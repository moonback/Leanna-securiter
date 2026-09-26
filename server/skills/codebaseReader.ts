import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { generateText } from "../utils/textGeneration.js";
import { markFileModified } from "../utils/sandbox.js";

/** Calcule le hash MD5 d'un contenu string (utf-8). */
function md5(content: string): string {
  return createHash("md5").update(content, "utf-8").digest("hex");
}
import {
  getProjectRoot,
  normalizeProjectPath,
  resolveWritePath,
  checkWorkspace,
  EXCLUDED_DIRS,
  EXCLUDED_FILES,
  TEXT_FILE_EXT,
  MAX_PREVIEW_SIZE,
  buildTreeMarkdown,
  buildFilePreview,
  buildPackageSummary,
  extractFileOutline,
  buildAnalysisPrompt
} from "./codebaseHelpers.js";

async function walkDirectory(dir: string, relativeBase: string, files: string[]) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    const relativePath = path.join(relativeBase, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(entryPath, relativePath, files);
    } else if (entry.isFile() && !EXCLUDED_FILES.has(entry.name)) {
      files.push(relativePath);
    }
  }
}

async function analyzeCodebaseWithOpenRouter(codebaseMarkdown: string): Promise<string | null> {
  try {
    const response = await generateText({
      prompt: buildAnalysisPrompt(codebaseMarkdown),
      systemPrompt: "Tu es un analyste de codebase. Reponds en Markdown clair, concis et structure.",
      temperature: 0.3,
    });
    return response.text.trim() || null;
  } catch (e: any) {
    console.error(`[Codebase] Erreur analyse IA: ${e.message}`);
    return null;
  }
}

// ─── Reader Handlers ──────────────────────────────────────────────────────────

export async function handleGenerateCodebaseMarkdown(args: any) {
  if (!getProjectRoot()) {
    return { error: "Aucun workspace ouvert. Sélectionnez ou créez un projet d'abord." };
  }
  const codebasePath = resolveWritePath("codebase.md");
  if (!codebasePath) {
    return { error: "Sandbox indisponible : génération de codebase.md refusée tant que le sandbox n'est pas READY." };
  }

  const includePreview = args.includePreview !== false;
  const analyzeWithOpenRouter = args.analyzeWithOpenRouter !== false;
  const files: string[] = [];
  await walkDirectory(getProjectRoot(), ".", files);
  const treeMarkdown = buildTreeMarkdown(files);
  const packageSummary = await buildPackageSummary(getProjectRoot());

  const header = [
    "# Codebase du projet",
    "",
    `Genere le ${new Date().toISOString()}.`,
    "",
    "## Structure des fichiers",
    "",
    treeMarkdown,
    "",
    packageSummary,
    "",
    "## Detail des fichiers",
    "",
  ].join("\n");

  const fileDetails: string[] = [];
  for (const relativePath of files) {
    fileDetails.push(`### ${relativePath}`);
    try {
      const absolutePath = path.join(getProjectRoot(), relativePath);
      const stats = await fs.promises.stat(absolutePath);
      fileDetails.push(`- Taille: ${stats.size} octets`);
      if (includePreview && TEXT_FILE_EXT.test(relativePath) && stats.size <= MAX_PREVIEW_SIZE) {
        fileDetails.push("", "```", await buildFilePreview(relativePath, getProjectRoot()), "```");
      } else {
        fileDetails.push("- Apercu non inclus (binaire ou trop volumineux).");
      }
      fileDetails.push("");
    } catch (error: any) {
      fileDetails.push(`- Erreur: ${error.message}`, "");
    }
  }

  let markdown = header + fileDetails.join("\n");
  let analysis: string | null = null;
  let analysisStatus = "disabled";
  if (analyzeWithOpenRouter) {
    try {
      analysis = await analyzeCodebaseWithOpenRouter(markdown);
      analysisStatus = analysis ? "success" : "missing-api-key";
      if (analysis) markdown += "\n\n## Analyse OpenRouter\n\n" + analysis;
    } catch (error: any) {
      analysisStatus = `error:${error.message}`;
    }
  }
  const finalCodebasePath = resolveWritePath("codebase.md");
  if (!finalCodebasePath || finalCodebasePath !== codebasePath) {
    return { error: "Le sandbox a changé d'état pendant la génération ; codebase.md n'a pas été écrit." };
  }
  await fs.promises.writeFile(finalCodebasePath, markdown, "utf-8");
  markFileModified("codebase.md");
  return { status: "success", path: "codebase.md", fileCount: files.length, analysis, analysisStatus };
}

