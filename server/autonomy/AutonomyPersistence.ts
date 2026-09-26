/**
 * AutonomyPersistence — Durable task store for autonomy-originated work
 *
 * Responsabilités :
 * - Persister les tâches autonomes du TaskManager (create + transitions d'état)
 * - Recharger les tâches non terminées au redémarrage (checkpoint / resume)
 *
 * Ceci comble une limite documentée dans AUTONOMY.md : les tâches génériques du
 * TaskManager n'étaient pas persistées et n'étaient donc pas reprises après un
 * crash. La persistance suit exactement le même contrat optionnel que
 * `AgentPersistence` : elle ne duplique aucun système de missions/queues.
 *
 * Table Supabase attendue (créée par le SQL de migration) :
 *   - autonomy_tasks : tâches autonomes bornées
 *
 * Tolérance aux pannes :
 * - Si Supabase n'est pas configuré → mode dégradé silencieux (mémoire only)
 * - Les erreurs Supabase ne bloquent JAMAIS l'exécution des tâches autonomes
 * - Chaque opération a son propre try/catch avec log
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";
import type { AgentPriority } from "../runtime/types.js";
import type { AutonomousTask, AutonomousTaskStatus } from "./TaskManager.js";

const log = createLogger("AutonomyPersistence");

interface AutonomyTaskRow {
  id: string;
  type: string;
  title: string;
  priority: string;
  source_event_id: string;
  fingerprint: string;
  status: string;
  attempts: number;
  max_retries: number;
  timeout_ms: number;
  metadata: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class AutonomyPersistence {
  private client: SupabaseClient | null = null;
  private available = false;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;

    if (url && key) {
      this.client = createClient(url, key);
      this.available = true;
      log.info("✅ AutonomyPersistence connecté à Supabase");
    } else {
      log.warn("⚠️ Supabase non configuré — persistance des tâches autonomes désactivée (mode mémoire)");
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Insère ou met à jour une tâche autonome (idempotent via upsert sur id). */
  async saveTask(task: AutonomousTask): Promise<void> {
    if (!this.client) return;
    try {
      const { error } = await this.client
        .from("autonomy_tasks")
        .upsert(this.taskToRow(task), { onConflict: "id" });

      if (error) log.error(`saveTask ${task.id.slice(0, 8)}: ${error.message}`);
    } catch (err) {
      log.error(`saveTask exception: ${(err as Error).message}`);
    }
  }

  /** Met à jour le statut (+ champs volatils) d'une tâche existante. */
  async updateTask(task: AutonomousTask): Promise<void> {
    if (!this.client) return;
    try {
      const { error } = await this.client
        .from("autonomy_tasks")
        .update({
          status: task.status,
          attempts: task.attempts,
          error: task.error ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      if (error) log.error(`updateTask ${task.id.slice(0, 8)}: ${error.message}`);
    } catch (err) {
      log.error(`updateTask exception: ${(err as Error).message}`);
    }
  }

  /**
   * Charge les tâches non terminées (pending / running) pour reprise au
   * redémarrage. Une tâche `running` interrompue par un crash est re-soumise
   * comme `pending` par le TaskManager, qui applique de nouveau ses bornes
   * (retries, timeout, circuit breaker).
   */
  async loadPendingTasks(): Promise<AutonomousTask[]> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from("autonomy_tasks")
        .select("*")
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: true });

      if (error) {
        log.error(`loadPendingTasks: ${error.message}`);
        return [];
      }

      return (data as AutonomyTaskRow[]).map((row) => this.rowToTask(row));
    } catch (err) {
      log.error(`loadPendingTasks exception: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Retourne le SQL de migration pour créer la table nécessaire.
   * À exécuter une fois via le dashboard Supabase ou une migration.
   */
  static getMigrationSQL(): string {
    return `
-- ── Autonomy Tasks (durable task store) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS autonomy_tasks (
  id              UUID PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('maintenance','reactive','mission','reflection')),
  title           TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  source_event_id TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','dead_letter','cancelled')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  timeout_ms      INTEGER NOT NULL DEFAULT 60000,
  metadata        JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autonomy_tasks_status     ON autonomy_tasks(status);
CREATE INDEX IF NOT EXISTS idx_autonomy_tasks_type       ON autonomy_tasks(type);
CREATE INDEX IF NOT EXISTS idx_autonomy_tasks_created_at ON autonomy_tasks(created_at DESC);
`;
  }

  private taskToRow(task: AutonomousTask): AutonomyTaskRow {
    const nowIso = new Date().toISOString();
    return {
      id: task.id,
      type: task.type,
      title: task.title,
      priority: task.priority,
      source_event_id: task.sourceEventId,
      fingerprint: task.fingerprint,
      status: task.status,
      attempts: task.attempts,
      max_retries: task.maxRetries,
      timeout_ms: task.timeoutMs,
      metadata: (task.metadata as Record<string, unknown>) ?? null,
      error: task.error ?? null,
      created_at: new Date(task.createdAt).toISOString(),
      updated_at: nowIso,
    };
  }

  private rowToTask(row: AutonomyTaskRow): AutonomousTask {
    return {
      id: row.id,
      type: row.type as AutonomousTask["type"],
      title: row.title,
      priority: row.priority as AgentPriority,
      sourceEventId: row.source_event_id,
      fingerprint: row.fingerprint,
      createdAt: new Date(row.created_at).getTime(),
      status: row.status as AutonomousTaskStatus,
      attempts: row.attempts,
      maxRetries: row.max_retries,
      timeoutMs: row.timeout_ms,
      metadata: row.metadata ?? undefined,
      error: row.error ?? undefined,
    };
  }
}
