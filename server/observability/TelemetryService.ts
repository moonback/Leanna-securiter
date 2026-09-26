/**
 * TelemetryService — OpenTelemetry tracing + Token/Cost tracking
 * 
 * Responsabilités :
 * 1. Traces OpenTelemetry : une trace par mission, spans pour tasks/tools/model calls
 * 2. Capture des tokens/coûts réels depuis les réponses Gemini/OpenRouter
 * 3. Store in-memory avec flush périodique vers Supabase
 * 4. Budget guardrails : arrêt automatique au dépassement
 */

import { trace, context, type Span, type Tracer, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface TokenUsage {
  id: string;
  missionId?: string;
  taskId?: string;
  agentRole?: string;
  toolName?: string;
  provider: 'gemini' | 'openrouter';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: string;
}

export interface BudgetConfig {
  maxTokens?: number;
  maxCostUsd?: number;
}

export interface BudgetStatus {
  tokensUsed: number;
  costUsd: number;
  exceeded: boolean;
  reason?: string;
}

/** Pricing per 1M tokens (input / output) in USD */
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pricing Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Gemini models (as of Sept 2026)
  'gemini-2.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-2.5-pro': { inputPer1M: 0.90, outputPer1M: 3.50 },
  'gemini-2.0-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
  
  // OpenRouter models (approximations from OR pricing page)
  'google/gemini-3.6-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'google/gemini-2.0-flash-exp': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'anthropic/claude-3.5-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'anthropic/claude-3-opus': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'openai/gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'openai/gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'openai/gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
};

// Fallback pricing for unknown models
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 0.50, outputPer1M: 1.50 };

// ═══════════════════════════════════════════════════════════════════════════════
// TelemetryService
// ═══════════════════════════════════════════════════════════════════════════════

export class TelemetryService {
  private tracer: Tracer;
  private provider: NodeTracerProvider;
  private supabase: SupabaseClient | null = null;
  
