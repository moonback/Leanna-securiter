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
}

export interface ThreatModel {
  generatedAt: string;
  entryPoints: EntryPoint[];
  assets: ThreatAsset[];
  actors: ThreatActor[];
  trustBoundaries: TrustBoundary[];
  dataFlows: DataFlow[];
  threats: Threat[];
  summary: {
    entryPointCount: number;
    threatCount: number;
    criticalThreats: number;
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

    // Menaces : une par finding, catégorisée STRIDE et rattachée à un actif/EP.
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
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      entryPoints,
      assets,
      actors,
      trustBoundaries,
      dataFlows,
      threats,
      summary: {
        entryPointCount: entryPoints.length,
        threatCount: threats.length,
        criticalThreats: threats.filter((t) => t.severity === 'critical').length,
      },
    };
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
