/**
 * ResearchLoop tests.
 *
 * Verify the bounded autonomous research cycle (hypothesis → lab test →
 * observation → refinement) enforces the SAME runtime bounds as the TaskManager:
 *   - 3 approches × 2 tentatives (maxApproaches × maxAttemptsPerApproach)
 *   - per-test timeout
 *   - per-category circuit breaker
 *   - dead-letter sink on error-dominated exhaustion / open breaker
 *   - fail-closed when no lab runner is wired (inert)
 * Tests are deterministic and CI-safe (tiny delays, small budgets).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ResearchLoop,
  type ResearchLoopConfig,
  type ResearchObservation,
  type LabTestRunner,
  type ResearchLoopEvent,
} from "./ResearchLoop.js";

const config = (overrides: Partial<ResearchLoopConfig> = {}): ResearchLoopConfig => ({
  maxApproaches: 3,
  maxAttemptsPerApproach: 2,
  testTimeoutMs: 100,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 50,
  maxConcurrency: 1,
  retryDelayMs: 1,
  dedupeTtlMs: 20,
  ...overrides,
});

const hypothesis = (statement = "param id is SQL-injectable", category = "CWE-89") => ({
  statement,
  category,
  source: "finding-1",
});

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

const closedEvent = (events: ResearchLoopEvent[]) =>
  events.find((e): e is Extract<ResearchLoopEvent, { type: "autonomy:research:closed" }> => e.type === "autonomy:research:closed");

test("confirms early when the lab supports the hypothesis (proof found)", async () => {
  const runner: LabTestRunner = async () => ({ outcome: "supported", detail: "canary recovered", evidence: { canary: "c-1" } });
  const events: ResearchLoopEvent[] = [];
  const loop = new ResearchLoop(runner, config(), (e) => events.push(e));

  const record = loop.submit(hypothesis());
  assert.ok(record);
  await settle();

  const stored = loop.get(record!.id)!;
  assert.equal(stored.status, "confirmed");
  assert.equal(stored.resolution, "confirmed");
  assert.equal(stored.approachesUsed, 1, "should stop at the first approach");
  assert.equal(stored.attemptsUsed, 1, "should stop at the first attempt");
  assert.deepEqual(stored.proof, { canary: "c-1" });
  assert.equal(closedEvent(events)?.resolution, "confirmed");
  await loop.stop();
});

test("exhausts 3 approaches × 2 attempts when never supported (inconclusive)", async () => {
  let calls = 0;
  const runner: LabTestRunner = async () => {
    calls++;
    return { outcome: "inconclusive", detail: `try ${calls}` };
  };
  const events: ResearchLoopEvent[] = [];
  const loop = new ResearchLoop(runner, config(), (e) => events.push(e));

  const record = loop.submit(hypothesis())!;
  await settle(120);

  const stored = loop.get(record.id)!;
  assert.equal(stored.status, "exhausted");
  assert.equal(stored.approachesUsed, 3, "must use exactly 3 approaches");
  assert.equal(stored.attemptsUsed, 6, "must run exactly 3 × 2 = 6 attempts");
  assert.equal(calls, 6);
  // One refinement event per approach transition (a1→a2, a2→a3).
  assert.equal(events.filter((e) => e.type === "autonomy:research:refined").length, 2);
  assert.equal(closedEvent(events)?.resolution, "exhausted");
  await loop.stop();
});

test("a refuted angle refines immediately into the next approach (no wasted retries)", async () => {
  const perApproach: number[] = [];
  const runner: LabTestRunner = async (req) => {
    perApproach[req.approach - 1] = (perApproach[req.approach - 1] ?? 0) + 1;
    return { outcome: "refuted", detail: `approach ${req.approach} is a dead end` };
  };
  const loop = new ResearchLoop(runner, config());

  const record = loop.submit(hypothesis())!;
  await settle(80);

  const stored = loop.get(record.id)!;
  assert.equal(stored.status, "exhausted");
  assert.equal(stored.approachesUsed, 3);
  assert.equal(stored.attemptsUsed, 3, "refuted → one attempt per approach, no retry");
  assert.deepEqual(perApproach, [1, 1, 1]);
  await loop.stop();
});

test("a per-test timeout is counted as an error attempt", async () => {
  const runner: LabTestRunner = () => new Promise<ResearchObservation>(() => { /* never resolves */ });
  // High breaker threshold so the timeout budget (not the breaker) is what bounds us.
  const loop = new ResearchLoop(runner, config({ testTimeoutMs: 10, retryDelayMs: 1, circuitBreakerThreshold: 99 }));

  const record = loop.submit(hypothesis())!;
  await settle(300);

  const stored = loop.get(record.id)!;
  assert.equal(stored.attemptsUsed, 6, "timeouts still consume the 3×2 budget");
  assert.ok(stored.observations.every((o) => o.outcome === "error"));
  assert.ok(stored.observations.every((o) => o.detail.includes("timed out")));
  // Error-dominated exhaustion routes to the dead-letter sink.
  assert.equal(stored.resolution, "dead_letter");
  assert.ok(stored.error);
  await loop.stop();
});