export async function handleListProjectFiles(args: any) {
  if (!getProjectRoot()) {
    return { error: "Aucun workspace ouvert. Sélectionnez ou créez un projet d'abord." };
  }
  const dirPath = String(args.path || ".").trim();
  const recursive = args.recursive === true;
  const includeStats = args.includeStats === true;
  // Filtrage par extension : "ts,tsx,js" → ["ts", "tsx", "js"]
  const filterExts: string[] | null = args.extensions
    ? String(args.extensions).split(",").map((e: string) => e.trim().replace(/^\./, "").toLowerCase()).filter(Boolean)
    : null;

  const normalized = normalizeProjectPath(dirPath);
  if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };
  if (!fs.existsSync(normalized)) return { error: "Dossier introuvable." };
  const stats = await fs.promises.stat(normalized);
  if (!stats.isDirectory()) return { error: "Le chemin doit pointer vers un dossier." };

  if (recursive) {
    const files: string[] = [];
    await walkDirectory(normalized, dirPath === "." ? "." : dirPath, files);

    // Filtrage par extension
    const filtered = filterExts
      ? files.filter(f => {
          const ext = path.extname(f).replace(/^\./, "").toLowerCase();
          return filterExts.includes(ext);
        })
      : files;

    if (!includeStats) {
      return { status: "success", path: dirPath, recursive: true, count: filtered.length, files: filtered };
    }

    // Avec stats
    const filesWithStats = await Promise.all(
      filtered.map(async (f) => {
        const abs = path.join(getProjectRoot(), f);
        const s = await fs.promises.stat(abs).catch(() => null);
        return {
          path: f,
          sizeBytes: s?.size,
          modifiedAt: s?.mtime.toISOString(),
        };
      })
    );
    return { status: "success", path: dirPath, recursive: true, count: filesWithStats.length, files: filesWithStats };
  }

  const entries = await fs.promises.readdir(normalized, { withFileTypes: true });
  const result = await Promise.all(
    entries
      .filter((e) => !EXCLUDED_DIRS.has(e.name))
      .filter((e) => {
        if (!filterExts || e.isDirectory()) return true;
        const ext = path.extname(e.name).replace(/^\./, "").toLowerCase();
        return filterExts.includes(ext);
      })
      .map(async (e) => {
        const fullPath = path.join(normalized, e.name);
        const s = await fs.promises.stat(fullPath);
        return {
          name: e.name,
          path: dirPath === "." ? e.name : `${dirPath}/${e.name}`,
          type: e.isDirectory() ? "directory" : "file",
          sizeBytes: e.isFile() ? s.size : undefined,
          ...(includeStats && {
            modifiedAt: s.mtime.toISOString(),
            createdAt: s.birthtime.toISOString(),
          }),
        };
      })
  );
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { status: "success", path: dirPath, recursive: false, count: result.length, entries: result };
}

