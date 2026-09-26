/**
 * HierarchicalMemoryService — Orchestrateur de mémoire unifiée à 3 niveaux
 * 
 * Paliers de mémoire :
 *   1. Court-terme (Session / Working) : mémoire volatile (RAM), rapide, gérée avec TTL et éviction LRU.
 *   2. Moyen-terme (Projet) : mémoire locale persistée (.project-memory.json), contexte repo, index BM25.
 *   3. Long-terme (Supabase) : mémoire persistante cloud avec embeddings vectoriels (gemini-embedding-2).
 * 
 * Fournit une API unifiée pour :
 *   - search : recherche cross-tiers ou ciblée
 *   - store : stockage dans le tier approprié
 *   - promote : promotion fluide d'un niveau inférieur vers un niveau supérieur
 *   - delete / clear : gestion du cycle de vie
 *   - getStats : métriques et état de santé des 3 paliers
 */

import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Memory } from "./Memory.js";
import { projectMemory, ProjectMemory } from "../knowledge/ProjectMemory.js";
import { createGeminiClient } from "../utils/geminiKeyPool.js";
import { createLogger } from "../utils/logger.js";
import type { ProjectFact, ProjectKnowledgeCategory } from "../knowledge/types.js";
import type { EventBus } from "./EventBus.js";

const log = createLogger("HierarchicalMemoryService");

export type HierarchicalTier = "session" | "project" | "longterm";

export interface HierarchicalMemoryItem {
  id: string;
  tier: HierarchicalTier;
  content: string;
  category?: string;
  tags: string[];
  confidence?: number;
  createdAt: string | number;
  updatedAt: string | number;
  ttl?: number;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface HierarchicalSearchOptions {
  tier?: HierarchicalTier | "all";
  tags?: string[];
  category?: string;
  limit?: number;
  matchThreshold?: number;
}

export interface HierarchicalStats {
  session: {
    count: number;
    capacity: number;
    status: "active" | "empty";
  };
  project: {
    count: number;
    status: "active" | "empty";
  };
  longterm: {
    count: number;
    status: "connected" | "disconnected" | "empty";
    error?: string;
  };
  total: number;
}

export interface HierarchicalStoreInput {
  key?: string;
  content: string;
  category?: string;
  tags?: string[];
  confidence?: number;
  ttl?: number; // ms pour la session
  metadata?: Record<string, unknown>;
}

export class HierarchicalMemoryService {
  private sessionStore: Memory;
  private projectStore: ProjectMemory;
  private eventBus?: EventBus;

  constructor(options: { sessionStore?: Memory; projectStore?: ProjectMemory; eventBus?: EventBus } = {}) {
    this.sessionStore = options.sessionStore ?? new Memory();
    this.projectStore = options.projectStore ?? projectMemory;
    this.eventBus = options.eventBus;
  }

  // ─── Helpers Supabase ────────────────────────────────────────────────────────

  private getSupabaseClient(): SupabaseClient | null {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) return null;
    try {
      return createClient(url, key);
    } catch {
      return null;
    }
  }

  // ─── Search Unifié ──────────────────────────────────────────────────────────

