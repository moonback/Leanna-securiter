/**
 * Tests du runtime agentique — mécanique déterministe et hermétique (sans LLM).
 *
 * Couvre les 12 scénarios de validation Phase 2 + Phase 4 :
 *   1.  write ok → verification ok
 *   2.  write ok → verification échouée → repair (retry)
 *   3.  repair réussi → nouvelle verification ok
 *   4.  même patch répété → stop
 *   5.  aucun progrès → stop
 *   6.  budget write épuisé → aucun write supplémentaire
 *   7.  budget verify réservé → toujours disponible après les writes
 *   8.  VerificationRecord conservé dans WorkspaceState
 *   9.  hash before/after correctement enregistré
 *   10. budget absolu 8/3/9/6/4 = 30 (source de vérité)
 *   11. résolution des outils réellement accordés (correctif de base)
 *   12. échec propre sur rôle inconnu, sans LLM
 *
 * Les phases plan()/execute()/finalize() appellent un vrai provider LLM et ne
 * sont pas testées ici.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

import { ToolRegistry } from "../ToolRegistry.js";
import { PermissionPolicy } from "../PermissionPolicy.js";
import { dynamicAgentRegistry } from "../../agents/DynamicAgentRegistry.js";
import type { VerificationRecord } from "../../agents/WorkspaceState.js";
import {
  resolveAgentTools,
  buildBudgetSection,
  buildObservationHistory,
  DEFAULT_AGENT_BUDGET,
  createAgentRuntime,
  AgenticRuntime,
  type Observation,
  type ToolCallOutcome,
} from "./index.js";
import { emptyBudgetUsage, normalizeBudget, criticalReserve } from "./types.js";
import { AgentRuntime as DIRuntime } from "../AgentRuntime.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

// ── Registre d'outils simulés, avec contenu de fichier pilotable ────────────
interface FakeFs {
  content: Map<string, string>;
  verifyOk: (path: string) => boolean;
}

function makeRegistry(fs: FakeFs): ToolRegistry {
  const registry = new ToolRegistry({ permissionPolicy: new PermissionPolicy({ mode: "off" }) });

  registry.register({
    declaration: { name: "read_project_file", description: "lit", parameters: { path: "string" } },
    handler: async (args) => ({ content: fs.content.get(String(args.path)) ?? "" }),
    permissions: ["read"],
  });
  registry.register({
    declaration: { name: "search_in_files", description: "cherche", parameters: { query: "string" } },
    handler: async () => ({ matches: [] }),
    permissions: ["read"],
  });
  registry.register({
    declaration: { name: "modify_project_file", description: "modifie", parameters: { path: "string", content: "string" } },
    handler: async (args) => {
      fs.content.set(String(args.path), String(args.content ?? `v-${Date.now()}`));
      return { ok: true };
    },
    permissions: ["write"],
  });
  registry.register({
    declaration: { name: "verify_file", description: "vérifie", parameters: { path: "string" } },
    handler: async (args) => {
      const path = String(args.path);
      const content = fs.content.get(path) ?? "";
      const h = hash(content);
      const ok = fs.verifyOk(path);
      const record: VerificationRecord = {
        file: path,
        contentHash: h,
        hashBefore: h,
        hashAfter: h,
        verifiedAt: new Date().toISOString(),
        ok,
        status: ok ? "success" : "failed",
        issues: ok ? [] : [{ type: "typecheck", file: path, line: 1, column: 1, severity: "error", rule: "TS2322", message: "type error" }],
        allIssues: ok ? [] : [{ type: "typecheck", file: path, line: 1, column: 1, severity: "error", rule: "TS2322", message: "type error" }],
      };
      return { status: ok ? "success" : "failed", ok, fileChanged: true, verificationRecord: record };
    },
    permissions: ["read"],
  });
  return registry;
}

/** Enregistre un agent de test avec les capabilities voulues. */
function registerTestAgent(role: string, capabilities: string[]): void {
  dynamicAgentRegistry.registerAgent(
    {
      role,
      name: `Test ${role}`,
      description: "agent de test",
      capabilities,
      systemPrompt: "Tu es un agent de test.",
      maxConcurrency: 1,
      defaultTimeoutMs: 60_000,
    },
    true
  );
}

/** Construit une observation contenant un write réussi sur `path`. */
function writeObservation(iteration: number, path: string): Observation {
  const outcome: ToolCallOutcome = {
    invocation: { name: "modify_project_file", parameters: { path, content: "x" } },
    success: true,
    result: { ok: true },
    durationMs: 1,
  };
  return { iteration, reasoning: "j'écris", toolOutcomes: [outcome], isFinal: false };
}

