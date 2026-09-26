import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  GitBranch, Play, Pause, Trash2, CheckCircle2, XCircle,
  AlertTriangle, Clock, ChevronDown, ChevronRight, RotateCw,
  Loader2, Activity, Zap, Timer, Hash, Sparkles, MessageSquarePlus, Plus,
} from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { IconButton } from '../ui/IconButton.js';
import { motion, AnimatePresence } from 'motion/react';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';
import { VisualWorkflowBuilder } from '../workflows/VisualWorkflowBuilder.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStepViewModel {
  id: string;
  action: string;
  label?: string;
  onError?: string;
}

export interface WorkflowViewModel {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepViewModel[];
  schedule?: string | null;
  enabled: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: 'success' | 'partial' | 'failed' | null;
}

export interface WorkflowStepRunState {
  stepId: string;
  action: string;
  label?: string;
  status: 'pending' | 'running' | 'success' | 'skipped' | 'failed';
  error?: string;
  durationMs?: number;
  startedAt?: string;
}

export interface WorkflowRunState {
  workflowId: string;
  workflowName: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepId: string | null;
  currentStepAction: string | null;
  progress: number;
  elapsedMs: number;
  steps: WorkflowStepRunState[];
}

interface WorkflowsPanelProps {
  workflows: WorkflowViewModel[];
  onRefresh?: () => Promise<void> | void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status?: string | null, size = 'w-3.5 h-3.5') {
  switch (status) {
    case 'success':
      return <CheckCircle2 className={size} style={{ color: 'var(--color-success)' }} />;
    case 'partial':
      return <AlertTriangle className={size} style={{ color: 'var(--color-warning)' }} />;
    case 'failed':
      return <XCircle className={size} style={{ color: 'var(--color-error)' }} />;
    case 'running':
      return <Loader2 className={`${size} animate-spin`} style={{ color: 'var(--accent-primary)' }} />;
    default:
      return <Clock className={size} style={{ color: 'var(--text-dimmed)' }} />;
  }
}

function statusLabel(status?: string | null) {
  switch (status) {
    case 'success': return 'Succès';
    case 'partial': return 'Partiel';
    case 'failed':  return 'Échoué';
    case 'running': return 'En cours…';
    default:        return 'Jamais exécuté';
  }
}

function statusColor(status?: string | null) {
  switch (status) {
    case 'success': return 'var(--color-success)';
    case 'partial': return 'var(--color-warning)';
    case 'failed':  return 'var(--color-error)';
    case 'running': return 'var(--accent-primary)';
    default:        return 'var(--text-dimmed)';
  }
}

