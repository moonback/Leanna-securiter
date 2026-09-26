/**
 * ToolCallParser — Extraction des appels d'outils depuis la sortie du modèle
 *
 * Responsabilité unique : transformer un texte de réponse LLM en une liste
 * structurée d'appels d'outils (`AgentToolCall`). Aucune dépendance à l'état
 * d'exécution — fonctions pures, testables isolément.
 *
 * Trois formats sont reconnus :
 *   1. JSON structuré `{"tool_calls": [...]}`
 *   2. Format provider `<|tool_call>call:tool_name{...}`
 *   3. Objets inline `{"name": "tool", "parameters"|"arguments": {...}}`
 */

export interface AgentToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

/** Nombre maximum d'appels d'outils extraits d'une seule réponse. */
const MAX_CALLS_PER_RESPONSE = 6;

/** Extrait les paramètres d'un appel, acceptant "parameters" ou "arguments" (format OpenAI). */
export function extractCallParams(call: {
  parameters?: unknown;
  arguments?: unknown;
  args?: unknown;
}): Record<string, unknown> {
  const raw = call.parameters ?? call.arguments ?? call.args;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  // Si c'est une string JSON, tenter de la parser
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      /* not valid JSON */
    }
  }
  return {};
}

/** Parse un objet JSON en respectant les accolades imbriquées. */
export function extractJsonObject(text: string, startIdx: number): Record<string, unknown> | null {
  if (startIdx < 0 || text[startIdx] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length && i < startIdx + 2000; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(startIdx, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractToolCalls(resultText: string): AgentToolCall[] {
  // Format 1: JSON structuré {"tool_calls": [...]}
  try {
    const parsed = JSON.parse(resultText.trim());
    if (Array.isArray(parsed?.tool_calls)) {
      const rawCalls: unknown[] = parsed.tool_calls;
      const calls = rawCalls
        .filter(
          (call): call is { name: string; parameters?: unknown; arguments?: unknown } =>
            Boolean(call && typeof call === "object" && typeof (call as { name?: unknown }).name === "string")
        )
        .slice(0, MAX_CALLS_PER_RESPONSE)
        .map((call: { name: string; parameters?: unknown; arguments?: unknown }) => ({
          name: call.name,
          parameters: extractCallParams(call),
        }));
      if (calls.length > 0) return calls;
    }
  } catch {
    /* not JSON */
  }

  // Format 2: <|tool_call>call:tool_name{"param":"value"} ou variantes provider
  const providerPattern = /<\|tool_call>call:(\w+)\s*(\{[^}]*\})?/gi;
  const providerCalls: AgentToolCall[] = [];
  let providerMatch: RegExpExecArray | null;
  while ((providerMatch = providerPattern.exec(resultText)) !== null && providerCalls.length < MAX_CALLS_PER_RESPONSE) {
    const name = providerMatch[1];
    let parameters: Record<string, unknown> = {};
    if (providerMatch[2]) {
      try {
        parameters = JSON.parse(providerMatch[2]);
      } catch {
        /* malformed */
      }
    }
    providerCalls.push({ name, parameters });
  }
  if (providerCalls.length > 0) return providerCalls;

  // Format 3: {"name": "tool", "parameters"|"arguments": {...}} en ligne (certains providers)
  // Utilise un parsing JSON-aware au lieu d'un regex fragile pour capturer les objets imbriqués
  const inlineCalls: AgentToolCall[] = [];
  const inlinePattern = /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"(?:parameters|arguments)"\s*:\s*/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlinePattern.exec(resultText)) !== null && inlineCalls.length < MAX_CALLS_PER_RESPONSE) {
    const name = inlineMatch[1];
    // Extraire l'objet JSON à partir de la position après "parameters":
    const paramsStartIdx = resultText.indexOf("{", inlineMatch.index! + inlineMatch[0].length - 1);
    const params = extractJsonObject(resultText, paramsStartIdx);
    if (params !== null) {
      inlineCalls.push({ name, parameters: params });
    }
  }
  return inlineCalls;
}
