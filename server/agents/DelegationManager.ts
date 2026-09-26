/**
 * DelegationManager — Gestion programmable de la délégation via JSON
 * 
 * Remplace le parsing Markdown par une approche structurée et typée.
 * Permet aux agents de déléguer des tâches via un format JSON standardisé.
 * 
 * Avantages vs DelegationParser (Markdown) :
 * - Format machine-readable, pas de parsing fragile
 * - Validation stricte avec Zod
 * - Support des délégations imbriquées et conditionnelles
 * - Intégration facile avec les outils et APIs
 * - Meilleure traçabilité et audit
 */

import { z } from "zod";
import type { AgentRole, TaskPriority, AgentTask, TaskContext } from "./types.js";
import { isDelegationAllowed } from "./AgentCommunication.js";
import { listAgentRoles } from "./roles.js";
import { agentMessageBus } from "./AgentMessageBus.js";
import { randomUUID } from "crypto";
import { createLogger } from "../utils/logger.js";
import type { TaskRequestPayload } from "./AgentCommunication.js";

const log = createLogger("DelegationManager");

// ═══════════════════════════════════════════════════════════════════════════════
// Types pour la délégation structurée
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format JSON standard pour une délégation unique.
 * Utilisé quand un agent veut déléguer une tâche spécifique à un autre agent.
 */
export interface StructuredDelegation {
  /** Rôle de l'agent cible */
  targetRole: AgentRole;
  
  /** Titre de la tâche à déléguer */
  title: string;
  
  /** Description détaillée de la tâche */
  description: string;
  
  /** Priorité de la tâche */
  priority?: TaskPriority;
  
  /** Fichiers concernés par la tâche */
  files?: string[];
  
  /** Instructions supplémentaires pour l'agent cible */
  instructions?: string;
  
  /** Contexte supplémentaire (métadonnées libres) */
  context?: Record<string, unknown>;
  
  /** Timeout en ms (override du timeout par défaut de l'agent) */
  timeoutMs?: number;
  
  /** Condition pour déclencher la délégation (optionnel) */
  condition?: {
    type: "always" | "on_success" | "on_failure" | "on_complete";
    value?: string; // Pour les conditions personnalisées
  };
  
  /** ID de corrélation pour suivre la délégation dans un workflow */
  correlationId?: string;
}

/**
 * Format JSON pour une délégation multiple (orchestration).
 * Permet de déléguer plusieurs tâches en parallèle ou séquentiellement.
 */
export interface BatchDelegation {
  /** ID unique de ce batch de délégations */
  batchId: string;
  
  /** Stratégie d'exécution : parallel, sequential, ou conditional */
  strategy: "parallel" | "sequential" | "conditional";
  
  /** Liste des délégations à exécuter */
  delegations: StructuredDelegation[];
  
  /** Conditions pour l'exécution du batch */
  conditions?: {
    allSucceed?: boolean; // Tous doivent réussir
    anySucceed?: boolean; // Au moins un doit réussir
    maxFailures?: number; // Nombre max d'échecs tolérés
  };
  
  /** Callback à exécuter après le batch (optionnel) */
  onComplete?: {
    agentRole: AgentRole;
    instructions: string;
  };
}

/**
 * Résultat d'une délégation structurée
 */
export interface DelegationResult {
  /** ID de la délégation */
  delegationId: string;
  
  /** ID de la tâche créée */
  taskId?: string;
  
  /** Succès ou échec de la délégation */
  success: boolean;
  
  /** Rôle cible */
  targetRole: AgentRole;
  
  /** Message d'erreur si échec */
  error?: string;
  
  /** Timestamp de création */
  timestamp: string;
  
  /** Statut actuel */
  status: "pending" | "accepted" | "rejected" | "completed" | "failed" | "cancelled";
}

/**
 * Événement de délégation pour le traçage
 */
export interface DelegationEvent {
  type: "delegation_created" | "delegation_accepted" | "delegation_rejected" | "delegation_completed" | "delegation_failed";
  delegationId: string;
  fromRole: AgentRole;
  targetRole: AgentRole;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schemas pour validation
// ═══════════════════════════════════════════════════════════════════════════════

const taskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);

