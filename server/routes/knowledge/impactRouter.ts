import { Router, Request, Response } from 'express';
import { impactAnalyzer } from '../../knowledge/index.js';

const router = Router();

// POST /api/knowledge/impact/analyze
router.post('/impact/analyze', (req: Request, res: Response) => {
  try {
    const { files, mode, minScore, includeTests, onlyInPaths } = req.body as {
      files?: string | string[];
      mode?: 'quick' | 'standard' | 'deep' | 'reverse';
      minScore?: number;
      includeTests?: boolean;
      onlyInPaths?: string[];
    };
    if (!files || (Array.isArray(files) && files.length === 0)) {
      return res.status(400).json({ error: 'Le paramètre files (string ou string[]) est requis.' });
    }
    const report = impactAnalyzer.analyze(files, {
      mode: mode || 'standard',
      minScore,
      includeTests,
      onlyInPaths,
    });
    res.json({ status: 'success', report });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/impact/quick
router.post('/impact/quick', (req: Request, res: Response) => {
  try {
    const { file } = req.body as { file?: string };
    if (!file) {
      return res.status(400).json({ error: 'Le paramètre file est requis.' });
    }
    const report = impactAnalyzer.quickAnalyze(file);
    res.json({ status: 'success', report });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/impact/deep
router.post('/impact/deep', (req: Request, res: Response) => {
  try {
    const { files } = req.body as { files?: string | string[] };
    if (!files || (Array.isArray(files) && files.length === 0)) {
      return res.status(400).json({ error: 'Le paramètre files est requis.' });
    }
    const report = impactAnalyzer.deepAnalyze(files);
    res.json({ status: 'success', report });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/impact/reverse
router.post('/impact/reverse', (req: Request, res: Response) => {
  try {
    const { file } = req.body as { file?: string };
    if (!file) {
      return res.status(400).json({ error: 'Le paramètre file est requis.' });
    }
    const report = impactAnalyzer.reverseAnalyze(file);
    res.json({ status: 'success', report });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;