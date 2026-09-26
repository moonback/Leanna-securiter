import { Mission } from "./Mission.js";
import { Planner } from "./Planner.js";
import { ReflectionEngine, type ReflectionInput } from "./Reflection.js";
import { SkillScorer } from "./SkillScorer.js";
import { MissionStore } from "./MissionStore.js";
import { AutonomyPolicy } from "./AutonomyPolicy.js";
import type {  PlannedAction,  ReflectionResult,
  MissionConfig,
  MissionPlan,
  Goal,
} from "./types.js";
import { DEFAULT_MISSION_CONFIG } from "./types.js";
import { telemetryService } from "../observability/TelemetryService.js";
import { setTelemetryContext, clearTelemetryContext } from "../utils/textGeneration.js";
import { learningEngine } from "../knowledge/LearningEngine.js";
import type { LearningResult } from "../knowledge/types.js";
import { strategyMemory } from "../knowledge/StrategyMemory.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Executor — Boucle plan → agir → vérifier → corriger
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * L'Executor coordonne l'exécution d'une mission complète.
 *
 * Boucle principale:
 *   1. Planner décompose l'objectif en sous-objectifs
 *   2. Pour chaque sous-objectif:
 *      a. Planner planifie les actions (skills scorés)
 *      b. Executor exécute chaque action via le SkillHandler
 *      c. Reflection évalue le résultat
 *      d. Si échec → retry / replan / escalate
 *   3. Quand tous les sous-objectifs sont complétés → mission terminée
 *
 * L'Executor est le composant central qui fait le lien entre
 * le Planner, le SkillScorer, le Reflection Engine et le SkillManager.
 */
export class Executor {
  private planner: Planner;
  private reflection: ReflectionEngine;
  private scorer: SkillScorer;
  private skillHandler: SkillHandlerFn | null = null;
  private config: MissionConfig;
  private eventEmitter: ExecutorEventEmitter | null = null;

  /** Fonction LLM pour générer les arguments d'un skill au moment de l'exécution. */
  private llmArgGen: LLMTextFn | null = null;

  /** Fonction LLM pour valider les critères de succès d'un objectif. */
  private llmVerify: LLMTextFn | null = null;

  /** Schémas des outils (name → { description, parameters }) pour la génération d'arguments. */
  private toolSchemas: Map<string, ToolSchema> = new Map();

  /** Store de persistance (optionnel). */
  private store: MissionStore | null = null;

  /** Curseur d'autonomie (optionnel). */
  private autonomy: AutonomyPolicy | null = null;

