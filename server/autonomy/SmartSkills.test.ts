import test from "node:test";
import assert from "node:assert/strict";
import { createSmartSkills } from "./SmartSkills.js";

test("quality_loop executes phases in order and returns a regression report", async () => {
  const calls: string[] = [];
  let content = "const value = 1;";
  const skill = createSmartSkills(async (name, _args) => {
    calls.push(name);
    if (name === "read_project_file") return content;
    if (name === "modify_project_file") {
      content = "const value = 2;";
      return { ok: true };
    }
    if (name === "verify_file") return { status: "success", ok: true, test: { file: "sample.test.ts", ok: true } };
    if (name === "verify_format" || name === "verify_typecheck") return { status: "success", ok: true };
    return { status: "success", ok: true };
  });

  const result = await skill.handleToolCall("quality_loop", { path: "sample.ts", search: "1", replace: "2" });

  assert.equal(result.success, true);
  assert.equal(result.stoppedAt, "complete");
  assert.equal(result.diff.changed, true);
  assert.deepEqual(calls, ["read_project_file", "verify_file", "modify_project_file", "verify_format", "verify_typecheck", "verify_file", "read_project_file"]);
  assert.equal(result.testFile, "sample.test.ts");
});

test("quality_loop stops after the first failed phase", async () => {
  const calls: string[] = [];
  const skill = createSmartSkills(async (name) => {
    calls.push(name);
    if (name === "read_project_file") return "const value = 1;";
    if (name === "verify_file") return { status: "success", ok: true };
    if (name === "modify_project_file") return { ok: true };
    if (name === "verify_format") return { status: "failed", ok: false, error: "format failed" };
    return { status: "success", ok: true };
  });

  const result = await skill.handleToolCall("quality_loop", { path: "sample.ts", search: "1", replace: "2" });

  assert.equal(result.success, false);
  assert.equal(result.stoppedAt, "format");
  assert.equal(calls.includes("verify_typecheck"), false);
  assert.equal(calls.includes("verify_file",), true);
});

test("validate_patch applies the correction returned by reasoning_think", async () => {
  const calls: string[] = [];
  let content = "const value = broken;";
  const skill = createSmartSkills(async (name, args) => {
    calls.push(name);
    if (name === "modify_project_file") {
      content = args.search === "broken" ? content.replace(args.search, args.replace) : content;
      return { ok: true };
    }
    if (name === "verify_file") {
      return content.includes("fixed")
        ? { status: "success", ok: true }
        : { status: "failed", ok: false, error: "value is broken" };
    }
    if (name === "read_project_file") return content;
    if (name === "reasoning_think") return { reasoning: '{"search":"broken","replace":"fixed"}' };
    return { status: "success", ok: true };
  });

  const result = await skill.handleToolCall("validate_patch", {
    path: "sample.ts",
    search: "value = broken",
    replace: "value = broken",
  });

  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(calls, [
    "modify_project_file",
    "verify_file",
    "read_project_file",
    "reasoning_think",
    "modify_project_file",
    "verify_file",
  ]);
});

test("read_until_understood bases confidence on context and file relevance", async () => {
  const skill = createSmartSkills(async (name) => {
    if (name === "knowledge_build_context") {
      return {
        score: { confidence: 30 },
        batch: { files: [{ path: "relevant.ts", relevance: 0.9 }, { path: "weak.ts", relevance: 0.1 }] },
        facts: [],
      };
    }
    if (name === "read_file_outline") return { status: "success", outline: "ok" };
    return { status: "success" };
  });

  const result = await skill.handleToolCall("read_until_understood", {
    task: "understand the implementation",
    maxFiles: 1,
    targetConfidence: 80,
  });

  assert.equal(result.confidence, 60);
  assert.deepEqual(result.filesRead, ["relevant.ts"]);
  assert.equal(result.suggestMore, true);
});
