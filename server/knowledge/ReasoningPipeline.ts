/**
 * ReasoningPipeline — Pipeline de raisonnement multi-étapes
 *
 * Orchestre un raisonnement structuré en 6 étapes pour produire
 * une réponse fiable et vérifiable :
 *  1. understanding  — Décomposition et compréhension de la tâche
 *  2. search         — Recherche sémantique (SemanticSearch)
 *  3. context        — Construction du contexte enrichi (ProjectMemory)
 *  4. reasoning      — Synthèse raisonnée à partir du contexte
 *  5. self_critique  — Auto-évaluation (heuristique ou LLM)
 *  6. final          — Réponse finale + suggestions de vérification
 *
 * Modes :
 *  - fast      : Recherche minimale, auto-critique heuristique uniquement
 *  - balanced  : Pipeline complet, 1 passe d'auto-critique (défaut)
 *  - deep      : Recherche approfondie, multi-passes, auto-critique LLM si dispo
 *
 * Architecture :
 *   PipelineContext
 *        ↓
 *   run() ──→ step_understanding()
 *                ↓
 *             step_search() ← SemanticSearch
 *                ↓
 *             step_context() ← ProjectMemory
 *                ↓
 *             step_reasoning()
 *                ↓
 *             step_selfCritique() ← (optionnel) generateText() LLM
 *                ↓ loop tant que critique sévère (deep only)
 *             step_final()
 *                ↓
 *           ReasoningResult
 */

import { createLogger } from "../utils/logger.js";
import { semanticSearch } from "./SemanticSearch.js";
import { projectMemory } from "./ProjectMemory.js";
import { generateText } from "../utils/textGeneration.js";
import type {
  ReasoningStep,
  StepResult,
  PipelineContext,
  ReasoningResult,
  ContextBatch,  RelevantFile,
} from "./types.js";

// ─── Import différé pour éviter les dépendances circulaires ─────────────────
// LearningEngine est importé dynamiquement dans les méthodes qui en ont besoin.
type LearningEngineType = import("./LearningEngine.js").LearningEngine;
let _learningEngineCache: LearningEngineType | null = null;
async function getLearningEngine(): Promise<LearningEngineType | null> {
  if (_learningEngineCache) return _learningEngineCache;
  try {
    const mod = await import("./LearningEngine.js");
    _learningEngineCache = mod.learningEngine;
    return _learningEngineCache;
  } catch {
    return null;
  }
}

const log = createLogger("ReasoningPipeline");

// ─── Types internes ───────────────────────────────────────────────────────────

interface InjectedLesson {
  type: string;
  description: string;
  recommendation: string;
  importance: number;
}

// ─── Configuration par mode ──────────────────────────────────────────────────

interface ModeConfig {
  maxSearchResults: number;
  maxFacts: number;
  selfCritiquePasses: number;
  useLLMForCritique: boolean;
  enableSubQueryExpansion: boolean;
  confidenceThreshold: number;
}

const MODE_CONFIGS: Record<PipelineContext["mode"], ModeConfig> = {
  fast: {
    maxSearchResults: 5,
    maxFacts: 5,
    selfCritiquePasses: 1,
    useLLMForCritique: false,
    enableSubQueryExpansion: false,
    confidenceThreshold: 0.4,
  },
  balanced: {
    maxSearchResults: 12,
    maxFacts: 10,
    selfCritiquePasses: 1,
    useLLMForCritique: false,
    enableSubQueryExpansion: true,
    confidenceThreshold: 0.5,
  },
  deep: {
    maxSearchResults: 20,
    maxFacts: 15,
    selfCritiquePasses: 3,
    useLLMForCritique: true,
    enableSubQueryExpansion: true,
    confidenceThreshold: 0.7,
  },
};

// ─── Cost/Benefit guards for deep mode multi-passes ───────────────────────────

/** Confiance minimale en dessous de laquelle on estime qu'une révision supplémentaire a peu de valeur. */
const LOW_CONFIDENCE_TO_REVISE = 0.35;
/** Confiance élevée (>= threshold + marge) -> on saute les passes suivantes car gain marginal. */
const HIGH_CONFIDENCE_SKIP_MARGIN = 0.08;
/** Coût d'1 passe d'auto-critique LLM (tokens estimés) — heuristique pour budget global. */
const AVG_LLM_CRITIQUE_TOKENS = 2000;
/** Budget tokens total estimé pour le mode deep ; au delà -> on arrête de consommer. */
const MODE_DEEP_TOKEN_BUDGET = 20_000;
/** Gain minimum de confiance entre passes sinon -> on stoppe (plateau). */
const MIN_MARGINAL_GAIN = 0.02;

// ═══════════════════════════════════════════════════════════════════════════════
// ReasoningPipeline
// ═══════════════════════════════════════════════════════════════════════════════

export class ReasoningPipeline {
  private steps: StepResult[] = [];
  private totalTokensUsed = 0;

  // ─── API publique ─────────────────────────────────────────────────────────

