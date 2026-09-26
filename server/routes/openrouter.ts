import { Router, Request, Response } from 'express';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function createOpenRouterRouter(_getProfile: () => any): Router {
  const router = Router();

  // POST /api/openrouter/test
  router.post('/test', async (req: Request, res: Response) => {
    const { apiKey, model } = req.body as { apiKey?: string; model?: string };
    if (!apiKey || !apiKey.trim()) {
      res.status(400).json({ status: 'error', error: 'Clé API requise.' });
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://Leanna.local',
          'X-Title': process.env.OPENROUTER_TITLE || 'Leanna',
        },
        body: JSON.stringify({
          model: model || 'google/gemini-3.6-flash',
          messages: [{ role: 'user', content: 'Say hi in 3 words.' }],
          max_tokens: 20,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errText = await response.text();
        res.json({ status: 'error', error: `HTTP ${response.status}: ${errText.slice(0, 200)}` });
        return;
      }
      const data: any = await response.json();
      res.json({ status: 'success', reply: data?.choices?.[0]?.message?.content || '', model: data?.model });
    } catch (e: any) {
      if (e.name === 'AbortError') res.json({ status: 'error', error: 'Connexion échouée (timeout 10s)' });
      else res.json({ status: 'error', error: e.message || 'Connexion échouée' });
    } finally { clearTimeout(timeoutId); }
  });

  // POST /api/openrouter/chat
  router.post('/chat', async (req: Request, res: Response) => {
    const { apiKey, model, messages, temperature, topP, maxTokens } = req.body as {
      apiKey?: string; model?: string; messages?: any[]; temperature?: number; topP?: number; maxTokens?: number;
    };
    const key = apiKey?.trim() || process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_FREE_API_KEY;
    if (!key) {
      res.status(400).json({ status: 'error', error: 'Aucune clé API OpenRouter disponible.' });
      return;
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ status: 'error', error: 'Messages requis.' });
      return;
    }

    const { optimizeMessagesWithLLM, getBudgetForModel } = await import('../utils/tokenOptimizer.js');
    const budget = getBudgetForModel(model || 'default');
    const { messages: optimizedMessages, trimmed, summarized, summaryMethod, summaryTokensCost } =
      await optimizeMessagesWithLLM(messages, budget, { apiKey: key, model: 'openai/gpt-4o-mini' });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://Leanna.local',
          'X-Title': process.env.OPENROUTER_TITLE || 'Leanna',
        },
        body: JSON.stringify({
          model: model || 'google/gemini-3.6-flash',
          messages: optimizedMessages,
          temperature: temperature ?? 0.9,
          top_p: topP ?? 0.95,
          max_tokens: maxTokens ?? 4096,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errText = await response.text();
        res.status(response.status).json({ status: 'error', error: `OpenRouter ${response.status}: ${errText.slice(0, 500)}` });
        return;
      }
      const data = await response.json();
      const optimization = trimmed > 0 ? { trimmedMessages: trimmed, summarized, summaryMethod, summaryTokensCost } : undefined;
      res.json({ status: 'success', data, optimization });
    } catch (e: any) {
      if (e.name === 'AbortError') res.status(504).json({ status: 'error', error: 'Délai d\'attente OpenRouter dépassé (30s)' });
      else res.status(500).json({ status: 'error', error: e.message || 'Erreur réseau OpenRouter' });
    }
  });

  // GET /api/openrouter/models
  router.get('/models', async (req: Request, res: Response) => {
    const key = (req.query.apiKey as string)?.trim() || process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_FREE_API_KEY || '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      if (!response.ok) {
        res.status(response.status).json({ status: 'error', error: `HTTP ${response.status}` });
        return;
      }
      const data = await response.json();
      res.json({ status: 'success', data });
    } catch (e: any) {
      if (e.name === 'AbortError') res.status(504).json({ status: 'error', error: 'Délai d\'attente OpenRouter dépassé (15s)' });
      else res.status(500).json({ status: 'error', error: e.message });
    } finally { clearTimeout(timeoutId); }
  });

  return router;
}
