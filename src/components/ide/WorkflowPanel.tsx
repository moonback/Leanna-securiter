import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Clock, Play, Pause, Trash2, ChevronRight,
  GitBranch, Zap, Activity, SkipForward,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  action: string;
  label?: string;
  onError?: string;
}

interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  schedule?: string | null;
  enabled: boolean;
  last_run_at?: string | null;
  last_run_status?: 'success' | 'partial' | 'failed' | null;
}

interface StepRunState {
  stepId: string;
  action: string;
  label?: string;
  status: 'pending' | 'running' | 'success' | 'skipped' | 'failed';
  error?: string;
  durationMs?: number;
}

interface ActiveRun {
  workflowId: string;
  workflowName: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepAction: string | null;
  progress: number;
  elapsedMs: number;
  steps: StepRunState[];
}

interface WorkflowPanelProps {
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status?: string | null): string {
  switch (status) {
    case 'success': return 'var(--color-success)';
    case 'partial': return 'var(--color-warning)';
    case 'failed':  return 'var(--color-error)';
    case 'running': return 'var(--color-accent-alt)';
    default:        return 'var(--text-dimmed)';
  }
}

function statusIcon(status?: string | null, size = 12) {
  switch (status) {
    case 'success': return <CheckCircle2 size={size} style={{ color: 'var(--color-success)' }} />;
    case 'partial': return <AlertTriangle size={size} style={{ color: 'var(--color-warning)' }} />;
    case 'failed': return <XCircle size={size} style={{ color: 'var(--color-error)' }} />;
    case 'running': return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--color-accent-alt)' }} />;
    default: return <Clock size={size} style={{ color: 'var(--text-dimmed)' }} />;
  }
}

function stepStatusIcon(status: string) {
  switch (status) {
    case 'success': return <CheckCircle2 size={11} style={{ color: 'var(--color-success)' }} />;
    case 'running': return <Loader2 size={11} className="animate-spin" style={{ color: 'var(--color-accent-alt)' }} />;
    case 'failed': return <XCircle size={11} style={{ color: 'var(--color-error)' }} />;
    case 'skipped': return <SkipForward size={11} style={{ color: 'var(--text-muted)' }} />;
    default: return <Clock size={11} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />;
  }
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case 'success': return 'Succès';
    case 'partial': return 'Partiel';
    case 'failed':  return 'Échoué';
    case 'running': return 'En cours';
    default:        return 'Jamais lancé';
  }
}

function timeAgo(iso?: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'à l\'instant';
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `il y a ${Math.round(diff / 3_600_000)}h`;
  return `il y a ${Math.round(diff / 86_400_000)}j`;
}

