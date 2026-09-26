/**
 * Runtime — Point d'entrée du nouveau cœur architectural
 * 
 * Usage :
 *   import { createRuntime } from "./server/runtime.js";
 *   const runtime = createRuntime({ enableMetrics: true });
 *   await runtime.start();
 * 
 * Le runtime est le conteneur unique de tous les composants.
 * Tous les autres modules dépendent du runtime, jamais l'inverse.
 */

// Core
export { AgentRuntime } from "./AgentRuntime.js";
export type { AgentPlugin } from "./AgentRuntime.js";
export { EventBus } from "./EventBus.js";
export { StateMachine } from "./StateMachine.js";
export { ToolRegistry, ToolNotFoundError, ToolTimeoutError, ToolPermissionError } from "./ToolRegistry.js";
export { PermissionPolicy, PermissionDeniedError, ALL_PERMISSIONS } from "./PermissionPolicy.js";
export type { PermissionMode, PermissionDecision, PermissionPolicyConfig } from "./PermissionPolicy.js";
export { DryRunController, SIDE_EFFECT_PERMISSIONS } from "./DryRun.js";
export type { DryRunConfig, DryRunResult, DryRunReport, SimulatedEffect } from "./DryRun.js";
export { Memory } from "./Memory.js";
export { HierarchicalMemoryService, hierarchicalMemoryService } from "./HierarchicalMemoryService.js";
export type { HierarchicalTier, HierarchicalMemoryItem, HierarchicalStats, HierarchicalSearchOptions, HierarchicalStoreInput } from "./HierarchicalMemoryService.js";
export { WorkflowEngine } from "./WorkflowEngine.js";
export { PromptRegistry } from "./PromptRegistry.js";
export { AgentLoader } from "./AgentLoader.js";
export { Observability } from "./Observability.js";

// Types
export type {
  Task,
  TaskState,
  TaskResult,
  AgentMetadata,
  AgentContext,
  AgentPriority,
  ToolDeclaration,
  ToolDefinition,
  ToolHandler,
  ToolPermission,
  SkillPermission,
  ToolCallMetrics,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeEventHandler,
  MemoryLevel,
  MemoryEntry,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowRun,
  PromptTemplate,
  RuntimeConfig,
} from "./types.js";
export { DEFAULT_RUNTIME_CONFIG, VALID_TRANSITIONS, CANONICAL_PERMISSIONS, normalizePermission, normalizePermissions } from "./types.js";

// Agents (plugins)
export { defaultAgents, defineAgent } from "./agents/index.js";
export type { AgentConfig } from "./agents/index.js";

// Compatibility Layer
export { SkillManagerV2 } from "./compat/SkillManagerV2.js";
export { adaptSkill, adaptAllSkills, createToolCallProxy } from "./compat/SkillAdapter.js";
export type { LegacySkill, AdaptOptions } from "./compat/SkillAdapter.js";

// Prompts
export { loadPromptTemplates } from "./prompts/loader.js";
export { SystemPromptBuilder, buildSystemInstructionV3 } from "./prompts/SystemPromptBuilder.js";
export { buildSystemPrompt } from "./prompts/SystemPromptBuilder.js";

// Bootstrap
export { bootstrapRuntime, bootstrapRuntimeSync } from "./bootstrap.js";
export type { BootstrapConfig, BootstrapResult } from "./bootstrap.js";

// Agentic runtime — la vraie boucle OBSERVE→PLAN→ACT→VERIFY→RECOVER→COMPLETE
export { AgenticRuntime, createAgentRuntime, DEFAULT_AGENT_BUDGET } from "./agentic/index.js";
export type {
  AgenticRuntimeDeps,
  AgentBudget,
  AgentTask as AgenticTask,
  AgentResult as AgenticResult,
  AgentOutcome,
  Plan,
  PlanStep,
  Observation,
  ToolInvocation,
  ToolCallOutcome,
  Verification,
  Recovery,
  FinalResult,
  BudgetUsage,
  IAgentRuntime,
} from "./agentic/index.js";

// ─── Factory ─────────────────────────────────────────────────────────────────

import { AgentRuntime } from "./AgentRuntime.js";
import { defaultAgents } from "./agents/index.js";
import type { RuntimeConfig } from "./types.js";

/**
 * Factory pour créer un runtime pré-configuré avec les agents par défaut.
 */
export function createRuntime(config: Partial<RuntimeConfig> = {}): AgentRuntime {
  const runtime = new AgentRuntime(config);

  for (const agent of defaultAgents) {
    runtime.registerAgent(agent);
  }

  return runtime;
}
