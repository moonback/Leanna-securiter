import { randomUUID } from "crypto";
import type { AgentPriority } from "../runtime/types.js";

export type AutonomousTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "dead_letter"
  | "cancelled";

export interface AutonomousTask {
  id: string;
  type: "maintenance" | "reactive" | "mission" | "reflection";
  title: string;
  priority: AgentPriority;
  sourceEventId: string;
  fingerprint: string;
  createdAt: number;
  status: AutonomousTaskStatus;
  attempts: number;
  maxRetries: number;
  timeoutMs: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface TaskManagerConfig {
  maxConcurrency: number;
  maxQueueSize: number;
  dedupeTtlMs: number;
  retryDelayMs: number;
  maxRetries: number;
  timeoutMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
}

export type TaskStateListener = (task: AutonomousTask, previous: AutonomousTaskStatus) => void;

/**
 * Optional durable store for autonomy tasks. Every method is best-effort and
 * must never throw into the TaskManager: implementations should swallow and log
 * their own errors so persistence outages cannot stall the in-memory queue.
 */
export interface TaskPersistence {
  saveTask(task: AutonomousTask): Promise<void> | void;
  updateTask(task: AutonomousTask): Promise<void> | void;
}

export const taskManagerConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): TaskManagerConfig => {
  const positive = (key: string, fallback: number): number => {
    const value = Number(env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  return {
    maxConcurrency: positive("LEANNA_AUTONOMY_MAX_CONCURRENCY", 2),
    maxQueueSize: positive("LEANNA_AUTONOMY_MAX_QUEUE_SIZE", 100),
    dedupeTtlMs: positive("LEANNA_AUTONOMY_DEDUPE_TTL_MS", 300_000),
    retryDelayMs: positive("LEANNA_AUTONOMY_RETRY_DELAY_MS", 1_000),
    maxRetries: positive("LEANNA_AUTONOMY_MAX_RETRIES", 3),
    timeoutMs: positive("LEANNA_AUTONOMY_TASK_TIMEOUT_MS", 60_000),
    circuitBreakerThreshold: positive("LEANNA_AUTONOMY_CIRCUIT_BREAKER_THRESHOLD", 5),
    circuitBreakerCooldownMs: positive("LEANNA_AUTONOMY_CIRCUIT_BREAKER_COOLDOWN_MS", 300_000),
  };
};

/** Bounded queue for autonomy-originated work. It intentionally does not replace AgentRuntime's agent queue. */
export class TaskManager {
  private readonly tasks = new Map<string, AutonomousTask>();
  private readonly queue: string[] = [];
  private readonly dedupe = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; openedAt?: number }>();
  private readonly retryTimers = new Set<NodeJS.Timeout>();
  private running = 0;
  private accepting = true;

  constructor(
    private readonly execute: (task: AutonomousTask) => Promise<void>,
    private readonly config = taskManagerConfigFromEnv(),
    private readonly onStateChanged?: TaskStateListener,
    private readonly persistence?: TaskPersistence,
  ) {}

  submit(input: Omit<AutonomousTask, "id" | "createdAt" | "status" | "attempts" | "maxRetries" | "timeoutMs">): AutonomousTask | undefined {
    this.pruneDedupe();
    if (!this.accepting || this.queue.length >= this.config.maxQueueSize || this.dedupe.has(input.fingerprint) || this.isCircuitOpen(input.type)) return undefined;

    const task: AutonomousTask = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now(),
      status: "pending",
      attempts: 0,
      maxRetries: this.config.maxRetries,
      timeoutMs: this.config.timeoutMs,
    };

    this.tasks.set(task.id, task);
    this.dedupe.set(task.fingerprint, Date.now() + this.config.dedupeTtlMs);
    this.queue.push(task.id);
    void this.persist(task, "save");
    this.pump();
    return task;
  }

  /**
   * Rehydrate unfinished tasks after a restart (checkpoint / resume). Tasks are
   * re-queued as `pending` and revalidated against the current dedupe window and
   * circuit state, so recovery still respects every existing bound. Returns the
   * number of tasks actually re-enqueued.
   */
  restore(tasks: AutonomousTask[]): number {
    let restored = 0;
    for (const source of tasks) {
      if (!this.accepting || this.queue.length >= this.config.maxQueueSize) break;
      if (this.tasks.has(source.id) || this.dedupe.has(source.fingerprint) || this.isCircuitOpen(source.type)) continue;

      const task: AutonomousTask = { ...source, status: "pending", error: undefined };
      this.tasks.set(task.id, task);
      this.dedupe.set(task.fingerprint, Date.now() + this.config.dedupeTtlMs);
      this.queue.push(task.id);
      void this.persist(task, "update");
      restored++;
    }
    if (restored > 0) this.pump();
    return restored;
  }

  list(): AutonomousTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async stop(): Promise<void> {
    this.accepting = false;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    for (const id of this.queue.splice(0)) {
      const task = this.tasks.get(id);
      if (task) this.transition(task, "cancelled");
    }
  }

  private pump(): void {
    while (this.accepting && this.running < this.config.maxConcurrency && this.queue.length > 0) {
      this.queue.sort((first, second) => this.compare(this.tasks.get(first)!, this.tasks.get(second)!));
      const taskId = this.queue.shift()!;
      const task = this.tasks.get(taskId)!;
      void this.run(task);
    }
  }

  private compare(first: AutonomousTask, second: AutonomousTask): number {
    const ageBoost = (task: AutonomousTask) => Math.min(2, Math.floor((Date.now() - task.createdAt) / 60_000));
    return priority(second.priority) + ageBoost(second) - priority(first.priority) - ageBoost(first)
      || first.createdAt - second.createdAt;
  }

  private async run(task: AutonomousTask): Promise<void> {
    this.running++;
    task.attempts++;
    this.transition(task, "running");

    try {
      await withTimeout(this.execute(task), task.timeoutMs);
      this.transition(task, "completed");
      this.failures.delete(task.type);
    } catch (error) {
      task.error = error instanceof Error ? error.message : String(error);
      const failure = this.failures.get(task.type) ?? { count: 0 };
      failure.count++;
      if (failure.count >= this.config.circuitBreakerThreshold) failure.openedAt = Date.now();
      this.failures.set(task.type, failure);

      if (task.attempts < task.maxRetries && !this.isCircuitOpen(task.type) && this.accepting) {
        this.transition(task, "pending");
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          if (this.accepting) {
            this.queue.push(task.id);
            this.pump();
          }
        }, this.config.retryDelayMs * 2 ** (task.attempts - 1));
        this.retryTimers.add(timer);
      } else {
        this.transition(task, "dead_letter");
      }
    } finally {
      this.running--;
      this.pump();
    }
  }

  private transition(task: AutonomousTask, next: AutonomousTaskStatus): void {
    const previous = task.status;
    task.status = next;
    void this.persist(task, "update");
    this.onStateChanged?.(task, previous);
  }

  /** Best-effort persistence; failures are swallowed by the store, never here. */
  private async persist(task: AutonomousTask, op: "save" | "update"): Promise<void> {
    if (!this.persistence) return;
    try {
      await (op === "save" ? this.persistence.saveTask(task) : this.persistence.updateTask(task));
    } catch {
      /* persistence is best-effort and must not affect the in-memory queue */
    }
  }

  private pruneDedupe(): void {
    const now = Date.now();
    for (const [fingerprint, expiresAt] of this.dedupe) {
      if (expiresAt <= now) this.dedupe.delete(fingerprint);
    }
  }

  private isCircuitOpen(type: string): boolean {
    const failure = this.failures.get(type);
    if (!failure?.openedAt) return false;
    if (Date.now() - failure.openedAt >= this.config.circuitBreakerCooldownMs) {
      this.failures.delete(type);
      return false;
    }
    return true;
  }
}

const priority = (value: AgentPriority): number => ({ low: 0, medium: 1, high: 2, critical: 3 })[value];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Autonomy task timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
