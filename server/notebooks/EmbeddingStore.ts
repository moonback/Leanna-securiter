/**
 * EmbeddingStore — Stockage et recherche vectorielle via Gemini Embeddings
 *
 * Utilise le modèle gemini-embedding-001 de Google pour vectoriser les chunks
 * et effectuer une recherche par similarité cosinus.
 *
 * Architecture :
 *   1. À l'ingestion d'une source, chaque chunk est vectorisé
 *   2. Les vecteurs sont stockés en mémoire + persistés sur disque
 *   3. À la recherche, la query est vectorisée et comparée par cosinus
 *   4. Le RAGEngine combine le score embeddings + TF-IDF (hybride)
 *
 * Optimisations de performance :
 *   - Lazy loading : les notebooks ne sont chargés en RAM qu'à la première recherche
 *   - Normes pré-calculées : la norme de chaque vecteur est calculée une seule fois
 *     à l'insertion, éliminant ~50% du coût de chaque calcul cosinus
 *   - Persist async + debounce : les écritures disque sont asynchrones et regroupées
 *     (max une écriture toutes les PERSIST_DEBOUNCE_MS par notebook)
 *   - Skip chunks déjà vectorisés : indexChunks filtre les chunks présents en RAM
 *   - BATCH_DELAY adaptatif : délai réduit à 200 ms (taux d'erreur dicte le throttling)
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../utils/logger.js";
import { withGeminiRetry } from "../utils/geminiKeyPool.js";
import { SELF_ROOT } from "../utils/selfRoot.js";

const log = createLogger("EmbeddingStore");

// ─── Configuration ──────────────────────────────────────────────────────────

/** Modèle d'embedding Gemini */
const EMBEDDING_MODEL = "gemini-embedding-001";

/** Dimensionalité des vecteurs (256 = bon compromis performance/qualité) */
const EMBEDDING_DIMENSIONS = 256;

/** Nombre maximum de textes par batch (limite API Gemini) */
const BATCH_SIZE = 100;

/**
 * Délai entre les batches pour respecter les rate limits.
 * Réduit à 200 ms (était 500 ms) — la gestion d'erreur + retry s'occupe du throttling réel.
 */
const BATCH_DELAY_MS = 200;

/**
 * Fenêtre de debounce pour la persistence disque.
 * Plusieurs appels à persistNotebook() dans cette fenêtre → une seule écriture.
 */
const PERSIST_DEBOUNCE_MS = 1_500;

// ─── Persistence ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(
  process.env.Leanna_CONFIG_PATH || process.env.ELECTRON_APP_PATH || SELF_ROOT || process.cwd(),
  ".Leanna",
  "notebooks",
  "embeddings"
);

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoredEmbedding {
  chunkId: string;
  sourceId: string;
  notebookId: string;
  vector: number[];
  /** Norme L2 pré-calculée — évite de la recalculer à chaque recherche cosinus */
  norm: number;
}

interface EmbeddingIndex {
  version: number;
  model: string;
  dimensions: number;
  entries: StoredEmbedding[];
}

// ═══════════════════════════════════════════════════════════════════════════════

export class EmbeddingStore {
  /** Index en mémoire : chunkId → vecteur + norme pré-calculée */
  private vectors: Map<string, StoredEmbedding> = new Map();
  /** Cache des embeddings de queries récentes */
  private queryCache: Map<string, number[]> = new Map();
  private readonly queryCacheMaxSize = 100;

