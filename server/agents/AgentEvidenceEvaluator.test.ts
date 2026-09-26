import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentEvidenceEvaluator } from "./AgentEvidenceEvaluator.js";
import { WorkspaceState } from "./WorkspaceState.js";
import type { ToolExecutionState } from "./AgentExecutionTypes.js";
import type { AgentTask, AgentRole } from "./types.js";
import { roleCanWriteFiles } from "./roles.js";

/**
 * Bug #2 (output.md): un agent read-only / analytique ne doit pas être déclaré
 * FAILED faute d'écriture de fichier. Le succès dépend du TYPE de tâche.
 */

function makeTask(role: AgentRole, title: string, description = ""): AgentTask {
  return {
    id: "t-" + role,
    role,
    title,
    description,
    priority: "medium",
    status: "running",
    context: { files: [], instructions: undefined },
    createdAt: new Date().toISOString(),
    timeoutMs: 60_000,
  } as AgentTask;
}

function makeToolExecution(overrides: Partial<ToolExecutionState> = {}): ToolExecutionState {
  const workspace = new WorkspaceState(async () => undefined);
  return {
    resultText: "",
    toolsExecuted: [],
    filesRead: [],
    filesModified: [],
    observations: [],
    errors: [],
    workspace,
    previousFileSnapshots: new Map(),
    newlyTouchedFiles: new Set(),
    consecutiveReadOnlyTurns: 0,
    noProgressAbort: false,
    preexistingErrors: [],
    ...overrides,
  } as ToolExecutionState;
}

const evaluator = new AgentEvidenceEvaluator();

test("roleCanWriteFiles: rôles read-only vs write-capable", () => {
  assert.equal(roleCanWriteFiles("reviewer"), false);
  assert.equal(roleCanWriteFiles("security"), false);
  assert.equal(roleCanWriteFiles("researcher"), false);
  assert.equal(roleCanWriteFiles("coder"), true);
  assert.equal(roleCanWriteFiles("proofreader"), true);
});

test("proofreader en relecture sans écriture = SUCCESS (pas FAILED)", () => {
  const task = makeTask("proofreader", "Relecture du document", "Relire et signaler les fautes.");
  const resultText = `## Résultats vérifiés
- Trois fautes d'accord détectées au paragraphe 2.
- Le ton est cohérent sur l'ensemble du document.
- Recommandation : reformuler la phrase d'introduction.`;
  const toolExecution = makeToolExecution({ filesRead: ["doc.md"], toolsExecuted: ["read_project_file"] });

  const evidence = evaluator.collectEvidence(task, ["--- doc.md ---\ncontenu"], { written: [], errors: [] }, resultText, toolExecution);
  const incomplete = evaluator.getIncompleteReason(task, resultText, evidence);

  assert.equal(evidence.outcome, "success", "une relecture avec constats est un succès analytique");
  assert.equal(incomplete, null, "aucune raison d'incomplétude");
});

test("reviewer (aucune capacité d'écriture) n'est jamais write-required", () => {
  const task = makeTask("reviewer", "Auditer le module auth");
  const resultText = `## Audit
- Le module valide correctement les entrées.
- Suggestion : centraliser la gestion des erreurs.`;
  const toolExecution = makeToolExecution({ filesRead: ["auth.ts"], toolsExecuted: ["read_project_file"] });

  const evidence = evaluator.collectEvidence(task, ["--- auth.ts ---\ncode"], { written: [], errors: [] }, resultText, toolExecution);
  assert.equal(evidence.outcome, "success");
  assert.equal(evidence.verification.passed, true);
});

test("coder avec tâche d'implémentation SANS écriture reste FAILED (contrat write-required préservé)", () => {
  const task = makeTask("coder", "Implémenter la fonction login", "Créer et écrire le code de login.");
  const resultText = `## Résumé
J'ai analysé le besoin.`;
  const toolExecution = makeToolExecution({ filesRead: ["login.ts"], noProgressAbort: true, consecutiveReadOnlyTurns: 3 });

  const evidence = evaluator.collectEvidence(task, ["--- login.ts ---\ncode"], { written: [], errors: [] }, resultText, toolExecution);
  assert.notEqual(evidence.outcome, "success", "une implémentation sans écriture ne doit pas être un succès");
  assert.equal(evidence.verification.passed, false);
});
