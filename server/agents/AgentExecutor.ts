/**
 * AgentExecutor — Exécute une tâche agent individuelle
 *
 * Responsabilité unique : le cycle de vie d'exécution d'une tâche :
 * 1. Lecture des fichiers de contexte
 * 2. Construction du prompt (via PromptBuilder)
 * 3. Appel à reasoning_think
 * 4. Écriture des fichiers générés (via GeneratedFileWriter)
 * 5. Extraction du résultat (via ResultParser)
 * 6. **Parse et déclenchement des délégations autonomes (via DelegationParser)**
 * 7. Notification de progression (via ProgressNotifier)
 */
import { createHash } from "crypto";
import type { AgentTask } from "./types.js";
import { getAgentDefinitionOrThrow, hasAgent } from "./roles.js";
import { PromptBuilder } from "./PromptBuilder.js";
import { GeneratedFileWriter } from "./GeneratedFileWriter.js";
import { ResultParser } from "./ResultParser.js";
import { ProgressNotifier } from "./ProgressNotifier.js";
import { extractToolCalls, type AgentToolCall } from "./ToolCallParser.js";
import { AgentContextResolver } from "./AgentContextResolver.js";
import { AgentEvidenceEvaluator } from "./AgentEvidenceEvaluator.js";
import { DelegationDispatcher } from "./DelegationDispatcher.js";
import type { ToolExecutionState } from "./AgentExecutionTypes.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";
import { createLogger } from "../utils/logger.js";
import { WorkspaceState, type VerificationRecord, type VerificationIssue } from "./WorkspaceState.js";
import { AgentRepairLoop } from "./AgentRepairLoop.js";
import { telemetryService } from "../observability/TelemetryService.js";
import { setTelemetryContext, clearTelemetryContext } from "../utils/textGeneration.js";
// import { promptCache } from "../utils/promptCache.js"; // Prêt pour intégration future

const log = createLogger("AgentExecutor");

/**
 * Options transmises à un appel d'outil via le `SkillHandler`.
 * Le champ `signal` porte le kill-switch temps-réel : quand il est déclenché,
 * le `ToolRegistry` interrompt l'appel en cours et le propage au handler.
 */
export interface SkillHandlerOptions {
  signal?: AbortSignal;
}

/** Handler externe pour exécuter les actions d'un agent */
export type SkillHandler<TArgs = unknown, TResult = unknown> = (
  name: string,
  args: TArgs,
  options?: SkillHandlerOptions
) => Promise<TResult>;

/**
 * Erreur levée lorsqu'une tâche en cours est annulée par l'utilisateur.
 * Distincte des échecs d'exécution : `execute()` la capture pour produire
 * un statut "cancelled" plutôt que "failed".
 */
export class CancellationError extends Error {
  constructor(taskId: string) {
    super(taskId ? `Tâche ${taskId.slice(0, 8)} annulée par l'utilisateur` : "Tâche annulée par l'utilisateur");
    this.name = "CancellationError";
  }
}

/**
 * Marqueur interne : le signal d'annulation d'un appel d'outil s'est déclenché
 * pendant la course `callToolWithTimeout`. Converti en `CancellationError` par
 * le catch, jamais propagé tel quel au reste de l'exécuteur.
 */
class ToolAbortedSignal extends Error {
  constructor(toolName: string) {
    super(`Outil "${toolName}" interrompu (kill-switch)`);
    this.name = "ToolAbortedSignal";
  }
}

// Seuls les appels structurés correspondant à des skills du workspace sont
// exécutables. Un faux appel `bash` généré par le modèle n'est jamais exécuté.
export const EXECUTABLE_AGENT_TOOLS = new Set([
  "list_project_files",
  "read_project_file",
  "read_file_outline",
  "search_in_files",
  "analyze_project_file",
  "write_project_file",
  "modify_project_file",
  "apply_patch",
  "patch_project_file",
  "rename_project_file",
  "delete_project_file",
  "create_project_directory",
  "verify_file",
  "verify_typecheck",
  "verify_lint",
  "verify_format",
  "verify_full",
  "run_project_command",
  "quality_loop",
  "knowledge_build_context",
  "knowledge_semantic_search",
  "knowledge_search_entities",
  "knowledge_memory_search",
  "knowledge_memory_add",
  "knowledge_memory_list",
  "knowledge_impact_analyze",
  "knowledge_status",
  "knowledge_reindex",
  // AST Call-Graph (skill knowledge) — analyse d'appels et d'impact
  "knowledge_ast_callers",
  "knowledge_ast_callees",
  "knowledge_ast_call_chain",
  "knowledge_ast_file_inspect",
  // Automatisation & vision (skill automation) — capacités de l'agent vision
  "automation_navigate",
  "automation_click",
  "automation_type",
  "automation_extract",
  "automation_inspect",
  "automation_screenshot",
  "automation_analyze_screenshot",
  "automation_scroll",
  // Audit sécurité (skill security) — outils non mutatifs de l'agent `security`
  // et de la flotte d'audit. Réels et testés (server/skills/security/index.ts) ;
  // référencés par les capabilities de l'agent, donc requis dans l'allowlist.
  "security_audit",
  "security_sast",
  "security_sca",
  "reasoning_think",
  "agent_execute",
]);

export class AgentExecutor implements AgentTaskRunner {
  private skillHandler: SkillHandler | null = null;
  private promptBuilder = new PromptBuilder();
  private fileWriter: GeneratedFileWriter;
  private resultParser = new ResultParser();
  private contextResolver = new AgentContextResolver((toolName, args) => this.callToolWithTimeout(toolName, args));
  private evidenceEvaluator = new AgentEvidenceEvaluator(this.resultParser);
  private delegationDispatcher = new DelegationDispatcher();
  private notifier: ProgressNotifier;

  /** Compteur de tâches en cours par rôle */
  private runningCount: Map<string, number> = new Map();

  /**
   * Registre des contrôleurs d'annulation par tâche en cours.
   * Une entrée existe uniquement pendant l'exécution active (créée dans
   * `execute()`, retirée dans le `finally`). Permet une annulation
   * coopérative : les points de contrôle vérifient `signal.aborted`.
   */
  private abortControllers: Map<string, AbortController> = new Map();
  
  /**
   * Timeouts par outil (ms) - optimisé pour éviter les timeouts prématurés
   * Les outils LLM et d'analyse nécessitent plus de temps
   */
  private static readonly TOOL_TIMEOUTS: Record<string, number> = {
    // Outils de lecture rapide (10-15s)
    'list_project_files': 15_000,
    'read_project_file': 20_000,
    'read_file_outline': 15_000,
    
    // Outils de recherche (30-45s)
    'search_in_files': 45_000,
    'knowledge_semantic_search': 45_000,
    'knowledge_search_entities': 30_000,
    'knowledge_memory_search': 30_000,
    'knowledge_memory_add': 30_000,
    
    // Outils d'analyse complexe (60-90s)
    'analyze_project_file': 90_000,
    'knowledge_build_context': 90_000,
    'knowledge_impact_analyze': 90_000,
    
    // Outils de vérification (45-60s)
    'verify_file': 60_000,
    'verify_typecheck': 120_000,
    'verify_lint': 120_000,
    'verify_full': 180_000,
    'run_project_command': 120_000,
    
    // Outils d'écriture (30-60s)
    'write_project_file': 60_000,
    'apply_patch': 60_000,
    'patch_project_file': 60_000,
    'modify_project_file': 60_000,
    'create_project_directory': 30_000,
    'rename_project_file': 30_000,
    'delete_project_file': 30_000,
    
    // Outils de raisonnement LLM (90-180s)
    'reasoning_think': 180_000,
    'agent_execute': 180_000,
    
    // Timeout par défaut pour les outils inconnus
    'default': 120_000,
  };

