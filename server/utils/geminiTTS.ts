/**
 * geminiTTS.ts — Système TTS avancé avec cache, chunking, queue et fallback intelligent.
 *
 * Architecture :
 *   1. Normalisation du texte (nettoyage markdown, URLs, caractères spéciaux)
 *   2. Cache LRU en mémoire (évite les regénérations inutiles)
 *   3. Chunking intelligent (découpe les textes longs pour réduire la latence)
 *   4. Queue de concurrence (limite les appels simultanés, évite les rate limits)
 *   5. Retry avec backoff exponentiel
 *   6. Sélection du provider basée sur les métriques de latence
 *   7. Fallback en cascade : OpenRouter Kokoro → OpenRouter Fish → Gemini TTS
 *
 * Usage :
 *   import { generateSpeech, generateSpeechStreaming } from './utils/geminiTTS.js';
 *   const base64Audio = await generateSpeech("Bonjour !", { voiceName: "ff_siwis" });
 *   // Ou en streaming pour les textes longs :
 *   for await (const chunk of generateSpeechStreaming(longText, opts)) { ... }
 */

import { createLogger } from "./logger.js";

const log = createLogger("TTS");

// ─── Types & Interfaces ─────────────────────────────────────────────────────

export interface TTSOptions {
  /** Nom de la voix (ex: ff_siwis, af_jessica, am_adam, Aoede, Kore) */
  voiceName?: string;
  /** Modèle TTS OpenRouter (défaut: hexgrad/kokoro-82m) */
  model?: string;
  /** Vitesse de parole (0.5 à 2.0, défaut: 1.0) */
  speed?: number;
  /** Forcer un provider spécifique ('openrouter' | 'gemini' | 'auto') */
  provider?: "openrouter" | "gemini" | "auto";
  /** Désactiver le cache pour cet appel */
  noCache?: boolean;
  /** Taille max d'un chunk en caractères (défaut: 300) */
  chunkSize?: number;
}

interface CacheEntry {
  audio: string;
  timestamp: number;
  size: number;
}

interface ProviderMetrics {
  totalCalls: number;
  totalLatencyMs: number;
  errors: number;
  lastLatencyMs: number;
  lastErrorTime: number;
}

interface QueueItem {
  fn: () => Promise<string | null>;
  resolve: (value: string | null) => void;
  reject: (err: Error) => void;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  /** Taille max du cache (nombre d'entrées) */
  CACHE_MAX_ENTRIES: 200,
  /** TTL du cache en ms (30 minutes) */
  CACHE_TTL_MS: 30 * 60 * 1000,
  /** Taille max totale du cache en octets (~50MB) */
  CACHE_MAX_SIZE_BYTES: 50 * 1024 * 1024,
  /** Nombre max de requêtes TTS simultanées */
  MAX_CONCURRENT: 3,
  /** Retry max par appel */
  MAX_RETRIES: 3,
  /** Backoff initial en ms */
  BACKOFF_BASE_MS: 500,
  /** Taille max d'un chunk de texte (caractères) */
  DEFAULT_CHUNK_SIZE: 300,
  /** Pénalité de temps (ms) pour un provider en erreur récente (<60s) */
  ERROR_PENALTY_MS: 5000,
};

// ─── Cache LRU ──────────────────────────────────────────────────────────────

class TTSCache {
  private cache = new Map<string, CacheEntry>();
  private totalSize = 0;

  private makeKey(text: string, voice: string, speed: number): string {
    return `${voice}:${speed}:${text}`;
  }

  get(text: string, voice: string, speed: number): string | null {
    const key = this.makeKey(text, voice, speed);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > CONFIG.CACHE_TTL_MS) {
      this.cache.delete(key);
      this.totalSize -= entry.size;
      return null;
    }

