import { Router, Request, Response } from "express";
import { notebookManager } from "../../notebooks/index.js";

export function createNotesRouter(): Router {
  const router = Router();

  router.post("/:id/notes", (req: Request, res: Response): void => {
    try {
      const { title, content } = req.body;
      if (!title) {
        res.status(400).json({ error: "Le champ 'title' est requis." });
        return;
      }
      const note = notebookManager.addNote(req.params.id, title, content || "");
      if (!note) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      res.json({ status: "success", note });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/:id/notes/:noteId", (req: Request, res: Response): void => {
    try {
      const { title, content, pinned } = req.body;
      const note = notebookManager.updateNote(req.params.id, req.params.noteId, { title, content, pinned });
      if (!note) {
        res.status(404).json({ error: "Note introuvable." });
        return;
      }
      res.json({ status: "success", note });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/notes/:noteId", (req: Request, res: Response): void => {
    try {
      const success = notebookManager.deleteNote(req.params.id, req.params.noteId);
      if (!success) {
        res.status(404).json({ error: "Note introuvable." });
        return;
      }
      res.json({ status: "success", message: "Note supprimée." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
