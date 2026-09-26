import assert from "node:assert/strict";
import test from "node:test";
import { agentEventStream } from "./AgentEventStream.js";
import type { AgentEvent } from "./ProgressNotifier.js";

test("agent event stream notifies subscribers and supports unsubscribe", () => {
  const received: AgentEvent[] = [];
  const unsubscribe = agentEventStream.subscribe((event) => received.push(event));
  const event = {
    type: "agent_event",
    event: "task_started",
    taskId: "task-test",
    role: "coder",
    title: "Test",
    status: "running",
    agentName: "Développeur",
    timestamp: new Date().toISOString(),
  } as AgentEvent;

  agentEventStream.publish(event);
  unsubscribe();
  agentEventStream.publish(event);

  assert.equal(received.length, 1);
  assert.equal(received[0].taskId, "task-test");
});