    // Move to end (LRU refresh)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.audio;
  }

  set(text: string, voice: string, speed: number, audio: string): void {
    const key = this.makeKey(text, voice, speed);
    const size = audio.length; // approximation base64 → bytes

    // Evict if over size limit
    while (this.totalSize + size > CONFIG.CACHE_MAX_SIZE_BYTES && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      const evicted = this.cache.get(firstKey);
      if (evicted) this.totalSize -= evicted.size;
      this.cache.delete(firstKey);
    }

    // Evict if over entry limit
    while (this.cache.size >= CONFIG.CACHE_MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      const evicted = this.cache.get(firstKey);
      if (evicted) this.totalSize -= evicted.size;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { audio, timestamp: Date.now(), size });
    this.totalSize += size;
  }

  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
  }

  get stats() {
    return {
      entries: this.cache.size,
      totalSizeKB: Math.round(this.totalSize / 1024),
    };
  }
}

const ttsCache = new TTSCache();

// ─── Provider Metrics ───────────────────────────────────────────────────────

const providerMetrics: Record<string, ProviderMetrics> = {
  openrouter_kokoro: { totalCalls: 0, totalLatencyMs: 0, errors: 0, lastLatencyMs: 0, lastErrorTime: 0 },
  gemini: { totalCalls: 0, totalLatencyMs: 0, errors: 0, lastLatencyMs: 0, lastErrorTime: 0 },
};

function recordMetric(provider: string, latencyMs: number, isError: boolean): void {
  const m = providerMetrics[provider];
  if (!m) return;
  m.totalCalls++;
  m.totalLatencyMs += latencyMs;
  m.lastLatencyMs = latencyMs;
  if (isError) {
    m.errors++;
    m.lastErrorTime = Date.now();
  }
}

function getAverageLatency(provider: string): number {
  const m = providerMetrics[provider];
  if (!m || m.totalCalls === 0) return 1000; // default estimate
  const avg = m.totalLatencyMs / m.totalCalls;
  // Pénalité si erreur récente
  if (Date.now() - m.lastErrorTime < 60_000) {
    return avg + CONFIG.ERROR_PENALTY_MS;
  }
  return avg;
}

/** Retourne le provider le plus rapide selon les métriques */
function selectBestProvider(): "openrouter_kokoro" | "gemini" {
  type Provider = "openrouter_kokoro" | "gemini";
  const providers: Provider[] = ["openrouter_kokoro", "gemini"];
  let best: Provider = providers[0];
  let bestLatency = getAverageLatency(best);

  for (const p of providers) {
    const lat = getAverageLatency(p);
    if (lat < bestLatency) {
      best = p;
      bestLatency = lat;
    }
  }
  return best;
}

// ─── Concurrency Queue ──────────────────────────────────────────────────────

class TTSQueue {
  private queue: QueueItem[] = [];
  private running = 0;

  async enqueue(fn: () => Promise<string | null>): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running >= CONFIG.MAX_CONCURRENT || this.queue.length === 0) return;

    this.running++;
    const item = this.queue.shift()!;

    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (err) {
      item.reject(err as Error);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}

const ttsQueue = new TTSQueue();

// ─── Text Normalization ─────────────────────────────────────────────────────

/**
 * Normalise le texte pour le TTS :
 * - Supprime le markdown (headers, bold, italic, links, code blocks)
 * - Remplace les URLs par "lien"
 * - Nettoie les emojis problématiques
 * - Supprime les caractères de contrôle
 * - Normalise les espaces
 */
