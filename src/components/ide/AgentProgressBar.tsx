import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  CheckCircle2, AlertCircle, Loader2, ChevronDown, X, Clock,
  FileText, FilePen, Search, Trash2, Globe, Brain, Users,
  Database, LayoutGrid, Terminal, Info,
} from 'lucide-react';
import type { ActivityStep, ReasoningState } from '../../hooks/useLiveAPI.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentProgressBarProps {
  steps: ActivityStep[];
  connected: boolean;
  onClear?: () => void;
  reasoning?: ReasoningState;
}

type StepStatus = 'running' | 'done' | 'error' | 'pending';
type ToolCategory = 'file-read' | 'file-write' | 'file-delete' | 'search' | 'web' | 'agent' | 'reasoning' | 'memory' | 'system' | 'other';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msElapsed(ts: Date): string {
  if (!(ts instanceof Date)) ts = new Date(ts);
  const ms = Date.now() - ts.getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

function msBetween(a: Date, b: Date): string {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

function stepDuration(step: ActivityStep): string | null {
  if (!step.endTimestamp) return null;
  return msBetween(new Date(step.timestamp), new Date(step.endTimestamp));
}

function getStepStatus(step: ActivityStep): StepStatus {
  if (step.status === 'running') return 'running';
  if (step.status === 'done') return 'done';
  if (step.status === 'error') return 'error';
  return 'pending';
}

// ─── Tool categorisation ──────────────────────────────────────────────────────

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read_project_file: 'file-read',  list_project_files: 'file-read',
  analyze_project_file: 'file-read', open_project_file: 'file-read',
  write_project_file: 'file-write', modify_project_file: 'file-write',
  create_project_directory: 'file-write', rename_project_file: 'file-write',
  patch_project_file: 'file-write',
  delete_project_file: 'file-delete',
  delete_project_folder: 'file-delete',
  search_in_files: 'search', automation_search: 'search',
  automation_navigate: 'web', automation_snapshot: 'web',
  automation_click: 'web', automation_type: 'web', automation_extract: 'web',
  agent_delegate: 'agent', agent_orchestrate: 'agent', agent_status: 'agent',
  agent_list_tasks: 'agent', agent_list_roles: 'agent',
  agent_cancel: 'agent', agent_stats: 'agent',
  reasoning_think: 'reasoning', reasoning_delegate_task: 'reasoning',
  reasoning_list_strategies: 'reasoning',
  save_memory: 'memory', search_memory: 'memory',
  get_workspace_info: 'system', generate_codebase_markdown: 'system',
  open_ide: 'system',
  create_rich_document: 'other',
};

function getCat(tool: string): ToolCategory {
  return TOOL_CATEGORIES[tool] ?? 'other';
}

const CAT_COLOR: Record<ToolCategory, string> = {
  'file-read':   'var(--accent-primary)',
  'file-write':  'var(--color-success)',
  'file-delete': 'var(--color-error)',
  'search':      'var(--color-warning)',
  'web':         'var(--accent-secondary)',
  'agent':       'var(--color-accent-alt)',
  'reasoning':   'var(--accent-primary)',
  'memory':      'var(--accent-secondary)',
  'system':      'var(--text-muted)',
  'other':       'var(--text-dimmed)',
};

const CAT_LABEL: Record<ToolCategory, string> = {
  'file-read': 'lecture', 'file-write': 'écriture', 'file-delete': 'suppression',
  'search': 'recherche', 'web': 'web', 'agent': 'agent',
  'reasoning': 'raisonnement', 'memory': 'mémoire', 'system': 'système', 'other': 'outil',
};

const TOOL_LABEL: Record<string, string> = {
  read_project_file: 'lecture', write_project_file: 'écriture',
  modify_project_file: 'modification', patch_project_file: 'patch',
  list_project_files: 'liste fichiers', search_in_files: 'recherche',
  delete_project_file: 'suppression', delete_project_folder: 'suppression dossier', analyze_project_file: 'analyse',
  open_project_file: 'ouverture', create_project_directory: 'dossier',
  rename_project_file: 'renommage', agent_delegate: 'délégation',
  agent_orchestrate: 'orchestration', agent_status: 'statut agent',
  reasoning_think: 'raisonnement', save_memory: 'mémoire+',
  search_memory: 'recherche mémoire', automation_search: 'recherche web',
  automation_navigate: 'navigation', automation_snapshot: 'capture',
  automation_click: 'clic', automation_type: 'saisie',
  get_workspace_info: 'workspace', open_ide: 'IDE',
  create_rich_document: 'document riche',
};

function toolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? tool.replace(/_/g, ' ').toLowerCase();
}

