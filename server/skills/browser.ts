/**
 * browserSkill — Skill qui permet à Leanna de contrôler le navigateur
 * intégré (BrowserPanel / Electron webview) visible dans l'interface.
 *
 * Contrairement à automationBrowser (Puppeteer headless), ces outils
 * pilotent le navigateur visible par l'utilisateur via des événements
 * IPC (emitIdeAction → CustomEvent → BrowserPanel).
 *
 * v2 — ajout de :
 *   - browser_get_links       : extraction des liens de la page
 *   - browser_open_link       : ouvrir un lien par texte / fragment d'URL
 *   - browser_research        : recherche + lecture automatique de N sources
 *   - browser_search          : moteur configurable (google/bing/duckduckgo/wikipedia)
 *   - lecture avec retry       : évite les pages lues "vides" faute d'avoir fini de charger
 *   - troncature de contenu   : évite de saturer le contexte du modèle
 *
 * NOTE IMPORTANTE : browser_get_links (et donc browser_open_link / browser_research)
 * introduit un NOUVEL événement IPC "browser-get-links". Ce fichier ne peut piloter
 * que le canal serveur ; il faut aussi ajouter le handler correspondant côté
 * BrowserPanel.tsx (client) pour que l'extraction fonctionne réellement.
 * Voir le commentaire "CLIENT REQUIS" plus bas pour le contrat exact attendu.
 */

import { Skill, validateArgs } from "./base.js";
import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Schémas explicitement interdits : évite qu'un prompt malveillant ou une
// URL mal formée fasse exécuter du JS, charger un fichier local, ou
// afficher du contenu data: arbitraire dans le webview visible par l'user.
const BLOCKED_SCHEMES = /^(javascript|data|file|vbscript|about):/i;

export type BrowserNetworkPolicy = "PUBLIC_WEB" | "PUBLIC_WEB_AND_LOCALHOST";
// Autorise les serveurs de développement locaux nommés localhost sans ouvrir
// les IP loopback, les réseaux privés ou les endpoints de métadonnées.
const NETWORK_POLICY: BrowserNetworkPolicy = "PUBLIC_WEB_AND_LOCALHOST";

// Domaines à exclure des résultats de recherche quand on extrait des liens
// "à visiter" (pages de moteurs de recherche, trackers, etc.)
const NON_CONTENT_DOMAINS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "webcache.googleusercontent.com",
  "translate.google.",
  "accounts.google.",
  "policies.google.",
  "support.google.",
];

const MAX_CONTENT_LENGTH = 15_000; // caractères — évite de saturer le contexte du modèle

export interface LinkCandidate {
  href: string;
  text: string;
  domain: string;
  position: number;
  relevance: number;
  isSponsored: boolean;
  isNavigation: boolean;
  isExternal: boolean;
}

export interface ResearchSource {
  url: string;
  title: string;
  domain: string;
  content: string;
  contentLength: number;
  reliability: number;
  freshness: { score: number; label: "recent" | "dated" | "unknown"; date?: string };
  facts: string[];
  evidence: string[];
  contradictions: string[];
}

export interface ResearchResult {
  query: string;
  sources: ResearchSource[];
  consensus: string[];
  contradictions: Array<{ claim: string; sources: string[] }>;
  confidence: number;
}

const RESEARCH_STOP_WORDS = new Set(["avec", "dans", "pour", "plus", "this", "that", "from", "have", "about", "their", "elles", "sont", "être", "comme"]);

function sourceReliability(url: string, content: string): number {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  let score = parsed.protocol === "https:" ? 0.55 : 0.35;
  if (/\.(gov|gouv|edu|ac\.[a-z]{2})$/i.test(host)) score += 0.25;
  if (/^www\.(reuters|apnews|bbc|who|un|nature|arxiv)\./i.test(host)) score += 0.2;
  if (content.length > 1200) score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}

function sourceFreshness(content: string, url: string): ResearchSource["freshness"] {
  const dateMatch = `${content.slice(0, 4000)} ${url}`.match(/\b(20\d{2})[-/]([01]\d)[-/]([0-3]\d)\b|\b([01]?\d)[-/]([0-3]?\d)[-/](20\d{2})\b/);
  if (!dateMatch) return { score: 0.5, label: "unknown" };
  const year = Number(dateMatch[1] ?? dateMatch[6]);
  const month = Number(dateMatch[2] ?? dateMatch[4] ?? 1);
  const day = Number(dateMatch[3] ?? dateMatch[5] ?? 1);
  const ageDays = Math.max(0, (Date.now() - new Date(year, month - 1, day).getTime()) / 86_400_000);
  return { score: Number(Math.max(0, 1 - ageDays / 1825).toFixed(2)), label: ageDays <= 365 ? "recent" : "dated", date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

function extractSourceEvidence(content: string, query: string): { facts: string[]; evidence: string[] } {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 3);
  const sentences = content.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 35 && sentence.length <= 500);
  const relevant = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return terms.some((term) => lower.includes(term)) || /\b\d+(?:[.,]\d+)?\s*%?\b/.test(sentence);
  }).slice(0, 8);
  return { facts: relevant.slice(0, 5), evidence: relevant.slice(0, 8) };
}

function claimKey(claim: string): string {
  return claim.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 3 && !RESEARCH_STOP_WORDS.has(word)).slice(0, 8).join(" ");
}

function compareResearchSources(sources: ResearchSource[]): Pick<ResearchResult, "consensus" | "contradictions" | "confidence"> {
  const claims = new Map<string, Array<{ source: ResearchSource; claim: string }>>();
  for (const source of sources) {
    for (const claim of source.facts) {
      const key = claimKey(claim);
      if (key) claims.set(key, [...(claims.get(key) ?? []), { source, claim }]);
    }
  }
  const consensus: string[] = [];
  const contradictions: Array<{ claim: string; sources: string[] }> = [];
  for (const entries of claims.values()) {
    if (entries.length < 2) continue;
    const numbers = new Set(entries.map((entry) => entry.claim.match(/\b\d+(?:[.,]\d+)?\s*%?\b/g)?.join(",") ?? "none"));
    const negations = new Set(entries.map((entry) => /\b(not|no|ne|pas|sans|never|jamais)\b/i.test(entry.claim)));
    if (numbers.size > 1 || negations.size > 1) {
      contradictions.push({ claim: entries[0].claim, sources: entries.map((entry) => entry.source.url) });
      entries.forEach((entry) => entry.source.contradictions.push(`Divergence avec ${entries.filter((other) => other.source !== entry.source).map((other) => other.source.domain).join(", ")}`));
    } else {
      consensus.push(entries[0].claim);
    }
  }
  const diversity = new Set(sources.map((source) => source.domain)).size / Math.max(1, sources.length);
  const evidenceRate = sources.length ? sources.filter((source) => source.evidence.length > 0).length / sources.length : 0;
  const quality = sources.length ? sources.reduce((sum, source) => sum + source.reliability * source.freshness.score, 0) / sources.length : 0;
  return { consensus: consensus.slice(0, 10), contradictions: contradictions.slice(0, 10), confidence: Number(Math.max(0, Math.min(1, quality * 0.45 + diversity * 0.2 + evidenceRate * 0.2 + (consensus.length > 0 ? 0.15 : 0))).toFixed(2)) };
}

