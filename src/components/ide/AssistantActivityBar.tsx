import { useState, useEffect, useRef, memo } from 'react';
import type React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDown, ChevronUp, CheckCircle2, Loader2, X,
  FolderSearch, FileText, FilePen, FileSearch, FolderPlus,
  FileMinus, FolderMinus, FileCode, Info, Database, Globe, Brain, Cpu,
  Search, Terminal, RefreshCw, BarChart2,
} from 'lucide-react';
import type { ActivityStep } from '../../hooks/useLiveAPI.js';

interface AssistantActivityBarProps {
  steps: ActivityStep[];
  connected: boolean;
  /** When true, renders inline (no absolute positioning/floating) */
  inline?: boolean;
}

// ── Per-tool metadata ────────────────────────────────────────────────────────
const TOOL_META: Record<string, { icon: React.ElementType; category: string; color: string }> = {
  list_project_files:         { icon: FolderSearch, category: 'Fichiers',    color: 'var(--accent-primary)' },
  read_project_file:          { icon: FileText,     category: 'Fichiers',    color: 'var(--accent-primary)' },
  write_project_file:         { icon: FilePen,      category: 'Fichiers',    color: 'var(--color-success)' },
  modify_project_file:        { icon: FilePen,      category: 'Fichiers',    color: 'var(--color-success)' },
  search_in_files:            { icon: FileSearch,   category: 'Fichiers',    color: 'var(--color-accent-alt)' },
  open_project_file:          { icon: FileCode,     category: 'Fichiers',    color: 'var(--accent-primary)' },
  create_project_directory:   { icon: FolderPlus,   category: 'Fichiers',    color: 'var(--color-success)' },
  rename_project_file:        { icon: FilePen,      category: 'Fichiers',    color: 'var(--color-warning)' },
  delete_project_file:        { icon: FileMinus,    category: 'Fichiers',    color: 'var(--color-error)' },
  delete_project_folder:      { icon: FolderMinus,  category: 'Fichiers',    color: 'var(--color-error)' },
  analyze_project_file:       { icon: FileSearch,   category: 'Fichiers',    color: 'var(--color-accent-alt)' },
  get_workspace_info:         { icon: Info,         category: 'Workspace',   color: 'var(--text-muted)' },
  generate_codebase_markdown: { icon: RefreshCw,    category: 'Workspace',   color: 'var(--color-warning)' },
  open_ide:                   { icon: Terminal,     category: 'IDE',         color: 'var(--accent-primary)' },
  save_memory:                { icon: Database,     category: 'Mémoire',     color: 'var(--color-accent-alt)' },
  search_memory:              { icon: Brain,        category: 'Mémoire',     color: 'var(--color-accent-alt)' },
  automation_navigate:        { icon: Globe,        category: 'Web',         color: 'var(--color-success)' },
  automation_search:          { icon: Search,       category: 'Web',         color: 'var(--color-success)' },
  automation_snapshot:        { icon: Globe,        category: 'Web',         color: 'var(--accent-primary)' },
  automation_click:           { icon: Globe,        category: 'Web',         color: 'var(--color-warning)' },
  automation_type:            { icon: Globe,        category: 'Web',         color: 'var(--color-warning)' },
  automation_extract:         { icon: Globe,        category: 'Web',         color: 'var(--accent-primary)' },
  reasoning_delegate_task:    { icon: Cpu,       category: 'Raisonnement',color: 'var(--color-warning)' },
  create_rich_document:       { icon: BarChart2,  category: 'Document',    color: 'var(--color-accent-alt)' },
};

// How long the panel lingers after the last step finishes before it
// auto-dismisses. Long enough to read "Terminé", short enough not to
// squat on the user's attention past its usefulness (Purpose).
const AUTO_HIDE_DELAY_MS = 4000;

function getMeta(tool: string) {
  return TOOL_META[tool] ?? { icon: Terminal, category: 'Outil', color: 'var(--text-muted)' };
}

