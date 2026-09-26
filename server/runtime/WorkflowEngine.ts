/**
 * WorkflowEngine — Moteur d'exécution de workflows déclaratifs
 * 
 * Exécute des workflows décrits en JSON/YAML avec résolution automatique
 * des dépendances entre étapes (DAG topologique).
 * 
 * Fonctionnalités :
 * - Chargement de workflows depuis fichiers ou BDD
 * - Résolution de dépendances (exécution parallèle quand possible)
 * - Templates dans les arguments ({{prev.result}}, {{steps.X.result}})
 * - Conditions d'exécution par étape
 * - Retry et error handling configurables
 * - Événements temps réel via EventBus
 */

import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowRun,
} from "./types.js";
import type { ToolRegistry } from "./ToolRegistry.js";
import type { EventBus } from "./EventBus.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface StepResult {
  stepId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
  skipped?: boolean;
}

export interface WorkflowResult {
  workflowId: string;
  success: boolean;
  steps: StepResult[];
  totalDurationMs: number;
}

export interface WorkflowEngineConfig {
  tools: ToolRegistry;
  eventBus?: EventBus;
  /** Timeout par défaut par étape (ms) */
  defaultStepTimeoutMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WorkflowEngine
// ═══════════════════════════════════════════════════════════════════════════════

export class WorkflowEngine {
  private tools: ToolRegistry;
  private eventBus?: EventBus;
  private defaultStepTimeoutMs: number;

  // Workflows enregistrés
  private workflows = new Map<string, WorkflowDefinition>();
  // Exécutions en cours
  private activeRuns = new Map<string, WorkflowRun>();

  constructor(config: WorkflowEngineConfig) {
    this.tools = config.tools;
    this.eventBus = config.eventBus;
    this.defaultStepTimeoutMs = config.defaultStepTimeoutMs ?? 120_000;
  }

  // ─── Gestion des workflows ─────────────────────────────────────────────────

  /**
   * Enregistre un workflow.
   */
  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
  }

  /**
   * Supprime un workflow.
   */
  unregister(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  /**
   * Retourne un workflow par son ID.
   */
  get(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Liste tous les workflows enregistrés.
   */
  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // ─── Exécution ─────────────────────────────────────────────────────────────

  /**
   * Exécute un workflow par son ID.
   * Résout le DAG de dépendances et exécute les étapes en parallèle quand possible.
   */
  async execute(workflowId: string): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" introuvable`);
    }

    return this.executeWorkflow(workflow);
  }

  /**
   * Exécute un workflow inline (pas besoin de l'enregistrer).
   */
  async executeInline(workflow: WorkflowDefinition): Promise<WorkflowResult> {
    return this.executeWorkflow(workflow);
  }

  /**
   * Retourne l'état d'une exécution en cours.
   */
  getActiveRun(workflowId: string): WorkflowRun | undefined {
    return this.activeRuns.get(workflowId);
  }

  // ─── Exécution interne ─────────────────────────────────────────────────────

