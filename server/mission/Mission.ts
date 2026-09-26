import { randomUUID } from "crypto";
import type {
  MissionState,
  Goal,
  GoalStatus,
  GoalPriority,
  GoalResult,
  PlannedAction,
  MissionContext,
  MissionMetrics,
  MissionConfig,
  ReflectionResult,
} from "./types.js";
import { DEFAULT_MISSION_CONFIG } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Mission — État persistant et Goal Stack
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gère l'état global d'une mission (objectif de haut niveau de l'utilisateur).
 * Maintient la Goal Stack, le contexte accumulé, et les métriques.
 *
 * Contrairement au mode conversationnel qui "redémarre" à chaque message,
 * le Mission Manager maintient un état continu jusqu'à complétion.
 */
export class Mission {
  private state: MissionState;
  private config: MissionConfig;

  constructor(
    title: string,
    description: string,
    priority: GoalPriority = "medium",
    config: Partial<MissionConfig> = {}
  ) {
    this.config = { ...DEFAULT_MISSION_CONFIG, ...config };

    const missionId = randomUUID();
    const rootGoalId = randomUUID();
    const now = new Date().toISOString();

    // Créer l'objectif racine (= la mission elle-même)
    const rootGoal: Goal = {
      id: rootGoalId,
      parentId: null,
      title,
      description,
      successCriteria: [`La mission "${title}" est complétée avec succès.`],
      priority,
      status: "pending",
      children: [],
      plannedActions: [],
      attempts: 0,
      maxAttempts: this.config.maxRetries,
      createdAt: now,
    };

    this.state = {
      id: missionId,
      title,
      description,
      status: "pending",
      priority,
      goalStack: [rootGoalId],
      goals: { [rootGoalId]: rootGoal },
      activeGoalId: rootGoalId,
      reflections: [],
      context: {
        relevantFiles: [],
        decisions: [],
        errors: [],
        hypotheses: [],
        dependencies: [],
      },
      metrics: {
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0,
        retriedActions: 0,
        averageConfidence: 0,
        totalDurationMs: 0,
        estimatedTokens: 0,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get id(): string {
    return this.state.id;
  }

  get status(): GoalStatus {
    return this.state.status;
  }

  get activeGoal(): Goal | null {
    if (!this.state.activeGoalId) return null;
    return this.state.goals[this.state.activeGoalId] ?? null;
  }

  get rootGoal(): Goal {
    return Object.values(this.state.goals).find((g) => g.parentId === null)!;
  }

  getState(): Readonly<MissionState> {
    return this.state;
  }

  getGoal(goalId: string): Goal | undefined {
    return this.state.goals[goalId];
  }

  getContext(): Readonly<MissionContext> {
    return this.state.context;
  }

  getMetrics(): Readonly<MissionMetrics> {
    return this.state.metrics;
  }

  getConfig(): Readonly<MissionConfig> {
    return this.config;
  }

  isCompleted(): boolean {
    return this.state.status === "completed" || this.state.status === "failed";
  }

  // ─── Goal Stack Management ────────────────────────────────────────────────

  /**
   * Ajoute un sous-objectif et le pousse sur la pile.
   * Retourne l'ID du nouveau goal.
   */
  addSubGoal(params: {
    parentId: string;
    title: string;
    description: string;
    successCriteria: string[];
    priority?: GoalPriority;
    dependsOn?: string[];
  }): string {
    const parent = this.state.goals[params.parentId];
    if (!parent) {
      throw new Error(`Parent goal ${params.parentId} not found`);
    }

    // Vérifier les limites
    if (parent.children.length >= this.config.maxSubGoals) {
      throw new Error(`Max sub-goals (${this.config.maxSubGoals}) reached for "${parent.title}"`);
    }

    if (this.state.goalStack.length >= this.config.maxDepth) {
      throw new Error(`Max goal depth (${this.config.maxDepth}) reached`);
    }

    const goalId = randomUUID();
    const now = new Date().toISOString();

    const goal: Goal = {
      id: goalId,
      parentId: params.parentId,
      title: params.title,
      description: params.description,
      successCriteria: params.successCriteria,
      priority: params.priority ?? parent.priority,
      status: "pending",
      children: [],
      dependsOn: params.dependsOn ?? [],
      plannedActions: [],
      attempts: 0,
      maxAttempts: this.config.maxRetries,
      createdAt: now,
    };

    this.state.goals[goalId] = goal;
    parent.children.push(goalId);
    this.state.updatedAt = now;

    return goalId;
  }

  /**
   * Active un objectif (le met au sommet de la pile).
   */
  pushGoal(goalId: string): void {
    const goal = this.state.goals[goalId];
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    goal.status = "in_progress";
    goal.startedAt = goal.startedAt ?? new Date().toISOString();

    // Retirer de la pile si déjà présent, puis repousser au sommet
    this.state.goalStack = this.state.goalStack.filter((id) => id !== goalId);
    this.state.goalStack.push(goalId);
    this.state.activeGoalId = goalId;
    this.state.status = "in_progress";
    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Complète l'objectif actif et dépile.
   */
  completeActiveGoal(result: GoalResult): void {
    const goal = this.activeGoal;
    if (!goal) throw new Error("No active goal to complete");

    goal.status = result.success ? "completed" : "failed";
    goal.result = result;
    goal.completedAt = new Date().toISOString();

    // Dépiler
    this.state.goalStack.pop();
    this.state.activeGoalId =
      this.state.goalStack.length > 0
        ? this.state.goalStack[this.state.goalStack.length - 1]
        : null;

    // Si c'était l'objectif racine → mission terminée
    if (goal.parentId === null) {
      this.state.status = result.success ? "completed" : "failed";
      this.state.completedAt = new Date().toISOString();
    }

    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Complète un objectif désigné par son ID (sans dépendre de la Goal Stack).
   * Sûr pour l'exécution parallèle de sous-objectifs indépendants.
   */
  completeGoal(goalId: string, result: GoalResult): void {
    const goal = this.state.goals[goalId];
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    goal.status = result.success ? "completed" : "failed";
    goal.result = result;
    goal.completedAt = new Date().toISOString();

    // Retirer de la pile si présent, et recalculer l'objectif actif.
    this.state.goalStack = this.state.goalStack.filter((id) => id !== goalId);
    this.state.activeGoalId =
      this.state.goalStack.length > 0
        ? this.state.goalStack[this.state.goalStack.length - 1]
        : null;

    // Objectif racine → statut global de la mission.
    if (goal.parentId === null) {
      this.state.status = result.success ? "completed" : "failed";
      this.state.completedAt = new Date().toISOString();
    }

    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Marque un objectif comme bloqué.
   */
  blockGoal(goalId: string, reason: string, blockedBy?: string): void {
    const goal = this.state.goals[goalId];
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    goal.status = "blocked";
    goal.blockReason = reason;
    goal.blockedBy = blockedBy;
    this.state.updatedAt = new Date().toISOString();
  }

  // ─── Actions & Exécution ──────────────────────────────────────────────────

  /**
   * Assigne des actions planifiées à l'objectif actif.
   */
  setPlan(actions: PlannedAction[]): void {
    const goal = this.activeGoal;
    if (!goal) throw new Error("No active goal to plan for");

    goal.plannedActions = actions;
    this.state.updatedAt = new Date().toISOString();
  }

  setPlanForGoal(goalId: string, actions: PlannedAction[]): void {
    const goal = this.state.goals[goalId];
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    goal.plannedActions = actions;
    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Marque une action comme démarrée.
   */
  startAction(actionId: string): void {
    const action = this.findAction(actionId);
    if (!action) throw new Error(`Action ${actionId} not found`);
    action.status = "in_progress";
    this.state.metrics.totalActions++;
    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Enregistre le résultat d'une action.
   */
  recordActionResult(actionId: string, result: unknown, success: boolean): void {
    const action = this.findAction(actionId);
    if (!action) throw new Error(`Action ${actionId} not found`);

    action.status = success ? "completed" : "failed";
    action.result = result;

    if (success) {
      this.state.metrics.successfulActions++;
    } else {
      this.state.metrics.failedActions++;
    }

    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Associe une réflexion à une action.
   */
  recordReflection(reflection: ReflectionResult): void {
    const action = this.findAction(reflection.actionId);
    if (action) {
      action.reflection = reflection;
    }
    this.state.reflections.push(reflection);

    // Mettre à jour la confiance moyenne
    const totalReflections = this.state.reflections.length;
    this.state.metrics.averageConfidence =
      (this.state.metrics.averageConfidence * (totalReflections - 1) + reflection.confidence) /
      totalReflections;

    this.state.updatedAt = new Date().toISOString();
  }

  // ─── Context ──────────────────────────────────────────────────────────────

  addRelevantFile(filePath: string): void {
    if (!this.state.context.relevantFiles.includes(filePath)) {
      this.state.context.relevantFiles.push(filePath);
    }
  }

  addDecision(what: string, why: string): void {
    this.state.context.decisions.push({
      what,
      why,
      when: new Date().toISOString(),
    });
  }

  addError(action: string, error: string): void {
    this.state.context.errors.push({
      action,
      error,
      when: new Date().toISOString(),
    });
  }

  addHypothesis(hypothesis: string): void {
    this.state.context.hypotheses.push(hypothesis);
  }

  // ─── Sérialisation ────────────────────────────────────────────────────────

  toJSON(): MissionState {
    return structuredClone(this.state);
  }

  static fromJSON(data: MissionState, config?: Partial<MissionConfig>): Mission {
    const mission = Object.create(Mission.prototype) as Mission;
    mission.state = structuredClone(data);
    mission.config = { ...DEFAULT_MISSION_CONFIG, ...config };
    return mission;
  }

  // ─── Résumé pour injection dans le prompt ─────────────────────────────────

  /**
   * Génère un résumé compact de l'état de la mission pour injection dans le contexte LLM.
   * Optimisé pour consommer peu de tokens.
   */
  toContextSummary(): string {
    const lines: string[] = [];
    lines.push(`🎯 MISSION: ${this.state.title}`);
    lines.push(`   Status: ${this.state.status} | Priorité: ${this.state.priority}`);

    if (this.activeGoal) {
      lines.push(`   Objectif actif: "${this.activeGoal.title}" (${this.activeGoal.status})`);
      if (this.activeGoal.plannedActions.length > 0) {
        const pending = this.activeGoal.plannedActions.filter((a) => a.status === "pending");
        const done = this.activeGoal.plannedActions.filter((a) => a.status === "completed");
        lines.push(`   Plan: ${done.length}/${this.activeGoal.plannedActions.length} actions terminées, ${pending.length} restantes`);
      }
    }

    const stack = this.state.goalStack
      .map((id) => this.state.goals[id]?.title ?? id)
      .reverse();
    if (stack.length > 1) {
      lines.push(`   Goal Stack: ${stack.join(" → ")}`);
    }

    if (this.state.context.errors.length > 0) {
      const lastErr = this.state.context.errors[this.state.context.errors.length - 1];
      lines.push(`   ⚠️ Dernière erreur: ${lastErr.action} → ${lastErr.error}`);
    }

    lines.push(`   Confiance: ${(this.state.metrics.averageConfidence * 100).toFixed(0)}% | Actions: ${this.state.metrics.successfulActions}✓ ${this.state.metrics.failedActions}✗`);

    return lines.join("\n");
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private findAction(actionId: string): PlannedAction | undefined {
    for (const goal of Object.values(this.state.goals)) {
      const action = goal.plannedActions.find((a) => a.id === actionId);
      if (action) return action;
    }
    return undefined;
  }
}