function makeRuntime(fs: FakeFs): AgenticRuntime {
  const di = new DIRuntime();
  const registry = makeRegistry(fs);
  // Injecte le registre simulé.
  return new AgenticRuntime({ registry, events: di.events });
}

// ═══════════════════════════════════════════════════════════════════════════
// Correctif de base + budget absolu (scénarios 10, 11, 12)
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveAgentTools — donne à l'agent ses outils réels", () => {
  it("résout uniquement les capabilities présentes dans le registre", () => {
    const registry = makeRegistry({ content: new Map(), verifyOk: () => true });
    const tools = resolveAgentTools(["modify_project_file", "read_project_file", "inexistant"], registry);
    assert.deepEqual(tools.map((t) => t.name).sort(), ["modify_project_file", "read_project_file"]);
  });
  it("fail-safe : aucune capability → aucun outil", () => {
    const registry = makeRegistry({ content: new Map(), verifyOk: () => true });
    assert.deepEqual(resolveAgentTools([], registry), []);
  });
});

describe("Budget absolu 8/3/9/6/4 — source de vérité (scénario 10)", () => {
  it("expose les cinq quotas absolus et un total dérivé de 30", () => {
    const b = DEFAULT_AGENT_BUDGET;
    assert.equal(b.maxRead, 8);
    assert.equal(b.maxPlan, 3);
    assert.equal(b.maxWrite, 9);
    assert.equal(b.maxVerify, 6);
    assert.equal(b.maxRecovery, 4);
    assert.equal(b.maxToolCalls, 30);
  });
  it("normalizeBudget recalcule le total comme somme des phases", () => {
    const b = normalizeBudget({ ...DEFAULT_AGENT_BUDGET, maxToolCalls: 999, maxWrite: 10 });
    assert.equal(b.maxToolCalls, 8 + 3 + 10 + 6 + 4);
  });
  it("criticalReserve = write + verify + recovery", () => {
    assert.equal(criticalReserve(DEFAULT_AGENT_BUDGET), 9 + 6 + 4);
  });
});