  /** Approbations en attente : actionId → resolver de décision. */
  private pendingApprovals: Map<string, {
    resolve: (approved: boolean) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  /** Délai d'attente d'une approbation avant refus par défaut (ms). */
  private approvalTimeoutMs = 5 * 60 * 1000;

  /** Missions actives */
  private activeMissions: Map<string, Mission> = new Map();

  /** Missions complétées (historique, max 50) */
  private completedMissions: Mission[] = [];
  private static readonly MAX_COMPLETED = 50;

  /** Promesses des missions lancées en arrière-plan, pour les appelants autonomes. */
  private readonly missionRuns = new Map<string, Promise<void>>();
  /** Candidate lessons/proposals; never auto-applied by mission finalization. */
  private readonly learningResults = new Map<string, LearningResult>();

  /**
   * Missions mises en pause par l'utilisateur.
   * L'exécution boucle sur un point de contrôle tant que l'ID est présent ici.
   */
  private pausedMissions: Set<string> = new Set();

  /** Intervalle de sondage de l'état de pause (ms). */
  private static readonly PAUSE_POLL_MS = 500;

  constructor(config: Partial<MissionConfig> = {}) {
    this.config = { ...DEFAULT_MISSION_CONFIG, ...config };
    this.scorer = new SkillScorer();
    this.planner = new Planner(this.scorer);
    this.reflection = new ReflectionEngine();
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  /**
   * Injecte le handler de skills (connect au SkillManager).
   */
  setSkillHandler(handler: SkillHandlerFn): void {
    this.skillHandler = handler;
  }

  /**
   * Injecte la fonction LLM pour la décomposition.
   */
  setLLMDecompose(fn: (prompt: string) => Promise<string>): void {
    this.planner.setDecomposeFunction(fn);
  }

  /**
   * Injecte la fonction LLM pour la réflexion.
   */
  setLLMReflect(fn: (prompt: string) => Promise<string>): void {
    this.reflection.setReflectFunction(fn);
  }

  /**
   * Injecte la fonction LLM utilisée pour générer les arguments d'un skill
   * au moment de l'exécution (quand le Planner n'a pas rempli action.args).
   */
  setLLMArgGen(fn: LLMTextFn): void {
    this.llmArgGen = fn;
  }

  /**
   * Injecte la fonction LLM utilisée pour valider les critères de succès
   * d'un objectif à partir des actions exécutées et de leurs résultats.
   */
  setLLMVerify(fn: LLMTextFn): void {
    this.llmVerify = fn;
  }

  /**
   * Enregistre les schémas des outils disponibles (name/description/parameters).
   * Utilisé pour générer des arguments valides via le LLM.
   */
  setToolSchemas(schemas: ToolSchema[]): void {
    this.toolSchemas.clear();
    for (const schema of schemas) {
      if (schema && schema.name) this.toolSchemas.set(schema.name, schema);
    }
  }

  /**
   * Injecte le store de persistance des missions (Supabase).
   */
  setStore(store: MissionStore): void {
    this.store = store;
  }

  /**
   * Injecte le curseur d'autonomie (suggest/ask/auto + .leannaignore).
   */
  setAutonomyPolicy(policy: AutonomyPolicy): void {
    this.autonomy = policy;
  }

  /** Configure le délai d'attente d'une approbation (ms). */
  setApprovalTimeout(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.approvalTimeoutMs = ms;
  }

  /**
   * Résout une demande d'approbation en attente (appelé depuis le frontend).
   * Retourne true si une demande correspondante existait.
   */
  resolveApproval(actionId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(actionId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(actionId);
    pending.resolve(approved);
    return true;
  }

  /** Liste les IDs d'actions en attente d'approbation. */
  listPendingApprovals(): string[] {
    return Array.from(this.pendingApprovals.keys());
  }

  /** Accès au curseur d'autonomie (pour lire/modifier le mode à chaud). */
  getAutonomyPolicy(): AutonomyPolicy | null {
    return this.autonomy;
  }

  /**
   * Configure l'émetteur d'événements pour le frontend.
   */
  setEventEmitter(emitter: ExecutorEventEmitter): void {
    this.eventEmitter = emitter;
  }

  /**
   * Accès au scorer (pour enregistrer les catégories de skills au démarrage).
   */
  getScorer(): SkillScorer {
    return this.scorer;
  }

  /**
   * Accès au reflection engine.
   */
  getReflection(): ReflectionEngine {
    return this.reflection;
  }

  // ─── Exécution de mission ─────────────────────────────────────────────────

  /**
   * Lance une mission complète.
   * Retourne la mission (l'exécution continue en arrière-plan).
   */
  async startMission(params: {
    title: string;
    description: string;
    priority?: "low" | "medium" | "high" | "critical";
    availableSkills: string[];
    budget?: { maxTokens?: number; maxCostUsd?: number };
    /** Exécuter la mission entière en simulation, sans effet de bord. */
    dryRun?: boolean;
  }): Promise<Mission> {
    if (!this.skillHandler) {
      throw new Error("SkillHandler not configured. Call setSkillHandler first.");
    }

    // Config spécifique à la mission : le dry-run peut être activé par mission.
    const missionConfig: MissionConfig = {
      ...this.config,
      dryRun: params.dryRun ?? this.config.dryRun,
    };

    const mission = new Mission(
      params.title,
      params.description,
      params.priority ?? "medium",
      missionConfig
    );

    if (missionConfig.dryRun) {
      console.log(`[Executor] 🧪 Mission "${params.title}" lancée en DRY-RUN (simulation, sans effet de bord).`);
      this.emit("mission_dryrun", { missionId: mission.id, title: params.title });
    }

    // Start OpenTelemetry trace for this mission
    telemetryService.startMissionTrace(mission.id, params.title);

    // Set up budget guardrails if provided
    if (params.budget) {
      telemetryService.setMissionBudget(mission.id, params.budget);
    }

    // Set telemetry context for all model calls in this mission
    setTelemetryContext({ missionId: mission.id });

    // Ferme la boucle d'apprentissage inter-missions (GAP-1) : amorcer le
    // SkillScorer avec la fiabilité durable des skills AVANT la planification,
    // pour qu'un outil historiquement défaillant soit d'emblée moins prioritaire.
    try {
      this.scorer.seedFromReliability(strategyMemory.getAllStats());
    } catch (err) {
      console.warn(`[Executor] Amorçage de fiabilité ignoré: ${(err as Error).message}`);
    }

    const plan = await this.preparePlan(mission, params.availableSkills);

    this.activeMissions.set(mission.id, mission);
    await this.persist(mission);
    this.emit("mission_plan", {
      missionId: mission.id,
      title: params.title,
      plan,
    });
    this.emit("mission_started", { missionId: mission.id, title: params.title });

    // Lancer l'exécution en arrière-plan, tout en conservant une promesse
    // observable. Le runtime autonome doit attendre le résultat vérifié plutôt
    // que déclarer une mission réussie juste après sa création.
    const run = this.executeMission(mission, params.availableSkills).catch((err) => {
      console.error(`[Executor] Mission ${mission.id} failed:`, err);
      telemetryService.endMissionTrace(mission.id, false);
      this.emit("mission_failed", { missionId: mission.id, error: String(err) });
    });
    this.missionRuns.set(mission.id, run);
    void run.finally(() => this.missionRuns.delete(mission.id));

    return mission;
  }

  /**
   * Attend la fin réelle d'une mission déjà lancée et retourne son état
   * terminal. C'est le contrat utilisé par l'autonomie pour fermer la boucle
   * exécution → vérification → réflexion avant de prendre la décision suivante.
   */
  async waitForMission(missionId: string): Promise<Mission | undefined> {
    await this.missionRuns.get(missionId);
    return this.activeMissions.get(missionId)
      ?? this.completedMissions.find((mission) => mission.id === missionId);
  }

  private async preparePlan(mission: Mission, availableSkills: string[]): Promise<MissionPlan> {
    const rootGoal = mission.rootGoal;
    const subGoals = await this.planner.decompose(mission, rootGoal.id, availableSkills);
    const objectives = subGoals.length > 0 ? subGoals.map((goal) => goal.title) : [rootGoal.title];
    const goals = subGoals.length > 0
      ? this.createSubGoals(mission, rootGoal.id, subGoals)
      : [rootGoal.id];
    const plannedActions: PlannedAction[] = [];

    for (const goalId of goals) {
      const actions = await this.planner.planActions(mission, goalId, availableSkills);
      mission.setPlanForGoal(goalId, actions);
      plannedActions.push(...actions);
    }

    const text = `${mission.getState().title} ${mission.getState().description}`;
    const targetedFiles = Array.from(new Set(
      text.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|json|css|md|html|sql|cjs|mjs)/gi) ?? []
    ));
    const tools = Array.from(new Set(plannedActions.map((action) => action.skillName)));
    const risks = [
      "Une action peut échouer et déclencher une replanification.",
      ...(targetedFiles.length === 0 ? ["Les fichiers ciblés seront confirmés pendant l'analyse."] : []),
      ...(plannedActions.length === 0 ? ["Aucun outil n'a encore atteint le score minimum."] : []),
    ];

    return {
      objectives,
      targetedFiles: targetedFiles.length > 0 ? targetedFiles : ["À déterminer pendant l'analyse"],
      tools: tools.length > 0 ? tools : ["Sélection automatique selon le contexte"],
      risks,
      estimatedTokens: 1200 + plannedActions.length * 800,
      stopConditions: [
        "Arrêt immédiat si un objectif critique échoue.",
        `Arrêt après ${this.config.maxRetries} échecs d'une même action.`,
        "Arrêt sur annulation explicite de l'utilisateur.",
      ],
    };
  }

  /**
   * Récupère une mission active.
   */
  getMission(missionId: string): Mission | undefined {
    return this.activeMissions.get(missionId);
  }

  /**
   * Liste les missions actives.
   */
  listActiveMissions(): Mission[] {
    return Array.from(this.activeMissions.values());
  }

  /**
   * Liste les missions complétées (historique).
   */
  listCompletedMissions(): Mission[] {
    return [...this.completedMissions];
  }

  /** Returns post-mission learning proposals for review by the policy/UI. */
  getLearningResult(missionId: string): LearningResult | undefined {
    return this.learningResults.get(missionId);
  }

  /**
   * Annule une mission active.
   */
  cancelMission(missionId: string): boolean {
    const mission = this.activeMissions.get(missionId);
    if (!mission) return false;

    mission.completeActiveGoal({
      success: false,
      summary: "Mission annulée par l'utilisateur.",
    });

    this.finalizeMission(mission);
    
    // End trace and clear telemetry
    telemetryService.endMissionTrace(missionId, false);
    telemetryService.clearMissionBudget(missionId);
    clearTelemetryContext();
    
    this.pausedMissions.delete(missionId);
    this.emit("mission_cancelled", { missionId });
    return true;
  }

  /**
   * Met en pause une mission active. L'exécution s'arrête au prochain point de
   * contrôle (entre deux actions/vagues) et reste suspendue jusqu'à reprise ou
   * annulation. Retourne false si la mission n'est pas active ou déjà en pause.
   */
  pauseMission(missionId: string): boolean {
    if (!this.activeMissions.has(missionId)) return false;
    if (this.pausedMissions.has(missionId)) return false;
    this.pausedMissions.add(missionId);
    this.emit("mission_paused", { missionId });
    return true;
  }

  /**
   * Reprend une mission mise en pause. Retourne false si elle n'était pas en pause.
   */
  resumeMission(missionId: string): boolean {
    if (!this.pausedMissions.has(missionId)) return false;
    this.pausedMissions.delete(missionId);
    this.emit("mission_resumed", { missionId });
    return true;
  }

  /** Indique si une mission est actuellement en pause. */
  isPaused(missionId: string): boolean {
    return this.pausedMissions.has(missionId);
  }

  /**
   * Supprime définitivement une mission.
   * - Si elle est active, elle est d'abord annulée.
   * - Elle est retirée de l'historique en mémoire et du store persistant.
   * Retourne false si aucune mission (active ou complétée) ne correspond.
   */
  deleteMission(missionId: string): boolean {
    const wasActive = this.activeMissions.has(missionId);
    if (wasActive) {
      // Annule proprement (finalise + émet mission_cancelled).
      this.cancelMission(missionId);
    }

    const beforeLen = this.completedMissions.length;
    this.completedMissions = this.completedMissions.filter((m) => m.id !== missionId);
    const removedFromHistory = this.completedMissions.length < beforeLen;

    this.pausedMissions.delete(missionId);

    // Nettoyage du store persistant (no-op si aucun store branché).
    if (this.store) {
      void this.store.delete(missionId);
    }

    const existed = wasActive || removedFromHistory;
    if (existed) {
      this.emit("mission_deleted", { missionId });
    }
    return existed;
  }

  /**
   * Point de contrôle de pause : suspend l'exécution tant que la mission est en
   * pause. Se débloque à la reprise, à l'annulation, ou si la mission n'est plus
   * active. Ne fait rien si la mission n'est pas en pause.
   */
  private async waitIfPaused(missionId: string): Promise<void> {
    while (
      this.pausedMissions.has(missionId) &&
      this.activeMissions.has(missionId)
    ) {
      await new Promise((r) => setTimeout(r, Executor.PAUSE_POLL_MS));
    }
  }

  // ─── Boucle d'exécution ───────────────────────────────────────────────────

  private async executeMission(mission: Mission, availableSkills: string[]): Promise<void> {
    const rootGoal = mission.rootGoal;
    mission.pushGoal(rootGoal.id);

    console.log(`[Executor] ═══════════════════════════════════════════`);
    console.log(`[Executor] 🚀 Mission démarrée: "${mission.getState().title}"`);
    console.log(`[Executor] ═══════════════════════════════════════════`);

    // Les sous-objectifs ont déjà été créés lors de preparePlan.
    // On les récupère depuis l'état (sans les recréer).
    const subGoalIds = Object.values(mission.getState().goals)
      .filter((goal) => goal.parentId === rootGoal.id)
      .map((goal) => goal.id);

    if (subGoalIds.length === 0) {
      // Pas de décomposition → exécuter directement
      await this.executeGoalDirectly(mission, rootGoal.id, availableSkills);
    } else {
      // Ordonnancement par vagues : exécuter en parallèle les objectifs dont
      // toutes les dépendances (dependsOn) sont déjà complétées.
      await this.executeGoalsScheduled(mission, subGoalIds, availableSkills);
    }

    // Compléter la mission si pas déjà fait
    if (!mission.isCompleted()) {
      const allGoals = Object.values(mission.getState().goals);
      const allSuccess = allGoals
        .filter((g) => g.parentId !== null)
        .every((g) => g.status === "completed");

      mission.completeActiveGoal({
        success: allSuccess,
        summary: allSuccess
          ? `Mission "${mission.getState().title}" complétée avec succès.`
          : `Mission terminée avec des objectifs échoués.`,
        lessonsLearned: this.extractLessons(mission),
      });
    }

    this.finalizeMission(mission);
    
    // End trace with success status
    const success = mission.status === "completed";
    telemetryService.endMissionTrace(mission.id, success);
    telemetryService.clearMissionBudget(mission.id);
    clearTelemetryContext();
    
    console.log(`[Executor] ✓ Mission terminée: ${mission.status}`);
    this.emit("mission_completed", {
      missionId: mission.id,
      success,
    });
  }

  /**
   * Exécute un objectif directement (planifie et exécute les actions).
   */
  private async executeGoalDirectly(
    mission: Mission,
    goalId: string,
    availableSkills: string[]
  ): Promise<void> {
    const goal = mission.getGoal(goalId);
    if (!goal) return;

    console.log(`[Executor] ── Objectif: "${goal.title}" ──`);

    // Planifier les actions
    let actions = goal.plannedActions.length > 0
      ? goal.plannedActions
      : await this.planner.planActions(mission, goalId, availableSkills);
    mission.setPlanForGoal(goalId, actions);

    if (actions.length === 0) {
      console.log(`[Executor]    Aucune action planifiée. Objectif marqué complété.`);
      mission.completeGoal(goalId, { success: true, summary: "Aucune action nécessaire." });
      return;
    }

    // Exécuter les actions une par une.
    // On lit systématiquement le plan VIVANT (mission.getGoal(...).plannedActions)
    // plutôt qu'une copie locale : une replanification remplace ce plan par de
    // nouvelles actions (nouveaux ids), et itérer sur l'ancienne référence
    // ferait planter startAction ("Action not found"). On avance donc via un
    // curseur sur le plan courant, réinitialisé après chaque replanification.
    let cursor = 0;
    // Garde-fou anti-boucle : borne le nombre total d'itérations pour éviter
    // qu'une replanification en boucle ne bloque indéfiniment l'objectif.
    let iterations = 0;
    const maxIterations = 100;

    while (iterations++ < maxIterations) {
      if (mission.isCompleted()) break;

      const livePlan = mission.getGoal(goalId)?.plannedActions ?? [];
      // Trouver la prochaine action à exécuter à partir du curseur.
      let action: PlannedAction | undefined;
      while (cursor < livePlan.length) {
        const candidate = livePlan[cursor];
        if (candidate.status === "pending") { action = candidate; break; }
        cursor++;
      }
      if (!action) break; // plus rien à exécuter

      // Point de contrôle : suspend si la mission est en pause.
      await this.waitIfPaused(mission.id);
      if (mission.isCompleted() || !this.activeMissions.has(mission.id)) break;

      const result = await this.executeAction(mission, goalId, action, availableSkills);

      // Une action RÉUSSIE est terminale : la réflexion ne peut pas la "défaire".
      // On ignore donc retry/replan/escalate/abort quand l'action a réussi
      // (le statut completed a déjà été posé par recordActionResult, qui mute
      // l'objet action de façon invisible pour l'inférence de types).
      const actionSucceeded = (mission.getGoal(goalId)?.plannedActions
        .find((a) => a.id === action.id)?.status) === "completed";

      // Décider de la suite selon la réflexion (uniquement en cas d'échec).
      if (!actionSucceeded && result.decision === "abort") {
        mission.completeGoal(goalId, {
          success: false,
          summary: `Abandonné: ${result.reasoning}`,
        });
        return;
      }

      if (!actionSucceeded && result.decision === "escalate") {
        // Marquer l'objectif comme bloqué et laisser le niveau supérieur gérer
        mission.blockGoal(goalId, result.reasoning);
        this.emit("goal_escalated", {
          missionId: mission.id,
          goalId,
          reason: result.reasoning,
        });
        return;
      }

      if (!actionSucceeded && result.decision === "replan") {
        // Replanifier avec les infos accumulées.
        console.log(`[Executor]    🔄 Replanification...`);
        const replanned = await this.planner.replan(
          mission,
          goalId,
          action,
          result.failure ?? "Erreur inconnue",
          availableSkills
        );
        // Remplace le plan vivant par les nouvelles actions et repart du début :
        // le curseur doit pointer sur le nouveau plan, pas sur l'ancien index.
        mission.setPlanForGoal(goalId, replanned);
        cursor = 0;
        continue;
      }

      // Aucune replanification : avancer le curseur au-delà de l'action courante.
      // (Une action retentée reste "pending" et sera re-sélectionnée ; une action
      // terminée est de toute façon ignorée par le filtre de statut ci-dessus.)
      if (result.decision !== "retry") {
        cursor++;
      }
    }

    // Ne valider l'objectif qu'une fois toutes les actions traitées.
    const allDone = goal.plannedActions.every(
      (a) => a.status === "completed" || a.status === "cancelled" || a.status === "failed"
    );
    if (!allDone) return;

    // Valider l'objectif au regard de ses critères de succès (et non plus
    // dès qu'une seule action a réussi).
    const verdict = await this.verifyGoalCriteria(mission, goal);

    this.emit("goal_verified", {
      missionId: mission.id,
      goalId,
      passed: verdict.passed,
      reasoning: verdict.reasoning,
    });

    console.log(
      `[Executor]    ${verdict.passed ? "✓" : "✗"} Critères de "${goal.title}": ${verdict.reasoning}`
    );

    mission.completeGoal(goalId, {
      success: verdict.passed,
      summary: `Objectif "${goal.title}" ${verdict.passed ? "atteint" : "non atteint"} — ${verdict.reasoning}`,
    });
  }

  /**
   * Ordonnance les sous-objectifs par vagues selon leurs dépendances.
   * Chaque vague exécute EN PARALLÈLE tous les objectifs dont les dépendances
   * (dependsOn) sont déjà complétées. S'arrête si un objectif critique échoue.
   */
  private async executeGoalsScheduled(
    mission: Mission,
    goalIds: string[],
    availableSkills: string[]
  ): Promise<void> {
    const maxConcurrency = Math.max(1, this.config.maxConcurrentGoals ?? 3);
    // Ne garder que les objectifs non terminaux (utile pour les missions reprises).
    const remaining = new Set(
      goalIds.filter((id) => {
        const g = mission.getGoal(id);
        return g && g.status !== "completed" && g.status !== "cancelled";
      })
    );
    let criticalFailure = false;

    const isDone = (id: string): boolean => {
      const g = mission.getGoal(id);
      return !!g && (g.status === "completed" || g.status === "failed" || g.status === "cancelled");
    };
    const isCompleted = (id: string): boolean =>
      mission.getGoal(id)?.status === "completed";

    while (remaining.size > 0 && !mission.isCompleted() && !criticalFailure) {
      // Point de contrôle : suspend au début de chaque vague si en pause.
      await this.waitIfPaused(mission.id);
      if (mission.isCompleted() || !this.activeMissions.has(mission.id)) break;

      // Sélectionner les objectifs exécutables : dépendances toutes complétées.
      const runnable: string[] = [];
      for (const id of remaining) {
        const goal = mission.getGoal(id);
        if (!goal) { remaining.delete(id); continue; }
        if (goal.status === "cancelled") { remaining.delete(id); continue; }

        const deps = (goal.dependsOn ?? []).filter((d) => goalIds.includes(d));
        const depsSatisfied = deps.every((d) => isCompleted(d));
        // Si une dépendance a échoué, l'objectif ne pourra jamais démarrer.
        const depFailed = deps.some((d) => {
          const dg = mission.getGoal(d);
          return dg && (dg.status === "failed" || dg.status === "cancelled");
        });

        if (depFailed) {
          mission.blockGoal(id, "Dépendance échouée ou annulée.");
          remaining.delete(id);
          this.emit("goal_blocked", { missionId: mission.id, goalId: id, reason: "Dépendance échouée." });
          continue;
        }
        if (depsSatisfied) runnable.push(id);
      }

      if (runnable.length === 0) {
        // Aucun objectif exécutable alors qu'il en reste : cycle ou blocage.
        console.warn(`[Executor] ⚠️ Aucun objectif exécutable (dépendances circulaires ?). Objectifs restants marqués bloqués.`);
        for (const id of remaining) {
          mission.blockGoal(id, "Dépendances non satisfaites (cycle ou blocage).");
        }
        break;
      }

      // Limiter la concurrence de la vague.
      const wave = runnable.slice(0, maxConcurrency);
      console.log(`[Executor] ▶ Vague de ${wave.length} objectif(s) en parallèle.`);

      await Promise.all(
        wave.map(async (goalId) => {
          const goal = mission.getGoal(goalId);
          if (!goal) return;
          mission.pushGoal(goalId);
          this.emit("goal_started", { missionId: mission.id, goalId, title: goal.title });
          await this.executeGoalDirectly(mission, goalId, availableSkills);
          remaining.delete(goalId);

          if (goal.status === "failed" && goal.priority === "critical") {
            console.log(`[Executor] ❌ Objectif critique échoué: "${goal.title}". Arrêt de la mission.`);
            criticalFailure = true;
          }
        })
      );

      // Sécurité : retirer de `remaining` tout ce qui est terminé.
      for (const id of [...remaining]) {
        if (isDone(id)) remaining.delete(id);
      }

      // Persister l'avancement après chaque vague (si un store est branché).
      await this.persist(mission);
    }

    if (criticalFailure && !mission.isCompleted()) {
      mission.completeGoal(mission.rootGoal.id, {
        success: false,
        summary: "Arrêt : un objectif critique a échoué.",
      });
    }
  }

  /**
   * Exécute une action unique et effectue la réflexion.
   */
  private async executeAction(
    mission: Mission,
    goalId: string,
    action: PlannedAction,
    _availableSkills: string[]
  ): Promise<ReflectionResult> {
    const goal = mission.getGoal(goalId)!;
    const startTime = Date.now();

    mission.startAction(action.id);
    this.emit("action_started", {
      missionId: mission.id,
      goalId,
      actionId: action.id,
      skill: action.skillName,
    });

    console.log(`[Executor]    ▶ ${action.skillName} (score: ${action.score})`);

    // Check budget before executing action
    const budgetStatus = telemetryService.checkBudget(mission.id);
    if (budgetStatus.exceeded) {
      console.warn(`[Executor] ⚠️ Budget exceeded for mission ${mission.id}: ${budgetStatus.reason}`);
      mission.recordActionResult(action.id, { error: budgetStatus.reason }, false);
      
      return {
        actionId: action.id,
        timestamp: new Date().toISOString(),
        observation: `Budget exceeded: ${budgetStatus.reason}`,
        success: null,
        failure: budgetStatus.reason || "Budget limit reached",
        hypothesis: null,
        confidence: 0,
        decision: "abort",
        reasoning: "Mission budget exceeded, stopping execution to prevent cost overrun.",
      };
    }

    let success = false;
    let result: unknown = undefined;
    let error: string | undefined = undefined;

    // Générer les arguments du skill au moment de l'exécution si le Planner
    // ne les a pas remplis (ils sont vides par défaut). On utilise le LLM avec
    // le schéma de l'outil, le contexte de l'objectif et les résultats déjà obtenus.
    if (this.needsArgs(action)) {
      try {
        action.args = await this.generateArgs(mission, goal, action);
      } catch (err) {
        console.warn(
          `[Executor]    ⚠️ Génération d'arguments échouée pour ${action.skillName}: ${(err as Error).message}`
        );
      }
    }

    // Curseur d'autonomie : décider si l'action peut s'exécuter, doit être
    // approuvée, ou est refusée (mode suggest/ask/auto + .leannaignore).
    if (this.autonomy) {
      const verdict = this.autonomy.decide(action.skillName, action.args);
      let allowed = verdict.decision === "allow";

      if (verdict.decision === "deny") {
        console.log(`[Executor]    ⛔ ${action.skillName} refusé: ${verdict.reason}`);
        mission.recordActionResult(action.id, { error: verdict.reason }, false);
        this.emit("action_denied", {
          missionId: mission.id,
          goalId,
          actionId: action.id,
          skill: action.skillName,
          reason: verdict.reason,
        });
        return this.createDefaultReflection(action.id, false);
      }

      if (verdict.decision === "ask") {
        console.log(`[Executor]    ⏸️ ${action.skillName} en attente d'approbation: ${verdict.reason}`);
        allowed = await this.requestApproval(mission, goalId, action, verdict.reason);
        if (!allowed) {
          const reason = "Action refusée ou non approuvée dans le délai imparti.";
          mission.recordActionResult(action.id, { error: reason }, false);
          this.emit("action_denied", {
            missionId: mission.id,
            goalId,
            actionId: action.id,
            skill: action.skillName,
            reason,
          });
          return this.createDefaultReflection(action.id, false);
        }
      }
    }

    try {
      const dryRun = mission.getConfig().dryRun;
      result = await this.skillHandler!(action.skillName, action.args, { dryRun });
      success = !!(
        result === null ||
        result === undefined ||
        (typeof result !== "object") ||
        (typeof result === "object" && !("error" in result))
      );
      if (!success) {
        error = (result as any)?.error ?? "Erreur retournée par le skill";
        console.log(`[Executor]    ✗ ${action.skillName} échoué (result.error): ${error}`);
      } else {
        console.log(`[Executor]    ✓ ${action.skillName} réussi`);
      }
    } catch (err: any) {
      error = err.message ?? String(err);
      console.log(`[Executor]    ✗ ${action.skillName} échoué: ${error}`);
    }

    const durationMs = Date.now() - startTime;

    // Enregistrer le résultat
    mission.recordActionResult(action.id, result, success);
    this.scorer.recordUsage(action.skillName, success, durationMs);
    // Persistance durable de la fiabilité du skill (GAP-1) : alimente la mémoire
    // de stratégie lue par les missions futures. Best-effort, jamais bloquant.
    try {
      strategyMemory.recordSkillOutcome(action.skillName, success, durationMs);
    } catch { /* la fiabilité durable est best-effort */ }

    // Réflexion
    const reflectionInput: ReflectionInput = {
      actionId: action.id,
      actionName: action.skillName,
      skillName: action.skillName,
      goalTitle: goal.title,
      success,
      result,
      error,
      attemptCount: goal.attempts + 1,
      maxAttempts: goal.maxAttempts,
      previousConfidence: mission.getMetrics().averageConfidence,
      previousErrors: mission.getContext().errors.map((e) => e.error),
    };

    const reflection = this.config.enableReflection
      ? await this.reflection.reflect(reflectionInput)
      : this.createDefaultReflection(action.id, success);

    mission.recordReflection(reflection);

    this.emit("action_completed", {
      missionId: mission.id,
      goalId,
      actionId: action.id,
      skill: action.skillName,
      success,
      confidence: reflection.confidence,
      decision: reflection.decision,
      durationMs,
    });

    return reflection;
  }

  // ─── Génération d'arguments ────────────────────────────────────────────────

  /** Une action a besoin d'arguments si le Planner ne les a pas remplis. */
  private needsArgs(action: PlannedAction): boolean {
    if (!this.llmArgGen) return false;
    const schema = this.toolSchemas.get(action.skillName);
    // Outil sans paramètres : rien à générer.
    if (schema && !this.schemaHasProperties(schema)) return false;
    return !action.args || Object.keys(action.args).length === 0;
  }

  private schemaHasProperties(schema: ToolSchema): boolean {
    const params = schema.parameters as any;
    if (!params || typeof params !== "object") return false;
    const props = params.properties;
    return !!props && typeof props === "object" && Object.keys(props).length > 0;
  }

  /**
   * Génère les arguments d'un skill via le LLM, en s'appuyant sur:
   *   - le schéma de paramètres de l'outil
   *   - le but courant (titre, description, critères)
   *   - les fichiers pertinents et les résultats des actions déjà exécutées
   */
  private async generateArgs(
    mission: Mission,
    goal: Goal,
    action: PlannedAction
  ): Promise<Record<string, unknown>> {
    if (!this.llmArgGen) return action.args ?? {};

    const schema = this.toolSchemas.get(action.skillName);
    const context = mission.getContext();

    const previousResults = goal.plannedActions
      .filter((a) => a.status === "completed" && a.id !== action.id)
      .slice(-3)
      .map((a) => ({
        skill: a.skillName,
        result: this.summarizeResult(a.result),
      }));

    const prompt = `Tu génères les ARGUMENTS d'un outil pour accomplir une étape précise.

OUTIL: ${action.skillName}
DESCRIPTION: ${schema?.description ?? "(non documentée)"}
SCHÉMA DES PARAMÈTRES (JSON Schema):
${JSON.stringify(schema?.parameters ?? {}, null, 2)}

OBJECTIF COURANT: ${goal.title}
DÉTAIL: ${goal.description}
CRITÈRES DE SUCCÈS:
${goal.successCriteria.map((c) => `  - ${c}`).join("\n")}
JUSTIFICATION DE CET OUTIL: ${action.rationale}

CONTEXTE:
- Fichiers pertinents: ${context.relevantFiles.slice(0, 10).join(", ") || "aucun"}
- Mission: ${mission.getState().title} — ${mission.getState().description}
- Résultats précédents: ${previousResults.length > 0 ? JSON.stringify(previousResults) : "aucun"}

INSTRUCTIONS:
- Retourne UNIQUEMENT un objet JSON correspondant au schéma des paramètres.
- N'invente pas de champs absents du schéma.
- Si un paramètre est optionnel et inutile, ne l'inclus pas.
- Réponds STRICTEMENT en JSON, sans texte autour.

JSON:`;

    const raw = await this.withTimeout(this.llmArgGen(prompt), 20_000, "arg-gen");
    const args = this.parseJsonObject(raw);
    console.log(
      `[Executor]    🧩 Arguments générés pour ${action.skillName}: ${JSON.stringify(args).slice(0, 200)}`
    );
    return args;
  }

  // ─── Validation par critères de succès ──────────────────────────────────────

  /**
   * Valide qu'un objectif est réellement atteint au regard de ses
   * successCriteria, à partir des actions exécutées et de leurs résultats.
   * Utilise le LLM si disponible, sinon une heuristique conservatrice.
   */
  private async verifyGoalCriteria(_mission: Mission, goal: Goal): Promise<{
    passed: boolean;
    reasoning: string;
  }> {
    const executed = goal.plannedActions.filter(
      (a) => a.status === "completed" || a.status === "failed"
    );
    const anySuccess = executed.some((a) => a.status === "completed");
    const allSuccess =
      executed.length > 0 && executed.every((a) => a.status === "completed");

    // Sans critères explicites, on retombe sur le succès des actions.
    if (!goal.successCriteria || goal.successCriteria.length === 0) {
      return {
        passed: anySuccess,
        reasoning: anySuccess
          ? "Aucun critère explicite ; au moins une action a réussi."
          : "Aucun critère explicite et aucune action réussie.",
      };
    }

    // Sans LLM : validation conservatrice — toutes les actions doivent réussir.
    if (!this.llmVerify) {
      return {
        passed: allSuccess,
        reasoning: allSuccess
          ? "Toutes les actions planifiées ont réussi (validation heuristique)."
          : "Certaines actions ont échoué ; critères non confirmés (validation heuristique).",
      };
    }

    const actionsSummary = executed.map((a) => ({
      skill: a.skillName,
      status: a.status,
      result: this.summarizeResult(a.result),
    }));

    const prompt = `Tu es un vérificateur qualité. Évalue si l'objectif est atteint au vu des preuves.

OBJECTIF: ${goal.title}
DÉTAIL: ${goal.description}
CRITÈRES DE SUCCÈS:
${goal.successCriteria.map((c) => `  - ${c}`).join("\n")}

ACTIONS EXÉCUTÉES ET RÉSULTATS:
${JSON.stringify(actionsSummary, null, 2)}

INSTRUCTIONS:
- Juge uniquement à partir des preuves ci-dessus.
- "passed": true si les critères semblent satisfaits.
- "blocking": true UNIQUEMENT si tu as une preuve claire d'un échec réel
  (une action a renvoyé une erreur, un résultat contredit un critère). En cas
  de simple doute ou d'information manquante, "blocking" doit être false.
- Réponds STRICTEMENT en JSON: {"passed": true|false, "blocking": true|false, "reasoning": "..."}

JSON:`;

    try {
      const raw = await this.withTimeout(this.llmVerify(prompt), 20_000, "verify");
      const parsed = this.parseJsonObject(raw);
      const passed = parsed.passed === true;
      const blocking = parsed.blocking === true;
      const reasoning =
        typeof parsed.reasoning === "string" ? parsed.reasoning : "Vérification LLM effectuée.";

      // Tolérance : si toutes les actions ont réussi, un verdict négatif du LLM
      // ne fait échouer l'objectif QUE s'il signale un problème réellement
      // bloquant. Sinon, on considère l'objectif atteint (évite de bloquer les
      // dépendances sur un LLM trop strict ou une réponse ambiguë).
      if (!passed && allSuccess && !blocking) {
        return {
          passed: true,
          reasoning: `Toutes les actions ont réussi ; verdict LLM non bloquant retenu comme succès. (${reasoning})`,
        };
      }

      return { passed, reasoning };
    } catch (err) {
      console.warn(
        `[Executor]    ⚠️ Vérification des critères échouée, repli heuristique: ${(err as Error).message}`
      );
      return {
        passed: allSuccess,
        reasoning: "Vérification LLM indisponible ; repli sur le succès de toutes les actions.",
      };
    }
  }

  private summarizeResult(result: unknown): string {
    if (result === null || result === undefined) return "ok (vide)";
    if (typeof result === "string") return result.slice(0, 300);
    try {
      return JSON.stringify(result).slice(0, 300);
    } catch {
      return String(result).slice(0, 300);
    }
  }

  private parseJsonObject(raw: string): Record<string, unknown> {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Aucun objet JSON trouvé dans la réponse LLM");
    const parsed = JSON.parse(match[0]);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("La réponse LLM n'est pas un objet JSON");
    }
    return parsed as Record<string, unknown>;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`LLM ${label} timeout (${ms}ms)`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private createSubGoals(
    mission: Mission,
    parentId: string,
    plans: Array<{ title: string; description: string; successCriteria: string[]; priority: string; dependsOn?: string[] }>
  ): string[] {
    const ids: string[] = [];
    // 1re passe : créer tous les objectifs et mémoriser le mapping titre → id.
    const titleToId = new Map<string, string>();

    for (const plan of plans) {
      const id = mission.addSubGoal({
        parentId,
        title: plan.title,
        description: plan.description,
        successCriteria: plan.successCriteria,
        priority: plan.priority as import("./types.js").GoalPriority,
      });
      ids.push(id);
      titleToId.set(plan.title.trim().toLowerCase(), id);
    }

    // 2e passe : résoudre les dépendances (exprimées par titre) en IDs de goals.
    plans.forEach((plan, index) => {
      const deps = plan.dependsOn ?? [];
      if (deps.length === 0) return;
      const goal = mission.getGoal(ids[index]);
      if (!goal) return;
      goal.dependsOn = deps
        .map((d) => titleToId.get(String(d).trim().toLowerCase()))
        .filter((id): id is string => !!id && id !== ids[index]);
    });

    return ids;
  }

  private createDefaultReflection(actionId: string, success: boolean): ReflectionResult {
    return {
      actionId,
      timestamp: new Date().toISOString(),
      observation: success ? "Action réussie" : "Action échouée",
      success: success ? "OK" : null,
      failure: success ? null : "Échec",
      hypothesis: null,
      confidence: success ? 0.7 : 0.3,
      decision: success ? "continue" : "retry",
      reasoning: success ? "Succès, on continue." : "Échec, on retente.",
    };
  }

  private extractLessons(mission: Mission): string[] {
    const lessons: string[] = [];
    const context = mission.getContext();

    // Leçons des erreurs répétées
    const errorCounts = new Map<string, number>();
    for (const err of context.errors) {
      errorCounts.set(err.action, (errorCounts.get(err.action) || 0) + 1);
    }
    for (const [action, count] of errorCounts) {
      if (count >= 2) {
        lessons.push(`Le skill "${action}" a tendance à échouer (${count}x). Envisager une alternative.`);
      }
    }

    // Leçons des hypothèses validées
    if (context.hypotheses.length > 0) {
      lessons.push(`Hypothèses explorées: ${context.hypotheses.slice(-3).join("; ")}`);
    }

    return lessons;
  }

  private finalizeMission(mission: Mission): void {
    this.activeMissions.delete(mission.id);
    this.completedMissions.push(mission);
    if (this.completedMissions.length > Executor.MAX_COMPLETED) {
      this.completedMissions.shift();
    }
    // Persistance finale (statut terminal).
    void this.persist(mission);
    this.proposeLearning(mission);
  }

  /**
   * Close reflection → learning without allowing the learning engine to mutate
   * the workspace or policy. Applying a proposal remains an explicit human or
   * policy decision in a later step.
   */
  private proposeLearning(mission: Mission): void {
    try {
      const state = mission.getState();
      const actions = Object.values(state.goals).flatMap((goal) => goal.plannedActions.map((action) => ({
        actionId: action.id,
        actionName: action.skillName,
        skillName: action.skillName,
        success: action.status === "completed",
        errorMessage: action.status === "failed" ? String(action.result ?? "Action failed") : undefined,
        goalId: goal.id,
      })));
      const learning = learningEngine.learnFromMission({
        missionId: mission.id,
        missionTitle: state.title,
        overallSuccess: mission.status === "completed",
        touchedFiles: state.context.relevantFiles,
        actions,
        errors: state.context.errors.map((error) => ({ message: error.error, action: error.action })),
        decisions: state.context.decisions.map((decision) => ({ what: decision.what, why: decision.why })),
      }, { applyAutoImprovements: false });
      this.learningResults.set(mission.id, learning);
      this.emit("mission_learning_completed", {
        missionId: mission.id,
        lessons: learning.lessons.length,
        candidateProposals: learning.candidateImprovements?.length ?? 0,
      });
    } catch (error) {
      // Learning must never turn an already terminal mission into a failure.
      this.emit("mission_learning_failed", { missionId: mission.id, error: String(error) });
    }
  }

  /**
   * Émet une demande d'approbation et attend sa résolution.
   * Résout `false` (refus) si le délai expire sans réponse.
   */
  private requestApproval(
    mission: Mission,
    goalId: string,
    action: PlannedAction,
    reason: string
  ): Promise<boolean> {
    this.emit("approval_required", {
      missionId: mission.id,
      goalId,
      actionId: action.id,
      skill: action.skillName,
      args: action.args,
      reason,
      timeoutMs: this.approvalTimeoutMs,
    });

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(action.id);
        console.log(`[Executor]    ⌛ Approbation expirée pour ${action.skillName} — refus par défaut.`);
        this.emit("approval_timeout", {
          missionId: mission.id,
          goalId,
          actionId: action.id,
          skill: action.skillName,
        });
        resolve(false);
      }, this.approvalTimeoutMs);

