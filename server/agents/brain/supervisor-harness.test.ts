/**
 * Supervisor Harness (Phase 6.5) — Test de bout en bout du superviseur
 * multi-agents (`AgentBrain.executeGoal`) avec :
 *   - un plan/understanding DÉTERMINISTES injectés (sans LLM) ;
 *   - une vérification d'étape HASHÉE réelle via `BrainVerifier(runTool)` +
 *     `WorkspaceState` (verify_file → VerificationRecord → hash gate) ;
 *   - un orchestrateur simulé qui écrit réellement des fichiers sur disque.
 *
 * Chaîne exercée :
 *   AgentBrain.executeGoal
 *     → planGoal (understanding/planner injectés) → BrainScheduler (DAG)
 *     → executeStage (delegateTask simulé, écrit un fichier)
 *     → BrainVerifier.verifyStage → runTool("verify_file") → WorkspaceState hash
 *     → (PASS | correction autonome) → BrainExecutionResult
 *
 * Scénarios :
 *   A. SUCCESS — l'étape écrit un fichier correct → verify hashé PASSE.
 *   B. REPAIR  — 1re écriture mauvaise → verify hashé ÉCHOUE → correction →
 *                2e écriture correcte → verify hashé PASSE.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

import { AgentBrain } from "./AgentBrain.js";
import { BrainVerifier } from "./BrainVerifier.js";
import type { BrainGoalInput, BrainPlan, BrainStage, GoalUnderstanding } from "./types.js";
import type { VerificationRecord } from "../WorkspaceState.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ── Répertoire temporaire réel (WorkspaceState lit sur disque). On utilise des
// CHEMINS ABSOLUS partout, de sorte que getProjectRoot n'est jamais consulté et
// qu'aucun monkey-patch d'export ESM n'est nécessaire. ──────────────────────
let tmpRoot: string;
let targetFile: string; // chemin absolu du fichier cible

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leanna-supervisor-"));
  fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
  targetFile = path.join(tmpRoot, "src", "example.ts");
  fs.writeFileSync(targetFile, "const value: string = 123;\n", "utf-8");
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ── Helpers de plan/understanding déterministes ─────────────────────────────
function makeUnderstanding(): GoalUnderstanding {
  return {
    intent: "Corriger l'erreur de type",
    domain: "bugfix",
    complexity: "moderate",
    keyTechnologies: ["TypeScript"],
    relevantFiles: ["src/example.ts"],
    requirements: ["Le fichier compile"],
    successCriteria: ["verify_file passe"],
    potentialRisks: [],
    rationale: "Test superviseur",
  };
}

function makeStage(id: string, role: BrainStage["agentRole"], dependsOn: string[] = []): BrainStage {
  return {
    id, title: `Étape ${id} (${role})`, description: `Corrige ${targetFile}`,
    agentRole: role, agentReason: "test", skills: ["codebase"],
    tools: ["modify_project_file", "verify_file"], files: [targetFile],
    instructions: "Corrige le type", dependsOn, status: "pending", priority: "high",
    verificationCriteria: ["compile"],
  };
}

function makePlan(stages: BrainStage[]): BrainPlan {
  return {
    id: "plan-supervisor", goal: "Corrige example.ts", understanding: makeUnderstanding(),
    stages, estimatedDurationMs: 1000, architectureRationale: "test",
    createdAt: new Date().toISOString(), status: "planned",
  };
}

function input(): BrainGoalInput {
  return { goal: "Corrige example.ts", contextFiles: [targetFile], mode: "auto", maxCorrectionAttempts: 2, maxReplans: 0 };
}

/** verify_file réel sur le FS temporaire : réussit si le fichier contient GOOD. */
function makeRunTool() {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name !== "verify_file") return { ok: true, status: "success" };
    const full = String(args.path); // chemin absolu
    const content = fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : "";
    const h = sha(content);
    const ok = content.includes("GOOD");
    const issues = ok ? [] : [{ type: "typecheck", file: full, line: 1, column: 7, severity: "error" as const, rule: "TS2322", message: "type error" }];
    const record: VerificationRecord = {
      file: full, contentHash: h, hashBefore: h, hashAfter: h, verifiedAt: new Date().toISOString(),
      ok, status: ok ? "success" : "failed", issues, allIssues: issues,
    };
    return { status: ok ? "success" : "failed", ok, fileChanged: true, verificationRecord: record };
  };
}

