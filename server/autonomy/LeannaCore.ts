import { randomUUID } from "crypto";
import type { AgentRuntime, EventBus } from "../runtime/index.js";
import type { RuntimeEvent } from "../runtime/types.js";
import { HeartbeatService, heartbeatConfigFromEnv } from "./HeartbeatService.js";
import { PerceptionEngine } from "./PerceptionEngine.js";
import { AutonomousExecutive, autonomousExecutiveConfigFromEnv, type AutonomousExecutiveOptions } from "./AutonomousExecutive.js";
import {
  TaskManager,
  taskManagerConfigFromEnv,
  type AutonomousTask,
  type AutonomousTaskStatus,
  type TaskPersistence,
} from "./TaskManager.js";

export type LeannaRuntimeStatus =
  | "starting"
  | "watching"
  | "idle"
  | "sleeping"
  | "executing"
  | "stopping"
  | "error";

export interface LeannaRuntimeState {
  status: LeannaRuntimeStatus;
  activeTasks: number;
  pendingEvents: number;
  lastWakeAt?: number;
  lastReflectionAt?: number;
  health: "healthy" | "degraded";
  recentFailures: string[];
}

/**
 * Durable store used for checkpoint / resume of autonomy tasks. Optional: when
 * absent, the runtime behaves exactly as before (in-memory only). All methods
 * are best-effort and must swallow their own errors.
 */
export interface AutonomyTaskStore extends TaskPersistence {
  loadPendingTasks(): Promise<AutonomousTask[]>;
}

/** Autonomy event types forwarded to the real-time timeline. */
export type AutonomyEventType =
  | "autonomy:heartbeat"
  | "autonomy:stateChanged"
  | "autonomy:health"
  | "autonomy:taskCreated"
  | "autonomy:taskStateChanged";

/**
 * Envelope pushed to WebSocket clients for the autonomy timeline. It mirrors the
 * shape used by the existing agent/mission broadcasters (typed message + ISO
 * timestamp) so a single client can consume all real-time channels uniformly.
 */
export interface AutonomyBroadcastMessage {
  type: "autonomy_event";
  event: AutonomyEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

/** Consumer of autonomy events, typically a WebSocket fan-out. Best-effort. */
export type AutonomyBroadcaster = (message: AutonomyBroadcastMessage) => void;

export interface LeannaCoreOptions {
  onTask?: (task: AutonomousTask) => Promise<void>;
  /** Optional closed-loop bridge into the existing mission executor. */
  executive?: Omit<AutonomousExecutiveOptions, "onEvent">;
  /** Optional durable task store enabling crash recovery of autonomy tasks. */
  persistence?: AutonomyTaskStore;
  /** Optional real-time broadcaster for the autonomy timeline (e.g. WebSocket). */
  broadcaster?: AutonomyBroadcaster;
}

const MAX_RECENT_FAILURES = 20;

/**
 * Event-driven autonomy coordinator. It reuses the Runtime EventBus and keeps
 * all tool/mission execution behind existing permission, dry-run and approval
 * policies. Neither perception nor heartbeat invokes an LLM.
 */
export class LeannaCore {
  private readonly perception = new PerceptionEngine();
  private readonly taskManager: TaskManager;
  private readonly heartbeat: HeartbeatService;
  private readonly executive?: AutonomousExecutive;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly persistence?: AutonomyTaskStore;
  private broadcaster?: AutonomyBroadcaster;
  private started = false;
  private state: LeannaRuntimeState = {
    status: "starting",
    activeTasks: 0,
    pendingEvents: 0,
    health: "healthy",
    recentFailures: [],
  };

