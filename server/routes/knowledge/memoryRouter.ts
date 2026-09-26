import { Router, Request, Response } from 'express';
import { projectMemory } from '../../knowledge/index.js';

const router = Router();

// GET /api/knowledge/memory
router.get('/memory', (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const facts = category
      ? projectMemory.getAllFacts(category as any)
      : projectMemory.getAllFacts();
    res.json({
      status: 'success',
      facts,
      total: facts.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/memory/search
router.get('/memory/search', (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'Le paramètre "q" est requis.' });
    }
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const results = projectMemory.searchFacts(query, limit);
    res.json({ status: 'success', results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/memory
router.post('/memory', (req: Request, res: Response) => {
  try {
    const { content, category, tags, sourceFile, confidence } = req.body;
    if (!content || !category) {
      return res.status(400).json({ error: 'content et category sont requis.' });
    }
    const id = projectMemory.addFact({
      content,
      category,
      tags: tags || [],
      sourceFile,
      confidence: confidence ?? 0.5,
    });
    res.json({ status: 'success', id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/memory/:id
router.get('/memory/:id', (req: Request, res: Response) => {
  try {
    const fact = projectMemory.getFact(req.params.id);
    if (!fact) {
      return res.status(404).json({ error: 'Fait mémoire introuvable.' });
    }
    res.json({ status: 'success', fact });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/knowledge/memory/:id
router.put('/memory/:id', (req: Request, res: Response) => {
  try {
    const { content, category, tags, sourceFile, confidence } = req.body;
    const updated = projectMemory.updateFact(req.params.id, {
      content,
      category,
      tags,
      sourceFile,
      confidence,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Fait mémoire introuvable.' });
    }
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/knowledge/memory/:id
router.delete('/memory/:id', (req: Request, res: Response) => {
  try {
    const deleted = projectMemory.deleteFact(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Fait mémoire introuvable.' });
    }
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/memory/autoextract
router.post('/memory/autoextract', (_req: Request, res: Response) => {
  try {
    const extractedIds = projectMemory.autoExtractFromKnowledgeGraph();
    res.json({
      status: 'success',
      extracted: extractedIds.length,
      ids: extractedIds,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/memory/context
router.post('/memory/context', (req: Request, res: Response) => {
  try {
    const { task, files } = req.body as { task?: string; files?: string[] };
    if (!task) {
      return res.status(400).json({ error: 'Le paramètre task est requis.' });
    }
    const context = projectMemory.getProjectContext(task, files || []);
    res.json({ status: 'success', context });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;