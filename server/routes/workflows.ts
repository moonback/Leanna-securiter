import { Router, Request, Response } from 'express';
import { getWorkflowsSnapshot } from '../skills/workflow.js';

const router = Router();

// GET /api/workflows
router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'success', workflows: getWorkflowsSnapshot() });
});

// GET /api/workflows/active-runs
router.get('/active-runs', async (_req: Request, res: Response) => {
  const { getActiveRuns } = await import('../skills/workflow');
  res.json({ status: 'success', runs: getActiveRuns() });
});

// POST /api/workflows
router.post('/', async (req: Request, res: Response) => {
  try {
    const { createWorkflow: createWf, createWorkflowSchema: schema } = await import('../skills/workflow');
    const validated = schema.parse(req.body);
    const workflow = await createWf(validated);
    res.json({ status: 'success', workflow });
  } catch (e: any) {
    res.status(400).json({ status: 'error', error: e.message || 'Impossible de créer le workflow.' });
  }
});

// POST /api/workflows/:id/run
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const { getWorkflow: getWf, executeWorkflow: execWf } = await import('../skills/workflow');
    const wf = getWf(req.params.id);
    if (!wf) return res.status(404).json({ status: 'not_found', error: 'Workflow introuvable.' });
    const result = await execWf(wf);
    res.json({ status: 'success', result });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// POST /api/workflows/:id/toggle
router.post('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { toggleWorkflow: toggleWf } = await import('../skills/workflow');
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) requis.' });
    const updated = await toggleWf(req.params.id, enabled);
    if (!updated) return res.status(404).json({ status: 'not_found' });
    res.json({ status: 'success', workflow: updated });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// DELETE /api/workflows/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { deleteWorkflow: deleteWf } = await import('../skills/workflow');
    const deleted = await deleteWf(req.params.id);
    res.json({ status: deleted ? 'success' : 'not_found' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

export default router;