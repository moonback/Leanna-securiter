import React, { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Zap, Clock, CloudRain, Github, Globe, Database,
  Monitor, Code, List, Brain, GitBranch,
  BookOpen, ChevronDown, ChevronUp, ChevronRight, Loader2,
  Activity, CheckCircle2, Timer, TrendingUp,
} from 'lucide-react';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';

// ── Tool → Skill mapping ─────────────────────────────────────────────────────

const TOOL_TO_SKILL: Record<string, string> = {
  list_project_files: 'codebase',
  read_project_file: 'codebase',
  read_file_outline: 'codebase',
  write_project_file: 'codebase',
  modify_project_file: 'codebase',
  patch_project_file: 'codebase',
  search_in_files: 'codebase',
  open_project_file: 'codebase',
  open_ide: 'codebase',
  create_project_directory: 'codebase',
  rename_project_file: 'codebase',
  delete_project_file: 'codebase',
  delete_project_folder: 'codebase',
  analyze_project_file: 'codebase',
  get_workspace_info: 'codebase',
  generate_codebase_markdown: 'codebase',
  get_current_time: 'time',
  get_weather: 'weather',
  get_github_user: 'github',
  get_github_repo: 'github',
  list_github_repos: 'github',
  list_github_issues: 'github',
  create_github_issue: 'github',
  list_github_pull_requests: 'github',
  search_github_repos: 'github',
  get_github_file_content: 'github',
  get_github_notifications: 'github',
  save_memory: 'memory',
  search_memory: 'memory',
  automation_navigate: 'automation',
  automation_click: 'automation',
  automation_type: 'automation',
  automation_extract: 'automation',
  automation_music_search: 'automation',
  automation_search: 'automation',
  automation_snapshot: 'automation',
  automation_inspect: 'automation',
  automation_close: 'automation',
  list_create: 'list',
  list_add_item: 'list',
  list_remove_item: 'list',
  list_delete: 'list',
  list_get: 'list',
  list_list_all: 'list',
  system_open: 'system',
  system_notify: 'system',
  system_info: 'system',
  system_execute_command: 'system',
  reasoning_delegate_task: 'reasoning',
  search_history: 'history',
  get_conversation_context: 'history',
  git_status: 'git',
  git_diff: 'git',
  git_stage: 'git',
  git_unstage: 'git',
  git_commit: 'git',
  git_push: 'git',
  git_pull: 'git',
  git_branches: 'git',
  git_switch_branch: 'git',
  git_log: 'git',
  get_workflow_guidelines: 'guidelines',
  get_project_standards: 'guidelines',
  get_tools_documentation: 'guidelines',
  get_communication_style: 'guidelines',
  get_all_guidelines: 'guidelines',
  request_tools: 'system',
  create_rich_document: 'richDocument',
};

// ── Tool display names ───────────────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, string> = {
  list_project_files: 'Explorer',
  read_project_file: 'Lire',
  read_file_outline: 'Outline',
  write_project_file: 'Écrire',
  modify_project_file: 'Modifier',
  patch_project_file: 'Patcher',
  search_in_files: 'Rechercher',
  open_project_file: 'Ouvrir',
  open_ide: 'IDE',
  create_project_directory: 'Créer dossier',
  rename_project_file: 'Renommer',
  delete_project_file: 'Supprimer',
  delete_project_folder: 'Supprimer dossier',
  analyze_project_file: 'Analyser',
  get_workspace_info: 'Info workspace',
  generate_codebase_markdown: 'Générer MD',
  get_current_time: 'Heure',
  get_weather: 'Météo',
  save_memory: 'Sauvegarder',
  search_memory: 'Rechercher',
  automation_navigate: 'Naviguer',
  automation_click: 'Cliquer',
  automation_type: 'Saisir',
  automation_extract: 'Extraire',
  automation_search: 'Recherche web',
  automation_snapshot: 'Snapshot',
  automation_inspect: 'Inspecter',
  automation_close: 'Fermer',
  system_open: 'Ouvrir app',
  system_notify: 'Notifier',
  system_info: 'Info sys.',
  system_execute_command: 'Shell',
  reasoning_delegate_task: 'Déléguer',
  search_history: 'Historique',
  get_conversation_context: 'Contexte',
  git_status: 'Status',
  git_diff: 'Diff',
  git_stage: 'Stage',
  git_commit: 'Commit',
  git_push: 'Push',
  git_pull: 'Pull',
  git_branches: 'Branches',
  git_log: 'Log',
  get_workflow_guidelines: 'Workflow',
  get_project_standards: 'Standards',
  get_tools_documentation: 'Docs',
  get_all_guidelines: 'Directives',
  request_tools: 'Charger',
  create_rich_document: 'Doc riche',
};

