import test from "node:test";
import assert from "node:assert/strict";
import { Supervisor } from "./Supervisor.js";

const failedVerify = (message = "TypeScript error") => ({
  ok: false,
  status: "failed",
  error: message,
});

test("uses the dedicated directive for a failed global build", async () => {
  const supervisor = new Supervisor({ attemptsPerApproach: 2 });

  const result = await supervisor.evaluateBuildResult({ valid: false, errors: "tsc failed" });

  assert.equal(result.needsCorrection, true);
  assert.match(result.directive ?? "", /BUILD CASSÉ/);
});

test("pauses on the tenth correction without exceeding the global limit", async () => {
  const supervisor = new Supervisor({ attemptsPerApproach: 100 });

  for (let index = 0; index < 9; index++) {
    const result = await supervisor.evaluateVerifyResult(`src/file-${index}.ts`, failedVerify(`error-${index}`));
    assert.equal(result.needsCorrection, true);
  }

  const result = await supervisor.evaluateVerifyResult("src/file-9.ts", failedVerify("error-9"));

  assert.match(result.directive ?? "", /coupe-circuit de session/);
  assert.equal(supervisor.getStats().totalCorrections, 10);
  assert.equal(supervisor.isMissionPaused(), true);
});

test("resumeMission clears blocked files and correction history", async () => {
  const supervisor = new Supervisor({ attemptsPerApproach: 2, maxApproaches: 1 });

  await supervisor.evaluateVerifyResult("src/blocked.ts", failedVerify());
  await supervisor.evaluateVerifyResult("src/blocked.ts", failedVerify("second error"));
  assert.equal(supervisor.isFileBlocked("src/blocked.ts"), true);

  supervisor.resumeMission();

  assert.equal(supervisor.isFileBlocked("src/blocked.ts"), false);
  assert.equal(supervisor.getStats().totalCorrections, 0);
  const result = await supervisor.evaluateVerifyResult("src/blocked.ts", failedVerify("new error"));
  assert.equal(result.needsCorrection, true);
  assert.match(result.directive ?? "", /CORRECTION REQUISE/);
});
