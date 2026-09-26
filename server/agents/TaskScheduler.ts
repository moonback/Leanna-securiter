/**
 * TaskScheduler — Gère l'orchestration multi-agents avec dépendances
 *
 * Responsabilité unique : exécuter un plan d'orchestration en respectant
 * les dépendances entre tâches et la parallélisation.
 */
import type { OrchestrationPlan, TaskResult } from "./types.js";
import { getAgentDefinition } from "./roles.js";
import { ProgressNotifier } from "./ProgressNotifier.js";
import { createLogger } from "../utils/logger.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";

const log = createLogger("TaskScheduler");

/**
 * Moteur d'exécution d'une tâche. Implémenté par `AgentExecutor` (legacy) et
 * par `AgentRuntimeExecutor` (runtime agentique). Le scheduler dépend de cette
 * interface partagée, pas d'une implémentation concrète.
 */
export type TaskRunner = AgentTaskRunner;

export class TaskScheduler {
  constructor(
    private executor: TaskRunner,
    private notifier?: ProgressNotifier
  ) {}

  /** Remplace le moteur d'exécution (bascule vers le runtime agentique). */
  setRunner(runner: TaskRunner): void {
    this.executor = runner;
  }

  /**
   * Exécute un plan d'orchestration complet.
   * Les tâches sans dépendances s'exécutent en parallèle.
   * Gère le deadlock quand des dépendances échouent.
   */
  async execute(plan: OrchestrationPlan): Promise<void> {
    const orchShortId = plan.id.slice(0, 8);
    const startTime = Date.now();

    log.info(`▶ Orchestration "${plan.title}" (${orchShortId}) — ${plan.tasks.length} tâche(s)`);

    plan.status = "running";
    const completed = new Set<string>();
    const failed = new Set<string>();
    let iteration = 0;

    while (completed.size + failed.size < plan.tasks.length) {
      iteration++;
      log.debug(`[${orchShortId}] Itération ${iteration} — Terminées: ${completed.size} | Échouées: ${failed.size}`);

      // Trouver les tâches prêtes (dépendances satisfaites et pas encore démarrées)
      const ready = plan.tasks.filter((t) => {
        if (t.status !== "pending") return false;
        const deps = plan.dependencies[t.id] ?? [];
        return deps.every((depId) => completed.has(depId));
      });

      if (ready.length === 0) {
        const running = plan.tasks.filter((t) => t.status === "running");
        if (running.length === 0) {
          // Deadlock: tâches en attente dont les dépendances ont échoué
          log.warn(`[${orchShortId}] Deadlock détecté — tâches bloquées par dépendances échouées`);
          const blocked = plan.tasks.filter(t => t.status === "pending");
          for (const b of blocked) {
            const deps = plan.dependencies[b.id] ?? [];
            const failedDeps = deps.filter(d => failed.has(d));
            log.warn(`  Bloquée: "${b.title}" — attend: ${failedDeps.join(", ")}`);
            b.status = "incomplete";
            b.completedAt = new Date().toISOString();
            b.result = {
              success: false,
              outcome: "failed",
              summary: "Tâche bloquée par une dépendance non terminée",
              error: `Dépendances non satisfaites: ${deps.join(", ") || "inconnues"}`,
              durationMs: 0,
            };
            failed.add(b.id);
            this.notifier?.notify(b, "failed");
          }
          break;
        }
        // Attendre que les tâches en cours terminent
        await this.sleep(500);
        continue;
      }

      log.info(`[${orchShortId}] Lancement de ${ready.length} tâche(s) en parallèle`);

      // Lancer les tâches prêtes en parallèle
      const executions = ready.map(async (task) => {
        const taskShortId = task.id.slice(0, 8);
        const agentName = getAgentDefinition(task.role)?.name ?? task.role;
        // Injecter les résultats des dépendances dans le contexte
        const deps = plan.dependencies[task.id] ?? [];
        const previousResults: TaskResult[] = deps
          .map((depId) => plan.tasks.find((t) => t.id === depId)?.result)
          .filter(Boolean) as TaskResult[];

        if (previousResults.length > 0) {
          task.context.previousResults = previousResults;
          log.debug(`[${orchShortId}] [task:${taskShortId}] [${agentName}] Contexte injecté: ${previousResults.length} résultat(s) de dépendance(s)`);
        }

        log.info(`[${orchShortId}] [task:${taskShortId}] ➤ [${agentName}] Lancement: "${task.title}" | Dépendances satisfaites: ${deps.length > 0 ? deps.map(d => d.slice(0, 8)).join(", ") : "aucune"}`);
        const taskStart = Date.now();
        await this.executor.execute(task);
        const taskMs = Date.now() - taskStart;

        if (task.status === "completed") {
          completed.add(task.id);
          log.info(`[${orchShortId}] [task:${taskShortId}] ✅ [${agentName}] Terminé en ${(taskMs / 1000).toFixed(1)}s | Progression: ${completed.size + failed.size}/${plan.tasks.length}`);
        } else {
          failed.add(task.id);
          log.warn(`[${orchShortId}] [task:${taskShortId}] ❌ [${agentName}] Échoué en ${(taskMs / 1000).toFixed(1)}s — ${task.result?.error ?? "raison inconnue"} | Progression: ${completed.size + failed.size}/${plan.tasks.length}`);
        }
      });

      await Promise.allSettled(executions);

      // (Audit §7) Marquer immédiatement les tâches dont toutes les dépendances
      // incluent une tâche échouée, plutôt que d'attendre le deadlock.
      for (const task of plan.tasks) {
        if (task.status !== "pending") continue;
        const deps = plan.dependencies[task.id] ?? [];
        const hasFailedDep = deps.some((depId) => failed.has(depId));
        if (hasFailedDep) {
          task.status = "incomplete";
          task.completedAt = new Date().toISOString();
          task.result = {
            success: false,
            outcome: "failed",
            summary: "Tâche annulée : dépendance échouée",
            error: `Dépendance(s) échouée(s): ${deps.filter(d => failed.has(d)).join(", ")}`,
            durationMs: 0,
          };
          failed.add(task.id);
          this.notifier?.notify(task, "failed");
          log.warn(`[${orchShortId}] Tâche "${task.title}" annulée (dépendance échouée)`);
        }
      }
    }

    // Une orchestration n'est terminée avec succès que si chaque tâche porte un
    // résultat vérifié. Les exécutions partielles/incomplètes restent visibles.
    const totalDuration = Date.now() - startTime;
    if (completed.size === plan.tasks.length) {
      plan.status = "completed";
    } else if (completed.size > 0) {
      plan.status = "incomplete";
    } else {
      plan.status = "failed";
    }
    plan.completedAt = new Date().toISOString();

    const emoji = plan.status === "completed" ? "✅" : "❌";
    log.info(`${emoji} Orchestration "${plan.title}" terminée en ${(totalDuration / 1000).toFixed(1)}s — ${completed.size}/${plan.tasks.length} vérifiée(s), ${failed.size} incomplète(s)/échouée(s)`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
