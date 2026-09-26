import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  /** Nom du skill/action à invoquer (ex: "github_list_prs", "memory_store", "automation_search") */
  action: string;
  /** Arguments passés à l'action. Supporte les templates {{prev.result}}, {{steps.stepId.result}} */
  args: Record<string, unknown>;
  /** Nom lisible de l'étape (optionnel) */
  label?: string;
  /** Condition pour exécuter cette étape (expression simple, ex: "prev.status === 'success'") */
  condition?: string;
  /** Comportement en cas d'échec: 'stop' (défaut), 'skip', 'retry' */
  onError?: "stop" | "skip" | "retry";
  /** Nombre max de retries si onError = 'retry' */
  maxRetries?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  /** Expression d'intervalle pour l'exécution planifiée (ex: "24h", "30m") — optionnel */
  schedule?: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunStatus?: "success" | "partial" | "failed";
}

export interface WorkflowStepResult {
  stepId: string;
  action: string;
  status: "success" | "skipped" | "failed";
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface WorkflowRunResult {
  workflowId: string;
  workflowName: string;
  status: "success" | "partial" | "failed";
  startedAt: string;
  completedAt: string;
  steps: WorkflowStepResult[];
}

/** État temps réel d'un workflow en cours d'exécution */
export interface WorkflowRunState {
  workflowId: string;
  workflowName: string;
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepId: string | null;
  currentStepAction: string | null;
  /** Progression en pourcentage (0-100) */
  progress: number;
  /** Durée écoulée en ms */
  elapsedMs: number;
  steps: WorkflowStepRunState[];
}

export interface WorkflowStepRunState {
  stepId: string;
  action: string;
  label?: string;
  status: "pending" | "running" | "success" | "skipped" | "failed";
  error?: string;
  durationMs?: number;
  startedAt?: string;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const workflowStepSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional().default({}),
  label: z.string().optional(),
  condition: z.string().optional(),
  onError: z.enum(["stop", "skip", "retry"]).optional().default("stop"),
  maxRetries: z.number().int().min(0).max(5).optional().default(2),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1, "Nom du workflow requis").trim(),
  description: z.string().optional().default(""),
  steps: z.array(workflowStepSchema).min(1, "Au moins une étape requise"),
  schedule: z.string().trim().optional(),
});

export const runWorkflowSchema = z.object({
  workflowId: z.string().min(1, "ID du workflow requis"),
});

export const deleteWorkflowSchema = z.object({
  workflowId: z.string().min(1, "ID du workflow requis"),
});

export const toggleWorkflowSchema = z.object({
  workflowId: z.string().min(1, "ID du workflow requis"),
  enabled: z.boolean(),
});

// ─── Storage ──────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const workflows = new Map<string, WorkflowDefinition>();
const workflowTimers = new Map<string, NodeJS.Timeout>();

/** Suivi temps réel des exécutions en cours */
const activeRuns = new Map<string, WorkflowRunState>();

/** Obtenir l'état d'exécution en cours d'un workflow (ou null s'il n'est pas en cours) */
export function getActiveRun(workflowId: string): WorkflowRunState | null {
  return activeRuns.get(workflowId) || null;
}

/** Obtenir tous les workflows en cours d'exécution */
export function getActiveRuns(): WorkflowRunState[] {
  return Array.from(activeRuns.values());
}

// ─── Interval parsing (reused from automation) ────────────────────────────────

function parseInterval(expr: string): number | null {
  const match = expr.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "s": case "sec": case "secs": case "second": case "seconds":
      return value * 1000;
    case "m": case "min": case "mins": case "minute": case "minutes":
      return value * 60 * 1000;
    case "h": case "hr": case "hrs": case "hour": case "hours":
      return value * 60 * 60 * 1000;
    default:
      return null;
  }
}

// ─── Template resolution ──────────────────────────────────────────────────────

/**
 * Résout les templates dans les arguments d'une étape.
 * Supporte:
 *  - {{prev.result}}   → résultat de l'étape précédente
 *  - {{prev.status}}   → statut de l'étape précédente
 *  - {{steps.ID.result}} → résultat d'une étape spécifique par son id
 *  - {{steps.ID.status}} → statut d'une étape spécifique
 */
