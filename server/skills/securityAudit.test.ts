import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { setSelfRoot } from "../utils/selfRoot.js";
import { securityAuditSkill } from "./securityAudit.js";

setSelfRoot(path.resolve(process.cwd()));

test("security audit exposes one non-mutating tool", () => {
  assert.equal(securityAuditSkill.declarations.length, 1);
  assert.equal(securityAuditSkill.declarations[0].name, "security_audit");
  assert.equal(securityAuditSkill.declarations[0].mutating, false);
  assert.ok(securityAuditSkill.inputSchemas?.security_audit);
});

test("security audit is bounded, read-only, and returns a consolidated report", async () => {
  const result = await securityAuditSkill.handleToolCall("security_audit", { includeTests: false });
  assert.equal(result.readOnly, true);
  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.scope.filesScanned, "number");
  assert.ok(result.scope.filesScanned > 0);
  assert.ok(result.summary);
  assert.ok(result.dependencies);
  assert.ok(["offline", "online", "not-applicable"].includes(result.dependencies.mode));
  assert.equal(typeof result.summary.dependenciesComplete, "boolean");
  assert.equal(typeof result.summary.issuesTruncated, "boolean");
  assert.equal(typeof result.durationMs, "number");
  assert.ok(Array.isArray(result.issues));
});