      this.pendingApprovals.set(action.id, { resolve, timer });
    });
  }

  /** Sauvegarde l'état courant de la mission (no-op si aucun store branché). */
  private async persist(mission: Mission): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.save(mission.toJSON());
    } catch (err) {
      console.warn(`[Executor] ⚠️ Persistance mission ${mission.id} échouée: ${(err as Error).message}`);
    }
  }

  /**
   * Reprend les missions interrompues (statut pending/in_progress) au démarrage.
   * Recharge leur état depuis le store et relance leur exécution en arrière-plan.
   * Ne fait rien si aucun store n'est branché ou si le SkillHandler manque.
   */
  async resumePending(availableSkills: string[]): Promise<number> {
    if (!this.store || !this.store.isEnabled()) return 0;
    if (!this.skillHandler) {
      console.warn(`[Executor] resumePending appelé sans SkillHandler configuré.`);
      return 0;
    }

    const states = await this.store.listByStatus(["pending", "in_progress"]);
    if (states.length === 0) return 0;

    let resumed = 0;
    for (const state of states) {
      // Éviter de reprendre une mission déjà active en mémoire.
      if (this.activeMissions.has(state.id)) continue;

      const mission = Mission.fromJSON(state);
      this.activeMissions.set(mission.id, mission);

      console.log(`[Executor] ♻️ Reprise de la mission "${state.title}" (${state.id}).`);
      this.emit("mission_resumed", { missionId: mission.id, title: state.title });

      this.executeMission(mission, availableSkills).catch((err) => {
        console.error(`[Executor] Reprise mission ${mission.id} échouée:`, err);
        this.emit("mission_failed", { missionId: mission.id, error: String(err) });
      });
      resumed++;
    }

    console.log(`[Executor] ♻️ ${resumed} mission(s) reprise(s) depuis le store.`);
    return resumed;
  }

  private emit(event: string, data: Record<string, unknown>): void {
    if (this.eventEmitter) {
      this.eventEmitter(event, data);
    }
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Options d'exécution transmises au handler de skill. */
export interface SkillHandlerOptions {
  /** Exécuter en simulation (dry-run), sans effet de bord. */
  dryRun?: boolean;
}

/** Handler pour exécuter un skill */
export type SkillHandlerFn = (
  name: string,
  args: any,
  options?: SkillHandlerOptions
) => Promise<any>;

/** Émetteur d'événements pour le frontend */
export type ExecutorEventEmitter = (event: string, data: Record<string, unknown>) => void;

/** Fonction LLM générique: prompt → texte. */
export type LLMTextFn = (prompt: string) => Promise<string>;

/** Schéma d'un outil, utilisé pour générer les arguments. */
export interface ToolSchema {
  name: string;
  description?: string;
  parameters?: unknown;
}
