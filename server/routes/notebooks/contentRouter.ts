import { Router, Request, Response } from "express";
import { notebookManager, contentGenerator } from "../../notebooks/index.js";
import type { GeneratedDocType, ReportSuggestion } from "../../notebooks/types.js";
import { buildRevealPresentation, countSlides } from "./slidesTheme.js";

export function createContentRouter(): Router {
  const router = Router();

  router.post("/:id/generate", async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, sourceIds, language, customInstructions, imageModel } = req.body;
      const validTypes: GeneratedDocType[] = ["summary", "faq", "study-guide", "briefing", "timeline", "outline", "mindmap", "swot", "glossary", "infographic", "full-report", "report-business", "report-market", "report-technical", "report-competitive", "report-financial", "report-marketing", "report-product", "report-risk", "report-executive", "report-project", "roadmap"];

      if (!type || !validTypes.includes(type)) {
        res.status(400).json({
          error: `Le champ 'type' doit être l'un de: ${validTypes.join(", ")}`,
        });
        return;
      }

      const doc = await contentGenerator.generate(req.params.id, type, { sourceIds, language, customInstructions, imageModel });
      res.json({ status: "success", document: doc });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/generate/stream", async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, sourceIds, language, customInstructions, imageModel } = req.body;
      const validTypes: GeneratedDocType[] = ["summary", "faq", "study-guide", "briefing", "timeline", "outline", "mindmap", "swot", "glossary", "infographic", "full-report", "report-business", "report-market", "report-technical", "report-competitive", "report-financial", "report-marketing", "report-product", "report-risk", "report-executive", "report-project", "roadmap"];

      if (!type || !validTypes.includes(type)) {
        res.status(400).json({
          error: `Le champ 'type' doit être l'un de: ${validTypes.join(", ")}`,
        });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      res.write(`event: start\ndata: ${JSON.stringify({ type, status: "generating" })}\n\n`);

      const doc = await contentGenerator.generate(req.params.id, type, {
        sourceIds,
        language,
        customInstructions,
        imageModel,
        onChunk: (chunk: string) => {
          res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        },
      });

      res.write(`event: done\ndata: ${JSON.stringify({ document: doc })}\n\n`);
      res.end();
    } catch (e: any) {
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: e.message });
      }
    }
  });

  router.get("/:id/generated", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      res.json({ status: "success", documents: notebook.generatedDocuments });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/generated/:docId", (req: Request, res: Response): void => {
    try {
      const success = notebookManager.deleteGeneratedDocument(req.params.id, req.params.docId);
      if (!success) {
        res.status(404).json({ error: "Document introuvable." });
        return;
      }
      res.json({ status: "success", message: "Document supprimé." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/generated/:docId/slides", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const doc = notebook.generatedDocuments.find((d: any) => d.id === req.params.docId);
      if (!doc) {
        res.status(404).json({ error: "Document introuvable." });
        return;
      }

      const {
        theme = "black",
        transition = "slide",
        ratio = "16:9",
        density = "normal",
      } = req.body as { theme?: string; transition?: string; ratio?: string; density?: string };

      const html = buildRevealPresentation(doc.title, doc.content, { theme, transition, ratio, density });

      res.json({ status: "success", html, slidesCount: countSlides(doc.content, density as any) + 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/report-suggestions", async (req: Request, res: Response): Promise<void> => {
    try {
      const suggestions: ReportSuggestion[] = await contentGenerator.suggestReports(req.params.id);
      res.json({ status: "success", suggestions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
