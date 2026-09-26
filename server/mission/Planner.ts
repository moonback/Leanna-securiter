import { randomUUID } from "crypto";
import type {
  Goal,
  GoalPriority,
  PlannedAction,  SkillScore,
} from "./types.js";
import { Mission } from "./Mission.js";
import { SkillScorer } from "./SkillScorer.js";
import { strategyMemory } from "../knowledge/StrategyMemory.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Planner — Décomposition hiérarchique des objectifs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Le Planner décompose un objectif de haut niveau en sous-objectifs concrets
 * et planifie les actions nécessaires pour chaque sous-objectif.
 *
 * Architecture:
 *   Mission (gros objectif)
 *     └─ Planner.decompose() → sous-objectifs ordonnés
 *         └─ Planner.planActions() → actions scorées pour chaque objectif
 *
 * Le Planner utilise le LLM pour la décomposition intelligente,
 * et le SkillScorer pour choisir les bons outils.
 */
export class Planner {
  private scorer: SkillScorer;
  private llmDecompose: DecomposeFunction | null = null;

  constructor(scorer: SkillScorer) {
    this.scorer = scorer;
  }

  /**
   * Injecte la fonction de décomposition LLM.
   * Permet de découpler le Planner de l'implémentation Gemini.
   */
  setDecomposeFunction(fn: DecomposeFunction): void {
    this.llmDecompose = fn;
  }

  // ─── Décomposition ────────────────────────────────────────────────────────

  /**
   * Décompose un objectif en sous-objectifs concrets.
   * Utilise le LLM si disponible, sinon une heuristique simple.
   */
  async decompose(
    mission: Mission,
    goalId: string,
    availableSkills: string[]
  ): Promise<SubGoalPlan[]> {
    const goal = mission.getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    // Si le LLM est disponible, utiliser la décomposition intelligente
    if (this.llmDecompose) {
      return this.decomposeWithLLM(mission, goal, availableSkills);
    }

    // Fallback: décomposition heuristique simple
    return this.decomposeHeuristic(goal, availableSkills);
  }

  /**
   * Planifie les actions pour un objectif donné.
   * Score les skills disponibles et retourne les top-N actions.
   */
  async planActions(
    mission: Mission,
    goalId: string,
    availableSkills: string[],
    maxActions: number = 5
  ): Promise<PlannedAction[]> {
    const goal = mission.getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const context = mission.getContext();
    const metrics = mission.getMetrics();

    // Scorer chaque skill pour cet objectif
    const scores: SkillScore[] = [];
    for (const skillName of availableSkills) {
      const score = this.scorer.scoreSkill(skillName, {
        goalTitle: goal.title,
        goalDescription: goal.description,
        successCriteria: goal.successCriteria,
        previousErrors: context.errors.map((e) => e.error),
        previousActions: goal.plannedActions
          .filter((a) => a.status === "completed" || a.status === "failed")
          .map((a) => ({ skill: a.skillName, success: a.status === "completed" })),
        relevantFiles: context.relevantFiles,
        averageConfidence: metrics.averageConfidence,
      });

      if (score.totalScore >= mission.getConfig().minSkillScore) {
        scores.push(score);
      }
    }

    // Trier par score décroissant et prendre les top-N
    scores.sort((a, b) => b.totalScore - a.totalScore);
    const topSkills = scores.slice(0, maxActions);

    // Convertir en PlannedActions
    return topSkills.map((score, index) => ({
      id: randomUUID(),
      skillName: score.skillName,
      args: {}, // Les args seront remplis par l'Executor au moment de l'exécution
      rationale: score.rationale,
      score: score.totalScore,
      order: index + 1,
      status: "pending" as const,
    }));
  }

  /**
   * Replanifie un objectif après un échec.
   * Prend en compte les erreurs précédentes pour ajuster la stratégie.
   */
  async replan(
    mission: Mission,
    goalId: string,
    failedAction: PlannedAction,
    error: string,
    availableSkills: string[]
  ): Promise<PlannedAction[]> {
    const goal = mission.getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    // Enregistrer l'erreur dans le contexte
    mission.addError(failedAction.skillName, error);

    // Exclure le skill qui a échoué (si déjà échoué plusieurs fois)
    const failCount = mission
      .getContext()
      .errors.filter((e) => e.action === failedAction.skillName).length;

    // Boucle d'apprentissage inter-missions (GAP-1) : lors d'une replanification,
    // écarter aussi les outils durablement peu fiables (mémoire de stratégie),
    // même sans échec re-observé dans cette mission — mais toujours en gardant au
    // moins un outil disponible pour ne pas rendre la replanification impossible.
    const durableFailing = this.durableFailingSkillNames(availableSkills);
    const toExclude = new Set<string>(durableFailing);
    if (failCount >= 2) toExclude.add(failedAction.skillName);

    const filtered = availableSkills.filter((s) => !toExclude.has(s));
    const filteredSkills = filtered.length > 0 ? filtered : availableSkills;

    // Ajouter une hypothèse corrective
    mission.addHypothesis(
      `Le skill "${failedAction.skillName}" a échoué (${failCount}x). ` +
        `Erreur: ${error}. Chercher une alternative.`
    );

    // Replanifier avec les skills restants
    return this.planActions(mission, goalId, filteredSkills);
  }

