import { createClient } from "@supabase/supabase-js";
import { parseIntervalToMs } from "./automationHelpers.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Veuillez configurer SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY pour la persistance des tâches.");
}

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export interface ScheduledTaskDefinition {
    id: string;
    name: string;
    description: string;
    actionName: string;
    args: Record<string, unknown>;
    intervalMs: number;
    intervalExpression: string;
    enabled: boolean;
    createdAt: number;
    lastRunAt?: number;
    lastSuccess?: boolean;
    lastError?: string;
    consecutiveFailures?: number;
}

const scheduledTasks = new Map<string, ScheduledTaskDefinition>();
const taskTimers = new Map<string, NodeJS.Timeout>();

let skillHandler: ((name: string, args: any) => Promise<any>) | null = null;

export function setSchedulerSkillHandler(handler: typeof skillHandler) {
  skillHandler = handler;
}

export function getScheduledTasksSnapshot(): ScheduledTaskDefinition[] {
    return Array.from(scheduledTasks.values());
}

export function getScheduledTask(taskId: string): ScheduledTaskDefinition | undefined {
    return scheduledTasks.get(taskId);
}

function scheduleTask(task: ScheduledTaskDefinition): void {
    if (taskTimers.has(task.id)) {
        clearInterval(taskTimers.get(task.id)!);
        taskTimers.delete(task.id);
    }

    const timer = setInterval(() => {
        void runScheduledTask(task);
    }, task.intervalMs);
    taskTimers.set(task.id, timer);
    scheduledTasks.set(task.id, task);
}

async function runScheduledTask(task: ScheduledTaskDefinition): Promise<void> {
    try {
        if (!skillHandler) {
            return;
        }
        console.log(`[Automation] Exécution planifiée: ${task.name}`);
        const result = await skillHandler(task.actionName, task.args);

        const isErrorResult = result != null && typeof result === 'object' && 'error' in result;
        const success = !isErrorResult;
        const errorMsg = isErrorResult ? (result as any).error : undefined;

        if (!success) {
            console.error(`[Automation] Tâche ${task.name} retournée en erreur:`, errorMsg);
        } else {
            console.log(`[Automation] Résultat planifié ${task.name}:`, result);
        }

        task.lastRunAt = Date.now();
        task.lastSuccess = success;
        task.lastError = errorMsg;
        task.consecutiveFailures = success ? 0 : (task.consecutiveFailures ?? 0) + 1;
        scheduledTasks.set(task.id, { ...task });

        // Mettre à jour en BDD
        await supabase?.from('scheduled_tasks').update({
            last_run_at: new Date(task.lastRunAt).toISOString(),
            last_success: success,
            last_error: errorMsg ?? null,
            consecutive_failures: task.consecutiveFailures,
            enabled: task.enabled && (task.consecutiveFailures ?? 0) < 5,
        }).eq('id', task.id);

        if (!success && (task.consecutiveFailures ?? 0) >= 5) {
            console.warn(`[Automation] Tâche ${task.name} désactivée après 5 échecs consécutifs.`);
            task.enabled = false;
            stopScheduledTask(task.id);
        }

    } catch (error: any) {
        console.error(`[Automation] Échec de la tâche planifiée ${task.name}:`, error);
        task.lastRunAt = Date.now();
        task.lastSuccess = false;
        task.lastError = error?.message ?? String(error);
        task.consecutiveFailures = (task.consecutiveFailures ?? 0) + 1;
        scheduledTasks.set(task.id, { ...task });
        try {
            await supabase?.from('scheduled_tasks').update({
                last_run_at: new Date(task.lastRunAt).toISOString(),
                last_success: false,
                last_error: task.lastError ?? null,
                consecutive_failures: task.consecutiveFailures,
                enabled: task.enabled && (task.consecutiveFailures ?? 0) < 5,
            }).eq('id', task.id);
        } catch (e) { /* ignore DB error after task handler failure */ }

        if ((task.consecutiveFailures ?? 0) >= 5) {
            console.warn(`[Automation] Tâche ${task.name} désactivée après 5 échecs consécutifs.`);
            task.enabled = false;
            stopScheduledTask(task.id);
        }
    }
}

export async function loadScheduledTasks() {
    if (!supabase) return;
    
    // Annuler les timers existants
    for (const timer of taskTimers.values()) {
        clearInterval(timer);
    }
    taskTimers.clear();
    scheduledTasks.clear();

    const { data, error } = await supabase
        .from('scheduled_tasks')
        .select('*')
        .eq('enabled', true);
    if (data) {
        for (const row of data) {
            const task: ScheduledTaskDefinition = {
                id: row.id,
                name: row.name,
                description: row.description,
                actionName: row.action_name,
                args: row.args,
                intervalExpression: row.interval_expression,
                intervalMs: row.interval_ms,
                enabled: row.enabled,
                createdAt: new Date(row.created_at).getTime(),
                lastRunAt: row.last_run_at ? new Date(row.last_run_at).getTime() : undefined,
                lastSuccess: row.last_success ?? undefined,
                lastError: row.last_error ?? undefined,
                consecutiveFailures: row.consecutive_failures ?? 0,
            };
            if (task.intervalMs > 0) {
                scheduleTask(task);
            }
        }
    }
}

