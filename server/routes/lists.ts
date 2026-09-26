import { Router, Request, Response } from 'express';
import { createList, getListByName, listAll, addItemToList, removeItemFromList, deleteList } from '../skills/list.js';

const router = Router();

// GET /api/lists
router.get('/', async (_req: Request, res: Response) => {
  try {
    const lists = await listAll();
    res.json({ status: 'success', lists: lists.map(list => ({ name: list.name, count: list.items.length, updatedAt: list.updatedAt })) });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// POST /api/lists
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, items } = req.body as { name?: string; items?: string[] };
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ status: 'error', error: 'Le nom de la liste est requis.' });
    const cleanItems = Array.isArray(items) ? items.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
    const list = await createList(name.trim(), cleanItems);
    res.json({ status: 'success', list });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// GET /api/lists/:name
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    const list = await getListByName(name);
    if (!list) return res.status(404).json({ status: 'error', error: `Liste '${name}' introuvable.` });
    res.json({ status: 'success', list });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// POST /api/lists/:name/items
router.post('/:name/items', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    const { item } = req.body as { item?: string };
    if (!item || typeof item !== 'string' || !item.trim()) return res.status(400).json({ status: 'error', error: 'L\u2019élément doit être une chaîne non vide.' });
    const list = await addItemToList(name, item.trim());
    res.json({ status: 'success', list });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// DELETE /api/lists/:name/items
router.delete('/:name/items', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    const { item, index } = req.body as { item?: string; index?: number };
    const list = await removeItemFromList(name, typeof item === 'string' ? item.trim() : undefined, typeof index === 'number' ? index : undefined);
    res.json({ status: 'success', list });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// DELETE /api/lists/:name
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    const deletedList = await deleteList(name);
    res.json({ status: 'success', list: deletedList });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

export default router;
