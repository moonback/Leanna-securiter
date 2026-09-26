import { Router, Request, Response } from "express";
import { notebookManager, contentGenerator } from "../../notebooks/index.js";
import { SELF_ROOT } from "../../utils/selfRoot.js";

export function createNotebooksCrudRouter(): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response): void => {
    try {
      // Filtrer par workspace actif — SELF_ROOT est lu dynamiquement à chaque requête
      const workspaceId = SELF_ROOT || undefined;
      const notebooks = notebookManager.getAllNotebooks(workspaceId);
      const light = notebooks.map(nb => ({
        id: nb.id,
        title: nb.title,
        description: nb.description,
        sourcesCount: nb.sources.length,
        notesCount: nb.notes.length,
        color: nb.color,
        icon: nb.icon,
        createdAt: nb.createdAt,
        updatedAt: nb.updatedAt,
      }));
      res.json({ status: "success", notebooks: light });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", (req: Request, res: Response): void => {
    try {
      const { title, description } = req.body;
      if (!title || typeof title !== "string") {
        res.status(400).json({ error: "Le champ 'title' est requis." });
        return;
      }
      const notebook = notebookManager.createNotebook(title.trim(), description || "", SELF_ROOT || undefined);

      contentGenerator.generateRoadmap(notebook.id, title.trim(), description || "").catch(() => {});

      res.json({ status: "success", notebook });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const light = {
        ...notebook,
        sources: notebook.sources.map(s => ({
          id: s.id,
          title: s.title,
          type: s.type,
          origin: s.origin,
          summary: s.summary,
          keywords: s.keywords,
          wordCount: s.wordCount,
          language: s.language,
          addedAt: s.addedAt,
          chunksCount: s.chunks.length,
        })),
      };
      res.json({ status: "success", notebook: light });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/:id", (req: Request, res: Response): void => {
    try {
      const { title, description, color, icon } = req.body;
      const updated = notebookManager.updateNotebook(req.params.id, { title, description, color, icon });
      if (!updated) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      res.json({ status: "success", notebook: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", (req: Request, res: Response): void => {
    try {
      const success = notebookManager.deleteNotebook(req.params.id);
      if (!success) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      res.json({ status: "success", message: "Notebook supprimé." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/stats/global", (_req: Request, res: Response): void => {
    try {
      const stats = notebookManager.getStats();
      res.json({ status: "success", stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