  /**
   * Exécute le pipeline complet de raisonnement.
   * Retourne un ReasoningResult avec la réponse finale, les étapes,
   * les métriques et les suggestions.
   */
  async run(context: PipelineContext): Promise<ReasoningResult> {
    const startTotal = Date.now();
    this.steps = [];
    this.totalTokensUsed = 0;

    const mode = context.mode || "balanced";
    const config = MODE_CONFIGS[mode];
    log.info(`🧠 Démarrage ReasoningPipeline [mode=${mode}] tâche: "${context.task.slice(0, 80)}..."`);

    // ── Étape 0 : Injection des leçons passées (pré-raisonnement) ────────
    const injectedLessons = await this.loadRelevantLessons(context.task);
    if (injectedLessons.length > 0) {
      log.debug(`[MetaLearning] ${injectedLessons.length} leçon(s) injectée(s) dans le contexte de raisonnement.`);
    }

    // ── Étape 1 : Understanding ───────────────────────────────────────────
    const understanding = this.step_understanding(context, injectedLessons);
    this.steps.push(understanding);

    const subQueries = this.extractSubQueries(
      understanding.output,
      context.task,
      config.enableSubQueryExpansion
    );

    // ── Étape 2 : Search ──────────────────────────────────────────────────
    const search = await this.step_search(context, subQueries, config);
    this.steps.push(search);

    // ── Étape 3 : Context ─────────────────────────────────────────────────
    const ctxStep = await this.step_context(context, subQueries, config);
    this.steps.push(ctxStep);
    const contextBatch = (ctxStep as any)._batch as ContextBatch | undefined;

    // ── Étape 4 : Reasoning ───────────────────────────────────────────────
    const reasoning = this.step_reasoning(context, contextBatch, understanding.output);
    this.steps.push(reasoning);

    // ── Étape 5 : Self-Critique (multi-passes, coût/bénéfice) ─────────────
    let lastReasoning = reasoning;
    let previousConfidence = reasoning.confidence;
    let passesWithNoGain = 0;
    const isDeepMode = mode === "deep";

    for (let pass = 1; pass <= config.selfCritiquePasses; pass++) {
      // ── Garde coût/bénéfice ────────────────────────────────────────────
      if (isDeepMode) {
        // 1. Confiance déjà très haute (≥ threshold + marge) -> plus besoin de passer
        if (lastReasoning.confidence >= config.confidenceThreshold + HIGH_CONFIDENCE_SKIP_MARGIN) {
          log.debug(`[Deep Skip pass=${pass}] confiance=${(lastReasoning.confidence * 100).toFixed(0)}% ≥ seuil+${Math.round(HIGH_CONFIDENCE_SKIP_MARGIN * 100)}% → arrêt précoce (gain marginal nul attendu).`);
          break;
        }
        // 2. Confiance trop basse + plusieurs passes -> rendements décroissants
        if (lastReasoning.confidence < LOW_CONFIDENCE_TO_REVISE && pass >= 2) {
          log.debug(`[Deep Skip pass=${pass}] confiance trop basse (${(lastReasoning.confidence * 100).toFixed(0)}%) → les passes suivantes ont peu de valeur.`);
          break;
        }
        // 3. Plateau : 2 passes successives sans gain significatif
        const gain = lastReasoning.confidence - previousConfidence;
        if (pass >= 2 && gain < MIN_MARGINAL_GAIN) {
          passesWithNoGain++;
          if (passesWithNoGain >= 1) {
            log.debug(`[Deep Skip pass=${pass}] plateau détecté (gain=${(gain * 100).toFixed(1)}%) → arrêt précoce.`);
            break;
          }
        } else {
          passesWithNoGain = 0;
        }
        // 4. Budget tokens global dépassé
        const approxRemainingPasses = (config.selfCritiquePasses - pass + 1);
        const projectedTokens = this.totalTokensUsed + approxRemainingPasses * AVG_LLM_CRITIQUE_TOKENS;
        if (projectedTokens > MODE_DEEP_TOKEN_BUDGET && pass >= 2) {
          log.debug(`[Deep Skip pass=${pass}] budget tokens projeté ${projectedTokens} > ${MODE_DEEP_TOKEN_BUDGET} → arrêt précoce.`);
          break;
        }
      }

      const critique = await this.step_selfCritique(
        lastReasoning.output,
        contextBatch,
        context,
        pass,
        config
      );
      this.steps.push(critique);

      const shouldRevise = this.shouldReviseAfterCritique(
        critique,
        reasoning.confidence,
        config.confidenceThreshold,
        pass,
        config.selfCritiquePasses
      );

      if (!shouldRevise) break;

      // Réitérer le raisonnement avec le feedback de la critique
      previousConfidence = lastReasoning.confidence;
      lastReasoning = this.step_reasoning(
        context,
        contextBatch,
        understanding.output,
        critique.output,
        pass + 1
      );
      this.steps.push(lastReasoning);
    }

    // ── Étape 6 : Final ───────────────────────────────────────────────────
    const final = this.step_final(
      context,
      contextBatch,
      lastReasoning.output,
      this.steps,
      config
    );
    this.steps.push(final);

    const totalDurationMs = Date.now() - startTotal;
    const avgConfidence = this.computeAverageConfidence(this.steps);

    const result: ReasoningResult = {
      answer: final.output,
      steps: this.steps,
      confidence: Math.round(avgConfidence * 100) / 100,
      totalDurationMs,
      suggestions: (final as any)._suggestions || [],
      requiresVerification: avgConfidence < config.confidenceThreshold,
      tokensUsed: this.totalTokensUsed,
    };
    log.info(
      `✅ Pipeline terminé [${mode}] en ${totalDurationMs}ms, ` +
      `confiance: ${(result.confidence * 100).toFixed(0)}%, ` +
      `tokens: ${result.tokensUsed}, vérif: ${result.requiresVerification ? "OUI" : "non"}`
    );

    // ── Étape 7 : Meta-learning post-tâche (fire-and-forget) ─────────────
    // Persistance des leçons apprises après le pipeline (asynchrone, non bloquant).
    if (context.existingContext && context.existingContext.length > 0) {
      log.debug(`[Post-Task Extraction] Analyse potentielle de ${context.existingContext.length} fichiers modifiés.`);
    }
    this.fireAndForgetMetaLearning(context, result).catch((e) =>
      log.warn(`[MetaLearning] Erreur post-pipeline ignorée: ${(e as Error).message}`)
    );

    return result;
  }