function resolveTemplates(
  args: Record<string, unknown>,
  stepResults: WorkflowStepResult[],
  prevResult: WorkflowStepResult | null
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      resolved[key] = resolveStringTemplate(value, stepResults, prevResult);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      resolved[key] = resolveTemplates(value as Record<string, unknown>, stepResults, prevResult);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

function resolveStringTemplate(
  template: string,
  stepResults: WorkflowStepResult[],
  prevResult: WorkflowStepResult | null
): unknown {
  // If the entire string is a single template placeholder, return the raw value (not stringified)
  const fullMatch = template.match(/^\{\{(.+?)\}\}$/);
  if (fullMatch) {
    return resolveReference(fullMatch[1].trim(), stepResults, prevResult);
  }

  // Otherwise do string interpolation
  return template.replace(/\{\{(.+?)\}\}/g, (_, ref) => {
    const val = resolveReference(ref.trim(), stepResults, prevResult);
    return typeof val === "string" ? val : JSON.stringify(val);
  });
}

function resolveReference(
  ref: string,
  stepResults: WorkflowStepResult[],
  prevResult: WorkflowStepResult | null
): unknown {
  // prev.result / prev.status
  if (ref.startsWith("prev.")) {
    if (!prevResult) return undefined;
    const field = ref.slice(5);
    if (field === "result") return prevResult.result;
    if (field === "status") return prevResult.status;
    if (field === "error") return prevResult.error;
    return undefined;
  }

  // steps.STEP_ID.result / steps.STEP_ID.status
  if (ref.startsWith("steps.")) {
    const parts = ref.slice(6).split(".");
    if (parts.length < 2) return undefined;
    const stepId = parts[0];
    const field = parts[1];
    const step = stepResults.find((s) => s.stepId === stepId);
    if (!step) return undefined;
    if (field === "result") return step.result;
    if (field === "status") return step.status;
    if (field === "error") return step.error;
    return undefined;
  }

  return undefined;
}

// ─── Condition evaluation (safe, no eval/new Function) ───────────────────────

type Value = any;
type Token = { type: string; value?: any; raw?: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let s = "";
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === "\\" && i + 1 < expr.length) { s += expr[i + 1]; i += 2; }
        else { s += expr[i]; i++; }
      }
      if (i >= expr.length) throw new Error("Unterminated string");
      i++;
      tokens.push({ type: "string", value: s });
      continue;
    }
    if (/\d/.test(ch)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[A-Za-z0-9_$]/.test(expr[i])) { id += expr[i]; i++; }
      if (id === "true" || id === "false") tokens.push({ type: "boolean", value: id === "true" });
      else if (id === "null") tokens.push({ type: "null", value: null });
      else if (id === "undefined") tokens.push({ type: "undefined", value: undefined });
      else tokens.push({ type: "ident", value: id, raw: id });
      continue;
    }
    const two = expr.slice(i, i + 2);
    const three = expr.slice(i, i + 3);
    if (three === "===" || three === "!==") { tokens.push({ type: "op", value: three }); i += 3; continue; }
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "?.") {
      tokens.push({ type: "op", value: two }); i += 2; continue;
    }
    if (ch === "(" || ch === ")" || ch === "!" || ch === "<" || ch === ">" || ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%" || ch === "?" || ch === ":" || ch === "." || ch === "[") {
      if (ch === "[") tokens.push({ type: "lbrack" });
      else if (ch === "(") tokens.push({ type: "lparen" });
      else if (ch === ")") tokens.push({ type: "rparen" });
      else if (ch === "?") tokens.push({ type: "question" });
      else if (ch === ":") tokens.push({ type: "colon" });
      else if (ch === ".") tokens.push({ type: "dot" });
      else tokens.push({ type: "op", value: ch });
      i++;
      if (ch === "[") { if (expr[i - 1 + 1] === undefined) {} /*noop*/ }
      continue;
    }
    if (ch === "]") { tokens.push({ type: "rbrack" }); i++; continue; }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

const PREC: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
  "!": 7, "u-": 7,
};
const RIGHT_ASSOC = new Set(["?:"]);