  constructor(private readonly runtime: AgentRuntime, options: LeannaCoreOptions = {}) {
    this.persistence = options.persistence;
    this.broadcaster = options.broadcaster;
    this.taskManager = new TaskManager(
      async (task) => {
        this.setStatus("executing", `Executing ${task.type} task.`);
        if (this.executive) await this.executive.execute(task);
        await options.onTask?.(task);
      },
      taskManagerConfigFromEnv(),
      (task, previous) => this.handleTaskStateChange(task, previous),
      this.persistence,
    );
    this.heartbeat = new HeartbeatService(
      runtime.events,
      () => this.healthCheck(),
      heartbeatConfigFromEnv(),
    );
    if (options.executive) {
      this.executive = new AutonomousExecutive(runtime, {
        ...autonomousExecutiveConfigFromEnv(),
        ...options.executive,
        onEvent: (event) => this.broadcastExecutive(event),
      });
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.setStatus("watching", "Autonomy runtime started.");
    this.unsubscribers.push(this.events.onAny((event) => this.handleEvent(event)));
    this.unsubscribers.push(this.events.on("autonomy:heartbeat", (event) => this.handleHeartbeat(event.state)));
    this.subscribeTimeline();
    this.heartbeat.start();
    void this.resumePersistedTasks();
  }

  /**
   * Attach or replace the real-time broadcaster after construction, mirroring the
   * `setEventBroadcaster` pattern of the agent/mission systems. Safe to call
   * before or after `start()`.
   */
  setBroadcaster(broadcaster: AutonomyBroadcaster | undefined): void {
    this.broadcaster = broadcaster;
  }

  /** Forward every autonomy:* event to the timeline broadcaster (best-effort). */
  private subscribeTimeline(): void {
    const events: AutonomyEventType[] = [
      "autonomy:heartbeat",
      "autonomy:stateChanged",
      "autonomy:health",
      "autonomy:taskCreated",
      "autonomy:taskStateChanged",
    ];
    for (const event of events) {
      this.unsubscribers.push(this.events.on(event, (e) => this.broadcast(e as RuntimeEvent)));
    }
  }

  private broadcast(event: RuntimeEvent): void {
    if (!this.broadcaster) return;
    const { type, ...payload } = event;
    try {
      this.broadcaster({
        type: "autonomy_event",
        event: type as AutonomyEventType,
        timestamp: new Date().toISOString(),
        payload: payload as Record<string, unknown>,
      });
    } catch {
      /* broadcasting is best-effort and must never affect the runtime */
    }
  }

  /**
   * Checkpoint / resume: reload unfinished tasks from the durable store (if any)
   * and hand them back to the TaskManager, which re-applies every existing bound
   * (dedupe, retries, timeout, circuit breaker). Best-effort — a store outage
   * never blocks startup.
   */
  private async resumePersistedTasks(): Promise<void> {
    if (!this.persistence) return;
    try {
      const pending = await this.persistence.loadPendingTasks();
      if (pending.length === 0) return;
      const restored = this.taskManager.restore(pending);
      if (restored > 0) {
        this.state.lastWakeAt = Date.now();
        this.heartbeat.wake("autonomy:resume");
        this.setStatus("watching", `Resumed ${restored} persisted autonomy task(s).`);
      }
    } catch {
      /* recovery is best-effort; the store logs its own errors */
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.setStatus("stopping", "Graceful shutdown requested.");
    this.heartbeat.stop();
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    await this.taskManager.stop();
    this.started = false;
  }

  getState(): Readonly<LeannaRuntimeState> {
    return {
      ...this.state,
      activeTasks: this.taskManager.list().filter((task) => task.status === "running").length,
      recentFailures: [...this.state.recentFailures],
    };
  }

  getTasks(): AutonomousTask[] {
    return this.taskManager.list();
  }

  private get events(): EventBus {
    return this.runtime.events;
  }

  private handleEvent(event: RuntimeEvent): void {
    if (event.type.startsWith("autonomy:" as never)) return;

    this.state.pendingEvents++;
    this.state.lastWakeAt = Date.now();
    this.heartbeat.wake(event.type);
    const perception = this.perception.perceive(event);
    this.state.pendingEvents--;

    if (!perception.requiresAttention || perception.possibleActions.length === 0) return;

    const type = perception.possibleActions.includes("maintenance") ? "maintenance" : "reactive";
    const task = this.taskManager.submit({
      type,
      title: `Autonomy: ${perception.reason}`,
      priority: perception.importance >= 0.8 ? "high" : "medium",
      sourceEventId: this.eventId(event),
      fingerprint: `${event.type}:${perception.affectedResources.sort().join(",")}`,
      // Keeping the typed source event makes the queued item a resumable
      // perception-to-decision unit rather than an opaque maintenance tick.
      metadata: { reason: perception.reason, resources: perception.affectedResources, event },
    });

    if (task) {
      this.events.emit({
        type: "autonomy:taskCreated",
        taskId: task.id,
        taskType: task.type,
        sourceEventId: task.sourceEventId,
      });
    }
  }

  private broadcastExecutive(event: { type: string; traceId: string; cycleId: string; timestamp: number; [key: string]: unknown }): void {
    if (!this.broadcaster) return;
    try {
      this.broadcaster({ type: "autonomy_event", event: event.type as AutonomyEventType, timestamp: new Date(event.timestamp).toISOString(), payload: event });
    } catch { /* observability is best-effort */ }
  }

  private handleTaskStateChange(task: AutonomousTask, previous: AutonomousTaskStatus): void {
    this.events.emit({
      type: "autonomy:taskStateChanged",
      taskId: task.id,
      taskType: task.type,
      from: previous,
      to: task.status,
      error: task.error,
    });

    if (task.status === "dead_letter") {
      this.state.recentFailures = [task.error ?? task.title, ...this.state.recentFailures].slice(0, MAX_RECENT_FAILURES);
      this.state.health = "degraded";
      this.setStatus("error", `Task ${task.id} reached the dead-letter queue.`);
    } else if (task.status === "completed" && this.started) {
      this.setStatus("watching", "Autonomy task completed.");
    }
  }

  private handleHeartbeat(state: "active" | "idle" | "sleep"): void {
    if (!this.started || this.getState().activeTasks > 0) return;
    this.setStatus(state === "active" ? "watching" : state === "idle" ? "idle" : "sleeping", `Heartbeat entered ${state}.`);
  }

  private healthCheck(): { attentionRequired: boolean; reason: string } {
    const stats = this.runtime.getStats();
    const degraded = !this.runtime.isRunning || stats.tasks.failed > 0 || this.state.recentFailures.length > 0;
    this.state.health = degraded ? "degraded" : "healthy";
    const reason = degraded ? "Runtime has failed tasks or is stopped." : "Runtime healthy.";
    this.events.emit({ type: "autonomy:health", status: this.state.health, reason });
    return { attentionRequired: degraded, reason };
  }

  private setStatus(to: LeannaRuntimeStatus, reason: string): void {
    const from = this.state.status;
    if (from === to) return;
    this.state.status = to;
    this.events.emit({ type: "autonomy:stateChanged", from, to, reason });
  }

  private eventId(event: RuntimeEvent): string {
    if ("taskId" in event) return event.taskId;
    if ("workflowId" in event) return event.workflowId;
    if ("toolName" in event) return `${event.type}:${event.toolName}`;
    return randomUUID();
  }
}
