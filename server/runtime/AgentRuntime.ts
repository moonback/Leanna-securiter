/**
 * AgentRuntime — Cœur du système, point d'entrée unique
 * 
 * Le runtime est le conteneur d'injection de dépendances qui orchestre
 * tous les composants du système. Aucun composant n'accède directement
 * à un autre — tout passe par le runtime.
 * 
 * Responsabilités :
 * - Enregistrement et gestion des agents (plugins)
 * - Scheduling et exécution des tâches
 * - Coordination via l'EventBus
 * - Gestion du cycle de vie (démarrage, arrêt)
 * - Métriques centralisées
 * 
 * Flux d'exécution simplifié d'une tâche :
 *   1. submit(agentId, context) → Task créée
 *   2. StateMachine : pending → running
 *   3. Agent.execute(context, tools) → résultat
 *   4. StateMachine : running → completed/failed
 *   5. Événement émis → listeners notifiés
 */

import { randomUUID } from "crypto";
import { EventBus } from "./EventBus.js";
import { StateMachine } from "./StateMachine.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { Memory } from "./Memory.js";
import { HierarchicalMemoryService } from "./HierarchicalMemoryService.js";
import { PermissionPolicy } from "./PermissionPolicy.js";
import { DryRunController } from "./DryRun.js";
import type {
  Task,
  TaskResult,
  AgentContext,
  AgentMetadata,
  AgentPriority,
  RuntimeConfig,
  TaskState,
} from "./types.js";
import { DEFAULT_RUNTIME_CONFIG } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Plugin Interface
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface qu'un agent-plugin doit implémenter.
 * Volontairement simple : metadata + execute.
 */
export interface AgentPlugin {
  metadata: AgentMetadata;
  
  /**
   * Exécute une tâche dans le contexte de cet agent.
   * L'agent reçoit le ToolRegistry pour appeler les outils dont il a besoin.
   */
  execute(context: AgentContext, tools: ToolRegistry): Promise<TaskResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AgentRuntime
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentRuntime {
  // Composants centraux
  readonly events: EventBus;
  readonly tools: ToolRegistry;
  readonly memory: Memory;
  readonly hierarchicalMemory: HierarchicalMemoryService;
  readonly fsm: StateMachine;

  // Registre des agents
  private agents = new Map<string, AgentPlugin>();

  // Tâches
  private tasks = new Map<string, Task>();
  private runningCount = new Map<string, number>(); // agentId → nb de tâches en cours
  private taskQueue: Task[] = []; // Queue de priorité simple

  // Config
  private config: RuntimeConfig;
  private started = false;
  private startPromise: Promise<void> | null = null;

  constructor(
    config: Partial<RuntimeConfig> = {},
    options: { permissionPolicy?: PermissionPolicy; dryRun?: DryRunController } = {}
  ) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };

    // Initialisation des composants centraux
    this.events = new EventBus();
    this.tools = new ToolRegistry({
      enableMetrics: this.config.enableMetrics,
      eventBus: this.events,
      defaultTimeoutMs: 180_000, // 3 minutes pour les tâches agent (aligné avec AgentExecutor)
      permissionPolicy: options.permissionPolicy ?? PermissionPolicy.fromEnv(process.env, { eventBus: this.events }),
      dryRun: options.dryRun ?? DryRunController.fromEnv(process.env, { eventBus: this.events }),
    });
    this.memory = new Memory({ eventBus: this.events });
    this.hierarchicalMemory = new HierarchicalMemoryService({
      sessionStore: this.memory,
      eventBus: this.events,
    });
    this.fsm = new StateMachine({ eventBus: this.events });

