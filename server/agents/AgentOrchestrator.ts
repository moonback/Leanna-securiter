import { randomUUID } from "crypto";
import { getAgentDefinition, getAgentDefinitionOrThrow } from "./roles.js";
import type {
  AgentRole,
  AgentTask,
  TaskStatus,
  TaskPriority,
  OrchestrationPlan,
} from "./types.js";
import { AgentExecutor, SkillHandler } from "./AgentExecutor.js";
import { AgentRuntimeExecutor } from "./AgentRuntimeExecutor.js";
import { TaskScheduler, type TaskRunner } from "./TaskScheduler.js";
import type { AgentRuntime as AgenticRuntime } from "../runtime/agentic/AgentRuntime.js";
import { ProgressNotifier, ProgressCallback, EventBroadcaster } from "./ProgressNotifier.js";
import { AgentRegistry, agentRegistry } from "./AgentRegistry.js";
import { agentMessageBus } from "./AgentMessageBus.js";
import { COLLABORATION_PATTERNS } from "./AgentCommunication.js";
import { agentPersistence } from "./AgentPersistence.js";
import { createLogger } from "../utils/logger.js";
import { initCustomAgents } from "../routes/custom-agents.js";
import { agentEventStream } from "./AgentEventStream.js";
import type { AgentBrain as AgentBrainType } from "./brain/AgentBrain.js";
import type {
  BrainGoalInput,
  BrainPlan,
  BrainExecutionResult,
} from "./brain/types.js";

// Ré-exporter pour compatibilité et usage externe
export type { AgentEvent } from "./ProgressNotifier.js";
export { agentMessageBus } from "./AgentMessageBus.js";
export { agentRegistry } from "./AgentRegistry.js";
export { COLLABORATION_PATTERNS, DELEGATION_MATRIX, delegationPolicy } from "./AgentCommunication.js";
export type { DelegationPolicy, DelegationTaskContext } from "./AgentCommunication.js";

const log = createLogger("Orchestrator");

