/**
 * textGeneration.ts — Unified text generation helper.
 * Routes AI text generation calls to either Gemini or OpenRouter
 * based on the user's profile setting (textProvider).
 *
 * Usage:
 *   import { generateText, generateTextStream, setTextGenerationProfile } from './utils/textGeneration.js';
 *   const result = await generateText({ prompt: "...", systemPrompt: "..." });
 *   const stream = generateTextStream({ prompt: "...", onChunk: (text) => ... });
 */

import { withGeminiRetry } from "./geminiKeyPool.js";
import { getNextGeminiKey } from "./geminiKeyPool.js";
import { GoogleGenAI } from "@google/genai";
import { telemetryService } from "../observability/TelemetryService.js";

// ── Profile interface (minimal subset needed here) ──────────────────────────

interface TextGenProfile {
  textProvider?: 'gemini' | 'openrouter';
  openrouterModel?: string;
  openrouterApiKey?: string;
}

let _profile: TextGenProfile = {};

/**
 * Called by server.ts at startup and whenever the profile is updated.
 */
export function setTextGenerationProfile(profile: TextGenProfile): void {
  _profile = profile;
}

/**
 * Get the currently active provider.
 */
export function getActiveProvider(): 'gemini' | 'openrouter' {
  return _profile.textProvider || 'gemini';
}

// ── Options for generateText ────────────────────────────────────────────────

export interface GenerateTextOptions {
  /** The user prompt / content */
  prompt: string;
  /** Optional system prompt (used only with OpenRouter, Gemini uses it as part of contents) */
  systemPrompt?: string;
  /** Temperature (default 0.5) */
  temperature?: number;
  /** Max tokens for OpenRouter (default 8192 — suffisant pour les sorties agents complètes) */
  maxTokens?: number;
  /** Limite de sortie explicite pour Gemini; propagée aussi à OpenRouter si maxTokens absent. */
  maxOutputTokens?: number;
  /** Gemini model override (default gemini-2.5-flash) */
  geminiModel?: string;
  /** OpenRouter model override (uses profile setting if not provided) */
  openrouterModel?: string;
  /** Gemini thinking budget override; use 0 when an agent needs visible output immediately. */
  thinkingBudget?: number;
  /** For Gemini: if you need to pass multimodal parts directly */
  geminiParts?: any[];
  /** Force a specific provider for this call, ignoring profile setting */
  forceProvider?: 'gemini' | 'openrouter';
}

export interface GenerateTextResult {
  text: string;
  provider: 'gemini' | 'openrouter';
  model: string;
  /** Token usage (captured from API response) */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// ── Cross-provider fallback + circuit breaker ───────────────────────────────

type Provider = 'gemini' | 'openrouter';

/**
 * Lightweight per-provider circuit breaker. After a run of consecutive
 * failures, a provider is skipped for a cooldown so the fallback path is not
 * spent probing a provider that is clearly down. Purely in-process, mirroring
 * the autonomy TaskManager breaker but scoped to LLM providers.
 */
const providerBreaker: Record<Provider, { failures: number; openedAt?: number }> = {
  gemini: { failures: 0 },
  openrouter: { failures: 0 },
};

const boolEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
};

const positiveEnv = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const fallbackConfig = () => ({
  enabled: boolEnv(process.env.LEANNA_PROVIDER_FALLBACK, true),
  breakerThreshold: positiveEnv(process.env.LEANNA_PROVIDER_BREAKER_THRESHOLD, 3),
  breakerCooldownMs: positiveEnv(process.env.LEANNA_PROVIDER_BREAKER_COOLDOWN_MS, 60_000),
});

function isBreakerOpen(provider: Provider, cooldownMs: number): boolean {
  const state = providerBreaker[provider];
  if (state.openedAt === undefined) return false;
  if (Date.now() - state.openedAt >= cooldownMs) {
    providerBreaker[provider] = { failures: 0 };
    return false;
  }
  return true;
}

function recordProviderResult(provider: Provider, ok: boolean, threshold: number): void {
  const state = providerBreaker[provider];
  if (ok) {
    providerBreaker[provider] = { failures: 0 };
    return;
  }
  const failures = state.failures + 1;
  providerBreaker[provider] = { failures, openedAt: failures >= threshold ? Date.now() : state.openedAt };
}