    // Logging middleware
    if (this.config.logLevel === "debug") {
      this.events.use((event, next) => {
        console.log(`[Runtime] ${event.type}`, JSON.stringify(event).slice(0, 200));
        next();
      });
    }
  }

  // ─── Cycle de vie ──────────────────────────────────────────────────────────

  /**
   * Démarre le runtime. Charge la mémoire projet et initialise les agents.
   */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      await this.memory.loadProject();
      this.started = true;

      console.log(
        `[AgentRuntime] Démarré — ${this.agents.size} agent(s), ${this.tools.size} outil(s)`
      );
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Arrête le runtime proprement.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // Annuler les tâches en attente
    for (const task of this.taskQueue) {
      await this.fsm.transition(task, "cancelled");
    }
    this.taskQueue = [];

    this.started = false;
    console.log("[AgentRuntime] Arrêté");
  }

  get isRunning(): boolean {
    return this.started;
  }

  // ─── Enregistrement d'agents ───────────────────────────────────────────────

  /**
   * Enregistre un agent-plugin dans le runtime.
   * L'ajout d'un agent ne nécessite jamais de modifier le runtime.
   */
  registerAgent(agent: AgentPlugin): void {
    const { id } = agent.metadata;
    if (this.agents.has(id)) {
      console.warn(`[AgentRuntime] Agent "${id}" déjà enregistré, remplacement.`);
    }
    this.agents.set(id, agent);
    this.runningCount.set(id, 0);
    this.events.emit({ type: "agent:registered", agentId: id });
  }

  /**
   * Désenregistre un agent.
   */
  unregisterAgent(agentId: string): boolean {
    this.runningCount.delete(agentId);
    return this.agents.delete(agentId);
  }

  /**
   * Retourne la liste des agents enregistrés.
   */
  listAgents(): AgentMetadata[] {
    return Array.from(this.agents.values()).map((a) => a.metadata);
  }

  /**
   * Retourne un agent par son ID.
   */
  getAgent(agentId: string): AgentPlugin | undefined {
    return this.agents.get(agentId);
  }

  // ─── Soumission de tâches ──────────────────────────────────────────────────

  /**
   * Soumet une tâche à un agent.
   * La tâche est placée en queue et exécutée dès que l'agent est disponible.
   * 
   * @returns L'objet Task (avec son ID pour le suivi)
   */
  async submit(params: {
    agentId: string;
    title: string;
    description: string;
    files?: string[];
    instructions?: string;
    priority?: AgentPriority;
    timeoutMs?: number;
    parentTaskId?: string;
  }): Promise<Task> {
    const agent = this.agents.get(params.agentId);
    if (!agent) {
      throw new Error(`Agent "${params.agentId}" non enregistré. Disponibles: ${Array.from(this.agents.keys()).join(", ")}`);
    }

    const task: Task = {
      id: randomUUID(),
      agentId: params.agentId,
      title: params.title,
      description: params.description,
      priority: params.priority ?? "medium",
      state: "pending",
      context: {
        taskId: "", // sera rempli ci-dessous
        title: params.title,
        description: params.description,
        files: params.files ?? [],
        instructions: params.instructions,
      },
      createdAt: Date.now(),
      timeoutMs: params.timeoutMs ?? agent.metadata.timeoutMs,
      parentTaskId: params.parentTaskId,
    };
    task.context.taskId = task.id;

    this.tasks.set(task.id, task);
    this.events.emit({ type: "task:created", task });

    // Essayer d'exécuter immédiatement, sinon mettre en queue
    if (this.canRunImmediately(params.agentId, agent)) {
      this.executeTask(task, agent).catch(() => {});
    } else {
      this.enqueue(task);
    }

    return task;
  }

  /**
   * Attend la complétion d'une tâche (bloquant).
   */
  async waitForTask(taskId: string, timeoutMs?: number): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Tâche "${taskId}" introuvable`);

    if (task.state === "completed" || task.state === "failed") {
      return task.result!;
    }

    const timeout = timeoutMs ?? task.timeoutMs;
    
    return new Promise<TaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout: tâche ${taskId} non terminée après ${timeout}ms`));
      }, timeout);

      const unsub = this.events.on("task:completed", (event) => {
        if (event.taskId === taskId) {
          clearTimeout(timer);
          unsub();
          resolve(event.result);
        }
      });

      // Écouter aussi les échecs
      const unsubFail = this.events.on("task:failed", (event) => {
        if (event.taskId === taskId) {
          clearTimeout(timer);
          unsub();
          unsubFail();
          reject(new Error(event.error));
        }
      });
    });
  }

  // ─── Requêtes ─────────────────────────────────────────────────────────────

  /**
   * Retourne une tâche par son ID.
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Liste les tâches avec filtres.
   */
  listTasks(filters?: { agentId?: string; state?: TaskState; limit?: number }): Task[] {
    let results = Array.from(this.tasks.values());

    if (filters?.agentId) results = results.filter((t) => t.agentId === filters.agentId);
    if (filters?.state) results = results.filter((t) => t.state === filters.state);

    results.sort((a, b) => b.createdAt - a.createdAt);
    return results.slice(0, filters?.limit ?? 20);
  }

  /**
   * Annule une tâche en attente.
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.state !== "pending" && task.state !== "planning") return false;

    await this.fsm.transition(task, "cancelled");
    this.taskQueue = this.taskQueue.filter((t) => t.id !== taskId);
    return true;
  }

  /**
   * Statistiques du runtime.
   */
  getStats(): {
    agents: number;
    tools: number;
    tasks: { total: number; pending: number; running: number; completed: number; failed: number };
    memory: Record<string, number>;
    events: Record<string, number>;
  } {
    const allTasks = Array.from(this.tasks.values());
    return {
      agents: this.agents.size,
      tools: this.tools.size,
      tasks: {
        total: allTasks.length,
        pending: allTasks.filter((t) => t.state === "pending").length,
        running: allTasks.filter((t) => t.state === "running").length,
        completed: allTasks.filter((t) => t.state === "completed").length,
        failed: allTasks.filter((t) => t.state === "failed").length,
      },
      memory: this.memory.getStats(),
      events: this.events.getMetrics(),
    };
  }

  // ─── Exécution interne ─────────────────────────────────────────────────────

  private async executeTask(task: Task, agent: AgentPlugin): Promise<void> {
    const agentId = task.agentId;
    this.runningCount.set(agentId, (this.runningCount.get(agentId) ?? 0) + 1);
    this.events.emit({ type: "agent:busy", agentId, taskId: task.id });

    try {
      await this.fsm.transition(task, "running");

      // Exécution avec timeout
      const result = await this.executeWithTimeout(
        () => agent.execute(task.context, this.tools),
        task.timeoutMs
      );

      task.result = result;

      if (result.success) {
        await this.fsm.transition(task, "completed");
        this.events.emit({ type: "task:completed", taskId: task.id, result });
      } else {
        await this.fsm.transition(task, "failed");
        this.events.emit({ type: "task:failed", taskId: task.id, error: result.error ?? "Unknown error" });
      }
    } catch (err) {
      const error = (err as Error).message;
      task.result = {
        success: false,
        summary: `Erreur: ${error}`,
        error,
        durationMs: Date.now() - (task.startedAt ?? task.createdAt),
      };
      await this.fsm.transition(task, "failed");
      this.events.emit({ type: "task:failed", taskId: task.id, error });
    } finally {
      const current = this.runningCount.get(agentId) ?? 1;
      this.runningCount.set(agentId, Math.max(0, current - 1));
      this.events.emit({ type: "agent:idle", agentId });

      // Lancer la prochaine tâche en queue pour cet agent
      this.processQueue(agentId);
    }
  }

  private canRunImmediately(agentId: string, agent: AgentPlugin): boolean {
    const running = this.runningCount.get(agentId) ?? 0;
    return running < agent.metadata.maxConcurrency;
  }

  private enqueue(task: Task): void {
    // Insertion triée par priorité (critical > high > medium > low)
    const priorityOrder: Record<AgentPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const taskPrio = priorityOrder[task.priority];
    const insertIdx = this.taskQueue.findIndex(
      (t) => priorityOrder[t.priority] > taskPrio
    );
    if (insertIdx === -1) {
      this.taskQueue.push(task);
    } else {
      this.taskQueue.splice(insertIdx, 0, task);
    }
  }

  private processQueue(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    if (!this.canRunImmediately(agentId, agent)) return;

    // Trouver la prochaine tâche pour cet agent
    const idx = this.taskQueue.findIndex((t) => t.agentId === agentId);
    if (idx === -1) return;

    const task = this.taskQueue.splice(idx, 1)[0];
    this.executeTask(task, agent).catch(() => {});
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout après ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
