/**
 * AgentPersistence — Persistance Supabase des tâches et messages inter-agents
 *
 * Responsabilités :
 * - Persister les AgentTask (create, update statut, update result)
 * - Persister les OrchestrationPlan
 * - Persister l'historique des messages du bus inter-agents
 * - Recharger les tâches en cours au redémarrage (recovery)
 *
 * Tables Supabase attendues (créées par le SQL de migration) :
 *   - agent_tasks          : tâches individuelles
 *   - agent_orchestrations : plans d'orchestration
 *   - agent_messages       : historique bus inter-agents (optionnel)
 *
 * Tolérance aux pannes :
 * - Si Supabase n'est pas configuré → mode dégradé silencieux (mémoire only)
 * - Les erreurs Supabase ne bloquent JAMAIS l'exécution des agents
 * - Chaque opération a son propre try/catch avec log
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { AgentTask, TaskResult, OrchestrationPlan, TaskStatus } from "./types.js";
import type { AgentMessage } from "./AgentCommunication.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AgentPersistence");

// ═══════════════════════════════════════════════════════════════════════════════
// Types de lignes Supabase
// ═══════════════════════════════════════════════════════════════════════════════

interface AgentTaskRow {
  id: string;
  orchestration_id: string | null;
  role: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  context_files: string[];
  context_instructions: string | null;
  context_metadata: Record<string, unknown> | null;
  result: TaskResult | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  timeout_ms: number | null;
}

interface AgentOrchestrationRow {
  id: string;
  title: string;
  description: string;
  status: string;
  dependencies: Record<string, string[]>;
  created_at: string;
  completed_at: string | null;
}

interface AgentMessageRow {
  id: string;
  type: string;
  from_role: string;
  to_role: string;
  priority: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AgentPersistence
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentPersistence {
  private client: SupabaseClient | null = null;
  private available = false;
  
  // Batch des mises à jour de statut
  private pendingUpdates: Map<string, Partial<AgentTaskRow>> = new Map();
  private flushTimeout: NodeJS.Timeout | null = null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (url && key) {
      this.client = createClient(url, key);
      this.available = true;
      log.info("✅ AgentPersistence connecté à Supabase");
    } else {
      log.warn("⚠️ Supabase non configuré — persistance agents désactivée (mode mémoire)");
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  // ─── AgentTask ─────────────────────────────────────────────────────────────

  /** Insère une nouvelle tâche en base */
  async saveTask(task: AgentTask): Promise<void> {
    if (!this.client) return;
    try {
      const row: AgentTaskRow = {
        id: task.id,
        orchestration_id: task.orchestrationId ?? null,
        role: task.role,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        context_files: task.context.files,
        context_instructions: task.context.instructions ?? null,
        context_metadata: (task.context.metadata as Record<string, unknown>) ?? null,
        result: task.result ?? null,
        created_at: task.createdAt,
        started_at: task.startedAt ?? null,
        completed_at: task.completedAt ?? null,
        timeout_ms: task.timeoutMs ?? null,
      };

      const { error } = await this.client
        .from("agent_tasks")
        .upsert(row, { onConflict: "id" });

      if (error) {
        log.error(`saveTask ${task.id.slice(0, 8)}: ${error.message}`);
      } else {
        log.debug(`Tâche persistée: ${task.id.slice(0, 8)} [${task.role}] "${task.title}"`);
      }
    } catch (err) {
      log.error(`saveTask exception: ${(err as Error).message}`);
    }
  }

  /**
   * Planifie une mise à jour de statut pour batching.
   */
  scheduleUpdate(taskId: string, update: Partial<AgentTaskRow>): void {
    this.pendingUpdates.set(taskId, { ...this.pendingUpdates.get(taskId), ...update });
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flushUpdates(), 5000);
    }
  }

  /** Flush les mises à jour en batch vers Supabase */
  private async flushUpdates(): Promise<void> {
    if (!this.client || this.pendingUpdates.size === 0) return;
    
    try {
      const updates = Array.from(this.pendingUpdates.entries());
      this.pendingUpdates.clear();
      this.flushTimeout = null;
      
      // Batch update - Supabase supporte les updates batch via RPC ou multiple requêtes
      // Pour simplifier, on fait des updates individuelles mais groupées
      for (const [taskId, update] of updates) {
        const { error } = await this.client
          .from("agent_tasks")
          .update(update)
          .eq("id", taskId);
        
        if (error) {
          log.error(`flushUpdates ${taskId.slice(0, 8)}: ${error.message}`);
        }
      }
      
      log.debug(`✅ Batch flush: ${updates.length} mises à jour de tâches envoyées à Supabase`);
    } catch (err) {
      log.error(`flushUpdates exception: ${(err as Error).message}`);
      // En cas d'erreur, réessayer après 5 secondes
      this.flushTimeout = setTimeout(() => this.flushUpdates(), 5000);
    }
  }

  /** Met à jour le statut + résultat d'une tâche */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    result?: TaskResult,
    startedAt?: string,
    completedAt?: string
  ): Promise<void> {
    if (!this.client) return;
    
    const update: Partial<AgentTaskRow> = { status };
    if (result !== undefined)     update.result       = result;
    if (startedAt !== undefined)  update.started_at   = startedAt;
    if (completedAt !== undefined) update.completed_at = completedAt;
    
    // Utiliser le batch au lieu de lupdate immédiat
    this.scheduleUpdate(taskId, update);
  }

  /** Charge toutes les tâches non terminées (recovery au redémarrage) */
  async loadPendingTasks(): Promise<AgentTask[]> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from("agent_tasks")
        .select("*")
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: true });

      if (error) {
        log.error(`loadPendingTasks: ${error.message}`);
        return [];
      }

      return (data as AgentTaskRow[]).map(this.rowToTask);
    } catch (err) {
      log.error(`loadPendingTasks exception: ${(err as Error).message}`);
      return [];
    }
  }

  /** Charge les N dernières tâches (pour restaurer l'état en mémoire) */
  async loadRecentTasks(limit = 100): Promise<AgentTask[]> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from("agent_tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        log.error(`loadRecentTasks: ${error.message}`);
        return [];
      }

      return (data as AgentTaskRow[]).map(this.rowToTask);
    } catch (err) {
      log.error(`loadRecentTasks exception: ${(err as Error).message}`);
      return [];
    }
  }

  // ─── OrchestrationPlan ────────────────────────────────────────────────────

  /** Insère un plan d'orchestration */
  async saveOrchestration(plan: OrchestrationPlan): Promise<void> {
    if (!this.client) return;
    try {
      const row: AgentOrchestrationRow = {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        dependencies: plan.dependencies,
        created_at: plan.createdAt,
        completed_at: plan.completedAt ?? null,
      };

      const { error } = await this.client
        .from("agent_orchestrations")
        .upsert(row, { onConflict: "id" });

      if (error) {
        log.error(`saveOrchestration ${plan.id.slice(0, 8)}: ${error.message}`);
      } else {
        log.debug(`Orchestration persistée: ${plan.id.slice(0, 8)} "${plan.title}"`);
      }
    } catch (err) {
      log.error(`saveOrchestration exception: ${(err as Error).message}`);
    }
  }

  /** Met à jour le statut d'une orchestration */
  async updateOrchestrationStatus(
    orchestrationId: string,
    status: TaskStatus,
    completedAt?: string
  ): Promise<void> {
    if (!this.client) return;
    try {
      const update: Partial<AgentOrchestrationRow> = { status };
      if (completedAt) update.completed_at = completedAt;

      const { error } = await this.client
        .from("agent_orchestrations")
        .update(update)
        .eq("id", orchestrationId);

      if (error) {
        log.error(`updateOrchestrationStatus ${orchestrationId.slice(0, 8)}: ${error.message}`);
      }
    } catch (err) {
      log.error(`updateOrchestrationStatus exception: ${(err as Error).message}`);
    }
  }

  /** Charge les N dernières orchestrations */
  async loadRecentOrchestrations(limit = 20): Promise<AgentOrchestrationRow[]> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from("agent_orchestrations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        log.error(`loadRecentOrchestrations: ${error.message}`);
        return [];
      }

      return data as AgentOrchestrationRow[];
    } catch (err) {
      log.error(`loadRecentOrchestrations exception: ${(err as Error).message}`);
      return [];
    }
  }

  // ─── Messages inter-agents ─────────────────────────────────────────────────

  /** Persiste un message du bus inter-agents (optionnel, best-effort) */
  async saveMessage(message: AgentMessage): Promise<void> {
    if (!this.client) return;
    // Ne persister que les task_request et task_response (pas les broadcasts légers)
    if (message.type === "broadcast" || message.type === "status_query") return;
    try {
      const row: AgentMessageRow = {
        id: message.id,
        type: message.type,
        from_role: message.from,
        to_role: String(message.to),
        priority: message.priority,
        payload: message.payload as unknown as Record<string, unknown>,
        correlation_id: message.correlationId ?? null,
        metadata: message.metadata ?? null,
        created_at: message.timestamp,
      };

      const { error } = await this.client
        .from("agent_messages")
        .insert(row);

      // Ignorer les erreurs de duplication (idempotence)
      if (error && !error.message.includes("duplicate")) {
        log.debug(`saveMessage ${message.id.slice(0, 8)}: ${error.message}`);
      }
    } catch {
      // Silencieux — la persistance des messages est best-effort
    }
  }

  // ─── Migration SQL ────────────────────────────────────────────────────────

  /**
   * Retourne le SQL de migration pour créer les tables nécessaires.
   * À exécuter une fois via le dashboard Supabase ou une migration Flyway.
   */
  static getMigrationSQL(): string {
    return `
-- ── Agent Tasks ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_tasks (
  id                  UUID PRIMARY KEY,
  orchestration_id    UUID REFERENCES agent_orchestrations(id) ON DELETE SET NULL,
  -- 'role' est volontairement un TEXT libre (sans CHECK) : l'ensemble des rôles
  -- est ouvert. En plus des rôles statiques (coder, researcher, debugger, tester,
  -- reviewer, vision, writer, planner, …), le DynamicPlanner et l'Agent Builder
  -- peuvent enregistrer des rôles dynamiques à l'exécution. La validation/normalisation
  -- se fait côté application (normalizeAgentRole + schémas Zod), pas via une liste
  -- figée en base qui casserait à chaque nouveau rôle.
  role                TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  context_files       TEXT[]   NOT NULL DEFAULT '{}',
  context_instructions TEXT,
  context_metadata    JSONB,
  result              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  timeout_ms          INTEGER
);

-- Migration idempotente pour les bases déjà créées avec l'ancienne contrainte
-- CHECK (role IN (...)) qui rejetait 'researcher', 'debugger', 'tester', etc.
ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_role_check;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status       ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_role         ON agent_tasks(role);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at   ON agent_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_orchestration ON agent_tasks(orchestration_id);

-- ── Agent Orchestrations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_orchestrations (
  id           UUID PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  dependencies JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_orchestrations_status     ON agent_orchestrations(status);
CREATE INDEX IF NOT EXISTS idx_agent_orchestrations_created_at ON agent_orchestrations(created_at DESC);

-- ── Agent Messages (bus inter-agents) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id             UUID PRIMARY KEY,
  type           TEXT NOT NULL,
  from_role      TEXT NOT NULL,
  to_role        TEXT NOT NULL,
  priority       TEXT NOT NULL DEFAULT 'medium',
  payload        JSONB NOT NULL DEFAULT '{}',
  correlation_id UUID,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_type       ON agent_messages(type);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from_role  ON agent_messages(from_role);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at ON agent_messages(created_at DESC);

-- Row Level Security (optionnel — activer si multi-tenant)
-- ALTER TABLE agent_tasks          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_orchestrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_messages       ENABLE ROW LEVEL SECURITY;
`;
  }

  // ─── Helpers de conversion ────────────────────────────────────────────────

  private rowToTask(row: AgentTaskRow): AgentTask {
    return {
      id: row.id,
      orchestrationId: row.orchestration_id ?? undefined,
      role: row.role as AgentTask["role"],
      title: row.title,
      description: row.description,
      priority: row.priority as AgentTask["priority"],
      status: row.status as AgentTask["status"],
      context: {
        files: row.context_files ?? [],
        instructions: row.context_instructions ?? undefined,
        metadata: row.context_metadata ?? undefined,
      },
      result: row.result ?? undefined,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      timeoutMs: row.timeout_ms ?? undefined,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const agentPersistence = new AgentPersistence();
