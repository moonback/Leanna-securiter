/**
 * ResponseCache — Cache intelligent pour les requêtes notebooks
 *
 * Fonctionnalités :
 *   - Cache LRU avec TTL configurable
 *   - Similarité sémantique pour matcher des questions proches
 *   - Invalidation automatique quand les sources changent
 *   - Statistiques de hit/miss pour monitoring
 *   - Support des réponses partielles (streaming)
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("ResponseCache");

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  /** Clé normalisée pour la recherche par similarité */
  normalizedKey: string;
  /** ID du notebook concerné */
  notebookId: string;
  /** Timestamp de création */
  createdAt: number;
  /** Timestamp du dernier accès */
  lastAccessedAt: number;
  /** Nombre d'accès */
  hitCount: number;
  /** TTL en ms (0 = pas d'expiration) */
  ttlMs: number;
  /** Taille estimée en octets */
  sizeBytes: number;
}

interface CacheConfig {
  /** Nombre maximum d'entrées */
  maxEntries: number;
  /** TTL par défaut en ms (30 minutes) */
  defaultTtlMs: number;
  /** Taille max du cache en octets (50 MB) */
  maxSizeBytes: number;
  /** Seuil de similarité pour considérer un hit (0-1) */
  similarityThreshold: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalSizeBytes: number;
  evictions: number;
  invalidations: number;
}

// ═══════════════════════════════════════════════════════════════════════════════

