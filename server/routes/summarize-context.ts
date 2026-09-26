import { Router, Request, Response } from 'express';
import { summarizeWithLLM, estimateTokens, type ChatMessage } from '../utils/tokenOptimizer.js';

const MAX_SUMMARIZE_INPUT_TOKENS = 120_000;
const MAX_KEEP_TURNS = 30;
const MIN_KEEP_TURNS = 2;

/**
 * POST /api/tokens/summarize-context
 *
 * Reçoit un tableau d'entrées transcript (user/assistant) et renvoie un
 * résumé intelligent généré par LLM (ou fallback local).
 *
 * Body:
 * {
 *   transcript: Array<{ role: 'user' | 'assistant'; text: string }>,
 *   keepTurns?: number   // nombre de tours récents à conserver (default 8)
 * }
 */
export function createSummarizeContextRouter(): Router {
  const router = Router();

  router.post('/summarize-context', async (req: Request, res: Response) => {
    try {
      const { transcript, keepTurns = 8 } = req.body as {
        transcript?: Array<{ role: 'user' | 'assistant'; text: string }>;
        keepTurns?: number;
      };

      if (!Array.isArray(transcript) || transcript.length === 0) {
        return res.status(400).json({ status: 'error', error: 'transcript requis' });
      }

      const safeKeepTurns = Math.min(MAX_KEEP_TURNS, Math.max(MIN_KEEP_TURNS, Number(keepTurns) || 8));

      // Convertir en ChatMessage pour le tokenOptimizer
      const messages: ChatMessage[] = transcript.map((e) => ({
        role: e.role,
        content: e.text,
      }));

      const totalInputTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
      if (totalInputTokens > MAX_SUMMARIZE_INPUT_TOKENS) {
        return res.status(413).json({
          status: 'error',
          error: 'budget token dépassé pour le résumé de contexte',
          budget: {
            maxInputTokens: MAX_SUMMARIZE_INPUT_TOKENS,
            estimatedInputTokens: totalInputTokens,
          },
        });
      }

      // Séparer les messages à résumer (anciens) des tours récents à garder
      const toSummarize = messages.slice(0, Math.max(0, messages.length - safeKeepTurns));
      const retained = messages.slice(Math.max(0, messages.length - safeKeepTurns));

      if (toSummarize.length === 0) {
        return res.json({
          status: 'success',
          summary: '',
          retainedTurns: retained.length,
          summarizedTurns: 0,
          method: 'local',
          tokensSaved: 0,
        });
      }

      const { summary, method, tokensUsed } = await summarizeWithLLM(toSummarize);

      const tokensSaved = toSummarize.reduce((sum, m) => sum + estimateTokens(m.content), 0) - estimateTokens(summary);

      return res.json({
        status: 'success',
        summary,
        retainedTurns: retained.length,
        summarizedTurns: toSummarize.length,
        method,
        tokensUsed,
        tokensSaved: Math.max(0, tokensSaved),
        budget: {
          maxInputTokens: MAX_SUMMARIZE_INPUT_TOKENS,
          estimatedInputTokens: totalInputTokens,
          compressedTokenEstimate: estimateTokens(summary) + retained.reduce((sum, m) => sum + estimateTokens(m.content), 0),
          keepTurns: safeKeepTurns,
        },
      });
    } catch (e: any) {
      return res.status(500).json({ status: 'error', error: e.message });
    }
  });

  return router;
}
