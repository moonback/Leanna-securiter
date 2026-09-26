import { Router, Request, Response } from "express";
import { backupService } from "../../notebooks/index.js";

export function createBackupRouter(): Router {
  const router = Router();

  router.post("/backup/run", async (_req: Request, res: Response): Promise<void> => {
    try {
      const metadata = await backupService.runBackup();
      if (!metadata) {
        res.json({ status: "success", message: "Aucune modification à sauvegarder." });
        return;
      }
      res.json({ status: "success", backup: metadata });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/backup/list", (_req: Request, res: Response): void => {
    try {
      const backups = backupService.listBackups();
      res.json({ status: "success", backups });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/backup/restore", (req: Request, res: Response): void => {
    try {
      const { backupId, notebookId } = req.body;
      if (!backupId || typeof backupId !== "string") {
        res.status(400).json({ error: "Le champ 'backupId' est requis." });
        return;
      }

      if (notebookId) {
        const success = backupService.restoreNotebook(backupId, notebookId);
        if (!success) {
          res.status(404).json({ error: "Backup ou notebook introuvable." });
          return;
        }
        res.json({ status: "success", message: `Notebook ${notebookId} restauré.` });
      } else {
        const result = backupService.restoreAll(backupId);
        res.json({ status: "success", ...result });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/backup/config", (_req: Request, res: Response): void => {
    try {
      res.json({ status: "success", config: backupService.getConfig() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/backup/config", (req: Request, res: Response): void => {
    try {
      const { intervalMs, maxBackups, enabled } = req.body;
      backupService.updateConfig({ intervalMs, maxBackups, enabled });
      res.json({ status: "success", config: backupService.getConfig() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
