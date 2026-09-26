/**
 * AutonomousLoop — Boucle de décision autonome Observe → Decide → Act
 *
 * Enveloppe l'AgentExecutor pour permettre aux agents d'itérer sur leur propre
 * travail de manière autonome, sans intervention humaine.
 *
 * Cycle par itération :
 *   1. OBSERVE  — Analyse le résultat de l'itération précédente
 *   2. DECIDE   — Détermine si une itération supplémentaire est nécessaire
 *   3. ACT      — Relance l'exécution avec un prompt enrichi du contexte accumulé
 *
 * Conditions de ré-itération :
 *   - L'agent a émis un signal ## RETRY dans sa sortie
 *   - Des fichiers écrits ont des erreurs de vérification (verify_file)
 *   - La confiance du résultat est trop basse (score interne)
 *   - Des délégations ont échoué et l'agent veut les ré-essayer
 *
 * Conditions d'arrêt :
 *   - Résultat jugé satisfaisant (pas de signal RETRY, confiance suffisante)
 *   - Nombre max d'itérations atteint (configurable, défaut: 6)
 *   - Timeout global dépassé
 *   - Deux itérations consécutives produisent le même résultat (détection de boucle)
 */
import type { AgentTask, TaskResult } from "./types.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";
import { getAgentDefinitionOrThrow } from "./roles.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AutonomousLoop");

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface LoopConfig {
  /** Nombre maximum d'itérations (défaut: 6, borné à 3 approches de 2 tentatives) */
  maxIterations: number;
  /** Timeout global pour toutes les itérations cumulées (ms, défaut: 5 min) */
  globalTimeoutMs: number;
  /** Seuil de confiance minimum pour accepter un résultat (0-1, défaut: 0.6) */
  minConfidenceScore: number;
  /** Activer la vérification des fichiers après écriture (défaut: true) */
  verifyFiles: boolean;
}

export interface IterationRecord {
  iteration: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  resultSummary: string;
  confidenceScore: number;
  decision: LoopDecision;
  decisionReason: string;
  filesWritten: string[];
  delegationsSent: number;
  retrySignal: boolean;
  verifyErrors: string[];
}

export type LoopDecision = "continue" | "stop" | "stop_loop_detected" | "stop_timeout" | "stop_max_iterations";

export interface LoopResult {
  finalTask: AgentTask;
  totalIterations: number;
  totalDurationMs: number;
  iterations: IterationRecord[];
  finalDecision: LoopDecision;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: LoopConfig = {
  maxIterations: 6,
  globalTimeoutMs: 5 * 60 * 1000, // 5 minutes
  minConfidenceScore: 0.6,
  verifyFiles: true,
};

// Seuil de similarité pour la détection de boucle (0-1)
const LOOP_DETECTION_SIMILARITY = 0.85;

// Budget maximal d'erreurs cumulées avant arrêt forcé
const MAX_CUMULATIVE_ERRORS = 6;
const MAX_ATTEMPTS_PER_APPROACH = 2;
const MAX_APPROACHES = 3;
const MAX_AUTONOMOUS_ATTEMPTS = MAX_ATTEMPTS_PER_APPROACH * MAX_APPROACHES;

// ═══════════════════════════════════════════════════════════════════════════════
// AutonomousLoop
// ═══════════════════════════════════════════════════════════════════════════════

export class AutonomousLoop {
  constructor(
    private readonly executor: AgentTaskRunner,
    private readonly config: LoopConfig = DEFAULT_CONFIG
  ) {}

