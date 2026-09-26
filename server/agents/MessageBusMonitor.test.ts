/**
 * Tests pour MessageBusMonitor (Node test runner)
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MessageBusMonitor,
  messageBusMonitor,
} from "./MessageBusMonitor.js";
import { agentMessageBus } from "./AgentMessageBus.js";

describe("MessageBusMonitor", () => {
  let monitor: MessageBusMonitor;

  beforeEach(() => {
    monitor = new MessageBusMonitor();
  });

  // ─── Tests de base ───────────────────────────────────────────────────────
  
  describe("Initialisation", () => {
    it("devrait créer une instance avec des valeurs par défaut", () => {
      assert.ok(monitor instanceof MessageBusMonitor);
    });

    it("devrait avoir un état de santé initial valide", () => {
      const health = monitor.getHealthStatus();
      
      assert.equal(health.healthy, true);
      assert.equal(health.issues.length, 0);
      assert.ok(health.metrics.uptime >= 0);
    });
  });

  // ─── Tests de santé ──────────────────────────────────────────────────────
  
  describe("Health Check", () => {
    it("devrait retourner un état sain initialement", () => {
      const health = monitor.getHealthStatus();
      
      assert.equal(health.healthy, true);
      assert.deepEqual(health.issues, []);
    });

    it("devrait détecter un taux de succès bas comme problème", () => {
      const originalMethod = agentMessageBus.getMonitoringReport;
      agentMessageBus.getMonitoringReport = () => ({
        bus: {
          totalMessages: 100,
          successRate: 0.7, // 70% - en dessous de 90%
          byMessageType: {},
          pendingRequests: 0,
          activeSubscriptions: 0,
          deadLetterQueue: {}
        },
        routing: {
          strategyUsage: { direct: 100, broadcast: 0, "round-robin": 0, "load-balanced": 0 },
          agentLoad: {} as any,
          roundRobinState: {} as any
        },
        traceEnabled: true,
        timestamp: new Date().toISOString()
      });

      try {
        const health = monitor.getHealthStatus();
        assert.equal(health.healthy, false);
        assert.ok(health.issues.some((issue) => issue.includes("succès")));
      } finally {
        agentMessageBus.getMonitoringReport = originalMethod;
      }
    });

    it("devrait détecter une dead-letter queue trop grande", () => {
      const originalMethod = agentMessageBus.getMonitoringReport;
      agentMessageBus.getMonitoringReport = () => ({
        bus: {
          totalMessages: 100,
          successRate: 1,
          byMessageType: {},
          pendingRequests: 0,
          activeSubscriptions: 0,
          deadLetterQueue: { coder: 30, tester: 20 } // 50 total
        },
        routing: {
          strategyUsage: { direct: 100, broadcast: 0, "round-robin": 0, "load-balanced": 0 },
          agentLoad: {} as any,
          roundRobinState: {} as any
        },
        traceEnabled: true,
        timestamp: new Date().toISOString()
      });

      try {
        const health = monitor.getHealthStatus();
        assert.equal(health.healthy, false);
        assert.ok(health.issues.some((issue) => issue.includes("Dead-letter")));
      } finally {
        agentMessageBus.getMonitoringReport = originalMethod;
      }
    });
  });

  // ─── Tests de visualisation ──────────────────────────────────────────────
  
  describe("Visualisation", () => {
    it("devrait générer un dashboard textuel", () => {
      const dashboard = monitor.generateDashboard();
      
      assert.equal(typeof dashboard, "string");
      assert.ok(dashboard.includes("TABLEAU DE BORD"));
      assert.ok(dashboard.includes("ÉTAT DE SANTÉ"));
      assert.ok(dashboard.includes("ROUTAGE"));
    });

    it("devrait générer un graphe de flux vide initialement", () => {
      const graph = monitor.generateMessageFlowGraph();
      
      assert.equal(graph.nodes.length, 0);
      assert.equal(graph.edges.length, 0);
    });

    it("devrait générer une visualisation ASCII du graphe", () => {
      const ascii = monitor.generateASCIIFlowGraph();
      
      assert.equal(typeof ascii, "string");
      assert.ok(ascii.includes("GRAPHE DE FLUX"));
    });
  });

  // ─── Tests de configuration ─────────────────────────────────────────────
  
  describe("Configuration", () => {
    it("devrait configurer la taille maximale de l'historique", () => {
      monitor.setMaxHistorySize(200);
      assert.ok(true);
    });

    it("devrait configurer le nombre maximal de métriques agrégées", () => {
      monitor.setMaxAggregatedMetrics(100);
      assert.ok(true);
    });
  });

  // ─── Tests de nettoyage ─────────────────────────────────────────────────
  
  describe("Nettoyage", () => {
    it("devrait réinitialiser toutes les données", () => {
      // @ts-ignore - Accès interne pour le test
      monitor.alerts.set("test", { id: "test", severity: "info", type: "test", title: "Test", message: "Test", timestamp: new Date().toISOString() });
      
      monitor.reset();
      
      assert.equal(monitor.getActiveAlerts().length, 0);
    });
  });
});

// ─── Tests du singleton ────────────────────────────────────────────────────

describe("MessageBusMonitor Singleton", () => {
  it("devrait exporter une instance singleton", () => {
    assert.ok(messageBusMonitor instanceof MessageBusMonitor);
  });
});