// ─── Micro-icons ─────────────────────────────────────────────────────────────

const CatIcon = memo(function CatIcon({ tool, size = 10 }: { tool: string; size?: number }) {
  const cat = getCat(tool);
  const s = { color: CAT_COLOR[cat], width: size, height: size, flexShrink: 0 as const };
  switch (cat) {
    case 'file-read':   return <FileText style={s} />;
    case 'file-write':  return <FilePen style={s} />;
    case 'file-delete': return <Trash2 style={s} />;
    case 'search':      return <Search style={s} />;
    case 'web':         return <Globe style={s} />;
    case 'agent':       return <Users style={s} />;
    case 'reasoning':   return <Brain style={s} />;
    case 'memory':      return <Database style={s} />;
    case 'system':      return <LayoutGrid style={s} />;
    default:            return <Terminal style={s} />;
  }
});

// ─── ReasoningPanel ───────────────────────────────────────────────────────────

const COMPLEXITY_LABEL: Record<string, { label: string; color: string }> = {
  simple:   { label: 'Direct',           color: 'var(--text-muted)' },
  moderate: { label: 'Chain of Thought', color: 'var(--accent-secondary)' },
  complex:  { label: 'CoT complet',      color: 'var(--color-accent-alt)' },
  critical: { label: 'Tree-of-Thought',  color: 'var(--color-warning)' },
};

