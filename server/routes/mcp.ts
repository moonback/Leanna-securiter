import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { mcpBridge } from '../mcp/index.js';

// ── Schémas de validation ────────────────────────────────────────────────────

const McpServerCreateSchema = z.object({
  id: z.string().min(1, "id requis"),
  name: z.string().min(1, "name requis"),
  transport: z.enum(["stdio", "sse"], { errorMap: () => ({ message: "transport doit être 'stdio' ou 'sse'" }) }),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional().or(z.undefined()),
  env: z.record(z.string()).optional(),
  disabled: z.boolean().optional(),
  description: z.string().optional(),
  autoApprove: z.array(z.string()).optional(),
});

const McpServerUpdateSchema = McpServerCreateSchema.omit({ id: true }).partial();

const McpToolCallSchema = z.object({
  tool: z.string().min(1, "tool (string) requis"),
  arguments: z.record(z.unknown()).optional(),
});

const router = Router();

// GET /api/mcp/status
router.get('/status', (_req: Request, res: Response) => {
  try {
    const statuses = mcpBridge.getServersStatus();
    const connected = statuses.filter((s: any) => s.status === 'connected').length;
    const total = statuses.length;
    res.json({ status: 'success', connected, total, ok: connected > 0 || total === 0 });
  } catch {
    res.json({ status: 'success', connected: 0, total: 0, ok: true });
  }
});

// GET /api/mcp/servers
router.get('/servers', async (_req: Request, res: Response) => {
  try {
    const statuses = mcpBridge.getServersStatus();
    res.json({ status: 'success', servers: statuses });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp/servers/:id
router.get('/servers/:id', async (req: Request, res: Response) => {
  const serverStatus = mcpBridge.getServerStatus(req.params.id);
  if (!serverStatus) {
    res.status(404).json({ error: 'Serveur MCP non trouvé' });
    return;
  }
  res.json({ status: 'success', server: serverStatus });
});

// POST /api/mcp/servers
router.post('/servers', async (req: Request, res: Response) => {
  try {
    const parsed = McpServerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Corps de requête invalide.',
        details: parsed.error.errors.map((e) => ({ field: e.path.join('.') || '(root)', message: e.message })),
      });
      return;
    }
    const { id, name, transport, command, args, url, env, disabled, description, autoApprove } = parsed.data;
    if (transport === 'stdio' && !command) {
      res.status(400).json({ error: 'command est requis pour le transport stdio' });
      return;
    }
    if (transport === 'sse' && !url) {
      res.status(400).json({ error: 'url est requis pour le transport sse' });
      return;
    }
    await mcpBridge.addServer(id, { name, transport, command, args, url, env, disabled, description, autoApprove });
    const serverStatus = mcpBridge.getServerStatus(id);
    res.json({ status: 'success', server: serverStatus });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/mcp/servers/:id
router.put('/servers/:id', async (req: Request, res: Response) => {
  try {
    const parsed = McpServerUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Corps de requête invalide.',
        details: parsed.error.errors.map((e) => ({ field: e.path.join('.') || '(root)', message: e.message })),
      });
      return;
    }
    await mcpBridge.updateServer(req.params.id, parsed.data);
    const serverStatus = mcpBridge.getServerStatus(req.params.id);
    res.json({ status: 'success', server: serverStatus });
  } catch (e: any) {
    res.status(e.message.includes('non trouvé') ? 404 : 500).json({ error: e.message });
  }
});

// DELETE /api/mcp/servers/:id
router.delete('/servers/:id', async (req: Request, res: Response) => {
  try {
    await mcpBridge.removeServer(req.params.id);
    res.json({ status: 'success', message: `Serveur "${req.params.id}" supprimé` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp/servers/:id/toggle
router.post('/servers/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) requis' });
      return;
    }
    await mcpBridge.toggleServer(req.params.id, enabled);
    const serverStatus = mcpBridge.getServerStatus(req.params.id);
    res.json({ status: 'success', server: serverStatus });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp/servers/:id/reconnect
router.post('/servers/:id/reconnect', async (req: Request, res: Response) => {
  try {
    await mcpBridge.reconnectServer(req.params.id);
    const serverStatus = mcpBridge.getServerStatus(req.params.id);
    res.json({ status: 'success', server: serverStatus });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp/tools
router.get('/tools', async (_req: Request, res: Response) => {
  try {
    const tools = mcpBridge.getAllTools();
    res.json({ status: 'success', tools });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp/tools/call
router.post('/tools/call', async (req: Request, res: Response) => {
  try {
    const parsed = McpToolCallSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Corps de requête invalide.',
        details: parsed.error.errors.map((e) => ({ field: e.path.join('.') || '(root)', message: e.message })),
      });
      return;
    }
    const { tool, arguments: args } = parsed.data;
    const result = await mcpBridge.callTool(tool, args || {});
    res.json({ status: 'success', ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp/metrics
router.get('/metrics', (_req: Request, res: Response) => {
  try {
    const metrics = mcpBridge.getMetrics();
    const summary = mcpBridge.getMetricsSummary();
    res.json({ status: 'success', metrics, summary });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
