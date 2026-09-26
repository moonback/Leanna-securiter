import { z } from "zod";
import { Skill, validateArgs } from "./base.js";
import { hierarchicalMemoryService, type HierarchicalTier } from "../runtime/HierarchicalMemoryService.js";

export const hierarchicalMemorySkill: Skill = {
  name: "hierarchical_memory",
  metadata: {
    version: "1.0.0",
    description: "Mémoire hiérarchique unifiée à 3 niveaux : court-terme (session), moyen-terme (projet) et long-terme (Supabase).",
    category: "memory",
  },
  declarations: [
    {
      name: "hierarchical_memory_search",
      description:
        "Rechercher dans la mémoire hiérarchique unifiée à travers les 3 paliers : " +
        "court-terme (session / volatile), moyen-terme (projet / .project-memory.json) et long-terme (Supabase / embeddings). " +
        "Permet de cibler un palier précis ou d'interroger l'ensemble de la mémoire avec attribution du niveau d'origine.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Terme ou phrase de recherche sémantique / textuelle.",
          },
          tier: {
            type: "STRING",
            description: "Palier à interroger : 'all' (tous les niveaux), 'session' (court-terme), 'project' (moyen-terme), 'longterm' (Supabase). Défaut : 'all'.",
            enum: ["all", "session", "project", "longterm"],
          },
          tags: {
            type: "ARRAY",
            description: "Filtrer par un ou plusieurs tags.",
            items: { type: "STRING" },
          },
          category: {
            type: "STRING",
            description: "Catégorie pour le palier projet (convention, architecture, decision, known-bug, pattern).",
          },
          limit: {
            type: "NUMBER",
            description: "Nombre maximal de résultats à retourner (défaut : 15).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "hierarchical_memory_store",
      description:
        "Stocker une connaissance dans le palier approprié de la mémoire hiérarchique : " +
        "- 'session' : court-terme volatile (RAM), scratchpad, contexte temporaire de la tâche en cours. " +
        "- 'project' : moyen-terme persistant (.project-memory.json), conventions de code, choix d'architecture, bugs connus du repo. " +
        "- 'longterm' : long-terme cloud (Supabase), préférences utilisateur globales, identité, règles durables multi-projets.",
      parameters: {
        type: "OBJECT",
        properties: {
          tier: {
            type: "STRING",
            description: "Niveau de mémoire ciblé : 'session', 'project', ou 'longterm'.",
            enum: ["session", "project", "longterm"],
          },
          content: {
            type: "STRING",
            description: "Contenu de la mémoire, rédigé de façon claire et autoportante.",
          },
          category: {
            type: "STRING",
            description: "Catégorie (pour le palier projet) : convention, architecture, decision, known-bug, pattern.",
          },
          tags: {
            type: "ARRAY",
            description: "Tags pour indexer la mémoire.",
            items: { type: "STRING" },
          },
          confidence: {
            type: "NUMBER",
            description: "Indice de confiance entre 0.1 et 1.0 (défaut : 0.85).",
          },
          ttl: {
            type: "NUMBER",
            description: "Durée de vie en millisecondes pour une mémoire de session (optionnel).",
          },
        },
        required: ["tier", "content"],
      },
    },
    {
      name: "hierarchical_memory_promote",
      description:
        "Promouvoir une mémoire vers un palier supérieur : " +
        "- de 'session' vers 'project' : figer une découverte de session comme convention/décision du projet. " +
        "- de 'session' vers 'longterm' : élever une préférence découverte en session au rang de préférence utilisateur globale. " +
        "- de 'project' vers 'longterm' : généraliser une connaissance projet vers la base durable Supabase.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: {
            type: "STRING",
            description: "Identifiant de la mémoire à promouvoir.",
          },
          from_tier: {
            type: "STRING",
            description: "Palier source : 'session' ou 'project'.",
            enum: ["session", "project"],
          },
          to_tier: {
            type: "STRING",
            description: "Palier de destination : 'project' ou 'longterm'.",
            enum: ["project", "longterm"],
          },
          category: {
            type: "STRING",
            description: "Nouvelle catégorie optionnelle pour la destination.",
          },
          tags: {
            type: "ARRAY",
            description: "Tags supplémentaires à associer lors de la promotion.",
            items: { type: "STRING" },
          },
          remove_source: {
            type: "BOOLEAN",
            description: "Supprimer l'entrée du palier source après promotion (défaut : false).",
          },
        },
        required: ["id", "from_tier", "to_tier"],
      },
    },
    {
      name: "hierarchical_memory_stats",
      description: "Consulter les statistiques d'utilisation et de santé des 3 paliers de mémoire (court-terme, moyen-terme, long-terme).",
      parameters: {
        type: "OBJECT",
        properties: {},
        required: [],
      },
    },
  ],
  inputSchemas: {
    hierarchical_memory_search: z.object({
      query: z.string().default(""),
      tier: z.enum(["all", "session", "project", "longterm"]).optional().default("all"),
      tags: z.array(z.string().trim()).optional().default([]),
      category: z.string().optional(),
      limit: z.number().int().positive().max(50).optional().default(15),
    }),
    hierarchical_memory_store: z.object({
      tier: z.enum(["session", "project", "longterm"]),
      content: z.string().min(1, "Le contenu ne peut être vide").trim(),
      category: z.string().optional(),
      tags: z.array(z.string().trim()).optional().default([]),
      confidence: z.number().min(0).max(1).optional().default(0.85),
      ttl: z.number().positive().optional(),
    }),
    hierarchical_memory_promote: z.object({
      id: z.string().min(1),
      from_tier: z.enum(["session", "project"]),
      to_tier: z.enum(["project", "longterm"]),
      category: z.string().optional(),
      tags: z.array(z.string().trim()).optional().default([]),
      remove_source: z.boolean().optional().default(false),
    }),
    hierarchical_memory_stats: z.object({}),
  },
  handleToolCall: async (name, args) => {
    switch (name) {
      case "hierarchical_memory_search": {
        try {
          const validated = validateArgs(hierarchicalMemorySkill.inputSchemas!.hierarchical_memory_search, args);
          const results = await hierarchicalMemoryService.search(validated.query, {
            tier: validated.tier,
            tags: validated.tags.length ? validated.tags : undefined,
            category: validated.category,
            limit: validated.limit,
          });
          return {
            status: "success",
            count: results.length,
            tier: validated.tier,
            results,
          };
        } catch (e: any) {
          return { status: "error", error: e.message };
        }
      }

      case "hierarchical_memory_store": {
        try {
          const validated = validateArgs(hierarchicalMemorySkill.inputSchemas!.hierarchical_memory_store, args);
          const item = await hierarchicalMemoryService.store(validated.tier as HierarchicalTier, {
            content: validated.content,
            category: validated.category,
            tags: validated.tags,
            confidence: validated.confidence,
            ttl: validated.ttl,
          });
          return {
            status: "success",
            message: `Information enregistrée avec succès dans le palier '${validated.tier}'.`,
            item,
          };
        } catch (e: any) {
          return { status: "error", error: e.message };
        }
      }

      case "hierarchical_memory_promote": {
        try {
          const validated = validateArgs(hierarchicalMemorySkill.inputSchemas!.hierarchical_memory_promote, args);
          const item = await hierarchicalMemoryService.promote(
            validated.id,
            validated.from_tier,
            validated.to_tier,
            {
              category: validated.category,
              tags: validated.tags,
              removeSource: validated.remove_source,
            }
          );
          return {
            status: "success",
            message: `Mémoire promue avec succès de '${validated.from_tier}' vers '${validated.to_tier}'.`,
            item,
          };
        } catch (e: any) {
          return { status: "error", error: e.message };
        }
      }

      case "hierarchical_memory_stats": {
        try {
          const stats = await hierarchicalMemoryService.getStats();
          return {
            status: "success",
            stats,
          };
        } catch (e: any) {
          return { status: "error", error: e.message };
        }
      }

      default:
        return { status: "error", error: `Outil inconnu: ${name}` };
    }
  },
};
