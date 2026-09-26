/**
 * AgentRuntime (agentique) — La boucle qui transforme Leanna en agent.
 *
 * Remplace le flux linéaire « User → Router → Agent → LLM → Response » par une
 * vraie boucle :
 *
 *   User → Intent/Task Analyzer → Planner → Execution Engine
 *          ┌──────────────────────────────────────────────┐
 *          │  Tool call → Observation → Reasoning →        │
 *          │  Next action → Verification                   │
 *          └──────────────────────────────────────────────┘
 *          → Finalizer → User
 *
 * Différence fondamentale avec l'ancien `AgentExecutor` : ici l'agent reçoit
 * RÉELLEMENT ses outils. On lit ses `capabilities` déclarées, on les résout
 * contre le `ToolRegistry`, on expose la liste au modèle, et on exécute chaque
 * appel via `registry.call()` (qui applique permissions, dry-run, timeout et
 * métriques). Les `capabilities` ne sont plus décoratives.
 *
 * Toute la boucle est bornée par un `AgentBudget` configurable :
 * maxIterations, maxToolCalls, maxExecutionTimeMs, maxRetries, maxCost.
 */

import { randomUUID } from "crypto";
import type { ToolRegistry } from "../ToolRegistry.js";
import type { EventBus } from "../EventBus.js";
import type { ToolDeclaration } from "../types.js";
import { getAgentDefinitionOrThrow, hasAgent } from "../../agents/roles.js";
import type { AgentDefinition } from "../../agents/types.js";
import { extractToolCalls } from "../../agents/ToolCallParser.js";
import { WorkspaceState, type VerificationRecord } from "../../agents/WorkspaceState.js";
import { AgentRepairLoop, type RepairDirective } from "../../agents/AgentRepairLoop.js";
import { generateText, type GenerateTextResult } from "../../utils/textGeneration.js";
import { createLogger } from "../../utils/logger.js";
import {
  resolveAgentTools,
  buildToolSection,
  buildBudgetSection,
  buildObservationHistory,
} from "./ToolPromptBuilder.js";
import {
  DEFAULT_AGENT_BUDGET,
  emptyBudgetUsage,
  normalizeBudget,
  type AgentBudget,
  type AgentError,
  type AgentPhase,
  type AgentResult,
  type AgentTask,
  type BudgetUsage,
  type FinalResult,
  type IAgentRuntime,
  type Observation,
  type Plan,
  type PlanStep,
  type Recovery,
  type ToolCallOutcome,
  type ToolKind,
  type Verification,
} from "./types.js";

const log = createLogger("AgenticRuntime");

/** Permissions à effet de bord : leur présence prouve qu'un fichier a été touché. */
const WRITE_TOOLS = new Set([
  "write_project_file",
  "modify_project_file",
  "patch_project_file",
  "apply_patch",
  "rename_project_file",
  "delete_project_file",
  "create_project_directory",
]);

/** Outils de vérification exécutables pour valider une étape. */
const VERIFY_TOOLS = ["verify_full", "verify_typecheck", "verify_lint", "verify_file"];
const VERIFY_TOOL_SET = new Set([...VERIFY_TOOLS, "verify_format", "quality_loop", "run_project_command"]);

/** Outils de lecture/exploration (comptabilisés en phase discovery). */
const READ_TOOLS = new Set([
  "read_project_file",
  "read_file_outline",
  "list_project_files",
  "search_in_files",
  "analyze_project_file",
  "knowledge_build_context",
  "knowledge_semantic_search",
  "knowledge_search_entities",
  "knowledge_impact_analyze",
  "knowledge_ast_callers",
  "knowledge_ast_callees",
  "knowledge_ast_call_chain",
  "knowledge_ast_file_inspect",
]);

/** Outils dont le résultat est mis en cache dans le contexte d'exécution. */
const CACHEABLE_TOOLS = new Set([
  "read_project_file",
  "read_file_outline",
  "list_project_files",
  "search_in_files",
  "analyze_project_file",
]);

const MAX_HISTORY_CHARS = 60_000;
const MAX_RESULT_CHARS = 4_000;

/** Classe un outil par nature, pour la comptabilité séparée et la règle d'arrêt. */
function classifyTool(name: string): ToolKind {
  if (WRITE_TOOLS.has(name)) return "write";
  if (VERIFY_TOOL_SET.has(name)) return "verify";
  if (READ_TOOLS.has(name)) return "read";
  return "other";
}

/**
 * Signature du générateur de texte. En production c'est `generateText`
 * (Gemini/OpenRouter). Un modèle DÉTERMINISTE peut être injecté pour tester la
 * chaîne agentique complète sans réseau ni clés API (voir mission-harness).
 */
export type GenerateTextFn = typeof generateText;

export interface AgenticRuntimeDeps {
  registry: ToolRegistry;
  events?: EventBus;
  /** Budget par défaut (fusionné avec le budget de la tâche). */
  budget?: Partial<AgentBudget>;
  /**
   * Générateur de texte injectable. Défaut : `generateText` (provider réel).
   * Permet d'injecter un modèle déterministe pour les tests de bout en bout.
   */
  model?: GenerateTextFn;
}

export class AgentRuntime implements IAgentRuntime {
  private readonly registry: ToolRegistry;
  private readonly events?: EventBus;
  private readonly defaultBudget: AgentBudget;
  private readonly model: GenerateTextFn;