export function normalizeTextForTTS(text: string): string {
  let normalized = text;

  // Supprimer les blocs de code
  normalized = normalized.replace(/```[\s\S]*?```/g, " bloc de code ");
  normalized = normalized.replace(/`([^`]+)`/g, "$1");

  // Supprimer les headers markdown
  normalized = normalized.replace(/^#{1,6}\s+/gm, "");

  // Supprimer bold/italic
  normalized = normalized.replace(/\*\*([^*]+)\*\*/g, "$1");
  normalized = normalized.replace(/\*([^*]+)\*/g, "$1");
  normalized = normalized.replace(/__([^_]+)__/g, "$1");
  normalized = normalized.replace(/_([^_]+)_/g, "$1");
  normalized = normalized.replace(/~~([^~]+)~~/g, "$1");

  // Remplacer les liens markdown par leur texte
  normalized = normalized.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remplacer les URLs nues
  normalized = normalized.replace(/https?:\/\/[^\s]+/g, " lien ");

  // Supprimer les listes markdown
  normalized = normalized.replace(/^[\s]*[-*+]\s+/gm, "");
  normalized = normalized.replace(/^[\s]*\d+\.\s+/gm, "");

  // Supprimer les images markdown
  normalized = normalized.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1 ");

  // Remplacer les caractères spéciaux problématiques
  normalized = normalized.replace(/[<>{}[\]|\\]/g, " ");

  // Supprimer les emojis composés (garder les simples)
  normalized = normalized.replace(/[\u{1F600}-\u{1F64F}]/gu, "");
  normalized = normalized.replace(/[\u{1F300}-\u{1F5FF}]/gu, "");
  normalized = normalized.replace(/[\u{1F680}-\u{1F6FF}]/gu, "");
  normalized = normalized.replace(/[\u{2600}-\u{26FF}]/gu, "");
  normalized = normalized.replace(/[\u{2700}-\u{27BF}]/gu, "");

  // Supprimer les séparateurs markdown (---, ***)
  normalized = normalized.replace(/^[-*_]{3,}\s*$/gm, "");

  // Normaliser les espaces et sauts de ligne
  normalized = normalized.replace(/\n{3,}/g, "\n\n");
  normalized = normalized.replace(/[ \t]{2,}/g, " ");
  normalized = normalized.trim();

  return normalized;
}

// ─── Text Chunking ──────────────────────────────────────────────────────────

/**
 * Découpe un texte long en chunks intelligents, respectant les frontières de phrases.
 * Priorité : fin de phrase (.) > virgule/point-virgule > espace
 */
export function chunkText(text: string, maxChunkSize: number = CONFIG.DEFAULT_CHUNK_SIZE): string[] {
  if (text.length <= maxChunkSize) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining.trim());
      break;
    }

    let cutAt = -1;

    // Chercher une fin de phrase dans la zone [maxChunkSize * 0.6, maxChunkSize]
    const searchStart = Math.floor(maxChunkSize * 0.6);
    const segment = remaining.slice(0, maxChunkSize);

    // Priorité 1 : fin de phrase
    for (let i = maxChunkSize - 1; i >= searchStart; i--) {
      if (segment[i] === "." || segment[i] === "!" || segment[i] === "?" || segment[i] === "\n") {
        cutAt = i + 1;
        break;
      }
    }

    // Priorité 2 : virgule ou point-virgule
    if (cutAt === -1) {
      for (let i = maxChunkSize - 1; i >= searchStart; i--) {
        if (segment[i] === "," || segment[i] === ";" || segment[i] === ":") {
          cutAt = i + 1;
          break;
        }
      }
    }

    // Priorité 3 : espace
    if (cutAt === -1) {
      for (let i = maxChunkSize - 1; i >= searchStart; i--) {
        if (segment[i] === " ") {
          cutAt = i + 1;
          break;
        }
      }
    }

    // Dernier recours : couper à maxChunkSize
    if (cutAt === -1) cutAt = maxChunkSize;

    const chunk = remaining.slice(0, cutAt).trim();
    if (chunk.length > 0) chunks.push(chunk);
    remaining = remaining.slice(cutAt).trim();
  }

  return chunks;
}

// ─── Retry with Backoff ─────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = CONFIG.MAX_RETRIES,
  baseMs: number = CONFIG.BACKOFF_BASE_MS
): Promise<T> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (attempt < maxRetries - 1) {
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * 200;
        log.warn(`Retry ${attempt + 1}/${maxRetries} après ${Math.round(delay)}ms: ${lastErr.message}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastErr || new Error("withRetry: échec après toutes les tentatives");
}

// ─── Provider Functions ─────────────────────────────────────────────────────

function getOpenRouterKey(): string | null {
  return (
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENROUTER_FREE_API_KEY?.trim() ||
    null
  );
}

/**
 * Appel TTS via OpenRouter (Kokoro ou Fish Audio).
 */
