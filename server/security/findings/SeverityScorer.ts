import type { FindingSeverity } from "./Finding.js";

/**
 * Calculateur de sévérité composite (CVSS 3.1, EPSS exploitability probability, CISA KEV).
 */
export function calculateSeverityTier(score: number): FindingSeverity {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0.0) return 'low';
  return 'info';
}

export interface RiskPriority {
  riskScore: number; // 0 to 100
  urgency: 'immediate' | 'high' | 'moderate' | 'low';
  summary: string;
}

export function computeRiskPriority(params: {
  cvssScore: number;
  epssScore?: number;
  cisaKev?: boolean;
  isInternetFacing?: boolean;
}): RiskPriority {
  const cvssNorm = Math.min(Math.max(params.cvssScore, 0), 10) / 10; // 0..1
  const epssNorm = Math.min(Math.max(params.epssScore ?? 0.05, 0), 1); // 0..1
  const kevBonus = params.cisaKev ? 0.3 : 0.0;
  const exposedBonus = params.isInternetFacing ? 0.1 : 0.0;

  // Formule de priorité du risque pondérée
  const rawRisk = (cvssNorm * 0.45) + (epssNorm * 0.35) + kevBonus + exposedBonus;
  const riskScore = Math.min(Math.round(rawRisk * 100), 100);

  let urgency: RiskPriority['urgency'] = 'low';
  let summary = 'Risque maîtrisé, correction lors d\'un cycle standard.';

  if (params.cisaKev || riskScore >= 80) {
    urgency = 'immediate';
    summary = 'Vulnérabilité critique ou exploitée activement dans la nature (CISA KEV / EPSS élevé). Patch immédiat requis.';
  } else if (riskScore >= 60) {
    urgency = 'high';
    summary = 'Risque élevé d\'exploitation avec impact important. Correction sous 7 jours recommandée.';
  } else if (riskScore >= 35) {
    urgency = 'moderate';
    summary = 'Vulnérabilité modérée. À corriger lors du prochain sprint ou livraison.';
  }

  return { riskScore, urgency, summary };
}