  /** Limite mémoire : nombre max de vecteurs en RAM (0 = illimité) */
  private maxVectorsInMemory: number;
  /** Notebooks chargés en mémoire (pour éviction LRU) */
  private loadedNotebooks: Map<string, { accessedAt: number; vectorCount: number }> = new Map();
  /** Timers de debounce par notebookId pour la persistence async */
  private persistTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(options?: { maxVectorsInMemory?: number }) {
    this.maxVectorsInMemory = options?.maxVectorsInMemory ?? 50_000;
    // Pas de loadIndex() au démarrage — lazy loading à la demande
    ensureDataDir();
    log.info("EmbeddingStore initialisé (lazy-load activé)");
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private getIndexPath(notebookId: string): string {
    return path.join(DATA_DIR, `${notebookId}.json`);
  }

  /**
   * Charge les embeddings d'un notebook en mémoire (lazy loading).
   * Appelé automatiquement lors d'une recherche ou indexation si le notebook n'est pas en RAM.
   * N'effectue aucune I/O si le notebook est déjà chargé.
   */
  private ensureNotebookLoaded(notebookId: string): void {
    if (this.loadedNotebooks.has(notebookId)) {
      // Mettre à jour le timestamp d'accès (LRU)
      this.loadedNotebooks.get(notebookId)!.accessedAt = Date.now();
      return;
    }

    const filePath = this.getIndexPath(notebookId);
    if (!fs.existsSync(filePath)) return;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const index: EmbeddingIndex = JSON.parse(raw);

      if (index.dimensions !== EMBEDDING_DIMENSIONS || index.model !== EMBEDDING_MODEL) {
        log.debug(`Notebook ${notebookId.slice(0, 8)} ignoré (modèle/dimensions différent)`);
        return;
      }

      let count = 0;
      for (const entry of index.entries) {
        if (!this.vectors.has(entry.chunkId)) {
          // Recalculer la norme si absente (compat. fichiers anciens sans norme)
          const norm = entry.norm > 0 ? entry.norm : this.computeNorm(entry.vector);
          this.vectors.set(entry.chunkId, { ...entry, norm });
          count++;
        }
      }

      this.loadedNotebooks.set(notebookId, { accessedAt: Date.now(), vectorCount: count });
      this.enforceMemoryLimit();

      log.debug(`📥 Notebook ${notebookId.slice(0, 8)} chargé en mémoire (${count} vecteurs)`);
    } catch (e: any) {
      log.warn(`Erreur chargement notebook ${notebookId}: ${e.message}`);
    }
  }

  /**
   * Éviction LRU des notebooks les moins récemment accédés
   * quand la mémoire dépasse le seuil configuré.
   */
  private enforceMemoryLimit(): void {
    if (this.maxVectorsInMemory <= 0) return;
    if (this.vectors.size <= this.maxVectorsInMemory) return;

    const sorted = [...this.loadedNotebooks.entries()]
      .sort((a, b) => a[1].accessedAt - b[1].accessedAt);

    let evicted = 0;
    for (const [notebookId] of sorted) {
      if (this.vectors.size <= this.maxVectorsInMemory * 0.8) break;

      const toDelete: string[] = [];
      for (const [chunkId, entry] of this.vectors) {
        if (entry.notebookId === notebookId) toDelete.push(chunkId);
      }
      for (const id of toDelete) this.vectors.delete(id);

      this.loadedNotebooks.delete(notebookId);
      evicted += toDelete.length;
      log.debug(`♻️ Éviction mémoire: notebook ${notebookId.slice(0, 8)} (${toDelete.length} vecteurs)`);
    }

    if (evicted > 0) {
      log.info(`♻️ Mémoire libérée: ${evicted} vecteurs évincés (reste: ${this.vectors.size})`);
    }
  }

  /**
   * Planifie une écriture disque async + debouncée pour un notebook.
   * Plusieurs appels dans PERSIST_DEBOUNCE_MS → une seule écriture effective.
   */
  private persistNotebook(notebookId: string): void {
    // Annuler le timer précédent s'il existe
    const existing = this.persistTimers.get(notebookId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.persistTimers.delete(notebookId);
      this.flushNotebook(notebookId);
    }, PERSIST_DEBOUNCE_MS);

