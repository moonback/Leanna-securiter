import { Skill, validateArgs } from "./base.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createGeminiClient } from "../utils/geminiKeyPool.js";

// Cache simple en mémoire pour les embeddings et les résultats de recherche
const memoryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cherche une mémoire sémantiquement proche ET partageant au moins un tag commun.
 * Si `tags` est vide, la correspondance de tag est ignorée (comportement legacy).
 */
async function findSimilarMemory(
  supabase: any,
  embedding: number[],
  tags: string[]
): Promise<{ id: string; content: string; tags: string[]; similarity: number } | null> {
  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: embedding,
    match_threshold: 0.85,
    match_count: 5,
  });

  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) return null;

  // Si on a des tags, on préfère une mémoire qui en partage au moins un
  if (tags.length > 0) {
    const withCommonTag = data.find((m: any) =>
      Array.isArray(m.tags) && m.tags.some((t: string) => tags.includes(t))
    );
    if (withCommonTag) return withCommonTag;
  }

  // Sinon retourne le plus proche uniquement si la similarité est très haute (>= 0.92)
  const top = data[0];
  return top.similarity >= 0.92 ? top : null;
}

export const memorySkill: Skill = {
  name: "memory",
  declarations: [
    {
      name: "save_memory",
      description:
        "Sauvegarder une information importante dans la mémoire à long terme (Supabase). " +
        "UTILISE CET OUTIL PROACTIVEMENT dès qu'une de ces catégories est détectée dans la conversation : " +
        "préférences (technique, alimentaire, style de communication), " +
        "identité (nom, rôle, entreprise, localisation, fuseau horaire), " +
        "habitudes et routines (sport, sommeil, rythme de travail), " +
        "dates importantes (anniversaires, deadlines, rendez-vous récurrents), " +
        "personnes mentionnées (prénom + relation + contexte), " +
        "projets actifs (nom, objectif, stack, décisions clés), " +
        "contraintes (allergies, aversions, limites à respecter), " +
        "décisions importantes (architecturales, personnelles, stratégiques), " +
        "objectifs (OKR, résolutions, intentions déclarées). " +
        "Écris un contenu AUTOPORTANT en phrase complète (ex: 'Maysson préfère TypeScript car il apprécie la sécurité des types'). " +
        "Une mémoire sémantiquement proche ET partageant un tag commun est mise à jour au lieu d'être dupliquée. " +
        "Tags recommandés : 'user-preference', 'user-identity', 'user-habit', 'user-goal', 'user-constraint', " +
        "'user-relationship', 'project-context', 'decision', 'date-important', 'technical-preference', 'personality'.",
      parameters: {
        type: "OBJECT",
        properties: {
          content: {
            type: "STRING",
            description: "L'information à sauvegarder. Soyez précis et concis.",
          },
          tags: {
            type: "ARRAY",
            description:
              "Tags pour classifier la mémoire. Utilisez des tags normalisés : 'user-preference', 'project-knowledge', 'stack', 'convention', 'decision', 'context'.",
            items: { type: "STRING" },
          },
        },
        required: ["content"],
      },
    },
    {
      name: "search_memory",
      description:
        "Rechercher dans la mémoire à long terme par similarité sémantique, par tags, ou les deux combinés.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Requête sémantique (optionnel si tags fournis)",
          },
          tags: {
            type: "ARRAY",
            description: "Filtrer par tags (optionnel, combinable avec query)",
            items: { type: "STRING" },
          },
          match_threshold: {
            type: "NUMBER",
            description: "Seuil de similarité entre 0 et 1 (défaut : 0.5)",
          },
          match_count: {
            type: "NUMBER",
            description: "Nombre maximum de résultats (défaut : 5)",
          },
        },
        required: [],
      },
    },
    {
      name: "list_memories",
      description:
        "Lister les mémoires les plus récentes, avec filtrage optionnel par tags. Utile pour auditer ou faire le ménage dans la mémoire.",
      parameters: {
        type: "OBJECT",
        properties: {
          tags: {
            type: "ARRAY",
            description: "Filtrer par tags (optionnel)",
            items: { type: "STRING" },
          },
          limit: {
            type: "NUMBER",
            description: "Nombre maximum de résultats (défaut : 20, max : 100)",
          },
        },
        required: [],
      },
    },
    {
      name: "delete_memory",
      description:
        "Supprimer une mémoire spécifique par son ID. Utilise `list_memories` ou `search_memory` pour retrouver l'ID avant de supprimer.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: {
            type: "STRING",
            description: "L'identifiant UUID de la mémoire à supprimer.",
          },
        },
        required: ["id"],
      },
    },
  ],
  inputSchemas: {
    save_memory: z.object({
      content: z.string().min(1, "Le contenu de la mémoire ne peut être vide").trim(),
      tags: z.array(z.string().trim()).optional().default([]),
    }),
    search_memory: z.object({
      query: z.string().optional(),
      tags: z.array(z.string().trim()).optional().default([]),
      match_threshold: z.number().min(0).max(1).optional().default(0.5),
      match_count: z.number().int().positive().optional().default(5),
    }),
    list_memories: z.object({
      tags: z.array(z.string().trim()).optional().default([]),
      limit: z.number().int().positive().max(100).optional().default(20),
    }),
    delete_memory: z.object({
      id: z.string().uuid("L'ID doit être un UUID valide"),
    }),
  },
  handleToolCall: async (name, args) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        error:
          "Veuillez configurer SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans les variables d'environnement.",
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── save_memory ─────────────────────────────────────────────────────────
    if (name === "save_memory") {
      try {
        const ai = createGeminiClient();
        if (!ai) return { error: "Aucune clé Gemini API disponible. Ajoutez des clés dans les paramètres." };

        const validated = validateArgs(memorySkill.inputSchemas!.save_memory, args);
        console.log(`[Memory] save: '${validated.content}' tags=${JSON.stringify(validated.tags)}`);

        const embedResponse = await ai.models.embedContent({
          model: "gemini-embedding-2",
          contents: validated.content,
          config: { outputDimensionality: 768 },
        });
        const embedding = embedResponse.embeddings?.[0]?.values;
        if (!embedding) return { error: "Erreur lors de la génération de l'embedding." };

        // Déduplication : similaire + tag commun → mise à jour
        const similar = await findSimilarMemory(supabase, embedding, validated.tags);
        if (similar) {
          const { data: updateData, error: updateError } = await supabase
            .from("memories")
            .update({
              content: validated.content,
              tags: validated.tags,
              embedding,
              updated_at: new Date().toISOString(),
            })
            .eq("id", similar.id)
            .select("id, content, tags, created_at, updated_at")
            .single();

          if (updateError) {
            console.error(`[Memory] Erreur mise à jour:`, updateError);
            return { error: `Erreur Supabase: ${updateError.message}` };
          }

          console.log(`[Memory] Mémoire mise à jour ID=${updateData.id} (similarité=${similar.similarity?.toFixed(3)})`);
          return {
            status: "updated",
            message: `Mémoire mise à jour (similarité: ${similar.similarity?.toFixed(2)})`,
            data: updateData,
          };
        }

        // Insertion nouvelle mémoire
        const { data, error } = await supabase
          .from("memories")
          .insert([{ content: validated.content, tags: validated.tags, embedding }])
          .select("id, content, tags, created_at");

        if (error) {
          console.error(`[Memory] Erreur insertion:`, error);
          return { error: `Erreur Supabase: ${error.message}` };
        }

        console.log(`[Memory] Nouvelle mémoire créée ID=${data[0].id}`);
        return { status: "created", message: "Information sauvegardée en mémoire", data };
      } catch (e: any) {
        console.error(`[Memory] Exception save_memory:`, e);
        return { error: e.message };
      }
    }

    // ── search_memory ────────────────────────────────────────────────────────
    if (name === "search_memory") {
      try {
        const validated = validateArgs(memorySkill.inputSchemas!.search_memory, args);
        console.log(
          `[Memory] search: query='${validated.query}' tags=${JSON.stringify(validated.tags)} threshold=${validated.match_threshold} count=${validated.match_count}`
        );

        // Recherche par tags seuls (sans embedding)
        if (!validated.query && validated.tags.length > 0) {
          const { data, error } = await supabase
            .from("memories")
            .select("id, content, tags, created_at, updated_at")
            .contains("tags", validated.tags)
            .order("created_at", { ascending: false })
            .limit(validated.match_count);
          if (error) return { error: `Erreur Supabase: ${error.message}` };
          console.log(`[Memory] ${data.length} résultats (tags only)`);
          return { status: "success", results: data };
        }

        // Vérification cache
        const cacheKey = `search:${validated.query || ""}:${JSON.stringify(validated.tags)}:${validated.match_threshold}:${validated.match_count}`;
        const cached = memoryCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`[Memory] Cache hit pour: '${validated.query}'`);
          return { status: "success", results: cached.data, cached: true };
        }

        const ai = createGeminiClient();
        if (!ai) return { error: "Aucune clé Gemini API disponible." };

        const embedResponse = await ai.models.embedContent({
          model: "gemini-embedding-2",
          contents: validated.query || "",
          config: { outputDimensionality: 768 },
        });
        const queryEmbedding = embedResponse.embeddings?.[0]?.values;
        if (!queryEmbedding) return { error: "Erreur lors de la génération de l'embedding de la requête." };

        let { data, error } = await supabase.rpc("match_memories", {
          query_embedding: queryEmbedding,
          match_threshold: validated.match_threshold,
          match_count: validated.match_count,
        });

        if (error) {
          console.error(`[Memory] Erreur recherche sémantique:`, error);
          return { error: `Erreur Supabase: ${error.message}` };
        }

        // Post-filtrage par tags si fournis
        if (validated.tags.length > 0 && Array.isArray(data) && data.length > 0) {
          const ids = data.map((m: any) => m.id);
          const { data: fullMemories, error: fetchError } = await supabase
            .from("memories")
            .select("id, content, tags, created_at, updated_at")
            .in("id", ids)
            .contains("tags", validated.tags);
          if (!fetchError) data = fullMemories;
        }

        console.log(`[Memory] ${data?.length ?? 0} résultats pour: '${validated.query}'`);
        memoryCache.set(cacheKey, { data, timestamp: Date.now() });
        return { status: "success", results: data };
      } catch (e: any) {
        console.error(`[Memory] Exception search_memory:`, e);
        return { error: e.message };
      }
    }

    // ── list_memories ────────────────────────────────────────────────────────
    if (name === "list_memories") {
      try {
        const validated = validateArgs(memorySkill.inputSchemas!.list_memories, args);
        console.log(`[Memory] list: tags=${JSON.stringify(validated.tags)} limit=${validated.limit}`);

        let query = supabase
          .from("memories")
          .select("id, content, tags, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(validated.limit);

        if (validated.tags.length > 0) {
          query = query.contains("tags", validated.tags);
        }

        const { data, error } = await query;
        if (error) {
          console.error(`[Memory] Erreur list:`, error);
          return { error: `Erreur Supabase: ${error.message}` };
        }

        console.log(`[Memory] ${data.length} mémoires listées`);
        return { status: "success", count: data.length, results: data };
      } catch (e: any) {
        console.error(`[Memory] Exception list_memories:`, e);
        return { error: e.message };
      }
    }

    // ── delete_memory ────────────────────────────────────────────────────────
    if (name === "delete_memory") {
      try {
        const validated = validateArgs(memorySkill.inputSchemas!.delete_memory, args);
        console.log(`[Memory] delete: id=${validated.id}`);

        // Invalide le cache entier (la suppression affecte potentiellement toutes les recherches)
        memoryCache.clear();

        const { error } = await supabase.from("memories").delete().eq("id", validated.id);
        if (error) {
          console.error(`[Memory] Erreur suppression:`, error);
          return { error: `Erreur Supabase: ${error.message}` };
        }

        console.log(`[Memory] Mémoire supprimée ID=${validated.id}`);
        return { status: "success", message: `Mémoire ${validated.id} supprimée.` };
      } catch (e: any) {
        console.error(`[Memory] Exception delete_memory:`, e);
        return { error: e.message };
      }
    }
  },
};
