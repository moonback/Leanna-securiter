import type { SkillScore } from "./types.js";
import type { SkillReliabilityStats } from "../knowledge/StrategyMemory.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SkillScorer — Sélection intelligente des outils
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule un score pour chaque skill disponible en fonction du contexte.
 *
 * Score = pertinence (0-30)
 *       + historique (0-20)
 *       + temps estimé (0-15)
 *       + probabilité de succès (0-20)
 *       + coût token (0-15)
 *
 * Permet à l'agent de choisir les bons outils au bon moment
 * au lieu de s'appuyer uniquement sur le prompt.
 */
export class SkillScorer {
  /** Historique d'utilisation des skills: skill → { success, failure, avgDurationMs } */
  private usageHistory: Map<string, SkillUsageStats> = new Map();

  /** Mapping de catégories de skills pour le calcul de pertinence */
  private skillCategories: Map<string, SkillCategory> = new Map();

  /** Mots-clés associés aux skills pour le matching sémantique */
  private skillKeywords: Map<string, string[]> = new Map();

  constructor() {
    this.initializeCategories();
  }

  // ─── Scoring ──────────────────────────────────────────────────────────────

  /**
   * Score un skill pour un objectif donné.
   */
  scoreSkill(skillName: string, context: ScoringContext): SkillScore {
    const relevance = this.scoreRelevance(skillName, context);
    const history = this.scoreHistory(skillName);
    const estimatedTime = this.scoreTime(skillName);
    const successProbability = this.scoreSuccessProbability(skillName, context);
    const tokenCost = this.scoreTokenCost(skillName);

    const totalScore = relevance + history + estimatedTime + successProbability + tokenCost;

    return {
      skillName,
      totalScore,
      breakdown: {
        relevance,
        history,
        estimatedTime,
        successProbability,
        tokenCost,
      },
      rationale: this.buildRationale(skillName, {
        relevance,
        history,
        estimatedTime,
        successProbability,
        tokenCost,
      }),
    };
  }

