/**
 * epssIntegrator — Intégrateur de score EPSS (Exploit Prediction Scoring System)
 * 
 * Le score EPSS (FIRST.org) estime la probabilité (0.0 à 1.0) qu'une vulnérabilité
 * fasse l'objet d'une exploitation active dans les 30 jours à venir.
 */

import { getEpssScore, getEpssScoresBatch, type EpssEntry } from '../../../security/integrations/EpssClient.js';

export interface EnrichedEpssData {
  epssScore: number;
  percentile: number;
  riskCategory: 'critical' | 'high' | 'medium' | 'low';
  requiresUrgentPatching: boolean;
}

export function categorizeEpss(score: number, percentile = 0): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 0.5 || percentile >= 0.95) return 'critical';
  if (score >= 0.2 || percentile >= 0.85) return 'high';
  if (score >= 0.05 || percentile >= 0.60) return 'medium';
  return 'low';
}

export async function enrichSingleCveWithEpss(cveId: string): Promise<EnrichedEpssData | null> {
  const entry = await getEpssScore(cveId);
  if (!entry) return null;

  return {
    epssScore: entry.epss,
    percentile: entry.percentile,
    riskCategory: categorizeEpss(entry.epss, entry.percentile),
    requiresUrgentPatching: entry.epss >= 0.2 || entry.percentile >= 0.90,
  };
}

export async function enrichMultipleCvesWithEpss(cveIds: string[]): Promise<Map<string, EnrichedEpssData>> {
  const result = new Map<string, EnrichedEpssData>();
  if (cveIds.length === 0) return result;

  try {
    const batch = await getEpssScoresBatch(cveIds);
    for (const [cve, entry] of batch) {
      result.set(cve, {
        epssScore: entry.epss,
        percentile: entry.percentile,
        riskCategory: categorizeEpss(entry.epss, entry.percentile),
        requiresUrgentPatching: entry.epss >= 0.2 || entry.percentile >= 0.90,
      });
    }
  } catch (err) {
    console.warn('[epssIntegrator] Batch EPSS failed:', err);
  }

  return result;
}
