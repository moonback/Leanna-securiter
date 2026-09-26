import { Router, Request, Response } from "express";
import { sourceProcessingQueue } from "../../notebooks/index.js";

export function createQueueRouter(): Router {
  const router = Router();

  router.get("/queue/stats", (_req: Request, res: Response): void => {
    try {
      const stats = sourceProcessingQueue.getStats();
      res.json({ status: "success", stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/queue/pending", (_req: Request, res: Response): void => {
    try {
      const pending = sourceProcessingQueue.getPending().map(t => ({
        id: t.id,
        type: t.type,
        priority: t.priority,
        status: t.status,
        attempts: t.attempts,
        createdAt: t.createdAt,
        progress: t.progress,
      }));
      res.json({ status: "success", tasks: pending });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/queue/processing", (_req: Request, res: Response): void => {
    try {
      const processing = sourceProcessingQueue.getProcessing().map(t => ({
        id: t.id,
        type: t.type,
        priority: t.priority,
        status: t.status,
        attempts: t.attempts,
        startedAt: t.startedAt,
        progress: t.progress,
      }));
      res.json({ status: "success", tasks: processing });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/queue/task/:taskId", (req: Request, res: Response): void => {
    try {
      const task = sourceProcessingQueue.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Tâche introuvable." });
        return;
      }
      res.json({
        status: "success",
        task: {
          id: task.id,
          type: task.type,
          priority: task.priority,
          status: task.status,
          attempts: task.attempts,
          maxAttempts: task.maxAttempts,
          progress: task.progress,
          error: task.error,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/queue/task/:taskId", (req: Request, res: Response): void => {
    try {
      const success = sourceProcessingQueue.cancel(req.params.taskId);
      if (!success) {
        res.status(404).json({ error: "Tâche introuvable ou déjà en cours." });
        return;
      }
      res.json({ status: "success", message: "Tâche annulée." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/queue/clear", (_req: Request, res: Response): void => {
    try {
      sourceProcessingQueue.clear();
      res.json({ status: "success", message: "Queue vidée." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