  /**
   * Score tous les skills et retourne le classement.
   */
  scoreAll(availableSkills: string[], context: ScoringContext): SkillScore[] {
    return availableSkills
      .map((skill) => this.scoreSkill(skill, context))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  // ─── Historique ───────────────────────────────────────────────────────────

  /**
   * Enregistre un usage de skill (appelé après chaque exécution).
   */
  recordUsage(skillName: string, success: boolean, durationMs: number): void {
    const stats = this.usageHistory.get(skillName) ?? {
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
      totalCalls: 0,
      lastUsed: "",
      recentResults: [],
    };

    stats.totalCalls++;
    stats.totalDurationMs += durationMs;
    stats.lastUsed = new Date().toISOString();

    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    // Garder les 20 derniers résultats
    stats.recentResults.push({ success, durationMs, at: new Date().toISOString() });
    if (stats.recentResults.length > 20) {
      stats.recentResults.shift();
    }

    this.usageHistory.set(skillName, stats);
  }

  /**
   * Amorce l'historique d'usage à partir de la mémoire de stratégie durable
   * (StrategyMemory). Ferme la boucle d'apprentissage inter-missions : un skill
   * qui a historiquement échoué obtient un score d'historique/probabilité plus
   * faible dès la PREMIÈRE planification d'une nouvelle mission, sans attendre
   * un échec re-observé dans le processus courant.
   *
   * On ne remplace pas l'historique déjà accumulé en cours de mission : les
   * observations vivantes priment. On ne fait qu'amorcer les skills encore vierges.
   */
  seedFromReliability(stats: SkillReliabilityStats[]): void {
    for (const s of stats) {
      if (this.usageHistory.has(s.skillName)) continue;
      if (s.totalCalls <= 0) continue;
      const successCount = Math.round(s.successRate * s.totalCalls);
      const failureCount = Math.max(0, s.totalCalls - successCount);
      // Reconstituer une fenêtre récente cohérente avec le taux de succès récent.
      const recentLen = Math.min(10, s.totalCalls);
      const recentSuccesses = Math.round(s.recentSuccessRate * recentLen);
      const recentResults = Array.from({ length: recentLen }, (_v, i) => ({
        success: i < recentSuccesses,
        durationMs: s.avgDurationMs,
        at: new Date().toISOString(),
      }));
      this.usageHistory.set(s.skillName, {
        successCount,
        failureCount,
        totalDurationMs: s.avgDurationMs * s.totalCalls,
        totalCalls: s.totalCalls,
        lastUsed: new Date().toISOString(),
        recentResults,
      });
    }
  }

  /**
   * Enregistre les mots-clés d'un skill (pour le scoring de pertinence).
   */
  registerSkillKeywords(skillName: string, keywords: string[]): void {
    this.skillKeywords.set(skillName, keywords.map((k) => k.toLowerCase()));
  }

  /**
   * Enregistre la catégorie d'un skill.
   */
  registerSkillCategory(skillName: string, category: SkillCategory): void {
    this.skillCategories.set(skillName, category);
  }

  // ─── Scoring interne ──────────────────────────────────────────────────────

  /**
   * Pertinence (0-30): Le skill est-il adapté à l'objectif ?
   */
  private scoreRelevance(skillName: string, context: ScoringContext): number {
    let score = 0;

    // Matching par mots-clés
    const keywords = this.skillKeywords.get(skillName) ?? [];
    const goalText = `${context.goalTitle} ${context.goalDescription}`.toLowerCase();

    for (const keyword of keywords) {
      if (goalText.includes(keyword)) {
        score += 5;
      }
    }

    // Matching par catégorie
    const category = this.skillCategories.get(skillName);
    if (category) {
      if (goalText.includes("lire") || goalText.includes("analyser") || goalText.includes("comprendre")) {
        if (category === "read" || category === "analysis") score += 10;
      }
      if (goalText.includes("écrire") || goalText.includes("créer") || goalText.includes("modifier")) {
        if (category === "write" || category === "code") score += 10;
      }
      if (goalText.includes("vérifier") || goalText.includes("tester") || goalText.includes("valider")) {
        if (category === "verify" || category === "test") score += 10;
      }
      if (goalText.includes("chercher") || goalText.includes("trouver") || goalText.includes("rechercher")) {
        if (category === "search" || category === "read") score += 10;
      }
    }

    // Matching par fichiers pertinents
    if (context.relevantFiles.length > 0) {
      if (category === "read" || category === "write" || category === "code") {
        score += 5;
      }
    }

    return Math.min(30, score);
  }

  /**
   * Historique (0-20): Le skill a-t-il bien fonctionné par le passé ?
   */
  private scoreHistory(skillName: string): number {
    const stats = this.usageHistory.get(skillName);
    if (!stats || stats.totalCalls === 0) {
      // Pas d'historique → score neutre
      return 10;
    }

    const successRate = stats.successCount / stats.totalCalls;

    // Score basé sur le taux de succès récent (les 10 derniers)
    const recent = stats.recentResults.slice(-10);
    const recentSuccessRate =
      recent.length > 0
        ? recent.filter((r) => r.success).length / recent.length
        : successRate;

    // Pondérer vers le récent (70% récent, 30% global)
    const weightedRate = recentSuccessRate * 0.7 + successRate * 0.3;

    return Math.round(weightedRate * 20);
  }

  /**
   * Temps estimé (0-15): Le skill est-il rapide ?
   */
  private scoreTime(skillName: string): number {
    const stats = this.usageHistory.get(skillName);
    if (!stats || stats.totalCalls === 0) {
      return 8; // Neutre
    }

    const avgMs = stats.totalDurationMs / stats.totalCalls;

    // Plus c'est rapide, meilleur le score
    if (avgMs < 1000) return 15;
    if (avgMs < 3000) return 12;
    if (avgMs < 10000) return 9;
    if (avgMs < 30000) return 6;
    if (avgMs < 60000) return 3;
    return 1;
  }

  /**
   * Probabilité de succès (0-20): Compte tenu du contexte actuel.
   */
  private scoreSuccessProbability(skillName: string, context: ScoringContext): number {
    let score = 10; // Base neutre

    // Pénalité si le skill a déjà échoué pour ce type d'objectif
    const previousFailures = context.previousActions.filter(
      (a) => a.skill === skillName && !a.success
    );
    score -= previousFailures.length * 5;

    // Bonus si le skill a déjà réussi pour ce type d'objectif
    const previousSuccesses = context.previousActions.filter(
      (a) => a.skill === skillName && a.success
    );
    score += previousSuccesses.length * 3;

    // Pénalité si l'erreur précédente mentionne ce skill
    if (context.previousErrors.some((e) => e.toLowerCase().includes(skillName.toLowerCase()))) {
      score -= 5;
    }

    // Ajustement par la confiance globale
    score += Math.round((context.averageConfidence - 0.5) * 10);

    return Math.max(0, Math.min(20, score));
  }

  /**
   * Coût token (0-15): Le skill est-il économique en tokens ?
   */
  private scoreTokenCost(skillName: string): number {
    // Estimation basée sur la catégorie
    const category = this.skillCategories.get(skillName);

    switch (category) {
      case "read":
        return 12; // Lectures = peu de tokens de sortie
      case "search":
        return 11;
      case "verify":
        return 13; // Vérifications = réponse courte
      case "write":
        return 8; // Écriture = plus de tokens
      case "code":
        return 6; // Code génération = beaucoup de tokens
      case "analysis":
        return 7;
      case "system":
        return 14; // Commandes système = très peu de tokens
      case "memory":
        return 13;
      default:
        return 8;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildRationale(
    skillName: string,
    scores: SkillScore["breakdown"]
  ): string {
    const parts: string[] = [];

    if (scores.relevance >= 20) parts.push("très pertinent pour l'objectif");
    else if (scores.relevance >= 10) parts.push("pertinent");

    if (scores.history >= 15) parts.push("bon historique");
    else if (scores.history <= 5) parts.push("historique d'échecs");

    if (scores.successProbability >= 15) parts.push("forte probabilité de succès");
    else if (scores.successProbability <= 5) parts.push("risque d'échec élevé");

    if (scores.estimatedTime >= 12) parts.push("rapide");
    if (scores.tokenCost >= 12) parts.push("économique");

    return parts.length > 0
      ? `${skillName}: ${parts.join(", ")}`
      : `${skillName}: score moyen, pas de signal fort`;
  }

  private initializeCategories(): void {
    // Catégorisation par défaut des skills connus de Leanna
    const defaults: Record<string, { category: SkillCategory; keywords: string[] }> = {
      read_project_file: { category: "read", keywords: ["lire", "fichier", "code", "contenu"] },
      write_project_file: { category: "write", keywords: ["écrire", "créer", "fichier", "code"] },
      modify_project_file: { category: "write", keywords: ["modifier", "éditer", "patch"] },
      patch_project_file: { category: "write", keywords: ["corriger", "patch", "ligne"] },
      list_project_files: { category: "read", keywords: ["lister", "arborescence", "structure"] },
      search_in_files: { category: "search", keywords: ["chercher", "trouver", "rechercher", "grep"] },
      run_command: { category: "system", keywords: ["exécuter", "commande", "npm", "git"] },
      verify_file: { category: "verify", keywords: ["vérifier", "typescript", "compilation"] },
      verify_typecheck: { category: "verify", keywords: ["types", "typescript", "tsc"] },
      verify_run_script: { category: "test", keywords: ["test", "tester", "script"] },
      save_memory: { category: "memory", keywords: ["mémoire", "sauvegarder", "retenir", "noter"] },
      search_memory: { category: "memory", keywords: ["rappeler", "mémoire", "souvenir"] },
      reasoning_think: { category: "analysis", keywords: ["réfléchir", "analyser", "comprendre", "planifier"] },
      generate_codebase_markdown: { category: "analysis", keywords: ["codebase", "structure", "documenter"] },
      github_list_prs: { category: "read", keywords: ["github", "pr", "pull request"] },
      github_create_issue: { category: "write", keywords: ["github", "issue", "créer"] },
    };

    for (const [skill, config] of Object.entries(defaults)) {
      this.skillCategories.set(skill, config.category);
      this.skillKeywords.set(skill, config.keywords);
    }
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Catégorie de skill */
export type SkillCategory =
  | "read"
  | "write"
  | "search"
  | "verify"
  | "test"
  | "system"
  | "memory"
  | "analysis"
  | "code"
  | "communication";

/** Statistiques d'usage d'un skill */
interface SkillUsageStats {
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  totalCalls: number;
  lastUsed: string;
  recentResults: { success: boolean; durationMs: number; at: string }[];
}

/** Contexte pour le scoring */
export interface ScoringContext {
  goalTitle: string;
  goalDescription: string;
  successCriteria: string[];
  previousErrors: string[];
  previousActions: { skill: string; success: boolean }[];
  relevantFiles: string[];
  averageConfidence: number;
}
