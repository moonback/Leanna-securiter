import { randomUUID } from "crypto";
import type { AgentPriority, AgentRuntime, RuntimeEvent } from "../runtime/index.js";
import type { AutonomousTask } from "./TaskManager.js";
import { PerceptionEngine, type Perception } from "./PerceptionEngine.js";

/** The action selected by the deterministic autonomy policy. */
export type ObservationDisposition = "IGNORE" | "STORE" | "MONITOR" | "INVESTIGATE" | "ACT" | "ESCALATE";
export type AutonomousGoalSource = "USER" | "SYSTEM" | "MISSION" | "EVENT" | "SCHEDULE" | "AGENT" | "LEARNED";
export type AutonomousGoalStatus = "PENDING" | "ACTIVE" | "BLOCKED" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED" | "ESCALATED";

export interface AutonomousGoal {
  id: string;
  parentGoalId?: string;
  description: string;
  source: AutonomousGoalSource;
  priority: AgentPriority;
  status: AutonomousGoalStatus;
  constraints: string[];
  deadline?: number;
  budget?: { maxCostUsd?: number; maxTokens?: number };
  riskLevel: "low" | "medium" | "high" | "critical";
  successCriteria: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PriorityFactors {
  urgency?: number; importance?: number; risk?: number; dependency?: number; userIntent?: number;
  deadline?: number; cost?: number; confidence?: number; impact?: number; missionPriority?: number;
}

/** Runtime-owned arbitration; model output must be converted to these bounded inputs. */
export class PriorityEngine {
  score(factors: PriorityFactors): number {
    const clamp = (value = 0) => Math.max(0, Math.min(1, value));
    return Math.round(100 * (
      clamp(factors.urgency) * .18 + clamp(factors.importance) * .18 + clamp(factors.risk) * .14 +
      clamp(factors.dependency) * .08 + clamp(factors.userIntent) * .12 + clamp(factors.deadline) * .1 +
      (1 - clamp(factors.cost)) * .04 + clamp(factors.confidence) * .05 + clamp(factors.impact) * .07 +
      clamp(factors.missionPriority) * .04
    ));
  }

  toPriority(score: number): AgentPriority {
    return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  }
}

/** In-memory, deduplicating goal index. Persistence remains the existing Memory/Mission stores. */
export class GoalManager {
  private readonly goals = new Map<string, AutonomousGoal>();

  createOrUpdate(input: Omit<AutonomousGoal, "id" | "createdAt" | "updatedAt" | "status">): { goal: AutonomousGoal; created: boolean } {
    const normalized = input.description.trim().toLowerCase().replace(/\s+/g, " ");
    const existing = [...this.goals.values()].find((goal) =>
      goal.status !== "COMPLETED" && goal.status !== "CANCELLED" && goal.description.toLowerCase().replace(/\s+/g, " ") === normalized,
    );
    if (existing) {
      existing.priority = input.priority;
      existing.riskLevel = input.riskLevel;
      existing.updatedAt = Date.now();
      return { goal: existing, created: false };
    }
    const now = Date.now();
    const goal: AutonomousGoal = { ...input, id: randomUUID(), status: "PENDING", createdAt: now, updatedAt: now };
    this.goals.set(goal.id, goal);
    return { goal, created: true };
  }

