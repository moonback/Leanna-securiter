/**
 * Agents Router V2 — Utilise le nouveau AgentRuntime
 * 
 * API compatible avec l'ancien router mais routée via le runtime.
 * Ce fichier peut remplacer server/routes/agents.ts une fois la migration complète.
 */

import { Router, Request, Response } from "express";
import type { AgentRuntime } from "../AgentRuntime.js";

export function createAgentsRouterV2(runtime: AgentRuntime): Router {
  const router = Router();

  // GET /api/v2/agents/status
  router.get("/status", (_req: Request, res: Response) => {
    try {
      const stats = runtime.getStats();
      res.json({
        registered: stats.agents > 0,
        agents: runtime.listAgents().map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          maxConcurrency: a.maxConcurrency,
        })),
        stats: stats.tasks,
        tools: stats.tools,
        events: stats.events,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/agents/tasks
  router.get("/tasks", (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string ?? "50", 10), 100);
      const agentId = req.query.agentId as string | undefined;
      const state = req.query.state as string | undefined;

      const tasks = runtime.listTasks({ agentId, state: state as any, limit });
      res.json({
        tasks: tasks.map((t) => ({
          id: t.id,
          agentId: t.agentId,
          title: t.title,
          state: t.state,
          priority: t.priority,
          createdAt: new Date(t.createdAt).toISOString(),
          startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : null,
          completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
          result: t.result ? { success: t.result.success, summary: t.result.summary } : null,
        })),
        total: tasks.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/agents/list
  router.get("/list", (_req: Request, res: Response) => {
    try {
      const agents = runtime.listAgents();
      res.json({
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          capabilities: a.capabilities,
          maxConcurrency: a.maxConcurrency,
          timeoutMs: a.timeoutMs,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v2/agents/submit
  router.post("/submit", async (req: Request, res: Response) => {
    try {
      const { agentId, title, description, files, instructions, priority, timeoutMs } = req.body;

      if (!agentId || !title || !description) {
        return res.status(400).json({
          error: "agentId, title et description sont requis",
        });
      }

      const task = await runtime.submit({
        agentId,
        title,
        description,
        files,
        instructions,
        priority,
        timeoutMs,
      });

      res.status(202).json({
        taskId: task.id,
        agentId: task.agentId,
        state: task.state,
        message: `Tâche soumise à l'agent "${task.agentId}"`,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // POST /api/v2/agents/cancel/:taskId
  router.post("/cancel/:taskId", async (req: Request, res: Response) => {
    try {
      const success = await runtime.cancelTask(req.params.taskId);
      if (success) {
        res.json({ success: true, message: "Tâche annulée" });
      } else {
        res.status(404).json({ error: "Tâche introuvable ou non annulable" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/agents/task/:taskId
  router.get("/task/:taskId", (req: Request, res: Response) => {
    try {
      const task = runtime.getTask(req.params.taskId);
      if (!task) {
        return res.status(404).json({ error: "Tâche introuvable" });
      }
      res.json({
        id: task.id,
        agentId: task.agentId,
        title: task.title,
        description: task.description,
        state: task.state,
        priority: task.priority,
        result: task.result,
        createdAt: new Date(task.createdAt).toISOString(),
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
        completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/agents/metrics
  router.get("/metrics", (_req: Request, res: Response) => {
    try {
      const stats = runtime.getStats();
      const toolMetrics = runtime.tools.getToolMetrics();
      const eventMetrics = runtime.events.getMetrics();

      res.json({
        runtime: stats,
        tools: toolMetrics,
        events: eventMetrics,
        memory: stats.memory,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v2/agents/tools
  router.get("/tools", (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const declarations = category
        ? runtime.tools.getDeclarationsByCategory(category)
        : runtime.tools.getDeclarations();

      res.json({
        tools: declarations.map((d) => ({
          name: d.name,
          description: d.description,
        })),
        total: declarations.length,
        categories: runtime.tools.getCategories(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
