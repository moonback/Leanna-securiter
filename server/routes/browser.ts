/**
 * Routeur pour le canal de retour webview → skill (browser_read_content,
 * browser_action_result).
 * Les Maps browserReadPending / browserActionPending sont partagées avec le
 * LiveSocketHandler — elles sont passées en dépendances via la factory.
 * Extrait de server.ts (Sprint 1 — découpage).
 */

import { Router, Request, Response } from 'express';

export interface BrowserPendingEntry {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowserActionPendingEntry {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createBrowserRouter(
  browserReadPending: Map<string, BrowserPendingEntry>,
  browserActionPending: Map<string, BrowserActionPendingEntry>,
): Router {
  const router = Router();

  // POST /api/browser/content-result
  // Le BrowserPanel appelle cet endpoint après avoir exécuté du JS dans la webview.
  router.post('/content-result', (req: Request, res: Response) => {
    const { requestId, result, error } = req.body as {
      requestId?: string;
      result?: string | null;
      error?: string | null;
    };
    if (!requestId) return res.status(400).json({ error: 'requestId manquant.' });

    const pending = browserReadPending.get(requestId);
    if (!pending) {
      return res.json({ status: 'ignored' });
    }
    browserReadPending.delete(requestId);
    clearTimeout(pending.timer);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result ?? '');
    }
    res.json({ status: 'ok' });
  });

  // POST /api/browser/action-result
  // click / type / snapshot / inspect → ce canal retour
  router.post('/action-result', (req: Request, res: Response) => {
    const { requestId, result, error } = req.body as {
      requestId?: string;
      result?: any;
      error?: string | null;
    };
    if (!requestId) return res.status(400).json({ error: 'requestId manquant.' });

    const pending = browserActionPending.get(requestId);
    if (!pending) {
      return res.json({ status: 'ignored' });
    }
    browserActionPending.delete(requestId);
    clearTimeout(pending.timer);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
    res.json({ status: 'ok' });
  });

  return router;
}