/** Dispatch to a single provider implementation with no fallback. */
async function generateOnce(provider: Provider, options: GenerateTextOptions): Promise<GenerateTextResult> {
  return provider === 'openrouter' ? generateWithOpenRouter(options) : generateWithGemini(options);
}

/**
 * Generate text using the configured provider (Gemini or OpenRouter), with
 * automatic cross-provider fallback.
 *
 * Order of resolution:
 *  1. Primary provider = options.forceProvider || profile.textProvider || 'gemini'.
 *  2. On failure, if fallback is enabled, retry once on the other provider.
 *  3. A per-provider circuit breaker skips a provider that recently failed
 *     repeatedly, so a sustained outage does not add latency to every call.
 *
 * The inner layers are preserved: Gemini keeps its key-pool rotation
 * (withGeminiRetry) and OpenRouter keeps its own timeout handling. This wrapper
 * only adds cross-provider failover on errors those layers rethrow.
 */
export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const primary: Provider = options.forceProvider || _profile.textProvider || 'gemini';
  const { enabled, breakerThreshold, breakerCooldownMs } = fallbackConfig();

  // A caller that forces a provider opts out of cross-provider fallback.
  if (!enabled || options.forceProvider) {
    return generateOnce(primary, options);
  }

  const secondary: Provider = primary === 'gemini' ? 'openrouter' : 'gemini';
  const order: Provider[] = [primary, secondary];
  const errors: string[] = [];

  for (const provider of order) {
    if (isBreakerOpen(provider, breakerCooldownMs) && provider !== order[order.length - 1]) {
      errors.push(`${provider}: circuit ouvert (récemment en échec)`);
      continue;
    }
    try {
      const result = await generateOnce(provider, { ...options, forceProvider: provider });
      recordProviderResult(provider, true, breakerThreshold);
      return result;
    } catch (error) {
      recordProviderResult(provider, false, breakerThreshold);
      errors.push(`${provider}: ${(error as Error).message}`);
    }
  }

  throw new Error(`Tous les providers ont échoué. ${errors.join(' | ')}`);
}

// Internal context for telemetry correlation (set by skills/agents)
let _currentTaskId: string | undefined;
let _currentMissionId: string | undefined;
let _currentAgentRole: string | undefined;
let _currentToolName: string | undefined;

/**
 * Set telemetry context for model calls (called by AgentExecutor/Mission system).
 */
export function setTelemetryContext(context: {
  taskId?: string;
  missionId?: string;
  agentRole?: string;
  toolName?: string;
}): void {
  _currentTaskId = context.taskId;
  _currentMissionId = context.missionId;
  _currentAgentRole = context.agentRole;
  _currentToolName = context.toolName;
}

/**
 * Clear telemetry context (called after task/mission completion).
 */
export function clearTelemetryContext(): void {
  _currentTaskId = undefined;
  _currentMissionId = undefined;
  _currentAgentRole = undefined;
  _currentToolName = undefined;
}

// ── Streaming support ───────────────────────────────────────────────────────

export interface GenerateTextStreamOptions extends GenerateTextOptions {
  /** Callback appelé pour chaque chunk de texte reçu */
  onChunk: (text: string) => void;
  /** Callback appelé quand le stream est terminé (optionnel) */
  onDone?: (fullText: string) => void;
  /** Callback d'erreur (optionnel) */
  onError?: (error: Error) => void;
  /** Signal d'annulation (optionnel) */
  signal?: AbortSignal;
}

/**
 * Generate text in streaming mode — appelle onChunk au fur et à mesure.
 * Supporte Gemini (generateContentStream) et OpenRouter (SSE).
 */
export async function generateTextStream(options: GenerateTextStreamOptions): Promise<string> {
  const provider = _profile.textProvider || 'gemini';

  if (provider === 'openrouter') {
    return streamWithOpenRouter(options);
  }
  return streamWithGemini(options);
}

// ── Gemini streaming implementation ─────────────────────────────────────────

