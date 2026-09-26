/**
 * LearningEngine — Moteur d'apprentissage automatique post-mission
 *
 * Sprint 10 — Objectifs :
 *   • Extraire des leçons structurées après chaque mission (succès, échec, optimisations)
 *   • Détecter des patterns répétés : erreurs récurrentes, stratégies gagnantes,
 *     gains d'optimisation possibles
 *   • Appliquer automatiquement certaines améliorations (ex: ajuster les poids
 *     d'ImpactAnalyzer, enrichir ProjectMemory, flaguer des modules à refactoriser)
 *   • Intégrer ProjectMemory : toutes les leçons → ProjectFacts persistés & catégorisés
 *   • Boucle d'auto-amélioration : alimente les prochains ReasoningPipeline /
 *     ReflectionEngine / UnderstandingEngine via la mémoire projet
 *
 * Types principaux (définis dans types.ts) :
 *   Lesson         — Une leçon individuelle (type + description + recommandation + importance)
 *   LearningResult — Résultat global d'apprentissage d'une mission
 *
 * Intégrations :
 *   projectMemory    — persistance des leçons en tant que faits
 *   knowledgeGraph   — entités & fichiers concernés par les patterns détectés
 *   dependencyGraph  — couplage / points chauds à surveiller
 *   impactAnalyzer   — réutilise le scoring pour prioriser les optimisations
 */

import { randomUUID } from "crypto";
import { createLogger } from "../utils/logger.js";
import { projectMemory } from "./ProjectMemory.js";
import { impactAnalyzer } from "./ImpactAnalyzer.js";
import type { Lesson, LearningResult, ProjectKnowledgeCategory, ProjectFact } from "./types.js";
import type { RiskLevel } from "./ImpactAnalyzer.js";

const log = createLogger("LearningEngine");

// ═══════════════════════════════════════════════════════════════════════════════
// Types Sprint 10 — LearningEngine
// ═══════════════════════════════════════════════════════════════════════════════

/** Mode d'extraction de leçons */
export type LearningMode =
  | "post_mission"   // Après une mission complète (défaut)
  | "incremental"    // Après chaque action / sous-objectif (plus granulaire)
  | "comparative"    // Compare à l'historique des missions similaires
  | "deep";          // Multi-passes : extraction + déduction + suggestions de refactor

/** Un pattern détecté (agrège plusieurs occurrences similaires) */
export interface DetectedPattern {
  /** Type de pattern */
  type: Lesson["type"];
  /** Signature / identifiant canonique du pattern (pour agrégation) */
  signature: string;
  /** Humainement lisible : ce qui se répète */
  description: string;
  /** Combien de fois ce pattern a-t-il été observé (sur cette mission ou historique) */
  occurrenceCount: number;
  /** Identifiants des sources (actions / erreurs / fichiers) */
  sourceIds: string[];
  /** Fichiers concernés */
  relatedFiles: string[];
  /** Score d'importance agrégé (0-1) */
  aggregatedImportance: number;
  /** Vitesse de croissance (si on a de l'historique) — combien de % de + par rapport à avant */
  growthPct?: number;
  /** S'il s'agit d'un pattern récurrent (>= 3 occurrences) */
  isRecurring: boolean;
}

/** Suggestion d'amélioration automatique proposée par le LearningEngine */
export interface AutoImprovement {
  id: string;
  /** Catégorie d'amélioration */
  kind:
    | "memory_insert"           // Ajouter un fait en ProjectMemory
    | "memory_tag"              // Tagguer / modifier un fait existant
    | "impact_weight_tweak"     // Ajuster les poids d'ImpactAnalyzer
    | "refactor_suggestion"     // Suggérer un refactor (dans ProjectMemory cat:refactoring)
    | "todo_create"             // Créer une tâche TODO
    | "convention_document";    // Documenter une convention implicite
  /** Ce qui sera fait (1-ligne) */
  label: string;
  /** Pourquoi c'est pertinent */
  rationale: string;
  /** Payoff estimé (0-1) — "à quel point ça va améliorer les prochaines missions" */
  estimatedPayoff: number;
  /** Effort estimé (1 = instantané, 5 = refactor lourd) */
  estimatedEffort: 1 | 2 | 3 | 4 | 5;
  /** Statut : peut-on appliquer automatiquement ? */
  autoApplicable: boolean;
  /** Payload spécifique selon kind */
  payload:
    | { kind: "memory_insert"; category: ProjectKnowledgeCategory; content: string; tags: string[]; sourceFile?: string }
    | { kind: "memory_tag"; factId: string; tagsToAdd: string[] }
    | { kind: "impact_weight_tweak"; criterion: string; delta: number; reason: string }
    | { kind: "refactor_suggestion"; module: string; description: string }
    | { kind: "todo_create"; content: string }
    | { kind: "convention_document"; convention: string; sourceFiles: string[] };
}

