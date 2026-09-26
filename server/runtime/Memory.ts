/**
 * Memory — Mémoire hiérarchique à 4 niveaux
 * 
 * Architecture :
 *   Working Memory  → volatile, durée de vie = tâche en cours
 *   Session Memory  → durée de vie = session (conversation)
 *   Project Memory  → persisté localement (fichier JSON)
 *   Long-term Memory → persisté en BDD (Supabase)
 * 
 * Chaque niveau a sa politique de rétention et son mécanisme de stockage.
 * L'API est unifiée : get/set/search avec un paramètre `level`.
 */

import type { MemoryLevel, MemoryEntry } from "./types.js";
import type { EventBus } from "./EventBus.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface MemoryConfig {
  /** Taille max de la working memory (entrées) */
  workingCapacity?: number;
  /** Taille max de la session memory (entrées) */
  sessionCapacity?: number;
  /** Fonction de persistance pour le niveau project */
  projectPersist?: (entries: MemoryEntry[]) => Promise<void>;
  /** Fonction de chargement pour le niveau project */
  projectLoad?: () => Promise<MemoryEntry[]>;
  /** Fonction de persistance pour le niveau longterm */
  longtermPersist?: (entry: MemoryEntry) => Promise<void>;
  /** Fonction de recherche pour le niveau longterm */
  longtermSearch?: (query: string, limit: number) => Promise<MemoryEntry[]>;
  /** EventBus pour émettre les mises à jour */
  eventBus?: EventBus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════════════════════

export class Memory {
  private working = new Map<string, MemoryEntry>();
  private session = new Map<string, MemoryEntry>();
  private project = new Map<string, MemoryEntry>();

  private workingCapacity: number;
  private sessionCapacity: number;
  private eventBus?: EventBus;

  // Callbacks de persistance
  private projectPersist?: (entries: MemoryEntry[]) => Promise<void>;
  private projectLoad?: () => Promise<MemoryEntry[]>;
  private longtermPersist?: (entry: MemoryEntry) => Promise<void>;
  private longtermSearch?: (query: string, limit: number) => Promise<MemoryEntry[]>;

  constructor(config: MemoryConfig = {}) {
    this.workingCapacity = config.workingCapacity ?? 100;
    this.sessionCapacity = config.sessionCapacity ?? 500;
    this.eventBus = config.eventBus;
    this.projectPersist = config.projectPersist;
    this.projectLoad = config.projectLoad;
    this.longtermPersist = config.longtermPersist;
    this.longtermSearch = config.longtermSearch;
  }

  // ─── API unifiée ───────────────────────────────────────────────────────────

  /**
   * Stocke une entrée au niveau spécifié.
   */
  async set(level: MemoryLevel, key: string, value: unknown, opts?: { ttl?: number; tags?: string[] }): Promise<void> {
    const now = Date.now();
    const entry: MemoryEntry = {
      key,
      value,
      level,
      createdAt: now,
      updatedAt: now,
      ttl: opts?.ttl,
      tags: opts?.tags,
    };

    switch (level) {
      case "working":
        this.evictIfFull(this.working, this.workingCapacity);
        this.working.set(key, entry);
        break;

      case "session":
        this.evictIfFull(this.session, this.sessionCapacity);
        this.session.set(key, entry);
        break;

      case "project":
        this.project.set(key, entry);
        // Persistance asynchrone
        if (this.projectPersist) {
          this.projectPersist(Array.from(this.project.values())).catch(() => {});
        }
        break;

      case "longterm":
        if (this.longtermPersist) {
          await this.longtermPersist(entry);
        }
        break;
    }

    this.eventBus?.emit({ type: "memory:updated", level, key });
  }

