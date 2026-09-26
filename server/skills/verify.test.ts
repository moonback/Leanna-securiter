import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "url";
import path from "path";
import { setSelfRoot } from "../utils/selfRoot.js";
import { verifySkill, parseTsErrors, parseLintResults, findAssociatedTestFile } from "./verify.js";

// Set SELF_ROOT so verify_file path resolution works correctly
{
  const __filename = fileURLToPath(import.meta.url);
  // server/skills/ → ../.. = project root
  setSelfRoot(path.resolve(path.dirname(__filename), '..', '..'));
}

// ─── Tests unitaires du skill verify ─────────────────────────────────────────

test("verify skill exposes all tool declarations", () => {
  assert.equal(verifySkill.declarations.length, 8);
  const names = verifySkill.declarations.map((d: any) => d.name);
  assert.ok(names.includes("verify_typecheck"));
  assert.ok(names.includes("verify_file"));
  assert.ok(names.includes("verify_run_script"));
  assert.ok(names.includes("verify_lint"));
  assert.ok(names.includes("verify_format"));
  assert.ok(names.includes("verify_syntax"));
});

test("verify skill has input schemas for all tools", () => {
  assert.ok(verifySkill.inputSchemas, "inputSchemas should be defined");
  assert.ok(verifySkill.inputSchemas!["verify_typecheck"]);
  assert.ok(verifySkill.inputSchemas!["verify_file"]);
  assert.ok(verifySkill.inputSchemas!["verify_run_script"]);
  assert.ok(verifySkill.inputSchemas!["verify_lint"]);
  assert.ok(verifySkill.inputSchemas!["verify_format"]);
  assert.ok(verifySkill.inputSchemas!["verify_syntax"]);
});

test("parseTsErrors parses TypeScript output formats correctly", () => {
  const sampleOutput = `
server/skills/verify.ts(45,12): error TS2304: Cannot find name 'foo'.
server/skills/base.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.
`;
  const errors = parseTsErrors(sampleOutput);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors[0], {
    file: "server/skills/verify.ts",
    line: 45,
    column: 12,
    code: "TS2304",
    message: "Cannot find name 'foo'.",
  });
  assert.deepEqual(errors[1], {
    file: "server/skills/base.ts",
    line: 10,
    column: 5,
    code: "TS2322",
    message: "Type 'string' is not assignable to type 'number'.",
  });
});

test("findAssociatedTestFile detects direct test files", () => {
  const testFile = findAssociatedTestFile("server/skills/verify.test.ts");
  assert.equal(testFile, "server/skills/verify.test.ts");
});

test("verify_typecheck returns a result with status and parsedErrors field", async () => {
  const result = await verifySkill.handleToolCall("verify_typecheck", {});
  assert.ok(result, "result should not be null");
  assert.ok("status" in result, "result should have a status field");
  assert.ok(
    ["success", "failed"].includes(result.status),
    `status should be success or failed, got: ${result.status}`
  );
  assert.ok("message" in result, "result should have a message");
  assert.ok(Array.isArray(result.parsedErrors), "should return parsedErrors array");
});

test("verify_file requires path parameter", async () => {
  const result = await verifySkill.handleToolCall("verify_file", {});
  assert.ok(result.error, "should return an error when path is missing");
  assert.match(result.error, /path: Required/i);
});

test("verify_file with nonexistent file returns error", async () => {
  const result = await verifySkill.handleToolCall("verify_file", {
    path: "nonexistent/file/that/does/not/exist.ts",
  });
  assert.ok(result.error, "should return an error for nonexistent file");
  assert.match(result.error, /introuvable/i);
});

test("verify_file with a valid file returns structured result", async () => {
  const result = await verifySkill.handleToolCall("verify_file", {
    path: "server/skills/verify.ts",
  });
  assert.ok(result, "result should not be null");
  assert.ok("status" in result, "should have status");
  assert.ok(["success", "failed"].includes(result.status));
  assert.ok("typecheck" in result, "should have typecheck result");
  assert.ok(result.typecheck, "typecheck result should exist");
  assert.ok("test" in result, "should have test result (or null)");
  assert.ok("message" in result, "should have a message");
  assert.ok(Array.isArray(result.parsedErrors), "should return parsedErrors array");
  assert.ok(result.verificationRecord, "should expose hash-bound verification evidence");
  assert.equal(result.verificationRecord.hashBefore.length, 64);
  assert.equal(result.verificationRecord.hashAfter.length, 64);
  assert.ok(["success", "failed", "stale"].includes(result.verificationRecord.status));
});