function toRpn(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const stack: Token[] = [];
  let prevTok: Token | null = null;
  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (["string", "number", "boolean", "null", "undefined", "ident"].includes(tok.type)) {
      out.push(tok);
    } else if (tok.type === "lparen") {
      stack.push(tok);
    } else if (tok.type === "rparen") {
      while (stack.length && stack[stack.length - 1].type !== "lparen") out.push(stack.pop()!);
      if (!stack.length) throw new Error("Mismatched parens");
      stack.pop();
    } else if (tok.type === "lbrack") {
      stack.push(tok);
    } else if (tok.type === "rbrack") {
      while (stack.length && stack[stack.length - 1].type !== "lbrack") out.push(stack.pop()!);
      if (!stack.length) throw new Error("Mismatched brackets");
      stack.pop();
      out.push({ type: "op", value: "[]" });
    } else if (tok.type === "dot") {
      stack.push({ type: "op", value: "." });
      const next = tokens[idx + 1];
      if (next && next.type === "ident") { out.push(next); idx++; }
      else throw new Error("Expected ident after dot");
      out.push(stack.pop()!);
      prevTok = tok;
      continue;
    } else if (tok.type === "question") {
      stack.push(tok);
    } else if (tok.type === "colon") {
      let foundQuestion = false;
      while (stack.length) {
        const t = stack.pop()!;
        if (t.type === "question") { foundQuestion = true; break; }
        out.push(t);
      }
      if (!foundQuestion) throw new Error("Colon without matching ?");
      stack.push({ type: "op", value: "?:" });
    } else if (tok.type === "op") {
      let opVal = tok.value;
      if (opVal === "-" && (!prevTok || (prevTok.type === "op" || prevTok.type === "lparen" || prevTok.type === "lbrack" || prevTok.type === "question" || prevTok.type === "colon"))) {
        opVal = "u-";
      }
      if (opVal === "+" && (!prevTok || (prevTok.type === "op" || prevTok.type === "lparen" || prevTok.type === "lbrack" || prevTok.type === "question" || prevTok.type === "colon"))) {
        prevTok = tok;
        continue;
      }
      const prec = PREC[opVal];
      if (!prec) throw new Error(`Unknown operator: ${opVal}`);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === "op" && top.value !== "?:" && top.value !== "." && top.value !== "[]") {
          const topPrec = PREC[top.value];
          if (!topPrec) break;
          if (topPrec > prec || (topPrec === prec && !RIGHT_ASSOC.has(opVal))) {
            out.push(stack.pop()!);
            continue;
          }
        }
        break;
      }
      stack.push({ type: "op", value: opVal });
    }
    prevTok = tok;
  }
  while (stack.length) {
    const t = stack.pop()!;
    if (t.type === "lparen" || t.type === "lbrack" || t.type === "question") throw new Error("Mismatched brackets/parens");
    out.push(t);
  }
  return out;
}

function safePropGet(obj: any, key: string): Value {
  if (obj === null || obj === undefined) return undefined;
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return obj[key];
}

function safeIndexGet(obj: any, key: any): Value {
  if (obj === null || obj === undefined) return undefined;
  if (typeof key !== "string" && typeof key !== "number") return undefined;
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return obj[key];
}

interface EvalCtx {
  prev: { result?: any; status?: any; error?: any };
  steps: Record<string, { result?: any; status?: any; error?: any }>;
}

function evalRpn(rpn: Token[], ctx: EvalCtx): Value {
  const stack: Value[] = [];
  for (const tok of rpn) {
    if (tok.type === "string" || tok.type === "number" || tok.type === "boolean" || tok.type === "null" || tok.type === "undefined") {
      stack.push(tok.value);
    } else if (tok.type === "ident") {
      const name = tok.value;
      if (name === "prev") stack.push(ctx.prev);
      else if (name === "steps") stack.push(ctx.steps);
      else throw new Error(`Unknown identifier: ${name} (only 'prev' and 'steps' are allowed)`);
    } else if (tok.type === "op") {
      const op = tok.value;
      if (op === "!") { const a = stack.pop(); stack.push(!a); }
      else if (op === "u-") { const a = stack.pop(); stack.push(-Number(a)); }
      else if (op === ".") {
        const key = stack.pop() as string;
        const obj = stack.pop();
        stack.push(safePropGet(obj, key));
      } else if (op === "[]") {
        const key = stack.pop();
        const obj = stack.pop();
        stack.push(safeIndexGet(obj, key));
      } else if (op === "?:") {
        const c = stack.pop();
        const a = stack.pop();
        const b = stack.pop();
        stack.push(b ? a : c);
      } else {
        const b = stack.pop();
        const a = stack.pop();
        switch (op) {
          case "||": stack.push(a || b); break;
          case "&&": stack.push(a && b); break;
          case "==": stack.push(a == b); break;
          case "!=": stack.push(a != b); break;
          case "===": stack.push(a === b); break;
          case "!==": stack.push(a !== b); break;
          case "<": stack.push(a < b); break;
          case ">": stack.push(a > b); break;
          case "<=": stack.push(a <= b); break;
          case ">=": stack.push(a >= b); break;
          case "+": stack.push(Number(a) + Number(b)); break;
          case "-": stack.push(Number(a) - Number(b)); break;
          case "*": stack.push(Number(a) * Number(b)); break;
          case "/": stack.push(Number(a) / Number(b)); break;
          case "%": stack.push(Number(a) % Number(b)); break;
          default: throw new Error(`Unknown op in eval: ${op}`);
        }
      }
    }
  }
  if (stack.length !== 1) throw new Error(`Invalid expression (stack size ${stack.length})`);
  return stack[0];
}

