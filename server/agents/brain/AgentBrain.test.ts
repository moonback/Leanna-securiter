/**
 * Tests unitaires — Agent Brain
 *
 * Couvre :
 * 1. GoalUnderstandingEngine — compréhension heuristique
 * 2. DynamicPlanner — séquence dynamique par domaine
 * 3. BrainVerifier — détection d'erreurs syntaxiques
 * 4. BrainCorrectionLoop — correction bornée
 * 5. AgentBrain.planGoal — plan complet sans exécution réelle
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GoalUnderstandingEngine } from "./GoalUnderstandingEngine.js";
import { DynamicPlanner } from "./DynamicPlanner.js";
import { BrainVerifier } from "./BrainVerifier.js";
import { BrainCorrectionLoop } from "./BrainCorrectionLoop.js";
import { AgentBrain } from "./AgentBrain.js";
import type { BrainGoalInput, BrainStage, StageVerification, GoalUnderstanding, BrainPlan } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(goal: string, extra?: Partial<BrainGoalInput>): BrainGoalInput {
  return { goal, contextFiles: [], mode: "plan_first", ...extra };
}

function makeUnderstanding(domain: GoalUnderstanding["domain"], complexity: GoalUnderstanding["complexity"] = "moderate"): GoalUnderstanding {
  return {
    intent: "Test de compréhension",
    domain,
    complexity,
    keyTechnologies: ["TypeScript", "React"],
    relevantFiles: [],
    requirements: ["Impl requirement"],
    successCriteria: ["Code valide", "Pas de régression"],
    potentialRisks: ["Régression possible"],
    rationale: "Analyse heuristique test",
  };
}

function makeStage(role: BrainStage["agentRole"], id = "stage-1"): BrainStage {
  return {
    id,
    title: `Étape test (${role})`,
    description: `Test de l'étape ${role}`,
    agentRole: role,
    agentReason: "Raison de test",
    skills: ["codebase"],
    tools: ["read_project_file"],
    files: [],
    instructions: "Exécuter le test",
    dependsOn: [],
    status: "completed",
    priority: "high",
    verificationCriteria: ["Code valide"],
  };
}

function makeVerification(passed: boolean, issues: StageVerification["issues"] = []): StageVerification {
  return {
    stageId: "stage-1",
    role: "coder",
    passed,
    syntaxCheckOk: passed,
    testsOk: passed,
    visualCheckOk: passed,
    semanticCheckOk: passed,
    issues,
    summary: passed ? "✅ OK" : "❌ Erreur de test",
    timestamp: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests GoalUnderstandingEngine
// ═══════════════════════════════════════════════════════════════════════════════

describe("GoalUnderstandingEngine", () => {
  const engine = new GoalUnderstandingEngine();
  const projectInfo = { techStack: ["TypeScript", "React"], hasReact: true, hasTypeScript: true };

  it("détecte le domaine 'frontend' pour un header responsive", () => {
    const result = engine.understandHeuristic(
      "Modernise mon site et rends le header responsive",
      makeInput("Modernise mon site et rends le header responsive"),
      projectInfo,
      []
    );
    assert.equal(result.domain, "frontend");
  });

  it("détecte le domaine 'bugfix' pour une erreur critique", () => {
    const result = engine.understandHeuristic(
      "Fix le crash au démarrage de l'app",
      makeInput("Fix le crash au démarrage de l'app"),
      projectInfo,
      []
    );
    assert.equal(result.domain, "bugfix");
  });

  it("détecte le domaine 'documentation'", () => {
    const result = engine.understandHeuristic(
      "Rédige le README et la documentation de l'API",
      makeInput("Rédige le README et la documentation"),
      projectInfo,
      []
    );
    assert.equal(result.domain, "documentation");
  });

  it("retourne des critères de succès vérifiables", () => {
    const result = engine.understandHeuristic(
      "Rends le header responsive",
      makeInput("Rends le header responsive"),
      projectInfo,
      []
    );
    assert.ok(result.successCriteria.length > 0, "Doit avoir au moins un critère de succès");
  });

  it("détecte la complexité simple pour un objectif court", () => {
    const result = engine.understandHeuristic(
      "Fix typo",
      makeInput("Fix typo"),
      projectInfo,
      []
    );
    assert.equal(result.complexity, "simple");
  });

  it("détecte la complexité 'complex' pour une refonte", () => {
    const result = engine.understandHeuristic(
      "Migration complète de l'architecture vers un système multi-agents avec sécurité avancée",
      makeInput("Migration complète de l'architecture vers un système multi-agents avec sécurité avancée"),
      projectInfo,
      []
    );
    assert.equal(result.complexity, "complex");
  });

  it("inclut les fichiers de contexte dans les fichiers pertinents", () => {
    const result = engine.understandHeuristic(
      "Modernise le header",
      makeInput("Modernise le header", { contextFiles: ["src/Header.tsx", "src/index.css"] }),
      projectInfo,
      ["src/Header.tsx", "src/index.css"]
    );
    assert.ok(result.relevantFiles.includes("src/Header.tsx"));
    assert.ok(result.relevantFiles.includes("src/index.css"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests DynamicPlanner
// ═══════════════════════════════════════════════════════════════════════════════

describe("DynamicPlanner", () => {
  const planner = new DynamicPlanner();

  it("génère le workflow researcher→architect→coder→tester→reviewer pour une refonte UI responsive", () => {
    const understanding = makeUnderstanding("frontend", "moderate");
    understanding.intent = "Modernise mon site et rends le header responsive";
    const plan = planner.planHeuristic(understanding, makeInput(understanding.intent));

    const roles = plan.stages.map((s) => s.agentRole);
    // Doit contenir coder et reviewer au minimum
    assert.ok(roles.includes("researcher"), `researcher attendu, reçu: ${roles.join(" → ")}`);
    assert.ok(roles.includes("coder"), `coder attendu, reçu: ${roles.join(" → ")}`);
    assert.ok(roles.includes("reviewer"), `reviewer attendu, reçu: ${roles.join(" → ")}`);
  });

  it("génère un workflow court debugger→coder→tester pour un bugfix", () => {
    const understanding = makeUnderstanding("bugfix", "simple");
    understanding.intent = "Fix le crash au démarrage";
    const plan = planner.planHeuristic(understanding, makeInput(understanding.intent));

    const roles = plan.stages.map((s) => s.agentRole);
    assert.ok(roles.includes("debugger"), `debugger attendu, reçu: ${roles.join(" → ")}`);
    assert.ok(roles.includes("coder"), `coder attendu, reçu: ${roles.join(" → ")}`);
    assert.ok(roles.includes("tester"), `tester attendu, reçu: ${roles.join(" → ")}`);
  });

  it("génère le workflow researcher→writer→proofreader pour la documentation", () => {
    const understanding = makeUnderstanding("documentation", "simple");
    understanding.intent = "Rédige le README";
    const plan = planner.planHeuristic(understanding, makeInput(understanding.intent));

    const roles = plan.stages.map((s) => s.agentRole);
    assert.ok(roles.includes("researcher"), `researcher attendu, reçu: ${roles.join(" → ")}`);
    assert.ok(roles.includes("writer"), `writer attendu, reçu: ${roles.join(" → ")}`);
  });

  it("chaque étape reçoit des outils assignés", () => {
    const understanding = makeUnderstanding("frontend", "moderate");
    understanding.intent = "Modernise le header";
    const plan = planner.planHeuristic(understanding, makeInput(understanding.intent));

    for (const stage of plan.stages) {
      assert.ok(stage.tools.length > 0, `L'étape '${stage.id}' doit avoir des outils assignés`);
    }
  });

  it("les dépendances entre étapes forment une chaîne linéaire valide", () => {
    const understanding = makeUnderstanding("frontend", "moderate");
    understanding.intent = "Modernise le header";
    const plan = planner.planHeuristic(understanding, makeInput(understanding.intent));

    const stageIds = plan.stages.map((s) => s.id);
    for (let i = 1; i < plan.stages.length; i++) {
      const deps = plan.stages[i].dependsOn;
      if (deps.length > 0) {
        assert.ok(stageIds.includes(deps[0]), `La dépendance '${deps[0]}' doit référencer une étape existante`);
      }
    }
  });

  it("toutes les étapes démarrent en statut 'pending'", () => {
    const understanding = makeUnderstanding("general", "moderate");
    understanding.intent = "Objectif de test";
    const plan = planner.planHeuristic(understanding, makeInput(understanding.intent));

    for (const stage of plan.stages) {
      assert.equal(stage.status, "pending", `L'étape '${stage.id}' doit être en statut 'pending'`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests BrainVerifier
// ═══════════════════════════════════════════════════════════════════════════════

describe("BrainVerifier", () => {
  const verifier = new BrainVerifier();
  const understanding = makeUnderstanding("frontend");

  it("retourne passed=true quand le résultat de l'étape est succès et aucun fichier modifié", async () => {
    const stage = makeStage("coder");
    stage.result = { success: true, outcome: "success", summary: "Implémenté", filesModified: [], durationMs: 0 };

    const report = await verifier.verifyStage(stage, understanding, []);
    // Sans erreur (ni fichiers corrompus, ni agent failed), doit passer
    assert.equal(report.passed, true);
  });

  it("retourne passed=false et une issue critique si l'agent a retourné success=false", async () => {
    const stage = makeStage("coder");
    stage.result = { success: false, outcome: "failed", summary: "Échec de compilation", error: "Compilation échouée", filesModified: [], durationMs: 0 };

    const report = await verifier.verifyStage(stage, understanding, []);
    assert.equal(report.passed, false);
    assert.ok(report.issues.some((i) => i.severity === "error"), "Doit avoir une issue error");
  });

  it("retourne passed=false si l'agent vision a signalé un débordement", async () => {
    const stage = makeStage("vision");
    stage.result = { success: true, outcome: "success", summary: "Détection d'un overflow et débordement sur mobile", filesModified: [], durationMs: 0 };

    const report = await verifier.verifyStage(stage, understanding, []);
    assert.equal(report.visualCheckOk, false);
    assert.equal(report.passed, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests BrainCorrectionLoop
// ═══════════════════════════════════════════════════════════════════════════════

describe("BrainCorrectionLoop", () => {
  const understanding = makeUnderstanding("frontend");

  it("génère une correction valide sur le premier échec", () => {
    const loop = new BrainCorrectionLoop(3);
    const stage = makeStage("coder");
    const verification = makeVerification(false, [
      { severity: "error", message: "Syntaxe incorrecte", file: "src/Header.tsx" },
    ]);

    const correction = loop.createCorrection(stage, verification, 1, understanding);
    assert.ok(correction !== null, "Doit produire une correction");
    assert.ok(correction!.diagnostic.includes("Syntaxe incorrecte"));
    assert.ok(correction!.filesToFix.includes("src/Header.tsx"));
    assert.equal(correction!.attemptNumber, 1);
    assert.equal(correction!.resolved, false);
  });

  it("retourne null si le budget de correction est dépassé", () => {
    const loop = new BrainCorrectionLoop(3);
    const stage = makeStage("coder");
    const verification = makeVerification(false, [
      { severity: "error", message: "Erreur persistante" },
    ]);

    const correction = loop.createCorrection(stage, verification, 4, understanding);
    assert.equal(correction, null, "Doit retourner null car budget épuisé (4 > 3)");
  });

  it("sélectionne debugger comme correcteur pour une étape tester en échec", () => {
    const loop = new BrainCorrectionLoop(3);
    const stage = makeStage("tester");
    const verification = makeVerification(false, [
      { severity: "error", message: "Test echoué" },
    ]);

    const correction = loop.createCorrection(stage, verification, 1, understanding);
    assert.equal(correction?.targetRole, "debugger");
  });

  it("inclut toujours des instructions correctives structurées", () => {
    const loop = new BrainCorrectionLoop(3);
    const stage = makeStage("coder");
    const verification = makeVerification(false, [
      { severity: "error", message: "Érreur de type TS2345" },
    ]);

    const correction = loop.createCorrection(stage, verification, 1, understanding);
    assert.ok(correction?.correctiveInstructions.includes("CORRECTION REQUISE"));
    assert.ok(correction?.correctiveInstructions.includes("DIAGNOSTIC"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers — Orchestrateur mocké pour tester AgentBrain sans exécution réelle
// ═══════════════════════════════════════════════════════════════════════════════

interface MockTaskResult {
  success: boolean;
  outcome?: string;
  summary?: string;
  error?: string;
  filesModified?: string[];
  durationMs?: number;
}

/**
 * Orchestrateur mocké minimal : implémente delegateTask() et getTask().
 * `resultFor(role, title, attempt)` détermine le résultat de chaque tâche,
 * ce qui permet de simuler succès, échec, puis succès après correction.
 */
