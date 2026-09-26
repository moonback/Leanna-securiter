/**
 * RAGEngine — Retrieval-Augmented Generation pour les notebooks
 *
 * Pipeline de recherche en 5 étapes :
 *   0. Expansion de requête — décomposition LLM en sous-questions (rappel ++)
 *   1. Recherche sémantique via Gemini Embeddings (similarité cosinus)
 *   2. Recherche lexicale TF-IDF (correspondance exacte de termes)
 *   3. Fusion Reciprocal Rank Fusion (RRF) des deux scores
 *   4. Re-ranking LLM — re-scorer les top candidats avec un appel modèle court
 *
 * La combinaison hybride + re-ranking garantit :
 * - Rappel élevé (embeddings captent le sens, TF-IDF capte les mots exacts)
 * - Précision élevée (le LLM élimine les faux positifs en fin de pipeline)
 * - Couverture étendue (l'expansion de requête capture les angles multiples)
 */

import { createLogger } from "../utils/logger.js";
import { generateText } from "../utils/textGeneration.js";
import { embeddingStore } from "./EmbeddingStore.js";
import type { Source, SourceChunk, RAGSearchOptions, RAGSearchResult } from "./types.js";

const log = createLogger("RAGEngine");

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_MAX_CHUNKS = 6;      // 10 → 6
const DEFAULT_MIN_RELEVANCE = 0.1;

/** Poids de la recherche sémantique dans le score final */
const SEMANTIC_WEIGHT = 0.65;
/** Poids de la recherche lexicale dans le score final */
const LEXICAL_WEIGHT = 0.35;

/** Constante k pour le Reciprocal Rank Fusion */
const RRF_K = 60;

/** Nombre de candidats à re-ranker via LLM */
const RERANK_TOP_K = 10;           // 20 → 10

/** Active/désactive le re-ranking LLM (peut être désactivé pour économiser des tokens) */
const RERANK_ENABLED = true;

/** Active/désactive l'expansion de requête via LLM */
const QUERY_EXPANSION_ENABLED = true;

/** Nombre maximum de sous-questions générées lors de l'expansion */
const QUERY_EXPANSION_MAX_SUBQUERIES = 3;

// ═══════════════════════════════════════════════════════════════════════════════

export class RAGEngine {