function evaluateCondition(
  condition: string,
  stepResults: WorkflowStepResult[],
  prevResult: WorkflowStepResult | null
): boolean {
  try {
    if (typeof condition !== "string") {
      console.warn(`[Workflow] Condition is not a string — skipping evaluation`);
      return true;
    }
    const trimmed = condition.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.length > 500) {
      console.warn(`[Workflow] Condition too long (${trimmed.length} chars) — blocked`);
      return false;
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)) {
      console.warn(`[Workflow] Condition contains control characters — blocked`);
      return false;
    }

    const tokens = tokenize(trimmed);
    const rpn = toRpn(tokens);

    const prev = prevResult
      ? { result: prevResult.result, status: prevResult.status, error: prevResult.error }
      : { result: undefined, status: undefined, error: undefined };
    const stepsMap: Record<string, any> = {};
    for (const sr of stepResults) {
      stepsMap[sr.stepId] = Object.freeze({ result: sr.result, status: sr.status, error: sr.error });
    }
    const ctx: EvalCtx = {
      prev: Object.freeze(prev),
      steps: Object.freeze(stepsMap),
    };

    return !!evalRpn(rpn, ctx);
  } catch (e: any) {
    console.warn(`[Workflow] Condition evaluation failed: "${condition}" — ${e?.message || e}`);
    return false;
  }
}

// ─── Workflow execution engine ────────────────────────────────────────────────

/** Référence au handleToolCall du SkillManager, injectée au démarrage */
let skillHandler: ((name: string, args: any) => Promise<any>) | null = null;

export function setWorkflowSkillHandler(handler: (name: string, args: any) => Promise<any>) {
  skillHandler = handler;
}