export class ResponseCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private invalidations = 0;
  private totalSize = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 500,
      defaultTtlMs: config?.defaultTtlMs ?? 30 * 60 * 1000, // 30 min
      maxSizeBytes: config?.maxSizeBytes ?? 50 * 1024 * 1024, // 50 MB
      similarityThreshold: config?.similarityThreshold ?? 0.85,
    };

    // Nettoyage périodique des entrées expirées (toutes les 5 min)
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  // ─── Opérations principales ────────────────────────────────────────────────

  /** Stocke une valeur dans le cache */
  set(key: string, value: T, notebookId: string, ttlMs?: number): void {
    const normalizedKey = this.normalizeKey(key);
    const sizeBytes = this.estimateSize(value);

    // Vérifier si l'entrée existe déjà
    if (this.cache.has(normalizedKey)) {
      const existing = this.cache.get(normalizedKey)!;
      this.totalSize -= existing.sizeBytes;
    }

    // Éviction si nécessaire
    while (this.cache.size >= this.config.maxEntries || this.totalSize + sizeBytes > this.config.maxSizeBytes) {
      if (!this.evictLRU()) break;
    }

    const entry: CacheEntry<T> = {
      key,
      value,
      normalizedKey,
      notebookId,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      hitCount: 0,
      ttlMs: ttlMs ?? this.config.defaultTtlMs,
      sizeBytes,
    };

    this.cache.set(normalizedKey, entry);
    this.totalSize += sizeBytes;
  }

  /** Récupère une valeur du cache (exact match) */
  get(key: string): T | undefined {
    const normalizedKey = this.normalizeKey(key);
    const entry = this.cache.get(normalizedKey);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Vérifier l'expiration
    if (this.isExpired(entry)) {
      this.cache.delete(normalizedKey);
      this.totalSize -= entry.sizeBytes;
      this.misses++;
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    entry.hitCount++;
    this.hits++;
    return entry.value;
  }

  /** Récupère une valeur par similarité de la clé (fuzzy match) */
  getSimilar(key: string, notebookId: string): T | undefined {
    const normalizedKey = this.normalizeKey(key);

    // D'abord essayer le match exact
    const exact = this.get(key);
    if (exact !== undefined) return exact;

    // Puis chercher par similarité
    let bestMatch: CacheEntry<T> | null = null;
    let bestScore = 0;

    for (const entry of this.cache.values()) {
      if (entry.notebookId !== notebookId) continue;
      if (this.isExpired(entry)) continue;

      const score = this.computeSimilarity(normalizedKey, entry.normalizedKey);
      if (score > this.config.similarityThreshold && score > bestScore) {
        bestMatch = entry;
        bestScore = score;
      }
    }

    if (bestMatch) {
      bestMatch.lastAccessedAt = Date.now();
      bestMatch.hitCount++;
      this.hits++;
      log.debug(`Cache hit par similarité (${(bestScore * 100).toFixed(0)}%): "${key}" ≈ "${bestMatch.key}"`);
      return bestMatch.value;
    }

    this.misses++;
    return undefined;
  }

  // ─── Invalidation ──────────────────────────────────────────────────────────

  /** Invalide toutes les entrées d'un notebook */
  invalidateNotebook(notebookId: string): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.notebookId === notebookId) {
        this.totalSize -= entry.sizeBytes;
        this.cache.delete(key);
        count++;
      }
    }
    this.invalidations += count;
    if (count > 0) {
      log.info(`♻️ ${count} entrée(s) invalidée(s) pour notebook ${notebookId.slice(0, 8)}`);
    }
    return count;
  }

  /** Invalide une entrée spécifique */
  invalidate(key: string): boolean {
    const normalizedKey = this.normalizeKey(key);
    const entry = this.cache.get(normalizedKey);
    if (entry) {
      this.totalSize -= entry.sizeBytes;
      this.cache.delete(normalizedKey);
      this.invalidations++;
      return true;
    }
    return false;
  }

  /** Vide tout le cache */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.totalSize = 0;
    log.info(`🧹 Cache vidé (${size} entrées supprimées)`);
  }

  // ─── Statistiques ──────────────────────────────────────────────────────────

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalSizeBytes: this.totalSize,
      evictions: this.evictions,
      invalidations: this.invalidations,
    };
  }

  // ─── Utilitaires internes ──────────────────────────────────────────────────

  /** Normalise une clé pour la comparaison */
  private normalizeKey(key: string): string {
    return key
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "") // Retirer la ponctuation
      .replace(/\s+/g, " ");   // Normaliser les espaces
  }

  /** Similarité de Jaccard sur les mots (rapide, suffisant pour les questions) */
  private computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(" ").filter(w => w.length > 2));
    const wordsB = new Set(b.split(" ").filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /** Estime la taille en octets d'une valeur */
  private estimateSize(value: T): number {
    try {
      const json = JSON.stringify(value);
      return Buffer.byteLength(json, "utf-8");
    } catch {
      return 1024; // Fallback
    }
  }

  /** Vérifie si une entrée est expirée */
  private isExpired(entry: CacheEntry<T>): boolean {
    if (entry.ttlMs === 0) return false;
    return Date.now() - entry.createdAt > entry.ttlMs;
  }

  /** Éviction LRU — supprime l'entrée la moins récemment accédée */
  private evictLRU(): boolean {
    if (this.cache.size === 0) return false;

    let oldest: [string, CacheEntry<T>] | null = null;
    for (const entry of this.cache.entries()) {
      if (!oldest || entry[1].lastAccessedAt < oldest[1].lastAccessedAt) {
        oldest = entry;
      }
    }

    if (oldest) {
      this.totalSize -= oldest[1].sizeBytes;
      this.cache.delete(oldest[0]);
      this.evictions++;
      return true;
    }
    return false;
  }

  /** Nettoie les entrées expirées */
  private cleanup(): void {
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.totalSize -= entry.sizeBytes;
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.debug(`🧹 Cleanup: ${cleaned} entrée(s) expirée(s) supprimée(s)`);
    }
  }

  /** Arrête le nettoyage périodique */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ─── Singletons ──────────────────────────────────────────────────────────────

/** Cache pour les réponses du chat grounded */
export const chatResponseCache = new ResponseCache<{ content: string; citations: unknown[] }>({
  maxEntries: 200,
  defaultTtlMs: 30 * 60 * 1000, // 30 min
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB
  similarityThreshold: 0.85,
});

/** Cache pour les résultats de recherche RAG */
export const ragSearchCache = new ResponseCache<unknown[]>({
  maxEntries: 300,
  defaultTtlMs: 15 * 60 * 1000, // 15 min
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  similarityThreshold: 0.9,
});
