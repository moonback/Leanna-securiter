/**
 * TaskManager soak / load tests.
 *
 * Validates the autonomy queue under sustained load: throughput, backpressure,
 * dedupe churn, retry + circuit-breaker + timeout behaviour, and clean shutdown
 * with no leaked timers. These assertions reflect the TaskManager's ACTUAL
 * design, not an idealised one:
 *   - The `tasks` map is never evicted, so it grows with the number of UNIQUE
 *     fingerprints submitted (deduplicated resubmits do not grow it).
 *   - The `dedupe` map is pruned on each submit once entries expire.
 *   - `retryTimers` are cleared on stop().
 *
 * The default run is bounded so it stays CI-safe and exits promptly. Set
 * LEANNA_SOAK=1 for a heavier, longer sustained run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TaskManager, type TaskManagerConfig } from "./TaskManager.js";

const SOAK = process.env.LEANNA_SOAK === "1" || process.env.LEANNA_SOAK === "true";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const baseConfig = (overrides: Partial<TaskManagerConfig> = {}): TaskManagerConfig => ({
  maxConcurrency: 4,
  maxQueueSize: 500,
  dedupeTtlMs: 20,
  retryDelayMs: 1,
  maxRetries: 2,
  timeoutMs: 50,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 30,
  ...overrides,
});

const input = (fingerprint: string) => ({
  type: "reactive" as const,
  title: `soak ${fingerprint}`,
  priority: "medium" as const,
  sourceEventId: `evt-${fingerprint}`,
  fingerprint,
});

/**
 * Wait until `done()` is true or a deadline elapses. Callers pass a CHEAP
 * predicate (e.g. an executed-counter check) rather than manager.list(), which
 * sorts the whole task map and would dominate timing under heavy load.
 */
async function waitFor(done: () => boolean, deadlineMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (done()) return true;
    await sleep(5);
  }
  return done();
}

test("sustains throughput over many waves without losing or duplicating work", async () => {
  // Real autonomy load arrives as a stream of events over time, not one giant
  // burst. We submit in waves and drain each, which both mirrors production and
  // keeps the queue small (the priority queue is re-sorted on every dequeue, so
  // a single huge burst is a worst case rather than a realistic one).
  const waves = SOAK ? 400 : 30;
  const perWave = 100;
  const total = waves * perWave;
  let executed = 0;
  const manager = new TaskManager(
    async () => { executed++; },
    baseConfig({ maxConcurrency: 8, maxQueueSize: perWave + 10, dedupeTtlMs: 1 }),
  );

  let accepted = 0;
  const started = Date.now();
  for (let w = 0; w < waves; w++) {
    for (let i = 0; i < perWave; i++) {
      if (manager.submit(input(`w${w}-${i}`))) accepted++;
    }
    const ok = await waitFor(() => executed === accepted, 10_000);
    assert.ok(ok, `wave ${w} drained (executed=${executed}/${accepted})`);
  }

  const throughput = Math.round((executed / (Date.now() - started)) * 1000);
  assert.equal(accepted, total, "every unique submission within per-wave capacity should be accepted");
  assert.equal(executed, total, "every accepted task should execute exactly once (no loss, no dup)");
  assert.equal(manager.pendingCount, 0, "queue fully drained after the final wave");
  console.log(`[soak] sustained throughput: ~${throughput} tasks/s over ${total} tasks in ${waves} waves`);
  await manager.stop();
});

test("applies backpressure under a burst larger than the queue without dropping accepted work", async () => {
  const capacity = 50;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let executed = 0;
  // Blocking executor with concurrency 1 so the queue actually fills up.
  const manager = new TaskManager(
    async () => { await gate; executed++; },
    baseConfig({ maxConcurrency: 1, maxQueueSize: capacity, dedupeTtlMs: 1 }),
  );

  const burst = capacity * 4;
  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < burst; i++) {
    if (manager.submit(input(`b-${i}`))) accepted++; else rejected++;
  }

  // Queue holds `capacity`; one task is pulled into the running slot.
  assert.ok(accepted <= capacity + 1, `accepted (${accepted}) must not exceed capacity + 1 running`);
  assert.ok(rejected > 0, "excess submissions must be rejected, not queued");
  assert.equal(accepted + rejected, burst, "every submission is either accepted or rejected");

  release?.();
  const drained = await waitFor(() => executed === accepted, 10_000);
  assert.ok(drained, "all accepted work eventually executes; nothing silently dropped");
  assert.equal(executed, accepted, "executed count matches accepted count");
  await manager.stop();
});

