/**
 * Tests du nouveau Runtime — Vérifie les composants core
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { AgentRuntime } from "./AgentRuntime.js";
import { EventBus } from "./EventBus.js";
import { StateMachine } from "./StateMachine.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { Memory } from "./Memory.js";
import { PromptRegistry } from "./PromptRegistry.js";
import { WorkflowEngine } from "./WorkflowEngine.js";
import { SkillManagerV2 } from "./compat/SkillManagerV2.js";
import { defineAgent } from "./agents/plugin.js";
import { createRuntime } from "./index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// EventBus
// ═══════════════════════════════════════════════════════════════════════════════

describe("EventBus", () => {
  it("devrait émettre et recevoir des événements", () => {
    const bus = new EventBus();
    let received = false;

    bus.on("task:created", () => { received = true; });
    bus.emit({ type: "task:created", task: {} as any });

    assert.equal(received, true);
  });

  it("devrait supporter les wildcards", () => {
    const bus = new EventBus();
    const events: string[] = [];

    bus.onAny((event) => events.push(event.type));
    bus.emit({ type: "task:created", task: {} as any });
    bus.emit({ type: "tool:called", toolName: "test" });

    assert.equal(events.length, 2);
  });

  it("devrait permettre le désabonnement", () => {
    const bus = new EventBus();
    let count = 0;

    const unsub = bus.on("task:created", () => { count++; });
    bus.emit({ type: "task:created", task: {} as any });
    unsub();
    bus.emit({ type: "task:created", task: {} as any });

    assert.equal(count, 1);
  });

  it("devrait compter les métriques", () => {
    const bus = new EventBus();
    bus.emit({ type: "task:created", task: {} as any });
    bus.emit({ type: "task:created", task: {} as any });
    bus.emit({ type: "tool:called", toolName: "x" });

    const metrics = bus.getMetrics();
    assert.equal(metrics["task:created"], 2);
    assert.equal(metrics["tool:called"], 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// StateMachine
// ═══════════════════════════════════════════════════════════════════════════════

describe("StateMachine", () => {
  it("devrait permettre les transitions valides", async () => {
    const fsm = new StateMachine();
    const task = { id: "1", state: "pending" } as any;

    const ok = await fsm.transition(task, "running");
    assert.equal(ok, true);
    assert.equal(task.state, "running");
  });

  it("devrait rejeter les transitions invalides", async () => {
    const fsm = new StateMachine();
    const task = { id: "1", state: "completed" } as any;

    const ok = await fsm.transition(task, "running");
    assert.equal(ok, false);
    assert.equal(task.state, "completed");
  });

  it("devrait détecter les états terminaux", () => {
    const fsm = new StateMachine();
    assert.equal(fsm.isTerminal("completed"), true);
    assert.equal(fsm.isTerminal("failed"), true);
    assert.equal(fsm.isTerminal("running"), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ToolRegistry
// ═══════════════════════════════════════════════════════════════════════════════

describe("ToolRegistry", () => {
  it("devrait enregistrer et appeler un outil", async () => {
    const registry = new ToolRegistry();
    registry.register({
      declaration: { name: "echo", description: "Retourne l'input", parameters: {} },
      handler: async (args) => ({ echo: args.text }),
    });

    const result = await registry.call("echo", { text: "hello" });
    assert.deepEqual(result, { echo: "hello" });
  });

  it("devrait lever une erreur pour un outil inconnu", async () => {
    const registry = new ToolRegistry();
    await assert.rejects(
      () => registry.call("inexistant", {}),
      (err: Error) => err.message.includes("introuvable")
    );
  });

  it("devrait compter les métriques", async () => {
    const registry = new ToolRegistry();
    registry.register({
      declaration: { name: "test", description: "", parameters: {} },
      handler: async () => "ok",
    });

    await registry.call("test", {});
    await registry.call("test", {});

    const metrics = registry.getToolMetrics();
    assert.equal(metrics["test"].calls, 2);
    assert.equal(metrics["test"].failures, 0);
  });

  it("devrait gérer le timeout", async () => {
    const registry = new ToolRegistry({ defaultTimeoutMs: 50 });
    registry.register({
      declaration: { name: "slow", description: "", parameters: {} },
      handler: async () => new Promise((r) => setTimeout(r, 200)),
    });

    await assert.rejects(
      () => registry.call("slow", {}),
      (err: Error) => err.message.includes("timeout")
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════════════════════

describe("Memory", () => {
  it("devrait stocker et récupérer des valeurs", async () => {
    const mem = new Memory();
    await mem.set("working", "test", { value: 42 });
    const result = mem.get("working", "test");
    assert.deepEqual(result, { value: 42 });
  });

  it("devrait respecter le TTL", async () => {
    const mem = new Memory();
    await mem.set("working", "expirable", "data", { ttl: 1 });
    // Attendre l'expiration
    await new Promise((r) => setTimeout(r, 5));
    const result = mem.get("working", "expirable");
    assert.equal(result, undefined);
  });

  it("devrait vider le working memory", async () => {
    const mem = new Memory();
    await mem.set("working", "a", 1);
    await mem.set("working", "b", 2);
    mem.clearWorking();
    assert.equal(mem.get("working", "a"), undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PromptRegistry
// ═══════════════════════════════════════════════════════════════════════════════

describe("PromptRegistry", () => {
  it("devrait enregistrer et rendre un template", () => {
    const reg = new PromptRegistry();
    reg.registerContent("greeting", "Bonjour {{name}} !");
    const rendered = reg.render("greeting", { variables: { name: "Alice" } });
    assert.equal(rendered, "Bonjour Alice !");
  });

  it("devrait supporter l'héritage", () => {
    const reg = new PromptRegistry();
    reg.registerContent("parent", "# Base\nContenu parent");
    reg.registerContent("child", "# Extension\nContenu enfant", { extends: "parent" });
    const rendered = reg.render("child");
    assert.ok(rendered.includes("Contenu parent"));
    assert.ok(rendered.includes("Contenu enfant"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WorkflowEngine
// ═══════════════════════════════════════════════════════════════════════════════

describe("WorkflowEngine", () => {
  it("devrait exécuter un workflow simple", async () => {
    const registry = new ToolRegistry();
    registry.register({
      declaration: { name: "add", description: "", parameters: {} },
      handler: async (args) => (args.a as number) + (args.b as number),
    });

    const engine = new WorkflowEngine({ tools: registry });
    const result = await engine.executeInline({
      id: "test",
      name: "Test",
      description: "Test workflow",
      steps: [
        { id: "s1", action: "add", args: { a: 1, b: 2 } },
        { id: "s2", action: "add", args: { a: 3, b: 4 }, dependsOn: ["s1"] },
      ],
    });

    assert.equal(result.success, true);
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0].result, 3);
    assert.equal(result.steps[1].result, 7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AgentRuntime
// ═══════════════════════════════════════════════════════════════════════════════

describe("AgentRuntime", () => {
  it("devrait créer un runtime avec les agents par défaut", () => {
    const runtime = createRuntime();
    const agents = runtime.listAgents();
    assert.ok(agents.length >= 6);
    assert.ok(agents.some((a) => a.id === "planner"));
    assert.ok(agents.some((a) => a.id === "writer"));
  });

  it("devrait enregistrer un agent custom", () => {
    const runtime = new AgentRuntime();
    const agent = defineAgent({
      id: "custom",
      name: "Custom Agent",
      description: "Test",
      capabilities: [],
      systemPrompt: "Tu es un agent de test.",
    });

    runtime.registerAgent(agent);
    const agents = runtime.listAgents();
    assert.ok(agents.some((a) => a.id === "custom"));
  });

  it("devrait soumettre et exécuter une tâche", async () => {
    const runtime = new AgentRuntime();
    const agent = defineAgent({
      id: "echo-agent",
      name: "Echo",
      description: "Retourne le titre",
      capabilities: [],
      systemPrompt: "",
      execute: async (context) => ({
        success: true,
        summary: `Done: ${context.title}`,
        durationMs: 1,
      }),
    });

    runtime.registerAgent(agent);
    await runtime.start();

    const task = await runtime.submit({
      agentId: "echo-agent",
      title: "Test Task",
      description: "Description",
    });

    const result = await runtime.waitForTask(task.id, 5000);
    assert.equal(result.success, true);
    assert.equal(result.summary, "Done: Test Task");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SkillManagerV2
// ═══════════════════════════════════════════════════════════════════════════════

describe("SkillManagerV2", () => {
  it("devrait enregistrer une skill et appeler ses outils", async () => {
    const sm = new SkillManagerV2();
    sm.registerSkill({
      name: "math",
      declarations: [
        { name: "add", description: "Addition" },
        { name: "multiply", description: "Multiplication" },
      ],
      handleToolCall: async (name, args) => {
        if (name === "add") return (args.a as number) + (args.b as number);
        if (name === "multiply") return (args.a as number) * (args.b as number);
        throw new Error("Unknown");
      },
    });

    const result = await sm.handleToolCall("add", { a: 3, b: 4 });
    assert.equal(result, 7);
  });

  it("devrait retourner les déclarations", () => {
    const sm = new SkillManagerV2();
    sm.registerSkill({
      name: "test",
      declarations: [{ name: "tool1", description: "T1" }],
      handleToolCall: async () => null,
    });

    const decls = sm.getToolDeclarations();
    assert.equal(decls.length, 1);
    assert.equal(decls[0].name, "tool1");
  });

  it("devrait retirer les anciens outils lors du remplacement d'une skill", () => {
    const sm = new SkillManagerV2();
    sm.registerSkill({
      name: "dynamic",
      declarations: [
        { name: "old_tool", description: "Ancien outil" },
        { name: "kept_tool", description: "Outil conservé" },
      ],
      handleToolCall: async () => null,
    });

    sm.registerSkill({
      name: "dynamic",
      declarations: [{ name: "kept_tool", description: "Outil actualisé" }],
      handleToolCall: async () => null,
    });

    assert.equal(sm.hasTool("old_tool"), false);
    assert.equal(sm.hasTool("kept_tool"), true);
    assert.equal(sm.getToolDeclarations()[0].description, "Outil actualisé");
  });
});
