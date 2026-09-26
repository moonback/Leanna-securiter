import test from "node:test";
import assert from "node:assert/strict";
import { agentsSkill } from "./agents.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers — Mocks simples pour agentOrchestrator
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * On ne peut pas facilement mocker le module `../agents` sans outils externes,
 * mais on peut tester la structure de la skill, ses déclarations, et les erreurs
 * de validation (avant qu'elle n'appelle l'orchestrator).
 * Pour les cas de succès, on mock via test.mock.method sur l'orchestrator importé.
 */
import { agentOrchestrator, listAgentDefinitions } from "../agents/index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Tests : Structure et déclarations de la skill
// ═══════════════════════════════════════════════════════════════════════════════

test("agentsSkill — nom de skill correct", () => {
  assert.equal(agentsSkill.name, "agents");
});

test("agentsSkill — déclare tous les outils attendus", () => {
  const toolNames = agentsSkill.declarations.map((d) => d.name);
  const expected = [
    "agent_delegate",
    "agent_orchestrate",
    "agent_status",
    "agent_list_tasks",
    "agent_list_roles",
    "agent_cancel",
    "agent_cancel_orchestration",
    "agent_stats",
    "agent_collaborate",
    "agent_fleet_status",
    "agent_list_collaboration_patterns",
    "agent_delegation_matrix",
    "agent_bus_metrics",
    "assistant_logs",
    "agent_message_history",
    "agent_brain",
  ];
  for (const name of expected) {
    assert.ok(toolNames.includes(name), `Outil "${name}" doit être déclaré`);
  }
  assert.equal(toolNames.length, expected.length, "Nombre exact d'outils");
});

test("agentsSkill — chaque déclaration a un nom et une description", () => {
  for (const decl of agentsSkill.declarations) {
    assert.ok(decl.name, "Chaque déclaration doit avoir un nom");
    assert.ok(decl.description, `"${decl.name}" doit avoir une description`);
    assert.ok(decl.description.length > 10, `"${decl.name}" description trop courte`);
  }
});

test("agentsSkill — inputSchemas définis pour chaque outil", () => {
  const schemaKeys = Object.keys(agentsSkill.inputSchemas!);
  const expected = [
    "agent_delegate",
    "agent_orchestrate",
    "agent_status",
    "agent_list_tasks",
    "agent_list_roles",
    "agent_cancel",
    "agent_stats",
  ];
  for (const name of expected) {
    assert.ok(schemaKeys.includes(name), `Schema pour "${name}" doit exister`);
  }
});

test("agentsSkill — agent_delegate déclare les paramètres requis", () => {
  const decl = agentsSkill.declarations.find((d) => d.name === "agent_delegate");
  assert.ok(decl);
  assert.ok(decl.parameters.required.includes("role"));
  assert.ok(decl.parameters.required.includes("title"));
  assert.ok(decl.parameters.required.includes("description"));
});

test("agentsSkill — agent_orchestrate déclare les paramètres requis", () => {
  const decl = agentsSkill.declarations.find((d) => d.name === "agent_orchestrate");
  assert.ok(decl);
  assert.ok(decl.parameters.required.includes("title"));
  assert.ok(decl.parameters.required.includes("description"));
  assert.ok(decl.parameters.required.includes("tasks"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests : Validation des arguments (erreurs Zod)
// ═══════════════════════════════════════════════════════════════════════════════

test("agent_delegate — rejette si rôle manquant", async () => {
  await assert.rejects(
    () => agentsSkill.handleToolCall("agent_delegate", { title: "Test", description: "Desc" }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_delegate — rejette si rôle invalide", async () => {
  await assert.rejects(
    () =>
      agentsSkill.handleToolCall("agent_delegate", {
        role: "invalid_role",
        title: "Test",
        description: "Desc",
      }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_delegate — rejette si titre vide", async () => {
  await assert.rejects(
    () =>
      agentsSkill.handleToolCall("agent_delegate", {
        role: "test",
        title: "",
        description: "Desc",
      }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_delegate — rejette si description manquante", async () => {
  await assert.rejects(
    () =>
      agentsSkill.handleToolCall("agent_delegate", {
        role: "test",
        title: "Mon titre",
      }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_orchestrate — rejette si tasks est vide", async () => {
  await assert.rejects(
    () =>
      agentsSkill.handleToolCall("agent_orchestrate", {
        title: "Orch",
        description: "Desc",
        tasks: [],
      }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_orchestrate — rejette si titre manquant", async () => {
  await assert.rejects(
    () =>
      agentsSkill.handleToolCall("agent_orchestrate", {
        description: "Desc",
        tasks: [{ role: "test", title: "T", description: "D" }],
      }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_status — rejette si taskId vide", async () => {
  await assert.rejects(
    () => agentsSkill.handleToolCall("agent_status", { taskId: "" }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

test("agent_cancel — rejette si taskId manquant", async () => {
  await assert.rejects(
    () => agentsSkill.handleToolCall("agent_cancel", {}),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests : handleToolCall — outil inconnu
// ═══════════════════════════════════════════════════════════════════════════════

test("handleToolCall — rejette un outil inconnu", async () => {
  await assert.rejects(
    () => agentsSkill.handleToolCall("nonexistent_tool", {}),
    (err: Error) => {
      assert.match(err.message, /inconnu/i);
      return true;
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests : handleToolCall — succès avec mocks sur l'orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

test("agent_delegate — succès avec mock delegateTask", async (t) => {
  const fakeTask = {
    id: "task-001",
    role: "test",
    title: "Créer tests unitaires",
    status: "pending",
    priority: "medium",
    createdAt: new Date().toISOString(),
    description: "Tests pour agents.ts",
    context: { files: ["server/skills/agents.ts"] },
  };

  t.mock.method(agentOrchestrator, "delegateTask", async () => fakeTask);

  const result = await agentsSkill.handleToolCall("agent_delegate", {
    role: "test",
    title: "Créer tests unitaires",
    description: "Tests pour agents.ts",
    files: ["server/skills/agents.ts"],
  });

  assert.equal(result.success, true);
  assert.equal(result.taskId, "task-001");
  assert.equal(result.role, "test");
  assert.equal(result.title, "Créer tests unitaires");
  assert.equal(result.status, "pending");
  assert.ok(result.hint.includes("task-001"));
});

test("agent_orchestrate — succès avec mock orchestrate", async (t) => {
  const fakePlan = {
    id: "orch-001",
    title: "Plan complet",
    description: "Refactor + tests",
    status: "running",
    createdAt: new Date().toISOString(),
    tasks: [
      { id: "t1", role: "refactor", title: "Refactor", status: "pending" },
      { id: "t2", role: "test", title: "Tests", status: "pending" },
    ],
    dependencies: { t2: ["t1"] },
  };

  t.mock.method(agentOrchestrator, "orchestrate", async () => fakePlan);

  const result = await agentsSkill.handleToolCall("agent_orchestrate", {
    title: "Plan complet",
    description: "Refactor + tests",
    tasks: [
      { role: "refactor", title: "Refactor", description: "Améliorer le code" },
      { role: "test", title: "Tests", description: "Ajouter des tests" },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.orchestrationId, "orch-001");
  assert.equal(result.taskCount, 2);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].role, "refactor");
  assert.equal(result.tasks[1].role, "test");
});

test("agent_status — retourne une tâche individuelle", async (t) => {
  const fakeTask = {
    id: "task-002",
    role: "docs",
    title: "Documentation API",
    status: "completed",
    priority: "high",
    createdAt: "2025-01-01T00:00:00Z",
    startedAt: "2025-01-01T00:00:01Z",
    completedAt: "2025-01-01T00:00:10Z",
    result: { success: true, summary: "Docs générées", durationMs: 9000 },
  };

  t.mock.method(agentOrchestrator, "getTask", () => fakeTask);

  const result = await agentsSkill.handleToolCall("agent_status", { taskId: "task-002" });

  assert.equal(result.type, "task");
  assert.equal(result.id, "task-002");
  assert.equal(result.role, "docs");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.result, { success: true, summary: "Docs générées", durationMs: 9000 });
});

test("agent_status — retourne une orchestration si pas de tâche", async (t) => {
  t.mock.method(agentOrchestrator, "getTask", () => undefined);

  const fakeOrch = {
    id: "orch-002",
    title: "Orch title",
    description: "Orch desc",
    status: "completed",
    createdAt: "2025-01-01T00:00:00Z",
    completedAt: "2025-01-01T00:01:00Z",
    tasks: [
      {
        id: "sub-1",
        role: "test",
        title: "Tests",
        status: "completed",
        result: { success: true, summary: "OK" },
      },
    ],
    dependencies: {},
  };

  t.mock.method(agentOrchestrator, "getOrchestration", () => fakeOrch);

  const result = await agentsSkill.handleToolCall("agent_status", { taskId: "orch-002" });

  assert.equal(result.type, "orchestration");
  assert.equal(result.id, "orch-002");
  assert.equal(result.tasks[0].role, "test");
  assert.equal(result.tasks[0].result.success, true);
});

test("agent_status — erreur si taskId introuvable", async (t) => {
  t.mock.method(agentOrchestrator, "getTask", () => undefined);
  t.mock.method(agentOrchestrator, "getOrchestration", () => undefined);

  await assert.rejects(
    () => agentsSkill.handleToolCall("agent_status", { taskId: "unknown-id" }),
    (err: Error) => {
      assert.match(err.message, /aucune tâche/i);
      return true;
    }
  );
});

test("agent_list_tasks — retourne la liste filtrée", async (t) => {
  const fakeTasks = [
    {
      id: "t1",
      role: "test",
      title: "Tests A",
      status: "completed",
      priority: "medium",
      createdAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:01:00Z",
      result: { success: true, summary: "OK", durationMs: 5000 },
    },
    {
      id: "t2",
      role: "test",
      title: "Tests B",
      status: "pending",
      priority: "low",
      createdAt: "2025-01-01T00:02:00Z",
      result: undefined,
    },
  ];

  t.mock.method(agentOrchestrator, "listTasks", () => fakeTasks);

  const result = await agentsSkill.handleToolCall("agent_list_tasks", { role: "test" });

  assert.equal(result.count, 2);
  assert.equal(result.tasks[0].id, "t1");
  assert.equal(result.tasks[1].id, "t2");
  assert.equal(result.tasks[0].hasResult, true);
  assert.equal(result.tasks[1].hasResult, false);
});

test("agent_list_roles — retourne les définitions d'agents", async (t) => {
  // listAgentDefinitions est une fonction pure exportée, on la teste directement
  const result = await agentsSkill.handleToolCall("agent_list_roles", {});

  assert.ok(result.count > 0, "Au moins un agent doit être défini");
  assert.ok(Array.isArray(result.agents));
  // Vérifier la structure de chaque agent
  for (const agent of result.agents) {
    assert.ok(agent.role, "Chaque agent doit avoir un rôle");
    assert.ok(agent.name, "Chaque agent doit avoir un nom");
    assert.ok(agent.description, "Chaque agent doit avoir une description");
    assert.ok(Array.isArray(agent.capabilities), "Capabilities doit être un tableau");
  }
});

test("agent_cancel — succès quand la tâche est pending", async (t) => {
  t.mock.method(agentOrchestrator, "cancelTask", () => true);

  const result = await agentsSkill.handleToolCall("agent_cancel", { taskId: "task-to-cancel" });

  assert.equal(result.success, true);
  assert.match(result.message, /annulée/i);
});

test("agent_cancel — erreur quand la tâche n'est pas annulable", async (t) => {
  t.mock.method(agentOrchestrator, "cancelTask", () => false);

  await assert.rejects(
    () => agentsSkill.handleToolCall("agent_cancel", { taskId: "task-running" }),
    (err: Error) => {
      assert.match(err.message, /impossible/i);
      return true;
    }
  );
});

test("agent_stats — retourne les statistiques", async (t) => {
  const fakeStats = {
    totalTasks: 15,
    byStatus: { pending: 2, running: 1, completed: 10, failed: 2, cancelled: 0 },
    byRole: { test: 5, docs: 3, refactor: 4, security: 1, review: 1, architect: 1 },
    activeOrchestrations: 1,
  };

  t.mock.method(agentOrchestrator, "getStats", () => fakeStats);

  const result = await agentsSkill.handleToolCall("agent_stats", {});

  assert.equal(result.totalTasks, 15);
  assert.equal(result.byStatus.completed, 10);
  assert.equal(result.byRole.test, 5);
  assert.equal(result.activeOrchestrations, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests : Validation des rôles acceptés
// ═══════════════════════════════════════════════════════════════════════════════

test("agent_delegate — accepte tous les rôles valides", async (t) => {
  const fakeTask = {
    id: "t-valid",
    role: "test",
    title: "T",
    status: "pending",
    priority: "medium",
    createdAt: new Date().toISOString(),
    description: "D",
    context: { files: [] },
  };

  t.mock.method(agentOrchestrator, "delegateTask", async () => fakeTask);

  const validRoles = ["test", "docs", "refactor", "security", "review", "architect"];
  for (const role of validRoles) {
    const result = await agentsSkill.handleToolCall("agent_delegate", {
      role,
      title: `Tâche ${role}`,
      description: `Description pour ${role}`,
    });
    assert.equal(result.success, true, `Le rôle "${role}" doit être accepté`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests : Priorités
// ═══════════════════════════════════════════════════════════════════════════════

test("agent_delegate — accepte toutes les priorités valides", async (t) => {
  const fakeTask = {
    id: "t-prio",
    role: "test",
    title: "T",
    status: "pending",
    priority: "medium",
    createdAt: new Date().toISOString(),
    description: "D",
    context: { files: [] },
  };

  t.mock.method(agentOrchestrator, "delegateTask", async () => fakeTask);

  const validPriorities = ["low", "medium", "high", "critical"];
  for (const priority of validPriorities) {
    const result = await agentsSkill.handleToolCall("agent_delegate", {
      role: "test",
      title: "Task",
      description: "Desc",
      priority,
    });
    assert.equal(result.success, true, `La priorité "${priority}" doit être acceptée`);
  }
});

test("agent_delegate — rejette une priorité invalide", async () => {
  await assert.rejects(
    () =>
      agentsSkill.handleToolCall("agent_delegate", {
        role: "test",
        title: "Task",
        description: "Desc",
        priority: "urgent", // invalide
      }),
    (err: Error) => {
      assert.match(err.message, /validation/i);
      return true;
    }
  );
});
