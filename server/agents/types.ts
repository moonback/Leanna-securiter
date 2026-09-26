import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Types du système d'agents multi-rôles
// ═══════════════════════════════════════════════════════════════════════════════

/** Rôles d'agents spécialisés Leanna — Audit de sécurité, analyse de vulnérabilités & ingénierie */
export const STATIC_AGENT_ROLES = [
  // ── Reconnaissance & Modélisation des menaces ──
  "recon",            // cartographie du code (entry points, surfaces d'attaque)
  "threat_modeler",   // STRIDE / MITRE ATT&CK mapping
  "architect_sec",    // analyse d'architecture (trust boundaries)

  // ── Analyse Statique (SAST) ──
  "sast_analyzer",    // taint analysis, injection patterns
  "crypto_auditor",   // usages cryptographiques, entropie, RNG
  "auth_auditor",     // authn/authz, sessions, JWT, OAuth
  "secrets_hunter",   // détection de secrets (tokens, keys, credentials)

  // ── Supply Chain (SCA) ──
  "sca_analyzer",     // CVE, EPSS, licence, typosquatting
  "sbom_builder",     // génération SBOM CycloneDX/SPDX

  // ── Infrastructure (IaC) ──
  "iac_auditor",      // Terraform, K8s, Docker, CloudFormation

  // ── Runtime (DAST) ──
  "dast_runner",      // fuzzing API, analyse runtime

  // ── Triage & Rapport ──
  "triage",           // dédupe, priorisation, faux positifs
  "poc_writer",       // écriture de PoC démonstratifs non-exploitables
  "report_writer",    // rapport exécutif + technique + SARIF

  // ── Rôles de support & compatibilité ──
  "security",
  "coder",
  "refactor",
  "debugger",
  "reviewer",
  "tester",
  "architect",
  "vision",
  "writer",
  "formatter",
  "researcher",
  "proofreader",
  "translator",
  "summarizer",
  "planner",
] as const;

/**
 * AgentRole peut être soit un rôle statique prédéfini, soit un rôle dynamique
 * enregistré via l'Agent Builder ou l'API.
 * Le type est union pour supporter à la fois les rôles statiques et dynamiques.
 */
export type AgentRole = (typeof STATIC_AGENT_ROLES)[number] | string;

/** Alias contrôlés acceptés aux frontières LLM. Aucun rôle n'est inventé. */
const AGENT_ROLE_ALIASES: Readonly<Record<string, AgentRole>> = {
  // Aliases Code & Dév
  coder: "coder",
  developpeur: "coder",
  développeur: "coder",
  dev: "coder",
  developer: "coder",
  code: "coder",
  programmer: "coder",
  programmeur: "coder",
  refactor: "refactor",
  refactoring: "refactor",
  clean_code: "refactor",
  restructuration: "refactor",
  debugger: "debugger",
  debug: "debugger",
  correctif: "debugger",
  fix: "debugger",
  bugfix: "debugger",
  depannage: "debugger",
  dépannage: "debugger",
  reviewer: "reviewer",
  review: "reviewer",
  revue: "reviewer",
  code_review: "reviewer",
  audit_code: "reviewer",
  tester: "tester",
  test: "tester",
  tests: "tester",
  qa: "tester",
  quality: "tester",
  security: "security",
  securite: "security",
  sécurité: "security",
  sec: "security",
  audit_secu: "security",
  audit_sécu: "security",
  architect: "architect",
  architecte: "architect",
  architecture: "architect",
  conception: "architect",
  // Vision & Analyse Visuelle
  vision: "vision",
  visual: "vision",
  vision_expert: "vision",
  analyse_visuelle: "vision",
  analyse_visual: "vision",
  screenshot_analysis: "vision",
  image_analysis: "vision",
  // Aliases Rédaction & Documents
  writer: "writer",
  docs: "writer",
  doc: "writer",
  documentation: "writer",
  redacteur: "writer",
  rédacteur: "writer",
  write: "writer",
  redaction: "writer",
  rédaction: "writer",
  formatter: "formatter",
  format: "formatter",
  mise_en_forme: "formatter",
  structure: "formatter",
  researcher: "researcher",
  recherche: "researcher",
  research: "researcher",
  proofreader: "proofreader",
  correcteur: "proofreader",
  correction: "proofreader",
  relecture: "proofreader",
  translator: "translator",
  traduction: "translator",
  translate: "translator",
  summarizer: "summarizer",
  synthese: "summarizer",
  synthèse: "summarizer",
  resume: "summarizer",
  résumé: "summarizer",
  planner: "planner",
  plan: "planner",
  outline: "planner",
  planification: "planner",
};

/**
 * Normalise seulement les alias approuvés, puis retourne la valeur normalisée.
 * Pour les rôles dynamiques (non dans les aliases), retourne simplement la valeur
 * normalisée (trim + lowercase).
 */