/** Options pour la méthode learnFromMission() */
export interface LearningOptions {
  mode?: LearningMode;
  /** Seuil d'importance minimum pour retenir une leçon (0-1) */
  minLessonImportance?: number;
  /** Maximum de leçons à extraire par mission */
  maxLessons?: number;
  /** Appliquer automatiquement les améliorations autoApplicables ? */
  applyAutoImprovements?: boolean;
  /** Comparer aux N missions précédentes (si historique accessible) */
  compareLastNMissions?: number;
}

/** Données d'entrée : extraire depuis MissionState, GoalResults ou données brutes */
export interface MissionLearningInput {
  missionId: string;
  missionTitle: string;
  /** Objectif global réussi ? */
  overallSuccess: boolean;
  /** Résumé haut niveau fourni par la mission */
  summary?: string;
  /** Fichiers modifiés / lus pendant la mission */
  touchedFiles: string[];
  /** Liste des actions exécutées (pour détection de patterns) */
  actions: {
    actionId: string;
    actionName: string;
    skillName?: string;
    success: boolean;
    durationMs?: number;
    /** Si échec, message d'erreur normalisé */
    errorMessage?: string;
    /** Fichiers concernés par cette action */
    files?: string[];
    /** Identifiant du goal parent */
    goalId?: string;
    attemptNumber?: number;
  }[];
  /** Erreurs globales / récurrentes listées dans le contexte mission */
  errors?: { message: string; count?: number; action?: string }[];
  /** Décisions prises explicitement par la mission */
  decisions?: { what: string; why: string }[];
  /** Leçons déjà identifiées manuellement (ex: lessonsLearned dans GoalResult) */
  explicitLessons?: string[];
  /** Rétroactions / issues remontées */
  knownIssues?: string[];
}

