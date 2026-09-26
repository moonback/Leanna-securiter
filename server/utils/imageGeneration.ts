/**
 * Image Generation Utilities
 *
 * Fournit la fonction generateImage pour créer des images via l'API OpenRouter.
 * Utilisée par ContentGenerator pour générer des infographies.
 */

import { createLogger } from "./logger.js";

const log = createLogger("imageGeneration");

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration OpenRouter
// ═══════════════════════════════════════════════════════════════════════════════

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux-1.1-pro";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ImageGenerationOptions {
  model?: string;
  style?: string;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
}

export interface ImageGenerationResult {
  imageBase64: string;
  mediaType: string;
  model: string;
  cost: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Génération d'image
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Génère une image via l'API OpenRouter Image Generation.
 * Retourne les données de l'image encodées en base64 avec les métadonnées.
 * Importée par ContentGenerator via `import("../utils/imageGeneration")`.
 *
 * @param prompt - Le prompt de génération d'image
 * @param options - Options de génération (modèle, style, résolution, etc.)
 * @returns Promise<ImageGenerationResult | null> - Résultat ou null en cas d'erreur
 */
export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<ImageGenerationResult | null> {
  const apiKey =
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_FREE_API_KEY;

  if (!apiKey) {
    log.error("generateImage: aucune clé API OpenRouter disponible (OPENROUTER_API_KEY manquante).");
    return null;
  }

  const model = options.model || DEFAULT_IMAGE_MODEL;

  // Construction du prompt complet avec les indications de style/qualité
  const styleHint = options.style ? ` Style: ${options.style}.` : "";
  const qualityHint = options.quality === "high" ? " Ultra high quality, detailed." : "";
  const fullPrompt = `${prompt}${styleHint}${qualityHint}`.trim();

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://Leanna.local",
        "X-Title": process.env.OPENROUTER_TITLE || "Leanna",
      },
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        n: 1,
        response_format: "b64_json",
        ...(options.aspectRatio ? { size: options.aspectRatio } : {}),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      log.error(`generateImage: OpenRouter HTTP ${response.status} — ${errText.slice(0, 300)}`);
      return null;
    }

    const data: any = await response.json();
    const b64 = data?.data?.[0]?.b64_json as string | undefined;
    if (!b64) {
      log.error("generateImage: réponse OpenRouter sans b64_json.");
      return null;
    }

    return {
      imageBase64: b64,
      mediaType: "image/png",
      model: data.model || model,
      cost: data.usage?.total_cost ?? 0,
    };
  } catch (e: any) {
    log.error(`generateImage: erreur réseau — ${e.message}`);
    return null;
  }
}
