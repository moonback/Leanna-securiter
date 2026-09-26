import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Code, GitBranch, Globe, Brain, Database,
  FileText, Loader2, Target, FlaskConical,
  RefreshCw, Shield, Eye, Building2, Wrench,
} from 'lucide-react';
import type { ActivityStep } from '../../hooks/useLiveAPI.js';

// ── Agent Definitions (tool-based "virtual" agents) ────────────────────────

interface AgentDef {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  color: string;
  tools: string[];
}

const TOOL_AGENTS: AgentDef[] = [
  {
    id: 'code',
    name: 'Code',
    icon: Code,
    color: 'var(--accent-primary)',
    tools: ['read_project_file', 'write_project_file', 'modify_project_file', 'patch_project_file', 'analyze_project_file', 'search_in_files', 'read_file_outline'],
  },
  {
    id: 'files',
    name: 'Fichiers',
    icon: FileText,
    color: 'var(--color-success)',
    tools: ['list_project_files', 'create_project_directory', 'rename_project_file', 'delete_project_file', 'delete_project_folder', 'open_project_file', 'get_workspace_info'],
  },
  {
    id: 'git',
    name: 'Git',
    icon: GitBranch,
    color: 'var(--color-error)',
    tools: ['git_status', 'git_diff', 'git_stage', 'git_unstage', 'git_commit', 'git_push', 'git_pull', 'git_branches', 'git_switch_branch', 'git_log'],
  },
  {
    id: 'web',
    name: 'Web',
    icon: Globe,
    color: 'var(--color-success)',
    tools: ['automation_navigate', 'automation_click', 'automation_type', 'automation_extract', 'automation_search', 'automation_snapshot'],
  },
  {
    id: 'memory',
    name: 'Mémoire',
    icon: Database,
    color: 'var(--color-accent-alt)',
    tools: ['save_memory', 'search_memory', 'search_history', 'get_conversation_context'],
  },
  {
    id: 'reasoning',
    name: 'Raisonnement',
    icon: Brain,
    color: 'var(--color-warning)',
    tools: ['reasoning_delegate_task', 'reasoning_think'],
  },
];

// ── Multi-role agents (from AgentOrchestrator) ─────────────────────────────

interface RoleAgentDef {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  color: string;
}

const ROLE_AGENTS: Record<string, RoleAgentDef> = {
  test:     { id: 'role-test',     name: 'Tests',   icon: FlaskConical, color: 'var(--color-success)' },
  docs:     { id: 'role-docs',     name: 'Docs',    icon: FileText,     color: 'var(--accent-primary)' },
  refactor: { id: 'role-refactor', name: 'Refactor', icon: RefreshCw,   color: 'var(--color-warning)' },
  security: { id: 'role-security', name: 'Sécu',    icon: Shield,       color: 'var(--color-error)' },
  review:   { id: 'role-review',   name: 'Review',  icon: Eye,          color: 'var(--color-accent-alt)' },
  architect:{ id: 'role-architect', name: 'Archi',   icon: Building2,    color: 'var(--color-warning)' },
};

function getAgentForTool(tool: string): AgentDef | null {
  return TOOL_AGENTS.find(a => a.tools.includes(tool)) || null;
}

// ── Component ──────────────────────────────────────────────────────────────

interface MultiAgentIndicatorProps {
  steps: ActivityStep[];
}

/**
 * Nature du badge — distingue une vraie unité autonome (mission, agent de rôle)
 * d'un simple appel d'outil personnifié. Cette distinction évite de laisser
 * croire à une activité multi-agent là où il n'y a qu'un outil invoqué.
 */
type AgentKind = 'mission' | 'role' | 'tool';

interface LiveAgent {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  color: string;
  isActive: boolean;
  expiresAt: number;
  kind: AgentKind;
}

/**
 * Shows which "agents" are currently active based on:
 * 1. Tools being used (code, git, etc.)
 * 2. Multi-role agents running tasks (test, docs, refactor, etc.)
 * 3. Missions in progress
 *
 * Uses a ticker interval to expire "recent" badges properly.
 */
