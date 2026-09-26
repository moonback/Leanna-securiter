/**
 * MessageBusMonitor — Surveillance et visualisation du MessageBus
 * 
 * Fournit des outils pour :
 * - Collecter et aggréger les métriques du bus
 * - Générer des rapports de surveillance
 * - Visualiser les flux de messages et la charge des agents
 * - Détecter les anomalies et les goulots d'étranglement
 * 
 * Intégration :
 * - Peut être connecté à Prometheus, Grafana, ou un dashboard custom
 * - Émet des événements pour les systèmes de monitoring externes
 * - Fournit une API REST pour les métriques
 */

import { EventEmitter } from "events";
import { agentMessageBus } from "./AgentMessageBus.js";
import type { AgentRole } from "./types.js";
import type { AgentMessage, RoutingStrategy, MessagePriority } from "./AgentCommunication.js";

import { createLogger } from "../utils/logger.js";

const log = createLogger("MessageBusMonitor");

// ═══════════════════════════════════════════════════════════════════════════════
// Types pour le monitoring
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Niveau de sévérité pour les alertes
 */
export type AlertSeverity = "info" | "warning" | "critical" | "error";

/**
 * Alerte de surveillance
 */
export interface MonitorAlert {
  id: string;
  severity: AlertSeverity;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  resolvedAt?: string;
  resolved?: boolean;
}

/**
 * Métriques agrégées sur une période
 */
export interface AggregatedMetrics {
  /** Période de l'agrégation (ex: "1m", "5m", "1h") */
  period: string;
  /** Timestamp de fin de la période */
  endTime: string;
  /** Nombre total de messages */
  totalMessages: number;
  /** Nombre de messages réussis */
  successfulMessages: number;
  /** Taux de succès */
  successRate: number;
  /** Temps moyen de traitement (ms) */
  avgProcessingTime: number;
  /** Temps max de traitement (ms) */
  maxProcessingTime: number;
  /** Temps min de traitement (ms) */
  minProcessingTime: number;
  /** Messages par type */
  byMessageType: Record<string, number>;
  /** Messages par rôle émetteur */
  byFromRole: Record<string, number>;
  /** Messages par rôle destinataire */
  byToRole: Record<string, number>;
  /** Messages par priorité */
  byPriority: Record<MessagePriority, number>;
  /** Messages par stratégie de routage */
  byStrategy: Record<RoutingStrategy, number>;
}

/**
 * État de santé du bus
 */
export interface HealthStatus {
  /** Le bus est-il opérationnel */
  healthy: boolean;
  /** Timestamp du dernier check */
  timestamp: string;
  /** Liste des problèmes détectés */
  issues: string[];
  /** Métriques clés */
  metrics: {
    uptime: number;
    totalMessages: number;
    successRate: number;
    pendingRequests: number;
    activeSubscriptions: number;
    deadLetterQueueSize: number;
  };
}

/**
 * Noeud du graphe de flux de messages
 */
export interface MessageFlowNode {
  role: AgentRole;
  sent: number;
  received: number;
  errors: number;
  avgProcessingTime: number;
}

/**
 * Edge du graphe de flux de messages
 */
export interface MessageFlowEdge {
  from: AgentRole;
  to: AgentRole;
  count: number;
  successRate: number;
  avgTime: number;
}

/**
 * Graphe de flux de messages
 */
export interface MessageFlowGraph {
  nodes: MessageFlowNode[];
  edges: MessageFlowEdge[];
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MessageBusMonitor
// ═══════════════════════════════════════════════════════════════════════════════

export class MessageBusMonitor extends EventEmitter {
  private alerts: Map<string, MonitorAlert> = new Map();
  private alertCounter = 0;
  
  private aggregatedMetrics: AggregatedMetrics[] = [];
  private maxAggregatedMetrics = 100;
  
  /** Historique des messages pour l'analyse de flux */
  private messageHistory: Array<{
    message: AgentMessage;
    timestamp: number;
    success: boolean;
    processingMs?: number;
  }> = [];
  