  /**
   * Exécution synchrone rapide sans LLM (pour les cas simples ou hors-ligne).
   */
  runSync(task: string, existingContext: string[] = []): ReasoningResult {
    const context: PipelineContext = {
      mode: "fast",
      task,
      existingContext,
      history: [],
    };
    // Convertir async → sync via attente "à la main" : mode rapide n'utilise pas d'await
    // ici on dérive un résultat heuristique
    return this.runFastSync(context);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Étape 1 — Understanding
  // ══════════════════════════════════════════════════════════════════════════

  private step_understanding(context: PipelineContext, injectedLessons: InjectedLesson[] = []): StepResult {
    const start = Date.now();
    const task = context.task.trim();

    // Classification heuristique du type de tâche
    const type = this.classifyTask(task);
    const scope = this.estimateScope(task, context.existingContext);
    const keywords = this.extractKeywords(task);

    const outputLines: string[] = [];
    outputLines.push(`## Analyse de la tâche`);
    outputLines.push(`- Type: ${type}`);
    outputLines.push(`- Portée: ${scope}`);
    outputLines.push(`- Mots-clés: ${keywords.join(", ") || "(aucun)"}`);
    if (context.existingContext.length > 0) {
      outputLines.push(`- Contexte existant: ${context.existingContext.length} fichier(s)`);
    }
    if (context.history.length > 0) {
      outputLines.push(`- Actions déjà effectuées: ${context.history.length}`);
    }

    // Objectifs dérivés
    const goals = this.deriveGoals(task, type);
    if (goals.length > 0) {
      outputLines.push(`- Objectifs:`);
      for (const g of goals) outputLines.push(`  - ${g}`);
    }

    // Contraintes potentielles
    const constraints = this.detectConstraints(task);
    if (constraints.length > 0) {
      outputLines.push(`- Contraintes:`);
      for (const c of constraints) outputLines.push(`  - ${c}`);
    }

    // ── Leçons passées injectées ─────────────────────────────────────────
    if (injectedLessons.length > 0) {
      outputLines.push(`\n## Leçons passées pertinentes (mémoire long terme)`);
      for (const lesson of injectedLessons.slice(0, 5)) {
        const icon = lesson.type === "error_pattern" ? "⚠️"
          : lesson.type === "optimization" ? "⚡"
          : lesson.type === "decision" ? "🎯" : "✅";
        outputLines.push(`${icon} [${lesson.type}] ${lesson.description.slice(0, 140)}`);
        outputLines.push(`   → ${lesson.recommendation.slice(0, 120)}`);
      }
    }

    const output = outputLines.join("\n");
    // Boost de confiance si des leçons pertinentes ont été trouvées (on sait où regarder)
    const lessonBonus = Math.min(0.1, injectedLessons.length * 0.025);
    const confidence = Math.min(0.95,
      (keywords.length >= 2 ? 0.85 : keywords.length === 1 ? 0.65 : 0.4) + lessonBonus
    );

    return {
      step: "understanding",
      input: task,
      output,
      durationMs: Date.now() - start,
      confidence,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Étape 2 — Search
  // ══════════════════════════════════════════════════════════════════════════

  private async step_search(
    context: PipelineContext,
    subQueries: string[],
    config: ModeConfig
  ): Promise<StepResult & { _files: RelevantFile[] }> {
    const start = Date.now();
    const queries = subQueries.length > 0 ? subQueries : [context.task];

    const allFiles = new Map<string, RelevantFile>();
    const reasonsByFile = new Map<string, string[]>();

    for (const q of queries) {
      const results = semanticSearch.searchAll(q);
      const limited = results.slice(0, Math.ceil(config.maxSearchResults / queries.length));
      for (const file of limited) {
        const existing = allFiles.get(file.filePath);
        if (existing) {
          existing.relevance = Math.max(existing.relevance, file.relevance);
          // Fusionner sections
          for (const s of file.relevantSections) {
            const dup = existing.relevantSections.find(
              (x) => x.lineStart === s.lineStart && x.lineEnd === s.lineEnd
            );
            if (!dup) existing.relevantSections.push(s);
          }
        } else {
          allFiles.set(file.filePath, { ...file, relevantSections: [...file.relevantSections] });
        }
        if (file.reason) {
          const arr = reasonsByFile.get(file.filePath) || [];
          arr.push(`[${q}] ${file.reason}`);
          reasonsByFile.set(file.filePath, arr);
        }
      }
    }

    // Intégrer les fichiers déjà connus en contexte
    for (const knownPath of context.existingContext) {
      if (!allFiles.has(knownPath)) {
        allFiles.set(knownPath, {
          filePath: knownPath,
          relevance: 0.5,
          reason: "[existingContext] Fichier déjà lu",
          relevantSections: [],
        });
      }
    }

    const files = Array.from(allFiles.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, config.maxSearchResults);

    const outputLines: string[] = [];
    outputLines.push(`## Recherche sémantique`);
    outputLines.push(`- Requêtes exécutées: ${queries.length}`);
    outputLines.push(`- Fichiers pertinents: ${files.length}`);
    for (const f of files.slice(0, 8)) {
      outputLines.push(
        `  - ${((f.relevance * 100).toFixed(0)).padStart(3)}% ${f.filePath}` +
        (f.relevantSections.length > 0 ? ` (${f.relevantSections.length} sections)` : "")
      );
    }
    if (files.length > 8) outputLines.push(`  - ... et ${files.length - 8} autres`);

    const topRelevance = files[0]?.relevance ?? 0;
    const confidence = Math.min(0.4 + topRelevance * 0.5 + files.length * 0.02, 0.95);

    const step: StepResult & { _files: RelevantFile[] } = {
      step: "search",
      input: queries.join(" | "),
      output: outputLines.join("\n"),
      durationMs: Date.now() - start,
      confidence,
      _files: files,
    };

    return step;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Étape 3 — Context
  // ══════════════════════════════════════════════════════════════════════════

  private async step_context(
    context: PipelineContext,
    subQueries: string[],
    config: ModeConfig
  ): Promise<StepResult & { _batch: ContextBatch }> {
    const start = Date.now();

    // Générer le ContextBatch via SemanticSearch pour la requête principale
    const primaryQuery = subQueries[0] || context.task;
    const batch = semanticSearch.generateContextBatch(primaryQuery);

    // Limiter selon le mode
    batch.files = batch.files.slice(0, config.maxSearchResults);
    batch.facts = batch.facts.slice(0, config.maxFacts);

    // Si sub-queries, compléter les faits
    if (subQueries.length > 1) {
      const seenFactIds = new Set(batch.facts.map((f) => f.id));
      for (let i = 1; i < subQueries.length; i++) {
        const extraFacts = projectMemory.searchFacts(subQueries[i], Math.ceil(config.maxFacts / subQueries.length));
        for (const ef of extraFacts) {
          if (!seenFactIds.has(ef.id)) {
            batch.facts.push(ef);
            seenFactIds.add(ef.id);
          }
        }
      }
      batch.facts = batch.facts.slice(0, config.maxFacts);
    }

    // Ajouter les fichiers du contexte existant si pas déjà présents
    for (const knownPath of context.existingContext) {
      if (!batch.files.find((f) => f.filePath === knownPath)) {
        batch.files.unshift({
          filePath: knownPath,
          relevance: 0.6,
          reason: "[existingContext] Contexte déjà fourni",
          relevantSections: [],
        });
      }
    }

    // Ré-estimer la qualité avec les nouveaux éléments
    batch.quality = semanticSearch.estimateQuality(batch.files, batch.facts);

    const outputLines: string[] = [];
    outputLines.push(`## Contexte construit`);
    outputLines.push(`- Fichiers: ${batch.files.length}`);
    outputLines.push(`- Faits mémoire: ${batch.facts.length}`);
    outputLines.push(
      `- Qualité: ${batch.quality.sufficient ? "SUFFISANTE" : "INSUFFISANTE"} ` +
      `(score moyen: ${(batch.quality.averageConfidence * 100).toFixed(0)}%)`
    );
    if (batch.primaryFile) outputLines.push(`- Fichier principal: ${batch.primaryFile}`);

    if (batch.facts.length > 0) {
      outputLines.push(`- Faits clés:`);
      for (const fact of batch.facts.slice(0, 5)) {
        outputLines.push(`  - [${fact.category}] ${fact.content.slice(0, 100)}${fact.content.length > 100 ? "..." : ""}`);
      }
    }

    const confidence = Math.min(
      (batch.quality.sufficient ? 0.7 : 0.4) + batch.quality.averageConfidence * 0.3,
      0.95
    );

    const step: StepResult & { _batch: ContextBatch } = {
      step: "context",
      input: primaryQuery,
      output: outputLines.join("\n"),
      durationMs: Date.now() - start,
      confidence,
      _batch: batch,
    };

    return step;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Étape 4 — Reasoning
  // ══════════════════════════════════════════════════════════════════════════

  private step_reasoning(
    context: PipelineContext,
    batch: ContextBatch | undefined,
    _understandingOutput: string,
    critiqueFeedback?: string,
    iteration: number = 1
  ): StepResult {
    const start = Date.now();

    const outputLines: string[] = [];
    outputLines.push(`## Raisonnement (itération ${iteration})`);

    if (critiqueFeedback) {
      outputLines.push(`### Feedback d'auto-critique pris en compte:`);
      outputLines.push(critiqueFeedback.split("\n").slice(0, 3).map((l) => `  ${l}`).join("\n"));
      outputLines.push("");
    }

    // Analyse des gaps
    const gaps: string[] = [];
    if (!batch || batch.files.length === 0) {
      gaps.push("Aucun fichier pertinent trouvé");
    }
    if (batch && !batch.quality.sufficient) {
      gaps.push("Qualité du contexte estimée insuffisante");
    }
    for (const histLine of context.history.slice(-3)) {
      if (/échec|error|fail|impossible|problème/i.test(histLine)) {
        gaps.push(`Tentative précédente en échec: ${histLine.slice(0, 80)}`);
      }
    }

    // Inférence de stratégie
    const strategy = this.deriveStrategy(context.task, batch, gaps, context.mode);
    outputLines.push(`### Stratégie proposée:`);
    for (const s of strategy) outputLines.push(`  - ${s}`);

    // Fichiers prioritaires
    if (batch && batch.files.length > 0) {
      outputLines.push("");
      outputLines.push(`### Fichiers prioritaires (à lire/modifier):`);
      for (const f of batch.files.slice(0, 6)) {
        outputLines.push(`  - ${f.filePath} [${(f.relevance * 100).toFixed(0)}%] — ${f.reason}`);
      }
    }

    // Gaps à combler
    if (gaps.length > 0) {
      outputLines.push("");
      outputLines.push(`### Gaps / limitations identifiés:`);
      for (const g of gaps) outputLines.push(`  - ⚠️ ${g}`);
    }

    // Réponse constructive
    outputLines.push("");
    outputLines.push(`### Recommandation:`);
    const recommendation = this.buildRecommendation(
      context.task,
      batch,
      gaps,
      context.existingContext,
      context.mode
    );
    for (const line of recommendation) outputLines.push(`  ${line}`);

    const output = outputLines.join("\n");
    const confidence = this.estimateReasoningConfidence(batch, gaps, iteration);

    return {
      step: "reasoning",
      input: context.task,
      output,
      durationMs: Date.now() - start,
      confidence,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Étape 5 — Self-Critique
  // ══════════════════════════════════════════════════════════════════════════

  private async step_selfCritique(
    reasoningOutput: string,
    batch: ContextBatch | undefined,
    context: PipelineContext,
    pass: number,
    config: ModeConfig
  ): Promise<StepResult & { _severity: number }> {
    const start = Date.now();

    let critiqueText = "";
    let severity = 0;
    let confidence = 0.5;

    // 0. Charger les erreurs connues depuis LearningEngine (best-effort)
    let knownErrors: string[] = [];
    try {
      const le = await getLearningEngine();
      if (le) {
        const relevant = le.getRelevantLessons(context.task, 4);
        knownErrors = relevant.lessons
          .filter((l) => l.type === "error_pattern")
          .map((l) => l.description.slice(0, 160));
      }
    } catch { /* non-bloquant */ }

    // 1. Critique heuristique (toujours exécutée, enrichie avec les erreurs connues)
    const heuristic = this.heuristicCritique(reasoningOutput, batch, context, knownErrors);
    critiqueText = heuristic.text;
    severity = heuristic.severity;

    // 2. Critique LLM (mode deep + autorisé) — best effort, fallback silencieux
    if (config.useLLMForCritique && pass <= 1) {
      try {
        const llmCritique = await this.llmCritique(
          context.task,
          reasoningOutput,
          batch,
          context.existingContext,
          knownErrors
        );
        critiqueText = llmCritique.text || critiqueText;
        severity = Math.max(severity, llmCritique.severity);
        this.totalTokensUsed += llmCritique.tokens;
        confidence = 0.85;
        log.debug(`[SelfCritique] LLM critique utilisée (sévérité ${severity})`);
      } catch (err) {
        log.warn(`[SelfCritique] LLM indisponible, fallback heuristique: ${(err as Error).message}`);
      }
    } else {
      confidence = 0.6 + (1 - severity / 100) * 0.3;
    }

    return {
      step: "self_critique",
      input: `pass=${pass}`,
      output: critiqueText,
      durationMs: Date.now() - start,
      confidence,
      _severity: severity,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Étape 6 — Final
  // ══════════════════════════════════════════════════════════════════════════

  private step_final(
    context: PipelineContext,
    batch: ContextBatch | undefined,
    reasoningOutput: string,
    steps: StepResult[],
    config: ModeConfig
  ): StepResult & { _suggestions: string[] } {
    const start = Date.now();

    const suggestions = this.buildSuggestions(context, batch, steps, config);
    const summary = this.buildFinalAnswer(context, batch, reasoningOutput, steps, suggestions);

    // Estimer les tokens approximatifs (1 token ~ 4 chars)
    const approxTokens = Math.round(
      steps.reduce((sum, s) => sum + (s.input.length + s.output.length), 0) / 4
    );
    this.totalTokensUsed = Math.max(this.totalTokensUsed, approxTokens);

    return {
      step: "final",
      input: context.task,
      output: summary,
      durationMs: Date.now() - start,
      confidence: this.computeAverageConfidence(steps),
      _suggestions: suggestions,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers — Classification & extraction
  // ══════════════════════════════════════════════════════════════════════════

  private classifyTask(task: string): string {
    const t = task.toLowerCase();
    if (/comment|explique|explain|définition|qu'est|what is|how|comment faire/i.test(t)) return "explicatif";
    if (/bug|erreur|error|problème|issue|défaillance|broken|panne|fail/i.test(t)) return "debug";
    if (/refactor|réusiner|nettoyer|clean|optimiser|optimize|améliorer|improve/i.test(t)) return "refactoring";
    if (/créer|create|nouveau|new|implément|implement|ajouter|add|feature|fonctionnalit/i.test(t)) return "implémentation";
    if (/vérifier|verify|test|tester|valider|validate/i.test(t)) return "vérification";
    if (/supprimer|remove|delete|effacer/i.test(t)) return "suppression";
    return "analyse";
  }

  private estimateScope(task: string, existingContext: string[]): string {
    const tokens = task.split(/[\s\/\\_.-]+/).filter((w) => w.length > 2);
    const rough = tokens.length + existingContext.length * 2;
    if (rough <= 5) return "petite";
    if (rough <= 15) return "moyenne";
    return "large";
  }

  private extractKeywords(task: string): string[] {
    const stop = new Set([
      "le", "la", "les", "de", "du", "des", "un", "une", "et", "ou", "mais", "donc",
      "dans", "sur", "avec", "pour", "par", "est", "sont", "ce", "cet", "cette",
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
      "with", "by", "from", "as", "is", "was", "are", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
      "can", "need", "this", "that", "these", "those", "it", "its", "they", "them",
      "not", "no", "oui", "non", "je", "tu", "il", "nous", "vous", "ils", "me", "te",
      "lui", "leur", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
      "comment", "faire", "plus", "moins", "tres", "très", "bien", "mal",
    ]);
    const words = task
      .replace(/[^a-z0-9_äöüéèêëàâùûôîïç]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stop.has(w.toLowerCase()));
    // Dédupliquer tout en gardant l'ordre
    const seen = new Set<string>();
    const result: string[] = [];
    for (const w of words) {
      const key = w.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(w);
      }
    }
    return result.slice(0, 10);
  }

  private extractSubQueries(_understandingOutput: string, task: string, enable: boolean): string[] {
    if (!enable) return [];
    const base = this.extractKeywords(task);
    if (base.length <= 2) return [];
    // 2 à 3 sous-requêtes dérivées
    const queries: string[] = [];
    if (base.length >= 2) queries.push(base.slice(0, 2).join(" "));
    if (base.length >= 4) queries.push(base.slice(2, 4).join(" "));
    if (base.length >= 3) queries.push(base.slice(Math.floor(base.length / 2)).join(" "));
    return queries.slice(0, 3);
  }

  private deriveGoals(task: string, type: string): string[] {
    const goals: string[] = [];
    const t = task.toLowerCase();
    switch (type) {
      case "implémentation":
        goals.push("Identifier les fichiers et modules à modifier");
        goals.push("Déterminer l'interface / signature à respecter");
        goals.push("Planifier l'ordre des modifications");
        break;
      case "debug":
        goals.push("Localiser la source du problème");
        goals.push("Identifier les causes racines potentielles");
        goals.push("Proposer des correctifs et tests de régression");
        break;
      case "refactoring":
        goals.push("Cartographier les dépendances impactées");
        goals.push("Évaluer le risque de régression");
        goals.push("Définir les étapes de modification sans cassure");
        break;
      case "explicatif":
        goals.push("Rassembler les fichiers pertinents");
        goals.push("Synthétiser le flux d'exécution");
        goals.push("Formuler une explication structurée");
        break;
      case "vérification":
        goals.push("Lister les points à contrôler");
        goals.push("Identifier les tests à exécuter");
        goals.push("Estimer le périmètre de validation");
        break;
      default:
        goals.push("Comprendre le périmètre de la demande");
        goals.push("Identifier les acteurs et fichiers concernés");
    }
    if (/sécurit|security|faille|vulnéra/i.test(t)) {
      goals.push("Vérifier les implications de sécurité");
    }
    return goals;
  }

  private detectConstraints(task: string): string[] {
    const constraints: string[] = [];
    const t = task.toLowerCase();
    if (/urgent|rapid|quick|asap|dès que possible|tout de suite/i.test(t)) constraints.push("Contrainte: exécution rapide préférée");
    if (/sans.*casser|sans.*break|compatib|backward|rétrocompat/i.test(t)) constraints.push("Contrainte: pas de cassure de compatibilité");
    if (/test|tester|vérifier/i.test(t)) constraints.push("Contrainte: tests/validation requis");
    if (/performan|rapid|vite|lent|speed|optim/i.test(t)) constraints.push("Contrainte: performance visée");
    if (/\bts\b|typescript|typag|type/i.test(t)) constraints.push("Contrainte: typage TypeScript strict");
    return constraints;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers — Reasoning
  // ══════════════════════════════════════════════════════════════════════════

  private deriveStrategy(
    task: string,
    batch: ContextBatch | undefined,
    gaps: string[],
    mode: PipelineContext["mode"]
  ): string[] {
    const strat: string[] = [];
    if (gaps.length > 0) {
      strat.push(`Combler ${gaps.length} gap(s) identifié(s) avant de décider`);
    }
    if (!batch || batch.files.length === 0) {
      strat.push("Lancer une recherche élargie dans le codebase");
    } else {
      strat.push(`Utiliser les ${batch.files.length} fichier(s) pertinent(s) comme base`);
    }
    if (batch && batch.facts.length > 0) {
      strat.push("Appliquer les conventions et décisions connues de la mémoire projet");
    }
    const type = this.classifyTask(task);
    switch (type) {
      case "debug":
        strat.push("Procéder par élimination: reproduire → localiser → corriger → vérifier");
        break;
      case "refactoring":
        strat.push("Modifier par encapsulation: préserver l'interface publique → migrer l'intérieur → retirer l'ancien");
        break;
      case "implémentation":
        strat.push("S'inspirer des patterns existants dans les fichiers voisins");
        break;
      case "vérification":
        strat.push("Vérifier statiques (compilation/lint) → tests unitaires → tests manuels");
        break;
      default:
        strat.push("Validation incrémentale après chaque étape");
    }
    if (mode === "deep") strat.push("Mode deep: double vérification et suggestions exhaustives");
    if (mode === "fast") strat.push("Mode fast: aller à l'essentiel, vérifications minimales");
    return strat;
  }

  private buildRecommendation(
    task: string,
    batch: ContextBatch | undefined,
    gaps: string[],
    existingContext: string[],
    mode: PipelineContext["mode"]
  ): string[] {
    const recs: string[] = [];
    const files = batch?.files || [];

    // Fichiers à lire en priorité
    const needRead = files.filter((f) => !existingContext.includes(f.filePath)).slice(0, 3);
    if (needRead.length > 0) {
      recs.push(`1. LIRE d'abord : ${needRead.map((f) => f.filePath).join(", ")}`);
    } else if (files.length > 0) {
      recs.push(`1. Base disponible dans les ${files.length} fichiers déjà connus`);
    } else {
      recs.push(`1. Aucun fichier trouvé — recherche élargie recommandée`);
    }

    // Mémoire projet
    if (batch && batch.facts.length > 0) {
      recs.push(`2. Consulter les ${batch.facts.length} fait(s) mémoire pertinents pour respecter les conventions`);
    } else {
      recs.push(`2. Aucun fait mémoire pertinent — attention aux conventions inconnues`);
    }

    // Gaps
    if (gaps.length > 0) {
      recs.push(`3. ⚠️ Gaps à combler : ${gaps.join(" ; ")}`);
    } else {
      recs.push(`3. Aucun gap critique détecté — peut passer à l'action`);
    }

    // Action finale
    const type = this.classifyTask(task);
    switch (type) {
      case "implémentation":
        recs.push(`4. IMPLÉMENTATION: suivre les patterns du projet, puis vérifier la compilation`);
        break;
      case "debug":
        recs.push(`4. DEBUG: émettre une hypothèse, tester, itérer jusqu'à résolution`);
        break;
      case "refactoring":
        recs.push(`4. REFACTOR: conserver les tests verts à chaque micro-commit logique`);
        break;
      case "vérification":
        recs.push(`4. VÉRIFICATION: lancer la compilation, puis les tests ciblés`);
        break;
      default:
        recs.push(`4. Procéder par étapes incrémentales avec validation`);
    }

    if (mode === "deep") {
      recs.push(`5. Mode DEEP: envisager les effets de bord (dépendances, mémoire, sécurité, perf)`);
    }

    return recs;
  }

  private estimateReasoningConfidence(
    batch: ContextBatch | undefined,
    gaps: string[],
    iteration: number
  ): number {
    let conf = 0.5;
    if (batch) {
      conf += batch.quality.averageConfidence * 0.3;
      if (batch.files.length > 0) conf += 0.1;
      if (batch.facts.length > 0) conf += 0.05;
      if (batch.quality.sufficient) conf += 0.05;
    }
    conf -= gaps.length * 0.1;
    if (iteration > 1) conf += 0.05; // Amélioration attendue par itération
    return Math.max(0.1, Math.min(0.95, conf));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers — Self-Critique
  // ══════════════════════════════════════════════════════════════════════════

  private heuristicCritique(
    reasoningOutput: string,
    batch: ContextBatch | undefined,
    context: PipelineContext,
    knownErrors: string[] = []
  ): { text: string; severity: number } {
    const problems: { level: "low" | "med" | "high"; msg: string }[] = [];

    // 1. Contexte insuffisant
    if (!batch || batch.files.length === 0) {
      problems.push({ level: "high", msg: "Aucun fichier pertinent — recommandation potentiellement non fondée" });
    } else if (!batch.quality.sufficient) {
      problems.push({ level: "med", msg: `Qualité de contexte insuffisante (${(batch.quality.averageConfidence * 100).toFixed(0)}%)` });
    }

    // 2. Fichiers existants ignorés (non mentionnés dans le raisonnement)
    if (batch) {
      const unmentioned = batch.files.filter((f) => !reasoningOutput.includes(f.filePath));
      if (unmentioned.length > batch.files.length / 2 && batch.files.length >= 3) {
        problems.push({
          level: "med",
          msg: `${unmentioned.length}/${batch.files.length} fichiers non exploités dans le raisonnement`,
        });
      }
    }

    // 3. Gaps critiques dans l'historique
    const recentErrors = context.history.filter((h) => /échec|error|fail|problème|broken|indisponible/i.test(h)).length;
    if (recentErrors > 0) {
      problems.push({
        level: recentErrors >= 2 ? "high" : "med",
        msg: `${recentErrors} tentative(s) précédente(s) en échec — nouveau plan recommandé`,
      });
    }

    // 4. Tâche ambiguë
    const kw = this.extractKeywords(context.task);
    if (kw.length === 0) {
      problems.push({ level: "low", msg: "Mots-clés insuffisants pour une recherche ciblée" });
    }

    // 5. Longueur du raisonnement trop faible
    if (reasoningOutput.length < context.task.length * 2) {
      problems.push({ level: "low", msg: "Raisonnement très concis — potentiellement incomplet" });
    }

    // 6. Erreurs connues (mémoire long terme) pertinentes à la tâche actuelle
    if (knownErrors.length > 0) {
      for (const errDesc of knownErrors.slice(0, 3)) {
        problems.push({
          level: "med",
          msg: `Erreur déjà rencontrée (mémoire projet) : ${errDesc.slice(0, 120)}`,
        });
      }
    }

    const severity = problems.reduce((sum, p) => {
      if (p.level === "high") return sum + 35;
      if (p.level === "med") return sum + 18;
      return sum + 8;
    }, 0);

    const lines: string[] = [];
    lines.push(`## Auto-Critique heuristique`);
    lines.push(`- Sévérité estimée: ${severity}/100`);
    if (problems.length === 0) {
      lines.push(`- Aucun problème détecté`);
    } else {
      lines.push(`- Problèmes (${problems.length}):`);
      for (const p of problems) {
        const icon = p.level === "high" ? "🔴" : p.level === "med" ? "🟡" : "🔵";
        lines.push(`  ${icon} [${p.level}] ${p.msg}`);
      }
    }
    lines.push(`- Améliorations possibles:`);
    if (severity >= 40) lines.push(`  → Approfondir la recherche sémantique`);
    if (severity >= 25) lines.push(`  → Relire les fichiers prioritaires avant d'agir`);
    if (knownErrors.length > 0) lines.push(`  → Consulter la mémoire projet pour éviter les erreurs connues`);
    lines.push(`  → Vérifier systématiquement après modification`);

    return { text: lines.join("\n"), severity: Math.min(100, severity) };
  }

  private async llmCritique(
    task: string,
    reasoningOutput: string,
    batch: ContextBatch | undefined,
    existingContext: string[],
    knownErrors: string[] = []
  ): Promise<{ text: string; severity: number; tokens: number }> {
    const filesSummary = batch
      ? batch.files.map((f) => `- ${f.filePath} (${(f.relevance * 100).toFixed(0)}%)`).join("\n")
      : "(aucun)";
    const factsSummary = batch
      ? batch.facts.map((f) => `- [${f.category}] ${f.content.slice(0, 100)}`).slice(0, 5).join("\n")
      : "(aucun)";
    const knownErrSummary = knownErrors.length > 0
      ? knownErrors.map((e) => `- ⚠️ ${e}`).join("\n")
      : "(aucune)";

    const prompt = [
      `## Rôle`,
      `Tu es un expert critique sans concession chargé d'évaluer un raisonnement technique produit par un agent IA.`,
      ``,
      `## Tâche initiale`,
      task,
      ``,
      `## Raisonnement produit par l'agent`,
      reasoningOutput,
      ``,
      `## Contexte disponible`,
      `### Fichiers pertinents`,
      filesSummary,
      `### Faits mémoire`,
      factsSummary,
      `### Fichiers déjà lus`,
      existingContext.length > 0 ? existingContext.join(", ") : "(aucun)",
      ``,
      `## Erreurs déjà rencontrées sur des tâches similaires (mémoire projet)`,
      knownErrSummary,
      ``,
      `## Consignes`,
      `Réponds STRICTEMENT au format Markdown suivant (ne pas sortir du format) :`,
      `### Sévérité : [0-100]`,
      `### Problèmes :`,
      `- [🔴/🟡/🔵] Description du problème`,
      `### Corrections recommandées :`,
      `- Action corrective`,
      `### Verdict : [CONFIANCE / REVOIR / REJETER]`,
    ].join("\n");

    const systemPrompt =
      "Tu es un auditeur exigeant et bienveillant. Tu détectes les angles morts, " +
      "les suppositions non fondées, les raccourcis abusifs et les risques sous-estimés. " +
      "Tiens compte des erreurs passées connues pour éviter de répéter les mêmes erreurs. " +
      "Sois concret, factuel, et respecte le format demandé.";

    let result;
    try {
      result = await generateText({
        prompt,
        systemPrompt,
        temperature: 0.3,
        maxTokens: 1024,
      });
    } catch (e) {
      return { text: "", severity: 0, tokens: 0 };
    }

    const text = result.text || "";
    // Extraire la sévérité depuis le texte
    const sevMatch = /S.v.rit.*\s*[:#]\s*(\d{1,3})/i.exec(text);
    const severity = sevMatch ? Math.min(100, Math.max(0, parseInt(sevMatch[1], 10))) : 30;
    const tokens = Math.round((prompt.length + text.length) / 4);

    return { text, severity, tokens };
  }

  private shouldReviseAfterCritique(
    critique: StepResult & { _severity?: number },
    reasoningConfidence: number,
    threshold: number,
    pass: number,
    maxPasses: number
  ): boolean {
    if (pass >= maxPasses) return false;
    const severity = (critique as any)._severity ?? 0;
    // Si sévérité haute ET confiance faible → réviser
    if (severity >= 45 && reasoningConfidence < threshold + 0.15) return true;
    // Si sévérité moyenne et mode deep → réviser
    if (severity >= 25 && maxPasses >= 3 && pass === 1) return true;
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers — Final
  // ══════════════════════════════════════════════════════════════════════════

  private buildSuggestions(
    context: PipelineContext,
    batch: ContextBatch | undefined,
    _steps: StepResult[],
    _config: ModeConfig
  ): string[] {
    const suggestions: string[] = [];

    // Suggestions basées sur les fichiers
    if (batch && batch.files.length > 0) {
      const top = batch.files[0];
      suggestions.push(`Lire en priorité: ${top.filePath}`);
      if (batch.files.length > 1) {
        suggestions.push(`Vérifier aussi: ${batch.files.slice(1, 3).map((f) => f.filePath).join(", ")}`);
      }
    } else {
      suggestions.push("Lancer une recherche élargie avec plus de termes");
    }

    // Suggestions basées sur la mémoire
    if (batch && batch.facts.length === 0) {
      suggestions.push("Enrichir la mémoire projet après résolution pour les prochaines fois");
    }

    // Vérifications obligatoires
    const type = this.classifyTask(context.task);
    if (["implémentation", "refactoring", "suppression", "debug"].includes(type)) {
      suggestions.push("Vérifier la compilation TypeScript après modification");
    }
    if (type === "debug") {
      suggestions.push("Rédiger un test de régression reproduisant le bug");
    }
    if (type === "implémentation") {
      suggestions.push("Vérifier les tests existants + ajouter un test de la nouvelle feature");
    }

    // Vérification si basse qualité
    if (batch && !batch.quality.sufficient) {
      suggestions.push("⚠️ Contexte insuffisant: valider manuellement avant d'exécuter");
    }

    return suggestions.slice(0, 6);
  }

  private buildFinalAnswer(
    context: PipelineContext,
    batch: ContextBatch | undefined,
    reasoningOutput: string,
    steps: StepResult[],
    suggestions: string[]
  ): string {
    const lines: string[] = [];
    lines.push(`# Résultat de l'analyse`);
    lines.push(``);
    lines.push(`## Tâche`);
    lines.push(context.task);
    lines.push(``);

    // Contexte disponible
    lines.push(`## Contexte disponible`);
    lines.push(`- Fichiers pertinents: ${batch?.files.length || 0}`);
    lines.push(`- Faits mémoire: ${batch?.facts.length || 0}`);
    const quality = batch?.quality;
    if (quality) {
      lines.push(
        `- Qualité du contexte: **${quality.sufficient ? "✅ Suffisante" : "⚠️ Insuffisante"}** ` +
        `(score: ${(quality.averageConfidence * 100).toFixed(0)}%)`
      );
    }
    lines.push(``);

    // Synthèse du raisonnement (section "Recommandation")
    const recoMatch = /### Recommandation:([\s\S]*?)(?=###|##|$)/.exec(reasoningOutput);
    const strategyMatch = /### Stratégie proposée:([\s\S]*?)(?=###|##|$)/.exec(reasoningOutput);
    const gapsMatch = /### Gaps.*?:([\s\S]*?)(?=###|##|$)/.exec(reasoningOutput);

    lines.push(`## Stratégie`);
    lines.push(strategyMatch ? strategyMatch[1].trim() : "Voir les étapes détaillées.");
    lines.push(``);

    if (gapsMatch && gapsMatch[1].trim().length > 0) {
      lines.push(`## Points d'attention`);
      lines.push(gapsMatch[1].trim());
      lines.push(``);
    }

    lines.push(`## Recommandation`);
    lines.push(recoMatch ? recoMatch[1].trim() : reasoningOutput.trim());
    lines.push(``);

    if (suggestions.length > 0) {
      lines.push(`## Prochaines actions suggérées`);
      for (let i = 0; i < suggestions.length; i++) {
        lines.push(`${i + 1}. ${suggestions[i]}`);
      }
      lines.push(``);
    }

    // Métadonnées
    const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
    const avgConf = this.computeAverageConfidence(steps);
    lines.push(`## Métadonnées`);
    lines.push(`- Étapes exécutées: ${steps.map((s) => s.step).join(" → ")}`);
    lines.push(`- Durée totale: ${totalMs}ms`);
    lines.push(`- Confiance moyenne: **${(avgConf * 100).toFixed(0)}%**`);

    return lines.join("\n");
  }

  private computeAverageConfidence(steps: StepResult[]): number {
    if (steps.length === 0) return 0;
    // Pondérer par l'importance de l'étape
    const weights: Record<ReasoningStep, number> = {
      understanding: 1,
      search: 1.5,
      context: 1.5,
      reasoning: 2,
      self_critique: 1,
      final: 1,
    };
    let sum = 0;
    let weightSum = 0;
    for (const s of steps) {
      const w = weights[s.step] || 1;
      sum += s.confidence * w;
      weightSum += w;
    }
    return weightSum > 0 ? sum / weightSum : 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Meta-Learning — chargement et persistance des leçons
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Charge les leçons passées pertinentes depuis LearningEngine (best-effort).
   * Retourne une liste triée par importance décroissante.
   */
  private async loadRelevantLessons(task: string): Promise<InjectedLesson[]> {
    try {
      const le = await getLearningEngine();
      if (!le) return [];
      const { lessons } = le.getRelevantLessons(task, 6);
      return lessons
        .filter((l) => l.importance >= 0.3)
        .sort((a, b) => b.importance - a.importance)
        .map((l) => ({
          type: l.type,
          description: l.description,
          recommendation: l.recommendation,
          importance: l.importance,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Après le pipeline, extrait des leçons de succès / pattern depuis la tâche
   * et les persiste via LearningEngine (fire-and-forget, non bloquant).
   */
  private async fireAndForgetMetaLearning(
    context: PipelineContext,
    result: ReasoningResult
  ): Promise<void> {
    try {
      const le = await getLearningEngine();
      if (!le) return;

      // Construire un input minimal pour learnFromAction
      const success = result.confidence >= 0.5 && !result.requiresVerification;
      le.learnFromAction(
        `pipeline:${Date.now()}`,
        {
          actionId: `pipeline:${Date.now()}`,
          actionName: "ReasoningPipeline.run",
          skillName: "reasoning_pipeline",
          success,
          durationMs: result.totalDurationMs,
          errorMessage: success ? undefined : `Confiance insuffisante: ${(result.confidence * 100).toFixed(0)}%`,
          files: context.existingContext.slice(0, 5),
        },
        { relatedFiles: context.existingContext.slice(0, 5) }
      );
      log.debug(`[MetaLearning] Leçon post-pipeline enregistrée (succès=${success}).`);
    } catch (e) {
      // Non-bloquant, on absorbe l'erreur silencieusement
      log.debug(`[MetaLearning] Impossible d'enregistrer la leçon: ${(e as Error).message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Run sync (mode fast)
  // ══════════════════════════════════════════════════════════════════════════

  private runFastSync(context: PipelineContext): ReasoningResult {
    const startTotal = Date.now();
    this.steps = [];

    const start = (): number => Date.now();
    const dur = (t: number) => Date.now() - t;

    void start(); // t0 — understanding step (durée trackée par step_understanding)
    const understanding = this.step_understanding(context);
    this.steps.push(understanding);

    const t1 = start();
    // Recherche simplifiée synchrone (searchAll est synchrone)
    const files = semanticSearch.searchAll(context.task).slice(0, 5);
    this.steps.push({
      step: "search",
      input: context.task,
      output: `Recherche sync rapide: ${files.length} fichier(s)`,
      durationMs: dur(t1),
      confidence: files[0]?.relevance ?? 0.3,
    });

    const t2 = start();
    const facts = projectMemory.searchFacts(context.task, 5);
    const batch: ContextBatch = {
      query: context.task,
      files,
      facts,
      primaryFile: context.existingContext[0],
      quality: semanticSearch.estimateQuality(files, facts),
    };
    this.steps.push({
      step: "context",
      input: context.task,
      output: `Contexte sync: ${files.length} fichiers, ${facts.length} faits`,
      durationMs: dur(t2),
      confidence: batch.quality.sufficient ? 0.7 : 0.4,
    });

    const t3 = start();
    const reasoning = this.step_reasoning(context, batch, understanding.output);
    this.steps.push(reasoning);

    const t4 = start();
    const heuristic = this.heuristicCritique(reasoning.output, batch, context);
    this.steps.push({
      step: "self_critique",
      input: "pass=1",
      output: heuristic.text,
      durationMs: dur(t4),
      confidence: 0.6,
    });

    const suggestions = this.buildSuggestions(context, batch, this.steps, MODE_CONFIGS.fast);
    const finalText = this.buildFinalAnswer(context, batch, reasoning.output, this.steps, suggestions);
    this.steps.push({
      step: "final",
      input: context.task,
      output: finalText,
      durationMs: dur(t3),
      confidence: this.computeAverageConfidence(this.steps),
    });

    const totalDurationMs = Date.now() - startTotal;
    const avgConfidence = this.computeAverageConfidence(this.steps);
    const tokensUsed = Math.round(
      this.steps.reduce((s, x) => s + x.input.length + x.output.length, 0) / 4
    );

    return {
      answer: finalText,
      steps: this.steps,
      confidence: Math.round(avgConfidence * 100) / 100,
      totalDurationMs,
      suggestions,
      requiresVerification: avgConfidence < MODE_CONFIGS.fast.confidenceThreshold,
      tokensUsed,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du ReasoningPipeline */
export const reasoningPipeline = new ReasoningPipeline();