  /**
   * Recherche hybride complète : expansion → embeddings + TF-IDF + fusion RRF + re-ranking LLM.
   * Fallback automatique sur TF-IDF seul si les embeddings ne sont pas disponibles.
   */
  async searchHybrid(query: string, sources: Source[], options: RAGSearchOptions = {}): Promise<RAGSearchResult[]> {
    const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
    const minRelevance = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;

    const filteredSources = options.sourceIds
      ? sources.filter(s => options.sourceIds!.includes(s.id))
      : sources;

    if (filteredSources.length === 0) return [];

    // Collecter tous les chunks
    const chunkMap = new Map<string, { chunk: SourceChunk; source: Source }>();
    for (const source of filteredSources) {
      for (const chunk of source.chunks) {
        chunkMap.set(chunk.id, { chunk, source });
      }
    }

    if (chunkMap.size === 0) return [];

    // ── Étape 0 : Expansion de requête via LLM ────────────────────────────
    // Décompose la question en sous-questions pour augmenter le rappel
    const queries = await this.expandQuery(query);
    log.debug(`Expansion: ${queries.length} requête(s) → [${queries.map(q => q.slice(0, 50)).join(" | ")}]`);

    // ── Étape 1 : Recherche sémantique via embeddings (toutes les queries) ─
    let semanticResults: Map<string, number> = new Map();
    try {
      // Paralléliser les recherches d'embeddings pour toutes les sous-requêtes
      const embeddingSearches = queries.map(q => 
        embeddingStore.search(q, {
          sourceIds: options.sourceIds,
          maxResults: RERANK_TOP_K * 2,
          minSimilarity: 0.2,
        })
      );
      
      const allEmbeddingResults = await Promise.all(embeddingSearches);

      // Fusionner les résultats de toutes les sous-requêtes
      for (const embeddingResults of allEmbeddingResults) {
        for (const result of embeddingResults) {
          if (chunkMap.has(result.chunkId)) {
            // Garder le meilleur score parmi toutes les sous-queries
            const existing = semanticResults.get(result.chunkId) || 0;
            semanticResults.set(result.chunkId, Math.max(existing, result.similarity));
          }
        }
      }
    } catch (e: any) {
      log.warn(`Embeddings search fallback: ${e.message}`);
    }

    // ── Étape 2 : Recherche lexicale TF-IDF (toutes les queries) ───────────
    const lexicalScores = new Map<string, number>();
    for (const q of queries) {
      const lexResults = this.searchTFIDF(q, filteredSources, RERANK_TOP_K * 2);
      for (const result of lexResults) {
        const existing = lexicalScores.get(result.chunk.id) || 0;
        lexicalScores.set(result.chunk.id, Math.max(existing, result.relevance));
      }
    }
    // Convertir en RAGSearchResult[] pour compatibilité avec la fusion
    const lexicalResults: RAGSearchResult[] = [];
    for (const [chunkId, score] of lexicalScores) {
      const entry = chunkMap.get(chunkId);
      if (entry) lexicalResults.push({ chunk: entry.chunk, source: entry.source, relevance: score });
    }

    // ── Étape 3 : Fusion RRF ───────────────────────────────────────────────
    const fusedScores = new Map<string, number>();

    if (semanticResults.size > 0) {
      const semanticRanked = Array.from(semanticResults.entries())
        .sort((a, b) => b[1] - a[1]);
      const lexicalRanked = lexicalResults
        .sort((a, b) => b.relevance - a.relevance);

      for (let rank = 0; rank < semanticRanked.length; rank++) {
        const [chunkId, similarity] = semanticRanked[rank];
        const rrfScore = SEMANTIC_WEIGHT / (RRF_K + rank + 1);
        const similarityBonus = similarity > 0.7 ? 0.1 : similarity > 0.5 ? 0.05 : 0;
        fusedScores.set(chunkId, (fusedScores.get(chunkId) || 0) + rrfScore + similarityBonus);
      }

      for (let rank = 0; rank < lexicalRanked.length; rank++) {
        const { chunk } = lexicalRanked[rank];
        const rrfScore = LEXICAL_WEIGHT / (RRF_K + rank + 1);
        fusedScores.set(chunk.id, (fusedScores.get(chunk.id) || 0) + rrfScore);
      }
    } else {
      for (const result of lexicalResults) {
        fusedScores.set(result.chunk.id, result.relevance);
      }
    }

    // Construire les candidats triés
    let candidates: RAGSearchResult[] = [];
    const allScores = Array.from(fusedScores.values());
    const maxFusedScore = Math.max(...allScores, 0.001); // Éviter division par 0

    for (const [chunkId, score] of fusedScores) {
      const entry = chunkMap.get(chunkId);
      if (!entry) continue;
      // Normaliser les scores RRF dans [0, 1] pour que le filtre minRelevance ait du sens
      const normalizedScore = semanticResults.size > 0 ? score / maxFusedScore : score;
      candidates.push({
        chunk: entry.chunk,
        source: entry.source,
        relevance: Math.min(normalizedScore, 1.0),
      });
    }
    candidates.sort((a, b) => b.relevance - a.relevance);
    // Pré-filtre souple : garder les top candidats pour le re-ranking + ceux au-dessus du seuil
    const preFilterThreshold = minRelevance * 0.3;
    candidates = candidates.filter((c, idx) => c.relevance >= preFilterThreshold || idx < RERANK_TOP_K);

    // ── Étape 4 : Re-ranking LLM ──────────────────────────────────────────
    const topCandidates = candidates.slice(0, RERANK_TOP_K);

    if (RERANK_ENABLED && topCandidates.length > 3) {
      try {
        const reranked = await this.rerankWithLLM(query, topCandidates);
        // Remplacer les candidats par les résultats re-rankés
        candidates = reranked;
      } catch (e: any) {
        log.warn(`Re-ranking LLM skipped: ${e.message}`);
        // Continuer avec l'ordre de fusion RRF
      }
    }

    // Filtrer et limiter
    return candidates
      .filter(r => r.relevance >= minRelevance)
      .slice(0, maxChunks);
  }

