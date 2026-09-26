/**
 * DocumentSearchEngine — Recherche sémantique dans la base documentaire
 *
 * Moteur de recherche intelligent pour les documents :
 *   • Recherche full-text via index inversé (BM25-like scoring)
 *   • Recherche par métadonnées (tags, collections, types)
 *   • Recherche dans les faits mémorisés
 *   • Scoring multi-critères (TF-IDF + pertinence structurelle)
 *   • Génération de contexte pour le LLM
 *   • Suggestions de documents similaires
 */

import { documentMemory } from "./DocumentMemory.js";
import type {
  SearchResult,
  SearchOptions,
  DocumentContext,
  KnowledgeDocument,
  MemoryFact,
  DocumentRelation,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_RESULTS = 20;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const STOP_WORDS = new Set([
  "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "à", "au",
  "ce", "ces", "est", "sont", "pour", "par", "sur", "dans", "qui", "que",
  "the", "a", "an", "is", "are", "of", "in", "to", "and", "for", "on", "with",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// DocumentSearchEngine
// ═══════════════════════════════════════════════════════════════════════════════

export class DocumentSearchEngine {

  /**
   * Recherche principale : combine documents, sections et faits.
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
    const results: SearchResult[] = [];

    // 1. Recherche dans les documents
    const docResults = this.searchDocuments(query, options);
    results.push(...docResults);

    // 2. Recherche dans les faits
    if (!options.searchMode || options.searchMode === "full") {
      const factResults = this.searchFacts(query, options);
      results.push(...factResults);
    }

    // 3. Trier par pertinence et limiter
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, maxResults);
  }

  /**
   * Recherche uniquement dans les documents.
   */
  searchDocuments(query: string, options: SearchOptions = {}): SearchResult[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    let documents = documentMemory.getAllDocuments();

    // Appliquer les filtres
    if (options.documentTypes?.length) {
      documents = documents.filter((d) => options.documentTypes!.includes(d.type));
    }
    if (options.collections?.length) {
      documents = documents.filter((d) => d.collection && options.collections!.includes(d.collection));
    }
    if (options.tags?.length) {
      documents = documents.filter((d) => d.tags.some((t) => options.tags!.includes(t)));
    }
    if (options.language && options.language !== "all") {
      documents = documents.filter((d) => d.language === options.language);
    }
    if (options.dateFrom) {
      documents = documents.filter((d) => d.addedAt >= options.dateFrom!);
    }
    if (options.dateTo) {
      documents = documents.filter((d) => d.addedAt <= options.dateTo!);
    }

    // Scorer chaque document
    const avgDocLength = this.computeAvgDocLength(documents);
    const scored: SearchResult[] = [];

    for (const doc of documents) {
      const score = this.scoreDocument(doc, tokens, avgDocLength, options.searchMode);
      if (score > 0) {
        const snippet = this.extractSnippet(doc, tokens);
        const highlights = this.findHighlights(snippet, tokens);

        scored.push({
          resultType: "document",
          id: doc.id,
          title: doc.title,
          snippet,
          relevance: Math.min(score, 1),
          documentId: doc.id,
          documentTitle: doc.title,
          highlights,
        });
      }
    }

    // Recherche dans les sections pour plus de granularité
    for (const doc of documents) {
      for (const section of doc.sections) {
        const sectionScore = this.scoreText(section.content, tokens, avgDocLength);
        if (sectionScore > 0.3) {
          const snippet = this.extractSnippetFromText(section.content, tokens);
          scored.push({
            resultType: "section",
            id: section.id,
            title: section.title || `Section de "${doc.title}"`,
            snippet,
            relevance: Math.min(sectionScore * 0.9, 1), // Légèrement inférieur aux documents complets
            documentId: doc.id,
            documentTitle: doc.title,
            highlights: this.findHighlights(snippet, tokens),
          });
        }
      }
    }

    return scored.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Recherche dans les faits mémorisés.
   */
  searchFacts(query: string, options: SearchOptions = {}): SearchResult[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    let facts = documentMemory.getAllFacts();

    // Filtrer par catégorie si spécifié
    if (options.factCategories?.length) {
      facts = facts.filter((f) => options.factCategories!.includes(f.category));
    }

    const scored: SearchResult[] = [];

    for (const fact of facts) {
      const text = `${fact.content} ${fact.tags.join(" ")} ${fact.relatedConcepts.join(" ")}`;
      const score = this.scoreText(text, tokens, 500); // Longueur moyenne d'un fait

      if (score > 0.15) {
        // Bonus pour les faits vérifiés et importants
        const adjustedScore = score * (1 + fact.importance * 0.3) * (fact.verified ? 1.2 : 1);

        scored.push({
          resultType: "fact",
          id: fact.id,
          title: `[${fact.category}] ${fact.content.slice(0, 80)}`,
          snippet: fact.content,
          relevance: Math.min(adjustedScore, 1),
          highlights: this.findHighlights(fact.content, tokens),
        });
      }
    }

    return scored.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Génère un contexte documentaire complet pour le LLM.
   */
  buildContext(query: string, options: SearchOptions = {}): DocumentContext {
    const maxDocs = options.maxResults || 10;

    // Rechercher les documents et faits pertinents
    const allResults = this.search(query, { ...options, maxResults: maxDocs * 3 });

    const docResults = allResults.filter((r) => r.resultType === "document" || r.resultType === "section");
    const factResults = allResults.filter((r) => r.resultType === "fact");

    // Récupérer les documents complets
    const uniqueDocIds = [...new Set(docResults.map((r) => r.documentId).filter(Boolean))] as string[];
    const documents = uniqueDocIds.slice(0, maxDocs).map((id) => {
      const doc = documentMemory.getDocument(id);
      if (!doc) return null;

      // Trouver les sections pertinentes
      const relevantSections = docResults
        .filter((r) => r.documentId === id && r.resultType === "section")
        .map((r) => r.snippet)
        .slice(0, 3);

      // Si pas de sections pertinentes, prendre le résumé
      if (relevantSections.length === 0) {
        relevantSections.push(doc.summary);
      }

      const relevance = docResults.find((r) => r.documentId === id)?.relevance || 0;

      return {
        id: doc.id,
        title: doc.title,
        summary: doc.summary,
        relevantSections,
        relevance,
      };
    }).filter(Boolean) as DocumentContext["documents"];

    // Récupérer les faits pertinents
    const facts = factResults
      .slice(0, 15)
      .map((r) => documentMemory.getFact(r.id))
      .filter(Boolean) as MemoryFact[];

    // Récupérer les relations entre les documents trouvés
    const relations: DocumentRelation[] = [];
    for (const docId of uniqueDocIds) {
      const docRelations = documentMemory.getRelationsForDocument(docId);
      for (const rel of docRelations) {
        if (uniqueDocIds.includes(rel.sourceId) && uniqueDocIds.includes(rel.targetId)) {
          if (!relations.find((r) => r.id === rel.id)) {
            relations.push(rel);
          }
        }
      }
    }

    // Calculer la qualité
    const averageRelevance = documents.length > 0
      ? documents.reduce((sum, d) => sum + d.relevance, 0) / documents.length
      : 0;

    const quality = {
      totalDocuments: documents.length,
      totalFacts: facts.length,
      averageRelevance,
      sufficient: documents.length >= 2 || facts.length >= 3,
    };

    // Formater le prompt pour injection LLM
    const formattedPrompt = this.formatContextPrompt(query, documents, facts, relations);

    return {
      query,
      documents,
      facts,
      relations,
      quality,
      formattedPrompt,
    };
  }

  /**
   * Trouve les documents similaires à un document donné.
   */
  findSimilarDocuments(documentId: string, maxResults = 5): { doc: KnowledgeDocument; similarity: number }[] {
    const sourceDoc = documentMemory.getDocument(documentId);
    if (!sourceDoc) return [];

    const tokens = this.tokenize(`${sourceDoc.title} ${sourceDoc.summary} ${sourceDoc.keywords.join(" ")}`);
    const allDocs = documentMemory.getAllDocuments().filter((d) => d.id !== documentId);
    const avgLen = this.computeAvgDocLength(allDocs);

    const scored = allDocs.map((doc) => ({
      doc,
      similarity: this.scoreDocument(doc, tokens, avgLen),
    }));

    return scored
      .filter((s) => s.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
  }

  // ─── Scoring BM25-like ────────────────────────────────────────────────────

  private scoreDocument(
    doc: KnowledgeDocument,
    queryTokens: string[],
    avgDocLength: number,
    mode?: "full" | "summary" | "keywords"
  ): number {
    let searchText: string;

    switch (mode) {
      case "summary":
        searchText = `${doc.title} ${doc.summary}`;
        break;
      case "keywords":
        searchText = `${doc.title} ${doc.keywords.join(" ")} ${doc.tags.join(" ")}`;
        break;
      default:
        searchText = `${doc.title} ${doc.summary} ${doc.keywords.join(" ")} ${doc.tags.join(" ")} ${doc.extractedText.slice(0, 10000)}`;
    }

    return this.scoreText(searchText, queryTokens, avgDocLength);
  }

  private scoreText(text: string, queryTokens: string[], avgDocLength: number): number {
    const docTokens = this.tokenize(text);
    const docLength = docTokens.length;
    if (docLength === 0 || queryTokens.length === 0) return 0;

    // Compter les fréquences
    const termFreq = new Map<string, number>();
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    // BM25 score
    let score = 0;
    const N = documentMemory.documentCount || 1;

    for (const queryToken of queryTokens) {
      const tf = termFreq.get(queryToken) || 0;
      if (tf === 0) continue;

      // Estimation IDF (combien de docs contiennent ce terme)
      const df = 1; // Simplifié — en vrai il faudrait compter
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      // BM25 formula
      const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength)));
      score += idf * tfNorm;
    }

    // Normaliser entre 0 et 1
    const maxPossibleScore = queryTokens.length * Math.log(N + 1) * (BM25_K1 + 1);
    return maxPossibleScore > 0 ? Math.min(score / maxPossibleScore, 1) : 0;
  }

  private computeAvgDocLength(docs: KnowledgeDocument[]): number {
    if (docs.length === 0) return 500;
    const totalWords = docs.reduce((sum, d) => sum + (d.metadata.wordCount || 500), 0);
    return totalWords / docs.length;
  }

  // ─── Extraction de snippets ───────────────────────────────────────────────

  private extractSnippet(doc: KnowledgeDocument, queryTokens: string[]): string {
    // Chercher dans le résumé d'abord
    const summaryScore = this.countMatches(doc.summary, queryTokens);
    if (summaryScore > 0) {
      return doc.summary.slice(0, 300);
    }

    // Sinon chercher dans le texte extrait
    return this.extractSnippetFromText(doc.extractedText, queryTokens);
  }

  private extractSnippetFromText(text: string, queryTokens: string[]): string {
    if (!text) return "";

    const lowerText = text.toLowerCase();
    let bestStart = 0;
    let bestScore = 0;

    // Fenêtre glissante de 300 chars
    const windowSize = 300;
    const step = 50;

    for (let i = 0; i < Math.min(text.length, 20000); i += step) {
      const window = lowerText.slice(i, i + windowSize);
      let score = 0;
      for (const token of queryTokens) {
        if (window.includes(token)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
      }
    }

    return text.slice(bestStart, bestStart + windowSize).replace(/\n+/g, " ").trim();
  }

  private findHighlights(text: string, queryTokens: string[]): { start: number; end: number }[] {
    const highlights: { start: number; end: number }[] = [];
    const lowerText = text.toLowerCase();

    for (const token of queryTokens) {
      let idx = lowerText.indexOf(token);
      while (idx !== -1 && highlights.length < 10) {
        highlights.push({ start: idx, end: idx + token.length });
        idx = lowerText.indexOf(token, idx + 1);
      }
    }

    return highlights.sort((a, b) => a.start - b.start);
  }

  private countMatches(text: string, queryTokens: string[]): number {
    const lower = text.toLowerCase();
    return queryTokens.filter((t) => lower.includes(t)).length;
  }

  // ─── Formatage du contexte pour LLM ───────────────────────────────────────

  private formatContextPrompt(
    query: string,
    documents: DocumentContext["documents"],
    facts: MemoryFact[],
    relations: DocumentRelation[]
  ): string {
    const parts: string[] = [];

    parts.push(`══ CONTEXTE DOCUMENTAIRE ══`);
    parts.push(`Requête : "${query}"`);
    parts.push(``);

    if (documents.length > 0) {
      parts.push(`── Documents pertinents (${documents.length}) ──`);
      for (const doc of documents) {
        parts.push(`📄 ${doc.title} [pertinence: ${(doc.relevance * 100).toFixed(0)}%]`);
        parts.push(`   Résumé : ${doc.summary.slice(0, 200)}`);
        if (doc.relevantSections.length > 0) {
          parts.push(`   Sections pertinentes :`);
          for (const section of doc.relevantSections) {
            parts.push(`     • ${section.slice(0, 150)}`);
          }
        }
        parts.push(``);
      }
    }

    if (facts.length > 0) {
      parts.push(`── Faits mémorisés (${facts.length}) ──`);
      for (const fact of facts) {
        const verified = fact.verified ? " ✓" : "";
        parts.push(`  • [${fact.category}${verified}] ${fact.content}`);
      }
      parts.push(``);
    }

    if (relations.length > 0) {
      parts.push(`── Relations inter-documents ──`);
      for (const rel of relations) {
        const sourceDoc = documents.find((d) => d.id === rel.sourceId);
        const targetDoc = documents.find((d) => d.id === rel.targetId);
        if (sourceDoc && targetDoc) {
          parts.push(`  • "${sourceDoc.title}" ${rel.type} "${targetDoc.title}" : ${rel.description}`);
        }
      }
    }

    return parts.join("\n");
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

export const documentSearchEngine = new DocumentSearchEngine();