  /**
   * Exécute une tâche dans la boucle autonome.
   * Peut lancer plusieurs itérations selon la décision interne.
   */
  async run(task: AgentTask): Promise<LoopResult> {
    const agent = getAgentDefinitionOrThrow(task.role);
    const globalStart = Date.now();
    const iterations: IterationRecord[] = [];
    let iteration = 0;
    let finalDecision: LoopDecision = "stop";

    log.info(
      `🔄 [${agent.name}] AutonomousLoop démarré — max ${this.config.maxIterations} itérations`
    );

    // Snapshot du contexte original pour ne pas le corrompre entre itérations
    const originalDescription = task.description;
    const originalFiles = [...task.context.files];

    const maxIterations = Math.min(this.config.maxIterations, MAX_AUTONOMOUS_ATTEMPTS);

    while (iteration < maxIterations) {
      iteration++;

      // ── Vérification timeout global ──
      const elapsed = Date.now() - globalStart;
      if (elapsed >= this.config.globalTimeoutMs) {
        log.warn(
          `[${agent.name}] Timeout global atteint (${elapsed}ms) — arrêt après itération ${iteration - 1}`
        );
        finalDecision = "stop_timeout";
        break;
      }

      const approach = Math.floor((iteration - 1) / MAX_ATTEMPTS_PER_APPROACH) + 1;
      log.info(`[${agent.name}] Approche ${approach}/${MAX_APPROACHES}, tentative ${((iteration - 1) % MAX_ATTEMPTS_PER_APPROACH) + 1}/${MAX_ATTEMPTS_PER_APPROACH}`);

      const iterStart = Date.now();

      // ── ACT : exécuter l'itération ──
      log.info(`[${agent.name}] 🔄 ACT — itération ${iteration}/${this.config.maxIterations}: "${task.title}"`);
      await this.executor.execute(task);
      const iterDuration = Date.now() - iterStart;
      const result = task.result;

      if (!result) {
        log.error(`[${agent.name}] Pas de résultat à l'itération ${iteration} — arrêt`);
        finalDecision = "stop";
        break;
      }

      // ── OBSERVE : analyser le résultat ──
      const observation = await this.observe(task, result);

      const record: IterationRecord = {
        iteration,
        startedAt: task.startedAt ?? new Date().toISOString(),
        completedAt: task.completedAt ?? new Date().toISOString(),
        durationMs: iterDuration,
        resultSummary: result.summary,
        confidenceScore: observation.confidenceScore,
        decision: "continue", // sera mis à jour
        decisionReason: "",
        filesWritten: result.filesModified ?? [],
        delegationsSent: result.delegatedSubTasks?.length ?? 0,
        retrySignal: observation.hasRetrySignal,
        verifyErrors: observation.verifyErrors,
      };

      // ── DECIDE : décider de continuer ou non ──
      const decision = this.decide(observation, iterations, iteration);
      record.decision = decision.action;
      record.decisionReason = decision.reason;
      iterations.push(record);

      const confPct = (observation.confidenceScore * 100).toFixed(0);
      const verifyTag = observation.verifyErrors.length > 0
        ? ` | ❌ Erreurs vérif: ${observation.verifyErrors.slice(0, 2).join("; ")}`
        : " | ✅ Vérifications OK";
      const retryTag = observation.hasRetrySignal ? " | 🔁 RETRY signal" : "";
      const filesTag = record.filesWritten.length > 0
        ? ` | 💾 Fichiers: [${record.filesWritten.join(", ")}]`
        : "";
      const deleg = record.delegationsSent > 0 ? ` | 🔀 Délég: ${record.delegationsSent}` : "";

      log.info(
        `[${agent.name}] 📊 Itération ${iteration}/${this.config.maxIterations} (${(record.durationMs / 1000).toFixed(1)}s) — Confiance: ${confPct}% | Décision: ${decision.action}${retryTag}${verifyTag}${filesTag}${deleg}`
      );
      log.debug(`[${agent.name}] Décision raison: ${decision.reason}`);
      if (result.summary) {
        log.debug(`[${agent.name}] Résumé itération: ${result.summary.slice(0, 200)}`);
      }

      if (decision.action !== "continue") {
        finalDecision = decision.action;
        break;
      }

      // ── Préparer l'itération suivante ──
      const forcePivot = iteration % MAX_ATTEMPTS_PER_APPROACH === 0;
      this.enrichTaskForNextIteration(task, result, observation, iteration, originalDescription, originalFiles, forcePivot);

      // Reset du statut pour la prochaine itération
      task.status = "pending";
      task.startedAt = undefined;
      task.completedAt = undefined;
    }

    // Si on a atteint le max sans décision explicite
    if (iteration >= maxIterations && finalDecision === "stop") {
      finalDecision = "stop_max_iterations";
      log.info(`[${agent.name}] Limite autonome atteinte (${maxIterations} tentatives, ${MAX_APPROACHES} approches maximum)`);
    }

    const totalDuration = Date.now() - globalStart;
    log.info(
      `[${agent.name}] 🏁 AutonomousLoop terminé — ${iteration} itération(s) en ${(totalDuration / 1000).toFixed(1)}s — Décision: ${finalDecision}`
    );
    if (iterations.length > 1) {
      const confScores = iterations.map(i => `${i.iteration}:${(i.confidenceScore * 100).toFixed(0)}%`).join(" → ");
      log.debug(`[${agent.name}] Progression confiance: ${confScores}`);
      const totalFilesWritten = new Set(iterations.flatMap(i => i.filesWritten)).size;
      if (totalFilesWritten > 0) {
        log.info(`[${agent.name}] Total fichiers modifiés sur toutes itérations: ${totalFilesWritten}`);
      }
    }

    return {
      finalTask: task,
      totalIterations: iteration,
      totalDurationMs: totalDuration,
      iterations,
      finalDecision,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVE
  // ═══════════════════════════════════════════════════════════════════════════

  private async observe(
    task: AgentTask,
    result: TaskResult
  ): Promise<ObservationReport> {
    const details = result.details ?? "";

    // Signal explicite de retry dans la sortie de l'agent
    const hasRetrySignal =
      result.success === false ||
      /##\s*RETRY|##\s*RELANCER|##\s*CORRECTION_NÉCESSAIRE/i.test(details);

    // Un échec ne peut jamais être interprété comme un signal DONE.
    const hasDoneSignal =
      result.success === true && /##\s*TERMINÉ|##\s*DONE|##\s*COMPLET/i.test(details);

    const verifyErrors: string[] = [];

    // Erreurs déjà connues à l'écriture (rejets pré-validation, cf. GeneratedFileWriter)
    if (result.fileValidationErrors?.length) {
      for (const e of result.fileValidationErrors) {
        verifyErrors.push(`${e.path}: ${e.error}`);
      }
    }

    // AgentExecutor vérifie déjà chaque écriture et expose la preuve structurée.
    // Ne relancer les vérifications que si cette preuve est absente ou négative.
    const evidencePassed = result.evidence?.verification.passed === true;
    if (this.config.verifyFiles && result.filesModified?.length && !evidencePassed) {
      for (const file of result.filesModified.slice(0, 5)) {
        const error = await this.verifyFile(file);
        if (error) verifyErrors.push(`${file}: ${error}`);
      }
    }

    // Validation build synchrone uniquement lorsque l’exécuteur n’a pas déjà
    // fourni une vérification complète, afin d’éviter le double travail.
    if (result.filesModified?.length && !evidencePassed) {
      try {
        const { runValidation } = await import("../utils/postEditValidator.js");
        const buildResult = await runValidation();
        if (!buildResult.valid && buildResult.errors) {
          verifyErrors.push(`build: ${buildResult.errors.slice(0, 500)}`);
        }
      } catch {
        // non bloquant si la validation échoue à se lancer
      }
    }

    // Score de confiance composite (avec tracking des erreurs précédentes)
    const confidenceScore = this.computeConfidence({
      success: result.success,
      hasRetrySignal,
      hasDoneSignal,
      verifyErrors,
      resultLength: details.length,
      filesWritten: result.filesModified?.length ?? 0,
      previousErrorCount: (task.context as any)?._previousErrorCount,
    });

    // Stocker le nombre d'erreurs pour la prochaine itération
    (task.context as any)._previousErrorCount = verifyErrors.length;

    return {
      hasRetrySignal,
      hasDoneSignal,
      verifyErrors,
      confidenceScore,
      resultLength: details.length,
      resultSummary: result.summary,
    };
  }

  private async verifyFile(filePath: string): Promise<string | null> {
    try {
      if (!this.executor.runTool) return null; // moteur sans exécution d'outil isolé
      const result = (await this.executor.runTool("verify_file", { path: filePath })) as any;
      if (!result || result.ok === true || result.status === "success") return null;
      const issues = Array.isArray(result.allIssues)
        ? result.allIssues.slice(0, 10).map((issue: any) => `${issue.file ?? "global"}${issue.line ? `:${issue.line}` : ""} — ${issue.message ?? "Erreur"}`)
        : [];
      const phases = [result.typecheck, result.lint, result.test].filter((phase: any) => phase?.ok === false);
      const phaseOutput = phases.flatMap((phase: any) => [phase.output, phase.stdout, phase.stderr]).filter(Boolean);
      const details = [...issues, ...phaseOutput, result.message, result.stderr, result.error].filter(Boolean).join("\n");
      return details.slice(0, 5000) || `verify_file a échoué (code ${result.exitCode ?? "inconnu"}).`;
    } catch (error) {
      return `verify_file indisponible: ${(error as Error).message}`;
    }
  }

  private computeConfidence(factors: {
    success: boolean;
    hasRetrySignal: boolean;
    hasDoneSignal: boolean;
    verifyErrors: string[];
    resultLength: number;
    filesWritten: number;
    previousErrorCount?: number;
  }): number {
    let score = factors.success ? 0.5 : 0.1;

    // Bonus : signal DONE explicite
    if (factors.hasDoneSignal) score += 0.2;

    // Malus : signal RETRY explicite
    if (factors.hasRetrySignal) score -= 0.3;

    // Malus : erreurs de vérification de fichiers
    score -= factors.verifyErrors.length * 0.15;

    // Malus amplifié : les erreurs n'ont pas diminué entre itérations
    if (
      factors.previousErrorCount !== undefined &&
      factors.verifyErrors.length >= factors.previousErrorCount &&
      factors.previousErrorCount > 0
    ) {
      score -= 0.25;
    }

    // Bonus modéré : résultat détaillé (plafonné pour éviter le "gonflage")
    if (factors.resultLength > 500) score += 0.05;
    if (factors.resultLength > 2000) score += 0.05;

    // Bonus fichiers produits (uniquement si pas d'erreurs)
    if (factors.filesWritten > 0 && factors.verifyErrors.length === 0) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DECIDE
  // ═══════════════════════════════════════════════════════════════════════════

  private decide(
    obs: ObservationReport,
    history: IterationRecord[],
    _currentIteration: number
  ): { action: LoopDecision; reason: string } {
    // ── Budget d'erreurs cumulées — arrêt forcé si trop d'erreurs au total ──
    const totalCumulativeErrors = history.reduce(
      (sum, it) => sum + it.verifyErrors.length, 0
    ) + obs.verifyErrors.length;

    if (totalCumulativeErrors > MAX_CUMULATIVE_ERRORS) {
      return {
        action: "stop",
        reason: `Budget d'erreurs épuisé (${totalCumulativeErrors} erreurs cumulées > ${MAX_CUMULATIVE_ERRORS}) — intervention humaine requise`,
      };
    }

    // ── Détection de boucle : comparer les summaries des itérations ──
    if (history.length >= 1) {
      const lastSummary = history[history.length - 1].resultSummary;
      const lastRecord = history[history.length - 1];

      // Comparaison par similarité textuelle entre les deux derniers résumés
      // Éviter les faux positifs sur résumés très courts (< 40 caractères)
      const hasSubstantialSummary = (lastSummary?.length ?? 0) >= 40 && (obs.resultSummary?.length ?? 0) >= 40;
      const similarity = this.stringSimilarity(lastSummary, obs.resultSummary);

      if (hasSubstantialSummary && similarity > LOOP_DETECTION_SIMILARITY) {
        return {
          action: "stop_loop_detected",
          reason: `Résultat trop similaire au précédent (similarité: ${(similarity * 100).toFixed(0)}%)`,
        };
      }

      // Double vérification : deux itérations successives avec summaries identiques et sans progrès
      if (history.length >= 2) {
        const prev1 = history[history.length - 1].resultSummary;
        const prev2 = history[history.length - 2].resultSummary;
        const prevSimilarity = this.stringSimilarity(prev1, prev2);
        if (prevSimilarity > LOOP_DETECTION_SIMILARITY && obs.verifyErrors.length === lastRecord.verifyErrors.length) {
          return {
            action: "stop_loop_detected",
            reason: `Deux itérations consécutives quasi-identiques détectées sans progression (${(prevSimilarity * 100).toFixed(0)}%)`,
          };
        }
      }
    }

    // ── Erreurs qui ne diminuent pas — l'agent tourne en rond ──
    if (history.length >= 1 && obs.verifyErrors.length > 0) {
      const lastErrors = history[history.length - 1].verifyErrors.length;
      if (obs.verifyErrors.length >= lastErrors && lastErrors > 0) {
        // Les erreurs n'ont pas diminué — vérifier si c'est la 2e fois consécutive
        if (
          history.length >= 2 &&
          history[history.length - 2].verifyErrors.length <= lastErrors
        ) {
          return {
            action: "stop",
            reason: `Les erreurs ne diminuent pas (${obs.verifyErrors.length} ≥ ${lastErrors}) — l'agent ne progresse plus`,
          };
        }
      }
    }

    // ── Confiance suffisante → arrêt ──
    if (obs.confidenceScore >= this.config.minConfidenceScore && !obs.hasRetrySignal) {
      return {
        action: "stop",
        reason: `Confiance suffisante (${(obs.confidenceScore * 100).toFixed(0)}% ≥ ${(this.config.minConfidenceScore * 100).toFixed(0)}%)`,
      };
    }

    // ── Signal RETRY explicite → continuer ──
    if (obs.hasRetrySignal) {
      return {
        action: "continue",
        reason: "Signal RETRY explicite de l'agent",
      };
    }

    // ── Erreurs de vérification → continuer pour corriger ──
    if (obs.verifyErrors.length > 0) {
      return {
        action: "continue",
        reason: `${obs.verifyErrors.length} erreur(s) de vérification à corriger`,
      };
    }

    // ── Confiance trop basse → continuer ──
    if (obs.confidenceScore < this.config.minConfidenceScore) {
      return {
        action: "continue",
        reason: `Confiance insuffisante (${(obs.confidenceScore * 100).toFixed(0)}% < ${(this.config.minConfidenceScore * 100).toFixed(0)}%)`,
      };
    }

    return { action: "stop", reason: "Résultat acceptable" };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACT — Enrichissement du contexte pour la prochaine itération
  // ═══════════════════════════════════════════════════════════════════════════

  private enrichTaskForNextIteration(
    task: AgentTask,
    prevResult: TaskResult,
    obs: ObservationReport,
    iterationNumber: number,
    originalDescription: string,
    originalFiles: string[],
    forcePivot = false
  ): void {
    const correctionParts: string[] = [
      `## Contexte de l'itération ${iterationNumber} (à corriger / améliorer)`,
      ``,
      `**Résultat précédent :** ${prevResult.summary}`,
    ];

    if (obs.verifyErrors.length > 0) {
      correctionParts.push(
        ``,
        `**⚠️ Erreurs de vérification détectées :**`,
        ...obs.verifyErrors.map((e) => `- ${e}`),
        ``,
        `**→ Tu DOIS corriger ces erreurs dans cette itération.**`
      );
    }

    if (obs.hasRetrySignal) {
      // Extraire le contenu du bloc ## RETRY pour guider l'itération suivante
      const retryMatch = prevResult.details?.match(
        /##\s*RETRY\s*\n([\s\S]*?)(?=\n##|$)/i
      );
      if (retryMatch) {
        correctionParts.push(
          ``,
          `**Signal RETRY de l'itération précédente :**`,
          retryMatch[1].trim()
        );
      }
    }

    if (forcePivot) {
      correctionParts.push(
        ``,
        `**PIVOT IMPOSE PAR LE RUNTIME :** les deux tentatives de cette approche sont épuisées.`,
        `La prochaine itération doit changer réellement de stratégie : autre outil, autre découpage ou nouvelle analyse du contexte. Ne répète pas exactement la même correction.`
      );
    }

    // Injecter le contexte de correction dans la description de la tâche
    task.description = `${originalDescription}\n\n${correctionParts.join("\n")}`;

    // Ajouter les fichiers produits à la précédente itération comme contexte
    if (prevResult.filesModified?.length) {
      const newFiles = [
        ...originalFiles,
        ...prevResult.filesModified,
      ].filter((v, i, arr) => arr.indexOf(v) === i);
      task.context.files = newFiles;
    }

    // Injecter un résumé léger du résultat précédent (pas le résultat complet)
    // pour ne pas saturer la fenêtre de contexte du LLM
    const lightResult = {
      summary: prevResult.summary,
      success: prevResult.success,
      errors: obs.verifyErrors,
      filesModified: prevResult.filesModified,
    };

    task.context.previousResults = [
      ...(task.context.previousResults ?? []),
      lightResult as any,
    ].slice(-2); // Max 2 itérations précédentes pour garder le prompt léger

    log.debug(
      `[Itération ${iterationNumber + 1}] Contexte enrichi — ${task.context.files.length} fichier(s), ${task.context.previousResults.length} résultat(s) précédent(s)`
    );
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    return (longer.length - this.editDistance(longer, shorter)) / longer.length;
  }

  private editDistance(a: string, b: string): number {
    // Optimisation : limiter à 200 chars pour ne pas bloquer sur de gros textes
    const sa = a.slice(0, 200);
    const sb = b.slice(0, 200);
    const dp: number[][] = Array.from({ length: sa.length + 1 }, (_, i) =>
      Array.from({ length: sb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= sa.length; i++) {
      for (let j = 1; j <= sb.length; j++) {
        dp[i][j] =
          sa[i - 1] === sb[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[sa.length][sb.length];
  }
}

// ─── Types internes ───────────────────────────────────────────────────────────

interface ObservationReport {
  hasRetrySignal: boolean;
  hasDoneSignal: boolean;
  verifyErrors: string[];
  confidenceScore: number;
  resultLength: number;
  resultSummary: string;
}
