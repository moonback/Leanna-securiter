import test from "node:test";
import assert from "node:assert/strict";
import { AgentRepairLoop } from "./AgentRepairLoop.js";
import { WorkspaceState } from "./WorkspaceState.js";

const issue = (message = "broken") => ({ type: "typecheck", file: "server/example.ts", line: 1, column: 1, severity: "error" as const, rule: "TS1000", message });

test("WorkspaceState requires current hash-bound verification for completion", async () => {
  let disk = "export const value = 1;";
  const workspace = new WorkspaceState(async () => disk);
  const read = await workspace.reread("server/example.ts");
  assert.equal(read.exists, true);
  assert.equal(read.version, 1);

  const record = { file: "server/example.ts", contentHash: read.contentHash, hashBefore: read.contentHash, hashAfter: read.contentHash, verifiedAt: new Date().toISOString(), ok: true, status: "success" as const, issues: [], allIssues: [] };
  workspace.recordVerification("server/example.ts", record);
  assert.equal((await workspace.reread("server/example.ts")).status, "verified");
  assert.equal(workspace.completionReport(["server/example.ts"]).passed, true);

  disk = "export const value = 2;";
  const changed = await workspace.reread("server/example.ts");
  assert.equal(changed.status, "stale");
  assert.equal(changed.previousHash, record.contentHash);
  assert.equal(changed.version, 2);
  assert.equal(workspace.completionReport(["server/example.ts"]).passed, false);
});

test("WorkspaceState rejects verification that changed during checks", async () => {
  const workspace = new WorkspaceState(async () => "const stable = true;");
  const state = await workspace.reread("server/example.ts");
  workspace.recordVerification("server/example.ts", { file: state.path, contentHash: state.contentHash, hashBefore: state.contentHash, hashAfter: WorkspaceState.hash("const changed = true;"), verifiedAt: new Date().toISOString(), ok: false, status: "stale", issues: [issue()], allIssues: [issue()] });
  assert.equal(workspace.get("server/example.ts")?.status, "stale");
  assert.equal(workspace.completionReport(["server/example.ts"]).passed, false);
});

test("AgentRepairLoop escalates repeated patches and permits measurable progress", () => {
  const loop = new AgentRepairLoop();
  const first = loop.assess({ issues: [issue()], currentHash: "one", currentVersion: 1, patch: "patch-a" });
  assert.equal(first.action, "continue");
  const progressed = loop.assess({ issues: [], currentHash: "two", currentVersion: 2, patch: "patch-b" });
  assert.equal(progressed.action, "continue");
  const stalled = loop.assess({ issues: [issue()], currentHash: "two", currentVersion: 2, patch: "patch-c" });
  assert.equal(stalled.action, "change_strategy");
  const repeated = loop.assess({ issues: [issue()], currentHash: "two", currentVersion: 2, patch: "patch-c" });
  assert.equal(repeated.action, "stop");
  assert.match(repeated.requiredAction, /stop automatic patching/i);
});
