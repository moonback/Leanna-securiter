/**
 * Autonomous Mission Harness (Phase 5.5) — Test de bout en bout de la chaîne
 * agentique complète avec un MODÈLE DÉTERMINISTE (fake LLM), sans réseau.
 *
 * Chaîne réellement exercée :
 *   AgentRuntime.run
 *     → plan (modèle) → execute (modèle → tool_calls) → ToolRegistry.call
 *     → WorkspaceState (hash) → verify_file (VerificationRecord)
 *     → recordVerification → (SUCCESS | RECOVER via AgentRepairLoop) → finalize
 *
 * Scénarios :
 *   A. SUCCESS       : read → fix → verify OK
 *   B. REPAIR        : write → verify FAIL → repair → write → verify PASS
 *   C. NO_PROGRESS   : même patch répété → stop (pas de boucle infinie)
 *   D. BUDGET        : writes jusqu'à maxWrite refusés au-delà, verify réservé dispo
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

import { ToolRegistry } from "../ToolRegistry.js";
import { PermissionPolicy } from "../PermissionPolicy.js";
import { EventBus } from "../EventBus.js";
import { dynamicAgentRegistry } from "../../agents/DynamicAgentRegistry.js";
import type { VerificationRecord } from "../../agents/WorkspaceState.js";
import { AgenticRuntime, type GenerateTextFn } from "./index.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ── Faux système de fichiers + outils réels du ToolRegistry ─────────────────
interface FakeFs {
  content: Map<string, string>;
  /** décide si verify_file réussit pour un contenu donné */
  isFixed: (content: string) => boolean;
}

function makeRegistry(fs: FakeFs) {
  const registry = new ToolRegistry({ permissionPolicy: new PermissionPolicy({ mode: "off" }) });
  const writes: Array<{ path: string; content: string }> = [];

  registry.register({
    declaration: { name: "read_project_file", description: "lit", parameters: { path: "string" } },
    handler: async (a) => ({ content: fs.content.get(String(a.path)) ?? "", status: "success" }),
    permissions: ["read"],
  });
  registry.register({
    declaration: { name: "modify_project_file", description: "modifie", parameters: { path: "string", content: "string" } },
    handler: async (a) => {
      const path = String(a.path);
      const content = String(a.content ?? "");
      fs.content.set(path, content);
      writes.push({ path, content });
      return { ok: true };
    },
    permissions: ["write"],
  });
  registry.register({
    declaration: { name: "verify_file", description: "vérifie", parameters: { path: "string" } },
    handler: async (a) => {
      const path = String(a.path);
      const content = fs.content.get(path) ?? "";
      const h = sha(content);
      const ok = fs.isFixed(content);
      const issues = ok ? [] : [{ type: "typecheck", file: path, line: 1, column: 7, severity: "error" as const, rule: "TS2322", message: "Type 'number' is not assignable to type 'string'." }];
      const record: VerificationRecord = {
        file: path, contentHash: h, hashBefore: h, hashAfter: h, verifiedAt: new Date().toISOString(),
        ok, status: ok ? "success" : "failed", issues, allIssues: issues,
      };
      return { status: ok ? "success" : "failed", ok, fileChanged: true, verificationRecord: record };
    },
    permissions: ["read"],
  });
  return { registry, writes };
}

function registerAgent(role: string): void {
  dynamicAgentRegistry.registerAgent(
    {
      role, name: `Test ${role}`, description: "test",
      capabilities: ["read_project_file", "modify_project_file", "verify_file"],
      systemPrompt: "Agent de test.", maxConcurrency: 1, defaultTimeoutMs: 30_000,
    },
    true
  );
}