  private maxHistorySize = 1000;
  
  /** ID de démarrage pour calculer l'uptime */
  private startTime: number;
  constructor() {
    super();
    this.startTime = Date.now();
    // S'abonner aux messages du bus
    this.setupMessageBusListeners();
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  /**
   * Configure la taille maximale de l'historique
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = Math.max(100, size);
    
    // Tronquer si nécessaire
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.splice(0, this.messageHistory.length - this.maxHistorySize);
    }
    
    log.info(`Taille historique configurée à ${this.maxHistorySize} messages`);
  }

  /**
   * Configure le nombre maximal de métriques agrégées
   */
  setMaxAggregatedMetrics(count: number): void {
    this.maxAggregatedMetrics = Math.max(50, count);
    
    if (this.aggregatedMetrics.length > this.maxAggregatedMetrics) {
      this.aggregatedMetrics.splice(0, this.aggregatedMetrics.length - this.maxAggregatedMetrics);
    }
    
    log.info(`Métriques agrégées limitées à ${this.maxAggregatedMetrics}`);
  }

  // ─── Collection de données ─────────────────────────────────────────────────

  /**
   * Configure les listeners sur le MessageBus
   */
  private setupMessageBusListeners(): void {
    agentMessageBus.on("message", (message: AgentMessage) => {
      this.onMessageSent(message);
    });

    // Note: Pour capturer les métriques complètes, on pourrait aussi écouter
    // les événements internes du bus, mais pour l'instant on utilise le polling
    log.info("MessageBusMonitor abonné aux messages du bus");
  }

  /**
   * Appelé quand un message est envoyé via le bus
   */
  private onMessageSent(message: AgentMessage): void {
    // Stocker le message dans l'historique
    this.messageHistory.push({
      message,
      timestamp: Date.now(),
      success: true, // Par défaut, on suppose succès (le bus gère les erreurs)
    });

    // Limiter l'historique
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.splice(0, 50);
    }

    // Détecter les anomalies
    this.detectAnomalies(message);
  }

  /**
   * Collecte les métriques actuelles du bus
   */
  collectMetrics(): void {
    const now = Date.now();
    const report = agentMessageBus.getMonitoringReport();
    
    // Créer des métriques agrégées pour cette période
    const period = "1m"; // Période de 1 minute (à ajuster)
    const aggregated: AggregatedMetrics = {
      period,
      endTime: new Date(now).toISOString(),
      totalMessages: report.bus.totalMessages,
      successfulMessages: Math.round(report.bus.totalMessages * report.bus.successRate),
      successRate: report.bus.successRate,
      avgProcessingTime: this.calculateAvgProcessingTime(),
      maxProcessingTime: this.calculateMaxProcessingTime(),
      minProcessingTime: this.calculateMinProcessingTime(),
      byMessageType: report.bus.byMessageType,
      byFromRole: this.countByField("from"),
      byToRole: this.countByField("to"),
      byPriority: this.countByField("priority") as Record<MessagePriority, number>,
      byStrategy: report.routing.strategyUsage,
    };

    this.aggregatedMetrics.push(aggregated);
    
    // Limiter les métriques agrégées
    if (this.aggregatedMetrics.length > this.maxAggregatedMetrics) {
      this.aggregatedMetrics.splice(0, 20);
    }
    log.debug(`Métriques collectées : ${aggregated.totalMessages} messages`);
  }

  /**
   * Calcule le temps de traitement moyen
   */
  private calculateAvgProcessingTime(): number {
    // Note: Il faudrait accéder aux métriques détaillées du bus
    // Pour l'instant, retourner une valeur par défaut
    return 0;
  }

  /**
   * Calcule le temps de traitement maximum
   */
  private calculateMaxProcessingTime(): number {
    // À implémenter avec les métriques détaillées
    return 0;
  }