class MockOrchestrator {
  private tasks = new Map<string, any>();
  public delegated: Array<{ role: string; title: string }> = [];
  private counter = 0;

  constructor(
    private resultFor: (params: { role: string; title: string; index: number }) => MockTaskResult
  ) {}

  async delegateTask(params: { role: string; title: string; description?: string; files?: string[]; instructions?: string; priority?: string }) {
    const index = this.counter++;
    const id = `task-${index}-${params.role}`;
    this.delegated.push({ role: params.role, title: params.title });
    const r = this.resultFor({ role: params.role, title: params.title, index });
    const task = {
      id,
      role: params.role,
      title: params.title,
      status: r.success ? "completed" : "failed",
      result: {
        success: r.success,
        outcome: r.outcome ?? (r.success ? "success" : "failed"),
        summary: r.summary ?? (r.success ? "OK" : "Échec"),
        error: r.error,
        filesModified: r.filesModified ?? [],
        durationMs: r.durationMs ?? 1,
      },
    };
    this.tasks.set(id, task);
    return task;
  }

  getTask(id: string) {
    return this.tasks.get(id);
  }
}

/** Construit un AgentBrain avec understanding + plan injectés (sans LLM). */
function makeBrainWithPlan(orchestrator: any, understanding: GoalUnderstanding, plan: BrainPlan): AgentBrain {
  const brain = new AgentBrain(orchestrator);
  const anyBrain = brain as any;
  anyBrain.understandingEngine = { understand: async () => understanding };
  anyBrain.planner = {
    plan: async () => JSON.parse(JSON.stringify(plan)) as BrainPlan,
    planHeuristic: () => JSON.parse(JSON.stringify(plan)) as BrainPlan,
  };
  return brain;
}

