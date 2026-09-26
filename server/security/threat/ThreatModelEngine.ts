/**
 * ThreatModelEngine — Modélisation de menaces pilotée par les données (Phase 5)
 *
 * Produit un modèle de menace STRIDE à partir de signaux RÉELS plutôt que de
 * valeurs codées en dur :
 *   - entryPoints    : découverts statiquement dans server/routes/**.ts
 *   - assets         : dérivés de la topologie + findings (secrets, DB, etc.)
 *   - actors         : acteurs standards (utilisateur, agent autonome, externe)
 *   - trustBoundaries: frontières entre zones de confiance
 *   - dataFlows      : flux entrée → traitement → ressources
 *   - threats        : menaces STRIDE dérivées des findings (scanner/CWE)
 *
 * Aucune exécution : la découverte est une analyse statique bornée et confinée
 * au workspace.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Finding } from '../findings/Finding.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';

export interface EntryPoint {
  id: string;
  kind: 'http' | 'websocket';
  verb: HttpVerb;
  route: string;
  sourceFile: string;
  /** true si la route contient un paramètre dynamique (:id) — surface accrue. */
  parameterized: boolean;
}

export interface ThreatAsset {
  id: string;
  label: string;
  kind: 'data' | 'credential' | 'service' | 'infrastructure';
  sensitivity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ThreatActor {
  id: string;
  label: string;
  trust: 'untrusted' | 'semi-trusted' | 'trusted';
}

export interface TrustBoundary {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface DataFlow {
  id: string;
  from: string;
  to: string;
  description: string;
  crossesBoundary: boolean;
}

export type StrideCategory =
  | 'spoofing'
  | 'tampering'
  | 'repudiation'
  | 'information_disclosure'
  | 'denial_of_service'
  | 'elevation_of_privilege';

/** Technique MITRE ATT&CK rattachée à une menace (ex: T1190). */
export interface MitreTechnique {
  /** Identifiant ATT&CK (ex: "T1190"). */
  id: string;
  /** Nom lisible de la technique. */
  name: string;
  /** Tactique parente (ex: "Initial Access"). */
  tactic: string;
}

export interface Threat {
  id: string;
  stride: StrideCategory;
  title: string;
  description: string;
  severity: Finding['severity'];
  /** Actifs / points d'entrée affectés. */
  affects: string[];
  /** Findings sources ayant motivé la menace. */
  evidenceFindingIds: string[];
  /** Technique MITRE ATT&CK correspondante, ou null si aucune ne s'applique. */
  mitre: MitreTechnique | null;
}

/**
 * Couverture STRIDE par point d'entrée : indique, pour chaque catégorie, si au
 * moins une menace concrète la couvre. Consommable tel quel par les analyseurs
 * aval (sast_analyzer, auth_auditor) pour cibler les zones non couvertes.
 */
export interface StrideCoverageRow {
  entryPointId: string;
  route: string;
  verb: HttpVerb;
  /** true pour chaque catégorie STRIDE ayant au moins une menace rattachée. */
  covered: Record<StrideCategory, boolean>;
  /** Nombre de menaces rattachées à ce point d'entrée. */
  threatCount: number;
}

export interface ThreatModel {
  generatedAt: string;
  entryPoints: EntryPoint[];
  assets: ThreatAsset[];
  actors: ThreatActor[];
  trustBoundaries: TrustBoundary[];
  dataFlows: DataFlow[];
  threats: Threat[];
  /** Matrice de couverture STRIDE par point d'entrée. */
  strideCoverage: StrideCoverageRow[];
  summary: {
    entryPointCount: number;
    threatCount: number;
    criticalThreats: number;
    /** Nombre de techniques MITRE ATT&CK distinctes mappées. */
    mitreTechniqueCount: number;
  };
}

// ---------------------------------------------------------------------------
// Découverte statique des points d'entrée
// ---------------------------------------------------------------------------

const MAX_ROUTE_FILES = 300;
const ROUTE_DECL = /router\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/gi;

/**
 * Scanne `routesDir` (récursivement, borné) et extrait les déclarations de
 * routes Express. Analyse purement textuelle : aucune exécution de code.
 */
export function discoverHttpEntryPoints(routesDir: string): EntryPoint[] {
  const entryPoints: EntryPoint[] = [];
  if (!fs.existsSync(routesDir)) return entryPoints;

  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= MAX_ROUTE_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_ROUTE_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(abs);
      }
    }
  };
  walk(routesDir);

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(routesDir, file).replace(/\\/g, '/');
    ROUTE_DECL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUTE_DECL.exec(content)) !== null) {
      const verb = m[1].toUpperCase() as HttpVerb;
      const route = m[3];
      entryPoints.push({
        id: `ep-${verb.toLowerCase()}-${rel}-${route}`.replace(/[^a-zA-Z0-9._/-]/g, '_'),
        kind: 'http',
        verb,
        route,
        sourceFile: rel,
        parameterized: route.includes(':') || route.includes('*'),
      });
    }
  }

  return entryPoints;
}

