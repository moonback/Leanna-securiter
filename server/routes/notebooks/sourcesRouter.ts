import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { notebookManager, sourceIngester, embeddingStore, sourceProcessingQueue } from "../../notebooks/index.js";
import { getSandboxRoot } from "../../utils/sandbox.js";

export function createSourcesRouter(upload: multer.Multer): Router {
  const router = Router();

  router.post("/:id/sources/upload", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
    try {
      const notebookId = req.params.id;
      const notebook = notebookManager.getNotebook(notebookId);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "Aucun fichier fourni." });
        return;
      }

      const source = await sourceIngester.ingestFromBuffer(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        notebookId
      );

      notebookManager.addSource(notebookId, source);

      res.json({
        status: "success",
        source: {
          id: source.id,
          title: source.title,
          type: source.type,
          summary: source.summary,
          keywords: source.keywords,
          wordCount: source.wordCount,
          chunksCount: source.chunks.length,
          language: source.language,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/upload-multi", upload.array("files", 20), async (req: Request, res: Response): Promise<void> => {
    try {
      const notebookId = req.params.id;
      const notebook = notebookManager.getNotebook(notebookId);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: "Aucun fichier fourni." });
        return;
      }

      const results: Array<{
        filename: string;
        status: "success" | "error";
        source?: any;
        error?: string;
      }> = [];

      for (const file of files) {
        try {
          const source = await sourceIngester.ingestFromBuffer(
            file.buffer,
            file.originalname,
            file.mimetype,
            notebookId
          );
          notebookManager.addSource(notebookId, source);

          results.push({
            filename: file.originalname,
            status: "success",
            source: {
              id: source.id,
              title: source.title,
              type: source.type,
              summary: source.summary,
              keywords: source.keywords,
              wordCount: source.wordCount,
              chunksCount: source.chunks.length,
              language: source.language,
            },
          });
        } catch (e: any) {
          results.push({
            filename: file.originalname,
            status: "error",
            error: e.message,
          });
        }
      }

      const successCount = results.filter(r => r.status === "success").length;
      const errorCount = results.filter(r => r.status === "error").length;

      res.json({
        status: errorCount === 0 ? "success" : (successCount > 0 ? "partial" : "error"),
        total: files.length,
        successCount,
        errorCount,
        results,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/upload-queued", upload.array("files", 20), (req: Request, res: Response): void => {
    try {
      const notebookId = req.params.id;
      const notebook = notebookManager.getNotebook(notebookId);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: "Aucun fichier fourni." });
        return;
      }

      const priority = (req.body.priority as "urgent" | "normal" | "low") || "normal";
      const taskIds: string[] = [];

      for (const file of files) {
        const taskId = `src-${notebookId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const task = sourceProcessingQueue.enqueue(
          taskId,
          "source-ingest",
          {
            notebookId,
            fileName: file.originalname,
            mimeType: file.mimetype,
            buffer: file.buffer,
          },
          { priority }
        );

        if (task) {
          taskIds.push(task.id);
        }
      }

      res.json({
        status: "success",
        message: `${taskIds.length} fichier(s) ajouté(s) à la queue de processing.`,
        taskIds,
        queueStats: sourceProcessingQueue.getStats(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/url", async (req: Request, res: Response): Promise<void> => {
    try {
      const notebookId = req.params.id;
      const notebook = notebookManager.getNotebook(notebookId);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        res.status(400).json({ error: "Le champ 'url' est requis." });
        return;
      }

      const source = await sourceIngester.ingestFromURL(url, notebookId);
      notebookManager.addSource(notebookId, source);

      res.json({
        status: "success",
        source: {
          id: source.id,
          title: source.title,
          type: source.type,
          summary: source.summary,
          keywords: source.keywords,
          wordCount: source.wordCount,
          chunksCount: source.chunks.length,
          language: source.language,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/text", async (req: Request, res: Response): Promise<void> => {
    try {
      const notebookId = req.params.id;
      const notebook = notebookManager.getNotebook(notebookId);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const { title, content } = req.body;
      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "Le champ 'content' est requis." });
        return;
      }

      const buffer = Buffer.from(content, "utf-8");
      const source = await sourceIngester.ingestFromBuffer(
        buffer,
        title || "Note collée",
        "text/plain",
        notebookId
      );
      notebookManager.addSource(notebookId, source);

      res.json({
        status: "success",
        source: {
          id: source.id,
          title: source.title,
          type: source.type,
          summary: source.summary,
          keywords: source.keywords,
          wordCount: source.wordCount,
          chunksCount: source.chunks.length,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/sources/:sourceId", (req: Request, res: Response): void => {
    try {
      const success = notebookManager.removeSource(req.params.id, req.params.sourceId);
      if (!success) {
        res.status(404).json({ error: "Source introuvable." });
        return;
      }
      res.json({ status: "success", message: "Source supprimée." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/codebase", async (req: Request, res: Response): Promise<void> => {
    try {
      const notebookId = req.params.id;
      const notebook = notebookManager.getNotebook(notebookId);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }

      const {
        extensions,
        excludeDirs = [],
        maxFileSizeKb = 100,
        includeConfig = true,
        title,
      } = req.body as {
        extensions?: string[];
        excludeDirs?: string[];
        maxFileSizeKb?: number;
        includeConfig?: boolean;
        title?: string;
      };

      const { getProjectRoot: getProjRoot, EXCLUDED_DIRS, TEXT_FILE_EXT } = await import("../../skills/codebaseHelpers");
      const workspaceRoot = getProjRoot();

      if (!fs.existsSync(workspaceRoot)) {
        res.status(400).json({ error: `Workspace introuvable: ${workspaceRoot}` });
        return;
      }

      const allowedExtensions = extensions && extensions.length > 0
        ? new Set(extensions.map((e: string) => e.toLowerCase().replace(/^\.?/, ".")))
        : null;

      const excludedDirsSet = new Set([
        ...EXCLUDED_DIRS,
        ".Leanna", ".aionrs", ".kiro", ".github", ".husky", ".vscode",
        "coverage", ".nyc_output", "tmp", "temp", ".cache",
        ...excludeDirs.map((d: string) => d.toLowerCase()),
      ]);

      const configFiles = new Set(["package.json", "tsconfig.json", ".env.example", "vite.config.ts", "vite.config.js"]);
      const maxBytes = maxFileSizeKb * 1024;
      const collectedFiles: { rel: string; content: string }[] = [];
      let totalChars = 0;
      const MAX_TOTAL_CHARS = 2_000_000;

      function walk(dir: string, relBase: string) {
        if (totalChars >= MAX_TOTAL_CHARS) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }

        for (const entry of entries) {
          const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (excludedDirsSet.has(entry.name.toLowerCase())) continue;
            walk(path.join(dir, entry.name), relPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            const isConfig = includeConfig && configFiles.has(entry.name);
            const isTextFile = TEXT_FILE_EXT.test(entry.name);
            const isAllowed = allowedExtensions ? allowedExtensions.has(ext) : isTextFile;
            if (!isAllowed && !isConfig) continue;

            let stats: fs.Stats;
            try { stats = fs.statSync(path.join(dir, entry.name)); } catch { continue; }
            if (stats.size > maxBytes) continue;
            if (totalChars + stats.size > MAX_TOTAL_CHARS) continue;

            try {
              const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
              collectedFiles.push({ rel: relPath, content });
              totalChars += content.length;
            } catch { /* fichier non lisible */ }
          }
        }
      }

      walk(workspaceRoot, "");

      if (collectedFiles.length === 0) {
        res.status(400).json({ error: "Aucun fichier texte trouvé dans le workspace." });
        return;
      }

      const EXT_TO_LANG: Record<string, string> = {
        ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
        py: "python", json: "json", md: "markdown", html: "html",
        css: "css", scss: "scss", yaml: "yaml", yml: "yaml",
        sh: "bash", sql: "sql", cjs: "javascript", mjs: "javascript",
        env: "bash", txt: "text",
      };

      const workspaceName = path.basename(workspaceRoot);
      const now = new Date().toLocaleString("fr-FR");
      const mdLines: string[] = [
        `# Codebase : ${workspaceName}`,
        ``,
        `> Exporté le ${now} — ${collectedFiles.length} fichier(s) — ${Math.round(totalChars / 1024)} Ko de texte`,
        ``,
        `## Arborescence`,
        ``,
        "```",
        ...collectedFiles.map(f => f.rel),
        "```",
        ``,
        `---`,
        ``,
      ];

      for (const { rel, content } of collectedFiles) {
        const ext = path.extname(rel).replace(".", "") || "text";
        const lang = EXT_TO_LANG[ext] || ext;
        mdLines.push(`## \`${rel}\``);
        mdLines.push(``);
        mdLines.push("```" + lang);
        mdLines.push(content.trimEnd());
        mdLines.push("```");
        mdLines.push(``);
      }

      const markdown = mdLines.join("\n");
      const sourceTitle = title?.trim() || `Codebase — ${workspaceName}`;
      const buffer = Buffer.from(markdown, "utf-8");
      const source = await sourceIngester.ingestFromBuffer(
        buffer,
        sourceTitle,
        "text/markdown",
        notebookId
      );
      notebookManager.addSource(notebookId, source);

      res.json({
        status: "success",
        source: {
          id: source.id,
          title: source.title,
          type: source.type,
          summary: source.summary,
          keywords: source.keywords,
          wordCount: source.wordCount,
          chunksCount: source.chunks.length,
        },
        stats: {
          filesCollected: collectedFiles.length,
          totalChars,
          workspaceRoot,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/:sourceId/reindex", async (req: Request, res: Response): Promise<void> => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const source = notebook.sources.find(s => s.id === req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source introuvable." });
        return;
      }

      embeddingStore.removeSource(req.params.sourceId, req.params.id);

      const chunks = source.chunks || [];
      if (chunks.length > 0) {
        await embeddingStore.indexChunks(
          chunks.map((c: any) => ({ id: c.id, content: c.content })),
          req.params.sourceId,
          req.params.id
        );
      }

      res.json({ status: "success", chunksCount: chunks.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/sources/:sourceId/content", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const source = notebook.sources.find(s => s.id === req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source introuvable." });
        return;
      }
      if (source.type === "image") {
        const imageBase64 = (source as any).imageBase64 || "";
        const imageMimeType = (source as any).imageMimeType || "image/png";
        const content = source.rawText
          || (source.chunks && source.chunks.length > 0
            ? source.chunks.sort((a, b) => a.index - b.index).map(c => c.content).join("\n\n")
            : source.summary || "Contenu non disponible.");
        res.json({ status: "success", content, type: "image", imageBase64, imageMimeType });
        return;
      }

      if (source.type === "html" && (source as any).rawHtml) {
        const content = source.rawText
          || (source.chunks && source.chunks.length > 0
            ? source.chunks.sort((a, b) => a.index - b.index).map(c => c.content).join("\n\n")
            : source.summary || "Contenu non disponible.");
        res.json({ status: "success", content, type: "html", rawHtml: (source as any).rawHtml });
        return;
      }

      const content = source.rawText
        || (source.chunks && source.chunks.length > 0
          ? source.chunks.sort((a, b) => a.index - b.index).map(c => c.content).join("\n\n")
          : source.summary || "Contenu non disponible.");
      res.json({ status: "success", content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:id/sources/:sourceId/tags", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const source = notebook.sources.find(s => s.id === req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source introuvable." });
        return;
      }
      const { tag } = req.body;
      if (!tag || typeof tag !== "string") {
        res.status(400).json({ error: "Le champ 'tag' est requis." });
        return;
      }
      if (!source.keywords.includes(tag.trim())) {
        source.keywords.push(tag.trim());
        notebook.updatedAt = new Date().toISOString();
        notebookManager.persistNotebook(req.params.id);
      }
      res.json({ status: "success", keywords: source.keywords });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/sources/:sourceId/tags", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      const source = notebook.sources.find(s => s.id === req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source introuvable." });
        return;
      }
      const { tag } = req.body;
      source.keywords = source.keywords.filter(k => k !== tag);
      notebook.updatedAt = new Date().toISOString();
      notebookManager.persistNotebook(req.params.id);
      res.json({ status: "success", keywords: source.keywords });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/sources-summary", async (req: Request, res: Response): Promise<void> => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      if (notebook.sources.length === 0) {
        res.json({ status: "success", summary: null, message: "Aucune source." });
        return;
      }

      const cached = (notebook as any)._sourcesSummaryCache as { hash: string; summary: string } | undefined;
      const currentHash = notebook.sources.map(s => s.id).sort().join("|");

      if (cached && cached.hash === currentHash) {
        res.json({ status: "success", summary: cached.summary, cached: true });
        return;
      }

      const sourcesContext = notebook.sources.map(s =>
        `### 📄 ${s.title} (${s.type})\n**Résumé :** ${s.summary}\n**Mots-clés :** ${s.keywords.join(", ")}\n**Volume :** ${s.wordCount} mots`
      ).join("\n\n");

      const lang = notebook.sources[0]?.language || "fr";
      const langInstruction = lang === "fr" ? "Réponds en français." : "Reply in English.";

      const prompt = `${langInstruction}

Tu es un assistant de synthèse documentaire. Génère un résumé global et structuré qui combine les informations de TOUTES les sources ci-dessous en un encart cohérent.

Le résumé doit :
- Être un paragraphe de synthèse (3-6 phrases) qui capture l'essence de l'ensemble des sources
- Suivi de bullet-points des points clés (max 8 points)
- Terminer avec les thèmes/mots-clés transversaux

Format Markdown court et lisible (pas de titres # principaux, utilise ** pour le gras et - pour les listes).

SOURCES (${notebook.sources.length}) :
${sourcesContext}

Génère le résumé global maintenant.`;

      const { generateText: genText } = await import("../../utils/textGeneration");
      const result = await genText({
        prompt,
        temperature: 0.3,
        maxOutputTokens: 1024,
      });

      (notebook as any)._sourcesSummaryCache = { hash: currentHash, summary: result.text };
      notebookManager.persistNotebook(req.params.id);

      res.json({ status: "success", summary: result.text, cached: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id/sources-summary", (req: Request, res: Response): void => {
    try {
      const notebook = notebookManager.getNotebook(req.params.id);
      if (!notebook) {
        res.status(404).json({ error: "Notebook introuvable." });
        return;
      }
      delete (notebook as any)._sourcesSummaryCache;
      notebookManager.persistNotebook(req.params.id);
      res.json({ status: "success", message: "Cache du résumé invalidé." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sandbox/folders", (_req: Request, res: Response): void => {
    try {
      const sandboxRoot = getSandboxRoot();

      if (!fs.existsSync(sandboxRoot)) {
        fs.mkdirSync(sandboxRoot, { recursive: true });
      }

      function listDirs(dir: string, base: string, depth: number): { path: string; name: string; depth: number }[] {
        const results: { path: string; name: string; depth: number }[] = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const relPath = base ? `${base}/${entry.name}` : entry.name;
            results.push({ path: relPath, name: entry.name, depth });
            if (depth < 2) {
              results.push(...listDirs(path.join(dir, entry.name), relPath, depth + 1));
            }
          }
        } catch { /* ignore unreadable dirs */ }
        return results;
      }

      const folders = [
        { path: "", name: "/ (racine sandbox)", depth: 0 },
        ...listDirs(sandboxRoot, "", 1),
      ];

      res.json({ status: "success", sandboxRoot, folders });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
