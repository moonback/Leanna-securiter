/**
 * ProgressNotifier — Gère les notifications de progression des tâches agents
 *
 * Responsabilité unique : émettre les événements de progression vers
 * le callback backend et le broadcaster temps réel vers le frontend.
 * Persiste également les mises à jour de statut dans Supabase.
 */
import type { AgentTask, TaskStatus, AgentRole } from "./types.js";
import { getAgentDefinition } from "./roles.js";
import { agentPersistence } from "./AgentPersistence.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AgentProgress");

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProgressEvent = "started" | "progress" | "completed" | "failed";

/** Callback de notification de progression */
export type ProgressCallback = (task: AgentTask, event: ProgressEvent) => void;

/** Callback pour envoyer des événements en temps réel au frontend */
export type EventBroadcaster = (event: AgentEvent) => void;

/** Événement agent envoyé au frontend pour la visibilité */
export interface AgentEvent {
  type: "agent_event";
  event: "task_started" | "task_progress" | "task_completed" | "task_failed" | "orchestration_started" | "orchestration_completed";
  taskId: string;
  role: AgentRole;
  title: string;
  status: TaskStatus;
  agentName: string;
  detail?: string;
  timestamp: string;
  summary?: string;
  durationMs?: number;
  progress?: { current: number; total: number; label: string };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ProgressNotifier
// ═══════════════════════════════════════════════════════════════════════════════

export class ProgressNotifier {
  private progressCallback: ProgressCallback | null = null;
  private eventBroadcaster: EventBroadcaster | null = null;

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  setEventBroadcaster(broadcaster: EventBroadcaster): void {
    this.eventBroadcaster = broadcaster;
  }

  /**
   * Notifie la progression d'une tâche agent via tous les canaux configurés.
   */
  notify(task: AgentTask, event: ProgressEvent, progress?: AgentEvent["progress"]): void {
    // Résolution DÉFENSIVE : un notifier ne doit jamais faire échouer l'exécuteur.
    // Un rôle inconnu (ex: échec "agent introuvable", ou agent dynamique
    // désenregistré) ne doit pas lever ici — on retombe sur le nom du rôle.
    const agentName = getAgentDefinition(task.role)?.name ?? task.role;

    // Log structuré
    switch (event) {
      case "started":
        log.info(`🚀 ${agentName} — "${task.title}" démarrée`);
        break;
      case "completed":
        log.info(`✅ ${agentName} — "${task.title}" terminée: ${task.result?.summary ?? ""}`);
        break;
      case "failed":
        log.error(`❌ ${agentName} — "${task.title}" échouée: ${task.result?.error ?? ""}`);
        break;
      case "progress":
        log.debug(`⏳ ${agentName} — "${task.title}" en cours`);
        break;
    }

    // Callback de progression (si configuré)
    if (this.progressCallback) {
      try {
        this.progressCallback(task, event);
      } catch {
        // Ne pas bloquer l'exécution sur une erreur de callback
      }
    }

    // Persistance Supabase (best-effort, non bloquant)
    if (event === "started" || event === "completed" || event === "failed") {
      agentPersistence.updateTaskStatus(
        task.id,
        task.status,
        task.result,
        task.startedAt,
        task.completedAt
      ).catch(() => {});
    }

    // Broadcast d'événement temps réel vers le frontend
    if (this.eventBroadcaster) {
      try {
        const agentEvent: AgentEvent = {
          type: "agent_event",
          event: `task_${event}` as AgentEvent["event"],
          taskId: task.id,
          role: task.role,
          title: task.title,
          status: task.status,
          agentName,
          timestamp: new Date().toISOString(),
          detail: event === "started"
            ? `Agent "${agentName}" démarre la tâche "${task.title}"`
            : event === "progress"
            ? progress?.label
            : event === "completed"
            ? task.result?.summary
            : event === "failed"
            ? task.result?.error
            : undefined,
          summary: task.result?.summary,
          durationMs: task.result?.durationMs,
          progress,
        };
        this.eventBroadcaster(agentEvent);
      } catch {
        // Ne pas bloquer l'exécution
      }
    }
  }
}
