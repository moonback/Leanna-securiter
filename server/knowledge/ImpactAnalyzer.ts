/**
 * ImpactAnalyzer — Analyse multi-critères d'impact de modification
 *
 * Sprint 7 — Objectifs:
 *  • Évaluer l'impact réel de la modification d'un ou plusieurs fichiers
 *  • 4 modes d'analyse : quick / standard / deep / reverse
 *  • 6 critères d'évaluation pondérés pour un score de risque réaliste
 *  • Intégration : DependencyGraph + ProjectMemory + KnowledgeGraph
 *  • Sorties : recommandations de tests, hiérarchie des validations,
 *               rapports lisibles (texte + Markdown + JSON)
 *
 * 6 Critères d'évaluation (pondérables par mode) :
 *   1. proximityScore        — Distance dans le graphe de dépendances
 *   2. centralityScore       — Nombre de dépendants transitifs (centralité)
 *   3. fileTypeScore         — Type de fichier (core vs tests vs config vs assets)
 *   4. interfaceChangeRisk   — Modification probable de l'interface publique
 *   5. bugHistoryScore       — Historique de bugs connus via ProjectMemory
 *   6. sideEffectScore       — Risque d'effets de bord globaux / mutables
 */

import { createLogger } from "../utils/logger.js";
import { dependencyGraph } from "./DependencyGraph.js";
import { projectMemory } from "./ProjectMemory.js";
import { knowledgeGraph } from "./KnowledgeGraph.js";
import type { ImpactReport, DependencyCycle } from "./types.js";

const log = createLogger("ImpactAnalyzer");

// ═══════════════════════════════════════════════════════════════════════════════
// Types Sprint 7 — ImpactAnalyzer
// ═══════════════════════════════════════════════════════════════════════════════

/** Mode d'analyse d'impact */
export type ImpactMode =
  | "quick"      // Seulement impacts directs + score simple, ultra rapide
  | "standard"   // Impacts directs + indirects + 6 critères pondérés (défaut)
  | "deep"       // Même chose + chemins de dépendance + cycles + suggestions exhaustives
  | "reverse";   // Mode inverse : quels sont les fichiers QUE ce fichier impacte ?

/** Niveau de risque (utilisé pour les seuils et recommandations) */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Fichier impacté individuel, avec scores par critère */
export interface ImpactedFile {
  filePath: string;
  /** Distance dans le graphe (1 = direct, 2+ = indirect) */
  distance: number;
  /** Score brut 0-100 */
  impactScore: number;
  /** Niveau de risque agrégé */
  risk: RiskLevel;
  /** Critères détaillés (0-1 chacun) */
  criteria: {
    proximity: number;
    centrality: number;
    fileType: number;
    interfaceChange: number;
    bugHistory: number;
    sideEffect: number;
  };
  /** Résumé textuel de "pourquoi ce fichier est à risque" */
  reasons: string[];
  /** Chemins de dépendance depuis le fichier modifié (mode deep) */
  dependencyPaths?: string[][];
  /** Ce fichier fait partie d'un cycle impacté ? */
  partOfCycles?: DependencyCycle[];
  /** Fichier critique (centralité haute) ? */
  isCritical?: boolean;
}

/** Recommandation de test / validation */
export interface TestRecommendation {
  priority: "must" | "should" | "may";
  kind: "unit" | "integration" | "e2e" | "manual" | "typecheck" | "lint" | "build";
  scope: string;                // Fichier(s) ou module concerné(s)
  description: string;
  rationale: string;
}

/** Rapport complet d'impact (Sprint 7 étendu) */
export interface ExtendedImpactReport extends ImpactReport {
  /** Mode d'analyse utilisé */
  mode: ImpactMode;
  /** Fichiers modifiés à l'origine de l'analyse */
  modifiedFiles: string[];
  /** Tous les fichiers impactés, classés par score décroissant */
  impactedFiles: ImpactedFile[];
  /** Décomposition du risque global (%) par critère */
  riskBreakdown: {
    proximity: number;
    centrality: number;
    fileType: number;
    interfaceChange: number;
    bugHistory: number;
    sideEffect: number;
  };
  /** Pondérations utilisées pour chaque critère (selon le mode) */
  criteriaWeights: Record<keyof ExtendedImpactReport["riskBreakdown"], number>;
  /** Niveau de risque global (agrégat) */
  overallRisk: RiskLevel;
  /** Recommandations de tests / validations */
  testRecommendations: TestRecommendation[];
  /** Hiérarchie des validations à effectuer (ordre d'exécution) */
  validationOrder: {
    step: number;
    label: string;
    commands?: string[];
    required: boolean;
    estimatedRiskReduction: number; // 0-1 estimation de la réduction de risque
  }[];
  /** Rapport formaté en Markdown */
  markdownReport: string;
  /** Timestamp de génération */
  generatedAt: string;
  /** Durée de calcul en ms */
  computationMs: number;
}

/** Options d'analyse */
export interface ImpactAnalysisOptions {
  mode?: ImpactMode;
  /** Pondérations personnalisées (remplacent celles du mode) */
  weights?: Partial<Record<keyof ExtendedImpactReport["riskBreakdown"], number>>;
  /** Filtre : inclure seulement les fichiers correspondant à ce préfixe */
  onlyInPaths?: string[];
  /** Seuil minimal de score 0-100 pour inclure un fichier (quick=5, standard=1, deep=0) */
  minScore?: number;
  /** Inclure les fichiers de test dans l'analyse (default false, ils sont déjà "output") */
  includeTests?: boolean;
  /** Chemins de dépendance maximum explorés par paire (mode deep) */
  maxPathsPerPair?: number;
  /** Inférer la probabilité de changement d'interface par heuristique sur types.ts? */
  interfaceHeuristic?: boolean;
}

