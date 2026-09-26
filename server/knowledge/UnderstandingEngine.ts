/**
 * UnderstandingEngine — Orchestrateur central de la compréhension
 *
 * Sprint 9 — Objectifs :
 *   • Orchestrer les 4 piliers de connaissance :
 *       KnowledgeGraph (KG) — fichiers + entités + lignes
 *       DependencyGraph (DG) — imports + chaînes d'impact
 *       ProjectMemory  (PM) — faits, décisions, patterns
 *       SemanticSearch (SS) — recherche par mot-clé, génération de contextes
 *   • Calcule un UnderstandingScore global et détaillé
 *   • Identifie les actions manquantes / fichiers non lus / checks à effectuer
 *   • Fournit des recommandations contextuelles intelligentes
 *   • Gère l'apprentissage incrémental (incorpore de nouvelles infos)
 *   • Génère un rapport lisible + prompt à injecter dans systemInstruction
 *
 * Mode d'usage :
 *   const ctx = understandingEngine.buildContext(task, { existingContext });
 *   → UnderstandingScore + ContextBatch + Prompt d'injection
 */

import { createLogger } from "../utils/logger.js";
import { knowledgeGraph } from "./KnowledgeGraph.js";
import { dependencyGraph } from "./DependencyGraph.js";
import { projectMemory } from "./ProjectMemory.js";
import { semanticSearch } from "./SemanticSearch.js";
import type {
  UnderstandingScore,
  ContextBatch,
  ProjectFact,
  RelevantFile,
  KnowledgeStats,
  DependencyCycle,
} from "./types.js";
import type { ImpactMode } from "./ImpactAnalyzer.js";
import { impactAnalyzer } from "./ImpactAnalyzer.js";

const log = createLogger("UnderstandingEngine");

// ═══════════════════════════════════════════════════════════════════════════════
// Types Sprint 9 — UnderstandingEngine
// ═══════════════════════════════════════════════════════════════════════════════

/** Stratégie de construction de contexte */
export type ContextStrategy =
  | "balanced"      // Fichiers + faits + dépendances (défaut)
  | "code_first"    // Priorité aux fichiers et entités
  | "memory_first"  // Priorité aux décisions et patterns
  | "graph_first"   // Priorité aux dépendances et chemins
  | "minimal";      // Contexte ultra-condensé (pour prompts courts)

/** Niveau de détail du contexte */
export type ContextDetailLevel = "compact" | "standard" | "verbose";

/** Diagnostic d'une connaissance manquante */
export interface MissingAction {
  id: string;
  /** Type d'action recommandée */
  kind: "read_file" | "run_search" | "look_up_fact" | "ask_user" | "index_project" | "replay_search" | "inspect_entities";
  /** Cible de l'action (fichier, terme de recherche, …) */
  target: string;
  /** Pourquoi il manque ça */
  rationale: string;
  /** Estimation du gain de compréhension si action faite */
  estimatedGain: number; // 0-100
  /** Priorité */
  priority: "low" | "medium" | "high" | "critical";
  /** Coût estimé : cheap / medium / expensive */
  cost: "cheap" | "medium" | "expensive";
}

/** Rapport de recommandation contextuelle */
export interface ContextualRecommendation {
  id: string;
  /** Catégorie */
  category: "read" | "write" | "validate" | "search" | "structure" | "learn";
  /** Courte description */
  description: string;
  /** Raison détaillée */
  rationale: string;
  /** Effort estimé : 1-5 */
  effort: 1 | 2 | 3 | 4 | 5;
  /** Impact estimé 0-1 */
  impact: number;
  /** Score ROI (impact * (1/effort normalisé)) */
  roi: number;
}

/** État actuel du KnowledgeGraph */
export interface KnowledgeHealth {
  initialized: boolean;
  fileCount: number;
  entityCount: number;
  exportCount: number;
  importCount: number;
  cycleCount: number;
  factCount: number;
  criticalModuleCount: number;
  /** Estimation de la fraîcheur (0 = très vieux, 1 = parfait) */
  freshness: number;
  lastIndexed?: string;
  warnings: string[];
}

/** Résultat d'un buildContext = compréhension complète */
export interface UnderstandingContext {
  /** Requête / tâche source */
  query: string;
  /** Score de compréhension détaillé */
  score: UnderstandingScore;
  /** Contexte structuré prêt à consommer (fichiers + faits) */
  batch: ContextBatch;
  /** Statistiques de santé de la connaissance projet */
  health: KnowledgeHealth;
  /** Actions manquantes triées par gain estimé */
  missingActions: MissingAction[];
  /** Recommandations contextuelles triées par ROI */
  recommendations: ContextualRecommendation[];
  /** Entités pertinentes trouvées par KG */
  relevantEntities: { name: string; type: string; file: string; score: number }[];
  /** Cycles de dépendances à risque si impactés */
  riskyCycles: DependencyCycle[];
  /** Contexte déjà fourni vs trouvé */
  coverage: {
    existing: string[];
    overlapped: string[];
    newlyFound: string[];
  };
  /** Mode d'analyse */
  strategy: ContextStrategy;
  /** Détail */
  detailLevel: ContextDetailLevel;
  /** Résumé textuel 1-ligne */
  oneLineSummary: string;
  /** Injection prête à insérer dans un prompt système */
  systemPromptInject: string;
  /** Rapport Markdown */
  markdownReport: string;
  /** Durée de calcul ms */
  computationMs: number;
  /** Généré à */
  generatedAt: string;
}

