/**
 * AgentRuntimeExecutor — Pont entre l'orchestration legacy et le runtime agentique.
 *
 * L'orchestrateur, le TaskScheduler et les agents autonomes manipulent des
 * `AgentTask` et lisent `task.status` / `task.result` in-place après
 * `execute(task)`. Cet adaptateur expose EXACTEMENT cette surface, mais délègue
 * l'exécution au vrai runtime agentique (`server/runtime/agentic/AgentRuntime`),
 * qui donne réellement ses outils à l'agent et boucle
 * analyse → plan → écriture → vérification → correction → re-vérification.
 *
 * Il remplace `AgentExecutor` comme moteur d'exécution des tâches, sans changer
 * les appelants : ceux-ci continuent d'appeler `execute(task)`.
 */

import type { AgentRuntime as AgenticRuntime } from "../runtime/agentic/AgentRuntime.js";
import type { AgentResult, AgentTask as AgenticTask, AgentBudget } from "../runtime/agentic/types.js";
import { getAgentDefinitionOrThrow, hasAgent } from "./roles.js";
import type { AgentTask, TaskResult, TaskOutcome } from "./types.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";
import { ProgressNotifier } from "./ProgressNotifier.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AgentRuntimeExecutor");

/**
 * Exécuteur de tâches basé sur le runtime agentique.
 * Compatible avec la surface publique de `AgentExecutor` utilisée par les
 * appelants (execute / getRunningCount / cancel / isRunning).
 */
export class AgentRuntimeExecutor implements AgentTaskRunner {
  private runningCount = new Map<string, number>();
  private active = new Map<string, AbortController>();

  constructor(
    private readonly agentic: AgenticRuntime,
    private readonly notifier: ProgressNotifier,
    private readonly defaultBudget?: Partial<AgentBudget>
  ) {}

  /** Exécute un outil isolé (ex: verify_file relancé par la boucle autonome). */
  runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.agentic.callTool(name, args);
  }

  getRunningCount(role: string): number {
    return this.runningCount.get(role) ?? 0;
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  /**
   * Annulation coopérative. Le runtime agentique ne prend pas encore de signal
   * d'annulation en cours de boucle ; on marque l'intention et on laisse la
   * tâche se terminer au prochain point de contrôle naturel.
   */
  cancel(taskId: string): boolean {
    const controller = this.active.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Exécute une tâche via le runtime agentique et écrit le résultat in-place,
   * en respectant le contrat de `AgentExecutor.execute`.
   */
  async execute(task: AgentTask): Promise<void> {
    const shortId = task.id.slice(0, 8);

    if (!hasAgent(task.role)) {
      task.status = "failed";
      task.result = {
        success: false,
        outcome: "failed",
        summary: `Agent "${task.role}" introuvable`,
        error: `Agent "${task.role}" non enregistré.`,
        durationMs: 0,
      };
      this.notifier.notify(task, "failed");
      return;
    }

    const agent = getAgentDefinitionOrThrow(task.role);
    const startTime = Date.now();

    this.active.set(task.id, new AbortController());
    this.increment(task.role);
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.notifier.notify(task, "started");

    log.info(`[task:${shortId}] ▶ [${agent.name}] via runtime agentique — "${task.title}"`);
    this.notifier.notify(task, "progress", { current: 1, total: 5, label: "Planification" });

    try {
      const agenticTask: AgenticTask = {
        id: task.id,
        role: task.role,
        goal: this.buildGoal(task),
        files: task.context.files,
        instructions: task.context.instructions,
        metadata: {
          ...(task.orchestrationId ? { missionId: task.orchestrationId } : {}),
          title: task.title,
        },
        budget: this.defaultBudget,
      };

      const result = await this.agentic.run(agenticTask);
      task.result = this.toTaskResult(result);
      task.status = result.success ? "completed" : "failed";
      task.completedAt = new Date().toISOString();

      this.notifier.notify(task, "progress", { current: 5, total: 5, label: "Terminé" });
      this.notifier.notify(task, result.success ? "completed" : "failed");

      log.info(
        `[task:${shortId}] ${result.success ? "✅" : "❌"} [${agent.name}] ` +
          `outcome=${result.outcome} — ${result.filesModified.length} fichier(s) modifié(s) — ` +
          `${(result.durationMs / 1000).toFixed(1)}s`
      );
    } catch (err) {
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      task.result = {
        success: false,
        outcome: "failed",
        summary: `Échec de l'agent ${agent.name}`,
        error: (err as Error).message,
        durationMs: Date.now() - startTime,
      };
      log.error(`[task:${shortId}] ❌ [${agent.name}] ${(err as Error).message}`);
      this.notifier.notify(task, "failed");
    } finally {
      this.active.delete(task.id);
      this.decrement(task.role);
    }
  }

  // ─── Adaptation des formats ────────────────────────────────────────────────

  /** Construit l'objectif en langage naturel à partir de la tâche legacy. */
  private buildGoal(task: AgentTask): string {
    const parts = [task.title];
    if (task.description && task.description !== task.title) parts.push(task.description);
    // Injecter les résultats de dépendances (chaînage d'orchestration).
    const prev = task.context.previousResults;
    if (prev?.length) {
      const summaries = prev
        .map((r) => `- ${r.summary}${r.filesModified?.length ? ` (fichiers: ${r.filesModified.join(", ")})` : ""}`)
        .join("\n");
      parts.push(`\nRÉSULTATS DES ÉTAPES PRÉCÉDENTES :\n${summaries}`);
    }
    return parts.join("\n\n");
  }

  /** Convertit un AgentResult (agentique) en TaskResult (legacy). */
  private toTaskResult(result: AgentResult): TaskResult {
    const outcome: TaskOutcome = result.outcome;
    return {
      success: result.success,
      outcome,
      summary: result.final.summary,
      details: result.final.details,
      filesModified: result.filesModified,
      suggestions: result.final.suggestions,
      error: result.error,
      durationMs: result.durationMs,
      evidence: {
        filesRead: [], // détail non exposé par le résultat agentique agrégé
        filesModified: result.filesModified,
        toolsExecuted: result.toolsExecuted,
        commandsExecuted: result.toolsExecuted.filter((t) => t === "run_project_command"),
        verification: {
          passed: result.verifications.length > 0 && result.verifications.every((v) => v.passed),
          checks: result.verifications.flatMap((v) => v.checks),
          errors: result.verifications.flatMap((v) => v.issues),
        },
      },
    };
  }

  private increment(role: string): void {
    this.runningCount.set(role, (this.runningCount.get(role) ?? 0) + 1);
  }

  private decrement(role: string): void {
    const current = this.runningCount.get(role) ?? 1;
    this.runningCount.set(role, Math.max(0, current - 1));
  }
}