// ─── Configurations par mode ─────────────────────────────────────────────────

interface ModeConfig {
  maxIndirectDistance: number;
  weights: Required<ImpactAnalysisOptions["weights"]>;
  minScore: number;
  includePaths: boolean;
  includeCycles: boolean;
  inferInterfaceChange: boolean;
  maxTestRecommendations: number;
}

const MODE_CONFIGS: Record<ImpactMode, ModeConfig> = {
  quick: {
    maxIndirectDistance: 1,
    weights: {
      proximity: 0.5,
      centrality: 0.2,
      fileType: 0.2,
      interfaceChange: 0,
      bugHistory: 0.05,
      sideEffect: 0.05,
    },
    minScore: 5,
    includePaths: false,
    includeCycles: false,
    inferInterfaceChange: false,
    maxTestRecommendations: 4,
  },
  standard: {
    maxIndirectDistance: 3,
    weights: {
      proximity: 0.25,
      centrality: 0.25,
      fileType: 0.15,
      interfaceChange: 0.1,
      bugHistory: 0.15,
      sideEffect: 0.1,
    },
    minScore: 1,
    includePaths: false,
    includeCycles: true,
    inferInterfaceChange: true,
    maxTestRecommendations: 8,
  },
  deep: {
    maxIndirectDistance: 5,
    weights: {
      proximity: 0.2,
      centrality: 0.2,
      fileType: 0.1,
      interfaceChange: 0.15,
      bugHistory: 0.15,
      sideEffect: 0.2,
    },
    minScore: 0,
    includePaths: true,
    includeCycles: true,
    inferInterfaceChange: true,
    maxTestRecommendations: 14,
  },
  reverse: {
    maxIndirectDistance: 3,
    weights: {
      proximity: 0.3,
      centrality: 0.3,
      fileType: 0.1,
      interfaceChange: 0.1,
      bugHistory: 0.1,
      sideEffect: 0.1,
    },
    minScore: 1,
    includePaths: false,
    includeCycles: true,
    inferInterfaceChange: true,
    maxTestRecommendations: 8,
  },
};

// ─── Helpers globaux ─────────────────────────────────────────────────────────