  /**
   * Calcule le temps de traitement minimum
   */
  private calculateMinProcessingTime(): number {
    // À implémenter avec les métriques détaillées
    return 0;
  }

  /**
   * Compte les messages par un champ donné
   */
  private countByField(field: keyof AgentMessage): Record<string, number> {
    const counts: Record<string, number> = {};
    
    for (const entry of this.messageHistory) {
      const value = entry.message[field];
      if (value !== undefined && value !== null) {
        const key = String(value);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    
    return counts;
  }

  // ─── Détection d'anomalies ────────────────────────────────────────────────

  /**
   * Détecte les anomalies dans les messages
   */
  private detectAnomalies(message: AgentMessage): void {
    // 1. Détection de messages trop fréquents (flood)
    this.detectMessageFlood(message);
    
    // 2. Détection de dead-letter queue trop grande
    this.detectDeadLetterQueueAnomaly();
    
    // 3. Détection de taux d'échec élevé
    this.detectHighFailureRate();
  }

  /**
   * Détecte si un agent envoie trop de messages (potentiel flood)
   */
  private detectMessageFlood(message: AgentMessage): void {
    const now = Date.now();
    const windowMs = 5000; // Fenêtre de 5 secondes
    
    // Compter les messages récents de ce rôle
    const recentMessages = this.messageHistory.filter(
      e => e.message.from === message.from && now - e.timestamp < windowMs
    );
    
    if (recentMessages.length > 10) { // Plus de 10 messages en 5 secondes
      this.triggerAlert({
        severity: "warning",
        type: "message_flood",
        title: "Flood de messages détecté",
        message: `L'agent "${message.from}" a envoyé ${recentMessages.length} messages en 5 secondes`,
        metadata: {
          agentRole: message.from,
          count: recentMessages.length,
          windowMs
        }
      });
    }
  }

  /**
   * Détecte si la dead-letter queue devient trop grande
   */
  private detectDeadLetterQueueAnomaly(): void {
    const report = agentMessageBus.getMonitoringReport();
    const dlqSize = Object.values(report.bus.deadLetterQueue).reduce(
      (sum, count) => sum + count, 0
    );
    
    if (dlqSize > 10) { // Plus de 10 messages en DLQ
      this.triggerAlert({
        severity: "warning",
        type: "dead_letter_queue_full",
        title: "Dead-letter queue trop grande",
        message: `${dlqSize} messages en attente dans la dead-letter queue`,
        metadata: {
          size: dlqSize,
          threshold: 10
        }
      });
    }
    
    if (dlqSize > 50) { // Plus de 50 messages = critique
      this.triggerAlert({
        severity: "critical",
        type: "dead_letter_queue_critical",
        title: "Dead-letter queue critique",
        message: `${dlqSize} messages en attente dans la dead-letter queue (CRITIQUE)`,
        metadata: {
          size: dlqSize,
          threshold: 50
        }
      });
    }
  }

  /**
   * Détecte un taux d'échec trop élevé
   */
  private detectHighFailureRate(): void {
    const report = agentMessageBus.getMonitoringReport();
    
    if (report.bus.totalMessages > 0 && report.bus.successRate < 0.8) {
      this.triggerAlert({
        severity: "critical",
        type: "high_failure_rate",
        title: "Taux d'échec élevé",
        message: `Taux de succès du bus à ${(report.bus.successRate * 100).toFixed(1)}%`,
        metadata: {
          successRate: report.bus.successRate,
          threshold: 0.8
        }
      });
    }
  }

  // ─── Alertes ───────────────────────────────────────────────────────────────

  /**
   * Déclenche une alerte
   */
  triggerAlert(alert: Omit<MonitorAlert, "id" | "timestamp" | "resolved">): MonitorAlert {
    const alertId = `alert-${++this.alertCounter}`;
    const timestamp = new Date().toISOString();
    
    const fullAlert: MonitorAlert = {
      ...alert,
      id: alertId,
      timestamp,
      resolved: false
    };
    
    this.alerts.set(alertId, fullAlert);
    
    // Émettre l'alerte
    this.emit("alert", fullAlert);
    
    // Logger selon la sévérité
    switch (alert.severity) {
      case "info":
        log.info(`🔵 ALERTE [${alertId}] ${alert.type}: ${alert.title}`);
        break;
      case "warning":
        log.warn(`🟡 ALERTE [${alertId}] ${alert.type}: ${alert.title}`);
        break;
      case "critical":
      case "error":
        log.error(`🔴 ALERTE [${alertId}] ${alert.type}: ${alert.title}`);
        break;
    }
    
    return fullAlert;
  }

  /**
   * Résout une alerte
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    
    if (!alert) {
      return false;
    }
    
    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString();
    
    this.emit("alertResolved", alert);
    log.info(`✅ Alerte résolue [${alertId}]: ${alert.title}`);
    
    return true;
  }

  /**
   * Retourne toutes les alertes actives
   */
  getActiveAlerts(): MonitorAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolved)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Retourne toutes les alertes (y compris résolues)
   */
  getAllAlerts(limit = 100): MonitorAlert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Retourne les alertes par sévérité
   */
  getAlertsBySeverity(severity: AlertSeverity): MonitorAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => a.severity === severity && !a.resolved)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // ─── Analyse de flux ───────────────────────────────────────────────────────