  // ─── Re-ranking LLM ──────────────────────────────────────────────────────

  /**
   * Expansion de requête via LLM — décompose la question en sous-questions.
   *
   * Stratégie :
   *   - Questions courtes ou simples → retournées telles quelles
   *   - Questions complexes → décomposées en 2-3 sous-questions ciblées
   *   - La question originale est TOUJOURS incluse (garantit le rappel de base)
   *
   * Exemples :
   *   "Comment fonctionne le système d'authentification et quelles sont les failles connues ?"
   *   → ["Comment fonctionne le système d'authentification et quelles sont les failles connues ?",
   *       "Architecture et mécanisme du système d'authentification",
   *       "Vulnérabilités et failles de sécurité connues dans l'authentification"]
   */
  private async expandQuery(query: string): Promise<string[]> {
    // Désactivé ou query trop courte → pas d'expansion
    if (QUERY_EXPANSION_ENABLED && query.length > 20) { // condition
      // Expansion active pour les requêtes suffisamment longues
    } else {
      return [query];
    }

    try {
      const prompt = `Tu es un moteur d'expansion de requête pour un système de recherche documentaire.

TÂCHE : Décompose la question suivante en sous-questions distinctes pour améliorer le rappel de recherche.

QUESTION ORIGINALE : "${query}"

RÈGLES :
- Génère 2 à ${QUERY_EXPANSION_MAX_SUBQUERIES} sous-questions MAXIMUM
- Chaque sous-question doit couvrir un angle ou aspect différent de la question
- Les sous-questions doivent être concises (< 80 caractères chacune)
- Utilise des reformulations sémantiques variées (synonymes, perspectives différentes)
- Si la question est déjà simple et atomique, retourne un tableau vide []
- Ne répète PAS la question originale dans les sous-questions

Réponds UNIQUEMENT en JSON strict :
["sous-question 1", "sous-question 2"]

Si la question est trop simple pour être décomposée :
[]`;

      const result = await generateText({
        prompt,
        temperature: 0.3,
        maxOutputTokens: 256,
        forceProvider: 'openrouter',
      });

      // Parser la réponse JSON
      const jsonMatch = result.text.match(/\[.*\]/s);
      if (!jsonMatch) {
        log.debug("Query expansion: pas de JSON dans la réponse, skip");
        return [query];
      }

      const subQueries: string[] = JSON.parse(jsonMatch[0]);

      // Validation : doit être un tableau de strings non-vides
      if (!Array.isArray(subQueries) || subQueries.length === 0) {
        return [query];
      }

      // Filtrer les sous-questions valides et limiter
      const validSubQueries = subQueries
        .filter(q => typeof q === "string" && q.trim().length >= 5)
        .slice(0, QUERY_EXPANSION_MAX_SUBQUERIES);

      if (validSubQueries.length === 0) {
        return [query];
      }

      // Toujours inclure la question originale en premier
      return [query, ...validSubQueries];
    } catch (e: any) {
      log.warn(`Query expansion skipped: ${e.message}`);
      return [query];
    }
  }

  // ─── Re-ranking LLM (passage scoring) ─────────────────────────────────────

