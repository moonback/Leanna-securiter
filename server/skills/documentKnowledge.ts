/**
 * Skill — Document Knowledge System
 *
 * Expose le système de connaissance documentaire au LLM (Gemini).
 * Permet à l'IA de :
 *   • Chercher dans les documents indexés
 *   • Consulter la mémoire (faits extraits)
 *   • Obtenir un contexte documentaire pour répondre
 *   • Ajouter des faits / connaissances
 *   • Lister les documents et collections
 *   • Créer des synthèses multi-documents
 */

import { Skill } from "./base.js";
import {
  documentMemory,
  documentSearchEngine,
  documentAnalyzer,
} from "../knowledge/document-system/index.js";
import type { MemoryCategory, DocumentType, SearchOptions } from "../knowledge/document-system/index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Valeurs autorisées
// ═══════════════════════════════════════════════════════════════════════════════

const MEMORY_CATEGORIES: MemoryCategory[] = [
  "definition", "fact", "insight", "procedure", "decision",
  "reference", "quote", "summary", "question", "contradiction",
  "timeline", "relationship",
];

const DOC_TYPES: DocumentType[] = [
  "pdf", "docx", "txt", "markdown", "html", "image",
  "spreadsheet", "presentation", "email", "note", "url", "other",
];

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Declaration
// ═══════════════════════════════════════════════════════════════════════════════