test("verify_file detects associated test file for verify.ts", async () => {
  const result = await verifySkill.handleToolCall("verify_file", {
    path: "server/skills/verify.ts",
  });
  // verify.test.ts exists, so test should not be null
  assert.ok(result.test !== null && result.test !== undefined, "should detect verify.test.ts as associated test");
  assert.ok(result.test?.file, "test result should have a file path");
  assert.match(result.test.file, /verify\.test\.ts/);
});

test("verify_file returns null test for files without associated tests", async () => {
  const result = await verifySkill.handleToolCall("verify_file", {
    path: "server/skills/base.ts",
  });
  assert.equal(result.test ?? null, null, "should be null when no test file exists");
});

test("verify_run_script rejects unauthorized scripts", async () => {
  const result = await verifySkill.handleToolCall("verify_run_script", {
    script: "dangerous-script",
  });
  assert.ok(result.error, "should return an error for unauthorized script");
});

test("verify_run_script accepts build script", async () => {
  const result = await verifySkill.handleToolCall("verify_run_script", {
    script: "build",
  });
  assert.ok(result, "result should not be null");
  assert.ok("status" in result, "should have status");
  assert.ok(["success", "failed"].includes(result.status));
});

test("verify_run_script accepts lint script", async () => {
  const result = await verifySkill.handleToolCall("verify_run_script", {
    script: "lint",
  });
  assert.ok(result, "result should not be null");
  assert.ok("status" in result, "should have status");
  assert.ok(["success", "failed"].includes(result.status));
});

test("unknown tool name returns an error", async () => {
  const result = await verifySkill.handleToolCall("verify_unknown", {});
  assert.ok(result.error, "should return an error for unknown tool");
  assert.match(result.error, /unknown tool|inconnu/i);
});

test("verify_run_script accepts test script", async () => {
  const result = await verifySkill.handleToolCall("verify_run_script", {
    script: "test",
  });
  assert.ok(result, "result should not be null");
  assert.ok("status" in result, "should have status");
  assert.ok(["success", "failed"].includes(result.status));
});

// ─── Tests pour le lint ──────────────────────────────────────────────────────

test("parseLintResults parses lint output correctly", () => {
  const sampleOutput = `server/skills/verify.ts:42:10 - warning no-console: console.log() détecté.
server/skills/base.ts:15:5 - error no-duplicate-import: Import/const dupliqué
server/skills/codebase.ts:100:1 - info no-todo-markers: Marqueur 'TODO' détecté dans le code`;

  const violations = parseLintResults(sampleOutput);
  assert.equal(violations.length, 3);
  assert.deepEqual(violations[0], {
    file: "server/skills/verify.ts",
    line: 42,
    column: 10,
    severity: "warning",
    rule: "no-console",
    message: "console.log() détecté.",
  });
  assert.deepEqual(violations[1], {
    file: "server/skills/base.ts",
    line: 15,
    column: 5,
    severity: "error",
    rule: "no-duplicate-import",
    message: "Import/const dupliqué",
  });
  assert.deepEqual(violations[2], {
    file: "server/skills/codebase.ts",
    line: 100,
    column: 1,
    severity: "info",
    rule: "no-todo-markers",
    message: "Marqueur 'TODO' détecté dans le code",
  });
});

test("parseLintResults returns empty array for empty input", () => {
  assert.equal(parseLintResults("").length, 0);
  assert.equal(parseLintResults(null as unknown as string).length, 0);
});

test("verify_file result includes lint field", async () => {
  const result = await verifySkill.handleToolCall("verify_file", {
    path: "server/skills/verify.ts",
  });
  assert.ok(result, "result should not be null");
  assert.ok("lint" in result, "should have lint field");
  assert.ok(result.lint && "ok" in result.lint, "lint should have ok field");
  assert.ok(Array.isArray(result.lint?.violations), "lint should have violations array");
});

test("verify_lint returns a structured result", async () => {
  const result = await verifySkill.handleToolCall("verify_lint", {});
  assert.ok(result, "result should not be null");
  assert.ok("status" in result, "should have status");
  assert.ok(["success", "failed"].includes(result.status));
  assert.ok("message" in result, "should have message");
  assert.ok("violations" in result, "should have violations");
  assert.ok(Array.isArray(result.violations), "violations should be an array");
  assert.ok("summary" in result, "should have summary");
  assert.ok("total" in result.summary, "summary should have total");
  assert.ok("errors" in result.summary, "summary should have errors");
  assert.ok("warnings" in result.summary, "summary should have warnings");
  assert.ok("infos" in result.summary, "summary should have infos");
});

