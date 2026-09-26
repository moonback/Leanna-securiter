/**
 * TriageClusterEngine — Triage assisté par regroupement de causes racines.
 *
 * Objectif : transformer une liste plate de findings en un petit nombre de
 * grappes (clusters) partageant une même cause racine, puis prioriser ces
 * grappes par RISQUE RÉEL plutôt que par sévérité nominale isolée.
 *
 * Le regroupement est DÉTERMINISTE (aucun aléa, aucun appel réseau) : deux
 * exécutions sur les mêmes findings produisent exactement le même résultat,
 * conformément au principe de déterminisme de Leanna.
 *
 * Heuristique de cause racine :
 *   - SAST / IaC : (CWE principal) × (répertoire du fichier) — une même classe
 *     de faiblesse répétée dans une même zone de code = une seule cause.
 *   - Secrets    : (type de secret via ruleId) — un secret répété = une cause.
 *   - SCA        : (paquet vulnérable) extrait du ruleId / de la localisation.
 *
 * Priorisation par risque réel (score 0–100) :
 *   base sévérité (max de la grappe)
 *     × facteur de volume (plusieurs occurrences = surface plus large)
 *     × multiplicateurs d'exploitabilité (CISA KEV, corroboration DAST, EPSS).
 */

import type { Finding } from '../findings/Finding.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageCluster {
  /** Identifiant stable dérivé de la clé de cause racine. */
  id: string;
  /** Clé de cause racine lisible (ex: "CWE-89@server/routes"). */
  rootCauseKey: string;
  /** Titre synthétique de la cause. */
  title: string;
  /** CWE dominant de la grappe (le plus fréquent). */
  dominantCwe: string | null;
  /** OWASP dominant de la grappe. */
  dominantOwasp: string | null;
  /** Sévérité la plus élevée observée dans la grappe. */
  maxSeverity: Finding['severity'];
  /** Nombre de findings regroupés. */
  size: number;
  /** IDs des findings membres. */
  findingIds: string[];
  /** Fichiers distincts touchés. */
  affectedFiles: string[];
  /** true si au moins un finding est marqué CISA KEV. */
  hasKev: boolean;
  /** true si au moins un finding a été confirmé (ex: corroboré DAST). */
  hasConfirmed: boolean;
  /** Score EPSS maximal observé (0–1), si disponible. */
  maxEpss: number | null;
  /** Score de risque réel 0–100 (déterministe). */
  riskScore: number;
  /** Remédiation consolidée recommandée pour toute la grappe. */
  consolidatedRemediation: string;
}

export interface TriageClusterReport {
  generatedAt: string;
  totalFindings: number;
  clusterCount: number;
  clusters: TriageCluster[];
  summary: {
    /** Nombre de grappes à risque critique (score ≥ 80). */
    criticalClusters: number;
    /** ID de la grappe la plus prioritaire, le cas échéant. */
    topClusterId: string | null;
  };
}

// ---------------------------------------------------------------------------
// Constantes de scoring
// ---------------------------------------------------------------------------

