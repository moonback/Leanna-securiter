/**
 * AgentCommunication — Types et protocoles pour la communication inter-agents
 *
 * Définit les structures de messages, événements et protocoles
 * pour permettre aux agents de communiquer de manière autonome.
 */
import { z } from "zod";
import type { AgentPermissions, AgentRole, TaskResult } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types de messages inter-agents
// ═══════════════════════════════════════════════════════════════════════════════

/** Type de message échangé entre agents */
export type AgentMessageType =
  | "task_request"      // Demande d'exécution de tâche
  | "task_response"     // Réponse avec résultat d'une tâche
  | "collaboration_request" // Demande de collaboration pour une tâche complexe
  | "status_query"      // Demande de statut d'un agent
  | "status_response"   // Réponse avec le statut
  | "event"             // Notification d'événement (non bloquant)
  | "broadcast";        // Message diffusé à tous les agents

/** Priorité d'un message */
export type MessagePriority = "low" | "medium" | "high" | "critical";

/** Message échangé entre agents */
export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  from: AgentRole;
  to: AgentRole | "broadcast";
  priority: MessagePriority;
  timestamp: string;
  
  /** Contenu du message */
  payload: MessagePayload;
  
  /** ID de corrélation pour les request/response */
  correlationId?: string;
  
  /** Metadata optionnelles */
  metadata?: Record<string, unknown>;
}

/** Contenu d'un message (union discriminée par type) */
export type MessagePayload =
  | TaskRequestPayload
  | TaskResponsePayload
  | CollaborationRequestPayload
  | StatusQueryPayload
  | StatusResponsePayload
  | EventPayload
  | BroadcastPayload;

// ─── Payloads spécifiques ─────────────────────────────────────────────────────

export interface TaskRequestPayload {
  type: "task_request";
  taskId: string;
  title: string;
  description: string;
  files?: string[];
  instructions?: string;
  context?: Record<string, unknown>;
}

export interface TaskResponsePayload {
  type: "task_response";
  taskId: string;
  result: TaskResult;
}

export interface CollaborationRequestPayload {
  type: "collaboration_request";
  taskId: string;
  reason: string;
  context: {
    currentWork: string;
    blockedBy: string;
    requiredExpertise: string;
  };
}

export interface StatusQueryPayload {
  type: "status_query";
}

export interface StatusResponsePayload {
  type: "status_response";
  status: "idle" | "busy" | "overloaded" | "offline";
  currentTasks: number;
  maxConcurrency: number;
  queueLength: number;
}

export interface EventPayload {
  type: "event";
  eventType: string;
  data: Record<string, unknown>;
}

