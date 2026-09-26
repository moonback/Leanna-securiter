/**
 * GroundedChat — Chat Q&A ancré sur les sources du notebook
 *
 * Utilise le RAGEngine pour retrouver le contexte pertinent,
 * puis génère une réponse avec citations via Gemini/OpenRouter.
 *
 * Fonctionnalités :
 * - ask() : réponse complète (mode classique)
 * - askStream() : réponse en streaming via callback (SSE)
 * - generateFollowUps() : propose 3 questions de suivi contextuelles
 * - deepDive() : exploration en profondeur avec RAG enchaîné
 */

import { randomUUID } from "crypto";
import { createLogger } from "../utils/logger.js";
import { generateText, generateTextStream } from "../utils/textGeneration.js";
import { ragEngine } from "./RAGEngine.js";
import { notebookManager } from "./NotebookManager.js";
import type { ChatMessage, Citation } from "./types.js";

const log = createLogger("GroundedChat");

// ─── System Prompt pour le chat groundé ──────────────────────────────────────

const GROUNDED_SYSTEM_PROMPT = `Tu es un assistant de recherche intelligent. Tu réponds aux questions de l'utilisateur en te basant EXCLUSIVEMENT sur les sources fournies dans le contexte.

RÈGLES STRICTES :
1. Base tes réponses UNIQUEMENT sur le contenu des sources fournies.
2. Cite tes sources en utilisant le format [SOURCE N] dans ta réponse (N = numéro de la source).
3. Si l'information n'est pas dans les sources, dis-le clairement : "Cette information n'est pas couverte par vos sources."
4. Ne fabrique JAMAIS d'informations. Reste factuel.
5. Structure tes réponses avec des paragraphes clairs et des bullet points si approprié.
6. Réponds dans la même langue que la question de l'utilisateur.
7. Si plusieurs sources se contredisent, mentionne-le et cite les deux.

FORMAT DE RÉPONSE :
- Réponse structurée et concise
- Citations [SOURCE N] intégrées dans le texte
- Section "Sources citées" en fin de réponse si > 2 citations`;

// ═══════════════════════════════════════════════════════════════════════════════

export class GroundedChat {

