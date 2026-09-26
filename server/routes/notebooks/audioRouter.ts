import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { notebookManager, contentGenerator } from "../../notebooks/index.js";
import { getSandboxRoot } from "../../utils/sandbox.js";
import { getProjectRoot } from "../../utils/pathUtils.js";

export function createAudioRouter(): Router {
  const router = Router();

  router.post("/:id/audio-overview", async (req: Request, res: Response): Promise<void> => {
    try {
      const { language, duration, sourceIds, tone, customInstructions } = req.body;
      const overview = await contentGenerator.generateAudioOverview(req.params.id, {
        language, duration, sourceIds, tone, customInstructions,
      });
      res.json({ status: "success", overview });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/audio-overviews/:overviewId/tts", async (req: Request, res: Response): Promise<void> => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const overview = notebook.audioOverviews?.find((o: any) => o.id === req.params.overviewId);
      if (!overview || overview.status !== "ready") {
        res.status(404).json({ error: "Audio overview introuvable ou pas prêt." });
        return;
      }

      const { generateSpeech } = await import("../../utils/geminiTTS");

      const alexVoice = req.body.alexVoice || "ff_siwis";
      const samVoice = req.body.samVoice || "Puck";

      const lines = overview.script.split("\n").filter((l: string) => l.trim());
      const dialogueLines: { speaker: string; text: string }[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        const isAlex = trimmed.startsWith("Alex:") || trimmed.startsWith("Alex :");
        const isSam = trimmed.startsWith("Sam:") || trimmed.startsWith("Sam :");

        if (isAlex) {
          dialogueLines.push({ speaker: "alex", text: trimmed.replace(/^Alex\s*:\s*/i, "") });
        } else if (isSam) {
          dialogueLines.push({ speaker: "sam", text: trimmed.replace(/^Sam\s*:\s*/i, "") });
        } else if (trimmed) {
          dialogueLines.push({ speaker: "alex", text: trimmed });
        }
      }

      if (dialogueLines.length === 0) {
        res.status(400).json({ error: "Le script ne contient aucune réplique." });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      res.write(`event: start\ndata: ${JSON.stringify({ total: dialogueLines.length })}\n\n`);

      for (let i = 0; i < dialogueLines.length; i++) {
        const { speaker, text } = dialogueLines[i];
        const voice = speaker === "alex" ? alexVoice : samVoice;

        try {
          const audioBase64 = await generateSpeech(text, { voiceName: voice });
          if (audioBase64) {
            res.write(`event: chunk\ndata: ${JSON.stringify({
              index: i,
              speaker,
              text,
              audio: audioBase64,
            })}\n\n`);
          } else {
            res.write(`event: skip\ndata: ${JSON.stringify({ index: i, speaker, reason: "no audio" })}\n\n`);
          }
        } catch (ttsErr: any) {
          res.write(`event: skip\ndata: ${JSON.stringify({ index: i, speaker, reason: ttsErr.message })}\n\n`);
        }
      }

      res.write(`event: done\ndata: ${JSON.stringify({ totalGenerated: dialogueLines.length })}\n\n`);
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

  router.get("/:id/audio-overviews", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      res.json({ status: "success", overviews: notebook.audioOverviews });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/audio-overviews/:overviewId", (req: Request, res: Response): void => {
    try {
      const success = notebookManager.deleteAudioOverview(req.params.id, req.params.overviewId);
      if (!success) {
        res.status(404).json({ error: "Audio overview introuvable." });
        return;
      }
      res.json({ status: "success", message: "Audio overview supprimé." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/audio-overviews/:overviewId/export", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const overview = notebook.audioOverviews?.find((o: any) => o.id === req.params.overviewId);
      if (!overview) {
        res.status(404).json({ error: "Audio overview introuvable." });
        return;
      }

      const lines: string[] = [];
      lines.push(`# 🎙️ ${overview.title}`);
      lines.push("");
      lines.push(`> Exporté le ${new Date().toLocaleString("fr-FR")}`);
      lines.push(`> Durée estimée : ${Math.floor(overview.estimatedDuration / 60)}:${(overview.estimatedDuration % 60).toString().padStart(2, "0")}`);
      lines.push("");
      lines.push("---");
      lines.push("");

      const scriptLines = overview.script.split("\n");
      for (const line of scriptLines) {
        const trimmed = line.trim();
        if (!trimmed) {
          lines.push("");
          continue;
        }

        const isAlex = trimmed.startsWith("Alex:") || trimmed.startsWith("Alex :");
        const isSam = trimmed.startsWith("Sam:") || trimmed.startsWith("Sam :");

        if (isAlex) {
          const text = trimmed.replace(/^Alex\s*:\s*/i, "");
          lines.push(`**🧑 Alex :** ${text}`);
          lines.push("");
        } else if (isSam) {
          const text = trimmed.replace(/^Sam\s*:\s*/i, "");
          lines.push(`**🤖 Sam :** ${text}`);
          lines.push("");
        } else {
          lines.push(`*${trimmed}*`);
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("");
      lines.push(`*Script généré le ${new Date(overview.createdAt).toLocaleString("fr-FR")}*`);

      const markdown = lines.join("\n");

      const saveToWorkspace = req.query.save === "true" || req.query.save === "sandbox";
      const saveToSandbox = req.query.save === "sandbox";

      if (saveToWorkspace) {
        const targetRoot = saveToSandbox ? getSandboxRoot() : getProjectRoot();

        const filename = `audio-script-${overview.title.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ ]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 50)}.md`;
        const filePath = path.join(targetRoot, filename);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, markdown, "utf-8");

        res.json({
          status: "success",
          message: saveToSandbox ? `Script audio sauvegardé dans la sandbox` : `Script sauvegardé dans le workspace`,
          filePath: filename,
          destination: saveToSandbox ? "sandbox" : "workspace",
          markdown,
        });
      } else {
        const filename = `audio-script-${overview.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40)}-${Date.now()}.md`;
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(markdown);
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