export function normalizeAgentRole(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  return AGENT_ROLE_ALIASES[normalized] ?? normalized;
}

/**
 * Vérifie si un rôle est un rôle statique prédéfini.
 */
export function isStaticAgentRole(role: string): boolean {
  return STATIC_AGENT_ROLES.includes(role as (typeof STATIC_AGENT_ROLES)[number]);
}

/** Statuts possibles d'une tâche déléguée */
export type TaskStatus = "pending" | "running" | "completed" | "incomplete" | "failed" | "cancelled";

/**
 * Résultat qualitatif d'une tâche — distinct du statut d'exécution.
 *
 * | Outcome   | Signification                                                       |
 * |-----------|---------------------------------------------------------------------|
 * | success   | Modifications demandées effectuées + validations passées            |
 * | partial   | Modifications partielles (certains fichiers OK, d'autres en erreur) |
 * | blocked   | Erreur externe (préexistante ou hors périmètre) empêche la finition |
 * | no_change | Agent terminé sans modifier aucun fichier (pour une tâche de modif) |
 * | failed    | Exception agent / outil / timeout                                   |
 *
 * Pour les tâches purement analytiques (researcher, planner, summarizer),
 * `success` est valide sans modification de fichiers.
 */
export type TaskOutcome = "success" | "partial" | "blocked" | "no_change" | "failed";

/** Priorité d'une tâche */
export type TaskPriority = "low" | "medium" | "high" | "critical";

/** Définition d'un agent spécialisé */
export interface AgentDefinition {
  role: AgentRole;
  name: string;
  description: string;
  /** Capacités de l'agent (skills/outils auxquels il a accès) */
  capabilities: string[];
  /** Politique explicite de délégation inter-agents. */
  permissions?: AgentPermissions;
  /** Instructions système spécifiques à l'agent */
  systemPrompt: string;
  /** Nombre max de tâches simultanées */
  maxConcurrency: number;
  /** Timeout par défaut en ms */
  defaultTimeoutMs: number;
}

export interface AgentPermissions {
  allowDelegation: boolean;
  allowReceiveDelegation: boolean;
  maxDelegationDepth: number;
  allowedTargets?: string[];
  allowedCapabilities?: string[];
  allowedTools?: string[];
  budget?: {
    maxDelegations?: number;
    maxTokens?: number;
  };
  riskLevel?: "low" | "medium" | "high" | "critical";
}

/** Tâche déléguée à un agent */
export interface AgentTask {
  id: string;
  /** ID du workflow parent (si orchestration multi-agents) */
  orchestrationId?: string;
  role: AgentRole;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Fichiers/contexte pertinents pour la tâche */
  context: TaskContext;
  /** Résultat de l'exécution */
  result?: TaskResult;
  /** Timestamps */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Timeout en ms (override du défaut) */
  timeoutMs?: number;
}

/** Contexte fourni à un agent pour exécuter sa tâche */
export interface TaskContext {
  /** Fichiers concernés */
  files: string[];
  /** Instructions additionnelles */
  instructions?: string;
  /** Résultats d'agents précédents (pour le chaînage) */
  previousResults?: TaskResult[];
  /** Métadonnées libres */
  metadata?: Record<string, unknown>;
}

/** Résultat de l'exécution d'une tâche */
export interface TaskResult {
  success: boolean;
  /**
   * Résultat qualitatif de l'exécution.
   * Fournit une sémantique fine au-delà du booléen success/failed.
   * Toujours présent après l'exécution.
   */
  outcome: TaskOutcome;
  /**
   * Cause du blocage (uniquement quand outcome === "blocked").
   * Ex: "compile_error_preexisting", "missing_dependency", "out_of_scope"
   */
  blockReason?: string;
  /** Résumé court de ce qui a été fait */
  summary: string;
  /** Détails complets */
  details?: string;
  /** Fichiers créés ou modifiés */
  filesModified?: string[];
  /** Fichiers rejetés par la validation pré-écriture (contenu invalide) */
  fileValidationErrors?: { path: string; error: string }[];
  /** Suggestions pour l'utilisateur */
  suggestions?: string[];
  /** Erreur si échec */
  error?: string;
  /** Durée d'exécution en ms */
  durationMs: number;
  /** IDs des sous-tâches déléguées de manière autonome (fire-and-forget) */
  delegatedSubTasks?: string[];
  /** Opérations de mémoire projet (knowledge_memory_add) effectuées */
  knowledgeMemoryOperations?: Array<{
    tool: string;
    fact_id: string;
    message: string;
    timestamp: string;
  }>;
  /** Preuves collectées par l'exécuteur, distinctes de la narration du modèle. */
  evidence?: TaskEvidence;
}