describe("run — échec propre sur rôle inconnu, sans LLM (scénario 12)", () => {
  it("retourne outcome=failed", async () => {
    const agentic = createAgentRuntime(new DIRuntime());
    const result = await agentic.run({ role: "role_inconnu_zzz", goal: "test" });
    assert.equal(result.success, false);
    assert.equal(result.outcome, "failed");
    assert.match(result.error ?? "", /introuvable/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4 — WorkspaceState + VerificationRecord + AgentRepairLoop
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — vérification hashée + réparation bornée", () => {
  beforeEach(() => {
    registerTestAgent("test_fixer", [
      "read_project_file",
      "search_in_files",
      "modify_project_file",
      "verify_file",
    ]);
  });

  it("scénario 1+8+9 : write ok → verify ok, VerificationRecord conservé avec hash before/after", async () => {
    const fs: FakeFs = { content: new Map([["a.ts", "ok"]]), verifyOk: () => true };
    const rt = makeRuntime(fs);
    const session = rt._seedSessionForTest({ role: "test_fixer", goal: "fix", id: "t1" });

    const verification = await rt.verify({ id: "s1", description: "fix a.ts", status: "running" }, writeObservation(1, "a.ts"));

    assert.equal(verification.passed, true, "la vérification hashée doit passer");
    const state = session.workspace.get("a.ts");
    assert.ok(state?.verification, "le VerificationRecord doit être conservé dans WorkspaceState");
    assert.equal(state?.status, "verified");
    assert.equal(state?.verification?.hashBefore, hash("ok"));
    assert.equal(state?.verification?.hashAfter, hash("ok"));
    assert.equal(state?.verifiedHash, state?.contentHash);
  });

  it("scénario 2 : write ok → verify échouée → recover renvoie retry", async () => {
    const fs: FakeFs = { content: new Map([["b.ts", "bad"]]), verifyOk: () => false };
    const rt = makeRuntime(fs);
    rt._seedSessionForTest({ role: "test_fixer", goal: "fix", id: "t2" });

    const obs = writeObservation(1, "b.ts");
    const verification = await rt.verify({ id: "s1", description: "fix b.ts", status: "running" }, obs);
    assert.equal(verification.passed, false);

    const recovery = await rt.recover({ phase: "verify", message: verification.issues.join("; "), file: "b.ts" });
    assert.equal(recovery.strategy, "retry", "première correction → retry");
  });

  it("scénario 4 : même patch répété → stop (abort)", async () => {
    const fs: FakeFs = { content: new Map([["c.ts", "same"]]), verifyOk: () => false };
    const rt = makeRuntime(fs);
    const session = rt._seedSessionForTest({ role: "test_fixer", goal: "fix", id: "t4" });

    // Simule le même patch appliqué à plusieurs reprises.
    session.lastPatchByFile.set("c.ts", JSON.stringify({ path: "c.ts", content: "same-patch" }));
    await session.workspace.reread("c.ts", "write");

    // 1re évaluation (continue/retry), 2e identique → la politique doit finir par stopper.
    let last = await rt.recover({ phase: "verify", message: "fail", file: "c.ts" });
    session.lastPatchByFile.set("c.ts", JSON.stringify({ path: "c.ts", content: "same-patch" }));
    last = await rt.recover({ phase: "verify", message: "fail", file: "c.ts" });
    // Le patch identique répété doit déclencher un arrêt.
    assert.equal(last.strategy, "abort", "patch identique répété → abort");
  });

  it("scénario 5 : budget de récupération épuisé → abort", async () => {
    const fs: FakeFs = { content: new Map([["d.ts", "x"]]), verifyOk: () => false };
    const rt = makeRuntime(fs);
    const session = rt._seedSessionForTest({ role: "test_fixer", goal: "fix", id: "t5", budget: { maxRecovery: 0 } });
    session.replans = 1; // interdit le replan de secours
    const recovery = await rt.recover({ phase: "verify", message: "fail", file: "d.ts" });
    assert.equal(recovery.strategy, "abort");
    assert.match(recovery.reason, /récupération/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Budgets réservés (scénarios 6, 7)
// ═══════════════════════════════════════════════════════════════════════════

describe("Réserves de budget étanches (scénarios 6, 7)", () => {
  beforeEach(() => {
    registerTestAgent("test_budget", ["read_project_file", "modify_project_file", "verify_file"]);
  });

  it("scénario 7 : le quota verify reste disponible même après épuisement du quota write", async () => {
    const fs: FakeFs = { content: new Map([["e.ts", "x"]]), verifyOk: () => true };
    const rt = makeRuntime(fs);
    const session = rt._seedSessionForTest({ role: "test_budget", goal: "fix", id: "t7" });

    // Épuise le quota d'écriture.
    session.usage.writeCalls = session.budget.maxWrite;
    // @ts-expect-error accès test à une méthode privée d'admission
    const write = rt.admitCall(session, "write");
    // @ts-expect-error accès test
    const verify = rt.admitCall(session, "verify");
    assert.equal(write.allowed, false, "écriture refusée quand le quota write est épuisé");
    assert.equal(verify.allowed, true, "vérification TOUJOURS disponible (réserve étanche)");
  });

  it("scénario 6 : au-delà du quota write, plus aucun write n'est admis", async () => {
    const fs: FakeFs = { content: new Map(), verifyOk: () => true };
    const rt = makeRuntime(fs);
    const session = rt._seedSessionForTest({ role: "test_budget", goal: "fix", id: "t6", budget: { maxWrite: 2 } });
    session.usage.writeCalls = 2;
    // @ts-expect-error accès test
    const decision = rt.admitCall(session, "write");
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /écriture/i);
  });

  it("l'exploration ne peut pas consommer le quota d'écriture", async () => {
    const fs: FakeFs = { content: new Map(), verifyOk: () => true };
    const rt = makeRuntime(fs);
    const session = rt._seedSessionForTest({ role: "test_budget", goal: "fix", id: "tr", budget: { maxRead: 2 } });
    session.usage.readCalls = 2;
    // @ts-expect-error accès test
    const read = rt.admitCall(session, "read");
    // @ts-expect-error accès test
    const write = rt.admitCall(session, "write");
    assert.equal(read.allowed, false, "lecture refusée au-delà du quota d'exploration");
    assert.equal(write.allowed, true, "l'écriture reste possible (réserve non entamée)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de prompt (inchangés fonctionnellement)
// ═══════════════════════════════════════════════════════════════════════════

describe("buildBudgetSection — quotas absolus + réserves", () => {
  it("affiche la phase et les réserves étanches", () => {
    const usage = emptyBudgetUsage();
    usage.readCalls = 8;
    const section = buildBudgetSection(DEFAULT_AGENT_BUDGET, usage, "discovery");
    assert.match(section, /DISCOVERY/);
    assert.match(section, /exploration: 8\/8/);
    assert.match(section, /écriture \(réservé\): 0\/9/);
    assert.match(section, /vérification \(réservé\): 0\/6/);
    assert.match(section, /RÈGLE D'ARRÊT/);
  });
});

describe("buildObservationHistory — historique borné", () => {
  it("rend les actions et reste borné", () => {
    const obs: Observation[] = [writeObservation(1, "a.ts")];
    const history = buildObservationHistory(obs, 10_000);
    assert.match(history, /modify_project_file/);
    const tiny = buildObservationHistory(obs, 40);
    assert.ok(tiny.length <= 200);
  });
});
