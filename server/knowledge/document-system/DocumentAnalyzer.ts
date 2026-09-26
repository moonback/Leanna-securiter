/**
 * DocumentAnalyzer — Analyse intelligente des documents via LLM
 *
 * Utilise l'IA pour :
 *   • Générer des résumés de documents
 *   • Extraire des faits/connaissances structurés
 *   • Détecter les relations inter-documents
 *   • Répondre à des questions sur les documents
 *   • Créer des synthèses multi-documents
 *
 * S'appuie sur Google Gemini (comme le reste de Leanna).
 */

import { createLogger } from "../../utils/logger.js";
import { documentMemory } from "./DocumentMemory.js";
import { contentExtractor } from "./ContentExtractor.js";
import { documentSearchEngine } from "./DocumentSearchEngine.js";
import type {
  KnowledgeDocument,
  DocumentRelation,
  DocumentRelationType,
  MemoryCategory,
  MemoryFact,
  ExtractionOptions,
  DocumentContext,
} from "./types.js";

const log = createLogger("DocumentAnalyzer");

// ═══════════════════════════════════════════════════════════════════════════════
// Types internes
// ═══════════════════════════════════════════════════════════════════════════════

interface AnalysisResult {
  summary: string;
  facts: Array<{
    content: string;
    category: MemoryCategory;
    importance: number;
    relatedConcepts: string[];
  }>;
  keywords: string[];
  suggestedTags: string[];
  suggestedRelations: Array<{
    targetDocId: string;
    type: DocumentRelationType;
    description: string;
    confidence: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DocumentAnalyzer
// ═══════════════════════════════════════════════════════════════════════════════

export class DocumentAnalyzer {

  /**
   * Pipeline complet : extraction + analyse + stockage.
   * Utilisé lors de l'upload d'un nouveau document.
   */
  async ingestDocument(
    filePath: string,
    fileName: string,
    mimeType: string,
    options: {
      collection?: string;
      tags?: string[];
      extractionOptions?: ExtractionOptions;
      generateSummary?: boolean;
      extractFacts?: boolean;
      detectRelations?: boolean;
    } = {}
  ): Promise<KnowledgeDocument> {
    log.info(`Ingestion document: ${fileName}`);

    // 1. Extraction du contenu
    const extraction = await contentExtractor.extract(filePath, mimeType, {
      extractEntities: true,
      detectSections: true,
      ...options.extractionOptions,
    });

    if (!extraction.success) {
      throw new Error(`Échec extraction: ${extraction.error}`);
    }

    // 2. Générer un résumé de base (sans LLM pour l'instant — sera enrichi par le skill)
    const summary = options.generateSummary !== false
      ? this.generateBasicSummary(extraction.text, extraction.sections)
      : "";

    // 3. Extraire les mots-clés
    const keywords = this.extractKeywords(extraction.text, extraction.entities.map((e) => e.name));

    // 4. Créer le document dans le store
    const document = documentMemory.addDocument({
      title: fileName.replace(/\.[^.]+$/, ""),
      source: filePath,
      type: contentExtractor.detectType(fileName, mimeType),
      mimeType,
      fileSize: extraction.metadata.charCount || extraction.text.length,
      extractedText: extraction.text,
      summary,
      sections: extraction.sections,
      entities: extraction.entities,
      keywords,
      tags: options.tags || [],
      language: extraction.language,
      metadata: extraction.metadata,
      collection: options.collection,
    });

    // 5. Extraire des faits basiques
    if (options.extractFacts !== false) {
      const facts = this.extractBasicFacts(document);
      for (const fact of facts) {
        documentMemory.addFact(fact);
      }
      log.info(`${facts.length} faits extraits pour "${fileName}"`);
    }

    // 6. Détecter des relations avec les documents existants
    if (options.detectRelations !== false) {
      const relations = this.detectBasicRelations(document);
      for (const rel of relations) {
        try {
          documentMemory.addRelation(rel);
        } catch (e) {
          // Ignorer si le document cible n'existe plus
        }
      }
      log.info(`${relations.length} relations détectées pour "${fileName}"`);
    }

    log.info(`Document ingéré avec succès: ${document.id}`);
    return document;
  }

  /**
   * Pipeline d'ingestion depuis un Buffer (uploads multer).
   */
  async ingestFromBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    options: {
      collection?: string;
      tags?: string[];
      extractionOptions?: ExtractionOptions;
    } = {}
  ): Promise<KnowledgeDocument> {
    log.info(`Ingestion buffer: ${fileName}`);

    const extraction = await contentExtractor.extractFromBuffer(buffer, fileName, mimeType, {
      extractEntities: true,
      detectSections: true,
      ...options.extractionOptions,
    });

    if (!extraction.success) {
      throw new Error(`Échec extraction: ${extraction.error}`);
    }

    const keywords = this.extractKeywords(extraction.text, extraction.entities.map((e) => e.name));
    const summary = this.generateBasicSummary(extraction.text, extraction.sections);

    const document = documentMemory.addDocument({
      title: fileName.replace(/\.[^.]+$/, ""),
      source: `upload://${fileName}`,
      type: contentExtractor.detectType(fileName, mimeType),
      mimeType,
      fileSize: buffer.length,
      extractedText: extraction.text,
      summary,
      sections: extraction.sections,
      entities: extraction.entities,
      keywords,
      tags: options.tags || [],
      language: extraction.language,
      metadata: extraction.metadata,
      collection: options.collection,
    });

    // Extraire les faits
    const facts = this.extractBasicFacts(document);
    for (const fact of facts) {
      documentMemory.addFact(fact);
    }

    // Détecter les relations
    const relations = this.detectBasicRelations(document);
    for (const rel of relations) {
      try { documentMemory.addRelation(rel); } catch (e) { /* ignore */ }
    }

    return document;
  }

  /**
   * Pipeline d'ingestion depuis une URL.
   */
  async ingestFromURL(
    url: string,
    options: { collection?: string; tags?: string[] } = {}
  ): Promise<KnowledgeDocument> {
    log.info(`Ingestion URL: ${url}`);

    const extraction = await contentExtractor.extractFromURL(url, {
      extractEntities: true,
      detectSections: true,
    });

    if (!extraction.success) {
      throw new Error(`Échec extraction URL: ${extraction.error}`);
    }

    const title = new URL(url).pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || url;
    const keywords = this.extractKeywords(extraction.text, extraction.entities.map((e) => e.name));
    const summary = this.generateBasicSummary(extraction.text, extraction.sections);

    const document = documentMemory.addDocument({
      title,
      source: url,
      type: "url",
      mimeType: "text/html",
      fileSize: extraction.text.length,
      extractedText: extraction.text,
      summary,
      sections: extraction.sections,
      entities: extraction.entities,
      keywords,
      tags: [...(options.tags || []), "web"],
      language: extraction.language,
      metadata: extraction.metadata,
      collection: options.collection,
    });

    const facts = this.extractBasicFacts(document);
    for (const fact of facts) {
      documentMemory.addFact(fact);
    }

    return document;
  }

  /**
   * Enrichit un document existant avec un résumé IA.
   * (Appelé par le skill avec le résultat de Gemini)
   */
  enrichWithAISummary(documentId: string, summary: string, additionalFacts?: AnalysisResult["facts"]): boolean {
    const doc = documentMemory.getDocument(documentId);
    if (!doc) return false;

    documentMemory.updateDocument(documentId, { summary });

    if (additionalFacts) {
      for (const fact of additionalFacts) {
        documentMemory.addFact({
          content: fact.content,
          category: fact.category,
          tags: [],
          sourceDocuments: [documentId],
          confidence: 0.8,
          importance: fact.importance,
          relatedConcepts: fact.relatedConcepts,
          verified: false,
        });
      }
    }

    return true;
  }

  /**
   * Génère une synthèse multi-documents (résultat textuel).
   */
  buildMultiDocumentSynthesis(documentIds: string[]): string {
    const documents = documentIds
      .map((id) => documentMemory.getDocument(id))
      .filter(Boolean) as KnowledgeDocument[];

    if (documents.length === 0) return "Aucun document trouvé.";

    const parts: string[] = [];
    parts.push(`═══ SYNTHÈSE MULTI-DOCUMENTS (${documents.length} documents) ═══\n`);

    for (const doc of documents) {
      parts.push(`📄 ${doc.title}`);
      parts.push(`   Type: ${doc.type} | Langue: ${doc.language} | Mots: ${doc.metadata.wordCount || "?"}`);
      parts.push(`   Résumé: ${doc.summary.slice(0, 200)}`);
      parts.push(`   Mots-clés: ${doc.keywords.slice(0, 10).join(", ")}`);
      parts.push(``);
    }

    // Relations entre ces documents
    const relations = documentMemory.getAllRelations().filter(
      (r) => documentIds.includes(r.sourceId) && documentIds.includes(r.targetId)
    );
    if (relations.length > 0) {
      parts.push(`── Relations détectées ──`);
      for (const rel of relations) {
        const src = documents.find((d) => d.id === rel.sourceId);
        const tgt = documents.find((d) => d.id === rel.targetId);
        if (src && tgt) {
          parts.push(`  • "${src.title}" ${rel.type} "${tgt.title}": ${rel.description}`);
        }
      }
      parts.push(``);
    }

    // Thèmes communs (mots-clés partagés)
    const allKeywords = documents.flatMap((d) => d.keywords);
    const keywordCounts = new Map<string, number>();
    for (const kw of allKeywords) {
      keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
    }
    const commonThemes = [...keywordCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([kw, count]) => `${kw} (×${count})`);

    if (commonThemes.length > 0) {
      parts.push(`── Thèmes communs ──`);
      parts.push(`  ${commonThemes.join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * Répond à une question en se basant sur les documents.
   * Retourne le contexte formaté pour que le LLM puisse répondre.
   */
  buildQuestionContext(question: string): DocumentContext {
    return documentSearchEngine.buildContext(question, { maxResults: 8 });
  }

  // ─── Méthodes internes ────────────────────────────────────────────────────

  /**
   * Génère un résumé basique (heuristique, sans LLM).
   */
  private generateBasicSummary(text: string, sections: { title?: string; content: string }[]): string {
    // Si des sections avec titres existent, utiliser les titres
    if (sections.length > 0 && sections.some((s) => s.title)) {
      const titled = sections.filter((s) => s.title);
      const outline = titled.map((s) => s.title).join(" | ");
      const firstContent = sections[0].content.slice(0, 200).replace(/\n/g, " ").trim();
      return `Structure: ${outline}. Début: ${firstContent}`;
    }

    // Sinon, prendre les premières phrases significatives
    const sentences = text
      .replace(/\n+/g, " ")
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20 && s.length < 300);

    return sentences.slice(0, 3).join(". ") + ".";
  }

  /**
   * Extrait des mots-clés significatifs.
   */
  private extractKeywords(text: string, entityNames: string[]): string[] {
    const stopWords = new Set([
      "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "à", "au",
      "ce", "ces", "est", "sont", "pour", "par", "sur", "dans", "qui", "que",
      "the", "a", "an", "is", "are", "of", "in", "to", "and", "for", "on", "with",
      "pas", "plus", "très", "tout", "être", "avoir", "faire", "comme", "mais",
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    // Inclure les noms d'entités comme keywords prioritaires
    const keywords = new Set<string>();
    for (const name of entityNames.slice(0, 10)) {
      keywords.add(name.toLowerCase());
    }

    // Ajouter les mots les plus fréquents
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    for (const [word] of sorted) {
      if (keywords.size >= 20) break;
      keywords.add(word);
    }

    return [...keywords];
  }

  /**
   * Extrait des faits basiques depuis un document (heuristique).
   */
  private extractBasicFacts(doc: KnowledgeDocument): Omit<MemoryFact, "id" | "createdAt" | "updatedAt" | "accessCount">[] {
    const facts: Omit<MemoryFact, "id" | "createdAt" | "updatedAt" | "accessCount">[] = [];

    // Fait : le document existe et contient X
    facts.push({
      content: `Le document "${doc.title}" (${doc.type}) contient ${doc.metadata.wordCount || "?"} mots. ${doc.summary.slice(0, 150)}`,
      category: "summary",
      tags: doc.keywords.slice(0, 5),
      sourceDocuments: [doc.id],
      sourceExcerpt: doc.summary.slice(0, 200),
      confidence: 0.9,
      importance: 0.6,
      relatedConcepts: doc.keywords.slice(0, 8),
      verified: false,
    });

    // Faits depuis les entités importantes
    const importantEntities = doc.entities
      .filter((e) => e.importance > 0.5)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);

    for (const entity of importantEntities) {
      const categoryMap: Record<string, MemoryCategory> = {
        person: "reference",
        organization: "reference",
        concept: "definition",
        definition: "definition",
        acronym: "definition",
        methodology: "procedure",
        technology: "reference",
      };

      facts.push({
        content: `${entity.type === "definition" ? "Définition" : "Référence"}: "${entity.name}" mentionné ${entity.occurrences}x dans "${doc.title}". Contexte: ${entity.context.slice(0, 100)}`,
        category: categoryMap[entity.type] || "fact",
        tags: [entity.type, entity.name.toLowerCase()],
        sourceDocuments: [doc.id],
        sourceExcerpt: entity.context,
        confidence: 0.7,
        importance: entity.importance,
        relatedConcepts: [entity.name],
        verified: false,
      });
    }

    return facts;
  }

  /**
   * Détecte des relations basiques avec les documents existants.
   */
  private detectBasicRelations(
    newDoc: KnowledgeDocument
  ): Omit<DocumentRelation, "id" | "createdAt">[] {
    const relations: Omit<DocumentRelation, "id" | "createdAt">[] = [];
    const existingDocs = documentMemory.getAllDocuments().filter((d) => d.id !== newDoc.id);

    for (const existingDoc of existingDocs) {
      // Similarité basée sur les mots-clés communs
      const commonKeywords = newDoc.keywords.filter((k) => existingDoc.keywords.includes(k));
      const similarity = commonKeywords.length / Math.max(newDoc.keywords.length, 1);

      if (similarity > 0.3) {
        relations.push({
          sourceId: newDoc.id,
          targetId: existingDoc.id,
          type: "related",
          description: `Thèmes communs: ${commonKeywords.slice(0, 5).join(", ")}`,
          confidence: Math.min(similarity, 0.9),
          evidence: `Mots-clés partagés: ${commonKeywords.join(", ")}`,
          autoDetected: true,
        });
      }

      // Même collection = relation séquentielle potentielle
      if (newDoc.collection && newDoc.collection === existingDoc.collection) {
        relations.push({
          sourceId: newDoc.id,
          targetId: existingDoc.id,
          type: "related",
          description: `Même collection: ${newDoc.collection}`,
          confidence: 0.5,
          autoDetected: true,
        });
      }
    }

    return relations.slice(0, 10); // Limiter à 10 relations max
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

export const documentAnalyzer = new DocumentAnalyzer();