  /**
   * Recherche unifiée à travers les tiers spécifiés (ou tous par défaut).
   */
  async search(query: string, options: HierarchicalSearchOptions = {}): Promise<HierarchicalMemoryItem[]> {
    const targetTier = options.tier ?? "all";
    const limit = options.limit ?? 20;
    const results: HierarchicalMemoryItem[] = [];

    const searchSession = targetTier === "all" || targetTier === "session";
    const searchProject = targetTier === "all" || targetTier === "project";
    const searchLongterm = targetTier === "all" || targetTier === "longterm";

    // 1. Recherche Court-terme (Session)
    if (searchSession) {
      try {
        const sessionEntries = this.sessionStore.list("session");
        const lowerQuery = query.toLowerCase().trim();

        for (const entry of sessionEntries) {
          const contentStr = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
          const keyMatches = entry.key.toLowerCase().includes(lowerQuery);
          const contentMatches = !lowerQuery || contentStr.toLowerCase().includes(lowerQuery);
          const tagMatches = !options.tags?.length || options.tags.some(t => entry.tags?.includes(t));

          if ((keyMatches || contentMatches) && tagMatches) {
            results.push({
              id: entry.key,
              tier: "session",
              content: contentStr,
              tags: entry.tags || [],
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
              ttl: entry.ttl,
              score: lowerQuery && contentMatches ? 0.95 : 0.8,
            });
          }
        }
      } catch (err) {
        log.warn(`Erreur recherche session: ${(err as Error).message}`);
      }
    }

    // 2. Recherche Moyen-terme (Projet)
    if (searchProject) {
      try {
        let projectMatches: ProjectFact[] = [];
        if (query && query.trim()) {
          projectMatches = this.projectStore.searchFacts(query, limit * 2);
        } else {
          projectMatches = this.projectStore.getAllFacts(options.category as ProjectKnowledgeCategory | undefined);
        }

        // Filtrage supplémentaire si options spécifiées
        if (options.category) {
          projectMatches = projectMatches.filter(f => f.category === options.category);
        }
        if (options.tags?.length) {
          projectMatches = projectMatches.filter(f => f.tags && f.tags.some(t => options.tags!.includes(t)));
        }

        for (const fact of projectMatches) {
          results.push({
            id: fact.id,
            tier: "project",
            content: fact.content,
            category: fact.category,
            tags: fact.tags || [],
            confidence: fact.confidence,
            createdAt: fact.createdAt,
            updatedAt: fact.updatedAt,
            score: (fact as any).score ?? fact.confidence ?? 0.85,
            metadata: {
              sourceFile: fact.sourceFile,
              usageCount: fact.usageCount,
              isStructural: fact.isStructural,
            },
          });
        }
      } catch (err) {
        log.warn(`Erreur recherche projet: ${(err as Error).message}`);
      }
    }

    // 3. Recherche Long-terme (Supabase)
    if (searchLongterm) {
      const supabase = this.getSupabaseClient();
      if (supabase) {
        try {
          const matchThreshold = options.matchThreshold ?? 0.5;
          let remoteResults: any[] = [];

          const ai = createGeminiClient();
          if (query && ai) {
            try {
              const embedResponse = await ai.models.embedContent({
                model: "gemini-embedding-2",
                contents: query,
                config: { outputDimensionality: 768 },
              });
              const queryEmbedding = embedResponse.embeddings?.[0]?.values;

              if (queryEmbedding) {
                const { data, error } = await supabase.rpc("match_memories", {
                  query_embedding: queryEmbedding,
                  match_threshold: matchThreshold,
                  match_count: limit,
                });
                if (!error && Array.isArray(data)) {
                  remoteResults = data;
                }
              }
            } catch (embedErr) {
              log.warn(`Vector search failed, falling back to text query: ${(embedErr as Error).message}`);
            }
          }

          // Fallback textuel si pas de résultat vectoriel ou pas de query
          if (remoteResults.length === 0) {
            let q = supabase
              .from("memories")
              .select("id, content, tags, created_at, updated_at")
              .order("created_at", { ascending: false })
              .limit(limit);

            if (options.tags?.length) {
              q = q.contains("tags", options.tags);
            }
            if (query) {
              q = q.ilike("content", `%${query}%`);
            }

            const { data } = await q;
            if (data) remoteResults = data;
          }

          for (const item of remoteResults) {
            results.push({
              id: item.id,
              tier: "longterm",
              content: item.content,
              tags: item.tags || [],
              createdAt: item.created_at,
              updatedAt: item.updated_at || item.created_at,
              score: item.similarity ?? 0.8,
            });
          }
        } catch (err) {
          log.warn(`Erreur recherche longterm: ${(err as Error).message}`);
        }
      }
    }

    // Trier par score décroissant puis date décroissante
    results.sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (Math.abs(scoreDiff) > 0.05) return scoreDiff;
      const bDate = typeof b.updatedAt === "number" ? b.updatedAt : new Date(b.updatedAt).getTime();
      const aDate = typeof a.updatedAt === "number" ? a.updatedAt : new Date(a.updatedAt).getTime();
      return bDate - aDate;
    });

    return results.slice(0, limit);
  }

  // ─── List par Tier ──────────────────────────────────────────────────────────

  /**
   * Récupère la liste des mémoires d'un niveau donné.
   */
  async list(tier: HierarchicalTier, options: { limit?: number; offset?: number } = {}): Promise<HierarchicalMemoryItem[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    switch (tier) {
      case "session": {
        const entries = this.sessionStore.list("session");
        return entries.slice(offset, offset + limit).map((entry) => ({
          id: entry.key,
          tier: "session",
          content: typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value),
          tags: entry.tags || [],
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          ttl: entry.ttl,
        }));
      }

      case "project": {
        const facts = this.projectStore.getAllFacts();
        return facts.slice(offset, offset + limit).map((fact) => ({
          id: fact.id,
          tier: "project",
          content: fact.content,
          category: fact.category,
          tags: fact.tags || [],
          confidence: fact.confidence,
          createdAt: fact.createdAt,
          updatedAt: fact.updatedAt,
          metadata: {
            sourceFile: fact.sourceFile,
            usageCount: fact.usageCount,
            isStructural: fact.isStructural,
          },
        }));
      }

      case "longterm": {
        const supabase = this.getSupabaseClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("memories")
          .select("id, content, tags, created_at, updated_at")
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error || !data) return [];

        return data.map((row) => ({
          id: row.id,
          tier: "longterm",
          content: row.content,
          tags: row.tags || [],
          createdAt: row.created_at,
          updatedAt: row.updated_at || row.created_at,
        }));
      }
    }
  }

  // ─── Store ──────────────────────────────────────────────────────────────────

  /**
   * Stocke directement une information dans le tier choisi.
   */
  async store(tier: HierarchicalTier, input: HierarchicalStoreInput): Promise<HierarchicalMemoryItem> {
    const now = Date.now();
    const tags = input.tags || [];

    switch (tier) {
      case "session": {
        const key = input.key || `session_${randomUUID()}`;
        await this.sessionStore.set("session", key, input.content, {
          ttl: input.ttl,
          tags,
        });

        const item: HierarchicalMemoryItem = {
          id: key,
          tier: "session",
          content: input.content,
          tags,
          createdAt: now,
          updatedAt: now,
          ttl: input.ttl,
        };

        this.eventBus?.emit({ type: "memory:hierarchical:stored", tier, id: key });
        return item;
      }

      case "project": {
        const category = (input.category || "convention") as ProjectKnowledgeCategory;
        let id = this.projectStore.addFact({
          content: input.content,
          category,
          tags,
          confidence: input.confidence ?? 0.8,
        });

        let effectiveFact: ProjectFact | undefined;
        if (id) {
          this.projectStore.save();
          effectiveFact = this.projectStore.getFact(id);
        } else {
          // Déjà existant / doublon : retrouver le fait existant
          const normalized = input.content.toLowerCase().trim().slice(0, 80);
          effectiveFact = this.projectStore.getAllFacts().find(f =>
            f.category === category &&
            (f.content.toLowerCase().trim().slice(0, 80) === normalized ||
             f.content.toLowerCase().trim().slice(0, 80).includes(normalized) ||
             normalized.includes(f.content.toLowerCase().trim().slice(0, 80)))
          );
          if (effectiveFact) {
            id = effectiveFact.id;
            if (tags.length > 0) {
              this.projectStore.updateFact(id, { tags: [...new Set([...effectiveFact.tags, ...tags])] });
              this.projectStore.save();
            }
          } else {
            id = randomUUID();
          }
        }

        const item: HierarchicalMemoryItem = {
          id,
          tier: "project",
          content: effectiveFact?.content || input.content,
          category: effectiveFact?.category || category,
          tags: effectiveFact?.tags || tags,
          confidence: effectiveFact?.confidence ?? input.confidence ?? 0.8,
          createdAt: effectiveFact?.createdAt || new Date(now).toISOString(),
          updatedAt: effectiveFact?.updatedAt || new Date(now).toISOString(),
        };

        this.eventBus?.emit({ type: "memory:hierarchical:stored", tier, id: item.id });
        return item;
      }

      case "longterm": {
        const supabase = this.getSupabaseClient();
        if (!supabase) {
          throw new Error("Supabase n'est pas configuré (SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante).");
        }

        let embedding: number[] | undefined;
        try {
          const ai = createGeminiClient();
          if (ai) {
            const embedResponse = await ai.models.embedContent({
              model: "gemini-embedding-2",
              contents: input.content,
              config: { outputDimensionality: 768 },
            });
            embedding = embedResponse.embeddings?.[0]?.values;
          }
        } catch (embedErr) {
          log.warn(`Échec de génération de l'embedding: ${(embedErr as Error).message}`);
        }

        const payload: Record<string, unknown> = {
          content: input.content,
          tags,
        };
        if (embedding) {
          payload.embedding = embedding;
        }

        const { data, error } = await supabase
          .from("memories")
          .insert([payload])
          .select("id, content, tags, created_at, updated_at")
          .single();

        if (error || !data) {
          throw new Error(`Erreur Supabase lors du stockage: ${error?.message || "Inconnue"}`);
        }

        const item: HierarchicalMemoryItem = {
          id: data.id,
          tier: "longterm",
          content: data.content,
          tags: data.tags || [],
          createdAt: data.created_at,
          updatedAt: data.updated_at || data.created_at,
        };

        this.eventBus?.emit({ type: "memory:hierarchical:stored", tier, id: data.id });
        return item;
      }
    }
  }

  // ─── Promote ────────────────────────────────────────────────────────────────

  /**
   * Promeut une mémoire d'un niveau inférieur vers un niveau supérieur :
   *   - session -> project
   *   - session -> longterm
   *   - project -> longterm
   */
  async promote(
    id: string,
    fromTier: "session" | "project",
    toTier: "project" | "longterm",
    options: { category?: string; tags?: string[]; removeSource?: boolean } = {}
  ): Promise<HierarchicalMemoryItem> {
    if (fromTier === toTier) {
      throw new Error(`Le niveau source (${fromTier}) et destination (${toTier}) doivent être différents.`);
    }

    let sourceContent = "";
    let sourceTags: string[] = [];
    let sourceCategory = options.category;

    // 1. Récupération de la source
    if (fromTier === "session") {
      const raw = this.sessionStore.get("session", id);
      if (!raw) {
        throw new Error(`Entrée session introuvable pour l'id '${id}'`);
      }
      sourceContent = typeof raw === "string" ? raw : JSON.stringify(raw);
      // Récupérer tags depuis list
      const entry = this.sessionStore.list("session").find(e => e.key === id);
      if (entry?.tags) sourceTags = entry.tags;
    } else if (fromTier === "project") {
      const fact = this.projectStore.getFact(id);
      if (!fact) {
        throw new Error(`Fait projet introuvable pour l'id '${id}'`);
      }
      sourceContent = fact.content;
      sourceTags = fact.tags || [];
      sourceCategory = sourceCategory || fact.category;
    }

    const mergedTags = [...new Set([...sourceTags, ...(options.tags || []), `promoted-from-${fromTier}`])];

    // 2. Stockage dans le niveau supérieur
    const promotedItem = await this.store(toTier, {
      content: sourceContent,
      category: sourceCategory,
      tags: mergedTags,
      confidence: 0.9,
    });

    // 3. Optionnellement supprimer de la source
    if (options.removeSource) {
      await this.delete(fromTier, id);
    }

    this.eventBus?.emit({
      type: "memory:hierarchical:promoted",
      fromTier,
      toTier,
      sourceId: id,
      newId: promotedItem.id,
    });

    log.info(`Mémoire promue : [${fromTier}] ${id} ➔ [${toTier}] ${promotedItem.id}`);
    return promotedItem;
  }

  // ─── Delete & Clear ─────────────────────────────────────────────────────────

  /**
   * Supprime une mémoire d'un niveau spécifique.
   */
  async delete(tier: HierarchicalTier, id: string): Promise<boolean> {
    switch (tier) {
      case "session":
        return this.sessionStore.delete("session", id);

      case "project": {
        const deleted = this.projectStore.deleteFact(id);
        if (deleted) this.projectStore.save();
        return deleted;
      }

      case "longterm": {
        const supabase = this.getSupabaseClient();
        if (!supabase) return false;
        const { error } = await supabase.from("memories").delete().eq("id", id);
        return !error;
      }
    }
  }

  /**
   * Vide un niveau de mémoire.
   */
  async clear(tier: HierarchicalTier): Promise<boolean> {
    switch (tier) {
      case "session":
        this.sessionStore.clear("session");
        return true;

      case "project":
        this.projectStore.clear();
        this.projectStore.save();
        return true;

      case "longterm": {
        const supabase = this.getSupabaseClient();
        if (!supabase) return false;
        const { error } = await supabase
          .from("memories")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        return !error;
      }
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  /**
   * Retourne les statistiques d'utilisation et de santé des 3 paliers.
   */
  async getStats(): Promise<HierarchicalStats> {
    const sessionEntries = this.sessionStore.list("session");
    const projectFacts = this.projectStore.getAllFacts();

    let longtermCount = 0;
    let longtermStatus: "connected" | "disconnected" | "empty" = "disconnected";
    let longtermError: string | undefined;

    const supabase = this.getSupabaseClient();
    if (supabase) {
      try {
        const { count, error } = await supabase
          .from("memories")
          .select("*", { count: "exact", head: true });

        if (error) {
          longtermStatus = "disconnected";
          longtermError = error.message;
        } else {
          longtermCount = count ?? 0;
          longtermStatus = "connected";
        }
      } catch (e: any) {
        longtermStatus = "disconnected";
        longtermError = e.message;
      }
    }

    return {
      session: {
        count: sessionEntries.length,
        capacity: 500,
        status: sessionEntries.length > 0 ? "active" : "empty",
      },
      project: {
        count: projectFacts.length,
        status: projectFacts.length > 0 ? "active" : "empty",
      },
      longterm: {
        count: longtermCount,
        status: longtermStatus,
        error: longtermError,
      },
      total: sessionEntries.length + projectFacts.length + longtermCount,
    };
  }
}

// Instance globale singleton
export const hierarchicalMemoryService = new HierarchicalMemoryService();