  /**
   * Re-score les candidats avec un appel LLM léger.
   * Le modèle évalue la pertinence de chaque passage par rapport à la question.
   *
   * Stratégie : un seul appel batch qui note tous les passages (pas un appel par chunk).
   * Retourne les résultats re-triés avec des scores ajustés.
   */
  private async rerankWithLLM(query: string, candidates: RAGSearchResult[]): Promise<RAGSearchResult[]> {
    // Préparer les passages pour le LLM (tronqués pour économiser les tokens)
    const passages = candidates.map((c, i) => ({
      index: i,
      text: c.chunk.content.slice(0, 400), // Max 400 chars par passage
      source: c.source.title,
    }));

    const prompt = `Tu es un système de re-ranking. Score chaque passage de 0 à 10 selon sa pertinence pour la question.

QUESTION : "${query}"

PASSAGES :
${passages.map(p => `[${p.index}] (${p.source}) ${p.text}`).join("\n\n")}

Scoring :
- 0 = hors sujet, 5 = partiellement pertinent, 10 = répond directement

Réponds UNIQUEMENT avec un tableau JSON de nombres, rien d'autre. Exemple : [7, 3, 9, 5]
Réponse :`;

    const result = await generateText({
      prompt,
      temperature: 0.0,
      maxOutputTokens: 256,
      forceProvider: 'openrouter',
    });

    // Parser les scores — multiple stratégies de fallback
    const text = result.text.trim();

    // Stratégie 1 : regex pour un tableau JSON (avec possibles retours à la ligne, espaces)
    const jsonMatch = text.match(/\[[\d\s,.\-\r\n]+\]/);

    // Stratégie 2 : chercher dans un code block markdown
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?\s*(\[[\d\s,.\-\r\n]+\])\s*\n?```/);

    // Stratégie 3 : le texte entier est le tableau (LLM bien obéissant)
    const directArrayMatch = text.startsWith('[') ? text.match(/^\[[\d\s,.\-\r\n]+\]/) : null;

    const matchedJson = jsonMatch?.[0] || codeBlockMatch?.[1] || directArrayMatch?.[0];

    if (!matchedJson) {
      // Stratégie 4 : extraire tous les nombres du texte
      const numbersInText = text.match(/\b\d+(?:\.\d+)?\b/g);
      if (numbersInText && numbersInText.length >= candidates.length * 0.5) {
        const fallbackScores = numbersInText.slice(0, candidates.length).map(Number);
        log.debug(`Re-ranking: fallback extraction de ${fallbackScores.length} scores depuis le texte brut`);
        return this.applyRerankScores(candidates, fallbackScores);
      }

      // Stratégie 5 : chercher des patterns "index: score" ou "Passage X: Y"
      const indexScorePattern = /(?:\[?\d+\]?|passage\s*\d+)\s*[:=\-–]\s*(\d+(?:\.\d+)?)/gi;
      const indexScores: number[] = [];
      let m;
      while ((m = indexScorePattern.exec(text)) !== null) {
        indexScores.push(Number(m[1]));
      }
      if (indexScores.length >= candidates.length * 0.5) {
        log.debug(`Re-ranking: extraction par pattern index:score de ${indexScores.length} scores`);
        return this.applyRerankScores(candidates, indexScores);
      }

      log.warn("Re-ranking: impossible de parser la réponse LLM, utilisation des scores originaux");
      return candidates;
    }

    let scores: number[];
    try {
      scores = JSON.parse(matchedJson);
    } catch {
      // Essayer de nettoyer le JSON (virgules trailing, etc.)
      const cleaned = matchedJson.replace(/,\s*\]/, ']').replace(/\n/g, '');
      try {
        scores = JSON.parse(cleaned);
      } catch {
        log.warn("Re-ranking: JSON.parse échoué sur le tableau extrait");
        return candidates;
      }
    }
    if (!Array.isArray(scores) || scores.length === 0) {
      return candidates;
    }

    return this.applyRerankScores(candidates, scores);
  }

  /**
   * Applique les scores de re-ranking aux candidats et retrie par pertinence.
   */
  private applyRerankScores(candidates: RAGSearchResult[], scores: number[]): RAGSearchResult[] {
    const reranked: RAGSearchResult[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const rawScore = scores[i] ?? 5;
      // Clamp entre 0 et 10 pour gérer les scores aberrants
      const clampedScore = Math.max(0, Math.min(10, rawScore));
      const llmScore = clampedScore / 10; // Normaliser 0-10 → 0-1
      const originalScore = candidates[i].relevance;

      // Score final : combinaison du score hybride et du score LLM
      // Le LLM a le dernier mot (poids 60%) mais le score initial pèse aussi (40%)
      const finalScore = originalScore * 0.4 + llmScore * 0.6;

      reranked.push({
        ...candidates[i],
        relevance: Math.min(finalScore, 1.0),
      });
    }

    // Re-trier par le nouveau score
    reranked.sort((a, b) => b.relevance - a.relevance);

    log.debug(`Re-ranking: ${candidates.length} passages re-scorés, top score: ${reranked[0]?.relevance.toFixed(3)}`);
    return reranked;
  }

  /**
   * Recherche synchrone TF-IDF (pas d'embeddings).
   * Utilisé comme fallback et comme composante de la recherche hybride.
   */
  search(query: string, sources: Source[], options: RAGSearchOptions = {}): RAGSearchResult[] {
    const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
    const minRelevance = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;

    const filteredSources = options.sourceIds
      ? sources.filter(s => options.sourceIds!.includes(s.id))
      : sources;

    if (filteredSources.length === 0) return [];

    const results = this.searchTFIDF(query, filteredSources, maxChunks * 2);

    return results
      .filter(r => r.relevance >= minRelevance)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxChunks);
  }

  /**
   * Construit le contexte textuel pour le LLM à partir des résultats RAG.
   * Inclut les citations formatées pour extraction ultérieure.
   */
  buildContext(results: RAGSearchResult[]): string {
    if (results.length === 0) {
      return "Aucun contenu pertinent trouvé dans les sources.";
    }

    const sections: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const { chunk, source, relevance } = results[i];
      sections.push(
        `[SOURCE ${i + 1}: "${source.title}" | Pertinence: ${(relevance * 100).toFixed(0)}%]\n` +
        `${chunk.content}\n` +
        `[/SOURCE ${i + 1}]`
      );
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * Extrait les citations depuis la réponse du LLM.
   * Cherche les références [SOURCE N] dans la réponse.
   */
  extractCitations(
    response: string,
    ragResults: RAGSearchResult[]
  ): { sourceId: string; sourceTitle: string; chunkId: string; excerpt: string; relevance: number }[] {
    const citations: { sourceId: string; sourceTitle: string; chunkId: string; excerpt: string; relevance: number }[] = [];
    const cited = new Set<string>();

    // Chercher les références explicites [SOURCE N] ou [N]
    const refPattern = /\[(?:SOURCE\s*)?(\d+)\]/gi;
    let match: RegExpExecArray | null;

    while ((match = refPattern.exec(response)) !== null) {
      const index = parseInt(match[1]) - 1;
      if (index >= 0 && index < ragResults.length) {
        const result = ragResults[index];
        if (!cited.has(result.chunk.id)) {
          cited.add(result.chunk.id);
          citations.push({
            sourceId: result.source.id,
            sourceTitle: result.source.title,
            chunkId: result.chunk.id,
            excerpt: result.chunk.content.slice(0, 200),
            relevance: result.relevance,
          });
        }
      }
    }

    // Si aucune citation explicite trouvée, citer les top résultats utilisés
    if (citations.length === 0 && ragResults.length > 0) {
      for (const result of ragResults.slice(0, 3)) {
        if (result.relevance >= 0.3) {
          citations.push({
            sourceId: result.source.id,
            sourceTitle: result.source.title,
            chunkId: result.chunk.id,
            excerpt: result.chunk.content.slice(0, 200),
            relevance: result.relevance,
          });
        }
      }
    }

    return citations;
  }

  // ─── TF-IDF interne ──────────────────────────────────────────────────────

  private searchTFIDF(query: string, sources: Source[], maxResults: number): RAGSearchResult[] {
    const queryTokens = this.tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return [];

    // Collecter tous les chunks
    const allChunks: { chunk: SourceChunk; source: Source }[] = [];
    for (const source of sources) {
      for (const chunk of source.chunks) {
        allChunks.push({ chunk, source });
      }
    }

    const totalDocs = allChunks.length;
    if (totalDocs === 0) return [];

    // Document frequency
    const docFreq = new Map<string, number>();
    for (const token of queryTokens) {
      let count = 0;
      for (const { chunk } of allChunks) {
        if (chunk.content.toLowerCase().includes(token)) {
          count++;
        }
      }
      docFreq.set(token, count);
    }

    // Scorer chaque chunk
    const results: RAGSearchResult[] = [];
    for (const { chunk, source } of allChunks) {
      const score = this.scoreChunk(chunk, queryTokens, docFreq, totalDocs, query);
      if (score > 0) {
        results.push({ chunk, source, relevance: score });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, maxResults);
  }

  private scoreChunk(
    chunk: SourceChunk,
    queryTokens: string[],
    docFreq: Map<string, number>,
    totalDocs: number,
    originalQuery: string
  ): number {
    const contentLower = chunk.content.toLowerCase();
    const contentTokens = this.tokenize(contentLower);

    if (contentTokens.length === 0) return 0;

    let score = 0;
    let matchedTerms = 0;

    for (const token of queryTokens) {
      const tf = contentTokens.filter(t => t === token).length / contentTokens.length;
      if (tf === 0) continue;

      const df = docFreq.get(token) || 1;
      const idf = Math.log(1 + totalDocs / df);

      score += tf * idf;
      matchedTerms++;
    }

    // Bonus: correspondance exacte de la phrase
    if (originalQuery.length >= 4 && contentLower.includes(originalQuery.toLowerCase())) {
      score += 0.5;
    }

    // Bonus: couverture de la query
    const coverage = matchedTerms / queryTokens.length;
    score += coverage * 0.3;

    // Bonus: proximité des termes
    if (matchedTerms >= 2) {
      score += this.computeProximityBonus(contentLower, queryTokens);
    }

    return Math.min(score, 1.0);
  }

  private computeProximityBonus(content: string, queryTokens: string[]): number {
    const positions: number[] = [];
    for (const token of queryTokens) {
      const idx = content.indexOf(token);
      if (idx >= 0) positions.push(idx);
    }

    if (positions.length < 2) return 0;
    positions.sort((a, b) => a - b);
    const span = positions[positions.length - 1] - positions[0];
    const maxSpan = 500;

    if (span <= maxSpan) {
      return 0.2 * (1 - span / maxSpan);
    }
    return 0;
  }

  // ─── Tokenisation ────────────────────────────────────────────────────────

  private tokenize(text: string): string[] {
    return text
      .split(/[^a-zà-ÿ0-9]+/)
      .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
  }
}

// ─── Stop Words FR/EN ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "au", "aux",
  "ce", "ces", "son", "sa", "ses", "il", "elle", "on", "nous", "vous", "ils",
  "elles", "se", "ne", "pas", "que", "qui", "ou", "mais", "donc", "car",
  "dans", "sur", "par", "pour", "avec", "sans", "sous", "entre",
  "cette", "mon", "ton", "leur", "nos", "vos", "leurs",
  "est", "sont", "été", "avoir", "être", "fait", "peut", "plus",
  "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would",
  "shall", "should", "may", "might", "can", "could",
  "and", "or", "but", "not", "no", "if", "then", "else",
  "an", "to", "of", "in", "on", "at", "by", "for", "with",
  "from", "up", "out", "off", "over", "under", "again",
  "this", "that", "these", "those", "it", "its",
  "he", "she", "they", "we", "you", "me", "him", "her", "us", "them",
]);

// Singleton
export const ragEngine = new RAGEngine();