// ─── Config par défaut ───────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<LearningOptions, "compareLastNMissions">> & {
  compareLastNMissions?: number;
} = {
  mode: "post_mission",
  minLessonImportance: 0.25,
  maxLessons: 12,
  applyAutoImprovements: true,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeError(msg: string): string {
  return msg
    .replace(/[A-Z]:\\[^:\s"']+/g, "<PATH>")
    .replace(/\/[^:\s"']{10,}/g, "<PATH>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<IP>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<HEX>")
    .replace(/line\s+\d+/gi, "line <N>")
    .replace(/column\s+\d+/gi, "column <N>")
    .toLowerCase()
    .trim();
}

function signatureFromParts(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).map((s) => String(s).toLowerCase().trim()).join("::");
}

function categorizeLessonDescription(desc: string): Lesson["type"] {
  const d = desc.toLowerCase();
  if (d.includes("échec") || d.includes("echec") || d.includes("erreur") || d.includes("error")
      || d.includes("fail") || d.includes("exception") || d.includes("timeout")) {
    return "error_pattern";
  }
  if (d.includes("optimis") || d.includes("rapide") || d.includes("faster")
      || d.includes("perf") || d.includes("amélior") || d.includes("amelior")) {
    return "optimization";
  }
  if (d.includes("décision") || d.includes("decision") || d.includes("choix")
      || d.includes("stratégie") || d.includes("strategie")) {
    return "decision";
  }
  return "success_pattern";
}

function riskToImportance(risk: RiskLevel): number {
  switch (risk) {
    case "critical": return 0.95;
    case "high": return 0.75;
    case "medium": return 0.45;
    case "low": return 0.15;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LearningEngine
// ═══════════════════════════════════════════════════════════════════════════════

export class LearningEngine {
  private static readonly FACT_TAG_PREFIX = "lesson";
  /** Seuil de détection : un pattern devient "récurrent" à partir de N occurrences */
  private static readonly RECURRING_THRESHOLD = 3;

  // ──────────────────────────────────────────────────────────────────────
  // API principale
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Point d'entrée principal : apprend depuis une mission terminée.
   * Retourne un LearningResult complet (leçons + améliorations + résumé).
   */
  learnFromMission(input: MissionLearningInput, options: LearningOptions = {}): LearningResult {
    const t0 = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    log.info(`[learnFromMission] Mission "${input.missionTitle}" (succès=${input.overallSuccess}, actions=${input.actions.length})`);

    // 1) Extraction des leçons brutes depuis l'input
    const rawLessons = this.extractLessons(input);

    // 2) Détection de patterns (agrégation + récurrence)
    const patterns = this.detectPatterns(rawLessons, input);

    // 3) Fusionner leçons + patterns → filtrer par seuil d'importance
    const lessonsPool: Lesson[] = [...rawLessons];
    for (const p of patterns) {
      if (p.isRecurring || p.aggregatedImportance >= opts.minLessonImportance) {
        lessonsPool.push({
          type: p.type,
          description: `Pattern récurrent (${p.occurrenceCount}×) : ${p.description}`,
          recommendation: this.recommendationForPattern(p),
          filePath: p.relatedFiles[0],
          missionId: input.missionId,
          timestamp: new Date().toISOString(),
          importance: Math.min(1, p.aggregatedImportance * (p.isRecurring ? 1.2 : 1)),
        });
      }
    }

    // 4) Ajouter les leçons explicites s'il y en a
    for (const explicit of input.explicitLessons ?? []) {
      lessonsPool.push({
        type: categorizeLessonDescription(explicit),
        description: explicit,
        recommendation: "Appliquer cette leçon aux missions futures similaires.",
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: 0.6,
      });
    }

    // 5) Décisions → leçons de type "decision"
    for (const dec of input.decisions ?? []) {
      lessonsPool.push({
        type: "decision",
        description: `Décision : ${dec.what}`,
        recommendation: dec.why || "Réutiliser cette approche pour des missions similaires.",
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: 0.5,
      });
    }

    // 6) Filtrer & trier par importance, capter à maxLessons
    const filtered = lessonsPool
      .filter((l) => l.importance >= opts.minLessonImportance)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, opts.maxLessons);

    // 7) Générer les améliorations applicables
    const improvements = this.generateAutoImprovements(filtered, input);

    // 8) Appliquer les améliorations autoApplicables si demandé
    const applied: string[] = [];
    const filesModified: string[] = [];
    if (opts.applyAutoImprovements) {
      for (const imp of improvements.filter((i) => i.autoApplicable)) {
        try {
          const result = this.applyImprovement(imp, input.missionId);
          if (result.applied) {
            applied.push(`✅ ${imp.label}`);
            if (result.filesTouched) filesModified.push(...result.filesTouched);
          }
        } catch (e: any) {
          log.warn(`Appel auto-amélioration échoué: ${imp.label} — ${e.message}`);
        }
      }
      projectMemory.save();
    }

    // 9) Résumé textuel
    const summary = this.buildSummary(input, filtered, applied, patterns);

    log.info(`[learnFromMission] → ${filtered.length} leçons retenues, ${applied.length} améliorations appliquées (${Date.now() - t0}ms)`);

    return {
      lessons: filtered,
      improvementsApplied: applied,
      candidateImprovements: improvements.map(({ id, kind, label, rationale, autoApplicable }) => ({ id, kind, label, rationale, autoApplicable })),
      filesModified: Array.from(new Set(filesModified)),
      summary,
    };
  }

  /**
   * Version "légère" : apprends incrémentalement depuis une seule action.
   * Utile pour LearningMode="incremental".
   */
  learnFromAction(
    missionId: string,
    action: MissionLearningInput["actions"][number],
    context?: { relatedFiles?: string[]; priorErrors?: string[] }
  ): { lessons: Lesson[]; persistedFactIds: string[] } {
    const lessons: Lesson[] = [];
    if (!action.success) {
      normalizeError(action.errorMessage || action.actionName);
      lessons.push({
        type: "error_pattern",
        description: `Échec sur ${action.actionName}: ${action.errorMessage || "sans détail"}`,
        recommendation: this.recommendationForError(action, context?.priorErrors),
        filePath: action.files?.[0],
        missionId,
        timestamp: new Date().toISOString(),
        importance: Math.min(1, 0.35 + 0.15 * (action.attemptNumber || 0)),
      });
    } else if ((action.attemptNumber || 0) > 1) {
      lessons.push({
        type: "optimization",
        description: `${action.actionName} a nécessité ${action.attemptNumber} tentatives avant succès.`,
        recommendation: "Identifier la cause des tentatives préalables et vérifier si on peut anticiper ce cas.",
        filePath: action.files?.[0],
        missionId,
        timestamp: new Date().toISOString(),
        importance: 0.4,
      });
    } else {
      lessons.push({
        type: "success_pattern",
        description: `Succès direct sur ${action.actionName}${action.files?.length ? ` (${action.files.length} fichier(s))` : ""}.`,
        recommendation: "Réutiliser la même séquence pour des tâches analogues.",
        filePath: action.files?.[0],
        missionId,
        timestamp: new Date().toISOString(),
        importance: 0.25,
      });
    }

    const persisted = this.persistLessons(lessons, missionId);
    return { lessons, persistedFactIds: persisted };
  }

  /**
   * Récupère les leçons apprises (depuis ProjectMemory) pour une tâche donnée.
   * Utile pour injecter dans un ReasoningPipeline ou un system prompt.
   */
  getRelevantLessons(query: string, limit = 5): { lessons: Lesson[]; facts: ProjectFact[] } {
    const facts = projectMemory.searchFacts(query, Math.max(limit * 2, 10))
      .filter((f) => f.tags.some((t) => t.startsWith(LearningEngine.FACT_TAG_PREFIX))
                  || f.category === "pattern"
                  || f.category === "known-bug"
                  || f.category === "refactoring");

    const lessons: Lesson[] = facts.slice(0, limit).map((f) => {
      const typeFromTags: Lesson["type"] =
        f.tags.includes("lesson:error_pattern") ? "error_pattern"
        : f.tags.includes("lesson:optimization") ? "optimization"
        : f.tags.includes("lesson:decision") ? "decision"
        : "success_pattern";
      return {
        type: typeFromTags,
        description: f.content,
        recommendation: `Voir fait mémoire ${f.id} pour contexte complet.`,
        filePath: f.sourceFile,
        missionId: (f.tags.find((t) => t.startsWith("mission:")) || "").replace("mission:", ""),
        timestamp: f.updatedAt,
        importance: f.confidence,
      };
    });

    return { lessons, facts };
  }

  /**
   * Mode "deep" : analyse comparative entre la mission courante et les N missions
   * précédentes pour détecter des tendances (régression / amélioration) et suggérer
   * des actions structurelles (refactor, convention, TODO prioritaire).
   */
  learnDeep(
    input: MissionLearningInput,
    options: LearningOptions = {}
  ): LearningResult & { trendReport: string } {
    const baseResult = this.learnFromMission(input, { ...options, mode: "deep" });

    const history = this.getPatternsHistory(20);
    const recurringErrors = history.errorPatterns.filter((p) => p.isRecurring);
    const growingErrors = history.errorPatterns.filter((p) => (p.growthPct ?? 0) > 20);

    const trendLines: string[] = [];
    trendLines.push(`# Analyse de tendance — ${input.missionTitle}`);
    trendLines.push("");

    if (recurringErrors.length > 0) {
      trendLines.push(`## 🔴 Erreurs chroniques (≥ ${LearningEngine.RECURRING_THRESHOLD} occurrences)`);
      for (const e of recurringErrors.slice(0, 5)) {
        trendLines.push(`- **${e.occurrenceCount}×** ${e.description.slice(0, 140)}`);
        trendLines.push(`  → ${this.recommendationForPattern(e)}`);
      }
      trendLines.push("");
    }

    if (growingErrors.length > 0) {
      trendLines.push(`## 📈 Erreurs en augmentation rapide (> +20%)`);
      for (const e of growingErrors.slice(0, 3)) {
        trendLines.push(`- **+${e.growthPct}%** ${e.description.slice(0, 140)}`);
      }
      trendLines.push("");
    }

    const recurringSuccesses = history.successPatterns.filter((p) => p.isRecurring);
    if (recurringSuccesses.length > 0) {
      trendLines.push(`## ✅ Patterns gagnants confirmés`);
      for (const s of recurringSuccesses.slice(0, 3)) {
        trendLines.push(`- **${s.occurrenceCount}×** ${s.description.slice(0, 140)}`);
      }
      trendLines.push("");
    }

    const optimizationOpps = history.optimizations
      .filter((o) => o.aggregatedImportance > 0.5)
      .slice(0, 3);
    if (optimizationOpps.length > 0) {
      trendLines.push(`## ⚡ Opportunités d'optimisation prioritaires`);
      for (const o of optimizationOpps) {
        trendLines.push(`- ${o.description.slice(0, 140)} (importance: ${(o.aggregatedImportance * 100).toFixed(0)}%)`);
      }
      trendLines.push("");
    }

    return { ...baseResult, trendReport: trendLines.join("\n") };
  }

  /**
   * Applique un oubli pondéré (decay) sur les leçons anciennes et peu utilisées.
   * Diminue progressivement la confiance des faits appris il y a plus de N jours
   * sans avoir été réutilisés, et supprime ceux tombés sous le seuil minimum.
   *
   * @param maxAgeDays     Âge maximum en jours avant début du decay (défaut: 90)
   * @param decayFactor    Facteur de réduction par période expirée (défaut: 0.85)
   * @param minConfidence  Confiance minimale sous laquelle le fait est supprimé (défaut: 0.15)
   */
  applyDecay(
    maxAgeDays = 90,
    decayFactor = 0.85,
    minConfidence = 0.15
  ): { decayed: number; removed: number } {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const allFacts = projectMemory.getAllFacts();

    let decayed = 0;
    let removed = 0;

    for (const fact of allFacts) {
      // Seulement les leçons auto-générées par le LearningEngine
      if (!fact.tags.some((t) => t === "learning-engine" || t === "learning-auto")) continue;

      const age = now - new Date(fact.updatedAt).getTime();
      if (age <= maxAgeMs) continue;

      // Nombre de "périodes" écoulées au-delà de maxAge
      const periodsExpired = Math.floor((age - maxAgeMs) / maxAgeMs) + 1;
      const newConfidence = fact.confidence * Math.pow(decayFactor, periodsExpired);

      if (newConfidence < minConfidence) {
        // Supprimer les faits trop anciens et peu fiables
        projectMemory.deleteFact(fact.id);
        removed++;
        log.debug(`[Decay] Fait supprimé (trop ancien + confiance faible): ${fact.id}`);
      } else if (newConfidence < fact.confidence) {
        // Mettre à jour la confiance réduite
        projectMemory.updateFact(fact.id, { confidence: newConfidence });
        decayed++;
        log.debug(`[Decay] Confiance réduite: ${fact.id} ${(fact.confidence * 100).toFixed(0)}% → ${(newConfidence * 100).toFixed(0)}%`);
      }
    }

    if (decayed > 0 || removed > 0) {
      projectMemory.save();
      log.info(`[Decay] ${decayed} faits dégradés, ${removed} supprimés.`);
    }

    return { decayed, removed };
  }

  /**
   * Prépare un bloc de contexte enrichi de leçons passées à injecter
   * en amont d'un ReasoningPipeline ou d'un prompt système d'agent.
   * Retourne une chaîne Markdown prête à l'emploi.
   */
  buildLessonContext(query: string, maxLessons = 5): string {
    const { lessons } = this.getRelevantLessons(query, maxLessons);
    if (lessons.length === 0) return "";

    const lines: string[] = [];
    lines.push(`## Leçons passées pertinentes (mémoire long terme)`);
    lines.push(`> Ces leçons ont été apprises lors de missions précédentes similaires.`);
    lines.push(`> Tiens-en compte pour éviter les erreurs répétées et réutiliser les stratégies gagnantes.`);
    lines.push("");

    for (const lesson of lessons) {
      const icon = lesson.type === "error_pattern" ? "⚠️"
        : lesson.type === "optimization" ? "⚡"
        : lesson.type === "decision" ? "🎯" : "✅";
      lines.push(`${icon} **[${lesson.type}]** ${lesson.description}`);
      lines.push(`   _Recommandation :_ ${lesson.recommendation}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Retourne l'historique des patterns connus (error/success/optim/decision) agrégé
   * depuis ProjectMemory. Utile pour LearningMode="comparative" / deep analysis.
   */
  getPatternsHistory(limitPerType = 10): {
    errorPatterns: DetectedPattern[];
    successPatterns: DetectedPattern[];
    optimizations: DetectedPattern[];
    decisions: DetectedPattern[];
  } {
    const all = projectMemory.getAllFacts();
    const groupBy = new Map<string, DetectedPattern>();

    for (const f of all) {
      const typeTag = f.tags.find((t) => t.startsWith("lesson:"));
      if (!typeTag) continue;
      const type = typeTag.replace("lesson:", "") as Lesson["type"];
      const sig = signatureFromParts(type, f.category, f.sourceFile || "generic");
      const existing = groupBy.get(sig);
      if (existing) {
        existing.occurrenceCount += 1;
        existing.aggregatedImportance = Math.min(1, existing.aggregatedImportance + f.confidence * 0.2);
        if (f.sourceFile && !existing.relatedFiles.includes(f.sourceFile)) {
          existing.relatedFiles.push(f.sourceFile);
        }
        existing.sourceIds.push(f.id);
      } else {
        groupBy.set(sig, {
          type,
          signature: sig,
          description: f.content.slice(0, 180),
          occurrenceCount: 1,
          sourceIds: [f.id],
          relatedFiles: f.sourceFile ? [f.sourceFile] : [],
          aggregatedImportance: f.confidence,
          isRecurring: false,
        });
      }
    }

    const arr = Array.from(groupBy.values()).map((p) => ({
      ...p,
      isRecurring: p.occurrenceCount >= LearningEngine.RECURRING_THRESHOLD,
    }));

    const takeTop = (type: Lesson["type"]) =>
      arr.filter((p) => p.type === type)
         .sort((a, b) => b.aggregatedImportance - a.aggregatedImportance)
         .slice(0, limitPerType);

    return {
      errorPatterns: takeTop("error_pattern"),
      successPatterns: takeTop("success_pattern"),
      optimizations: takeTop("optimization"),
      decisions: takeTop("decision"),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // 1. Extraction des leçons
  // ──────────────────────────────────────────────────────────────────────

  private extractLessons(input: MissionLearningInput): Lesson[] {
    const lessons: Lesson[] = [];

    // ── Résultat global ──────────────────────────────────────────────
    if (input.overallSuccess) {
      lessons.push({
        type: "success_pattern",
        description: `Mission "${input.missionTitle}" complétée avec succès.`,
        recommendation: "Réutiliser le pattern d'ordonnancement / de décisions de cette mission pour des tâches similaires.",
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: 0.4,
      });
    } else {
      lessons.push({
        type: "error_pattern",
        description: `Mission "${input.missionTitle}" n'a pas atteint son objectif.`,
        recommendation: "Revoir la stratégie d'ordonnancement, les hypothèses de départ et les modules identifiés comme défaillants.",
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: 0.85,
      });
    }

    // ── Fichiers modifiés : scanner pour flagger les "points chauds" (impact élevé) ──
    if (input.touchedFiles.length > 0) {
      try {
        const impact = impactAnalyzer.analyze(input.touchedFiles, { mode: "quick", includeTests: false });
        const risky = impact.impactedFiles.filter((f) => f.risk === "high" || f.risk === "critical");
        if (risky.length > 0) {
          for (const r of risky.slice(0, 4)) {
            lessons.push({
              type: "optimization",
              description: `Fichier à fort impact : ${r.filePath} (risque ${r.risk}, score ${r.impactScore.toFixed(0)}). ${r.reasons.slice(0, 2).join("; ")}.`,
              recommendation: "Pour les prochaines modifications, prévoir un point de contrôle spécifique sur ce fichier (typecheck + tests dédiés).",
              filePath: r.filePath,
              missionId: input.missionId,
              timestamp: new Date().toISOString(),
              importance: riskToImportance(r.risk),
            });
          }
        }
      } catch { /* impactAnalyzer pas forcément initialisé encore à ce stade */ }
    }

    // ── Patterns d'erreur / d'échec par action ───────────────────────
    const failedActions = input.actions.filter((a) => !a.success);
    for (const fail of failedActions) {
      lessons.push({
        type: "error_pattern",
        description: `Échec ${fail.actionName}${fail.attemptNumber ? ` (tentative ${fail.attemptNumber})` : ""}: ${fail.errorMessage || "sans détail"}.`,
        recommendation: this.recommendationForError(fail, input.errors?.map((e) => e.message)),
        filePath: fail.files?.[0],
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: Math.min(1, 0.3 + 0.2 * (fail.attemptNumber || 1)),
      });
    }

    // ── Erreurs récurrentes listées dans le contexte ─────────────────
    for (const err of input.errors ?? []) {
      const count = err.count ?? 1;
      lessons.push({
        type: "error_pattern",
        description: `Erreur récurrente (${count}×)${err.action ? ` dans ${err.action}` : ""} : ${err.message}.`,
        recommendation: "Identifier la cause racine et ajouter une pré-condition ou un garde-corps explicite.",
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: Math.min(1, 0.35 + 0.1 * count),
      });
    }

    // ── Actions nécessitant plusieurs tentatives → optimisation ─────
    const multiAttempt = input.actions.filter((a) => (a.attemptNumber || 0) > 1 && a.success);
    for (const act of multiAttempt) {
      lessons.push({
        type: "optimization",
        description: `${act.actionName} a réussi en ${act.attemptNumber} tentatives.`,
        recommendation: "Ajouter une pré-vérification (check préalable) pour réduire le nombre de tentatives à l'avenir.",
        filePath: act.files?.[0],
        missionId: input.missionId,
        timestamp: new Date().toISOString(),
        importance: 0.45,
      });
    }

    return lessons;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 2. Détection de patterns (agrégation des similarités)
  // ──────────────────────────────────────────────────────────────────────

  private detectPatterns(lessons: Lesson[], input: MissionLearningInput): DetectedPattern[] {
    const bySignature = new Map<string, DetectedPattern>();

    // Agréger les leçons par signature (normalisée sur type + fichier + message base)
    for (const l of lessons) {
      const errSig = l.type === "error_pattern"
        ? normalizeError(l.description)
        : l.description.toLowerCase().slice(0, 40);
      const sig = signatureFromParts(l.type, l.filePath || "no-file", errSig);

      const existing = bySignature.get(sig);
      if (existing) {
        existing.occurrenceCount += 1;
        existing.aggregatedImportance = Math.min(1, existing.aggregatedImportance + l.importance * 0.3);
        if (l.filePath && !existing.relatedFiles.includes(l.filePath)) {
          existing.relatedFiles.push(l.filePath);
        }
      } else {
        bySignature.set(sig, {
          type: l.type,
          signature: sig,
          description: l.description.slice(0, 200),
          occurrenceCount: 1,
          sourceIds: [l.missionId + ":" + sig.slice(0, 8)],
          relatedFiles: l.filePath ? [l.filePath] : [],
          aggregatedImportance: l.importance,
          isRecurring: false,
        });
      }
    }

    // Agréger aussi depuis l'historique ProjectMemory si dispo
    const history = this.getPatternsHistory(10);
    const historyArr = [
      ...history.errorPatterns,
      ...history.successPatterns,
      ...history.optimizations,
      ...history.decisions,
    ];

    for (const hp of historyArr) {
      const existing = bySignature.get(hp.signature);
      if (existing) {
        const prevCount = existing.occurrenceCount;
        existing.occurrenceCount += hp.occurrenceCount;
        existing.aggregatedImportance = Math.min(1, existing.aggregatedImportance + hp.aggregatedImportance * 0.2);
        existing.growthPct = prevCount > 0 ? Math.round(((existing.occurrenceCount - prevCount) / prevCount) * 100) : undefined;
      } else {
        bySignature.set(hp.signature, { ...hp });
      }
    }

    const patterns = Array.from(bySignature.values())
      .map((p) => ({ ...p, isRecurring: p.occurrenceCount >= LearningEngine.RECURRING_THRESHOLD }))
      .filter((p) => p.occurrenceCount >= 2)
      .sort((a, b) => b.aggregatedImportance - a.aggregatedImportance);

    void input; // input déjà utilisé indirectement via lessons[]
    return patterns;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3. Générer des améliorations applicables
  // ──────────────────────────────────────────────────────────────────────

  private generateAutoImprovements(lessons: Lesson[], input: MissionLearningInput): AutoImprovement[] {
    const improvements: AutoImprovement[] = [];

    for (const lesson of lessons) {
      if (lesson.type === "error_pattern") {
        improvements.push({
          id: randomUUID(),
          kind: "todo_create",
          label: `TODO : investiguer l'erreur récurrente sur ${lesson.filePath || "module"}`,
          rationale: lesson.description,
          estimatedPayoff: 0.6,
          estimatedEffort: 2,
          autoApplicable: true,
          payload: {
            kind: "todo_create",
            content: `Investiguer le pattern d'erreur: ${lesson.description.slice(0, 200)}`,
          },
        });
      }

      if (lesson.type === "optimization" && lesson.filePath) {
        improvements.push({
          id: randomUUID(),
          kind: "refactor_suggestion",
          label: `Réf. suggérée sur ${lesson.filePath}`,
          rationale: lesson.description,
          estimatedPayoff: 0.5,
          estimatedEffort: 4,
          autoApplicable: true,
          payload: {
            kind: "refactor_suggestion",
            module: lesson.filePath,
            description: `Opportunité d'optimisation détectée: ${lesson.recommendation}`,
          },
        });
      }

      if (lesson.type === "decision") {
        improvements.push({
          id: randomUUID(),
          kind: "memory_insert",
          label: `Mémoriser la décision dans ProjectMemory`,
          rationale: lesson.description,
          estimatedPayoff: 0.4,
          estimatedEffort: 1,
          autoApplicable: true,
          payload: {
            kind: "memory_insert",
            category: "decision",
            content: lesson.description,
            tags: [`lesson:${lesson.type}`, `mission:${input.missionId}`, "learning-auto"],
            sourceFile: lesson.filePath,
          },
        });
      }
    }

    // ── Pattern d'optimisation global : si la mission touche beaucoup de fichiers
    // mais surtout des fichiers tests → flagger le module sous-jacent ──
    const testFiles = input.touchedFiles.filter((f) => /\.test\.|\.spec\.|\/tests?\//i.test(f));
    if (testFiles.length > 2) {
      improvements.push({
        id: randomUUID(),
        kind: "memory_insert",
        label: "Module avec beaucoup de tests touchés",
        rationale: `${testFiles.length} fichiers de test modifiés → la logique sous-jacente est probablement en évolution.`,
        estimatedPayoff: 0.35,
        estimatedEffort: 1,
        autoApplicable: true,
        payload: {
          kind: "memory_insert",
          category: "refactoring",
          content: `Forte activité sur les tests (${testFiles.length} fichiers) dans la mission "${input.missionTitle}". Surveiller les modules testés pour stabiliser l'API.`,
          tags: ["test-activity", `mission:${input.missionId}`, "learning-auto"],
        },
      });
    }

    // Dédupliquer par label
    const seen = new Set<string>();
    return improvements.filter((i) => (seen.has(i.label) ? false : (seen.add(i.label), true)));
  }

  // ──────────────────────────────────────────────────────────────────────
  // 4. Appliquer une amélioration autoApplicable
  // ──────────────────────────────────────────────────────────────────────

  private applyImprovement(imp: AutoImprovement, missionId: string): { applied: boolean; filesTouched?: string[] } {
    switch (imp.payload.kind) {
      case "memory_insert": {
        const p = imp.payload;
        projectMemory.addFact({
          content: p.content,
          category: p.category,
          tags: p.tags,
          sourceFile: p.sourceFile,
          confidence: 0.7,
        });
        return { applied: true };
      }
      case "memory_tag": {
        const fact = projectMemory.getFact(imp.payload.factId);
        if (!fact) return { applied: false };
        for (const t of imp.payload.tagsToAdd) {
          if (!fact.tags.includes(t)) fact.tags.push(t);
        }
        fact.updatedAt = new Date().toISOString();
        return { applied: true };
      }
      case "todo_create": {
        projectMemory.addFact({
          content: imp.payload.content,
          category: "todo",
          tags: ["learning-auto", `mission:${missionId}`, "auto-todo"],
          confidence: 0.6,
        });
        return { applied: true };
      }
      case "refactor_suggestion": {
        projectMemory.addFact({
          content: `[Refactor suggéré] ${imp.payload.module} : ${imp.payload.description}`,
          category: "refactoring",
          tags: ["refactor-suggestion", `mission:${missionId}`, "learning-auto"],
          sourceFile: imp.payload.module,
          confidence: 0.55,
        });
        return { applied: true };
      }
      case "convention_document": {
        projectMemory.addFact({
          content: `Convention implicite observée : ${imp.payload.convention}`,
          category: "convention",
          tags: ["convention-doc", `mission:${missionId}`, "learning-auto"],
          confidence: 0.6,
        });
        return { applied: true };
      }
      case "impact_weight_tweak": {
        projectMemory.addFact({
          content: `Suggestion d'ajustement de poids ImpactAnalyzer : critère ${imp.payload.criterion} Δ${imp.payload.delta.toFixed(2)} — raison: ${imp.payload.reason}`,
          category: "todo",
          tags: ["impact-weight", `mission:${missionId}`, "learning-auto"],
          confidence: 0.5,
        });
        return { applied: true };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 5. Persister les leçons en ProjectMemory (appelé par learnFromAction)
  // ──────────────────────────────────────────────────────────────────────

  private persistLessons(lessons: Lesson[], missionId: string): string[] {
    const ids: string[] = [];
    for (const l of lessons) {
      const category: ProjectKnowledgeCategory =
        l.type === "error_pattern" ? "known-bug"
        : l.type === "decision" ? "decision"
        : l.type === "optimization" ? "refactoring"
        : "pattern";
      const id = projectMemory.addFact({
        content: `${l.description} | Recommandation: ${l.recommendation}`,
        category,
        tags: [
          `lesson:${l.type}`,
          `mission:${missionId}`,
          `importance:${l.importance.toFixed(2)}`,
          "learning-engine",
        ],
        sourceFile: l.filePath,
        confidence: l.importance,
      });
      ids.push(id);
    }
    projectMemory.save();
    return ids;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers de recommandations
  // ──────────────────────────────────────────────────────────────────────

  private recommendationForError(
    action: MissionLearningInput["actions"][number],
    priorErrors?: string[]
  ): string {
    const hasRetries = (action.attemptNumber || 0) > 1;
    const fileHint = action.files?.[0] ? `Relire attentivement ${action.files[0]} avant retentative.` : "";
    if (priorErrors && priorErrors.length >= 2) {
      return `Ce type d'erreur est récurrent sur la mission. Vérifier la pré-condition avant d'appeler ${action.actionName}. ${fileHint}`;
    }
    if (hasRetries) {
      return `Échec après ${action.attemptNumber} tentatives. Envisager une stratégie alternative (replanning, skill différent, demande utilisateur). ${fileHint}`;
    }
    return `Vérifier les hypothèses d'appel pour ${action.actionName} et ajouter un garde-corps explicite si le cas se reproduit. ${fileHint}`;
  }

  private recommendationForPattern(p: DetectedPattern): string {
    switch (p.type) {
      case "error_pattern":
        return `Ce pattern d'échec revient ${p.occurrenceCount}× — il faut traiter la cause racine (pas seulement le symptôme).`;
      case "success_pattern":
        return `Pattern gagnant récurrent (${p.occurrenceCount}×) : réutiliser systématiquement cette séquence dans les missions analogues.`;
      case "optimization":
        return `Opportunité d'optimisation récurrente : appliquer avant les prochaines missions pour gagner du temps.`;
      case "decision":
        return `Décision confirmée ${p.occurrenceCount}× : élever en convention projet (ProjectMemory cat="convention").`;
    }
  }

  private buildSummary(
    input: MissionLearningInput,
    lessons: Lesson[],
    applied: string[],
    patterns: DetectedPattern[]
  ): string {
    const total = input.actions.length;
    const failed = input.actions.filter((a) => !a.success).length;
    const retries = input.actions.reduce((s, a) => s + Math.max(0, (a.attemptNumber || 1) - 1), 0);

    const lines: string[] = [];
    lines.push(`# Rapport d'apprentissage — Mission "${input.missionTitle}"\n`);
    lines.push(`**Résultat global :** ${input.overallSuccess ? "✅ Succès" : "❌ Échec"}`);
    lines.push(`- **Actions** : ${total} (réussies ${total - failed}, échecs ${failed}, retries ${retries})`);
    lines.push(`- **Fichiers touchés** : ${input.touchedFiles.length}`);
    lines.push(`- **Leçons extraites** : ${lessons.length}`);
    lines.push(`- **Patterns détectés** : ${patterns.length} (récurrents : ${patterns.filter((p) => p.isRecurring).length})`);
    lines.push(`- **Améliorations auto-appliquées** : ${applied.length}\n`);

    const perType: Record<Lesson["type"], number> = {
      error_pattern: 0, success_pattern: 0, optimization: 0, decision: 0,
    };
    for (const l of lessons) perType[l.type]++;
    lines.push(`**Répartition des leçons :**`);
    lines.push(`- ⚠️  Erreurs : ${perType.error_pattern}`);
    lines.push(`- ✅  Succès : ${perType.success_pattern}`);
    lines.push(`- ⚡  Optimisations : ${perType.optimization}`);
    lines.push(`- 🎯  Décisions : ${perType.decision}\n`);

    if (lessons.length > 0) {
      lines.push(`**Top 5 leçons (par importance) :**\n`);
      for (const l of lessons.slice(0, 5)) {
        const ico =
          l.type === "error_pattern" ? "⚠️" :
          l.type === "success_pattern" ? "✅" :
          l.type === "optimization" ? "⚡" : "🎯";
        lines.push(`${ico}  **${(l.importance * 100).toFixed(0)}% —** ${l.description.slice(0, 160)}`);
        lines.push(`   → _${l.recommendation}_\n`);
      }
    }

    if (applied.length > 0) {
      lines.push(`**Améliorations appliquées :**`);
      for (const a of applied) lines.push(`- ${a}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const learningEngine = new LearningEngine();
