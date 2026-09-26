import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { encrypt, decrypt } from "./crypto.js";
import { SELF_ROOT } from "./selfRoot.js";

/**
 * GeminiKeyPool — Manages a pool of Gemini API keys with round-robin rotation.
 * When a key hits rate limits (429), it automatically rotates to the next key.
 */

const KEYS_FILE = path.join(process.env.Leanna_CONFIG_PATH || process.env.ELECTRON_APP_PATH || SELF_ROOT, ".gemini-keys.json");

interface KeyEntry {
  key: string;
  label?: string;
  disabled?: boolean;
  lastError?: string;
  lastUsed?: string;
}

let keyPool: KeyEntry[] = [];
let currentIndex = 0;

/**
 * Load keys from .gemini-keys.json and/or GEMINI_API_KEY env var.
 */
export async function loadGeminiKeys(): Promise<void> {
  keyPool = [];

  // Load from JSON file if it exists
  try {
    await fs.promises.access(KEYS_FILE);
    const raw = await fs.promises.readFile(KEYS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      keyPool = parsed
        .filter((e: any) => e && typeof e.key === "string" && e.key.trim())
        .map((e: any) => ({
          ...e,
          key: decrypt(e.key.trim()),
        }));
    }
  } catch (e) {
    console.warn("[GeminiKeyPool] Erreur lecture .gemini-keys.json:", e);
  }

  // If no keys from file, fall back to env var
  if (keyPool.length === 0) {
    const envKey = process.env.GEMINI_API_KEY;
    if (envKey && envKey.trim()) {
      keyPool.push({ key: decrypt(envKey.trim()), label: "Default (env)" });
    }
  }

  currentIndex = 0;
  console.log(`[GeminiKeyPool] ${keyPool.length} clé(s) chargée(s).`);
}

/**
 * Save current key pool to .gemini-keys.json
 */
export async function saveGeminiKeys(): Promise<void> {
  const toSave = keyPool.map((entry) => ({
    ...entry,
    key: encrypt(entry.key),
  }));
  await fs.promises.writeFile(KEYS_FILE, JSON.stringify(toSave, null, 2), "utf-8");
}

/**
 * Get all keys (for settings UI). Masks the actual key values.
 */
export function getGeminiKeys(): Array<{ index: number; label: string; preview: string; disabled: boolean }> {
  return keyPool.map((entry, i) => ({
    index: i,
    label: entry.label || `Clé ${i + 1}`,
    preview: entry.key.slice(0, 6) + "•".repeat(Math.min(entry.key.length - 6, 20)),
    disabled: !!entry.disabled,
  }));
}

/**
 * Add a new key to the pool.
 */
export async function addGeminiKey(key: string, label?: string): Promise<void> {
  // Avoid duplicates
  if (keyPool.some((e) => e.key === key)) {
    throw new Error("Cette clé existe déjà dans le pool.");
  }
  keyPool.push({ key: key.trim(), label: label || `Clé ${keyPool.length + 1}` });
  await saveGeminiKeys();
  console.log(`[GeminiKeyPool] Clé ajoutée. Total: ${keyPool.length}`);
}

/**
 * Remove a key from the pool by index.
 */
export async function removeGeminiKey(index: number): Promise<void> {
  if (index < 0 || index >= keyPool.length) {
    throw new Error("Index invalide.");
  }
  keyPool.splice(index, 1);
  if (currentIndex >= keyPool.length) currentIndex = 0;
  await saveGeminiKeys();
  console.log(`[GeminiKeyPool] Clé supprimée. Total: ${keyPool.length}`);
}

/**
 * Toggle disable/enable a key.
 */
export async function toggleGeminiKey(index: number): Promise<boolean> {
  if (index < 0 || index >= keyPool.length) {
    throw new Error("Index invalide.");
  }
  keyPool[index].disabled = !keyPool[index].disabled;
  await saveGeminiKeys();
  return !keyPool[index].disabled; // returns new enabled state
}

/**
 * Update label for a key.
 */
export async function updateGeminiKeyLabel(index: number, label: string): Promise<void> {
  if (index < 0 || index >= keyPool.length) {
    throw new Error("Index invalide.");
  }
  keyPool[index].label = label;
  await saveGeminiKeys();
}

/**
 * Get the next available (non-disabled) API key using round-robin.
 * Returns null if no keys are available.
 */
export function getNextGeminiKey(): string | null {
  const enabledKeys = keyPool.filter((e) => !e.disabled);
  if (enabledKeys.length === 0) return null;

  // Find next enabled key starting from currentIndex
  for (let i = 0; i < keyPool.length; i++) {
    const idx = (currentIndex + i) % keyPool.length;
    if (!keyPool[idx].disabled) {
      currentIndex = (idx + 1) % keyPool.length;
      keyPool[idx].lastUsed = new Date().toISOString();
      return keyPool[idx].key;
    }
  }
  return null;
}

/**
 * Mark a key as having errored (for UI display).
 */
function markKeyError(apiKey: string, error: string): void {
  const entry = keyPool.find((e) => e.key === apiKey);
  if (entry) {
    entry.lastError = error;
  }
}

/**
 * Create a GoogleGenAI instance with the next available key.
 * Returns null if no key is available.
 */
export function createGeminiClient(): GoogleGenAI | null {
  const key = getNextGeminiKey();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Execute a Gemini API call with automatic retry on 429 (rate limit).
 * Rotates through available keys before giving up.
 */
export async function withGeminiRetry<T>(
  fn: (ai: GoogleGenAI) => Promise<T>,
  maxRetries?: number,
  /** Timeout global en ms (défaut: 120s). Protège contre les appels bloquants. */
  timeoutMs: number = 120_000
): Promise<T> {
  const enabledCount = keyPool.filter((e) => !e.disabled).length;
  const retries = maxRetries ?? Math.max(enabledCount, 2);
  let lastError: any = null;

  // (Audit §1) Timeout global pour éviter un blocage indéfini
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`withGeminiRetry timeout après ${timeoutMs}ms`)), timeoutMs);
  });

  const execute = async (): Promise<T> => {
    for (let attempt = 0; attempt < retries; attempt++) {
      const key = getNextGeminiKey();
      if (!key) {
        throw new Error("Aucune clé Gemini API disponible. Ajoutez des clés dans les paramètres.");
      }

      const ai = new GoogleGenAI({ apiKey: key });

      try {
        const result = await fn(ai);
        return result;
      } catch (error: any) {
        const status = error?.status || error?.httpStatus || error?.code;

        // BUGFIX : lastError n'était jamais assigné auparavant, donc l'erreur
        // finale (ligne throw ci-dessous) masquait systématiquement la vraie
        // cause avec un message générique, y compris pour un échec non lié au
        // rate limiting survenant à la dernière tentative.
        lastError = error;

        // For rate limiting (429) or overloaded/unavailable (503), rotate key
        if (status === 429 || status === 503) {
          console.warn(
            `[GeminiKeyPool] Erreur de clé (${status}), rotation vers la suivante... (tentative ${attempt + 1}/${retries})`
          );
          markKeyError(key, `${status} - ${status === 429 ? 'Rate limited' : 'Overloaded'} (${new Date().toLocaleTimeString()})`);
          // Small delay before retry
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // For non-429 errors, don't retry
        throw error;
      }
    }

    throw lastError || new Error("Toutes les clés API ont été rate-limited. Réessayez plus tard.");
  };

  return Promise.race([execute(), timeoutPromise]);
}

// NOTE: loadGeminiKeys() is called explicitly from server.ts at startup.
// Do NOT call it here — importing this module must not trigger a side-effect.