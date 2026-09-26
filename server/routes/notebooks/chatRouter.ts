import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { notebookManager, groundedChat } from "../../notebooks/index.js";
import { getSandboxRoot } from "../../utils/sandbox.js";

export function createChatRouter(): Router {
  const router = Router();

  router.post("/:id/chat", async (req: Request, res: Response): Promise<void> => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string") {
        res.status(400).json({ error: "Le champ 'question' est requis." });
        return;
      }

      const message = await groundedChat.ask(req.params.id, question.trim());
      res.json({ status: "success", message });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/chat/stream", async (req: Request, res: Response): Promise<void> => {
    try {
      const { question, threadId } = req.body;
      if (!question || typeof question !== "string") {
        res.status(400).json({ error: "Le champ 'question' est requis." });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      res.write(`event: start\ndata: ${JSON.stringify({ status: "streaming" })}\n\n`);

      const message = await groundedChat.askStream(
        req.params.id,
        question.trim(),
        (chunk: string) => {
          res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      );

      if (threadId) {
        const notebook = notebookManager.getNotebook(req.params.id);
        if (notebook?.chatThreads) {
          const thread = notebook.chatThreads.find((t: any) => t.id === threadId);
          if (thread) {
            thread.messages.push({
              id: `msg-${Date.now()}-u`,
              role: 'user',
              content: question.trim(),
              citations: [],
              timestamp: new Date().toISOString(),
            });
            thread.messages.push(message);
            if (thread.messages.length <= 2) {
              thread.title = question.trim().slice(0, 50) + (question.length > 50 ? '...' : '');
            }
            notebookManager.persistNotebook(req.params.id);
          }
        }
      }

      let followUps: string[] = [];
      try {
        followUps = await groundedChat.generateFollowUps(req.params.id);
      } catch { /* ignore */ }

      res.write(`event: done\ndata: ${JSON.stringify({ message, followUps })}\n\n`);
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

  router.get("/:id/chat/follow-ups", async (req: Request, res: Response): Promise<void> => {
    try {
      const followUps = await groundedChat.generateFollowUps(req.params.id);
      res.json({ status: "success", followUps });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/chat/deep-dive", async (req: Request, res: Response): Promise<void> => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string") {
        res.status(400).json({ error: "Le champ 'question' est requis." });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      res.write(`event: start\ndata: ${JSON.stringify({ mode: "deep-dive" })}\n\n`);

      const message = await groundedChat.deepDive(
        req.params.id,
        question.trim(),
        (stage: string, content: string) => {
          res.write(`event: progress\ndata: ${JSON.stringify({ stage, content })}\n\n`);
        }
      );

      let followUps: string[] = [];
      try {
        followUps = await groundedChat.generateFollowUps(req.params.id);
      } catch { /* ignore */ }

      res.write(`event: done\ndata: ${JSON.stringify({ message, followUps })}\n\n`);
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

  router.get("/:id/chat/history", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const threadId = req.query.threadId as string | undefined;
      if (threadId && notebook.chatThreads) {
        const thread = notebook.chatThreads.find((t: any) => t.id === threadId);
        res.json({ status: "success", messages: thread?.messages || [] });
      } else {
        res.json({ status: "success", messages: notebook.chatHistory });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/chat/threads", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const threads = (notebook.chatThreads || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
      }));
      res.json({ status: "success", threads });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/chat/threads", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      if (!notebook.chatThreads) notebook.chatThreads = [];

      const thread = {
        id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: req.body.title || `Conversation ${notebook.chatThreads.length + 1}`,
        messages: [],
        createdAt: new Date().toISOString(),
      };
      notebook.chatThreads.push(thread);
      notebook.updatedAt = new Date().toISOString();
      notebookManager.persistNotebook(req.params.id);

      res.json({ status: "success", thread: { id: thread.id, title: thread.title, createdAt: thread.createdAt } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/chat/threads/:threadId", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      if (notebook.chatThreads) {
        notebook.chatThreads = notebook.chatThreads.filter((t: any) => t.id !== req.params.threadId);
        notebook.updatedAt = new Date().toISOString();
        notebookManager.persistNotebook(req.params.id);
      }
      res.json({ status: "success" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/chat/feedback", (req: Request, res: Response): void => {
    try {
      const { messageId, feedback } = req.body;
      res.json({ status: "success", messageId, feedback });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/chat/history", (req: Request, res: Response): void => {
    try {
      notebookManager.clearChatHistory(req.params.id);
      res.json({ status: "success", message: "Historique effacé." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/chat/suggestions", async (req: Request, res: Response): Promise<void> => {
    try {
      const suggestions = await groundedChat.suggestQuestions(req.params.id);
      res.json({ status: "success", suggestions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/chat/export", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      if (notebook.chatHistory.length === 0) {
        res.status(400).json({ error: "Aucun message à exporter." });
        return;
      }

      const format = (req.query.format as string) || "markdown";

      const lines: string[] = [];
      lines.push(`# Chat — ${notebook.title}`);
      lines.push(`> Exporté le ${new Date().toLocaleString("fr-FR")}`);
      lines.push(`> ${notebook.chatHistory.length} messages\n`);
      lines.push("---\n");

      for (const msg of notebook.chatHistory) {
        const role = msg.role === "user" ? "🧑 **Utilisateur**" : "🤖 **Assistant**";
        const time = new Date(msg.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        lines.push(`### ${role} — ${time}\n`);
        lines.push(msg.content);

        if (msg.citations.length > 0) {
          lines.push("\n<details><summary>📚 Citations</summary>\n");
          for (const cit of msg.citations) {
            lines.push(`- **${cit.sourceTitle}** (pertinence: ${(cit.relevance * 100).toFixed(0)}%)`);
            lines.push(`  > ${cit.excerpt}\n`);
          }
          lines.push("</details>");
        }
        lines.push("\n---\n");
      }

      const markdown = lines.join("\n");

      if (format === "markdown") {
        const filename = `chat-${notebook.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40)}-${Date.now()}.md`;
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(markdown);
      } else {
        res.json({ status: "success", markdown, title: notebook.title });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/chat/save-message", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const { messageId, filename: customFilename, folder } = req.body as {
        messageId?: string;
        filename?: string;
        folder?: string;
      };

      let msg = notebook.chatHistory.find(m => m.id === messageId);
      if (!msg && notebook.chatThreads) {
        for (const thread of notebook.chatThreads) {
          msg = thread.messages.find(m => m.id === messageId);
          if (msg) break;
        }
      }

      if (!msg) {
        res.status(404).json({ error: "Message introuvable." });
        return;
      }

      const role = msg.role === "user" ? "Utilisateur" : "Assistant";
      const time = new Date(msg.timestamp).toLocaleString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const lines: string[] = [];
      lines.push(`# ${role} - ${notebook.title}`);
      lines.push(`> ${time}`);
      lines.push(`> Notebook : **${notebook.title}**\n`);
      lines.push("---\n");
      lines.push(msg.content);

      if (msg.citations && msg.citations.length > 0) {
        lines.push("\n\n---\n");
        lines.push("## Citations\n");
        for (const cit of msg.citations) {
          lines.push(`### ${cit.sourceTitle}`);
          lines.push(`- **Pertinence :** ${(cit.relevance * 100).toFixed(0)}%`);
          lines.push(`\n> ${cit.excerpt}\n`);
        }
      }

      const markdown = lines.join("\n");

      const sandboxRoot = getSandboxRoot();
      const targetFolder = folder
        ? path.join(sandboxRoot, folder.replace(/\.\./g, ""))
        : path.join(sandboxRoot, "chat-exports");

      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
      }

      const timestamp = new Date(msg.timestamp).getTime();
      const roleSlug = msg.role === "user" ? "user" : "assistant";
      const contentSlug = msg.content
        .slice(0, 40)
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      const safeFilename = customFilename
        ? customFilename.replace(/[^a-zA-Z0-9\-_.]/g, "_") + (customFilename.endsWith(".md") ? "" : ".md")
        : `${roleSlug}-${timestamp}-${contentSlug || "message"}.md`;

      const filePath = path.join(targetFolder, safeFilename);
      fs.writeFileSync(filePath, markdown, "utf-8");

      res.json({
        status: "success",
        filePath: path.relative(sandboxRoot, filePath).replace(/\\/g, "/"),
        filename: safeFilename,
        destination: "sandbox",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/chat/chunk/:chunkId", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const chunkId = req.params.chunkId;

      for (const source of notebook.sources) {
        const chunk = source.chunks.find(c => c.id === chunkId);
        if (chunk) {
          res.json({
            status: "success",
            chunk: {
              id: chunk.id,
              content: chunk.content,
              sourceTitle: source.title,
              sourceId: source.id,
              index: chunk.index,
              metadata: chunk.metadata,
            },
          });
          return;
        }
      }

      res.status(404).json({ error: "Chunk introuvable." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/chat/compare", async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceIds } = req.body;
      if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length < 2) {
        res.status(400).json({ error: "Au moins 2 sourceIds sont requis." });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      res.write(`event: start\ndata: ${JSON.stringify({ mode: "compare" })}\n\n`);

      const message = await groundedChat.compareSources(
        req.params.id,
        sourceIds,
        (chunk: string) => {
          res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      );

      let followUps: string[] = [];
      try {
        followUps = await groundedChat.generateFollowUps(req.params.id);
      } catch { /* ignore */ }

      res.write(`event: done\ndata: ${JSON.stringify({ message, followUps })}\n\n`);
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

  router.post("/:id/chat/insights", async (req: Request, res: Response): Promise<void> => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      res.write(`event: start\ndata: ${JSON.stringify({ mode: "insights" })}\n\n`);

      const message = await groundedChat.extractInsights(
        req.params.id,
        (chunk: string) => {
          res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      );

      let followUps: string[] = [];
      try {
        followUps = await groundedChat.generateFollowUps(req.params.id);
      } catch { /* ignore */ }

      res.write(`event: done\ndata: ${JSON.stringify({ message, followUps })}\n\n`);
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

  return router;
}