const agentRoleSchema = z.union([
  z.enum(listAgentRoles() as [string, ...string[]]),
  z.string().min(1).max(64)
]);

export const structuredDelegationSchema = z.object({
  targetRole: agentRoleSchema,
  title: z.string().min(1, "Le titre est requis").trim(),
  description: z.string().min(1, "La description est requise").trim(),
  priority: taskPrioritySchema.optional().default("medium"),
  files: z.array(z.string()).optional().default([]),
  instructions: z.string().optional(),
  context: z.record(z.unknown()).optional().default({}),
  timeoutMs: z.number().int().positive().optional(),
  condition: z.object({
    type: z.enum(["always", "on_success", "on_failure", "on_complete"]),
    value: z.string().optional()
  }).optional().default({ type: "always" }),
  correlationId: z.string().uuid().optional()
});

export const batchDelegationSchema = z.object({
  batchId: z.string().uuid(),
  strategy: z.enum(["parallel", "sequential", "conditional"]),
  delegations: z.array(structuredDelegationSchema).min(1),
  conditions: z.object({
    allSucceed: z.boolean().optional(),
    anySucceed: z.boolean().optional(),
    maxFailures: z.number().int().nonnegative().optional()
  }).optional().default({}),
  onComplete: z.object({
    agentRole: agentRoleSchema,
    instructions: z.string().trim()
  }).optional()
});

// ═══════════════════════════════════════════════════════════════════════════════
// DelegationManager
// ═══════════════════════════════════════════════════════════════════════════════

export class DelegationManager {
  private delegationEvents: DelegationEvent[] = [];
  private delegationResults: Map<string, DelegationResult> = new Map();
  private pendingDelegations: Map<string, StructuredDelegation> = new Map();
  private maxHistorySize = 1000;