const ReasoningPanel = memo(function ReasoningPanel({ reasoning }: { reasoning?: ReasoningState }) {
  const reduceMotion = useReducedMotion();

  if (!reasoning || (!reasoning.active && !reasoning.steps?.length)) return null;

  const meta = reasoning.complexity ? COMPLEXITY_LABEL[reasoning.complexity] : null;
  const steps = reasoning.steps ?? [];
  const doneCount = steps.filter(s => s.status === 'done').length;
  const total = reasoning.totalSteps ?? steps.length;
  const progress = total > 0 ? Math.min(100, Math.round((doneCount / total) * 100)) : reasoning.active ? 18 : 100;
  const statusLabel = reasoning.active ? 'En cours' : reasoning.cached ? 'Instantané' : 'Terminé';
  const statusColor = reasoning.active ? 'var(--color-warning)' : 'var(--color-success)';
  const streamPreview = reasoning.streamText?.trim();

  return (
    <div
      className="border-t px-3 py-2.5"
      style={{ borderColor: 'color-mix(in srgb, var(--color-accent-alt) 18%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-accent-alt) 4%, transparent)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <motion.div
          animate={reasoning.active && !reduceMotion ? { rotate: 360 } : {}}
          transition={reasoning.active && !reduceMotion ? { duration: 2, repeat: Infinity, ease: 'linear' } : {}}
        >
          <Brain style={{ width: 14, height: 14, color: 'var(--color-accent-alt)' }} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm tracking-wide font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {reasoning.strategyLabel ?? 'Raisonnement'}
            </span>
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            {reasoning.announcement ?? (reasoning.active ? 'Analyse des options en cours…' : 'Analyse terminée')}
          </div>
        </div>
        {meta && (
          <span
            className="text-xs tracking-wide px-1 py-px rounded font-mono"
            style={{
              backgroundColor: 'color-mix(in srgb, ' + meta.color + ' 14%, transparent)',
              color: meta.color,
              border: '1px solid color-mix(in srgb, ' + meta.color + ' 25%, transparent)'
            }}
          >
            {meta.label}
          </span>
        )}
        <span className="text-xs tracking-wide tabular-nums font-mono" style={{ color: 'var(--text-secondary)' }}>
          {total > 0 ? `${doneCount}/${total}` : `${progress}%`}
        </span>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--text-muted) 18%, transparent)' }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: reduceMotion ? 0.1 : 0.45, ease: 'easeOut' }}
          style={{ backgroundColor: statusColor }}
        />
      </div>

      {streamPreview && (
        <div className="mt-2 max-h-16 overflow-hidden rounded-md px-2 py-1.5 text-[11px] leading-relaxed font-mono" style={{ color: 'var(--text-secondary)', backgroundColor: 'color-mix(in srgb, var(--bg-base) 45%, transparent)', border: '1px solid color-mix(in srgb, var(--border-base) 60%, transparent)' }}>
          {streamPreview.slice(-420)}{reasoning.active ? ' ▍' : ''}
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <div className="pt-2 space-y-0.5">
          {steps.map((step) => {
            const isRun = step.status === 'running';
            const isDone = step.status === 'done';
            const isFail = step.status === 'failed';
            const color = isRun ? 'var(--color-accent-alt)' : isDone ? 'var(--color-success)' : isFail ? 'var(--color-error)' : 'var(--text-muted)';
            return (
              <div key={step.index} className="flex items-baseline gap-2">
                {isRun
                  ? <Loader2 style={{ width: 9, height: 9, color, flexShrink: 0 }} className={reduceMotion ? '' : 'animate-spin mt-px'} />
                  : isDone
                    ? <CheckCircle2 style={{ width: 9, height: 9, color, flexShrink: 0 }} className="mt-px" />
                    : isFail
                      ? <AlertCircle style={{ width: 9, height: 9, color, flexShrink: 0 }} className="mt-px" />
                      : <div className="w-1 h-1 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: color }} />
                }
                <span
                  className="text-sm tracking-wide leading-snug truncate"
                  style={{ color: isRun ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isRun ? 600 : 400 }}
                >
                  {step.label}
                </span>
                {step.durationMs !== undefined && (
                  <span className="text-xs tracking-wide tabular-nums font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                    {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {reasoning.active && steps.length === 0 && (
        <div className="flex items-center gap-1.5 pt-2">
          {reduceMotion ? (
            [0, 1, 2].map(i => (
              <div key={`dot-${i}`} className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--color-accent-alt)', opacity: 0.6 }} />
            ))
          ) : (
            [0, 1, 2].map(i => (
              <motion.div
                key={`dot-${i}`}
                className="w-1 h-1 rounded-full"
                style={{ backgroundColor: 'var(--color-accent-alt)' }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
              />
            ))
          )}
          <span className="text-xs tracking-wide" style={{ color: 'var(--text-dimmed)' }}>Analyse…</span>
        </div>
      )}
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export function AgentProgressBar({ steps, connected, onClear, reasoning }: AgentProgressBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const reduceMotion = useReducedMotion();

  const runningStep = useMemo(() => [...steps].reverse().find(s => s.status === 'running'), [steps]);
  const isWorking   = !!runningStep;
  const doneCount   = useMemo(() => steps.filter(s => s.status === 'done').length, [steps]);
  const errorCount  = useMemo(() => steps.filter(s => s.status === 'error').length, [steps]);
  const total       = steps.length;
  const pct         = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const totalDur = useMemo(() => {
    if (!steps.length) return '0s';
    const first = new Date(steps[0].timestamp);
    const last  = new Date(steps[steps.length - 1].timestamp);
    return msBetween(first, isWorking ? new Date() : last);
  }, [steps, isWorking]);

  // Critically-damped default spring for state-driven UI (§4 / Quick Reference).
  // Reduced motion gets a short, non-bouncy fade/step instead of a spring.
  const uiSpring = reduceMotion
    ? { duration: 0.12, ease: 'linear' as const }
    : { type: 'spring' as const, bounce: 0, duration: 0.35 };

  const toggleExpand = useCallback(() => setExpanded(v => !v), []);

  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [steps.length, expanded]);

  useEffect(() => {
    if (isWorking && steps.length <= 2) setExpanded(true);
  }, [isWorking, steps.length]);

  useEffect(() => {
    if (!isWorking) return;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [isWorking]);

  if (!connected || steps.length === 0) return null;

  const accentColor = isWorking ? 'var(--accent-primary)' : errorCount > 0 ? 'var(--color-warning)' : 'var(--color-success)';

  return (
    <div
      className="border-t select-none"
      style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
    >
      {/* ── Splash-style progress bar ── */}
      <div
        className="relative h-[5px] w-full overflow-hidden rounded"
        style={{ backgroundColor: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}
      >
        <motion.div
          className="absolute inset-y-0 left-0 rounded"
          style={{ backgroundColor: accentColor }}
          animate={{ width: `${pct}%` }}
          transition={uiSpring}
        />
        {/* Splash-style shimmer sweep, omitted when motion is reduced. */}
        {isWorking && !reduceMotion && (
          <motion.div
            className="absolute inset-y-0 w-1/4"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent)' }}
            animate={{ left: ['-25%', '100%'] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>

      {/* ── Compact header (single row, ~32px tall) ── */}
      <motion.div
        className="flex items-center gap-2 px-3 h-8 cursor-pointer group"
        onClick={toggleExpand}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); }}}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        aria-label="Historique agent"
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
        whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
        transition={{ duration: 0.1 }}
      >
        {/* Status dot / spinner */}
        {isWorking ? (
          <Loader2
            className={reduceMotion ? 'flex-shrink-0' : 'animate-spin flex-shrink-0'}
            style={{ width: 12, height: 12, color: 'var(--accent-primary)' }}
          />
        ) : errorCount > 0 ? (
          <AlertCircle style={{ width: 12, height: 12, color: 'var(--color-warning)', flexShrink: 0 }} />
        ) : (
          <CheckCircle2 style={{ width: 12, height: 12, color: 'var(--color-success)', flexShrink: 0 }} />
        )}

        {/* Main label */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {isWorking ? (
            <>
              <CatIcon tool={runningStep.tool} size={10} />
              <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {runningStep.label}
              </span>
              <span
                className="text-xs tracking-wide font-mono px-1 py-px rounded flex-shrink-0"
                style={{
                  backgroundColor: 'color-mix(in srgb, ' + CAT_COLOR[getCat(runningStep.tool)] + ' 10%, transparent)',
                  color: CAT_COLOR[getCat(runningStep.tool)],
                }}
              >
                {toolLabel(runningStep.tool)}
              </span>
            </>
          ) : (
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Terminé
            </span>
          )}
        </div>

        {/* Right-side meta */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isWorking && (
            <span className="text-xs tracking-wide tabular-nums font-mono" style={{ color: 'var(--text-dimmed)' }}>
              {msElapsed(runningStep.timestamp)}
            </span>
          )}
          <span
            className="text-xs tracking-wide tabular-nums font-mono px-1.5 py-px rounded"
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: errorCount > 0 ? 'var(--color-warning)' : 'var(--text-muted)',
              border: '1px solid var(--border-base)',
            }}
          >
            {doneCount}/{total}
            {errorCount > 0 && <span style={{ color: 'var(--color-error)' }}> ·{errorCount}err</span>}
          </span>
          {!isWorking && (
            <span className="text-xs tracking-wide tabular-nums" style={{ color: 'var(--text-dimmed)' }}>
              {totalDur}
            </span>
          )}
          <ChevronDown
            className="transition-transform duration-150"
            style={{
              width: 12, height: 12,
              color: 'var(--text-dimmed)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
          {!isWorking && onClear && (
            <button
              onClick={e => { e.stopPropagation(); onClear(); }}
              className="p-0.5 rounded hover:bg-white/5 active:bg-white/10 active:scale-90 transition-all"
              title="Effacer"
              aria-label="Effacer l'historique"
              style={{ color: 'var(--text-dimmed)' }}
            >
              <X style={{ width: 11, height: 11 }} />
            </button>
          )}
        </div>
      </motion.div>

      {/* ── Expandable drawer ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={uiSpring}
            style={{ overflow: 'hidden' }}
          >
            {/* Stats strip */}
            <div
              className="flex items-center gap-3 px-3 py-1 border-y text-xs tracking-wide font-mono tabular-nums"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-dimmed)' }}
            >
              <span style={{ color: 'var(--color-success)' }}>{doneCount} ok</span>
              {errorCount > 0 && <span style={{ color: 'var(--color-error)' }}>{errorCount} err</span>}
              <span>{total} étape{total > 1 ? 's' : ''}</span>
              <span className="ml-auto flex items-center gap-1">
                <Clock style={{ width: 9, height: 9 }} />
                {totalDur}
              </span>
            </div>

            {/* Timeline */}
            <div
              ref={listRef}
              className="overflow-y-auto px-2 py-1"
              style={{ maxHeight: '200px' }}
            >
              {steps.map((step, i) => {
                const status    = getStepStatus(step);
                const isLast    = i === steps.length - 1;
                const catColor  = CAT_COLOR[getCat(step.tool)];
                const dur       = stepDuration(step);
                const isExp     = expandedStepId === step.id;

                return (
                  <div key={step.id} className="flex gap-1.5 min-h-[22px]">
                    {/* Timeline dot + connector */}
                    <div className="flex flex-col items-center flex-shrink-0 w-3 pt-[5px]">
                      {status === 'running' ? (
                        <Loader2 style={{ width: 9, height: 9, color: catColor }} className={reduceMotion ? '' : 'animate-spin'} />
                      ) : status === 'done' ? (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: catColor, opacity: 0.7 }} />
                      ) : status === 'error' ? (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-error)' }} />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--border-base)' }} />
                      )}
                      {!isLast && (
                        <div className="w-px flex-1 mt-0.5" style={{ backgroundColor: 'var(--border-base)', opacity: 0.35 }} />
                      )}
                    </div>

                    {/* Content */}
                    <motion.div
                      className="flex-1 min-w-0 pb-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-white/[0.03] transition-colors group"
                      onClick={() => setExpandedStepId(isExp ? null : step.id)}
                      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                    >
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <CatIcon tool={step.tool} size={9} />
                        <span
                          className="text-sm flex-1 truncate leading-tight"
                          style={{
                            color: status === 'running' ? 'var(--text-primary)'
                              : status === 'error' ? 'var(--color-error)'
                              : 'var(--text-secondary)',
                            fontWeight: status === 'running' ? 600 : 400,
                          }}
                        >
                          {step.label}
                        </span>
                        {dur
                          ? <span className="text-xs tracking-wide tabular-nums font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>{dur}</span>
                          : status === 'running'
                            ? <span className="text-xs tracking-wide tabular-nums font-mono flex-shrink-0" style={{ color: catColor }}>{msElapsed(step.timestamp)}</span>
                            : null
                        }
                        {step.detail && (
                          <Info style={{ width: 8, height: 8, flexShrink: 0, color: 'var(--text-dimmed)' }} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </div>

                      {/* Tool tag — only for non-trivial categories */}
                      {getCat(step.tool) !== 'other' && (
                        <span className="text-xs tracking-wide font-mono" style={{ color: catColor, opacity: 0.55 }}>
                          {CAT_LABEL[getCat(step.tool)]}
                        </span>
                      )}

                      {/* Detail expand */}
                      <AnimatePresence>
                        {isExp && step.detail && (
                          <motion.div
                            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            transition={uiSpring}
                            className="overflow-hidden"
                          >
                            <pre
                              className="mt-1 p-1.5 text-xs tracking-wide leading-relaxed whitespace-pre-wrap break-all font-mono rounded"
                              style={{
                                color: 'var(--text-muted)',
                                backgroundColor: 'var(--bg-input)',
                                border: '1px solid var(--border-base)',
                              }}
                            >
                              {step.detail}
                            </pre>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  </div>
                );
              })}
            </div>

            {/* Reasoning */}
            {reasoning && <ReasoningPanel reasoning={reasoning} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}