  /**
   * Envoie une question au notebook et retourne une réponse groundée avec citations.
   */
  async ask(notebookId: string, question: string): Promise<ChatMessage> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook) {
      throw new Error("Notebook introuvable.");
    }

    if (notebook.sources.length === 0) {
      return this.buildMessage(
        "assistant",
        "Ce notebook ne contient aucune source. Ajoutez des documents (PDF, textes, URLs) pour pouvoir poser des questions.",
        []
      );
    }

    // 1. Sauvegarder le message utilisateur
    const userMessage: ChatMessage = this.buildMessage("user", question, []);
    notebookManager.addChatMessage(notebookId, userMessage);

    // 2. Recherche RAG hybride (embeddings + TF-IDF) dans les chunks des sources
    const ragResults = await ragEngine.searchHybrid(question, notebook.sources, {
      maxChunks: 8,
      minRelevance: 0.1,
    });

    // 3. Construire le contexte groundé
    const context = ragEngine.buildContext(ragResults);

    // 4. Construire le prompt avec l'historique récent
    const recentHistory = notebook.chatHistory.slice(-6).map(msg =>
      `${msg.role === "user" ? "Utilisateur" : "Assistant"}: ${msg.content}`
    ).join("\n\n");

    const fullPrompt = `${GROUNDED_SYSTEM_PROMPT}

═══ CONTEXTE DES SOURCES ═══

${context}

═══ HISTORIQUE RÉCENT ═══

${recentHistory || "(première question)"}

═══ QUESTION DE L'UTILISATEUR ═══

${question}

Réponds en te basant sur les sources ci-dessus. Cite tes sources avec [SOURCE N].`;

    // 5. Génération de la réponse
    let responseText = "";
    try {
      const result = await generateText({
        prompt: fullPrompt,
        temperature: 0.4,
        maxOutputTokens: 4096,
      });
      responseText = result.text;
    } catch (e: any) {
      log.error(`Erreur génération réponse: ${e.message}`);
      responseText = "Désolé, une erreur est survenue lors de la génération de la réponse. Veuillez réessayer.";
    }

    // 6. Extraire les citations
    const citations = ragEngine.extractCitations(responseText, ragResults);

    // 7. Construire et sauvegarder le message assistant
    const assistantMessage = this.buildMessage("assistant", responseText, citations);
    notebookManager.addChatMessage(notebookId, assistantMessage);

    return assistantMessage;
  }

  // ─── Streaming ────────────────────────────────────────────────────────────

  /**
   * Streaming version de ask() — envoie les chunks au fur et à mesure via callback.
   * Retourne le message complet à la fin.
   */
  async askStream(
    notebookId: string,
    question: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook) throw new Error("Notebook introuvable.");

    if (notebook.sources.length === 0) {
      const msg = "Ce notebook ne contient aucune source. Ajoutez des documents pour pouvoir poser des questions.";
      onChunk(msg);
      return this.buildMessage("assistant", msg, []);
    }

    // 1. Sauvegarder le message utilisateur
    const userMessage: ChatMessage = this.buildMessage("user", question, []);
    notebookManager.addChatMessage(notebookId, userMessage);

    // 2. Recherche RAG (non-streamée — rapide)
    const ragResults = await ragEngine.searchHybrid(question, notebook.sources, {
      maxChunks: 8,
      minRelevance: 0.1,
    });

    // 3. Contexte
    const context = ragEngine.buildContext(ragResults);

    // 4. Prompt
    const recentHistory = notebook.chatHistory.slice(-6).map(msg =>
      `${msg.role === "user" ? "Utilisateur" : "Assistant"}: ${msg.content}`
    ).join("\n\n");

    const fullPrompt = `${GROUNDED_SYSTEM_PROMPT}

═══ CONTEXTE DES SOURCES ═══

${context}

═══ HISTORIQUE RÉCENT ═══

${recentHistory || "(première question)"}

═══ QUESTION DE L'UTILISATEUR ═══

${question}

Réponds en te basant sur les sources ci-dessus. Cite tes sources avec [SOURCE N].`;

    // 5. Génération en streaming
    let responseText = "";
    try {
      responseText = await generateTextStream({
        prompt: fullPrompt,
        temperature: 0.4,
        maxOutputTokens: 4096,
        onChunk,
        signal,
      });
    } catch (e: any) {
      log.error(`Erreur génération streaming: ${e.message}`);
      const errMsg = "Désolé, une erreur est survenue. Veuillez réessayer.";
      onChunk(errMsg);
      responseText = errMsg;
    }

    // 6. Citations + sauvegarde
    const citations = ragEngine.extractCitations(responseText, ragResults);
    const assistantMessage = this.buildMessage("assistant", responseText, citations);
    notebookManager.addChatMessage(notebookId, assistantMessage);

    return assistantMessage;
  }

  // ─── Follow-up automatique ────────────────────────────────────────────────

  /**
   * Génère 3 questions de suivi contextuelles basées sur la dernière réponse.
   * Tient compte de la question posée, de la réponse, et des sources citées.
   */
  async generateFollowUps(notebookId: string): Promise<string[]> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook || notebook.chatHistory.length < 2) return [];

    // Prendre les 2 derniers messages (question + réponse)
    const lastMessages = notebook.chatHistory.slice(-2);
    const lastQuestion = lastMessages.find(m => m.role === "user")?.content || "";
    const lastAnswer = lastMessages.find(m => m.role === "assistant")?.content || "";

    if (!lastQuestion || !lastAnswer) return [];

    try {
      const result = await generateText({
        prompt: `Tu es un assistant de recherche. À partir de l'échange ci-dessous, propose exactement 3 questions de suivi pertinentes que l'utilisateur pourrait poser pour approfondir le sujet.

QUESTION PRÉCÉDENTE : "${lastQuestion}"

RÉPONSE DONNÉE (extrait) : "${lastAnswer.slice(0, 800)}"

RÈGLES :
- 3 questions exactement
- Questions courtes (< 80 caractères chacune)
- Chaque question explore un angle différent : approfondissement, comparaison, application pratique
- Les questions doivent être naturelles et en lien direct avec l'échange
- Même langue que la question de l'utilisateur

Réponds UNIQUEMENT en JSON strict :
["question 1", "question 2", "question 3"]`,
        temperature: 0.6,
        maxOutputTokens: 256,
        thinkingBudget: 0,
      });

      const match = result.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((q: any) => typeof q === "string" && q.trim().length >= 5)
            .slice(0, 3);
        }
      }
    } catch (e: any) {
      log.warn(`Erreur génération follow-ups: ${e.message}`);
    }

    return [];
  }

  // ─── Deep Dive Mode ───────────────────────────────────────────────────────

  /**
   * Mode "Deep Dive" — explore un sujet en profondeur via 3-4 requêtes RAG enchaînées.
   *
   * Stratégie :
   *   1. Première requête RAG sur la question initiale → réponse partielle
   *   2. Le LLM identifie les lacunes/aspects non couverts
   *   3. Requêtes RAG complémentaires ciblées sur ces lacunes
   *   4. Synthèse finale fusionnant toutes les découvertes
   *
   * Retourne une réponse plus complète et structurée qu'un simple ask().
   */
  async deepDive(
    notebookId: string,
    question: string,
    onProgress?: (stage: string, content: string) => void
  ): Promise<ChatMessage> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook) throw new Error("Notebook introuvable.");
    if (notebook.sources.length === 0) {
      return this.buildMessage("assistant", "Aucune source disponible pour le deep dive.", []);
    }

    // Sauvegarder la question
    notebookManager.addChatMessage(notebookId, this.buildMessage("user", question, []));
    onProgress?.("search", "Recherche initiale en cours...");

    // ── Étape 1 : Recherche initiale large ─────────────────────────────────
    const initialResults = await ragEngine.searchHybrid(question, notebook.sources, {
      maxChunks: 10,
      minRelevance: 0.08,
    });

    const initialContext = ragEngine.buildContext(initialResults.slice(0, 5));
    onProgress?.("analysis", "Analyse des résultats et identification des lacunes...");

    // ── Étape 2 : Identifier les lacunes / sous-thèmes à explorer ──────────
    let subTopics: string[] = [];
    try {
      const analysisResult = await generateText({
        prompt: `Tu es un assistant de recherche approfondie.

QUESTION DE L'UTILISATEUR : "${question}"

PREMIERS RÉSULTATS DE RECHERCHE (contexte partiel) :
${initialContext.slice(0, 2000)}

TÂCHE : Identifie 2-3 aspects ou sous-thèmes de la question qui ne sont PAS bien couverts par ces premiers résultats, ou qui méritent une exploration plus poussée.

Réponds UNIQUEMENT en JSON strict — un tableau de requêtes de recherche complémentaires :
["requête complémentaire 1", "requête complémentaire 2", "requête complémentaire 3"]

Si les premiers résultats couvrent déjà bien le sujet, retourne : []`,
        temperature: 0.4,
        maxOutputTokens: 256,
        thinkingBudget: 0,
      });

      const match = analysisResult.text.match(/\[[\s\S]*\]/);
      if (match) {
        subTopics = JSON.parse(match[0])
          .filter((q: any) => typeof q === "string" && q.trim().length >= 5)
          .slice(0, 3);
      }
    } catch (e: any) {
      log.warn(`Deep dive — analyse lacunes échouée: ${e.message}`);
    }

    // ── Étape 3 : Requêtes complémentaires ciblées ─────────────────────────
    const allResults = [...initialResults];
    const seenChunkIds = new Set(initialResults.map(r => r.chunk.id));

    for (const subQuery of subTopics) {
      onProgress?.("search", `Exploration complémentaire : "${subQuery.slice(0, 60)}..."`);

      const subResults = await ragEngine.searchHybrid(subQuery, notebook.sources, {
        maxChunks: 5,
        minRelevance: 0.15,
      });

      // Dédupliquer
      for (const result of subResults) {
        if (!seenChunkIds.has(result.chunk.id)) {
          seenChunkIds.add(result.chunk.id);
          allResults.push(result);
        }
      }
    }

    // Trier tous les résultats et garder les meilleurs
    allResults.sort((a, b) => b.relevance - a.relevance);
    const topResults = allResults.slice(0, 12);
    const fullContext = ragEngine.buildContext(topResults);

    onProgress?.("synthesis", "Synthèse finale en cours...");

    // ── Étape 4 : Synthèse finale ─────────────────────────────────────────
    const synthesisPrompt = `${GROUNDED_SYSTEM_PROMPT}

MODE DEEP DIVE — Tu as accès à un contexte étendu issu de MULTIPLES recherches complémentaires.

Ta réponse doit être :
- EXHAUSTIVE : couvre tous les aspects trouvés dans les sources
- STRUCTURÉE : utilise des sections, sous-titres, bullet points
- SYNTHÉTIQUE : croise les informations de différentes sources
- NUANCÉE : mentionne les contradictions ou limites si elles existent

═══ CONTEXTE ÉTENDU (MULTI-RECHERCHE) ═══

${fullContext}

═══ QUESTION DE L'UTILISATEUR ═══

${question}

${subTopics.length > 0 ? `\nSous-thèmes explorés : ${subTopics.join(", ")}` : ""}

Fournis une réponse approfondie et structurée. Cite avec [SOURCE N].`;

    let responseText = "";
    try {
      const result = await generateText({
        prompt: synthesisPrompt,
        temperature: 0.4,
        maxOutputTokens: 6144, // Plus long que le mode normal
      });
      responseText = result.text;
    } catch (e: any) {
      log.error(`Deep dive — synthèse échouée: ${e.message}`);
      responseText = "Erreur lors de la synthèse du deep dive. Veuillez réessayer.";
    }

    // Citations et sauvegarde
    const citations = ragEngine.extractCitations(responseText, topResults);
    const assistantMessage = this.buildMessage("assistant", responseText, citations);
    notebookManager.addChatMessage(notebookId, assistantMessage);

    onProgress?.("done", "Deep dive terminé.");
    return assistantMessage;
  }

  /**
   * Chat multi-turn : prend en compte le contexte conversationnel.
   */
  async askWithContext(
    notebookId: string,
    question: string,
    additionalContext?: string
  ): Promise<ChatMessage> {
    if (additionalContext) {
      const enrichedQuestion = `${question}\n\nContexte additionnel: ${additionalContext}`;
      return this.ask(notebookId, enrichedQuestion);
    }
    return this.ask(notebookId, question);
  }

  // ─── Compare Sources ──────────────────────────────────────────────────────

  /**
   * Compare 2+ sources entre elles : similitudes, différences, contradictions.
   */
  async compareSources(
    notebookId: string,
    sourceIds: string[],
    onChunk?: (chunk: string) => void
  ): Promise<ChatMessage> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook) throw new Error("Notebook introuvable.");

    const sources = notebook.sources.filter(s => sourceIds.includes(s.id));
    if (sources.length < 2) throw new Error("Au moins 2 sources sont nécessaires pour une comparaison.");

    // Sauvegarder le message utilisateur
    const userMsg = this.buildMessage("user", `🔄 Comparer : ${sources.map(s => `"${s.title}"`).join(" vs ")}`, []);
    notebookManager.addChatMessage(notebookId, userMsg);

    // Construire le contexte de chaque source
    const sourcesContext = sources.map(s =>
      `═══ SOURCE : "${s.title}" ═══\nRésumé : ${s.summary}\n\nContenu clé :\n${s.chunks.slice(0, 6).map(c => c.content).join("\n\n")}`
    ).join("\n\n────────────────────────────\n\n");

    const prompt = `Tu es un analyste expert en comparaison documentaire. Compare les sources suivantes de manière détaillée et structurée.

${sourcesContext}

ANALYSE DEMANDÉE :

## 🔄 Comparaison : ${sources.map(s => `"${s.title}"`).join(" vs ")}

Structure ta réponse avec :

### 📌 Points communs
Les idées, faits ou concepts partagés par les sources.

### ⚡ Différences clés
Les divergences d'approche, de perspective ou de contenu.

### ⚠️ Contradictions
Les points où les sources se contredisent (si applicable).

### 🎯 Synthèse comparative
Un tableau ou résumé qui met en perspective les forces/limites de chaque source.

### 💡 Complémentarité
Comment ces sources se complètent mutuellement.

Cite les sources avec leur nom entre guillemets. Sois précis et factuel.`;

    let responseText = "";
    try {
      if (onChunk) {
        const { generateTextStream } = await import("../utils/textGeneration");
        responseText = await generateTextStream({
          prompt,
          temperature: 0.4,
          maxOutputTokens: 6144,
          onChunk,
        });
      } else {
        const result = await generateText({
          prompt,
          temperature: 0.4,
          maxOutputTokens: 6144,
        });
        responseText = result.text;
      }
    } catch (e: any) {
      log.error(`Erreur comparaison sources: ${e.message}`);
      responseText = "Erreur lors de la comparaison. Veuillez réessayer.";
    }

    const assistantMsg = this.buildMessage("assistant", responseText, []);
    notebookManager.addChatMessage(notebookId, assistantMsg);
    return assistantMsg;
  }

  // ─── Extract Insights ─────────────────────────────────────────────────────

  /**
   * Extrait les insights clés, tendances, et patterns des sources du notebook.
   */
  async extractInsights(
    notebookId: string,
    onChunk?: (chunk: string) => void
  ): Promise<ChatMessage> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook) throw new Error("Notebook introuvable.");
    if (notebook.sources.length === 0) throw new Error("Aucune source disponible.");

    // Sauvegarder le message utilisateur
    const userMsg = this.buildMessage("user", "💡 Extraction d'insights — analyse approfondie des sources", []);
    notebookManager.addChatMessage(notebookId, userMsg);

    // Construire le contexte enrichi
    const sourcesContext = notebook.sources.map(s =>
      `## ${s.title}\nRésumé : ${s.summary}\nMots-clés : ${s.keywords.join(", ")}\n\nExtraits :\n${s.chunks.slice(0, 4).map(c => c.content).join("\n\n")}`
    ).join("\n\n---\n\n");

    const prompt = `Tu es un analyste de recherche senior. Analyse en profondeur les sources suivantes et extrais des insights de haut niveau.

SOURCES :
${sourcesContext}

ANALYSE DEMANDÉE — Structure ta réponse exactement ainsi :

## 💡 Insights clés

### 🔑 Findings principaux
Les découvertes ou informations les plus importantes (5-8 points, classés par importance).

### 📈 Tendances identifiées
Les patterns, évolutions ou tendances qui émergent de l'ensemble des sources.

### 🔗 Connexions cachées
Les liens non évidents entre différentes sources ou concepts qui apportent une compréhension plus profonde.

### ⚠️ Points de vigilance
Les risques, limites, biais ou zones d'ombre dans les sources.

### 🎯 Conclusions actionables
Ce qu'un décideur devrait retenir et les actions recommandées.

### ❓ Questions ouvertes
Les questions que les sources soulèvent mais ne répondent pas (pistes de recherche future).

Sois analytique, rigoureux et surprenant dans tes connexions. Chaque insight doit apporter une valeur au-delà de la simple lecture des sources.`;

    let responseText = "";
    try {
      if (onChunk) {
        const { generateTextStream } = await import("../utils/textGeneration");
        responseText = await generateTextStream({
          prompt,
          temperature: 0.5,
          maxOutputTokens: 6144,
          onChunk,
        });
      } else {
        const result = await generateText({
          prompt,
          temperature: 0.5,
          maxOutputTokens: 6144,
        });
        responseText = result.text;
      }
    } catch (e: any) {
      log.error(`Erreur extraction insights: ${e.message}`);
      responseText = "Erreur lors de l'extraction des insights. Veuillez réessayer.";
    }

    const assistantMsg = this.buildMessage("assistant", responseText, []);
    notebookManager.addChatMessage(notebookId, assistantMsg);
    return assistantMsg;
  }

  /**
   * Suggère des questions pertinentes basées sur le contenu des sources.
   */
  async suggestQuestions(notebookId: string): Promise<string[]> {
    const notebook = notebookManager.getNotebook(notebookId);
    if (!notebook || notebook.sources.length === 0) return [];

    // Prendre un échantillon des résumés des sources
    const summaries = notebook.sources
      .map(s => `- "${s.title}": ${s.summary}`)
      .slice(0, 5)
      .join("\n");

    try {
      const result = await generateText({
        prompt: `Voici les résumés de documents dans un notebook de recherche :

${summaries}

Génère exactement 5 questions intéressantes et pertinentes que l'utilisateur pourrait poser sur ces documents. Les questions doivent être variées (compréhension, comparaison, synthèse, détail).

Réponds en JSON strict :
["question 1", "question 2", "question 3", "question 4", "question 5"]`,
        temperature: 0.7,
        maxOutputTokens: 512,
      });

      const match = result.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed.slice(0, 5);
      }
    } catch (e: any) {
      log.warn(`Erreur suggestion questions: ${e.message}`);
    }

    return [];
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildMessage(role: "user" | "assistant", content: string, citations: Citation[]): ChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      citations,
      timestamp: new Date().toISOString(),
    };
  }
}

export const groundedChat = new GroundedChat();