export async function handleReadProjectFile(args: any) {
  if (!getProjectRoot()) {
    return { error: "Aucun workspace ouvert. Sélectionnez ou créez un projet d'abord." };
  }
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  const normalized = normalizeProjectPath(requestedPath);
  if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };
  const stats = await fs.promises.stat(normalized);
  if (!stats.isFile()) return { error: "Le chemin doit pointer vers un fichier." };
  const raw = await fs.promises.readFile(normalized, "utf-8");
  const lines = raw.split(/\r?\n/);
  const startLine = typeof args.startLine === "number" ? Math.max(1, args.startLine) : 1;
  const endLine = typeof args.endLine === "number" ? Math.min(lines.length, args.endLine) : lines.length;
  const selectedLines = lines.slice(startLine - 1, endLine);
  const content = selectedLines.join("\n");

  const forceFullContent = args.full === true || args.forceFullContent === true;
  const SMART_LIMIT = 8000;
  const noRangeSpecified = typeof args.startLine !== "number" && typeof args.endLine !== "number";

  // ── Preview partiel amélioré : début + fin du fichier ────────────────────
  if (!forceFullContent && noRangeSpecified && content.length > SMART_LIMIT) {
    const HEAD_LINES = 60;
    const TAIL_LINES = 30;
    const headLines = lines.slice(0, HEAD_LINES);
    const tailLines = lines.length > HEAD_LINES + TAIL_LINES
      ? lines.slice(lines.length - TAIL_LINES)
      : [];
    const hasMiddle = lines.length > HEAD_LINES + TAIL_LINES;
    const preview = [
      ...headLines,
      ...(hasMiddle
        ? [`\n... [${lines.length - HEAD_LINES - TAIL_LINES} lignes masquées — utilise startLine/endLine ou full:true] ...\n`]
        : []),
      ...tailLines,
    ].join("\n");

    return {
      status: "partial",
      path: requestedPath,
      totalLines: lines.length,
      sizeBytes: stats.size,
      contentHash: md5(raw),
      content: preview,
      headLines: HEAD_LINES,
      tailLines: tailLines.length,
      warning: `Fichier volumineux (${lines.length} lignes, ${stats.size} octets). Début (${HEAD_LINES} lignes) et fin (${tailLines.length} lignes) affichés. Utilise startLine/endLine pour cibler une section, ou full:true pour tout lire.`,
      hint: "Pour modifier ce fichier : read_project_file({ path, full: true }) pour obtenir les numéros de ligne exacts, puis patch_project_file ou modify_project_file.",
    };
  }

  const maxLength = 200_000;
  const truncated = content.length > maxLength;

  // Numéros de ligne pour faciliter patch_project_file (full: true uniquement)
  const addLineNumbers = (args.full === true || args.forceFullContent === true) && !truncated && lines.length > 30;
  const formattedContent = addLineNumbers
    ? selectedLines.map((line, i) => `${(startLine + i).toString().padStart(4, " ")}| ${line}`).join("\n")
    : (truncated ? content.slice(0, maxLength) + "\n... [tronque]" : content);

  return {
    status: "success",
    path: requestedPath,
    totalLines: lines.length,
    startLine,
    endLine,
    content: formattedContent,
    lineNumbered: addLineNumbers,
    truncated,
    sizeBytes: stats.size,
    contentHash: md5(raw),
    hint: addLineNumbers
      ? "Les numéros de ligne sont inclus (format: '  42| code'). Utilise patch_project_file avec startLine/endLine pour modifier des plages précises."
      : undefined,
  };
}

export async function handleReadFileOutline(args: any) {
  if (!getProjectRoot()) {
    return { error: "Aucun workspace ouvert. Sélectionnez ou créez un projet d'abord." };
  }
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  const normalized = normalizeProjectPath(requestedPath);
  if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };
  const stats = await fs.promises.stat(normalized);
  if (!stats.isFile()) return { error: "Le chemin doit pointer vers un fichier." };
  const raw = await fs.promises.readFile(normalized, "utf-8");
  const lines = raw.split(/\r?\n/);
  const ext = path.extname(requestedPath).toLowerCase();

  const outline = extractFileOutline(lines, ext);

  return {
    status: "success",
    path: requestedPath,
    totalLines: lines.length,
    sizeBytes: stats.size,
    outline,
    hint: "Utilise ces numéros de ligne avec read_project_file(startLine, endLine) pour lire uniquement la section nécessaire.",
  };
}

