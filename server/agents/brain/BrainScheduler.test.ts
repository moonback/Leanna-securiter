/**
 * Tests unitaires — BrainScheduler
 *
 * Couvre :
 * 1. Exécution parallèle des étapes indépendantes (DAG diamant)
 * 2. Respect de l'ordre topologique (fan-in)
 * 3. Échec de branche : annulation des dépendants, poursuite des indépendants
 * 4. Deadlock détecté proprement
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BrainScheduler, type ExecuteStageFn } from "./BrainScheduler.js";
import type { BrainStage, StageVerification } from "./types.js";

function makeStage(id: string, role: BrainStage["agentRole"], dependsOn: string[] = []): BrainStage {
  return {
    id,
    title: `Étape ${id}`,
    description: `Description ${id}`,
    agentRole: role,
    agentReason: "test",
    skills: [],
    tools: [],
    files: [],
    instructions: "",
    dependsOn,
    status: "pending",
    priority: "high",
  };
}

function pass(stage: BrainStage): StageVerification {
  return {
    stageId: stage.id,
    role: stage.agentRole,
    passed: true,
    syntaxCheckOk: true,
    testsOk: true,
    semanticCheckOk: true,
    issues: [],
    summary: "OK",
    timestamp: new Date().toISOString(),
  };
}

function fail(stage: BrainStage): StageVerification {
  return {
    stageId: stage.id,
    role: stage.agentRole,
    passed: false,
    syntaxCheckOk: false,
    testsOk: false,
    semanticCheckOk: false,
    issues: [{ severity: "error", message: "échec simulé" }],
    summary: "KO",
    timestamp: new Date().toISOString(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("BrainScheduler.execute", () => {
  it("exécute les étapes indépendantes en parallèle et respecte l'ordre topologique (diamant)", async () => {
    // a -> {b, c} -> d
    const stages = [
      makeStage("a", "researcher"),
      makeStage("b", "coder", ["a"]),
      makeStage("c", "coder", ["a"]),
      makeStage("d", "reviewer", ["b", "c"]),
    ];

    // Enregistrer les fenêtres de temps de chaque étape pour prouver le parallélisme
    const startAt: Record<string, number> = {};
    const endAt: Record<string, number> = {};
    const t0 = Date.now();

    const exec: ExecuteStageFn = async (stage) => {
      startAt[stage.id] = Date.now() - t0;
      await sleep(40);
      endAt[stage.id] = Date.now() - t0;
      return pass(stage);
    };

    const scheduler = new BrainScheduler(exec);
    const report = await scheduler.execute(stages);

    assert.deepEqual(report.failed, []);
    assert.equal(report.completed.length, 4);

    // a avant b et c ; d après b et c
    assert.ok(endAt["a"] <= startAt["b"], "a doit finir avant que b démarre");
    assert.ok(endAt["a"] <= startAt["c"], "a doit finir avant que c démarre");
    assert.ok(endAt["b"] <= startAt["d"], "b doit finir avant que d démarre");
    assert.ok(endAt["c"] <= startAt["d"], "c doit finir avant que d démarre");

    // b et c doivent se chevaucher dans le temps (parallélisme réel)
    const overlap = startAt["b"] < endAt["c"] && startAt["c"] < endAt["b"];
    assert.ok(overlap, `b et c doivent s'exécuter en parallèle (b:[${startAt["b"]},${endAt["b"]}] c:[${startAt["c"]},${endAt["c"]}])`);
  });

  it("annule les dépendants d'une branche échouée mais poursuit les branches indépendantes", async () => {
    // a -> b (échoue) -> d ; c indépendant
    const stages = [
      makeStage("a", "researcher"),
      makeStage("b", "coder", ["a"]),
      makeStage("c", "writer"),
      makeStage("d", "reviewer", ["b"]),
    ];

    const exec: ExecuteStageFn = async (stage) => {
      await sleep(10);
      return stage.id === "b" ? fail(stage) : pass(stage);
    };

    const scheduler = new BrainScheduler(exec);
    const report = await scheduler.execute(stages);

    assert.ok(report.completed.includes("a"), "a doit réussir");
    assert.ok(report.completed.includes("c"), "c (indépendant) doit réussir malgré l'échec de b");
    assert.ok(report.failed.includes("b"), "b doit échouer");
    assert.ok(report.incomplete.includes("d"), "d doit être annulé car b a échoué");
    assert.equal(report.firstFailedStageId, "b");
    // d ne doit jamais avoir été exécuté
    assert.ok(!report.executionOrder.includes("d"), "d ne doit pas avoir démarré");
  });

  it("détecte proprement un deadlock quand toute la racine échoue", async () => {
    // a (échoue) -> b -> c : tout est bloqué
    const stages = [
      makeStage("a", "coder"),
      makeStage("b", "tester", ["a"]),
      makeStage("c", "reviewer", ["b"]),
    ];

    const exec: ExecuteStageFn = async (stage) => {
      await sleep(5);
      return stage.id === "a" ? fail(stage) : pass(stage);
    };

    const scheduler = new BrainScheduler(exec);
    const report = await scheduler.execute(stages);

    assert.ok(report.failed.includes("a"));
    assert.ok(report.incomplete.includes("b"));
    assert.ok(report.incomplete.includes("c"));
    assert.equal(report.completed.length, 0);
  });

  it("préserve les étapes déjà completed et ne réexécute que le reste", async () => {
    const a = makeStage("a", "researcher");
    a.status = "completed";
    a.result = { success: true, outcome: "success", summary: "déjà fait", filesModified: [], durationMs: 0 };
    const stages = [a, makeStage("b", "coder", ["a"])];

    const executed: string[] = [];
    const exec: ExecuteStageFn = async (stage) => {
      executed.push(stage.id);
      return pass(stage);
    };

    const scheduler = new BrainScheduler(exec);
    const report = await scheduler.execute(stages);

    assert.deepEqual(executed, ["b"], "seule b doit être exécutée");
    assert.ok(report.completed.includes("a"));
    assert.ok(report.completed.includes("b"));
  });
});