  list(): AutonomousGoal[] { return [...this.goals.values()]; }
  get(id: string): AutonomousGoal | undefined { return this.goals.get(id); }
  transition(id: string, status: AutonomousGoalStatus): void {
    const goal = this.goals.get(id);
    if (goal) { goal.status = status; goal.updatedAt = Date.now(); }
  }
}

export interface AutonomousDecision {
  disposition: ObservationDisposition;
  reason: string;
  priority: AgentPriority;
  goal?: AutonomousGoal;
}

export interface AutonomousMissionRequest {
  cycleId: string;
  traceId: string;
  goal: AutonomousGoal;
  observation: Perception;
  task: AutonomousTask;
}

export interface AutonomousExecutiveOptions {
  /** The sole hand-off into planning/execution. Existing Mission/Brain systems own this callback. */
  executeMission?: (request: AutonomousMissionRequest) => Promise<{ success: boolean; summary?: string; escalate?: boolean }>;
  /** @deprecated Use maxConcurrentCycles; retained for configuration compatibility. */
  maxCycles?: number;
  /** Maximum executive cycles in flight; excess work remains in TaskManager's bounded queue. */
  maxConcurrentCycles?: number;
  onEvent?: (event: AutonomousExecutiveEvent) => void;
}

/** Reads only positive integer limits; malformed environment values fail closed to the safe default. */
export const autonomousExecutiveConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Pick<AutonomousExecutiveOptions, "maxConcurrentCycles"> => {
  const parsed = Number(env.LEANNA_AUTONOMY_MAX_CONCURRENT_CYCLES);
  return { maxConcurrentCycles: Number.isInteger(parsed) && parsed > 0 ? parsed : 1 };
};

export interface AutonomousExecutiveEvent {
  type: string;
  traceId: string;
  cycleId: string;
  timestamp: number;
  status?: string;
  goalId?: string;
  taskId?: string;
  error?: string;
  // Index signature keeps the event structurally compatible with the generic
  // broadcaster payload in LeannaCore.broadcastExecutive (fixes GAP-4).
  [key: string]: unknown;
}

/**
 * Bounded perception → decision → mission bridge. It deliberately delegates
 * planning, tool authorization, dry-run, verification and reflection to the
 * already configured Mission/Brain/ToolRegistry pipeline instead of bypassing it.
 */
export class AutonomousExecutive {
  readonly goals = new GoalManager();
  readonly priorities = new PriorityEngine();
  private readonly perception = new PerceptionEngine();
  private activeCycles = 0;

  constructor(private readonly runtime: AgentRuntime, private readonly options: AutonomousExecutiveOptions = {}) {}

  /**
   * Stable fingerprint of an event *class*, not a specific resource. This mirrors
   * the goal-dedup philosophy (resource identifiers are intentionally excluded so
   * repeated instances of the same failure class share one goal/tally), which is
   * what lets decide() recognise a recurring-but-impossible objective.
   */
  private fingerprint(event: RuntimeEvent, _observation: Perception): string {
    return event.type;
  }

  /**
   * Memory-informed bias (GAP-2). Reads the outcome recorded by a previous cycle
   * for the same fingerprint. If that class of goal was already escalated or
   * blocked recently, we raise urgency (it needs attention) and, once it has
   * failed repeatedly, we escalate immediately instead of re-attempting an
   * impossible mission. Deterministic and bounded; never invokes an LLM.
   */
  private recallOutcome(fingerprint: string): { escalate: boolean; urgencyBonus: number } {
    try {
      const recalled = this.runtime.memory.get("project", `autonomy:fingerprint:${fingerprint}`) as
        | { failures?: number; lastDisposition?: string }
        | undefined;
      if (!recalled) return { escalate: false, urgencyBonus: 0 };
      const failures = Number(recalled.failures) || 0;
      // 3+ prior failures of the same class → stop retrying, escalate to a human.
      return { escalate: failures >= 3, urgencyBonus: Math.min(0.3, failures * 0.1) };
    } catch {
      return { escalate: false, urgencyBonus: 0 };
    }
  }

  decide(event: RuntimeEvent): AutonomousDecision {
    const observation = this.perception.perceive(event);
    if (!observation.requiresAttention) return { disposition: observation.importance < .1 ? "IGNORE" : "STORE", reason: observation.reason, priority: "low" };
    const memory = this.recallOutcome(this.fingerprint(event, observation));
    const score = this.priorities.score({ importance: observation.importance, urgency: Math.min(1, (observation.requiresAttention ? .7 : 0) + memory.urgencyBonus), risk: observation.importance, confidence: .8, impact: observation.importance });
    const priority = this.priorities.toPriority(score);
    const { goal } = this.goals.createOrUpdate({
      // Resource identifiers are intentionally excluded: repeated instances of
      // the same failure class are one goal until it is resolved/escalated.
      description: this.goalDescription(event, observation), source: "EVENT", priority, riskLevel: priority === "critical" ? "critical" : priority === "high" ? "high" : "medium",
      constraints: ["Use the existing ToolRegistry, PermissionPolicy, DryRunController and confirmation flow."],
      successCriteria: ["The triggering condition is verified, recovered, or escalated."],
    });
    if (event.type === "tool:permissionDenied") return { disposition: "ESCALATE", reason: observation.reason, priority, goal };
    // A goal class that already failed repeatedly is escalated rather than
    // re-attempted, preventing an infinite loop on an impossible objective.
    if (memory.escalate) return { disposition: "ESCALATE", reason: `${observation.reason} (échecs répétés du même type — escalade)`, priority, goal };
    return { disposition: observation.possibleActions.includes("maintenance") ? "ACT" : "INVESTIGATE", reason: observation.reason, priority, goal };
  }