export const documentKnowledgeSkill: Skill = {
  name: "document_knowledge",
  declarations: [
    {
      name: "doc_search",
      description:
        "🔍 Recherche sémantique dans la base de documents indexés. " +
        "Cherche dans les titres, résumés, textes extraits, mots-clés et faits mémorisés. " +
        "Retourne les résultats classés par pertinence avec des snippets.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Terme ou concept à rechercher (ex: 'budget 2024', 'procédure de recrutement').",
          },
          max_results: {
            type: "NUMBER",
            description: "Nombre max de résultats (défaut: 15, max: 50).",
          },
          collection: {
            type: "STRING",
            description: "Filtrer par collection (optionnel).",
          },
          document_type: {
            type: "STRING",
            description: "Filtrer par type de document: pdf, docx, txt, markdown, html, url, etc.",
            enum: DOC_TYPES,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_get_context",
      description:
        "📚 Génère un contexte documentaire complet pour répondre à une question. " +
        "Combine les documents pertinents, les faits mémorisés et les relations inter-documents. " +
        "Retourne un prompt formaté prêt à utiliser pour le raisonnement.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "La question ou le sujet pour lequel obtenir du contexte.",
          },
          max_documents: {
            type: "NUMBER",
            description: "Nombre max de documents à inclure (défaut: 8).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_list",
      description:
        "📋 Liste les documents indexés dans le système, avec filtres optionnels par collection ou type.",
      parameters: {
        type: "OBJECT",
        properties: {
          collection: {
            type: "STRING",
            description: "Filtrer par collection (optionnel).",
          },
          document_type: {
            type: "STRING",
            description: "Filtrer par type de document (optionnel).",
            enum: DOC_TYPES,
          },
          limit: {
            type: "NUMBER",
            description: "Nombre max de documents à retourner (défaut: 30).",
          },
        },
        required: [],
      },
    },
    {
      name: "doc_get",
      description:
        "📄 Récupère le contenu complet d'un document par son ID. " +
        "Inclut le texte extrait, les sections, résumé, entités et métadonnées.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_id: {
            type: "STRING",
            description: "L'ID du document à récupérer.",
          },
        },
        required: ["document_id"],
      },
    },
    {
      name: "doc_memory_search",
      description:
        "🧠 Recherche dans la mémoire des faits extraits des documents. " +
        "Les faits sont des connaissances structurées : définitions, procédures, décisions, citations, etc.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Terme ou concept à chercher dans les faits.",
          },
          category: {
            type: "STRING",
            description: "Filtrer par catégorie de fait.",
            enum: MEMORY_CATEGORIES,
          },
          max_results: {
            type: "NUMBER",
            description: "Nombre max de résultats (défaut: 15).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_memory_add",
      description:
        "➕ Ajoute un fait/connaissance à la mémoire documentaire. " +
        "Utilisé pour mémoriser des informations importantes découvertes lors de l'analyse.",
      parameters: {
        type: "OBJECT",
        properties: {
          content: {
            type: "STRING",
            description: "Le contenu du fait à mémoriser.",
          },
          category: {
            type: "STRING",
            description: "Catégorie du fait.",
            enum: MEMORY_CATEGORIES,
          },
          source_documents: {
            type: "STRING",
            description: "IDs des documents sources (séparés par des virgules).",
          },
          importance: {
            type: "NUMBER",
            description: "Importance du fait (0.0 à 1.0, défaut: 0.7).",
          },
          related_concepts: {
            type: "STRING",
            description: "Concepts liés (séparés par des virgules).",
          },
        },
        required: ["content", "category"],
      },
    },
    {
      name: "doc_synthesis",
      description:
        "🔗 Génère une synthèse multi-documents. Croise les informations de plusieurs documents " +
        "pour identifier les thèmes communs, contradictions et relations.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_ids: {
            type: "STRING",
            description: "IDs des documents à synthétiser (séparés par des virgules).",
          },
        },
        required: ["document_ids"],
      },
    },
    {
      name: "doc_stats",
      description:
        "📊 Statistiques du système de connaissance documentaire : nombre de documents, faits, relations, etc.",
      parameters: {
        type: "OBJECT",
        properties: {},
        required: [],
      },
    },
    {
      name: "doc_collections",
      description:
        "📁 Liste les collections de documents avec le nombre de documents dans chaque collection.",
      parameters: {
        type: "OBJECT",
        properties: {},
        required: [],
      },
    },
    {
      name: "doc_relations",
      description:
        "🔗 Liste les relations entre documents (références, contradictions, compléments, etc.).",
      parameters: {
        type: "OBJECT",
        properties: {
          document_id: {
            type: "STRING",
            description: "Filtrer les relations pour un document spécifique (optionnel).",
          },
        },
        required: [],
      },
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Exécution des tools
  // ═══════════════════════════════════════════════════════════════════════════

  async handleToolCall(name: string, args: Record<string, any>): Promise<any> {
    switch (name) {
      case "doc_search": {
        const { query, max_results, collection, document_type } = args;
        const options: SearchOptions = {
          maxResults: Math.min(max_results || 15, 50),
          collections: collection ? [collection] : undefined,
          documentTypes: document_type ? [document_type] : undefined,
        };
        const results = documentSearchEngine.search(query, options);
        return {
          query,
          resultCount: results.length,
          results: results.map((r) => ({
            type: r.resultType,
            id: r.id,
            title: r.title,
            snippet: r.snippet.slice(0, 300),
            relevance: (r.relevance * 100).toFixed(1) + "%",
            documentTitle: r.documentTitle,
          })),
        };
      }

      case "doc_get_context": {
        const { query, max_documents } = args;
        const context = documentSearchEngine.buildContext(query, {
          maxResults: Math.min(max_documents || 8, 15),
        });
        return {
          query: context.query,
          quality: context.quality,
          documentCount: context.documents.length,
          factCount: context.facts.length,
          formattedContext: context.formattedPrompt,
        };
      }

      case "doc_list": {
        const { collection, document_type, limit } = args;
        let docs = documentMemory.getAllDocuments();
        if (collection) docs = docs.filter((d) => d.collection === collection);
        if (document_type) docs = docs.filter((d) => d.type === document_type);
        docs = docs.slice(0, Math.min(limit || 30, 50));

        return {
          count: docs.length,
          documents: docs.map((d) => ({
            id: d.id,
            title: d.title,
            type: d.type,
            collection: d.collection || "—",
            keywords: d.keywords.slice(0, 5).join(", "),
            wordCount: d.metadata.wordCount || "?",
            addedAt: d.addedAt,
          })),
        };
      }

      case "doc_get": {
        const { document_id } = args;
        const doc = documentMemory.getDocument(document_id);
        if (!doc) return { error: "Document introuvable." };

        return {
          id: doc.id,
          title: doc.title,
          type: doc.type,
          source: doc.source,
          language: doc.language,
          summary: doc.summary,
          keywords: doc.keywords,
          tags: doc.tags,
          collection: doc.collection || "—",
          metadata: doc.metadata,
          sections: doc.sections.map((s) => ({
            title: s.title || "(sans titre)",
            contentPreview: s.content.slice(0, 200),
          })),
          entities: doc.entities.slice(0, 20).map((e) => ({
            name: e.name,
            type: e.type,
            occurrences: e.occurrences,
          })),
          extractedText: doc.extractedText.slice(0, 5000) + (doc.extractedText.length > 5000 ? "\n...[tronqué]" : ""),
        };
      }

      case "doc_memory_search": {
        const { query, category, max_results } = args;
        const results = documentSearchEngine.searchFacts(query, {
          factCategories: category ? [category] : undefined,
          maxResults: Math.min(max_results || 15, 30),
        });

        const facts = results.map((r) => {
          const fact = documentMemory.getFact(r.id);
          return fact ? {
            id: fact.id,
            content: fact.content,
            category: fact.category,
            importance: fact.importance,
            verified: fact.verified,
            relatedConcepts: fact.relatedConcepts,
            relevance: (r.relevance * 100).toFixed(1) + "%",
          } : null;
        }).filter(Boolean);

        return { query, count: facts.length, facts };
      }

      case "doc_memory_add": {
        const { content, category, source_documents, importance, related_concepts } = args;
        const sourceIds = source_documents ? source_documents.split(",").map((s: string) => s.trim()) : [];
        const concepts = related_concepts ? related_concepts.split(",").map((s: string) => s.trim()) : [];

        const fact = documentMemory.addFact({
          content,
          category,
          tags: [],
          sourceDocuments: sourceIds,
          confidence: 0.85,
          importance: importance || 0.7,
          relatedConcepts: concepts,
          verified: false,
        });

        return { success: true, factId: fact.id, message: `Fait mémorisé: "${content.slice(0, 80)}..."` };
      }

      case "doc_synthesis": {
        const { document_ids } = args;
        const ids = document_ids.split(",").map((s: string) => s.trim());
        const synthesis = documentAnalyzer.buildMultiDocumentSynthesis(ids);
        return { documentCount: ids.length, synthesis };
      }

      case "doc_stats": {
        const stats = documentMemory.getStats();
        return stats;
      }

      case "doc_collections": {
        const collections = documentMemory.getCollections();
        const result = collections.map((name) => ({
          name,
          documentCount: documentMemory.getDocumentsByCollection(name).length,
        }));
        return { count: result.length, collections: result };
      }

      case "doc_relations": {
        const { document_id } = args;
        const relations = document_id
          ? documentMemory.getRelationsForDocument(document_id)
          : documentMemory.getAllRelations();

        return {
          count: relations.length,
          relations: relations.slice(0, 30).map((r) => {
            const src = documentMemory.getDocument(r.sourceId);
            const tgt = documentMemory.getDocument(r.targetId);
            return {
              id: r.id,
              source: src?.title || r.sourceId,
              target: tgt?.title || r.targetId,
              type: r.type,
              description: r.description,
              confidence: r.confidence,
              autoDetected: r.autoDetected,
            };
          }),
        };
      }

      default:
        return { error: `Outil inconnu: ${name}` };
    }
  },
};
