/**
 * AgentMessageBus — Bus de messages inter-agents
 *
 * Implémente un système de messagerie pub/sub + request/response
 * permettant aux agents de communiquer de manière asynchrone et découplée.
 *
 * Fonctionnalités :
 * - Publish/Subscribe par rôle et type de message
 * - Request/Response avec timeout et corrélation
 * - Broadcast à tous les agents
 * - Queue de messages avec priorité
 * - Retry avec backoff exponentiel
 * - Métriques et historique des messages
 * - Routage avancé (round-robin, load-balancing)
 * - Surveillance et traçage des messages
 */
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { AgentRole } from "./types.js";
import type {
  AgentMessage,
  MessageHandler,
  MessageSubscription,
  PublishOptions,
  RoutingStrategy,
  StatusResponsePayload,
} from "./AgentCommunication.js";
import { agentPersistence } from "./AgentPersistence.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AgentMessageBus");

// ─── Types internes ───────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (message: AgentMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface MessageMetric {
  messageId: string;
  from: AgentRole;
  to: AgentRole | "broadcast";
  type: string;
  timestamp: number;
  processingMs?: number;
  success: boolean;
  strategy?: RoutingStrategy;
  agentLoad?: Record<AgentRole, number>;
}

// Métriques de routage pour le load-balancing
interface RoutingMetrics {
  /** Nombre de messages traités par agent */
  agentMessageCount: Map<AgentRole, number>;
  /** Nombre de messages en cours par agent */
  agentActiveMessages: Map<AgentRole, number>;
  /** Temps moyen de traitement par agent (ms) */
  agentAvgProcessingTime: Map<AgentRole, number>;
  /** Dernier temps de traitement par agent */
  agentLastProcessingTime: Map<AgentRole, number>;
}

// État pour le round-robin par rôle cible
interface RoundRobinState {
  /** Index courant pour chaque rôle cible */
  index: Map<AgentRole, number>;
  /** Liste des abonnés pour chaque rôle */
  subscribers: Map<AgentRole, string[]>;
}

// TTL de la dead-letter queue (ms) — messages non livrés expirés après ce délai
const DEAD_LETTER_TTL_MS = 60_000;