const SEVERITY_BASE: Record<Finding['severity'], number> = {
  critical: 55,
  high: 40,
  medium: 25,
  low: 12,
  info: 4,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dirOf(filePath: string | undefined): string {
  if (!filePath) return 'unknown';
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '.' : norm.slice(0, idx);
}

function primaryCwe(f: Finding): string | null {
  if (Array.isArray(f.cwe) && f.cwe.length > 0) return f.cwe[0].toUpperCase();
  return null;
}

function primaryOwasp(f: Finding): string | null {
  if (Array.isArray(f.owasp) && f.owasp.length > 0) {
    const m = f.owasp[0].toUpperCase().match(/A\d{1,2}:\d{4}/);
    return m ? m[0] : f.owasp[0];
  }
  return null;
}

/**
 * Extrait le nom du paquet pour un finding SCA. On tente le ruleId
 * (souvent "PKG@version" ou "CVE-...") puis un motif dans le titre.
 */
function packageKey(f: Finding): string {
  const fromTitle = f.title.match(/([a-z0-9._-]+)@[0-9]/i);
  if (fromTitle) return fromTitle[1].toLowerCase();
  return f.ruleId.toLowerCase();
}

/** Calcule la clé de cause racine déterministe d'un finding. */
export function rootCauseKeyFor(f: Finding): string {
  switch (f.scanner) {
    case 'sca':
      return `sca:${packageKey(f)}`;
    case 'secrets':
      return `secrets:${f.ruleId.toLowerCase()}`;
    case 'sast':
    case 'iac':
    case 'dast':
    default: {
      const weakness = primaryCwe(f) ?? f.ruleId.toUpperCase();
      return `${weakness}@${dirOf(f.location?.filePath)}`;
    }
  }
}

const SEVERITY_ORDER: Finding['severity'][] = ['info', 'low', 'medium', 'high', 'critical'];

function maxSeverity(findings: Finding[]): Finding['severity'] {
  return findings.reduce<Finding['severity']>((acc, f) => {
    return SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(acc) ? f.severity : acc;
  }, 'info');
}

/** Renvoie l'élément le plus fréquent d'une liste, ou null si vide. */
function mode(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  // Itération triée pour un résultat déterministe en cas d'égalité.
  for (const key of [...counts.keys()].sort()) {
    const c = counts.get(key)!;
    if (c > bestCount) { best = key; bestCount = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

export class TriageClusterEngine {
  /**
   * Regroupe et priorise les findings.
   * @param findings Findings à trier (typiquement les findings ouverts/confirmés).
   */
  cluster(findings: Finding[]): TriageClusterReport {
    const groups = new Map<string, Finding[]>();
    for (const f of findings) {
      const key = rootCauseKeyFor(f);
      const arr = groups.get(key);
      if (arr) arr.push(f);
      else groups.set(key, [f]);
    }

    const clusters: TriageCluster[] = [];
    // Tri des clés pour un ordre de construction déterministe.
    for (const key of [...groups.keys()].sort()) {
      const members = groups.get(key)!;
      clusters.push(this.buildCluster(key, members));
    }

    // Tri par risque décroissant ; départage stable par id.
    clusters.sort((a, b) => (b.riskScore - a.riskScore) || a.id.localeCompare(b.id));

    const criticalClusters = clusters.filter((c) => c.riskScore >= 80).length;

    return {
      generatedAt: new Date().toISOString(),
      totalFindings: findings.length,
      clusterCount: clusters.length,
      clusters,
      summary: {
        criticalClusters,
        topClusterId: clusters.length > 0 ? clusters[0].id : null,
      },
    };
  }

  private buildCluster(key: string, members: Finding[]): TriageCluster {
    const sev = maxSeverity(members);
    const dominantCwe = mode(members.map(primaryCwe));
    const dominantOwasp = mode(members.map(primaryOwasp));
    const affectedFiles = [
      ...new Set(members.map((f) => (f.location?.filePath ?? 'unknown').replace(/\\/g, '/'))),
    ].sort();
    const hasKev = members.some((f) => f.cisaKev === true);
    const hasConfirmed = members.some((f) => f.status === 'confirmed');
    const epssValues = members
      .map((f) => f.epssScore)
      .filter((v): v is number => typeof v === 'number');
    const maxEpss = epssValues.length > 0 ? Math.max(...epssValues) : null;

    const riskScore = this.scoreCluster({ sev, size: members.length, hasKev, hasConfirmed, maxEpss });

    return {
      id: `cluster-${this.slug(key)}`,
      rootCauseKey: key,
      title: this.titleFor(key, members[0], dominantCwe),
      dominantCwe,
      dominantOwasp,
      maxSeverity: sev,
      size: members.length,
      findingIds: members.map((f) => f.id),
      affectedFiles,
      hasKev,
      hasConfirmed,
      maxEpss,
      riskScore,
      consolidatedRemediation: this.remediationFor(members),
    };
  }

  /**
   * Score de risque réel, borné à [0, 100].
   *   base sévérité
   *   + bonus de volume (log-ish : plafonné pour éviter qu'une grappe énorme
   *     de findings low n'écrase un critical isolé)
   *   × multiplicateurs d'exploitabilité (KEV, confirmation, EPSS).
   */
  private scoreCluster(input: {
    sev: Finding['severity'];
    size: number;
    hasKev: boolean;
    hasConfirmed: boolean;
    maxEpss: number | null;
  }): number {
    const base = SEVERITY_BASE[input.sev];
    const volumeBonus = Math.min(20, Math.round(Math.log2(input.size + 1) * 6));
    let score = base + volumeBonus;

    // Multiplicateurs d'exploitabilité (cumulatifs mais bornés).
    if (input.hasKev) score *= 1.35;          // activement exploité dans la nature
    if (input.hasConfirmed) score *= 1.2;     // corroboré dynamiquement (DAST)
    if (input.maxEpss !== null) score *= 1 + Math.min(0.25, input.maxEpss * 0.25);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private titleFor(key: string, sample: Finding, dominantCwe: string | null): string {
    if (key.startsWith('sca:')) {
      return `Dépendance vulnérable : ${key.slice(4)}`;
    }
    if (key.startsWith('secrets:')) {
      return `Secret exposé : ${sample.ruleName || key.slice(8)}`;
    }
    const where = key.includes('@') ? key.split('@')[1] : '';
    const weakness = dominantCwe ?? sample.ruleId;
    return `${weakness}${where ? ` dans ${where}` : ''}`;
  }

  /**
   * Choisit une remédiation consolidée : la remédiation du finding le plus sévère
   * de la grappe fait référence pour toute la cause racine.
   */
  private remediationFor(members: Finding[]): string {
    const sorted = [...members].sort(
      (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity),
    );
    const withRemediation = sorted.find((f) => f.remediation && f.remediation.trim().length > 0);
    const base = withRemediation?.remediation?.trim()
      ?? 'Corriger la cause racine commune à tous les findings de cette grappe.';
    if (members.length > 1) {
      return `${base} (Applique-toi à corriger les ${members.length} occurrences de cette même cause en une seule passe.)`;
    }
    return base;
  }

  private slug(key: string): string {
    return key.replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 80);
  }
}
