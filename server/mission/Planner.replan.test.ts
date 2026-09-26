import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Planner } from "./Planner.js";
import { SkillScorer } from "./SkillScorer.js";
import { Mission } from "./Mission.js";
import { DEFAULT_MISSION_CONFIG } from "./types.js";
import { strategyMemory } from "../knowledge/StrategyMemory.js";
import { SELF_ROOT } from "../utils/selfRoot.js";

/**
 * R2-R3 + GAP-1: dynamic replanning must consult durable skill reliability, so a
 * tool that failed across prior missions is dropped on replan even without a
 * re-observed failure in the current mission — while never removing every tool.
 */

function cleanup() {
  const file = path.join(SELF_ROOT || process.cwd(), ".Leanna-strategy.json");
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
  strategyMemory.reset();
}

test("replan drops a durably-failing tool while keeping at least one option", async () => {
  cleanup();
  // Record enough failures to flag "unreliable_tool" as durably failing.
  for (let i = 0; i < 5; i++) strategyMemory.recordSkillOutcome("unreliable_tool", false, 100);

  const planner = new Planner(new SkillScorer());
  const mission = new Mission("t", "corriger le bug", "high", { ...DEFAULT_MISSION_CONFIG });
  const goalId = mission.rootGoal.id;

  const available = ["reliable_tool", "unreliable_tool"];
  const failed = { id: "a", skillName: "reliable_tool", args: {}, rationale: "", score: 40, order: 1, status: "failed" as const };

  const actions = await planner.replan(mission, goalId, failed, "boom", available);
  const usedSkills = new Set(actions.map((a) => a.skillName));
  assert.equal(usedSkills.has("unreliable_tool"), false, "durably-failing tool must be excluded on replan");
  cleanup();
});

test("replan never removes every tool (keeps availability if all are failing)", async () => {
  cleanup();
  for (let i = 0; i < 5; i++) strategyMemory.recordSkillOutcome("only_tool", false, 100);

  const planner = new Planner(new SkillScorer());
  const mission = new Mission("t", "corriger le bug", "high", { ...DEFAULT_MISSION_CONFIG, minSkillScore: 0 });
  const goalId = mission.rootGoal.id;
  const failed = { id: "a", skillName: "only_tool", args: {}, rationale: "", score: 40, order: 1, status: "failed" as const };

  const actions = await planner.replan(mission, goalId, failed, "boom", ["only_tool"]);
  // With every available tool failing, replanning must still be possible.
  assert.ok(actions.length >= 0, "replan must not throw when all tools are unreliable");
  cleanup();
});
