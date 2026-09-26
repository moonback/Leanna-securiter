/**
 * Metrics Router — Observabilité centralisée du runtime
 * 
 * Expose les métriques, traces, et état de santé du runtime V2.
 * Un seul endpoint à surveiller au lieu de multiples sources dispersées.
 */

import { Router, Request, Response } from "express";
import type { AgentRuntime } from "../AgentRuntime.js";
import type { LeannaCore } from "../../autonomy/LeannaCore.js";
import { strategyMemory } from "../../knowledge/StrategyMemory.js";

export function createMetricsRouter(runtime: AgentRuntime, autonomy?: LeannaCore): Router {
  const router = Router();

  // GET /api/v2/metrics
  router.get("/", (_req: Request, res: Response) => {
    try {
      const stats = runtime.getStats();
      const toolMetrics = runtime.tools.getToolMetrics();
      const eventMetrics = runtime.events.getMetrics();
      const memoryStats = runtime.memory.getStats();

      res.json({
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        runtime: {
          agents: stats.agents,
          tools: stats.tools,
          tasks: stats.tasks,
        },
        toolMetrics: {
          top10: Object.entries(toolMetrics)
            .sort((a, b) => b[1].calls - a[1].calls)
            .slice(0, 10)
            .map(([name, m]) => ({ name, ...m })),
          totalCalls: Object.values(toolMetrics).reduce((sum, m) => sum + m.calls, 0),
          totalFailures: Object.values(toolMetrics).reduce((sum, m) => sum + m.failures, 0),
        },
        events: eventMetrics,
        memory: memoryStats,
        process: {
          memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          cpuUser: process.cpuUsage().user,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/metrics/autonomy — current autonomous runtime state and bounded task timeline.
  router.get("/autonomy", (_req: Request, res: Response) => {
    if (!autonomy) return res.status(503).json({ error: "Autonomy runtime unavailable" });
    return res.json({ state: autonomy.getState(), tasks: autonomy.getTasks().slice(0, 100) });
  });

  // GET /api/v2/metrics/reliability — durable cross-mission skill reliability.
  // Surfaces the StrategyMemory signal that biases planning (see master audit
  // GAP-1) so operators can see WHY a tool is deprioritised.
  router.get("/reliability", (_req: Request, res: Response) => {
    try {
      const all = strategyMemory.getAllStats();
      return res.json({
        timestamp: new Date().toISOString(),
        totalSkills: all.length,
        failing: strategyMemory.getFailingSkills(),
        skills: all.sort((a, b) => a.recentSuccessRate - b.recentSuccessRate),
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/metrics/tools
  router.get("/tools", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string ?? "50", 10);
      res.json({
        metrics: runtime.tools.getToolMetrics(),
        history: runtime.tools.getCallHistory(limit),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/metrics/events
  router.get("/events", (_req: Request, res: Response) => {
    try {
      res.json({
        counters: runtime.events.getMetrics(),
        subscribers: runtime.events.subscriberCount,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/health
  router.get("/health", (_req: Request, res: Response) => {
    const stats = runtime.getStats();
    const healthy = runtime.isRunning && stats.agents > 0;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "degraded",
      running: runtime.isRunning,
      agents: stats.agents,
      tools: stats.tools,
      activeTasks: stats.tasks.running,
      pendingTasks: stats.tasks.pending,
    });
  });

  return router;
}
