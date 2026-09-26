/**
 * WorkspaceIndexer — Extraction automatique des documents du workspace
 *
 * Scanne le workspace pour trouver tous les fichiers documentaires
 * (.md, .txt, .rst, .adoc, .tex, .log, .csv) et les indexe automatiquement
 * dans le DocumentStore. Fonctionne au démarrage et en mode incrémental
 * via le FileWatcher.
 *
 * Architecture :
 *   WorkspaceIndexer.extractAll()
 *     ├── walkDirectory() → liste les fichiers documents
 *     ├── extractDocument() → parse chaque fichier
 *     └── documentStore.addDocument() → stocke dans le store
 *
 *   WorkspaceIndexer.extractFile(relativePath)
 *     └── parseDocument() → documentStore.addOrUpdate()
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../utils/logger.js";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { getDocumentStore } from "./DocumentStore.js";
import { isSandboxActive, getSandboxRoot } from "../utils/sandbox.js";
import { fileWatcher } from "./FileWatcher.js";
import type { FileChangeEvent } from "./FileWatcher.js";
import { broadcastKnowledgeProgress } from "../utils/knowledgeBroadcaster.js";

const log = createLogger("WorkspaceIndexer");

// ─── Configuration ──────────────────────────────────────────────────────────

/** Extensions de documents reconnus */
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".md",
  ".txt",
  ".rst",
  ".adoc",
  ".tex",
  ".log",
  ".csv",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
]);

/** Répertoires exclus du scan documentaire */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "release",
  "coverage",
  ".vscode",
  ".idea",
  ".Leanna",
  ".husky",
]);

/** Fichiers exclus */
const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
  ".env",
  ".env.local",
  ".env.example",
  ".gemini-keys.json",
  ".project-knowledge.json",
  ".project-memory.json",
  "documents.json",
]);

/** Taille max d'un document (1 MB) */
const MAX_DOC_SIZE = 1_000_000;

/** Nombre max de documents à indexer */
const MAX_DOCUMENTS = 200;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedDocument {
  relativePath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  title: string;
  summary: string;
  sections: DocumentSection[];
  content: string;
  metadata: DocumentMetadata;
  size: number;
  lastModified: string;
}

export interface DocumentSection {
  level: number;
  title: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

export interface DocumentMetadata {
  wordCount: number;
  lineCount: number;
  language: string;
  hasTableOfContents: boolean;
  headingCount: number;
  linkCount: number;
  codeBlockCount: number;
  listCount: number;
  tableCount: number;
}

export interface ExtractionStats {
  totalFiles: number;
  totalExtracted: number;
  totalSections: number;
  totalWords: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WorkspaceIndexer
// ═══════════════════════════════════════════════════════════════════════════════

export class WorkspaceIndexer {
  private extractedPaths: Set<string> = new Set();

  /**
   * Retourne la racine du workspace actif.
   */
  private getRoot(): string {
    if (isSandboxActive()) return getSandboxRoot();
    return SELF_ROOT;
  }

  // ─── Extraction complète ──────────────────────────────────────────────────

