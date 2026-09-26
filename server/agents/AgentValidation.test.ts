import test from "node:test";
import assert from "node:assert/strict";
import { AgentValidation } from "./AgentValidation.js";

test("AgentValidation accepts a stable baseline with pre-existing failures", () => {
  const baseline = AgentValidation.snapshot({ typecheck: { errorCount: 10 }, lint: { summary: { errors: 2 } }, security: { summary: { critical: 0, high: 1 } } });
  const current = AgentValidation.snapshot({ typecheck: { errorCount: 10 }, lint: { summary: { errors: 2 } }, security: { summary: { critical: 0, high: 1 } } });
  assert.equal(AgentValidation.compare(baseline, current).passed, true);
});

test("AgentValidation reports each increased global failure category", () => {
  const baseline = AgentValidation.snapshot({ typecheck: { errorCount: 1 }, lint: { summary: { errors: 0 } }, security: { summary: { critical: 0, high: 0 } } });
  const current = AgentValidation.snapshot({ typecheck: { errorCount: 2 }, lint: { summary: { errors: 1 } }, security: { summary: { critical: 1, high: 0 } } });
  const report = AgentValidation.compare(baseline, current);
  assert.equal(report.passed, false);
  assert.deepEqual(report.regressions.map((issue) => issue.type), ["typecheck", "lint", "security"]);
});