  /**
   * Récupère une entrée par clé et niveau.
   * Retourne undefined si non trouvée ou expirée.
   */
  get(level: MemoryLevel, key: string): unknown | undefined {
    const store = this.getStore(level);
    if (!store) return undefined;

    const entry = store.get(key);
    if (!entry) return undefined;

    // Vérification TTL
    if (entry.ttl && Date.now() - entry.updatedAt > entry.ttl) {
      store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Supprime une entrée.
   */
  delete(level: MemoryLevel, key: string): boolean {
    const store = this.getStore(level);
    return store?.delete(key) ?? false;
  }

  /**
   * Recherche dans un niveau par tags ou préfixe de clé.
   */
  search(level: MemoryLevel, query: { prefix?: string; tags?: string[]; limit?: number }): MemoryEntry[] {
    const store = this.getStore(level);
    if (!store) return [];

    const limit = query.limit ?? 20;
    const results: MemoryEntry[] = [];
    const now = Date.now();

    for (const entry of store.values()) {
      // Expiration
      if (entry.ttl && now - entry.updatedAt > entry.ttl) continue;

      // Filtrage par préfixe
      if (query.prefix && !entry.key.startsWith(query.prefix)) continue;

      // Filtrage par tags
      if (query.tags?.length) {
        if (!entry.tags?.some((t) => query.tags!.includes(t))) continue;
      }

      results.push(entry);
      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Recherche sémantique dans la mémoire long-terme (via callback).
   */
  async searchLongterm(query: string, limit = 10): Promise<MemoryEntry[]> {
    if (!this.longtermSearch) return [];
    return this.longtermSearch(query, limit);
  }

  // ─── Gestion du cycle de vie ───────────────────────────────────────────────

  /**
   * Vide la working memory (fin de tâche).
   */
  clearWorking(): void {
    this.working.clear();
  }

  /**
   * Vide la session memory (fin de conversation).
   */
  clearSession(): void {
    this.session.clear();
  }

  /**
   * Vide un niveau spécifique de mémoire.
   */
  clear(level: MemoryLevel): void {
    const store = this.getStore(level);
    if (store) store.clear();
  }

  /**
   * Liste toutes les entrées valides (non expirées) pour un niveau donné.
   */
  list(level: MemoryLevel): MemoryEntry[] {
    const store = this.getStore(level);
    if (!store) return [];

    const now = Date.now();
    const result: MemoryEntry[] = [];
    const expiredKeys: string[] = [];

    for (const [key, entry] of store.entries()) {
      if (entry.ttl && now - entry.updatedAt > entry.ttl) {
        expiredKeys.push(key);
      } else {
        result.push(entry);
      }
    }

    for (const key of expiredKeys) {
      store.delete(key);
    }

    return result;
  }

  /**
   * Charge la project memory depuis la persistance.
   */
  async loadProject(): Promise<void> {
    if (!this.projectLoad) return;
    const entries = await this.projectLoad();
    this.project.clear();
    for (const entry of entries) {
      this.project.set(entry.key, entry);
    }
  }

  /**
   * Retourne les statistiques de la mémoire.
   */
  getStats(): Record<MemoryLevel, number> {
    return {
      working: this.working.size,
      session: this.session.size,
      project: this.project.size,
      longterm: -1, // Inconnu sans requête BDD
    };
  }

  /**
   * Promeut une entrée d'un niveau inférieur vers un niveau supérieur.
   * Utile pour les informations qui deviennent permanentes.
   */
  async promote(key: string, from: MemoryLevel, to: MemoryLevel): Promise<boolean> {
    const store = this.getStore(from);
    if (!store) return false;

    const entry = store.get(key);
    if (!entry) return false;

    await this.set(to, key, entry.value, { tags: entry.tags });
    store.delete(key);
    return true;
  }

  // ─── Privé ───────────────────────────────────────────────────────────────

  private getStore(level: MemoryLevel): Map<string, MemoryEntry> | null {
    switch (level) {
      case "working": return this.working;
      case "session": return this.session;
      case "project": return this.project;
      case "longterm": return null; // Long-term n'a pas de store local
    }
  }

  private evictIfFull(store: Map<string, MemoryEntry>, capacity: number): void {
    if (store.size < capacity) return;

    // Stratégie LRU simple : supprimer les plus anciennes
    const entries = Array.from(store.entries())
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

    const toRemove = Math.max(1, Math.floor(capacity * 0.1)); // Supprimer 10%
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      store.delete(entries[i][0]);
    }
  }
}