async function callOpenRouter(
  text: string,
  voice: string,
  model: string,
  speed: number
): Promise<string | null> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) return null;

  const providerKey = "openrouter_kokoro";
  const start = Date.now();

  try {
    const body: Record<string, any> = {
      model,
      input: text,
      voice,
      response_format: "pcm",
    };
    if (speed !== 1.0) {
      body.speed = speed;
    }

    const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://Leanna.local",
        "X-Title": process.env.OPENROUTER_TITLE || "Leanna",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      recordMetric(providerKey, Date.now() - start, true);
      throw new Error(`OpenRouter ${model} erreur ${response.status}: ${errText.slice(0, 200)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      recordMetric(providerKey, Date.now() - start, true);
      return null;
    }

    const buffer = Buffer.from(arrayBuffer);
    const base64Audio = buffer.toString("base64");

    recordMetric(providerKey, Date.now() - start, false);
    log.debug(`[${providerKey}] Audio (${voice}, speed=${speed}): "${text.slice(0, 40)}..." → ${Math.round(buffer.length / 1024)}KB en ${Date.now() - start}ms`);
    return base64Audio;
  } catch (err) {
    recordMetric(providerKey, Date.now() - start, true);
    throw err;
  }
}

/**
 * Appel TTS via Gemini (fallback).
 */
async function callGemini(text: string, voiceName: string): Promise<string | null> {
  const start = Date.now();

  try {
    const { withGeminiRetry } = await import("./geminiKeyPool");

    const model = "gemini-2.5-flash-preview-tts";

    const response = await withGeminiRetry(
      (ai) =>
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          } as any,
        }),
      undefined,
      30_000 // timeout 30s pour TTS
    );

    const audioData = getInlineAudioData(response);
    if (!audioData) {
      recordMetric("gemini", Date.now() - start, true);
      return null;
    }

    recordMetric("gemini", Date.now() - start, false);
    log.debug(`[gemini] Audio (${voiceName}): "${text.slice(0, 40)}..." → ${Math.round(audioData.length / 1024)}KB en ${Date.now() - start}ms`);
    return audioData;
  } catch (err) {
    recordMetric("gemini", Date.now() - start, true);
    throw err;
  }
}

// ─── Main Public API ────────────────────────────────────────────────────────

/**
 * Génère de l'audio TTS à partir de texte.
 * Gère automatiquement : normalisation, cache, queue, retry, fallback.
 *
 * Retourne l'audio en base64 (PCM 24kHz 16-bit mono) ou null en cas d'échec.
 */
export async function generateSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;

  const voice = options.voiceName || "ff_siwis";
  const speed = Math.max(0.5, Math.min(2.0, options.speed || 1.0));
  const provider = options.provider || "auto";
  const noCache = options.noCache || false;

  // 1. Normaliser le texte
  const normalizedText = normalizeTextForTTS(text);
  if (!normalizedText || normalizedText.length === 0) return null;

  // 2. Check cache
  if (!noCache) {
    const cached = ttsCache.get(normalizedText, voice, speed);
    if (cached) {
      log.debug(`[cache hit] "${normalizedText.slice(0, 40)}..." (${ttsCache.stats.entries} entrées)`);
      return cached;
    }
  }

  // 3. Si le texte est long, on traite chunk par chunk et on concatène
  const chunkSize = options.chunkSize || CONFIG.DEFAULT_CHUNK_SIZE;
  if (normalizedText.length > chunkSize) {
    return generateSpeechChunked(normalizedText, voice, speed, provider, chunkSize, noCache);
  }

  // 4. Enqueue l'appel TTS avec concurrence limitée
  const audio = await ttsQueue.enqueue(() =>
    executeTTSWithFallback(normalizedText, voice, speed, provider, options.model)
  );

  // 5. Mettre en cache
  if (audio && !noCache) {
    ttsCache.set(normalizedText, voice, speed, audio);
  }

  return audio;
}

/**
 * Génère le TTS en streaming — retourne un AsyncGenerator de chunks audio base64.
 * Idéal pour les textes longs : chaque chunk est rendu dès qu'il est prêt.
 */
export async function* generateSpeechStreaming(
  text: string,
  options: TTSOptions = {}
): AsyncGenerator<{ audio: string; chunkIndex: number; totalChunks: number; text: string }> {
  if (!text || text.trim().length === 0) return;

  const voice = options.voiceName || "ff_siwis";
  const speed = Math.max(0.5, Math.min(2.0, options.speed || 1.0));
  const provider = options.provider || "auto";
  const chunkSize = options.chunkSize || CONFIG.DEFAULT_CHUNK_SIZE;
  const noCache = options.noCache || false;

  const normalizedText = normalizeTextForTTS(text);
  if (!normalizedText) return;

  const chunks = chunkText(normalizedText, chunkSize);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Check cache pour ce chunk
    if (!noCache) {
      const cached = ttsCache.get(chunk, voice, speed);
      if (cached) {
        yield { audio: cached, chunkIndex: i, totalChunks: chunks.length, text: chunk };
        continue;
      }
    }

    const audio = await ttsQueue.enqueue(() =>
      executeTTSWithFallback(chunk, voice, speed, provider, options.model)
    );

    if (audio) {
      if (!noCache) ttsCache.set(chunk, voice, speed, audio);
      yield { audio, chunkIndex: i, totalChunks: chunks.length, text: chunk };
    }
  }
}

// ─── Internal Implementation ────────────────────────────────────────────────

/**
 * Génère l'audio pour un texte long en concaténant les chunks.
 */
async function generateSpeechChunked(
  text: string,
  voice: string,
  speed: number,
  provider: "openrouter" | "gemini" | "auto",
  chunkSize: number,
  noCache: boolean
): Promise<string | null> {
  const chunks = chunkText(text, chunkSize);
  log.debug(`Chunking: ${chunks.length} segments pour ${text.length} caractères`);

  const audioChunks: string[] = [];

  for (const chunk of chunks) {
    // Check cache pour le chunk
    if (!noCache) {
      const cached = ttsCache.get(chunk, voice, speed);
      if (cached) {
        audioChunks.push(cached);
        continue;
      }
    }

    const audio = await ttsQueue.enqueue(() =>
      executeTTSWithFallback(chunk, voice, speed, provider)
    );

    if (audio) {
      if (!noCache) ttsCache.set(chunk, voice, speed, audio);
      audioChunks.push(audio);
    }
  }

  if (audioChunks.length === 0) return null;

  // Concaténer les buffers PCM base64
  const concatenated = concatenateBase64PCM(audioChunks);

  // Mettre en cache le résultat complet
  if (!noCache) {
    ttsCache.set(text, voice, speed, concatenated);
  }

  return concatenated;
}

/**
 * Exécute l'appel TTS avec retry et fallback entre providers.
 * Route automatiquement vers Gemini si la voix demandée est une voix Gemini native.
 */
async function executeTTSWithFallback(
  text: string,
  voice: string,
  speed: number,
  provider: "openrouter" | "gemini" | "auto",
  model?: string
): Promise<string | null> {
  const hasOpenRouterKey = !!getOpenRouterKey();

  // Si la voix est native Gemini (ex: Puck, Charon, Aoede...), forcer Gemini
  if (isGeminiVoice(voice)) {
    const providerOrder: Array<() => Promise<string | null>> = [
      () => callGeminiSafe(text, voice),
      // Fallback OpenRouter avec voix mappée si Gemini échoue
      ...(hasOpenRouterKey ? [
        () => callOpenRouterSafe(text, "ff_siwis", "hexgrad/kokoro-82m", speed),
      ] : []),
    ];

    for (const providerFn of providerOrder) {
      try {
        const result = await providerFn();
        if (result) return result;
      } catch (err) {
        log.warn(`Provider échoué: ${(err as Error).message}`);
        continue;
      }
    }
    log.error(`Tous les providers TTS ont échoué pour voix Gemini "${voice}": "${text.slice(0, 50)}..."`);
    return null;
  }

  // Déterminer l'ordre des providers
  let providerOrder: Array<() => Promise<string | null>>;

  if (provider === "gemini") {
    providerOrder = [() => callGeminiSafe(text, voice)];
  } else if (provider === "openrouter") {
    providerOrder = [
      () => callOpenRouterSafe(text, voice, model || "hexgrad/kokoro-82m", speed),
      () => callGeminiSafe(text, voice),
    ];
  } else {
    // Auto : sélection intelligente basée sur les métriques
    if (!hasOpenRouterKey) {
      providerOrder = [() => callGeminiSafe(text, voice)];
    } else {
      const best = selectBestProvider();
      if (best === "gemini") {
        providerOrder = [
          () => callGeminiSafe(text, voice),
          () => callOpenRouterSafe(text, voice, "hexgrad/kokoro-82m", speed),
        ];
      } else {
        providerOrder = [
          () => callOpenRouterSafe(text, voice, "hexgrad/kokoro-82m", speed),
          () => callGeminiSafe(text, voice),
        ];
      }
    }
  }

  // Essayer chaque provider dans l'ordre
  for (const providerFn of providerOrder) {
    try {
      const result = await providerFn();
      if (result) return result;
    } catch (err) {
      log.warn(`Provider échoué: ${(err as Error).message}`);
      continue;
    }
  }

  log.error(`Tous les providers TTS ont échoué pour: "${text.slice(0, 50)}..."`);
  return null;
}

/** Wrapper avec retry autour de callOpenRouter */
async function callOpenRouterSafe(
  text: string,
  voice: string,
  model: string,
  speed: number
): Promise<string | null> {
  return withRetry(() => callOpenRouter(text, voice, model, speed), 2, 300);
}

/** Wrapper avec retry autour de callGemini */
async function callGeminiSafe(text: string, voice: string): Promise<string | null> {
  // Mapper les voix OpenRouter vers Gemini si nécessaire
  const geminiVoice = mapToGeminiVoice(voice);
  return withRetry(() => callGemini(text, geminiVoice), 2, 500);
}

/** Mapper une voix OpenRouter/Kokoro vers une voix Gemini compatible */
function mapToGeminiVoice(voice: string): string {
  const mapping: Record<string, string> = {
    ff_siwis: "Aoede",     // français féminin
    am_adam: "Charon",     // masculin
    af_jessica: "Kore",   // féminin anglais
    af_bella: "Kore",
    am_michael: "Charon",
  };
  return mapping[voice] || voice;
}

/**
 * Voix Gemini TTS natives (doivent être routées vers le provider Gemini).
 * Ces voix supportent le français nativement et sont de meilleure qualité
 * que les voix Kokoro pour les langues non-anglaises.
 */
const GEMINI_NATIVE_VOICES = new Set([
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
]);

/** Vérifie si une voix est une voix Gemini native */
function isGeminiVoice(voice: string): boolean {
  return GEMINI_NATIVE_VOICES.has(voice);
}

// ─── Utility Functions ──────────────────────────────────────────────────────

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Concatène plusieurs buffers audio PCM encodés en base64.
 */
function concatenateBase64PCM(chunks: string[]): string {
  if (chunks.length === 1) return chunks[0];

  // Calculer la taille totale
  let totalLength = 0;
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const buf = Buffer.from(chunk, "base64");
    buffers.push(buf);
    totalLength += buf.length;
  }

  // Concaténer
  const result = Buffer.concat(buffers, totalLength);
  return result.toString("base64");
}

/**
 * Extrait l'audio inline d'une réponse Gemini.
 */
function getInlineAudioData(response: unknown): string | null {
  if (typeof response !== "object" || response === null) return null;
  const candidates = (response as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const candidate = candidates[0];
  if (typeof candidate !== "object" || candidate === null) return null;
  const content = (candidate as Record<string, unknown>).content;
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const part = parts[0];
  if (typeof part !== "object" || part === null) return null;
  const inlineData = (part as Record<string, unknown>).inlineData;
  if (typeof inlineData !== "object" || inlineData === null) return null;
  const data = (inlineData as Record<string, unknown>).data;
  return typeof data === "string" ? data : null;
}

// ─── Public Utility Exports ─────────────────────────────────────────────────

/** Vider le cache TTS */
export function clearTTSCache(): void {
  ttsCache.clear();
  log.info("Cache TTS vidé.");
}

/** Obtenir les statistiques du système TTS */
export function getTTSStats(): {
  cache: { entries: number; totalSizeKB: number };
  queue: { active: number; pending: number };
  providers: Record<string, ProviderMetrics>;
} {
  return {
    cache: ttsCache.stats,
    queue: { active: ttsQueue.active, pending: ttsQueue.pending },
    providers: { ...providerMetrics },
  };
}