/** Réponse "modèle" enveloppée au format attendu par le runtime. */
function reply(text: string): Awaited<ReturnType<GenerateTextFn>> {
  return { text, provider: "gemini", model: "fake-deterministic", tokenUsage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
}

const PLAN_JSON = JSON.stringify({
  intent: "Corriger l'erreur de type dans le fichier",
  successCriteria: ["verify_file passe"],
  rationale: "Corriger l'annotation de type",
  steps: [{ description: "Corriger src/example.ts", suggestedTools: ["modify_project_file", "verify_file"], verification: "verify_file OK" }],
});

const isPlanPrompt = (p: string) => /produis un plan|Analyse l'intention/i.test(p);
const isFinalPrompt = (p: string) => /synthèse finale/i.test(p);
const FINAL_JSON = JSON.stringify({ summary: "Corrigé", details: "type annotation fixée", deliverables: ["src/example.ts"], suggestions: [] });

/**
 * Construit un modèle déterministe : PLAN → [étapes scriptées] → FINAL.
 * `steps` est la file des réponses d'exécution (tool_calls ou texte final).
 */
function scriptedModel(steps: string[]): GenerateTextFn {
  let i = 0;
  return (async (opts: { prompt: string; systemPrompt?: string }) => {
    if (isPlanPrompt(opts.prompt)) return reply(PLAN_JSON);
    if (isFinalPrompt(opts.prompt)) return reply(FINAL_JSON);
    // Sinon : une étape d'exécution.
    const next = i < steps.length ? steps[i] : ""; // réponse finale vide = plus d'action
    i += 1;
    return reply(next);
  }) as GenerateTextFn;
}

const toolCall = (name: string, params: Record<string, unknown>) =>
  JSON.stringify({ tool_calls: [{ name, parameters: params }] });

describe("Mission Harness — chaîne agentique de bout en bout (fake LLM)", () => {
  beforeEach(() => registerAgent("harness_fixer"));

  it("A. SUCCESS : read → fix → verify OK, avec preuve observable complète", async () => {
    const fs: FakeFs = {
      content: new Map([["src/example.ts", "const value: string = 123;"]]),
      isFixed: (c) => c.includes("const value: number = 123"),
    };
    const { registry, writes } = makeRegistry(fs);
    const model = scriptedModel([
      // étape 1 : lire puis corriger
      toolCall("modify_project_file", { path: "src/example.ts", content: "const value: number = 123;" }),
      // étape 2 : plus d'action → réponse finale
      "Terminé.",
    ]);
    const runtime = new AgenticRuntime({ registry, events: new EventBus(), model });

    const result = await runtime.run({ role: "harness_fixer", goal: "Corrige une erreur dans src/example.ts", id: "mA" });

    assert.equal(result.success, true, "la mission doit réussir");
    assert.equal(result.outcome, "success");
    assert.deepEqual(result.filesModified, ["src/example.ts"]);
    assert.ok(writes.some((w) => w.content.includes("number")), "le fix doit avoir été écrit sur disque");
    // budget consommé de façon plausible : au moins 1 write + 1 verify
    assert.ok(result.budgetUsage.writeCalls >= 1);
    assert.ok(result.budgetUsage.verifyCalls >= 1);
    assert.ok(result.budgetUsage.toolCalls >= 2);
    // preuve de vérification hashée dans le résultat
    assert.ok(result.verifications.some((v) => v.passed), "au moins une vérification passée");
  });

  it("B. REPAIR : write → verify FAIL → repair → write → verify PASS", async () => {
    let attempts = 0;
    const fs: FakeFs = {
      content: new Map([["src/example.ts", "const value: string = 123;"]]),
      // le premier fix est mauvais, le second est bon
      isFixed: (c) => c.includes("GOOD"),
    };
    const { registry } = makeRegistry(fs);
    const model = scriptedModel([
      toolCall("modify_project_file", { path: "src/example.ts", content: "const value = 123; // BAD" }), // verify FAIL
      toolCall("modify_project_file", { path: "src/example.ts", content: "const value: number = 123; // GOOD" }), // verify PASS
      "Terminé.",
    ]);
    // trace des tentatives via le compteur d'écritures
    const runtime = new AgenticRuntime({ registry, events: new EventBus(), model });

    const result = await runtime.run({ role: "harness_fixer", goal: "Corrige src/example.ts", id: "mB" });

    void attempts;
    assert.ok(result.recoveries.length >= 1, "au moins une récupération (repair) doit avoir eu lieu");
    assert.ok(result.filesModified.includes("src/example.ts"));
    assert.ok(result.budgetUsage.writeCalls >= 2, "deux écritures : le patch initial puis la correction");
    assert.equal(fs.content.get("src/example.ts")?.includes("GOOD"), true, "le fichier final contient le bon fix");
  });

  it("C. NO_PROGRESS : même patch répété → stop, pas de boucle infinie", async () => {
    const fs: FakeFs = {
      content: new Map([["src/example.ts", "const value: string = 123;"]]),
      isFixed: () => false, // verify échoue TOUJOURS
    };
    const { registry, writes } = makeRegistry(fs);
    const samePatch = toolCall("modify_project_file", { path: "src/example.ts", content: "const value = 123; // SAME" });
    // Le modèle répète indéfiniment le MÊME patch.
    const model = scriptedModel(Array(20).fill(samePatch));
    const runtime = new AgenticRuntime({ registry, events: new EventBus(), model });

    const result = await runtime.run({ role: "harness_fixer", goal: "Corrige src/example.ts", id: "mC" });

    assert.equal(result.success, false, "la mission ne peut pas réussir");
    assert.ok(["failed", "blocked", "partial"].includes(result.outcome));
    // Preuve d'arrêt borné : le budget d'écriture n'est jamais dépassé, et la
    // boucle s'est arrêtée (pas de consommation illimitée).
    assert.ok(result.budgetUsage.writeCalls <= result.plan.steps.length + 9, "écritures bornées par le budget");
    assert.ok(writes.length <= 9, `pas d'écritures illimitées (observé: ${writes.length})`);
    assert.ok(result.budgetUsage.iterations <= 20, "itérations bornées");
    // une récupération a été tentée puis abandonnée (repair → stop)
    assert.ok(result.recoveries.some((r) => r.strategy === "abort"), "un abort (no-progress) doit apparaître");
  });

  it("D. BUDGET : verify réservé reste disponible même quand write est épuisé", async () => {
    const fs: FakeFs = { content: new Map([["f.ts", "x"]]), isFixed: () => true };
    const { registry } = makeRegistry(fs);
    const runtime = new AgenticRuntime({
      registry,
      events: new EventBus(),
      model: scriptedModel(["Terminé."]),
      budget: { maxWrite: 2, maxVerify: 6, maxRead: 8, maxPlan: 3, maxRecovery: 4 },
    });
    // Amorce une session hors LLM pour tester admitCall directement.
    const session = runtime._seedSessionForTest({ role: "harness_fixer", goal: "x", id: "mD" });
    session.usage.writeCalls = 2; // quota d'écriture atteint (maxWrite=2)

    // @ts-expect-error accès test à la méthode privée d'admission
    const write = runtime.admitCall(session, "write");
    // @ts-expect-error accès test
    const verify = runtime.admitCall(session, "verify");

    assert.equal(write.allowed, false, "write refusé au-delà du quota");
    assert.equal(verify.allowed, true, "verify TOUJOURS disponible (réserve étanche)");
  });
});