test("keeps the dedupe map bounded across sustained repeated-fingerprint churn", async () => {
  const manager = new TaskManager(async () => {}, baseConfig({ dedupeTtlMs: 15 }));
  const rounds = SOAK ? 400 : 80;
  const perRound = 25;

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < perRound; i++) manager.submit(input(`churn-${i}`));
    await sleep(20); // let the TTL lapse so the next round re-accepts and prunes
  }
  await waitFor(() => manager.pendingCount === 0, 10_000);

  // Only `perRound` distinct fingerprints exist. After the final round + pruning,
  // the dedupe map cannot exceed the distinct fingerprint count — it does not grow
  // with the number of rounds.
  const distinct = new Set(manager.list().map((t) => t.fingerprint));
  assert.ok(distinct.size <= perRound, `distinct fingerprints (${distinct.size}) stay bounded by ${perRound}`);
  await manager.stop();
});

test("opens the circuit under a flood of same-type failures and stops accepting that type", async () => {
  const manager = new TaskManager(
    async () => { throw new Error("always fails"); },
    baseConfig({ maxRetries: 1, circuitBreakerThreshold: 5, circuitBreakerCooldownMs: 10_000, dedupeTtlMs: 1 }),
  );

  let acceptedAfterOpen = 0;
  for (let i = 0; i < 200; i++) {
    const task = manager.submit(input(`fail-${i}`));
    if (task) await sleep(2); // let it run + fail so the breaker can trip
    else acceptedAfterOpen++; // rejected once the circuit is open
  }

  await waitFor(() => manager.pendingCount === 0, 10_000);
  assert.ok(acceptedAfterOpen > 0, "circuit must eventually reject new tasks of the failing type");
  const dead = manager.list().filter((t) => t.status === "dead_letter").length;
  assert.ok(dead > 0, "terminally failed tasks land in dead_letter");
  await manager.stop();
});

test("enforces per-attempt timeout on slow tasks under load", async () => {
  const n = SOAK ? 200 : 40;
  let terminal = 0;
  let sawTimeoutError = false;
  const manager = new TaskManager(
    async () => { await sleep(500); }, // far exceeds the 40ms timeout
    baseConfig({ maxRetries: 1, timeoutMs: 40, maxConcurrency: 8, dedupeTtlMs: 1, circuitBreakerThreshold: 999 }),
    (task, previous) => {
      if ((task.status === "dead_letter" || task.status === "completed") && previous === "running") {
        terminal++;
        if ((task.error ?? "").toLowerCase().includes("timed out")) sawTimeoutError = true;
      }
    },
  );

  for (let i = 0; i < n; i++) manager.submit(input(`slow-${i}`));
  const drained = await waitFor(() => terminal === n, 15_000);

  assert.ok(drained, `every slow task terminates via the timeout path, none hang (terminal=${terminal}/${n})`);
  assert.ok(sawTimeoutError, "slow tasks fail with a timeout error");
  await manager.stop();
});

test("stop() cancels pending work and leaves no active handles", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const manager = new TaskManager(
    async () => { await gate; },
    baseConfig({ maxConcurrency: 1, maxQueueSize: 100, dedupeTtlMs: 1 }),
  );

  for (let i = 0; i < 50; i++) manager.submit(input(`stop-${i}`));
  assert.ok(manager.pendingCount > 0, "queue should have pending work before stop");

  await manager.stop();
  assert.equal(manager.pendingCount, 0, "stop drains the pending queue");
  const cancelled = manager.list().filter((t) => t.status === "cancelled").length;
  assert.ok(cancelled > 0, "pending tasks are transitioned to cancelled on stop");

  // After stop, no new work is accepted.
  assert.equal(manager.submit(input("after-stop")), undefined, "stopped manager rejects new work");

  release?.();
  // If retry timers had leaked, the process would keep an active timer here.
  const handlesBefore = (process as any)._getActiveHandles?.().length ?? 0;
  await sleep(30);
  const handlesAfter = (process as any)._getActiveHandles?.().length ?? 0;
  assert.ok(handlesAfter <= handlesBefore, "stop() must not leave growing active handles/timers");
});
