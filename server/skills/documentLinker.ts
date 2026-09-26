/**
 * DocumentLinker Skill — Analyse inter-documents et établissement de liens
 *
 * Permet à Leanna de :
 *   • Lister les documents persistés dans le store
 *   • Rechercher dans les documents par mots-clés
 *   • Analyser les liens entre documents (via LLM)
 *   • Trouver des documents similaires
 *   • Générer une synthèse croisée de plusieurs documents
 *
 * Utilise le DocumentStore (persistant) + appels LLM pour l'analyse sémantique.
 */

import { Skill, validateArgs } from "./base.js";
import { z } from "zod";
import { getDocumentStore } from "../knowledge/DocumentStore.js";
import type { StoredDocument, DocumentLink } from "../knowledge/DocumentStore.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Declaration
// ═══════════════════════════════════════════════════════════════════════════════

export const documentLinkerSkill: Skill = {
  name: "documentLinker",
  declarations: [
    {
      name: "document_list",
      description:
        "📄 Liste tous les documents persistés dans la base documentaire. " +
        "Affiche les résumés, mots-clés et liens existants. " +
        "Utilise ceci pour savoir quels documents sont disponibles avant une analyse croisée.",
      parameters: {
        type: "OBJECT",
        properties: {
          include_summaries: {
            type: "BOOLEAN",
            description: "Inclure les résumés complets (défaut: true).",
          },
          include_links: {
            type: "BOOLEAN",
            description: "Inclure les liens inter-documents existants (défaut: true).",
          },
        },
        required: [],
      },
    },
    {
      name: "document_search",
      description:
        "🔍 Recherche dans les documents persistés par mots-clés. " +
        "Cherche dans les noms de fichiers, résumés, mots-clés et tags. " +
        "Plus rapide que document_analyze_links pour trouver un document spécifique.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Termes de recherche (ex: 'budget 2024', 'architecture microservices').",
          },
          max_results: {
            type: "NUMBER",
            description: "Nombre max de résultats (défaut: 5, max: 20).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "document_find_similar",
      description:
        "🔗 Trouve les documents les plus similaires à un document donné. " +
        "Utilise une analyse de vocabulaire partagé (similarité de Jaccard). " +
        "Utile pour identifier des documents qui traitent de sujets connexes.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_id: {
            type: "STRING",
            description: "ID du document de référence.",
          },
          min_similarity: {
            type: "NUMBER",
            description: "Score minimum de similarité 0-1 (défaut: 0.03). Plus bas = plus de résultats.",
          },
          max_results: {
            type: "NUMBER",
            description: "Nombre max de résultats (défaut: 5, max: 10).",
          },
        },
        required: ["document_id"],
      },
    },
    {
      name: "document_analyze_links",
      description:
        "🧠 Outil PRINCIPAL d'analyse inter-documents. " +
        "Analyse N documents et identifie les LIENS SÉMANTIQUES entre eux : " +
        "thèmes communs, complémentarités, contradictions, séquences logiques, références croisées. " +
        "Utilise le LLM pour une analyse profonde. Résultat structuré avec les connexions trouvées. " +
        "⚠️ Coûteux en tokens — utiliser sur 2 à 6 documents max.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_ids: {
            type: "ARRAY",
            description:
              "IDs des documents à analyser ensemble. Si vide ou absent, analyse TOUS les documents du store (max 6 les plus récents).",
            items: { type: "STRING" },
          },
          focus: {
            type: "STRING",
            description:
              "Angle d'analyse optionnel (ex: 'contradictions', 'complémentarités', 'chronologie', 'thèmes communs'). " +
              "Si absent, analyse générale.",
          },
          save_links: {
            type: "BOOLEAN",
            description: "Sauvegarder les liens trouvés dans le store pour référence future (défaut: true).",
          },
        },
        required: [],
      },
    },
    {
      name: "document_synthesize",
      description:
        "📝 Génère une SYNTHÈSE CROISÉE de plusieurs documents. " +
        "Contrairement à document_analyze_links qui identifie les liens, " +
        "cet outil produit un texte unifié qui combine les informations de tous les documents " +
        "en une narration cohérente. Idéal pour un briefing ou un rapport.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_ids: {
            type: "ARRAY",
            description: "IDs des documents à synthétiser. Si absent, utilise les 5 plus récents.",
            items: { type: "STRING" },
          },
          question: {
            type: "STRING",
            description:
              "Question ou angle spécifique pour guider la synthèse (ex: 'Quels sont les risques identifiés ?'). " +
              "Si absent, synthèse générale.",
          },
          format: {
            type: "STRING",
            description: "Format de sortie: 'summary' (résumé court), 'report' (rapport structuré), 'bullets' (liste à puces).",
            enum: ["summary", "report", "bullets"],
          },
        },
        required: [],
      },
    },
    {
      name: "document_add_tag",
      description:
        "🏷️ Ajoute un ou plusieurs tags à un document pour faciliter l'organisation et la recherche.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_id: {
            type: "STRING",
            description: "ID du document.",
          },
          tags: {
            type: "ARRAY",
            description: "Tags à ajouter.",
            items: { type: "STRING" },
          },
        },
        required: ["document_id", "tags"],
      },
    },
    {
      name: "document_remove",
      description:
        "🗑️ Supprime un document du store persistant (et tous ses liens associés).",
      parameters: {
        type: "OBJECT",
        properties: {
          document_id: {
            type: "STRING",
            description: "ID du document à supprimer.",
          },
        },
        required: ["document_id"],
      },
    },
    {
      name: "document_store_status",
      description:
        "📊 Statistiques du store documentaire : nombre de documents, liens, taille totale, dernière mise à jour.",
      parameters: {
        type: "OBJECT",
        properties: {},
        required: [],
      },
    },
  ],
  inputSchemas: {
    document_list: z.object({
      include_summaries: z.boolean().optional().default(true),
      include_links: z.boolean().optional().default(true),
    }),
    document_search: z.object({
      query: z.string().min(1, "La requête ne peut être vide").trim(),
      max_results: z.number().int().positive().max(20).optional().default(5),
    }),
    document_find_similar: z.object({
      document_id: z.string().min(1).trim(),
      min_similarity: z.number().min(0).max(1).optional().default(0.03),
      max_results: z.number().int().positive().max(10).optional().default(5),
    }),
    document_analyze_links: z.object({
      document_ids: z.array(z.string().trim()).optional(),
      focus: z.string().trim().optional(),
      save_links: z.boolean().optional().default(true),
    }),
    document_synthesize: z.object({
      document_ids: z.array(z.string().trim()).optional(),
      question: z.string().trim().optional(),
      format: z.enum(["summary", "report", "bullets"]).optional().default("report"),
    }),
    document_add_tag: z.object({
      document_id: z.string().min(1).trim(),
      tags: z.array(z.string().trim().min(1)).min(1),
    }),
    document_remove: z.object({
      document_id: z.string().min(1).trim(),
    }),
    document_store_status: z.object({}),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Handler
  // ═══════════════════════════════════════════════════════════════════════════

  handleToolCall: async (name, args, context) => {
    const store = getDocumentStore();
    const log = (msg: string) => console.log(`[DocumentLinker] ${msg}`);

    // ─────────────────────────────────────────────────────────────────────────
    // document_list
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_list") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_list, args);
      const docs = store.getAllDocuments();
      const links = store.getAllLinks();

      return {
        status: "success",
        count: docs.length,
        documents: docs.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          mimeType: d.mimeType,
          uploadedAt: d.uploadedAt,
          keywords: d.keywords,
          tags: d.tags,
          summary: validated.include_summaries ? d.summary : undefined,
          textLength: d.extractedText.length,
        })),
        links: validated.include_links
          ? links.map((l) => ({
              docA: l.docA,
              docB: l.docB,
              linkType: l.linkType,
              description: l.description,
              confidence: l.confidence,
            }))
          : undefined,
        _tip: docs.length === 0
          ? "Aucun document en mémoire. Uploade des documents via l'interface pour les analyser."
          : `${docs.length} document(s) disponibles. Utilise document_analyze_links pour trouver les connexions.`,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_search
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_search") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_search, args);
      log(`search query='${validated.query}' max=${validated.max_results}`);

      const results = store.searchDocuments(validated.query, validated.max_results);

      return {
        status: "success",
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          fileName: r.fileName,
          relevance: r.relevance,
          keywords: r.keywords,
          summary: r.summary.slice(0, 500),
          uploadedAt: r.uploadedAt,
        })),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_find_similar
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_find_similar") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_find_similar, args);
      log(`findSimilar docId='${validated.document_id}' minSim=${validated.min_similarity}`);

      const sourceDoc = store.getDocument(validated.document_id);
      if (!sourceDoc) {
        return { error: `Document introuvable: ${validated.document_id}` };
      }

      const similar = store.findSimilarDocuments(
        validated.document_id,
        validated.min_similarity,
        validated.max_results
      );

      return {
        status: "success",
        source: { id: sourceDoc.id, fileName: sourceDoc.fileName },
        similar: similar.map((s) => ({
          id: s.doc.id,
          fileName: s.doc.fileName,
          similarity: Math.round(s.similarity * 100) / 100,
          keywords: s.doc.keywords,
          summary: s.doc.summary.slice(0, 300),
        })),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_analyze_links
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_analyze_links") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_analyze_links, args);
      log(`analyzeLinks ids=${JSON.stringify(validated.document_ids)} focus='${validated.focus || "general"}'`);

      // Déterminer quels documents analyser
      let docIds = validated.document_ids;
      if (!docIds || docIds.length === 0) {
        const allDocs = store.getAllDocuments();
        docIds = allDocs
          .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
          .slice(0, 6)
          .map((d) => d.id);
      }

      if (docIds.length < 2) {
        return {
          error: "Il faut au moins 2 documents pour analyser les liens inter-documents.",
          _tip: "Uploade plus de documents ou vérifie les IDs fournis.",
        };
      }

      // Construire le contexte multi-documents
      const crossContext = store.buildCrossDocumentContext(docIds, 6000);
      const docs = docIds.map((id) => store.getDocument(id)).filter(Boolean) as StoredDocument[];

      // Construire le prompt d'analyse
      const focusInstruction = validated.focus
        ? `Concentre-toi particulièrement sur : ${validated.focus}.`
        : "";

      const analysisPrompt = [
        "Tu es un expert en analyse documentaire. Voici plusieurs documents. " +
        "Identifie les LIENS et CONNEXIONS entre eux.",
        "",
        focusInstruction,
        "",
        "Pour chaque lien trouvé, indique :",
        "1. Les deux documents concernés (par leur nom de fichier)",
        "2. Le TYPE de lien : thematic (même thème), complementary (informations complémentaires), " +
        "contradictory (informations contradictoires), sequential (suite logique/chronologique), " +
        "reference (l'un cite ou fait référence à l'autre)",
        "3. Une DESCRIPTION précise du lien (1-2 phrases)",
        "4. Un score de CONFIANCE (0.0 à 1.0)",
        "",
        "Termine par une section '## Synthèse' résumant les connexions principales.",
        "",
        "Réponds en JSON avec la structure :",
        '{ "links": [{ "docA": "nom_fichier_A", "docB": "nom_fichier_B", "linkType": "...", "description": "...", "confidence": 0.X }], "synthesis": "..." }',
        "",
        "═══ DOCUMENTS À ANALYSER ═══",
        "",
        crossContext,
      ].join("\n");

      // Appeler le LLM via le contexte fourni (on utilise la même mécanique que l'upload)
      let analysisResult: { links: any[]; synthesis: string } | null = null;

      try {
        // Utiliser le provider configuré via le context (injecté par le SkillManager/server)
        const llmResponse = await callLLMForAnalysis(analysisPrompt, context);
        analysisResult = parseLLMLinksResponse(llmResponse, docs);
      } catch (e: any) {
        log(`Erreur LLM analyze_links: ${e.message}`);
        // Fallback: analyse locale basée sur la similarité
        analysisResult = localFallbackAnalysis(docs, store);
      }

      // Sauvegarder les liens si demandé
      if (analysisResult && validated.save_links) {
        for (const link of analysisResult.links) {
          const docA = docs.find((d) => d.fileName === link.docA || d.id === link.docA);
          const docB = docs.find((d) => d.fileName === link.docB || d.id === link.docB);
          if (docA && docB) {
            store.addLink({
              docA: docA.id,
              docB: docB.id,
              linkType: link.linkType,
              description: link.description,
              confidence: link.confidence,
            });
          }
        }
      }

      return {
        status: "success",
        documents_analyzed: docs.map((d) => ({ id: d.id, fileName: d.fileName })),
        links_found: analysisResult?.links.length ?? 0,
        links: analysisResult?.links ?? [],
        synthesis: analysisResult?.synthesis ?? "Analyse non disponible.",
        saved: validated.save_links,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_synthesize
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_synthesize") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_synthesize, args);
      log(`synthesize ids=${JSON.stringify(validated.document_ids)} format=${validated.format}`);

      let docIds = validated.document_ids;
      if (!docIds || docIds.length === 0) {
        const allDocs = store.getAllDocuments();
        docIds = allDocs
          .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
          .slice(0, 5)
          .map((d) => d.id);
      }

      if (docIds.length === 0) {
        return { error: "Aucun document disponible pour la synthèse." };
      }

      const docs = docIds.map((id) => store.getDocument(id)).filter(Boolean) as StoredDocument[];
      const crossContext = store.buildCrossDocumentContext(docIds, 8000);

      const formatInstruction: Record<string, string> = {
        summary: "Produis un résumé court (5-10 phrases) qui combine les informations essentielles de tous les documents.",
        report: "Produis un rapport structuré avec titres (##), sections, et bullet points. Sois exhaustif et relie les informations entre documents.",
        bullets: "Produis une liste à puces hiérarchique des points clés, en regroupant par thème et en indiquant la source entre parenthèses.",
      };

      const questionInstruction = validated.question
        ? `L'utilisateur demande spécifiquement : "${validated.question}". Oriente ta synthèse pour répondre à cette question.`
        : "Fais une synthèse générale couvrant tous les aspects importants.";

      const synthesizePrompt = [
        "Tu es un expert en synthèse documentaire. Voici plusieurs documents.",
        questionInstruction,
        "",
        formatInstruction[validated.format],
        "",
        "Règles :",
        "- Cite les sources (nom du document) quand tu fais une affirmation",
        "- Identifie les informations qui se recoupent entre documents",
        "- Signale les éventuelles contradictions",
        "- Réponds en français",
        "",
        "═══ DOCUMENTS ═══",
        "",
        crossContext,
      ].join("\n");

      try {
        const synthesis = await callLLMForAnalysis(synthesizePrompt, context);
        return {
          status: "success",
          documents_used: docs.map((d) => ({ id: d.id, fileName: d.fileName })),
          format: validated.format,
          question: validated.question || null,
          synthesis,
        };
      } catch (e: any) {
        log(`Erreur LLM synthesize: ${e.message}`);
        // Fallback: concaténer les résumés
        const fallback = docs.map((d) => `**${d.fileName}** : ${d.summary}`).join("\n\n");
        return {
          status: "partial",
          documents_used: docs.map((d) => ({ id: d.id, fileName: d.fileName })),
          format: validated.format,
          synthesis: `[Synthèse locale — LLM indisponible]\n\n${fallback}`,
          _warning: "Le LLM n'était pas disponible. Voici une concaténation des résumés existants.",
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_add_tag
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_add_tag") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_add_tag, args);
      const doc = store.getDocument(validated.document_id);
      if (!doc) {
        return { error: `Document introuvable: ${validated.document_id}` };
      }

      const newTags = validated.tags.filter((t: string) => !doc.tags.includes(t));
      doc.tags.push(...newTags);
      store.save();

      return {
        status: "success",
        document: doc.fileName,
        tags: doc.tags,
        added: newTags,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_remove
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_remove") {
      const validated = validateArgs(documentLinkerSkill.inputSchemas!.document_remove, args);
      const doc = store.getDocument(validated.document_id);
      if (!doc) {
        return { error: `Document introuvable: ${validated.document_id}` };
      }

      store.removeDocument(validated.document_id);
      return {
        status: "success",
        message: `Document "${doc.fileName}" supprimé du store.`,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // document_store_status
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "document_store_status") {
      const stats = store.getStats();
      const docs = store.getAllDocuments();

      return {
        status: "success",
        ...stats,
        recentDocuments: docs
          .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
          .slice(0, 5)
          .map((d) => ({ id: d.id, fileName: d.fileName, uploadedAt: d.uploadedAt })),
      };
    }

    return { error: `Outil inconnu : ${name}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Utilitaires LLM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Appelle le LLM configuré pour une analyse documentaire.
 * Utilise OpenRouter ou Gemini selon la configuration du profil.
 */
async function callLLMForAnalysis(prompt: string, context?: any): Promise<string> {
  // Tenter d'utiliser le provider du profil via le context
  const profile = context?.profile || context?.getProfile?.() || null;
  const provider = profile?.textProvider || "gemini";

  if (provider === "openrouter") {
    const orKey =
      profile?.openrouterApiKey?.trim() ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENROUTER_FREE_API_KEY;

    if (!orKey) {
      throw new Error("Aucune clé API OpenRouter disponible.");
    }

    const orModel = profile?.openrouterModel || "google/gemini-3.6-flash";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://Leanna.local",
        "X-Title": "Leanna DocumentLinker",
      },
      body: JSON.stringify({
        model: orModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } else {
    // Gemini
    const { withGeminiRetry } = await import("../utils/geminiKeyPool");
    const response = await withGeminiRetry((ai) =>
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      })
    );
    return response.text || "";
  }
}

/**
 * Parse la réponse LLM pour extraire les liens structurés.
 */
function parseLLMLinksResponse(
  response: string,
  docs: StoredDocument[]
): { links: any[]; synthesis: string } {
  try {
    // Chercher un bloc JSON dans la réponse
    const jsonMatch = response.match(/\{[\s\S]*"links"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        links: (parsed.links || []).map((l: any) => ({
          docA: l.docA || l.doc_a || "",
          docB: l.docB || l.doc_b || "",
          linkType: l.linkType || l.link_type || "thematic",
          description: l.description || "",
          confidence: Number(l.confidence) || 0.5,
        })),
        synthesis: parsed.synthesis || parsed.synthese || "",
      };
    }
  } catch {
    // JSON parsing failed
  }

  // Fallback: retourner la réponse brute comme synthèse
  return {
    links: [],
    synthesis: response,
  };
}

/**
 * Analyse locale (fallback) basée sur la similarité textuelle.
 */
function localFallbackAnalysis(
  docs: StoredDocument[],
  store: ReturnType<typeof getDocumentStore>
): { links: any[]; synthesis: string } {
  const links: any[] = [];

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const similarity = store.computeSimilarity(docs[i].id, docs[j].id);
      if (similarity > 0.05) {
        links.push({
          docA: docs[i].fileName,
          docB: docs[j].fileName,
          linkType: "thematic",
          description: `Vocabulaire partagé (similarité: ${Math.round(similarity * 100)}%)`,
          confidence: Math.min(similarity * 2, 0.9),
        });
      }
    }
  }

  const synthesis = links.length > 0
    ? `Analyse locale (sans LLM) : ${links.length} lien(s) thématique(s) détecté(s) par similarité de vocabulaire.`
    : "Aucun lien significatif détecté par l'analyse locale. Un LLM permettrait une analyse sémantique plus fine.";

  return { links, synthesis };
}
