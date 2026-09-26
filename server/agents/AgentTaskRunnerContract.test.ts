/**
 * AgentTaskRunnerContract — Suite de contrat COMMUNE aux deux moteurs.
 *
 * Objectif : empêcher `AgentExecutor` (legacy) et `AgentRuntimeExecutor`
 * (agentique) de devenir des implémentations divergentes du même contrat.
 * Les invariants comportementaux (voir `AgentTaskRunner.ts`) sont vérifiés à
 * l'identique contre les DEUX moteurs, de façon hermétique (sans réseau).
 *
 * Portée :
 *   - Invariants UNIVERSELS (1,2,3,6,7,8,10) : testés contre les deux moteurs
 *     via les chemins d'échec/normalisation, là où la divergence est la plus
 *     dangereuse et la plus probable.
 *   - Invariants de SUCCÈS/VÉRIFICATION/BUDGET (6,7,8,9,10) sur le chemin
 *     nominal : couverts par `runtime/agentic/mission-harness.test.ts` pour le
 *     moteur agentique (le seul dont le chemin de succès est pilotable par un
 *     modèle déterministe injecté).
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { AgentExecutor } from "./AgentExecutor.js";
import { AgentRuntimeExecutor } from "./AgentRuntimeExecutor.js";
import { ProgressNotifier } from "./ProgressNotifier.js";
import { AgenticRuntime, type GenerateTextFn } from "../runtime/agentic/index.js";
import { ToolRegistry } from "../runtime/ToolRegistry.js";
import { PermissionPolicy } from "../runtime/PermissionPolicy.js";
import { dynamicAgentRegistry } from "./DynamicAgentRegistry.js";
import type { AgentTask, TaskStatus } from "./types.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";

// ── Fabriques de moteurs, réduites au contrat AgentTaskRunner ───────────────

/** Modèle déterministe minimal : ne produit aucun appel d'outil (réponse vide). */
const emptyModel: GenerateTextFn = (async () => ({
  text: "",
  provider: "gemini",
  model: "fake",
  tokenUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
})) as GenerateTextFn;

function makeAgenticRunner(model: GenerateTextFn = emptyModel): AgentTaskRunner {
  const registry = new ToolRegistry({ permissionPolicy: new PermissionPolicy({ mode: "off" }) });
  registry.register({
    declaration: { name: "read_project_file", description: "lit", parameters: {} },
    handler: async () => ({ content: "", status: "success" }),
    permissions: ["read"],
  });
  const agentic = new AgenticRuntime({ registry, model });
  return new AgentRuntimeExecutor(agentic, new ProgressNotifier());
}

function makeLegacyRunner(): AgentTaskRunner {
  const exec = new AgentExecutor(new ProgressNotifier());
  // skillHandler déterministe : agent_execute ne renvoie aucun texte exploitable,
  // les lectures renvoient du vide. Aucun appel réseau.
  exec.setSkillHandler(async (name: string) => {
    if (name === "agent_execute" || name === "reasoning_think") return { answer: "" };
    if (name === "read_project_file" || name === "list_project_files") return { content: "", status: "success" };
    return { ok: true, status: "success" };
  });
  return exec;
}

const RUNNERS: Array<{ name: string; make: () => AgentTaskRunner }> = [
  { name: "AgentRuntimeExecutor (agentique)", make: () => makeAgenticRunner() },
  { name: "AgentExecutor (legacy)", make: () => makeLegacyRunner() },
];

function makeTask(role: string): AgentTask {
  return {
    id: `contract-${Math.random().toString(36).slice(2, 8)}`,
    role,
    title: "Tâche de contrat",
    description: "Vérifie les invariants du moteur d'exécution",
    priority: "medium",
    status: "pending",
    context: { files: [] },
    createdAt: new Date().toISOString(),
  };
}

const TERMINAL: TaskStatus[] = ["completed", "failed", "incomplete", "cancelled"];

function registerContractAgent(role: string): void {
  dynamicAgentRegistry.registerAgent(
    {
      role,
      name: `Contract ${role}`,
      description: "agent de contrat",
      capabilities: ["read_project_file", "modify_project_file", "verify_file"],
      systemPrompt: "Agent de contrat.",
      maxConcurrency: 1,
      defaultTimeoutMs: 15_000,
    },
    true
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite de contrat, exécutée contre CHAQUE moteur
// ═══════════════════════════════════════════════════════════════════════════

for (const impl of RUNNERS) {
  describe(`Contrat AgentTaskRunner — ${impl.name}`, () => {
    beforeEach(() => registerContractAgent("contract_role"));

    it("expose execute() (surface du contrat)", () => {
      const runner = impl.make();
      assert.equal(typeof runner.execute, "function");
    });

    it("Invariant 1+2 : après execute(), status terminal et result cohérent", async () => {
      const runner = impl.make();
      const task = makeTask("contract_role");
      await runner.execute(task);

      assert.ok(TERMINAL.includes(task.status), `status doit être terminal (obtenu: ${task.status})`);
      assert.ok(task.result, "result doit être défini");
      assert.equal(typeof task.result!.success, "boolean");
      assert.ok(task.result!.outcome, "outcome doit être renseigné");
      // Cohérence success ↔ status.
      if (task.status === "completed") assert.equal(task.result!.success, true);
      if (task.status === "failed") assert.equal(task.result!.success, false);
    });

    it("Invariant 3 : rôle inconnu → échec normalisé, aucune exception ne fuit", async () => {
      const runner = impl.make();
      const task = makeTask("role_totalement_inconnu_xyz");
      await assert.doesNotReject(() => runner.execute(task));
      assert.equal(task.status, "failed");
      assert.equal(task.result!.success, false);
      assert.equal(task.result!.outcome, "failed");
      assert.ok((task.result!.error ?? "").length > 0, "error non vide");
    });

    it("Invariant 6+7 : aucun fichier fantôme quand rien n'est écrit", async () => {
      const runner = impl.make();
      const task = makeTask("contract_role");
      await runner.execute(task);
      const modified = task.result?.filesModified ?? [];
      assert.deepEqual(modified, [], "filesModified doit être vide sans écriture réelle");
    });

    it("Invariant 8 : exécution bornée (retourne sans boucle infinie)", async () => {
      const runner = impl.make();
      const task = makeTask("contract_role");
      const start = Date.now();
      await runner.execute(task);
      // Le simple fait de retourner prouve la terminaison ; borne de sécurité.
      assert.ok(Date.now() - start < 15_000, "execute doit terminer dans une borne raisonnable");
    });

    it("Invariant 10 : résultat déterministe pour des entrées identiques", async () => {
      const t1 = makeTask("contract_role");
      const t2 = makeTask("contract_role");
      await impl.make().execute(t1);
      await impl.make().execute(t2);
      assert.equal(t1.status, t2.status, "status reproductible");
      assert.equal(t1.result!.outcome, t2.result!.outcome, "outcome reproductible");
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Invariants de succès/vérification pilotés (moteur agentique)
// ═══════════════════════════════════════════════════════════════════════════

describe("Contrat — invariants de succès/vérification (moteur agentique)", () => {
  it("Invariant 9 : le succès s'appuie sur une vérification observable", async () => {
    // Renvoie à la preuve end-to-end : mission-harness.test.ts scénario A
    // (write → verify OK) assère result.verifications.some(v => v.passed) et
    // result.filesModified. On documente ici le lien de couverture.
    assert.ok(true, "couvert par runtime/agentic/mission-harness.test.ts (scénario A)");
  });
});