/** Éléments vérifiables nécessaires pour déclarer une tâche terminée. */
export interface TaskEvidence {
  filesRead: string[];
  filesModified: string[];
  toolsExecuted: string[];
  commandsExecuted: string[];
  /** Pre/post global checks and delta-based regression evidence. */
  globalValidation?: {
    baseline: unknown;
    current: unknown;
    regressions: string[];
    passed: boolean;
  };
  verification: {
    passed: boolean;
    checks: string[];
    errors: string[];
  };
}

/** Plan d'orchestration multi-agents */
export interface OrchestrationPlan {
  id: string;
  title: string;
  description: string;
  /** Tâches ordonnées (certaines peuvent être parallèles) */
  tasks: AgentTask[];
  /** Dépendances entre tâches: taskId → [taskIds dont elle dépend] */
  dependencies: Record<string, string[]>;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
}

// ─── Zod Schemas pour validation ──────────────────────────────────────────────

const strictAgentRoleSchema = z.enum(
  STATIC_AGENT_ROLES,
  {
    errorMap: (_issue, ctx) => ({
      message:
        `Rôle invalide : "${ctx.data}". ` +
        `Un seul rôle autorisé par tâche, parmi : ${STATIC_AGENT_ROLES.join(", ")}.`,
    }),
  }
);

/**
 * Schéma pour les rôles dynamiques (strings arbitraires).
 * Accepte n'importe quelle chaîne non-vide comme rôle potentiel.
 */
const dynamicAgentRoleSchema = z
  .string()
  .min(1, "Le rôle ne peut pas être vide")
  .max(64, "Le rôle est trop long (max 64 caractères)")
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    "Le rôle doit commencer par une lettre et contenir uniquement des lettres, chiffres, underscores ou tirets"
  );

/**
 * Accepte les rôles officiels, les alias explicitement approuvés, ou les rôles dynamiques valides.
 * Le transform normalise les alias connus et laisse passer les autres.
 */
export const agentRoleSchema = z
  .union([
    strictAgentRoleSchema,
    z.enum([
      // Code & Dev aliases
      "coder", "developpeur", "développeur", "dev", "developer", "code", "programmer", "programmeur",
      "refactor", "refactoring", "clean_code", "restructuration",
      "debugger", "debug", "correctif", "fix", "bugfix", "depannage", "dépannage",
      "reviewer", "review", "revue", "code_review", "audit_code",
      "tester", "test", "tests", "qa", "quality",
      "security", "securite", "sécurité", "sec", "audit_secu", "audit_sécu",
      "architect", "architecte", "architecture", "conception",
      // Docs aliases
      "docs", "doc", "documentation",
      "redacteur", "rédacteur", "write", "redaction", "rédaction",
      "format", "mise_en_forme", "structure",
      "recherche", "research",
      "correcteur", "correction", "relecture",
      "traduction", "translate",
      "synthese", "synthèse", "resume", "résumé",
      "plan", "outline", "planification",
    ]),
    dynamicAgentRoleSchema,
  ])
  .transform((value): AgentRole => normalizeAgentRole(value) as AgentRole);

export const taskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const delegateTaskSchema = z.object({
  role: agentRoleSchema,
  title: z.string().min(1, "Le titre de la tâche est requis").trim(),
  description: z.string().min(1, "La description de la tâche est requise").trim(),
  files: z.array(z.string()).optional().default([]),
  instructions: z.string().optional(),
  priority: taskPrioritySchema.optional().default("medium"),
  timeoutMs: z.number().int().positive().optional(),
});

export const orchestrateSchema = z.object({
  title: z.string().min(1).trim(),
  description: z.string().min(1).trim(),
  tasks: z.array(z.object({
    /**
     * ID stable optionnel de la tâche.
     * Permet de référencer cette tâche dans `dependsOn` d'autres tâches
     * sans dépendre du titre (ex: "task-analysis", "task-refactor").
     * Si absent, un UUID est généré automatiquement.
     */
    id: z.string().min(1).optional(),
    role: agentRoleSchema,
    title: z.string().min(1).trim(),
    description: z.string().min(1).trim(),
    files: z.array(z.string()).optional().default([]),
    instructions: z.string().optional(),
    priority: taskPrioritySchema.optional().default("medium"),
    /**
     * IDs ou titres des tâches dont celle-ci dépend.
     * Résolution : ID stable fourni via le champ `id` > UUID interne > titre de tâche.
     * Le scheduler ne lance la tâche que lorsque toutes ses dépendances
     * sont au statut "completed".
     */
    dependsOn: z.array(z.string()).optional().default([]),
  })).min(1, "Au moins une tâche requise"),
});

export const listAgentTasksSchema = z.object({
  role: agentRoleSchema.optional(),
  status: z.enum(["pending", "running", "completed", "incomplete", "failed", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});