  /**
   * Parse une délégation à partir d'un format JSON.
   * Retourne les délégations valides ou lève une erreur de validation.
   */
  parseFromJSON(jsonInput: string, fromRole: AgentRole): StructuredDelegation[] {
    try {
      const parsed = JSON.parse(jsonInput);
      
      // Si c'est un tableau, parser chaque élément
      if (Array.isArray(parsed)) {
        return parsed.map((item, index) => 
          this.parseSingleDelegation(item, fromRole, index)
        ).filter(Boolean) as StructuredDelegation[];
      }
      
      // Si c'est un objet unique
      if (typeof parsed === 'object' && parsed !== null) {
        // Vérifier si c'est un BatchDelegation
        if (parsed.batchId && parsed.delegations) {
          const batch = batchDelegationSchema.parse(parsed);
          return batch.delegations.map(d => this.validateAndEnrichDelegation(d, fromRole));
        }
        
        // Sinon, c'est une délégation unique
        const delegation = this.parseSingleDelegation(parsed, fromRole, 0, true);
        return delegation ? [delegation] : [];
      }
      
      throw new Error("Format JSON invalide : doit être un objet ou un tableau");
    } catch (error) {
      if (error instanceof z.ZodError) {
        log.error(`Validation échouée : ${error.errors.map(e => e.message).join(', ')}`);
        throw new Error(`Délégation invalide : ${error.errors[0].message}`);
      }
      log.error(`Erreur de parsing JSON : ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Parse une seule délégation avec validation
   */
  private parseSingleDelegation(
    data: unknown,
    fromRole: AgentRole,
    index: number,
    throwOnError = false
  ): StructuredDelegation | null {
    try {
      const validated = structuredDelegationSchema.parse(data);
      return this.validateAndEnrichDelegation(validated, fromRole);
    } catch (error) {
      if (throwOnError) throw error;
      log.warn(`Délégation #${index} invalide : ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Valide et enrichit une délégation
   */
  private validateAndEnrichDelegation(
    delegation: StructuredDelegation,
    fromRole: AgentRole
  ): StructuredDelegation {
    // Validation de la délégation
    if (!isDelegationAllowed(fromRole, delegation.targetRole)) {
      const error = new Error(
        `Délégation non autorisée : [${fromRole}] → [${delegation.targetRole}]`
      );
      log.warn(`Délégation refusée : ${error.message}`);
      throw error;
    }

    // Enrichir avec des valeurs par défaut
    return {
      ...delegation,
      priority: delegation.priority ?? "medium",
      files: delegation.files ?? [],
      context: delegation.context ?? {},
      condition: delegation.condition ?? { type: "always" },
      correlationId: delegation.correlationId ?? randomUUID()
    };
  }

  /**
   * Parse une délégation à partir d'un format YAML (alternative au JSON)
   */
  async parseFromYAML(yamlInput: string, fromRole: AgentRole): Promise<StructuredDelegation[]> {
    // Essayer de parser le YAML
    // Note: En production, utiliser js-yaml ou similar
    // Pour l'instant, on suppose que le YAML est converti en JSON
    try {
      // Simple YAML parser pour les cas basiques
      const jsonLike = this.simpleYAMLToJSON(yamlInput);
      return this.parseFromJSON(jsonLike, fromRole);
    } catch (error) {
      log.error(`Parsing YAML échoué : ${(error as Error).message}`);
      throw new Error(`Format YAML invalide : ${(error as Error).message}`);
    }
  }

  /**
   * Convertisseur simple YAML -> JSON (pour les cas basiques)
   */
  private simpleYAMLToJSON(yaml: string): string {
    // Ce convertisseur gère seulement les cas simples
    // Pour une implémentation complète, utiliser js-yaml
    const lines = yaml.split('\n');
    const result: Record<string, unknown> = {};
    let current: Record<string, unknown> = result;
    const stack: Record<string, unknown>[] = [result];
    let indentStack: number[] = [0];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.search(/\S/);
      const content = line.slice(indent);

      // Pop stack si moins indenté
      while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 1]!) {
        indentStack.pop();
        stack.pop();
      }

      current = stack[stack.length - 1]!;

      // Key: value
      const colonIdx = content.indexOf(':');
      if (colonIdx > 0) {
        const key = content.slice(0, colonIdx).trim();
        let value = content.slice(colonIdx + 1).trim();

        // Check if value starts a block
        if (value === '' || value.startsWith('-') || value.includes(':')) {
          const newObj: Record<string, unknown> = {};
          current[key] = newObj;
          stack.push(newObj);
          indentStack.push(indent + 2);
        } else if (value.startsWith('-')) {
          // Array
          const items = value.split('-').slice(1).map(v => v.trim()).filter(Boolean);
          current[key] = items.length === 1 ? items[0] : items;
        } else {
          // Simple value
          current[key] = this.parseYAMLValue(value);
        }
      } else if (content.startsWith('-')) {
        // Array item
        const value = content.slice(1).trim();
        const parent = stack[stack.length - 2] || current;
        const lastKey = Object.keys(current)[Object.keys(current).length - 1];
        if (lastKey && Array.isArray(parent[lastKey])) {
          (parent[lastKey] as unknown[]).push(value);
        } else {
          Object.values(parent).pop()
        }
      }
    }

    return JSON.stringify(result);
  }

