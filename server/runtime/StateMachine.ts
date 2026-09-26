/**
 * StateMachine — Machine à états finis pour les tâches
 * 
 * Remplace les changements de statut dispersés par une FSM
 * qui valide chaque transition et émet des événements.
 * 
 * Principes :
 * - Toute transition invalide est rejetée avec une erreur explicite
 * - Les hooks before/after permettent d'injecter de la logique sans couplage
 * - Intégration naturelle avec l'EventBus
 */

import type { TaskState, Task } from "./types.js";
import { VALID_TRANSITIONS } from "./types.js";
import type { EventBus } from "./EventBus.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type TransitionHook = (task: Task, from: TaskState, to: TaskState) => void | Promise<void>;

export interface StateMachineConfig {
  /** Hook appelé AVANT chaque transition (peut rejeter via throw) */
  beforeTransition?: TransitionHook;
  /** Hook appelé APRÈS chaque transition réussie */
  afterTransition?: TransitionHook;
  /** EventBus pour émettre les changements d'état */
  eventBus?: EventBus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// StateMachine
// ═══════════════════════════════════════════════════════════════════════════════

export class StateMachine {
  private beforeHooks: TransitionHook[] = [];
  private afterHooks: TransitionHook[] = [];
  private eventBus?: EventBus;

  constructor(config: StateMachineConfig = {}) {
    if (config.beforeTransition) this.beforeHooks.push(config.beforeTransition);
    if (config.afterTransition) this.afterHooks.push(config.afterTransition);
    this.eventBus = config.eventBus;
  }

  /**
   * Tente une transition d'état sur une tâche.
   * Retourne true si la transition a réussi, false si invalide.
   * @throws Si un hook beforeTransition rejette
   */
  async transition(task: Task, to: TaskState): Promise<boolean> {
    const from = task.state;

    // Vérifier la validité de la transition
    if (!this.canTransition(from, to)) {
      return false;
    }

    // Exécuter les hooks before
    for (const hook of this.beforeHooks) {
      await hook(task, from, to);
    }

    // Appliquer la transition
    task.state = to;

    // Timestamps automatiques
    if (to === "running" && !task.startedAt) {
      task.startedAt = Date.now();
    }
    if (to === "completed" || to === "failed" || to === "cancelled") {
      task.completedAt = Date.now();
    }

    // Émettre l'événement
    this.eventBus?.emit({ type: "task:stateChanged", taskId: task.id, from, to });

    // Exécuter les hooks after
    for (const hook of this.afterHooks) {
      await hook(task, from, to);
    }

    return true;
  }

  /**
   * Vérifie si une transition est valide sans l'appliquer.
   */
  canTransition(from: TaskState, to: TaskState): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed.includes(to);
  }

  /**
   * Retourne les états accessibles depuis un état donné.
   */
  getAvailableTransitions(from: TaskState): TaskState[] {
    return VALID_TRANSITIONS[from];
  }

  /**
   * Vérifie si un état est terminal (pas de transitions sortantes).
   */
  isTerminal(state: TaskState): boolean {
    return VALID_TRANSITIONS[state].length === 0;
  }

  /**
   * Ajoute un hook before (exécuté avant chaque transition).
   */
  onBefore(hook: TransitionHook): void {
    this.beforeHooks.push(hook);
  }

  /**
   * Ajoute un hook after (exécuté après chaque transition réussie).
   */
  onAfter(hook: TransitionHook): void {
    this.afterHooks.push(hook);
  }
}
