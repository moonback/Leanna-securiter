# Guide d'intégration — Migration SkillManager → ToolRegistry

## Migration minimale (drop-in replacement)

### Avant (server.ts actuel)

```typescript
import { SkillManager } from "./server/skills/SkillManager";
const skillManager = new SkillManager();

// Plus tard dans le code...
const result = await skillManager.handleToolCall("read_project_file", { path: "..." });
const declarations = skillManager.getToolDeclarations();
```

### Après (avec SkillManagerV2)

```typescript
import { bootstrapRuntime } from "./server/runtime";
import { automationSkill } from "./server/skills/automation";
import { codebaseSkill } from "./server/skills/codebase";
import { gitSkill } from "./server/skills/git";
// ... etc

const { runtime, skillManager } = await bootstrapRuntime({
  skills: [
    automationSkill,
    codebaseSkill,
    gitSkill,
    githubSkill,
    guidelinesSkill,
    historySkill,
    knowledgeSkill,
    listSkill,
    memorySkill,
    reasoningSkill,
    systemSkill,
    timeSkill,
    verifySkill,
    weatherSkill,
    projectSkill,
    agentsSkill,
    missionSkill,
  ],
});

// Interface IDENTIQUE à l'ancien SkillManager :
const result = await skillManager.handleToolCall("read_project_file", { path: "..." });
const declarations = skillManager.getToolDeclarations();

// BONUS : accès direct au ToolRegistry pour les nouvelles fonctionnalités :
const metrics = runtime.tools.getToolMetrics();
const history = runtime.tools.getCallHistory();
```

## Migration des composants dépendants

### AgentOrchestrator

```typescript
// Avant
agentOrchestrator.setSkillHandler((name, args) => skillManager.handleToolCall(name, args));

// Après — Plus nécessaire ! Le runtime inclut déjà les outils.
// Les agents accèdent directement au ToolRegistry via runtime.tools
```

### Workflow Engine

```typescript
// Avant
setWorkflowSkillHandler((name, args) => skillManager.handleToolCall(name, args));

// Après
import { WorkflowEngine } from "./server/runtime";
const workflows = new WorkflowEngine({ tools: runtime.tools, eventBus: runtime.events });
```

### Mission System

```typescript
// Avant
const missionExecutor = new Executor();
missionExecutor.setSkillHandler((name, args) => skillManager.handleToolCall(name, args));

// Après
const missionExecutor = new Executor();
missionExecutor.setSkillHandler(skillManager.createHandler());
```

## Ajout de nouveaux outils

### Depuis une skill existante
```typescript
skillManager.registerSkill(myNewSkill);
```

### Directement dans le ToolRegistry
```typescript
runtime.tools.register({
  declaration: {
    name: "my_tool",
    description: "Description pour le LLM",
    parameters: { type: "OBJECT", properties: { ... } }
  },
  handler: async (args) => { /* ... */ },
  category: "custom",
  timeoutMs: 10_000,
  permissions: ["read"],
});
```

## Observabilité

```typescript
// Écouter tous les appels d'outils
runtime.events.on("tool:completed", (event) => {
  console.log(`${event.toolName}: ${event.durationMs}ms (${event.success ? "✓" : "✗"})`);
});

// Métriques agrégées
const metrics = runtime.tools.getToolMetrics();
// → { "read_project_file": { calls: 42, failures: 2, avgMs: 15 }, ... }

// Historique des 10 derniers appels
const history = runtime.tools.getCallHistory(10);
```

## Tests

```typescript
import { SkillManagerV2 } from "./server/runtime/compat";

describe("Mon module", () => {
  it("devrait appeler un outil", async () => {
    const sm = new SkillManagerV2();
    
    // Enregistrer un mock
    sm.getRegistry().register({
      declaration: { name: "mock_tool", description: "test", parameters: {} },
      handler: async () => ({ success: true }),
    });

    const result = await sm.handleToolCall("mock_tool", {});
    expect(result).toEqual({ success: true });
  });
});
```