  /** In-memory token usage store (flush périodique) */
  private usageStore: TokenUsage[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  /**
   * Persistance désactivée à chaud si la table `token_usage` est absente
   * (PGRST205) ou si Supabase refuse durablement les écritures. Le dashboard
   * continue de fonctionner en mémoire — dégradation silencieuse, cohérente
   * avec le reste de l'application quand Supabase n'est pas provisionné.
   */
  private persistenceDisabled = false;
  
  /** Budget tracking per mission */
  private missionBudgets = new Map<string, BudgetConfig>();
  private missionUsage = new Map<string, BudgetStatus>();
  
  /** Active spans registry (for correlation) */
  private activeSpans = new Map<string, Span>();
  
  private static readonly FLUSH_INTERVAL_MS = 30_000; // 30s
  private static readonly MAX_IN_MEMORY = 1000;

  constructor() {
    // Initialize OpenTelemetry provider.
    // OTel SDK v2 API: span processors are passed via the constructor
    // (addSpanProcessor was removed), and resources are built with
    // resourceFromAttributes (the Resource class constructor was removed).
    const exportSpans = process.env.OTEL_CONSOLE_EXPORT === '1'
      || process.env.OTEL_CONSOLE_EXPORT === 'true';

    this.provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'leanna-os',
        [ATTR_SERVICE_VERSION]: '1.0.0',
      }),
      // Console export is opt-in (verbose). Traces are still created and can
      // be wired to an OTLP/Jaeger exporter by adding a processor here.
      spanProcessors: exportSpans
        ? [new BatchSpanProcessor(new ConsoleSpanExporter())]
        : [],
    });

    this.provider.register();
    this.tracer = trace.getTracer('leanna-telemetry', '1.0.0');
    
    // Initialize Supabase if credentials available
    this.initSupabase();
    
    // Start periodic flush
    this.startFlushTimer();
  }

  private initSupabase(): void {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (url && key) {
      this.supabase = createClient(url, key);
      console.log('[TelemetryService] ✓ Supabase connected for token persistence');
    } else {
      console.warn('[TelemetryService] ⚠️ Supabase not configured — token usage will stay in-memory only');
    }
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => {
      this.flushToSupabase().catch(err => {
        console.error('[TelemetryService] Flush error:', err);
      });
    }, TelemetryService.FLUSH_INTERVAL_MS);
  }

  // ─── OpenTelemetry Tracing ─────────────────────────────────────────────────

  /**
   * Start a new trace for a mission.
   * Returns the span to be ended when the mission completes.
   */
  startMissionTrace(missionId: string, title: string): Span {
    const span = this.tracer.startSpan('mission', {
      attributes: {
        'mission.id': missionId,
        'mission.title': title,
      },
    });
    
    this.activeSpans.set(`mission:${missionId}`, span);
    return span;
  }

  /**
   * End a mission trace.
   */
  endMissionTrace(missionId: string, success: boolean): void {
    const span = this.activeSpans.get(`mission:${missionId}`);
    if (span) {
      span.setStatus({ code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR });
      span.end();
      this.activeSpans.delete(`mission:${missionId}`);
    }
  }

  /**
   * Start a span for an agent task (child of mission span).
   */
  startTaskSpan(taskId: string, role: string, title: string, missionId?: string): Span {
    const parentSpan = missionId ? this.activeSpans.get(`mission:${missionId}`) : undefined;
    const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();
    
    const span = this.tracer.startSpan('agent_task', {
      attributes: {
        'task.id': taskId,
        'task.role': role,
        'task.title': title,
      },
    }, ctx);
    
    this.activeSpans.set(`task:${taskId}`, span);
    return span;
  }

  /**
   * End a task span.
   */
  endTaskSpan(taskId: string, success: boolean): void {
    const span = this.activeSpans.get(`task:${taskId}`);
    if (span) {
      span.setStatus({ code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR });
      span.end();
      this.activeSpans.delete(`task:${taskId}`);
    }
  }

  /**
   * Start a span for a tool call (child of task span).
   */
  startToolSpan(toolName: string, taskId?: string): Span {
    const parentSpan = taskId ? this.activeSpans.get(`task:${taskId}`) : undefined;
    const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();
    
    const span = this.tracer.startSpan('tool_call', {
      attributes: {
        'tool.name': toolName,
      },
    }, ctx);
    
    return span;
  }

  /**
   * Start a span for a model call (child of tool/task span).
   */
  startModelCallSpan(provider: string, model: string, taskId?: string): Span {
    const parentSpan = taskId ? this.activeSpans.get(`task:${taskId}`) : undefined;
    const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();
    
    const span = this.tracer.startSpan('model_call', {
      attributes: {
        'model.provider': provider,
        'model.name': model,
      },
    }, ctx);
    
    return span;
  }

  // ─── Token & Cost Tracking ─────────────────────────────────────────────────

  /**
   * Record token usage from a model call.
   * Returns the calculated cost.
   */
  recordTokenUsage(params: {
    missionId?: string;
    taskId?: string;
    agentRole?: string;
    toolName?: string;
    provider: 'gemini' | 'openrouter';
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): number {
    const pricing = MODEL_PRICING[params.model] || DEFAULT_PRICING;
    
    const costUsd = 
      (params.inputTokens / 1_000_000) * pricing.inputPer1M +
      (params.outputTokens / 1_000_000) * pricing.outputPer1M;
    
    const usage: TokenUsage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      missionId: params.missionId,
      taskId: params.taskId,
      agentRole: params.agentRole,
      toolName: params.toolName,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    };
    
    this.usageStore.push(usage);
    
    // Update mission budget tracking
    if (params.missionId) {
      this.updateMissionUsage(params.missionId, usage.totalTokens, costUsd);
    }
    
    // Flush if store is too large
    if (this.usageStore.length >= TelemetryService.MAX_IN_MEMORY) {
      this.flushToSupabase().catch(err => {
        console.error('[TelemetryService] Emergency flush failed:', err);
      });
    }
    
    return costUsd;
  }

  /**
   * Calculate cost for given token counts (utility method).
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
    return (
      (inputTokens / 1_000_000) * pricing.inputPer1M +
      (outputTokens / 1_000_000) * pricing.outputPer1M
    );
  }

  // ─── Budget Guardrails ─────────────────────────────────────────────────────

  /**
   * Set budget for a mission.
   */
  setMissionBudget(missionId: string, budget: BudgetConfig): void {
    this.missionBudgets.set(missionId, budget);
    this.missionUsage.set(missionId, {
      tokensUsed: 0,
      costUsd: 0,
      exceeded: false,
    });
  }

  /**
   * Check if mission budget is exceeded.
   */
  checkBudget(missionId: string): BudgetStatus {
    return this.missionUsage.get(missionId) || {
      tokensUsed: 0,
      costUsd: 0,
      exceeded: false,
    };
  }

  /**
   * Clear budget tracking for a mission (after completion).
   */
  clearMissionBudget(missionId: string): void {
    this.missionBudgets.delete(missionId);
    this.missionUsage.delete(missionId);
  }

  private updateMissionUsage(missionId: string, tokens: number, costUsd: number): void {
    const current = this.missionUsage.get(missionId) || {
      tokensUsed: 0,
      costUsd: 0,
      exceeded: false,
    };
    
    const updated: BudgetStatus = {
      tokensUsed: current.tokensUsed + tokens,
      costUsd: current.costUsd + costUsd,
      exceeded: current.exceeded,
    };
    
    const budget = this.missionBudgets.get(missionId);
    if (budget && !updated.exceeded) {
      if (budget.maxTokens && updated.tokensUsed > budget.maxTokens) {
        updated.exceeded = true;
        updated.reason = `Token budget exceeded: ${updated.tokensUsed} > ${budget.maxTokens}`;
      } else if (budget.maxCostUsd && updated.costUsd > budget.maxCostUsd) {
        updated.exceeded = true;
        updated.reason = `Cost budget exceeded: $${updated.costUsd.toFixed(4)} > $${budget.maxCostUsd.toFixed(4)}`;
      }
    }
    
    this.missionUsage.set(missionId, updated);
  }

  // ─── Data Retrieval ────────────────────────────────────────────────────────

  /**
   * Get in-memory usage records (for dashboard).
   */
  getUsageRecords(filters?: {
    missionId?: string;
    agentRole?: string;
    provider?: string;
    limit?: number;
  }): TokenUsage[] {
    let records = [...this.usageStore];
    
    if (filters?.missionId) {
      records = records.filter(r => r.missionId === filters.missionId);
    }
    if (filters?.agentRole) {
      records = records.filter(r => r.agentRole === filters.agentRole);
    }
    if (filters?.provider) {
      records = records.filter(r => r.provider === filters.provider);
    }
    
    const limit = filters?.limit || 100;
    return records.slice(-limit);
  }

  /**
   * Get aggregated stats (for dashboard).
   */
  getAggregatedStats(period?: 'day' | 'hour'): {
    totalTokens: number;
    totalCost: number;
    byModel: Record<string, { tokens: number; cost: number; calls: number }>;
    byAgent: Record<string, { tokens: number; cost: number; calls: number }>;
    byMission: Record<string, { tokens: number; cost: number }>;
  } {
    const cutoff = period === 'day' 
      ? Date.now() - 24 * 60 * 60 * 1000
      : period === 'hour'
      ? Date.now() - 60 * 60 * 1000
      : 0;
    
    const records = this.usageStore.filter(r => 
      new Date(r.timestamp).getTime() >= cutoff
    );
    
    const stats = {
      totalTokens: 0,
      totalCost: 0,
      byModel: {} as Record<string, { tokens: number; cost: number; calls: number }>,
      byAgent: {} as Record<string, { tokens: number; cost: number; calls: number }>,
      byMission: {} as Record<string, { tokens: number; cost: number }>,
    };
    
    for (const record of records) {
      stats.totalTokens += record.totalTokens;
      stats.totalCost += record.costUsd;
      
      // By model
      if (!stats.byModel[record.model]) {
        stats.byModel[record.model] = { tokens: 0, cost: 0, calls: 0 };
      }
      stats.byModel[record.model].tokens += record.totalTokens;
      stats.byModel[record.model].cost += record.costUsd;
      stats.byModel[record.model].calls += 1;
      
      // By agent
      if (record.agentRole) {
        if (!stats.byAgent[record.agentRole]) {
          stats.byAgent[record.agentRole] = { tokens: 0, cost: 0, calls: 0 };
        }
        stats.byAgent[record.agentRole].tokens += record.totalTokens;
        stats.byAgent[record.agentRole].cost += record.costUsd;
        stats.byAgent[record.agentRole].calls += 1;
      }
      
      // By mission
      if (record.missionId) {
        if (!stats.byMission[record.missionId]) {
          stats.byMission[record.missionId] = { tokens: 0, cost: 0 };
        }
        stats.byMission[record.missionId].tokens += record.totalTokens;
        stats.byMission[record.missionId].cost += record.costUsd;
      }
    }
    
    return stats;
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private async flushToSupabase(): Promise<void> {
    if (!this.supabase || this.persistenceDisabled || this.usageStore.length === 0) return;
    
    const toFlush = this.usageStore.splice(0, 500); // Flush up to 500 at a time
    
    try {
      const { error } = await this.supabase
        .from('token_usage')
        .insert(toFlush.map(u => ({
          id: u.id,
          mission_id: u.missionId,
          task_id: u.taskId,
          agent_role: u.agentRole,
          tool_name: u.toolName,
          provider: u.provider,
          model: u.model,
          input_tokens: u.inputTokens,
          output_tokens: u.outputTokens,
          total_tokens: u.totalTokens,
          cost_usd: u.costUsd,
          created_at: u.timestamp,
        })));
      
      if (error) {
        // Table absente : désactiver la persistance pour éviter d'inonder les
        // logs et de re-empiler indéfiniment les mêmes enregistrements.
        if (error.code === 'PGRST205' || /Could not find the table/i.test(error.message ?? '')) {
          this.persistenceDisabled = true;
          console.warn(
            "[TelemetryService] ⚠️ Table 'token_usage' introuvable — persistance désactivée. " +
            "Exécutez supabase/token_usage_schema.sql dans Supabase pour l'activer. " +
            "Le dashboard continue de fonctionner en mémoire."
          );
          return; // On abandonne ce lot (pas de re-empilement)
        }
        console.error('[TelemetryService] Supabase insert error:', error);
        // Erreur transitoire : ré-empiler pour retenter au prochain flush,
        // en bornant la taille du store pour éviter une croissance mémoire.
        this.requeue(toFlush);
      } else {
        console.log(`[TelemetryService] ✓ Flushed ${toFlush.length} token usage records to Supabase`);
      }
    } catch (err) {
      console.error('[TelemetryService] Flush exception:', err);
      this.requeue(toFlush);
    }
  }

  /** Ré-empile un lot en tête, en bornant la taille totale du store. */
  private requeue(batch: TokenUsage[]): void {
    this.usageStore.unshift(...batch);
    if (this.usageStore.length > TelemetryService.MAX_IN_MEMORY) {
      // Conserver les plus récents (fin du tableau), abandonner les plus anciens.
      this.usageStore.splice(0, this.usageStore.length - TelemetryService.MAX_IN_MEMORY);
    }
  }

  /**
   * Graceful shutdown: flush remaining records.
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    await this.flushToSupabase();
    await this.provider.shutdown();
  }
}

// ─── Singleton instance ────────────────────────────────────────────────────

export const telemetryService = new TelemetryService();