/**
 * BrainScheduler — Moteur topologique parallèle pour l'Agent Brain
 *
 * Responsabilité unique : exécuter les étapes (`BrainStage`) d'un plan en
 * respectant les dépendances `dependsOn`, en lançant en parallèle toutes les
 * étapes dont les dépendances sont satisfaites (fan-out), puis en attendant
 * leur convergence (fan-in). L'exécution concrète d'une étape (délégation,
 * vérification, correction) est déléguée à un callback injecté, ce qui rend
 * le scheduler testable sans orchestrateur réel.
 */
import type { BrainStage, StageVerification } from "./types.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("BrainScheduler");

/**
 * Callback d'exécution d'une étape unique.
 * @param stage L'étape à exécuter.
 * @param completedResults Vérifications des dépendances déjà terminées (fan-in).
 * @returns La vérification finale de l'étape (après correction éventuelle).
 */
export type ExecuteStageFn = (
  stage: BrainStage,
  completedResults: StageVerification[]
) => Promise<StageVerification>;

export interface BrainScheduleReport {
  /** ids des étapes terminées avec succès */
  completed: string[];
  /** ids des étapes échouées (échec persistant) */
  failed: string[];
  /** ids des étapes annulées car une dépendance a échoué */
  incomplete: string[];
  /** ordre de démarrage des étapes (pour observabilité / tests) */
  executionOrder: string[];
  /** vérification finale par étape */
  verifications: Record<string, StageVerification>;
  /** première étape en échec persistant (déclencheur de réplanification) */
  firstFailedStageId: string | null;
  /** true si un deadlock (dépendances échouées) a été détecté */
  deadlocked: boolean;
}

export class BrainScheduler {
  constructor(private executeStage: ExecuteStageFn) {}

  /**
   * Exécute les étapes fournies en respectant leurs dépendances.
   * Ne modifie pas les statuts des étapes déjà `completed` en entrée
   * (permet la réexécution d'un sous-graphe après réplanification).
   */
  async execute(stages: BrainStage[]): Promise<BrainScheduleReport> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const incomplete = new Set<string>();
    const executionOrder: string[] = [];
    const verifications: Record<string, StageVerification> = {};
    let firstFailedStageId: string | null = null;
    let deadlocked = false;

    // Les étapes déjà terminées (ex: sous-graphe préservé) comptent comme satisfaites.
    for (const stage of stages) {
      if (stage.status === "completed") {
        completed.add(stage.id);
        if (stage.result) {
          // reconstruire une vérification minimale "passed" pour le fan-in
          verifications[stage.id] = this.syntheticPass(stage);
        }
      }
    }

    const isTerminal = (id: string) => completed.has(id) || failed.has(id) || incomplete.has(id);
    const total = stages.length;

    while (completed.size + failed.size + incomplete.size < total) {
      // Étapes prêtes : pending, non terminales, dont toutes les deps sont completed
      const ready = stages.filter((s) => {
        if (isTerminal(s.id)) return false;
        if (s.status === "running") return false;
        const deps = s.dependsOn ?? [];
        return deps.every((depId) => completed.has(depId));
      });

      if (ready.length === 0) {
        const running = stages.filter((s) => s.status === "running");
        if (running.length === 0) {
          // Aucune étape prête ni en cours → tâches bloquées par des deps échouées
          this.markBlocked(stages, completed, failed, incomplete, verifications);
          deadlocked = incomplete.size > 0;
          if (deadlocked) {
            log.warn(`Deadlock : ${incomplete.size} étape(s) bloquée(s) par des dépendances échouées`);
          }
          break;
        }
        // Des étapes tournent encore : attendre un cycle
        await this.sleep(50);
        continue;
      }

      log.info(`▶ Fan-out : lancement de ${ready.length} étape(s) en parallèle [${ready.map((s) => s.id).join(", ")}]`);

      const runs = ready.map(async (stage) => {
        stage.status = "running";
        executionOrder.push(stage.id);

        // Fan-in : collecter les vérifications des dépendances
        const deps = stage.dependsOn ?? [];
        const depResults = deps
          .map((depId) => verifications[depId])
          .filter((v): v is StageVerification => Boolean(v));

        try {
          const verification = await this.executeStage(stage, depResults);
          verifications[stage.id] = verification;
          if (verification.passed) {
            stage.status = "completed";
            completed.add(stage.id);
          } else {
            stage.status = "failed";
            failed.add(stage.id);
            if (!firstFailedStageId) firstFailedStageId = stage.id;
          }
        } catch (err: any) {
          log.error(`Étape ${stage.id} a levé une exception : ${err?.message ?? err}`);
          stage.status = "failed";
          failed.add(stage.id);
          if (!firstFailedStageId) firstFailedStageId = stage.id;
        }
      });

      await Promise.allSettled(runs);

      // Marquer immédiatement les étapes dont une dépendance vient d'échouer.
      this.markBlocked(stages, completed, failed, incomplete, verifications);
    }

    log.info(
      `Terminé : ${completed.size} réussie(s), ${failed.size} échouée(s), ${incomplete.size} annulée(s) / ${total}`
    );

    return {
      completed: [...completed],
      failed: [...failed],
      incomplete: [...incomplete],
      executionOrder,
      verifications,
      firstFailedStageId,
      deadlocked,
    };
  }

  /**
   * Marque `incomplete` toute étape pending dont au moins une dépendance a
   * échoué (ou est elle-même incomplete). Propage en cascade.
   */
  private markBlocked(
    stages: BrainStage[],
    completed: Set<string>,
    failed: Set<string>,
    incomplete: Set<string>,
    verifications: Record<string, StageVerification>
  ): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const stage of stages) {
        if (completed.has(stage.id) || failed.has(stage.id) || incomplete.has(stage.id)) continue;
        if (stage.status === "running") continue;
        const deps = stage.dependsOn ?? [];
        const blockedDep = deps.find((d) => failed.has(d) || incomplete.has(d));
        if (blockedDep) {
          stage.status = "skipped";
          incomplete.add(stage.id);
          verifications[stage.id] = {
            stageId: stage.id,
            role: stage.agentRole,
            passed: false,
            syntaxCheckOk: false,
            testsOk: false,
            semanticCheckOk: false,
            issues: [
              {
                severity: "error",
                message: `Étape annulée : dépendance non satisfaite (${blockedDep})`,
              },
            ],
            summary: `Annulée : dépendance échouée (${blockedDep})`,
            timestamp: new Date().toISOString(),
          };
          log.warn(`Étape "${stage.id}" annulée (dépendance échouée: ${blockedDep})`);
          changed = true;
        }
      }
    }
  }

  /** Vérification synthétique "passed" pour une étape déjà terminée en entrée. */
  private syntheticPass(stage: BrainStage): StageVerification {
    return {
      stageId: stage.id,
      role: stage.agentRole,
      passed: true,
      syntaxCheckOk: true,
      testsOk: true,
      semanticCheckOk: true,
      issues: [],
      summary: `Étape pré-complétée (${stage.id})`,
      timestamp: new Date().toISOString(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
