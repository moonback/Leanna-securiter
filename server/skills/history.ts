import { Skill, validateArgs } from "./base.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateText } from "../utils/textGeneration.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("History");

// ── Types ───────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string | null;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  created_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SearchResult {
  message_id: string;
  conversation_id: string;
  conversation_title: string | null;
  role: string;
  content: string;
  created_at: string;
  rank: number;
}

// ── Supabase helper ─────────────────────────────────────────────────────────

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Veuillez configurer SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(supabaseUrl, supabaseKey);
}

// ── Session management ──────────────────────────────────────────────────────

// Active conversation tracking (in-memory, per server instance)
let activeConversationId: string | null = null;

/**
 * Start a new conversation session. Returns the conversation ID.
 */
export async function startConversation(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert([{ title: null, summary: null, message_count: 0 }])
    .select("id")
    .single();

  if (error) throw new Error(`Erreur création conversation: ${error.message}`);
  activeConversationId = data.id;
  console.log(`[History] Nouvelle conversation démarrée: ${data.id}`);
  return data.id;
}

/**
 * End the current conversation session.
 * Generates an AI summary of the conversation before closing.
 */
export async function endConversation(conversationId?: string): Promise<void> {
  const id = conversationId || activeConversationId;
  if (!id) return;

  const supabase = getSupabaseClient();

  // Generate summary from conversation messages
  let summary: string | null = null;
  try {
    const { data: messages } = await supabase
      .from("conversation_messages")
      .select("role, content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(15);

    if (messages && messages.length >= 2) {
      summary = await generateConversationSummary(messages);
    }
  } catch (e) {
    console.error("[History] Erreur génération résumé:", e);
  }

  await supabase
    .from("conversations")
    .update({
      ended_at: new Date().toISOString(),
      ...(summary ? { summary } : {}),
    })
    .eq("id", id);

  console.log(`[History] Conversation terminée: ${id}${summary ? ' (avec résumé)' : ''}`);
  if (id === activeConversationId) activeConversationId = null;
}

/**
 * Generate a short summary of a conversation using Gemini.
 * Uses the key pool with automatic retry on 429 rate limits.
 */
async function generateConversationSummary(
  messages: { role: string; content: string }[]
): Promise<string | null> {
  // Build a condensed transcript (limit to avoid token overflow)
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"}: ${m.content.slice(0, 200)}`)
    .join("\n")
    .slice(0, 3000);

  try {
    const response = await generateText({
      prompt: `Résume cette conversation en 1 à 2 phrases courtes en français. Le résumé doit capturer le sujet principal et les points clés. Pas de préambule, juste le résumé.\n\n${transcript}`,
      temperature: 0.3,
      maxTokens: 1024,
    });

    const text = response.text;
    if (text) {
      const cleaned = text.trim().slice(0, 300);
      console.log(`[History] Résumé généré (${response.provider}): "${cleaned}"`);
      return cleaned;
    }
  } catch (e: any) {
    if (e.status === 402 || e.message?.includes("402")) {
      logger.warn("Résumé ignoré : crédits OpenRouter insuffisants.");
      return null;
    }
    console.error("[History] Erreur appel IA pour résumé:", e);
  }

  return null;
}

/**
 * Save a message to the current active conversation.
 */
export async function saveMessage(
  role: "user" | "assistant",
  content: string,
  conversationId?: string
): Promise<void> {
  const id = conversationId || activeConversationId;
  if (!id || !content.trim()) return;

  const supabase = getSupabaseClient();

  // Insert message
  const { error } = await supabase
    .from("conversation_messages")
    .insert([{ conversation_id: id, role, content: content.trim() }]);

  if (error) {
    console.error(`[History] Erreur sauvegarde message:`, error.message);
    return;
  }

  // Count messages and update conversation
  const { count } = await supabase
    .from("conversation_messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", id);

  const updates: Record<string, any> = { message_count: count || 0 };

  // Auto-generate title from first user message
  if (role === "user") {
    const { data: conv } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", id)
      .single();

    if (!conv?.title) {
      updates.title = content.trim().slice(0, 80) + (content.trim().length > 80 ? "…" : "");
    }
  }

  await supabase.from("conversations").update(updates).eq("id", id);
}

/**
 * Get the active conversation ID (or null).
 */
export function getActiveConversationId(): string | null {
  return activeConversationId;
}

// ── Query functions (for API routes) ────────────────────────────────────────

export async function listConversations(limit = 30, offset = 0): Promise<Conversation[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  return (data || []) as Conversation[];
}

export async function getConversationMessages(
  conversationId: string,
  limit = 100,
  offset = 0
): Promise<ConversationMessage[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  return (data || []) as ConversationMessage[];
}

export async function searchHistory(query: string, limit = 20): Promise<SearchResult[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("search_conversations", {
    search_query: query,
    result_limit: limit,
  });

  if (error) throw new Error(error.message);
  return (data || []) as SearchResult[];
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);

  if (error) throw new Error(error.message);
}

/**
 * Delete ALL conversations and their messages (cascade).
 * Returns the number of deleted conversations.
 */
export async function clearAllConversations(): Promise<number> {
  const supabase = getSupabaseClient();

  // Count before deleting
  const { count } = await supabase
    .from("conversations")
    .select("*", { count: "exact", head: true });

  const { error } = await supabase
    .from("conversations")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

  if (error) throw new Error(error.message);

  // Reset active conversation
  activeConversationId = null;

  console.log(`[History] Toutes les conversations supprimées (${count || 0})`);
  return count || 0;
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", conversationId);

  if (error) throw new Error(error.message);
}

// ── Skill declaration (for Gemini tool calls) ───────────────────────────────

export const historySkill: Skill = {
  name: "history",
  declarations: [
    {
      name: "search_history",
      description:
        "Rechercher dans l'historique des conversations passées avec l'utilisateur. Utile pour retrouver un sujet discuté précédemment.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Les mots-clés à chercher dans l'historique des conversations",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_conversation_context",
      description:
        "Récupérer les messages d'une conversation précédente pour en reprendre le contexte.",
      parameters: {
        type: "OBJECT",
        properties: {
          conversation_id: {
            type: "STRING",
            description: "L'identifiant UUID de la conversation à consulter",
          },
        },
        required: ["conversation_id"],
      },
    },
  ],
  inputSchemas: {
    search_history: z.object({
      query: z.string().min(1, "La requête ne peut être vide").trim(),
    }),
    get_conversation_context: z.object({
      conversation_id: z.string().uuid("ID de conversation invalide"),
    }),
  },
  handleToolCall: async (name, args) => {
    if (name === "search_history") {
      try {
        const validated = validateArgs(historySkill.inputSchemas!["search_history"], args);
        console.log(`[History] Recherche: "${validated.query}"`);
        const results = await searchHistory(validated.query);
        return {
          status: "success",
          results: results.map((r) => ({
            conversation_id: r.conversation_id,
            conversation_title: r.conversation_title,
            role: r.role,
            content: r.content,
            date: r.created_at,
          })),
        };
      } catch (e: any) {
        return { error: e.message };
      }
    }

    if (name === "get_conversation_context") {
      try {
        const validated = validateArgs(
          historySkill.inputSchemas!["get_conversation_context"],
          args
        );
        console.log(`[History] Récupération contexte: ${validated.conversation_id}`);
        const messages = await getConversationMessages(validated.conversation_id, 50);
        return {
          status: "success",
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            date: m.created_at,
          })),
        };
      } catch (e: any) {
        return { error: e.message };
      }
    }
  },
};
