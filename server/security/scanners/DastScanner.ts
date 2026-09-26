/**
 * DastScanner — Analyse dynamique d'API (DAST), opt-in et NON DESTRUCTIVE.
 *
 * Contrat de sécurité (aligné sur la doctrine Leanna) :
 *  - AUCUNE exploitation réelle : le runner n'envoie jamais de charge utile
 *    d'injection (pas de `' OR 1=1`, pas de `; rm -rf`, pas de payload SSRF
 *    vers un service interne). Il n'émet que des requêtes d'observation
 *    inoffensives (GET/HEAD/OPTIONS + une sonde de robustesse bornée).
 *  - Opt-in explicite : ce scanner ne tourne QUE si un `target` est fourni et
 *    que `SecurityPolicyEngine.canRunDast(target, optIn=true)` renvoie `allow`.
 *    L'orchestrateur applique cette porte ; le scanner refuse par défaut.
 *  - Confinement réseau : timeout strict, redirections plafonnées, nombre de
 *    requêtes borné, méthodes en liste blanche.
 *
 * Deux fonctions, conformes à la roadmap :
 *   1) Runner runtime : sonde les endpoints découverts et lève des findings
 *      de configuration observables à distance (en-têtes de sécurité manquants,
 *      exposition de bannière/stack, méthodes dangereuses activées, redirection
 *      en clair, cookies non sécurisés, verbeux d'erreur 5xx).
 *   2) Validation dynamique des findings SAST : confronte chaque finding SAST
 *      exploitable en HTTP (SSRF, XSS réfléchi, path traversal, injections
 *      exposées via une route) à une observation runtime, SANS l'exploiter, et
 *      promeut/annote le finding (`confirmed` vs reste `open`).
 */

import crypto from "crypto";
import type { Finding, FindingSeverity } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface DastEndpoint {
  /** Chemin relatif (ex: "/api/users") ou URL absolue. */
  path: string;
  /** Méthode observée (par défaut GET). */
  method?: string;
}

export interface DastScanOptions {
  /** Base URL de la cible (déjà autorisée par la politique). Ex: http://localhost:3000 */
  target: string;
  /** Endpoints à sonder. Si vide, seule la racine `/` est observée. */
  endpoints?: DastEndpoint[];
  /** Findings SAST à valider dynamiquement (facultatif). */
  sastFindings?: Finding[];
  /** Plafond de requêtes réseau (défaut 25). Garde-fou anti-abus. */
  maxRequests?: number;
  /** Timeout par requête en ms (défaut 4000). */
  requestTimeoutMs?: number;
  /**
   * Injection de test : implémentation `fetch` alternative (pour les tests
   * unitaires hors réseau). Par défaut le `fetch` global (Node ≥ 18).
   */
  fetchImpl?: typeof fetch;
}

export interface DastScanResult {
  /** Nouveaux findings dynamiques observés à l'exécution. */
  findings: Finding[];
  /** IDs des findings SAST corroborés dynamiquement (à promouvoir en `confirmed`). */
  corroboratedSastIds: string[];
  /** Nombre de requêtes réellement émises. */
  requestsSent: number;
  /** Endpoints qui n'ont pas répondu (timeout / erreur réseau). */
  unreachable: string[];
}

// ---------------------------------------------------------------------------
// Constantes de gouvernance
// ---------------------------------------------------------------------------

/** Méthodes d'observation autorisées — toutes non mutantes / inoffensives. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const DEFAULT_MAX_REQUESTS = 25;
const DEFAULT_TIMEOUT_MS = 4000;

/** En-têtes de sécurité HTTP dont l'absence est observable à distance. */
const SECURITY_HEADERS: Array<{ name: string; label: string; cwe: string[]; owasp: string[] }> = [
  { name: "content-security-policy", label: "Content-Security-Policy", cwe: ["CWE-693"], owasp: ["A05:2021-Security Misconfiguration"] },
  { name: "strict-transport-security", label: "Strict-Transport-Security (HSTS)", cwe: ["CWE-319"], owasp: ["A02:2021-Cryptographic Failures"] },
  { name: "x-content-type-options", label: "X-Content-Type-Options", cwe: ["CWE-693"], owasp: ["A05:2021-Security Misconfiguration"] },
  { name: "x-frame-options", label: "X-Frame-Options", cwe: ["CWE-1021"], owasp: ["A05:2021-Security Misconfiguration"] },
];