  /**
   * Parse une valeur YAML simple
   */
  private parseYAMLValue(value: string): unknown {
    if (value === 'true' || value === 'True') return true;
    if (value === 'false' || value === 'False') return false;
    if (value === 'null' || value === 'Null' || value === '~') return null;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  /**
   * Exécute une délégation structurée.
   * Crée une tâche et l'envoie à l'agent cible via le MessageBus.
   */
  async executeDelegation(
    delegation: StructuredDelegation,
    fromRole: AgentRole
  ): Promise<DelegationResult> {
    const delegationId = delegation.correlationId ?? randomUUID();
    const timestamp = new Date().toISOString();

    // Valider la délégation
    try {
      const validatedDelegation = this.validateAndEnrichDelegation(delegation, fromRole);
      
      // Créer la tâche
      const taskId = randomUUID();
      const task: AgentTask = {
        id: taskId,
        role: validatedDelegation.targetRole,
        title: validatedDelegation.title,
        description: validatedDelegation.description,
        priority: validatedDelegation.priority as TaskPriority,
        status: "pending",
        context: {
          files: validatedDelegation.files ?? [],
          instructions: validatedDelegation.instructions,
          metadata: validatedDelegation.context
        } as TaskContext,
        createdAt: timestamp,
        timeoutMs: validatedDelegation.timeoutMs
      };

      // Envoyer via le MessageBus
      const messagePayload: TaskRequestPayload = {
        type: "task_request",
        taskId: task.id,
        title: task.title,
        description: task.description,
        files: task.context.files,
        instructions: task.context.instructions as string | undefined,
        context: task.context.metadata as Record<string, unknown> | undefined
      };

      await agentMessageBus.publish({
        id: randomUUID(),
        type: "task_request",
        from: fromRole,
        to: validatedDelegation.targetRole,
        priority: validatedDelegation.priority ?? "medium",
        timestamp,
        payload: messagePayload,
        correlationId: delegationId
      });

      // Enregistrer l'événement
      this.recordEvent({
        type: "delegation_created",
        delegationId,
        fromRole,
        targetRole: validatedDelegation.targetRole,
        timestamp,
        metadata: {
          taskId,
          title: validatedDelegation.title,
          priority: validatedDelegation.priority
        }
      });

      const result: DelegationResult = {
        delegationId,
        taskId: task.id,
        success: true,
        targetRole: validatedDelegation.targetRole,
        timestamp,
        status: "accepted"
      };

      this.delegationResults.set(delegationId, result);
      this.pendingDelegations.set(delegationId, validatedDelegation);

      log.info(
        `✅ Délégation [${fromRole}] → [${validatedDelegation.targetRole}] ` +
        `"${validatedDelegation.title}" (id: ${delegationId.slice(0, 8)})`
      );

      return result;
    } catch (error) {
      const result: DelegationResult = {
        delegationId,
        success: false,
        targetRole: delegation.targetRole,
        error: (error as Error).message,
        timestamp,
        status: "rejected"
      };

      this.delegationResults.set(delegationId, result);
      this.recordEvent({
        type: "delegation_rejected",
        delegationId,
        fromRole,
        targetRole: delegation.targetRole,
        timestamp,
        metadata: { error: (error as Error).message }
      });

      log.error(
        `❌ Délégation refusée : [${fromRole}] → [${delegation.targetRole}] : ${(error as Error).message}`
      );

      throw error;
    }
  }

  /**
   * Exécute un batch de délégations
   */
  async executeBatch(delegation: BatchDelegation, fromRole: AgentRole): Promise<DelegationResult[]> {
    const results: DelegationResult[] = [];
    const timestamp = new Date().toISOString();

    log.info(
      `📦 Exécution batch de ${delegation.delegations.length} délégations ` +
      `(stratégie: ${delegation.strategy})`
    );

    switch (delegation.strategy) {
      case "parallel":
        // Exécuter toutes en parallèle
        const promises = delegation.delegations.map(d => 
          this.executeDelegation(d, fromRole).catch(err => ({
            delegationId: randomUUID(),
            success: false,
            targetRole: d.targetRole,
            error: (err as Error).message,
            timestamp,
            status: "failed" as const
          }))
        );
        results.push(...(await Promise.all(promises)));
        break;

      case "sequential":
        // Exécuter séquentiellement
        for (const d of delegation.delegations) {
          try {
            const result = await this.executeDelegation(d, fromRole);
            results.push(result);
            
            // Vérifier les conditions de sortie
            if (delegation.conditions?.maxFailures !== undefined) {
              const failures = results.filter(r => !r.success).length;
              if (failures >= delegation.conditions.maxFailures) {
                log.warn(
                  `🛑 Batch interrompu : ${failures} échecs atteints (max: ${delegation.conditions.maxFailures})`
                );
                break;
              }
            }
          } catch (error) {
            results.push({
              delegationId: randomUUID(),
              success: false,
              targetRole: d.targetRole,
              error: (error as Error).message,
              timestamp,
              status: "failed"
            });
          }
        }
        break;

      case "conditional":
        // Exécuter avec des dépendances conditionnelles
        for (const d of delegation.delegations) {
          const condition = d.condition?.type ?? "always";
          
          // Vérifier si la condition est remplie
          const shouldExecute = this.evaluateCondition(condition, results);
          
          if (shouldExecute) {
            try {
              const result = await this.executeDelegation(d, fromRole);
              results.push(result);
            } catch (error) {
              results.push({
                delegationId: randomUUID(),
                success: false,
                targetRole: d.targetRole,
                error: (error as Error).message,
                timestamp,
                status: "failed"
              });
            }
          } else {
            log.debug(`⏭️ Délégation conditionnelle ignorée : ${d.title} (condition: ${condition})`);
          }
        }
        break;
    }

    // Exécuter le callback onComplete si tout est OK
    if (delegation.onComplete && this.shouldExecuteOnComplete(delegation, results)) {
      try {
        await this.executeOnCompleteCallback(delegation.onComplete, fromRole, delegation.batchId);
      } catch (error) {
        log.error(`Erreur dans onComplete callback : ${(error as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Évalue si une délégation doit être exécutée basée sur sa condition
   */
  private evaluateCondition(condition: string, results: DelegationResult[]): boolean {
    switch (condition) {
      case "always":
        return true;
      case "on_success":
        return results.every(r => r.success);
      case "on_failure":
        return results.some(r => !r.success);
      case "on_complete":
        return results.length > 0;
      default:
        return true;
    }
  }

  /**
   * Détermine si le callback onComplete doit être exécuté
   */
  private shouldExecuteOnComplete(
    delegation: BatchDelegation,
    results: DelegationResult[]
  ): boolean {
    if (!delegation.conditions) return true;
    
    if (delegation.conditions.allSucceed) {
      return results.every(r => r.success);
    }
    if (delegation.conditions.anySucceed) {
      return results.some(r => r.success);
    }
    return true;
  }

  /**
   * Exécute le callback onComplete
   */
  private async executeOnCompleteCallback(
    callback: NonNullable<BatchDelegation['onComplete']>,
    fromRole: AgentRole,
    batchId: string
  ): Promise<void> {
    log.info(`🎯 Exécution callback onComplete : [${fromRole}] → [${callback.agentRole}]`);

    await agentMessageBus.publish({
      id: randomUUID(),
      type: "event",
      from: fromRole,
      to: callback.agentRole,
      priority: "medium",
      timestamp: new Date().toISOString(),
      payload: {
        type: "event",
        eventType: "batch_complete",
        data: {
          batchId,
          instructions: callback.instructions
        }
      }
    });
  }

  /**
   * Génère un template JSON pour une délégation
   */
  generateDelegationTemplate(targetRole: AgentRole = "coder"): string {
    return `{
  "targetRole": "${targetRole}",
  "title": "Titre de la tâche à déléguer",
  "description": "Description détaillée de ce que l'agent doit faire",
  "priority": "medium",
  "files": ["fichier1.ts", "fichier2.ts"],
  "instructions": "Instructions supplémentaires optionnelles",
  "context": {
    "metadata": "valeur"
  },
  "timeoutMs": 30000,
  "condition": {
    "type": "always"
  }
}`;
  }

  /**
   * Génère un template JSON pour un batch de délégations
   */
  generateBatchTemplate(strategy: "parallel" | "sequential" | "conditional" = "parallel"): string {
    return `{
  "batchId": "${randomUUID()}",
  "strategy": "${strategy}",
  "delegations": [
    {
      "targetRole": "coder",
      "title": "Tâche 1",
      "description": "Description de la tâche 1"
    },
    {
      "targetRole": "tester",
      "title": "Tâche 2",
      "description": "Description de la tâche 2"
    }
  ],
  "conditions": {
    "allSucceed": true
  }
}`;
  }

  /**
   * Retourne l'historique des délégations
   */
  getDelegationHistory(limit = 100): DelegationEvent[] {
    return this.delegationEvents.slice(-limit);
  }

  /**
   * Retourne les résultats des délégations
   */
  getDelegationResults(limit = 100): DelegationResult[] {
    return Array.from(this.delegationResults.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Retourne les délégations en attente
   */
  getPendingDelegations(): StructuredDelegation[] {
    return Array.from(this.pendingDelegations.values());
  }

  /**
   * Annule une délégation en attente
   */
  cancelDelegation(delegationId: string): boolean {
    if (!this.pendingDelegations.has(delegationId)) {
      return false;
    }

    this.pendingDelegations.delete(delegationId);
    const result = this.delegationResults.get(delegationId);
    
    if (result) {
      result.status = "cancelled";
      result.success = false;
      result.error = "Délégation annulée";
      this.delegationResults.set(delegationId, result);
    }

    this.recordEvent({
      type: "delegation_failed",
      delegationId,
      fromRole: "unknown",
      targetRole: result?.targetRole ?? "unknown",
      timestamp: new Date().toISOString(),
      metadata: { reason: "cancelled" }
    });

    log.info(`🚫 Délégation annulée : ${delegationId.slice(0, 8)}`);
    return true;
  }

  /**
   * Met à jour le statut d'une délégation
   */
  updateDelegationStatus(
    delegationId: string,
    status: DelegationResult['status'],
    error?: string
  ): boolean {
    const result = this.delegationResults.get(delegationId);
    
    if (!result) {
      return false;
    }

    result.status = status;
    if (error) {
      result.error = error;
      result.success = false;
    }

    this.delegationResults.set(delegationId, result);

    // Enregistrer l'événement
    const eventType = status === "completed" ? "delegation_completed" : "delegation_failed";
    this.recordEvent({
      type: eventType as DelegationEvent['type'],
      delegationId,
      fromRole: "unknown", // TODO: stocker le fromRole dans le résultat
      targetRole: result.targetRole,
      timestamp: new Date().toISOString(),
      metadata: { status, error }
    });

    // Retirer de pending si complétée
    if (status === "completed" || status === "failed") {
      this.pendingDelegations.delete(delegationId);
    }

    return true;
  }

  /**
   * Enregistre un événement de délégation
   */
  private recordEvent(event: DelegationEvent): void {
    this.delegationEvents.push(event);
    
    // Limiter l'historique
    if (this.delegationEvents.length > this.maxHistorySize) {
      this.delegationEvents.splice(0, 100);
    }

    // Émettre l'événement pour les listeners
    this.emitDelegationEvent(event);
  }

  /**
   * Émet un événement de délégation (pour les observers)
   */
  private emitDelegationEvent(event: DelegationEvent): void {
    // Peut être étendu pour émettre via EventEmitter ou WebSocket
    log.debug(`📡 Événement délégation : ${event.type} (${event.delegationId.slice(0, 8)})`);
  }

  /**
   * Retourne les statistiques de délégation
   */
  getStatistics(): {
    totalDelegations: number;
    pending: number;
    completed: number;
    failed: number;
    byTargetRole: Record<string, number>;
    byFromRole: Record<string, number>;
    byPriority: Record<TaskPriority, number>;
  } {
    const stats = {
      totalDelegations: this.delegationResults.size,
      pending: 0,
      completed: 0,
      failed: 0,
      byTargetRole: {} as Record<string, number>,
      byFromRole: {} as Record<string, number>,
      byPriority: { low: 0, medium: 0, high: 0, critical: 0 } as Record<TaskPriority, number>
    };

    // Compter par statut
    for (const result of this.delegationResults.values()) {
      if (result.status === "pending" || result.status === "accepted") {
        stats.pending++;
      } else if (result.status === "completed") {
        stats.completed++;
      } else {
        stats.failed++;
      }

      // Par rôle cible
      stats.byTargetRole[result.targetRole] = (stats.byTargetRole[result.targetRole] ?? 0) + 1;
    }

    // Compter par priorité dans les délégations en attente
    for (const delegation of this.pendingDelegations.values()) {
      stats.byPriority[delegation.priority ?? "medium"]++;
    }

    return stats;
  }

  /**
   * Nettoie les données anciennes (pour éviter les fuites mémoire)
   */
  cleanupOldData(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;

    // Nettoyer les résultats anciens
    for (const [id, result] of this.delegationResults) {
      const resultTime = new Date(result.timestamp).getTime();
      if (resultTime < cutoff && result.status !== "pending") {
        this.delegationResults.delete(id);
      }
    }

    // Nettoyer les événements anciens
    this.delegationEvents = this.delegationEvents.filter(
      e => new Date(e.timestamp).getTime() >= cutoff
    );

    log.debug(`🧹 Nettoyage : ${this.delegationResults.size} résultats, ${this.delegationEvents.length} événements conservés`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

export const delegationManager = new DelegationManager();
