/**
 * DelegationDispatcher — Délégations autonomes entre agents
 *
 * Responsabilité unique : parser les blocs `## DÉLÉGATION` de la sortie d'un
 * agent et publier les `task_request` correspondants sur le bus de messages.
 *
 * Détient l'état des chaînes de délégation actives pour :
 *   - détecter les cycles (A -> B -> A),
 *   - borner la profondeur (max `MAX_DELEGATION_DEPTH` niveaux).
 *
 * Les sous-tâches sont lancées en parallèle (fire-and-forget) : elles
 * s'exécutent indépendamment et leurs résultats sont loggés.
 */
import { randomUUID } from "crypto";
import type { AgentTask } from "./types.js";
import { getAgentDefinition } from "./roles.js";
import { DelegationParser, type ParsedDelegation } from "./DelegationParser.js";
import { agentMessageBus } from "./AgentMessageBus.js";
import type { TaskRequestPayload } from "./AgentCommunication.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("DelegationDispatcher");

export class DelegationDispatcher {
  private delegationParser = new DelegationParser();

  /**
   * Limite de profondeur maximale pour les délégations (évite les cascades infinies)
   */
  private static readonly MAX_DELEGATION_DEPTH = 4;

  /**
   * Map pour suivre les chaînes de délégation actives et détecter les cycles
   * Clé: parentTaskId, Valeur: Set des rôles déjà rencontrés dans cette chaîne
   */
  private delegationChains: Map<string, Set<string>> = new Map();

  /**
   * Parse la sortie de l'agent, extrait les blocs ## DÉLÉGATION
   * et envoie des task_request sur le bus pour chaque délégation valide.
   *
   * Les sous-tâches sont lancées en parallèle (fire-and-forget) :
   * elles s'exécutent indépendamment et leurs résultats sont loggés.
   * On retourne les IDs des tâches déléguées pour la traçabilité.
   */
  async dispatchDelegations(
    parentTask: AgentTask,
    resultText: string,
    depth: number = 0
  ): Promise<string[]> {
    const { delegations, warnings } = this.delegationParser.parse(
      resultText,
      parentTask.role
    );

    // Logger les avertissements de parsing
    for (const w of warnings) {
      log.warn(`[DelegationParser] ${w}`);
    }

    if (delegations.length === 0) return [];

    const agent = getAgentDefinition(parentTask.role);
    if (!agent) {
      log.error(`[dispatchDelegations] Agent "${parentTask.role}" introuvable`);
      return [];
    }
    log.info(
      `🔀 [${agent.name}] ${delegations.length} délégation(s) détectée(s) à profondeur ${depth} — dispatch en cours...`
    );

    const subTaskIds: string[] = [];
    const nextDepth = depth + 1;

    try {
      // Lancer toutes les délégations en parallèle (fire-and-forget)
      const dispatches = delegations.map((delegation: ParsedDelegation) =>
        this.sendDelegation(parentTask, delegation, nextDepth).then((taskId) => {
          if (taskId) subTaskIds.push(taskId);
        })
      );

      await Promise.allSettled(dispatches);

      log.info(
        `[${agent.name}] ${subTaskIds.length}/${delegations.length} délégation(s) envoyée(s) sur le bus (profondeur: ${nextDepth})`
      );

      return subTaskIds;
    } finally {
      // Nettoyer la chaîne seulement une fois tous les dispatches de ce parent terminés
      this.delegationChains.delete(parentTask.id);
    }
  }

