/**
 * tts.ts — Route API pour la synthèse vocale TTS.
 *
 * POST /api/tts/speak — Génère de l'audio TTS pour un texte donné.
 * POST /api/tts/speak-stream — Génère l'audio en streaming SSE (pour textes longs).
 * GET  /api/tts/stats — Statistiques du système TTS (cache, queue, providers).
 * POST /api/tts/cache/clear — Vide le cache TTS.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { generateSpeech, generateSpeechStreaming, getTTSStats, clearTTSCache } from "../utils/geminiTTS.js";

// ── Schémas de validation ────────────────────────────────────────────────────

const TtsSpeakSchema = z.object({
  text: z.string().min(1, "Le champ 'text' est requis").max(10_000, "Le texte est trop long (max 10 000 caractères). Utilisez /speak-stream."),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
  provider: z.string().optional(),
  noCache: z.boolean().optional(),
});

const TtsSpeakStreamSchema = z.object({
  text: z.string().min(1, "Le champ 'text' est requis"),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
  provider: z.string().optional(),
});

export function createTTSRouter(): Router {
  const router = Router();

  /**
   * POST /api/tts/speak
   * Body: { text: string, voice?: string, speed?: number, provider?: string, noCache?: boolean }
   * Returns: { audio: string (base64 PCM), cached: boolean }
   */
  router.post("/speak", async (req: Request, res: Response) => {
    try {
      const parsed = TtsSpeakSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Corps de requête invalide.",
          details: parsed.error.errors.map((e) => ({ field: e.path.join(".") || "(root)", message: e.message })),
        });
        return;
      }
      const { text, voice, speed, provider, noCache } = parsed.data;

      const audio = await generateSpeech(text, {
        voiceName: voice,
        speed,
        provider: provider as any,
        noCache: !!noCache,
      });

      if (!audio) {
        res.status(500).json({ error: "Échec de la génération TTS. Aucun provider disponible." });
        return;
      }

      res.json({ audio, cached: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/tts/speak-stream
   * Body: { text: string, voice?: string, speed?: number, provider?: string }
   * Returns: SSE stream with audio chunks
   */
  router.post("/speak-stream", async (req: Request, res: Response) => {
    try {
      const parsed = TtsSpeakStreamSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Corps de requête invalide.",
          details: parsed.error.errors.map((e) => ({ field: e.path.join(".") || "(root)", message: e.message })),
        });
        return;
      }
      const { text, voice, speed, provider } = parsed.data;

      // Setup SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const generator = generateSpeechStreaming(text, {
        voiceName: voice,
        speed,
        provider: provider as any,
      });

      for await (const chunk of generator) {
        if (res.writableEnded) break;
        res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      }

      if (!res.writableEnded) {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      }
    } catch (e: any) {
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: e.message });
      }
    }
  });

  /**
   * GET /api/tts/stats
   * Returns: cache/queue/provider metrics
   */
  router.get("/stats", (_req: Request, res: Response) => {
    res.json(getTTSStats());
  });

  /**
   * POST /api/tts/cache/clear
   * Clears the TTS cache
   */
  router.post("/cache/clear", (_req: Request, res: Response) => {
    clearTTSCache();
    res.json({ status: "ok", message: "Cache TTS vidé." });
  });

  return router;
}
