/**
 * priorityEngine — Moteur de priorisation multi-facteurs
 * 
 * Calcule un score unifié de priorité d'action selon la formule :
 * Priorité = (CVSS / 10) × 0.40 + (EPSS) × 0.35 + (KEV ? 1.0 : 0.0) × 0.25
 * Modulé par la portée (atteignable / local / interne).
 */

export interface PriorityScoreInput {
  cvssScore: number;
  epssScore?: number;
  cisaKev?: boolean;
  isInternetFacing?: boolean;
  hasWorkingPoC?: boolean;
}

export interface PriorityScoreOutput {
  priorityScore: number; // 0.0 – 100.0
  urgency: 'p0_immediate' | 'p1_high' | 'p2_medium' | 'p3_low';
  slaHours: number;
  rationale: string;
}

export function computePriorityScore(input: PriorityScoreInput): PriorityScoreOutput {
  const cvssPart = (Math.min(Math.max(input.cvssScore, 0), 10) / 10) * 40;
  const epssPart = Math.min(Math.max(input.epssScore ?? 0.01, 0), 1) * 35;
  const kevPart = input.cisaKev ? 25 : 0;

  let base = cvssPart + epssPart + kevPart;

  // Modulateurs
  if (input.isInternetFacing) base *= 1.15;
  if (input.hasWorkingPoC) base *= 1.10;

  const priorityScore = Math.min(100, Math.round(base * 10) / 10);

  let urgency: PriorityScoreOutput['urgency'] = 'p3_low';
  let slaHours = 720; // 30 jours
  let rationale = 'Vulnérabilité à faible probabilité d’exploitation.';

  if (input.cisaKev || priorityScore >= 80) {
    urgency = 'p0_immediate';
    slaHours = 24;
    rationale = input.cisaKev
      ? 'VULNÉRABILITÉ EXPLOITÉE EN NATURE (CISA KEV) : Remédiation requise sous 24h.'
      : 'Score de priorité critique (CVSS + EPSS élevés) : Remédiation requise sous 24h.';
  } else if (priorityScore >= 60 || (input.epssScore ?? 0) >= 0.20) {
    urgency = 'p1_high';
    slaHours = 72;
    rationale = 'Probabilité d’exploitation élevée ou impact critique : Patch sous 72h.';
  } else if (priorityScore >= 35) {
    urgency = 'p2_medium';
    slaHours = 336; // 14 jours
    rationale = 'Vulnérabilité standard sans preuve d’exploitation immédiate.';
  }

  return { priorityScore, urgency, slaHours, rationale };
}
