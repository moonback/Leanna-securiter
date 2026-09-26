/**
 * RedisEventBridge tests — no live Redis required.
 *
 * These validate:
 *  - The degraded path: without REDIS_URL, start() is a no-op, the bridge is not
 *    connected, and local EventBus behaviour is completely unchanged.
 *  - Wire serialization round-trips every RuntimeEvent shape losslessly.
 *  - deserializeEnvelope never throws on malformed input (a corrupt stream entry
 *    must not break the consumer loop).
 *
 * The Redis publish/consume path itself relies on Redis primitives (XADD/XREAD)
 * and is exercised only when a real REDIS_URL is present in an integration env.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Force the degraded path regardless of the ambient environment.
delete process.env.REDIS_URL;
delete process.env.LEANNA_EVENTBUS_REDIS_URL;

const { EventBus } = await import("./EventBus.js");
const { RedisEventBridge, serializeEvent, deserializeEnvelope } = await import("./RedisEventBridge.js");
import type { RuntimeEvent } from "./types.js";

test("start() is a no-op and the bridge stays disconnected without Redis", async () => {
  const bus = new EventBus();
  const bridge = new RedisEventBridge(bus);
  await bridge.start();
  assert.equal(bridge.isConnected, false, "no Redis → not connected");
  await bridge.stop(); // must not throw
});

test("local EventBus delivery is unchanged when the bridge is attached without Redis", async () => {
  const bus = new EventBus();
  const bridge = new RedisEventBridge(bus);
  await bridge.start();

  const received: string[] = [];
  bus.on("task:failed", (e) => received.push(e.error));
  bus.emit({ type: "task:failed", taskId: "t1", error: "boom" });

  assert.deepEqual(received, ["boom"], "local subscribers still receive events normally");
  await bridge.stop();
});

test("serializeEvent + deserializeEnvelope round-trips representative event shapes", () => {
  const instanceId = "inst-123";
  const samples: RuntimeEvent[] = [
    { type: "task:failed", taskId: "t1", error: "boom" },
    { type: "autonomy:stateChanged", from: "watching", to: "idle", reason: "heartbeat" },
    { type: "autonomy:taskStateChanged", taskId: "a1", taskType: "reactive", from: "running", to: "completed" },
    { type: "tool:completed", toolName: "read_file", durationMs: 12, success: true },
    { type: "workflow:started", workflowId: "w1", name: "build" },
  ];

  for (const event of samples) {
    const fields = serializeEvent(instanceId, event);
    assert.equal(fields.instanceId, instanceId);
    assert.equal(fields.type, event.type);
    const envelope = deserializeEnvelope(fields);
    assert.ok(envelope, `envelope should deserialize for ${event.type}`);
    assert.equal(envelope!.instanceId, instanceId);
    assert.deepEqual(envelope!.event, event, `round-trip preserves ${event.type}`);
  }
});

test("deserializeEnvelope returns null on malformed input instead of throwing", () => {
  assert.equal(deserializeEnvelope({} as Record<string, string>), null, "missing fields → null");
  assert.equal(
    deserializeEnvelope({ instanceId: "x", payload: "not-json{" }),
    null,
    "invalid JSON → null",
  );
  assert.equal(
    deserializeEnvelope({ instanceId: "x", payload: JSON.stringify({ notype: true }) }),
    null,
    "payload without a string type → null",
  );
  const ok = deserializeEnvelope({ instanceId: "x", payload: JSON.stringify({ type: "agent:idle", agentId: "a1" }) });
  assert.ok(ok, "well-formed payload → envelope");
  assert.equal(ok!.event.type, "agent:idle");
});

test("each bridge instance has a distinct instanceId (used for loop prevention)", () => {
  const bus = new EventBus();
  const a = new RedisEventBridge(bus);
  const b = new RedisEventBridge(bus);
  assert.notEqual(a.instanceId, b.instanceId, "instance ids must be unique across processes");
});