function stopScheduledTask(taskId: string): boolean {
    const timer = taskTimers.get(taskId);
    if (timer) {
        clearInterval(timer);
        taskTimers.delete(taskId);
    }
    return scheduledTasks.delete(taskId);
}

export function pauseScheduledTask(taskId: string) {
    const task = scheduledTasks.get(taskId);
    if (!task) return { status: 'not_found', message: `Tâche ${taskId} introuvable.` };
    if (!task.enabled) return { status: 'already_paused', message: `Tâche ${taskId} déjà en pause.` };
    task.enabled = false;
    const timer = taskTimers.get(taskId);
    if (timer) {
        clearInterval(timer);
        taskTimers.delete(taskId);
    }
    scheduledTasks.set(taskId, task);
    return { status: 'paused', message: `Tâche ${taskId} mise en pause.` };
}

export function resumeScheduledTask(taskId: string) {
    const task = scheduledTasks.get(taskId);
    if (!task) return { status: 'not_found', message: `Tâche ${taskId} introuvable.` };
    if (task.enabled) return { status: 'already_active', message: `Tâche ${taskId} déjà active.` };
    task.enabled = true;
    scheduleTask(task);
    return { status: 'resumed', message: `Tâche ${taskId} reprise.` };
}

export async function runScheduledTaskNow(taskId: string) {
    const task = scheduledTasks.get(taskId);
    if (!task) return { status: 'not_found', message: `Tâche ${taskId} introuvable.` };
    await runScheduledTask(task);
    return { status: 'success', message: `Exécution immédiate lancée pour ${task.name}.` };
}

export function cancelScheduledTask(taskId: string) {
    return stopScheduledTask(taskId);
}

export function stopAllScheduledTasks(): void {
  for (const timer of taskTimers.values()) {
    clearInterval(timer);
  }
  taskTimers.clear();
  console.log('[Automation] Tous les timers de tâches planifiées arrêtés.');
}

// ─── Scheduler Handlers ────────────────────────────────────────────────────────

export async function handleScheduleTask(validated: {
    name: string;
    description: string;
    actionName: string;
    args: Record<string, unknown>;
    intervalSeconds?: number;
    intervalMinutes?: number;
    intervalHours?: number;
    interval?: string;
}) {
    const intervalMs = parseIntervalToMs(validated);

    if (!intervalMs) {
        return { error: "Intervalle invalide." };
    }

    // Insérer en BDD
    const result = await supabase?.from('scheduled_tasks').insert({
        name: validated.name,
        description: validated.description,
        action_name: validated.actionName,
        args: validated.args,
        interval_expression: validated.interval || "N/A"
    }).select().single();

    const data = result?.data;
    const error = result?.error;

    if (error || !data) {
        return { error: "Impossible de créer la tâche en BDD." };
    }

    const taskId = data.id;
    const task: ScheduledTaskDefinition = {
        id: taskId,
        name: validated.name,
        description: validated.description,
        actionName: validated.actionName,
        args: validated.args,
        intervalExpression: data.interval_expression,
        intervalMs,
        enabled: true,
        createdAt: new Date(data.created_at).getTime(),
    };

    scheduleTask(task);
    void runScheduledTask(task);

    return {
        status: "success",
        taskId,
        intervalMs,
        nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
        message: `Tâche planifiée: ${validated.name}`
    };
}

export async function handleListScheduledTasks() {
    return {
        status: "success",
        tasks: Array.from(scheduledTasks.values()).map(task => ({
            id: task.id,
            name: task.name,
            description: task.description,
            actionName: task.actionName,
            intervalMs: task.intervalMs,
            createdAt: task.createdAt,
            lastRunAt: task.lastRunAt,
        }))
    };
}

export async function handleCancelScheduledTask(validated: { taskId: string }) {
    // Supprimer en BDD
    const deleteResult = await supabase?.from('scheduled_tasks').delete().eq('id', validated.taskId);
    if (deleteResult?.error) {
        return { error: "Impossible de supprimer la tâche en BDD." };
    }

    const cancelled = stopScheduledTask(validated.taskId);
    return {
        status: cancelled ? "success" : "not_found",
        message: cancelled ? `Tâche ${validated.taskId} annulée.` : `Tâche ${validated.taskId} introuvable.`
    };
}