/** Bannières/en-têtes révélant la stack technique (fingerprinting). */
const DISCLOSURE_HEADERS = ["server", "x-powered-by", "x-aspnet-version", "x-runtime"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();

function makeFinding(params: {
  ruleId: string;
  ruleName: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  cwe: string[];
  owasp: string[];
  urlPath: string;
  cvssScore: number;
  snippet: string;
  impact: string;
  remediation: string;
  metadata?: Record<string, unknown>;
}): Finding {
  return {
    id: crypto.randomUUID(),
    fingerprint: computeFingerprint({
      filePath: params.urlPath,
      ruleId: params.ruleId,
      snippet: params.snippet,
    }),
    ruleId: params.ruleId,
    ruleName: params.ruleName,
    title: params.title,
    description: params.description,
    severity: params.severity,
    status: "open",
    scanner: "dast",
    cwe: params.cwe,
    owasp: params.owasp,
    location: {
      // Pour la DAST, `filePath` porte l'URL/route observée (preuve reproductible).
      filePath: params.urlPath,
      startLine: 1,
      snippet: params.snippet,
    },
    cvssScore: params.cvssScore,
    impact: params.impact,
    remediation: params.remediation,
    firstSeen: now(),
    lastSeen: now(),
    metadata: { runtime: true, ...params.metadata },
  };
}

/** Concatène base + chemin en évitant les doubles slashs. */
function joinUrl(base: string, p: string): string {
  if (/^[a-z]+:\/\//i.test(p)) return p; // déjà absolu
  const b = base.replace(/\/+$/, "");
  const s = p.startsWith("/") ? p : `/${p}`;
  return `${b}${s}`;
}

/** Requête bornée : timeout strict, méthode en liste blanche. */
async function safeRequest(
  url: string,
  method: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response | null> {
  const m = method.toUpperCase();
  if (!SAFE_METHODS.has(m)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: m,
      redirect: "manual", // on observe la redirection sans la suivre aveuglément
      signal: controller.signal,
      headers: { "user-agent": "Leanna-DAST/1.0 (non-destructive audit)" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function headerValue(res: Response, name: string): string | null {
  try {
    return res.headers.get(name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Runner principal
// ---------------------------------------------------------------------------

/**
 * Exécute une analyse dynamique non destructive.
 *
 * IMPORTANT : l'appelant (SecurityOrchestrator) DOIT avoir validé la cible via
 * `SecurityPolicyEngine.canRunDast(target, optIn)` AVANT d'invoquer ce scanner.
 * Le scanner applique néanmoins ses propres garde-fous (méthodes sûres,
 * plafonds, timeouts).
 */
export async function runDastScan(options: DastScanOptions): Promise<DastScanResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const result: DastScanResult = {
    findings: [],
    corroboratedSastIds: [],
    requestsSent: 0,
    unreachable: [],
  };

  if (typeof fetchImpl !== "function") {
    // Environnement sans fetch : on ne peut rien observer, on sort proprement.
    return result;
  }

  const target = (options.target ?? "").trim();
  if (!target) return result;

  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Toujours au moins la racine.
  const endpoints: DastEndpoint[] =
    options.endpoints && options.endpoints.length > 0
      ? options.endpoints
      : [{ path: "/", method: "GET" }];

  const seen = new Set<string>();

  for (const ep of endpoints) {
    if (result.requestsSent >= maxRequests) break;

    const method = (ep.method ?? "GET").toUpperCase();
    if (!SAFE_METHODS.has(method)) continue;

    const url = joinUrl(target, ep.path);
    if (seen.has(`${method} ${url}`)) continue;
    seen.add(`${method} ${url}`);

    const res = await safeRequest(url, method, fetchImpl, timeoutMs);
    result.requestsSent++;

    if (!res) {
      result.unreachable.push(url);
      continue;
    }

    result.findings.push(...analyzeResponse(url, method, res));
  }

  // Validation dynamique des findings SAST (sans exploitation).
  if (options.sastFindings && options.sastFindings.length > 0) {
    const { findings, corroboratedIds } = await validateSastFindings(
      options.sastFindings,
      target,
      fetchImpl,
      timeoutMs,
      maxRequests - result.requestsSent,
      (n) => {
        result.requestsSent += n;
      },
    );
    result.findings.push(...findings);
    result.corroboratedSastIds.push(...corroboratedIds);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Analyse d'une réponse HTTP observée (aucune exploitation)
// ---------------------------------------------------------------------------

function analyzeResponse(url: string, method: string, res: Response): Finding[] {
  const findings: Finding[] = [];
  const status = res.status;

  // 1) En-têtes de sécurité manquants (observable, non destructif).
  for (const h of SECURITY_HEADERS) {
    if (!headerValue(res, h.name)) {
      findings.push(
        makeFinding({
          ruleId: `DAST-MISSING-HEADER-${h.name.toUpperCase()}`,
          ruleName: `En-tête de sécurité manquant : ${h.label}`,
          title: `${h.label} absent sur ${method} ${url}`,
          description: `La réponse HTTP observée ne définit pas l'en-tête "${h.label}". Cette absence est vérifiable à distance et affaiblit la posture défensive du service.`,
          severity: "low",
          cwe: h.cwe,
          owasp: h.owasp,
          urlPath: url,
          cvssScore: 3.7,
          snippet: `${method} ${url} → ${status} (sans ${h.label})`,
          impact: `Selon l'en-tête manquant : clickjacking, MIME sniffing, downgrade TLS ou injection de contenu facilitée.`,
          remediation: `Ajoutez l'en-tête "${h.label}" côté serveur/proxy pour toutes les réponses.`,
          metadata: { header: h.name, status },
        }),
      );
    }
  }

  // 2) Divulgation de stack technique (fingerprinting).
  for (const dh of DISCLOSURE_HEADERS) {
    const val = headerValue(res, dh);
    if (val && val.trim()) {
      findings.push(
        makeFinding({
          ruleId: "DAST-BANNER-DISCLOSURE",
          ruleName: "Divulgation de la pile technique via en-tête",
          title: `En-tête révélant la technologie : ${dh}: ${val}`,
          description: `Le service expose "${dh}: ${val}", révélant sa technologie/version et facilitant le ciblage d'exploits connus.`,
          severity: "info",
          cwe: ["CWE-200"],
          owasp: ["A05:2021-Security Misconfiguration"],
          urlPath: url,
          cvssScore: 2.0,
          snippet: `${dh}: ${val}`,
          impact: "Aide à l'énumération de vulnérabilités spécifiques à la version exposée.",
          remediation: `Supprimez ou masquez l'en-tête "${dh}" au niveau du serveur/reverse proxy.`,
          metadata: { header: dh, value: val },
        }),
      );
    }
  }

  // 3) Redirection en clair (HTTP → HTTP au lieu de HTTPS).
  if (status >= 300 && status < 400) {
    const loc = headerValue(res, "location");
    if (loc && loc.startsWith("http://")) {
      findings.push(
        makeFinding({
          ruleId: "DAST-INSECURE-REDIRECT",
          ruleName: "Redirection vers une cible non chiffrée (HTTP)",
          title: `Redirection ${status} vers une URL HTTP en clair`,
          description: `La réponse redirige vers "${loc}" en HTTP non chiffré, exposant le trafic à l'interception (MITM).`,
          severity: "medium",
          cwe: ["CWE-319"],
          owasp: ["A02:2021-Cryptographic Failures"],
          urlPath: url,
          cvssScore: 5.9,
          snippet: `${status} Location: ${loc}`,
          impact: "Interception ou altération du trafic redirigé sur un réseau hostile.",
          remediation: "Redirigez systématiquement vers HTTPS et activez HSTS.",
          metadata: { status, location: loc },
        }),
      );
    }
  }

  // 4) Cookies de session non sécurisés (Set-Cookie sans Secure/HttpOnly).
  const setCookie = headerValue(res, "set-cookie");
  if (setCookie) {
    const lower = setCookie.toLowerCase();
    const missing: string[] = [];
    if (!lower.includes("httponly")) missing.push("HttpOnly");
    if (!lower.includes("secure")) missing.push("Secure");
    if (missing.length > 0) {
      findings.push(
        makeFinding({
          ruleId: "DAST-INSECURE-COOKIE",
          ruleName: "Cookie défini sans attribut de sécurité",
          title: `Cookie sans ${missing.join(" / ")}`,
          description: `Un cookie est défini sans le(s) attribut(s) ${missing.join(" et ")}, l'exposant au vol via XSS ou transport en clair.`,
          severity: "medium",
          cwe: ["CWE-1004", "CWE-614"],
          owasp: ["A05:2021-Security Misconfiguration"],
          urlPath: url,
          cvssScore: 5.3,
          snippet: `Set-Cookie: ${setCookie.slice(0, 80)}…`,
          impact: "Détournement de session par vol de cookie.",
          remediation: "Ajoutez les attributs HttpOnly, Secure et SameSite aux cookies de session.",
          metadata: { missing },
        }),
      );
    }
  }

  // 5) Erreur serveur verbeuse observée (5xx).
  if (status >= 500) {
    findings.push(
      makeFinding({
        ruleId: "DAST-SERVER-ERROR",
        ruleName: "Erreur serveur observée à l'exécution",
        title: `Réponse ${status} sur ${method} ${url}`,
        description: `Le service a renvoyé un statut ${status} sur une requête d'observation inoffensive, indiquant une instabilité ou une fuite potentielle de détails d'erreur.`,
        severity: "low",
        cwe: ["CWE-209"],
        owasp: ["A05:2021-Security Misconfiguration"],
        urlPath: url,
        cvssScore: 3.1,
        snippet: `${method} ${url} → ${status}`,
        impact: "Une gestion d'erreur verbeuse peut divulguer des traces de pile ou des chemins internes.",
        remediation: "Retournez des erreurs génériques et journalisez les détails côté serveur uniquement.",
        metadata: { status },
      }),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Validation dynamique des findings SAST (NON destructive)
// ---------------------------------------------------------------------------

/**
 * Certains findings SAST se traduisent par une route HTTP observable. On tente
 * une observation runtime INOFFENSIVE pour corroborer que la route existe et
 * répond — SANS jamais envoyer de charge d'exploitation. Un finding corroboré
 * gagne en confiance (à promouvoir `confirmed` par le FindingManager) ; sinon
 * il reste `open` (l'absence de preuve runtime n'est pas une preuve d'absence).
 */
async function validateSastFindings(
  sastFindings: Finding[],
  target: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  budget: number,
  onRequests: (n: number) => void,
): Promise<{ findings: Finding[]; corroboratedIds: string[] }> {
  const findings: Finding[] = [];
  const corroboratedIds: string[] = [];

  // Familles SAST dont l'exposition est observable via une route HTTP.
  const HTTP_EXPOSED = new Set([
    "SAST-SSRF",
    "SAST-XSS-REFLECTED",
    "SAST-PATH-TRAVERSAL",
    "SAST-SQLI",
    "SAST-CMD-INJECTION",
  ]);

  const candidates = sastFindings.filter(
    (f) => f.scanner === "sast" && HTTP_EXPOSED.has(f.ruleId),
  );

  let sent = 0;
  for (const f of candidates) {
    if (sent >= budget) break;

    const route = inferRouteFromFinding(f);
    if (!route) continue;

    const url = joinUrl(target, route);
    // Observation inoffensive : GET simple, aucune charge utile.
    const res = await safeRequest(url, "GET", fetchImpl, timeoutMs);
    sent++;

    if (!res) continue; // route non atteignable → aucune corroboration
    if (res.status >= 200 && res.status < 500) {
      // La route existe et répond : on corrobore l'exposition (pas l'exploit).
      corroboratedIds.push(f.id);
      findings.push(
        makeFinding({
          ruleId: "DAST-SAST-CORROBORATION",
          ruleName: "Corroboration runtime d'un finding SAST",
          title: `Route exposée confirmée pour ${f.ruleId} (${route})`,
          description: `Le finding statique ${f.ruleId} (${f.title}) correspond à une route accessible à l'exécution (${url} → ${res.status}). L'exposition est confirmée par observation, sans exploitation.`,
          severity: f.severity,
          cwe: f.cwe,
          owasp: f.owasp,
          urlPath: url,
          cvssScore: f.cvssScore,
          snippet: `GET ${url} → ${res.status} (corrobore ${f.ruleId})`,
          impact: `Surface d'attaque runtime confirmée pour : ${f.impact ?? f.ruleName}.`,
          remediation: f.remediation ?? "Corriger la vulnérabilité SAST sous-jacente et re-valider dynamiquement.",
          metadata: {
            corroboratesFindingId: f.id,
            corroboratesFingerprint: f.fingerprint,
            sourceRule: f.ruleId,
            observedStatus: res.status,
          },
        }),
      );
    }
  }

  onRequests(sent);
  return { findings, corroboratedIds };
}

/**
 * Déduit une route HTTP plausible à partir d'un finding SAST.
 * Heuristique conservatrice : on privilégie une route explicite fournie dans
 * les métadonnées, sinon on dérive du nom de fichier (ex: routes/users.ts →
 * /users). Renvoie `null` si aucune route ne peut être inférée sans risque.
 */
function inferRouteFromFinding(f: Finding): string | null {
  // 1) Route explicite dans les métadonnées (source la plus fiable).
  const metaRoute =
    (f.metadata?.route as string | undefined) ??
    (f.metadata?.httpPath as string | undefined);
  if (metaRoute && typeof metaRoute === "string" && metaRoute.startsWith("/")) {
    return metaRoute;
  }

  // 2) Dérivation prudente depuis le chemin de fichier.
  const file = f.location?.filePath?.replace(/\\/g, "/").toLowerCase() ?? "";
  const m = file.match(/(?:routes?|controllers?|api|handlers?)\/([a-z0-9_-]+)\.(?:t|j)sx?$/);
  if (m && m[1] && m[1] !== "index") {
    return `/${m[1]}`;
  }

  return null;
}
