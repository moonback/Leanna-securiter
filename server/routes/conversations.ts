import { Router, Request, Response } from 'express';
import { listConversations, getConversationMessages, searchHistory, deleteConversation, clearAllConversations, updateConversationTitle } from '../skills/history.js';

const router = Router();

// GET /api/conversations
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conversations = await listConversations(limit, offset);
    res.json({ status: 'success', conversations });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// GET /api/conversations/search
router.get('/search', async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || '').trim();
    if (!query) return res.status(400).json({ status: 'error', error: "Le paramètre 'q' est requis." });
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const results = await searchHistory(query, limit);
    res.json({ status: 'success', results });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// GET /api/conversations/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const messages = await getConversationMessages(req.params.id, limit, offset);
    res.json({ status: 'success', messages });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// PATCH /api/conversations/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { title } = req.body as { title?: string };
    if (!title || !title.trim()) return res.status(400).json({ status: 'error', error: 'Le titre est requis.' });
    await updateConversationTitle(req.params.id, title.trim());
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// DELETE /api/conversations/all
router.delete('/all', async (_req: Request, res: Response) => {
  try {
    const count = await clearAllConversations();
    res.json({ status: 'success', deleted: count });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteConversation(req.params.id);
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

export default router;
