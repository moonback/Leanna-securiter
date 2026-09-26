/**
 * Routeur pour la gestion du pool de clés Gemini (rotation 429).
 * Extrait de server.ts (Sprint 1 — découpage).
 */

import { Router, Request, Response } from 'express';
import {
  getGeminiKeys,
  addGeminiKey,
  removeGeminiKey,
  toggleGeminiKey,
  updateGeminiKeyLabel,
} from '../utils/geminiKeyPool.js';

export function createGeminiKeysRouter(): Router {
  const router = Router();

  // GET /api/gemini-keys — liste toutes les clés
  router.get('/', (_req: Request, res: Response) => {
    try {
      const keys = getGeminiKeys();
      res.json({ status: 'success', keys });
    } catch (e: any) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // POST /api/gemini-keys — ajouter une clé
  router.post('/', (req: Request, res: Response) => {
    const { key, label } = req.body as { key?: string; label?: string };
    if (!key || typeof key !== 'string' || !key.trim()) {
      return res.status(400).json({ status: 'error', error: 'La clé API est requise.' });
    }
    try {
      addGeminiKey(key.trim(), label?.trim() || undefined);
      res.json({ status: 'success', keys: getGeminiKeys() });
    } catch (e: any) {
      res.status(400).json({ status: 'error', error: e.message });
    }
  });

  // DELETE /api/gemini-keys/:index — supprimer une clé par index
  router.delete('/:index', (req: Request, res: Response) => {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) {
      return res.status(400).json({ status: 'error', error: 'Index invalide.' });
    }
    try {
      removeGeminiKey(index);
      res.json({ status: 'success', keys: getGeminiKeys() });
    } catch (e: any) {
      res.status(400).json({ status: 'error', error: e.message });
    }
  });

  // PATCH /api/gemini-keys/:index/toggle — activer/désactiver une clé
  router.patch('/:index/toggle', (req: Request, res: Response) => {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) {
      return res.status(400).json({ status: 'error', error: 'Index invalide.' });
    }
    try {
      const enabled = toggleGeminiKey(index);
      res.json({ status: 'success', enabled, keys: getGeminiKeys() });
    } catch (e: any) {
      res.status(400).json({ status: 'error', error: e.message });
    }
  });

  // PATCH /api/gemini-keys/:index/label — renommer une clé
  router.patch('/:index/label', (req: Request, res: Response) => {
    const index = parseInt(req.params.index, 10);
    const { label } = req.body as { label?: string };
    if (isNaN(index)) {
      return res.status(400).json({ status: 'error', error: 'Index invalide.' });
    }
    if (!label || typeof label !== 'string') {
      return res.status(400).json({ status: 'error', error: 'Le label est requis.' });
    }
    try {
      updateGeminiKeyLabel(index, label.trim());
      res.json({ status: 'success', keys: getGeminiKeys() });
    } catch (e: any) {
      res.status(400).json({ status: 'error', error: e.message });
    }
  });

  return router;
}