  // État par exécution (reconstruit à chaque run pour rester réentrant).
  private session: RunSession | null = null;

  constructor(deps: AgenticRuntimeDeps) {
    this.registry = deps.registry;
    this.events = deps.events;
    this.defaultBudget = { ...DEFAULT_AGENT_BUDGET, ...deps.budget };
    this.model = deps.model ?? generateText;
  }

  /**
   * Exécute un outil ponctuel via le ToolRegistry (permissions, dry-run,
   * timeout, métriques appliqués). Utilisé hors boucle par les appelants qui
   * ont besoin d'une vérification isolée (ex: AutonomousLoop.verifyFile).
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.registry.call(name, args);
  }

  // ─── run : orchestration complète ─────────────────────────────────────────

  async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = Date.now();
    const taskId = task.id ?? randomUUID();
    // Le budget est normalisé : maxToolCalls = somme des quotas de phase absolus.
    const budget: AgentBudget = normalizeBudget({ ...this.defaultBudget, ...task.budget });

    if (!hasAgent(task.role)) {
      return this.failFast(task, taskId, startedAt, `Agent "${task.role}" introuvable`);
    }
    const agent = getAgentDefinitionOrThrow(task.role);
    const tools = resolveAgentTools(agent.capabilities, this.registry);

    // WorkspaceState : état authoritatif adressé par contenu (SHA-256). La
    // fonction de lecture passe par le ToolRegistry (read_project_file), comme
    // le fait le legacy executor.
    const workspace = new WorkspaceState(async (path: string) => {
      const res = (await this.registry.call("read_project_file", { path, full: true })) as
        | { content?: string; error?: string; status?: string }
        | undefined;
      if (!res || res.error || res.status === "failed" || typeof res.content !== "string") {
        throw new Error(res?.error ?? "Lecture du fichier impossible.");
      }
      return res.content;
    });

    const session: RunSession = {
      taskId,
      agent,
      tools,
      observations: [],
      verifications: [],
      recoveries: [],
      filesModified: new Set<string>(),
      toolsExecuted: [],
      usage: emptyBudgetUsage(),
      budget,
      startedAt,
      pendingInstruction: undefined,
      replans: 0,
      phase: "discovery",
      readCache: new Map<string, unknown>(),
      readFilesSeen: new Set<string>(),
      workspace,
      repairLoops: new Map<string, AgentRepairLoop>(),
      blockedFiles: new Set<string>(),
      lastPatchByFile: new Map<string, string>(),
    };
    this.session = session;

    log.info(
      `[${taskId.slice(0, 8)}] ▶ ${agent.name} — objectif: "${truncate(task.goal, 120)}" | ` +
        `${tools.length} outil(s) réellement disponible(s) sur ${agent.capabilities.length} déclaré(s)`
    );

    let plan: Plan;
    try {
      // ── UNDERSTAND + PLAN ──
      plan = await this.plan(task);
      session.lastPlan = plan;
    } catch (err) {
      return this.finish(task, session, "failed", `Échec de la planification: ${(err as Error).message}`);
    }

    // ── Boucle ACT → OBSERVE → VERIFY → (NEXT | RECOVER) ──
    let stepIdx = 0;
    while (stepIdx < plan.steps.length) {
      if (this.budgetExhausted(session)) {
        log.warn(`[${taskId.slice(0, 8)}] ⛔ Budget épuisé — arrêt de la boucle`);
        break;
      }

      // Transition de phase automatique : une fois le quota d'exploration
      // consommé, on force la phase WRITE pour que l'agent agisse.
      this.advancePhase(session);

      const step = plan.steps[stepIdx];
      step.status = "running";

      let observation: Observation;
      try {
        observation = await this.execute(task, step);
      } catch (err) {
        const recovery = await this.recover({
          phase: "act",
          message: (err as Error).message,
          cause: err,
        });
        session.recoveries.push(recovery);
        const advance = this.applyRecovery(session, plan, stepIdx, recovery);
        if (advance === "abort") break;
        if (advance === "next") stepIdx++;
        continue;
      }

      // ── VERIFY ──
      step.status = "verifying";
      const verification = await this.verify(step, observation);
      session.verifications.push(verification);

      if (verification.passed) {
        step.status = "done";
        stepIdx++;
        // Si le modèle a produit une réponse finale, on peut clore tôt.
        if (observation.isFinal && this.allRemainingTrivial(plan, stepIdx)) break;
        continue;
      }

      // ── FAILURE → RECOVER ──
      step.status = "failed";
      // Identifie le premier fichier écrit non vérifié pour piloter la réparation.
      const failedFile = this.firstUnverifiedWrite(session, observation);
      const recovery = await this.recover({
        phase: "verify",
        message: verification.issues.join("; ") || verification.summary,
        file: failedFile,
      });
      session.recoveries.push(recovery);
      const advance = this.applyRecovery(session, plan, stepIdx, recovery);
      if (advance === "abort") break;
      if (advance === "next") stepIdx++;
      // "retry"/"replan" → on reste sur la même étape (ou plan régénéré)
    }

    // ── COMPLETE ──
    const outcome = this.assessOutcome(session, plan);
    const success = outcome === "success" || outcome === "partial";
    return this.finish(task, session, outcome, undefined, success);
  }

  // ─── plan : UNDERSTAND + PLAN ───────────────────────────────────────────────

  async plan(task: AgentTask): Promise<Plan> {
    const session = this.requireSession();
    const { agent, tools } = session;

    const toolNames = tools.map((t) => t.name).join(", ") || "(aucun)";
    const planPrompt = [
      `OBJECTIF UTILISATEUR : ${task.goal}`,
      task.instructions ? `INSTRUCTIONS : ${task.instructions}` : "",
      task.files?.length ? `FICHIERS DE CONTEXTE : ${task.files.join(", ")}` : "",
      `OUTILS QUE TU POURRAS UTILISER : ${toolNames}`,
      "",
      "Analyse l'intention puis produis un plan d'action minimal et vérifiable.",
      "Réponds UNIQUEMENT avec un JSON strict de la forme :",
      JSON.stringify(
        {
          intent: "reformulation courte de l'intention",
          successCriteria: ["critère observable 1", "critère observable 2"],
          rationale: "pourquoi ce plan",
          steps: [
            { description: "étape 1", suggestedTools: ["outil_a"], verification: "comment vérifier" },
          ],
        },
        null,
        0
      ),
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.callLLM(agent, planPrompt);
    this.accountCost(session, response);

    const parsed = parseJsonObject(response.text);
    const rawSteps = Array.isArray(parsed?.steps) ? parsed!.steps : [];

    const steps: PlanStep[] = rawSteps
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
      .map((s, i) => ({
        id: `step-${i + 1}`,
        description: typeof s.description === "string" ? s.description : `Étape ${i + 1}`,
        suggestedTools: Array.isArray(s.suggestedTools)
          ? (s.suggestedTools.filter((t) => typeof t === "string") as string[])
          : undefined,
        verification: typeof s.verification === "string" ? s.verification : undefined,
        status: "pending" as const,
      }));

    // Fallback : un plan à une seule étape reprenant l'objectif brut.
    const plan: Plan = {
      intent: typeof parsed?.intent === "string" ? parsed.intent : task.goal,
      successCriteria: Array.isArray(parsed?.successCriteria)
        ? (parsed!.successCriteria.filter((c) => typeof c === "string") as string[])
        : ["L'objectif est atteint et vérifié."],
      rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "Plan direct.",
      steps: steps.length > 0 ? steps : [
        { id: "step-1", description: task.goal, status: "pending" },
      ],
    };

    log.info(
      `[${session.taskId.slice(0, 8)}] 🧭 Plan: "${truncate(plan.intent, 80)}" — ${plan.steps.length} étape(s)`
    );
    this.events?.emit({ type: "workflow:started", workflowId: session.taskId, name: plan.intent });
    return plan;
  }

  // ─── execute : ACT + OBSERVE RESULT (boucle d'outils interne) ───────────────

  async execute(task: AgentTask, step: PlanStep): Promise<Observation> {
    const session = this.requireSession();
    const { agent, tools, usage } = session;

    usage.iterations += 1;

    const iteration = usage.iterations;
    const systemPrompt = this.buildSystemPrompt(agent, tools, session);
    const stepPrompt = [
      `OBJECTIF GLOBAL : ${task.goal}`,
      `ÉTAPE COURANTE : ${step.description}`,
      step.suggestedTools?.length ? `OUTILS SUGGÉRÉS : ${step.suggestedTools.join(", ")}` : "",
      step.verification ? `VÉRIFICATION ATTENDUE : ${step.verification}` : "",
      session.pendingInstruction ? `CONSIGNE CORRECTIVE : ${session.pendingInstruction}` : "",
      buildObservationHistory(session.observations, MAX_HISTORY_CHARS),
      "",
      "Décide de la prochaine action : soit des tool_calls JSON, soit une réponse finale.",
    ]
      .filter(Boolean)
      .join("\n\n");

    session.pendingInstruction = undefined;

    const response = await this.callLLM(agent, stepPrompt, systemPrompt);
    this.accountCost(session, response);
    const text = response.text.trim();

    const calls = extractToolCalls(text);
    const toolOutcomes: ToolCallOutcome[] = [];

    for (const call of calls) {
      const kind = classifyTool(call.name);

      // Gate de budget SÉLECTIF par nature d'appel.
      // - read/other : bloqués dès que le budget non-critique est épuisé.
      // - write/verify : autorisés tant que le budget réservé aux actions
      //   critiques n'est pas dépassé (les corrections doivent pouvoir aboutir).
      const gate = this.admitCall(session, kind);
      if (!gate.allowed) {
        toolOutcomes.push({
          invocation: { name: call.name, parameters: call.parameters },
          success: false,
          error: gate.reason,
          durationMs: 0,
        });
        // Un refus de phase (discovery saturé) pousse vers l'écriture : on
        // n'interrompt pas la boucle, mais on injecte une consigne.
        session.pendingInstruction = gate.nudge ?? session.pendingInstruction;
        continue;
      }

      // Un agent ne peut appeler QUE les outils qu'il a réellement.
      if (!tools.some((t) => t.name === call.name)) {
        toolOutcomes.push({
          invocation: { name: call.name, parameters: call.parameters },
          success: false,
          error: `Outil "${call.name}" non autorisé pour l'agent ${agent.role}`,
          durationMs: 0,
        });
        continue;
      }

      const outcome = await this.invokeTool(session, call.name, call.parameters);
      toolOutcomes.push(outcome);

      // Transition de phase après une écriture réussie : on passe en VERIFY.
      if (kind === "write" && outcome.success && session.phase !== "recovery") {
        session.phase = "verify";
      }
    }

    const observation: Observation = {
      iteration,
      reasoning: text,
      toolOutcomes,
      isFinal: calls.length === 0,
    };
    session.observations.push(observation);
    return observation;
  }

  private async invokeTool(
    session: RunSession,
    name: string,
    parameters: Record<string, unknown>
  ): Promise<ToolCallOutcome> {
    const kind = classifyTool(name);

    // ── Cache de contexte : évite les search→read→search redondants. ──
    // Un read identique déjà effectué dans ce run est resservi sans nouvel appel
    // ni consommation de budget.
    if (CACHEABLE_TOOLS.has(name)) {
      const key = cacheKey(name, parameters);
      if (session.readCache.has(key)) {
        return {
          invocation: { name, parameters },
          success: true,
          result: session.readCache.get(key),
          durationMs: 0,
          cached: true,
        };
      }
    }

    const start = Date.now();
    this.countCall(session, kind);
    session.toolsExecuted.push(name);
    this.events?.emit({ type: "tool:called", toolName: name, agentId: session.agent.role });

    try {
      const result = await this.registry.call(name, parameters, { agentId: session.agent.role });
      const durationMs = Date.now() - start;

      // ── Écriture CONFIRMÉE : enregistrée immédiatement (transactionnel). ──
      // La preuve d'écriture est capturée dès le retour du handler, AVANT tout
      // contrôle de budget ultérieur. Une limite atteinte plus tard n'annule
      // jamais une modification déjà émise et réussie. On relit puis on hashe
      // le fichier dans le WorkspaceState (chaîne WRITE → observe → hash).
      if (kind === "write") {
        const path = extractPath(parameters);
        if (path) {
          session.filesModified.add(path);
          session.usage.filesModified = session.filesModified.size;
          try {
            await session.workspace.reread(path, "write");
          } catch {
            session.workspace.markError(path, "Relecture post-écriture impossible.");
          }
          // Mémorise le patch pour la détection de patch identique répété.
          session.lastPatchByFile.set(normPath(path), JSON.stringify(parameters));
        }
      }

      // Comptabilité des fichiers lus distincts + mise en cache.
      if (kind === "read") {
        const path = extractPath(parameters);
        if (path && !session.readFilesSeen.has(path)) {
          session.readFilesSeen.add(path);
          session.usage.filesRead = session.readFilesSeen.size;
        }
      }
      if (CACHEABLE_TOOLS.has(name)) {
        session.readCache.set(cacheKey(name, parameters), clampResult(result));
      }

      return {
        invocation: { name, parameters },
        success: true,
        result: clampResult(result),
        durationMs,
      };
    } catch (err) {
      return {
        invocation: { name, parameters },
        success: false,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      };
    }
  }

  /** Incrémente les compteurs séparés (lecture / écriture / vérification / autre). */
  private countCall(session: RunSession, kind: ToolKind): void {
    const u = session.usage;
    u.toolCalls += 1;
    if (kind === "read") u.readCalls += 1;
    else if (kind === "write") u.writeCalls += 1;
    else if (kind === "verify") u.verifyCalls += 1;
    else u.otherCalls += 1;
  }