export function MultiAgentIndicator({ steps }: MultiAgentIndicatorProps) {
  const [roleAgents, setRoleAgents] = useState<Map<string, { name: string; role: string; expiresAt: number }>>(new Map());
  const [activeMissions, setActiveMissions] = useState<Map<string, { title: string; expiresAt: number }>>(new Map());
  const [tick, setTick] = useState(0);

  // ── Ticker: force re-render every 2s to expire stale badges ──────────────
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 2000);
    return () => clearInterval(interval);
  }, []);

  // ── Listen for multi-role agent events ───────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      const taskId = detail.taskId as string;
      const role = detail.role as string;
      const agentName = detail.agentName as string;

      if (detail.event === 'task_started' || detail.status === 'running' || detail.status === 'pending') {
        setRoleAgents(prev => {
          const next = new Map(prev);
          next.set(taskId, { name: agentName, role, expiresAt: Date.now() + 120_000 }); // 2 min TTL
          return next;
        });
      } else if (detail.event === 'task_completed' || detail.event === 'task_failed') {
        // Keep for 5s then remove
        setRoleAgents(prev => {
          const next = new Map(prev);
          next.set(taskId, { name: agentName, role, expiresAt: Date.now() + 5000 });
          return next;
        });
      }
    };

    window.addEventListener('Leanna-agent-event', handler);
    return () => window.removeEventListener('Leanna-agent-event', handler);
  }, []);

  // ── Listen for mission events ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== 'mission_event') return;

      const missionId = detail.missionId as string;

      if (detail.event === 'mission_started') {
        setActiveMissions(prev => {
          const next = new Map(prev);
          next.set(missionId, { title: detail.title ?? 'Mission', expiresAt: Date.now() + 600_000 }); // 10 min TTL
          return next;
        });
      } else if (detail.event === 'mission_completed' || detail.event === 'mission_cancelled' || detail.event === 'mission_failed') {
        setActiveMissions(prev => {
          const next = new Map(prev);
          next.set(missionId, { title: detail.title ?? 'Mission', expiresAt: Date.now() + 5000 });
          return next;
        });
      }
    };

    window.addEventListener('Leanna-mission-event', handler);
    return () => window.removeEventListener('Leanna-mission-event', handler);
  }, []);

  // ── Compute visible badges ───────────────────────────────────────────────
  const now = Date.now();

  // Tool-based agents
  const toolAgents = useMemo(() => {
    const running = steps.filter(s => s.status === 'running');
    const agentSet = new Set<string>();
    const result: LiveAgent[] = [];

    for (const step of running) {
      const agent = getAgentForTool(step.tool);
      if (agent && !agentSet.has(agent.id)) {
        agentSet.add(agent.id);
        result.push({ ...agent, isActive: true, expiresAt: Infinity, kind: 'tool' });
      }
    }

    // Recently used (last 5s)
    const recent = steps.filter(s => s.status === 'done' && (now - s.timestamp.getTime()) < 5000);
    for (const step of recent) {
      const agent = getAgentForTool(step.tool);
      if (agent && !agentSet.has(agent.id)) {
        agentSet.add(agent.id);
        result.push({ ...agent, isActive: false, expiresAt: step.timestamp.getTime() + 5000, kind: 'tool' });
      }
    }

    return result;
  }, [steps, tick]); // tick ensures re-evaluation every 2s

  // Role-based agents (filter expired)
  const roleAgentBadges = useMemo((): LiveAgent[] => {
    const result: LiveAgent[] = [];
    const seenRoles = new Set<string>();

    for (const entry of roleAgents.values()) {
      if (entry.expiresAt < now) continue;
      if (seenRoles.has(entry.role)) continue;
      seenRoles.add(entry.role);

      const def = ROLE_AGENTS[entry.role];
      if (def) {
        result.push({
          ...def,
          name: entry.name || def.name,
          isActive: entry.expiresAt > now + 5000, // If TTL > 5s, it's still running
          expiresAt: entry.expiresAt,
          kind: 'role',
        });
      }
    }
    return result;
  }, [roleAgents, tick]);

  // Mission badges (filter expired)
  const missionBadges = useMemo((): LiveAgent[] => {
    const result: LiveAgent[] = [];
    for (const [missionId, entry] of activeMissions) {
      if (entry.expiresAt < now) continue;
      result.push({
        id: `mission-${missionId}`,
        name: entry.title.length > 12 ? entry.title.slice(0, 12) + '…' : entry.title,
        icon: Target,
        color: 'var(--accent-primary)',
        isActive: entry.expiresAt > now + 5000,
        expiresAt: entry.expiresAt,
        kind: 'mission',
      });
    }
    return result;
  }, [activeMissions, tick]);

  // Clean up expired entries periodically
  useEffect(() => {
    setRoleAgents(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const [k, v] of next) {
        if (v.expiresAt < now) { next.delete(k); changed = true; }
      }
      return changed ? next : prev;
    });
    setActiveMissions(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const [k, v] of next) {
        if (v.expiresAt < now) { next.delete(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [tick]);

  // Unités réellement autonomes : missions + agents de rôle.
  const autonomousBadges = [...missionBadges, ...roleAgentBadges];
  // Appels d'outils personnifiés — présentés à part pour ne pas les confondre
  // avec de vrais agents.
  const toolBadges = toolAgents;

  const prefersReducedMotion = useReducedMotion();

  if (autonomousBadges.length === 0 && toolBadges.length === 0) return null;

  const badgeMotion = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, scale: 0.8, width: 0 },
        animate: { opacity: 1, scale: 1, width: 'auto' as const },
        exit: { opacity: 0, scale: 0.8, width: 0 },
        transition: { duration: 0.2 },
      };

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      role="status"
      aria-label="Agents et outils actifs"
    >
      {/* ── Agents autonomes (missions + rôles) : forme pleine, libellé en capitales ── */}
      <AnimatePresence mode="popLayout">
        {autonomousBadges.map((agent) => {
          const Icon = agent.icon;
          const stateLabel = agent.isActive ? 'actif' : 'terminé';
          const kindLabel = agent.kind === 'mission' ? 'Mission' : 'Agent';
          return (
            <motion.div
              key={agent.id}
              {...badgeMotion}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md overflow-hidden"
              style={{
                backgroundColor: `color-mix(in srgb, ${agent.color} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${agent.color} ${agent.isActive ? '40%' : '20%'}, transparent)`,
              }}
              title={`${kindLabel} · ${agent.name} — ${stateLabel}`}
            >
              {agent.isActive ? (
                <Loader2 size={12} className={prefersReducedMotion ? '' : 'animate-spin'} style={{ color: agent.color }} />
              ) : (
                <Icon size={12} style={{ color: agent.color, opacity: 0.75 }} />
              )}
              <span
                className="text-xs font-semibold uppercase whitespace-nowrap"
                style={{ color: agent.color, opacity: agent.isActive ? 1 : 0.65 }}
              >
                {agent.name}
              </span>
              {/* Statut en toutes lettres (ne repose pas que sur la couleur) */}
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-dimmed)' }}>
                {stateLabel}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* ── Séparateur visuel entre agents autonomes et outils ── */}
      {autonomousBadges.length > 0 && toolBadges.length > 0 && (
        <span
          aria-hidden="true"
          className="h-3.5 w-px flex-shrink-0"
          style={{ backgroundColor: 'var(--border-base)' }}
        />
      )}

      {/* ── Outils invoqués : forme discrète (pilule, icône Wrench, minuscules) ── */}
      {toolBadges.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap" title="Outils invoqués (pas des agents autonomes)">
          <Wrench size={11} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} aria-hidden="true" />
          <AnimatePresence mode="popLayout">
            {toolBadges.map((tool) => {
              const Icon = tool.icon;
              return (
                <motion.div
                  key={tool.id}
                  {...badgeMotion}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full overflow-hidden"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-base)',
                  }}
                  title={`Outil · ${tool.name} — ${tool.isActive ? 'en cours' : 'récent'}`}
                >
                  {tool.isActive ? (
                    <Loader2 size={11} className={prefersReducedMotion ? '' : 'animate-spin'} style={{ color: tool.color }} />
                  ) : (
                    <Icon size={11} style={{ color: tool.color, opacity: 0.7 }} />
                  )}
                  <span
                    className="text-xs font-medium whitespace-nowrap"
                    style={{ color: 'var(--text-muted)', opacity: tool.isActive ? 1 : 0.7 }}
                  >
                    {tool.name}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
