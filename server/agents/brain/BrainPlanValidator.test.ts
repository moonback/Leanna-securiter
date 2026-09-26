/**
 * Tests unitaires — BrainPlanValidator
 *
 * Couvre :
 * 1. Validation d'un plan linéaire valide
 * 2. Détection de dépendance orpheline
 * 3. Détection de cycle
 * 4. Détection d'id dupliqué
 * 5. Détection de rôle inconnu
 * 6. Génération Mermaid (graph TD, nœuds, arêtes)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BrainPlanValidator } from "./BrainPlanValidator.js";
import type { BrainPlan, BrainStage } from "./types.js";

function makeStage(id: string, role: BrainStage["agentRole"], dependsOn: string[] = []): BrainStage {
  return {
    id,
    title: `Étape ${id}`,
    description: `Description ${id}`,
    agentRole: role,
    agentReason: "Raison de test",
    skills: ["codebase"],
    tools: ["read_project_file"],
    files: [],
    instructions: "Instructions de test",
    dependsOn,
    status: "pending",
    priority: "high",
  };
}

function makePlan(stages: BrainStage[]): BrainPlan {
  return {
    id: "plan-test",
    goal: "Objectif de test",
    understanding: {
      intent: "Test",
      domain: "general",
      complexity: "moderate",
      keyTechnologies: [],
      relevantFiles: [],
      requirements: [],
      successCriteria: [],
      potentialRisks: [],
      rationale: "",
    },
    stages,
    estimatedDurationMs: 0,
    architectureRationale: "",
    createdAt: new Date().toISOString(),
    status: "planned",
  };
}

describe("BrainPlanValidator.validate", () => {
  const validator = new BrainPlanValidator();

  it("accepte un plan linéaire valide", () => {
    const plan = makePlan([
      makeStage("stage-1", "coder"),
      makeStage("stage-2", "tester", ["stage-1"]),
      makeStage("stage-3", "reviewer", ["stage-2"]),
    ]);
    const result = validator.validate(plan);
    assert.equal(result.ok, true, `Issues: ${result.issues.join(" | ")}`);
    assert.equal(result.issues.length, 0);
  });

  it("accepte un DAG diamant valide", () => {
    const plan = makePlan([
      makeStage("a", "researcher"),
      makeStage("b", "coder", ["a"]),
      makeStage("c", "coder", ["a"]),
      makeStage("d", "reviewer", ["b", "c"]),
    ]);
    const result = validator.validate(plan);
    assert.equal(result.ok, true, `Issues: ${result.issues.join(" | ")}`);
  });

  it("rejette une dépendance orpheline", () => {
    const plan = makePlan([
      makeStage("stage-1", "coder"),
      makeStage("stage-2", "tester", ["stage-inexistant"]),
    ]);
    const result = validator.validate(plan);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes("orpheline")), `Issues: ${result.issues.join(" | ")}`);
  });

  it("rejette un cycle (A→B→A)", () => {
    const plan = makePlan([
      makeStage("a", "coder", ["b"]),
      makeStage("b", "tester", ["a"]),
    ]);
    const result = validator.validate(plan);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes("Cycle")), `Issues: ${result.issues.join(" | ")}`);
  });

  it("rejette une auto-dépendance", () => {
    const plan = makePlan([makeStage("a", "coder", ["a"])]);
    const result = validator.validate(plan);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes("Auto-dépendance")), `Issues: ${result.issues.join(" | ")}`);
  });

  it("rejette un id d'étape dupliqué", () => {
    const plan = makePlan([
      makeStage("dup", "coder"),
      makeStage("dup", "tester"),
    ]);
    const result = validator.validate(plan);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes("dupliqué")), `Issues: ${result.issues.join(" | ")}`);
  });

  it("rejette un rôle d'agent inconnu", () => {
    const plan = makePlan([makeStage("stage-1", "role_bidon_xyz" as BrainStage["agentRole"])]);
    const result = validator.validate(plan);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes("inconnu")), `Issues: ${result.issues.join(" | ")}`);
  });

  it("rejette un plan sans étape", () => {
    const plan = makePlan([]);
    const result = validator.validate(plan);
    assert.equal(result.ok, false);
  });
});

describe("BrainPlanValidator.toMermaid", () => {
  const validator = new BrainPlanValidator();

  it("produit un graph TD avec un nœud par étape et une arête par dépendance", () => {
    const plan = makePlan([
      makeStage("stage-1", "coder"),
      makeStage("stage-2", "tester", ["stage-1"]),
    ]);
    const mermaid = validator.toMermaid(plan);

    assert.ok(mermaid.startsWith("graph TD"), "Doit commencer par 'graph TD'");
    // Deux nœuds
    assert.ok(mermaid.includes("stage_1["), "Nœud stage-1 attendu");
    assert.ok(mermaid.includes("stage_2["), "Nœud stage-2 attendu");
    // Exactement une arête
    const edges = mermaid.split("\n").filter((l) => l.includes("-->"));
    assert.equal(edges.length, 1, `Une seule arête attendue, reçu: ${edges.length}`);
    assert.ok(edges[0].includes("stage_1 --> stage_2"), `Arête stage_1 --> stage_2 attendue: ${edges[0]}`);
  });

  it("produit une arête par dépendance dans un DAG diamant", () => {
    const plan = makePlan([
      makeStage("a", "researcher"),
      makeStage("b", "coder", ["a"]),
      makeStage("c", "coder", ["a"]),
      makeStage("d", "reviewer", ["b", "c"]),
    ]);
    const mermaid = validator.toMermaid(plan);
    const edges = mermaid.split("\n").filter((l) => l.includes("-->"));
    assert.equal(edges.length, 4, `4 arêtes attendues, reçu: ${edges.length}`);
  });

  it("échappe les caractères problématiques dans les labels", () => {
    const stage = makeStage("s1", "coder");
    stage.title = 'Titre avec "guillemets" et [crochets] (parenthèses) {accolades} <chevrons> |pipe|';
    const plan = makePlan([stage]);
    const mermaid = validator.toMermaid(plan);

    // Le contenu du label (entre les guillemets du nœud) ne doit plus contenir
    // de métacaractère de forme Mermaid ni de guillemet double.
    const labelMatch = mermaid.match(/\["([^\n]*)"\]/);
    assert.ok(labelMatch, "Un label entre guillemets doit être présent");
    const label = labelMatch![1];
    assert.ok(!label.includes('"'), "Pas de guillemet double dans le label");
    assert.ok(!/[\[\]{}<>|]/.test(label), "Pas de crochet/accolade/chevron/pipe dans le label");
    assert.ok(!/[()]/.test(label), "Pas de parenthèse ASCII (remplacée par pleine largeur)");
  });
});
