import { randomUUID } from "crypto";
import type { AgentPriority } from "../runtime/types.js";

/**
 * BOUNDED AUTONOMOUS RESEARCH LOOP
 * ────────────────────────────────
 * Extends the event-driven autonomy runtime (LeannaCore, §Runtime autonome
 * événementiel) with a deterministic research cycle:
 *
 *     hypothesis → test in lab → observation → refinement
 *
 * The loop reuses the EXACT same runtime bounds as the TaskManager so that
 * autonomous exploration can never run away:
 *   - 3 approches × 2 tentatives   → maxApproaches × maxAttemptsPerApproach
 *   - timeout                      → per-test deadline (withTimeout)
 *   - circuit breaker              → per-category failure gate + cooldown
 *   - dead-letter                  → terminal sink when the bound is reached
 *
 * SAFETY DOCTRINE (aligned with ROADMAP §9 "Recherche en lab isolé"):
 *   - Deterministic. It NEVER calls an LLM.
 *   - Fail-closed. Active tests only run through an injected LabTestRunner. When
 *     no runner is provided (the default), every test is refused as
 *     "inconclusive" with reason "no lab runner" — the loop is inert and cannot
 *     touch any target. This mirrors "aucune action active sans manifeste valide".
 *   - The runner is expected to sit behind the lab scope guard / manifest; this
 *     engine only orchestrates the bounded cadence, it does not itself reach the
 *     network or the filesystem.
 */

/** A testable hypothesis fed into the loop (e.g. derived from a SAST/DAST finding). */
export interface ResearchHypothesis {
  /** Human-readable statement, e.g. "param `id` on /users is SQL-injectable (CWE-89)". */
  statement: string;
  /** Category used for circuit-breaking and dedupe (e.g. a CWE id or finding class). */
  category: string;
  /** Where the hypothesis came from (finding id, event id, mission id, "manual", …). */
  source: string;
  priority?: AgentPriority;
  /** Free-form context handed verbatim to the lab runner (target, param, payload hints…). */
  context?: Record<string, unknown>;
}

/** Outcome of a single lab test attempt. Deterministic and side-effect-described. */
export type ResearchOutcome = "supported" | "refuted" | "inconclusive" | "error";

export interface ResearchObservation {
  outcome: ResearchOutcome;
  /** Short explanation, and — for a "supported" outcome — the reproducible proof reference. */
  detail: string;
  /** Optional evidence handle (e.g. captured request/response, recovered canary id). */
  evidence?: Record<string, unknown>;
}

/** A single test request handed to the (lab-only) runner. */
export interface ResearchTestRequest {
  loopId: string;
  hypothesis: ResearchHypothesis;
  /** 1-based index of the current approach (bounded by maxApproaches). */
  approach: number;
  /** 1-based attempt within the current approach (bounded by maxAttemptsPerApproach). */
  attempt: number;
  /** Refinement notes accumulated from previous observations, oldest first. */
  refinements: string[];
}

/**
 * Executes an active verification IN LAB ONLY. Implementations MUST enforce the
 * lab scope guard / manifest before doing anything active and MUST fail closed.
 * The engine treats a thrown error or a rejected promise as an "error" outcome
 * that counts against the runtime bounds.
 */
export type LabTestRunner = (request: ResearchTestRequest) => Promise<ResearchObservation>;

/**
 * Deterministic strategy that turns an observation into the next step. Given the
 * current state and the latest observation it decides whether to retry the same
 * approach, refine into the next approach, or stop. A default strategy is
 * provided; callers may inject their own (still deterministic) policy.
 */
export type RefinementStrategy = (
  observation: ResearchObservation,
  state: { approach: number; attempt: number; maxApproaches: number; maxAttemptsPerApproach: number },
) => { action: "confirm" | "retry" | "refine" | "give_up"; reason: string };

export interface ResearchLoopConfig {
  /** Distinct strategies to try. Mirrors the "3 approches" runtime bound. */
  maxApproaches: number;
  /** Attempts per approach. Mirrors the "2 tentatives" runtime bound. */
  maxAttemptsPerApproach: number;
  /** Per-test deadline in ms. Mirrors the TaskManager task timeout. */
  testTimeoutMs: number;
  /** Consecutive errors (per category) that trip the breaker. */
  circuitBreakerThreshold: number;
  /** How long the breaker stays open for a category, in ms. */
  circuitBreakerCooldownMs: number;
  /** Max concurrently-running loops. */
  maxConcurrency: number;
  /** Backoff between attempts, exponential like the TaskManager retry. */
  retryDelayMs: number;
  /** How long a hypothesis fingerprint is deduped, in ms. */
  dedupeTtlMs: number;
}

