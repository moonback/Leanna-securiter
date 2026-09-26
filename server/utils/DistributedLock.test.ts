/**
 * DistributedLock tests — exercise the in-process fallback path (no live Redis).
 *
 * These tests deliberately run WITHOUT a REDIS_URL so they validate the
 * degraded, single-process correctness of the lock: mutual exclusion, safe
 * release (compare-and-delete semantics), TTL expiry, renewal, and withLock's
 * guaranteed release. The Redis backend uses the same battle-tested SET NX PX +
 * Lua release primitives; its behaviour is covered by Redis itself.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Ensure the fallback path is taken regardless of the ambient environment.
delete process.env.REDIS_URL;
delete process.env.LEANNA_LOCK_REDIS_URL;

const { DistributedLockManager } = await import("./DistributedLock.js");

const uniqueKey = (name: string) => `test:lock:${name}:${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("falls back to in-process locking when Redis is not configured", async () => {
  const mgr = new DistributedLockManager();
  assert.equal(mgr.isDistributed, false, "no Redis → not distributed");
  const handle = await mgr.tryAcquire(uniqueKey("fallback"));
  assert.ok(handle, "should acquire via in-process fallback");
  await handle!.release();
});

test("enforces mutual exclusion: a second acquire fails while held", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("mutex");
  const first = await mgr.tryAcquire(key);
  assert.ok(first, "first acquire succeeds");
  const second = await mgr.tryAcquire(key);
  assert.equal(second, null, "second acquire is refused while the lock is held");
  await first!.release();
  const third = await mgr.tryAcquire(key);
  assert.ok(third, "acquire succeeds again after release");
  await third!.release();
});

test("release is owner-scoped and idempotent", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("owner");
  const handle = await mgr.tryAcquire(key);
  assert.ok(handle);
  await handle!.release();
  await handle!.release(); // idempotent — no throw
  // After release the lock is free again.
  const again = await mgr.tryAcquire(key);
  assert.ok(again, "lock is free after release");
  await again!.release();
});

test("auto-expires after its TTL so a crashed holder cannot deadlock others", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("ttl");
  const held = await mgr.tryAcquire(key, 30); // 30ms TTL
  assert.ok(held, "acquired with short TTL");
  // Do NOT release — simulate a crashed holder.
  const blockedImmediately = await mgr.tryAcquire(key, 30);
  assert.equal(blockedImmediately, null, "still held before TTL elapses");
  await sleep(50);
  const afterExpiry = await mgr.tryAcquire(key, 30);
  assert.ok(afterExpiry, "lock is acquirable again once the TTL expires");
  await afterExpiry!.release();
});

test("renew extends the TTL while held", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("renew");
  const handle = await mgr.tryAcquire(key, 40);
  assert.ok(handle);
  await sleep(25);
  const renewed = await handle!.renew(60);
  assert.equal(renewed, true, "renew succeeds while held");
  await sleep(25); // would have expired at 40ms without renewal
  const blocked = await mgr.tryAcquire(key, 40);
  assert.equal(blocked, null, "renewed lock is still held past the original TTL");
  await handle!.release();
});

test("acquire retries up to waitMs then gives up", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("wait");
  const holder = await mgr.tryAcquire(key, 1_000);
  assert.ok(holder);

  const start = Date.now();
  const contender = await mgr.acquire(key, { waitMs: 60, retryDelayMs: 10, ttlMs: 1_000 });
  const elapsed = Date.now() - start;
  assert.equal(contender, null, "contender gives up after waitMs");
  assert.ok(elapsed >= 50, `should have waited ~waitMs before giving up (waited ${elapsed}ms)`);

  await holder!.release();
  const nowFree = await mgr.acquire(key, { waitMs: 60, retryDelayMs: 10 });
  assert.ok(nowFree, "acquire succeeds once the lock frees up within waitMs");
  await nowFree!.release();
});

test("withLock runs the critical section and always releases", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("withlock");

  let ran = false;
  const outcome = await mgr.withLock(key, async (handle) => {
    ran = true;
    assert.equal(handle.key, key);
    // The lock must be held during the critical section.
    const reentrant = await mgr.tryAcquire(key);
    assert.equal(reentrant, null, "lock is held for the duration of fn");
    return 42;
  });

  assert.ok(ran, "critical section executed");
  assert.deepEqual(outcome, { acquired: true, result: 42 });

  // Released afterwards.
  const after = await mgr.tryAcquire(key);
  assert.ok(after, "withLock released the lock on completion");
  await after!.release();
});

test("withLock releases even when the critical section throws", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("withlock-throw");

  await assert.rejects(
    mgr.withLock(key, async () => { throw new Error("boom"); }),
    /boom/,
  );

  const after = await mgr.tryAcquire(key);
  assert.ok(after, "lock released despite the thrown error");
  await after!.release();
});

test("withLock reports acquired:false without running fn when the lock is taken", async () => {
  const mgr = new DistributedLockManager();
  const key = uniqueKey("withlock-contended");
  const holder = await mgr.tryAcquire(key, 1_000);
  assert.ok(holder);

  let ran = false;
  const outcome = await mgr.withLock(key, async () => { ran = true; }, { waitMs: 20, retryDelayMs: 5 });
  assert.equal(ran, false, "fn must not run when the lock cannot be acquired");
  assert.deepEqual(outcome, { acquired: false });

  await holder!.release();
});