function stepStatusIcon(status: string) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent-primary)' }} />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} />;
    case 'skipped':
      return <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />;
    default:
      return <Clock className="w-3.5 h-3.5" style={{ color: 'var(--text-dimmed)', opacity: 0.4 }} />;
  }
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return 'Jamais';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'À l\'instant';
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.round(diff / 3_600_000)}h`;
  return `il y a ${Math.round(diff / 86_400_000)}j`;
}

function formatElapsed(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

// ─── Active Run Tracker ───────────────────────────────────────────────────────

function ActiveRunTracker({ run }: { run: WorkflowRunState }) {
  const isFinished = run.status !== 'running';
  const color = statusColor(run.status);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl border-2 overflow-hidden"
      style={{
        borderColor: color,
        backgroundColor: 'var(--bg-secondary)',
        boxShadow: !isFinished ? `0 0 20px ${color}20, 0 4px 12px rgba(0,0,0,0.1)` : '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      {/* Header avec pulsation */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            {!isFinished && (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ backgroundColor: color }}
                animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
            <div
              className="relative w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              {!isFinished ? (
                <Activity className="w-4 h-4" style={{ color }} />
              ) : (
                statusIcon(run.status, 'w-4 h-4')
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                {run.workflowName}
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold uppercase px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${color}20`, color }}
                >
                  {statusLabel(run.status)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm" style={{ color: 'var(--text-dimmed)' }}>
              <span className="inline-flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {formatElapsed(run.elapsedMs)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Hash className="w-3 h-3" />
                Étape {run.currentStepIndex + 1}/{run.totalSteps}
              </span>
              {!isFinished && run.currentStepAction && (
                <span className="inline-flex items-center gap-1 font-mono text-xs" style={{ color }}>
                  <Zap className="w-3 h-3" />
                  {run.currentStepAction}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Barre de progression */}
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
          <motion.div
            className="h-full rounded-full relative overflow-hidden"
            initial={{ width: 0 }}
            animate={{ width: `${run.progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ backgroundColor: color }}
          >
            {!isFinished && (
              <motion.div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                }}
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </motion.div>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
            {run.progress}%
          </span>
        </div>
      </div>

      {/* Détail des étapes */}
      <div
        className="border-t px-4 py-3"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(0,0,0,0.06)' }}
      >
        <div className="flex flex-col gap-2">
          {run.steps.map((step, idx) => {
            const isActive = step.status === 'running';
            const isDone = step.status === 'success' || step.status === 'skipped';
            return (
              <motion.div
                key={step.stepId}
                className="flex items-center gap-3 rounded-lg px-3 py-2 transition-all"
                style={{
                  backgroundColor: isActive ? `${color}10` : 'transparent',
                  border: isActive ? `1px solid ${color}30` : '1px solid transparent',
                  opacity: step.status === 'pending' ? 0.4 : 1,
                }}
                animate={isActive ? { scale: [1, 1.01, 1] } : {}}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                {/* Ligne verticale de connexion */}
                <div className="flex flex-col items-center gap-0.5">
                  {stepStatusIcon(step.status)}
                  {idx < run.steps.length - 1 && (
                    <div
                      className="w-px h-2 mt-0.5"
                      style={{ backgroundColor: isDone ? 'var(--color-success)' : 'var(--border-base)' }}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <span
                    className="text-sm font-semibold block truncate"
                    style={{
                      color: isActive ? color : 'var(--text-primary)',
                    }}
                  >
                    {step.label || step.action}
                  </span>
                  {step.label && (
                    <span className="text-xs font-mono block" style={{ color: 'var(--text-dimmed)' }}>
                      {step.action}
                    </span>
                  )}
                  {step.error && (
                    <span className="text-xs block mt-0.5 truncate" style={{ color: 'var(--color-error)' }} title={step.error}>
                      ⚠ {step.error}
                    </span>
                  )}
                </div>

                {step.durationMs != null && (
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                    {formatElapsed(step.durationMs)}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const WorkflowsPanel = React.memo(function WorkflowsPanel({ workflows, onRefresh }: WorkflowsPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<WorkflowRunState[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { sendTextMessage, connected } = useLiveAPIContext();

  const GUIDED_CREATION_PROMPT =
    'Je veux créer un nouveau workflow. Guide-moi étape par étape : demande-moi le nom, la description, les étapes (action + arguments), la planification si nécessaire, puis crée-le.';

  // Polling des exécutions actives
  const fetchActiveRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows/active-runs');
      const data = await res.json();
      if (Array.isArray(data?.runs)) {
        setActiveRuns(data.runs);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchActiveRuns();
    const hasRunning = activeRuns.some(r => r.status === 'running');
    const pollRef = setInterval(fetchActiveRuns, hasRunning ? 500 : 4000);
    return () => { clearInterval(pollRef); };
  }, [fetchActiveRuns, activeRuns.some(r => r.status === 'running')]);

  // Refresh quand un run se termine
  useEffect(() => {
    if (activeRuns.some(r => r.status !== 'running')) {
      onRefresh?.();
    }
  }, [activeRuns, onRefresh]);

  const runAction = useCallback(async (url: string, method: 'POST' | 'DELETE' = 'POST', body?: object) => {
    setBusyId(url);
    try {
      await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      await fetchActiveRuns();
      await onRefresh?.();
    } finally {
      setBusyId(null);
    }
  }, [onRefresh, fetchActiveRuns]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const getRunForWorkflow = (id: string) => activeRuns.find(r => r.workflowId === id);

  const [isBuilderOpen, setIsBuilderOpen] = useState(false);

  return (
    <>
      <VisualWorkflowBuilder
        isOpen={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        onSaved={() => {
          onRefresh?.();
        }}
      />
      <Panel
        title="Workflows"
        icon={<GitBranch className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsBuilderOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all bg-[var(--accent-subtle)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-white border border-[var(--border-base)] shadow-sm"
              title="Créer un workflow visuel low-code"
            >
              <Plus className="w-3.5 h-3.5" /> Nouveau Workflow Visuel
            </button>
            {activeRuns.some(r => r.status === 'running') && (
              <span
                className="text-xs font-bold uppercase px-2 py-0.5 rounded-full animate-pulse"
                style={{ backgroundColor: 'rgba(14,165,233,0.15)', color: 'var(--accent-primary)' }}
              >
                {activeRuns.filter(r => r.status === 'running').length} en cours
              </span>
            )}
            <motion.button
              id="workflow-create-assistant-btn"
              onClick={() => sendTextMessage(GUIDED_CREATION_PROMPT)}
              disabled={!connected}
              whileHover={{ scale: connected ? 1.05 : 1 }}
              whileTap={{ scale: connected ? 0.95 : 1 }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
              style={{
                background: connected
                  ? 'linear-gradient(135deg, var(--accent-primary), var(--color-accent-alt))'
                  : 'var(--bg-secondary)',
                color: connected ? 'white' : 'var(--text-muted)',
                boxShadow: connected ? '0 2px 8px rgba(14,165,233,0.3)' : 'none',
              }}
              title={connected ? 'Créer un workflow avec l\'assistant' : 'Connectez l\'assistant pour créer un workflow'}
              aria-label="Créer un workflow guidé via l'assistant"
            >
              <Sparkles size={11} />
              Créer
            </motion.button>
            <IconButton
              icon={<RotateCw className="w-3.5 h-3.5" />}
              onClick={() => onRefresh?.()}
              tooltip="Rafraîchir"
              aria-label="Rafraîchir les workflows"
            />
          </div>
        }
      >
      <div className="flex flex-col gap-3">
        {/* ─── Exécutions actives ─── */}
        <AnimatePresence>
          {activeRuns.map(run => (
            <ActiveRunTracker key={`run-${run.workflowId}`} run={run} />
          ))}
        </AnimatePresence>

        {/* Séparateur */}
        {activeRuns.length > 0 && workflows.length > 0 && (
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-base)' }} />
            <span className="text-xs uppercase font-bold tracking-widest" style={{ color: 'var(--text-dimmed)' }}>
              Tous les workflows
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-base)' }} />
          </div>
        )}

        {/* ─── Liste des workflows ─── */}
        {workflows.length === 0 && activeRuns.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border-2 border-dashed px-5 py-7 text-center flex flex-col items-center gap-3"
            style={{ borderColor: 'var(--border-base)' }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(14,165,233,0.1), rgba(124,58,237,0.1))' }}
            >
              <GitBranch className="w-5 h-5" style={{ color: 'var(--accent-primary)', opacity: 0.7 }} />
            </div>
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>Aucun workflow configuré</p>
              <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>L'assistant peut t'en créer un en quelques questions.</p>
            </div>
            <motion.button
              id="workflow-create-assistant-empty-btn"
              onClick={() => sendTextMessage(GUIDED_CREATION_PROMPT)}
              disabled={!connected}
              whileHover={{ scale: connected ? 1.04 : 1 }}
              whileTap={{ scale: connected ? 0.96 : 1 }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{
                background: connected
                  ? 'linear-gradient(135deg, var(--accent-primary), var(--color-accent-alt))'
                  : 'var(--bg-secondary)',
                color: connected ? 'white' : 'var(--text-muted)',
                boxShadow: connected ? '0 4px 14px rgba(14,165,233,0.25)' : 'none',
              }}
              aria-label="Créer un workflow guidé via l'assistant"
            >
              <MessageSquarePlus size={13} />
              Créer un workflow avec l'assistant
            </motion.button>
            {!connected && (
              <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>Connectez l'assistant pour commencer</p>
            )}
          </motion.div>
        ) : (
          <div className="grid gap-2">
            {workflows.map((wf) => {
              const isExpanded = expandedId === wf.id;
              const activeRun = getRunForWorkflow(wf.id);
              const isRunning = activeRun?.status === 'running';
              const displayStatus = isRunning ? 'running' : wf.lastRunStatus;

              return (
                <motion.div
                  key={wf.id}
                  layout
                  className="rounded-xl border overflow-hidden transition-all duration-200"
                  style={{
                    borderColor: isRunning ? 'var(--accent-primary)' : 'var(--border-base)',
                    backgroundColor: 'var(--bg-secondary)',
                    boxShadow: isRunning ? '0 0 12px rgba(14,165,233,0.1)' : undefined,
                  }}
                >
                  {/* Header */}
                  <div className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      {/* Status orb */}
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: `${statusColor(displayStatus)}15` }}
                      >
                        {isRunning ? (
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />
                        ) : (
                          <GitBranch className="w-4 h-4" style={{ color: statusColor(displayStatus) }} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Title row */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {wf.name}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {!wf.enabled && (
                              <span
                                className="text-xs font-bold uppercase px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'rgba(107,114,128,0.15)', color: 'var(--text-muted)' }}
                              >
                                Pausé
                              </span>
                            )}
                            {wf.schedule && (
                              <span
                                className="text-xs font-mono px-2 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: 'rgba(14, 165, 233, 0.1)',
                                  color: 'var(--accent-primary)',
                                  border: '1px solid rgba(14, 165, 233, 0.2)',
                                }}
                              >
                                ⏱ {wf.schedule}
                              </span>
                            )}
                          </div>
                        </div>

                        {wf.description && (
                          <p className="text-sm mt-1 line-clamp-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {wf.description}
                          </p>
                        )}

                        {/* Meta row */}
                        <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                          <span className="inline-flex items-center gap-1">
                            <Hash className="w-3 h-3" />
                            {wf.steps.length} étape{wf.steps.length > 1 ? 's' : ''}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 font-semibold"
                            style={{ color: statusColor(displayStatus) }}
                          >
                            {statusIcon(displayStatus, 'w-3 h-3')}
                            {statusLabel(displayStatus)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Timer className="w-3 h-3" />
                            {isRunning ? formatElapsed(activeRun!.elapsedMs) : formatRelativeTime(wf.lastRunAt)}
                          </span>
                        </div>

                        {/* Mini progress bar quand en cours */}
                        {isRunning && activeRun && (
                          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                            <motion.div
                              className="h-full rounded-full"
                              animate={{ width: `${activeRun.progress}%` }}
                              transition={{ duration: 0.3 }}
                              style={{ backgroundColor: 'var(--accent-primary)' }}
                            />
                          </div>
                        )}

                        {/* Actions */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => runAction(`/api/workflows/${wf.id}/run`)}
                            disabled={busyId !== null || isRunning}
                            className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors hover:bg-[var(--bg-primary)]"
                            style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                          >
                            {isRunning ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> En cours…</>
                            ) : (
                              <><Play className="w-3 h-3" /> Exécuter</>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction(`/api/workflows/${wf.id}/toggle`, 'POST', { enabled: !wf.enabled })}
                            disabled={busyId !== null}
                            className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors hover:bg-[var(--bg-primary)]"
                            style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                          >
                            <Pause className="w-3 h-3" />
                            {wf.enabled ? 'Pause' : 'Reprendre'}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExpand(wf.id)}
                            className="rounded-lg border px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 transition-colors hover:bg-[var(--bg-primary)]"
                            style={{ borderColor: 'var(--border-base)', color: 'var(--text-dimmed)' }}
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            Pipeline
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction(`/api/workflows/${wf.id}`, 'DELETE')}
                            disabled={busyId !== null || isRunning}
                            className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors hover:bg-red-500/5"
                            style={{ borderColor: 'var(--border-base)', color: 'var(--color-error)' }}
                          >
                            <Trash2 className="w-3 h-3" /> Supprimer
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded: pipeline details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div
                          className="border-t px-4 py-3"
                          style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(0,0,0,0.04)' }}
                        >
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-dimmed)' }}>
                              Pipeline — {wf.steps.length} étapes
                            </div>
                            {wf.schedule && (
                              <span className="text-xs font-mono px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: 'rgba(14,165,233,0.08)', color: 'var(--accent-primary)' }}>
                                Toutes les {wf.schedule}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {wf.steps.map((step, idx) => {
                              const liveStep = activeRun?.steps[idx];
                              const liveStatus = liveStep?.status;
                              const isStepActive = liveStatus === 'running';

                              return (
                                <div
                                  key={step.id}
                                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                                  style={{
                                    backgroundColor: isStepActive ? 'rgba(14,165,233,0.08)' : 'transparent',
                                    border: isStepActive ? '1px solid rgba(14,165,233,0.2)' : '1px solid transparent',
                                    opacity: liveStatus === 'pending' ? 0.4 : 1,
                                  }}
                                >
                                  {liveStatus ? (
                                    stepStatusIcon(liveStatus)
                                  ) : (
                                    <span
                                      className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
                                      style={{ backgroundColor: 'rgba(14,165,233,0.1)', color: 'var(--accent-primary)' }}
                                    >
                                      {idx + 1}
                                    </span>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <span
                                      className="text-sm font-semibold block truncate"
                                      style={{ color: isStepActive ? 'var(--accent-primary)' : 'var(--text-primary)' }}
                                    >
                                      {step.label || step.action}
                                    </span>
                                    {step.label && (
                                      <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                                        {step.action}
                                      </span>
                                    )}
                                  </div>
                                  {liveStep?.durationMs != null && (
                                    <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                                      {formatElapsed(liveStep.durationMs)}
                                    </span>
                                  )}
                                  {step.onError && step.onError !== 'stop' && (
                                    <span
                                      className="text-xs px-1.5 py-0.5 rounded font-mono font-bold"
                                      style={{
                                        backgroundColor: step.onError === 'retry' ? 'rgba(245,158,11,0.12)' : 'rgba(107,114,128,0.12)',
                                        color: step.onError === 'retry' ? 'var(--color-warning)' : 'var(--text-muted)',
                                      }}
                                    >
                                      {step.onError === 'retry' ? '↻ retry' : '→ skip'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
    </>
  );
});