  /**
   * Scanne le workspace et extrait tous les documents.
   * À appeler au démarrage après le scan du ProjectIndexer.
   */
  async extractAll(): Promise<ExtractionStats> {
    const startTime = Date.now();
    const root = this.getRoot();

    if (!root) {
      log.warn("Aucun workspace actif — extraction documentaire différée.");
      return { totalFiles: 0, totalExtracted: 0, totalSections: 0, totalWords: 0, skipped: 0, errors: 0, durationMs: 0 };
    }

    log.info(`📄 Extraction documentaire du workspace: ${root}`);

    // 1. Lister les fichiers documents
    const files: string[] = [];
    await this.walkDirectory(root, files, root);
    log.info(`📋 ${files.length} document(s) trouvé(s)`);

    // 2. Extraire chaque document
    const store = getDocumentStore(root);
    let totalExtracted = 0;
    let totalSections = 0;
    let totalWords = 0;
    let skipped = 0;
    let errors = 0;

    for (const relativePath of files.slice(0, MAX_DOCUMENTS)) {
      try {
        const doc = await this.extractDocument(relativePath, root);
        if (doc) {
          // Ajouter ou mettre à jour dans le store
          this.upsertDocument(store, doc);
          this.extractedPaths.add(relativePath);
          totalExtracted++;
          totalSections += doc.sections.length;
          totalWords += doc.metadata.wordCount;
        } else {
          skipped++;
        }
      } catch (err) {
        log.debug(`⚠️ Erreur extraction: ${relativePath} — ${(err as Error).message}`);
        errors++;
      }
    }

    store.save();

    const durationMs = Date.now() - startTime;
    log.info(`✅ Extraction terminée: ${totalExtracted} documents, ${totalSections} sections, ${totalWords} mots (${(durationMs / 1000).toFixed(1)}s)`);

    return { totalFiles: files.length, totalExtracted, totalSections, totalWords, skipped, errors, durationMs };
  }

