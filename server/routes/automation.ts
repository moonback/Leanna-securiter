import { Router, Request, Response } from 'express';
import { getScheduledTasksSnapshot, pauseScheduledTask, resumeScheduledTask, runScheduledTaskNow, cancelScheduledTask, getScheduledTask } from '../skills/automation.js';

const router = Router();

// GET /api/automation/scheduled-tasks
router.get('/scheduled-tasks', (_req: Request, res: Response) => {
  res.json({ status: 'success', tasks: getScheduledTasksSnapshot() });
});

// POST /api/automation/scheduled-tasks/:id/toggle
router.post('/scheduled-tasks/:id/toggle', (req: Request, res: Response) => {
  const taskId = req.params.id;
  const task = getScheduledTask(taskId);
  if (!task) return res.status(404).json({ status: 'not_found', message: `Tâche ${taskId} introuvable.` });
  const result = task.enabled ? pauseScheduledTask(taskId) : resumeScheduledTask(taskId);
  res.json({ status: result.status, message: result.message });
});

// POST /api/automation/scheduled-tasks/:id/run
router.post('/scheduled-tasks/:id/run', async (req: Request, res: Response) => {
  const result = await runScheduledTaskNow(req.params.id);
  res.json(result);
});

// DELETE /api/automation/scheduled-tasks/:id
router.delete('/scheduled-tasks/:id', (req: Request, res: Response) => {
  const cancelled = cancelScheduledTask(req.params.id);
  res.json({ status: cancelled ? 'success' : 'not_found', message: cancelled ? `Tâche ${req.params.id} annulée.` : `Tâche ${req.params.id} introuvable.` });
});

export default router;