// ═══════════════════════════════════════════════════════════════════════════════
// AgentOrchestrator — Façade allégée (délègue l'exécution aux composants)
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentOrchestrator {
  private tasks: Map<string, AgentTask> = new Map();
  private orchestrations: Map<string, OrchestrationPlan> = new Map();

  // Composants spécialisés
  private notifier = new ProgressNotifier();
  private legacyExecutor = new AgentExecutor(this.notifier);
  /**
   * Moteur d'exécution ACTIF. Par défaut l'exécuteur legacy, remplacé par le
   * runtime agentique dès que `enableAgenticRuntime()` est appelé au bootstrap.
   */
  private executor: TaskRunner & {
    getRunningCount(role: string): number;
    cancel(taskId: string): boolean;
    isRunning?(taskId: string): boolean;
    runTool?(name: string, args: Record<string, unknown>): Promise<unknown>;
  } = this.legacyExecutor;
  private scheduler = new TaskScheduler(this.executor, this.notifier);
  /** Vrai une fois le runtime agentique branché (plus de fallback silencieux). */
  private agenticEnabled = false;

  // Registry des agents autonomes (partagé via singleton)
  private registry: AgentRegistry = agentRegistry;

  // ─── Configuration ────────────────────────────────────────────────────────

  /**
   * Injecte le handler de skills pour que les agents puissent appeler des outils.
   * Initialise également le registre d'agents autonomes.
   */
  setSkillHandler(handler: SkillHandler): void {
    // Le handler alimente l'exécuteur legacy et le registre d'agents autonomes.
    this.legacyExecutor.setSkillHandler(handler);

    // Initialiser le registre d'agents autonomes si ce n'est pas encore fait
    if (!this.registry.isReady) {
      this.registry.initialize(handler);
      log.info("🤖 Flotte d'agents autonomes initialisée");
      
      // Charger les agents personnalisés après l'initialisation
      initCustomAgents();
    }
  }

  /**
   * Bascule l'orchestrateur sur le RUNTIME AGENTIQUE comme moteur d'exécution.
   *
   * À partir de cet appel, `delegateTask()` et l'orchestration multi-agents
   * (`orchestrate()` → scheduler) exécutent les tâches via la vraie boucle
   * analyse → plan → écriture → vérification → correction, avec budget
   * transactionnel. L'exécuteur legacy n'est plus utilisé pour les tâches
   * (il reste seulement pour la flotte d'agents autonomes qui l'appelle
   * directement).
   *
   * Appelé une fois au bootstrap. Après migration, c'est le chemin par défaut :
   * plus aucun fallback silencieux vers `AgentExecutor` pour `agent_orchestrate`.
   */
  enableAgenticRuntime(agentic: AgenticRuntime): void {
    const runtimeExecutor = new AgentRuntimeExecutor(agentic, this.notifier);
    this.executor = runtimeExecutor;
    this.scheduler.setRunner(runtimeExecutor);
    // Phase 5 : la flotte d'agents autonomes partage le même moteur agentique.
    // Le registre redémarre ses agents sur le runtime (voir AgentRegistry.setRunner).
    // Au bootstrap aucune mission ne tourne, la bascule est donc acceptée ; si
    // elle était refusée (tâches actives), on le journalise sans forcer.
    const swapped = this.registry.setRunner(runtimeExecutor);
    if (!swapped) {
      log.warn("⚠️ Flotte autonome non basculée sur le runtime agentique (tâches actives) — reste sur le moteur legacy.");
    }
    this.agenticEnabled = true;
    log.info("🧠 Runtime agentique ACTIVÉ — orchestrate/delegateTask ET flotte autonome passent par la boucle plan→act→verify");
  }

  /** Indique si le runtime agentique est le moteur d'exécution actif. */
  get isAgenticEnabled(): boolean {
    return this.agenticEnabled;
  }

  /**
   * Exécute un outil isolé via le moteur d'exécution actif (si celui-ci expose
   * `runTool`). Utilisé par le BrainVerifier pour la vérification hashée des
   * étapes. Retourne `undefined` si le moteur courant ne supporte pas
   * l'exécution d'outil isolée.
   */
  async runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (typeof this.executor.runTool !== "function") {
      throw new Error("Le moteur d'exécution actif n'expose pas runTool.");
    }
    return this.executor.runTool(name, args);
  }

  /** Indique si le moteur actif peut exécuter un outil isolé (runTool). */
  get canRunTool(): boolean {
    return typeof this.executor.runTool === "function";
  }

  /** Configure le callback de progression */
  setProgressCallback(callback: ProgressCallback): void {
    this.notifier.setProgressCallback(callback);
    this.registry.setProgressCallback(callback);
  }

  /** Configure le broadcaster d'événements temps réel vers le frontend */
  setEventBroadcaster(broadcaster: EventBroadcaster): void {
    const publish = (event: Parameters<EventBroadcaster>[0]) => {
      broadcaster(event);
      agentEventStream.publish(event);
    };
    this.notifier.setEventBroadcaster(publish);
    this.registry.setEventBroadcaster(publish);

    // Transmettre les événements du bus de messages au frontend
    agentMessageBus.on("message", (msg) => {
      try {
          publish({
          type: "agent_event",
          event: "task_started",
          taskId: msg.id,
          role: msg.from,
          // Encode les infos de bus dans le title pour parsing côté frontend
          title: `[bus] ${msg.from}→${msg.to} ${msg.type}`,
          status: "running",
          agentName: getAgentDefinition(msg.from)?.name ?? msg.from,
          // detail contient les infos de routage pour le composant fleet
          detail: `bus:${msg.type}:${msg.from}:${String(msg.to)}:${msg.metadata?.autonomous === true ? 'auto' : 'manual'}`,
          timestamp: msg.timestamp,
        });
      } catch {
        // Ne pas bloquer si le broadcast échoue
      }
    });
  }

  // ─── Délégation simple ────────────────────────────────────────────────────

  /**
   * Délègue une tâche à un agent spécialisé.
   * Retourne immédiatement avec l'ID de la tâche (exécution async).
   */
  async delegateTask(params: {
    role: AgentRole;
    title: string;
    description: string;
    files?: string[];
    instructions?: string;
    priority?: TaskPriority;
    timeoutMs?: number;
  }): Promise<AgentTask> {
    const agent = getAgentDefinitionOrThrow(params.role);
    const currentRunning = this.executor.getRunningCount(params.role);

    log.info(`📋 Délégation → ${agent.name}: "${params.title}" (priorité: ${params.priority ?? "medium"})`);

    if (currentRunning >= agent.maxConcurrency) {
      log.warn(`⚠️ Rejet — ${agent.name} à capacité maximale (${agent.maxConcurrency})`);
      throw new Error(
        `L'agent "${agent.name}" est à capacité maximale (${agent.maxConcurrency} tâche(s) simultanée(s)). Réessaie plus tard.`
      );
    }

    const task: AgentTask = {
      id: randomUUID(),
      role: params.role,
      title: params.title,
      description: params.description,
      priority: params.priority ?? "medium",
      status: "pending",
      context: {
        files: params.files ?? [],
        instructions: params.instructions,
      },
      createdAt: new Date().toISOString(),
      timeoutMs: params.timeoutMs ?? agent.defaultTimeoutMs,
    };

    this.tasks.set(task.id, task);
    log.debug(`Tâche créée: ${task.id.slice(0, 8)} — timeout: ${task.timeoutMs}ms`);

    // Persister immédiatement (statut pending)
    agentPersistence.saveTask(task).catch(() => {});

    // Lancer l'exécution en arrière-plan
    this.executor.execute(task).catch((err) => {
      log.error(`Erreur non gérée pour tâche ${task.id.slice(0, 8)}: ${err.message}`);
    });

    return task;
  }

  // ─── Orchestration multi-agents ───────────────────────────────────────────

  /**
   * Orchestre plusieurs tâches avec gestion des dépendances.
   * Les tâches sans dépendances s'exécutent en parallèle.
   */
  async orchestrate(params: {
    title: string;
    description: string;
    tasks: Array<{
      /** ID stable optionnel — permet d'être référencé dans dependsOn d'autres tâches */
      id?: string;
      role: AgentRole;
      title: string;
      description: string;
      files?: string[];
      instructions?: string;
      priority?: TaskPriority;
      /**
       * IDs stables ou titres de tâches dont celle-ci dépend.
       * Résolution (par ordre de priorité) :
       *   1. ID stable fourni via le champ `id`
       *   2. UUID interne généré automatiquement
       *   3. Titre de tâche dans le même plan
       * Le scheduler ne lance la tâche que lorsque toutes ses dépendances
       * sont au statut "completed".
       */
      dependsOn?: string[];
    }>;
  }): Promise<OrchestrationPlan> {
    const orchestrationId = randomUUID();

    log.info(`🎯 Orchestration "${params.title}" — ${params.tasks.length} tâche(s), agents: ${[...new Set(params.tasks.map(t => t.role))].join(", ")}`);

    const agentTasks: AgentTask[] = [];
    const dependencies: Record<string, string[]> = {};

    // Première passe : attribuer un UUID interne à chaque tâche et construire
    // les tables de résolution (ID stable → UUID interne, titre → UUID interne).
    const taskIds = params.tasks.map(() => randomUUID());
    const idByStableId = new Map<string, string>(); // "task-analysis" → UUID interne
    const idByTitle = new Map<string, string>();     // "Analyse du code" → UUID interne
    params.tasks.forEach((taskDef, index) => {
      if (taskDef.id) {
        if (idByStableId.has(taskDef.id)) {
          log.warn(`⚠️ ID de tâche dupliqué "${taskDef.id}" — seule la première occurrence est prise en compte`);
        } else {
          idByStableId.set(taskDef.id, taskIds[index]);
        }
      }
      idByTitle.set(taskDef.title, taskIds[index]);
    });

    /**
     * Résout une référence de dépendance vers l'UUID interne de la tâche.
     * Ordre de résolution :
     *   1. ID stable (champ `id` de la définition de tâche)
     *   2. Titre de tâche dans le même plan
     *   3. Passage direct (assume que la référence est déjà un UUID valide,
     *      ex: dépendance vers une tâche d'un plan précédent)
     */
    const knownInternalIds = new Set<string>(taskIds);
    const resolveRef = (reference: string, fromTitle: string): string => {
      const resolved = idByStableId.get(reference) ?? idByTitle.get(reference) ?? reference;
      if (resolved === reference && !knownInternalIds.has(reference)) {
        log.warn(
          `⚠️ Dépendance non résolue: tâche "${fromTitle}" référence "${reference}" — ` +
          `IDs stables connus: [${[...idByStableId.keys()].join(", ")}], ` +
          `titres connus: [${[...idByTitle.keys()].join(", ")}]`
        );
      }
      return resolved;
    };

    // Log de la table de résolution (aide au débogage)
    log.debug(
      `Table de résolution — IDs stables: {${[...idByStableId.entries()].map(([k, v]) => `"${k}"→${v.slice(0, 8)}`).join(", ")}} ` +
      `| Titres: {${[...idByTitle.entries()].map(([k, v]) => `"${k}"→${v.slice(0, 8)}`).join(", ")}}`
    );

    // Seconde passe : créer les tâches et résoudre toutes les dépendances.
    for (let i = 0; i < params.tasks.length; i++) {
      const taskDef = params.tasks[i];
      const agent = getAgentDefinitionOrThrow(taskDef.role);
      const taskId = taskIds[i];

      const task: AgentTask = {
        id: taskId,
        orchestrationId,
        role: taskDef.role,
        title: taskDef.title,
        description: taskDef.description,
        priority: taskDef.priority ?? "medium",
        status: "pending",
        context: {
          files: taskDef.files ?? [],
          instructions: taskDef.instructions,
        },
        createdAt: new Date().toISOString(),
        timeoutMs: agent.defaultTimeoutMs,
      };

      agentTasks.push(task);
      this.tasks.set(task.id, task);

      const rawDeps = taskDef.dependsOn ?? [];
      const resolvedDeps = rawDeps.map((ref) => resolveRef(ref, taskDef.title));
      dependencies[taskId] = resolvedDeps;

      log.info(
        `  [plan] "${taskDef.title}"${taskDef.id ? ` (id: ${taskDef.id})` : ""} → UUID ${taskId.slice(0, 8)} | ` +
        `dependsOn raw: [${rawDeps.join(", ") || "aucune"}] → resolved: [${resolvedDeps.map(d => d.slice(0, 8)).join(", ") || "aucune"}]`
      );
    }

    const plan: OrchestrationPlan = {
      id: orchestrationId,
      title: params.title,
      description: params.description,
      tasks: agentTasks,
      dependencies,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.orchestrations.set(orchestrationId, plan);
    log.info(`Plan d'orchestration créé (${orchestrationId.slice(0, 8)}). Lancement...`);

    // Persister le plan d'orchestration
    agentPersistence.saveOrchestration(plan).catch(() => {});

    // Lancer l'orchestration en arrière-plan
    this.scheduler.execute(plan).catch((err) => {
      log.error(`Erreur orchestration ${orchestrationId.slice(0, 8)}: ${err.message}`);
    });

    return plan;
  }

  // ─── Collaboration inter-agents ───────────────────────────────────────────

  /**
   * Lance une collaboration structurée entre agents selon un pattern prédéfini.
   * Ex: "document-complet", "traduction-verifiee", "recherche-redaction"
   *
   * @param patternName - Nom du pattern de collaboration (voir COLLABORATION_PATTERNS)
   * @param context - Contexte partagé pour tous les agents du pattern
   */
  async collaborateByPattern(params: {
    patternName: string;
    context: {
      title: string;
      description: string;
      files?: string[];
      instructions?: string;
    };
  }): Promise<OrchestrationPlan> {
    const pattern = COLLABORATION_PATTERNS.find((p) => p.name === params.patternName);
    if (!pattern) {
      throw new Error(
        `Pattern de collaboration "${params.patternName}" introuvable. Disponibles: ${COLLABORATION_PATTERNS.map((p) => p.name).join(", ")}`
      );
    }

    log.info(`🤝 Collaboration par pattern "${pattern.name}" — ${pattern.participants.length} agent(s): ${pattern.participants.join(", ")}`);

    // Transformer les étapes dépendantes en titres de tâches résolvables par orchestrate().
    const stepTitle = (stepNumber: number) => {
      const step = pattern.workflow.find((workflowStep) => workflowStep.step === stepNumber);
      return step ? `[${pattern.name}] Étape ${step.step}: ${step.action}` : undefined;
    };
    const tasks = pattern.workflow.map((step) => ({
      role: step.agent,
      title: `[${pattern.name}] Étape ${step.step}: ${step.action}`,
      description: `${params.context.description}\n\nÉtape ${step.step} du pattern "${pattern.name}": ${step.action}`,
      files: params.context.files,
      instructions: params.context.instructions,
      priority: "high" as TaskPriority,
      dependsOn: (step.dependsOn ?? []).map(stepTitle).filter((title): title is string => Boolean(title)),
    }));

    // Notifier le bus du démarrage de la collaboration
    await agentMessageBus.broadcast("planner", "collaboration_started", {
      pattern: pattern.name,
      participants: pattern.participants,
      title: params.context.title,
    }).catch(() => {});

    return this.orchestrate({
      title: `[${pattern.name}] ${params.context.title}`,
      description: pattern.description,
      tasks,
    });
  }

  /**
   * Retourne l'état de santé complet de la flotte d'agents autonomes.
   */
  getFleetStatus() {
    if (!this.registry.isReady) {
      return {
        initialized: false,
        message: "Le registre d'agents n'est pas encore initialisé (setSkillHandler() pas encore appelé)",
      };
    }
    return {
      initialized: true,
      ...this.registry.getFleetStatus(),
    };
  }

  /**
   * Délègue une tâche directement à un agent autonome via le bus de messages.
   * Contrairement à delegateTask(), cela passe par le AutonomousAgent complet
   * qui peut lui-même sous-déléguer à d'autres agents.
   */
  async delegateAutonomously(params: {
    role: AgentRole;
    title: string;
    description: string;
    files?: string[];
    instructions?: string;
    priority?: TaskPriority;
    timeoutMs?: number;
  }): Promise<AgentTask> {
    // Utiliser le chemin standard (crée la tâche et notifie via AgentExecutor)
    const task = await this.delegateTask(params);

    // Notifier le bus de messages que l'orchestrateur a délégué cette tâche
    await agentMessageBus
      .broadcast("planner", "task_delegated_by_orchestrator", {
        taskId: task.id,
        role: params.role,
        title: params.title,
      })
      .catch(() => {});

    return task;
  }

  // ─── Requêtes ─────────────────────────────────────────────────────────────

  /** Récupère une tâche par son ID */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Liste les tâches avec filtres optionnels */
  listTasks(filters?: { role?: AgentRole; status?: TaskStatus; limit?: number }): AgentTask[] {
    let results = Array.from(this.tasks.values());

    if (filters?.role) {
      results = results.filter((t) => t.role === filters.role);
    }
    if (filters?.status) {
      results = results.filter((t) => t.status === filters.status);
    }

    // Tri par date de création décroissante
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return results.slice(0, filters?.limit ?? 20);
  }

  /** Récupère un plan d'orchestration */
  getOrchestration(orchestrationId: string): OrchestrationPlan | undefined {
    return this.orchestrations.get(orchestrationId);
  }

  /** Liste les orchestrations */
  listOrchestrations(): OrchestrationPlan[] {
    return Array.from(this.orchestrations.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Annule une tâche, qu'elle soit en attente (`pending`) ou en cours (`running`).
   *
   * - `pending` : la tâche est marquée annulée immédiatement, elle ne démarrera pas.
   * - `running` : un signal d'annulation coopératif est envoyé à l'exécuteur ;
   *   la tâche s'arrête au prochain point de contrôle (avant/après un appel
   *   d'outil ou un tour), puis son statut passe à `cancelled` via `execute()`.
   *
   * @returns `true` si l'annulation a été prise en compte, `false` si la tâche
   *          est introuvable ou déjà terminée.
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === "pending") {
      task.status = "cancelled";
      agentPersistence.updateTaskStatus(taskId, "cancelled").catch(() => {});
      log.info(`🛑 Tâche ${taskId.slice(0, 8)} (pending) annulée`);
      return true;
    }

    if (task.status === "running") {
      const signaled = this.executor.cancel(taskId);
      if (signaled) {
        log.info(`🛑 Tâche ${taskId.slice(0, 8)} (running) — signal d'annulation envoyé`);
      } else {
        log.warn(`⚠️ Tâche ${taskId.slice(0, 8)} marquée running mais aucune exécution active — annulation logique`);
        task.status = "cancelled";
        agentPersistence.updateTaskStatus(taskId, "cancelled").catch(() => {});
      }
      return true;
    }

    // Déjà terminée (completed/failed/incomplete/cancelled) — rien à annuler.
    return false;
  }

  /**
   * Annule une orchestration entière : signale toutes ses tâches `pending` et
   * `running`. Les tâches déjà terminées ne sont pas affectées.
   *
   * @returns le nombre de tâches pour lesquelles l'annulation a été prise en
   *          compte, ou `-1` si l'orchestration est introuvable.
   */
  cancelOrchestration(orchestrationId: string): number {
    const plan = this.orchestrations.get(orchestrationId);
    if (!plan) return -1;

    let cancelledCount = 0;
    for (const task of plan.tasks) {
      if (task.status === "pending" || task.status === "running") {
        if (this.cancelTask(task.id)) cancelledCount++;
      }
    }

    if (plan.status === "pending" || plan.status === "running") {
      plan.status = "cancelled";
      plan.completedAt = new Date().toISOString();
      agentPersistence.updateOrchestrationStatus(orchestrationId, "cancelled", plan.completedAt).catch(() => {});
    }

    log.info(`🛑 Orchestration ${orchestrationId.slice(0, 8)} annulée — ${cancelledCount} tâche(s) concernée(s)`);
    return cancelledCount;
  }

  /**
   * Restaure les tâches et orchestrations depuis Supabase au redémarrage.
   * Les tâches "running" au moment du crash sont marquées "failed".
   * Les tâches "pending" sont rechargées en mémoire pour reprise éventuelle.
   */
  async restoreFromPersistence(): Promise<{ tasks: number; orchestrations: number }> {
    if (!agentPersistence.isAvailable) {
      log.debug("restoreFromPersistence: Supabase non disponible — skip");
      return { tasks: 0, orchestrations: 0 };
    }

    try {
      // Charger les tâches récentes en mémoire (sans les ré-exécuter)
      const recentTasks = await agentPersistence.loadRecentTasks(200);
      for (const task of recentTasks) {
        // Les tâches "running" au moment du crash → failed
        if (task.status === "running") {
          task.status = "failed";
          task.result = {
            success: false,
            outcome: "failed" as const,
            summary: "Tâche interrompue par un redémarrage du serveur",
            error: "Server restart",
            durationMs: 0,
          };
          await agentPersistence.updateTaskStatus(
            task.id,
            "failed",
            task.result,
            task.startedAt,
            new Date().toISOString()
          );
        }
        this.tasks.set(task.id, task);
      }

      // Charger les orchestrations récentes
      const recentOrchs = await (agentPersistence as any).loadRecentOrchestrations(50);
      for (const row of recentOrchs) {
        if (!this.orchestrations.has(row.id)) {
          this.orchestrations.set(row.id, {
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status === "running" ? "failed" : row.status,
            tasks: [],            // Les tâches sont déjà en mémoire via loadRecentTasks
            dependencies: row.dependencies,
            createdAt: row.created_at,
            completedAt: row.completed_at ?? undefined,
          });
          // Marquer les orchestrations "running" comme failed
          if (row.status === "running") {
            await agentPersistence.updateOrchestrationStatus(row.id, "failed", new Date().toISOString());
          }
        }
      }

      log.info(
        `✅ Restauration depuis Supabase: ${recentTasks.length} tâche(s), ${recentOrchs.length} orchestration(s)`
      );
      return { tasks: recentTasks.length, orchestrations: recentOrchs.length };
    } catch (err) {
      log.error(`restoreFromPersistence: ${(err as Error).message}`);
      return { tasks: 0, orchestrations: 0 };
    }
  }

  /** Retourne les statistiques globales des agents */
  getStats(): {
    totalTasks: number;
    byStatus: Record<TaskStatus, number>;
    byRole: Record<AgentRole, number>;
    activeOrchestrations: number;
  } {
    const allTasks = Array.from(this.tasks.values());
    const byStatus: Record<TaskStatus, number> = {
      pending: 0, running: 0, completed: 0, incomplete: 0, failed: 0, cancelled: 0,
    };
    const byRole: Record<string, number> = {
      coder: 0,
      refactor: 0,
      debugger: 0,
      reviewer: 0,
      tester: 0,
      security: 0,
      architect: 0,
      writer: 0,
      formatter: 0,
      researcher: 0,
      proofreader: 0,
      translator: 0,
      summarizer: 0,
      planner: 0,
    };

    for (const task of allTasks) {
      if (byStatus[task.status] !== undefined) {
        byStatus[task.status]++;
      }
      byRole[task.role] = (byRole[task.role] ?? 0) + 1;
    }

    const activeOrchestrations = Array.from(this.orchestrations.values())
      .filter((o) => o.status === "running" || o.status === "pending").length;

    return { totalTasks: allTasks.length, byStatus, byRole: byRole as Record<AgentRole, number>, activeOrchestrations };
  }

  // ─── Agent Brain (Cerveau Central Leanna) ──────────────────────────────────

  private brainInstance: AgentBrainType | null = null;

  /**
   * Retourne l'instance de l'Agent Brain (cerveau central Leanna).
   * L'import est dynamique pour éviter le cycle d'import
   * (AgentBrain importe AgentOrchestrator).
   */
  async getBrain(): Promise<AgentBrainType> {
    if (!this.brainInstance) {
      const { AgentBrain } = await import("./brain/AgentBrain.js");
      this.brainInstance = new AgentBrain(this);
    }
    return this.brainInstance;
  }

  /**
   * Planifie dynamiquement un objectif utilisateur via l'Agent Brain
   */
  async brainPlan(input: BrainGoalInput): Promise<BrainPlan> {
    const brain = await this.getBrain();
    return brain.planGoal(input);
  }

  /**
   * Exécute de bout en bout un objectif utilisateur via l'Agent Brain
   */
  async brainExecute(input: BrainGoalInput): Promise<BrainExecutionResult> {
    const brain = await this.getBrain();
    return brain.executeGoal(input);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const agentOrchestrator = new AgentOrchestrator();