  /**
   * Extrait un seul fichier document (appel incrémental).
   */
  async extractFile(relativePath: string): Promise<ExtractedDocument | null> {
    const root = this.getRoot();
    if (!root) return null;

    try {
      const doc = await this.extractDocument(relativePath, root);
      if (doc) {
        const store = getDocumentStore(root);
        this.upsertDocument(store, doc);
        store.save();
        this.extractedPaths.add(relativePath);
        log.info(`📝 Document extrait: ${relativePath} (${doc.metadata.wordCount} mots, ${doc.sections.length} sections)`);
      }
      return doc;
    } catch (err) {
      log.warn(`⚠️ Erreur extraction fichier: ${relativePath} — ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Supprime un document du store (quand le fichier est supprimé).
   */
  removeDocument(relativePath: string): void {
    const root = this.getRoot();
    if (!root) return;

    const store = getDocumentStore(root);
    const existing = store.getAllDocuments().find(d => d.fileName === relativePath);
    if (existing) {
      store.removeDocument(existing.id);
      store.save();
      this.extractedPaths.delete(relativePath);
      log.info(`🗑️ Document retiré: ${relativePath}`);
    }
  }

  // ─── Parsing d'un document ────────────────────────────────────────────────

  /**
   * Parse un fichier document et retourne sa structure extraite.
   */
  private async extractDocument(relativePath: string, root: string): Promise<ExtractedDocument | null> {
    const absolutePath = path.join(root, relativePath);

    if (!fs.existsSync(absolutePath)) return null;

    const stats = fs.statSync(absolutePath);
    if (!stats.isFile() || stats.size > MAX_DOC_SIZE || stats.size === 0) return null;

    const ext = path.extname(relativePath).toLowerCase();

    let content: string;
    try {
      if (ext === ".pdf") {
        content = await this.extractPdfText(fs.readFileSync(absolutePath));
      } else {
        content = fs.readFileSync(absolutePath, "utf-8");
        if (this.isBinaryContent(content)) return null;
      }
    } catch {
      return null; // Fichier binaire ou illisible
    }

    const fileName = relativePath;
    const lines = content.split(/\r?\n/);

    // Extraire les sections selon le format
    const sections = this.extractSections(lines, ext);

    // Extraire le titre
    const title = this.extractTitle(lines, ext, relativePath);

    // Générer un résumé automatique
    const summary = this.generateSummary(content, sections, title);

    // Calculer les métadonnées
    const metadata = this.computeMetadata(content, lines, ext);

    return {
      relativePath,
      fileName,
      extension: ext,
      mimeType: this.getMimeType(ext),
      title,
      summary,
      sections,
      content: content.slice(0, 30_000), // Limiter à 30k chars
      metadata,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    };
  }

  // ─── Extraction de sections ───────────────────────────────────────────────

  private extractSections(lines: string[], ext: string): DocumentSection[] {
    switch (ext) {
      case ".md":
        return this.extractMarkdownSections(lines);
      case ".rst":
        return this.extractRstSections(lines);
      case ".tex":
        return this.extractTexSections(lines);
      case ".adoc":
        return this.extractAsciidocSections(lines);
      default:
        return this.extractPlainTextSections(lines);
    }
  }

  private extractMarkdownSections(lines: string[]): DocumentSection[] {
    const sections: DocumentSection[] = [];
    let currentSection: DocumentSection | null = null;

    for (let i = 0; i < lines.length; i++) {
      const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        // Fermer la section précédente
        if (currentSection) {
          currentSection.lineEnd = i - 1;
          currentSection.content = lines.slice(currentSection.lineStart, i).join("\n").trim();
          sections.push(currentSection);
        }
        currentSection = {
          level: headingMatch[1].length,
          title: headingMatch[2].trim(),
          lineStart: i,
          lineEnd: i,
          content: "",
        };
      }
    }

    // Fermer la dernière section
    if (currentSection) {
      currentSection.lineEnd = lines.length - 1;
      currentSection.content = lines.slice(currentSection.lineStart).join("\n").trim();
      sections.push(currentSection);
    }

    // Si aucune section trouvée, créer une section unique
    if (sections.length === 0 && lines.length > 0) {
      sections.push({
        level: 1,
        title: "(contenu)",
        lineStart: 0,
        lineEnd: lines.length - 1,
        content: lines.join("\n").trim().slice(0, 5000),
      });
    }

    return sections;
  }

  private extractRstSections(lines: string[]): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const underlineChars = new Set(["=", "-", "~", "^", '"']);

    for (let i = 0; i < lines.length - 1; i++) {
      const nextLine = lines[i + 1];
      if (nextLine && nextLine.length >= 3 && underlineChars.has(nextLine[0]) && nextLine === nextLine[0].repeat(nextLine.length)) {
        const level = nextLine[0] === "=" ? 1 : nextLine[0] === "-" ? 2 : 3;
        sections.push({
          level,
          title: lines[i].trim(),
          lineStart: i,
          lineEnd: i + 1,
          content: "",
        });
      }
    }

    // Remplir le contenu entre sections
    for (let i = 0; i < sections.length; i++) {
      const start = sections[i].lineStart;
      const end = i < sections.length - 1 ? sections[i + 1].lineStart - 1 : lines.length - 1;
      sections[i].lineEnd = end;
      sections[i].content = lines.slice(start, end + 1).join("\n").trim().slice(0, 5000);
    }

    return sections;
  }

  private extractTexSections(lines: string[]): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const sectionCommands = [
      { pattern: /\\chapter\{(.+?)\}/, level: 1 },
      { pattern: /\\section\{(.+?)\}/, level: 2 },
      { pattern: /\\subsection\{(.+?)\}/, level: 3 },
      { pattern: /\\subsubsection\{(.+?)\}/, level: 4 },
    ];

    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, level } of sectionCommands) {
        const match = lines[i].match(pattern);
        if (match) {
          sections.push({
            level,
            title: match[1],
            lineStart: i,
            lineEnd: i,
            content: "",
          });
          break;
        }
      }
    }

    // Remplir le contenu
    for (let i = 0; i < sections.length; i++) {
      const end = i < sections.length - 1 ? sections[i + 1].lineStart - 1 : lines.length - 1;
      sections[i].lineEnd = end;
      sections[i].content = lines.slice(sections[i].lineStart, end + 1).join("\n").trim().slice(0, 5000);
    }

    return sections;
  }

  private extractAsciidocSections(lines: string[]): DocumentSection[] {
    const sections: DocumentSection[] = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(={1,5})\s+(.+)/);
      if (match) {
        sections.push({
          level: match[1].length,
          title: match[2].trim(),
          lineStart: i,
          lineEnd: i,
          content: "",
        });
      }
    }

    for (let i = 0; i < sections.length; i++) {
      const end = i < sections.length - 1 ? sections[i + 1].lineStart - 1 : lines.length - 1;
      sections[i].lineEnd = end;
      sections[i].content = lines.slice(sections[i].lineStart, end + 1).join("\n").trim().slice(0, 5000);
    }

    return sections;
  }

  private extractPlainTextSections(lines: string[]): DocumentSection[] {
    // Pour le texte brut, découper par paragraphes (lignes vides)
    const sections: DocumentSection[] = [];
    let currentStart = 0;
    let paraIndex = 0;

    for (let i = 0; i <= lines.length; i++) {
      if (i === lines.length || (lines[i].trim() === "" && i - currentStart > 2)) {
        if (i > currentStart) {
          const content = lines.slice(currentStart, i).join("\n").trim();
          if (content.length > 20) {
            paraIndex++;
            sections.push({
              level: 1,
              title: content.split("\n")[0].slice(0, 80) || `Paragraphe ${paraIndex}`,
              lineStart: currentStart,
              lineEnd: i - 1,
              content: content.slice(0, 5000),
            });
          }
        }
        currentStart = i + 1;
      }
    }

    return sections;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private extractTitle(lines: string[], ext: string, relativePath: string): string {
    if (ext === ".md") {
      // Chercher le premier H1
      for (const line of lines.slice(0, 10)) {
        const match = line.match(/^#\s+(.+)/);
        if (match) return match[1].trim();
      }
    }

    if (ext === ".tex") {
      for (const line of lines.slice(0, 30)) {
        const match = line.match(/\\title\{(.+?)\}/);
        if (match) return match[1];
      }
    }

    if (ext === ".rst" || ext === ".adoc") {
      if (lines.length > 1 && lines[1] && /^[=\-~]+$/.test(lines[1])) {
        return lines[0].trim();
      }
    }

    // Fallback : nom du fichier
    return path.basename(relativePath, ext);
  }

  private generateSummary(content: string, sections: DocumentSection[], title: string): string {
    const lines: string[] = [];
    lines.push(`Document "${title}".`);

    if (sections.length > 0) {
      lines.push(`Structure : ${sections.length} section(s).`);
      const topSections = sections.filter(s => s.level <= 2).slice(0, 8);
      if (topSections.length > 0) {
        lines.push(`Sections principales : ${topSections.map(s => s.title).join(", ")}.`);
      }
    }

    // Prendre les 3 premières phrases significatives du contenu
    const sentences = content
      .replace(/```[\s\S]*?```/g, "") // Supprimer les blocs de code
      .replace(/\|[^\n]+\|/g, "")    // Supprimer les tables
      .split(/[.!?]\s+/)
      .filter(s => s.trim().length > 20 && !s.startsWith("#") && !s.startsWith("-"))
      .slice(0, 3)
      .map(s => s.trim().slice(0, 150));

    if (sentences.length > 0) {
      lines.push(sentences.join(". ") + ".");
    }

    return lines.join(" ").slice(0, 800);
  }

  private computeMetadata(content: string, lines: string[], ext: string): DocumentMetadata {
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const headings = ext === ".md"
      ? lines.filter(l => /^#{1,6}\s/.test(l)).length
      : 0;
    const links = (content.match(/\[.+?\]\(.+?\)/g) || []).length + (content.match(/https?:\/\/\S+/g) || []).length;
    const codeBlocks = (content.match(/```/g) || []).length / 2;
    const lists = lines.filter(l => /^\s*[-*+]\s|^\s*\d+\.\s/.test(l)).length;
    const tables = lines.filter(l => /^\|.+\|$/.test(l.trim())).length > 0 ? 1 : 0;
    const hasToc = /\[toc\]|table\s+(?:des\s+)?(?:matières|contents)/i.test(content);

    // Détection de langue simple
    const frenchWords = ["le", "la", "les", "de", "du", "des", "un", "une", "est", "sont", "dans", "pour"];
    const frenchCount = frenchWords.filter(w => content.toLowerCase().includes(` ${w} `)).length;
    const language = frenchCount >= 4 ? "fr" : "en";

    return {
      wordCount: words.length,
      lineCount: lines.length,
      language,
      hasTableOfContents: hasToc,
      headingCount: headings,
      linkCount: links,
      codeBlockCount: Math.floor(codeBlocks),
      listCount: lists,
      tableCount: tables,
    };
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    return typeof pdfData?.text === "string" ? pdfData.text : "";
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".rst": "text/x-rst",
      ".adoc": "text/asciidoc",
      ".tex": "text/x-tex",
      ".log": "text/plain",
      ".csv": "text/csv",
      ".yaml": "text/yaml",
      ".yml": "text/yaml",
      ".toml": "text/toml",
      ".ini": "text/ini",
      ".cfg": "text/plain",
    };
    return mimeTypes[ext] || "text/plain";
  }

