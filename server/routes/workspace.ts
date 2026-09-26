import { Router, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { isSandboxActive } from '../utils/sandbox.js';
import { SELF_ROOT } from '../utils/selfRoot.js';

export function createWorkspaceRouter(getWorkspaceRoot: () => string): Router {
  const router = Router();

  router.get('/workspace', (_req: Request, res: Response) => {
    const root = getWorkspaceRoot();
    const exists = existsSync(root);
    res.json({ workspace: root, exists, selfReferential: true, sandbox: isSandboxActive() });
  });

  router.post('/workspace', (_req: Request, res: Response) => {
    res.status(403).json({
      error: "Leanna est un IDE . Le workspace est verrouillé sur son propre code source.",
      workspace: SELF_ROOT,
    });
  });

  return router;
}