export interface BroadcastPayload {
  type: "broadcast";
  message: string;
  data?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Protocole de communication
// ═══════════════════════════════════════════════════════════════════════════════

/** Handler de message asynchrone */
export type MessageHandler = (message: AgentMessage) => Promise<void>;

/** Subscription à un type de message */
export interface MessageSubscription {
  id: string;
  agentRole: AgentRole;
  messageType: AgentMessageType | "*";
  handler: MessageHandler;
}

/** Stratégie de routage pour les messages */
export type RoutingStrategy = "direct" | "broadcast" | "round-robin" | "load-balanced";

/** Options de publication de message */
export interface PublishOptions {
  /** Attendre une réponse ? */
  awaitResponse?: boolean;
  /** Timeout pour la réponse (ms) */
  timeout?: number;
  /** Stratégie de routage */
  routing?: RoutingStrategy;
  /** Retry en cas d'échec ? */
  retry?: {
    maxRetries: number;
    backoff: "linear" | "exponential";
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Capacités de délégation et collaboration
// ═══════════════════════════════════════════════════════════════════════════════

/** Capacité d'un agent à déléguer à un autre */
export interface DelegationCapability {
  /** Agent cible */
  targetRole: AgentRole;
  /** Types de tâches qu'il peut lui déléguer */
  taskTypes: string[];
  /** Raison de la délégation */
  reason: string;
}

export interface DelegationTaskContext {
  taskType?: string;
  depth?: number;
  requiredCapabilities?: string[];
  requiredTools?: string[];
  budget?: number;
  riskLevel?: "low" | "medium" | "high" | "critical";
}

export interface DelegationPolicy {
  allows(
    parent: AgentRole,
    target: AgentRole,
    task?: DelegationTaskContext
  ): boolean;
}

import { STATIC_AGENT_ROLES } from "./types.js";
import { listAgentRoles as _listAgentRoles } from "./roles.js";
import { getAgentDefinition } from "./roles.js";

export const DELEGATION_MATRIX: Partial<Record<AgentRole, DelegationCapability[]>> = {
  // ── Flotte Sécurité & Audit de Vulnérabilités ──
  recon: [
    { targetRole: "threat_modeler", taskTypes: ["threat-modeling", "stride-analysis"], reason: "Modélisation des menaces sur les surfaces cartographiées" },
    { targetRole: "sast_analyzer", taskTypes: ["analyse-statique", "taint-analysis"], reason: "Analyse statique ciblée sur les points d'entrée découverts" },
  ],
  threat_modeler: [
    { targetRole: "sast_analyzer", taskTypes: ["injection-sast", "taint-flow"], reason: "Vérification des chemins d'injection suspectés" },
    { targetRole: "auth_auditor", taskTypes: ["audit-auth", "session-jwt"], reason: "Audit des frontières de confiance et contrôles d'accès" },
  ],
  sast_analyzer: [
    { targetRole: "triage", taskTypes: ["triage-findings", "deduplication"], reason: "Triage et élimination des faux positifs" },
    { targetRole: "poc_writer", taskTypes: ["redaction-poc", "demonstrateur"], reason: "Rédaction d'un PoC démonstratif non-destructif" },
  ],
  sca_analyzer: [
    { targetRole: "sbom_builder", taskTypes: ["generation-sbom", "cyclonedx"], reason: "Génération de l'inventaire SBOM logiciel" },
    { targetRole: "triage", taskTypes: ["priorisation-cve", "epss-kev"], reason: "Priorisation des dépendances vulnérables selon KEV/EPSS" },
  ],
  triage: [
    { targetRole: "poc_writer", taskTypes: ["validation-poc"], reason: "Validation d'exploitabilité via PoC démonstratif" },
    { targetRole: "report_writer", taskTypes: ["consolidation-rapport", "sarif"], reason: "Génération du rapport exécutif et export SARIF" },
  ],
  poc_writer: [
    { targetRole: "report_writer", taskTypes: ["inclusion-poc-rapport"], reason: "Intégration du PoC dans la section remédiation du rapport" },
  ],
  architect_sec: [
    { targetRole: "threat_modeler", taskTypes: ["menaces-architecturales"], reason: "Consolidation des menaces par frontière" },
    { targetRole: "sast_analyzer", taskTypes: ["analyse-ciblee"], reason: "Analyse des zones sensibles identifiées" },
  ],
  crypto_auditor: [
    { targetRole: "triage", taskTypes: ["triage-findings"], reason: "Qualification des findings crypto" },
  ],
  auth_auditor: [
    { targetRole: "triage", taskTypes: ["triage-findings"], reason: "Qualification des findings auth" },
  ],
  secrets_hunter: [
    { targetRole: "triage", taskTypes: ["triage-findings", "masking"], reason: "Triage des secrets exposés (masquage avant triage)" },
  ],
  iac_auditor: [
    { targetRole: "triage", taskTypes: ["triage-findings"], reason: "Qualification des findings IaC" },
  ],
  dast_runner: [
    { targetRole: "poc_writer", taskTypes: ["validation-poc"], reason: "Consolidation des PoC des findings validés" },
    { targetRole: "triage", taskTypes: ["triage-findings"], reason: "Qualification des findings dynamiques" },
  ],

  // ── Code & Ingénierie logicielle ──
  coder: [
    { targetRole: "tester", taskTypes: ["tests-unitaires", "couverture", "validation"], reason: "Écriture et passage de tests pour le code implémenté" },
    { targetRole: "reviewer", taskTypes: ["revue-code", "audit-qualite"], reason: "Revue de code approfondie et conformité aux standards" },
    { targetRole: "debugger", taskTypes: ["diagnostic-erreur", "analyse-stacktrace"], reason: "Analyse et diagnostic en cas d'erreur bloquante" },
  ],
  refactor: [
    { targetRole: "reviewer", taskTypes: ["audit-qualite", "verification-solid"], reason: "Vérification des améliorations structurelles et patterns" },
    { targetRole: "tester", taskTypes: ["non-regression", "tests-validation"], reason: "Garantie de non-régression comportementale" },
  ],
  debugger: [
    { targetRole: "tester", taskTypes: ["test-reproduction", "test-regression"], reason: "Validation du correctif et test anti-régression" },
    { targetRole: "coder", taskTypes: ["implementation-correctif"], reason: "Implémentation complète si le fix nécessite un nouveau composant" },
  ],
  reviewer: [
    { targetRole: "coder", taskTypes: ["application-correctifs", "amelioration-code"], reason: "Application des remarques et correctifs issus de la revue" },
    { targetRole: "refactor", taskTypes: ["refactorisation-dette"], reason: "Restructuration en cas d'anti-pattern ou code monolithique" },
    { targetRole: "security", taskTypes: ["audit-securite-cible"], reason: "Audit de sécurité si suspicion de vulnérabilité" },
  ],
  tester: [
    { targetRole: "debugger", taskTypes: ["analyse-echec-test"], reason: "Diagnostic des causes d'échec de tests" },
    { targetRole: "coder", taskTypes: ["ajustement-testabilite"], reason: "Ajustement du code pour meilleure testabilité" },
  ],
  security: [
    { targetRole: "coder", taskTypes: ["remediation-faille"], reason: "Application des correctifs de sécurité recommandés" },
    { targetRole: "architect", taskTypes: ["revision-architecture-securite"], reason: "Révision de l'architecture si faille conceptuelle" },
  ],
  architect: [
    { targetRole: "coder", taskTypes: ["implementation-module"], reason: "Implémentation concrète selon l'architecture définie" },
    { targetRole: "planner", taskTypes: ["planification-etapes"], reason: "Découpage du plan de développement en jalons" },
    { targetRole: "reviewer", taskTypes: ["validation-conception"], reason: "Revue de conformité de l'implémentation avec l'architecture" },
  ],

  // ── Rédaction & Documents ──
  writer: [
    { targetRole: "proofreader", taskTypes: ["relecture", "correction"], reason: "Relecture après rédaction" },
    { targetRole: "formatter", taskTypes: ["mise-en-forme", "formatage"], reason: "Mise en forme du document rédigé" },
    { targetRole: "summarizer", taskTypes: ["resume", "synthese"], reason: "Création d'un résumé exécutif" },
  ],
  formatter: [
    { targetRole: "proofreader", taskTypes: ["verification-format"], reason: "Vérification de la cohérence du formatage" },
    { targetRole: "writer", taskTypes: ["contenu-manquant"], reason: "Signaler les sections vides nécessitant du contenu" },
  ],
  researcher: [
    { targetRole: "planner", taskTypes: ["structuration-recherche", "planification"], reason: "Structuration des findings en plan ou mémoire projet" },
    { targetRole: "coder", taskTypes: ["prototype", "poc"], reason: "Développement d'un prototype technique à partir des sources" },
    { targetRole: "writer", taskTypes: ["redaction-findings"], reason: "Rédaction à partir des résultats de recherche" },
    { targetRole: "summarizer", taskTypes: ["synthese-sources"], reason: "Synthèse des sources collectées" },
  ],
  proofreader: [
    { targetRole: "writer", taskTypes: ["reformulation", "reecriture"], reason: "Réécriture de passages problématiques" },
    { targetRole: "translator", taskTypes: ["verification-traduction"], reason: "Vérification de la qualité d'une traduction" },
  ],
  translator: [
    { targetRole: "proofreader", taskTypes: ["relecture-traduction"], reason: "Relecture de la traduction dans la langue cible" },
    { targetRole: "formatter", taskTypes: ["formatage-traduction"], reason: "Remise en forme du document traduit" },
  ],
  summarizer: [
    { targetRole: "proofreader", taskTypes: ["relecture-resume"], reason: "Relecture du résumé produit" },
    { targetRole: "writer", taskTypes: ["developpement-point"], reason: "Développer un point du résumé si nécessaire" },
  ],
  planner: [
    { targetRole: "coder", taskTypes: ["implementation-tache"], reason: "Implémentation d'une brique selon le plan" },
    { targetRole: "reviewer", taskTypes: ["revue-code", "audit-qualite"], reason: "Délégation de la revue de code à l'agent spécialisé" },
    { targetRole: "tester", taskTypes: ["validation-tests", "qa"], reason: "Délégation de la validation et tests automatisés" },
    { targetRole: "researcher", taskTypes: ["recherche-complementaire"], reason: "Recherche et analyse technique préalable" },
    { targetRole: "writer", taskTypes: ["redaction-section", "redaction-document"], reason: "Rédaction selon le plan établi" },
    { targetRole: "formatter", taskTypes: ["mise-en-forme-plan"], reason: "Formatage du plan en document structuré" },
    { targetRole: "proofreader", taskTypes: ["relecture-document"], reason: "Relecture et correction du document planifié" },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// Vérification de délégation (inclut support des agents personnalisés)
// ═══════════════════════════════════════════════════════════════════════════════

function permissionsFor(role: AgentRole): AgentPermissions {
  const definition = getAgentDefinition(role);
  const isStatic = STATIC_AGENT_ROLES.includes(role as (typeof STATIC_AGENT_ROLES)[number]);

  // Les agents custom doivent déclarer explicitement leurs permissions.
  if (!definition && !isStatic) {
    return { allowDelegation: false, allowReceiveDelegation: false, maxDelegationDepth: 0 };
  }

  const matrixTargets = (DELEGATION_MATRIX[role as (typeof STATIC_AGENT_ROLES)[number]] ?? [])
    .map((entry) => entry.targetRole);
  return definition?.permissions ?? {
    allowDelegation: matrixTargets.length > 0,
    allowReceiveDelegation: isStatic,
    maxDelegationDepth: 3,
    allowedTargets: matrixTargets,
  };
}

export const delegationPolicy: DelegationPolicy = {
  allows(parent, target, task = {}) {
    const parentPermissions = permissionsFor(parent);
    const targetPermissions = permissionsFor(target);
    const depth = task.depth ?? 0;

    if (!parentPermissions.allowDelegation || !targetPermissions.allowReceiveDelegation) return false;
    if (depth >= parentPermissions.maxDelegationDepth || depth >= targetPermissions.maxDelegationDepth) return false;
    if (parentPermissions.allowedTargets && !parentPermissions.allowedTargets.includes(target)) return false;
    if (task.riskLevel === "critical" && parentPermissions.riskLevel !== "critical") return false;
    if (parentPermissions.riskLevel && task.riskLevel === "high" && !["high", "critical"].includes(parentPermissions.riskLevel)) return false;
    if (task.budget !== undefined && parentPermissions.budget?.maxTokens !== undefined && task.budget > parentPermissions.budget.maxTokens) return false;

    const targetDefinition = getAgentDefinition(target);
    if (!targetDefinition) return false;
    if (task.requiredCapabilities?.some((capability) => !targetDefinition.capabilities.includes(capability))) return false;
    if (task.requiredTools?.some((tool) => !targetDefinition.capabilities.includes(tool))) return false;
    if (parentPermissions.allowedCapabilities?.some((capability) => !targetDefinition.capabilities.includes(capability))) return false;
    if (parentPermissions.allowedTools?.some((tool) => !targetDefinition.capabilities.includes(tool))) return false;

    if (task.taskType) {
      const matrixRule = DELEGATION_MATRIX[parent as (typeof STATIC_AGENT_ROLES)[number]]
        ?.find((entry) => entry.targetRole === target);
      if (!matrixRule?.taskTypes.includes(task.taskType)) return false;
    }
    return true;
  },
};

export function isDelegationAllowed(
  fromRole: AgentRole,
  targetRole: AgentRole,
  task?: DelegationTaskContext
): boolean {
  return delegationPolicy.allows(fromRole, targetRole, task);
}

/** Patterns de collaboration entre agents */
export interface CollaborationPattern {
  name: string;
  description: string;
  participants: AgentRole[];
  workflow: Array<{
    step: number;
    agent: AgentRole;
    action: string;
    dependsOn?: number[];
  }>;
}

/** Patterns de collaboration prédéfinis */
export const COLLABORATION_PATTERNS: CollaborationPattern[] = [
  // ── Ingénierie Logicielle ──
  {
    name: "feature-engineering",
    description: "Cycle complet de développement : architecture → implémentation → tests QA → revue de code",
    participants: ["architect", "coder", "tester", "reviewer"],
    workflow: [
      { step: 1, agent: "architect", action: "Définir la structure, contrats d'interfaces et découpage" },
      { step: 2, agent: "coder", action: "Implémenter le code propre et typé selon l'architecture", dependsOn: [1] },
      { step: 3, agent: "tester", action: "Rédiger et exécuter la suite de tests automatisés", dependsOn: [2] },
      { step: 4, agent: "reviewer", action: "Auditer la qualité, lint/types et conformité du code", dependsOn: [3] },
    ],
  },
  {
    name: "code-review-and-fix",
    description: "Revue de code approfondie puis application ciblée et validation",
    participants: ["reviewer", "debugger", "tester"],
    workflow: [
      { step: 1, agent: "reviewer", action: "Auditer le code et lister les anomalies hiérarchisées" },
      { step: 2, agent: "debugger", action: "Appliquer les correctifs ciblés sur les anomalies identifiées", dependsOn: [1] },
      { step: 3, agent: "tester", action: "Vérifier la non-régression et la validité des corrections", dependsOn: [2] },
    ],
  },
  {
    name: "tech-stack-analysis-and-memory",
    description: "Analyse technique approfondie, identification des modules et enrichissement de ProjectMemory",
    participants: ["researcher", "planner", "reviewer"],
    workflow: [
      { step: 1, agent: "researcher", action: "Analyser les dépendances, modules critiques et conventions du dépôt" },
      { step: 2, agent: "planner", action: "Structurer les découvertes et alimenter ProjectMemory via knowledge_memory_add", dependsOn: [1] },
      { step: 3, agent: "reviewer", action: "Vérifier la cohérence de la stack et des règles de validation de code", dependsOn: [2] },
    ],
  },
  // ── Rédaction & Documents ──
  {
    name: "document-complet",
    description: "Création complète d'un document : planification → rédaction → correction → mise en forme",
    participants: ["planner", "writer", "proofreader", "formatter"],
    workflow: [
      { step: 1, agent: "planner", action: "Créer le plan et la structure du document" },
      { step: 2, agent: "writer", action: "Rédiger le contenu selon le plan", dependsOn: [1] },
      { step: 3, agent: "proofreader", action: "Relecture et correction orthographique/grammaticale", dependsOn: [2] },
      { step: 4, agent: "formatter", action: "Mise en forme finale et formatage Markdown", dependsOn: [3] },
    ],
  },
  {
    name: "traduction-verifiee",
    description: "Traduction d'un document avec relecture de qualité",
    participants: ["writer", "translator", "proofreader"],
    workflow: [
      { step: 1, agent: "writer", action: "Préparer et nettoyer le texte source" },
      { step: 2, agent: "translator", action: "Traduire le document", dependsOn: [1] },
      { step: 3, agent: "proofreader", action: "Relecture de la traduction", dependsOn: [2] },
    ],
  },
  {
    name: "recherche-redaction",
    description: "Recherche approfondie puis rédaction documentée",
    participants: ["researcher", "planner", "writer", "proofreader"],
    workflow: [
      { step: 1, agent: "researcher", action: "Recherche et collecte d'informations" },
      { step: 2, agent: "planner", action: "Structurer les findings en plan", dependsOn: [1] },
      { step: 3, agent: "writer", action: "Rédiger le document à partir de la recherche", dependsOn: [2] },
      { step: 4, agent: "proofreader", action: "Relecture et vérification des sources", dependsOn: [3] },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Schemas Zod pour validation
// ═══════════════════════════════════════════════════════════════════════════════

export const agentMessageSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "task_request",
    "task_response",
    "collaboration_request",
    "status_query",
    "status_response",
    "event",
    "broadcast",
  ]),
  from: z.union([z.enum(STATIC_AGENT_ROLES), z.string()]),
  to: z.union([
    z.enum(STATIC_AGENT_ROLES),
    z.string(),
    z.literal("broadcast"),
  ]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  timestamp: z.string().datetime(),
  payload: z.any(), // Validation plus spécifique dans les handlers
  correlationId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const publishOptionsSchema = z.object({
  awaitResponse: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
  routing: z.enum(["direct", "broadcast", "round-robin", "load-balanced"]).optional(),
  retry: z
    .object({
      maxRetries: z.number().int().min(1).max(5),
      backoff: z.enum(["linear", "exponential"]),
    })
    .optional(),
});
