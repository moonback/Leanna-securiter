import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/health
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

export default router;