export type ResearchResolution = "confirmed" | "exhausted" | "dead_letter" | "aborted";

export interface ResearchLoopRecord {
  id: string;
  hypothesis: ResearchHypothesis;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  status: "pending" | "running" | "confirmed" | "exhausted" | "dead_letter" | "aborted";
  approach: number;
  attempt: number;
  approachesUsed: number;
  attemptsUsed: number;
  refinements: string[];
  observations: Array<ResearchObservation & { approach: number; attempt: number }>;
  resolution?: ResearchResolution;
  proof?: Record<string, unknown>;
  error?: string;
}

/** Events emitted by the loop, forwarded verbatim onto the shared EventBus. */
export type ResearchLoopEvent =
  | { type: "autonomy:research:opened"; loopId: string; hypothesis: string; source: string }
  | { type: "autonomy:research:tested"; loopId: string; approach: number; attempt: number; outcome: ResearchOutcome; detail: string }
  | { type: "autonomy:research:refined"; loopId: string; fromApproach: number; toApproach: number; reason: string }
  | { type: "autonomy:research:closed"; loopId: string; resolution: ResearchResolution; approaches: number; attempts: number; reason: string };

export type ResearchLoopEventSink = (event: ResearchLoopEvent) => void;

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export const researchLoopConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ResearchLoopConfig => ({
  maxApproaches: positive(Number(env.LEANNA_RESEARCH_MAX_APPROACHES), 3),
  maxAttemptsPerApproach: positive(Number(env.LEANNA_RESEARCH_MAX_ATTEMPTS), 2),
  testTimeoutMs: positive(Number(env.LEANNA_RESEARCH_TEST_TIMEOUT_MS), 60_000),
  circuitBreakerThreshold: positive(Number(env.LEANNA_RESEARCH_CIRCUIT_BREAKER_THRESHOLD), 5),
  circuitBreakerCooldownMs: positive(Number(env.LEANNA_RESEARCH_CIRCUIT_BREAKER_COOLDOWN_MS), 300_000),
  maxConcurrency: positive(Number(env.LEANNA_RESEARCH_MAX_CONCURRENCY), 1),
  retryDelayMs: positive(Number(env.LEANNA_RESEARCH_RETRY_DELAY_MS), 1_000),
  dedupeTtlMs: positive(Number(env.LEANNA_RESEARCH_DEDUPE_TTL_MS), 300_000),
});

/**
 * Default deterministic refinement policy:
 *   - supported            → confirm (proof found, stop early).
 *   - refuted              → refine into the next approach (this angle is a dead end).
 *   - inconclusive / error → retry within the current approach until the per-approach
 *                            attempt budget is spent, then refine into the next approach.
 * When no approach/attempt budget remains the caller turns "retry"/"refine" into
 * exhaustion, so this strategy never has to know the terminal bound itself.
 */
export const defaultRefinementStrategy: RefinementStrategy = (observation, state) => {
  if (observation.outcome === "supported") {
    return { action: "confirm", reason: "Hypothesis supported by reproducible proof." };
  }
  if (observation.outcome === "refuted") {
    return { action: "refine", reason: "Angle refuted; refining into a different approach." };
  }
  // inconclusive | error
  if (state.attempt < state.maxAttemptsPerApproach) {
    return { action: "retry", reason: `Inconclusive; retrying attempt ${state.attempt + 1} of the same approach.` };
  }
  return { action: "refine", reason: "Attempt budget for this approach spent; refining." };
};

/**
 * Bounded, deterministic research loop. Construction mirrors the TaskManager:
 * an executor (the lab runner) plus a config of bounds plus optional listeners.
 */
