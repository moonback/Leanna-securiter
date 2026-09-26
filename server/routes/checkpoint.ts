/**
 * Routeur pour les checkpoints git (Phase 2 — garde-fous auto-modification).
 * Extrait de server.ts (Sprint 1 — découpage).
 */

import { Router, Request, Response } from 'express';
import {
  createCheckpoint,
  rollbackToCheckpoint,
  listCheckpoints,
  validateBuild,
} from '../utils/checkpoint.js';

export function createCheckpointRouter(): Router {
  const router = Router();

  // POST /api/checkpoint/create
  router.post('/create', async (req: Request, res: Response) => {
    try {
      const reason = (req.body as any)?.reason || 'checkpoint manuel';
      const hash = await createCheckpoint(reason);
      res.json({
        success: true,
        hash,
        message: hash
          ? `Checkpoint créé: ${hash.slice(0, 8)}`
          : 'Rien à sauvegarder.',
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/checkpoint/rollback
  router.post('/rollback', async (req: Request, res: Response) => {
    try {
      const { hash } = req.body as { hash?: string };
      if (!hash) return res.status(400).json({ error: 'hash est requis.' });
      const ok = await rollbackToCheckpoint(hash);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/checkpoint/list
  router.get('/list', async (_req: Request, res: Response) => {
    try {
      const checkpoints = await listCheckpoints();
      res.json({ checkpoints });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/checkpoint/validate
  router.post('/validate', async (_req: Request, res: Response) => {
    try {
      const result = await validateBuild();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
