import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { buildSystemInstruction, ProfileConfig } from '../prompts/systemInstruction.js';

export function createTokensOptimizationRouter(getProfile: () => ProfileConfig, getWorkspaceRoot: () => string): Router {
  const router = Router();

  // GET /api/tokens/optimization
  router.get('/optimization', async (_req: Request, res: Response) => {
    try {
      const { estimateTokens, getBudgetForModel } = await import('../utils/tokenOptimizer');
      const profile = getProfile();
      const systemText = buildSystemInstruction({
        ...profile,
        workspace: getWorkspaceRoot(),
        mode: (profile as any).mode || 'full',
      });
      const systemPromptTokens = estimateTokens(systemText);

      let memoryTokens = 0;
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
          const { data: memories } = await supabase
            .from('memories')
            .select('content')
            .order('created_at', { ascending: false })
            .limit(10);
          if (memories) memoryTokens = memories.reduce((sum, m) => sum + estimateTokens(m.content), 0);
        } catch { /* ignore */ }
      }

      const model = (profile as any).openrouterModel || 'default';
      const budget = getBudgetForModel(model);
      const totalBaseTokens = systemPromptTokens + memoryTokens;
      const availableForConversation = budget.maxTotal - totalBaseTokens - budget.responseReserve;

      const suggestions: string[] = [];
      const isCompact = !!(profile as any).compactPrompt;
      if (!isCompact && systemPromptTokens > 3000) suggestions.push('Activez le mode compact pour réduire le prompt de ~40% (−1500-2000 tokens).');
      if (memoryTokens > 1500) suggestions.push('Beaucoup de mémoires injectées. Envisagez de nettoyer les anciennes.');
      if (profile.responseStyle === 'detailed') suggestions.push('Le style "detailed" génère des réponses longues. Passez en "balanced" pour économiser.');

      let savedTokens = 0;
      if (isCompact) {
        const fullText = buildSystemInstruction({
          ...profile,
          compactPrompt: true,
          workspace: getWorkspaceRoot(),
          mode: (profile as any).mode || 'full',
        } as any);
        savedTokens = estimateTokens(fullText) - systemPromptTokens;
      }

      res.json({
        status: 'success',
        optimization: {
          systemPromptTokens, memoryTokens, totalBaseTokens, availableForConversation,
          modelBudget: budget, suggestions, compactEnabled: isCompact, savedTokens,
          config: {
            responseStyle: profile.responseStyle || 'balanced',
            compactPrompt: isCompact,
            maxMemories: 10,
            model,
          },
        },
      });
    } catch (e: any) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  return router;
}