  private isBinaryContent(content: string): boolean {
    // Vérifier la présence de caractères nuls (indicateur de binaire)
    const sample = content.slice(0, 1000);
    return sample.includes("\0");
  }

  /**
   * Ajoute ou met à jour un document dans le store.
   */
  private upsertDocument(store: ReturnType<typeof getDocumentStore>, doc: ExtractedDocument): void {
    // Chercher si le document existe déjà (par chemin)
    const existing = store.getAllDocuments().find(d => d.fileName === doc.relativePath);
    if (existing) {
      store.removeDocument(existing.id);
    }

    store.addDocument({
      fileName: doc.relativePath,
      mimeType: doc.mimeType,
      summary: doc.summary,
      extractedText: doc.content,
      originalTextLength: doc.size,
      uploadedAt: doc.lastModified,
      tags: [
        doc.extension.replace(".", ""),
        doc.metadata.language,
        ...doc.sections.slice(0, 5).map(s => s.title.toLowerCase().slice(0, 30)),
      ].filter(Boolean),
    });
  }

  // ─── Walk directory ───────────────────────────────────────────────────────

  private async walkDirectory(dir: string, files: string[], baseRoot: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseRoot, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, files, baseRoot);
      } else if (entry.isFile()) {
        if (EXCLUDED_FILES.has(entry.name)) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!DOCUMENT_EXTENSIONS.has(ext)) continue;

