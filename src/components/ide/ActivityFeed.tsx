import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity, FileText, GitBranch, Terminal,
  Zap, CheckCircle2, ChevronDown, Loader2,
  Search, Globe, Database, Brain,
} from 'lucide-react';
import type { ActivityStep } from '../../hooks/useLiveAPI.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface FeedEntry {
  id: string;
  type: 'file' | 'git' | 'terminal' | 'search' | 'web' | 'memory' | 'reasoning' | 'agent';
  title: string;
  count: number;
  timestamp: Date;
  status: 'success' | 'running';
}

interface ActivityFeedProps {
  steps: ActivityStep[];
  connected: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function getIcon(type: FeedEntry['type']) {
  switch (type) {
    case 'file': return FileText;
    case 'git': return GitBranch;
    case 'terminal': return Terminal;
    case 'search': return Search;
    case 'web': return Globe;
    case 'memory': return Database;
    case 'reasoning': return Brain;
    default: return Zap;
  }
}

function getColor(type: FeedEntry['type']) {
  switch (type) {
    case 'file': return 'var(--accent-primary)';
    case 'git': return 'var(--color-error)';
    case 'terminal': return 'var(--color-warning)';
    case 'search': return 'var(--color-success)';
    case 'web': return 'var(--accent-primary)';
    case 'memory': return 'var(--color-accent-alt)';
    case 'reasoning': return 'var(--color-warning)';
    default: return 'var(--accent-primary)';
  }
}

function classifyTool(tool: string): FeedEntry['type'] {
  if (/file|project|codebase|write|read|modify|create|delete|patch/.test(tool)) return 'file';
  if (/git|commit|branch|push/.test(tool)) return 'git';
  if (/system_execute|terminal|shell/.test(tool)) return 'terminal';
  if (/search|find|grep/.test(tool)) return 'search';
  if (/web|fetch|browse/.test(tool)) return 'web';
  if (/memory|knowledge|remember/.test(tool)) return 'memory';
  if (/reason|think|plan/.test(tool)) return 'reasoning';
  return 'agent';
}

/**
 * Déduplique les étapes consécutives du même type en une seule entrée
 * avec un compteur. Affiche le dernier label du groupe.
 */
function deduplicateSteps(steps: ActivityStep[]): FeedEntry[] {
  if (steps.length === 0) return [];

  const entries: FeedEntry[] = [];
  let current: { type: FeedEntry['type']; steps: ActivityStep[] } | null = null;

  for (const step of steps) {
    const type = classifyTool(step.tool);

    if (current && current.type === type && step.status !== 'running') {
      current.steps.push(step);
    } else {
      if (current) {
        const last = current.steps[current.steps.length - 1];
        entries.push({
          id: last.id,
          type: current.type,
          title: current.steps.length > 1
            ? `${current.steps.length}× ${getTypeLabel(current.type)}`
            : last.label,
          count: current.steps.length,
          timestamp: last.timestamp,
          status: 'success',
        });
      }
      current = { type, steps: [step] };
    }
  }

  // Flush remaining
  if (current) {
    const last = current.steps[current.steps.length - 1];
    entries.push({
      id: last.id,
      type: current.type,
      title: current.steps.length > 1
        ? `${current.steps.length}× ${getTypeLabel(current.type)}`
        : last.label,
      count: current.steps.length,
      timestamp: last.timestamp,
      status: last.status === 'running' ? 'running' : 'success',
    });
  }

  return entries;
}

function getTypeLabel(type: FeedEntry['type']): string {
  switch (type) {
    case 'file': return 'Fichiers';
    case 'git': return 'Git';
    case 'terminal': return 'Commandes';
    case 'search': return 'Recherches';
    case 'web': return 'Web';
    case 'memory': return 'Mémoire';
    case 'reasoning': return 'Réflexion';
    default: return 'Actions';
  }
}

// ── Activity Feed Component ────────────────────────────────────────────────

export function ActivityFeed({ steps, connected }: ActivityFeedProps) {
  const [expanded, setExpanded] = useState(true);

  const entries = useMemo(() => deduplicateSteps(steps), [steps]);
  const runningCount = steps.filter(s => s.status === 'running').length;
  const doneCount = steps.filter(s => s.status === 'done').length;

  if (!connected || steps.length === 0) return null;

  return (
    <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ borderTop: '1px solid var(--border-base)' }}>
      {/* Header */}
      <button
        className="flex items-center gap-2 px-3 py-2 w-full text-left select-none hover:bg-white/5 transition"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Masquer l\'activité' : 'Afficher l\'activité'}
      >
        {runningCount > 0 ? (
          <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        ) : (
          <Activity size={11} style={{ color: 'var(--color-success)' }} />
        )}
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-muted)' }}>
          {runningCount > 0 ? `${runningCount} en cours` : `${doneCount} terminée${doneCount > 1 ? 's' : ''}`}
        </span>
        <ChevronDown
          size={10}
          className={`transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
          style={{ color: 'var(--text-dimmed)' }}
        />
      </button>

      {/* Feed entries */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="overflow-y-auto max-h-40 px-2 pb-2 space-y-0.5 custom-scrollbar">
              {entries.slice(-8).reverse().map((entry) => (
                <FeedRow key={entry.id} entry={entry} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Feed Row ───────────────────────────────────────────────────────────────

function FeedRow({ entry }: { entry: FeedEntry }) {
  const Icon = getIcon(entry.type);
  const color = getColor(entry.type);
  const isRunning = entry.status === 'running';

  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition group"
    >
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
      >
        {isRunning ? (
          <Loader2 size={10} className="animate-spin" style={{ color }} />
        ) : (
          <Icon size={10} style={{ color }} />
        )}
      </div>
      <span
        className="text-sm flex-1 truncate"
        style={{ color: isRunning ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        {entry.title}
      </span>
      {entry.count > 1 && (
        <span
          className="text-xs font-bold px-1 py-0.5 rounded"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
        >
          {entry.count}
        </span>
      )}
      <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
        {timeLabel(entry.timestamp)}
      </span>
      {isRunning ? (
        <div className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: color }} />
      ) : (
        <CheckCircle2 size={8} className="flex-shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" style={{ color: 'var(--color-success)' }} />
      )}
    </motion.div>
  );
}