function classifyHost(hostname: string): "PUBLIC_WEB" | "PRIVATE_NETWORK" | "LOCALHOST" | "LOOPBACK" | "LINK_LOCAL" | "INTERNAL" {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return "LOCALHOST";
  if (host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") return "INTERNAL";
  if (host === "::1" || host === "0.0.0.0" || host === "[::1]") return "LOOPBACK";
  if (host.startsWith("fe80:") || host.startsWith("fe8") || host.startsWith("fec") || host.startsWith("fed") || host.startsWith("fee") || host.startsWith("fef")) return "LINK_LOCAL";
  if (host.startsWith("fc") || host.startsWith("fd")) return "PRIVATE_NETWORK";

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return "PUBLIC_WEB";
  const [first, second] = octets;
  if (first === 127) return "LOOPBACK";
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127) || (first === 198 && second >= 18 && second <= 19)) return "PRIVATE_NETWORK";
  if (first === 169 && second === 254) return "LINK_LOCAL";
  return "PUBLIC_WEB";
}

function assertAllowedBrowserUrl(url: string): void {
  const parsed = new URL(url);
  const classification = classifyHost(parsed.hostname);
  const localhostAllowed = NETWORK_POLICY === "PUBLIC_WEB_AND_LOCALHOST" && classification === "LOCALHOST";
  if (classification !== "PUBLIC_WEB" && !localhostAllowed) {
    throw new Error(`Destination ${classification} interdite par la policy ${NETWORK_POLICY}.`);
  }
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) return "https://www.google.com";

  if (BLOCKED_SCHEMES.test(trimmed)) {
    throw new Error(`Schéma d'URL non autorisé : ${trimmed.slice(0, 20)}...`);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    assertAllowedBrowserUrl(trimmed);
    return trimmed;
  }

  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(trimmed) && !trimmed.includes(" ")) {
    const normalized = `https://${trimmed}`;
    assertAllowedBrowserUrl(normalized);
    return normalized;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function buildSearchUrl(engine: string, query: string): string {
  const q = encodeURIComponent(query);
  switch (engine) {
    case "bing":
      return `https://www.bing.com/search?q=${q}`;
    case "duckduckgo":
      return `https://duckduckgo.com/html/?q=${q}`;
    case "wikipedia":
      return `https://fr.wikipedia.org/w/index.php?search=${q}`;
    case "google":
    default:
      return `https://www.google.com/search?q=${q}`;
  }
}

function truncateContent(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_CONTENT_LENGTH) return { content, truncated: false };
  return {
    content: content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[...contenu tronqué...]",
    truncated: true,
  };
}

function isContentDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !NON_CONTENT_DOMAINS.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

function canonicalizeLink(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$|ref$)/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