// ── Skill metadata ───────────────────────────────────────────────────────────

interface SkillMeta {
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

const SKILL_META: Record<string, SkillMeta> = {
  codebase:   { label: 'Codebase',     desc: 'Lecture, écriture et navigation de fichiers',  icon: Code,      color: 'var(--accent-primary)' },
  time:       { label: 'Horloge',      desc: 'Date et heure système',                       icon: Clock,     color: 'var(--color-warning)' },
  weather:    { label: 'Météo',        desc: 'Conditions météo',                            icon: CloudRain, color: 'var(--accent-primary)' },
  github:     { label: 'GitHub',       desc: 'Repos, issues, PRs',                          icon: Github,    color: 'var(--color-accent-alt)' },
  memory:     { label: 'Mémoire',      desc: 'Mémoire persistante',                         icon: Database,  color: 'var(--color-accent-alt)' },
  automation: { label: 'Automation',   desc: 'Navigation web et extraction',                icon: Globe,     color: 'var(--color-success)' },
  list:       { label: 'Listes',       desc: 'Gestion de listes',                           icon: List,      color: 'var(--color-warning)' },
  system:     { label: 'Système',      desc: 'Commandes OS et apps',                        icon: Monitor,   color: 'var(--text-muted)' },
  reasoning:  { label: 'Raisonnement', desc: 'Tâches complexes déléguées',                  icon: Brain,     color: 'var(--color-warning)' },
  history:    { label: 'Historique',    desc: 'Conversations passées',                       icon: BookOpen,  color: 'var(--color-accent-alt)' },
  git:        { label: 'Git',          desc: 'Contrôle de version',                         icon: GitBranch, color: 'var(--color-error)' },
  guidelines: { label: 'Guidelines',   desc: 'Standards du projet',                         icon: Zap,        color: 'var(--color-success)' },
  richDocument: { label: 'Doc Riche',  desc: 'Tableaux, graphiques et fiches interactifs',   icon: TrendingUp, color: 'var(--color-accent-alt)' },
};

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillUsage {
  skillId: string;
  callCount: number;
  isActive: boolean;
  lastUsed: Date;
  firstUsed: Date;
  tools: string[];
  calls: { tool: string; label: string; status: 'running' | 'done' | 'error'; timestamp: Date }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5) return 'maintenant';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Main Component ───────────────────────────────────────────────────────────

export function LiveSkillsMonitor() {
  const { activity, connected } = useLiveAPIContext();
  const [expanded, setExpanded] = useState(true);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleSkill = (id: string) => {
    setExpandedSkills(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const skillUsages = useMemo((): SkillUsage[] => {
    const map = new Map<string, {
      count: number; active: boolean; lastUsed: Date; firstUsed: Date;
      tools: Set<string>;
      calls: { tool: string; label: string; status: 'running' | 'done' | 'error'; timestamp: Date }[];
    }>();

    for (const step of activity) {
      const sid = TOOL_TO_SKILL[step.tool] || 'system';
      const call = { tool: step.tool, label: step.label, status: step.status, timestamp: step.timestamp };
      const ex = map.get(sid);
      if (ex) {
        ex.count++;
        ex.tools.add(step.tool);
        ex.calls.push(call);
        if (step.timestamp > ex.lastUsed) ex.lastUsed = step.timestamp;
        if (step.timestamp < ex.firstUsed) ex.firstUsed = step.timestamp;
        if (step.status === 'running') ex.active = true;
      } else {
        map.set(sid, { count: 1, active: step.status === 'running', lastUsed: step.timestamp, firstUsed: step.timestamp, tools: new Set([step.tool]), calls: [call] });
      }
    }

    return Array.from(map.entries())
      .map(([skillId, d]) => ({ skillId, callCount: d.count, isActive: d.active, lastUsed: d.lastUsed, firstUsed: d.firstUsed, tools: Array.from(d.tools), calls: d.calls }))
      .sort((a, b) => a.isActive && !b.isActive ? -1 : !a.isActive && b.isActive ? 1 : b.lastUsed.getTime() - a.lastUsed.getTime());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, tick]);

  const total = activity.length;
  const activeCount = skillUsages.filter(s => s.isActive).length;
  const sessionMs = activity.length > 0 ? Date.now() - activity[0].timestamp.getTime() : 0;

  if (!connected) return null;

  return (
    <div className="flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-panel)' }}>
      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-base)' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="relative flex-shrink-0">
          <Activity className="w-3.5 h-3.5" style={{ color: activeCount > 0 ? 'var(--color-success)' : 'var(--text-muted)' }} />
          {activeCount > 0 && (
            <motion.div
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: 'var(--color-success)' }}
              animate={{ scale: [1, 1.5, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
        <span className="text-xs font-bold uppercase tracking-wider flex-1" style={{ color: 'var(--text-muted)' }}>
          Skills Live
        </span>
        {total > 0 && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--text-dimmed)', backgroundColor: 'var(--bg-input)' }}>
            {total}
          </span>
        )}
        {expanded
          ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-dimmed)' }} />
          : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-dimmed)' }} />
        }
      </div>

      {expanded && (
        <>
          {/* ── Stats ── */}
          {total > 0 && (
            <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
              <Stat label="Appels" value={String(total)} color="var(--text-primary)" />
              <Stat label="Skills" value={String(skillUsages.length)} color="var(--accent-primary)" />
              <Stat label="Actifs" value={String(activeCount)} color={activeCount > 0 ? 'var(--color-success)' : 'var(--text-dimmed)'} />
              <Stat label="Durée" value={sessionMs > 0 ? fmtDuration(sessionMs) : '—'} color="var(--text-primary)" />
            </div>
          )}

          {/* ── Skills list ── */}
          <div className="overflow-y-auto flex-shrink-0" style={{ maxHeight: '45vh' }}>
            {skillUsages.length === 0 ? (
              <div className="text-center py-6 px-3">
                <Zap className="w-6 h-6 mx-auto mb-2 opacity-15" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
                  Les skills apparaîtront en temps réel
                </p>
              </div>
            ) : (
              skillUsages.map((usage, i) => (
                <SkillRow
                  key={usage.skillId}
                  usage={usage}
                  index={i}
                  total={total}
                  isOpen={expandedSkills.has(usage.skillId)}
                  onToggle={() => toggleSkill(usage.skillId)}
                />
              ))
            )}
          </div>

          {/* ── Distribution ── */}
          {skillUsages.length > 0 && (
            <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border-base)' }}>
              <div className="flex gap-0.5 h-2 rounded overflow-hidden mb-1.5" style={{ backgroundColor: 'var(--bg-input)' }}>
                {skillUsages.map(u => {
                  const m = SKILL_META[u.skillId] || SKILL_META.system;
                  const pct = total > 0 ? (u.callCount / total) * 100 : 0;
                  return (
                    <motion.div
                      key={u.skillId}
                      className="h-full rounded-sm"
                      style={{ backgroundColor: m.color, minWidth: 3 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.3 }}
                      title={`${m.label}: ${Math.round(pct)}%`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                {skillUsages.map(u => {
                  const m = SKILL_META[u.skillId] || SKILL_META.system;
                  return (
                    <span key={u.skillId} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      <span className="w-1.5 h-1.5 rounded-sm inline-block" style={{ backgroundColor: m.color }} />
                      {m.label} {Math.round((u.callCount / total) * 100)}%
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Stat chip ────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center px-1">
      <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>{label}</div>
      <div className="text-sm font-bold tabular-nums leading-tight" style={{ color }}>{value}</div>
    </div>
  );
}

// ── Skill Row ────────────────────────────────────────────────────────────────

interface SkillRowProps {
  usage: SkillUsage;
  index: number;
  total: number;
  isOpen: boolean;
  onToggle: () => void;
}

function SkillRow({ usage, index, total, isOpen, onToggle }: SkillRowProps) {
  const meta = SKILL_META[usage.skillId] || SKILL_META.system;
  const Icon = meta.icon;
  const pct = total > 0 ? Math.round((usage.callCount / total) * 100) : 0;
  const dur = usage.lastUsed.getTime() - usage.firstUsed.getTime();

  return (
    <div>
      {/* Row */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-white/[0.03]"
        onClick={onToggle}
        style={{ borderBottom: '1px solid var(--border-base)' }}
      >
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.1 }} className="flex-shrink-0">
          <ChevronRight className="w-2.5 h-2.5" style={{ color: 'var(--text-dimmed)' }} />
        </motion.div>

        <div
          className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center"
          style={{ backgroundColor: usage.isActive ? `${meta.color}18` : 'var(--bg-input)', color: usage.isActive ? meta.color : 'var(--text-muted)' }}
        >
          {usage.isActive
            ? <Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color: meta.color }} />
            : <Icon className="w-2.5 h-2.5" />
          }
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium block truncate" style={{ color: usage.isActive ? meta.color : 'var(--text-primary)' }}>
            {meta.label}
          </span>
          <span className="text-xs block" style={{ color: 'var(--text-dimmed)' }}>
            {usage.tools.length} outil{usage.tools.length > 1 ? 's' : ''} · {timeAgo(usage.lastUsed)} · {pct}%
          </span>
        </div>

        <span
          className="text-sm font-bold tabular-nums px-1.5 rounded"
          style={{ color: meta.color, backgroundColor: `${meta.color}12` }}
        >
          {usage.callCount}×
        </span>
      </div>

      {/* Detail */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-3 py-2 space-y-2" style={{ backgroundColor: 'var(--bg-secondary, rgba(0,0,0,0.15))' }}>
              {/* Description */}
              <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>{meta.desc}</p>

              {/* Metrics */}
              <div className="flex gap-3">
                <span className="flex items-center gap-1 text-sm" style={{ color: meta.color }}>
                  <TrendingUp className="w-3 h-3" /> {usage.callCount} appel{usage.callCount > 1 ? 's' : ''}
                </span>
                <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <Timer className="w-3 h-3" /> {dur > 0 ? fmtDuration(dur) : '<1s'}
                </span>
                <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <Clock className="w-3 h-3" /> {fmtTime(usage.firstUsed)}
                </span>
              </div>

              {/* Tools badges */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-dimmed)' }}>Outils</div>
                <div className="flex flex-wrap gap-1">
                  {usage.tools.map(tool => {
                    const cnt = usage.calls.filter(c => c.tool === tool).length;
                    return (
                      <span key={tool} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${meta.color}10`, color: meta.color, border: `1px solid ${meta.color}20` }}>
                        {TOOL_DISPLAY[tool] || tool}{cnt > 1 ? ` ×${cnt}` : ''}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Recent calls */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-dimmed)' }}>Récent</div>
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {[...usage.calls].reverse().slice(0, 6).map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      {c.status === 'running'
                        ? <Loader2 className="w-2 h-2 animate-spin flex-shrink-0" style={{ color: meta.color }} />
                        : <CheckCircle2 className="w-2 h-2 flex-shrink-0" style={{ color: 'var(--text-dimmed)', opacity: 0.4 }} />
                      }
                      <span className="text-xs flex-1 truncate" style={{ color: c.status === 'running' ? meta.color : 'var(--text-muted)' }}>
                        {c.label}
                      </span>
                      <span className="text-xs tabular-nums flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                        {fmtTime(c.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