  constructor(notifier: ProgressNotifier) {
    this.notifier = notifier;
    this.fileWriter = new GeneratedFileWriter(null);
  }

  /**
   * Appelle un outil avec un timeout spécifique basé sur le type d'outil.
   * Gère automatiquement les timeouts et les erreurs.
   */
  private async callToolWithTimeout(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<any> {
    // Kill-switch temps-réel : si la tâche est déjà annulée, ne pas lancer
    // l'outil du tout.
    if (signal?.aborted) {
      throw new CancellationError("");
    }

    const timeoutMs = AgentExecutor.TOOL_TIMEOUTS[toolName] ?? 
                     AgentExecutor.TOOL_TIMEOUTS['default'];
    
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Outil timeout après ${timeoutMs}ms`));
      }, timeoutMs);
    });

    // Course additionnelle contre l'annulation : dès que le signal se déclenche,
    // `callToolWithTimeout` rejette immédiatement (le ToolRegistry, qui a reçu
    // le même signal, interrompt de son côté le handler sous-jacent).
    let abortListener: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          abortListener = () => reject(new ToolAbortedSignal(toolName));
          signal.addEventListener("abort", abortListener, { once: true });
        })
      : null;

    try {
      const handler = this.skillHandler!;
      // Propagation du signal jusqu'au ToolRegistry.call via les options.
      const toolPromise = handler(toolName, args, { signal });
      
      // Course entre le tool, le timeout et l'annulation
      const racers: Promise<any>[] = [toolPromise, timeoutPromise];
      if (abortPromise) racers.push(abortPromise);
      return await Promise.race(racers);
    } catch (error) {
      // Annulation temps-réel : convertir en CancellationError pour que la
      // boucle d'exécution la traite comme un arrêt volontaire (statut
      // "cancelled"), et non comme un échec d'outil.
      if (error instanceof ToolAbortedSignal || signal?.aborted) {
        throw new CancellationError("");
      }
      // Si l'erreur vient du timeout, ajouter des infos contextuelles
      if ((error as Error).message.includes('timeout')) {
        throw new Error(`[${toolName}] ${(error as Error).message}`);
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }
  }

  setSkillHandler(handler: SkillHandler): void {
    this.skillHandler = handler;
    this.fileWriter.setSkillHandler(handler);
  }

  /**
   * Exécute un outil isolé via le skillHandler configuré (implémentation de
   * `AgentTaskRunner.runTool`). Permet à la boucle autonome de relancer une
   * vérification sans accéder au handler privé.
   */
  async runTool(name: string, args: Record<string, unknown>, options?: SkillHandlerOptions): Promise<unknown> {
    if (!this.skillHandler) throw new Error("SkillHandler non initialisé");
    return this.skillHandler(name, args, options);
  }

  /** Retourne le nombre de tâches en cours pour un rôle */
  getRunningCount(role: string): number {
    return this.runningCount.get(role) ?? 0;
  }

  /**
   * Demande l'annulation coopérative d'une tâche en cours d'exécution.
   * Déclenche l'`AbortController` associé : la boucle d'exécution s'arrête
   * au prochain point de contrôle (avant/après un appel d'outil ou un tour).
   *
   * @returns `true` si une tâche active correspondante a reçu le signal,
   *          `false` si aucune exécution n'est en cours pour cet id.
   */
  cancel(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (!controller) return false;
    if (controller.signal.aborted) return true;
    log.info(`[task:${taskId.slice(0, 8)}] 🛑 Annulation demandée — interruption à venir`);
    controller.abort();
    return true;
  }

  /** Indique si une tâche est actuellement en cours d'exécution (registre actif). */
  isRunning(taskId: string): boolean {
    return this.abortControllers.has(taskId);
  }

  /**
   * Lève une `CancellationError` si le signal d'annulation de la tâche a été
   * déclenché. Appelé aux points de contrôle de la boucle d'exécution.
   */
  private throwIfCancelled(taskId: string): void {
    if (this.abortControllers.get(taskId)?.signal.aborted) {
      throw new CancellationError(taskId);
    }
  }

  /**
   * Retourne l'`AbortSignal` de la tâche en cours, s'il existe. Propagé jusqu'au
   * `ToolRegistry.call` pour interrompre un outil long-running en temps réel.
   */
  private getTaskSignal(taskId?: string): AbortSignal | undefined {
    if (!taskId) return undefined;
    return this.abortControllers.get(taskId)?.signal;
  }

  /**
   * Exécute une tâche agent de bout en bout.
   * Modifie task.status, task.result, task.startedAt, task.completedAt in-place.
   */
  async execute(task: AgentTask): Promise<void> {
    const taskShortId = task.id.slice(0, 8);
    const role = task.role;

    // Vérifier si l'agent existe (statique ou dynamique)
    if (!hasAgent(role)) {
      log.error(`[task:${taskShortId}] Agent "${role}" non trouvé (statique ou dynamique)`);
      task.status = "failed";
      task.result = {
        success: false,
        outcome: "failed",
        summary: `Agent "${role}" introuvable`,
        error: `Agent "${role}" non enregistré. Utilisez l'Agent Builder pour créer et enregistrer cet agent d'abord.`,
        durationMs: 0,
      };
      this.notifier.notify(task, "failed");
      return;
    }

    const agent = getAgentDefinitionOrThrow(role);
    
    log.info(`[task:${taskShortId}] ▶ [${agent.name}] Démarrage tâche: "${task.title}"`);

    if (!this.skillHandler) {
      log.error(`[task:${taskShortId}] [${agent.name}] SkillHandler non initialisé`);
      task.status = "failed";
      task.result = {
        success: false,
        outcome: "failed",
        summary: "Aucun handler de skills configuré.",
        error: "SkillHandler non initialisé",
        durationMs: 0,
      };
      this.notifier.notify(task, "failed");
      return;
    }

    const startTime = Date.now();

    // Start OpenTelemetry span for this task
    const missionId = (task.context as any).missionId; // Extract if available
    telemetryService.startTaskSpan(task.id, task.role, task.title, missionId);
    
    // Set telemetry context for all model calls in this task
    setTelemetryContext({
      taskId: task.id,
      missionId,
      agentRole: task.role,
      toolName: 'agent_execute',
    });

    const notifyProgress = (current: number, label: string) => {
      this.notifier.notify(task, "progress", { current, total: 5, label });
    };

    // Enregistrer le contrôleur d'annulation pour cette exécution
    this.abortControllers.set(task.id, new AbortController());

    // Mettre à jour le statut
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.incrementRunning(task.role);
    this.notifier.notify(task, "started");

    log.info(`[task:${taskShortId}] 🟡 [${agent.name}] Rôle: ${task.role} | Titre: "${task.title}" | Fichiers contexte: ${task.context.files.length}`);

    try {
      // ── Étape 1: Découverte puis lecture bornée du contexte ──
      log.debug(`[task:${taskShortId}] [${agent.name}] 📂 Étape 1/5 — Résolution des fichiers de contexte...`);
      const contextFiles = await this.contextResolver.resolveContextFiles(task, agent.capabilities);
      const fileContents = await this.contextResolver.readContextFiles(contextFiles);
      notifyProgress(1, "Contexte résolu");
      log.debug(`[task:${taskShortId}] [${agent.name}] 📂 Contexte résolu — ${contextFiles.length} fichier(s) chargé(s): [${contextFiles.slice(0, 4).join(", ")}${contextFiles.length > 4 ? ` +${contextFiles.length - 4}` : ""}]`);

      // ── Étape 2: Construction du prompt ──
      log.debug(`[task:${taskShortId}] [${agent.name}] 📝 Étape 2/5 — Construction du prompt...`);
      const executionPrompt = this.promptBuilder.build(agent, task, fileContents);
      notifyProgress(2, "Prompt construit");
      log.debug(`[task:${taskShortId}] [${agent.name}] 📝 Prompt construit — ${executionPrompt.length} caractères`);

      // Point de contrôle d'annulation avant l'appel LLM coûteux
      this.throwIfCancelled(task.id);

      // ── Étape 3: Exécution directe par l'agent ──
      log.info(`[task:${taskShortId}] [${agent.name}] 🤖 Étape 3/5 — Exécution agent_execute (LLM)...`);
      log.debug(`[task:${taskShortId}] [${agent.name}] 📊 Budget: max ${AgentExecutor.EXECUTION_BUDGET.maxToolCalls} appels outils, ${AgentExecutor.EXECUTION_BUDGET.maxFilesRead} fichiers lus, ${Math.round(AgentExecutor.EXECUTION_BUDGET.maxContextChars / 1000)}k chars contexte`);
      const thinkResult = await this.callToolWithTimeout("agent_execute", {
        prompt: executionPrompt,
      }, this.getTaskSignal(task.id));

      const initialResultText = this.resultParser.normalizeResult(thinkResult);
      log.debug(`[task:${taskShortId}] [${agent.name}] 🤖 Réponse initiale: ${initialResultText.length} chars`);
      const toolExecution = await this.executeToolLoop(agent, executionPrompt, initialResultText, task);
      const resultText = toolExecution.resultText;
      notifyProgress(3, "Exécution agent terminée");
      
      // Logs de consommation des ressources
      const budgetUsage = {
        toolCalls: `${toolExecution.toolsExecuted.length}/${AgentExecutor.EXECUTION_BUDGET.maxToolCalls}`,
        filesRead: `${toolExecution.filesRead.length}/${AgentExecutor.EXECUTION_BUDGET.maxFilesRead}`,
        filesModified: toolExecution.filesModified.length,
        errors: toolExecution.errors.length,
      };
      log.info(`[task:${taskShortId}] [${agent.name}] 🔧 Boucle outils terminée — Outils: ${budgetUsage.toolCalls}, Fichiers lus: ${budgetUsage.filesRead}, Fichiers modifiés: ${budgetUsage.filesModified}, Erreurs: ${budgetUsage.errors}`);


      // ── Étape 4: Matérialisation et vérification des modifications ──
      log.debug(`[task:${taskShortId}] [${agent.name}] 💾 Étape 4/5 — Écriture et vérification des fichiers...`);
      const generatedWriteResult = await this.fileWriter.writeFromAgentOutput(task, resultText);
      notifyProgress(4, "Fichiers écrits et vérifiés");
      if (generatedWriteResult.written.length > 0) {
        log.debug(`[task:${taskShortId}] [${agent.name}] 💾 Fichiers écrits par FileWriter: [${generatedWriteResult.written.join(", ")}]`);
      }
      if (generatedWriteResult.errors.length > 0) {
        log.warn(`[task:${taskShortId}] [${agent.name}] 💾 Erreurs d'écriture FileWriter: ${generatedWriteResult.errors.map(e => `${e.path}: ${e.error}`).join(" | ")}`);
      }
      const generatedRegistration = await this.registerGeneratedWrites(generatedWriteResult.written, toolExecution);
      const writeResult = {
        written: [...new Set([...toolExecution.filesModified, ...generatedRegistration.verified])],
        errors: [...toolExecution.errors.map((error) => ({ path: "tool-call", error })), ...generatedWriteResult.errors, ...generatedRegistration.errors],
      };
      const durationMs = Date.now() - startTime;
      const evidence = this.evidenceEvaluator.collectEvidence(task, fileContents, writeResult, resultText, toolExecution);
      const incompleteReason = this.evidenceEvaluator.getIncompleteReason(task, resultText, evidence);
      const success = incompleteReason === null;

      // Extraire les opérations de mémoire projet des observations
      const memoryOperations = this.evidenceEvaluator.extractMemoryOperations(toolExecution.observations);
      notifyProgress(5, "Résultat évalué");

      log.debug(`[task:${taskShortId}] [${agent.name}] 🔍 Étape 5/5 — Évaluation des preuves d'exécution...`);
      log.debug(`[task:${taskShortId}] [${agent.name}] 🔍 Fichiers écrits+vérifiés: [${writeResult.written.join(", ") || "aucun"}] | Erreurs: ${writeResult.errors.length} | Vérification: ${success ? "PASS ✅" : "FAIL ❌"}`);

      // Un texte non exceptionnel ne suffit jamais : completed nécessite des preuves
      // observables collectées par l'exécuteur, pas seulement déclarée par le modèle.
      // outcome="blocked" → "failed" avec cause externe clairement identifiée
      // outcome="no_change" → "failed" (tâche write-required sans aucune modification)
      // outcome="success"/"partial" → "completed"
      const outcome = evidence.outcome;
      const isBlocked = outcome === "blocked";
      const isNoChange = outcome === "no_change";
      task.status = success ? "completed" : "failed";
      task.completedAt = new Date().toISOString();
      task.result = {
        success,
        outcome,
        ...(evidence.blockReason !== undefined && { blockReason: evidence.blockReason }),
        summary: this.resultParser.extractSummary(resultText),
        details: resultText,
        filesModified: writeResult.written,
        fileValidationErrors: writeResult.errors,
        suggestions: this.resultParser.extractSuggestions(resultText),
        error: incompleteReason ?? undefined,
        durationMs,
        evidence,
        ...(memoryOperations.length > 0 && { knowledgeMemoryOperations: memoryOperations }),
      };

      if (!success) {
        if (isBlocked) {
          log.warn(`[task:${taskShortId}] 🔶 [${agent.name}] Bloqué par erreur préexistante après ${(durationMs / 1000).toFixed(1)}s — ${evidence.blockReason ?? incompleteReason}`);
        } else if (isNoChange) {
          log.warn(`[task:${taskShortId}] 🟡 [${agent.name}] Aucune modification produite après ${(durationMs / 1000).toFixed(1)}s (${toolExecution.filesRead.length} fichier(s) lu(s), 0 modifié) — Cause: ${incompleteReason}`);
        } else {
          log.warn(`[task:${taskShortId}] ⚠️ [${agent.name}] Résultat incomplet après ${(durationMs / 1000).toFixed(1)}s — Cause: ${incompleteReason}`);
        }
        if (toolExecution.errors.length > 0) {
          log.warn(`[task:${taskShortId}] [${agent.name}] Erreurs outils: ${toolExecution.errors.slice(0, 3).join(" | ")}`);
        }
        this.notifier.notify(task, "failed");
        return;
      }

      if (memoryOperations.length > 0) {
        log.info(`[task:${taskShortId}] [${agent.name}] 🧠 ${memoryOperations.length} entrée(s) mémoire projet enregistrée(s)`);
      }

      // ── Étape 5: Les délégations ne partent qu'après une exécution vérifiée ──
      const subTaskIds = await this.delegationDispatcher.dispatchDelegations(task, resultText);
      if (subTaskIds.length > 0) {
        task.result!.delegatedSubTasks = subTaskIds;
        log.info(`[task:${taskShortId}] [${agent.name}] 🔀 ${subTaskIds.length} sous-tâche(s) déléguée(s): [${subTaskIds.map(id => id.slice(0, 8)).join(", ")}]`);
      }

      log.info(`[task:${taskShortId}] ✅ [${agent.name}] Terminé en ${(durationMs / 1000).toFixed(1)}s — ${writeResult.written.length} fichier(s) modifié(s) — ${task.result!.summary}`);
      this.notifier.notify(task, "completed");
      
      // End task span with success
      telemetryService.endTaskSpan(task.id, true);
      clearTelemetryContext();
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Annulation coopérative : statut distinct de l'échec.
      if (error instanceof CancellationError) {
        task.status = "cancelled";
        task.completedAt = new Date().toISOString();
        task.result = {
          success: false,
          outcome: "failed",
          summary: `Tâche annulée par l'utilisateur après ${(durationMs / 1000).toFixed(1)}s`,
          error: "cancelled_by_user",
          durationMs,
        };
        log.info(`[task:${taskShortId}] 🛑 [${agent.name}] Annulée après ${(durationMs / 1000).toFixed(1)}s`);
        telemetryService.endTaskSpan(task.id, false);
        clearTelemetryContext();
        this.notifier.notify(task, "failed");
        return;
      }

      task.status = "failed";
      task.completedAt = new Date().toISOString();
      task.result = {
        success: false,
        outcome: "failed",
        summary: `Échec de l'agent ${agent.name}`,
        error: (error as Error).message,
        durationMs,
      };

      log.error(`[task:${taskShortId}] ❌ [${agent.name}] Échec après ${(durationMs / 1000).toFixed(1)}s`);
      log.error(`[task:${taskShortId}] [${agent.name}] Erreur: ${(error as Error).message}`);
      if ((error as Error).stack) {
        log.debug(`[task:${taskShortId}] [${agent.name}] Stack: ${(error as Error).stack?.split("\n").slice(0, 4).join(" | ")}`);
      }
      
      // End task span with failure
      telemetryService.endTaskSpan(task.id, false);
      clearTelemetryContext();
      
      this.notifier.notify(task, "failed");
    } finally {
      this.abortControllers.delete(task.id);
      this.decrementRunning(task.role);
      log.debug(`[task:${taskShortId}] [${agent.name}] Concurrence: ${this.getRunningCount(task.role)} tâche(s) en cours pour ce rôle`);
    }
  }

    // ─── Helpers internes ───────────────────────────────────────────────────
  private static readonly MAX_TOOL_TURNS = 10;
  /** Taille maximale d’une observation cumulée envoyée au modèle suivant. */
  private static readonly MAX_OBSERVATION_CHARS = 80_000;
  /** Limite de sécurité par snapshot, supérieure aux composants UI usuels. */
  private static readonly MAX_FILE_CONTEXT_CHARS = 50_000;
  /** Limite maximale de fichiers dans le contexte incrémental */
  private static readonly MAX_FILES_IN_CONTEXT = 10;
  
  /** Budget de contraintes pour éviter la surconsommation de ressources */
  private static readonly EXECUTION_BUDGET = {
    /** Nombre maximum d'appels d'outils au total */
    maxToolCalls: 60,
    /** Nombre maximum de fichiers lus */
    maxFilesRead: 20,
    /** Caractères maximum pour le contexte cumulé (approximation de ~60k tokens) */
    maxContextChars: 240_000,
  };

  private async executeToolLoop(
    agent: { name: string; capabilities: string[] },
    executionPrompt: string,
    initialResultText: string,
    task: AgentTask
  ): Promise<ToolExecutionState> {
    const state: ToolExecutionState = {
      resultText: initialResultText,
      toolsExecuted: [],
      filesRead: [],
      filesModified: [],
      errors: [],
      observations: [],
      touchedFiles: new Set(),
      repairLoops: new Map(),
      blockedFiles: new Set(),
      workspace: new WorkspaceState(async (path: string) => {
        const result = await this.callToolWithTimeout("read_project_file", { path, full: true });
        if (result?.error || result?.status === "failed" || typeof result?.content !== "string") {
          throw new Error(this.formatToolFailure(result));
        }
        return result.content;
      }),
      fileSnapshots: new Map(),
      previousFileSnapshots: new Map(),
      newlyTouchedFiles: new Set(),
      consecutiveReadOnlyTurns: 0,
      noProgressAbort: false,
      preexistingErrors: [],
    };

    for (let turn = 0; turn < AgentExecutor.MAX_TOOL_TURNS; turn++) {
      // Point de contrôle d'annulation en tête de chaque tour de la boucle d'outils
      this.throwIfCancelled(task.id);

      const calls = extractToolCalls(state.resultText);
      if (calls.length === 0) {
        if (turn === 0) {
          log.debug(`[${agent.name}] Aucun appel d'outil détecté — réponse directe sans outil`);
        }
        break;
      }

      log.info(`[${agent.name}] 🔧 Tour ${turn + 1}/${AgentExecutor.MAX_TOOL_TURNS} — ${calls.length} appel(s) d'outil: [${calls.map(c => c.name).join(", ")}]`);

      // Forcer la synthèse uniquement au tout dernier tour
      const isLastAllowedTurn = turn >= AgentExecutor.MAX_TOOL_TURNS - 1;

      // Sauvegarder l'état précédent pour le diff incrémental
      const filesBeforeTurn = new Map(state.fileSnapshots);
      const newlyTouchedBeforeTurn = new Set(state.newlyTouchedFiles);

      const observationCountBefore = state.observations.length;
      await this.executeRequestedTools(agent, calls, state, task.id);
      const observations = state.observations
        .slice(observationCountBefore)
        .join("\n")
        .slice(-AgentExecutor.MAX_OBSERVATION_CHARS);

      // Identifier les fichiers nouvellement lus ou modifiés dans ce tour
      const currentFiles = new Set([...state.filesRead, ...state.filesModified]);
      const newlyTouchedThisTurn = new Set(
        [...currentFiles].filter(f => 
          !newlyTouchedBeforeTurn.has(f) || 
          (state.fileSnapshots.get(f) !== filesBeforeTurn.get(f))
        )
      );
      
      // Mettre à jour les fichiers nouvellement touchés
      newlyTouchedThisTurn.forEach(f => state.newlyTouchedFiles.add(f));

      // Construire le contexte des fichiers lus avec DIFF INCréMENTAL
      const limitedNewlyTouched = new Set([...newlyTouchedThisTurn].slice(0, AgentExecutor.MAX_FILES_IN_CONTEXT));
      const fileContextSection = this.buildIncrementalFileContext(
        state.fileSnapshots,
        limitedNewlyTouched
      );

      // Log pour le suivi des optimisations
      if (turn > 0 && newlyTouchedThisTurn.size > 0) {
        const totalFiles = state.fileSnapshots.size;
        const savings = totalFiles - newlyTouchedThisTurn.size;
        if (savings > 0) {
          log.info(`[${agent.name}] Tour ${turn + 1}: Optimisation diff incrémental - ${newlyTouchedThisTurn.size}/${totalFiles} fichiers envoyés en entier (économie: ~${savings} fichiers)`);
        }
      }

      // ── Budget enforcement ──────────────────────────────────────────────
      // Vérifier que l'agent ne dépasse pas les limites budgétaires
      const totalToolCalls = state.toolsExecuted.length;
      const totalFilesRead = state.filesRead.length;
      const totalContextChars = executionPrompt.length + fileContextSection.length + observations.length;
      
      const budgetViolations: string[] = [];
      if (totalToolCalls >= AgentExecutor.EXECUTION_BUDGET.maxToolCalls) {
        budgetViolations.push(`${totalToolCalls} appels d'outils (max: ${AgentExecutor.EXECUTION_BUDGET.maxToolCalls})`);
      }
      if (totalFilesRead >= AgentExecutor.EXECUTION_BUDGET.maxFilesRead) {
        budgetViolations.push(`${totalFilesRead} fichiers lus (max: ${AgentExecutor.EXECUTION_BUDGET.maxFilesRead})`);
      }
      if (totalContextChars >= AgentExecutor.EXECUTION_BUDGET.maxContextChars) {
        budgetViolations.push(`${Math.round(totalContextChars / 1000)}k caractères de contexte (max: ${Math.round(AgentExecutor.EXECUTION_BUDGET.maxContextChars / 1000)}k)`);
      }

      if (budgetViolations.length > 0) {
        log.warn(
          `[${agent.name}] ⚠️ Budget d'exécution dépassé au tour ${turn + 1}: ${budgetViolations.join(", ")}. ` +
          `L'agent doit conclure avec les informations disponibles.`
        );
        
        // Forcer un tour de synthèse finale
        const budgetPrompt = [
          executionPrompt.slice(0, 10_000), // Contexte initial réduit
          "",
          "## Budget d'exécution dépassé",
          `Après ${turn + 1} tours, tu as atteint les limites budgétaires :`,
          ...budgetViolations.map(v => `- ${v}`),
          "",
          "Tu DOIS maintenant conclure avec ce que tu as découvert.",
          "NE fais PLUS d'appels d'outils (read_project_file, search_in_files, etc.).",
          "Fournis un résumé de tes découvertes et recommandations.",
        ].join("\n");
        
        const budgetFollowUp = await this.callToolWithTimeout("agent_execute", { prompt: budgetPrompt }, this.getTaskSignal(task.id));
        state.resultText = this.resultParser.normalizeResult(budgetFollowUp);
        break;
      }

      // ── No-progress guard ───────────────────────────────────────────────
      // Mettre à jour le compteur de tours sans écriture.
      // Les tours purement verify_*/analyze_* ne comptent PAS — c'est du travail légitime
      // (l'agent analyse la situation avant d'écrire, pas une boucle infinie de lecture).
      // Les tours contenant une tentative d'écriture (isWriteCall) ne comptent PAS non plus,
      // même si la vérification a échoué — l'agent a progressé structurellement.
      const isVerifyOnlyTurn = calls.every(c =>
        c.name.startsWith("verify_") || c.name.startsWith("analyze_") || c.name === "reasoning_think"
      );
      const hadWriteAttemptThisTurn = calls.some(c =>
        ["write_project_file", "apply_patch", "patch_project_file", "modify_project_file"].includes(c.name)
      );
      if (state.filesModified.length === 0 && !isVerifyOnlyTurn && !hadWriteAttemptThisTurn) {
        state.consecutiveReadOnlyTurns++;
      } else if (state.filesModified.length > 0 || hadWriteAttemptThisTurn) {
        state.consecutiveReadOnlyTurns = 0;
      }

      // Seuil : 5 tours consécutifs sans écriture → interrompre.
      // Seuil relevé de 3 à 5 pour laisser le temps d'analyser avant d'agir.
      // Ne s'applique QUE pour les rôles qui doivent produire des modifications.
      const NO_PROGRESS_THRESHOLD = 5;
      const isWriteRequiredForGuard = ["coder", "refactor", "debugger", "writer", "formatter", "proofreader", "translator"].includes(task.role)
        && !this.evidenceEvaluator.isAnalysisOnlyTask(task);
      if (
        isWriteRequiredForGuard &&
        !isLastAllowedTurn &&
        state.consecutiveReadOnlyTurns >= NO_PROGRESS_THRESHOLD &&
        state.filesModified.length === 0
      ) {
        log.warn(
          `[${agent.name}] 🚫 No-progress guard déclenché après ${state.consecutiveReadOnlyTurns} tours sans écriture ` +
          `(${state.filesRead.length} fichier(s) lu(s), 0 modifié). Interruption de la boucle.`
        );
        // Pattern restreint aux vraies erreurs TypeScript/import — exclut "introuvable" générique
        // qui peut venir d'un list_project_files sur un dossier inexistant (erreur outil, pas compile).
        const compileErrorPattern = /(?:cannot find module|module not found|error ts\d{3,4}:?|ts\d{4,}:)/i;
        const modifiedOrAttempted = state.touchedFiles.size > 0;
        if (modifiedOrAttempted && (compileErrorPattern.test(state.observations.join("\n")) || compileErrorPattern.test(state.resultText))) {
          state.noProgressAbort = true;
          const blockedObs = state.observations.find(o => compileErrorPattern.test(o));
          if (blockedObs) state.preexistingErrors.push(blockedObs.slice(0, 300));
        } else {
          state.noProgressAbort = true;
        }
        // Forcer un dernier tour de synthèse
        const forcePrompt = [
          executionPrompt,
          fileContextSection,
          "",
          "## Observations d'exécution (tour " + (turn + 1) + ")",
          observations,
          "",
          `⛔ INTERRUPTION FORCÉE : Après ${state.consecutiveReadOnlyTurns} tours de lecture sans aucune modification, ` +
          `l'exécution est interrompue. Tu DOIS maintenant soit :\n` +
          `1. Émettre immédiatement un modify_project_file / patch_project_file / write_project_file si tu peux modifier des fichiers.\n` +
          `2. Déclarer explicitement pourquoi tu es bloqué avec "## Blocage\nCause: <raison précise>" si une erreur externe t'en empêche.\n` +
          `N'émet plus de tool_calls de lecture (read_project_file, search_in_files, list_project_files).`,
        ].join("\n");
        const forcedFollowUp = await this.callToolWithTimeout("agent_execute", { prompt: forcePrompt }, this.getTaskSignal(task.id));
        state.resultText = this.resultParser.normalizeResult(forcedFollowUp);

        // ── Exécuter les tool_calls d'écriture présents dans la réponse forcée ──
        // L'agent répond souvent avec un write_project_file après le forçage.
        // Sans cette étape, le tool_call reste en texte brut et n'est jamais appliqué.
        const pendingWriteCalls = extractToolCalls(state.resultText).filter(c =>
          ["write_project_file", "modify_project_file", "patch_project_file", "apply_patch"].includes(c.name)
        );
        if (pendingWriteCalls.length > 0) {
          log.info(`[${agent.name}] ⚡ Exécution de ${pendingWriteCalls.length} outil(s) d'écriture issus de la réponse forcée`);
          await this.executeRequestedTools(agent, pendingWriteCalls, state, task.id);
          if (state.filesModified.length > 0) {
            state.noProgressAbort = false;
            log.info(`[${agent.name}] ✅ ${state.filesModified.length} fichier(s) modifié(s) après exécution forcée`);
          }
        }
        break;
      }

      // ── Stall note progressive (write-required uniquement) ──────────────
      const readsSinceWrite = state.filesRead.length;
      const stallNote = (isWriteRequiredForGuard && state.consecutiveReadOnlyTurns >= 2 && state.filesModified.length === 0)
        ? `\n💡 Tour ${state.consecutiveReadOnlyTurns}/${NO_PROGRESS_THRESHOLD} sans modification. ` +
          `Tu as lu ${readsSinceWrite} fichier(s). Si cette tâche requiert une modification, ` +
          `émets MAINTENANT un modify_project_file, patch_project_file ou write_project_file. ` +
          `Après ${NO_PROGRESS_THRESHOLD} tours sans écriture, l'exécution sera interrompue.`
        : "";

      const synthesisInstruction = isLastAllowedTurn
        ? "⚠️ C'est ton dernier tour d'appels d'outils. Tu DOIS maintenant produire le résultat final. Ne demande plus d'appels d'outils."
        : `Poursuis la tâche avec ces observations. Les appels bash/shell et les chemins /workspace ne sont pas disponibles.\nUtilise les skills structurés autorisés pour appliquer les changements (modify_project_file / patch_project_file / write_project_file) puis verify_file.\nPour apply_patch, fournis un diff unifié complet avec les lignes \`---\`, \`+++\` et \`@@\`.\nUne fois les actions exécutées et vérifiées, rends le résultat final avec la section ## Résultats vérifiés.\nNe renvoie jamais un plan seul ni un JSON tool_calls sans résultat final.${stallNote}`;

      // Ne remplacer que le snapshot du fichier dans le followUp —
      // le prompt initial (contrat d'exécution, liste des outils) doit toujours être présent.
      // Pour les tours suivants, on injecte uniquement la section fichier + observations.
      const followUpPrompt = [
        executionPrompt,
        fileContextSection,
        "",
        "## Observations d'exécution (tour " + (turn + 1) + ")",
        observations,
        "",
        synthesisInstruction,
      ].join("\n");
      const followUp = await this.callToolWithTimeout("agent_execute", {
        prompt: followUpPrompt,
      }, this.getTaskSignal(task.id));
      state.resultText = this.resultParser.normalizeResult(followUp);
    }

    // Si on sort de la boucle à MAX_TOOL_TURNS et que le résultat contient encore des tool_calls,
    // logger un avertissement — le modèle est en boucle
    if (extractToolCalls(state.resultText).length > 0) {
      log.warn(`[${agent.name}] Boucle de tool calls interrompue après ${AgentExecutor.MAX_TOOL_TURNS} tours. Forçage de synthèse.`);
      state.errors.push(`Boucle de tool calls interrompue après ${AgentExecutor.MAX_TOOL_TURNS} tours.`);
    }

    return state;
  }

  /**
   * Construit le contexte des fichiers avec diff incrémental.
   * Seuls les fichiers nouvellement lus ou modifiés sont envoyés en entier.
   * Les autres sont référencés avec leur hash SHA-256 pour vérification.
   */
  private buildIncrementalFileContext(
    currentSnapshots: Map<string, string>,
    newlyTouchedFiles: Set<string>
  ): string {
    if (currentSnapshots.size === 0) {
      return "";
    }

    const parts: string[] = [
      "",
      "## Fichiers en mémoire (état courant autoritaire pour apply_patch)",
    ];

    // Fichiers nouvellement lus ou modifiés - envoyer le contenu complet
    const newOrModifiedFiles: string[] = [];
    newlyTouchedFiles.forEach(filePath => {
      const content = currentSnapshots.get(filePath);
      if (content) {
        const truncated = content.length > AgentExecutor.MAX_FILE_CONTEXT_CHARS
          ? content.slice(0, AgentExecutor.MAX_FILE_CONTEXT_CHARS) + `
... [tronqué par sécurité — ${content.split("\n").length} lignes au total. Relis la section manquante avec read_project_file(full:true) ou startLine/endLine]`
          : content;
        newOrModifiedFiles.push(`### ${filePath} (NOUVEAU/MODIFIÉ)
\`\`\`
${truncated}
\`\`\``);
      }
    });

    // Fichiers existants mais non modifiés - juste référencer avec hash
    const unchangedFiles: string[] = [];
    currentSnapshots.forEach((content, filePath) => {
      if (!newlyTouchedFiles.has(filePath)) {
        const hash = this.computeContentHash(content);
        unchangedFiles.push(`### ${filePath} (inchangé - SHA-256: ${hash.slice(0, 16)}...)`);
      }
    });

    if (newOrModifiedFiles.length > 0) {
      parts.push("### Fichiers nouvellement lus ou modifiés :");
      parts.push(...newOrModifiedFiles);
    }

    if (unchangedFiles.length > 0) {
      parts.push("");
      parts.push("### Fichiers inchangés (référence par hash) :");
      parts.push(...unchangedFiles);
    }

    parts.push("");
    
    // Ajouter une note explicative pour le modèle
    if (unchangedFiles.length > 0 && newlyTouchedFiles.size > 0) {
      parts.push(
        `✨ **Optimisation active** : Seuls les fichiers modifiés sont inclus en entier. ` +
        `Les fichiers inchangés sont référencés par leur hash. ` +
        `Utilise read_project_file pour relire un fichier spécifique si nécessaire.`
      );
      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * Calcul un hash simple pour le contenu (pour référence)
   */
  private computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /** Sérialise une observation sans tronquer le contenu des lectures complètes. */
  private formatToolObservation(toolName: string, result: unknown): string {
    const serialized = JSON.stringify(result) ?? String(result);
    const limit = ["read_project_file", "read_file_outline"].includes(toolName)
      ? AgentExecutor.MAX_FILE_CONTEXT_CHARS
      : 8_000;
    const suffix = serialized.length > limit
      ? `\n... [observation tronquée à ${limit} caractères]`
      : "";
    return `- ${toolName}: succès — ${serialized.slice(0, limit)}${suffix}`;
  }

  private formatToolFailure(result: unknown): string {
    if (!result) return "outil sans résultat";
    const resultObj = result as Record<string, unknown>;
    const phases = [resultObj.typecheck ?? resultObj.tsc, resultObj.lint, resultObj.test].filter(Boolean);
    const details = phases.flatMap((phase: unknown) => {
      const phaseObj = phase as Record<string, unknown>;
      return [
        phaseObj.output,
        phaseObj.stdout,
        phaseObj.stderr,
        phaseObj.errors,
        phaseObj.violations,
      ].flatMap((value: unknown) => {
        if (Array.isArray(value)) {
          return value.map((item: unknown) => {
            if (typeof item === "string") return item;
            const itemObj = item as Record<string, unknown>;
            return itemObj?.message ?? JSON.stringify(item);
          });
        }
        return value ? [String(value)] : [];
      });
    });
    const issues = Array.isArray(resultObj.allIssues)
      ? (resultObj.allIssues as Array<Record<string, unknown>>).map((issue) => 
          `${issue.file ?? "global"}${issue.line ? `:${issue.line}` : ""} — ${issue.message ?? JSON.stringify(issue)}`)
      : [];
    const streams = [
      resultObj.stdout,
      resultObj.stderr,
      resultObj.message,
      resultObj.error,
      ...details,
      ...issues
    ]
      .filter(Boolean)
      .join("\n");
    return streams.slice(0, 5000) || `outil en échec (code ${(resultObj as { exitCode?: string }).exitCode ?? "inconnu"})`;
  }

  private async refreshFileSnapshot(
    requestedPath: string,
    state: ToolExecutionState,
    reason: string,
    afterWrite = false,
  ): Promise<boolean> {
    const file = await state.workspace.reread(requestedPath, afterWrite ? "write" : "read");
    state.toolsExecuted.push("read_project_file");
    if (file.status === "error" || !file.exists || typeof file.content !== "string") {
      state.fileSnapshots.delete(requestedPath);
      state.observations.push(`- read_project_file ${requestedPath}: échec pendant le rafraîchissement ${reason} — ${file.errors.at(-1) ?? "contenu indisponible"}`);
      return false;
    }
    state.filesRead.push(requestedPath);
    state.fileSnapshots.set(requestedPath, file.content);
    state.observations.push(`- read_project_file ${requestedPath}: instantané courant SHA-256 ${file.contentHash.slice(0, 12)} rafraîchi ${reason}; il remplace tout contenu initial.`);
    return true;
  }

  private async registerGeneratedWrites(paths: string[], state: ToolExecutionState): Promise<{ verified: string[]; errors: { path: string; error: string }[] }> {
    const verified: string[] = []; const errors: { path: string; error: string }[] = [];
    for (const filePath of [...new Set(paths)]) {
      state.touchedFiles.add(filePath);
      if (!await this.refreshFileSnapshot(filePath, state, "après la génération", true)) { errors.push({ path: filePath, error: "Relecture post-écriture impossible." }); continue; }
      const verification = await this.callToolWithTimeout("verify_file", { path: filePath });
      state.toolsExecuted.push("verify_file");
      const record = verification?.verificationRecord;
      if (this.isVerificationRecord(record)) state.workspace.recordVerification(filePath, record);
      else state.workspace.markError(filePath, "verify_file n'a pas retourné de preuve hashée structurée.");
      await this.refreshFileSnapshot(filePath, state, "après la vérification générée");
      const file = state.workspace.get(filePath);
      if (verification?.ok === true && verification?.status === "success" && file?.status === "verified" && file.verifiedHash === file.contentHash) { verified.push(filePath); state.filesModified.push(filePath); }
      else errors.push({ path: filePath, error: this.formatToolFailure(verification) });
    }
    return { verified, errors };
  }

  private repairInstruction(state: ToolExecutionState, path: string, issues: unknown, patch?: string): string {
    const normalized = Array.isArray(issues) && issues.length > 0
      ? issues as VerificationIssue[]
      : [{ type: "execution", file: path, line: null, column: null, severity: "error" as const, rule: "tool-result", message: "Écriture ou vérification non confirmée." }];
    const key = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const loop = state.repairLoops.get(key) ?? new AgentRepairLoop();
    state.repairLoops.set(key, loop);
    const file = state.workspace.get(path);
    const directive = loop.assess({ issues: normalized, currentHash: file?.contentHash, currentVersion: file?.version, patch });
    if (directive.action === "stop") { state.blockedFiles.add(key); state.errors.push(`repair(${path}): ${directive.reason}`); }
    return directive.requiredAction;
  }

  private isVerificationRecord(value: unknown): value is VerificationRecord {
    const record = value as Partial<VerificationRecord> | undefined;
    return Boolean(record && typeof record.contentHash === "string" && typeof record.hashBefore === "string" && typeof record.hashAfter === "string" && typeof record.ok === "boolean" && ["success", "failed", "stale"].includes(record.status ?? ""));
  }

  private async executeRequestedTools(
    agent: { name: string; capabilities: string[] },
    calls: AgentToolCall[],
    state: ToolExecutionState,
    taskId?: string
  ): Promise<void> {
    const seenCalls = new Set<string>();
    const writePathsHandled = new Set<string>();

    for (const call of calls) {
      // Interruption coopérative entre chaque appel d'outil d'un même tour
      if (taskId) this.throwIfCancelled(taskId);

      const callSignature = `${call.name}:${JSON.stringify(call.parameters)}`;
      if (seenCalls.has(callSignature)) {
        state.observations.push(`- ${call.name}: appel identique ignoré dans ce tour; l'observation du premier appel est suffisante.`);
        continue;
      }
      seenCalls.add(callSignature);

      if (!EXECUTABLE_AGENT_TOOLS.has(call.name) || !agent.capabilities.includes(call.name)) {
        // Tenter une résolution partielle (le modèle tronque parfois les noms)
        // Stratégie : 1) préfixe direct, 2) suppression de _project_file côté outil,
        // 3) suppression de _project_file côté appel (ex: verify_project_file → verify_file)
        const callWithoutProject = call.name.replace("_project_file", "_file");
        const callBase = call.name.replace("_project_file", "");
        const resolved = [...EXECUTABLE_AGENT_TOOLS].find(
          (tool) =>
            tool.startsWith(call.name) ||
            call.name.startsWith(tool.replace("_project_file", "")) ||
            tool === callWithoutProject ||
            tool === callBase
        );
        if (resolved && agent.capabilities.includes(resolved)) {
          call.name = resolved;
        } else {
          log.warn(`[${agent.name}] Appel d'outil refusé: ${call.name}`);
          state.observations.push(`- ${call.name}: refusé. Outil non autorisé pour ${agent.name}; bash/shell ne sont jamais exécutés.`);
          continue;
        }
      }

      const requestedPath = typeof call.parameters.path === "string" ? call.parameters.path : undefined;
      const isWriteCall = requestedPath && ["write_project_file", "apply_patch", "patch_project_file", "modify_project_file"].includes(call.name);
      const pathKey = requestedPath?.replace(/\\/g, "/").replace(/^\.\//, "");

      // ── Validations préventives pour éviter les erreurs courantes ──────────────────
      
      // 1. Vérifier que search_in_files a un chemin valide
      if (call.name === "search_in_files" && requestedPath) {
        // Vérification simple : le chemin ne doit pas contenir de caractères problématiques
        // et ne doit pas être visiblement invalide
        const invalidPaths = ["node_modules", ".git", ".Leanna/sandbox/components", ".Leanna/sandbox/src"];
        if (invalidPaths.some(p => requestedPath.includes(p))) {
          state.observations.push(`- search_in_files: Le chemin "${requestedPath}" pointe vers un répertoire invalide ou inexistant. Essaye un chemin valide comme "server/" ou "src/".`);
          log.warn(`[${agent.name}] search_in_files ignoré: chemin invalide "${requestedPath}"`);
          continue;
        }
        
        // Vérifier que le chemin n'est pas vide ou juste des espaces
        if (!requestedPath.trim() || requestedPath === ".") {
          // C'est OK, recherche à la racine
        } else if (!/^[a-zA-Z0-9_\\\/\-\.]+$/.test(requestedPath.replace(/\\/g, "/"))) {
          state.observations.push(`- search_in_files: Le chemin "${requestedPath}" contient des caractères invalides.`);
          log.warn(`[${agent.name}] search_in_files ignoré: caractères invalides dans "${requestedPath}"`);
          continue;
        }
      }
      
      // 2. Vérifier que read_file_outline pointe vers un fichier (pas un répertoire)
      if (call.name === "read_file_outline" && requestedPath) {
        // Un fichier doit avoir une extension
        const fileExtensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".scss", ".html", ".vue", ".py", ".rs", ".go", ".yaml", ".yml"];
        const hasExtension = fileExtensions.some(ext => requestedPath.endsWith(ext));
        
        if (!hasExtension) {
          // Cela ressemble à un répertoire
          state.observations.push(`- read_file_outline: "${requestedPath}" semble être un répertoire. Utilise list_project_files pour lister son contenu, ou read_project_file pour lire un fichier spécifique.`);
          log.warn(`[${agent.name}] read_file_outline ignoré: "${requestedPath}" semble être un répertoire (pas d'extension)`);
          continue;
        }
      }
      
      // 3. Vérifier que modify_project_file a un chemin valide
      if (call.name === "modify_project_file" && requestedPath) {
        const fileExtensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".scss", ".html", ".vue", ".py", ".rs", ".go", ".yaml", ".yml", ".txt", ".tsv", ".csv"];
        const hasExtension = fileExtensions.some(ext => requestedPath.endsWith(ext));
        
        if (!hasExtension) {
          state.observations.push(`- modify_project_file: "${requestedPath}" semble être un répertoire. Utilise un chemin de fichier valide avec une extension.`);
          log.warn(`[${agent.name}] modify_project_file ignoré: "${requestedPath}" semble être un répertoire`);
          continue;
        }
      }

      // Tous les patches d'une réponse sont produits à partir du même état. Après une
      // écriture, tout second patch du même fichier serait nécessairement obsolète.
      if (isWriteCall && pathKey && writePathsHandled.has(pathKey)) {
        state.observations.push(`- ${call.name} ${requestedPath}: écriture différée. Une écriture de ce fichier a déjà été traitée ce tour; attends l'instantané rafraîchi avant un nouveau patch.`);
        continue;
      }
      if (isWriteCall && pathKey) writePathsHandled.add(pathKey);
      if (isWriteCall && pathKey && state.blockedFiles.has(pathKey)) {
        state.observations.push(`- ${call.name} ${requestedPath}: écriture bloquée par le diagnostic de non-progression; signaler le bloqueur au lieu de répéter le patch.`);
        continue;
      }

      try {
        const argSummary = JSON.stringify(call.parameters).slice(0, 150);
        log.debug(`[${agent.name}] ⚙️  ${call.name}(${argSummary})`);
        const toolStart = Date.now();
        const result = await this.callToolWithTimeout(call.name, call.parameters, this.getTaskSignal(taskId));
        const toolMs = Date.now() - toolStart;
        log.debug(`[${agent.name}] ⚙️  ${call.name} → ${result?.status ?? (result?.ok === false ? "failed" : "ok")} (${toolMs}ms)`);
        state.toolsExecuted.push(call.name);
        if (isWriteCall && requestedPath) state.touchedFiles.add(requestedPath);
        if (result?.error || result?.status === "failed") {
          const error = this.formatToolFailure(result);
          if (isWriteCall && requestedPath) {
            await this.refreshFileSnapshot(requestedPath, state, "après le refus d'écriture");
            const instruction = this.repairInstruction(state, requestedPath, result?.allIssues, JSON.stringify(call.parameters));
            state.observations.push(`- ${call.name} ${requestedPath}: échec — ${error}\n${instruction}`);
          } else {
            // Pour les outils non-écriture (read, list, search, verify d'exploration),
            // l'échec est une observation de travail transmise au modèle pour qu'il s'ajuste.
            state.observations.push(`- ${call.name}: échec — ${error}`);
          }
          continue;
        }

        if (requestedPath && ["read_project_file", "read_file_outline"].includes(call.name)) {
          state.filesRead.push(requestedPath);
          if (call.name === "read_project_file" && typeof result?.content === "string" && result?.status === "success") {
            state.workspace.observe(requestedPath, result.content);
            state.fileSnapshots.set(requestedPath, result.content);
          }
        }
        if (isWriteCall && requestedPath) {
          if (!await this.refreshFileSnapshot(requestedPath, state, "après l'écriture", true)) {
            state.workspace.markError(requestedPath, "Impossible de relire le fichier réellement écrit.");
            state.errors.push(`${call.name}(${requestedPath}): relecture post-écriture impossible.`);
            continue;
          }

          const verification = await this.callToolWithTimeout("verify_file", { path: requestedPath }, this.getTaskSignal(taskId));
          state.toolsExecuted.push("verify_file");
          const record = verification?.verificationRecord;
          if (!this.isVerificationRecord(record)) state.workspace.markError(requestedPath, "verify_file n'a pas retourné de preuve hashée structurée.");
          else state.workspace.recordVerification(requestedPath, record);
          await this.refreshFileSnapshot(requestedPath, state, "après la vérification");
          const file = state.workspace.get(requestedPath);
          const verified = Boolean(record && this.isVerificationRecord(record) && verification?.status === "success" && verification?.ok === true && file?.status === "verified" && file.verifiedHash === file.contentHash);
          if (!verified) {
            // ── Fallback : erreurs préexistantes ─────────────────────────────────
            // Si le fichier a physiquement changé (hashBefore !== hashAfter dans le record
            // ou fileChanged === true retourné par verify_file), le patch a bien été appliqué.
            // Les erreurs de vérification peuvent être dues à des erreurs TypeScript/lint
            // préexistantes qui n'ont pas été introduites par ce patch.
            // Dans ce cas : on comptabilise le fichier comme modifié, mais on propage
            // les issues comme avertissements pour que l'agent puisse les corriger.
            const patchActuallyApplied = Boolean(
              verification?.fileChanged === true ||
              (this.isVerificationRecord(record) && record.hashBefore !== record.hashAfter)
            );
            if (patchActuallyApplied) {
              // Enregistrer les erreurs détectées comme potentiellement préexistantes
              const allIssues = verification?.allIssues ?? record?.allIssues ?? [];
              const issuesSummary = allIssues
                .filter((i: any) => i.severity === "error" || i.severity === "critical")
                .map((i: any) => `${i.rule ?? i.type}: ${i.message}`)
                .slice(0, 3)
                .join("; ");
              const warningNote = issuesSummary
                ? `⚠️ Patch appliqué (fichier modifié sur disque) mais des erreurs subsistent — probablement préexistantes : ${issuesSummary}. Corrige-les ou déclare un blocage si elles sont hors périmètre.`
                : `⚠️ Patch appliqué (fichier modifié sur disque) mais la vérification a échoué. Vérifie les erreurs et corrige-les si elles sont dans le périmètre de la tâche.`;
              state.observations.push(`- ${call.name} ${requestedPath}: ${warningNote}`);
              state.preexistingErrors.push(`${requestedPath}: ${issuesSummary || "vérification échouée après patch"}`);
              state.filesModified.push(requestedPath);
              // Ne pas continue : le patch compte, l'observation est déjà poussée
            } else {
              const error = this.formatToolFailure(verification);
              const instruction = this.repairInstruction(state, requestedPath, verification?.allIssues ?? record?.allIssues, JSON.stringify(call.parameters));
              state.observations.push(`- ${call.name} ${requestedPath}: écrit mais vérification non courante/échouée — ${error}\n${instruction}`);
              continue;
            }
          } else {
            state.filesModified.push(requestedPath);
          }
        }

        state.observations.push(this.formatToolObservation(call.name, result));
      } catch (error) {
        const message = (error as Error).message;
        state.errors.push(`${call.name}: ${message}`);
        state.observations.push(`- ${call.name}: erreur — ${message}`);
      }
    }
  }

  private incrementRunning(role: string): void {
    this.runningCount.set(role, (this.runningCount.get(role) ?? 0) + 1);
  }

  private decrementRunning(role: string): void {
    const current = this.runningCount.get(role) ?? 1;
    this.runningCount.set(role, Math.max(0, current - 1));
  }
}