  /** Premier fichier écrit dans l'observation qui n'est pas vérifié dans le WorkspaceState. */
  private firstUnverifiedWrite(session: RunSession, observation: Observation): string | undefined {
    for (const o of observation.toolOutcomes) {
      if (o.success && WRITE_TOOLS.has(o.invocation.name)) {
        const path = extractPath(o.invocation.parameters);
        if (!path) continue;
        const state = session.workspace.get(path);
        if (!state || state.status !== "verified" || state.verifiedHash !== state.contentHash) {
          return path;
        }
      }
    }
    return undefined;
  }

  // ─── verify : VERIFICATION ──────────────────────────────────────────────────

  async verify(step: PlanStep, observation: Observation): Promise<Verification> {
    const session = this.requireSession();
    const checks: string[] = [];
    const issues: string[] = [];

    // 1. Une action ayant échoué invalide l'étape.
    const failed = observation.toolOutcomes.filter((o) => !o.success);
    for (const f of failed) {
      issues.push(`${f.invocation.name}: ${f.error ?? "échec"}`);
    }
    checks.push(`${observation.toolOutcomes.length} action(s), ${failed.length} en échec`);

    // 2. Vérification HASHÉE par fichier écrit dans ce tour.
    //    Chaîne : WRITE → observe/hash (déjà fait) → verify_file → VerificationRecord
    //    → workspace.recordVerification → HASH MATCH ? On NE JETTE PAS le record.
    const writtenPaths = [
      ...new Set(
        observation.toolOutcomes
          .filter((o) => o.success && WRITE_TOOLS.has(o.invocation.name))
          .map((o) => extractPath(o.invocation.parameters))
          .filter((p): p is string => Boolean(p))
      ),
    ];

    const hasVerifyFile = session.tools.some((d) => d.name === "verify_file");
    for (const path of writtenPaths) {
      if (!hasVerifyFile) {
        checks.push(`écriture ${path} (verify_file indisponible pour cet agent)`);
        continue;
      }
      const res = await this.invokeTool(session, "verify_file", { path });
      const record = extractVerificationRecord(res.result);
      if (record) {
        // Le fichier doit être relu avant recordVerification (invariant WorkspaceState).
        await session.workspace.reread(path, "read").catch(() => undefined);
        try {
          session.workspace.recordVerification(path, record);
        } catch (e) {
          session.workspace.markError(path, (e as Error).message);
        }
      } else {
        session.workspace.markError(path, "verify_file n'a pas retourné de preuve hashée.");
      }

      const state = session.workspace.get(path);
      const verified =
        Boolean(record) &&
        state?.status === "verified" &&
        state.verifiedHash === state.contentHash;

      checks.push(
        `verify_file ${path}: ${verified ? "VÉRIFIÉ (hash match)" : "NON vérifié"} ` +
          `[before=${record?.hashBefore.slice(0, 8) ?? "?"} after=${record?.hashAfter.slice(0, 8) ?? "?"}]`
      );
      if (!verified) {
        issues.push(`${path}: vérification hashée non concluante (${state?.status ?? "état absent"})`);
      }
    }

    // 3. Réponse finale sans action : acceptée seulement si rien n'a été écrit.
    if (observation.isFinal && observation.toolOutcomes.length === 0) {
      checks.push("réponse finale sans action");
    }

    const passed = issues.length === 0;
    return {
      passed,
      checks,
      issues,
      summary: passed
        ? `Étape "${truncate(step.description, 60)}" validée`
        : `Étape "${truncate(step.description, 60)}" en échec: ${issues.slice(0, 2).join("; ")}`,
    };
  }