  private goalDescription(event: RuntimeEvent, observation: Perception): string {
    switch (event.type) {
      case "task:failed": return "Recover or escalate repeated runtime task failures.";
      case "tool:permissionDenied": return `Resolve or escalate denied permission for tool ${event.toolName}.`;
      case "workflow:completed": return event.success ? "Record completed workflow." : "Recover or escalate failed workflow.";
      default: return observation.reason;
    }
  }

  async execute(task: AutonomousTask): Promise<void> {
    const event = task.metadata?.event as RuntimeEvent | undefined;
    if (!event) return; // Restored legacy tasks remain safe no-ops until a planner provides context.
    const limit = this.options.maxConcurrentCycles ?? this.options.maxCycles ?? 1;
    if (this.activeCycles >= limit) throw new Error("Autonomy concurrency budget exhausted; task will be retried by TaskManager.");
    this.activeCycles++;
    try {
      const cycleId = randomUUID(); const traceId = `autonomy:${cycleId}`;
      this.emit("autonomy.cycle.started", traceId, cycleId, { taskId: task.id });
      const decision = this.decide(event);
      this.emit("autonomy.decision.made", traceId, cycleId, { taskId: task.id, goalId: decision.goal?.id, status: decision.disposition });
      if (decision.disposition === "IGNORE" || decision.disposition === "STORE" || decision.disposition === "MONITOR") {
        await this.runtime.memory.set("session", `autonomy:observation:${task.id}`, { event, decision, observedAt: Date.now() }, { ttl: 86_400_000 });
        this.emit("autonomy.memory.updated", traceId, cycleId, { taskId: task.id, status: "stored" });
        return;
      }
      if (!decision.goal || decision.disposition === "ESCALATE" || !this.options.executeMission) {
        decision.goal && this.goals.transition(decision.goal.id, "ESCALATED");
        this.emit("autonomy.cycle.escalated", traceId, cycleId, { taskId: task.id, goalId: decision.goal?.id, status: decision.reason });
        return;
      }
      this.goals.transition(decision.goal.id, "ACTIVE");
      this.emit("autonomy.mission.created", traceId, cycleId, { taskId: task.id, goalId: decision.goal.id });
      const result = await this.options.executeMission({ cycleId, traceId, goal: decision.goal, observation: this.perception.perceive(event), task });
      this.goals.transition(decision.goal.id, result.escalate ? "ESCALATED" : result.success ? "COMPLETED" : "BLOCKED");
      await this.runtime.memory.set("project", `autonomy:outcome:${decision.goal.id}`, { result, cycleId, traceId, completedAt: Date.now() });
      // Persist a per-fingerprint tally so decide() can bias future cycles of the
      // same goal class (GAP-2). Success resets the failure counter. Guarded so a
      // memory backend without get() (e.g. minimal test doubles) never breaks the cycle.
      try {
        const fingerprint = this.fingerprint(event, this.perception.perceive(event));
        const prior = (this.runtime.memory.get?.("project", `autonomy:fingerprint:${fingerprint}`) as { failures?: number } | undefined)?.failures ?? 0;
        const failures = result.success ? 0 : prior + 1;
        await this.runtime.memory.set("project", `autonomy:fingerprint:${fingerprint}`, { failures, lastDisposition: decision.disposition, updatedAt: Date.now() });
      } catch { /* per-fingerprint tally is best-effort */ }
      this.emit(result.escalate ? "autonomy.cycle.escalated" : "autonomy.cycle.completed", traceId, cycleId, { taskId: task.id, goalId: decision.goal.id, status: result.success ? "completed" : "blocked" });
    } finally {
      this.activeCycles--;
    }
  }

  private emit(type: string, traceId: string, cycleId: string, extra: Omit<AutonomousExecutiveEvent, "type" | "traceId" | "cycleId" | "timestamp">): void {
    this.options.onEvent?.({ type, traceId, cycleId, timestamp: Date.now(), ...extra });
  }
}
