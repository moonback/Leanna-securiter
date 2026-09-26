/**
 * Route API pour générer un agent personnalisé via IA (OpenRouter/Gemini).
 * L'utilisateur décrit l'agent qu'il veut et l'IA génère la configuration complète.
 */

import type { Request, Response } from "express";
import { generateText } from "../utils/textGeneration.js";

const AGENT_GENERATION_PROMPT = `Tu es un expert en conception d'agents IA. L'utilisateur va te décrire l'agent qu'il souhaite créer.
Tu dois générer une configuration JSON complète pour cet agent.

RÈGLES :
- Réponds UNIQUEMENT avec un bloc JSON valide (pas de markdown, pas d'explication)
- Le JSON doit respecter exactement cette structure :

{
  "name": "string - nom court et clair de l'agent",
  "role": "string - identifiant court en minuscules (ex: reviewer, optimizer, designer)",
  "description": "string - description en 1-2 phrases de ce que fait l'agent",
  "avatar": "string - un seul emoji représentant l'agent",
  "color": "string - couleur hex (ex: #60a5fa)",
  "systemPrompt": "string - instructions détaillées pour l'agent (comportement, contraintes, style)",
  "capabilities": ["array de strings - capacités/compétences de l'agent"],
  "tools": ["array de strings - outils nécessaires parmi: read_project_file, write_project_file, apply_patch, search_in_files, list_project_files, system_execute_command, git_status, git_commit, git_push, automation_navigate, automation_extract, save_memory, search_memory, reasoning_think, agent_delegate"],
  "temperature": number entre 0 et 2 (0.3 pour précision, 0.7 pour équilibré, 1.2+ pour créativité),
  "maxTokens": number (4096 à 32768 selon la complexité des tâches),
  "maxConcurrency": number (1 à 5),
  "defaultTimeoutMs": number (30000 à 300000),
  "triggerKeywords": ["array de mots-clés qui déclenchent cet agent"],
  "autoDelegate": boolean (true si l'agent doit pouvoir déléguer à d'autres)
}

Sois créatif et pertinent dans le systemPrompt. Adapte les outils aux besoins réels de l'agent.
Choisis un emoji et une couleur qui correspondent à la personnalité de l'agent.`;

export async function handleGenerateAgent(req: Request, res: Response) {
  try {
    const { description, model } = req.body as { description?: string; model?: string };

    if (!description || typeof description !== "string" || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte. Décris l'agent que tu veux créer." });
    }

    const result = await generateText({
      systemPrompt: AGENT_GENERATION_PROMPT,
      prompt: `Crée un agent basé sur cette description : "${description.trim()}"`,
      temperature: 0.8,
      maxTokens: 4096,
      ...(model && model !== "default" ? { openrouterModel: model } : {}),
    });

    // Parse le JSON de la réponse
    let agentConfig: any;
    try {
      // Nettoyer la réponse (parfois le LLM ajoute des backticks)
      let jsonText = result.text.trim();
      if (jsonText.startsWith("```json")) jsonText = jsonText.slice(7);
      if (jsonText.startsWith("```")) jsonText = jsonText.slice(3);
      if (jsonText.endsWith("```")) jsonText = jsonText.slice(0, -3);
      jsonText = jsonText.trim();

      agentConfig = JSON.parse(jsonText);
    } catch (parseErr) {
      return res.status(422).json({
        error: "L'IA n'a pas produit un JSON valide. Réessaie avec une description plus précise.",
        raw: result.text.slice(0, 500),
      });
    }

    // Validation minimale
    if (!agentConfig.name || !agentConfig.role || !agentConfig.systemPrompt) {
      return res.status(422).json({
        error: "Configuration incomplète générée. Réessaie.",
        raw: agentConfig,
      });
    }

    // Normaliser les champs optionnels
    agentConfig.tools = Array.isArray(agentConfig.tools) ? agentConfig.tools : [];
    agentConfig.capabilities = Array.isArray(agentConfig.capabilities) ? agentConfig.capabilities : [];
    agentConfig.triggerKeywords = Array.isArray(agentConfig.triggerKeywords) ? agentConfig.triggerKeywords : [];
    agentConfig.temperature = typeof agentConfig.temperature === "number" ? agentConfig.temperature : 0.7;
    agentConfig.maxTokens = typeof agentConfig.maxTokens === "number" ? agentConfig.maxTokens : 8192;
    agentConfig.maxConcurrency = typeof agentConfig.maxConcurrency === "number" ? agentConfig.maxConcurrency : 2;
    agentConfig.defaultTimeoutMs = typeof agentConfig.defaultTimeoutMs === "number" ? agentConfig.defaultTimeoutMs : 60000;
    agentConfig.autoDelegate = typeof agentConfig.autoDelegate === "boolean" ? agentConfig.autoDelegate : false;
    agentConfig.model = model || "default";

    return res.json({
      success: true,
      agent: agentConfig,
      provider: result.provider,
      generationModel: result.model,
    });
  } catch (err: any) {
    console.error("[generate-agent] Error:", err.message);
    return res.status(500).json({ error: err.message || "Erreur lors de la génération" });
  }
}