  // ─── recover : branche FAILURE ──────────────────────────────────────────────

  async recover(error: AgentError): Promise<Recovery> {
    const session = this.requireSession();
    const { budget, usage } = session;
    session.phase = "recovery";

    // 1. Budget de récupération épuisé → arrêt (les réserves verify ne sont pas
    //    consommées par la recovery ; voir admitCall).
    if (usage.recoveryCalls >= budget.maxRecovery) {
      const canReplan = usage.iterations < budget.maxIterations - 1 && session.replans < 1;
      if (canReplan) {
        session.replans += 1;
        return {
          strategy: "replan",
          instruction: `Le plan a échoué (${error.message}). Reconsidère l'approche complètement.`,
          reason: "Budget de récupération épuisé, une replanification reste possible.",
        };
      }
      return {
        strategy: "abort",
        instruction: "",
        reason: `Budget de récupération épuisé (${usage.recoveryCalls}/${budget.maxRecovery}).`,
      };
    }

    // 2. Politique de réparation DÉTERMINISTE par fichier (AgentRepairLoop) :
    //    détecte patch identique répété, absence de progrès, régression.
    const file = error.file;
    if (file) {
      const directive = this.assessRepair(session, file, error);
      usage.recoveryCalls += 1;
      switch (directive.action) {
        case "stop":
          session.blockedFiles.add(normPath(file));
          return {
            strategy: "abort",
            instruction: directive.requiredAction,
            reason: directive.reason,
          };
        case "change_strategy":
          return {
            strategy: "replan",
            instruction: directive.requiredAction,
            reason: directive.reason,
          };
        case "continue":
        default:
          return {
            strategy: "retry",
            instruction: directive.requiredAction,
            reason: directive.reason,
          };
      }
    }

    // 3. Erreur sans fichier identifié (plan/act générique) : retry borné.
    usage.recoveryCalls += 1;
    return {
      strategy: "retry",
      instruction:
        `L'action précédente a échoué : ${error.message}. ` +
        `Analyse la cause exacte et corrige avant de réessayer ` +
        `(récupération ${usage.recoveryCalls}/${budget.maxRecovery}).`,
      reason: "Erreur récupérable sans fichier ciblé.",
    };
  }