        files.push(relativePath);
      }
    }
  }

  // ─── File Watcher Integration ─────────────────────────────────────────────

  /**
   * Démarre la surveillance des documents pour extraction incrémentale.
   * À appeler après extractAll().
   */
  startWatching(): void {
    fileWatcher.onChange(async (events: FileChangeEvent[]) => {
      await this.handleFileChanges(events);
    });
    log.info("👁️ Extraction documentaire incrémentale activée");
  }

  /**
   * Gère les changements de fichiers documents.
   * Broadcast un événement knowledge_progress phase=done après chaque traitement
   * pour permettre aux composants UI de se rafraîchir automatiquement.
   */
  private async handleFileChanges(events: FileChangeEvent[]): Promise<void> {
    let processed = 0;
    const relevant = events.filter(e =>
      DOCUMENT_EXTENSIONS.has(path.extname(e.relativePath).toLowerCase())
    );
    if (relevant.length === 0) return;

    for (const event of relevant) {
      if (event.type === "deleted") {
        this.removeDocument(event.relativePath);
      } else {
        // created ou modified
        await this.extractFile(event.relativePath);
      }
      processed++;
    }

    // Notifier les clients UI que le store documentaire a été mis à jour
    broadcastKnowledgeProgress("done", processed, processed, {
      totalEntities: this.extractedPaths.size,
    });
  }

  // ─── API publique ─────────────────────────────────────────────────────────

  /**
   * Retourne la liste des documents actuellement extraits.
   */
  getExtractedPaths(): string[] {
    return [...this.extractedPaths];
  }

  /**
   * Retourne les statistiques rapides.
   */
  getStats(): { extracted: number; watching: boolean } {
    return {
      extracted: this.extractedPaths.size,
      watching: fileWatcher.running,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const workspaceIndexer = new WorkspaceIndexer();
