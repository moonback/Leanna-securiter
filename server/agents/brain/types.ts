import { z } from "zod";
import type { AgentRole, TaskPriority, TaskResult } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Brain Types — Architecture Cognitive Supérieure
// ═══════════════════════════════════════════════════════════════════════════════

export type ProjectDomain =
  | "frontend"
  | "backend"
  | "fullstack"
  | "documentation"
  | "devops"
  | "bugfix"
  | "refactor"
  | "general";

export type ComplexityLevel = "simple" | "moderate" | "complex" | "critical";

/** Contexte initial fourni au Brain */
export interface BrainGoalInput {
  goal: string;
  contextFiles?: string[];
  instructions?: string;
  mode?: "auto" | "plan_first";
  maxCorrectionAttempts?: number;
  /** Budget global de réplanifications à chaud du sous-graphe restant (défaut 2). */
  maxReplans?: number;
  preferences?: {
    visualValidation?: boolean;
    skipTests?: boolean;
    strictMode?: boolean;
  };
}

/** Compréhension approfondie et modélisée de l'objectif utilisateur */
export interface GoalUnderstanding {
  intent: string;
  domain: ProjectDomain;
  complexity: ComplexityLevel;
  keyTechnologies: string[];
  relevantFiles: string[];
  requirements: string[];
  successCriteria: string[];
  potentialRisks: string[];
  rationale: string;
}

/** Étape individuelle du DAG d'exécution du Brain */
export interface BrainStage {
  id: string;
  title: string;
  description: string;
  agentRole: AgentRole;
  agentReason: string;
  skills: string[];
  tools: string[];
  files: string[];
  instructions: string;
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  priority: TaskPriority;
  verificationCriteria?: string[];
  result?: TaskResult;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

/** Graphe de plan d'action dynamique (DAG) */
export interface BrainPlan {
  id: string;
  goal: string;
  understanding: GoalUnderstanding;
  stages: BrainStage[];
  estimatedDurationMs: number;
  architectureRationale: string;
  createdAt: string;
  status: "planned" | "executing" | "verifying" | "correcting" | "completed" | "incomplete" | "failed";
  /** Représentation Mermaid (`graph TD`) du DAG des étapes, générée à la planification. */
  mermaid?: string;
}

/** Résultat de vérification d'une étape ou du projet global */
export interface VerificationIssue {
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  file?: string;
  rule?: string;
}

export interface StageVerification {
  stageId: string;
  role: AgentRole;
  passed: boolean;
  syntaxCheckOk: boolean;
  testsOk: boolean;
  visualCheckOk?: boolean;
  semanticCheckOk: boolean;
  issues: VerificationIssue[];
  summary: string;
  timestamp: string;
}

/** Tentative d'auto-correction suite à un échec de vérification */
export interface BrainCorrectionAttempt {
  id: string;
  attemptNumber: number;
  failedStageId: string;
  targetRole: AgentRole;
  diagnostic: string;
  correctiveInstructions: string;
  filesToFix: string[];
  resolved: boolean;
  timestamp: string;
}

/** Résultat final complet produit par l'Agent Brain */
export interface BrainExecutionResult {
  planId: string;
  goal: string;
  success: boolean;
  understanding: GoalUnderstanding;
  stages: Array<{
    stage: BrainStage;
    result?: TaskResult;
    durationMs: number;
  }>;
  filesModified: string[];
  verifications: StageVerification[];
  corrections: BrainCorrectionAttempt[];
  totalDurationMs: number;
  summary: string;
  deliverables: string[];
}

// ─── Schémas Zod pour validation des entrées API et Outils ───────────────────

export const brainExecuteSchema = z.object({
  goal: z.string().min(1, "L'objectif est requis").trim(),
  contextFiles: z.array(z.string()).optional().default([]),
  instructions: z.string().optional(),
  mode: z.enum(["auto", "plan_first"]).optional().default("auto"),
  maxCorrectionAttempts: z.number().int().min(0).max(5).optional().default(3),
  maxReplans: z.number().int().min(0).max(5).optional().default(2),
  preferences: z
    .object({
      visualValidation: z.boolean().optional(),
      skipTests: z.boolean().optional(),
      strictMode: z.boolean().optional(),
    })
    .optional(),
});
