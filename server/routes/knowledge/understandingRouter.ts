import { Router, Request, Response } from 'express';
import { understandingEngine } from '../../knowledge/index.js';

const router = Router();

// POST /api/knowledge/understanding/context
router.post('/understanding/context', (req: Request, res: Response) => {
  try {
    const { query, strategy, detail, existingContext, maxFiles, maxFacts, includeRisk, riskMode } = req.body as {
      query?: string;
      strategy?: 'balanced' | 'code_first' | 'memory_first' | 'graph_first' | 'minimal';
      detail?: 'compact' | 'standard' | 'verbose';
      existingContext?: string[];
      maxFiles?: number;
      maxFacts?: number;
      includeRisk?: boolean;
      riskMode?: 'quick' | 'standard' | 'deep' | 'reverse';
    };
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Le paramètre query est requis.' });
    }
    const context = understandingEngine.buildContext(query, {
      strategy,
      detail,
      existingContext,
      maxFiles,
      maxFacts,
      includeRisk,
      riskMode,
    });
    res.json({ status: 'success', context });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/understanding/score
router.post('/understanding/score', (req: Request, res: Response) => {
  try {
    const { query, strategy, includeRisk } = req.body as {
      query?: string;
      strategy?: 'balanced' | 'code_first' | 'memory_first' | 'graph_first' | 'minimal';
      includeRisk?: boolean;
    };
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Le paramètre query est requis.' });
    }
    const score = understandingEngine.computeScore(query, { strategy, includeRisk });
    res.json({ status: 'success', score });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/understanding/prompt
router.post('/understanding/prompt', (req: Request, res: Response) => {
  try {
    const { query, strategy, detail } = req.body as {
      query?: string;
      strategy?: 'balanced' | 'code_first' | 'memory_first' | 'graph_first' | 'minimal';
      detail?: 'compact' | 'standard' | 'verbose';
    };
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Le paramètre query est requis.' });
    }
    const prompt = understandingEngine.buildSystemPrompt(query, { strategy, detail });
    res.json({ status: 'success', prompt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/understanding/health
router.get('/understanding/health', (_req: Request, res: Response) => {
  try {
    const health = understandingEngine.scanKnowledgeHealth();
    res.json({ status: 'success', health });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/understanding/feedback
router.post('/understanding/feedback', (req: Request, res: Response) => {
  try {
    const { query, feedback, missionId } = req.body as {
      query?: string;
      feedback?: {
        confirmedFacts?: string[];
        deniedFacts?: string[];
        usefulFiles?: string[];
        uselessFiles?: string[];
        missingTerms?: string[];
        lesson?: string;
      };
      missionId?: string;
    };
    if (!query || !feedback) {
      return res.status(400).json({ error: 'Les paramètres query et feedback sont requis.' });
    }
    const result = understandingEngine.incorporateFeedback(query, feedback, { missionId });
    res.json({ status: 'success', applied: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;