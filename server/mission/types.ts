import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Types du système Mission — Couche décisionnelle autonome
// ═══════════════════════════════════════════════════════════════════════════════

/** Priorité d'un objectif */
export type GoalPriority = "low" | "medium" | "high" | "critical";

/** Statut d'un objectif ou d'une étape */
export type GoalStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

/** Niveau de confiance de l'agent (0 à 1) */
export type Confidence = number;

/** Résultat d'une réflexion post-action */
export interface ReflectionResult {
  actionId: string;
  timestamp: string;
  /** Ce qui s'est passé */
  observation: string;
  /** Ce qui a bien fonctionné */
  success: string | null;
  /** Ce qui a échoué ou manque */
  failure: string | null;
  /** Nouvelle hypothèse ou stratégie */
  hypothesis: string | null;
  /** Confiance dans la progression (0-1) */
  confidence: Confidence;
  /** Décision: continuer, corriger, abandonner, demander aide */
  decision: "continue" | "retry" | "replan" | "escalate" | "abort";
  /** Raison de la décision */
  reasoning: string;
}

/** Un objectif dans la Goal Stack */
export interface Goal {
  id: string;
  /** Objectif parent (null = objectif racine / mission) */
  parentId: string | null;
  /** Description courte */
  title: string;
  /** Description détaillée */
  description: string;
  /** Critères de succès vérifiables */
  successCriteria: string[];
  priority: GoalPriority;
  status: GoalStatus;
  /** Sous-objectifs */
  children: string[];
  /** IDs des objectifs dont celui-ci dépend (doivent être complétés avant). */
  dependsOn?: string[];
  /** Skills/outils planifiés pour cet objectif */
  plannedActions: PlannedAction[];
  /** Résultat si terminé */
  result?: GoalResult;
  /** Nombre de tentatives */
  attempts: number;
  /** Max tentatives avant escalade */
  maxAttempts: number;
  /** Timestamps */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Blocage éventuel */
  blockedBy?: string;
  blockReason?: string;
}

/** Action planifiée (encore non exécutée) */
export interface PlannedAction {
  id: string;
  /** Nom du skill/outil */
  skillName: string;
  /** Arguments prévus */
  args: Record<string, unknown>;
  /** Justification du choix */
  rationale: string;
  /** Score de pertinence calculé par SkillScorer */
  score: number;
  /** Ordre d'exécution */
  order: number;
  /** Statut */
  status: GoalStatus;
  /** Résultat après exécution */
  result?: unknown;
  /** Réflexion post-exécution */
  reflection?: ReflectionResult;
}

/** Résultat d'un objectif complété */
export interface GoalResult {
  success: boolean;
  summary: string;
  artifacts?: string[];
  /** Leçons apprises (sauvegardées en mémoire) */
  lessonsLearned?: string[];
}

/** État global de la mission */
export interface MissionState {
  id: string;
  /** Titre de la mission (objectif de haut niveau) */
  title: string;
  /** Description complète de ce que l'utilisateur veut */
  description: string;
  /** Statut global */
  status: GoalStatus;
  /** Priorité globale */
  priority: GoalPriority;
  /** Pile d'objectifs (du plus profond au plus haut) */
  goalStack: string[];
  /** Tous les objectifs indexés par ID */
  goals: Record<string, Goal>;
  /** Objectif actif (le sommet de la pile) */
  activeGoalId: string | null;
  /** Historique des réflexions */
  reflections: ReflectionResult[];
  /** Contexte accumulé pendant la mission */
  context: MissionContext;
  /** Métriques */
  metrics: MissionMetrics;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** Contexte dynamique de la mission */
export interface MissionContext {
  /** Fichiers pertinents découverts */
  relevantFiles: string[];
  /** Décisions prises */
  decisions: { what: string; why: string; when: string }[];
  /** Erreurs rencontrées */
  errors: { action: string; error: string; when: string }[];
  /** Hypothèses de travail */
  hypotheses: string[];
  /** Dépendances identifiées */
  dependencies: string[];
}

/** Métriques de la mission */
export interface MissionMetrics {
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  retriedActions: number;
  averageConfidence: number;
  totalDurationMs: number;
  /** Estimation tokens consommés */
  estimatedTokens: number;
}

/** Plan explicite présenté avant le lancement d'une mission multi-étapes. */
export interface MissionPlan {
  objectives: string[];
  targetedFiles: string[];
  tools: string[];
  risks: string[];
  estimatedTokens: number;
  stopConditions: string[];
}

/** Score calculé pour un skill */
export interface SkillScore {
  skillName: string;
  /** Score global (0-100) */
  totalScore: number;
  /** Détail des composantes */
  breakdown: {
    relevance: number;       // Pertinence par rapport à l'objectif (0-30)
    history: number;         // Succès historique pour ce type de tâche (0-20)
    estimatedTime: number;   // Rapidité estimée (0-15)
    successProbability: number; // Probabilité de succès (0-20)
    tokenCost: number;       // Économie de tokens (0-15)
  };
  /** Justification textuelle */
  rationale: string;
}

/** Configuration du système Mission */
export interface MissionConfig {
  /** Nombre max de sous-objectifs par objectif */
  maxSubGoals: number;
  /** Profondeur max de la Goal Stack */
  maxDepth: number;
  /** Nombre max de tentatives par action */
  maxRetries: number;
  /** Confiance minimale pour continuer sans replanification */
  minConfidence: number;
  /** Activer l'auto-réflexion */
  enableReflection: boolean;
  /** Activer la sauvegarde en mémoire des leçons */
  enableMemoryLearning: boolean;
  /** Seuil de score minimum pour sélectionner un skill */
  minSkillScore: number;
  /** Nombre max de sous-objectifs exécutés en parallèle dans une vague. */
  maxConcurrentGoals: number;
  /**
   * Mode simulation globale : la mission s'exécute sans effet de bord
   * (aucune écriture, exécution shell ou mutation réseau réelle).
   * Les outils en lecture seule continuent de s'exécuter normalement.
   */
  dryRun: boolean;
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

export const createMissionSchema = z.object({
  title: z.string().min(1).trim(),
  description: z.string().min(1).trim(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
});

export const addGoalSchema = z.object({
  missionId: z.string().min(1),
  parentId: z.string().nullable().optional().default(null),
  title: z.string().min(1).trim(),
  description: z.string().min(1).trim(),
  successCriteria: z.array(z.string()).min(1),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
});

export const DEFAULT_MISSION_CONFIG: MissionConfig = {
  maxSubGoals: 10,
  maxDepth: 5,
  maxRetries: 3,
  minConfidence: 0.4,
  enableReflection: true,
  enableMemoryLearning: true,
  minSkillScore: 25,
  maxConcurrentGoals: 3,
  dryRun: false,
};
