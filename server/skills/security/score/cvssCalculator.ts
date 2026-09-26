/**
 * cvssCalculator — Calculateur CVSS v3.1 canonique
 * 
 * Analyse un vecteur CVSS (ex: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")
 * et calcule le score de base (0.0 - 10.0), la sévérité et l'impact.
 */

export interface CvssMetrics {
  av?: 'N' | 'A' | 'L' | 'P'; // Attack Vector
  ac?: 'L' | 'H';             // Attack Complexity
  pr?: 'N' | 'L' | 'H';       // Privileges Required
  ui?: 'N' | 'R';             // User Interaction
  s?: 'U' | 'C';              // Scope
  c?: 'N' | 'L' | 'H';        // Confidentiality
  i?: 'N' | 'L' | 'H';        // Integrity
  a?: 'N' | 'L' | 'H';        // Availability
}

export interface CvssCalculationResult {
  score: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  vector: string;
  impactScore: number;
  exploitabilityScore: number;
}

const AV_WEIGHT: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC_WEIGHT: Record<string, number> = { L: 0.77, H: 0.44 };
const PR_WEIGHT_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_WEIGHT_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.50 };
const UI_WEIGHT: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA_WEIGHT: Record<string, number> = { N: 0.0, L: 0.22, H: 0.56 };

export function parseCvssVector(vector: string): CvssMetrics {
  const parts = vector.split('/');
  const metrics: CvssMetrics = {};

  for (const part of parts) {
    const [key, value] = part.split(':');
    if (!key || !value) continue;
    const k = key.trim().toLowerCase();
    const v = value.trim().toUpperCase();

    if (k === 'av' && ['N', 'A', 'L', 'P'].includes(v)) metrics.av = v as any;
    if (k === 'ac' && ['L', 'H'].includes(v)) metrics.ac = v as any;
    if (k === 'pr' && ['N', 'L', 'H'].includes(v)) metrics.pr = v as any;
    if (k === 'ui' && ['N', 'R'].includes(v)) metrics.ui = v as any;
    if (k === 's' && ['U', 'C'].includes(v)) metrics.s = v as any;
    if (k === 'c' && ['N', 'L', 'H'].includes(v)) metrics.c = v as any;
    if (k === 'i' && ['N', 'L', 'H'].includes(v)) metrics.i = v as any;
    if (k === 'a' && ['N', 'L', 'H'].includes(v)) metrics.a = v as any;
  }

  return metrics;
}

export function scoreToSeverity(score: number): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0.0) return 'low';
  return 'info';
}

export function calculateCvss31(vectorOrMetrics: string | CvssMetrics): CvssCalculationResult {
  const metrics = typeof vectorOrMetrics === 'string' ? parseCvssVector(vectorOrMetrics) : vectorOrMetrics;
  const vector = typeof vectorOrMetrics === 'string'
    ? vectorOrMetrics
    : `CVSS:3.1/AV:${metrics.av ?? 'N'}/AC:${metrics.ac ?? 'L'}/PR:${metrics.pr ?? 'N'}/UI:${metrics.ui ?? 'N'}/S:${metrics.s ?? 'U'}/C:${metrics.c ?? 'H'}/I:${metrics.i ?? 'H'}/A:${metrics.a ?? 'H'}`;

  const av = AV_WEIGHT[metrics.av ?? 'N'] ?? 0.85;
  const ac = AC_WEIGHT[metrics.ac ?? 'L'] ?? 0.77;
  const s = metrics.s ?? 'U';
  const pr = s === 'C'
    ? (PR_WEIGHT_CHANGED[metrics.pr ?? 'N'] ?? 0.85)
    : (PR_WEIGHT_UNCHANGED[metrics.pr ?? 'N'] ?? 0.85);
  const ui = UI_WEIGHT[metrics.ui ?? 'N'] ?? 0.85;

  const exploitability = Math.round(8.22 * av * ac * pr * ui * 10) / 10;

  const c = CIA_WEIGHT[metrics.c ?? 'N'] ?? 0.0;
  const i = CIA_WEIGHT[metrics.i ?? 'N'] ?? 0.0;
  const a = CIA_WEIGHT[metrics.a ?? 'N'] ?? 0.0;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  let impact = 0;
  if (s === 'U') {
    impact = Math.round(6.42 * iss * 10) / 10;
  } else {
    impact = Math.round((7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)) * 10) / 10;
  }

  let baseScore = 0;
  if (impact <= 0) {
    baseScore = 0.0;
  } else if (s === 'U') {
    baseScore = Math.min(10.0, Math.ceil(Math.min(impact + exploitability, 10) * 10) / 10);
  } else {
    baseScore = Math.min(10.0, Math.ceil(Math.min(1.08 * (impact + exploitability), 10) * 10) / 10);
  }

  return {
    score: baseScore,
    severity: scoreToSeverity(baseScore),
    vector,
    impactScore: impact,
    exploitabilityScore: exploitability,
  };
}
