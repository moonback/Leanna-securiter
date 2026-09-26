import { randomUUID } from "crypto";
import { projectMemory } from "../knowledge/ProjectMemory.js";
import { createLogger } from "../utils/logger.js";
import type { Confidence, ReflectionResult, MissionState, Goal } from "./types.js";

const log = createLogger("ReflectionEngine");

// ═══════════════════════════════════════════════════════════════════════════════
// Types étendus — Sprint 6
// ═══════════════════════════════════════════════════════════════════════════════

/** Mode de réflexion — Sprint 6 */
export type ReflectionMode =
  | "standard"      // Mode par défaut : 1 passe heuristique ou LLM
  | "deep"          // Multi-passes, historique long, auto-critique
  | "comparative"   // Compare à des actions similaires dans l'historique
  | "preventive";   // Anticipe les risques avant échec

/** Résultat de détection de boucle — Sprint 6 (enrichi) */
export interface LoopDetectionResult {
  isLoop: boolean;
  pattern?: string;
  /** Type de boucle détectée */
  loopType?: "same_failure" | "oscillation" | "no_progress" | "repeated_action";
  /** Nombre d'occurrences */
  count?: number;
  /** Actions impliquées (IDs) */
  involvedActions?: string[];
  /** Sévérité (0-100) */
  severity?: number;
}

/** Analyse de tendance — Sprint 6 (enrichi) */
export interface ConfidenceAnalysis {
  trend: "rising" | "stable" | "declining" | "volatile" | "stagnant";
  window: number;
  /** Évolution moyenne par unité (par action) */
  slope: number;
  /** Volatilité (écart-type normalisé) */
  volatility: number;
  /** Niveau moyen sur la fenêtre */
  average: number;
  /** Prévision du prochain point si tendance se poursuit */
  projectedNext: number;
  /** Recommandation textuelle */
  recommendation: string;
}

/** Leçon apprise par réflexion — Sprint 6 */
export interface ReflectionLesson {
  id: string;
  type: "success_pattern" | "error_pattern" | "optimization" | "decision" | "risk";
  description: string;
  recommendation: string;
  /** Fichier/skill concerné */
  scope?: string;
  /** Nombre d'occurrences observées */
  occurrenceCount: number;
  /** Score d'importance (0-1) */
  importance: number;
  /** Timestamp de découverte */
  discoveredAt: string;
  /** IDs des actions source */
  sourceActionIds: string[];
}

/** Résumé de réflexion — Sprint 6, pour rapports de mission */
export interface ReflectionSummary {
  /** Nombre total d'actions réfléchies */
  totalReflections: number;
  /** Nombre de succès / échecs */
  successfulActions: number;
  failedActions: number;
  retriedActions: number;
  replannedActions: number;
  escalatedActions: number;
  abortedActions: number;
  /** Distribution des décisions */
  decisionBreakdown: Record<ReflectionResult["decision"], number>;
  /** Statistiques de confiance */
  confidence: {
    min: number;
    max: number;
    avg: number;
    final: number;
    analysis: ConfidenceAnalysis;
  };
  /** Boucles détectées */
  loopsDetected: LoopDetectionResult[];
  /** Leçons extraites */
  lessons: ReflectionLesson[];
  /** Risques actuels */
  currentRisks: string[];
  /** Format Markdown pour rapport */
  markdownReport: string;
}

/** Input étendu pour la réflexion — Sprint 6 */
export interface ReflectionInput {
  actionId: string;
  actionName: string;
  skillName: string;
  goalTitle: string;
  goalId?: string;
  missionId?: string;
  success: boolean;
  result?: unknown;
  error?: string;
  attemptCount: number;
  maxAttempts: number;
  previousConfidence?: Confidence;
  previousErrors?: string[];
  /** Mode de réflexion — Sprint 6 */
  mode?: ReflectionMode;
  /** Objectif courant (état Goal) — pour analyse préventive */
  currentGoal?: Partial<Goal>;
  /** Fichiers modifiés par cette action */
  affectedFiles?: string[];
}

/** Fonction de réflexion via LLM (injectée) */
export type ReflectFunction = (prompt: string) => Promise<string>;

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration de détection de boucles */
const LOOP_CONFIG = {
  defaultWindow: 6,
  minFailuresForLoop: 3,
  oscillationWindow: 4,
  noProgressWindow: 6,
  repeatedActionWindow: 5,
  severityThresholds: {
    low: 30,
    medium: 60,
    high: 85,
  },
} as const;

/** Configuration d'analyse de confiance */
const CONFIDENCE_CONFIG = {
  volatileStdDev: 0.2,
  stagnantRange: 0.05,
  stagnantMinWindow: 4,
} as const;