async function streamWithGemini(options: GenerateTextStreamOptions): Promise<string> {
  const model = options.geminiModel || 'gemini-2.5-flash';

  const parts = options.geminiParts
    ? options.geminiParts
    : [{ text: options.systemPrompt ? `${options.systemPrompt}\n\n${options.prompt}` : options.prompt }];

  const key = getNextGeminiKey();
  if (!key) throw new Error("Aucune clé Gemini API disponible.");

  const ai = new GoogleGenAI({ apiKey: key });

  const response = await ai.models.generateContentStream({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      temperature: options.temperature ?? 0.5,
      // Voir generateWithGemini : même repli maxTokens → maxOutputTokens.
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : options.maxTokens !== undefined
          ? { maxOutputTokens: options.maxTokens }
          : {}),
      ...(options.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
        : {}),
    },
  });

  let fullText = "";

  for await (const chunk of response) {
    if (options.signal?.aborted) break;

    // Extraire le texte visible (ignorer les parties "thought")
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if ((part as any).thought) continue;
      const text = (part as any).text;
      if (text) {
        fullText += text;
        options.onChunk(text);
      }
    }
  }

  options.onDone?.(fullText);
  return fullText;
}

// ── OpenRouter streaming implementation ─────────────────────────────────────

async function streamWithOpenRouter(options: GenerateTextStreamOptions): Promise<string> {
  const orKey = _profile.openrouterApiKey?.trim()
    || process.env.OPENROUTER_API_KEY
    || process.env.OPENROUTER_FREE_API_KEY;

  if (!orKey) {
    console.warn('[TextGen] OpenRouter configuré mais aucune clé disponible, fallback Gemini stream');
    return streamWithGemini(options);
  }

  const model = options.openrouterModel || _profile.openrouterModel || 'google/gemini-3.6-flash';

  const messages: any[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  // Si un signal externe est fourni, le propager
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${orKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://Leanna.local',
        'X-Title': process.env.OPENROUTER_TITLE || 'Leanna',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens ?? options.maxOutputTokens ?? 8192,
        stream: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
    }

    let fullText = "";
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body reader");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            options.onChunk(content);
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    options.onDone?.(fullText);
    return fullText;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      options.onDone?.(``);
      return "";
    }
    options.onError?.(e);
    throw e;
  }
}

// ── Gemini non-streaming implementation ─────────────────────────────────────

async function generateWithGemini(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const model = options.geminiModel || 'gemini-2.5-flash';

  // Start OTel span for this model call
  const span = telemetryService.startModelCallSpan('gemini', model, _currentTaskId);
  span.setAttribute('prompt.length', options.prompt.length);
  if (options.systemPrompt) {
    span.setAttribute('system_prompt.length', options.systemPrompt.length);
  }

  try {
    // Build parts — if custom geminiParts provided, use those; otherwise text-only
    const parts = options.geminiParts
      ? options.geminiParts
      : [{ text: options.systemPrompt ? `${options.systemPrompt}\n\n${options.prompt}` : options.prompt }];

    // Timeout de 120s pour éviter que l'AgentExecutor se bloque indéfiniment
    // sur un appel Gemini suspendu (réseau lent, modèle surchargé).
    const GEMINI_TIMEOUT_MS = 120_000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout après ${GEMINI_TIMEOUT_MS / 1000}s`)), GEMINI_TIMEOUT_MS)
    );

    const response = await Promise.race([
      withGeminiRetry((ai) =>
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            temperature: options.temperature ?? 0.5,
            // maxOutputTokens est la clé "native" Gemini ; maxTokens est le nom
            // générique utilisé par les appelants (ex. chainOfThought.ts) qui
            // partagent le même code avec OpenRouter. Sans ce repli, un appel
            // ne fournissant que `maxTokens` n'appliquait AUCUNE limite sur
            // Gemini (le provider par défaut), ce qui rendait les budgets de
            // tokens du module CoT inopérants dans le cas le plus courant.
            ...(options.maxOutputTokens !== undefined
              ? { maxOutputTokens: options.maxOutputTokens }
              : options.maxTokens !== undefined
                ? { maxOutputTokens: options.maxTokens }
                : {}),
            ...(options.thinkingBudget !== undefined
              ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
              : {}),
          },
        })
      ),
      timeoutPromise,
    ]);

    const rawResponse = response as {
      text?: string;
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const visibleParts = (rawResponse.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text!.trim())
      .filter(Boolean);
    const text = rawResponse.text?.trim() || visibleParts.join("\n");

    if (!text) {
      const finishReasons = (rawResponse.candidates ?? [])
        .map((candidate) => candidate.finishReason ?? "unknown")
        .join(", ");
      console.warn(`[TextGen] Gemini n'a renvoyé aucun texte visible (finish: ${finishReasons || "aucun"}).`);
    }

    // Extract token usage from usageMetadata
    const usage = rawResponse.usageMetadata;
    const tokenUsage = usage ? {
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
    } : undefined;

    // Record tokens in telemetry service
    if (tokenUsage) {
      const cost = telemetryService.recordTokenUsage({
        missionId: _currentMissionId,
        taskId: _currentTaskId,
        agentRole: _currentAgentRole,
        toolName: _currentToolName,
        provider: 'gemini',
        model,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
      });

      span.setAttribute('tokens.input', tokenUsage.inputTokens);
      span.setAttribute('tokens.output', tokenUsage.outputTokens);
      span.setAttribute('tokens.total', tokenUsage.totalTokens);
      span.setAttribute('cost.usd', cost);
    }

    span.setStatus({ code: 0 }); // OK
    span.end();

    return {
      text,
      provider: 'gemini',
      model,
      tokenUsage,
    };
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
    span.end();
    throw error;
  }
}