function elapsed(ts: Date): string {
  const ms = Date.now() - ts.getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const StepRow = memo(function StepRow({
  step,
  meta,
  isRun,
  dur,
}: {
  step: ActivityStep;
  meta: { icon: React.ElementType; category: string; color: string };
  isRun: boolean;
  dur: string;
}) {
  const Icon = meta.icon;
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2 mx-1.5 rounded-2xl"
      style={{
        backgroundColor: isRun ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)' : 'var(--bg-surface)',
        border: '1px solid var(--border-base)',
        boxShadow: isRun ? '0 8px 20px color-mix(in srgb, var(--accent-primary) 8%, transparent)' : 'inset 0 -1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <div
        className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center"
        style={{ backgroundColor: isRun ? `${meta.color}20` : 'var(--bg-input)' }}
      >
        {isRun ? (
          <Loader2 className="w-3 h-3 animate-spin" style={{ color: meta.color }} />
        ) : (
          <Icon className="w-3 h-3" style={{ color: isRun ? meta.color : 'var(--text-muted)' }} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span
            className="text-xs font-medium truncate"
            style={{ color: isRun ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {step.label}
          </span>
          <span className="text-sm tabular-nums flex-shrink-0" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
            {isRun ? elapsed(step.timestamp) : dur}
          </span>
        </div>
        <span className="text-sm" style={{ color: isRun ? meta.color : 'var(--text-muted)', opacity: isRun ? 1 : 0.6 }}>
          {meta.category}
        </span>
      </div>

      <div className="flex-shrink-0 mt-0.5">
        {isRun ? (
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} />
        ) : (
          <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--text-muted)', opacity: 0.35 }} />
        )}
      </div>
    </div>
  );
});

// ── Component ────────────────────────────────────────────────────────────────
export function AssistantActivityBar({ steps, connected, inline = false }: AssistantActivityBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReducedMotion = useReducedMotion();
  // Track elapsed for running steps
  const [, setTick] = useState(0);

  const runningStep = [...steps].reverse().find(s => s.status === 'running');
  const isWorking = !!runningStep;
  const doneCount = steps.filter(s => s.status === 'done').length;

  // Ticker — refresh elapsed every 100ms while working
  useEffect(() => {
    if (!isWorking) return;
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, [isWorking]);

  // Show when work starts, auto-hide a while after it finishes.
  // Skipped for `inline` (it has no floating chrome to dismiss) and while
  // the user has it expanded — don't yank a panel away mid-read (Agency).
  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (isWorking) {
      setVisible(true);
      return;
    }

    if (!inline && visible && !expanded && steps.length > 0) {
      hideTimerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_DELAY_MS);
    }

    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorking, expanded, inline]);

  // Auto-scroll to bottom when list updates
  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [steps, expanded]);

  // Nothing to render
  if (!connected) return null;

  // In inline mode, always visible when there are steps (no auto-hide logic)
  const shouldShow = inline ? steps.length > 0 : visible;

  // Reduced motion: cross-fade only, no slide/scale/overshoot.
  const panelInitial = prefersReducedMotion
    ? { opacity: 0 }
    : inline
      ? { opacity: 0 }
      : { opacity: 0, y: 8, scale: 0.97 };
  const panelAnimate = prefersReducedMotion
    ? { opacity: 1 }
    : inline
      ? { opacity: 1 }
      : { opacity: 1, y: 0, scale: 1 };
  const panelExit = panelInitial;
  const panelTransition = prefersReducedMotion
    ? { duration: 0.15, ease: 'easeOut' as const }
    : { type: 'spring' as const, damping: 1, duration: 0.32 };

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          key="activity-bar"
          initial={panelInitial}
          animate={panelAnimate}
          exit={panelExit}
          transition={panelTransition}
          className={inline
            ? "flex flex-col min-h-0 overflow-hidden"
            : "absolute bottom-8 right-4 z-40 w-80 rounded-2xl overflow-hidden"
          }
          style={inline
            ? { borderTop: '1px solid var(--border-base)' }
            : {
                backgroundColor: 'color-mix(in srgb, var(--bg-panel) 92%, transparent)',
                border: '1px solid var(--border-base)',
                borderTop: '1px solid var(--border-strong, var(--border-base))', // bright top edge = light catching the material
                boxShadow: 'var(--shadow-lg, 0 24px 64px rgba(0,0,0,0.28))',
                backdropFilter: 'blur(18px)',
                transformOrigin: 'bottom right', // grows from the corner it lives in
              }
          }
        >
          {/* ── Header ── */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none"
            style={{
              borderBottom: expanded ? '1px solid var(--border-base)' : 'none',
              backgroundColor: expanded ? 'color-mix(in srgb, var(--text-primary) 2%, transparent)' : 'transparent',
            }}
            onClick={() => setExpanded(v => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
            tabIndex={0}
            role="button"
            aria-expanded={expanded}
          >
            {/* Animated status dot */}
            <div className="relative flex-shrink-0 w-4 h-4 flex items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                {isWorking ? (
                  <motion.div
                    key="working"
                    className="absolute inset-0 flex items-center justify-center"
                    initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    transition={{ type: 'spring', damping: 1, duration: 0.25 }}
                  >
                    {!prefersReducedMotion && (
                      <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{ backgroundColor: 'var(--accent-primary)', opacity: 0.2 }}
                        animate={{ scale: [1, 1.8, 1] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    )}
                    <Loader2
                      className="w-3.5 h-3.5 animate-spin relative"
                      style={{ color: 'var(--accent-primary)' }}
                    />
                  </motion.div>
                ) : (
                  // Completion feedback: a small pop, not an instant swap —
                  // the state change itself is the thing worth noticing.
                  <motion.div
                    key="done"
                    initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                    transition={{ type: 'spring', damping: 0.8, duration: 0.3 }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Main label */}
            <div className="flex-1 min-w-0">
              {isWorking ? (
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span
                    className="text-xs font-semibold truncate"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {runningStep.label}
                  </span>
                  <span className="text-sm tabular-nums flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {elapsed(runningStep.timestamp)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                    Terminé
                  </span>
                  <span
                    className="text-sm px-2 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
                  >
                    {doneCount} étape{doneCount > 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                className="p-1 rounded-full transition-colors hover:bg-white/10"
                aria-label={expanded ? 'Réduire' : 'Développer'}
                onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
              >
                {expanded
                  ? <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                  : <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                }
              </button>
              {!inline && (
                <button
                  className="p-1 rounded-full transition-colors hover:bg-white/10"
                  aria-label="Fermer"
                  onClick={e => { e.stopPropagation(); setVisible(false); setExpanded(false); }}
                >
                  <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
          </div>

          {/* ── Steps list ── */}
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="steps"
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0.15, ease: 'easeOut' }
                    : { type: 'spring', damping: 1, duration: 0.28 }
                }
                style={{ overflow: 'hidden' }}
              >
                <div
                  ref={listRef}
                  className={`overflow-y-auto py-1.5 ${inline ? 'flex-1' : ''}`}
                  style={inline ? undefined : { maxHeight: 220 }}
                >
                  {steps.map((step, i) => {
                    const meta = getMeta(step.tool);
                    const isRun = step.status === 'running';
                    const nextStep = steps[i + 1];
                    const dur = isRun
                      ? elapsed(step.timestamp)
                      : nextStep
                        ? `${((nextStep.timestamp.getTime() - step.timestamp.getTime()) / 1000).toFixed(1)}s`
                        : '—';

                    return (
                      <StepRow key={step.id} step={step} meta={meta} isRun={isRun} dur={dur} />
                    );
                  })}
                </div>

                {/* Footer with total count */}
                {steps.length > 0 && (
                  <div
                    className="px-3 py-1.5 flex items-center justify-between"
                    style={{ borderTop: '1px solid var(--border-base)' }}
                  >
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {steps.length} action{steps.length > 1 ? 's' : ''}
                    </span>
                    {!isWorking && (
                      <span className="text-sm" style={{ color: 'var(--color-success)' }}>
                        ✓ Toutes terminées
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}