/**
 * Pont Runtime-plugin → boucle agentique.
 *
 * Les 7 plugins de rédaction historiques utilisent l'exécuteur LLM par défaut
 * de `defineAgent` (un seul appel modèle). Les 8 rôles d'ingénierie (coder,
 * refactor, debugger, reviewer, tester, security, architect, vision) ont besoin
 * de la VRAIE boucle plan→act→verify pour être exécutables via
 * `AgentRuntime.submit()` — exactement comme via l'orchestrateur.
 *
 * Plutôt que de coupler statiquement `server/runtime/agents/*` au runtime
 * agentique (`server/runtime/agentic/*`), on expose un *provider* injecté une
 * seule fois au bootstrap. Un plugin d'ingénierie appelle ce provider au moment
 * de l'exécution. Si le provider n'a pas été branché, l'exécution échoue
 * PROPREMENT (jamais de faux succès, jamais de fallback silencieux vers un
 * autre moteur).
 *
 * Ce module est volontairement sans dépendance sur les types agentiques
 * concrets : il ne connaît qu'un contrat minimal `AgenticRunLike`.
 */

import type { AgentContext, TaskResult } from "../types.js";

/** Résultat minimal consommé par le pont (sous-ensemble d'`AgentResult`). */
export interface AgenticRunResult {
  success: boolean;
  outcome: string;
  filesModified: string[];
  toolsExecuted: string[];
  durationMs: number;
  error?: string;
  final: { summary: string; details: string; suggestions: string[] };
}

/** Contrat minimal du runtime agentique requis par le pont. */
export interface AgenticRunLike {
  run(task: {
    id?: string;
    role: string;
    goal: string;
    files?: string[];
    instructions?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgenticRunResult>;
}

let provider: AgenticRunLike | null = null;

/**
 * Branche le runtime agentique partagé. Appelé une fois au bootstrap, après
 * `createAgentRuntime(...)`. Idempotent (le dernier gagne).
 */
export function setAgenticRuntimeProvider(runtime: AgenticRunLike): void {
  provider = runtime;
}

/** Indique si le provider agentique est branché. */
export function hasAgenticRuntimeProvider(): boolean {
  return provider !== null;
}

/**
 * Exécute une tâche de plugin runtime via la boucle agentique partagée.
 *
 * @param role     rôle d'ingénierie à incarner (coder, debugger, …)
 * @param context  contexte de tâche fourni par `AgentRuntime.submit`
 * @returns TaskResult au format du runtime DI (server/runtime/types.ts)
 */
export async function runViaAgentic(role: string, context: AgentContext): Promise<TaskResult> {
  const startTime = Date.now();

  if (!provider) {
    return {
      success: false,
      summary: `Agent "${role}" non exécutable : runtime agentique non branché.`,
      error:
        "Le provider agentique n'est pas initialisé. setAgenticRuntimeProvider() " +
        "doit être appelé au bootstrap avant AgentRuntime.submit() pour ce rôle.",
      durationMs: Date.now() - startTime,
    };
  }

  // Construit l'objectif en langage naturel à partir du contexte de tâche.
  const goalParts = [context.title];
  if (context.description && context.description !== context.title) {
    goalParts.push(context.description);
  }
  const goal = goalParts.join("\n\n");

  try {
    const result = await provider.run({
      id: context.taskId,
      role,
      goal,
      files: context.files,
      instructions: context.instructions,
    });

    return {
      success: result.success,
      summary: result.final.summary || (result.success ? "Tâche terminée." : "Échec de la tâche."),
      details: result.final.details,
      error: result.error,
      durationMs: result.durationMs || Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      summary: `Erreur agent "${role}" via boucle agentique.`,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    };
  }
}