  /**
   * Applique AgentRepairLoop pour un fichier : construit les issues à partir de
   * l'état WorkspaceState + de l'erreur, et laisse la politique décider
   * continue / change_strategy / stop (patch identique, stall, régression).
   */
  private assessRepair(session: RunSession, file: string, error: AgentError): RepairDirective {
    const key = normPath(file);
    const loop = session.repairLoops.get(key) ?? new AgentRepairLoop();
    session.repairLoops.set(key, loop);
    const state = session.workspace.get(file);
    const issues = state?.verification?.allIssues?.length
      ? state.verification.allIssues
      : [
          {
            type: "execution",
            file: key,
            line: null,
            column: null,
            severity: "error" as const,
            rule: "tool-result",
            message: error.message || "Écriture ou vérification non confirmée.",
          },
        ];
    return loop.assess({
      issues,
      record: state?.verification,
      currentHash: state?.contentHash,
      currentVersion: state?.version,
      patch: session.lastPatchByFile.get(key),
    });
  }

  // ─── finalize : COMPLETE ────────────────────────────────────────────────────

  async finalize(task: AgentTask): Promise<FinalResult> {
    const session = this.requireSession();
    const { agent } = session;

    const finalPrompt = [
      `OBJECTIF : ${task.goal}`,
      `FICHIERS MODIFIÉS : ${[...session.filesModified].join(", ") || "aucun"}`,
      `OUTILS EXÉCUTÉS : ${[...new Set(session.toolsExecuted)].join(", ") || "aucun"}`,
      buildObservationHistory(session.observations, 20_000),
      "",
      "Produis une synthèse finale en JSON strict :",
      JSON.stringify({ summary: "", details: "", deliverables: [], suggestions: [] }, null, 0),
    ]
      .filter(Boolean)
      .join("\n\n");

    let final: FinalResult = {
      summary: "Tâche traitée.",
      details: "",
      deliverables: [...session.filesModified],
      suggestions: [],
    };

    try {
      const response = await this.callLLM(agent, finalPrompt);
      this.accountCost(session, response);
      const parsed = parseJsonObject(response.text);
      if (parsed) {
        final = {
          summary: typeof parsed.summary === "string" ? parsed.summary : final.summary,
          details: typeof parsed.details === "string" ? parsed.details : response.text.trim(),
          deliverables: Array.isArray(parsed.deliverables)
            ? (parsed.deliverables.filter((d) => typeof d === "string") as string[])
            : final.deliverables,
          suggestions: Array.isArray(parsed.suggestions)
            ? (parsed.suggestions.filter((s) => typeof s === "string") as string[])
            : [],
        };
      } else {
        final.details = response.text.trim();
      }
    } catch (err) {
      log.warn(`[${session.taskId.slice(0, 8)}] Synthèse finale dégradée: ${(err as Error).message}`);
    }
    return final;
  }