export async function executeWorkflow(workflow: WorkflowDefinition): Promise<WorkflowRunResult> {
  if (!skillHandler) {
    throw new Error("Workflow skill handler not configured. Call setWorkflowSkillHandler first.");
  }

  const startedAt = new Date().toISOString();
  const stepResults: WorkflowStepResult[] = [];
  let overallStatus: "success" | "partial" | "failed" = "success";

  // ── Initialisation du suivi temps réel ────────────────────────────────
  const runState: WorkflowRunState = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: "running",
    startedAt,
    currentStepIndex: 0,
    totalSteps: workflow.steps.length,
    currentStepId: null,
    currentStepAction: null,
    progress: 0,
    elapsedMs: 0,
    steps: workflow.steps.map((s) => ({
      stepId: s.id,
      action: s.action,
      label: s.label,
      status: "pending" as const,
    })),
  };
  activeRuns.set(workflow.id, runState);

  // Timer pour mettre à jour le temps écoulé
  const startTime = Date.now();
  const elapsedTimer = setInterval(() => {
    runState.elapsedMs = Date.now() - startTime;
  }, 250);

  console.log(`[Workflow] ▶ Démarrage: "${workflow.name}" (${workflow.steps.length} étapes)`);

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const prevResult = i > 0 ? stepResults[i - 1] : null;

    // Mettre à jour l'état courant
    runState.currentStepIndex = i;
    runState.currentStepId = step.id;
    runState.currentStepAction = step.action;
    runState.progress = Math.round((i / workflow.steps.length) * 100);
    runState.steps[i].status = "running";
    runState.steps[i].startedAt = new Date().toISOString();

    // Évaluation de la condition
    if (step.condition) {
      const shouldRun = evaluateCondition(step.condition, stepResults, prevResult);
      if (!shouldRun) {
        console.log(`[Workflow]   ⏭ Étape "${step.id}" skipped (condition non remplie)`);
        runState.steps[i].status = "skipped";
        stepResults.push({
          stepId: step.id,
          action: step.action,
          status: "skipped",
          durationMs: 0,
        });
        continue;
      }
    }

    // Résolution des templates dans les arguments
    const resolvedArgs = resolveTemplates(step.args, stepResults, prevResult);

    // Exécution avec retry
    const maxAttempts = step.onError === "retry" ? (step.maxRetries || 2) : 1;
    let lastError: string | undefined;
    let result: any;
    let success = false;
    const stepStart = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log(`[Workflow]   ▷ Étape "${step.id}" → ${step.action}${attempt > 0 ? ` (retry ${attempt})` : ""}`);
        result = await skillHandler(step.action, resolvedArgs);

        // Vérifier si le skill a retourné une erreur
        if (result && typeof result === "object" && result.error) {
          lastError = result.error;
          if (attempt < maxAttempts - 1) continue;
        } else {
          success = true;
          break;
        }
      } catch (e: any) {
        lastError = e.message || String(e);
        if (attempt < maxAttempts - 1) {
          console.log(`[Workflow]     ⟳ Retry ${attempt + 1}/${maxAttempts - 1}`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // backoff
        }
      }
    }

    const durationMs = Date.now() - stepStart;

    if (success) {
      stepResults.push({ stepId: step.id, action: step.action, status: "success", result, durationMs });
      runState.steps[i].status = "success";
      runState.steps[i].durationMs = durationMs;
      console.log(`[Workflow]   ✓ Étape "${step.id}" réussie (${durationMs}ms)`);
    } else {
      stepResults.push({ stepId: step.id, action: step.action, status: "failed", error: lastError, durationMs });
      runState.steps[i].status = "failed";
      runState.steps[i].error = lastError;
      runState.steps[i].durationMs = durationMs;
      console.log(`[Workflow]   ✗ Étape "${step.id}" échouée: ${lastError}`);

      if (step.onError === "stop") {
        overallStatus = "failed";
        break;
      } else {
        // skip — on continue
        overallStatus = "partial";
      }
    }
  }

  // Si pas d'échec explicite, vérifier si toutes les étapes sont ok
  if (overallStatus === "success") {
    const hasFailed = stepResults.some((s) => s.status === "failed");
    if (hasFailed) overallStatus = "partial";
  }

  const completedAt = new Date().toISOString();
  console.log(`[Workflow] ■ Terminé: "${workflow.name}" → ${overallStatus}`);

  // Finaliser le suivi temps réel
  clearInterval(elapsedTimer);
  runState.status = overallStatus;
  runState.completedAt = completedAt;
  runState.progress = 100;
  runState.elapsedMs = Date.now() - startTime;
  runState.currentStepId = null;
  runState.currentStepAction = null;

  // Garder l'état final visible pendant 10s, puis nettoyer
  setTimeout(() => {
    activeRuns.delete(workflow.id);
  }, 10_000);

  // Mise à jour de l'état du workflow
  workflow.lastRunAt = Date.now();
  workflow.lastRunStatus = overallStatus;
  workflows.set(workflow.id, workflow);

  // Persistance en BDD
  if (supabase) {
    const { error: dbErr } = await supabase
      .from("workflows")
      .update({ last_run_at: completedAt, last_run_status: overallStatus })
      .eq("id", workflow.id);
    if (dbErr) console.error("[Workflow] DB update failed:", dbErr);
  }

  return { workflowId: workflow.id, workflowName: workflow.name, status: overallStatus, startedAt, completedAt, steps: stepResults };
}

// ─── CRUD operations ──────────────────────────────────────────────────────────

export async function createWorkflow(input: z.input<typeof createWorkflowSchema>): Promise<WorkflowDefinition> {
  const parsedInput = createWorkflowSchema.parse(input);
  const id = crypto.randomUUID();
  const workflow: WorkflowDefinition = {
    id,
    name: parsedInput.name,
    description: parsedInput.description,
    steps: parsedInput.steps.map((s) => ({
      id: s.id,
      action: s.action,
      args: s.args,
      label: s.label,
      condition: s.condition,
      onError: s.onError || "stop",
      maxRetries: s.maxRetries,
    })),
    schedule: parsedInput.schedule,
    enabled: true,
    createdAt: Date.now(),
  };

  // Persistance BDD
  if (supabase) {
    const { error } = await supabase.from("workflows").insert({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps,
      schedule: workflow.schedule || null,
      enabled: workflow.enabled,
    });
    if (error) {
      console.error("[Workflow] DB insert failed:", error);
    }
  }

  workflows.set(id, workflow);

  // Planification si schedule défini
  if (workflow.schedule) {
    scheduleWorkflow(workflow);
  }

  return workflow;
}

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return workflows.get(id);
}