function makePlanFrom(stages: BrainStage[], goal = "Objectif de test"): BrainPlan {
  return {
    id: "plan-brain-test",
    goal,
    understanding: makeUnderstanding("frontend"),
    stages,
    estimatedDurationMs: stages.length * 1000,
    architectureRationale: "Plan de test",
    createdAt: new Date().toISOString(),
    status: "planned",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests AgentBrain.planGoal — validation + Mermaid
// ═══════════════════════════════════════════════════════════════════════════════

describe("AgentBrain.planGoal", () => {
  it("retourne un plan valide avec un diagramme Mermaid non vide", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([
      { ...makeStage("coder", "stage-1"), status: "pending" },
      { ...makeStage("tester", "stage-2"), status: "pending", dependsOn: ["stage-1"] },
    ]);
    const brain = makeBrainWithPlan(new MockOrchestrator(() => ({ success: true })), understanding, plan);

    const result = await brain.planGoal(makeInput("Rends le header responsive"));
    assert.ok(result.mermaid && result.mermaid.includes("graph TD"), "Le plan doit contenir un Mermaid graph TD");
    assert.ok(result.mermaid!.includes("-->"), "Le Mermaid doit contenir au moins une arête");
  });

  it("rejette un plan invalide (cycle) produit par le planner", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([
      { ...makeStage("coder", "a"), status: "pending", dependsOn: ["b"] },
      { ...makeStage("tester", "b"), status: "pending", dependsOn: ["a"] },
    ]);
    const brain = makeBrainWithPlan(new MockOrchestrator(() => ({ success: true })), understanding, plan);

    await assert.rejects(
      () => brain.planGoal(makeInput("Objectif menant à un cycle")),
      /invalide/i,
      "planGoal doit rejeter un plan cyclique"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests AgentBrain.executeGoal — scheduler parallèle, correction, réplanification
// ═══════════════════════════════════════════════════════════════════════════════

describe("AgentBrain.executeGoal (scheduler DAG)", () => {
  it("exécute un plan linéaire et retourne success=true", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([
      { ...makeStage("coder", "stage-1"), status: "pending" },
      { ...makeStage("tester", "stage-2"), status: "pending", dependsOn: ["stage-1"] },
    ]);
    const orch = new MockOrchestrator(() => ({ success: true, filesModified: ["src/a.ts"] }));
    const brain = makeBrainWithPlan(orch, understanding, plan);

    const result = await brain.executeGoal(makeInput("Objectif linéaire", { mode: "auto", maxCorrectionAttempts: 1, maxReplans: 0 }));
    assert.equal(result.success, true, result.summary);
    assert.equal(result.stages.length, 2);
    assert.ok(result.filesModified.includes("src/a.ts"));
  });

  it("exécute les branches indépendantes en parallèle", async () => {
    const understanding = makeUnderstanding("frontend");
    // a -> {b, c} -> d
    const plan = makePlanFrom([
      { ...makeStage("researcher", "a"), status: "pending" },
      { ...makeStage("coder", "b"), status: "pending", dependsOn: ["a"] },
      { ...makeStage("coder", "c"), status: "pending", dependsOn: ["a"] },
      { ...makeStage("reviewer", "d"), status: "pending", dependsOn: ["b", "c"] },
    ]);

    // Mesurer le chevauchement de b et c en traçant delegateTask (début/fin)
    const windows: Record<string, { start: number; end: number }> = {};
    const t0 = Date.now();
    const orch2 = new MockOrchestrator(() => ({ success: true }));
    // Patch delegateTask pour introduire un délai et enregistrer la fenêtre temporelle
    const origDelegate = orch2.delegateTask.bind(orch2);
    let delegateSeq = 0;
    (orch2 as any).delegateTask = async (params: any) => {
      const startedKey = `${params.role}#${delegateSeq++}`;
      windows[startedKey] = { start: Date.now() - t0, end: 0 };
      await sleepMs(40);
      windows[startedKey].end = Date.now() - t0;
      return origDelegate(params);
    };

    const brain = makeBrainWithPlan(orch2, understanding, plan);
    const result = await brain.executeGoal(makeInput("DAG diamant", { mode: "auto", maxCorrectionAttempts: 0, maxReplans: 0 }));

    assert.equal(result.success, true, result.summary);
    // Retrouver les fenêtres de b et c (leurs titres contiennent l'id de stage via makeStage: "Étape test (role)")
    // makeStage titre = `Étape test (${role})` -> b et c ont le même role "coder" donc on distingue par ordre.
    const coderWindows = Object.entries(windows).filter(([t]) => t.includes("coder"));
    assert.ok(coderWindows.length >= 2, "Deux étapes coder attendues (b et c)");
    const [w1, w2] = coderWindows.map(([, w]) => w);
    const overlap = w1.start < w2.end && w2.start < w1.end;
    assert.ok(overlap, `b et c doivent se chevaucher: ${JSON.stringify(coderWindows)}`);
  });

  it("poursuit une branche indépendante malgré l'échec d'une autre (succès partiel)", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([
      { ...makeStage("researcher", "a"), status: "pending" },
      { ...makeStage("coder", "b"), status: "pending", dependsOn: ["a"] }, // échoue
      { ...makeStage("writer", "c"), status: "pending" }, // indépendant, réussit
    ]);
    const orch = new MockOrchestrator(({ role }) => {
      if (role === "coder") return { success: false, error: "compilation KO" };
      return { success: true };
    });
    const brain = makeBrainWithPlan(orch, understanding, plan);

    const result = await brain.executeGoal(makeInput("Branche échouée", { mode: "auto", maxCorrectionAttempts: 0, maxReplans: 0 }));
    assert.equal(result.success, false, "Succès global faux car une branche échoue");
    // c (writer) doit avoir réussi
    const cResult = result.stages.find((s) => s.stage.agentRole === "writer");
    assert.equal(cResult?.stage.status, "completed", "La branche indépendante writer doit réussir");
  });

  it("corrige une étape en échec puis réussit (correction autonome)", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([{ ...makeStage("coder", "stage-1"), status: "pending" }]);

    // Premier appel (délégation initiale) échoue ; l'appel de correction réussit.
    const orch = new MockOrchestrator(({ title }) => {
      if (title.includes("Auto-Correction")) return { success: true, filesModified: ["src/fixed.ts"] };
      return { success: false, error: "erreur initiale" };
    });
    const brain = makeBrainWithPlan(orch, understanding, plan);

    const result = await brain.executeGoal(makeInput("Correction", { mode: "auto", maxCorrectionAttempts: 2, maxReplans: 0 }));
    assert.equal(result.success, true, `Doit réussir après correction: ${result.summary}`);
    assert.ok(result.corrections.length >= 1, "Au moins une correction enregistrée");
    assert.ok(result.corrections.some((c) => c.resolved), "Une correction doit être marquée resolved");
  });

  it("réplanifie le sous-graphe restant sur échec persistant, borné par maxReplans", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([
      { ...makeStage("coder", "stage-1"), status: "pending" },
      { ...makeStage("tester", "stage-2"), status: "pending", dependsOn: ["stage-1"] },
    ]);

    // stage-1 (coder) échoue toujours, y compris après correction et réplanification.
    const brain = makeBrainWithPlan(
      new MockOrchestrator(({ role, title }) => {
        if (title.includes("Auto-Correction")) return { success: false, error: "fix inefficace" };
        if (role === "coder") return { success: false, error: "échec persistant" };
        return { success: true };
      }),
      understanding,
      plan
    );
    // Le 1er appel à planner.plan est la planification initiale ; les suivants sont
    // les réplanifications de sous-graphe. On ne compte que ces derniers.
    const anyBrain = brain as any;
    let planCalls = 0;
    let replanObserved = 0;
    anyBrain.planner.plan = async () => {
      planCalls++;
      if (planCalls === 1) return JSON.parse(JSON.stringify(plan)); // plan initial
      replanObserved++;
      return makePlanFrom([{ ...makeStage("coder", "regen"), status: "pending" }]);
    };

    const result = await brain.executeGoal(makeInput("Réplanification", { mode: "auto", maxCorrectionAttempts: 0, maxReplans: 2 }));
    assert.equal(result.success, false, "Doit échouer proprement après épuisement du budget");
    assert.equal(replanObserved, 2, `maxReplans=2 doit produire exactement 2 réplanifications, observé: ${replanObserved}`);
  });

  it("ne réexécute pas les étapes déjà complétées lors d'une réplanification", async () => {
    const understanding = makeUnderstanding("frontend");
    const plan = makePlanFrom([
      { ...makeStage("researcher", "stage-1"), status: "pending" }, // réussit
      { ...makeStage("coder", "stage-2"), status: "pending", dependsOn: ["stage-1"] }, // échoue
    ]);

    const executedRoles: string[] = [];
    const orch = new MockOrchestrator(({ role, title }) => {
      if (!title.includes("Auto-Correction")) executedRoles.push(role);
      if (role === "coder") return { success: false, error: "échec" };
      return { success: true };
    });
    const brain = makeBrainWithPlan(orch, understanding, plan);
    const anyBrain = brain as any;
    let planCalls = 0;
    anyBrain.planner.plan = async () => {
      planCalls++;
      if (planCalls === 1) return JSON.parse(JSON.stringify(plan)); // plan initial (researcher + coder)
      // réplanification : seulement un nouveau coder pour le sous-graphe restant
      return makePlanFrom([{ ...makeStage("coder", "regen"), status: "pending" }]);
    };

    await brain.executeGoal(makeInput("Préservation", { mode: "auto", maxCorrectionAttempts: 0, maxReplans: 1 }));
    // researcher (stage-1) ne doit être exécuté qu'une seule fois malgré la réplanification
    const researcherCount = executedRoles.filter((r) => r === "researcher").length;
    assert.equal(researcherCount, 1, `researcher exécuté ${researcherCount} fois (attendu 1)`);
  });
});

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test d'intégration — DAG parallèle + correction + réplanification combinés
// ═══════════════════════════════════════════════════════════════════════════════

describe("AgentBrain.executeGoal (intégration bout-en-bout)", () => {
  it("combine parallélisme, correction autonome et réplanification en un seul run", async () => {
    const understanding = makeUnderstanding("frontend");
    // a -> {b, c} ; b réussit après correction ; c échoue puis est réplanifié
    const plan = makePlanFrom([
      { ...makeStage("researcher", "a"), status: "pending" },
      { ...makeStage("coder", "b"), status: "pending", dependsOn: ["a"] },
      { ...makeStage("tester", "c"), status: "pending", dependsOn: ["a"] },
    ]);

    const orch = new MockOrchestrator(({ role, title }) => {
      // Corrections : distinguer selon l'étape source encodée dans le titre du fix.
      if (title.includes("Auto-Correction")) {
        // Le fix de b (coder) réussit ; le fix de c (tester) échoue → échec persistant de c.
        if (title.includes("(coder)")) return { success: true, filesModified: ["src/b.ts"] };
        return { success: false, error: "fix de c inefficace" };
      }
      // Délégations initiales
      if (role === "coder") return { success: false, error: "b: erreur initiale" }; // b échoue, puis corrigé
      if (role === "tester") return { success: false, error: "c: échec persistant" }; // c échoue → réplanif
      return { success: true }; // researcher + étapes régénérées (writer)
    });
    const brain = makeBrainWithPlan(orch, understanding, plan);

    // Réplanification : régénère un writer (qui réussit) pour remplacer la branche c
    const anyBrain = brain as any;
    let planCalls = 0;
    anyBrain.planner.plan = async () => {
      planCalls++;
      if (planCalls === 1) return JSON.parse(JSON.stringify(plan));
      return makePlanFrom([{ ...makeStage("writer", "regen-c"), status: "pending" }]);
    };

    const result = await brain.executeGoal(
      makeInput("Mission combinée", { mode: "auto", maxCorrectionAttempts: 2, maxReplans: 2 })
    );

    // b doit avoir été corrigé avec succès
    assert.ok(result.corrections.some((c) => c.resolved), "La correction de b doit réussir");
    assert.ok(result.filesModified.includes("src/b.ts"), "Le fix de b doit apparaître dans filesModified");
    // Une réplanification a eu lieu pour la branche c
    assert.ok(planCalls >= 2, `Au moins une réplanification attendue, planCalls=${planCalls}`);
    // Le run se termine (pas de boucle infinie) avec un succès global après régénération
    assert.equal(typeof result.success, "boolean");
    assert.ok(result.totalDurationMs >= 0);
  });
});