export function rankLinkCandidates(
  links: Array<{ text?: string; href?: string }>,
  currentUrl?: string
): LinkCandidate[] {
  const currentDomain = currentUrl ? (() => { try { return new URL(currentUrl).hostname; } catch { return ""; } })() : "";
  const seen = new Set<string>();
  const candidates: LinkCandidate[] = [];

  links.forEach((link, position) => {
    if (!link?.href) return;
    let href: string;
    try {
      href = normalizeUrl(link.href);
      href = canonicalizeLink(href);
      if (seen.has(href) || !isContentDomain(href)) return;
      seen.add(href);
    } catch {
      return;
    }
    const text = (link.text ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    const lower = `${text} ${href}`.toLowerCase();
    const isSponsored = /sponsor|advert|annonce|pub|ads\b|promoted|utm_|gclid|fbclid/.test(lower);
    const isNavigation = /^(home|accueil|login|sign in|connexion|menu|search|recherche|privacy|terms|contact|about|à propos|next|previous|suivant|précédent)$/i.test(text)
      || /\/login(?:[/?#]|$)|\/signup(?:[/?#]|$)|\/privacy(?:[/?#]|$)|\/terms(?:[/?#]|$)/i.test(href);
    const domain = new URL(href).hostname;
    const isExternal = Boolean(currentDomain && domain !== currentDomain);
    const relevance = Math.max(0, 100 - position) + (text.length >= 20 ? 15 : 0) + (isExternal ? 5 : 0) - (isSponsored ? 100 : 0) - (isNavigation ? 50 : 0);
    candidates.push({ href, text, domain, position, relevance, isSponsored, isNavigation, isExternal });
  });

  return candidates.sort((a, b) => b.relevance - a.relevance || a.position - b.position);
}

// Petit wrapper pour garantir qu'on ne renvoie jamais "success" si l'IPC
// n'est pas disponible (context.emitIdeAction manquant), et pour uniformiser
// la forme des erreurs renvoyées au modèle.
function withEmit<T>(
  emit: ((action: any) => void) | undefined,
  fn: (emit: (action: any) => void) => T
): T | { status: "error"; message: string } {
  if (!emit) {
    return {
      status: "error",
      message:
        "Le panneau navigateur n'est pas disponible dans ce contexte (emitIdeAction manquant).",
    };
  }
  try {
    return fn(emit);
  } catch (err: any) {
    return {
      status: "error",
      message: err?.message ?? "Erreur inconnue lors de l'appel au navigateur intégré.",
    };
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const navigateSchema = z.object({
  url: z.string().min(1, "URL requise"),
});

const searchEngineEnum = z.enum(["google", "bing", "duckduckgo", "wikipedia"]);

const searchSchema = z.object({
  query: z.string().min(1, "Requête de recherche requise"),
  engine: searchEngineEnum.optional().default("google"),
});

const scrollSchema = z.object({
  direction: z.enum(["down", "up", "top", "bottom"]).default("down"),
  amount: z.number().int().positive().max(5000, "amount trop élevé (max 5000px)").default(300),
});

const emptySchema = z.object({});

const readContentSchema = z.object({
  selector: z.string().optional(),
});

const clickSchema = z.object({
  selector: z.string().min(1, "Sélecteur CSS requis"),
});

const typeSchema = z.object({
  selector: z.string().min(1, "Sélecteur CSS requis"),
  text: z.string(),
  pressEnter: z.boolean().optional().default(false),
});

const inspectSchema = z.object({
  type: z.enum(["buttons", "inputs", "links", "all"]).default("all"),
});

const summarizePageSchema = z.object({
  url: z.string().min(1, "URL requise"),
  selector: z.string().optional(),
});

const getLinksSchema = z.object({
  selector: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});

const openLinkSchema = z
  .object({
    text: z.string().optional(),
    urlContains: z.string().optional(),
  })
  .refine((d) => !!(d.text?.trim() || d.urlContains?.trim()), {
    message: "Fournis au moins 'text' (texte visible du lien) ou 'urlContains' (fragment d'URL).",
  });

const researchSchema = z.object({
  query: z.string().min(1, "Requête de recherche requise"),
  engine: searchEngineEnum.optional().default("google"),
  maxSources: z.number().int().positive().max(5).default(3),
});

// ─── Sprint 1 — Nouveaux schemas ──────────────────────────────────────────────

// J1 — Accessibilité
const accessibilitySnapshotSchema = z.object({});

const clickByRoleSchema = z.object({
  role: z.string().min(1, "Rôle ARIA requis (ex: button, link, textbox, combobox)"),
  name: z.string().min(1, "Nom accessible requis (ex: libellé visible ou aria-label)"),
  waitFor: z.string().optional(),
});

const typeByLabelSchema = z.object({
  label: z.string().min(1, "Libellé du champ requis (ex: 'Email', 'Recherche')"),
  text: z.string(),
  pressEnter: z.boolean().optional().default(false),
  waitFor: z.string().optional(),
});

// J2 — Robustesse (waitFor ajouté aux actions existantes)
const waitForSchema = z.object({
  condition: z.string().min(1, "Condition requise"),
  conditionType: z.enum(["selector", "text", "url"]).default("selector"),
  timeout: z.number().int().positive().max(30000).default(10000),
});

// J3 — Actions primitives
const getElementTextSchema = z.object({
  selector: z.string().min(1, "Sélecteur CSS requis"),
});

const getElementAttributeSchema = z.object({
  selector: z.string().min(1, "Sélecteur CSS requis"),
  attribute: z.string().min(1, "Nom de l'attribut requis (ex: href, src, value, data-id)"),
});

const fillFormSchema = z.object({
  selector: z.string().min(1, "Sélecteur CSS requis"),
  value: z.string(),
  waitFor: z.string().optional(),
});

const selectOptionSchema = z.object({
  selector: z.string().min(1, "Sélecteur CSS de l'élément <select> requis"),
  value: z.string().min(1, "Valeur de l'option à sélectionner requise"),
});

// ─── Skill ────────────────────────────────────────────────────────────────────

export const browserSkill: Skill = {
  name: "browser",

  declarations: [
    {
      name: "browser_navigate",
      description:
        "Ouvre le navigateur intégré et navigue vers une URL. Le navigateur s'affiche dans l'interface. Utilise browser_read_content() pour lire le contenu après navigation.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "L'URL à visiter (ex: https://example.com). Peut être une URL complète, un domaine, ou un terme de recherche (sera automatiquement converti en recherche Google).",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "browser_open",
      description:
        "Ouvre le panneau navigateur intégré sans changer l'URL. Utile pour révéler le navigateur.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_search",
      description:
        "Effectue une recherche dans le navigateur. Utilise browser_get_links() pour extraire les résultats et browser_navigate() pour ouvrir un lien.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Le terme ou la question à rechercher",
          },
          engine: {
            type: "STRING",
            description: "Moteur de recherche : 'google' (défaut), 'bing', 'duckduckgo', ou 'wikipedia'.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "browser_close",
      description: "Ferme (cache) le panneau navigateur intégré.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_scroll",
      description: "Fait défiler la page affichée dans le navigateur. À utiliser quand l'utilisateur dit 'scrolle', 'descends', 'fais défiler', ou quand le contenu est tronqué et qu'il faut voir plus bas.",
      parameters: {
        type: "OBJECT",
        properties: {
          direction: {
            type: "STRING",
            description:
              "Direction : 'down' (défiler vers le bas), 'up' (vers le haut), 'top' (retour en haut), 'bottom' (aller tout en bas). Défaut : 'down'.",
          },
          amount: {
            type: "NUMBER",
            description: "Pixels à défiler (ignoré pour 'top' et 'bottom', max 5000). Défaut : 300.",
          },
        },
      },
    },
    {
      name: "browser_back",
      description: "Revient à la page précédente dans l'historique. À utiliser quand l'utilisateur dit 'retourne en arrière', 'page précédente', 'reviens'.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_forward",
      description: "Avance à la page suivante dans l'historique du navigateur intégré.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_reload",
      description: "Recharge la page actuellement affichée. À utiliser si la page est vide, bloquée, ou si l'utilisateur dit 'recharge', 'actualise'.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_read_content",
      description:
        "Lit et retourne le contenu textuel de la page actuellement affichée. À appeler après browser_navigate ou browser_search pour extraire les informations et pouvoir répondre à l'utilisateur. Supporte un sélecteur CSS optionnel pour cibler une section précise.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description:
              "Optionnel. Sélecteur CSS pour n'extraire qu'une partie de la page (ex: 'article', 'main', '.content', '#results'). Si omis, extrait tout le contenu visible.",
          },
        },
      },
    },
    {
      name: "browser_get_links",
      description:
        "Extrait tous les liens (texte visible + URL absolue) de la page actuellement affichée. OUTIL CLÉ après browser_search : récupère les liens des résultats Google/Bing pour ensuite naviguer. Aussi utilisé pour 'ouvre le premier lien' (→ links[0]), 'ouvre le deuxième' (→ links[1]), 'ouvre le lien Wikipedia' (→ filtrer par urlContains:'wikipedia').",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description:
              "Optionnel. Limite l'extraction aux liens dans ce sélecteur CSS (ex: '#search', 'article'). Si omis, extrait tous les liens de la page.",
          },
          limit: {
            type: "NUMBER",
            description: "Nombre maximum de liens à retourner (défaut 50, max 200).",
          },
        },
      },
    },
    {
      name: "browser_open_link",
      description:
        "Ouvre un lien de la page courante identifié par son texte visible et/ou un fragment d'URL. UTILISATION PRINCIPALE : quand l'utilisateur dit 'ouvre le lien [texte]' ou 'ouvre celui de Wikipedia/YouTube/etc'. Récupère automatiquement les liens de la page et navigue vers le premier qui correspond. Ne nécessite pas de sélecteur CSS.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "Texte visible du lien (ou fragment, insensible à la casse). Ex: 'En savoir plus', 'Wikipedia', titre d'un résultat.",
          },
          urlContains: {
            type: "STRING",
            description: "Fragment que l'URL doit contenir. Ex: 'wikipedia.org', 'youtube.com', '/article/'.",
          },
        },
      },
    },
    {
      name: "browser_click",
      description:
        "Clique sur un élément de la page (bouton, lien, etc.). OBLIGATOIRE : appeler browser_snapshot() d'abord pour obtenir les sélecteurs CSS valides. Ne jamais inventer un sélecteur.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description:
              "Sélecteur CSS de l'élément (ex: 'button#submit', '.search-btn'). Doit provenir de browser_snapshot ou browser_inspect.",
          },
        },
        required: ["selector"],
      },
    },
    {
      name: "browser_type",
      description:
        "Saisit du texte dans un champ de la page (input, textarea). OBLIGATOIRE : appeler browser_snapshot() d'abord pour obtenir le sélecteur CSS valide du champ. Utiliser pressEnter:true pour valider une recherche.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Sélecteur CSS du champ (ex: 'input[name=\"q\"]', '#search'). Doit provenir de browser_snapshot.",
          },
          text: {
            type: "STRING",
            description: "Le texte à saisir.",
          },
          pressEnter: {
            type: "BOOLEAN",
            description: "Si true, appuie sur Entrée après la saisie (pour valider un formulaire de recherche). Défaut : false.",
          },
        },
        required: ["selector", "text"],
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Retourne la liste des éléments interactifs visibles (inputs, boutons) avec leurs sélecteurs CSS VALIDES. APPELER SYSTÉMATIQUEMENT avant browser_click ou browser_type. Indispensable pour interagir avec n'importe quelle page.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_summarize_page",
      description:
        "OUTIL TOUT-EN-UN : navigue vers une URL ET lit immédiatement son contenu en une seule étape. C'est l'outil préféré quand tu as une URL précise à consulter. Le navigateur s'ouvre, l'utilisateur voit la page, et tu reçois le contenu pour répondre.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "L'URL à visiter et lire.",
          },
          selector: {
            type: "STRING",
            description:
              "Optionnel. Sélecteur CSS pour n'extraire qu'une partie de la page.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "browser_research",
      description:
        "RECHERCHE APPROFONDIE AUTOMATIQUE. Lance une recherche, extrait les liens des résultats, visite et lit automatiquement jusqu'à maxSources pages, puis retourne tout le contenu. À utiliser pour les sujets complexes, comparaisons multi-sources, ou quand l'utilisateur dit 'fais une recherche approfondie', 'compare plusieurs sources', 'enquête sur'. Synthétise ensuite les résultats en citant les sources.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Le sujet ou la question à rechercher.",
          },
          engine: {
            type: "STRING",
            description: "Moteur : 'google' (défaut), 'bing', 'duckduckgo', 'wikipedia'.",
          },
          maxSources: {
            type: "NUMBER",
            description: "Nombre de pages à visiter et lire (défaut 3, max 5).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "browser_inspect",
      description:
        "Inspecte les éléments d'un type précis sur la page (boutons, champs, liens, ou tous) et retourne leurs sélecteurs CSS. Alternative à browser_snapshot pour cibler un type d'élément spécifique.",
      parameters: {
        type: "OBJECT",
        properties: {
          type: {
            type: "STRING",
            description: "Type : 'buttons', 'inputs', 'links', ou 'all'. Défaut : 'all'.",
          },
        },
      },
    },

    // ── Sprint 1 — J1 : Accessibilité ─────────────────────────────────────────
    {
      name: "browser_get_accessibility_snapshot",
      description:
        "Retourne l'arbre d'accessibilité (ARIA) de la page : rôles, noms accessibles, états (disabled, checked, expanded) et sélecteurs CSS. PRÉFÉRER cet outil à browser_snapshot pour les SPA (React, Vue, Angular) où les classes CSS sont instables. Retourne au moins 90% des éléments interactifs y compris les composants ARIA custom.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "browser_click_by_role",
      description:
        "Clique sur un élément identifié par son rôle ARIA et son nom accessible. OUTIL PRÉFÉRÉ pour les SPA où les sélecteurs CSS sont instables. Ex: role='button', name='Valider'. Supporte un paramètre waitFor optionnel pour attendre qu'un sélecteur ou du texte apparaisse après le clic.",
      parameters: {
        type: "OBJECT",
        properties: {
          role: {
            type: "STRING",
            description: "Rôle ARIA de l'élément : 'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', etc.",
          },
          name: {
            type: "STRING",
            description: "Nom accessible de l'élément (texte visible, aria-label, ou aria-labelledby). Insensible à la casse.",
          },
          waitFor: {
            type: "STRING",
            description: "Optionnel. Sélecteur CSS ou texte à attendre après le clic (ex: '#results', 'Chargement terminé'). Attend jusqu'à 5s.",
          },
        },
        required: ["role", "name"],
      },
    },
    {
      name: "browser_type_by_label",
      description:
        "Saisit du texte dans un champ identifié par son libellé (label HTML associé, aria-label, ou placeholder). OUTIL PRÉFÉRÉ pour les formulaires car plus stable que les sélecteurs CSS. Efface le contenu existant avant de saisir. Ex: label='Email', text='user@example.com'.",
      parameters: {
        type: "OBJECT",
        properties: {
          label: {
            type: "STRING",
            description: "Libellé du champ : texte du <label> associé, aria-label, ou placeholder. Insensible à la casse.",
          },
          text: {
            type: "STRING",
            description: "Le texte à saisir dans le champ.",
          },
          pressEnter: {
            type: "BOOLEAN",
            description: "Si true, appuie sur Entrée après la saisie. Défaut : false.",
          },
          waitFor: {
            type: "STRING",
            description: "Optionnel. Sélecteur CSS ou texte à attendre après la saisie.",
          },
        },
        required: ["label", "text"],
      },
    },

    // ── Sprint 1 — J2 : Robustesse ────────────────────────────────────────────
    {
      name: "browser_wait_for",
      description:
        "Attend qu'une condition soit remplie sur la page avant de continuer. Utile pour les SPA où les éléments apparaissent de manière asynchrone. Supporte : l'apparition d'un sélecteur CSS, la présence d'un texte dans la page, ou un changement d'URL.",
      parameters: {
        type: "OBJECT",
        properties: {
          condition: {
            type: "STRING",
            description: "Ce qu'on attend : un sélecteur CSS (ex: '#results'), un texte (ex: 'Chargement terminé'), ou un pattern d'URL (ex: '/dashboard').",
          },
          conditionType: {
            type: "STRING",
            description: "Type de condition : 'selector' (défaut), 'text', ou 'url'.",
          },
          timeout: {
            type: "NUMBER",
            description: "Timeout en millisecondes (défaut 10000, max 30000).",
          },
        },
        required: ["condition"],
      },
    },

    // ── Sprint 1 — J3 : Actions primitives ───────────────────────────────────
    {
      name: "browser_get_element_text",
      description:
        "Retourne le texte visible d'un élément ciblé par un sélecteur CSS. Utile pour lire la valeur d'un champ, le contenu d'un badge, d'un message d'erreur, ou d'un statut dynamique sans avoir à lire toute la page.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Sélecteur CSS de l'élément dont on veut lire le texte (ex: '#error-msg', '.price', 'h1').",
          },
        },
        required: ["selector"],
      },
    },
    {
      name: "browser_get_element_attribute",
      description:
        "Retourne la valeur d'un attribut HTML spécifique d'un élément (href, src, value, data-*, aria-*, class, etc.). Utile pour extraire des URLs de liens, des sources d'images, des valeurs de champs cachés, ou des métadonnées.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Sélecteur CSS de l'élément.",
          },
          attribute: {
            type: "STRING",
            description: "Nom de l'attribut à lire (ex: 'href', 'src', 'value', 'data-id', 'aria-expanded').",
          },
        },
        required: ["selector", "attribute"],
      },
    },
    {
      name: "browser_fill_form",
      description:
        "Efface le contenu d'un champ puis saisit une nouvelle valeur en simulant la saisie caractère par caractère (déclenche les événements input/change nécessaires aux frameworks comme React/Vue). PRÉFÉRER cet outil à browser_type pour les formulaires dynamiques avec validation en temps réel.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Sélecteur CSS du champ (input, textarea, ou contenteditable). Doit provenir de browser_snapshot ou browser_get_accessibility_snapshot.",
          },
          value: {
            type: "STRING",
            description: "La valeur à saisir dans le champ (remplace tout contenu existant).",
          },
          waitFor: {
            type: "STRING",
            description: "Optionnel. Sélecteur CSS ou texte à attendre après la saisie (ex: '.suggestions-list' pour une liste d'autocomplétion).",
          },
        },
        required: ["selector", "value"],
      },
    },
    {
      name: "browser_select_option",
      description:
        "Sélectionne une option dans un élément <select> (liste déroulante native). Déclenche les événements change pour les frameworks réactifs. Fournir la valeur (attribut value de l'option) ou le texte visible.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Sélecteur CSS de l'élément <select>.",
          },
          value: {
            type: "STRING",
            description: "Valeur de l'option (attribut value) ou texte visible de l'option à sélectionner.",
          },
        },
        required: ["selector", "value"],
      },
    },
  ],

  inputSchemas: {
    browser_navigate: navigateSchema,
    browser_open: emptySchema,
    browser_search: searchSchema,
    browser_close: emptySchema,
    browser_scroll: scrollSchema,
    browser_back: emptySchema,
    browser_forward: emptySchema,
    browser_reload: emptySchema,
    browser_read_content: readContentSchema,
    browser_get_links: getLinksSchema,
    browser_open_link: openLinkSchema,
    browser_click: clickSchema,
    browser_type: typeSchema,
    browser_snapshot: emptySchema,
    browser_inspect: inspectSchema,
    browser_summarize_page: summarizePageSchema,
    browser_research: researchSchema,
    // Sprint 1 — J1
    browser_get_accessibility_snapshot: accessibilitySnapshotSchema,
    browser_click_by_role: clickByRoleSchema,
    browser_type_by_label: typeByLabelSchema,
    // Sprint 1 — J2
    browser_wait_for: waitForSchema,
    // Sprint 1 — J3
    browser_get_element_text: getElementTextSchema,
    browser_get_element_attribute: getElementAttributeSchema,
    browser_fill_form: fillFormSchema,
    browser_select_option: selectOptionSchema,
  },

  handleToolCall: async (name: string, args: any, context?: any) => {
    const emit = context?.emitIdeAction as ((action: any) => void) | undefined;

    // Helper générique pour les actions async (click/type/snapshot/inspect/get-links)
    // qui utilisent le registre browserActionPending de server.ts.
    const runBrowserAction = async <T = any>(action: any, timeoutMs = 15_000): Promise<T | string> => {
      const pending = context?.browserActionPending as Map<string, {
        resolve: (value: any) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }> | undefined;
      if (!pending) return "[ERREUR] browserActionPending non disponible dans le contexte.";
      if (!emit) return "[ERREUR] emitIdeAction non disponible.";

      const requestId = `ba_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Timeout (${(timeoutMs / 1000).toFixed(0)}s) — navigateur non disponible ou en chargement.`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        emit({ requestId, ...action });
      }).catch((err: Error) => `[ERREUR ACTION] ${err.message}`);
    };

    // Helper avec retry exponentiel (Sprint 1 — J2)
    // Ré-essaie l'action jusqu'à 3 fois si elle échoue :
    //   1er essai immédiat, 2e après 1s, 3e après 3s.
    const runBrowserActionWithRetry = async <T = any>(
      action: any,
      timeoutMs = 15_000,
      maxAttempts = 3
    ): Promise<T | string> => {
      const delays = [0, 1_000, 3_000];
      let lastResult: T | string = "[ERREUR] Aucune tentative effectuée.";
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (delays[attempt] > 0) {
          await new Promise<void>((r) => setTimeout(r, delays[attempt]));
        }
        lastResult = await runBrowserAction<T>(action, timeoutMs);
        // Succès si ce n'est pas une chaîne d'erreur et que found/ok n'est pas false
        if (typeof lastResult !== "string") {
          const r = lastResult as any;
          if (r?.found === false) {
            // Élément pas encore dans le DOM — retenter
            continue;
          }
          return lastResult;
        }
        // Timeout ou erreur réseau — retenter
      }
      return lastResult;
    };

    const waitForBrowserCondition = async (
      condition: string,
      conditionType: "selector" | "text" | "url" = "selector",
      timeout = 10_000
    ): Promise<boolean> => {
      const result = await runBrowserAction({
        type: "browser-wait-for",
        condition,
        conditionType,
        timeout,
      }, timeout + 2_000);
      return typeof result !== "string" && (result as any)?.found !== false;
    };

    // ── browser_navigate ──────────────────────────────────────────────────────
    if (name === "browser_navigate") {
      const { url } = validateArgs(browserSkill.inputSchemas!["browser_navigate"], args);

      return withEmit(emit, (fire) => {
        const normalized = normalizeUrl(url); // peut throw → capté par withEmit
        fire({ type: "open-browser" });
        fire({ type: "browser-navigate", url: normalized });
        return {
          status: "success",
          url: normalized,
          message: `Le navigateur intégré navigue vers : ${normalized}`,
        };
      });
    }

    // ── browser_open ──────────────────────────────────────────────────────────
    if (name === "browser_open") {
      validateArgs(browserSkill.inputSchemas!["browser_open"], args);
      return withEmit(emit, (fire) => {
        fire({ type: "open-browser" });
        return { status: "success", message: "Le panneau navigateur est maintenant visible." };
      });
    }

    // ── browser_search ────────────────────────────────────────────────────────
    if (name === "browser_search") {
      const { query, engine } = validateArgs(browserSkill.inputSchemas!["browser_search"], args);
      const searchUrl = buildSearchUrl(engine, query);

      return withEmit(emit, (fire) => {
        fire({ type: "open-browser" });
        fire({ type: "browser-navigate", url: searchUrl });
        return {
          status: "success",
          url: searchUrl,
          query,
          engine,
          message: `Recherche "${query}" en cours sur ${engine} dans le navigateur.`,
        };
      });
    }

    // ── browser_close ─────────────────────────────────────────────────────────
    if (name === "browser_close") {
      validateArgs(browserSkill.inputSchemas!["browser_close"], args);
      return withEmit(emit, (fire) => {
        fire({ type: "close-browser" });
        return { status: "success", message: "Le panneau navigateur est fermé." };
      });
    }

    // ── browser_scroll ────────────────────────────────────────────────────────
    if (name === "browser_scroll") {
      const { direction, amount } = validateArgs(browserSkill.inputSchemas!["browser_scroll"], args);
      return withEmit(emit, (fire) => {
        fire({ type: "browser-scroll", direction, amount });
        return {
          status: "success",
          direction,
          amount,
          message: `Défilement ${direction} de ${amount}px dans le navigateur.`,
        };
      });
    }

    // ── browser_back ──────────────────────────────────────────────────────────
    if (name === "browser_back") {
      validateArgs(browserSkill.inputSchemas!["browser_back"], args);
      return withEmit(emit, (fire) => {
        fire({ type: "browser-back" });
        return { status: "success", message: "Retour à la page précédente." };
      });
    }

    // ── browser_forward ───────────────────────────────────────────────────────
    if (name === "browser_forward") {
      validateArgs(browserSkill.inputSchemas!["browser_forward"], args);
      return withEmit(emit, (fire) => {
        fire({ type: "browser-forward" });
        return { status: "success", message: "Avance à la page suivante." };
      });
    }

    // ── browser_reload ────────────────────────────────────────────────────────
    if (name === "browser_reload") {
      validateArgs(browserSkill.inputSchemas!["browser_reload"], args);
      return withEmit(emit, (fire) => {
        fire({ type: "browser-reload" });
        return { status: "success", message: "Page rechargée." };
      });
    }

    // ── Helper interne : lire le contenu de la page courante ─────────────────
    // Utilisé par browser_read_content, browser_summarize_page ET browser_research.
    const readPageContent = async (selector?: string | null): Promise<{
      status: "success" | "error";
      url?: string;
      title?: string;
      content?: string;
      contentLength?: number;
      message: string;
    }> => {
      if (!emit) {
        return { status: "error", message: "Le navigateur n'est pas disponible dans ce contexte." };
      }

      const pending = context?.browserReadPending as Map<string, {
        resolve: (text: string) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }> | undefined;

      if (!pending) {
        return { status: "error", message: "browserReadPending non disponible dans le contexte." };
      }

      const requestId = `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Timeout plus long pour laisser le temps à la page de charger
      const TIMEOUT_MS = 18_000;

      const text = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("Timeout (18s) : la webview n'a pas répondu. Le navigateur est peut-être fermé ou la page met trop de temps à charger."));
        }, TIMEOUT_MS);
        pending.set(requestId, { resolve, reject, timer });
        emit({ type: "browser-read-request", requestId, selector: selector ?? null });
      }).catch((err: Error) => `[ERREUR LECTURE] ${err.message}`);

      // Tenter de parser si le script a retourné un JSON {title, url, text}
      let parsed: { title?: string; url?: string; text?: string } | null = null;
      if (typeof text === "string" && text.startsWith("{") && text.includes('"text"')) {
        try { parsed = JSON.parse(text); } catch { /* pas du JSON */ }
      }

      if (parsed) {
        const { content, truncated } = truncateContent(parsed.text ?? "");
        return {
          status: "success",
          url: parsed.url ?? "",
          title: parsed.title ?? "",
          content,
          contentLength: content.length,
          message: `Contenu extrait de "${parsed.title ?? parsed.url ?? "la page"}" (${content.length} caractères${truncated ? ", tronqué" : ""}).`,
        };
      }

      // Réponse en texte brut (pas de JSON)
      if (typeof text === "string" && text.startsWith("[ERREUR")) {
        return { status: "error", message: text };
      }

      const { content, truncated } = truncateContent(text);
      return {
        status: "success",
        content,
        contentLength: content.length,
        message: `Contenu extrait (${content.length} caractères${truncated ? ", tronqué" : ""}).`,
      };
    };

    // Variante avec retry : relit la page si le premier essai renvoie un
    // contenu quasi vide (souvent signe que la page n'a pas fini de charger
    // au moment de la lecture). Évite de dépendre d'un seul délai fixe.
    const readPageContentWithRetry = async (
      selector?: string | null,
      attempts = 3,
      delayMs = 1500
    ): Promise<Awaited<ReturnType<typeof readPageContent>>> => {
      let last = await readPageContent(selector);
      let tries = 1;
      while (
        tries < attempts &&
        (last.status === "error" || (last.content ?? "").trim().length < 40)
      ) {
        await waitForBrowserCondition(selector ?? "body", "selector", delayMs);
        last = await readPageContent(selector);
        tries += 1;
      }
      return last;
    };

    // ── browser_summarize_page ────────────────────────────────────────────────
    // Combine browser_navigate + browser_read_content (avec retry) en une seule étape.
    if (name === "browser_summarize_page") {
      const { url, selector } = validateArgs(browserSkill.inputSchemas!["browser_summarize_page"], args);

      if (!emit) {
        return {
          status: "error",
          message: "Le panneau navigateur n'est pas disponible dans ce contexte (emitIdeAction manquant).",
        };
      }

      let normalized: string;
      try {
        normalized = normalizeUrl(url);
      } catch (err: any) {
        return { status: "error", message: err.message };
      }

      // 1. Ouvrir le navigateur et naviguer
      emit({ type: "open-browser" });
      emit({ type: "browser-navigate", url: normalized });

      // 2. Attendre un signal observable plutôt qu'un délai fixe.
      await waitForBrowserCondition(normalized, "url", 10_000);

      // 3. Lire le contenu, avec retry si la page n'a pas fini de charger
      const result = await readPageContentWithRetry(selector ?? null);

      if (result.status === "error") {
        return {
          status: "error",
          url: normalized,
          message: `Navigation vers ${normalized} réussie mais lecture impossible : ${result.message}. Réessaie avec browser_read_content après quelques secondes.`,
        };
      }

      return {
        status: "success",
        url: result.url || normalized,
        title: result.title ?? "",
        content: result.content ?? "",
        contentLength: result.contentLength ?? 0,
        message: `Page "${result.title || normalized}" chargée et lue (${result.contentLength ?? 0} caractères).`,
      };
    }

    // ── browser_read_content ──────────────────────────────────────────────────
    // Canal retour : le skill envoie un browser-read-request via emitIdeAction
    // → useLiveAPI dispatche Leanna-browser-read-request
    // → BrowserPanel exécute executeJavaScript et POST /api/browser/content-result
    // → la promesse ici est résolue avec le texte extrait
    if (name === "browser_read_content") {
      const { selector } = validateArgs(browserSkill.inputSchemas!["browser_read_content"], args);
      const result = await readPageContentWithRetry(selector ?? null, 2, 1200);

      if (result.status === "error") {
        return result;
      }

      return {
        status: "success",
        url: result.url ?? "",
        title: result.title ?? "",
        content: result.content ?? "",
        contentLength: result.contentLength ?? 0,
        message: result.message,
      };
    }

    // ── browser_get_links ─────────────────────────────────────────────────────
    // CLIENT REQUIS : BrowserPanel.tsx doit gérer un nouveau cas d'action
    // { type: "browser-get-links", requestId, selector } et répondre via
    // POST /api/browser/action-result avec { requestId, result: links }
    // où links = Array<{ text: string; href: string }> (URLs résolues en absolu,
    // via `new URL(a.getAttribute('href'), location.href).href`, dédupliquées).
    // Voir le snippet fourni séparément pour l'implémentation exacte.
    if (name === "browser_get_links") {
      const { selector, limit } = validateArgs(browserSkill.inputSchemas!["browser_get_links"], args);
      const raw = await runBrowserAction({ type: "browser-get-links", selector: selector ?? null }, 12_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const links = (Array.isArray(raw) ? raw : raw?.links ?? []) as Array<{ text?: string; href?: string }>;
      const cleaned = rankLinkCandidates(links).slice(0, limit);

      return {
        status: "success",
        count: cleaned.length,
        links: cleaned,
        message: `${cleaned.length} lien(s) extrait(s) de la page.`,
      };
    }

    // ── browser_open_link ─────────────────────────────────────────────────────
    // Récupère les liens de la page courante puis navigue vers le premier qui
    // correspond au texte et/ou au fragment d'URL demandé.
    if (name === "browser_open_link") {
      const { text, urlContains } = validateArgs(browserSkill.inputSchemas!["browser_open_link"], args);

      const raw = await runBrowserAction({ type: "browser-get-links", selector: null }, 12_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const links = (Array.isArray(raw) ? raw : raw?.links ?? []) as Array<{ text?: string; href?: string }>;
      const candidates = rankLinkCandidates(links);

      const wantedText = text?.trim().toLowerCase();
      const wantedUrl = urlContains?.trim().toLowerCase();

      const match = candidates.find((l) => {
        const linkText = l.text.toLowerCase();
        const linkHref = l.href.toLowerCase();
        const textOk = wantedText ? linkText.includes(wantedText) : true;
        const urlOk = wantedUrl ? linkHref.includes(wantedUrl) : true;
        return !l.isSponsored && textOk && urlOk;
      });

      if (!match) {
        return {
          status: "error",
          message: `Aucun lien correspondant trouvé sur la page (text="${text ?? ""}", urlContains="${urlContains ?? ""}"). Utilise browser_get_links pour voir les liens disponibles.`,
        };
      }

      return withEmit(emit, (fire) => {
        const normalized = normalizeUrl(match.href);
        fire({ type: "open-browser" });
        fire({ type: "browser-navigate", url: normalized });
        return {
          status: "success",
          url: normalized,
          matchedText: match.text,
          message: `Ouverture du lien "${match.text || normalized}".`,
        };
      });
    }

    // ── browser_research ──────────────────────────────────────────────────────
    // Enchaîne : recherche → extraction des liens de résultats → lecture des
    // N meilleures sources (hors pages de moteur de recherche / trackers).
    if (name === "browser_research") {
      if (!emit) {
        return { status: "error", message: "Le panneau navigateur n'est pas disponible dans ce contexte." };
      }

      const { query, engine, maxSources } = validateArgs(browserSkill.inputSchemas!["browser_research"], args);
      const searchUrl = buildSearchUrl(engine, query);

      // 1. Lancer la recherche
      emit({ type: "open-browser" });
      emit({ type: "browser-navigate", url: searchUrl });
      await waitForBrowserCondition(searchUrl, "url", 10_000);

      // 2. Extraire les liens de la page de résultats
      const rawLinks = await runBrowserAction({ type: "browser-get-links", selector: null }, 12_000);
      if (typeof rawLinks === "string") {
        return {
          status: "error",
          message: `Recherche lancée sur ${engine} mais extraction des liens impossible : ${rawLinks}`,
        };
      }
      const links = (Array.isArray(rawLinks) ? rawLinks : rawLinks?.links ?? []) as Array<{ text?: string; href?: string }>;
      const rankedLinks = rankLinkCandidates(links);

      // 3. Filtrer : garder des URLs http(s) valides, hors domaines "non-contenu",
      //    et dédupliquer par domaine pour diversifier les sources.
      const seenDomains = new Set<string>();
      const candidates: string[] = [];
      for (const l of rankedLinks) {
        if (l.isSponsored || l.isNavigation) continue;
        const domain = l.domain;
        if (seenDomains.has(domain)) continue;
        seenDomains.add(domain);
        candidates.push(l.href);
        if (candidates.length >= maxSources) break;
      }

      if (candidates.length === 0) {
        return {
          status: "error",
          searchUrl,
          message: `Recherche effectuée sur ${engine} mais aucune source exploitable détectée. Consulte manuellement avec browser_read_content ou browser_get_links.`,
        };
      }

      // 4. Visiter et lire chaque source
      const sources: ResearchSource[] = [];
      const errors: Array<{ url: string; message: string }> = [];

      for (const url of candidates) {
        emit({ type: "browser-navigate", url });
        await waitForBrowserCondition(url, "url", 10_000);
        const result = await readPageContentWithRetry(null, 2, 1200);
        if (result.status === "success") {
          const sourceUrl = result.url || url;
          const content = result.content ?? "";
          const extracted = extractSourceEvidence(content, query);
          sources.push({
            url: sourceUrl,
            title: result.title ?? "",
            domain: new URL(sourceUrl).hostname,
            content,
            contentLength: result.contentLength ?? content.length,
            reliability: sourceReliability(sourceUrl, content),
            freshness: sourceFreshness(content, sourceUrl),
            facts: extracted.facts,
            evidence: extracted.evidence,
            contradictions: [],
          });
        } else {
          errors.push({ url, message: result.message });
        }
      }

      const comparison = compareResearchSources(sources);
      const research: ResearchResult = {
        query,
        sources,
        consensus: comparison.consensus,
        contradictions: comparison.contradictions,
        confidence: comparison.confidence,
      };

      return {
        status: sources.length > 0 ? "success" : "error",
        query,
        engine,
        searchUrl,
        sourcesRead: sources.length,
        sources,
        consensus: research.consensus,
        contradictions: research.contradictions,
        confidence: research.confidence,
        errors: errors.length ? errors : undefined,
        message:
          sources.length > 0
            ? `${sources.length} source(s) lue(s) pour "${query}". Consensus: ${research.consensus.length}, contradictions: ${research.contradictions.length}, confiance: ${(research.confidence * 100).toFixed(0)}%. Cite les preuves par URL/titre.`
            : `Aucune source n'a pu être lue pour "${query}".`,
      };
    }

    // ── browser_click ─────────────────────────────────────────────────────────
    if (name === "browser_click") {
      const { selector } = validateArgs(browserSkill.inputSchemas!["browser_click"], args);
      const raw = await runBrowserAction({ type: "browser-click", selector }, 10_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      return {
        status: "success",
        selector,
        message: `Clic effectué sur : ${selector}`,
        pageContent: raw?.content ?? "",
      };
    }

    // ── browser_type ──────────────────────────────────────────────────────────
    if (name === "browser_type") {
      const { selector, text, pressEnter } = validateArgs(browserSkill.inputSchemas!["browser_type"], args);
      const raw = await runBrowserAction({ type: "browser-type", selector, text, pressEnter }, 15_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      return {
        status: "success",
        selector,
        pressEnter,
        message: `Saisie de ${text.length} caractère(s) dans ${selector}${pressEnter ? " + Entrée" : ""}.`,
      };
    }

    // ── browser_snapshot ─────────────────────────────────────────────────────
    if (name === "browser_snapshot") {
      validateArgs(browserSkill.inputSchemas!["browser_snapshot"], args);
      const raw = await runBrowserAction({ type: "browser-snapshot" }, 12_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const snap = raw as { url?: string; title?: string; inputs?: any[]; buttons?: any[] };
      return {
        status: "success",
        url: snap.url ?? "",
        title: snap.title ?? "",
        inputs: snap.inputs ?? [],
        buttons: snap.buttons ?? [],
        note: "Utilise UNIQUEMENT les sélecteurs listés ci-dessus pour browser_click / browser_type. N'invente PAS de sélecteurs.",
      };
    }

    // ── browser_inspect ──────────────────────────────────────────────────────
    if (name === "browser_inspect") {
      const { type } = validateArgs(browserSkill.inputSchemas!["browser_inspect"], args);
      const raw = await runBrowserAction({ type: "browser-inspect", inspectType: type }, 12_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      return {
        status: "success",
        type,
        elements: raw ?? {},
        note: "Utilise UNIQUEMENT ces sélecteurs pour browser_click / browser_type.",
      };
    }

    // ── Sprint 1 — J1 : Accessibilité ─────────────────────────────────────────

    // ── browser_get_accessibility_snapshot ────────────────────────────────────
    if (name === "browser_get_accessibility_snapshot") {
      validateArgs(browserSkill.inputSchemas!["browser_get_accessibility_snapshot"], args);
      const raw = await runBrowserAction({ type: "browser-accessibility-snapshot" }, 12_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const snap = raw as { url?: string; title?: string; elements?: any[]; stats?: any };
      return {
        status: "success",
        url: snap.url ?? "",
        title: snap.title ?? "",
        elements: snap.elements ?? [],
        stats: snap.stats ?? {},
        note: "Utilise role + name pour browser_click_by_role / browser_type_by_label. Plus stable que les sélecteurs CSS sur les SPA.",
      };
    }

    // ── browser_click_by_role ─────────────────────────────────────────────────
    if (name === "browser_click_by_role") {
      const { role, name: accessibleName, waitFor } = validateArgs(
        browserSkill.inputSchemas!["browser_click_by_role"], args
      );
      const raw = await runBrowserActionWithRetry(
        { type: "browser-click-by-role", role, accessibleName, waitFor: waitFor ?? null },
        10_000
      );
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      return {
        status: "success",
        role,
        name: accessibleName,
        changed: (raw as any)?.changed ?? {},
        message: `Clic effectué sur l'élément [role="${role}" name="${accessibleName}"]${waitFor ? ` — attente de "${waitFor}" effectuée` : ""}.`,
      };
    }

    // ── browser_type_by_label ─────────────────────────────────────────────────
    if (name === "browser_type_by_label") {
      const { label, text, pressEnter, waitFor } = validateArgs(
        browserSkill.inputSchemas!["browser_type_by_label"], args
      );
      const raw = await runBrowserActionWithRetry(
        { type: "browser-type-by-label", label, text, pressEnter, waitFor: waitFor ?? null },
        15_000
      );
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      return {
        status: "success",
        label,
        pressEnter,
        changed: (raw as any)?.changed ?? {},
        message: `Saisie de "${text}" dans le champ "${label}"${pressEnter ? " + Entrée" : ""}${waitFor ? ` — attente de "${waitFor}" effectuée` : ""}.`,
      };
    }

    // ── Sprint 1 — J2 : Robustesse ────────────────────────────────────────────

    // ── browser_wait_for ──────────────────────────────────────────────────────
    if (name === "browser_wait_for") {
      const { condition, conditionType, timeout } = validateArgs(
        browserSkill.inputSchemas!["browser_wait_for"], args
      );
      const raw = await runBrowserAction(
        { type: "browser-wait-for", condition, conditionType, timeout },
        (timeout ?? 10_000) + 3_000
      );
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const result = raw as { found: boolean; elapsed?: number };
      return {
        status: result.found ? "success" : "error",
        conditionType,
        condition,
        elapsed: result.elapsed ?? 0,
        message: result.found
          ? `Condition "${condition}" (${conditionType}) remplie en ${result.elapsed ?? "?"}ms.`
          : `Timeout : condition "${condition}" (${conditionType}) non remplie après ${timeout}ms.`,
      };
    }

    // ── Sprint 1 — J3 : Actions primitives ───────────────────────────────────

    // ── browser_get_element_text ──────────────────────────────────────────────
    if (name === "browser_get_element_text") {
      const { selector } = validateArgs(browserSkill.inputSchemas!["browser_get_element_text"], args);
      const raw = await runBrowserAction({ type: "browser-get-element-text", selector }, 10_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const result = raw as { text?: string; found?: boolean };
      if (!result.found) {
        return { status: "error", message: `Élément introuvable : ${selector}` };
      }
      return {
        status: "success",
        selector,
        text: result.text ?? "",
        message: `Texte extrait de "${selector}" : ${(result.text ?? "").slice(0, 100)}${(result.text ?? "").length > 100 ? "..." : ""}`,
      };
    }

    // ── browser_get_element_attribute ─────────────────────────────────────────
    if (name === "browser_get_element_attribute") {
      const { selector, attribute } = validateArgs(
        browserSkill.inputSchemas!["browser_get_element_attribute"], args
      );
      const raw = await runBrowserAction(
        { type: "browser-get-element-attribute", selector, attribute },
        10_000
      );
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const result = raw as { value?: string | null; found?: boolean };
      if (!result.found) {
        return { status: "error", message: `Élément introuvable : ${selector}` };
      }
      return {
        status: "success",
        selector,
        attribute,
        value: result.value ?? null,
        message: result.value !== null && result.value !== undefined
          ? `Attribut "${attribute}" de "${selector}" = "${result.value}".`
          : `L'attribut "${attribute}" est absent sur l'élément "${selector}".`,
      };
    }

    // ── browser_fill_form ─────────────────────────────────────────────────────
    if (name === "browser_fill_form") {
      const { selector, value, waitFor } = validateArgs(
        browserSkill.inputSchemas!["browser_fill_form"], args
      );
      const raw = await runBrowserActionWithRetry(
        { type: "browser-fill-form", selector, value, waitFor: waitFor ?? null },
        15_000
      );
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const result = raw as { ok?: boolean; found?: boolean; changed?: any };
      if (!result.found) {
        return { status: "error", message: `Champ introuvable : ${selector}` };
      }
      return {
        status: "success",
        selector,
        value,
        changed: result.changed ?? {},
        message: `Champ "${selector}" rempli avec "${value.slice(0, 50)}${value.length > 50 ? "..." : ""}"${waitFor ? ` — attente de "${waitFor}" effectuée` : ""}.`,
      };
    }

    // ── browser_select_option ─────────────────────────────────────────────────
    if (name === "browser_select_option") {
      const { selector, value } = validateArgs(
        browserSkill.inputSchemas!["browser_select_option"], args
      );
      const raw = await runBrowserAction({ type: "browser-select-option", selector, value }, 10_000);
      if (typeof raw === "string") {
        return { status: "error", message: raw };
      }
      const result = raw as { ok?: boolean; found?: boolean; selectedText?: string };
      if (!result.found) {
        return { status: "error", message: `Élément <select> introuvable : ${selector}` };
      }
      if (!result.ok) {
        return {
          status: "error",
          message: `Option "${value}" introuvable dans le <select> "${selector}". Utilise browser_get_element_attribute pour inspecter les options disponibles.`,
        };
      }
      return {
        status: "success",
        selector,
        value,
        selectedText: result.selectedText ?? value,
        message: `Option "${result.selectedText ?? value}" sélectionnée dans "${selector}".`,
      };
    }

    return { status: "error", message: `Outil inconnu : ${name}` };
  },
};