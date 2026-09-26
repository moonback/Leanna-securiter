import test from "node:test";
import assert from "node:assert/strict";
import { PerceptionEngine } from "./PerceptionEngine.js";

test("failed tasks require deterministic maintenance attention", () => {
  const perception = new PerceptionEngine().perceive({ type: "task:failed", taskId: "t", error: "boom" });
  assert.equal(perception.requiresAttention, true);
  assert.ok(perception.possibleActions.includes("maintenance"));
});

test("successful workflow completion remains idle", () => {
  const perception = new PerceptionEngine().perceive({ type: "workflow:completed", workflowId: "w", success: true });
  assert.equal(perception.requiresAttention, false);
});