// ── OpenRouter implementation ───────────────────────────────────────────────

async function generateWithOpenRouter(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const orKey = _profile.openrouterApiKey?.trim()
    || process.env.OPENROUTER_API_KEY
    || process.env.OPENROUTER_FREE_API_KEY;

  if (!orKey) {
    // No cross-provider fallback here: generateText() owns failover and will
    // route to Gemini when OpenRouter is unavailable. Throwing keeps a single
    // failover path and lets a direct forceProvider:'openrouter' caller see a
    // clear error rather than a silent provider switch.
    const error = new Error('OpenRouter configuré mais aucune clé disponible.');
    (error as any).status = 401;
    throw error;
  }

  const model = options.openrouterModel || _profile.openrouterModel || 'google/gemini-3.6-flash';

  // Start OTel span for this model call
  const span = telemetryService.startModelCallSpan('openrouter', model, _currentTaskId);
  span.setAttribute('prompt.length', options.prompt.length);
  if (options.systemPrompt) {
    span.setAttribute('system_prompt.length', options.systemPrompt.length);
  }

  // Declared outside the try so the catch block can clear the timeout.
  const controller = new AbortController();
  // 120s au lieu de 60s : les agents font des sorties longues (code complet, analyses, délégations)
  // qui peuvent nécessiter plus d'une minute sur des modèles OpenRouter sous charge.
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const messages: any[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: options.prompt });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${orKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://Leanna.local',
        'X-Title': process.env.OPENROUTER_TITLE || 'Leanna',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens ?? options.maxOutputTokens ?? 8192,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      const error = new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
      (error as any).status = response.status;
      throw error;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Extract token usage from OpenRouter response
    const usage = data.usage;
    const tokenUsage = usage ? {
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    } : undefined;

    // Record tokens in telemetry service
    if (tokenUsage) {
      const cost = telemetryService.recordTokenUsage({
        missionId: _currentMissionId,
        taskId: _currentTaskId,
        agentRole: _currentAgentRole,
        toolName: _currentToolName,
        provider: 'openrouter',
        model,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
      });

      span.setAttribute('tokens.input', tokenUsage.inputTokens);
      span.setAttribute('tokens.output', tokenUsage.outputTokens);
      span.setAttribute('tokens.total', tokenUsage.totalTokens);
      span.setAttribute('cost.usd', cost);
    }

    span.setStatus({ code: 0 }); // OK
    span.end();

    return { text, provider: 'openrouter', model, tokenUsage };
  } catch (e: any) {
    clearTimeout(timeoutId);
    
    span.recordException(e);
    span.setStatus({ code: 2, message: e.message }); // ERROR
    span.end();

    // Cross-provider fallback is now owned by generateText() (central layer):
    // rethrow so it can decide whether to fail over to Gemini, apply the
    // circuit breaker and avoid a redundant double call. This keeps failover
    // in one place instead of two competing mechanisms.
    throw e;
  }
}