  // ─── Helpers internes ───────────────────────────────────────────────────────

  private buildSystemPrompt(agent: AgentDefinition, tools: ToolDeclaration[], session: RunSession): string {
    return [
      agent.systemPrompt,
      "",
      buildToolSection(tools),
      "",
      buildBudgetSection(session.budget, session.usage, session.phase),
    ].join("\n");
  }

  private async callLLM(
    agent: AgentDefinition,
    prompt: string,
    systemPrompt?: string
  ): Promise<GenerateTextResult> {
    return this.model({
      prompt,
      systemPrompt: systemPrompt ?? agent.systemPrompt,
      temperature: 0.3,
      thinkingBudget: 0,
      maxOutputTokens: 16_384,
    });
  }

  private accountCost(session: RunSession, response: GenerateTextResult): void {
    const usage = response.tokenUsage;
    const cost = usage ? usage.totalTokens / 1000 : 1; // ~1 unité si non renseigné
    session.usage.cost += cost;
  }

  /**
   * Épuisement du budget contrôlant l'ARRÊT de la boucle (niveau itération).
   * Les limites de temps, itérations et coût sont dures. Le budget d'outils ne
   * stoppe la boucle que si TOUS les quotas de phase restants sont à zéro —
   * sinon on laisse la boucle tourner pour permettre écritures/vérifications.
   */
  private budgetExhausted(session: RunSession): boolean {
    const { budget, usage, startedAt } = session;
    usage.elapsedMs = Date.now() - startedAt;
    if (usage.iterations >= budget.maxIterations) return true;
    if (usage.elapsedMs >= budget.maxExecutionTimeMs) return true;
    if (usage.cost >= budget.maxCost) return true;
    // Reste-t-il un quota exploitable dans une phase quelconque ?
    const writeLeft = budget.maxWrite - usage.writeCalls;
    const verifyLeft = budget.maxVerify - usage.verifyCalls;
    const recoveryLeft = budget.maxRecovery - usage.recoveryCalls;
    const readLeft = budget.maxRead - usage.readCalls;
    if (writeLeft <= 0 && verifyLeft <= 0 && recoveryLeft <= 0 && readLeft <= 0) return true;
    return false;
  }

  /**
   * Règle d'arrêt intelligente basée sur les quotas ABSOLUS par phase.
   * Les quotas write/verify/recovery sont RÉSERVÉS : ils ne peuvent jamais être
   * consommés par la lecture. C'est ce qui garantit qu'après la découverte,
   * l'agent dispose toujours des appels nécessaires pour écrire ET vérifier.
   */
  private admitCall(
    session: RunSession,
    kind: ToolKind
  ): { allowed: boolean; reason: string; nudge?: string } {
    const { budget, usage } = session;

    // Limites dures non liées aux outils.
    usage.elapsedMs = Date.now() - session.startedAt;
    if (usage.elapsedMs >= budget.maxExecutionTimeMs) {
      return { allowed: false, reason: "Budget temps épuisé." };
    }
    if (usage.cost >= budget.maxCost) {
      return { allowed: false, reason: "Budget de coût épuisé." };
    }

    // Chaque nature d'appel est plafonnée par SON quota de phase absolu, jamais
    // par le total : le total est la somme, mais les réserves sont étanches.
    switch (kind) {
      case "write":
        return usage.writeCalls < budget.maxWrite
          ? { allowed: true, reason: "" }
          : { allowed: false, reason: `Quota d'écriture épuisé (${usage.writeCalls}/${budget.maxWrite}).` };
      case "verify":
        return usage.verifyCalls < budget.maxVerify
          ? { allowed: true, reason: "" }
          : { allowed: false, reason: `Quota de vérification épuisé (${usage.verifyCalls}/${budget.maxVerify}).` };
      case "read":
        return usage.readCalls < budget.maxRead && usage.filesRead < budget.maxFilesRead
          ? { allowed: true, reason: "" }
          : {
              allowed: false,
              reason: `Quota d'exploration épuisé (${usage.readCalls}/${budget.maxRead}).`,
              nudge:
                "Le quota d'exploration est atteint. Arrête de lire/chercher et PASSE À L'ACTION : " +
                "applique les modifications (write_project_file / modify_project_file / patch_project_file), " +
                "puis vérifie (verify_file / verify_typecheck).",
            };
      case "other":
      default:
        // Les appels « autres » (ex: planification, run_project_command hors
        // verify) puisent dans le quota de planification résiduel.
        return usage.otherCalls < budget.maxPlan
          ? { allowed: true, reason: "" }
          : { allowed: false, reason: `Quota d'appels divers épuisé (${usage.otherCalls}/${budget.maxPlan}).` };
    }
  }

