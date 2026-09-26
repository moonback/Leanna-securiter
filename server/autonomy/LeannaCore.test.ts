import test from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "../runtime/EventBus.js";
import { LeannaCore } from "./LeannaCore.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeRuntime() {
  const events = new EventBus();
  return {
    events,
    isRunning: true,
    getStats: () => ({ tasks: { failed: 0 } }),
    memory: { set: async () => {} },
  };
}

test("creates one bounded autonomy task for duplicate failed runtime events", async () => {
  const runtime = fakeRuntime();
  const core = new LeannaCore(runtime as never, { onTask: async () => {} });
  core.start();

  runtime.events.emit({ type: "task:failed", taskId: "failed-1", error: "boom" });
  runtime.events.emit({ type: "task:failed", taskId: "failed-1", error: "boom" });
  await sleep(10);

  assert.equal(core.getTasks().length, 1);
  assert.equal(core.getTasks()[0].status, "completed");
  await core.stop();
});

test("broadcasts autonomy events to the configured real-time broadcaster", async () => {
  const runtime = fakeRuntime();
  const received: string[] = [];
  const core = new LeannaCore(runtime as never, {
    onTask: async () => {},
    broadcaster: (message) => {
      assert.equal(message.type, "autonomy_event");
      assert.ok(typeof message.timestamp === "string");
      assert.ok(!("type" in message.payload));
      received.push(message.event);
    },
  });
  core.start();

  runtime.events.emit({ type: "task:failed", taskId: "failed-2", error: "boom" });
  await sleep(10);

  assert.ok(received.includes("autonomy:taskCreated"), "should broadcast taskCreated");
  assert.ok(received.includes("autonomy:taskStateChanged"), "should broadcast taskStateChanged");
  await core.stop();
});

test("setBroadcaster attaches a broadcaster after construction", async () => {
  const runtime = fakeRuntime();
  const received: string[] = [];
  const core = new LeannaCore(runtime as never, { onTask: async () => {} });
  core.setBroadcaster((message) => received.push(message.event));
  core.start();

  runtime.events.emit({ type: "task:failed", taskId: "failed-3", error: "boom" });
  await sleep(10);

  assert.ok(received.length > 0, "broadcaster set post-construction should receive events");
  await core.stop();
});