/** Configuration de sauvegarde mémoire */
const MEMORY_CONFIG = {
  minImportanceToSave: 0.5,
  maxLessonsPerReflection: 2,
  /** Catégorie cible dans ProjectMemory */
  category: "decision" as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Reflection Engine — Auto-évaluation après chaque action (SPRINT 6 ENRICHIE)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Le Reflection Engine analyse le résultat de chaque action exécutée
 * et décide si l'agent doit continuer, corriger, ou abandonner.
 *
 * Nouveautés Sprint 6 :
 * - Modes standard / deep / comparative / preventive
 * - Détection de boucles multi-types avec sévérité
 * - Analyse complète de tendance de confiance (volatilité, stagnation, projection)
 * - Extraction + sauvegarde automatique des leçons vers ProjectMemory
 * - Génération de résumé Markdown pour rapports de mission
 *
 * Boucle de réflexion:
 *   Action exécutée
 *     ↓
 *   Que s'est-il passé ? (observation)
 *     ↓
 *   Est-ce correct ? (évaluation)
 *     ↓
 *   Quelle hypothèse ? (raisonnement)
 *     ↓
 *   Que faire ensuite ? (décision)
 *     ↓
 *  [deep]  Auto-critique itérative
 *  [comparative]  Comparaison historique
 *  [preventive]   Pré-risque
 *     ↓
 *   Leçons extraites → ProjectMemory (auto)
 */
export class ReflectionEngine {
  private reflectFn: ReflectFunction | null = null;
  private reflectionHistory: ReflectionResult[] = [];
  private lessons: Map<string, ReflectionLesson> = new Map();
  private loopCache: Map<string, LoopDetectionResult> = new Map();
  private static readonly MAX_HISTORY = 100;
  private static readonly MAX_LESSONS = 200;
  private missionId?: string;

  /**
   * Injecte la fonction de réflexion LLM.
   * Si non injectée, le moteur utilise des heuristiques.
   */
  setReflectFunction(fn: ReflectFunction): void {
    this.reflectFn = fn;
  }

  /**
   * Associe le moteur à une mission (pour les rapports et la mémoire).
   */
  attachToMission(missionId: string): void {
    this.missionId = missionId;
  }

  /**
   * Réfléchit sur le résultat d'une action.
   * Accepte maintenant un mode de réflexion (Sprint 6).
   */
  async reflect(params: ReflectionInput): Promise<ReflectionResult> {
    const mode: ReflectionMode = params.mode || "standard";

    let result: ReflectionResult;

    // ── Mode PREVENTIVE : analyser avant tout l'issue potentielle ──
    if (mode === "preventive") {
      result = await this.reflectPreventive(params);
    }
    // ── Mode DEEP : multi-passes avec LLM + heuristique ──
    else if (mode === "deep") {
      result = await this.reflectDeep(params);
    }
    // ── Mode COMPARATIVE : recherche de précédents similaires ──
    else if (mode === "comparative") {
      result = await this.reflectComparative(params);
    }
    // ── Mode STANDARD (comportement historique) ──
    else {
      if (this.reflectFn) {
        result = await this.reflectWithLLM(params);
      } else {
        result = this.reflectHeuristic(params);
      }
    }

    // ── Post-traitement commun (Sprint 6) ──
    this.addToHistory(result);

    // 1. Extraire les leçons
    const extracted = this.extractLessons(result, params);
    // 2. Sauvegarder les leçons les plus importantes en mémoire projet
    const saved = this.persistLessonsToMemory(extracted, params);
    if (saved.length > 0) {
      log.info(`💡 ${saved.length} leçon(s) sauvegardée(s) en ProjectMemory`);
    }

    return result;
  }

  /**
   * Retourne les N dernières réflexions.
   */
  getRecentReflections(count: number = 10): ReflectionResult[] {
    return this.reflectionHistory.slice(-count);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPRINT 6 — Analyse de tendance de confiance ENRICHIE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Analyse complète de la tendance de confiance.
   * Retourne volatilité, stagnation, pente, et recommandation.
   */
  analyzeConfidence(window: number = 8): ConfidenceAnalysis {
    const recent = this.reflectionHistory.slice(-window);
    if (recent.length < 2) {
      return {
        trend: "stable",
        window: recent.length,
        slope: 0,
        volatility: 0,
        average: recent[0]?.confidence ?? 0.5,
        projectedNext: recent[0]?.confidence ?? 0.5,
        recommendation: "Pas assez de données pour une analyse fiable.",
      };
    }

    const values = recent.map((r) => r.confidence);
    const n = values.length;

    // Moyenne
    const avg = values.reduce((s, v) => s + v, 0) / n;

    // Pente (régression linéaire simple)
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = values[i];
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const denom = n * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

    // Écart-type (volatilité)
    const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    // Détection de stagnation : variation très faible sur toute la fenêtre
    const range = Math.max(...values) - Math.min(...values);
    const isStagnant =
      n >= CONFIDENCE_CONFIG.stagnantMinWindow &&
      range <= CONFIDENCE_CONFIG.stagnantRange &&
      Math.abs(slope) < 0.01;

    // Détection de volatilité
    const isVolatile = stdDev >= CONFIDENCE_CONFIG.volatileStdDev;

    // Déterminer la tendance
    let trend: ConfidenceAnalysis["trend"] = "stable";
    if (isStagnant) trend = "stagnant";
    else if (isVolatile) trend = "volatile";
    else if (slope > 0.05) trend = "rising";
    else if (slope < -0.05) trend = "declining";

    const projectedNext = Math.max(0, Math.min(1, avg + slope * n));

    let recommendation = "Confiance stable — continuer.";
    if (trend === "rising") recommendation = "Progression positive — renforcer l'approche.";
    else if (trend === "declining") recommendation = "⚠️ Confiance en baisse — réévaluer la stratégie.";
    else if (trend === "volatile") recommendation = "⚠️ Confiance très variable — stabiliser les hypothèses.";
    else if (trend === "stagnant") recommendation = "Aucune progression — risque d'impasse, envisager replanification.";

    return {
      trend,
      window: n,
      slope: Math.round(slope * 1000) / 1000,
      volatility: Math.round(stdDev * 100) / 100,
      average: Math.round(avg * 100) / 100,
      projectedNext: Math.round(projectedNext * 100) / 100,
      recommendation,
    };
  }

  /**
   * Raccourci historique — retourne uniquement la tendance.
   */
  getConfidenceTrend(window: number = 5): "rising" | "stable" | "declining" {
    const analysis = this.analyzeConfidence(window);
    if (analysis.trend === "volatile" || analysis.trend === "stagnant") return "stable";
    return analysis.trend;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPRINT 6 — Détection de boucle AMÉLIORÉE (multi-types + sévérité)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Détecte les boucles de plusieurs types avec sévérité.
   */
  detectLoop(window: number = LOOP_CONFIG.defaultWindow): LoopDetectionResult {
    const cacheKey = `${this.reflectionHistory.length}-${window}`;
    const cached = this.loopCache.get(cacheKey);
    if (cached) return cached;

    const recent = this.reflectionHistory.slice(-window);
    if (recent.length < 3) {
      const empty = { isLoop: false, severity: 0 };
      this.loopCache.set(cacheKey, empty);
      return empty;
    }

    // 1) Échec répété du même type
    const sameFailure = this.checkSameFailureLoop(recent);
    if (sameFailure.isLoop) {
      sameFailure.severity = Math.min(100, 50 + (sameFailure.count ?? 0) * 10);
      this.loopCache.set(cacheKey, sameFailure);
      return sameFailure;
    }

    // 2) Oscillation continue/retry/continue/retry
    const oscillation = this.checkOscillationLoop(recent);
    if (oscillation.isLoop) {
      oscillation.severity = Math.min(100, 40 + (oscillation.count ?? 0) * 8);
      this.loopCache.set(cacheKey, oscillation);
      return oscillation;
    }

    // 3) Aucune progression (confidence qui ne monte pas)
    const noProgress = this.checkNoProgressLoop(recent);
    if (noProgress.isLoop) {
      noProgress.severity = Math.min(100, 30 + (noProgress.count ?? 0) * 5);
      this.loopCache.set(cacheKey, noProgress);
      return noProgress;
    }

    // 4) Même action (skill+nom) réexécutée avec échec
    const repeated = this.checkRepeatedAction(recent);
    if (repeated.isLoop) {
      repeated.severity = Math.min(100, 35 + (repeated.count ?? 0) * 7);
      this.loopCache.set(cacheKey, repeated);
      return repeated;
    }

    const result: LoopDetectionResult = { isLoop: false, severity: 0 };
    this.loopCache.set(cacheKey, result);
    return result;
  }

  private checkSameFailureLoop(recent: ReflectionResult[]): LoopDetectionResult {
    const failures = recent.filter((r) => r.failure);
    if (failures.length < LOOP_CONFIG.minFailuresForLoop) return { isLoop: false };

    const normalized = failures.map((f) => this.normalizeError(f.failure!));
    const counts = new Map<string, number>();
    normalized.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));

    for (const [pattern, count] of counts) {
      if (count >= 3) {
        return {
          isLoop: true,
          loopType: "same_failure",
          pattern: `Échec identique répété (${count}x) : ${pattern}`,
          count,
          involvedActions: failures.map((f) => f.actionId),
        };
      }
    }
    return { isLoop: false };
  }

  private checkOscillationLoop(recent: ReflectionResult[]): LoopDetectionResult {
    if (recent.length < LOOP_CONFIG.oscillationWindow) return { isLoop: false };

    // Compte les alternances continue ↔ retry/replan
    let alternances = 0;
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1].decision;
      const curr = recent[i].decision;
      if (
        (prev === "continue" && (curr === "retry" || curr === "replan")) ||
        ((prev === "retry" || prev === "replan") && curr === "continue")
      ) {
        alternances++;
      }
    }

    if (alternances >= 3) {
      return {
        isLoop: true,
        loopType: "oscillation",
        pattern: `Oscillation (${alternances} alternances) entre avancement et correction — stratégie chaotique`,
        count: alternances,
        involvedActions: recent.map((r) => r.actionId),
      };
    }
    return { isLoop: false };
  }

  private checkNoProgressLoop(recent: ReflectionResult[]): LoopDetectionResult {
    if (recent.length < LOOP_CONFIG.noProgressWindow) return { isLoop: false };

    const confs = recent.map((r) => r.confidence);
    const first = confs.slice(0, Math.ceil(confs.length / 2));
    const last = confs.slice(Math.floor(confs.length / 2));
    const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
    const avgLast = last.reduce((s, v) => s + v, 0) / last.length;

    // Confiance qui stagne voire baisse, peu de succès
    const successes = recent.filter((r) => r.decision === "continue" && r.success).length;
    if (avgLast <= avgFirst + 0.05 && successes <= 1) {
      return {
        isLoop: true,
        loopType: "no_progress",
        pattern: `Impasse sur ${recent.length} actions : confiance stagne (${(avgLast * 100).toFixed(0)}%), ${successes} succès confirmés`,
        count: recent.length,
        involvedActions: recent.map((r) => r.actionId),
      };
    }
    return { isLoop: false };
  }

  private checkRepeatedAction(recent: ReflectionResult[]): LoopDetectionResult {
    if (recent.length < LOOP_CONFIG.repeatedActionWindow) return { isLoop: false };

    // _actionKeys: observation keys used for grouping (below)
    const counts = new Map<string, number>();
    const byKey = new Map<string, ReflectionResult[]>();
    for (const r of recent) {
      const key = `${r.decision}:${r.failure ? this.normalizeError(r.failure) : "ok"}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      const list = byKey.get(key) || [];
      list.push(r);
      byKey.set(key, list);
    }

    for (const [key, count] of counts) {
      if (count >= 3) {
        const actions = byKey.get(key)!;
        return {
          isLoop: true,
          loopType: "repeated_action",
          pattern: `Même pattern répété (${count}x) : ${key}`,
          count,
          involvedActions: actions.map((a) => a.actionId),
        };
      }
    }
    return { isLoop: false };
  }

  private normalizeError(err: string): string {
    return err
      .toLowerCase()
      .replace(/['"`]/g, "")
      .replace(/[0-9a-f]{8,}/gi, "<HASH>") // retirer UUIDs
      .replace(/\b\d+\b/g, "<NUM>") // retirer nombres
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPRINT 6 — Modes de réflexion : deep / comparative / preventive
  // ══════════════════════════════════════════════════════════════════════════

  private async reflectDeep(params: ReflectionInput): Promise<ReflectionResult> {
    // Pass 1 : première passe (LLM si dispo sinon heuristic)
    const first = this.reflectFn
      ? await this.reflectWithLLM(params)
      : this.reflectHeuristic(params);

    // Pass 2 : auto-critique du résultat
    const critique = this.critiqueReflection(first, params);

    if (critique.shouldRevise) {
      return this.reviseReflection(first, critique.notes, params);
    }
    return first;
  }

  private async reflectComparative(params: ReflectionInput): Promise<ReflectionResult> {
    const base = this.reflectFn
      ? await this.reflectWithLLM(params)
      : this.reflectHeuristic(params);

    // Rechercher des actions passées similaires
    const precedents = this.findSimilarPrecedents(params, 5);
    if (precedents.length >= 2) {
      const avgSuccessConf = this.computePrecedentSuccessConfidence(precedents);
      base.observation += ` — Comparaison historique : ${precedents.length} précédent(s) similaire(s), confiance moyenne des succès ${(avgSuccessConf * 100).toFixed(0)}%`;

      if (precedents.some((p) => p.loopType)) {
        base.confidence = Math.max(0, base.confidence - 0.15);
        if (base.decision === "retry") base.decision = "replan";
        base.reasoning += " (ajustement : précédents contenaient une boucle connue, passage en replanification)";
      }
    }

    return base;
  }

  private async reflectPreventive(params: ReflectionInput): Promise<ReflectionResult> {
    // Mode préventif : même en cas de SUCCÈS, on vérifie les risques
    // d'effet de bord, de régression, de boucle prochaine.
    const base = this.reflectFn
      ? await this.reflectWithLLM(params)
      : this.reflectHeuristic(params);

    const risks: string[] = [];

    // 1) Risque de boucle proche
    const loop = this.detectLoop(LOOP_CONFIG.defaultWindow + 1);
    if (loop.isLoop) {
      risks.push(`Risque immédiat : boucle en cours — ${loop.pattern}`);
    }

    // 2) Risque : confiance en déclin malgré succès apparent
    const analysis = this.analyzeConfidence(6);
    if (analysis.trend === "declining" || analysis.trend === "volatile") {
      risks.push(`Risque de tendance : ${analysis.trend} — ${analysis.recommendation}`);
    }

    // 3) Risque : objectif courant bloqué ou en difficulté
    if (params.currentGoal) {
      const attempts = params.currentGoal.attempts || 0;
      const maxAtt = params.currentGoal.maxAttempts || 3;
      if (attempts >= maxAtt - 1) {
        risks.push(`Risque : objectif "${params.currentGoal.title}" à ${attempts}/${maxAtt} tentatives — dernière chance`);
      }
    }

    // 4) Risque : fichiers critiques modifiés sans test
    if (params.affectedFiles && params.affectedFiles.length > 0) {
      const critical = params.affectedFiles.filter((f) => this.looksCritical(f));
      if (critical.length > 0 && params.success) {
        risks.push(`Vérification préventive : ${critical.length} fichier(s) sensible(s) modifié(s) — valider avant de continuer`);
      }
    }

    if (risks.length > 0) {
      base.hypothesis = (base.hypothesis ? base.hypothesis + " — " : "") + `⚠️ Risques détectés: ${risks.join(" ; ")}`;
      // Escalader si risque sévère
      const severe = risks.some((r) => /boucle|dernière chance|sensible/i.test(r));
      if (severe && base.decision === "continue") {
        base.confidence = Math.max(0, base.confidence - 0.1);
        base.decision = "replan";
        base.reasoning = "Interrompu par mode préventif : risques détectés — replanification recommandée.";
      }
    }

    return base;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPRINT 6 — Leçons apprises + intégration ProjectMemory
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Retourne les leçons extraites par le moteur.
   */
  getLessons(max: number = 20): ReflectionLesson[] {
    return Array.from(this.lessons.values())
      .sort((a, b) => b.importance - a.importance || b.occurrenceCount - a.occurrenceCount)
      .slice(0, max);
  }

  /**
   * Extrait les leçons d'une nouvelle réflexion.
   */
  private extractLessons(result: ReflectionResult, input: ReflectionInput): ReflectionLesson[] {
    const lessons: ReflectionLesson[] = [];
    const now = new Date().toISOString();

    // 1) Pattern d'échec répété
    if (result.failure) {
      const norm = this.normalizeError(result.failure);
      const existing = Array.from(this.lessons.values()).find(
        (l) => l.type === "error_pattern" && this.normalizeError(l.description).includes(norm.slice(0, 30))
      );
      if (existing) {
        existing.occurrenceCount++;
        existing.sourceActionIds.push(result.actionId);
        existing.discoveredAt = now;
        lessons.push(existing);
      } else {
        const loop = this.detectLoop();
        if (loop.isLoop || input.attemptCount >= 2) {
          lessons.push({
            id: randomUUID(),
            type: "error_pattern",
            description: `Échec sur skill="${input.skillName}" : ${result.failure}`,
            recommendation: `Éviter de réessayer à l'identique. Tester d'abord l'hypothèse: "${result.hypothesis || "changer approche"}"`,
            scope: input.skillName,
            occurrenceCount: 1,
            importance: 0.5 + Math.min(0.3, input.attemptCount * 0.1),
            discoveredAt: now,
            sourceActionIds: [result.actionId],
          });
        }
      }
    }

    // 2) Pattern de succès
    if (result.success && result.decision === "continue" && input.attemptCount === 1) {
      lessons.push({
        id: randomUUID(),
        type: "success_pattern",
        description: `Succès direct avec skill="${input.skillName}" pour "${input.goalTitle}"`,
        recommendation: `Réutiliser ce pattern pour des objectifs similaires : ${input.actionName} via ${input.skillName}`,
        scope: input.skillName,
        occurrenceCount: 1,
        importance: 0.4,
        discoveredAt: now,
        sourceActionIds: [result.actionId],
      });
    }

    // 3) Décision d'escalade / replanification
    if (result.decision === "replan" || result.decision === "escalate") {
      lessons.push({
        id: randomUUID(),
        type: "decision",
        description: `Décision "${result.decision}" prise pour goal="${input.goalTitle}" après ${input.attemptCount} tentative(s)`,
        recommendation: result.hypothesis || "Revoir la stratégie dès le prochain objectif.",
        scope: input.goalTitle,
        occurrenceCount: 1,
        importance: 0.6,
        discoveredAt: now,
        sourceActionIds: [result.actionId],
      });
    }

    // 4) Risque détecté
    const loop = this.detectLoop();
    if (loop.isLoop) {
      lessons.push({
        id: randomUUID(),
        type: "risk",
        description: `Risque de boucle détecté (${loop.loopType}): ${loop.pattern}`,
        recommendation: `Interrompre ce pattern: diversifier l'approche, proposer plusieurs alternatives au lieu de réitérer.`,
        scope: input.skillName,
        occurrenceCount: loop.count ?? 1,
        importance: Math.min(0.95, 0.5 + (loop.severity ?? 0) / 150),
        discoveredAt: now,
        sourceActionIds: loop.involvedActions ?? [result.actionId],
      });
    }

    // Limiter
    return lessons.slice(0, MEMORY_CONFIG.maxLessonsPerReflection);
  }

  /**
   * Sauvegarde les leçons les plus importantes dans ProjectMemory.
   */
  private persistLessonsToMemory(
    lessons: ReflectionLesson[],
    params: ReflectionInput
  ): ReflectionLesson[] {
    const saved: ReflectionLesson[] = [];
    for (const lesson of lessons) {
      // Enregistrer dans le cache local des leçons
      this.lessons.set(lesson.id, lesson);
      if (this.lessons.size > ReflectionEngine.MAX_LESSONS) {
        const sorted = Array.from(this.lessons.values()).sort((a, b) => a.importance - b.importance);
        const toRemove = sorted[0];
        if (toRemove) this.lessons.delete(toRemove.id);
      }

      // Sauvegarde en mémoire projet (si importance suffisante)
      if (lesson.importance >= MEMORY_CONFIG.minImportanceToSave) {
        try {
          const tags = [lesson.type, "reflection", "lesson"];
          if (lesson.scope) tags.push(lesson.scope);
          if (params.skillName) tags.push(params.skillName);
          if (this.missionId) tags.push(`mission:${this.missionId}`);

          const sourceFile = params.affectedFiles && params.affectedFiles[0]
            ? params.affectedFiles[0]
            : undefined;

          projectMemory.addFact({
            content: `${lesson.description} → Recommandation: ${lesson.recommendation}`,
            category: MEMORY_CONFIG.category,
            tags,
            sourceFile,
            confidence: lesson.importance,
          });
          saved.push(lesson);
        } catch (err) {
          log.warn(`⚠️ Échec sauvegarde leçon en ProjectMemory: ${(err as Error).message}`);
        }
      }
    }
    // Persister la mémoire après ajout
    try { projectMemory.save(); } catch { /* ignore */ }
    return saved;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPRINT 6 — Génération de résumé de réflexion pour rapports de mission
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Génère un résumé complet (incluant un rapport Markdown) de l'historique
   * de réflexions, adapté aux rapports de mission.
   */
  generateSummary(mission?: MissionState): ReflectionSummary {
    const history = this.reflectionHistory;
    const totalReflections = history.length;

    // Distribution des résultats
    const successfulActions = history.filter((r) => r.success).length;
    const failedActions = history.filter((r) => r.failure).length;
    const retriedActions = history.filter((r) => r.decision === "retry").length;
    const replannedActions = history.filter((r) => r.decision === "replan").length;
    const escalatedActions = history.filter((r) => r.decision === "escalate").length;
    const abortedActions = history.filter((r) => r.decision === "abort").length;

    const decisionBreakdown: ReflectionSummary["decisionBreakdown"] = {
      continue: 0, retry: 0, replan: 0, escalate: 0, abort: 0,
    };
    for (const r of history) decisionBreakdown[r.decision]++;

    // Confiance stats
    const confs = history.map((r) => r.confidence);
    const confMin = confs.length ? Math.min(...confs) : 0;
    const confMax = confs.length ? Math.max(...confs) : 0;
    const confAvg = confs.length ? confs.reduce((s, v) => s + v, 0) / confs.length : 0;
    const confFinal = confs.length ? confs[confs.length - 1] : 0;
    const analysis = this.analyzeConfidence();

    // Boucles
    const loops: LoopDetectionResult[] = [];
    for (let w = 4; w <= Math.min(history.length, 12); w += 2) {
      const loop = this.detectLoop(w);
      if (loop.isLoop) loops.push(loop);
    }
    // Dédupliquer les boucles par pattern
    const seen = new Set<string>();
    const loopsDedup = loops.filter((l) => {
      const k = l.pattern || l.loopType || "";
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // Leçons
    const lessons = this.getLessons(10);

    // Risques actuels
    const risks: string[] = [];
    if (loopsDedup.length > 0) risks.push(`${loopsDedup.length} boucle(s) détectée(s) pendant la mission`);
    if (analysis.trend === "declining") risks.push(`Tendance de confiance en baisse`);
    if (analysis.trend === "volatile") risks.push(`Confiance volatile`);
    if (analysis.trend === "stagnant") risks.push(`Progression bloquée (stagnation)`);
    if (escalatedActions > 0) risks.push(`${escalatedActions} escalade(s) vers l'utilisateur`);
    if (failedActions > successfulActions && totalReflections > 2) {
      risks.push(`Plus d'échecs (${failedActions}) que de succès (${successfulActions})`);
    }

    return {
      totalReflections,
      successfulActions,
      failedActions,
      retriedActions,
      replannedActions,
      escalatedActions,
      abortedActions,
      decisionBreakdown,
      confidence: {
        min: Math.round(confMin * 100) / 100,
        max: Math.round(confMax * 100) / 100,
        avg: Math.round(confAvg * 100) / 100,
        final: Math.round(confFinal * 100) / 100,
        analysis,
      },
      loopsDetected: loopsDedup,
      lessons,
      currentRisks: risks,
      markdownReport: this.buildMarkdownReport(mission, {
        totalReflections, successfulActions, failedActions,
        retriedActions, replannedActions, escalatedActions, abortedActions,
        decisionBreakdown,
        confMin, confMax, confAvg, confFinal, analysis,
        loopsDedup, lessons, risks,
      }),
    };
  }

  private buildMarkdownReport(mission: MissionState | undefined, stats: {
    totalReflections: number; successfulActions: number; failedActions: number;
    retriedActions: number; replannedActions: number; escalatedActions: number;
    abortedActions: number;
    decisionBreakdown: Record<string, number>;
    confMin: number; confMax: number; confAvg: number; confFinal: number;
    analysis: ConfidenceAnalysis;
    loopsDedup: LoopDetectionResult[];
    lessons: ReflectionLesson[];
    risks: string[];
  }): string {
    const {
      totalReflections, successfulActions, failedActions,
      retriedActions, replannedActions, escalatedActions, abortedActions,
      decisionBreakdown, confMin, confMax, confAvg, confFinal, analysis,
      loopsDedup, lessons, risks,
    } = stats;

    const successRate = totalReflections > 0
      ? Math.round((successfulActions / totalReflections) * 100)
      : 0;

    const lines: string[] = [];
    lines.push(`# Rapport de Réflexion — ${mission?.title || "Mission"}`);
    lines.push("");
    lines.push(`> Généré par ReflectionEngine (Sprint 6) le ${new Date().toLocaleString()}`);
    lines.push("");

    // 1. Aperçu global
    lines.push(`## 1. Aperçu global`);
    lines.push("");
    lines.push(`| Métrique | Valeur |`);
    lines.push(`|---|---|`);
    lines.push(`| Actions réfléchies | **${totalReflections}** |`);
    lines.push(`| Succès | ${successfulActions} |`);
    lines.push(`| Échecs | ${failedActions} |`);
    lines.push(`| Taux de succès | **${successRate}%** |`);
    lines.push(`| Retries (corrections rapides) | ${retriedActions} |`);
    lines.push(`| Replanifications | ${replannedActions} |`);
    lines.push(`| Escalades | ${escalatedActions} |`);
    lines.push(`| Abandons | ${abortedActions} |`);
    lines.push("");

    // 2. Décisions
    lines.push(`## 2. Distribution des décisions`);
    lines.push("");
    lines.push(`- ▶️ **continue** : ${decisionBreakdown.continue || 0}`);
    lines.push(`- 🔁 **retry** : ${decisionBreakdown.retry || 0}`);
    lines.push(`- 🔄 **replan** : ${decisionBreakdown.replan || 0}`);
    lines.push(`- 🆘 **escalate** : ${decisionBreakdown.escalate || 0}`);
    lines.push(`- ⏹️ **abort** : ${decisionBreakdown.abort || 0}`);
    lines.push("");

    // 3. Confiance
    lines.push(`## 3. Analyse de confiance`);
    lines.push("");
    lines.push(`- Min / Moy / Max / Finale : **${(confMin * 100).toFixed(0)}% / ${(confAvg * 100).toFixed(0)}% / ${(confMax * 100).toFixed(0)}% / ${(confFinal * 100).toFixed(0)}%**`);
    lines.push(`- Tendance : \`${analysis.trend}\` (pente ${analysis.slope}, volatilité ${analysis.volatility})`);
    lines.push(`- Recommandation : ${analysis.recommendation}`);
    lines.push("");

    // 4. Boucles
    lines.push(`## 4. Boucles détectées`);
    lines.push("");
    if (loopsDedup.length === 0) {
      lines.push(`✅ Aucune boucle significative détectée.`);
    } else {
      for (const loop of loopsDedup) {
        lines.push(`- [${loop.loopType}] ${loop.pattern} (sévérité: ${loop.severity}/100, ${loop.count ?? "?"} occurrences)`);
      }
    }
    lines.push("");

    // 5. Risques
    lines.push(`## 5. Risques actuels`);
    lines.push("");
    if (risks.length === 0) {
      lines.push(`✅ Faible risque détecté.`);
    } else {
      for (const risk of risks) lines.push(`- ⚠️ ${risk}`);
    }
    lines.push("");

    // 6. Leçons apprises
    lines.push(`## 6. Leçons apprises (Top 5)`);
    lines.push("");
    if (lessons.length === 0) {
      lines.push(`(Aucune leçon extraite pour le moment)`);
    } else {
      for (const lesson of lessons.slice(0, 5)) {
        const icon = lesson.type === "error_pattern" ? "❌"
          : lesson.type === "success_pattern" ? "✅"
          : lesson.type === "optimization" ? "⚡"
          : lesson.type === "risk" ? "⚠️"
          : "📝";
        lines.push(`- ${icon} **[${lesson.type}]** ${lesson.description}`);
        lines.push(`  - 💡 *${lesson.recommendation}*`);
        lines.push(`  - Importance: ${(lesson.importance * 100).toFixed(0)}% — Occurrences: ${lesson.occurrenceCount}`);
      }
    }
    lines.push("");

    // 7. Conclusion
    lines.push(`## 7. Conclusion`);
    lines.push("");
    if (risks.length === 0 && confFinal >= 0.6 && successRate >= 60) {
      lines.push(`✅ Mission maîtrisée : progression satisfaisante, confiance finale élevée.`);
    } else if (loopsDedup.length > 0 || escalatedActions > 0) {
      lines.push(`⚠️ Mission tendue : blocages ou escalades observés. Revoir la stratégie avant de poursuivre.`);
    } else {
      lines.push(`🔄 Mission en cours : poursuivre avec vérifications régulières.`);
    }

    return lines.join("\n");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Réflexion LLM + heuristique (code historique, conservé et enrichi)
  // ══════════════════════════════════════════════════════════════════════════

  private async reflectWithLLM(params: ReflectionInput): Promise<ReflectionResult> {
    const prompt = this.buildReflectPrompt(params);

    try {
      const response = await this.reflectFn!(prompt);
      const result = this.parseReflectResult(response, params);
      return result;
    } catch (err) {
      log.warn(`[Reflection] LLM reflection failed, using heuristic:`, (err as Error).message);
      return this.reflectHeuristic(params);
    }
  }

  private buildReflectPrompt(params: ReflectionInput): string {
    const mode = params.mode || "standard";
    return `Tu es un moteur de réflexion (mode ${mode}). Analyse le résultat de cette action et décide de la suite.

ACTION: ${params.actionName} (skill: ${params.skillName})
OBJECTIF: ${params.goalTitle}
${params.currentGoal ? `CONTEXTE OBJECTIF: statut=${params.currentGoal.status || "?"}, tentatives=${params.currentGoal.attempts || 0}/${params.currentGoal.maxAttempts || "?"}` : ""}
RÉSULTAT: ${params.success ? "SUCCÈS" : "ÉCHEC"}
${params.result ? `DONNÉES: ${typeof params.result === "string" ? params.result.slice(0, 500) : JSON.stringify(params.result).slice(0, 500)}` : ""}
${params.error ? `ERREUR: ${params.error}` : ""}
${params.affectedFiles && params.affectedFiles.length > 0 ? `FICHIERS MODIFIÉS: ${params.affectedFiles.join(", ")}` : ""}

CONTEXTE:
- Tentatives précédentes: ${params.attemptCount}/${params.maxAttempts}
- Confiance précédente: ${((params.previousConfidence ?? 0.5) * 100).toFixed(0)}%
- Erreurs passées: ${params.previousErrors?.slice(-3).join("; ") || "aucune"}

INSTRUCTIONS:
Réponds en JSON strict:
{
  "observation": "Ce qui s'est passé concrètement",
  "success": "Ce qui a bien fonctionné (null si rien)",
  "failure": "Ce qui a échoué ou manque (null si tout va bien)",
  "hypothesis": "Nouvelle hypothèse ou stratégie (null si on continue)",
  "confidence": 0.0-1.0,
  "decision": "continue|retry|replan|escalate|abort",
  "reasoning": "Pourquoi cette décision"
}`;
  }

  private parseReflectResult(response: string, params: ReflectionInput): ReflectionResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        actionId: params.actionId,
        timestamp: new Date().toISOString(),
        observation: String(parsed.observation || "Action exécutée"),
        success: parsed.success ?? null,
        failure: parsed.failure ?? null,
        hypothesis: parsed.hypothesis ?? null,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        decision: this.validateDecision(parsed.decision),
        reasoning: String(parsed.reasoning || ""),
      };
    } catch (err) {
      return this.reflectHeuristic(params);
    }
  }

  private reflectHeuristic(params: ReflectionInput): ReflectionResult {
    const { success, error, attemptCount, maxAttempts, previousConfidence } = params;

    let confidence: Confidence;
    let decision: ReflectionResult["decision"];
    let observation: string;
    let hypothesis: string | null = null;

    if (success) {
      confidence = Math.min(1, (previousConfidence ?? 0.5) + 0.15);
      decision = "continue";
      observation = `Action "${params.skillName}" exécutée avec succès.`;
    } else if (attemptCount >= maxAttempts) {
      confidence = Math.max(0, (previousConfidence ?? 0.5) - 0.3);
      decision = "escalate";
      observation = `Action "${params.skillName}" a échoué ${attemptCount} fois. Limite atteinte.`;
      hypothesis = "L'approche actuelle ne fonctionne pas. Besoin d'intervention ou de changement de stratégie.";
    } else if (attemptCount >= 2) {
      confidence = Math.max(0, (previousConfidence ?? 0.5) - 0.2);
      decision = "replan";
      observation = `Action "${params.skillName}" échoue de façon répétée (${attemptCount}x).`;
      hypothesis = `L'erreur "${error}" suggère un problème structurel. Changer d'approche.`;
    } else {
      confidence = Math.max(0, (previousConfidence ?? 0.5) - 0.1);
      decision = "retry";
      observation = `Action "${params.skillName}" a échoué: ${error}`;
      hypothesis = "Erreur possiblement transitoire, retenter.";
    }

    // Détection de boucle (version enrichie Sprint 6)
    const loop = this.detectLoop();
    if (loop.isLoop && decision !== "escalate") {
      decision = "escalate";
      confidence = Math.max(0, confidence - 0.2);
      hypothesis = `Boucle détectée [${loop.loopType}]: ${loop.pattern}. Escalade nécessaire.`;
    }

    // Injection tendance de confiance (si déclin → ajustement)
    const trend = this.analyzeConfidence(5);
    if (trend.trend === "declining" && decision === "retry") {
      decision = "replan";
      hypothesis = (hypothesis ? hypothesis + " — " : "") + trend.recommendation;
    }

    const result: ReflectionResult = {
      actionId: params.actionId,
      timestamp: new Date().toISOString(),
      observation,
      success: success ? `${params.skillName} a produit un résultat valide.` : null,
      failure: !success ? (error ?? "Erreur inconnue") : null,
      hypothesis,
      confidence,
      decision,
      reasoning: this.explainDecision(decision, params),
    };

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers internes
  // ══════════════════════════════════════════════════════════════════════════

  private validateDecision(decision: unknown): ReflectionResult["decision"] {
    const valid = ["continue", "retry", "replan", "escalate", "abort"];
    if (typeof decision === "string" && valid.includes(decision)) {
      return decision as ReflectionResult["decision"];
    }
    return "continue";
  }

  private explainDecision(decision: ReflectionResult["decision"], params: ReflectionInput): string {
    switch (decision) {
      case "continue":
        return "L'action a réussi. On passe à l'étape suivante.";
      case "retry":
        return `Premier échec (tentative ${params.attemptCount}/${params.maxAttempts}). On retente.`;
      case "replan":
        return `Échecs multiples (${params.attemptCount}x). L'approche doit changer.`;
      case "escalate":
        return "Trop d'échecs ou boucle détectée. L'utilisateur doit intervenir.";
      case "abort":
        return "Objectif impossible à atteindre dans les conditions actuelles.";
    }
  }

  private addToHistory(result: ReflectionResult): void {
    this.reflectionHistory.push(result);
    if (this.reflectionHistory.length > ReflectionEngine.MAX_HISTORY) {
      this.reflectionHistory.shift();
    }
    // Invalider le cache de boucles après ajout
    this.loopCache.clear();
  }

  private critiqueReflection(result: ReflectionResult, params: ReflectionInput): { shouldRevise: boolean; notes: string } {
    const notes: string[] = [];
    let shouldRevise = false;

    // 1) Confiance finale vs minimale
    if (result.confidence < 0.3 && result.decision === "continue") {
      notes.push("Confiance très faible mais décision 'continue' — incohérent");
      shouldRevise = true;
    }

    // 2) Échec sans hypothèse claire
    if (result.failure && !result.hypothesis && params.attemptCount >= 2) {
      notes.push("Échec répété sans nouvelle hypothèse — à compléter");
      shouldRevise = true;
    }

    // 3) Boucle détectée ignorée
    const loop = this.detectLoop();
    if (loop.isLoop && result.decision !== "escalate" && result.decision !== "abort") {
      notes.push(`Boucle [${loop.loopType}] ignorée dans la décision`);
      shouldRevise = true;
    }

    // 4) Raisonnement trop court
    if (result.reasoning.length < 20) {
      notes.push("Raisonnement trop concis");
    }

    return { shouldRevise, notes: notes.join(" ; ") };
  }

  private reviseReflection(
    base: ReflectionResult,
    notes: string,
    _params: ReflectionInput
  ): ReflectionResult {
    const revised: ReflectionResult = {
      ...base,
      observation: base.observation + ` [révisé: ${notes}]`,
      reasoning: base.reasoning + ` — Notes d'auto-critique: ${notes}`,
      decision: notes.includes("Boucle") || notes.includes("incohérent")
        ? (base.confidence < 0.4 ? "escalate" : "replan")
        : base.decision,
    };
    if (revised.decision !== base.decision) {
      revised.confidence = Math.max(0, base.confidence - 0.05);
      revised.reasoning += ` (décision ajustée: ${base.decision} → ${revised.decision})`;
    }
    return revised;
  }

  private findSimilarPrecedents(params: ReflectionInput, count: number): {
    actionId: string;
    success: boolean;
    confidence: number;
    loopType?: string;
  }[] {
    const recent = this.reflectionHistory.slice(-15);
    const scored = recent.map((r) => {
      let score = 0;
      if (r.failure && params.error) {
        const normR = this.normalizeError(r.failure || "");
        const normP = this.normalizeError(params.error);
        if (normR === normP) score += 5;
        else if (this.levenshteinOverlap(normR, normP)) score += 2;
      }
      if (!!r.success === params.success) score += 1;
      return {
        actionId: r.actionId,
        success: !!r.success,
        confidence: r.confidence,
        score,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score >= 1)
      .slice(0, count)
      .map(({ score, ...rest }) => rest);
  }

  private computePrecedentSuccessConfidence(
    precedents: { success: boolean; confidence: number }[]
  ): number {
    const successes = precedents.filter((p) => p.success);
    if (successes.length === 0) return 0.2;
    return successes.reduce((s, p) => s + p.confidence, 0) / successes.length;
  }

  private levenshteinOverlap(a: string, b: string): boolean {
    if (!a || !b) return false;
    const short = a.length < b.length ? a : b;
    const long = short === a ? b : a;
    // Simple heuristique : partage au moins 40% de mots
    const tokA = new Set(short.split(/\s+/));
    const tokB = long.split(/\s+/);
    let common = 0;
    for (const t of tokB) if (tokA.has(t)) common++;
    return common / Math.max(1, tokA.size) >= 0.4;
  }

  private looksCritical(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return /(server\.ts|index\.ts|types\.ts|config|router|middleware|schema|auth|security|deploy|docker|build|webpack|vite|tsconfig)/i.test(lower)
      || lower.endsWith(".test.ts") === false && /(knowledge|mission|agents|skills\/(codebase|reasoning|memory))/i.test(lower);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du ReflectionEngine */
export const reflectionEngine = new ReflectionEngine();
