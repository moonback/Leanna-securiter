/**
 * AutonomousAgent — Base class pour les agents IA autonomes
 *
 * Un agent autonome est capable de :
 * 1. Recevoir des tâches (via l'orchestrateur ou d'autres agents)
 * 2. Décider AUTONOMEMENT de déléguer des sous-tâches à d'autres agents
 * 3. Communiquer avec les autres agents via le bus de messages
 * 4. Répondre aux requêtes de status et de collaboration
 * 5. Gérer sa propre file de tâches interne
 *
 * Architecture :
 *   AgentOrchestrator
 *     ↓ delegateTask()
 *   AutonomousAgent (instance par rôle)
 *     ↓ execute() — boucle autonome
 *       ├── execute task (via AgentExecutor)
 *       └── delegate sub-tasks (via AgentMessageBus)
 *             ↓
 *           Other AutonomousAgents (parallel)
 */
import { randomUUID } from "crypto";
import type { AgentRole, AgentTask, TaskResult, TaskPriority } from "./types.js";
import type {
  AgentMessage,
  TaskRequestPayload,
  CollaborationRequestPayload,
  StatusResponsePayload,
} from "./AgentCommunication.js";
import { isDelegationAllowed } from "./AgentCommunication.js";
import { AgentMessageBus } from "./AgentMessageBus.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";
import { AutonomousLoop, type LoopConfig } from "./AutonomousLoop.js";
import { getAgentDefinitionOrThrow } from "./roles.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AutonomousAgent");

// ─── Types internes ───────────────────────────────────────────────────────────

interface TaskQueueItem {
  task: AgentTask;
  resolve: (result: TaskResult) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

interface DelegatedSubTask {
  taskId: string;
  targetRole: AgentRole;
  title: string;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  result?: TaskResult;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AutonomousAgent
// ═══════════════════════════════════════════════════════════════════════════════

export class AutonomousAgent {
  private readonly role: AgentRole;
  private readonly bus: AgentMessageBus;
  private readonly executor: AgentTaskRunner;
  private readonly loop: AutonomousLoop;

  // État interne
  private taskQueue: TaskQueueItem[] = [];
  private runningTasks: Map<string, AgentTask> = new Map();
  private delegatedSubTasks: DelegatedSubTask[] = [];
  private subscriptionId: string | null = null;
  private broadcastSubId: string | null = null;
  private isOnline = false;

  constructor(role: AgentRole, executor: AgentTaskRunner, bus: AgentMessageBus, loopConfig?: Partial<LoopConfig>) {
    this.role = role;
    this.executor = executor;
    this.bus = bus;
    // La boucle autonome utilise la config par défaut, surchargeable par rôle
    this.loop = new AutonomousLoop(executor, {
      maxIterations: 3,
      globalTimeoutMs: getAgentDefinitionOrThrow(role).defaultTimeoutMs * 3,
      minConfidenceScore: 0.6,
      verifyFiles: true,
      ...loopConfig,
    });
  }

  // ─── Cycle de vie ──────────────────────────────────────────────────────────

  /**
   * Démarre l'agent : s'abonne aux messages et se met en ligne.
   */
  start(): void {
    if (this.isOnline) return;

    // Abonnement aux messages directs
    this.subscriptionId = this.bus.subscribe(this.role, "*", (msg) =>
      this.handleMessage(msg)
    );

    // Abonnement aux broadcasts
    this.broadcastSubId = this.bus.subscribe(this.role, "broadcast", (msg) =>
      this.handleBroadcast(msg)
    );

    this.isOnline = true;
    log.info(`🤖 Agent "${this.agentName}" en ligne`);

    // Annoncer la disponibilité
    this.bus
      .broadcast(this.role, "agent_online", { role: this.role, name: this.agentName })
      .catch(() => {});
  }

  /**
   * Arrête l'agent proprement.
   */
  stop(): void {
    if (!this.isOnline) return;

    if (this.subscriptionId) this.bus.unsubscribe(this.subscriptionId);
    if (this.broadcastSubId) this.bus.unsubscribe(this.broadcastSubId);

    this.isOnline = false;
    log.info(`🔴 Agent "${this.agentName}" hors ligne`);
  }

  // ─── Exécution de tâche ────────────────────────────────────────────────────

  /**
   * Soumet une tâche à cet agent.
   * Retourne le résultat quand la tâche est terminée.
   */
  async submitTask(task: AgentTask): Promise<TaskResult> {
    return new Promise<TaskResult>((resolve, reject) => {
      this.taskQueue.push({
        task,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });

      log.debug(
        `📥 [${this.agentName}] Tâche "${task.title}" en queue (queue: ${this.taskQueue.length})`
      );

      // Lancer le traitement immédiatement (sans bloquer)
      this.processNextTask().catch((err) =>
        log.error(`[${this.agentName}] Erreur processNextTask: ${err.message}`)
      );
    });
  }

