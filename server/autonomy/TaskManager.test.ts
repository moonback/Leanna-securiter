import test from "node:test";
import assert from "node:assert/strict";
import { TaskManager } from "./TaskManager.js";

const config = { maxConcurrency: 1, dedupeTtlMs: 50, retryDelayMs: 1, maxRetries: 2, timeoutMs: 100, circuitBreakerThreshold: 2, circuitBreakerCooldownMs: 50 };
const input = { type: "reactive" as const, title: "test", priority: "medium" as const, sourceEventId: "event-1", fingerprint: "same" };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("deduplicates an event fingerprint within its configured TTL", () => {
  const manager = new TaskManager(async () => {}, config);
  assert.ok(manager.submit(input));
  assert.equal(manager.submit(input), undefined);
});

test("retries a failed task with a bounded exponential delay", async () => {
  let calls = 0;
  const manager = new TaskManager(async () => { calls++; if (calls === 1) throw new Error("temporary"); }, config);
  const task = manager.submit(input)!;
  await sleep(30);
  assert.equal(calls, 2);
  assert.equal(manager.list().find(item => item.id === task.id)?.status, "completed");
});

test("opens a circuit and sends terminal failures to the dead-letter state", async () => {
  const manager = new TaskManager(async () => { throw new Error("unavailable"); }, { ...config, maxRetries: 1, circuitBreakerThreshold: 1 });
  const task = manager.submit(input)!;
  await sleep(10);
  assert.equal(manager.list().find(item => item.id === task.id)?.status, "dead_letter");
  assert.equal(manager.submit({ ...input, fingerprint: "next" }), undefined);
});

test("applies queue backpressure without discarding already accepted work", () => {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const manager = new TaskManager(async () => blocked, { ...config, maxQueueSize: 1 });
  assert.ok(manager.submit(input));
  assert.ok(manager.submit({ ...input, fingerprint: "queued" }));
  assert.equal(manager.submit({ ...input, fingerprint: "overflow" }), undefined);
  release?.();
});