  /**
   * Génère un graphe de flux de messages
   */
  generateMessageFlowGraph(): MessageFlowGraph {
    const nodesMap = new Map<AgentRole, MessageFlowNode>();
    const edgesMap = new Map<string, MessageFlowEdge>();
    
    for (const entry of this.messageHistory) {
      const from = entry.message.from;
      const to = entry.message.to;
      
      // Mettre à jour les nodes
      if (!nodesMap.has(from)) {
        nodesMap.set(from, {
          role: from,
          sent: 0,
          received: 0,
          errors: 0,
          avgProcessingTime: 0
        });
      }
      nodesMap.get(from)!.sent++;
      
      if (typeof to === "string" && to !== "broadcast") {
        if (!nodesMap.has(to)) {
          nodesMap.set(to, {
            role: to,
            sent: 0,
            received: 0,
            errors: 0,
            avgProcessingTime: 0
          });
        }
        nodesMap.get(to)!.received++;
        
        // Mettre à jour l'edge
        const edgeKey = `${from}->${to}`;
        if (!edgesMap.has(edgeKey)) {
          edgesMap.set(edgeKey, {
            from,
            to,
            count: 0,
            successRate: 1,
            avgTime: 0
          });
        }
        edgesMap.get(edgeKey)!.count++;
      }
    }
    
    // Convertir en tableaux
    const nodes = Array.from(nodesMap.values());
    const edges = Array.from(edgesMap.values());
    
    return {
      nodes,
      edges,
      timestamp: new Date().toISOString()
    };
  }

  // ─── Visualisation ────────────────────────────────────────────────────────

  /**
   * Génère une visualisation ASCII du graphe de flux
   */
  generateASCIIFlowGraph(): string {
    const graph = this.generateMessageFlowGraph();
    const lines: string[] = [
      "╔═══════════════════════════════════════════════════════════════╗",
      "║                  GRAPHE DE FLUX DE MESSAGES                      ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      ""
    ];
    
    // Nodes
    lines.push("📊 NODES:");
    lines.push("─".repeat(64));
    lines.push("Rôle                  | Envoyés | Reçus | Erreurs | Avg Time");
    lines.push("─".repeat(64));
    
    for (const node of graph.nodes) {
      lines.push(
        `${node.role.padEnd(20)} | ${node.sent.toString().padStart(7)} | ${node.received.toString().padStart(6)} | ${node.errors.toString().padStart(7)} | ${node.avgProcessingTime}ms`
      );
    }
    
    // Edges
    lines.push("");
    lines.push("🔗 EDGES (flux entre agents):");
    lines.push("─".repeat(64));
    lines.push("De → Vers              | Count | Success Rate | Avg Time");
    lines.push("─".repeat(64));
    
    for (const edge of graph.edges) {
      lines.push(
        `${edge.from.padEnd(17)} → ${edge.to.padEnd(16)} | ${edge.count.toString().padStart(5)} | ${(edge.successRate * 100).toFixed(1)}% | ${edge.avgTime}ms`
      );
    }
    
    lines.push("");
    lines.push(`Généré à: ${graph.timestamp}`);
    
    return lines.join("\n");
  }