  /**
   * Applique la décision de récupération et indique comment avancer :
   *  - "abort" : arrêter la boucle
   *  - "next"  : passer à l'étape suivante (skip)
   *  - "stay"  : rester sur l'étape courante (retry/replan)
   */
  private applyRecovery(
    session: RunSession,
    plan: Plan,
    stepIdx: number,
    recovery: Recovery
  ): "abort" | "next" | "stay" {
    switch (recovery.strategy) {
      case "abort":
        return "abort";
      case "skip":
        plan.steps[stepIdx].status = "skipped";
        session.pendingInstruction = recovery.instruction;
        return "next";
      case "replan": {
        // Regénère les étapes restantes en une seule étape corrective.
        session.pendingInstruction = recovery.instruction;
        plan.steps.splice(stepIdx, plan.steps.length - stepIdx, {
          id: `step-replan-${stepIdx + 1}`,
          description: recovery.instruction,
          status: "pending",
        });
        return "stay";
      }
      case "retry":
      default:
        session.pendingInstruction = recovery.instruction;
        return "stay";
    }
  }

  /**
   * Fait avancer la phase courante selon la consommation du budget.
   * discovery → write dès que le quota de découverte est atteint (ou qu'une
   * écriture a déjà eu lieu). En recovery, la phase est pilotée par recover().
   */
  private advancePhase(session: RunSession): void {
    if (session.phase === "recovery" || session.phase === "verify") return;
    const { budget, usage } = session;
    if (session.phase === "discovery" && (usage.readCalls >= budget.maxRead || usage.writeCalls > 0)) {
      session.phase = "write";
    }
  }

  private allRemainingTrivial(plan: Plan, fromIdx: number): boolean {
    return plan.steps.slice(fromIdx).every((s) => s.status === "done" || s.status === "skipped");
  }

  private assessOutcome(session: RunSession, plan: Plan): import("./types.js").AgentOutcome {
    const anyFailedStep = plan.steps.some((s) => s.status === "failed");
    const wroteSomething = session.filesModified.size > 0;
    const anyToolError = session.observations.some((o) => o.toolOutcomes.some((t) => !t.success));

    // Aucune écriture ni aucun outil exécuté : rien n'a bougé.
    if (!wroteSomething && session.toolsExecuted.length === 0) return "no_change";

    // La VÉRIFICATION hashée est l'arbitre, pas le simple fait d'avoir écrit.
    // On consulte le WorkspaceState : chaque fichier modifié doit être "verified"
    // avec un hash courant concordant, sinon la mission n'est pas un succès.
    const report = session.workspace.completionReport(session.filesModified);
    const allWritesVerified = wroteSomething && report.passed;

    // Un fichier bloqué par la politique de réparation (no-progress / patch répété)
    // signale un échec de progression explicite.
    if (session.blockedFiles.size > 0 && !allWritesVerified) return "failed";

    if (allWritesVerified && !anyFailedStep) return "success";

    // Des écritures existent mais la vérification n'aboutit pas.
    if (wroteSomething && !allWritesVerified) {
      return this.budgetExhausted(session) ? "blocked" : "failed";
    }

    if (anyFailedStep && !wroteSomething) return "failed";
    if (anyFailedStep || anyToolError) return "partial";
    return "success";
  }

  private async finish(
    task: AgentTask,
    session: RunSession,
    outcome: import("./types.js").AgentOutcome,
    error?: string,
    successOverride?: boolean
  ): Promise<AgentResult> {
    const final = error ? emptyFinal(error) : await this.finalize(task);
    session.usage.elapsedMs = Date.now() - session.startedAt;
    const success = successOverride ?? (outcome === "success" || outcome === "partial");

    const result: AgentResult = {
      taskId: session.taskId,
      role: session.agent.role,
      goal: task.goal,
      success,
      outcome,
      plan: session.lastPlan ?? { intent: task.goal, steps: [], successCriteria: [], rationale: "" },
      observations: session.observations,
      verifications: session.verifications,
      recoveries: session.recoveries,
      filesModified: [...session.filesModified],
      toolsExecuted: [...new Set(session.toolsExecuted)],
      final,
      budgetUsage: session.usage,
      durationMs: session.usage.elapsedMs,
      error,
    };

    this.events?.emit({ type: "workflow:completed", workflowId: session.taskId, success });
    log.info(
      `[${session.taskId.slice(0, 8)}] ${success ? "✅" : "❌"} ${session.agent.name} — ` +
        `outcome=${outcome} | ${result.filesModified.length} fichier(s) | ` +
        `${session.usage.toolCalls} appel(s) outil | ${session.usage.iterations} itération(s) | ` +
        `${(result.durationMs / 1000).toFixed(1)}s`
    );
    this.session = null;
    return result;
  }