test("error-dominated exhaustion lands in the dead-letter sink", async () => {
  const runner: LabTestRunner = async () => { throw new Error("runner boom"); };
  const events: ResearchLoopEvent[] = [];
  // Threshold high enough that the breaker does not trip within one loop's 6 attempts.
  const loop = new ResearchLoop(runner, config({ circuitBreakerThreshold: 99 }), (e) => events.push(e));

  const record = loop.submit(hypothesis())!;
  await settle(120);

  const stored = loop.get(record.id)!;
  assert.equal(stored.status, "dead_letter");
  assert.equal(stored.attemptsUsed, 6);
  assert.equal(closedEvent(events)?.resolution, "dead_letter");
  await loop.stop();
});

test("circuit breaker opens per category and refuses new submissions", async () => {
  const runner: LabTestRunner = async () => { throw new Error("boom"); };
  // Breaker trips after 3 consecutive errors — within the first loop's budget.
  const loop = new ResearchLoop(runner, config({ circuitBreakerThreshold: 3, circuitBreakerCooldownMs: 10_000 }));

  const first = loop.submit(hypothesis("stmt A"))!;
  await settle(80);
  assert.equal(loop.get(first.id)!.status, "dead_letter");

  // A different hypothesis in the SAME category is now refused (breaker open).
  const blocked = loop.submit(hypothesis("stmt B"));
  assert.equal(blocked, undefined, "same-category submission refused while breaker is open");

  // A different category is unaffected.
  const other = loop.submit(hypothesis("stmt C", "CWE-22"));
  assert.ok(other, "a different category is not gated by the open breaker");
  await loop.stop();
});

test("deduplicates identical hypotheses within the TTL window", async () => {
  const runner: LabTestRunner = async () => ({ outcome: "inconclusive", detail: "..." });
  const loop = new ResearchLoop(runner, config({ dedupeTtlMs: 10_000 }));

  const a = loop.submit(hypothesis("same stmt"));
  const b = loop.submit(hypothesis("same stmt"));
  assert.ok(a);
  assert.equal(b, undefined, "identical hypothesis is deduped");
  await loop.stop();
});

test("is inert (fail-closed) when no lab runner is wired", async () => {
  const events: ResearchLoopEvent[] = [];
  const loop = new ResearchLoop(undefined, config(), (e) => events.push(e));

  assert.equal(loop.armed, false, "loop reports it cannot run active tests");
  const record = loop.submit(hypothesis())!;
  await settle(120);

  const stored = loop.get(record.id)!;
  assert.equal(stored.status, "exhausted");
  assert.ok(stored.observations.every((o) => o.outcome === "inconclusive"));
  assert.ok(stored.observations.every((o) => o.detail.includes("No lab runner")));
  await loop.stop();
});

test("stop() aborts queued loops and clears timers", async () => {
  const runner: LabTestRunner = async () => ({ outcome: "inconclusive", detail: "slow" });
  const loop = new ResearchLoop(runner, config({ maxConcurrency: 1 }));

  loop.submit(hypothesis("q1", "c1"));
  const queued = loop.submit(hypothesis("q2", "c2"))!; // waits behind the running one
  await loop.stop();

  const stored = loop.get(queued.id)!;
  assert.ok(["aborted", "exhausted", "confirmed", "dead_letter"].includes(stored.status));
});
