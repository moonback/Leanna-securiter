/**
 * /api/observability — REST endpoints for Cost & Token Dashboard, Budget, and Traces
 * 
 * Endpoints:
 * - GET /api/observability/dashboard - Aggregated stats (tokens, cost, by model/agent/mission)
 * - GET /api/observability/usage - Token usage records with filters
 * - GET /api/observability/budget/:missionId - Budget status for a mission
 * - POST /api/observability/budget/:missionId - Set budget for a mission
 * - GET /api/observability/stats/day - Daily stats
 * - GET /api/observability/stats/hour - Hourly stats
 */

import { Router, type Request, type Response } from 'express';
import { telemetryService } from '../observability/TelemetryService.js';
import { z } from 'zod';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// Validation Schemas
// ═══════════════════════════════════════════════════════════════════════════════

const usageQuerySchema = z.object({
  missionId: z.string().optional(),
  agentRole: z.string().optional(),
  provider: z.enum(['gemini', 'openrouter']).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(100),
});

const setBudgetSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/observability/dashboard
 * Returns aggregated statistics for the dashboard.
 */
router.get('/dashboard', (_req: Request, res: Response) => {
  try {
    const stats = telemetryService.getAggregatedStats('day');
    
    // Transform to dashboard-friendly format
    const dashboard = {
      overview: {
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        totalCalls: Object.values(stats.byModel).reduce((sum, m) => sum + m.calls, 0),
      },
      byModel: Object.entries(stats.byModel)
        .map(([model, data]) => ({
          model,
          tokens: data.tokens,
          cost: data.cost,
          calls: data.calls,
          avgTokensPerCall: Math.round(data.tokens / data.calls),
          avgCostPerCall: data.cost / data.calls,
        }))
        .sort((a, b) => b.cost - a.cost), // Sort by cost descending
      
      byAgent: Object.entries(stats.byAgent)
        .map(([role, data]) => ({
          role,
          tokens: data.tokens,
          cost: data.cost,
          calls: data.calls,
        }))
        .sort((a, b) => b.cost - a.cost),
      
      byMission: Object.entries(stats.byMission)
        .map(([id, data]) => ({
          missionId: id,
          tokens: data.tokens,
          cost: data.cost,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 20), // Top 20 missions
    };
    
    res.json({ success: true, dashboard });
  } catch (error) {
    console.error('[ObservabilityRouter] Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: (error as Error).message,
    });
  }
});

/**
 * GET /api/observability/usage
 * Returns token usage records with optional filters.
 * Query params: missionId, agentRole, provider, limit
 */
router.get('/usage', (req: Request, res: Response) => {
  try {
    const parsed = usageQuerySchema.safeParse(req.query);
    
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: parsed.error.errors,
      });
      return;
    }
    
    const filters = parsed.data;
    const records = telemetryService.getUsageRecords(filters);
    
    res.json({
      success: true,
      count: records.length,
      records,
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Usage records error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage records',
      details: (error as Error).message,
    });
  }
});

/**
 * GET /api/observability/budget/:missionId
 * Returns budget status for a mission.
 */
router.get('/budget/:missionId', (req: Request, res: Response) => {
  try {
    const { missionId } = req.params;
    
    if (!missionId) {
      res.status(400).json({
        success: false,
        error: 'Mission ID is required',
      });
      return;
    }
    
    const status = telemetryService.checkBudget(missionId);
    
    res.json({
      success: true,
      missionId,
      budget: status,
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Budget status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch budget status',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/observability/budget/:missionId
 * Sets budget guardrails for a mission.
 * Body: { maxTokens?: number, maxCostUsd?: number }
 */
router.post('/budget/:missionId', (req: Request, res: Response) => {
  try {
    const { missionId } = req.params;
    
    if (!missionId) {
      res.status(400).json({
        success: false,
        error: 'Mission ID is required',
      });
      return;
    }
    
    const parsed = setBudgetSchema.safeParse(req.body);
    
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid budget configuration',
        details: parsed.error.errors,
      });
      return;
    }
    
    const budget = parsed.data;
    
    if (!budget.maxTokens && !budget.maxCostUsd) {
      res.status(400).json({
        success: false,
        error: 'At least one budget limit (maxTokens or maxCostUsd) must be provided',
      });
      return;
    }
    
    telemetryService.setMissionBudget(missionId, budget);
    
    res.json({
      success: true,
      missionId,
      budget,
      message: 'Budget guardrails set successfully',
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Set budget error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set budget',
      details: (error as Error).message,
    });
  }
});

/**
 * DELETE /api/observability/budget/:missionId
 * Clears budget guardrails for a mission.
 */
router.delete('/budget/:missionId', (req: Request, res: Response) => {
  try {
    const { missionId } = req.params;
    
    if (!missionId) {
      res.status(400).json({
        success: false,
        error: 'Mission ID is required',
      });
      return;
    }
    
    telemetryService.clearMissionBudget(missionId);
    
    res.json({
      success: true,
      missionId,
      message: 'Budget guardrails cleared',
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Clear budget error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear budget',
      details: (error as Error).message,
    });
  }
});

/**
 * GET /api/observability/stats/day
 * Returns aggregated stats for the last 24 hours.
 */
router.get('/stats/day', (_req: Request, res: Response) => {
  try {
    const stats = telemetryService.getAggregatedStats('day');
    
    res.json({
      success: true,
      period: 'day',
      stats,
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Daily stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch daily stats',
      details: (error as Error).message,
    });
  }
});

/**
 * GET /api/observability/stats/hour
 * Returns aggregated stats for the last hour.
 */
router.get('/stats/hour', (_req: Request, res: Response) => {
  try {
    const stats = telemetryService.getAggregatedStats('hour');
    
    res.json({
      success: true,
      period: 'hour',
      stats,
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Hourly stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch hourly stats',
      details: (error as Error).message,
    });
  }
});

/**
 * GET /api/observability/health
 * Returns telemetry service health status.
 */
router.get('/health', (_req: Request, res: Response) => {
  try {
    const stats = telemetryService.getAggregatedStats();
    
    res.json({
      success: true,
      status: 'healthy',
      telemetry: {
        totalRecordsInMemory: stats.totalTokens > 0 ? 'active' : 'idle',
        supabaseConnected: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? true : false,
      },
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Health check error:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: (error as Error).message,
    });
  }
});

/**
 * POST /api/observability/flush
 * Manually trigger a flush to Supabase (for testing/admin).
 */
router.post('/flush', async (_req: Request, res: Response) => {
  try {
    // The flush method is private, but we can trigger it indirectly
    // by recording a dummy usage (this is a workaround for manual testing)
    // In production, the periodic flush runs automatically every 30s
    
    res.json({
      success: true,
      message: 'Flush runs automatically every 30 seconds. To force flush, restart the server.',
    });
  } catch (error) {
    console.error('[ObservabilityRouter] Flush error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to flush',
      details: (error as Error).message,
    });
  }
});

export default router;
