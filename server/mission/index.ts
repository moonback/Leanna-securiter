/**
 * Mission System — Couche d'orchestration décisionnelle
 *
 * Ce module ajoute une couche de planification, exécution et réflexion
 * entre l'utilisateur et les skills. Il permet à l'agent de:
 * - Maintenir un objectif persistant (Goal Stack)
 * - Décomposer des objectifs complexes en sous-tâches
 * - Choisir intelligemment les outils (SkillScorer)
 * - Évaluer ses propres résultats (Reflection Engine)
 * - Se corriger et replanifier en cas d'échec
 *
 * Architecture:
 *   Utilisateur
 *     ↓
 *   Mission (état persistant)
 *     ↓
 *   Planner (décomposition hiérarchique)
 *     ↓
 *   Executor (boucle plan→agir→vérifier→corriger)
 *     ↓
 *   SkillManager (exécution des outils)
 *     ↓
 *   Reflection (auto-évaluation)
 *     ↓
 *   Retour à l'Executor (décision: continuer/corriger/escalade)
 */

export { Mission } from "./Mission.js";
export { Planner, type SubGoalPlan, type DecomposeFunction } from "./Planner.js";
export { Executor, type SkillHandlerFn, type ExecutorEventEmitter, type LLMTextFn, type ToolSchema } from "./Executor.js";
export { MissionStore } from "./MissionStore.js";
export { AutonomyPolicy, type AutonomyMode, type AutonomyDecision, type AutonomyVerdict } from "./AutonomyPolicy.js";
export { ReflectionEngine, reflectionEngine, type ReflectionInput, type ReflectFunction, type ReflectionMode, type LoopDetectionResult, type ConfidenceAnalysis, type ReflectionLesson, type ReflectionSummary } from "./Reflection.js";
export { SkillScorer, type ScoringContext, type SkillCategory } from "./SkillScorer.js";
export type {
  MissionState,
  MissionConfig,
  MissionContext,
  MissionMetrics,
  Goal,
  GoalStatus,
  GoalPriority,
  GoalResult,
  PlannedAction,
  ReflectionResult,
  SkillScore,
  Confidence,
} from "./types.js";
export { DEFAULT_MISSION_CONFIG, createMissionSchema, addGoalSchema } from "./types.js";