interface DeadLetterEntry {
  message: AgentMessage;
  enqueuedAt: number;
  attempts: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AgentMessageBus
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentMessageBus extends EventEmitter {
  private subscriptions: Map<string, MessageSubscription> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageHistory: AgentMessage[] = [];
  private metrics: MessageMetric[] = [];
  /** Dead-letter queue : messages non délivrés car l'agent cible n'était pas abonné */
  private deadLetterQueue: Map<AgentRole, DeadLetterEntry[]> = new Map();

  // ─── Routage avancé ───────────────────────────────────────────────────────────
  
  /** Métriques de routage pour le load-balancing */
  private routingMetrics: RoutingMetrics = {
    agentMessageCount: new Map(),
    agentActiveMessages: new Map(),
    agentAvgProcessingTime: new Map(),
    agentLastProcessingTime: new Map(),
  };

  /** État pour le round-robin */
  private roundRobinState: RoundRobinState = {
    index: new Map(),
    subscribers: new Map(),
  };



  // ─── Traçage et surveillance ──────────────────────────────────────────────────
  
  /** ID de trace pour corrélation des messages */
  private traceEnabled = true;
  private traceIdCounter = 0;

  constructor(private readonly maxHistorySize = 100) {
    super();
  }

  // ─── Subscription ─────────────────────────────────────────────────────────

  /**
   * Abonne un agent à un type de message.
   * Déclenche la re-livraison des messages en dead-letter queue pour ce rôle.
   * @returns ID de subscription pour désabonnement
   */
  subscribe(
    agentRole: AgentRole,
    messageType: AgentMessage["type"] | "*",
    handler: MessageHandler
  ): string {
    const subId = randomUUID();
    this.subscriptions.set(subId, {
      id: subId,
      agentRole,
      messageType,
      handler,
    });
    log.debug(`📬 Agent "${agentRole}" abonné au type "${messageType}" (sub: ${subId.slice(0, 8)})`);

    // Re-livrer immédiatement les messages en attente pour ce rôle
    this.flushDeadLetterQueue(agentRole).catch((err) => {
      log.warn(`Échec flush dead-letter queue pour "${agentRole}": ${(err as Error).message}`);
    });

    return subId;
  }

  /**
   * Désabonne un agent via son ID de subscription.
   */
  unsubscribe(subscriptionId: string): boolean {
    const removed = this.subscriptions.delete(subscriptionId);
    if (removed) log.debug(`📭 Subscription ${subscriptionId.slice(0, 8)} supprimée`);
    return removed;
  }

  /**
   * Désabonne tous les handlers d'un agent.
   */
  unsubscribeAll(agentRole: AgentRole): void {
    for (const [id, sub] of this.subscriptions) {
      if (sub.agentRole === agentRole) {
        this.subscriptions.delete(id);
      }
    }
    log.debug(`📭 Toutes les subscriptions de "${agentRole}" supprimées`);
  }

  // ─── Publication ──────────────────────────────────────────────────────────

  /**
   * Publie un message sur le bus (sans attendre de réponse).
   */
  async publish(message: AgentMessage, options: PublishOptions = {}): Promise<void> {
    this.addToHistory(message);
    log.debug(
      `📤 [${message.from}] → [${message.to}] type="${message.type}" id=${message.id.slice(0, 8)}`
    );

    // Retry si configuré
    if (options.retry) {
      await this.withRetry(() => this.deliver(message, options), options.retry);
    } else {
      await this.deliver(message, options);
    }
  }

  /**
   * Publie un message et attend une réponse (request/response pattern).
   * @throws Timeout si la réponse n'arrive pas dans le délai
   */
  async request(
    message: AgentMessage,
    timeoutMs: number = 120_000
  ): Promise<AgentMessage> {
    const correlationId = randomUUID();
    message.correlationId = correlationId;

    this.addToHistory(message);
    log.debug(
      `📤 [${message.from}] → [${message.to}] request id=${message.id.slice(0, 8)} correl=${correlationId.slice(0, 8)}`
    );

    return new Promise<AgentMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(
          new Error(
            `Timeout: aucune réponse de "${message.to}" pour la requête ${message.id.slice(0, 8)} (${timeoutMs}ms)`
          )
        );
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timeout });
      this.deliver(message, {}).catch(reject);
    });
  }

  /**
   * Diffuse un message à tous les agents abonnés.
   */
  async broadcast(
    from: AgentRole,
    eventType: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    const message: AgentMessage = {
      id: randomUUID(),
      type: "broadcast",
      from,
      to: "broadcast",
      priority: "low",
      timestamp: new Date().toISOString(),
      payload: { type: "broadcast", message: eventType, data },
    };

    this.addToHistory(message);
    log.debug(`📢 [${from}] broadcast: "${eventType}"`);
    await this.deliverToAll(message);
  }

  /**
   * Répond à un message (ferme le cycle request/response).
   */
  async respond(
    originalMessage: AgentMessage,
    from: AgentRole,
    payload: AgentMessage["payload"]
  ): Promise<void> {
    if (!originalMessage.correlationId) return;

    const response: AgentMessage = {
      id: randomUUID(),
      type: "task_response",
      from,
      to: originalMessage.from,
      priority: originalMessage.priority,
      timestamp: new Date().toISOString(),
      payload,
      correlationId: originalMessage.correlationId,
    };

    this.addToHistory(response);
    const pending = this.pendingRequests.get(originalMessage.correlationId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(originalMessage.correlationId);
      pending.resolve(response);
      log.debug(
        `📬 Réponse délivrée correl=${originalMessage.correlationId.slice(0, 8)}`
      );
    }
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  /** Interroge le statut d'un agent */
  async queryStatus(
    from: AgentRole,
    target: AgentRole,
    timeoutMs = 5_000
  ): Promise<StatusResponsePayload | null> {
    try {
      const response = await this.request(
        {
          id: randomUUID(),
          type: "status_query",
          from,
          to: target,
          priority: "low",
          timestamp: new Date().toISOString(),
          payload: { type: "status_query" },
        },
        timeoutMs
      );
      return response.payload as StatusResponsePayload;
    } catch {
      return null;
    }
  }

  // ─── Métriques & historique ───────────────────────────────────────────────

  /** Retourne les N derniers messages de l'historique */
  getHistory(limit = 50): AgentMessage[] {
    return this.messageHistory.slice(-limit);
  }

  // ─── Traçage et Surveillance ────────────────────────────────────────────────

  /**
   * Active ou désactive le traçage des messages
   */
  enableTracing(enabled: boolean = true): void {
    this.traceEnabled = enabled;
    log.info(`Traçage des messages : ${enabled ? "ACTIVÉ" : "DÉSACTIVÉ"}`);
  }

  /**
   * Retourne si le traçage est activé
   */
  isTracingEnabled(): boolean {
    return this.traceEnabled;
  }

  /**
   * Génère un ID de trace pour une séquence de messages
   */
  generateTraceId(): string {
    return `trace-${++this.traceIdCounter}`;
  }

  /**
   * Retourne les métriques de routage détaillées
   */
  getRoutingMetrics(): {
    agentMessageCount: Record<string, number>;
    agentActiveMessages: Record<string, number>;
    agentAvgProcessingTime: Record<string, number>;
    agentLastProcessingTime: Record<string, number>;
  } {
    return {
      agentMessageCount: Object.fromEntries(this.routingMetrics.agentMessageCount),
      agentActiveMessages: Object.fromEntries(this.routingMetrics.agentActiveMessages),
      agentAvgProcessingTime: Object.fromEntries(this.routingMetrics.agentAvgProcessingTime),
      agentLastProcessingTime: Object.fromEntries(this.routingMetrics.agentLastProcessingTime),
    };
  }

  /**
   * Retourne les statistiques de charge par agent
   */
  getAgentLoad(): Record<AgentRole, {
    messageCount: number;
    activeMessages: number;
    avgProcessingTime: number;
    loadScore: number;
  }> {
    const load: Record<AgentRole, {
      messageCount: number;
      activeMessages: number;
      avgProcessingTime: number;
      loadScore: number;
    }> = {};

    // Collecter tous les rôles
    const allRoles = new Set<AgentRole>();
    for (const sub of this.subscriptions.values()) {
      allRoles.add(sub.agentRole);
    }

    for (const role of allRoles) {
      const messageCount = this.routingMetrics.agentMessageCount.get(role) ?? 0;
      const activeMessages = this.routingMetrics.agentActiveMessages.get(role) ?? 0;
      const avgProcessingTime = this.routingMetrics.agentAvgProcessingTime.get(role) ?? 0;
      
      // Score de charge = messages actifs * temps moyen
      const loadScore = activeMessages * (avgProcessingTime > 0 ? avgProcessingTime : 100);

      load[role] = {
        messageCount,
        activeMessages,
        avgProcessingTime,
        loadScore
      };
    }

    return load;
  }

  /**
   * Retourne l'état actuel du round-robin
   */
  getRoundRobinState(): Record<AgentRole, {
    currentIndex: number;
    subscriberCount: number;
  }> {
    const state: Record<AgentRole, { currentIndex: number; subscriberCount: number }> = {};

    for (const [role, subIds] of this.roundRobinState.subscribers) {
      state[role] = {
        currentIndex: this.roundRobinState.index.get(role) ?? 0,
        subscriberCount: subIds.length
      };
    }

    return state;
  }

  /**
   * Réinitialise les métriques de routage
   */
  resetRoutingMetrics(): void {
    this.routingMetrics.agentMessageCount.clear();
    this.routingMetrics.agentActiveMessages.clear();
    this.routingMetrics.agentAvgProcessingTime.clear();
    this.routingMetrics.agentLastProcessingTime.clear();
    log.info("✅ Métriques de routage réinitialisées");
  }

  /**
   * Retourne un rapport complet de surveillance
   */
  getMonitoringReport(): {
    bus: {
      totalMessages: number;
      successRate: number;
      byMessageType: Record<string, number>;
      pendingRequests: number;
      activeSubscriptions: number;
      deadLetterQueue: Record<string, number>;
    };
    routing: {
      strategyUsage: Record<RoutingStrategy, number>;
      agentLoad: Record<AgentRole, {
        messageCount: number;
        activeMessages: number;
        avgProcessingTime: number;
        loadScore: number;
      }>;
      roundRobinState: Record<AgentRole, { currentIndex: number; subscriberCount: number }>;
    };
    traceEnabled: boolean;
    timestamp: string;
  } {
    const metrics = this.getMetrics();
    const load = this.getAgentLoad();
    const rrState = this.getRoundRobinState();

    // Compter l'utilisation des stratégies
    const strategyUsage: Record<RoutingStrategy, number> = {
      direct: 0,
      broadcast: 0,
      "round-robin": 0,
      "load-balanced": 0
    };
    for (const m of this.metrics) {
      if (m.strategy) {
        strategyUsage[m.strategy] = (strategyUsage[m.strategy] ?? 0) + 1;
      } else {
        strategyUsage.direct++;
      }
    }

    return {
      bus: {
        totalMessages: metrics.totalMessages,
        successRate: metrics.successRate,
        byMessageType: metrics.byMessageType,
        pendingRequests: metrics.pendingRequests,
        activeSubscriptions: metrics.activeSubscriptions,
        deadLetterQueue: metrics.deadLetterQueue,
      },
      routing: {
        strategyUsage,
        agentLoad: load,
        roundRobinState: rrState,
      },
      traceEnabled: this.traceEnabled,
      timestamp: new Date().toISOString(),
    };
  }

  /** Retourne les métriques d'utilisation du bus */
  getMetrics(): {
    totalMessages: number;
    successRate: number;
    byAgentRole: Record<string, number>;
    byMessageType: Record<string, number>;
    pendingRequests: number;
    activeSubscriptions: number;
    deadLetterQueue: Record<string, number>;
  } {
    const byAgentRole: Record<string, number> = {};
    const byMessageType: Record<string, number> = {};

    for (const m of this.metrics) {
      byAgentRole[m.from] = (byAgentRole[m.from] ?? 0) + 1;
      byMessageType[m.type] = (byMessageType[m.type] ?? 0) + 1;
    }

    const successful = this.metrics.filter((m) => m.success).length;

    const deadLetterQueue: Record<string, number> = {};
    for (const [role, entries] of this.deadLetterQueue) {
      const active = entries.filter((e) => Date.now() - e.enqueuedAt < DEAD_LETTER_TTL_MS);
      if (active.length > 0) deadLetterQueue[role] = active.length;
    }

    return {
      totalMessages: this.metrics.length,
      successRate: this.metrics.length > 0 ? successful / this.metrics.length : 1,
      byAgentRole,
      byMessageType,
      pendingRequests: this.pendingRequests.size,
      activeSubscriptions: this.subscriptions.size,
      deadLetterQueue,
    };
  }

  // ─── Routage avancé ──────────────────────────────────────────────────────

  /**
   * Détermine la stratégie de routage à utiliser.
   * L'ordre de priorité est : options.routing > message.metadata.routing > "direct"
   */
  private determineRoutingStrategy(options: PublishOptions): RoutingStrategy {
    return options.routing ?? "direct";
  }

  /**
   * Met à jour l'état des abonnements pour le round-robin
   */
  private updateRoundRobinState(): void {
    this.roundRobinState.subscribers.clear();
    this.roundRobinState.index.clear();

    for (const sub of this.subscriptions.values()) {
      if (!this.roundRobinState.subscribers.has(sub.agentRole)) {
        this.roundRobinState.subscribers.set(sub.agentRole, []);
      }
      this.roundRobinState.subscribers.get(sub.agentRole)!.push(sub.id);
    }
  }

  /**
   * Sélectionne le prochain abonné pour un rôle donné (round-robin)
   */
  private getNextRoundRobinSubscriber(role: AgentRole): string | null {
    const subscriberIds = this.roundRobinState.subscribers.get(role);
    if (!subscriberIds || subscriberIds.length === 0) {
      return null;
    }

    const currentIndex = this.roundRobinState.index.get(role) ?? 0;
    const nextIndex = (currentIndex + 1) % subscriberIds.length;
    this.roundRobinState.index.set(role, nextIndex);

    return subscriberIds[currentIndex];
  }

  /**
   * Met à jour les métriques de routage après traitement d'un message
   */
  private updateRoutingMetrics(
    agentRole: AgentRole,
    processingTime: number
  ): void {
    // Mettre à jour le compteur de messages
    const messageCount = this.routingMetrics.agentMessageCount.get(agentRole) ?? 0;
    this.routingMetrics.agentMessageCount.set(agentRole, messageCount + 1);

    // Mettre à jour le temps de traitement
    this.routingMetrics.agentLastProcessingTime.set(agentRole, processingTime);

    // Mettre à jour la moyenne (moyenne mobile)
    const avgTime = this.routingMetrics.agentAvgProcessingTime.get(agentRole) ?? 0;
    const newAvg = avgTime === 0 
      ? processingTime 
      : (avgTime * 0.7) + (processingTime * 0.3); // Moyenne exponentielle
    this.routingMetrics.agentAvgProcessingTime.set(agentRole, newAvg);
  }

  /**
   * Sélectionne le meilleur agent pour le load-balancing
   * Utilise l'algorithme "least connections" avec pondération par temps de réponse
   */
  private selectAgentForLoadBalancing(targetRole: AgentRole): string | null {
    const availableHandlers: Array<{ subId: string; load: number; avgTime: number }> = [];

    for (const sub of this.subscriptions.values()) {
      if (sub.agentRole !== targetRole) continue;

      const subId = sub.id;
      const load = this.routingMetrics.agentActiveMessages.get(sub.agentRole) ?? 0;
      const avgTime = this.routingMetrics.agentAvgProcessingTime.get(sub.agentRole) ?? 100;

      availableHandlers.push({ subId, load, avgTime });
    }

    if (availableHandlers.length === 0) {
      return null;
    }

    // Score = load * avgTime (plus le score est bas, meilleur c'est)
    const scored = availableHandlers.map(h => ({
      ...h,
      score: h.load * h.avgTime
    }));

    // Trier par score ascendant
    scored.sort((a, b) => a.score - b.score);

    return scored[0].subId;
  }

  /**
   * Incrémente le compteur de messages actifs pour un agent
   */
  private incrementActiveMessages(agentRole: AgentRole): void {
    const count = this.routingMetrics.agentActiveMessages.get(agentRole) ?? 0;
    this.routingMetrics.agentActiveMessages.set(agentRole, count + 1);
  }

  /**
   * Décrémente le compteur de messages actifs pour un agent
   */
  private decrementActiveMessages(agentRole: AgentRole): void {
    const count = this.routingMetrics.agentActiveMessages.get(agentRole) ?? 1;
    this.routingMetrics.agentActiveMessages.set(agentRole, Math.max(0, count - 1));
  }

  // ─── Interne ──────────────────────────────────────────────────────────────

  private async deliver(message: AgentMessage, options: PublishOptions): Promise<void> {
    const startTime = Date.now();
    let success = false;
    const strategy = this.determineRoutingStrategy(options);

    // Générer un traceId pour le traçage
    const traceId = this.traceEnabled ? `trace-${++this.traceIdCounter}` : undefined;

    // Logger avec trace
    const traceInfo = traceId ? `[${traceId}]` : "";
    log.debug(
      `📤 ${traceInfo} [${message.from}] → [${message.to}] type="${message.type}" strategy="${strategy}"`
    );

    try {
      if (message.to === "broadcast") {
        await this.deliverToAll(message, strategy);
      } else {
        await this.deliverToAgent(message.to, message, options, strategy);
      }
      success = true;
    } finally {
      const processingMs = Date.now() - startTime;
      
      // Mettre à jour les métriques de routage si cible est un rôle
      if (typeof message.to === "string" && message.to !== "broadcast") {
        this.updateRoutingMetrics(message.to, processingMs);
      }

      this.metrics.push({
        messageId: message.id,
        from: message.from,
        to: message.to,
        type: message.type,
        timestamp: startTime,
        processingMs,
        success,
        strategy,
      });
      
      // Garder les métriques sous contrôle
      if (this.metrics.length > 1000) {
        this.metrics.splice(0, 200);
      }

      // Logger le résultat avec trace
      if (traceId) {
        log.debug(
          `📞 ${traceInfo} Délivraison terminée : ${success ? "✅" : "❌"} ` +
          `(${processingMs}ms)`
        );
      }
    }
  }

  private async deliverToAgent(
    targetRole: AgentRole,
    message: AgentMessage,
    _options: PublishOptions = {},
    strategy: RoutingStrategy = "direct"
  ): Promise<void> {
    const handlers: Array<{ handler: MessageHandler; subId: string }> = [];

    for (const sub of this.subscriptions.values()) {
      if (
        sub.agentRole === targetRole &&
        (sub.messageType === "*" || sub.messageType === message.type)
      ) {
        handlers.push({ handler: sub.handler, subId: sub.id });
      }
    }

    // Mettre à jour l'état round-robin
    this.updateRoundRobinState();

    if (handlers.length === 0) {
      // ── Dead-letter queue : l'agent n'est pas encore abonné ──────────────
      // On conserve le message et on le re-livrera dès que l'agent s'abonera.
      // Seuls les task_request sont mis en dead-letter (les autres types ne
      // nécessitent pas de garantie de livraison).
      if (message.type === "task_request" || message.type === "collaboration_request") {
        const queue = this.deadLetterQueue.get(targetRole) ?? [];
        const now = Date.now();

        // Expirer les vieux messages avant d'ajouter
        const active = queue.filter((e) => now - e.enqueuedAt < DEAD_LETTER_TTL_MS);
        active.push({ message, enqueuedAt: now, attempts: 0 });
        this.deadLetterQueue.set(targetRole, active);

        log.warn(
          `📭 [${targetRole}] non abonné — message ${message.id.slice(0, 8)} mis en dead-letter queue (${active.length} en attente)`
        );
      } else {
        log.warn(
          `⚠️ Aucun handler pour agent "${targetRole}" type="${message.type}" — message ${message.id.slice(0, 8)} ignoré`
        );
      }
      return;
    }

    // Appliquer la stratégie de routage
    const selectedHandlers = this.applyRoutingStrategy(handlers, targetRole, strategy);

    // Incrémenter le compteur pour le load-balancing
    if (strategy === "load-balanced") {
      this.incrementActiveMessages(targetRole);
    }

    // Traiter avec les handlers sélectionnés
    await Promise.allSettled(
      selectedHandlers.map(({ handler }) =>
        handler(message).catch((err) =>
          log.error(`Handler [${targetRole}] erreur: ${(err as Error).message}`)
        )
      )
    );

    // Décrémenter après traitement
    if (strategy === "load-balanced") {
      this.decrementActiveMessages(targetRole);
    }
  }

  /**
   * Applique la stratégie de routage pour sélectionner les handlers
   */
  private applyRoutingStrategy(
    handlers: Array<{ handler: MessageHandler; subId: string }>,
    targetRole: AgentRole,
    strategy: RoutingStrategy
  ): Array<{ handler: MessageHandler; subId: string }> {
    switch (strategy) {
      case "round-robin":
        // Sélectionner un seul handler en round-robin
        const nextSubId = this.getNextRoundRobinSubscriber(targetRole);
        if (nextSubId) {
          const handler = handlers.find(h => h.subId === nextSubId);
          if (handler) {
            log.debug(`🔄 Round-robin : sélectionné ${nextSubId.slice(0, 8)} pour [${targetRole}]`);
            return [handler];
          }
        }
        // Fallback : retourner tous les handlers
        return handlers;

      case "load-balanced":
        // Sélectionner le handler avec la plus faible charge
        const selectedSubId = this.selectAgentForLoadBalancing(targetRole);
        if (selectedSubId) {
          const handler = handlers.find(h => h.subId === selectedSubId);
          if (handler) {
            log.debug(`⚖️ Load-balanced : sélectionné ${selectedSubId.slice(0, 8)} pour [${targetRole}]`);
            return [handler];
          }
        }
        // Fallback : retourner tous les handlers
        return handlers;

      case "broadcast":
        // Envoyer à tous les handlers (comportement par défaut pour broadcast)
        return handlers;

      case "direct":
      default:
        // Envoyer à tous les handlers (comportement original)
        return handlers;
    }
  }

  /**
   * Re-livre les messages en dead-letter queue pour un rôle donné.
   * Appelé automatiquement quand un agent s'abonne.
   */
  private async flushDeadLetterQueue(role: AgentRole): Promise<void> {
    const queue = this.deadLetterQueue.get(role);
    if (!queue || queue.length === 0) return;

    const now = Date.now();
    const toDeliver = queue.filter((e) => now - e.enqueuedAt < DEAD_LETTER_TTL_MS);
    this.deadLetterQueue.delete(role);

    if (toDeliver.length === 0) return;

    log.info(
      `📬 [${role}] abonné — re-livraison de ${toDeliver.length} message(s) en dead-letter queue`
    );

    for (const entry of toDeliver) {
      entry.attempts++;
      await this.deliverToAgent(role, entry.message).catch((err) => {
        log.error(`Re-livraison [${role}] erreur: ${err.message}`);
      });
    }
  }

  private async deliverToAll(message: AgentMessage, _strategy: RoutingStrategy = "broadcast"): Promise<void> {
    const handlers: Array<{ handler: MessageHandler; subId: string }> = [];
    const seen = new Set<AgentRole>();

    for (const sub of this.subscriptions.values()) {
      // Éviter de diffuser à l'émetteur lui-même
      if (sub.agentRole === message.from) continue;
      // Un seul handler par rôle pour le broadcast
      if (seen.has(sub.agentRole)) continue;

      if (sub.messageType === "*" || sub.messageType === message.type) {
        seen.add(sub.agentRole);
        handlers.push({ handler: sub.handler, subId: sub.id });
      }
    }

    // Pour le broadcast, on envoie à tous les handlers
    // Les autres stratégies sont gérées dans deliverToAgent
    await Promise.allSettled(
      handlers.map(({ handler }) =>
        handler(message).catch((err) =>
          log.error(`Broadcast handler erreur: ${(err as Error).message}`)
        )
      )
    );
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    retry: NonNullable<PublishOptions["retry"]>
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err as Error;
        if (attempt < retry.maxRetries) {
          const delay =
            retry.backoff === "exponential"
              ? Math.min(1000 * Math.pow(2, attempt), 8_000)
              : 500 * (attempt + 1);
          log.warn(
            `🔄 Retry ${attempt + 1}/${retry.maxRetries} dans ${delay}ms — ${lastError.message}`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError!;
  }

  private addToHistory(message: AgentMessage): void {
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.splice(0, 50);
    }
    // Persister dans Supabase (best-effort, silencieux)
    agentPersistence.saveMessage(message).catch(() => {});
    // Émettre l'événement pour les listeners externes (ex: WebSocket)
    this.emit("message", message);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const agentMessageBus = new AgentMessageBus();
