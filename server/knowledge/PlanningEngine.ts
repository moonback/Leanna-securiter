/**
 * PlanningEngine — Planification d'exécution multi-fichiers
 *
 * Sprint 8 — Objectifs :
 *   • Ordonner une liste de fichiers à modifier/visiter dans l'ordre le plus safe
 *   • Utiliser DependencyGraph : topologique + dépendances
 *   • Détecter des groupes parallélisables (waves = ensembles de fichiers
 *     sans dépendances mutuelles, exécutables en parallèle)
 *   • Appliquer des stratégies de minimisation de risque via ImpactAnalyzer
 *   • Générer des plans structurés : étapes, validations intermédiaires,
 *     estimations de risque cumulé, rapports lisibles
 *
 * Types principaux :
 *   PlanningStrategy    — 5 stratégies d'ordonnancement
 *   PlanningStep        — Une étape atomique du plan (1 fichier + validations)
 *   ParallelWave        — Groupe d'étapes exécutables en parallèle
 *   StructuredPlan      — Plan complet avec waves + risques + validations + markdown
 *
 * Intégrations :
 *   DependencyGraph   — ordre topologique, cycles, couplage
 *   ImpactAnalyzer    — risque par fichier, recommandations de tests
 */

import { createLogger } from "../utils/logger.js";
import { dependencyGraph } from "./DependencyGraph.js";
import { impactAnalyzer } from "./ImpactAnalyzer.js";
import type { ImpactMode, ExtendedImpactReport, TestRecommendation } from "./ImpactAnalyzer.js";

const log = createLogger("PlanningEngine");

// ═══════════════════════════════════════════════════════════════════════════════
// Types Sprint 8
// ═══════════════════════════════════════════════════════════════════════════════

/** Stratégie d'ordonnancement du plan */
export type PlanningStrategy =
  | "dependency"      // Tri topologique (dépendances d'abord) — stratégie par défaut
  | "reverse"         // Tri topologique inversé (feuilles d'abord, puis racines)
  | "risk_first"      // Moins risqué en premier, augmenter la confiance progressivement
  | "risk_last"       // Plus risqué en premier (attaquer le dur tôt)
  | "critical_path";  // Chemin critique (fichiers les plus centraux en premier)

/** Mode d'estimation du risque — impacte l'analyse utilisée */
export type PlanningRiskMode = "quick" | "standard" | "deep";

/** Une étape du plan : 1 fichier + métadonnées + validations à exécuter après */
export interface PlanningStep {
  /** Identifiant unique de l'étape au sein du plan */
  id: string;
  /** Index global (0-based) dans le plan séquentiel */
  index: number;
  /** Fichier cible de l'étape */
  filePath: string;
  /** Type d'action suggérée */
  action: "read" | "modify" | "create" | "delete" | "verify";
  /** Raccourci d'affichage */
  label: string;
  /** Couche / vague parallèle (0-based) */
  wave: number;
  /** Distance depuis la racine / dépendance (0 = racine) */
  depth: number;
  /** Nombre de dépendances dans cet ensemble (entrantes dans le sous-graphe) */
  prerequisitesCount: number;
  /** Nombre de dépendants (sortants) */
  dependentsCount: number;
  /** Estimation de risque 0–100 (par ImpactAnalyzer ou heuristique) */
  estimatedRisk: number;
  /** Risque cumulé depuis le début jusqu'ici (borne supérieure) */
  cumulativeRiskUpto: number;
  /** Risque relâché après cette étape si on valide bien */
  residualRiskAfter: number;
  /** Pourquoi cette étape est là (dépendances / stratégie) */
  rationale: string[];
  /** Validations à exécuter APRES cette étape */
  validations: {
    kind: "typecheck" | "lint" | "unit" | "integration" | "manual";
    scope: string;
    required: boolean;
    description: string;
  }[];
  /** Vérifications AVANT de pouvoir exécuter cette étape */
  preconditions: string[];
  /** Durée estimée en millisecondes (très grossière) */
  estimatedDurationMs: number;
  /** Étape est-elle un point de contrôle obligatoire ? */
  checkpoint?: boolean;
  /** Tags additionnels */
  tags: string[];
}

/** Groupe d'étapes parallélisables : aucune dépendance entre étapes d'une même vague */
export interface ParallelWave {
  /** Index de vague (0 = premières étapes) */
  index: number;
  /** Étapes contenues dans cette vague */
  steps: PlanningStep[];
  /** Risque maximum parmi les étapes */
  peakRisk: number;
  /** Risque moyen des étapes */
  averageRisk: number;
  /** Durée cumulée si en série */
  sequentialDurationMs: number;
  /** Durée si parfaitement parallèle (goulot = étape la plus longue) */
  parallelDurationMs: number;
  /** Est-ce un point de synchronisation obligatoire ? */
  requiresSync: boolean;
  /** Validations croisées inter-étapes */
  crossValidations: string[];
}

