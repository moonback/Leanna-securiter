import { test } from "node:test";
import assert from "node:assert/strict";
import { StrategyMemory } from "./StrategyMemory.js";
import { SkillScorer } from "../mission/SkillScorer.js";

/**
 * Closes GAP-1: a durable skill outcome recorded by one mission must influence
 * the planning of a later mission via SkillScorer seeding. These tests use a
 * fresh StrategyMemory instance so they never touch the shared on-disk store.
 */

test("records skill outcomes and reports reliability", () => {
  const mem = new StrategyMemory({ ephemeral: true });
  mem.reset();
  for (let i = 0; i < 5; i++) mem.recordSkillOutcome("flaky_tool", false, 100);
  const stats = mem.getSkillStats("flaky_tool");
  assert.ok(stats, "stats should exist after recording");
  assert.equal(stats!.totalCalls, 5);
  assert.equal(stats!.successRate, 0);
  assert.equal(stats!.failing, true, "5 failures with no success is failing");
});

test("a reliable skill is not flagged failing", () => {
  const mem = new StrategyMemory({ ephemeral: true });
  mem.reset();
  for (let i = 0; i < 5; i++) mem.recordSkillOutcome("solid_tool", true, 50);
  const stats = mem.getSkillStats("solid_tool");
  assert.equal(stats!.failing, false);
  assert.equal(stats!.successRate, 1);
});

test("insufficient evidence never flags a skill as failing", () => {
  const mem = new StrategyMemory({ ephemeral: true });
  mem.reset();
  mem.recordSkillOutcome("new_tool", false, 100); // only 1 call < MIN_EVIDENCE
  assert.equal(mem.getSkillStats("new_tool")!.failing, false);
});

test("getFailingSkills lists only skills with enough failing evidence", () => {
  const mem = new StrategyMemory({ ephemeral: true });
  mem.reset();
  for (let i = 0; i < 4; i++) mem.recordSkillOutcome("bad", false, 100);
  for (let i = 0; i < 4; i++) mem.recordSkillOutcome("good", true, 100);
  const failing = mem.getFailingSkills().map((s) => s.skillName);
  assert.deepEqual(failing, ["bad"]);
});

test("seeded reliability biases SkillScorer history downward (GAP-1 closed)", () => {
  const mem = new StrategyMemory({ ephemeral: true });
  mem.reset();
  // A tool that has always failed across prior missions.
  for (let i = 0; i < 6; i++) mem.recordSkillOutcome("write_project_file", false, 200);

  const seeded = new SkillScorer();
  seeded.seedFromReliability(mem.getAllStats());
  const fresh = new SkillScorer();

  const ctx = {
    goalTitle: "modifier le fichier",
    goalDescription: "écrire du code",
    successCriteria: ["fichier écrit"],
    previousErrors: [],
    previousActions: [],
    relevantFiles: ["a.ts"],
    averageConfidence: 0.5,
  };

  const seededScore = seeded.scoreSkill("write_project_file", ctx);
  const freshScore = fresh.scoreSkill("write_project_file", ctx);

  // The historically-failing tool must score strictly lower once seeded, so a
  // future mission's Planner deprioritises it before any in-process failure.
  assert.ok(
    seededScore.totalScore < freshScore.totalScore,
    `seeded (${seededScore.totalScore}) should be < fresh (${freshScore.totalScore})`,
  );
  assert.ok(seededScore.breakdown.history < freshScore.breakdown.history);
});

test("seeding does not overwrite live in-process history", () => {
  const mem = new StrategyMemory({ ephemeral: true });
  mem.reset();
  for (let i = 0; i < 6; i++) mem.recordSkillOutcome("run_command", false, 200);

  const scorer = new SkillScorer();
  // Live: the skill succeeded this session.
  for (let i = 0; i < 3; i++) scorer.recordUsage("run_command", true, 100);
  scorer.seedFromReliability(mem.getAllStats());

  // Live observations win: history reflects the successful in-process runs.
  const score = scorer.scoreSkill("run_command", {
    goalTitle: "exécuter", goalDescription: "commande", successCriteria: [],
    previousErrors: [], previousActions: [], relevantFiles: [], averageConfidence: 0.5,
  });
  assert.ok(score.breakdown.history >= 14, `live success should keep history high, got ${score.breakdown.history}`);
});