  /**
   * Génère un tableau de bord textuel
   */
  generateDashboard(): string {
    const report = agentMessageBus.getMonitoringReport();
    const health = this.getHealthStatus();
    const activeAlerts = this.getActiveAlerts();
    
    const lines: string[] = [
      "╔══════════════════════════════════════════════════════════════════════╗",
      "║                    TABLEAU DE BORD MessageBus                        ║",
      "╚══════════════════════════════════════════════════════════════════════╝",
      ""
    ];
    
    // État de santé
    lines.push("🩺 ÉTAT DE SANTÉ:");
    lines.push("─".repeat(64));
    lines.push(`Statut: ${health.healthy ? "✅ SAIN" : "❌ PROBLÈME"}`);
    lines.push(`Uptime: ${this.formatUptime(health.metrics.uptime)}`);
    lines.push(`Total messages: ${report.bus.totalMessages}`);
    lines.push(`Taux succès: ${(report.bus.successRate * 100).toFixed(1)}%`);
    lines.push(`Requêtes en attente: ${report.bus.pendingRequests}`);
    
    // Alertes
    lines.push("");
    lines.push("🚨 ALERTES ACTIVES:");
    lines.push("─".repeat(64));
    if (activeAlerts.length === 0) {
      lines.push("Aucune alerte active");
    } else {
      for (const alert of activeAlerts.slice(0, 5)) {
        const severityIcon = {
          info: "🔵",
          warning: "🟡",
          critical: "🔴",
          error: "🔴"
        }[alert.severity];
        lines.push(`${severityIcon} [${alert.severity.toUpperCase()}] ${alert.title} - ${alert.message}`);
      }
      if (activeAlerts.length > 5) {
        lines.push(`... et ${activeAlerts.length - 5} autres`);
      }
    }
    
    // Métriques de routage
    lines.push("");
    lines.push("📊 ROUTAGE:");
    lines.push("─".repeat(64));
    lines.push("Stratégie              | Utilisation");
    lines.push("─".repeat(64));
    for (const [strategy, count] of Object.entries(report.routing.strategyUsage)) {
      lines.push(`${strategy.padEnd(20)} | ${count.toString().padStart(9)}`);
    }
    
    // Charge des agents
    lines.push("");
    lines.push("👥 CHARGE DES AGENTS:");
    lines.push("─".repeat(64));
    lines.push("Agent                  | Messages | Actifs | Score");
    lines.push("─".repeat(64));
    
    const load = report.routing.agentLoad;
    const sortedAgents = Object.entries(load)
      .sort(([, a], [, b]) => b.loadScore - a.loadScore)
      .slice(0, 10);
    
    for (const [role, metrics] of sortedAgents) {
      lines.push(
        `${role.padEnd(20)} | ${metrics.messageCount.toString().padStart(8)} | ${metrics.activeMessages.toString().padStart(6)} | ${metrics.loadScore.toFixed(1).padStart(5)}`
      );
    }
    
    // Dead-letter queue
    lines.push("");
    lines.push("📭 DEAD-LETTER QUEUE:");
    lines.push("─".repeat(64));
    if (Object.keys(report.bus.deadLetterQueue).length === 0) {
      lines.push("Vide");
    } else {
      for (const [role, count] of Object.entries(report.bus.deadLetterQueue)) {
        lines.push(`${role.padEnd(20)} | ${count.toString().padStart(40)} messages`);
      }
    }
    
    lines.push("");
    lines.push(`Généré à: ${report.timestamp}`);
    
    return lines.join("\n");
  }

