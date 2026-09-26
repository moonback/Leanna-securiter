/**
 * agentic — Le runtime agentique de Leanna.
 *
 * Point d'entrée du composant qui transforme Leanna d'un pipeline linéaire
 * (User → Router → Agent → LLM → Response) en un vrai agent bouclant sur
 * OBSERVE → PLAN → ACT → OBSERVE → VERIFY → (NEXT | RECOVER) → COMPLETE,
 * en donnant réellement aux agents les outils qu'ils déclarent.
 *
 * Usage rapide :
 *   import { createAgentRuntime } from "./runtime/agentic/index.js";
 *   const agentic = createAgentRuntime(runtime); // runtime = AgentRuntime (DI) existant
 *   const result = await agentic.run({ role: "coder", goal: "Analyse le projet et corrige les problèmes." });
 */

import type { AgentRuntime as DIRuntime } from "../AgentRuntime.js";
import { AgentRuntime as AgenticRuntime, type AgenticRuntimeDeps } from "./AgentRuntime.js";
import type { AgentBudget } from "./types.js";

export { AgentRuntime as AgenticRuntime } from "./AgentRuntime.js";
export type { AgenticRuntimeDeps, GenerateTextFn } from "./AgentRuntime.js";
export {
  resolveAgentTools,
  buildToolSection,
  buildBudgetSection,
  buildObservationHistory,
} from "./ToolPromptBuilder.js";
export {
  DEFAULT_AGENT_BUDGET,
  type AgentBudget,
  type AgentTask,
  type AgentResult,
  type AgentOutcome,
  type AgentError,
  type Plan,
  type PlanStep,
  type PlanStepStatus,
  type Observation,
  type ToolInvocation,
  type ToolCallOutcome,
  type Verification,
  type Recovery,
  type FinalResult,
  type BudgetUsage,
  type IAgentRuntime,
} from "./types.js";

/**
 * Fabrique un runtime agentique branché sur le `ToolRegistry` et l'`EventBus`
 * d'un runtime DI existant (`server/runtime/AgentRuntime.ts`).
 *
 * C'est la voie recommandée : le runtime agentique réutilise les outils,
 * permissions, dry-run et métriques déjà configurés par `bootstrapRuntime()`.
 */
export function createAgentRuntime(
  runtime: DIRuntime,
  options: { budget?: Partial<AgentBudget>; model?: import("./AgentRuntime.js").GenerateTextFn } = {}
): AgenticRuntime {
  const deps: AgenticRuntimeDeps = {
    registry: runtime.tools,
    events: runtime.events,
    budget: options.budget,
    model: options.model,
  };
  return new AgenticRuntime(deps);
}