  /**
   * Délègue une sous-tâche à un autre agent de manière autonome.
   * Vérifie la matrice de délégation avant d'envoyer le message.
   */
  async delegateTo(
    targetRole: AgentRole,
    title: string,
    description: string,
    files: string[] = [],
    instructions?: string,
    priority: TaskPriority = "medium"
  ): Promise<TaskResult | null> {
    // Vérifier la matrice de délégation (inclut support des agents personnalisés)
    if (!isDelegationAllowed(this.role, targetRole)) {
      log.warn(
        `⚠️ [${this.agentName}] Délégation refusée vers "${targetRole}" — non autorisée dans la matrice`
      );
      return null;
    }

    const taskId = randomUUID();
    const subTask: DelegatedSubTask = {
      taskId,
      targetRole,
      title,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.delegatedSubTasks.push(subTask);

    log.info(`🔀 [${this.agentName}] Délégation → [${targetRole}]: "${title}"`);

    try {
      const request: AgentMessage = {
        id: randomUUID(),
        type: "task_request",
        from: this.role,
        to: targetRole,
        priority,
        timestamp: new Date().toISOString(),
        payload: {
          type: "task_request",
          taskId,
          title,
          description,
          files,
          instructions,
        } as TaskRequestPayload,
        metadata: { delegatedBy: this.role, delegationReason: title },
      };

      // Attendre la réponse avec un timeout adapté au rôle cible
      const targetDef = getAgentDefinitionOrThrow(targetRole);
      const response = await this.bus.request(request, targetDef.defaultTimeoutMs + 5_000);
      const result = (response.payload as { result: TaskResult }).result;

      subTask.status = result.success ? "completed" : "failed";
      subTask.result = result;

      log.info(
        `✅ [${this.agentName}] Délégation "${title}" → [${targetRole}] ${result.success ? "réussie" : "échouée"}`
      );
      return result;
    } catch (err) {
      subTask.status = "failed";
      log.error(
        `❌ [${this.agentName}] Délégation "${title}" → [${targetRole}] erreur: ${(err as Error).message}`
      );
      return null;
    }
  }

  /**
   * Demande une collaboration à un autre agent pour une tâche complexe.
   */
  async requestCollaboration(
    targetRole: AgentRole,
    currentWork: string,
    blockedBy: string,
    requiredExpertise: string
  ): Promise<void> {
    const message: AgentMessage = {
      id: randomUUID(),
      type: "collaboration_request",
      from: this.role,
      to: targetRole,
      priority: "high",
      timestamp: new Date().toISOString(),
      payload: {
        type: "collaboration_request",
        taskId: randomUUID(),
        reason: `[${this.agentName}] a besoin d'aide`,
        context: { currentWork, blockedBy, requiredExpertise },
      } as CollaborationRequestPayload,
    };

    log.info(
      `🤝 [${this.agentName}] Demande de collaboration → [${targetRole}]: "${blockedBy}"`
    );
    await this.bus.publish(message);
  }

  // ─── Gestion des messages entrants ────────────────────────────────────────

  private async handleMessage(message: AgentMessage): Promise<void> {
    log.debug(
      `📨 [${this.agentName}] Message reçu de [${message.from}] type="${message.type}"`
    );

    switch (message.type) {
      case "task_request":
        await this.handleTaskRequest(message);
        break;
      case "status_query":
        await this.handleStatusQuery(message);
        break;
      case "collaboration_request":
        await this.handleCollaborationRequest(message);
        break;
      default:
        log.debug(`[${this.agentName}] Message type "${message.type}" ignoré`);
    }
  }

  private async handleBroadcast(message: AgentMessage): Promise<void> {
    const payload = message.payload as { message: string; data?: Record<string, unknown> };
    log.debug(`📢 [${this.agentName}] Broadcast: "${payload.message}" de [${message.from}]`);
    // Les agents peuvent réagir aux broadcasts ici (ex: mise à jour de contexte)
  }

  /** Traite une task_request reçue d'un autre agent */
  private async handleTaskRequest(message: AgentMessage): Promise<void> {
    const payload = message.payload as TaskRequestPayload;
    const isAutonomous = (message.metadata?.autonomous === true);

    log.info(
      `📋 [${this.agentName}] Reçu task_request de [${message.from}]: "${payload.title}"${isAutonomous ? " [mode autonome]" : ""}`
    );

    const agentDef = getAgentDefinitionOrThrow(this.role);

    const task: AgentTask = {
      id: payload.taskId,
      role: this.role,
      title: payload.title,
      description: payload.description,
      priority: message.priority as TaskPriority,
      status: "pending",
      context: {
        files: payload.files ?? [],
        instructions: payload.instructions,
        metadata: {
          delegatedBy: message.from,
          autonomous: isAutonomous,
          ...((payload.context as Record<string, unknown>) ?? {}),
        },
      },
      createdAt: new Date().toISOString(),
      timeoutMs: agentDef.defaultTimeoutMs,
    };

    try {
      let finalResult: TaskResult;

      if (isAutonomous) {
        // Mode autonome : boucle Observe → Decide → Act
        log.info(`🔄 [${this.agentName}] Lancement de la boucle autonome pour "${payload.title}"`);
        const loopResult = await this.loop.run(task);

        finalResult = loopResult.finalTask.result ?? {
          success: false,
          outcome: "failed" as const,
          summary: "Pas de résultat après boucle autonome",
          durationMs: loopResult.totalDurationMs,
        };

        // Enrichir le résultat avec les métadonnées de la boucle
        finalResult = {
          ...finalResult,
          details: [
            finalResult.details ?? "",
            `\n\n---\n**Boucle autonome** : ${loopResult.totalIterations} itération(s)`,
            `Décision finale : ${loopResult.finalDecision}`,
            `Durée totale : ${(loopResult.totalDurationMs / 1000).toFixed(1)}s`,
          ].join("\n"),
        };

        log.info(
          `✅ [${this.agentName}] Boucle autonome terminée — ${loopResult.totalIterations} itération(s), décision: ${loopResult.finalDecision}`
        );
      } else {
        // Mode simple : exécution directe sans boucle
        await this.executor.execute(task);
        finalResult = task.result ?? {
          success: false,
          outcome: "failed" as const,
          summary: "Pas de résultat",
          durationMs: 0,
        };
      }

      // Répondre avec le résultat
      await this.bus.respond(message, this.role, {
        type: "task_response",
        taskId: task.id,
        result: finalResult,
      });
    } catch (err) {
      await this.bus.respond(message, this.role, {
        type: "task_response",
        taskId: task.id,
        result: {
          success: false,
          outcome: "failed" as const,
          summary: `Erreur: ${(err as Error).message}`,
          error: (err as Error).message,
          durationMs: 0,
        },
      });
    }
  }

  /** Répond à une query de statut */
  private async handleStatusQuery(message: AgentMessage): Promise<void> {
    const agentDef = getAgentDefinitionOrThrow(this.role);
    const running = this.runningTasks.size;
    const queued = this.taskQueue.length;

    const statusPayload: StatusResponsePayload = {
      type: "status_response",
      status:
        running >= agentDef.maxConcurrency
          ? "overloaded"
          : queued > 0 || running > 0
          ? "busy"
          : "idle",
      currentTasks: running,
      maxConcurrency: agentDef.maxConcurrency,
      queueLength: queued,
    };

    await this.bus.respond(message, this.role, statusPayload);
  }

  /** Traite une demande de collaboration */
  private async handleCollaborationRequest(message: AgentMessage): Promise<void> {
    const payload = message.payload as CollaborationRequestPayload;
    log.info(
      `🤝 [${this.agentName}] Demande de collaboration de [${message.from}]: "${payload.reason}"`
    );
    // TODO: implémenter la logique de collaboration proactive
    // Pour l'instant : log + broadcast de l'acceptation
    await this.bus.broadcast(this.role, "collaboration_accepted", {
      from: this.role,
      to: message.from,
      reason: payload.reason,
    });
  }

  // ─── Queue interne ─────────────────────────────────────────────────────────

  private async processNextTask(): Promise<void> {
    const agentDef = getAgentDefinitionOrThrow(this.role);

    if (
      this.taskQueue.length === 0 ||
      this.runningTasks.size >= agentDef.maxConcurrency
    ) {
      return;
    }

    const item = this.taskQueue.shift()!;
    this.runningTasks.set(item.task.id, item.task);

    try {
      await this.executor.execute(item.task);
      this.runningTasks.delete(item.task.id);

      if (item.task.result) {
        item.resolve(item.task.result);
      } else {
        item.reject(new Error("Aucun résultat de tâche"));
      }
    } catch (err) {
      this.runningTasks.delete(item.task.id);
      item.reject(err as Error);
    } finally {
      // Traiter la prochaine tâche en queue
      if (this.taskQueue.length > 0) {
        this.processNextTask().catch(() => {});
      }
    }
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  get agentName(): string {
    return getAgentDefinitionOrThrow(this.role).name;
  }

  get isAvailable(): boolean {
    const agentDef = getAgentDefinitionOrThrow(this.role);
    return (
      this.isOnline &&
      this.runningTasks.size < agentDef.maxConcurrency
    );
  }

  get status(): "idle" | "busy" | "overloaded" | "offline" {
    if (!this.isOnline) return "offline";
    const agentDef = getAgentDefinitionOrThrow(this.role);
    if (this.runningTasks.size >= agentDef.maxConcurrency) return "overloaded";
    if (this.runningTasks.size > 0 || this.taskQueue.length > 0) return "busy";
    return "idle";
  }

  getStats() {
    return {
      role: this.role,
      name: this.agentName,
      status: this.status,
      isOnline: this.isOnline,
      runningTasks: this.runningTasks.size,
      queuedTasks: this.taskQueue.length,
      delegatedSubTasks: this.delegatedSubTasks.length,
      delegationSuccess: this.delegatedSubTasks.filter((d) => d.status === "completed").length,
    };
  }
}