/** Orchestrateur simulé qui écrit réellement le fichier corrigé sur disque. */
function makeOrchestrator(writeForTask: (params: { role: string; title: string; index: number }) => string | null) {
  let counter = 0;
  const tasks = new Map<string, unknown>();
  const delegated: Array<{ role: string; title: string }> = [];
  return {
    delegated,
    canRunTool: true,
    async runTool() { return null; },
    async delegateTask(params: { role: string; title: string; files?: string[] }) {
      const index = counter++;
      const id = `task-${index}-${params.role}`;
      delegated.push({ role: params.role, title: params.title });
      const contentToWrite = writeForTask({ role: params.role, title: params.title, index });
      const filesModified: string[] = [];
      if (contentToWrite !== null) {
        fs.writeFileSync(targetFile, contentToWrite, "utf-8");
        filesModified.push(targetFile);
      }
      const task = {
        id, role: params.role, title: params.title, status: "completed",
        result: { success: true, outcome: "success", summary: "écrit", filesModified, durationMs: 1 },
      };
      tasks.set(id, task);
      return task;
    },
    getTask(id: string) { return tasks.get(id); },
  };
}

function makeBrain(orch: unknown, plan: BrainPlan): AgentBrain {
  const verifier = new BrainVerifier(makeRunTool());
  return new AgentBrain(orch as never, {
    understandingEngine: { understand: async () => makeUnderstanding() },
    planner: { plan: async () => JSON.parse(JSON.stringify(plan)) as BrainPlan },
    verifier,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
describe("Supervisor Harness — AgentBrain avec vérification d'étape HASHÉE", () => {
  it("A. SUCCESS : l'étape écrit un fix correct → verify_file hashé PASSE", async () => {
    fs.writeFileSync(targetFile, "const value: string = 123;\n", "utf-8");
    const plan = makePlan([makeStage("stage-1", "debugger")]);
    // L'agent écrit directement le bon contenu (marqueur GOOD).
    const orch = makeOrchestrator(() => "const value: number = 123; // GOOD\n");
    const brain = makeBrain(orch, plan);

    const result = await brain.executeGoal(input());

    assert.equal(result.success, true, `attendu succès: ${result.summary}`);
    assert.ok(result.filesModified.includes(targetFile));
    // La vérification hashée a réellement tourné et est passée.
    assert.ok(result.verifications.some((v) => v.passed && v.syntaxCheckOk));
    assert.ok(fs.readFileSync(targetFile, "utf-8").includes("GOOD"));
  });

  it("B. REPAIR : 1er fix mauvais → verify hashé ÉCHOUE → correction → verify PASSE", async () => {
    fs.writeFileSync(targetFile, "const value: string = 123;\n", "utf-8");
    const plan = makePlan([makeStage("stage-1", "debugger")]);
    // 1re délégation (initiale) : écrit un mauvais contenu (pas de GOOD) → verify échoue.
    // Délégation d'auto-correction (title contient "Auto-Correction") : écrit GOOD → verify passe.
    const orch = makeOrchestrator(({ title }) =>
      title.includes("Auto-Correction")
        ? "const value: number = 123; // GOOD\n"
        : "const value = 123; // BAD\n"
    );
    const brain = makeBrain(orch, plan);

    const result = await brain.executeGoal(input());

    assert.equal(result.success, true, `doit réussir après correction: ${result.summary}`);
    assert.ok(result.corrections.length >= 1, "au moins une correction enregistrée");
    assert.ok(result.corrections.some((c) => c.resolved), "une correction doit être resolved");
    // Preuve hashée : au moins une vérification échouée PUIS une réussie.
    assert.ok(result.verifications.some((v) => !v.passed), "une vérification hashée a échoué (1er patch)");
    assert.ok(result.verifications.some((v) => v.passed), "une vérification hashée a réussi (après fix)");
    assert.ok(fs.readFileSync(targetFile, "utf-8").includes("GOOD"));
  });
});