function formatElapsed(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${secs % 60}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkflowPanel({ onClose }: WorkflowPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflows');
      const data = await res.json();
      if (Array.isArray(data?.workflows)) {
        setWorkflows(data.workflows);
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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
    fetchWorkflows();
    fetchActiveRuns();
  }, [fetchWorkflows, fetchActiveRuns]);

  useEffect(() => {
    const hasRunning = activeRuns.some(r => r.status === 'running');
    pollRef.current = setInterval(() => {
      fetchActiveRuns();
      if (hasRunning) fetchWorkflows();
    }, hasRunning ? 800 : 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchActiveRuns, fetchWorkflows, activeRuns]);

  const runWorkflow = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/workflows/${id}/run`, { method: 'POST' });
      await fetchActiveRuns();
    } finally {
      setBusyId(null);
    }
  }, [fetchActiveRuns]);

  const toggleWorkflow = useCallback(async (id: string, enabled: boolean) => {
    setBusyId(id);
    try {
      await fetch(`/api/workflows/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await fetchWorkflows();
    } finally {
      setBusyId(null);
    }
  }, [fetchWorkflows]);

  const deleteWorkflow = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      await fetchWorkflows();
    } finally {
      setBusyId(null);
    }
  }, [fetchWorkflows]);

  const getActiveRun = (id: string) => activeRuns.find(r => r.workflowId === id);
  const runningRuns = activeRuns.filter(r => r.status === 'running');

  return (
    <div
      className="flex flex-col h-full border-l overflow-hidden"
      style={{
        width: '340px',
        minWidth: '340px',
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-panel)',
      }}
    >
      {/* ─── Header ─── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-base)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ backgroundColor: 'rgba(167,139,250,0.1)' }}
          >
            <WorkflowIcon size={13} style={{ color: 'var(--color-accent-alt)' }} />
          </div>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Workflows
          </span>
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-dimmed)' }}>
            {workflows.length}
          </span>
          {runningRuns.length > 0 && (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full animate-pulse"
              style={{ backgroundColor: 'rgba(167,139,250,0.12)', color: 'var(--color-accent-alt)' }}
            >
              {runningRuns.length} actif{runningRuns.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchWorkflows}
            className="p-1.5 rounded-md transition hover:bg-[var(--bg-input)]"
            style={{ color: 'var(--text-muted)' }}
            title="Rafraîchir"
            aria-label="Rafraîchir les workflows"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition hover:bg-[var(--bg-input)]"
            style={{ color: 'var(--text-muted)' }}
            title="Fermer"
            aria-label="Fermer le panneau"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ─── Active run banner ─── */}
      {runningRuns.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--border-base)', backgroundColor: 'rgba(167,139,250,0.03)' }}>
          {runningRuns.map(run => (
            <div key={run.workflowId} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Activity size={10} className="animate-pulse" style={{ color: 'var(--color-accent-alt)' }} />
                <span className="text-sm font-bold truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                  {run.workflowName}
                </span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: 'var(--color-accent-alt)' }}>
                  {run.currentStepIndex + 1}/{run.totalSteps}
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                  {formatElapsed(run.elapsedMs)}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-[4px] rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-input)' }}>
                <motion.div
                  className="h-full rounded-full relative overflow-hidden"
                  animate={{ width: `${run.progress}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  style={{ backgroundColor: 'var(--color-accent-alt)' }}
                >
                  <motion.div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)' }}
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  />
                </motion.div>
              </div>
              {/* Current action */}
              {run.currentStepAction && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-accent-alt)' }}>
                  <Zap size={9} />
                  <span className="font-mono truncate">{run.currentStepAction}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {loading && workflows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center gap-2 px-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(167,139,250,0.1), rgba(99,102,241,0.1))' }}>
              <GitBranch size={18} style={{ color: 'var(--color-accent-alt)', opacity: 0.7 }} />
            </div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Aucun workflow configuré
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dimmed)' }}>
              Demande à Leanna d'en créer un via le chat.<br/>
              Les workflows automatisent des séquences d'actions.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {workflows.map((wf) => {
              const run = getActiveRun(wf.id);
              const isRunning = run?.status === 'running';
              const displayStatus = isRunning ? 'running' : wf.last_run_status;
              const isExpanded = expandedId === wf.id;
              const isBusy = busyId === wf.id;
              const color = statusColor(displayStatus);

              return (
                <div
                  key={wf.id}
                  className="rounded-lg overflow-hidden transition-all"
                  style={{
                    border: `1px solid ${isExpanded ? color + '30' : 'var(--border-base)'}`,
                    backgroundColor: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                  }}
                >
                  {/* ─ Workflow Row ─ */}
                  <div
                    className="group flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]"
                    onClick={() => setExpandedId(isExpanded ? null : wf.id)}
                  >
                    {/* Expand chevron */}
                    <span className="flex-shrink-0 transition-transform" style={{ color: 'var(--text-dimmed)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <ChevronRight size={11} />
                    </span>

                    {/* Status indicator dot */}
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: wf.enabled ? color : 'var(--text-muted)',
                        boxShadow: isRunning ? `0 0 6px ${color}` : 'none',
                      }}
                    />

                    {/* Name */}
                    <span
                      className="text-xs font-semibold truncate flex-1"
                      style={{
                        color: wf.enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                      }}
                    >
                      {wf.name}
                    </span>

                    {/* Schedule badge */}
                    {wf.schedule && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ backgroundColor: 'rgba(167,139,250,0.08)', color: 'var(--color-accent-alt)' }}>
                        {wf.schedule}
                      </span>
                    )}

                    {/* Run time */}
                    {timeAgo(wf.last_run_at) && (
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                        {timeAgo(wf.last_run_at)}
                      </span>
                    )}

                    {/* Quick play button (visible on hover) */}
                    <button
                      onClick={(e) => { e.stopPropagation(); runWorkflow(wf.id); }}
                      disabled={isBusy || isRunning}
                      className="p-1 rounded-md transition opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-input)] disabled:opacity-30"
                      style={{ color: 'var(--color-success)' }}
                      title="Exécuter maintenant"
                      aria-label={`Exécuter ${wf.name}`}
                    >
                      {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                    </button>
                  </div>

                  {/* ─ Expanded detail ─ */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 pt-1 flex flex-col gap-2.5"
                          style={{ borderTop: '1px solid var(--border-base)' }}>
                          
                          {/* Description */}
                          {wf.description && (
                            <p className="text-xs leading-relaxed pl-1 py-1.5 px-2.5 rounded-md"
                              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-primary)' }}>
                              {wf.description}
                            </p>
                          )}

                          {/* Status summary bar */}
                          <div className="flex items-center gap-3 text-xs px-1" style={{ color: 'var(--text-dimmed)' }}>
                            <span className="inline-flex items-center gap-1" style={{ color }}>
                              {statusIcon(displayStatus, 10)}
                              <span className="font-semibold">{statusLabel(displayStatus)}</span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <GitBranch size={9} />
                              {wf.steps.length} étape{wf.steps.length > 1 ? 's' : ''}
                            </span>
                            {!wf.enabled && (
                              <span className="font-bold uppercase text-xs px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'rgba(107,114,128,0.1)', color: 'var(--text-muted)' }}>
                                Pausé
                              </span>
                            )}
                          </div>

                          {/* Steps pipeline */}
                          <div className="flex flex-col gap-0.5 pl-1">
                            {wf.steps.map((step, idx) => {
                              const liveStep = run?.steps[idx];
                              const liveStatus = liveStep?.status;
                              const isStepActive = liveStatus === 'running';

                              return (
                                <div
                                  key={step.id}
                                  className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-md transition-all"
                                  style={{
                                    backgroundColor: isStepActive ? 'rgba(167,139,250,0.06)' : 'transparent',
                                    border: isStepActive ? '1px solid rgba(167,139,250,0.15)' : '1px solid transparent',
                                    opacity: liveStatus === 'pending' ? 0.4 : 1,
                                  }}
                                >
                                  {/* Step number or live status */}
                                  {liveStatus ? stepStatusIcon(liveStatus) : (
                                    <span
                                      className="w-4 h-4 rounded flex items-center justify-center text-xs font-bold flex-shrink-0"
                                      style={{ backgroundColor: 'rgba(167,139,250,0.08)', color: 'var(--color-accent-alt)' }}
                                    >
                                      {idx + 1}
                                    </span>
                                  )}

                                  {/* Step label & action */}
                                  <div className="flex-1 min-w-0">
                                    <span
                                      className="text-sm font-medium block truncate"
                                      style={{ color: isStepActive ? 'var(--color-accent-alt)' : 'var(--text-primary)' }}
                                    >
                                      {step.label || step.action}
                                    </span>
                                    {step.label && (
                                      <span className="text-xs font-mono block truncate"
                                        style={{ color: 'var(--text-dimmed)' }}>
                                        {step.action}
                                      </span>
                                    )}
                                    {/* Show error if failed */}
                                    {liveStep?.error && (
                                      <span className="text-xs block mt-0.5 truncate" style={{ color: 'var(--color-error)' }}
                                        title={liveStep.error}>
                                        ⚠ {liveStep.error}
                                      </span>
                                    )}
                                  </div>

                                  {/* Duration or onError badge */}
                                  {liveStep?.durationMs != null ? (
                                    <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                                      {formatElapsed(liveStep.durationMs)}
                                    </span>
                                  ) : step.onError && step.onError !== 'stop' ? (
                                    <span
                                      className="text-xs px-1.5 py-0.5 rounded font-mono font-bold flex-shrink-0"
                                      style={{
                                        backgroundColor: step.onError === 'retry' ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.1)',
                                        color: step.onError === 'retry' ? 'var(--color-warning)' : 'var(--text-muted)',
                                      }}
                                    >
                                      {step.onError}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-base)' }}>
                            <button
                              onClick={() => runWorkflow(wf.id)}
                              disabled={isBusy || isRunning}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors hover:bg-[var(--bg-input)] disabled:opacity-30"
                              style={{ color: 'var(--color-success)', border: '1px solid var(--border-base)' }}
                              aria-label={`Exécuter ${wf.name}`}
                            >
                              {isRunning ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                              {isRunning ? 'En cours…' : 'Exécuter'}
                            </button>
                            <button
                              onClick={() => toggleWorkflow(wf.id, !wf.enabled)}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors hover:bg-[var(--bg-input)] disabled:opacity-30"
                              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
                              aria-label={wf.enabled ? 'Mettre en pause' : 'Reprendre'}
                            >
                              <Pause size={10} />
                              {wf.enabled ? 'Pause' : 'Reprendre'}
                            </button>
                            <button
                              onClick={() => deleteWorkflow(wf.id)}
                              disabled={isBusy || isRunning}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors hover:bg-red-500/5 disabled:opacity-30 ml-auto"
                              style={{ color: 'var(--color-error)', border: '1px solid var(--border-base)' }}
                              aria-label={`Supprimer ${wf.name}`}
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Footer ─── */}
      <div
        className="px-4 py-2 flex-shrink-0 flex items-center justify-between"
        style={{
          borderTop: '1px solid var(--border-base)',
          backgroundColor: 'var(--bg-base)',
        }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-dimmed)' }}>
          {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
          {workflows.filter(w => w.enabled).length !== workflows.length && (
            <> · {workflows.filter(w => w.enabled).length} actif{workflows.filter(w => w.enabled).length > 1 ? 's' : ''}</>
          )}
        </span>
        {workflows.some(w => w.last_run_status === 'failed') && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--color-error)' }}>
            {workflows.filter(w => w.last_run_status === 'failed').length} en erreur
          </span>
        )}
      </div>
    </div>
  );
}
