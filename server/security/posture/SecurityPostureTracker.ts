/**
 * SecurityPostureTracker — Historique de posture de sécurité (Phase 5, section 18)
 *
 * Enregistre un instantané (« snapshot ») après chaque audit et permet de
 * suivre l'évolution de la posture dans le temps :
 *   - score de posture 0..100 (plus haut = meilleur)
 *   - tendance (improving / stable / regressing) entre les deux derniers audits
 *   - deltas de findings (résolus / nouveaux)
 *
 * Stockage en mémoire, borné (ring buffer). Produit dérivé, non persistant.
 */

import type { ScanExecutionResult } from '../orchestrator/SecurityOrchestrator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeverityCounts {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface PostureSnapshot {
  timestamp: string;
  scanId?: string;
  counts: SeverityCounts;
  /** 0..100, plus haut = meilleur. */
  score: number;
}

export type PostureTrend = 'improving' | 'stable' | 'regressing';

export interface PostureTrendReport {
  trend: PostureTrend;
  scoreDelta: number;
  previous?: PostureSnapshot;
  latest?: PostureSnapshot;
  /** Variation du nombre total de findings (négatif = amélioration). */
  totalDelta: number;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Pénalités par sévérité. Un critical pèse lourd ; un info est négligeable.
 * Le score part de 100 et décroît avec les findings pondérés (borné à 0).
 */
const SEVERITY_PENALTY: Record<keyof Omit<SeverityCounts, 'total'>, number> = {
  critical: 25,
  high: 12,
  medium: 4,
  low: 1,
  info: 0,
};

/** Calcule un score de posture 0..100 (plus haut = meilleur) à partir des comptes. */
export function computePostureScore(counts: SeverityCounts): number {
  const penalty =
    counts.critical * SEVERITY_PENALTY.critical +
    counts.high * SEVERITY_PENALTY.high +
    counts.medium * SEVERITY_PENALTY.medium +
    counts.low * SEVERITY_PENALTY.low +
    counts.info * SEVERITY_PENALTY.info;
  return Math.max(0, Math.min(100, 100 - penalty));
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/** Variation de score en deçà de laquelle la tendance est jugée « stable ». */
const STABLE_BAND = 3;

export class SecurityPostureTracker {
  private readonly history: PostureSnapshot[] = [];

  constructor(private readonly maxSnapshots = 100) {
    if (maxSnapshots < 1) throw new Error('[SecurityPostureTracker] maxSnapshots >= 1 requis.');
  }

  /** Enregistre un instantané à partir d'un résultat d'audit. */
  recordFromScan(result: ScanExecutionResult): PostureSnapshot {
    const counts: SeverityCounts = { ...result.findingsCount };
    return this.record({
      timestamp: result.endTime ?? new Date().toISOString(),
      scanId: result.scanId,
      counts,
      score: computePostureScore(counts),
    });
  }

  /** Enregistre un instantané déjà formé (score recalculé pour cohérence). */
  record(snapshot: Omit<PostureSnapshot, 'score'> & { score?: number }): PostureSnapshot {
    const finalized: PostureSnapshot = {
      ...snapshot,
      score: snapshot.score ?? computePostureScore(snapshot.counts),
    };
    this.history.push(finalized);
    // Ring buffer : conserve les N plus récents.
    if (this.history.length > this.maxSnapshots) {
      this.history.splice(0, this.history.length - this.maxSnapshots);
    }
    return finalized;
  }

  list(): PostureSnapshot[] {
    return [...this.history];
  }

  latest(): PostureSnapshot | undefined {
    return this.history[this.history.length - 1];
  }

  size(): number {
    return this.history.length;
  }

  clear(): void {
    this.history.length = 0;
  }

  /**
   * Compare les deux derniers instantanés. Sans historique suffisant, renvoie
   * une tendance « stable » avec des deltas nuls.
   */
  trend(): PostureTrendReport {
    const n = this.history.length;
    const latest = this.history[n - 1];
    const previous = this.history[n - 2];

    if (!latest || !previous) {
      return { trend: 'stable', scoreDelta: 0, totalDelta: 0, latest, previous };
    }

    const scoreDelta = latest.score - previous.score;
    const totalDelta = latest.counts.total - previous.counts.total;

    let trend: PostureTrend = 'stable';
    if (scoreDelta > STABLE_BAND) trend = 'improving';
    else if (scoreDelta < -STABLE_BAND) trend = 'regressing';

    return { trend, scoreDelta, totalDelta, previous, latest };
  }
}