// ---------------------------------------------------------------------------
// Synthèse STRIDE à partir des findings
// ---------------------------------------------------------------------------

/** Mappe un finding vers une catégorie STRIDE selon scanner/CWE. */
export function strideForFinding(f: Finding): StrideCategory {
  const cwes = (f.cwe ?? []).join(',').toUpperCase();
  const rule = f.ruleId.toUpperCase();

  if (f.scanner === 'secrets') return 'information_disclosure';
  if (f.scanner === 'sca') return 'elevation_of_privilege';

  // SAST / IaC / DAST — affiner par CWE.
  if (/CWE-89|CWE-78|CWE-943|CWE-502/.test(cwes) || /SQL|INJECT|DESERIAL/.test(rule)) {
    return 'tampering';
  }
  if (/CWE-79|XSS/.test(cwes) || /XSS/.test(rule)) return 'tampering';
  if (/CWE-22|PATH|TRAVERSAL/.test(cwes) || /CWE-200|DISCLOSURE/.test(rule)) {
    return 'information_disclosure';
  }
  if (/CWE-918|SSRF/.test(cwes) || /SSRF/.test(rule)) return 'information_disclosure';
  if (/CWE-287|CWE-306|AUTH/.test(cwes) || /AUTH/.test(rule)) return 'spoofing';
  if (/CWE-269|CWE-250|PRIV/.test(cwes)) return 'elevation_of_privilege';
  if (/CWE-400|DOS|RESOURCE/.test(cwes) || /REDOS|DOS/.test(rule)) return 'denial_of_service';

  return 'tampering';
}

/**
 * Mappe un finding vers une technique MITRE ATT&CK à partir de son CWE / scanner /
 * ruleId. Retourne `null` lorsqu'aucune technique ne correspond franchement —
 * conformément à la doctrine du rôle threat_modeler : ne jamais inventer une
 * technique pour « remplir une case ».
 */