/** Plan complet structuré */
export interface StructuredPlan {
  /** Stratégie utilisée */
  strategy: PlanningStrategy;
  /** Mode de risque */
  riskMode: PlanningRiskMode;
  /** Fichiers cibles originaux */
  targetFiles: string[];
  /** Étapes dans l'ordre séquentiel (flatten) */
  steps: PlanningStep[];
  /** Vagues parallèles (groupes d'étapes indépendantes) */
  waves: ParallelWave[];
  /** Métadonnées de risque */
  risk: {
    /** Score de risque global 0–100 (max pondéré) */
    total: number;
    /** Profil */
    profile: "smooth" | "jagged" | "spiky";
    /** Somme cumulée des risques des étapes */
    cumulative: number;
    /** Pics (étapes dont le risque dépasse 70) */
    peaks: PlanningStep[];
    /** Rapport ImpactAnalyzer global, si calculé */
    impactReport?: ExtendedImpactReport;
  };
  /** Validations à chaque point de contrôle */
  checkpoints: PlanningStep[];
  /** Validations globales (à la fin du plan) */
  finalValidations: TestRecommendation[];
  /** Cycle(s) détecté(s) qui empêche(nt) un tri topologique strict */
  detectedCycles: string[][];
  /** Ordre topologique impossible — certains emplacements ont été forcés */
  approximationUsed: boolean;
  /** Suggestions d'amélioration du plan */
  suggestions: string[];
  /** Rapport Markdown */
  markdownReport: string;
  /** Durée de calcul du plan */
  computationMs: number;
  /** Généré à */
  generatedAt: string;
}