  /**
   * Envoie une délégation unique sur le bus de messages.
   * Retourne l'ID de la sous-tâche créée, ou null en cas d'erreur.
   *
   * Implémente :
   * - Détection de cycle : empêche A -> B -> A
   * - Limite de profondeur : max 4 niveaux de délégation
   */
  private async sendDelegation(
    parentTask: AgentTask,
    delegation: ParsedDelegation,
    depth: number = 0
  ): Promise<string | null> {
    const taskId = randomUUID();
    const agent = getAgentDefinition(parentTask.role);
    if (!agent) {
      log.error(`[sendDelegation] Agent "${parentTask.role}" introuvable`);
      return null;
    }

    // Vérifier la limite de profondeur
    if (depth >= DelegationDispatcher.MAX_DELEGATION_DEPTH) {
      log.warn(
        `[${agent.name}] Délégation rejetée : profondeur maximale atteinte (${DelegationDispatcher.MAX_DELEGATION_DEPTH}) - ` +
        `chaîne: ${this.formatDelegationChain(parentTask.id)}`
      );
      return null;
    }

    // Vérifier les cycles dans la chaîne de délégation
    const chain = this.getDelegationChain(parentTask.id);
    if (chain.has(delegation.targetRole)) {
      log.warn(
        `[${agent.name}] Délégation rejetée : cycle détecté - ${delegation.targetRole} est déjà dans la chaîne: ` +
        `${Array.from(chain).join(' -> ')} -> ${delegation.targetRole}`
      );
      return null;
    }

    // Enregistrer cette délégation dans la chaîne
    this.addToDelegationChain(parentTask.id, delegation.targetRole);

    // Construire une description enrichie avec le contexte du parent
    const description = [
      `Sous-tâche déléguée par [${agent.name}]`,
      ``,
      `Raison : ${delegation.reason}`,
      ``,
      `Contexte de la tâche parent :`,
      `- Titre : ${parentTask.title}`,
      `- Description : ${parentTask.description.slice(0, 300)}`,
      ...(parentTask.result?.summary
        ? [`- Résultat parent : ${parentTask.result.summary}`]
        : []),
    ].join("\n");

    const message = {
      id: randomUUID(),
      type: "task_request" as const,
      from: parentTask.role,
      to: delegation.targetRole,
      priority: delegation.priority as "low" | "medium" | "high" | "critical",
      timestamp: new Date().toISOString(),
      payload: {
        type: "task_request",
        taskId,
        title: `[Sous-tâche] ${delegation.reason.slice(0, 80)}`,
        description,
        files: [
          ...delegation.files,
          // Inclure aussi les fichiers du parent qui sont pertinents
          ...(parentTask.result?.filesModified ?? []),
        ].filter((v, i, arr) => arr.indexOf(v) === i), // dédupliquer
        instructions: delegation.instructions,
      } as TaskRequestPayload,
      metadata: {
        parentTaskId: parentTask.id,
        parentRole: parentTask.role,
        delegationBlockIndex: delegation.blockIndex,
        autonomous: true,
      },
    };

    try {
      // Publish fire-and-forget (pas d'await de réponse — la sous-tâche s'exécute de manière autonome)
      await agentMessageBus.publish(message);

      log.info(
        `📤 [${agent.name}] Délégation envoyée → [${delegation.targetRole}]: "${delegation.reason.slice(0, 60)}" (task: ${taskId.slice(0, 8)})`
      );
      return taskId;
    } catch (err) {
      log.error(
        `[${agent.name}] Échec envoi délégation → [${delegation.targetRole}]: ${(err as Error).message}`
      );
      return null;
    }
  }

  /**
   * Récupère la chaîne de délégation pour une tâche
   */
  private getDelegationChain(taskId: string): Set<string> {
    let chain = this.delegationChains.get(taskId);
    if (!chain) {
      chain = new Set<string>();
      this.delegationChains.set(taskId, chain);
    }
    return chain;
  }

  /**
   * Ajoute un rôle à la chaîne de délégation
   */
  private addToDelegationChain(taskId: string, role: string): void {
    let chain = this.delegationChains.get(taskId);
    if (!chain) {
      chain = new Set<string>();
      this.delegationChains.set(taskId, chain);
    }
    chain.add(role);
  }

  /**
   * Formate la chaîne de délégation pour le log
   */
  private formatDelegationChain(taskId: string): string {
    const chain = this.delegationChains.get(taskId);
    return chain ? Array.from(chain).join(' -> ') : taskId;
  }
}