export function mitreForFinding(f: Finding): MitreTechnique | null {
  const cwes = (f.cwe ?? []).join(',').toUpperCase();
  const rule = f.ruleId.toUpperCase();
  const test = (re: RegExp) => re.test(cwes) || re.test(rule);

  // Injection (SQL / commande / NoSQL) → Exploit Public-Facing Application.
  if (test(/CWE-89|CWE-78|CWE-943|CWE-90|SQL|INJECT|COMMAND/)) {
    return { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access' };
  }
  // Désérialisation / RCE via composant → Exploitation for Client Execution.
  if (test(/CWE-502|CWE-94|DESERIAL|RCE/)) {
    return { id: 'T1203', name: 'Exploitation for Client Execution', tactic: 'Execution' };
  }
  // XSS → Drive-by Compromise (exécution côté client via contenu web).
  if (test(/CWE-79|XSS/)) {
    return { id: 'T1189', name: 'Drive-by Compromise', tactic: 'Initial Access' };
  }
  // Secrets / credentials en clair → Unsecured Credentials.
  if (f.scanner === 'secrets' || test(/CWE-798|CWE-321|SECRET|CREDENTIAL|API_KEY/)) {
    return { id: 'T1552', name: 'Unsecured Credentials', tactic: 'Credential Access' };
  }
  // Auth cassée / absence de contrôle → Valid Accounts.
  if (test(/CWE-287|CWE-306|CWE-862|CWE-347|AUTH|JWT/)) {
    return { id: 'T1078', name: 'Valid Accounts', tactic: 'Defense Evasion' };
  }
  // Élévation de privilège / conteneur privilégié → Exploitation for Priv Esc.
  if (test(/CWE-269|CWE-250|PRIV|ROOT/)) {
    return { id: 'T1068', name: 'Exploitation for Privilege Escalation', tactic: 'Privilege Escalation' };
  }
  // SSRF → contournement du proxy / accès interne (Proxy).
  if (test(/CWE-918|SSRF/)) {
    return { id: 'T1090', name: 'Proxy', tactic: 'Command and Control' };
  }
  // Path traversal / divulgation → Data from Local System.
  if (test(/CWE-22|CWE-200|PATH|TRAVERSAL|DISCLOSURE/)) {
    return { id: 'T1005', name: 'Data from Local System', tactic: 'Collection' };
  }
  // Dépendance vulnérable (SCA) → Exploit Public-Facing Application (générique).
  if (f.scanner === 'sca') {
    return { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access' };
  }
  // DoS / épuisement de ressources → Endpoint Denial of Service.
  if (test(/CWE-400|DOS|REDOS|RESOURCE/)) {
    return { id: 'T1499', name: 'Endpoint Denial of Service', tactic: 'Impact' };
  }
  return null;
}

const STRIDE_LABEL: Record<StrideCategory, string> = {
  spoofing: 'Usurpation (Spoofing)',
  tampering: 'Altération (Tampering)',
  repudiation: 'Répudiation (Repudiation)',
  information_disclosure: 'Divulgation d\'information (Information Disclosure)',
  denial_of_service: 'Déni de service (DoS)',
  elevation_of_privilege: 'Élévation de privilège (EoP)',
};

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

export class ThreatModelEngine {
  constructor(private readonly workspaceRoot: string) {
    if (!workspaceRoot || !workspaceRoot.trim()) {
      throw new Error('[ThreatModelEngine] workspaceRoot requis.');
    }
  }

  /**
   * Construit le modèle de menace complet.
   * @param findings Findings ouverts issus de l'orchestrateur de sécurité.
   */
  build(findings: Finding[]): ThreatModel {
    const routesDir = path.join(this.workspaceRoot, 'server', 'routes');
    const entryPoints = discoverHttpEntryPoints(routesDir);

    const actors: ThreatActor[] = [
      { id: 'actor-user', label: 'Utilisateur / Client navigateur', trust: 'untrusted' },
      { id: 'actor-agent', label: 'Agent autonome (Leanna runtime)', trust: 'semi-trusted' },
      { id: 'actor-external', label: 'Services externes (LLM, registres, CVE)', trust: 'untrusted' },
    ];

    // Actifs : topologie de base + actifs révélés par les findings.
    const hasSecrets = findings.some((f) => f.scanner === 'secrets');
    const assets: ThreatAsset[] = [
      { id: 'asset-workspace', label: 'Code source du workspace', kind: 'data', sensitivity: 'high' },
      { id: 'asset-db', label: 'Base SQLite (mémoire & graphe)', kind: 'data', sensitivity: 'medium' },
      { id: 'asset-runtime', label: 'Runtime multi-agents (sandbox VM)', kind: 'service', sensitivity: 'high' },
      { id: 'asset-fs', label: 'Système de fichiers hôte', kind: 'infrastructure', sensitivity: 'critical' },
    ];
    if (hasSecrets) {
      assets.push({ id: 'asset-secrets', label: 'Secrets / jetons détectés', kind: 'credential', sensitivity: 'critical' });
    }

    const trustBoundaries: TrustBoundary[] = [
      { id: 'tb-net-app', label: 'Réseau public ↔ Application', from: 'actor-user', to: 'asset-runtime' },
      { id: 'tb-app-fs', label: 'Application ↔ Système de fichiers', from: 'asset-runtime', to: 'asset-fs' },
      { id: 'tb-app-ext', label: 'Application ↔ Services externes', from: 'asset-runtime', to: 'actor-external' },
    ];

    const dataFlows: DataFlow[] = [
      { id: 'df-in', from: 'actor-user', to: 'asset-runtime', description: 'Requêtes HTTP/WS entrantes', crossesBoundary: true },
      { id: 'df-fs', from: 'asset-runtime', to: 'asset-fs', description: 'Lecture/écriture fichiers projet', crossesBoundary: true },
      { id: 'df-db', from: 'asset-runtime', to: 'asset-db', description: 'Persistance mémoire/graphe', crossesBoundary: false },
      { id: 'df-ext', from: 'asset-runtime', to: 'actor-external', description: 'Appels LLM / enrichissement CVE', crossesBoundary: true },
    ];

    // Menaces : une par finding, catégorisée STRIDE, mappée MITRE et rattachée à un actif/EP.
    const threats: Threat[] = findings.map((f, i) => {
      const stride = strideForFinding(f);
      const affects = this.assetsForFinding(f, entryPoints);
      return {
        id: `threat-${i}-${f.id}`,
        stride,
        title: `${STRIDE_LABEL[stride]} — ${f.title}`,
        description: f.description,
        severity: f.severity,
        affects,
        evidenceFindingIds: [f.id],
        mitre: mitreForFinding(f),
      };
    });

    const strideCoverage = this.buildStrideCoverage(entryPoints, threats);

    const mitreTechniqueCount = new Set(
      threats.map((t) => t.mitre?.id).filter((id): id is string => Boolean(id)),
    ).size;

    return {
      generatedAt: new Date().toISOString(),
      entryPoints,
      assets,
      actors,
      trustBoundaries,
      dataFlows,
      threats,
      strideCoverage,
      summary: {
        entryPointCount: entryPoints.length,
        threatCount: threats.length,
        criticalThreats: threats.filter((t) => t.severity === 'critical').length,
        mitreTechniqueCount,
      },
    };
  }

  /**
   * Construit la matrice de couverture STRIDE par point d'entrée. Une menace est
   * rattachée à un point d'entrée lorsqu'elle le cite dans `affects`.
   */
  private buildStrideCoverage(entryPoints: EntryPoint[], threats: Threat[]): StrideCoverageRow[] {
    const categories: StrideCategory[] = [
      'spoofing',
      'tampering',
      'repudiation',
      'information_disclosure',
      'denial_of_service',
      'elevation_of_privilege',
    ];
    const emptyCoverage = (): Record<StrideCategory, boolean> =>
      categories.reduce((acc, c) => { acc[c] = false; return acc; }, {} as Record<StrideCategory, boolean>);

    return entryPoints.map((ep) => {
      const related = threats.filter((t) => t.affects.includes(ep.id));
      const covered = emptyCoverage();
      for (const t of related) covered[t.stride] = true;
      return {
        entryPointId: ep.id,
        route: ep.route,
        verb: ep.verb,
        covered,
        threatCount: related.length,
      };
    });
  }

  /** Rattache un finding aux actifs/points d'entrée qu'il menace. */
  private assetsForFinding(f: Finding, entryPoints: EntryPoint[]): string[] {
    const file = f.location?.filePath?.toLowerCase() ?? '';
    const affected: string[] = [];

    if (f.scanner === 'secrets') affected.push('asset-secrets');
    if (f.scanner === 'sca') affected.push('asset-runtime');
    if (f.scanner === 'iac') affected.push('asset-fs');

    const cwes = (f.cwe ?? []).join(',').toUpperCase();
    if (/CWE-89|CWE-943|SQL/.test(cwes) || /SQL/.test(f.ruleId.toUpperCase())) affected.push('asset-db');
    if (/CWE-22|PATH/.test(cwes)) affected.push('asset-fs');

    // Rattacher aux points d'entrée définis dans le même fichier source.
    const relatedEp = entryPoints.find((ep) => file.includes(ep.sourceFile.toLowerCase()));
    if (relatedEp) affected.push(relatedEp.id);

    if (affected.length === 0) affected.push('asset-workspace');
    return [...new Set(affected)];
  }
}