  private async executeWorkflow(workflow: WorkflowDefinition): Promise<WorkflowResult> {
    const startTime = Date.now();
    const stepResults = new Map<string, StepResult>();

    this.eventBus?.emit({ type: "workflow:started", workflowId: workflow.id, name: workflow.name });

    // Construire le graphe de dépendances
    const graph = this.buildDependencyGraph(workflow.steps);

    // Tri topologique pour l'ordre d'exécution
    const executionOrder = this.topologicalSort(graph, workflow.steps);

    // Exécution séquentielle avec parallélisation par vague
    const waves = this.groupIntoWaves(executionOrder, workflow.steps);

    let overallSuccess = true;
    let aborted = false;

    for (const wave of waves) {
      if (aborted) break;

      // Exécuter les étapes de la vague en parallèle
      const waveResults = await Promise.all(
        wave.map((stepId) => {
          const step = workflow.steps.find((s) => s.id === stepId)!;
          return this.executeStep(step, stepResults, workflow.id);
        })
      );

      // Enregistrer les résultats
      for (const result of waveResults) {
        stepResults.set(result.stepId, result);

        this.eventBus?.emit({
          type: "workflow:stepCompleted",
          workflowId: workflow.id,
          stepId: result.stepId,
          success: result.success,
        });

        if (!result.success && !result.skipped) {
          const step = workflow.steps.find((s) => s.id === result.stepId)!;
          if (step.onError === "stop") {
            overallSuccess = false;
            aborted = true;
            break;
          }
          overallSuccess = false;
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const success = overallSuccess;

    this.eventBus?.emit({ type: "workflow:completed", workflowId: workflow.id, success });

    return {
      workflowId: workflow.id,
      success,
      steps: Array.from(stepResults.values()),
      totalDurationMs,
    };
  }

  private async executeStep(
    step: WorkflowStep,
    previousResults: Map<string, StepResult>,
    _workflowId: string
  ): Promise<StepResult> {
    const startTime = Date.now();

    // Évaluer la condition
    if (step.condition) {
      const shouldRun = this.evaluateCondition(step.condition, previousResults);
      if (!shouldRun) {
        return {
          stepId: step.id,
          success: true,
          skipped: true,
          durationMs: 0,
        };
      }
    }

    // Résoudre les templates dans les arguments
    const resolvedArgs = this.resolveTemplates(step.args ?? {}, previousResults);

    // Exécution avec retry
    const maxAttempts = step.onError === "retry" ? (step.maxRetries ?? 2) : 1;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.tools.call(step.action, resolvedArgs, {
          timeoutMs: step.timeoutMs,
        });

        return {
          stepId: step.id,
          success: true,
          result,
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        lastError = (err as Error).message;
        if (attempt < maxAttempts - 1) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    // Si onError === "skip", on marque comme succès avec erreur notée
    if (step.onError === "skip") {
      return {
        stepId: step.id,
        success: true,
        skipped: true,
        error: lastError,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      stepId: step.id,
      success: false,
      error: lastError,
      durationMs: Date.now() - startTime,
    };
  }

  // ─── Résolution de dépendances ─────────────────────────────────────────────

  private buildDependencyGraph(steps: WorkflowStep[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const step of steps) {
      graph.set(step.id, step.dependsOn ?? []);
    }
    return graph;
  }

  private topologicalSort(graph: Map<string, string[]>, steps: WorkflowStep[]): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Dépendance circulaire détectée impliquant l'étape "${id}"`);
      }

      visiting.add(id);
      const deps = graph.get(id) ?? [];
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return sorted;
  }

  /**
   * Regroupe les étapes en vagues parallélisables.
   * Les étapes d'une même vague n'ont pas de dépendances entre elles.
   */
  private groupIntoWaves(order: string[], steps: WorkflowStep[]): string[][] {
    const waves: string[][] = [];
    const completed = new Set<string>();

    const remaining = new Set(order);

    while (remaining.size > 0) {
      const wave: string[] = [];

      for (const id of remaining) {
        const step = steps.find((s) => s.id === id)!;
        const deps = step.dependsOn ?? [];
        const allDepsCompleted = deps.every((d) => completed.has(d));

        if (allDepsCompleted) {
          wave.push(id);
        }
      }

      if (wave.length === 0) {
        // Sécurité : si on ne peut rien exécuter, on force le premier restant
        const first = remaining.values().next().value;
        if (first) wave.push(first);
      }

      for (const id of wave) {
        remaining.delete(id);
        completed.add(id);
      }

      waves.push(wave);
    }

    return waves;
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  private resolveTemplates(
    args: Record<string, unknown>,
    results: Map<string, StepResult>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        resolved[key] = this.resolveStringTemplate(value, results);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        resolved[key] = this.resolveTemplates(value as Record<string, unknown>, results);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private resolveStringTemplate(
    template: string,
    results: Map<string, StepResult>
  ): unknown {
    // Si le template entier est une référence, retourner la valeur brute
    const fullMatch = template.match(/^\{\{(.+?)\}\}$/);
    if (fullMatch) {
      return this.resolveRef(fullMatch[1].trim(), results);
    }

    // Sinon, interpolation dans la string
    return template.replace(/\{\{(.+?)\}\}/g, (_, ref) => {
      const val = this.resolveRef(ref.trim(), results);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
  }

  private resolveRef(ref: string, results: Map<string, StepResult>): unknown {
    // prev.result, prev.error, prev.success
    if (ref.startsWith("prev.")) {
      const entries = Array.from(results.values());
      const prev = entries[entries.length - 1];
      if (!prev) return undefined;
      const field = ref.slice(5);
      if (field === "result") return prev.result;
      if (field === "error") return prev.error;
      if (field === "success") return prev.success;
      return undefined;
    }

    // steps.STEP_ID.result, steps.STEP_ID.error
    if (ref.startsWith("steps.")) {
      const parts = ref.slice(6).split(".");
      if (parts.length < 2) return undefined;
      const stepResult = results.get(parts[0]);
      if (!stepResult) return undefined;
      if (parts[1] === "result") return stepResult.result;
      if (parts[1] === "error") return stepResult.error;
      if (parts[1] === "success") return stepResult.success;
      return undefined;
    }

    return undefined;
  }

  // ─── Conditions ────────────────────────────────────────────────────────────

  private evaluateCondition(condition: string, results: Map<string, StepResult>): boolean {
    try {
      const trimmed = condition.trim();
      if (!trimmed) return true;

      // Conditions simples supportées :
      // "prev.success === true"
      // "steps.build.success === true"
      // "prev.result !== null"

      // Résoudre les références dans la condition
      const resolved = trimmed.replace(/(\w+(?:\.\w+)+)/g, (match) => {
        const val = this.resolveRef(match, results);
        return JSON.stringify(val);
      });

      // Évaluation sécurisée (opérateurs simples uniquement)
      return this.safeEval(resolved);
    } catch {
      return true; // En cas d'erreur, on exécute l'étape
    }
  }

  private safeEval(expr: string): boolean {
    // Support basique : comparaisons simples
    const eqMatch = expr.match(/^(.+?)\s*(===|!==|==|!=)\s*(.+?)$/);
    if (eqMatch) {
      const left = JSON.parse(eqMatch[1].trim());
      const op = eqMatch[2];
      const right = JSON.parse(eqMatch[3].trim());
      switch (op) {
        case "===": case "==": return left === right;
        case "!==": case "!=": return left !== right;
      }
    }
    // Par défaut, truthy
    return true;
  }

  // ─── Utils ─────────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