export async function handleSearchInFiles(args: any) {
  if (!getProjectRoot()) {
    return { error: "Aucun workspace ouvert. Sélectionnez ou créez un projet d'abord." };
  }
  const query = String(args.query || "").trim();
  if (!query) return { error: "Le terme de recherche est requis." };
  const searchPath = String(args.path || ".").trim();
  const normalized = normalizeProjectPath(searchPath);
  if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };
  const extensions = args.extensions ? String(args.extensions).split(",").map((e: string) => e.trim().replace(/^\./, "")) : null;
  const caseSensitive = args.caseSensitive === true;
  const isRegex = args.regex === true;
  const maxResults = typeof args.maxResults === "number" ? Math.min(args.maxResults, 100) : 20;
  // Nombre de lignes de contexte à inclure avant/après chaque match
  const contextLines = typeof args.contextLines === "number" ? Math.min(Math.max(0, args.contextLines), 10) : 0;
  // Texte de remplacement pour prévisualiser les changements
  const replaceWith: string | null = typeof args.replaceWith === "string" ? args.replaceWith : null;

  const allFiles: string[] = [];

  const pathStats = await fs.promises.stat(normalized).catch(() => null);
  if (pathStats && pathStats.isFile()) {
    allFiles.push(searchPath);
  } else {
    await walkDirectory(normalized, searchPath === "." ? "." : searchPath, allFiles);
  }

  interface SearchResult {
    file: string;
    line: number;
    column: number;
    content: string;
    contextBefore?: string[];
    contextAfter?: string[];
    replacePreview?: string;
  }

  const results: SearchResult[] = [];

  let pattern: string;
  if (isRegex) {
    pattern = query;
  } else {
    pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch (e: any) {
    return { error: `Expression régulière invalide: ${e.message}. Utilisez regex: false ou échappez les caractères spéciaux.` };
  }

  for (const filePath of allFiles) {
    if (results.length >= maxResults) break;
    if (extensions) {
      const ext = path.extname(filePath).replace(/^\./, "");
      if (!extensions.includes(ext)) continue;
    }
    if (!TEXT_FILE_EXT.test(filePath)) continue;
    try {
      const absolutePath = path.join(getProjectRoot(), filePath);
      const s = await fs.promises.stat(absolutePath);
      if (s.size > MAX_PREVIEW_SIZE) continue;
      const content = await fs.promises.readFile(absolutePath, "utf-8");
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        regex.lastIndex = 0;
        const match = regex.exec(lines[i]);
        if (!match) continue;

        const result: SearchResult = {
          file: filePath,
          line: i + 1,
          column: match.index + 1,
          content: lines[i].trim(),
        };

        // Lignes de contexte avant/après
        if (contextLines > 0) {
          result.contextBefore = lines
            .slice(Math.max(0, i - contextLines), i)
            .map((l, idx) => `${i - contextLines + idx + 1}: ${l}`);
          result.contextAfter = lines
            .slice(i + 1, Math.min(lines.length, i + 1 + contextLines))
            .map((l, idx) => `${i + 2 + idx}: ${l}`);
        }

        // Prévisualisation du remplacement
        if (replaceWith !== null) {
          regex.lastIndex = 0;
          result.replacePreview = lines[i].replace(regex, replaceWith);
        }

        results.push(result);
      }
    } catch { /* skip unreadable files */ }
  }

  return {
    status: "success",
    query,
    replaceWith: replaceWith ?? undefined,
    count: results.length,
    results,
    hint: results.length === maxResults
      ? `Limite de ${maxResults} résultats atteinte. Affinez avec 'path', 'extensions' ou augmentez 'maxResults'.`
      : undefined,
  };
}

export async function handleAnalyzeProjectFile(args: any, toolContext: any) {
  if (!getProjectRoot()) {
    return { error: "Aucun workspace ouvert. Sélectionnez ou créez un projet d'abord." };
  }
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  const normalized = normalizeProjectPath(requestedPath);
  if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };
  const stats = await fs.promises.stat(normalized);
  if (!stats.isFile()) return { error: "Le chemin doit pointer vers un fichier." };
  const raw = await fs.promises.readFile(normalized, "utf-8");
  const lines = raw.split(/\r?\n/);
  const ext = path.extname(requestedPath).toLowerCase();
  toolContext.emitIdeAction?.({ type: "open-file", path: requestedPath });
  return {
    status: "success",
    path: requestedPath,
    extension: ext || "none",
    sizeBytes: stats.size,
    totalLines: lines.length,
    nonEmptyLines: lines.filter((l) => l.trim()).length,
    preview: lines.slice(0, 20).join("\n"),
  };
}

export async function handleGetWorkspaceInfo() {
  const root = getProjectRoot();
  if (!root) {
    return {
      status: "no_workspace",
      workspace: null,
      exists: false,
      detectedConfigFiles: [],
      message: "Aucun workspace ouvert. L'application est actuellement en mode sans projet.",
    };
  }
  const configFiles = ["package.json", "tsconfig.json", ".env", "vite.config.ts", "vite.config.js", "next.config.js", "README.md"];
  const detected: string[] = [];
  for (const f of configFiles) {
    if (fs.existsSync(path.join(root, f))) detected.push(f);
  }
  const wsCheck = checkWorkspace();
  return {
    status: "success",
    workspace: root,
    exists: wsCheck.exists,
    detectedConfigFiles: detected,
    message: wsCheck.message,
  };
}