  // ─── Décomposition LLM ────────────────────────────────────────────────────

  private async decomposeWithLLM(
    mission: Mission,
    goal: Goal,
    availableSkills: string[]
  ): Promise<SubGoalPlan[]> {
    const prompt = this.buildDecomposePrompt(mission, goal, availableSkills);

    const timeoutMs = 20_000;
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`LLM decomposition timeout (${timeoutMs}ms)`)), timeoutMs);
    });

    try {
      const result = await Promise.race([
        this.llmDecompose!(prompt),
        timeoutPromise,
      ]);
      const parsed = this.parseDecomposeResult(result);
      if (parsed && parsed.length > 0) return parsed;
      throw new Error("LLM returned empty plan");
    } catch (err) {
      console.warn(`[Planner] LLM decomposition failed, falling back to heuristic:`, err);
      return this.decomposeHeuristic(goal, availableSkills);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private buildDecomposePrompt(
    mission: Mission,
    goal: Goal,
    availableSkills: string[]
  ): string {
    const context = mission.getContext();

    // Boucle d'apprentissage inter-missions (GAP-1) : avertir le planificateur
    // des outils qui ont historiquement échoué, en s'appuyant uniquement sur
    // les outils disponibles pour cette mission.
    const failingWarning = this.buildFailingSkillsWarning(availableSkills);

    return `Tu es un planificateur de tâches. Décompose cet objectif en sous-étapes concrètes.

OBJECTIF: ${goal.title}
DESCRIPTION: ${goal.description}
CRITÈRES DE SUCCÈS:
${goal.successCriteria.map((c) => `  - ${c}`).join("\n")}

CONTEXTE:
- Fichiers pertinents: ${context.relevantFiles.slice(0, 10).join(", ") || "aucun"}
- Erreurs passées: ${context.errors.slice(-3).map((e) => e.error).join("; ") || "aucune"}
- Hypothèses: ${context.hypotheses.slice(-3).join("; ") || "aucune"}
${failingWarning}
OUTILS DISPONIBLES: ${availableSkills.join(", ")}

INSTRUCTIONS:
- Décompose en 2 à 6 sous-étapes ordonnées
- Chaque étape doit être concrète et vérifiable
- Indique la priorité (low/medium/high/critical)
- Indique les dépendances entre étapes

RÉPONDS EN JSON STRICT:
[
  {
    "title": "...",
    "description": "...",
    "successCriteria": ["..."],
    "priority": "medium",
    "dependsOn": []
  }
]`;
  }

  /** Noms des outils disponibles marqués durablement peu fiables. Best-effort. */
  private durableFailingSkillNames(availableSkills: string[]): string[] {
    try {
      const available = new Set(availableSkills);
      return strategyMemory
        .getFailingSkills()
        .map((s) => s.skillName)
        .filter((name) => available.has(name));
    } catch {
      return [];
    }
  }

  /**
   * Construit un avertissement, à injecter dans le prompt de décomposition,
   * listant les outils disponibles historiquement peu fiables (mémoire de
   * stratégie durable). Retourne une chaîne vide si aucun signal fiable.
   */
  private buildFailingSkillsWarning(availableSkills: string[]): string {
    let failing: { skillName: string; recentSuccessRate: number; totalCalls: number }[] = [];
    try {
      const available = new Set(availableSkills);
      failing = strategyMemory
        .getFailingSkills()
        .filter((s) => available.has(s.skillName));
    } catch {
      return "";
    }
    if (failing.length === 0) return "";
    const lines = failing
      .slice(0, 5)
      .map(
        (s) =>
          `  - ${s.skillName} (succès récent ${Math.round(s.recentSuccessRate * 100)}% sur ${s.totalCalls} appels)`,
      )
      .join("\n");
    return `\nOUTILS HISTORIQUEMENT PEU FIABLES (préférer une alternative si possible):\n${lines}\n`;
  }

  private parseDecomposeResult(result: string): SubGoalPlan[] {
    try {
      // Extraire le JSON du résultat (peut contenir du texte autour)
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("No JSON array found in LLM response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error("Expected array");
      }

      return parsed.map((item: any, index: number) => ({
        title: String(item.title || `Étape ${index + 1}`),
        description: String(item.description || ""),
        successCriteria: Array.isArray(item.successCriteria)
          ? item.successCriteria.map(String)
          : ["Étape complétée"],
        priority: (item.priority as GoalPriority) || "medium",
        dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
        order: index + 1,
      }));
    } catch (err) {
      console.warn(`[Planner] Failed to parse LLM decompose result:`, err);
      return [];
    }
  }

  // ─── Décomposition heuristique ────────────────────────────────────────────

  private decomposeHeuristic(goal: Goal, _availableSkills: string[]): SubGoalPlan[] {


    const text = `${goal.title} ${goal.description}`.toLowerCase();

    const hasFiles = /(\.tsx?|\.jsx?|\.json|\.py|\.rs|\.go|\.md|\/[A-Za-z0-9_-]+\/)/.test(`${goal.title} ${goal.description}`);
    const scopeKeywords = text.match(/\b(\d+)\s*(fichiers?|modules?|fns?|fonctions?)\b/g);
    const estimatedScope = scopeKeywords
      ? Math.max(2, Math.min(6, (scopeKeywords.length + 1) * 2))
      : hasFiles ? 3 : 2;

    const makePlan = (steps: Array<{ t: string; d: string; sc: string[]; p: "critical"|"high"|"medium"|"low"; deps: string[] }>): SubGoalPlan[] =>
      steps.map((s, i) => ({
        title: s.t, description: s.d, successCriteria: s.sc,
        priority: s.p, dependsOn: s.deps, order: i + 1,
      }));

    if (text.includes("créer") || text.includes("ajouter") || text.includes("implémenter")) {
      const baseSteps: Parameters<typeof makePlan>[0] = [
        { t: "Analyser le contexte existant", d: "Lire les fichiers pertinents et comprendre l'architecture actuelle", sc: ["Fichiers pertinents identifiés", "Architecture comprise"], p: "high", deps: [] },
        { t: "Concevoir la solution", d: `Définir le plan d'implémentation pour: ${goal.title}`, sc: ["Structure décidée", "Points d'intégration identifiés"], p: "high", deps: ["Analyser le contexte existant"] },
        { t: "Implémenter la fonctionnalité", d: `Écrire le code pour: ${goal.title}`, sc: goal.successCriteria, p: "high", deps: ["Concevoir la solution"] },
      ];
      if (estimatedScope >= 4) {
        baseSteps.push({ t: "Intégrer et lier les modules", d: "Connecter les nouvelles briques entre elles et au projet", sc: ["Aucune dépendance cassée", "Intégration OK"], p: "high", deps: ["Implémenter la fonctionnalité"] });
      }
      baseSteps.push({ t: "Vérifier et valider", d: "Compiler, lancer les vérifications statiques et les tests associés", sc: ["Compilation réussie", "Aucune régression"], p: "medium", deps: [estimatedScope >= 4 ? "Intégrer et lier les modules" : "Implémenter la fonctionnalité"] });
      return makePlan(baseSteps);
    }

    if (text.includes("corriger") || text.includes("fix") || text.includes("bug") || text.includes("erreur") || text.includes("régression")) {
      const baseSteps: Parameters<typeof makePlan>[0] = [
        { t: "Identifier la cause", d: "Reproduire le problème et localiser la source", sc: ["Fichier source identifié", "Cause racine comprise"], p: "critical", deps: [] },
        { t: "Concevoir le correctif", d: "Définir une correction sans effet de bord", sc: ["Approche validée", "Impact maîtrisé"], p: "high", deps: ["Identifier la cause"] },
        { t: "Appliquer le correctif", d: "Corriger le code source", sc: ["Correction appliquée"], p: "high", deps: ["Concevoir le correctif"] },
      ];
      baseSteps.push({ t: "Vérifier la correction", d: "S'assurer que le bug est résolu et qu'aucune régression n'est introduite", sc: ["Bug résolu", "Pas de régression"], p: "high", deps: ["Appliquer le correctif"] });
      return makePlan(baseSteps);
    }

    if (text.includes("refactor") || text.includes("refacto") || text.includes("nettoyer") || text.includes("réorganiser") || text.includes("restructurer")) {
      return makePlan([
        { t: "Auditer le document cible", d: `Lire et comprendre la structure actuelle à réorganiser`, sc: ["Structure actuelle comprise", "Points de douleur listés"], p: "high", deps: [] },
        { t: "Planifier la restructuration", d: "Définir les sections et sous-sections de sortie", sc: ["Nouvelle structure décidée"], p: "high", deps: ["Auditer le document cible"] },
        { t: "Appliquer la restructuration", d: "Réorganiser le contenu selon le nouveau plan", sc: ["Contenu réorganisé sans perte d'information"], p: "high", deps: ["Planifier la restructuration"] },
        { t: "Valider", d: "Vérifier cohérence et complétude", sc: ["Aucune information perdue", "Structure logique"], p: "high", deps: ["Appliquer la restructuration"] },
      ]);
    }

    return makePlan([
      { t: "Comprendre le besoin", d: `Analyser: ${goal.description}`, sc: ["Besoin compris", "Critères de succès clairs"], p: "high", deps: [] },
      { t: "Exécuter l'action", d: goal.description, sc: goal.successCriteria, p: "high", deps: ["Comprendre le besoin"] },
      { t: "Vérifier le résultat", d: "Contrôler le résultat attendu", sc: ["Critères atteints"], p: "medium", deps: ["Exécuter l'action"] },
    ]);
  }
}

// ─── Types internes ───────────────────────────────────────────────────────────

/** Sous-objectif planifié (avant insertion dans la mission) */
export interface SubGoalPlan {
  title: string;
  description: string;
  successCriteria: string[];
  priority: GoalPriority;
  dependsOn: string[];
  order: number;
}

/** Fonction de décomposition via LLM (injectée) */
export type DecomposeFunction = (prompt: string) => Promise<string>;