export function listWorkflows(): WorkflowDefinition[] {
  return Array.from(workflows.values());
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  // Annuler le timer
  const timer = workflowTimers.get(id);
  if (timer) {
    clearInterval(timer);
    workflowTimers.delete(id);
  }

  // Supprimer en BDD
  if (supabase) {
    await supabase.from("workflows").delete().eq("id", id);
  }

  return workflows.delete(id);
}

export async function toggleWorkflow(id: string, enabled: boolean): Promise<WorkflowDefinition | null> {
  const wf = workflows.get(id);
  if (!wf) return null;

  wf.enabled = enabled;
  workflows.set(id, wf);

  if (enabled && wf.schedule) {
    scheduleWorkflow(wf);
  } else {
    const timer = workflowTimers.get(id);
    if (timer) {
      clearInterval(timer);
      workflowTimers.delete(id);
    }
  }

  if (supabase) {
    await supabase.from("workflows").update({ enabled }).eq("id", id);
  }

  return wf;
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

function scheduleWorkflow(workflow: WorkflowDefinition): void {
  // Clear existing timer
  const existing = workflowTimers.get(workflow.id);
  if (existing) {
    clearInterval(existing);
    workflowTimers.delete(workflow.id);
  }

  if (!workflow.schedule || !workflow.enabled) return;

  const intervalMs = parseInterval(workflow.schedule);
  if (!intervalMs) {
    console.warn(`[Workflow] Schedule invalide pour "${workflow.name}": ${workflow.schedule}`);
    return;
  }

  const timer = setInterval(async () => {
    const current = workflows.get(workflow.id);
    if (!current || !current.enabled) return;
    try {
      await executeWorkflow(current);
    } catch (e) {
      console.error(`[Workflow] Scheduled execution failed for "${workflow.name}":`, e);
    }
  }, intervalMs);

  workflowTimers.set(workflow.id, timer);
  console.log(`[Workflow] Planifié: "${workflow.name}" toutes les ${workflow.schedule}`);
}

// ─── Load from DB ─────────────────────────────────────────────────────────────

export async function loadWorkflows(): Promise<void> {
  if (!supabase) return;

  // Clear existing timers
  for (const timer of workflowTimers.values()) {
    clearInterval(timer);
  }
  workflowTimers.clear();
  workflows.clear();

  const { data, error } = await supabase.from("workflows").select("*");

  if (error) {
    console.error("[Workflow] Erreur chargement depuis BDD:", error);
    return;
  }

  if (data) {
    for (const row of data) {
      const wf: WorkflowDefinition = {
        id: row.id,
        name: row.name,
        description: row.description || "",
        steps: row.steps || [],
        schedule: row.schedule || undefined,
        enabled: row.enabled ?? true,
        createdAt: new Date(row.created_at).getTime(),
        lastRunAt: row.last_run_at ? new Date(row.last_run_at).getTime() : undefined,
        lastRunStatus: row.last_run_status || undefined,
      };
      workflows.set(wf.id, wf);

      if (wf.enabled && wf.schedule) {
        scheduleWorkflow(wf);
      }
    }
    console.log(`[Workflow] ${data.length} workflow(s) chargé(s) depuis la BDD.`);
  }
}

export function getWorkflowsSnapshot(): WorkflowDefinition[] {
  return Array.from(workflows.values());
}

/**
 * Arrête tous les timers de planification de workflows.
 * À appeler lors du graceful shutdown du serveur pour éviter les
 * MaxListenersExceededWarning et les exécutions zombies après hot-reload.
 */
export function stopAllWorkflowTimers(): void {
  for (const timer of workflowTimers.values()) {
    clearInterval(timer);
  }
  workflowTimers.clear();
  console.log(`[Workflow] ${workflowTimers.size === 0 ? 'Tous les timers arrêtés.' : 'Arrêt partiel des timers.'}`);
}
