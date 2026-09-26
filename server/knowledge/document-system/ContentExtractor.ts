/**
 * ContentExtractor — Extraction de contenu depuis différents formats
 *
 * Supporte :
 *   • PDF (via pdf-parse)
 *   • Texte brut (.txt)
 *   • Markdown (.md)
 *   • HTML (nettoyage des balises)
 *   • URLs (via fetch + nettoyage)
 *
 * Fonctionnalités :
 *   • Extraction du texte brut
 *   • Détection de sections/titres
 *   • Extraction de métadonnées (auteur, pages, date)
 *   • Détection d'entités basique (noms, dates, URLs, emails)
 *   • Détection de langue (FR/EN)
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../../utils/logger.js";
import type {
  ExtractionResult,
  ExtractionOptions,
  DocumentSection,
  DocumentEntity,
  DocumentMetadata,
  DocumentType,
} from "./types.js";

const log = createLogger("ContentExtractor");

// ═══════════════════════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_CHARS = 200_000;
const SECTION_ID_PREFIX = "sec_";

// ═══════════════════════════════════════════════════════════════════════════════
// ContentExtractor
// ═══════════════════════════════════════════════════════════════════════════════

export class ContentExtractor {

  /**
   * Extrait le contenu d'un fichier selon son type.
   */
  async extract(
    filePath: string,
    mimeType: string,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const start = Date.now();
    const maxChars = options.maxChars || DEFAULT_MAX_CHARS;

    try {
      const docType = this.detectType(filePath, mimeType);
      let text = "";
      let metadata: DocumentMetadata = {};
      let sections: DocumentSection[] = [];

      switch (docType) {
        case "pdf":
          ({ text, metadata } = await this.extractPDF(filePath));
          break;
        case "markdown":
          ({ text, sections } = this.extractMarkdown(filePath));
          break;
        case "txt":
          text = this.extractText(filePath);
          break;
        case "html":
          text = this.extractHTML(filePath);
          break;
        default:
          text = this.extractText(filePath);
      }

      // Tronquer si nécessaire
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
      }

      // Détecter les sections si demandé et pas déjà fait
      if (options.detectSections !== false && sections.length === 0) {
        sections = this.detectSections(text);
      }

      // Calculer métadonnées de base
      metadata.wordCount = text.split(/\s+/).filter(Boolean).length;
      metadata.charCount = text.length;

      // Détecter les entités si demandé
      let entities: DocumentEntity[] = [];
      if (options.extractEntities) {
        entities = this.extractEntities(text, "");
      }

      // Détecter la langue
      const language = this.detectLanguage(text);

      return {
        success: true,
        text,
        sections,
        metadata,
        entities,
        language,
        durationMs: Date.now() - start,
      };
    } catch (error: any) {
      log.error(`Erreur extraction ${filePath}:`, error.message);
      return {
        success: false,
        text: "",
        sections: [],
        metadata: {},
        entities: [],
        language: "other",
        error: error.message,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Extrait le contenu d'un Buffer (pour les uploads multer).
   */
  async extractFromBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const start = Date.now();
    const maxChars = options.maxChars || DEFAULT_MAX_CHARS;

    try {
      const docType = this.detectType(fileName, mimeType);
      let text = "";
      let metadata: DocumentMetadata = {};
      let sections: DocumentSection[] = [];

      switch (docType) {
        case "pdf":
          ({ text, metadata } = await this.extractPDFFromBuffer(buffer));
          break;
        case "markdown":
          text = buffer.toString("utf-8");
          sections = this.detectMarkdownSections(text);
          break;
        case "html":
          text = this.stripHTML(buffer.toString("utf-8"));
          break;
        default:
          text = buffer.toString("utf-8");
      }

      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
      }

      if (options.detectSections !== false && sections.length === 0) {
        sections = this.detectSections(text);
      }

      metadata.wordCount = text.split(/\s+/).filter(Boolean).length;
      metadata.charCount = text.length;

      let entities: DocumentEntity[] = [];
      if (options.extractEntities) {
        entities = this.extractEntities(text, "");
      }

      const language = this.detectLanguage(text);

      return {
        success: true,
        text,
        sections,
        metadata,
        entities,
        language,
        durationMs: Date.now() - start,
      };
    } catch (error: any) {
      log.error(`Erreur extraction buffer ${fileName}:`, error.message);
      return {
        success: false,
        text: "",
        sections: [],
        metadata: {},
        entities: [],
        language: "other",
        error: error.message,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Extrait du texte brut depuis une URL.
   */
  async extractFromURL(url: string, options: ExtractionOptions = {}): Promise<ExtractionResult> {
    const start = Date.now();
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const contentType = response.headers.get("content-type") || "";
      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = new URL(url).pathname.split("/").pop() || "page.html";

      const result = await this.extractFromBuffer(buffer, fileName, contentType, options);
      result.durationMs = Date.now() - start;
      return result;
    } catch (error: any) {
      log.error(`Erreur extraction URL ${url}:`, error.message);
      return {
        success: false,
        text: "",
        sections: [],
        metadata: {},
        entities: [],
        language: "other",
        error: error.message,
        durationMs: Date.now() - start,
      };
    }
  }

  // ─── Extracteurs spécifiques ──────────────────────────────────────────────

  private async extractPDF(filePath: string): Promise<{ text: string; metadata: DocumentMetadata }> {
    const { PDFParse } = await import("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const pdfData = await parser.getText();
    await parser.destroy();

    return {
      text: pdfData.text || "",
      metadata: {
        pageCount: pdfData.total || undefined,
      },
    };
  }

  private async extractPDFFromBuffer(buffer: Buffer): Promise<{ text: string; metadata: DocumentMetadata }> {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const pdfData = await parser.getText();
    await parser.destroy();

    return {
      text: pdfData.text || "",
      metadata: {
        pageCount: pdfData.total || undefined,
      },
    };
  }

  private extractMarkdown(filePath: string): { text: string; sections: DocumentSection[] } {
    const raw = fs.readFileSync(filePath, "utf-8");
    const sections = this.detectMarkdownSections(raw);
    // Retirer la syntaxe markdown pour le texte brut
    const text = raw
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/^[-*+]\s+/gm, "• ")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/^>\s+/gm, "");

    return { text, sections };
  }

  private extractText(filePath: string): string {
    return fs.readFileSync(filePath, "utf-8");
  }

  private extractHTML(filePath: string): string {
    const raw = fs.readFileSync(filePath, "utf-8");
    return this.stripHTML(raw);
  }

  private stripHTML(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  // ─── Détection de sections ────────────────────────────────────────────────

  private detectMarkdownSections(text: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = text.split("\n");
    let currentSection: Partial<DocumentSection> | null = null;
    let offset = 0;
    let sectionIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);

      if (headerMatch) {
        // Fermer la section précédente
        if (currentSection && currentSection.content !== undefined) {
          currentSection.endOffset = offset - 1;
          sections.push(currentSection as DocumentSection);
        }

        sectionIdx++;
        currentSection = {
          id: `${SECTION_ID_PREFIX}${sectionIdx}`,
          title: headerMatch[2].trim(),
          level: headerMatch[1].length,
          startOffset: offset,
          endOffset: offset,
          content: "",
        };
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }

      offset += line.length + 1;
    }

    // Fermer la dernière section
    if (currentSection && currentSection.content !== undefined) {
      currentSection.endOffset = offset;
      sections.push(currentSection as DocumentSection);
    }

    return sections;
  }

  private detectSections(text: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = text.split("\n");
    let currentContent = "";
    let sectionStart = 0;
    let sectionIdx = 0;

    // Heuristique : une ligne courte suivie d'une ligne vide ou de contenu = titre
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isTitle =
        line.length > 0 &&
        line.length < 100 &&
        (line === line.toUpperCase() || // TOUT EN MAJUSCULES
          /^\d+[\.\)]\s+/.test(line) || // 1. Titre ou 1) Titre
          /^[IVX]+[\.\)]\s+/.test(line) || // I. Titre romain
          (i < lines.length - 1 && lines[i + 1].trim() === "")); // Suivi d'une ligne vide

      if (isTitle && currentContent.trim().length > 50) {
        sectionIdx++;
        sections.push({
          id: `${SECTION_ID_PREFIX}${sectionIdx}`,
          title: line,
          level: 1,
          content: currentContent.trim(),
          startOffset: sectionStart,
          endOffset: sectionStart + currentContent.length,
        });
        currentContent = "";
        sectionStart = i;
      } else {
        currentContent += line + "\n";
      }
    }

    // Dernière section
    if (currentContent.trim().length > 20) {
      sectionIdx++;
      sections.push({
        id: `${SECTION_ID_PREFIX}${sectionIdx}`,
        content: currentContent.trim(),
        level: 1,
        startOffset: sectionStart,
        endOffset: sectionStart + currentContent.length,
      });
    }

    return sections;
  }

  // ─── Extraction d'entités basique ─────────────────────────────────────────

  extractEntities(text: string, documentId: string): DocumentEntity[] {
    const entities: DocumentEntity[] = [];

    // URLs
    const urlRegex = /https?:\/\/[^\s<>"']+/g;
    const urls = text.match(urlRegex) || [];
    for (const url of [...new Set(urls)].slice(0, 20)) {
      entities.push({
        name: url,
        type: "url",
        context: this.getContext(text, url),
        occurrences: (text.match(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
        importance: 0.3,
        documentId,
      });
    }

    // Emails
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
    const emails = text.match(emailRegex) || [];
    for (const email of [...new Set(emails)].slice(0, 10)) {
      entities.push({
        name: email,
        type: "email",
        context: this.getContext(text, email),
        occurrences: (text.match(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
        importance: 0.5,
        documentId,
      });
    }

    // Dates (formats courants FR et EN)
    const dateRegex = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g;
    const dates = text.match(dateRegex) || [];
    for (const date of [...new Set(dates)].slice(0, 15)) {
      entities.push({
        name: date,
        type: "date",
        context: this.getContext(text, date),
        occurrences: 1,
        importance: 0.4,
        documentId,
      });
    }

    // Montants
    const amountRegex = /\b\d+[\s.,]?\d*\s*[€$£]\b|\b[€$£]\s*\d+[\s.,]?\d*/g;
    const amounts = text.match(amountRegex) || [];
    for (const amount of [...new Set(amounts)].slice(0, 10)) {
      entities.push({
        name: amount.trim(),
        type: "amount",
        context: this.getContext(text, amount),
        occurrences: 1,
        importance: 0.6,
        documentId,
      });
    }

    // Acronymes (2+ lettres majuscules)
    const acronymRegex = /\b[A-Z]{2,8}\b/g;
    const acronyms = text.match(acronymRegex) || [];
    const acronymCounts = new Map<string, number>();
    for (const a of acronyms) {
      acronymCounts.set(a, (acronymCounts.get(a) || 0) + 1);
    }
    for (const [acronym, count] of [...acronymCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      if (count >= 2) {
        entities.push({
          name: acronym,
          type: "acronym",
          context: this.getContext(text, acronym),
          occurrences: count,
          importance: Math.min(0.3 + count * 0.05, 0.8),
          documentId,
        });
      }
    }

    return entities;
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  /** Détecte le type de document à partir du nom et du MIME type */
  detectType(fileName: string, mimeType: string): DocumentType {
    const ext = path.extname(fileName).toLowerCase();

    if (mimeType.includes("pdf") || ext === ".pdf") return "pdf";
    if (mimeType.includes("word") || ext === ".docx" || ext === ".doc") return "docx";
    if (ext === ".md" || ext === ".markdown") return "markdown";
    if (mimeType.includes("html") || ext === ".html" || ext === ".htm") return "html";
    if (mimeType.includes("text") || ext === ".txt") return "txt";
    if (mimeType.includes("image") || [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
    if (mimeType.includes("spreadsheet") || [".xlsx", ".xls", ".csv"].includes(ext)) return "spreadsheet";
    if (mimeType.includes("presentation") || [".pptx", ".ppt"].includes(ext)) return "presentation";

    return "other";
  }

  /** Détecte la langue du texte (heuristique simple FR/EN) */
  private detectLanguage(text: string): "fr" | "en" | "other" {
    const sample = text.slice(0, 5000).toLowerCase();

    const frWords = ["le", "la", "les", "de", "du", "des", "un", "une", "est", "sont",
      "dans", "pour", "avec", "sur", "qui", "que", "pas", "plus", "cette", "ces"];
    const enWords = ["the", "is", "are", "was", "were", "of", "in", "to", "and", "for",
      "with", "on", "at", "by", "from", "this", "that", "have", "has", "been"];

    let frScore = 0;
    let enScore = 0;

    for (const word of frWords) {
      const regex = new RegExp(`\\b${word}\\b`, "g");
      frScore += (sample.match(regex) || []).length;
    }
    for (const word of enWords) {
      const regex = new RegExp(`\\b${word}\\b`, "g");
      enScore += (sample.match(regex) || []).length;
    }

    if (frScore > enScore * 1.2) return "fr";
    if (enScore > frScore * 1.2) return "en";
    return frScore > 5 || enScore > 5 ? (frScore > enScore ? "fr" : "en") : "other";
  }

  /** Récupère le contexte autour d'un terme trouvé */
  private getContext(text: string, term: string): string {
    const idx = text.indexOf(term);
    if (idx === -1) return "";
    const start = Math.max(0, idx - 80);
    const end = Math.min(text.length, idx + term.length + 80);
    return text.slice(start, end).replace(/\n/g, " ").trim();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

export const contentExtractor = new ContentExtractor();