  /**
   * Formate l'uptime en format lisible
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // ─── Santé ─────────────────────────────────────────────────────────────────

  /**
   * Retourne l'état de santé du bus
   */
  getHealthStatus(): HealthStatus {
    const report = agentMessageBus.getMonitoringReport();
    const now = new Date().toISOString();
    const uptime = Date.now() - this.startTime;
    const issues: string[] = [];
    
    // Vérifier les problèmes
    if (report.bus.successRate < 0.9) {
      issues.push(`Taux de succès bas: ${(report.bus.successRate * 100).toFixed(1)}%`);
    }
    
    const dlqSize = Object.values(report.bus.deadLetterQueue).reduce(
      (sum, count) => sum + count, 0
    );
    if (dlqSize > 20) {
      issues.push(`Dead-letter queue trop grande: ${dlqSize} messages`);
    }
    
    if (report.bus.pendingRequests > 10) {
      issues.push(`Trop de requêtes en attente: ${report.bus.pendingRequests}`);
    }
    
    return {
      healthy: issues.length === 0,
      timestamp: now,
      issues,
      metrics: {
        uptime,
        totalMessages: report.bus.totalMessages,
        successRate: report.bus.successRate,
        pendingRequests: report.bus.pendingRequests,
        activeSubscriptions: report.bus.activeSubscriptions,
        deadLetterQueueSize: dlqSize
      }
    };
  }

  /**
   * Vérifie si le bus est en bonne santé
   */
  isHealthy(): boolean {
    return this.getHealthStatus().healthy;
  }

  // ─── Rapports ─────────────────────────────────────────────────────────────

  /**
   * Retourne les métriques agrégées
   */
  getAggregatedMetrics(limit = 20): AggregatedMetrics[] {
    return this.aggregatedMetrics.slice(-limit);
  }

  /**
   * Retourne un rapport complet
   */
  getFullReport(): {
    health: HealthStatus;
    metrics: AggregatedMetrics[];
    alerts: MonitorAlert[];
    flowGraph: MessageFlowGraph;
    monitoring: ReturnType<typeof agentMessageBus.getMonitoringReport>;
    timestamp: string;
  } {
    return {
      health: this.getHealthStatus(),
      metrics: this.aggregatedMetrics.slice(-20),
      alerts: this.getActiveAlerts(),
      flowGraph: this.generateMessageFlowGraph(),
      monitoring: agentMessageBus.getMonitoringReport(),
      timestamp: new Date().toISOString()
    };
  }

  // ─── Nettoyage ────────────────────────────────────────────────────────────

  /**
   * Nettoie les anciennes alertes
   */
  cleanupOldAlerts(maxAgeMs: number = 86400000): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    
    for (const [id, alert] of this.alerts) {
      const alertTime = new Date(alert.timestamp).getTime();
      if (alertTime < cutoff) {
        this.alerts.delete(id);
      }
    }
    
    log.debug(`Nettoyage : ${this.alerts.size} alertes conservées`);
  }

  /**
   * Nettoie les anciennes métriques agrégées
   */
  cleanupOldMetrics(maxAgeMs: number = 86400000): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    
    this.aggregatedMetrics = this.aggregatedMetrics.filter(
      m => new Date(m.endTime).getTime() >= cutoff
    );
    
    log.debug(`Nettoyage : ${this.aggregatedMetrics.length} métriques agrégées conservées`);
  }

  /**
   * Réinitialise toutes les données du moniteur
   */
  reset(): void {
    this.alerts.clear();
    this.aggregatedMetrics = [];
    this.messageHistory = [];
    this.alertCounter = 0;
    this.startTime = Date.now();
    
    log.info("✅ MessageBusMonitor réinitialisé");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

export const messageBusMonitor = new MessageBusMonitor();