export class ResearchLoop {
  private readonly loops = new Map<string, ResearchLoopRecord>();
  private readonly queue: string[] = [];
  private readonly dedupe = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; openedAt?: number }>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private running = 0;
  private accepting = true;

  constructor(
    /**
     * The lab-only active-test executor. Optional: when omitted the loop is
     * inert (every test resolves "inconclusive: no lab runner") and can never
     * perform an active action — the safe default.
     */
    private readonly runner: LabTestRunner | undefined,
    private readonly config: ResearchLoopConfig = researchLoopConfigFromEnv(),
    private readonly emit?: ResearchLoopEventSink,
    private readonly strategy: RefinementStrategy = defaultRefinementStrategy,
  ) {}

  /** Whether the loop can actually run active tests (a lab runner is wired). */
  get armed(): boolean {
    return typeof this.runner === "function";
  }

  /**
   * Submit a hypothesis for bounded investigation. Returns the created record,
   * or undefined when refused (not accepting, deduped, or category breaker open).
   * Refusal is silent and safe, exactly like TaskManager.submit.
   */
  submit(hypothesis: ResearchHypothesis): ResearchLoopRecord | undefined {
    this.pruneDedupe();
    const fingerprint = `${hypothesis.category}:${hypothesis.statement.trim().toLowerCase().replace(/\s+/g, " ")}`;
    if (!this.accepting || this.dedupe.has(fingerprint) || this.isCircuitOpen(hypothesis.category)) {
      return undefined;
    }

    const now = Date.now();
    const record: ResearchLoopRecord = {
      id: randomUUID(),
      hypothesis,
      fingerprint,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      approach: 1,
      attempt: 0,
      approachesUsed: 0,
      attemptsUsed: 0,
      refinements: [],
      observations: [],
    };
    this.loops.set(record.id, record);
    this.dedupe.set(fingerprint, now + this.config.dedupeTtlMs);
    this.queue.push(record.id);
    this.emit?.({ type: "autonomy:research:opened", loopId: record.id, hypothesis: hypothesis.statement, source: hypothesis.source });
    this.pump();
    return record;
  }

  list(): ResearchLoopRecord[] {
    return [...this.loops.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): ResearchLoopRecord | undefined {
    return this.loops.get(id);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  /** Graceful shutdown: stop accepting, clear timers, abort queued loops. */
  async stop(): Promise<void> {
    this.accepting = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const id of this.queue.splice(0)) {
      const record = this.loops.get(id);
      if (record && record.status === "pending") this.close(record, "aborted", "Runtime stopping.");
    }
  }

  // ─── Internal cadence ──────────────────────────────────────────────────────

  private pump(): void {
    while (this.accepting && this.running < this.config.maxConcurrency && this.queue.length > 0) {
      this.queue.sort((a, b) => this.compare(this.loops.get(a)!, this.loops.get(b)!));
      const id = this.queue.shift()!;
      const record = this.loops.get(id)!;
      if (record.status !== "pending") continue;
      void this.step(record);
    }
  }

  private compare(a: ResearchLoopRecord, b: ResearchLoopRecord): number {
    return priority(b.hypothesis.priority) - priority(a.hypothesis.priority) || a.createdAt - b.createdAt;
  }

  /** Run one bounded test attempt, then decide the next step deterministically. */
  private async step(record: ResearchLoopRecord): Promise<void> {
    // Re-check the breaker at execution time: it may have tripped since queueing.
    if (this.isCircuitOpen(record.hypothesis.category)) {
      this.close(record, "dead_letter", `Circuit open for category "${record.hypothesis.category}".`);
      return;
    }

    this.running++;
    record.status = "running";
    record.attempt++;
    record.attemptsUsed++;
    if (record.attempt === 1) record.approachesUsed++;
    record.updatedAt = Date.now();

    let observation: ResearchObservation;
    try {
      observation = await withTimeout(this.runTest(record), this.config.testTimeoutMs);
    } catch (error) {
      observation = { outcome: "error", detail: error instanceof Error ? error.message : String(error) };
    }

    record.observations.push({ ...observation, approach: record.approach, attempt: record.attempt });
    record.updatedAt = Date.now();
    this.emit?.({
      type: "autonomy:research:tested",
      loopId: record.id,
      approach: record.approach,
      attempt: record.attempt,
      outcome: observation.outcome,
      detail: observation.detail,
    });
    this.trackFailure(record.hypothesis.category, observation.outcome);

    this.running--;
    this.decide(record, observation);
    this.pump();
  }

  /** Invoke the lab runner, or fail closed when none is wired. */
  private async runTest(record: ResearchLoopRecord): Promise<ResearchObservation> {
    if (!this.runner) {
      return { outcome: "inconclusive", detail: "No lab runner wired; loop is inert (fail-closed)." };
    }
    return this.runner({
      loopId: record.id,
      hypothesis: record.hypothesis,
      approach: record.approach,
      attempt: record.attempt,
      refinements: [...record.refinements],
    });
  }

  /** Apply the deterministic strategy and enforce the 3×2 + breaker bounds. */
  private decide(record: ResearchLoopRecord, observation: ResearchObservation): void {
    // A tripped breaker terminates immediately — same doctrine as the TaskManager.
    if (this.isCircuitOpen(record.hypothesis.category)) {
      this.close(record, "dead_letter", `Circuit tripped for category "${record.hypothesis.category}".`);
      return;
    }

    const decision = this.strategy(observation, {
      approach: record.approach,
      attempt: record.attempt,
      maxApproaches: this.config.maxApproaches,
      maxAttemptsPerApproach: this.config.maxAttemptsPerApproach,
    });

    if (decision.action === "confirm") {
      record.proof = observation.evidence;
      this.close(record, "confirmed", decision.reason);
      return;
    }

    if (decision.action === "give_up") {
      this.close(record, "exhausted", decision.reason);
      return;
    }

    if (decision.action === "retry" && record.attempt < this.config.maxAttemptsPerApproach) {
      record.refinements.push(`[a${record.approach}.t${record.attempt}] ${observation.detail}`);
      this.requeue(record);
      return;
    }

    // Either an explicit "refine" or an exhausted attempt budget: move to the
    // next approach if the approach bound allows it, otherwise exhaust.
    if (record.approach < this.config.maxApproaches) {
      const from = record.approach;
      record.approach++;
      record.attempt = 0;
      record.refinements.push(`[a${from} → a${record.approach}] ${decision.reason} (${observation.detail})`);
      this.emit?.({ type: "autonomy:research:refined", loopId: record.id, fromApproach: from, toApproach: record.approach, reason: decision.reason });
      this.requeue(record);
      return;
    }

    // 3 approaches × 2 attempts fully spent with no proof → bounded stop.
    // An error-dominated exhaustion lands in the dead-letter sink; otherwise it
    // is a clean "exhausted" (we simply could not support the hypothesis).
    const erroredOut = observation.outcome === "error";
    this.close(
      record,
      erroredOut ? "dead_letter" : "exhausted",
      erroredOut
        ? `All ${this.config.maxApproaches} approaches errored; routed to dead-letter.`
        : `All ${this.config.maxApproaches} approaches × ${this.config.maxAttemptsPerApproach} attempts spent without proof.`,
    );
  }

  private requeue(record: ResearchLoopRecord): void {
    record.status = "pending";
    const backoff = this.config.retryDelayMs * 2 ** Math.max(0, record.attempt - 1);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.accepting && record.status === "pending") {
        this.queue.push(record.id);
        this.pump();
      }
    }, backoff);
    this.timers.add(timer);
  }

  private close(record: ResearchLoopRecord, resolution: ResearchResolution, reason: string): void {
    record.status = resolution;
    record.resolution = resolution;
    if (resolution === "dead_letter" || resolution === "aborted") record.error = reason;
    record.updatedAt = Date.now();
    this.emit?.({
      type: "autonomy:research:closed",
      loopId: record.id,
      resolution,
      approaches: record.approachesUsed,
      attempts: record.attemptsUsed,
      reason,
    });
  }

  // ─── Circuit breaker (per category) ─────────────────────────────────────────

  private trackFailure(category: string, outcome: ResearchOutcome): void {
    if (outcome === "supported") {
      this.failures.delete(category); // a win clears the breaker, like a completed task.
      return;
    }
    if (outcome !== "error") return; // only hard errors feed the breaker.
    const failure = this.failures.get(category) ?? { count: 0 };
    failure.count++;
    if (failure.count >= this.config.circuitBreakerThreshold) failure.openedAt = Date.now();
    this.failures.set(category, failure);
  }

  private isCircuitOpen(category: string): boolean {
    const failure = this.failures.get(category);
    if (!failure?.openedAt) return false;
    if (Date.now() - failure.openedAt >= this.config.circuitBreakerCooldownMs) {
      this.failures.delete(category);
      return false;
    }
    return true;
  }

  private pruneDedupe(): void {
    const now = Date.now();
    for (const [fingerprint, expiresAt] of this.dedupe) {
      if (expiresAt <= now) this.dedupe.delete(fingerprint);
    }
  }
}

const priority = (value: AgentPriority = "medium"): number =>
  ({ low: 0, medium: 1, high: 2, critical: 3 })[value];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Research test timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