/** Options de planification */
export interface PlanningOptions {
  strategy?: PlanningStrategy;
  riskMode?: PlanningRiskMode;
  /** Toutes actions = "modify" par défaut. Permet de surcharger par fichier */
  actionByFile?: Record<string, PlanningStep["action"]>;
  /** Action par défaut pour les fichiers non listés dans actionByFile */
  defaultAction?: PlanningStep["action"];
  /** Forcer l'inclusion de fichiers dépendants supplémentaires (jusqu'à depth) */
  extendWithDependencies?: boolean;
  /** Profondeur maximale de dépendances incluses (si extend=true) */
  maxDependencyDepth?: number;
  /** Inclure aussi les dépendants indirects dans l'analyse */
  extendWithDependents?: boolean;
  /** Ajouter des checkpoints automatiques après N étapes à risque */
  checkpointEveryHighRiskSteps?: number;
  /** True : ajouter un checkpoint à la fin de chaque vague */
  checkpointAfterWaves?: boolean;
  /** Pondération custom des stratégies hybrides (réservé) */
  strategyWeights?: Partial<Record<PlanningStrategy, number>>;
  /** Interdire la mise en parallèle d'un fichier donné */
  forbidParallelForFiles?: string[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<PlanningOptions, "actionByFile" | "strategyWeights" | "forbidParallelForFiles">> & {
  actionByFile: Record<string, PlanningStep["action"]>;
  strategyWeights: Partial<Record<PlanningStrategy, number>>;
  forbidParallelForFiles: string[];
} = {
  strategy: "dependency",
  riskMode: "standard",
  actionByFile: {},
  defaultAction: "modify",
  extendWithDependencies: false,
  maxDependencyDepth: 3,
  extendWithDependents: false,
  checkpointEveryHighRiskSteps: 3,
  checkpointAfterWaves: true,
  strategyWeights: {},
  forbidParallelForFiles: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PlanningEngine
// ═══════════════════════════════════════════════════════════════════════════════

export class PlanningEngine {
  private static readonly RISK_THRESHOLD_CHECKPOINT = 70;

  // ──────────────────────────────────────────────────────────────────────
  // API principale
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Génère un plan structuré d'exécution pour un ensemble de fichiers cibles.
   */
  plan(targetFiles: string | string[], options: PlanningOptions = {}): StructuredPlan {
    const t0 = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const targets = (Array.isArray(targetFiles) ? targetFiles : [targetFiles]).map(normalizePath);
    if (targets.length === 0) return this.emptyPlan(targets, opts, Date.now() - t0);

    // 1) Élargir la liste si demandé : inclure dépendances / dépendants
    const effectiveFiles = this.expandTargets(targets, opts);

    // 2) Évaluer le risque global — impact report (peut être undefined selon mode)
    const impactReport = this.maybeBuildImpactReport(effectiveFiles, opts.riskMode);

    // 3) Ordonnencer selon la stratégie
    const ordered = this.orderFiles(effectiveFiles, opts.strategy, impactReport);

    // 4) Détecter cycles dans le sous-graphe
    const cycles = this.detectCyclesAmongFiles(effectiveFiles);

    // 5) Générer les étapes séquentielles
    const steps = this.buildPlanningSteps(ordered, effectiveFiles, opts, impactReport);

    // 6) Grouper les étapes en vagues parallèles
    const waves = this.buildParallelWaves(steps, opts);

    // 7) Post-traitement : checkpoints, validations croisées, suggestions
    const { steps: stepsWithCP, checkpoints } = this.decorateWithCheckpoints(steps, waves, opts);

    // 8) Agréger le risque
    const risk = this.aggregateRisk(stepsWithCP, waves, impactReport);

    // 9) Validations finales
    const finalValidations = impactReport
      ? impactReport.testRecommendations.filter((t) => t.kind !== "manual" || t.priority === "must")
      : this.defaultFinalValidations(risk.total);

    // 10) Suggestions
    const suggestions = this.buildSuggestions(stepsWithCP, waves, risk, opts, cycles);

    // 11) Construire le rapport
    const plan: StructuredPlan = {
      strategy: opts.strategy,
      riskMode: opts.riskMode,
      targetFiles: targets,
      steps: stepsWithCP,
      waves,
      risk,
      checkpoints,
      finalValidations,
      detectedCycles: cycles,
      approximationUsed: cycles.length > 0,
      suggestions,
      markdownReport: "",
      computationMs: Date.now() - t0,
      generatedAt: new Date().toISOString(),
    };
    plan.markdownReport = this.generateMarkdownReport(plan, opts);

    log.info(
      `🗺️ PlanningEngine [${opts.strategy}/${opts.riskMode}] ${targets.length} cibles → ` +
      `${plan.steps.length} étapes / ${plan.waves.length} vagues, risque=${risk.total}/100 ` +
      `(${risk.profile}) — ${plan.computationMs}ms`
    );

    return plan;
  }

  /** Alias : plan avec stratégie "dependency" standard */
  planSafe(targetFiles: string | string[], opts: PlanningOptions = {}): StructuredPlan {
    return this.plan(targetFiles, { ...opts, strategy: "dependency", riskMode: "standard" });
  }

  /** Alias : plan à bas risque, checkpoints fréquents */
  planConservative(targetFiles: string | string[], opts: PlanningOptions = {}): StructuredPlan {
    return this.plan(targetFiles, {
      ...opts,
      strategy: "risk_first",
      riskMode: "deep",
      checkpointAfterWaves: true,
      checkpointEveryHighRiskSteps: 1,
    });
  }

  /** Alias : plan agressif, dur d'abord, parallèle max */
  planAggressive(targetFiles: string | string[], opts: PlanningOptions = {}): StructuredPlan {
    return this.plan(targetFiles, {
      ...opts,
      strategy: "risk_last",
      riskMode: "quick",
      checkpointAfterWaves: false,
      checkpointEveryHighRiskSteps: 5,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // 1. Expansion des cibles (dépendances / dépendants)
  // ──────────────────────────────────────────────────────────────────────

  private expandTargets(targets: string[], opts: typeof DEFAULT_OPTIONS): string[] {
    const set = new Set(targets);
    if (opts.extendWithDependencies) {
      for (const t of targets) {
        const chain = dependencyGraph.getDependencyChain(t).slice(1, opts.maxDependencyDepth + 1);
        chain.forEach((f) => set.add(normalizePath(f)));
      }
    }
    if (opts.extendWithDependents) {
      for (const t of targets) {
        const chain = dependencyGraph.getImpactChain(t).slice(1, opts.maxDependencyDepth + 1);
        chain.forEach((f) => set.add(normalizePath(f)));
      }
    }
    return Array.from(set);
  }

  // ──────────────────────────────────────────────────────────────────────
  // 2. Rapport d'impact optionnel selon le mode
  // ──────────────────────────────────────────────────────────────────────

  private maybeBuildImpactReport(
    files: string[],
    riskMode: PlanningRiskMode
  ): ExtendedImpactReport | undefined {
    if (riskMode === "quick") return undefined;
    const mode: ImpactMode = riskMode === "deep" ? "deep" : "standard";
    try {
      return impactAnalyzer.analyze(files, { mode });
    } catch (e) {
      log.warn(`[PlanningEngine] ImpactAnalyzer indisponible: ${(e as Error).message}`);
      return undefined;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3. Ordonnancement multi-stratégie
  // ──────────────────────────────────────────────────────────────────────

  private orderFiles(
    files: string[],
    strategy: PlanningStrategy,
    report: ExtendedImpactReport | undefined
  ): string[] {
    if (files.length <= 1) return [...files];

    switch (strategy) {
      case "dependency":
        return this.topologicalOrder(files, "forward");
      case "reverse":
        return this.topologicalOrder(files, "reverse");
      case "risk_first":
        return this.orderByRisk(files, report, "asc");
      case "risk_last":
        return this.orderByRisk(files, report, "desc");
      case "critical_path":
        return this.orderByCriticality(files);
    }
  }

  private topologicalOrder(files: string[], direction: "forward" | "reverse"): string[] {
    // Algorithme Kahn : in-degree sur le sous-graphe formé de files
    const fileSet = new Set(files);
    const inDeg: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    for (const f of files) { inDeg[f] = 0; adj[f] = []; }

    for (const f of files) {
      const deps = dependencyGraph.getDirectDependencies(f).filter((d) => fileSet.has(normalizePath(d)));
      for (const rawD of deps) {
        const d = normalizePath(rawD);
        if (direction === "forward") {
          // "d doit venir avant f"
          adj[d].push(f);
          inDeg[f] = (inDeg[f] || 0) + 1;
        } else {
          // "f doit venir avant d" (reverse)
          adj[f].push(d);
          inDeg[d] = (inDeg[d] || 0) + 1;
        }
      }
    }

    const queue: string[] = [];
    for (const f of files) if ((inDeg[f] || 0) === 0) queue.push(f);
    // Déterministe
    queue.sort();

    const result: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const nxt of adj[node] || []) {
        inDeg[nxt]--;
        if (inDeg[nxt] === 0) {
          const pos = queue.findIndex((q) => q > nxt);
          if (pos === -1) queue.push(nxt); else queue.splice(pos, 0, nxt);
        }
      }
    }

    // S'il reste des éléments, il y a un cycle : on ajoute à la fin (ordre fichier)
    if (result.length < files.length) {
      const done = new Set(result);
      const rest = files.filter((f) => !done.has(f)).sort();
      result.push(...rest);
    }

    return result;
  }

  private orderByRisk(
    files: string[],
    report: ExtendedImpactReport | undefined,
    direction: "asc" | "desc"
  ): string[] {
    // D'abord trier par dépendance topologique, puis réordonner à l'intérieur
    // des "strates" par risque.
    const topo = this.topologicalOrder(files, "forward");
    const riskByFile: Record<string, number> = {};
    for (const f of files) {
      riskByFile[f] = this.estimateFileRisk(f, report);
    }
    // Dépendances imposent un ordre relatif mais on peut permuter quand
    // deux fichiers ne sont pas liés. Solution simple : trier topologique
    // puis par risk au sein d'une même wave (profondeur).
    const depth = this.computeDepths(topo, files);
    const grouped = new Map<number, string[]>();
    for (const f of topo) {
      const d = depth.get(f) ?? 0;
      const arr = grouped.get(d) || [];
      arr.push(f);
      grouped.set(d, arr);
    }
    const result: string[] = [];
    const keys = Array.from(grouped.keys()).sort((a, b) => a - b);
    for (const k of keys) {
      const arr = grouped.get(k)!;
      const sorted = [...arr].sort((a, b) => {
        const ra = riskByFile[a] ?? 50;
        const rb = riskByFile[b] ?? 50;
        return direction === "asc" ? ra - rb : rb - ra;
      });
      result.push(...sorted);
    }
    return result;
  }

  private orderByCriticality(files: string[]): string[] {
    // Centralité = nb de dépendants transitifs dans le graphe COMPLET
    // Puis trier (plus central en premier), avec conservation des
    // contraintes topologiques quand c'est possible.
    const topo = this.topologicalOrder(files, "forward");
    const centrality: Record<string, number> = {};
    for (const f of files) {
      try {
        const chain = dependencyGraph.getImpactChain(f);
        centrality[f] = Math.max(0, chain.length - 1);
      } catch {
        centrality[f] = 0;
      }
    }
    const depth = this.computeDepths(topo, files);
    const grouped = new Map<number, string[]>();
    for (const f of topo) {
      const d = depth.get(f) || 0;
      const arr = grouped.get(d) || [];
      arr.push(f);
      grouped.set(d, arr);
    }
    const result: string[] = [];
    const keys = Array.from(grouped.keys()).sort((a, b) => a - b);
    for (const k of keys) {
      const arr = grouped.get(k)!;
      arr.sort((a, b) => (centrality[b] ?? 0) - (centrality[a] ?? 0));
      result.push(...arr);
    }
    return result;
  }

  private computeDepths(orderedFiles: string[], files: string[]): Map<string, number> {
    const depth = new Map<string, number>();
    const fileSet = new Set(files);
    for (const f of orderedFiles) {
      let maxPred = -1;
      for (const rawD of dependencyGraph.getDirectDependencies(f)) {
        const d = normalizePath(rawD);
        if (fileSet.has(d) && depth.has(d)) {
          maxPred = Math.max(maxPred, depth.get(d)!);
        }
      }
      depth.set(f, maxPred + 1);
    }
    return depth;
  }

  private estimateFileRisk(filePath: string, report: ExtendedImpactReport | undefined): number {
    if (report) {
      const found = report.impactedFiles.find((f) => normalizePath(f.filePath) === normalizePath(filePath));
      if (found) return found.impactScore;
    }
    // Heuristique fallback
    let risk = 30;
    const lower = filePath.toLowerCase();
    if (/types\.ts|interfaces\.ts|contract/.test(lower)) risk += 25;
    if (/index\.(ts|js)$/.test(lower)) risk += 15;
    if (/server\/(knowledge|mission|agents|skills|orchestration)\//.test(lower)) risk += 20;
    if (/\.test\.(ts|js)/.test(lower)) risk -= 15;
    if (/\.(css|md|svg|png)$/.test(lower)) risk -= 15;
    return Math.max(0, Math.min(100, risk));
  }

  // ──────────────────────────────────────────────────────────────────────
  // 4. Cycles parmi les fichiers
  // ──────────────────────────────────────────────────────────────────────

  private detectCyclesAmongFiles(files: string[]): string[][] {
    const normSet = new Set(files.map(normalizePath));
    try {
      const allCycles = dependencyGraph.detectCycles();
      return allCycles
        .filter((c) => c.files.some((f) => normSet.has(normalizePath(f))))
        .map((c) => c.files.map(normalizePath));
    } catch {
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 5. Construction des étapes
  // ──────────────────────────────────────────────────────────────────────

  private buildPlanningSteps(
    ordered: string[],
    allFiles: string[],
    opts: typeof DEFAULT_OPTIONS,
    report: ExtendedImpactReport | undefined
  ): PlanningStep[] {
    const fileSet = new Set(allFiles);
    const depth = this.computeDepths(ordered, allFiles);
    const steps: PlanningStep[] = [];
    let cumulativeRisk = 0;

    for (let i = 0; i < ordered.length; i++) {
      const fp = ordered[i];
      const risk = this.estimateFileRisk(fp, report);
      cumulativeRisk = Math.min(100, cumulativeRisk + risk * 0.35);
      const residual = Math.max(0, cumulativeRisk - Math.min(40, risk * 0.6));

      const prerequisites = dependencyGraph
        .getDirectDependencies(fp)
        .filter((d) => fileSet.has(normalizePath(d))).length;
      const dependents = dependencyGraph
        .getDirectDependents(fp)
        .filter((d) => fileSet.has(normalizePath(d))).length;

      const action: PlanningStep["action"] = opts.actionByFile[fp] || opts.defaultAction;
      const d = depth.get(fp) ?? 0;
      const rationale: string[] = [];
      rationale.push(`Stratégie: ${opts.strategy} — position ${i + 1}/${ordered.length}`);
      if (prerequisites > 0) rationale.push(`${prerequisites} prérequis(s) dans le plan`);
      if (dependents > 0) rationale.push(`${dependents} dépendant(s) directement impacté(s)`);

      const validations = this.buildStepValidations(fp, risk, action, report);

      const step: PlanningStep = {
        id: this.stepId(fp, i),
        index: i,
        filePath: fp,
        action,
        label: `${action.toUpperCase()} ${fp.split("/").pop()}`,
        wave: d,
        depth: d,
        prerequisitesCount: prerequisites,
        dependentsCount: dependents,
        estimatedRisk: risk,
        cumulativeRiskUpto: Math.round(cumulativeRisk * 10) / 10,
        residualRiskAfter: Math.round(residual * 10) / 10,
        rationale,
        validations,
        preconditions: prerequisites > 0
          ? [`Toutes les étapes produisant des dépendances de \`${fp}\` doivent être terminées`]
          : [],
        estimatedDurationMs: this.estimateStepDuration(fp, action, risk),
        tags: [action, `risk:${risk >= 70 ? "high" : risk >= 40 ? "med" : "low"}`],
      };
      steps.push(step);
    }

    return steps;
  }

  private stepId(fp: string, i: number): string {
    const base = fp.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    return `s${i + 1}_${base}`;
  }

  private buildStepValidations(
    fp: string,
    risk: number,
    action: PlanningStep["action"],
    report: ExtendedImpactReport | undefined
  ): PlanningStep["validations"] {
    const out: PlanningStep["validations"] = [];
    const lower = fp.toLowerCase();
    const isCode = /\.(ts|tsx|js|jsx)$/.test(lower);
    if (action === "delete") {
      out.push({
        kind: "typecheck",
        scope: fp,
        required: true,
        description: `Vérifier qu'aucun import ne référence plus ${fp} après suppression`,
      });
    }
    if (isCode && (action === "modify" || action === "create")) {
      out.push({
        kind: "lint",
        scope: fp,
        required: risk >= 40,
        description: `Linter ${fp}`,
      });
      if (action === "modify") {
        out.push({
          kind: "typecheck",
          scope: "projet",
          required: risk >= 50,
          description: `tsc --noEmit après modification de ${fp.split("/").pop()}`,
        });
      }
      const testFile = this.findCorrespondingTest(fp);
      if (testFile && risk >= 20) {
        out.push({
          kind: "unit",
          scope: testFile,
          required: risk >= 50,
          description: `Jouer les tests unitaires associés: ${testFile.split("/").pop()}`,
        });
      } else if (!testFile && risk >= 50) {
        out.push({
          kind: "manual",
          scope: fp,
          required: true,
          description: `⚠️ Pas de tests unitaires — validation manuelle requise`,
        });
      }
    }
    // Si ImpactAnalyzer a des recommandations spécifiques, on reprend
    if (report) {
      const fileRecommendations = report.testRecommendations.filter(
        (t) => typeof t.scope === "string" && normalizePath(t.scope).includes(normalizePath(fp))
      );
      for (const r of fileRecommendations.slice(0, 2)) {
        out.push({
          kind: r.kind as PlanningStep["validations"][number]["kind"],
          scope: r.scope,
          required: r.priority === "must",
          description: r.description,
        });
      }
    }
    return out;
  }

  private findCorrespondingTest(filePath: string): string | null {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return null;
    const base = filePath.replace(/\.(ts|tsx|js|jsx)$/i, "");
    const candidates = [
      `${base}.test.ts`,
      `${base}.spec.ts`,
      `${base}.test.tsx`,
    ];
    for (const c of candidates) {
      try {
        const g = (dependencyGraph as any).knowledgeGraph;
        if (g && typeof g.getFile === "function" && g.getFile(c)) return c;
      } catch { /* ignore */ }
    }
    return null;
  }

  private estimateStepDuration(
    fp: string,
    action: PlanningStep["action"],
    risk: number
  ): number {
    const fileSizeHeuristic = (() => {
      try {
        // tenter estimation via le knowledge graph si accessible
        const g = (dependencyGraph as any).knowledgeGraph;
        if (g && typeof g.getFile === "function") {
          const node = g.getFile(fp);
          if (node && node.lineCount) return node.lineCount;
        }
      } catch { /* ignore */ }
      return 150; // ~ nombre de lignes moyen
    })();
    let base = 2000 + fileSizeHeuristic * 15;
    if (action === "read") base *= 0.2;
    if (action === "modify") base *= 1.0;
    if (action === "create") base *= 1.5;
    if (action === "delete") base *= 0.8;
    if (action === "verify") base *= 0.4;
    base *= 1 + risk / 100; // + risqué = + long
    return Math.round(base);
  }

  // ──────────────────────────────────────────────────────────────────────
  // 6. Construction des vagues parallèles
  // ──────────────────────────────────────────────────────────────────────

  private buildParallelWaves(
    steps: PlanningStep[],
    opts: typeof DEFAULT_OPTIONS
  ): ParallelWave[] {
    const byWave = new Map<number, PlanningStep[]>();
    // Surcharger : certains fichiers ne peuvent pas être parallélisés
    // → leur donner leur propre vague (max parmi leurs dépendants directs ?)
    const forbidSet = new Set((opts.forbidParallelForFiles || []).map(normalizePath));

    let extraWaveOffset = 0;
    for (const s of steps) {
      let wave = s.wave;
      if (forbidSet.has(normalizePath(s.filePath))) {
        // Utiliser la vague la plus haute rencontrée jusque-là + 1
        let maxWave = wave;
        byWave.forEach((_, w) => { if (w > maxWave) maxWave = w; });
        wave = maxWave + 1;
        extraWaveOffset = Math.max(extraWaveOffset, wave - s.wave);
      } else {
        wave = wave + extraWaveOffset;
      }
      const arr = byWave.get(wave) || [];
      arr.push(s);
      byWave.set(wave, arr);
      s.wave = wave; // Mettre à jour l'étape pour cohérence
    }

    const waves: ParallelWave[] = [];
    const waveKeys = Array.from(byWave.keys()).sort((a, b) => a - b);

    for (let i = 0; i < waveKeys.length; i++) {
      const k = waveKeys[i];
      const arr = byWave.get(k)!;
      const risks = arr.map((s) => s.estimatedRisk);
      const peakRisk = risks.length ? Math.max(...risks) : 0;
      const avgRisk = risks.length ? risks.reduce((s, v) => s + v, 0) / risks.length : 0;
      const durations = arr.map((s) => s.estimatedDurationMs);
      const seq = durations.reduce((s, v) => s + v, 0);
      const par = durations.length ? Math.max(...durations) : 0;

      // Validations croisées : s'il y a ≥ 2 étapes qui modifient des fichiers liés
      const crossVals: string[] = [];
      if (arr.length >= 2 && avgRisk >= 40) {
        crossVals.push("Typecheck global après la vague parallèle");
      }
      if (arr.some((s) => s.estimatedRisk >= PlanningEngine.RISK_THRESHOLD_CHECKPOINT)) {
        crossVals.push("Checkpoint : exécuter les tests unitaires de chaque étape");
      }
      const requiresSync = crossVals.length > 0 || opts.checkpointAfterWaves || i === waveKeys.length - 1;

      waves.push({
        index: i,
        steps: arr,
        peakRisk: Math.round(peakRisk),
        averageRisk: Math.round(avgRisk),
        sequentialDurationMs: seq,
        parallelDurationMs: par,
        requiresSync,
        crossValidations: crossVals,
      });
    }
    return waves;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 7. Décoration : checkpoints
  // ──────────────────────────────────────────────────────────────────────

  private decorateWithCheckpoints(
    steps: PlanningStep[],
    waves: ParallelWave[],
    opts: typeof DEFAULT_OPTIONS
  ): { steps: PlanningStep[]; checkpoints: PlanningStep[] } {
    const checkpoints: PlanningStep[] = [];
    let highRiskSinceLastCP = 0;
    const cpDepth = new Set<number>();
    if (opts.checkpointAfterWaves) {
      for (const w of waves) {
        if (w.steps.length > 0) cpDepth.add(w.steps[w.steps.length - 1].index);
      }
    }

    for (const s of steps) {
      if (s.estimatedRisk >= PlanningEngine.RISK_THRESHOLD_CHECKPOINT) highRiskSinceLastCP++;
      const makeCP =
        s.estimatedRisk >= 90 ||
        cpDepth.has(s.index) ||
        (opts.checkpointEveryHighRiskSteps > 0 &&
          highRiskSinceLastCP >= opts.checkpointEveryHighRiskSteps);
      if (makeCP) {
        s.checkpoint = true;
        s.validations.push({
          kind: "integration",
          scope: "tous modules modifiés jusque-là",
          required: true,
          description: `Checkpoint après étape ${s.index + 1} (${s.label})`,
        });
        checkpoints.push(s);
        highRiskSinceLastCP = 0;
      }
    }

    return { steps, checkpoints };
  }

  // ──────────────────────────────────────────────────────────────────────
  // 8. Agrégation risque
  // ──────────────────────────────────────────────────────────────────────

  private aggregateRisk(
    steps: PlanningStep[],
    _waves: ParallelWave[],
    report: ExtendedImpactReport | undefined
  ): StructuredPlan["risk"] {
    if (steps.length === 0) {
      return { total: 0, profile: "smooth", cumulative: 0, peaks: [] };
    }
    const total = steps[steps.length - 1].cumulativeRiskUpto;
    const cumulative = Math.round(steps.reduce((s, st) => s + st.estimatedRisk, 0));
    const peaks = steps.filter((s) => s.estimatedRisk >= 70);
    const peakRisks = steps.map((s) => s.estimatedRisk);

    // Profil : smooth si écart-type faible, spiky si 1+ pics, jagged sinon
    const avg = peakRisks.reduce((s, v) => s + v, 0) / peakRisks.length;
    const variance = peakRisks.reduce((s, v) => s + (v - avg) ** 2, 0) / peakRisks.length;
    const std = Math.sqrt(variance);
    let profile: StructuredPlan["risk"]["profile"] = "smooth";
    if (peaks.length >= 1 && Math.max(...peakRisks) - avg >= 35) profile = "spiky";
    else if (std >= 22) profile = "jagged";

    return {
      total: Math.round(total),
      profile,
      cumulative,
      peaks,
      impactReport: report,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // 9. Validations finales (fallback)
  // ──────────────────────────────────────────────────────────────────────

  private defaultFinalValidations(totalRisk: number): TestRecommendation[] {
    const out: TestRecommendation[] = [
      {
        priority: totalRisk >= 30 ? "must" : "should",
        kind: "typecheck",
        scope: "projet",
        description: "Typecheck complet (tsc --noEmit)",
        rationale: "Cohérence typographique après modifications.",
      },
    ];
    if (totalRisk >= 45) {
      out.push({
        priority: "must",
        kind: "integration",
        scope: "modules impactés",
        description: "Tests d'intégration des modules concernés",
        rationale: "Risque moyen-élevé — interactions inter-modules à vérifier.",
      });
    }
    if (totalRisk >= 75) {
      out.push({
        priority: "must",
        kind: "manual",
        scope: "flux principaux",
        description: "Smoke test manuel des parcours critiques",
        rationale: "Risque élevé — validation humaine indispensable.",
      });
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 10. Suggestions d'amélioration du plan
  // ──────────────────────────────────────────────────────────────────────

  private buildSuggestions(
    steps: PlanningStep[],
    waves: ParallelWave[],
    risk: StructuredPlan["risk"],
    opts: typeof DEFAULT_OPTIONS,
    cycles: string[][]
  ): string[] {
    const sug: string[] = [];
    if (cycles.length > 0) sug.push(`⚠️ ${cycles.length} cycle(s) de dépendance détecté(s) — ordre approximatif, valider manuellement.`);
    if (risk.profile === "spiky") sug.push("Profil de risque spiky : envisager d'éclater les étapes les plus risquées.");
    if (risk.profile === "jagged") sug.push("Profil de risque irrégulier : envisager une stratégie risk_first pour lisser.");
    if (waves.length > 0) {
      const gain = waves.reduce((s, w) => s + (w.sequentialDurationMs - w.parallelDurationMs), 0);
      if (gain > 5000) {
        const minutes = Math.round(gain / 600) / 100;
        sug.push(`⚡ Parallélisation possible : gain estimé ${minutes}min (${waves.length} vagues).`);
      }
    }
    const noValCount = steps.filter((s) => s.validations.length === 0 && s.action === "modify").length;
    if (noValCount > 0) sug.push(`${noValCount} étape(s) sans validation : ajouter tests ou vérifications manuelles.`);
    if (risk.peaks.length > 2) sug.push(`${risk.peaks.length} pics de risque — ajouter des checkpoints.`);
    if (opts.riskMode === "quick") sug.push("Mode quick — ré-exécuter en standard/deep pour une analyse de risque complète.");
    return sug;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 11. Rapport Markdown
  // ──────────────────────────────────────────────────────────────────────

  private generateMarkdownReport(
    plan: StructuredPlan,
    opts: typeof DEFAULT_OPTIONS
  ): string {
    void opts;
    const lines: string[] = [];
    const riskIcon =
      plan.risk.total >= 75 ? "🔴" : plan.risk.total >= 45 ? "🟠" : plan.risk.total >= 20 ? "🟡" : "🟢";

    lines.push(`# Plan d'exécution — stratégie \`${plan.strategy}\` (${plan.riskMode})`);
    lines.push("");
    lines.push(`> Généré le ${new Date(plan.generatedAt).toLocaleString()} en ${plan.computationMs}ms`);
    lines.push("");

    // 1. Synthèse
    lines.push(`## 1. Synthèse`);
    lines.push("");
    lines.push(`${riskIcon} **Risque global estimé : ${plan.risk.total}/100** — profil **${plan.risk.profile}**`);
    lines.push("");
    lines.push("| Indicateur | Valeur |");
    lines.push("|---|---|");
    lines.push(`| Fichiers cibles | ${plan.targetFiles.length} |`);
    lines.push(`| Étapes totales | **${plan.steps.length}** |`);
    lines.push(`| Vagues parallèles | ${plan.waves.length} |`);
    lines.push(`| Checkpoints | ${plan.checkpoints.length} |`);
    lines.push(`| Pics de risque (≥70) | ${plan.risk.peaks.length} |`);
    lines.push(`| Cycles détectés | ${plan.detectedCycles.length}${plan.approximationUsed ? " ⚠️ approximation" : ""} |`);
    lines.push(`| Validations finales | ${plan.finalValidations.length} |`);
    lines.push("");

    // 2. Ordre séquentiel (top étapes)
    lines.push(`## 2. Étapes (${plan.steps.length})`);
    lines.push("");
    lines.push("| # | Wave | Action | Fichier | Risque | Cumulé | CP? | Validation(s) |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const s of plan.steps) {
      lines.push(
        `| ${s.index + 1} | ${s.wave} | **${s.action}** | \`${s.filePath}\` | ${s.estimatedRisk} | ${s.cumulativeRiskUpto} | ${s.checkpoint ? "✅" : "·"} | ${s.validations.length} |`
      );
    }
    lines.push("");

    // 3. Vagues parallèles
    lines.push(`## 3. Vagues parallèles`);
    lines.push("");
    lines.push("| Wave | Nb étapes | Peak risk | Durée (série / parallèle) | Sync? | Cross-validations |");
    lines.push("|---|---|---|---|---|---|");
    for (const w of plan.waves) {
      lines.push(
        `| ${w.index} | ${w.steps.length} | ${w.peakRisk} | ${Math.round(w.sequentialDurationMs / 100) / 10}s / **${Math.round(w.parallelDurationMs / 100) / 10}s** | ${w.requiresSync ? "✅" : "·"} | ${w.crossValidations.length || "·"} |`
      );
    }
    lines.push("");

    // 4. Pics de risque
    if (plan.risk.peaks.length > 0) {
      lines.push(`## 4. Pics de risque (Top ${Math.min(5, plan.risk.peaks.length)})`);
      lines.push("");
      for (const p of plan.risk.peaks.slice(0, 5)) {
        lines.push(`- **${p.estimatedRisk}/100** — étape ${p.index + 1} : \`${p.filePath}\` (${p.action})`);
        for (const r of p.rationale.slice(0, 2)) lines.push(`  - ${r}`);
      }
      lines.push("");
    }

    // 5. Checkpoints
    if (plan.checkpoints.length > 0) {
      lines.push(`## 5. Points de contrôle obligatoires`);
      lines.push("");
      for (const cp of plan.checkpoints) {
        lines.push(`- Après étape ${cp.index + 1} (\`${cp.filePath}\`) :`);
        for (const v of cp.validations.filter((x) => x.required)) {
          lines.push(`  - ▶️ **${v.kind}** — ${v.description}`);
        }
      }
      lines.push("");
    }

    // 6. Cycles détectés
    if (plan.detectedCycles.length > 0) {
      lines.push(`## 6. Cycles impactant le plan`);
      lines.push("");
      for (const cyc of plan.detectedCycles.slice(0, 5)) {
        lines.push(`- ${cyc.map((f) => `\`${f}\``).join(" → ")}`);
      }
      lines.push("");
    }

    // 7. Validations finales
    lines.push(`## 7. Validations finales`);
    lines.push("");
    for (const t of plan.finalValidations) {
      const p = t.priority === "must" ? "🔴 MUST" : t.priority === "should" ? "🟡 SHOULD" : "🔵 MAY";
      lines.push(`- ${p} **${t.kind}** _(${t.scope})_ : ${t.description}`);
    }
    lines.push("");

    // 8. Suggestions
    if (plan.suggestions.length > 0) {
      lines.push(`## 8. Suggestions d'amélioration`);
      lines.push("");
      for (const s of plan.suggestions) lines.push(`- ${s}`);
      lines.push("");
    }

    // 9. Conclusion
    lines.push(`## 9. Conclusion`);
    lines.push("");
    if (plan.risk.total < 25) lines.push(`✅ Plan à faible risque — peut exécuter en parallèle.`);
    else if (plan.risk.total < 55) lines.push(`🟡 Plan à risque modéré — respecter les checkpoints.`);
    else if (plan.risk.total < 80) lines.push(`🟠 Plan à haut risque — toutes les étapes \`must\` obligatoires.`);
    else lines.push(`🔴 Plan CRITIQUE — revoir découpage si possible puis exécuter pas à pas.`);

    return lines.join("\n");
  }

  // ──────────────────────────────────────────────────────────────────────
  // Plan vide
  // ──────────────────────────────────────────────────────────────────────

  private emptyPlan(
    targets: string[],
    opts: typeof DEFAULT_OPTIONS,
    durationMs: number
  ): StructuredPlan {
    return {
      strategy: opts.strategy,
      riskMode: opts.riskMode,
      targetFiles: targets,
      steps: [],
      waves: [],
      risk: { total: 0, profile: "smooth", cumulative: 0, peaks: [] },
      checkpoints: [],
      finalValidations: [],
      detectedCycles: [],
      approximationUsed: false,
      suggestions: ["Aucun fichier cible fourni."],
      markdownReport: "# Plan d'exécution — (vide)\n",
      computationMs: durationMs,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée de PlanningEngine */
export const planningEngine = new PlanningEngine();
