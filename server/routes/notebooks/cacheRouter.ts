import { Router, Request, Response } from "express";
import { chatResponseCache, ragSearchCache } from "../../notebooks/index.js";

export function createCacheRouter(): Router {
  const router = Router();

  router.get("/cache/stats", (_req: Request, res: Response): void => {
    try {
      const chatStats = chatResponseCache.getStats();
      const ragStats = ragSearchCache.getStats();
      res.json({
        status: "success",
        chat: chatStats,
        rag: ragStats,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/cache/clear", (_req: Request, res: Response): void => {
    try {
      chatResponseCache.clear();
      ragSearchCache.clear();
      res.json({ status: "success", message: "Cache vidé." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/cache/:notebookId", (req: Request, res: Response): void => {
    try {
      const chatInvalidated = chatResponseCache.invalidateNotebook(req.params.notebookId);
      const ragInvalidated = ragSearchCache.invalidateNotebook(req.params.notebookId);
      res.json({
        status: "success",
        invalidated: { chat: chatInvalidated, rag: ragInvalidated },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