    this.persistTimers.set(notebookId, timer);
  }

  /** Écrit immédiatement le notebook sur disque (async, non-bloquant). */
  private flushNotebook(notebookId: string): void {
    ensureDataDir();
    const entries: StoredEmbedding[] = [];
    for (const entry of this.vectors.values()) {
      if (entry.notebookId === notebookId) entries.push(entry);
    }

    const index: EmbeddingIndex = {
      version: 1,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      entries,
    };

    const filePath = this.getIndexPath(notebookId);
    fs.writeFile(filePath, JSON.stringify(index), "utf-8", (err) => {
      if (err) log.warn(`Erreur persistence notebook ${notebookId.slice(0, 8)}: ${err.message}`);
      else log.debug(`💾 Notebook ${notebookId.slice(0, 8)} persisté (${entries.length} vecteurs)`);
    });
  }

  /**
   * Force l'écriture immédiate de tous les notebooks en attente.
   * À appeler avant la fermeture de l'application.
   */
  flushAll(): void {
    for (const [notebookId, timer] of this.persistTimers) {
      clearTimeout(timer);
      this.persistTimers.delete(notebookId);
      this.flushNotebook(notebookId);
    }
  }

  /**
   * Retourne les statistiques mémoire du store.
   */
  getMemoryStats(): {
    vectorsInMemory: number;
    maxVectors: number;
    usagePercent: number;
    loadedNotebooks: number;
    estimatedMemoryMB: number;
    pendingFlushes: number;
  } {
    const estimatedBytes = this.vectors.size * EMBEDDING_DIMENSIONS * 4;
    return {
      vectorsInMemory: this.vectors.size,
      maxVectors: this.maxVectorsInMemory,
      usagePercent: this.maxVectorsInMemory > 0 ? (this.vectors.size / this.maxVectorsInMemory) * 100 : 0,
      loadedNotebooks: this.loadedNotebooks.size,
      estimatedMemoryMB: Math.round(estimatedBytes / (1024 * 1024) * 100) / 100,
      pendingFlushes: this.persistTimers.size,
    };
  }

  // ─── Génération d'embeddings ─────────────────────────────────────────────

  /**
   * Vectorise un ensemble de textes via l'API Gemini embeddings.
   * Gère le batching automatique pour les grands ensembles.
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      try {
        const response = await withGeminiRetry(async (ai) => {
          return ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: batch,
            config: { outputDimensionality: EMBEDDING_DIMENSIONS },
          });
        });

        if (response.embeddings) {
          for (const embedding of response.embeddings) {
            allVectors.push(embedding.values || []);
          }
        } else {
          for (let j = 0; j < batch.length; j++) allVectors.push([]);
        }
      } catch (e: any) {
        log.error(`Erreur embedding batch ${i}-${i + batch.length}: ${e.message}`);
        for (let j = 0; j < batch.length; j++) allVectors.push([]);
      }

      // Délai réduit entre les batches (200 ms au lieu de 500 ms)
      if (i + BATCH_SIZE < texts.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    return allVectors;
  }

  /**
   * Vectorise un seul texte (query) avec cache LRU.
   */
  async embedQuery(query: string): Promise<number[]> {
    const cached = this.queryCache.get(query);
    if (cached) return cached;

    const vectors = await this.embedTexts([query]);
    const vector = vectors[0] || [];

    if (this.queryCache.size >= this.queryCacheMaxSize) {
      const firstKey = this.queryCache.keys().next().value;
      if (firstKey !== undefined) this.queryCache.delete(firstKey);
    }
    this.queryCache.set(query, vector);

    return vector;
  }

  // ─── Indexation de chunks ────────────────────────────────────────────────

  /**
   * Indexe les chunks d'une source (calcule et stocke les embeddings).
   *
   * Optimisations :
   *   - Filtre les chunks déjà présents en RAM (skip re-vectorisation inutile)
   *   - Pré-calcule la norme L2 à l'insertion pour accélérer les recherches
   *   - Persiste via debounce async (non-bloquant)
   */
  async indexChunks(
    chunks: { id: string; content: string }[],
    sourceId: string,
    notebookId: string
  ): Promise<number> {
    if (chunks.length === 0) return 0;

    // S'assurer que le notebook est en mémoire avant de dédupliquer
    this.ensureNotebookLoaded(notebookId);

    // Filtrer les chunks déjà vectorisés (évite les appels API redondants)
    const newChunks = chunks.filter(c => !this.vectors.has(c.id));

    if (newChunks.length === 0) {
      log.info(`⏭️ Tous les chunks déjà vectorisés pour source ${sourceId.slice(0, 8)}, skip`);
      return chunks.length;
    }

    const skipped = chunks.length - newChunks.length;
    if (skipped > 0) {
      log.info(`⏭️ ${skipped} chunks déjà vectorisés, ${newChunks.length} à traiter`);
    }

    log.info(`🔢 Vectorisation de ${newChunks.length} chunks (source: ${sourceId.slice(0, 8)})`);

    // Tronquer à 2048 chars (limite Gemini ~2048 tokens)
    const texts = newChunks.map(c => c.content.slice(0, 2048));

    const vectors = await this.embedTexts(texts);

    let indexed = 0;
    for (let i = 0; i < newChunks.length; i++) {
      const vector = vectors[i];
      if (vector && vector.length > 0) {
        this.vectors.set(newChunks[i].id, {
          chunkId: newChunks[i].id,
          sourceId,
          notebookId,
          vector,
          norm: this.computeNorm(vector), // pré-calcul norme
        });
        indexed++;
      }
    }

    // Persister de façon asynchrone avec debounce
    this.persistNotebook(notebookId);

    log.info(`✅ ${indexed}/${newChunks.length} nouveaux chunks vectorisés (source: ${sourceId.slice(0, 8)})`);
    return indexed + skipped;
  }

  /**
   * Supprime tous les embeddings d'une source.
   */
  removeSource(sourceId: string, notebookId: string): void {
    const toDelete: string[] = [];
    for (const [chunkId, entry] of this.vectors) {
      if (entry.sourceId === sourceId) toDelete.push(chunkId);
    }
    for (const id of toDelete) this.vectors.delete(id);
    this.persistNotebook(notebookId);
  }

  /**
   * Supprime tous les embeddings d'un notebook.
   */
  removeNotebook(notebookId: string): void {
    // Annuler le flush en attente
    const timer = this.persistTimers.get(notebookId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(notebookId);
    }

    const toDelete: string[] = [];
    for (const [chunkId, entry] of this.vectors) {
      if (entry.notebookId === notebookId) toDelete.push(chunkId);
    }
    for (const id of toDelete) this.vectors.delete(id);
    this.loadedNotebooks.delete(notebookId);

    const filePath = this.getIndexPath(notebookId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  // ─── Recherche par similarité ────────────────────────────────────────────

  /**
   * Recherche les chunks les plus similaires à un vecteur query.
   *
   * Optimisation : utilise la norme pré-calculée de chaque vecteur stocké,
   * ce qui évite de recalculer sqrt(sum(b²)) à chaque comparaison.
   * La norme de la query est calculée une seule fois avant la boucle.
   */
  searchByVector(
    queryVector: number[],
    options: {
      notebookId?: string;
      sourceIds?: string[];
      maxResults?: number;
      minSimilarity?: number;
    } = {}
  ): { chunkId: string; sourceId: string; similarity: number }[] {
    const maxResults = options.maxResults ?? 10;
    const minSimilarity = options.minSimilarity ?? 0.3;

    if (queryVector.length === 0) return [];

    // Lazy load : s'assurer que le notebook est en mémoire
    if (options.notebookId) {
      this.ensureNotebookLoaded(options.notebookId);
    }

    // Pré-calculer la norme de la query (une seule fois pour toute la boucle)
    const queryNorm = this.computeNorm(queryVector);
    if (queryNorm === 0) return [];

    const results: { chunkId: string; sourceId: string; similarity: number }[] = [];

    for (const [chunkId, entry] of this.vectors) {
      if (options.notebookId && entry.notebookId !== options.notebookId) continue;
      if (options.sourceIds && !options.sourceIds.includes(entry.sourceId)) continue;
      if (entry.vector.length === 0 || entry.norm === 0) continue;

      const similarity = this.cosineSimilarityWithNorms(queryVector, entry.vector, queryNorm, entry.norm);
      if (similarity >= minSimilarity) {
        results.push({ chunkId, sourceId: entry.sourceId, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }

  /**
   * Recherche sémantique complète : vectorise la query puis cherche.
   */
  async search(
    query: string,
    options: {
      notebookId?: string;
      sourceIds?: string[];
      maxResults?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<{ chunkId: string; sourceId: string; similarity: number }[]> {
    const queryVector = await this.embedQuery(query);
    if (queryVector.length === 0) return [];
    return this.searchByVector(queryVector, options);
  }

  // ─── Vérification de disponibilité ───────────────────────────────────────

  hasEmbedding(chunkId: string): boolean {
    return this.vectors.has(chunkId);
  }

  get size(): number {
    return this.vectors.size;
  }

  getStats(notebookId?: string): { total: number; bySource: Map<string, number> } {
    const bySource = new Map<string, number>();
    let total = 0;

    for (const entry of this.vectors.values()) {
      if (notebookId && entry.notebookId !== notebookId) continue;
      total++;
      bySource.set(entry.sourceId, (bySource.get(entry.sourceId) || 0) + 1);
    }

    return { total, bySource };
  }

  // ─── Math vectorielle ────────────────────────────────────────────────────

  /** Calcule la norme L2 d'un vecteur. */
  private computeNorm(v: number[]): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    return Math.sqrt(sum);
  }

  /**
   * Similarité cosinus avec normes pré-calculées.
   * Évite deux sqrt() par rapport à l'ancienne implémentation naïve.
   */
  private cosineSimilarityWithNorms(
    a: number[],
    b: number[],
    normA: number,
    normB: number
  ): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const denominator = normA * normB;
    if (denominator === 0) return 0;

    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) dotProduct += a[i] * b[i];
    return dotProduct / denominator;
  }
}

// Singleton
export const embeddingStore = new EmbeddingStore();