function scoreToRisk(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImpactAnalyzer
// ═══════════════════════════════════════════════════════════════════════════════

export class ImpactAnalyzer {
  // ──────────────────────────────────────────────────────────────────────
  // API principale
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Analyse l'impact de la modification d'un ou plusieurs fichiers.
   */
  analyze(filePaths: string | string[], options: ImpactAnalysisOptions = {}): ExtendedImpactReport {
    const t0 = Date.now();
    const mode: ImpactMode = options.mode || "standard";
    const cfg = MODE_CONFIGS[mode];

    const modified = (Array.isArray(filePaths) ? filePaths : [filePaths]).map(normalizePath);
    const minScore = options.minScore ?? cfg.minScore;

    if (modified.length === 0) {
      return this.emptyReport(modified, mode, Date.now() - t0);
    }

    // 1) Rassembler tous les fichiers potentiellement impactés
    const impactedCandidates = this.collectImpactedFiles(modified, cfg, options);

    // 2) Pondérations effectives : fusion mode config + overrides
    const cfgWeights = cfg.weights ?? { proximity: 0.25, centrality: 0.25, fileType: 0.15, interfaceChange: 0.2, bugHistory: 0.1, sideEffect: 0.05 };
    const weights: ExtendedImpactReport["criteriaWeights"] = {
      proximity: options.weights?.proximity ?? cfgWeights.proximity,
      centrality: options.weights?.centrality ?? cfgWeights.centrality,
      fileType: options.weights?.fileType ?? cfgWeights.fileType,
      interfaceChange: options.weights?.interfaceChange ?? cfgWeights.interfaceChange,
      bugHistory: options.weights?.bugHistory ?? cfgWeights.bugHistory,
      sideEffect: options.weights?.sideEffect ?? cfgWeights.sideEffect,
    };

    // 3) Évaluer chaque fichier impacté
    const evaluated: ImpactedFile[] = [];
    for (const cand of impactedCandidates) {
      if (options.onlyInPaths && options.onlyInPaths.length > 0) {
        const anyMatch = options.onlyInPaths.some(
          (prefix) => cand.filePath.startsWith(normalizePath(prefix))
        );
        if (!anyMatch) continue;
      }
      if (!options.includeTests && this.isTestFile(cand.filePath)) continue;
      const ev = this.evaluateFile(cand, modified, { ...options, mode, weights, config: cfg });
      if (ev.impactScore >= minScore) evaluated.push(ev);
    }

    evaluated.sort((a, b) => b.impactScore - a.impactScore);

    // 4) Calcul du risque global : moyenne pondérée des fichiers impactés
    //    Le fichier modifié lui-même compte aussi via son score intrinsèque
    const globalRiskScore = this.computeGlobalRisk(modified, evaluated, weights);

    // 5) Cycles impactés (tous les cycles contenant au moins un fichier modifié ou impacté)
    const affectedCycles = cfg.includeCycles
      ? this.findAffectedCycles([...modified, ...evaluated.map((e) => e.filePath)])
      : [];

    // 6) Modules critiques impactés (centralité >= 10 ou marqués)
    const criticalModules = evaluated
      .filter((e) => e.isCritical)
      .map((e) => e.filePath);

    // 7) Impacts directs / indirects (compatibilité avec ImpactReport)
    const directImpacts = evaluated.filter((e) => e.distance === 1).map((e) => e.filePath);
    const indirectImpacts = evaluated.filter((e) => e.distance > 1).map((e) => e.filePath);

    // 8) Breakdown du risque global (%)
    const breakdown = this.computeRiskBreakdown(evaluated, weights);

    // 9) Recommandations de tests
    const testRecommendations = this.buildTestRecommendations(
      modified, evaluated, globalRiskScore, mode
    ).slice(0, cfg.maxTestRecommendations);

    // 10) Hiérarchie des validations
    const validationOrder = this.buildValidationOrder(
      modified, evaluated, globalRiskScore, mode
    );

    // 11) Compatibilité ImpactReport historique : filePath prend le 1er fichier
    const primaryModified = modified[0];

    const report: ExtendedImpactReport = {
      mode,
      modifiedFiles: modified,
      filePath: primaryModified,
      directImpacts,
      indirectImpacts,
      riskScore: Math.round(globalRiskScore * 10) / 10,
      totalImpacted: evaluated.length,
      affectedCycles,
      criticalModulesAffected: criticalModules,
      impactedFiles: evaluated,
      riskBreakdown: breakdown,
      criteriaWeights: weights,
      overallRisk: scoreToRisk(globalRiskScore),
      testRecommendations,
      validationOrder,
      markdownReport: "",
      generatedAt: new Date().toISOString(),
      computationMs: Date.now() - t0,
    };

    // Générer le rapport Markdown
    report.markdownReport = this.generateMarkdownReport(report);

    log.info(
      `📊 ImpactAnalyzer [${mode}] ${modified.length} fichier(s) → ` +
      `${evaluated.length} impacté(s), risque=${report.overallRisk} (${report.riskScore.toFixed(0)}/100), ` +
      `${affectedCycles.length} cycle(s), ${criticalModules.length} critique(s) — ${report.computationMs}ms`
    );

    return report;
  }

  /**
   * Raccourci : mode "quick" pour une évaluation ultra rapide.
   */
  quickAnalyze(filePath: string): ExtendedImpactReport {
    return this.analyze(filePath, { mode: "quick" });
  }

  /**
   * Raccourci : mode "deep" pour une analyse exhaustive.
   */
  deepAnalyze(filePaths: string | string[]): ExtendedImpactReport {
    return this.analyze(filePaths, { mode: "deep" });
  }

  /**
   * Mode reverse : à partir d'un fichier F, retourne l'ensemble des fichiers
   * QUI IMPACTENT F (i.e. dépendances de F, récursivement).
   * Utile pour répondre : « si ce test échoue, où chercher ? »
   */
  reverseAnalyze(targetFilePath: string, options: ImpactAnalysisOptions = {}): ExtendedImpactReport {
    return this.analyze(targetFilePath, { ...options, mode: "reverse" });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Étape 1 : Collecter les fichiers impactés via le graphe
  // ──────────────────────────────────────────────────────────────────────

  private collectImpactedFiles(
    modified: string[],
    cfg: ModeConfig,
    options: ImpactAnalysisOptions
  ): { filePath: string; distance: number }[] {
    const results = new Map<string, number>();
    const maxDist = cfg.maxIndirectDistance;

    for (const mod of modified) {
      // Mode reverse : on regarde ce que MOD dépend (impacts "venant de l'amont")
      // Mode normal : on regarde ce qui dépend de MOD (impacts "en aval")
      const chain =
        options.mode === "reverse"
          ? dependencyGraph.getDependencyChain(mod)
          : dependencyGraph.getImpactChain(mod);

      // chain[0] = mod lui-même. On l'inclut avec distance 0.
      for (let i = 0; i < chain.length; i++) {
        if (i > maxDist) break;
        const filePath = normalizePath(chain[i]);
        const distance = i; // 0 = fichier modifié, 1 = direct, 2+ indirect
        const prev = results.get(filePath);
        if (prev === undefined || distance < prev) {
          results.set(filePath, distance);
        }
      }
    }

    return Array.from(results.entries()).map(([filePath, distance]) => ({ filePath, distance }));
  }

  // ──────────────────────────────────────────────────────────────────────
  // Étape 3 : évaluation d'1 fichier impacté — 6 critères
  // ──────────────────────────────────────────────────────────────────────

  private evaluateFile(
    cand: { filePath: string; distance: number },
    modified: string[],
    ctx: {
      mode: ImpactMode;
      weights: ExtendedImpactReport["criteriaWeights"];
      config: ModeConfig;
      interfaceHeuristic?: boolean;
      maxPathsPerPair?: number;
    }
  ): ImpactedFile {
    const { filePath, distance } = cand;

    // ── Critère 1 : Proximity (0-1) ───────────────────────────────────
    // distance 0 (fichier lui-même) → 1.0 ; distance 1 → 0.8 ; distance décroit
    const proximity = Math.max(0, 1 - distance * 0.25);

    // ── Critère 2 : Centrality (0-1) ──────────────────────────────────
    const centrality = this.criterionCentrality(filePath);

    // ── Critère 3 : File Type (0-1) ──────────────────────────────────
    const fileType = this.criterionFileType(filePath);

    // ── Critère 4 : Interface Change Risk (0-1) ──────────────────────
    let interfaceChange = 0;
    if (ctx.config.inferInterfaceChange || ctx.interfaceHeuristic) {
      interfaceChange = this.criterionInterfaceChange(filePath, modified);
    }

    // ── Critère 5 : Bug History via ProjectMemory (0-1) ──────────────
    const bugHistory = this.criterionBugHistory(filePath);

    // ── Critère 6 : Side Effect Risk (0-1) ────────────────────────────
    const sideEffect = this.criterionSideEffect(filePath);

    // ── Agrégation pondérée ──────────────────────────────────────────
    const w = ctx.weights;
    const weighted =
      proximity * w.proximity +
      centrality * w.centrality +
      fileType * w.fileType +
      interfaceChange * w.interfaceChange +
      bugHistory * w.bugHistory +
      sideEffect * w.sideEffect;

    const impactScore = Math.max(0, Math.min(100, Math.round(weighted * 100)));

    // ── Raisons textuelles ───────────────────────────────────────────
    const reasons: string[] = [];
    if (distance === 0) reasons.push("Fichier modifié directement");
    else if (distance === 1) reasons.push("Dépendant direct du fichier modifié");
    else reasons.push(`Dépendance indirecte (distance ${distance})`);

    if (centrality >= 0.66) reasons.push(`Fichier très central (${Math.round(centrality * 100)}%)`);
    else if (centrality >= 0.33) reasons.push(`Fichier modérément central (${Math.round(centrality * 100)}%)`);

    if (fileType >= 0.75) reasons.push("Fichier de cœur / configuration critique");
    else if (fileType >= 0.5) reasons.push("Fichier source important");

    if (interfaceChange >= 0.7) reasons.push("Risque élevé de modification d'interface publique");
    else if (interfaceChange >= 0.4) reasons.push("Possible impact sur signatures / exports");

    if (bugHistory >= 0.6) reasons.push("Historique de bugs / problèmes connus");
    else if (bugHistory >= 0.3) reasons.push("Quelques faits mémoire liés à des incidents passés");

    if (sideEffect >= 0.6) reasons.push("Risque d'effets de bord globaux / mutables");

    // ── Chemins + cycles (mode deep) ──────────────────────────────────
    const dependencyPaths: string[][] | undefined = ctx.config.includePaths
      ? this.findPathsToImpacted(modified, filePath, ctx.maxPathsPerPair ?? 3)
      : undefined;

    const partOfCycles: DependencyCycle[] | undefined = ctx.config.includeCycles
      ? this.findCyclesForFile(filePath)
      : undefined;

    const isCritical = centrality >= 0.8 || this.inCriticalModulesList(filePath);

    return {
      filePath,
      distance,
      impactScore,
      risk: scoreToRisk(impactScore),
      criteria: {
        proximity,
        centrality,
        fileType,
        interfaceChange,
        bugHistory,
        sideEffect,
      },
      reasons,
      dependencyPaths,
      partOfCycles,
      isCritical,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Implémentation des 6 critères
  // ──────────────────────────────────────────────────────────────────────

  /** Critère 2 : Centralité — basé sur le nombre de dépendants transitifs */
  private criterionCentrality(filePath: string): number {
    try {
      // getImpactChain retourne fichier + tous ses dépendants
      const chain = dependencyGraph.getImpactChain(filePath);
      // chain.length - 1 = nb dépendants transitifs
      const dependents = Math.max(0, chain.length - 1);
      // Seuil : 0 → 0, 1 → 0.2, 5 → 0.5, 20+ → 1.0
      const raw = 1 - Math.exp(-dependents / 8);
      return Math.round(raw * 100) / 100;
    } catch {
      return 0;
    }
  }

  /** Critère 3 : File Type — heuristique sur nom et extension */
  private criterionFileType(filePath: string): number {
    const lower = filePath.toLowerCase();
    const name = lower.split("/").pop() || lower;

    // Configs critiques
    if (/\b(tsconfig|package|eslint|webpack|vite|dockerfile|\.env|jest|vitest)\b/.test(lower) ||
        /\.(ya?ml|json|toml)$/.test(lower) && /(config|deploy|setup|build|tsconfig)/.test(lower)) {
      return 0.95;
    }

    // Fichiers sources cœurs du système Leanna
    if (/server\/(knowledge|mission|agents|skills|orchestration|tools)\//.test(lower)) {
      return 0.8;
    }

    // Routes / handlers / controllers / auth / security
    if (/(route|handler|controller|auth|security|middleware|schema|models?)\.(ts|js)$/.test(name)) {
      return 0.75;
    }

    // Barrel exports
    if (name === "index.ts" || name === "index.js") {
      return 0.6;
    }

    // Types / interfaces (changement = impact sur les consommateurs)
    if (/(types|interfaces|contracts?)\.(ts)$/.test(name)) {
      return 0.7;
    }

    // Tests (moins risqué car ne dégrade pas la prod)
    if (this.isTestFile(lower)) {
      return 0.2;
    }

    // Assets / styles / docs
    if (/\.(css|scss|less|md|svg|png|jpg|jpeg|gif|ico)$/.test(lower)) {
      return 0.1;
    }

    // Autres fichiers TS/JS standard
    if (/\.(ts|js|tsx|jsx)$/.test(lower)) {
      return 0.45;
    }

    return 0.3;
  }

  /** Critère 4 : Interface Change — heuristique sur les exports, types, etc. */
  private criterionInterfaceChange(filePath: string, modified: string[]): number {
    const lower = filePath.toLowerCase();
    const normFp = normalizePath(filePath);
    // Si c'est le fichier modifié lui-même (ou l'un d'eux)
    const isModifiedItself = modified.map(normalizePath).includes(normFp);

    // 1) Fichier de types — modification = très haut risque de changement d'interface
    if (/(types|interfaces|api\.ts|contract)\.ts$/i.test(lower)) {
      return isModifiedItself ? 0.9 : 0.6;
    }
    // 2) Barrel index
    if (/\/index\.(ts|js)$/i.test(lower)) {
      return isModifiedItself ? 0.8 : 0.5;
    }
    // 3) Fichier Skill / agent / orchestreur — exports publics
    if (/(server\/skills|server\/agents|server\/mission|server\/knowledge)\/[^/]*\.(ts|js)$/i.test(lower)) {
      return isModifiedItself ? 0.75 : 0.45;
    }
    // 4) Fichier TS "classique"
    if (/\.(ts|tsx|js|jsx)$/i.test(lower)) {
      return isModifiedItself ? 0.5 : 0.25;
    }
    return isModifiedItself ? 0.3 : 0.1;
  }

  /** Critère 5 : Bug History via ProjectMemory */
  private criterionBugHistory(filePath: string): number {
    try {
      const norm = normalizePath(filePath);
      // Chercher des faits mémoire concernant ce fichier ou son module
      const facts = projectMemory.searchFacts(norm, 20);
      let score = 0;
      for (const fact of facts) {
        const lower = fact.content.toLowerCase();
        if (
          /bug|erreur|échec|fail|issue|problème|défaut|défaillance|cassure|régression|panne/i.test(lower)
        ) {
          score = Math.max(score, fact.confidence * 0.9);
        } else if (/attention|warning|à surveiller|délicat|fragile|attention/i.test(lower)) {
          score = Math.max(score, fact.confidence * 0.5);
        } else {
          score = Math.max(score, fact.confidence * 0.2);
        }
      }
      return Math.round(score * 100) / 100;
    } catch {
      return 0;
    }
  }

  /** Critère 6 : Side effect — heuristique sur globaux/mutable/singleton */
  private criterionSideEffect(filePath: string): number {
    const lower = filePath.toLowerCase();
    // Fichiers racine "stateful"
    if (/(server\.ts|index\.ts|main\.ts|app\.ts|bootstrap|startup)$/i.test(lower) ||
        lower.split("/").pop() === "server.ts") {
      return 0.85;
    }
    // Knowledge / Memory — mutable global
    if (/(projectmemory|knowledgegraph|semanticsearch|dependencygraph|impactanalyzer|reasoningpipeline|reflection)/i.test(lower)) {
      return 0.75;
    }
    // Mission / Orchestration — stateful
    if (/(missionmanager|missionengine|planner|orchestr|executor)/i.test(lower)) {
      return 0.7;
    }
    // Logger / config / variables globales
    if (/(logger|config|env\.ts|settings|constants)/i.test(lower)) {
      return 0.55;
    }
    // Classes utilitaires pures (ex: formatting, helpers hors I/O)
    if (/(utils|helper|format|parse|encode|decode|hash|string)\.(ts|js)$/i.test(lower)) {
      return 0.25;
    }
    // Tests → peu d'effets de bord sur prod
    if (this.isTestFile(lower)) return 0.1;
    // Défaut
    return 0.4;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Agrégation : risque global + breakdown
  // ──────────────────────────────────────────────────────────────────────

  private computeGlobalRisk(
    modified: string[],
    impacted: ImpactedFile[],
    _weights: ExtendedImpactReport["criteriaWeights"]
  ): number {
    if (impacted.length === 0) return 0;

    // Somme pondérée par 1/(distance+1) : fichiers proches ont plus d'influence
    let numerator = 0;
    let denominator = 0;
    for (const imp of impacted) {
      const distWeight = 1 / (imp.distance + 1);
      numerator += imp.impactScore * distWeight;
      denominator += distWeight;
    }
    const base = denominator > 0 ? numerator / denominator : 0;

    // Bonus si le fichier modifié lui-même est critique
    let selfRisk = 0;
    for (const mod of modified) {
      const modEntry = impacted.find((i) => i.filePath === normalizePath(mod));
      if (modEntry) selfRisk = Math.max(selfRisk, modEntry.impactScore);
    }
    // Fusion 60% base impactés + 40% risque intrinsèque du fichier modifié
    return Math.round(base * 0.6 + selfRisk * 0.4);
  }

  private computeRiskBreakdown(
    impacted: ImpactedFile[],
    weights: ExtendedImpactReport["criteriaWeights"]
  ): ExtendedImpactReport["riskBreakdown"] {
    const empty: ExtendedImpactReport["riskBreakdown"] = {
      proximity: 0, centrality: 0, fileType: 0,
      interfaceChange: 0, bugHistory: 0, sideEffect: 0,
    };
    if (impacted.length === 0) return empty;

    let totalProx = 0, totalCent = 0, totalFT = 0, totalIC = 0, totalBH = 0, totalSE = 0;
    let weightSum = 0;
    for (const imp of impacted) {
      const w = 1 / (imp.distance + 1);
      totalProx += imp.criteria.proximity * weights.proximity * 100 * w;
      totalCent += imp.criteria.centrality * weights.centrality * 100 * w;
      totalFT  += imp.criteria.fileType   * weights.fileType   * 100 * w;
      totalIC  += imp.criteria.interfaceChange * weights.interfaceChange * 100 * w;
      totalBH  += imp.criteria.bugHistory * weights.bugHistory * 100 * w;
      totalSE  += imp.criteria.sideEffect * weights.sideEffect * 100 * w;
      weightSum += w;
    }
    if (weightSum === 0) return empty;
    const rawTotal = totalProx + totalCent + totalFT + totalIC + totalBH + totalSE;
    if (rawTotal === 0) return empty;
    return {
      proximity: Math.round((totalProx / rawTotal) * 100),
      centrality: Math.round((totalCent / rawTotal) * 100),
      fileType: Math.round((totalFT / rawTotal) * 100),
      interfaceChange: Math.round((totalIC / rawTotal) * 100),
      bugHistory: Math.round((totalBH / rawTotal) * 100),
      sideEffect: Math.round((totalSE / rawTotal) * 100),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Recommandations de tests & hiérarchie de validation
  // ──────────────────────────────────────────────────────────────────────

  private buildTestRecommendations(
    modified: string[],
    impacted: ImpactedFile[],
    globalRisk: number,
    mode: ImpactMode
  ): TestRecommendation[] {
    const recs: TestRecommendation[] = [];
    const now = Date.now(); void now;
    void mode;

    // 0) Validation statique obligatoire pour risque >= medium
    if (globalRisk >= 20) {
      recs.push({
        priority: "must",
        kind: "typecheck",
        scope: "projet entier",
        description: "Vérifier la compilation TypeScript sans erreur",
        rationale: "Garantit la cohérence de type après modifications.",
      });
      recs.push({
        priority: "should",
        kind: "lint",
        scope: modified.join(", "),
        description: "Linter les fichiers modifiés",
        rationale: "Respect des conventions et détection d'erreurs statiques.",
      });
    }

    // 1) Tests unitaires ciblés sur le fichier modifié
    for (const mod of modified) {
      const testFile = this.findCorrespondingTest(mod);
      if (testFile) {
        recs.push({
          priority: "must",
          kind: "unit",
          scope: testFile,
          description: `Exécuter les tests unitaires de ${mod.split("/").pop()}`,
          rationale: "Validation directe du comportement du fichier modifié.",
        });
      } else {
        recs.push({
          priority: "should",
          kind: "manual",
          scope: mod,
          description: `Vérifier manuellement le comportement de ${mod.split("/").pop()} (pas de tests unitaires trouvés)`,
          rationale: "Absence de tests automatisés couvrant ce module.",
        });
      }
    }

    // 2) Tests unitaires des top-3 dépendants directs
    const topDirect = impacted.filter((i) => i.distance === 1).slice(0, 3);
    for (const imp of topDirect) {
      if (imp.risk === "low") continue;
      const testFile = this.findCorrespondingTest(imp.filePath);
      if (testFile) {
        recs.push({
          priority: imp.risk === "critical" || imp.risk === "high" ? "must" : "should",
          kind: "unit",
          scope: testFile,
          description: `Rejouer les tests unitaires de ${imp.filePath.split("/").pop()} (dépendant direct)`,
          rationale: `Raison: ${imp.reasons[0] || "impact direct"} — score ${imp.impactScore}/100.`,
        });
      }
    }

    // 3) Tests d'intégration pour risque >= high
    if (globalRisk >= 45) {
      const scope =
        impacted.filter((i) => i.impactScore >= 40).map((i) => i.filePath.split("/").pop()).slice(0, 5).join(", ") ||
        "modules critiques";
      recs.push({
        priority: "must",
        kind: "integration",
        scope,
        description: "Exécuter les tests d'intégration des modules impactés",
        rationale: `Risque global ${globalRisk}/100 — interactions inter-modules à valider.`,
      });
    }

    // 4) Build pour risque critique
    if (globalRisk >= 75) {
      recs.push({
        priority: "must",
        kind: "build",
        scope: "projet entier",
        description: "Lancer un build complet du projet",
        rationale: "Risque critique : s'assurer qu'aucun fichier produit n'est cassé.",
      });
    }

    // 5) E2E / manuel pour risque très élevé ou fichiers critiques
    const criticals = impacted.filter((i) => i.risk === "critical");
    if (criticals.length > 0 || globalRisk >= 80) {
      recs.push({
        priority: "must",
        kind: "manual",
        scope: criticals.map((i) => i.filePath).join(", ") || "flux principaux",
        description: "Validation manuelle des parcours critiques (smoke test)",
        rationale: "Aucun test automatisé ne peut remplacer la vérification humaine à ce niveau de risque.",
      });
    }

    // Dédupliquer approximativement
    const seen = new Set<string>();
    return recs.filter((r) => {
      const key = `${r.kind}:${r.scope.slice(0, 60)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  private buildValidationOrder(
    modified: string[],
    impacted: ImpactedFile[],
    globalRisk: number,
    mode: ImpactMode
  ): ExtendedImpactReport["validationOrder"] {
    void mode;
    const steps: ExtendedImpactReport["validationOrder"] = [];
    let stepNum = 0;

    // Étape 1 : rapide, pas cher, haut signal (typecheck)
    steps.push({
      step: ++stepNum,
      label: "Typecheck / compilation",
      commands: ["tsc --noEmit"],
      required: globalRisk >= 20,
      estimatedRiskReduction: 0.25,
    });

    // Étape 2 : lint fichiers modifiés
    if (globalRisk >= 20) {
      steps.push({
        step: ++stepNum,
        label: "Lint fichiers modifiés",
        commands: modified.map((m) => `eslint ${m}`),
        required: false,
        estimatedRiskReduction: 0.1,
      });
    }

    // Étape 3 : tests unitaires fichiers modifiés
    const testsToRun = modified.map(this.findCorrespondingTest).filter(Boolean) as string[];
    if (testsToRun.length > 0) {
      steps.push({
        step: ++stepNum,
        label: "Tests unitaires — fichiers modifiés",
        commands: testsToRun.map((t) => `npx vitest run ${t}`),
        required: true,
        estimatedRiskReduction: 0.25,
      });
    }

    // Étape 4 : tests unitaires des dépendants impactés
    const topImpactedTests = impacted
      .filter((i) => i.distance >= 1)
      .slice(0, 4)
      .map((i) => this.findCorrespondingTest(i.filePath))
      .filter(Boolean) as string[];
    if (topImpactedTests.length > 0 && globalRisk >= 30) {
      steps.push({
        step: ++stepNum,
        label: "Tests unitaires — dépendants impactés",
        commands: topImpactedTests.map((t) => `npx vitest run ${t}`),
        required: globalRisk >= 50,
        estimatedRiskReduction: 0.2,
      });
    }

    // Étape 5 : build / tests d'intégration
    if (globalRisk >= 45) {
      steps.push({
        step: ++stepNum,
        label: "Tests d'intégration + build complet",
        commands: [
          "npm run test:integration",
          "npm run build",
        ],
        required: globalRisk >= 70,
        estimatedRiskReduction: 0.3,
      });
    }

    // Étape 6 : smoke test manuel pour risque critique
    if (globalRisk >= 75) {
      steps.push({
        step: ++stepNum,
        label: "Smoke test manuel",
        commands: [],
        required: true,
        estimatedRiskReduction: 0.15,
      });
    }

    return steps;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers pour chemins, cycles, tests, modules critiques
  // ──────────────────────────────────────────────────────────────────────

  private findPathsToImpacted(modified: string[], target: string, max: number): string[][] {
    const out: string[][] = [];
    for (const mod of modified) {
      const path = dependencyGraph.findDependencyPath(mod, target);
      if (path && path.length > 0) {
        out.push(path);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  private findCyclesForFile(filePath: string): DependencyCycle[] {
    try {
      const allCycles = dependencyGraph.detectCycles();
      return allCycles.filter((c) =>
        c.files.some((f) => normalizePath(f) === normalizePath(filePath))
      );
    } catch {
      return [];
    }
  }

  private findAffectedCycles(filePaths: string[]): DependencyCycle[] {
    try {
      const norm = new Set(filePaths.map(normalizePath));
      const cycles = dependencyGraph.detectCycles();
      return cycles.filter((c) => c.files.some((f) => norm.has(normalizePath(f))));
    } catch {
      return [];
    }
  }

  private inCriticalModulesList(filePath: string): boolean {
    try {
      const critical = dependencyGraph.getCriticalModules(8);
      const norm = normalizePath(filePath);
      return critical.some((c) => normalizePath(c.filePath) === norm);
    } catch {
      return false;
    }
  }

  private isTestFile(p: string): boolean {
    return /\.(test|spec|tests?)\.(ts|tsx|js|jsx)$/i.test(p) || /(__tests__|tests?)\//i.test(p);
  }

  private findCorrespondingTest(filePath: string): string | null {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return null;
    const base = filePath.replace(/\.(ts|tsx|js|jsx)$/i, "");
    const candidates = [
      `${base}.test.ts`,
      `${base}.spec.ts`,
      `${base}.test.tsx`,
      `${base}.spec.js`,
      base.replace(/([^/]+)$/, "__tests__/$1.test.ts"),
    ];
    for (const c of candidates) {
      try {
        if (knowledgeGraph.getFile(c)) return c;
      } catch { /* ignore */ }
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Rapport Markdown
  // ──────────────────────────────────────────────────────────────────────

  private generateMarkdownReport(r: ExtendedImpactReport): string {
    const lines: string[] = [];
    const riskIcon = r.overallRisk === "critical" ? "🔴"
      : r.overallRisk === "high" ? "🟠"
      : r.overallRisk === "medium" ? "🟡"
      : "🟢";

    lines.push(`# Rapport d'impact — ${r.mode}`);
    lines.push("");
    lines.push(`> Généré le ${new Date(r.generatedAt).toLocaleString()} en ${r.computationMs}ms`);
    lines.push("");

    // 1. Synthèse
    lines.push(`## 1. Synthèse`);
    lines.push("");
    lines.push(`${riskIcon} **Risque global : ${r.overallRisk.toUpperCase()} (${r.riskScore}/100)**`);
    lines.push("");
    lines.push(`| Indicateur | Valeur |`);
    lines.push(`|---|---|`);
    lines.push(`| Fichiers modifiés | ${r.modifiedFiles.length} |`);
    lines.push(`| Fichiers impactés | **${r.totalImpacted}** |`);
    lines.push(`| · directs | ${r.directImpacts.length} |`);
    lines.push(`| · indirects | ${r.indirectImpacts.length} |`);
    lines.push(`| Cycles impactés | ${r.affectedCycles.length} |`);
    lines.push(`| Modules critiques | ${r.criticalModulesAffected.length} |`);
    lines.push(`| Nb recommandations tests | ${r.testRecommendations.length} |`);
    lines.push(`| Étapes de validation | ${r.validationOrder.length} |`);
    lines.push("");

    // 1b. Fichiers modifiés
    lines.push(`### Fichiers modifiés`);
    lines.push("");
    for (const m of r.modifiedFiles) lines.push(`- \`${m}\``);
    lines.push("");

    // 2. Breakdown du risque
    lines.push(`## 2. Décomposition du risque global (${r.mode})`);
    lines.push("");
    lines.push("| Critère | Poids utilisé | Contribution au risque |");
    lines.push("|---|---|---|");
    const critLabels: Record<keyof typeof r.riskBreakdown, string> = {
      proximity: "📏 Proximité",
      centrality: "🕸️ Centralité",
      fileType: "📁 Type de fichier",
      interfaceChange: "🔌 Changement d'interface",
      bugHistory: "🐛 Historique de bugs",
      sideEffect: "⚡ Effets de bord",
    };
    const weightsTotal = Object.values(r.criteriaWeights).reduce((s, v) => s + v, 0) || 1;
    for (const key of Object.keys(critLabels) as (keyof typeof r.riskBreakdown)[]) {
      const weight = r.criteriaWeights[key];
      const pct = r.riskBreakdown[key];
      const weightPct = Math.round((weight / weightsTotal) * 100);
      lines.push(`| ${critLabels[key]} | ${weightPct}% | ${pct}% |`);
    }
    lines.push("");

    // 3. Top fichiers impactés
    lines.push(`## 3. Fichiers impactés (Top 10)`);
    lines.push("");
    lines.push("| # | Fichier | Distance | Score | Risque | Critique | Pourquoi |");
    lines.push("|---|---|---|---|---|---|---|");
    const top = r.impactedFiles.slice(0, 10);
    top.forEach((f, idx) => {
      lines.push(
        `| ${idx + 1} | \`${f.filePath}\` | ${f.distance} | **${f.impactScore}** | ${f.risk} | ${f.isCritical ? "✅" : "·"} | ${f.reasons.slice(0, 2).join(" · ")} |`
      );
    });
    if (r.impactedFiles.length > top.length) {
      lines.push(`| _…_ | _${r.impactedFiles.length - top.length} fichiers supplémentaires_ | — | — | — | — | _voir rapport complet_ |`);
    }
    lines.push("");

    // 4. Cycles + modules critiques
    if (r.affectedCycles.length > 0 || r.criticalModulesAffected.length > 0) {
      lines.push(`## 4. Cycles et modules critiques`);
      lines.push("");
      if (r.criticalModulesAffected.length > 0) {
        lines.push(`### Modules critiques impactés (${r.criticalModulesAffected.length})`);
        for (const c of r.criticalModulesAffected) lines.push(`- ⚠️ \`${c}\``);
        lines.push("");
      }
      if (r.affectedCycles.length > 0) {
        lines.push(`### Cycles impactés (${r.affectedCycles.length})`);
        for (const cyc of r.affectedCycles.slice(0, 5)) {
          lines.push(`- Cycle (taille ${cyc.length}) : ${cyc.files.map((f) => `\`${f}\``).join(" → ")}`);
        }
        if (r.affectedCycles.length > 5) lines.push(`- …et ${r.affectedCycles.length - 5} autres cycles`);
        lines.push("");
      }
    }

    // 5. Recommandations de tests
    lines.push(`## 5. Recommandations de tests`);
    lines.push("");
    if (r.testRecommendations.length === 0) {
      lines.push(`_Aucune recommandation de test pour ce niveau d'impact._`);
    } else {
      lines.push("| Priorité | Type | Scope | Description |");
      lines.push("|---|---|---|---|");
      for (const t of r.testRecommendations) {
        const p = t.priority === "must" ? "🔴 **MUST**" : t.priority === "should" ? "🟡 **SHOULD**" : "🔵 MAY";
        lines.push(`| ${p} | ${t.kind} | \`${t.scope.slice(0, 80)}${t.scope.length > 80 ? "…" : ""}\` | ${t.description} |`);
      }
    }
    lines.push("");

    // 6. Hiérarchie des validations
    lines.push(`## 6. Ordre de validation recommandé`);
    lines.push("");
    if (r.validationOrder.length === 0) {
      lines.push(`_Aucune étape de validation spécifique requise._`);
    } else {
      lines.push("| Étape | Action | Requise | Commande(s) | Gain de confiance estimé |");
      lines.push("|---|---|---|---|---|");
      for (const s of r.validationOrder) {
        lines.push(
          `| ${s.step} | ${s.label} | ${s.required ? "✅ OUI" : "· non"} | ${s.commands && s.commands.length > 0 ? "`" + s.commands.join("` · `") + "`" : "manuel"} | ${Math.round(s.estimatedRiskReduction * 100)}% |`
        );
      }
    }
    lines.push("");

    // 7. Chemins de dépendance (mode deep)
    const withPaths = r.impactedFiles.filter((f) => f.dependencyPaths && f.dependencyPaths.length > 0).slice(0, 5);
    if (withPaths.length > 0) {
      lines.push(`## 7. Chemins de dépendance (Top 5 — mode deep)`);
      lines.push("");
      for (const f of withPaths) {
        lines.push(`### \`${f.filePath}\` (score ${f.impactScore}/100)`);
        for (const path of f.dependencyPaths!.slice(0, 3)) {
          lines.push(`- ${path.map((p) => `\`${p}\``).join(" → ")}`);
        }
        lines.push("");
      }
    }

    // 8. Conclusion
    lines.push(`## 8. Conclusion`);
    lines.push("");
    if (r.overallRisk === "low") {
      lines.push(`✅ Impact faible — peut poursuivre en suivant les validations rapides.`);
    } else if (r.overallRisk === "medium") {
      lines.push(`🟡 Impact modéré — respecter impérativement les étapes 1 à 3 de validation.`);
    } else if (r.overallRisk === "high") {
      lines.push(`🟠 Impact élevé — **toutes** les recommandations \`must\` sont obligatoires avant merge/poursuite.`);
    } else {
      lines.push(`🔴 Impact CRITIQUE — revoir la conception si possible ; exécuter **toutes** les étapes, y compris le smoke test manuel.`);
    }

    return lines.join("\n");
  }

  // ──────────────────────────────────────────────────────────────────────
  // Rapport vide
  // ──────────────────────────────────────────────────────────────────────

  private emptyReport(modified: string[], mode: ImpactMode, durationMs: number): ExtendedImpactReport {
    return {
      mode,
      modifiedFiles: modified,
      filePath: modified[0] || "",
      directImpacts: [],
      indirectImpacts: [],
      riskScore: 0,
      totalImpacted: 0,
      affectedCycles: [],
      criticalModulesAffected: [],
      impactedFiles: [],
      riskBreakdown: { proximity: 0, centrality: 0, fileType: 0, interfaceChange: 0, bugHistory: 0, sideEffect: 0 },
      criteriaWeights: MODE_CONFIGS[mode].weights ?? { proximity: 0.25, centrality: 0.25, fileType: 0.15, interfaceChange: 0.2, bugHistory: 0.1, sideEffect: 0.05 },
      overallRisk: "low",
      testRecommendations: [],
      validationOrder: [],
      markdownReport: "# Rapport d'impact — Aucun fichier à analyser\n",
      generatedAt: new Date().toISOString(),
      computationMs: durationMs,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée d'ImpactAnalyzer */
export const impactAnalyzer = new ImpactAnalyzer();