/** Options pour buildContext */
export interface BuildContextOptions {
  strategy?: ContextStrategy;
  detail?: ContextDetailLevel;
  /** Chemins de fichiers déjà lus / connus */
  existingContext?: string[];
  /** Maximum de fichiers à retourner */
  maxFiles?: number;
  /** Maximum de faits ProjectMemory à retourner */
  maxFacts?: number;
  /** Inclure le risque ImpactAnalyzer ? */
  includeRisk?: boolean;
  /** Mode ImpactAnalyzer si includeRisk=true */
  riskMode?: ImpactMode;
  /** Nombre minimal de tokens disponibles dans le prompt (influence la taille du contexte) */
  maxTokenBudget?: number;
  /** Historique des précédentes actions (pour apprentissage incrémental) */
  history?: string[];
  /** Identifiant de mission (pour apprentissage) */
  missionId?: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: Required<Omit<BuildContextOptions, "missionId" | "history">> & {
  missionId?: string;
  history?: string[];
} = {
  strategy: "balanced",
  detail: "standard",
  existingContext: [],
  maxFiles: 6,
  maxFacts: 7,
  includeRisk: true,
  riskMode: "standard",
  maxTokenBudget: 8000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// UnderstandingEngine
// ═══════════════════════════════════════════════════════════════════════════════

export class UnderstandingEngine {
  private usageCache: { query: string; timestamp: number; context: UnderstandingContext }[] = [];
  private static readonly CACHE_MAX = 20;
  private static readonly CACHE_TTL_MS = 30_000;

  // ──────────────────────────────────────────────────────────────────────
  // Adaptive Context Sizing
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Ajuste dynamiquement maxFiles et maxFacts en fonction de la complexité
   * estimée de la requête. Analyse :
   *   - Nombre de fichiers potentiellement impactés (via recherche rapide)
   *   - Profondeur des dépendances
   *   - Nombre de concepts/termes dans la query
   *   - Stratégie demandée
   *
   * Retourne les limites ajustées.
   */
  private adaptContextSize(query: string, opts: typeof DEFAULTS): { maxFiles: number; maxFacts: number } {
    let maxFiles = opts.maxFiles;
    let maxFacts = opts.maxFacts;

    // 1. Complexité lexicale : plus de mots significatifs = besoin de plus de contexte
    const significantWords = query.toLowerCase()
      .split(/[^a-zà-ÿ0-9]+/)
      .filter(w => w.length > 3);
    const lexicalComplexity = Math.min(significantWords.length, 10);

    // 2. Estimation des fichiers impactés via une recherche rapide
    let estimatedReach = 0;
    try {
      const quickSearch = semanticSearch.searchAll(query);
      estimatedReach = quickSearch.filter(f => f.relevance > 0.15).length;
    } catch {
      estimatedReach = 5; // Fallback
    }

    // 3. Ajustement selon la complexité
    if (lexicalComplexity >= 5 || estimatedReach >= 10) {
      // Requête complexe / multi-module
      maxFiles = Math.min(opts.maxFiles * 2, 20);
      maxFacts = Math.min(opts.maxFacts * 2, 15);
    } else if (lexicalComplexity <= 2 && estimatedReach <= 3) {
      // Requête simple / fichier unique
      maxFiles = Math.max(3, Math.floor(opts.maxFiles * 0.6));
      maxFacts = Math.max(3, Math.floor(opts.maxFacts * 0.6));
    }

    // 4. Ajustement selon la stratégie
    switch (opts.strategy) {
      case "code_first":
        maxFiles = Math.min(maxFiles + 3, 25);
        maxFacts = Math.max(3, maxFacts - 2);
        break;
      case "memory_first":
        maxFacts = Math.min(maxFacts + 5, 20);
        maxFiles = Math.max(3, maxFiles - 2);
        break;
      case "minimal":
        maxFiles = Math.min(maxFiles, 4);
        maxFacts = Math.min(maxFacts, 4);
        break;
      case "graph_first":
        maxFiles = Math.min(maxFiles + 2, 20);
        break;
    }

    // 5. Ajustement selon le detail level
    if (opts.detail === "verbose") {
      maxFiles = Math.min(maxFiles + 2, 25);
      maxFacts = Math.min(maxFacts + 2, 20);
    } else if (opts.detail === "compact") {
      maxFiles = Math.min(maxFiles, 5);
      maxFacts = Math.min(maxFacts, 5);
    }

    return { maxFiles, maxFacts };
  }

  // ──────────────────────────────────────────────────────────────────────
  // API principale
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Construit une compréhension complète pour une requête donnée.
   */
  buildContext(query: string, options: BuildContextOptions = {}): UnderstandingContext {
    const t0 = Date.now();
    const opts = { ...DEFAULTS, ...options };
    const q = query.trim();
    if (q.length === 0) return this.emptyContext(q, opts, Date.now() - t0);

    // 0a. Adaptive context sizing — ajuster les limites selon la complexité
    if (!options.maxFiles && !options.maxFacts) {
      const adapted = this.adaptContextSize(q, opts);
      opts.maxFiles = adapted.maxFiles;
      opts.maxFacts = adapted.maxFacts;
    }

    // 0. Cache rapide (même query dans la TTL)
    const fromCache = this.cacheGet(q, opts);
    if (fromCache) return fromCache;

    // 1. État de santé de la base de connaissance
    const health = this.scanKnowledgeHealth();

    // 2. Recherche sémantique → ContextBatch de base (fichiers + faits)
    const baseBatch = semanticSearch.generateContextBatch(q);
    void baseBatch.quality; // évite unused

    // 3. Orchestration selon la stratégie
    const batch = this.applyStrategy(q, baseBatch, opts);

    // 4. Ajout info graphe (cycles critiques, couplage)
    const riskyCycles = this.findRiskyCycles(batch.files);

    // 5. Entités pertinentes via KnowledgeGraph
    const entities = this.searchRelevantEntities(q, batch.files, 10);

    // 6. Score de compréhension UnderstandingScore
    const score = this.computeUnderstandingScore(q, batch, health, opts);

    // 7. Actions manquantes
    const missingActions = this.computeMissingActions(q, score, batch, health, opts);

    // 8. Recommandations contextuelles
    const recommendations = this.computeRecommendations(score, missingActions, batch, opts);

    // 9. Coverage (existant vs nouveau)
    const coverage = this.computeCoverage(batch, opts.existingContext);

    // 10. Risk ImpactAnalyzer (si activé)
    if (opts.includeRisk && batch.files.length > 0) {
      try {
        const topFiles = batch.files.slice(0, 8).map((f) => f.filePath);
        const report = impactAnalyzer.analyze(topFiles, { mode: opts.riskMode });
        // Injecter risque dans les checks recommandés s'il est sévère
        if (report.overallRisk === "critical" || report.overallRisk === "high") {
          const mapped: UnderstandingScore["risk"] = report.overallRisk === "critical" ? "high" : report.overallRisk;
          score.risk = score.risk === "low" ? mapped : (score.risk === "medium" && report.overallRisk === "critical" ? "high" : score.risk);
          score.recommendedChecks.push(
            `⚠️ Risque ${report.overallRisk} détecté par ImpactAnalyzer sur ${topFiles.length} fichiers — lancer: ${report.validationOrder.slice(0, 2).map((s) => s.label).join(" → ")}`
          );
        }
      } catch (e) {
        log.debug(`[UnderstandingEngine] ImpactAnalyzer indisponible: ${(e as Error).message}`);
      }
    }

    // 11-bis. Enrichissement automatique de la mémoire projet (Optimisation Leanna #4)
    // Capture systématiquement architecture, conventions et patterns saillants
    this.autoEnrichProjectMemory(q, baseBatch, health, opts.missionId);

    // 11. Apprentissage incrémental minimal : noter la requête dans l'usage
    this.trackUsage(q);

    // 12. Prompts et rapports
    const oneLineSummary = this.buildOneLineSummary(score, batch, coverage);
    const systemPromptInject = this.buildSystemPromptInject(score, batch, recommendations, opts);
    const draft: Omit<UnderstandingContext, "markdownReport"> = {
      query: q,
      score,
      batch,
      health,
      missingActions,
      recommendations,
      relevantEntities: entities,
      riskyCycles,
      coverage,
      strategy: opts.strategy,
      detailLevel: opts.detail,
      oneLineSummary,
      systemPromptInject,
      computationMs: Date.now() - t0,
      generatedAt: new Date().toISOString(),
    };
    const markdownReport = this.buildMarkdownReport({ ...draft, markdownReport: "" });
    const result: UnderstandingContext = { ...draft, markdownReport };
    this.cachePut(q, opts, result);

    log.info(
      `🧠 UnderstandingEngine [${opts.strategy}/${opts.detail}] query="${q.slice(0, 50)}…" → ` +
      `confiance=${(score.confidence).toFixed(0)}%, risque=${score.risk}, ` +
      `${batch.files.length} fichiers, ${batch.facts.length} faits, ` +
      `${missingActions.length} action(s) manquante(s) — ${result.computationMs}ms`
    );

    return result;
  }

  /** Raccourci : juste le UnderstandingScore */
  computeScore(query: string, options: BuildContextOptions = {}): UnderstandingScore {
    return this.buildContext(query, options).score;
  }

  /** Raccourci : juste le prompt à injecter */
  buildSystemPrompt(query: string, options: BuildContextOptions = {}): string {
    return this.buildContext(query, options).systemPromptInject;
  }

  /** Apprentissage incrémental : incorporer de nouvelles infos après une action */
  incorporateFeedback(
    originalQuery: string,
    feedback: {
      usefulFiles?: string[];
      uselessFiles?: string[];
      missingTerms?: string[];
      confirmedFacts?: string[];
      deniedFacts?: string[];
      lesson?: string;
    },
    options: BuildContextOptions = {}
  ): string[] {
    const applied: string[] = [];

    // 1. Faits confirmés → augmenter usageCount + confidence
    if (feedback.confirmedFacts && feedback.confirmedFacts.length > 0) {
      for (const content of feedback.confirmedFacts) {
        const matches = projectMemory.searchFacts(content, 1);
        for (const fact of matches) {
          try {
            fact.usageCount++;
            fact.confidence = Math.min(1, fact.confidence + 0.05);
            fact.updatedAt = new Date().toISOString();
            applied.push(`✅ Confiance renforcée sur fait: ${content.slice(0, 60)}`);
          } catch { /* ignore */ }
        }
      }
      projectMemory.save();
    }

    // 2. Faits démentis → baisser confiance, flag
    if (feedback.deniedFacts && feedback.deniedFacts.length > 0) {
      for (const content of feedback.deniedFacts) {
        const matches = projectMemory.searchFacts(content, 1);
        for (const fact of matches) {
          fact.confidence = Math.max(0.05, fact.confidence - 0.15);
          fact.updatedAt = new Date().toISOString();
          if (!fact.tags.includes("contested")) fact.tags.push("contested");
          applied.push(`⚠️ Fait contesté: ${content.slice(0, 60)} (conf↓)`);
        }
      }
      projectMemory.save();
    }

    // 3. Fichiers utiles → ajouter dans les sources de mémoire si pas présents
    if (feedback.usefulFiles && feedback.usefulFiles.length > 0 && options.missionId) {
      for (const fp of feedback.usefulFiles) {
        const existing = projectMemory.searchFacts(fp, 1);
        if (existing.length === 0) {
          projectMemory.addFact({
            content: `Fichier systématiquement pertinent: ${fp}`,
            category: "pattern",
            tags: ["useful-file", "incorporate", `mission:${options.missionId}`],
            sourceFile: fp,
            confidence: 0.7,
          });
          applied.push(`📝 Ajout en mémoire: ${fp} marqué utile`);
        }
      }
      projectMemory.save();
    }

    // 4. Termes manquants → mémoriser comme "requête à optimiser"
    if (feedback.missingTerms && feedback.missingTerms.length > 0 && options.missionId) {
      const combined = feedback.missingTerms.join(", ");
      projectMemory.addFact({
        content: `Terme(s) non trouvé(s) lors de l'analyse de "${originalQuery}" : ${combined} — à réindéxer ou enrichir.`,
        category: "todo",
        tags: ["missing-term", "incorporate", `mission:${options.missionId}`],
        confidence: 0.6,
      });
      applied.push(`📌 Mémorisé terme(s) manquant(s): ${combined}`);
      projectMemory.save();
    }

    // 5. Leçon explicite
    if (feedback.lesson && feedback.lesson.length > 0) {
      projectMemory.addFact({
        content: feedback.lesson,
        category: "decision",
        tags: ["lesson", "feedback", ...(options.missionId ? [`mission:${options.missionId}`] : [])],
        confidence: 0.85,
      });
      applied.push(`🎓 Leçon intégrée en mémoire projet.`);
      projectMemory.save();
    }

    // Invalider cache pour forcer recalcul
    this.usageCache = [];
    return applied;
  }

  // ─── Enrichissement automatique mémoire projet (Optimisation Leanna #4) ───
  /**
   * Capture systématiquement en ProjectMemory:
   *  • Architecture : modules/dossiers saillants (>3 fichiers)
   *  • Conventions : patterns récurrents dans le top batch
   *  • Décisions : résultats ImpactAnalyzer (risques, modules critiques)
   *  • Workflow : présence / absence de sandbox, profile actif
   * Protection anti-doublons via searchFacts (1 résultat = déjà existant).
   */
  private autoEnrichProjectMemory(
    _query: string,
    _batch: ContextBatch,
    health: KnowledgeHealth,
    missionId?: string
  ): number {
    try {
      let added = 0;
      const tagsBase = ["auto-enrich", ...(missionId ? [`mission:${missionId}`] : [])];

      const isDuplicate = (content: string): boolean => {
        const normalized = content.toLowerCase().trim().slice(0, 120);
        try {
          const hits = projectMemory.searchFacts(normalized, 1);
          return hits.length > 0 && hits[0].content.toLowerCase().includes(normalized.slice(0, 60));
        } catch {
          return false;
        }
      };

      // ═══════════════════════════════════════════════════════════════════════
      // SUPPRIMÉ (v2 — cleanup bruit sémantique) :
      //   ✗ "Module X concentre N fichiers pour la requête Y" (hot-module)
      //     → Trop éphémère, lié à une requête spécifique, pas actionnable
      //   ✗ "Vocabulaire saillant : correspondance(×4), textuelle(×4)" (keyword-saliency)
      //     → Aucune valeur actionnable, pollue la mémoire
      //
      // CONSERVÉ : uniquement les faits STRUCTURELS et ACTIONNABLES
      // ═══════════════════════════════════════════════════════════════════════

      // 1. Décisions / risques — modules critiques (stable dans le temps)
      if (health.criticalModuleCount && health.criticalModuleCount > 0) {
        const content = `Projet comporte ${health.criticalModuleCount} module(s) critique(s) (haute centralité). Toute modification → analyser l'impact AVANT (knowledge_impact_analyze).`;
        if (!isDuplicate(content)) {
          projectMemory.addFact({
            content,
            category: "decision",
            tags: [...tagsBase, "critical-modules", "hard-rule"],
            confidence: 0.9,
            isStructural: true,
          });
          added++;
        }
      }

      // 2. Santé / workflow — fraîcheur basse = reindex nécessaire
      if (health.freshness < 0.5) {
        const content = `Fraîcheur index KnowledgeGraph faible (${(health.freshness * 100).toFixed(0)}%). Recommandation: lancer knowledge_reindex pour garantir la pertinence du RAG.`;
        if (!isDuplicate(content)) {
          projectMemory.addFact({
            content,
            category: "todo",
            tags: [...tagsBase, "reindex-needed"],
            confidence: 0.65,
          });
          added++;
        }
      }

      if (added > 0) {
        log.info(`[Enrichissement] +${added} fait(s) structurel(s) ajouté(s) (persistance différée)`);
      }
      return added;
    } catch (e) {
      log.debug(`[Enrichissement] Erreur silencieuse: ${(e as Error).message}`);
      return 0;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 0. Cache
  // ──────────────────────────────────────────────────────────────────────

  private cacheGet(query: string, opts: BuildContextOptions): UnderstandingContext | null {
    const now = Date.now();
    const key = `${query}::${opts.strategy}::${opts.detail}`;
    const entry = this.usageCache.find(
      (c) => `${c.query}::balanced::standard` === key && now - c.timestamp < UnderstandingEngine.CACHE_TTL_MS
    );
    return entry ? entry.context : null;
  }

  private cachePut(query: string, opts: BuildContextOptions, context: UnderstandingContext): void {
    const key = `${query}::${opts.strategy}::${opts.detail}`;
    this.usageCache.push({ query: key, timestamp: Date.now(), context });
    if (this.usageCache.length > UnderstandingEngine.CACHE_MAX) this.usageCache.shift();
  }

  private trackUsage(_query: string): void {
    // Future amélioration : tracking des patterns d'usage
  }

  // ──────────────────────────────────────────────────────────────────────
  // 1. Health check
  // ──────────────────────────────────────────────────────────────────────

  scanKnowledgeHealth(): KnowledgeHealth {
    const warnings: string[] = [];
    let initialized = false;
    let fileCount = 0, entityCount = 0, exportCount = 0, importCount = 0;
    let cycleCount = 0, factCount = 0, criticalModuleCount = 0;
    let freshness = 0.3;
    let lastIndexed: string | undefined;

    try {
      const stats: KnowledgeStats = knowledgeGraph.getStats();
      fileCount = stats.totalFiles;
      entityCount = stats.totalEntities;
      exportCount = stats.totalExports;
      importCount = stats.totalImports;
      initialized = knowledgeGraph.isInitialized();
      lastIndexed = knowledgeGraph.getLastIndexed();
      freshness = initialized ? Math.min(1, 0.5 + 0.5 / (1 + this.hoursSince(lastIndexed))) : 0.05;
      if (!initialized) warnings.push("KnowledgeGraph non initialisé — indexer d'abord le projet");
      if (fileCount === 0) warnings.push("Aucun fichier indexé");
    } catch (e) {
      warnings.push(`KnowledgeGraph indisponible: ${(e as Error).message.slice(0, 60)}`);
    }

    try {
      const cycles = dependencyGraph.detectCycles();
      cycleCount = cycles.length;
      if (cycleCount > 0) warnings.push(`${cycleCount} cycle(s) de dépendance détecté(s)`);
      criticalModuleCount = dependencyGraph.getCriticalModules(8).length;
    } catch {
      warnings.push("DependencyGraph indisponible");
    }

    try {
      const allFacts = projectMemory.searchFacts("", 9999);
      factCount = allFacts.length;
      if (factCount === 0) warnings.push("ProjectMemory vide — aucune connaissance métier acquise");
    } catch {
      warnings.push("ProjectMemory indisponible");
    }

    return {
      initialized,
      fileCount, entityCount, exportCount, importCount,
      cycleCount, factCount, criticalModuleCount,
      freshness: Math.round(freshness * 100) / 100,
      lastIndexed,
      warnings,
    };
  }

  private hoursSince(iso?: string): number {
    if (!iso) return 9999;
    const diff = Date.now() - new Date(iso).getTime();
    return Math.max(0, diff) / 3_600_000;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3. Application de la stratégie
  // ──────────────────────────────────────────────────────────────────────

  private applyStrategy(
    query: string,
    batch: ContextBatch,
    opts: typeof DEFAULTS
  ): ContextBatch {
    const working: ContextBatch = { ...batch };
    const maxFiles = opts.maxFiles;
    const maxFacts = opts.maxFacts;

    // 1. Adapter fichiers selon stratégie
    switch (opts.strategy) {
      case "code_first": {
        // Prioriser les fichiers à haute pertinence textuelle, ignorés les faits mémoire
        working.files = working.files
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, maxFiles);
        working.facts = working.facts.slice(0, Math.max(2, Math.floor(maxFacts * 0.25)));
        break;
      }
      case "memory_first": {
        // Prioriser les faits mémoire puis fichiers (plus de place aux faits)
        working.facts = working.facts.slice(0, maxFacts);
        working.files = working.files
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, Math.max(3, Math.floor(maxFiles * 0.5)));
        // Ajouter des faits relatifs aux fichiers primaires
        const bonusFacts: ProjectFact[] = [];
        for (const f of working.files.slice(0, 5)) {
          const extras = projectMemory.searchFacts(f.filePath, 3);
          for (const ex of extras) {
            if (!working.facts.find((x) => x.id === ex.id) && !bonusFacts.find((x) => x.id === ex.id)) {
              bonusFacts.push(ex);
            }
          }
        }
        working.facts = [...working.facts, ...bonusFacts].slice(0, maxFacts + 5);
        break;
      }
      case "graph_first": {
        // Ajouter : fichiers dans la chaîne d'impact des fichiers trouvés
        const added = new Set(working.files.map((f) => f.filePath));
        for (const f of working.files.slice(0, 6)) {
          const chain = dependencyGraph.getImpactChain(f.filePath).slice(1, 4);
          for (const dep of chain) {
            if (!added.has(dep)) {
              working.files.push({
                filePath: dep,
                relevance: Math.max(0.1, f.relevance - 0.2),
                reason: `[graph_first] Dans la chaîne d'impact de ${f.filePath}`,
                relevantSections: [],
              });
              added.add(dep);
            }
          }
        }
        working.files = working.files.slice(0, maxFiles);
        working.facts = working.facts.slice(0, maxFacts);
        break;
      }
      case "minimal": {
        // Très peu d'éléments : top fichier + top 2 faits
        working.files = working.files.slice(0, 3);
        working.facts = working.facts.slice(0, 3);
        break;
      }
      default: {
        // balanced
        working.files = working.files
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, maxFiles);
        working.facts = working.facts.slice(0, maxFacts);
      }
    }

    // 2. Respect du budget token approximatif
    working.quality = semanticSearch.estimateQuality(working.files, working.facts);
    if (opts.detail === "compact") {
      working.files = working.files.map((f) => ({
        ...f,
        relevantSections: f.relevantSections.slice(0, 2),
      }));
    } else if (opts.detail === "verbose") {
      // Ajouter + de faits si budget le permet
      if (working.facts.length < maxFacts) {
        const extras = projectMemory.searchFacts(query, maxFacts);
        for (const ex of extras) {
          if (!working.facts.find((f) => f.id === ex.id)) working.facts.push(ex);
          if (working.facts.length >= maxFacts) break;
        }
      }
    }

    // 3. Qualité recalculée
    working.quality = semanticSearch.estimateQuality(working.files, working.facts);

    // 4. PrimaryFile : si pas déjà défini, prendre le plus pertinent
    if (!working.primaryFile && working.files.length > 0) {
      working.primaryFile = working.files[0].filePath;
    }

    return working;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 4. Cycles risqués
  // ──────────────────────────────────────────────────────────────────────

  private findRiskyCycles(files: RelevantFile[]): DependencyCycle[] {
    const paths = new Set(files.map((f) => this.norm(f.filePath)));
    try {
      return dependencyGraph
        .detectCycles()
        .filter((c) => c.files.some((f) => paths.has(this.norm(f))))
        .filter((c) => c.length >= 3) // les cycles de 2 sont courants, signaler 3+
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  private norm(p: string): string {
    return p.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
  }

  // ──────────────────────────────────────────────────────────────────────
  // 5. Entités pertinentes
  // ──────────────────────────────────────────────────────────────────────

  private searchRelevantEntities(
    query: string,
    files: RelevantFile[],
    limit: number
  ): UnderstandingContext["relevantEntities"] {
    const results: UnderstandingContext["relevantEntities"] = [];
    try {
      const lowerQ = query.toLowerCase();
      const fromQuery = knowledgeGraph.searchEntities(query).slice(0, limit);
      for (const e of fromQuery) {
        const score = this.computeEntityRelevance(e, lowerQ);
        results.push({ name: e.name, type: e.type, file: e.filePath, score });
      }
      // Compléter avec des entités des fichiers top
      const topFiles = files.slice(0, 3).map((f) => this.norm(f.filePath));
      for (const fp of topFiles) {
        const ents = knowledgeGraph.getEntities("").filter((e) => this.norm(e.filePath) === fp).slice(0, 3);
        for (const e of ents) {
          if (!results.find((r) => r.name === e.name && r.file === e.filePath)) {
            results.push({ name: e.name, type: e.type, file: e.filePath, score: 0.4 });
          }
        }
      }
    } catch { /* ignore */ }
    return results.slice(0, limit);
  }

  // ──────────────────────────────────────────────────────────────────────
  // 6. UnderstandingScore
  // ──────────────────────────────────────────────────────────────────────

  private computeUnderstandingScore(
    _query: string,
    batch: ContextBatch,
    health: KnowledgeHealth,
    opts: typeof DEFAULTS
  ): UnderstandingScore {
    // contextFound : ratio qualité estimée + fichiers / seuils
    const fileScore = Math.min(1, batch.files.length / Math.max(1, Math.round(opts.maxFiles * 0.6))) * 100;
    const factScore = Math.min(1, batch.facts.length / Math.max(1, Math.round(opts.maxFacts * 0.5))) * 100;
    const qualityScore = batch.quality.sufficient ? 100 : batch.quality.averageConfidence * 100;
    const contextFound = Math.round(fileScore * 0.4 + factScore * 0.2 + qualityScore * 0.4);

    // relations : centralité + cycles + couverture de l'historique
    const relationIndicators: number[] = [];
    try {
      for (const f of batch.files.slice(0, 5)) {
        const depCount = dependencyGraph.getDirectDependents(f.filePath).length;
        relationIndicators.push(Math.min(1, depCount / 8));
      }
    } catch { /* ignore */ }
    const relAvg = relationIndicators.length > 0
      ? relationIndicators.reduce((s, v) => s + v, 0) / relationIndicators.length
      : 0;
    let relations = Math.round((0.5 + relAvg * 0.5) * 100);
    if (health.cycleCount > 0) relations = Math.max(0, relations - Math.min(20, health.cycleCount * 3));

    // Confiance globale : combinaison avec health.freshness
    let confidence = Math.round(
      contextFound * 0.45 + relations * 0.25 + (health.freshness * 100) * 0.2 +
      (health.initialized ? 10 : 0) + (health.factCount > 0 ? 5 : 0)
    );
    confidence = Math.max(0, Math.min(100, confidence));

    // Risque : basé sur quality insuffisante, cycles, ou conf faible
    let risk: UnderstandingScore["risk"] = "low";
    if (confidence < 40 || !batch.quality.sufficient) risk = "high";
    else if (confidence < 65 || health.cycleCount >= 2) risk = "medium";

    // Checks recommandés
    const recommendedChecks: string[] = [];
    if (!health.initialized) recommendedChecks.push("Lancer l'indexation du projet (KnowledgeGraph)");
    if (health.cycleCount > 0) recommendedChecks.push(`Analyser les ${health.cycleCount} cycle(s) de dépendance`);
    if (batch.quality.sufficient === false) recommendedChecks.push("Contexte insuffisant : lire davantage de fichiers pertinents");
    if (batch.facts.length < 2) recommendedChecks.push("Enrichir la mémoire projet avec les décisions clés");

    // Missing actions seront remplis à l'étape 7
    const missingActions: string[] = [];
    const unreadFiles = batch.files
      .filter((f) => !opts.existingContext.map(this.norm).includes(this.norm(f.filePath)))
      .slice(0, 8)
      .map((f) => f.filePath);

    return {
      contextFound,
      relations,
      confidence,
      risk,
      missingActions,
      unreadFiles,
      recommendedChecks,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // 7. Actions manquantes
  // ──────────────────────────────────────────────────────────────────────

  private computeMissingActions(
    query: string,
    score: UnderstandingScore,
    batch: ContextBatch,
    health: KnowledgeHealth,
    opts: typeof DEFAULTS
  ): MissingAction[] {
    const actions: MissingAction[] = [];
    const existingSet = new Set(opts.existingContext.map(this.norm));

    // 1. Indexer le projet si nécessaire
    if (!health.initialized) {
      actions.push({
        id: "act_index",
        kind: "index_project",
        target: "projet",
        rationale: "KnowledgeGraph vide ou non initialisé",
        estimatedGain: 40,
        priority: "critical",
        cost: "expensive",
      });
    }

    // 2. Fichiers non lus dans le top
    const unreadTop = batch.files
      .filter((f) => !existingSet.has(this.norm(f.filePath)))
      .slice(0, 6);
    for (const f of unreadTop) {
      const gain = Math.round(30 + f.relevance * 50);
      actions.push({
        id: `act_read_${this.norm(f.filePath).replace(/[^a-z0-9]/gi, "_")}`,
        kind: "read_file",
        target: f.filePath,
        rationale: f.reason || `Fichier pertinent (${Math.round(f.relevance * 100)}%)`,
        estimatedGain: gain,
        priority: gain >= 60 ? "high" : gain >= 35 ? "medium" : "low",
        cost: "cheap",
      });
    }

    // 3. Recherche sémantique complémentaire si contexte trop faible
    if (score.contextFound < 40) {
      const terms = this.extractTerms(query).slice(0, 3);
      for (const t of terms) {
        actions.push({
          id: `act_search_${t}`,
          kind: "run_search",
          target: t,
          rationale: `Rechercher le terme "${t}" pour compléter le contexte faible`,
          estimatedGain: 25,
          priority: "medium",
          cost: "cheap",
        });
      }
    }

    // 4. Faits à chercher dans ProjectMemory si peu de faits retournés
    if (batch.facts.length < 2) {
      actions.push({
        id: "act_facts_lookup",
        kind: "look_up_fact",
        target: query,
        rationale: `Peu de faits projet (${batch.facts.length}) — requête ProjectMemory élargie`,
        estimatedGain: 20,
        priority: score.confidence < 50 ? "high" : "medium",
        cost: "cheap",
      });
    }

    // 5. Inspecter les entités du top fichier
    const topUnread = unreadTop[0];
    if (topUnread) {
      actions.push({
        id: `act_entities_${this.norm(topUnread.filePath).replace(/[^a-z0-9]/gi, "_")}`,
        kind: "inspect_entities",
        target: topUnread.filePath,
        rationale: "Inspecter entités/fonctions/classes du fichier principal avant de modifier",
        estimatedGain: 15,
        priority: "low",
        cost: "cheap",
      });
    }

    // 6. Ask user si vraiment rien et health correct
    if (
      score.confidence < 25 &&
      health.initialized &&
      batch.files.length === 0 &&
      batch.facts.length === 0 &&
      opts.history &&
      opts.history.length >= 2
    ) {
      actions.push({
        id: "act_ask_user",
        kind: "ask_user",
        target: "clarification",
        rationale: "Aucune piste trouvée malgré la base initialisée — clarifier la demande",
        estimatedGain: 60,
        priority: "critical",
        cost: "medium",
      });
    }

    // Dédupliquer + trier par gain décroissant
    const seen = new Set<string>();
    const deduplicated = actions.filter((a) => {
      const k = `${a.kind}:${a.target}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    deduplicated.sort((a, b) => {
      const prioScore = (p: MissingAction["priority"]) =>
        p === "critical" ? 1e6 : p === "high" ? 1e4 : p === "medium" ? 1e2 : 1;
      return b.estimatedGain * prioScore(b.priority) - a.estimatedGain * prioScore(a.priority);
    });

    // Mettre à jour le score.missingActions (liste lisible)
    score.missingActions = deduplicated
      .slice(0, 5)
      .map((a) => `${a.kind} → ${a.target} (gain ~${a.estimatedGain}%, ${a.priority})`);

    return deduplicated;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 8. Recommandations contextuelles (par ROI)
  // ──────────────────────────────────────────────────────────────────────

  private computeRecommendations(
    score: UnderstandingScore,
    missing: MissingAction[],
    _batch: ContextBatch,
    opts: typeof DEFAULTS
  ): ContextualRecommendation[] {
    const recs: ContextualRecommendation[] = [];

    const addRec = (
      category: ContextualRecommendation["category"],
      description: string,
      rationale: string,
      effort: 1 | 2 | 3 | 4 | 5,
      impact: number
    ) => {
      recs.push({
        id: `rec_${recs.length + 1}`,
        category,
        description,
        rationale,
        effort,
        impact: Math.max(0, Math.min(1, impact)),
        roi: 0,
      });
    };

    // 1. Lecture fichiers non lus
    const topRead = missing.filter((m) => m.kind === "read_file").slice(0, 3);
    for (const r of topRead) {
      addRec(
        "read",
        `Lire ${r.target.split("/").pop()} (${r.target})`,
        r.rationale,
        2,
        r.estimatedGain / 100
      );
    }

    // 2. Validation si risque moyen/élevé
    if (score.risk === "high") {
      addRec(
        "validate",
        "Valider chaque modification par typecheck + tests",
        `Risque élevé détecté par UnderstandingEngine (confiance=${score.confidence}%)`,
        3,
        0.85
      );
    } else if (score.risk === "medium") {
      addRec(
        "validate",
        "Typecheck après modifications des fichiers top",
        "Risque modéré — éviter les erreurs évidentes",
        2,
        0.6
      );
    }

    // 3. Structuration : grouper les lectures avant écriture
    const unreadCount = score.unreadFiles.length;
    if (unreadCount >= 3) {
      addRec(
        "structure",
        `Lire d'abord les ${Math.min(5, unreadCount)} fichiers pertinents avant toute écriture`,
        "Évite les modifications en aveugle et diminue le risque de réécriture",
        2,
        0.7
      );
    }

    // 4. Search sémantique si besoin
    const searchAct = missing.find((m) => m.kind === "run_search");
    if (searchAct) {
      addRec(
        "search",
        `Recherche sémantique complémentaire sur: "${searchAct.target}"`,
        searchAct.rationale,
        1,
        searchAct.estimatedGain / 100
      );
    }

    // 5. Apprentissage : enregistrer la leçon après coup
    if (opts.missionId) {
      addRec(
        "learn",
        `Enregistrer les décisions importantes en ProjectMemory (mission:${opts.missionId})`,
        "Améliore la compréhension des futures missions similaires",
        2,
        0.4
      );
    }

    // Calcul du ROI
    for (const r of recs) {
      const effortNorm = r.effort / 5; // 0.2 .. 1
      r.roi = Math.round((r.impact / Math.max(0.05, effortNorm)) * 100) / 100;
    }
    recs.sort((a, b) => b.roi - a.roi);

    return recs;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 9. Coverage
  // ──────────────────────────────────────────────────────────────────────

  private computeCoverage(
    batch: ContextBatch,
    existing: string[]
  ): UnderstandingContext["coverage"] {
    const existingNorm = existing.map(this.norm);
    const overlapped: string[] = [];
    const newlyFound: string[] = [];
    const batchSet = new Set(batch.files.map((f) => this.norm(f.filePath)));
    for (const e of existingNorm) if (batchSet.has(e)) overlapped.push(e);
    for (const f of batch.files) {
      const n = this.norm(f.filePath);
      if (!existingNorm.includes(n)) newlyFound.push(f.filePath);
    }
    return { existing: existingNorm, overlapped, newlyFound };
  }

  // ──────────────────────────────────────────────────────────────────────
  // 12. Prompts et rapports
  // ──────────────────────────────────────────────────────────────────────

  private buildOneLineSummary(
    score: UnderstandingScore,
    batch: ContextBatch,
    coverage: UnderstandingContext["coverage"]
  ): string {
    const risk = score.risk === "low" ? "🟢" : score.risk === "medium" ? "🟡" : "🔴";
    return (
      `${risk} Compréhension ${score.confidence}% — ` +
      `${batch.files.length} fichiers (${coverage.newlyFound.length} nouveaux, ${coverage.overlapped.length} déjà connus) · ` +
      `${batch.facts.length} faits mémoire · ` +
      `${score.missingActions.length} action(s) à faire`
    );
  }

  private buildSystemPromptInject(
    score: UnderstandingScore,
    batch: ContextBatch,
    recs: ContextualRecommendation[],
    opts: typeof DEFAULTS
  ): string {
    const lines: string[] = [];
    lines.push(`<understanding_engine>`);
    lines.push(`<!-- Résultats UnderstandingEngine — injectés automatiquement -->`);
    lines.push(`<score confidence="${score.confidence}" risk="${score.risk}" context="${score.contextFound}" relations="${score.relations}" />`);
    lines.push(`<summary>${this.escapeXml(this.buildOneLineSummary(score, batch, this.computeCoverage(batch, opts.existingContext)))}</summary>`);
    lines.push(`<contexte_existant count="${opts.existingContext.length}">${opts.existingContext.join(", ")}</contexte_existant>`);

    if (batch.primaryFile) {
      lines.push(`<fichier_principal>${batch.primaryFile}</fichier_principal>`);
    }
    lines.push(`<fichiers count="${batch.files.length}">`);
    for (const f of batch.files.slice(0, 8)) {
      lines.push(`  <file path="${this.escapeXml(f.filePath)}" relevance="${Math.round(f.relevance * 100)}%" reason="${this.escapeXml(f.reason || "")}">`);
      const sections = f.relevantSections.slice(0, opts.detail === "verbose" ? 5 : 2);
      for (const s of sections) {
        lines.push(`    <snippet lines="${s.lineStart}-${s.lineEnd}" content="${this.escapeXml(s.content.slice(0, 220))}" />`);
      }
      lines.push(`  </file>`);
    }
    lines.push(`</fichiers>`);

    if (batch.facts.length > 0) {
      lines.push(`<faits_memoire count="${batch.facts.length}">`);
      for (const fact of batch.facts.slice(0, 5)) {
        lines.push(`  <fact id="${fact.id}" category="${fact.category}" confidence="${fact.confidence}" tags="${fact.tags.join(",")}">${this.escapeXml(fact.content.slice(0, 240))}</fact>`);
      }
      lines.push(`</faits_memoire>`);
    }

    if (score.missingActions.length > 0) {
      lines.push(`<actions_a_faire>`);
      for (const m of score.missingActions) lines.push(`  <action>${this.escapeXml(m)}</action>`);
      lines.push(`</actions_a_faire>`);
    }

    if (score.unreadFiles.length > 0) {
      lines.push(`<fichiers_non_lus>`);
      for (const f of score.unreadFiles) lines.push(`  <unread>${this.escapeXml(f)}</unread>`);
      lines.push(`</fichiers_non_lus>`);
    }

    if (score.recommendedChecks.length > 0) {
      lines.push(`<checks>`);
      for (const c of score.recommendedChecks) lines.push(`  <check>${this.escapeXml(c)}</check>`);
      lines.push(`</checks>`);
    }

    if (recs.length > 0) {
      lines.push(`<recommandations>`);
      for (const r of recs.slice(0, 5)) {
        lines.push(`  <rec roi="${r.roi}" effort="${r.effort}" category="${r.category}">${this.escapeXml(r.description)}</rec>`);
      }
      lines.push(`</recommandations>`);
    }

    lines.push(`</understanding_engine>`);
    return lines.join("\n");
  }

  private buildMarkdownReport(ctx: UnderstandingContext): string {
    const lines: string[] = [];
    lines.push(`# Rapport UnderstandingEngine — ${ctx.strategy}/${ctx.detailLevel}`);
    lines.push("");
    lines.push(`> Généré le ${new Date(ctx.generatedAt).toLocaleString()} en ${ctx.computationMs}ms`);
    lines.push("");
    lines.push(`## 1. Résumé`);
    lines.push("");
    lines.push(`> ${ctx.oneLineSummary}`);
    lines.push("");
    lines.push(`| Indicateur | Valeur |`);
    lines.push(`|---|---|`);
    lines.push(`| Confiance | **${ctx.score.confidence}%** |`);
    lines.push(`| Risque | ${ctx.score.risk} |`);
    lines.push(`| Contexte trouvé | ${ctx.score.contextFound}% |`);
    lines.push(`| Relations fichiers | ${ctx.score.relations}% |`);
    lines.push(`| Fichiers (batch) | ${ctx.batch.files.length} |`);
    lines.push(`| Faits mémoire | ${ctx.batch.facts.length} |`);
    lines.push(`| Actions manquantes | ${ctx.missingActions.length} |`);
    lines.push(`| Recommandations | ${ctx.recommendations.length} |`);
    lines.push(`| Cycles à risque | ${ctx.riskyCycles.length} |`);
    lines.push("");

    lines.push(`## 2. Santé de la base de connaissance`);
    lines.push("");
    lines.push(`- Initialisé : ${ctx.health.initialized ? "✅ oui" : "❌ non"} · Fraîcheur : **${(ctx.health.freshness * 100).toFixed(0)}%** ${ctx.health.lastIndexed ? `(indexé le ${new Date(ctx.health.lastIndexed).toLocaleString()})` : ""}`);
    lines.push(`- Fichiers: ${ctx.health.fileCount} · Entités: ${ctx.health.entityCount} · Exports: ${ctx.health.exportCount} · Imports: ${ctx.health.importCount}`);
    lines.push(`- Cycles: ${ctx.health.cycleCount} · Faits projet: ${ctx.health.factCount} · Modules critiques: ${ctx.health.criticalModuleCount}`);
    if (ctx.health.warnings.length > 0) {
      lines.push("");
      lines.push(`### ⚠️ Warnings`);
      for (const w of ctx.health.warnings) lines.push(`- ${w}`);
    }
    lines.push("");

    lines.push(`## 3. Contexte retourné`);
    lines.push("");
    lines.push(`### Fichiers (Top ${ctx.batch.files.length})`);
    for (const f of ctx.batch.files) {
      lines.push(`- **${(f.relevance * 100).toFixed(0)}%** \`${f.filePath}\` — ${f.reason || ""}`);
      if (f.relevantSections.length > 0) {
        for (const s of f.relevantSections.slice(0, 2)) {
          lines.push(`  · \`L${s.lineStart}-L${s.lineEnd}\`: ${s.content.slice(0, 140)}${s.content.length > 140 ? "…" : ""}`);
        }
      }
    }
    if (ctx.batch.facts.length > 0) {
      lines.push("");
      lines.push(`### Faits ProjectMemory (Top ${ctx.batch.facts.length})`);
      for (const fact of ctx.batch.facts) {
        lines.push(`- [${fact.category}] ${fact.content.slice(0, 140)}${fact.content.length > 140 ? "…" : ""} <sup>(${(fact.confidence * 100).toFixed(0)}% · utilisé ${fact.usageCount}x)</sup>`);
      }
    }
    lines.push("");

    lines.push(`## 4. Coverage`);
    lines.push("");
    lines.push(`- Déjà connus: ${ctx.coverage.overlapped.length}/${ctx.coverage.existing.length}`);
    lines.push(`- Nouvellement découverts: **${ctx.coverage.newlyFound.length}**`);
    if (ctx.coverage.newlyFound.length > 0) {
      for (const f of ctx.coverage.newlyFound.slice(0, 10)) lines.push(`  - ${f}`);
    }
    lines.push("");

    lines.push(`## 5. Actions manquantes`);
    lines.push("");
    if (ctx.missingActions.length === 0) {
      lines.push(`✅ Aucune action manquante détectée.`);
    } else {
      lines.push(`| Priorité | Action | Cible | Gain estimé | Coût | Rationale |`);
      lines.push(`|---|---|---|---|---|---|`);
      for (const a of ctx.missingActions.slice(0, 10)) {
        lines.push(`| ${a.priority} | ${a.kind} | \`${a.target}\` | ${a.estimatedGain}% | ${a.cost} | ${a.rationale.slice(0, 80)} |`);
      }
    }
    lines.push("");

    lines.push(`## 6. Recommandations (par ROI)`);
    lines.push("");
    if (ctx.recommendations.length === 0) {
      lines.push(`(aucune)`);
    } else {
      lines.push(`| # | Catégorie | Description | Effort | Impact | ROI |`);
      lines.push(`|---|---|---|---|---|---|`);
      for (let i = 0; i < Math.min(10, ctx.recommendations.length); i++) {
        const r = ctx.recommendations[i];
        lines.push(`| ${i + 1} | ${r.category} | ${r.description.slice(0, 80)} | ${r.effort}/5 | ${(r.impact * 100).toFixed(0)}% | **${r.roi}** |`);
      }
    }
    lines.push("");

    if (ctx.relevantEntities.length > 0) {
      lines.push(`## 7. Entités pertinentes`);
      lines.push("");
      for (const e of ctx.relevantEntities) lines.push(`- **${e.name}** (${e.type}) — \`${e.file}\` · ${(e.score * 100).toFixed(0)}%`);
      lines.push("");
    }

    if (ctx.riskyCycles.length > 0) {
      lines.push(`## 8. Cycles à risque`);
      lines.push("");
      for (const c of ctx.riskyCycles) lines.push(`- Taille ${c.length}: ${c.files.map((f) => `\`${f}\``).join(" → ")}`);
      lines.push("");
    }

    lines.push(`## 9. Vérifications recommandées`);
    lines.push("");
    if (ctx.score.recommendedChecks.length === 0) {
      lines.push(`(aucune — contexte jugé suffisant)`);
    } else {
      for (const c of ctx.score.recommendedChecks) lines.push(`- ${c}`);
    }
    lines.push("");

    lines.push(`## 10. Extrait prompt système à injecter`);
    lines.push("");
    lines.push("```xml");
    lines.push(ctx.systemPromptInject.split("\n").slice(0, 30).join("\n"));
    if (ctx.systemPromptInject.split("\n").length > 30) lines.push(`<!-- ... +${ctx.systemPromptInject.split("\n").length - 30} lignes ... -->`);
    lines.push("```");

    return lines.join("\n");
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private extractTerms(query: string): string[] {
    const stop = new Set([
      "le","la","les","de","du","des","un","une","et","ou","mais","dans","sur","avec","pour","par",
      "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","as","is",
      "was","are","were","be","this","that","these","those","it","its","not","no","how","what","why",
      "comment","pourquoi","quand","quel","quelle","que","qui","est","fichier","file","function",
    ]);
    return query
      .replace(/[^a-z0-9_äöüéèêëàâùûôîïç]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stop.has(w.toLowerCase()))
      .slice(0, 10);
  }

  private emptyContext(
    query: string,
    opts: typeof DEFAULTS,
    durationMs: number
  ): UnderstandingContext {
    const health = this.scanKnowledgeHealth();
    return {
      query,
      score: {
        contextFound: 0, relations: 0, confidence: 0, risk: "high",
        missingActions: ["Indexer le projet puis relancer"],
        unreadFiles: [],
        recommendedChecks: health.warnings,
      },
      batch: { query, files: [], facts: [], quality: semanticSearch.estimateQuality([], []), primaryFile: undefined },
      health,
      missingActions: [],
      recommendations: [],
      relevantEntities: [],
      riskyCycles: [],
      coverage: { existing: opts.existingContext.map(this.norm), overlapped: [], newlyFound: [] },
      strategy: opts.strategy,
      detailLevel: opts.detail,
      oneLineSummary: "⚠️ Query vide — impossible de construire un contexte",
      systemPromptInject: `<understanding_engine><error>empty query</error></understanding_engine>`,
      markdownReport: "# Rapport UnderstandingEngine — (query vide)\n",
      computationMs: durationMs,
      generatedAt: new Date().toISOString(),
    };
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private computeEntityRelevance(e: { name: string; type: string; filePath: string; modifiers?: string[]; description?: string; signature?: string }, lowerQ: string): number {
    // Simule un score de pertinence basé sur présence de tokens dans name/desc/signature/exports
    let score = 0.4; // score de base
    if (e.name.toLowerCase() === lowerQ) score += 0.5;
    else if (e.name.toLowerCase().includes(lowerQ)) score += 0.3;
    if (e.modifiers && (e.modifiers.includes("export") || e.modifiers.includes("default"))) score += 0.05;
    if (e.description && e.description.toLowerCase().includes(lowerQ)) score += 0.15;
    if (e.signature && e.signature.toLowerCase().includes(lowerQ)) score += 0.1;
    const tokens = lowerQ.split(/[\s-_./]+/).filter((t) => t.length >= 3);
    for (const tok of tokens) {
      if (e.name.toLowerCase().includes(tok)) score += 0.08;
    }
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée de UnderstandingEngine */
export const understandingEngine = new UnderstandingEngine();
