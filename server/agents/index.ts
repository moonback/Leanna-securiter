export { AgentOrchestrator, agentOrchestrator } from "./AgentOrchestrator.js";
export type { AgentEvent } from "./AgentOrchestrator.js";
export { agentMessageBus } from "./AgentOrchestrator.js";
export { agentRegistry } from "./AgentOrchestrator.js";
export { COLLABORATION_PATTERNS, DELEGATION_MATRIX, delegationPolicy } from "./AgentOrchestrator.js";
export type { DelegationPolicy, DelegationTaskContext } from "./AgentOrchestrator.js";

// Exports directs des nouveaux modules autonomes
export { AutonomousAgent } from "./AutonomousAgent.js";
export { AgentRegistry } from "./AgentRegistry.js";
export { AgentMessageBus } from "./AgentMessageBus.js";
export { DelegationParser, delegationParser } from "./DelegationParser.js";
export { AutonomousLoop } from "./AutonomousLoop.js";
export type { LoopConfig, LoopResult, IterationRecord, LoopDecision } from "./AutonomousLoop.js";
export type { ParsedDelegation, DelegationParseResult } from "./DelegationParser.js";
export { AgentPersistence, agentPersistence } from "./AgentPersistence.js";
export type {
  AgentMessage,
  AgentMessageType,
  MessagePriority,
  MessageHandler,
  MessageSubscription,
  PublishOptions,
  DelegationCapability,
  CollaborationPattern,
  TaskRequestPayload,
  TaskResponsePayload,
  StatusResponsePayload,
  EventPayload,
  BroadcastPayload,
} from "./AgentCommunication.js";

export { WorkspaceState } from "./WorkspaceState.js";
export type { WorkspaceFileState, WorkspaceCompletionReport, WorkspaceRead, VerificationIssue, VerificationRecord, VerificationSeverity } from "./WorkspaceState.js";
export { AgentValidation } from "./AgentValidation.js";
export type { ValidationSnapshot, RegressionReport } from "./AgentValidation.js";
export { AgentRepairLoop } from "./AgentRepairLoop.js";
export type { RepairAction, RepairDirective } from "./AgentRepairLoop.js";

// Exports existants (inchangés)
export { 
  STATIC_AGENT_REGISTRY, 
  getAgentDefinition, 
  getAgentDefinitionOrThrow,
  listAgentDefinitions, 
  listAgentRoles,
  hasAgent
} from "./roles.js";
export { isDelegationAllowed } from "./AgentCommunication.js";

// Dynamic Agent Registry
export { DynamicAgentRegistry, dynamicAgentRegistry } from "./DynamicAgentRegistry.js";
export type {
  AgentRole,
  AgentTask,
  TaskContext,
  TaskResult,
  TaskStatus,
  TaskPriority,
  OrchestrationPlan,
  AgentDefinition,
} from "./types.js";

// Tool-Agent Mapper (spécialisation des compétences)
export {
  TOOL_CATEGORIES,
  initializeToolAgentMapper,
  getAgentsForTool,
  getPrimaryAgentForTool,
  canAgentUseTool,
  getToolCategory,
  getAllToolCategories,
  getToolsForAgent,
  getRecommendedRolesForCategory,
  applyToolRegistryAttribution,
  applyRuntimeAgentAuthorization,
  getExplicitlyAttributedTools,
  UNATTRIBUTED_ROLE,
} from "./toolAgentMapper.js";
export {
  agentRoleSchema,
  taskPrioritySchema,
  delegateTaskSchema,
  orchestrateSchema,
  listAgentTasksSchema,
} from "./types.js";

// === NOUVEAUX EXPORTS POUR LES AMÉLIORATIONS ===

// Délégation structurée (remplace le parsing Markdown)
export { DelegationManager, delegationManager } from "./DelegationManager.js";
export type { 
  StructuredDelegation, 
  BatchDelegation, 
  DelegationResult, 
  DelegationEvent 
} from "./DelegationManager.js";

// Routage avancé
export type { RoutingStrategy } from "./AgentCommunication.js";

// Surveillance et traçage du MessageBus
export { MessageBusMonitor, messageBusMonitor } from "./MessageBusMonitor.js";
export type { 
  AlertSeverity, 
  MonitorAlert, 
  AggregatedMetrics, 
  HealthStatus,
  MessageFlowNode,
  MessageFlowEdge,
  MessageFlowGraph
} from "./MessageBusMonitor.js";

// Agent Brain — Cerveau central dynamique Leanna
export { AgentBrain, agentBrain } from "./brain/AgentBrain.js";
export { GoalUnderstandingEngine } from "./brain/GoalUnderstandingEngine.js";
export { DynamicPlanner } from "./brain/DynamicPlanner.js";
export { BrainVerifier } from "./brain/BrainVerifier.js";
export { BrainCorrectionLoop } from "./brain/BrainCorrectionLoop.js";
export { BrainPlanValidator } from "./brain/BrainPlanValidator.js";
export { BrainScheduler } from "./brain/BrainScheduler.js";
export type {
  BrainGoalInput,
  GoalUnderstanding,
  BrainPlan,
  BrainStage,
  BrainExecutionResult,
  StageVerification,
  BrainCorrectionAttempt,
  ProjectDomain,
  ComplexityLevel,
} from "./brain/types.js";