  private failFast(
    task: AgentTask,
    taskId: string,
    startedAt: number,
    error: string
  ): AgentResult {
    log.error(`[${taskId.slice(0, 8)}] ${error}`);
    return {
      taskId,
      role: task.role,
      goal: task.goal,
      success: false,
      outcome: "failed",
      plan: { intent: task.goal, steps: [], successCriteria: [], rationale: "" },
      observations: [],
      verifications: [],
      recoveries: [],
      filesModified: [],
      toolsExecuted: [],
      final: emptyFinal(error),
      budgetUsage: { ...emptyBudgetUsage(), elapsedMs: Date.now() - startedAt },
      durationMs: Date.now() - startedAt,
      error,
    };
  }

  private requireSession(): RunSession {
    if (!this.session) {
      throw new Error("AgentRuntime: aucune session active. Appelez run() (les phases ne sont pas réentrantes hors run).");
    }
    return this.session;
  }

  /**
   * Amorce une session sans appeler le LLM. RÉSERVÉ AUX TESTS : permet de
   * valider les phases déterministes (verify/recover, budget, WorkspaceState,
   * AgentRepairLoop) de façon hermétique, sans réseau ni clés API.
   */
  _seedSessionForTest(task: AgentTask): RunSession {
    const budget = normalizeBudget({ ...this.defaultBudget, ...task.budget });
    const agent = getAgentDefinitionOrThrow(task.role);
    const tools = resolveAgentTools(agent.capabilities, this.registry);
    const workspace = new WorkspaceState(async (path: string) => {
      const res = (await this.registry.call("read_project_file", { path, full: true })) as
        | { content?: string } | undefined;
      if (typeof res?.content !== "string") throw new Error("read failed");
      return res.content;
    });
    const session: RunSession = {
      taskId: task.id ?? "test-task",
      agent,
      tools,
      observations: [],
      verifications: [],
      recoveries: [],
      filesModified: new Set(),
      toolsExecuted: [],
      usage: emptyBudgetUsage(),
      budget,
      startedAt: Date.now(),
      replans: 0,
      phase: "discovery",
      readCache: new Map(),
      readFilesSeen: new Set(),
      workspace,
      repairLoops: new Map(),
      blockedFiles: new Set(),
      lastPatchByFile: new Map(),
    };
    this.session = session;
    return session;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// État interne d'une exécution
// ═══════════════════════════════════════════════════════════════════════════

interface RunSession {
  taskId: string;
  agent: AgentDefinition;
  tools: ToolDeclaration[];
  observations: Observation[];
  verifications: Verification[];
  recoveries: Recovery[];
  filesModified: Set<string>;
  toolsExecuted: string[];
  usage: BudgetUsage;
  budget: AgentBudget;
  startedAt: number;
  pendingInstruction?: string;
  replans: number;
  lastPlan?: Plan;
  /** Phase courante de la boucle (règle d'arrêt intelligente). */
  phase: AgentPhase;
  /** Cache des résultats d'outils de lecture (clé = nom+params). */
  readCache: Map<string, unknown>;
  /** Fichiers déjà lus (déduplication du compteur filesRead). */
  readFilesSeen: Set<string>;
  /** État authoritatif adressé par contenu (hash before/after, vérification). */
  workspace: WorkspaceState;
  /** Politique de réparation bornée par fichier (progrès / stall / stop). */
  repairLoops: Map<string, AgentRepairLoop>;
  /** Fichiers bloqués par le diagnostic de non-progression. */
  blockedFiles: Set<string>;
  /** Dernier patch appliqué par fichier (détection de patch identique répété). */
  lastPatchByFile: Map<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilitaires purs
// ═══════════════════════════════════════════════════════════════════════════

function emptyFinal(error: string): FinalResult {
  return { summary: error, details: error, deliverables: [], suggestions: [] };
}

function clampResult(result: unknown): unknown {
  if (typeof result === "string") {
    return result.length > MAX_RESULT_CHARS ? `${result.slice(0, MAX_RESULT_CHARS)}…` : result;
  }
  return result;
}

/** Clé de cache stable pour un appel d'outil de lecture. */
function cacheKey(name: string, parameters: Record<string, unknown>): string {
  let params: string;
  try {
    params = JSON.stringify(parameters, Object.keys(parameters).sort());
  } catch {
    params = String(parameters);
  }
  return `${name}:${params}`;
}

/** Extrait un chemin de fichier des paramètres d'un appel d'outil. */
function extractPath(parameters: Record<string, unknown>): string | undefined {
  if (typeof parameters.path === "string") return parameters.path;
  if (typeof parameters.file === "string") return parameters.file;
  if (typeof parameters.filePath === "string") return parameters.filePath;
  return undefined;
}

/** Normalise un chemin (slashes, préfixe ./) pour servir de clé stable. */
function normPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Type guard : le résultat de verify_file contient-il un VerificationRecord ? */
function extractVerificationRecord(result: unknown): VerificationRecord | null {
  if (!result || typeof result !== "object") return null;
  const record = (result as { verificationRecord?: unknown }).verificationRecord as
    | Partial<VerificationRecord>
    | undefined;
  if (
    record &&
    typeof record.contentHash === "string" &&
    typeof record.hashBefore === "string" &&
    typeof record.hashAfter === "string" &&
    typeof record.ok === "boolean" &&
    ["success", "failed", "stale"].includes(record.status ?? "")
  ) {
    return record as VerificationRecord;
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Extrait le premier objet JSON valide d'un texte (tolérant aux fences ```json). */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}


