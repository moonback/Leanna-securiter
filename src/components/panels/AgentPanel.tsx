import React, { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users, Bot, FileText,
  Loader2, CheckCircle2, XCircle, Clock,
  ChevronRight, Trash2, Code, GitBranch, Globe,
  Brain, Database, Target, Activity, ArrowRight,
  Code2, Sparkles, Bug, CheckCheck, FlaskConical, ShieldAlert, Network,
  PenTool, AlignLeft, Search, SpellCheck, Languages, ListTree,
} from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { IconButton } from '../ui/IconButton.js';
import { useProfile } from '../../context/UserProfileContext.js';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';
import type { AgentRole } from '../../context/UserProfileContext.js';
import {
  getToolActivities, getAgentTasks, subscribe,
  clearCompletedTools, clearCompletedTasks,
  type ToolActivityEntry, type AgentTaskEntry,
} from '../../stores/agentActivityStore.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Metadata
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_META: Record<string, {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
  label: string;
  description: string;
}> = {
  // Code & Ingénierie
  coder:       { icon: Code2,        color: 'var(--accent-secondary)', label: 'Développeur',     description: 'Écriture & modification de code' },
  refactor:    { icon: Sparkles,     color: 'var(--accent-primary)', label: 'Refactorisation', description: 'Clean code & modularité' },
  debugger:    { icon: Bug,          color: 'var(--color-error)', label: 'Débogueur',       description: 'Diagnostic & correctifs' },
  reviewer:    { icon: CheckCheck,   color: 'var(--color-success)', label: 'Revue de Code',   description: 'Audit & qualité logicielle' },
  tester:      { icon: FlaskConical, color: 'var(--color-warning)', label: 'QA & Tests',      description: 'Tests automatisés & couverture' },
  security:    { icon: ShieldAlert,  color: 'var(--color-info)', label: 'Sécurité & Audit', description: 'Vulnérabilités & secrets' },
  architect:   { icon: Network,      color: 'var(--color-info)', label: 'Architecte',      description: 'Conception & modélisation' },

  // Rédaction & Documents
  writer:      { icon: PenTool,      color: 'var(--color-info)', label: 'Rédacteur',       description: 'Rédaction de documents' },
  formatter:   { icon: AlignLeft,    color: 'var(--color-success)', label: 'Mise en forme',   description: 'Formatage & structure' },
  researcher:  { icon: Search,       color: 'var(--color-accent-alt)', label: 'Recherche',       description: 'Collecte & synthèse' },
  proofreader: { icon: SpellCheck,   color: 'var(--color-warning)', label: 'Correcteur',      description: 'Orthographe & grammaire' },
  translator:  { icon: Languages,    color: 'var(--accent-secondary)', label: 'Traducteur',      description: 'Traduction & localisation' },
  summarizer:  { icon: FileText,     color: 'var(--color-warning)', label: 'Synthèse',        description: 'Résumés & condensés' },
  planner:     { icon: ListTree,     color: 'var(--color-info)', label: 'Planificateur',   description: 'Plans & outlines' },

  // Activités & outils
  code:     { icon: Code,         color: 'var(--color-info)', label: 'Code',         description: 'Lecture/écriture de fichiers' },
  files:    { icon: FileText,     color: 'var(--color-success)', label: 'Fichiers',     description: 'Gestion de fichiers' },
  git:      { icon: GitBranch,    color: 'var(--accent-secondary)', label: 'Git',          description: 'Contrôle de version' },
  web:      { icon: Globe,        color: 'var(--color-success)', label: 'Web',          description: 'Navigation web' },
  memory:   { icon: Database,     color: 'var(--color-accent-alt)', label: 'Mémoire',     description: 'Mémoire persistante' },
  reasoning:{ icon: Brain,        color: 'var(--color-warning)', label: 'Raisonnement', description: 'Réflexion et planification' },
  mission:  { icon: Target,       color: 'var(--accent-secondary)', label: 'Mission',     description: 'Mission autonome' },

  // Rôle neutre : outils exécutables non rattachés à un agent spécialisé
  system:   { icon: Bot,          color: 'var(--text-muted)', label: 'Exécution système', description: 'Outils système non rattachés à un agent' },
};

function getRoleMeta(role: string) {
  return ROLE_META[role] ?? { icon: Bot, color: 'var(--text-muted)', label: role, description: '' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Roster Config (matches SettingsView roles)
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_ROSTER: { id: AgentRole; label: string; desc: string; icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>; color: string }[] = [
  // Code & Ingénierie
  { id: 'coder',       label: 'Développeur',     desc: 'Écriture et modification de code typé',       icon: Code2,        color: 'var(--accent-secondary)' },
  { id: 'refactor',    label: 'Refactorisation', desc: 'Clean code, architecture & modularité',        icon: Sparkles,     color: 'var(--accent-primary)' },
  { id: 'debugger',    label: 'Débogueur',       desc: 'Diagnostic de bugs & patches chirurgicaux',     icon: Bug,          color: 'var(--color-error)' },
  { id: 'reviewer',    label: 'Revue de Code',   desc: 'Audit qualité, détection d\'anti-patterns',    icon: CheckCheck,   color: 'var(--color-success)' },
  { id: 'tester',      label: 'QA & Tests',      desc: 'Création & exécution de tests automatisés',    icon: FlaskConical, color: 'var(--color-warning)' },
  { id: 'security',    label: 'Sécurité & Audit',desc: 'Détection failles OWASP, fuites de secrets',   icon: ShieldAlert,  color: 'var(--color-info)' },
  { id: 'architect',   label: 'Architecte',      desc: 'Conception système, interfaces & modèles',    icon: Network,      color: 'var(--color-info)' },
  // Rédaction & Documentation
  { id: 'writer',      label: 'Rédacteur',       desc: 'Rédaction de documents & articles',            icon: PenTool,      color: 'var(--color-info)' },
  { id: 'formatter',   label: 'Mise en Forme',   desc: 'Formatage & structure Markdown',               icon: AlignLeft,    color: 'var(--color-success)' },
  { id: 'researcher',  label: 'Recherche',       desc: 'Collecte & synthèse d\'informations',          icon: Search,       color: 'var(--color-accent-alt)' },
  { id: 'proofreader', label: 'Correcteur',      desc: 'Orthographe, grammaire, style',                icon: SpellCheck,   color: 'var(--color-warning)' },
  { id: 'translator',  label: 'Traducteur',      desc: 'Traduction & localisation',                    icon: Languages,    color: 'var(--accent-secondary)' },
  { id: 'summarizer',  label: 'Synthèse',        desc: 'Résumés & condensés',                          icon: FileText,     color: 'var(--color-warning)' },
  { id: 'planner',     label: 'Planificateur',   desc: 'Plans & outlines de documents',                icon: ListTree,     color: 'var(--color-info)' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
    pending:   { color: 'var(--text-muted)', bg: 'var(--bg-input)', label: 'Attente', icon: <Clock size={9} /> },
    running:   { color: 'var(--accent-secondary)', bg: 'var(--color-info-subtle)', label: 'En cours', icon: <Loader2 size={9} className="animate-spin" /> },
    completed: { color: 'var(--color-success)', bg: 'var(--color-success-subtle)', label: 'OK', icon: <CheckCircle2 size={9} /> },
    failed:    { color: 'var(--color-error)', bg: 'var(--color-error-subtle)', label: 'Erreur', icon: <XCircle size={9} /> },
    done:      { color: 'var(--color-success)', bg: 'var(--color-success-subtle)', label: 'OK', icon: <CheckCircle2 size={9} /> },
  };
  const c = config[status] ?? config.pending;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider"
      style={{ color: c.color, backgroundColor: c.bg }}>
      {c.icon}{c.label}
    </span>
  );
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Elapsed time hook for running items */
function useElapsed(startTime: number, active: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [active]);
  if (!active) return '';
  return formatDuration(now - startTime);
}

/** Format tool args for display */
function formatArgs(args: any): string {
  if (!args) return '';
  if (typeof args === 'string') return args.slice(0, 80);
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  const priority = ['path', 'file', 'relativePath', 'command', 'query', 'content', 'message'];
  for (const key of priority) {
    if (args[key]) {
      const val = String(args[key]);
      return val.length > 60 ? val.slice(0, 57) + '…' : val;
    }
  }
  const firstVal = String(args[keys[0]]);
  return firstVal.length > 60 ? firstVal.slice(0, 57) + '…' : firstVal;
}

/** Badge de latence vocale avec code couleur */
function VoiceLatencyBadge({ getLatencyStats }: { getLatencyStats: () => { avg: number; min: number; max: number; samples: number; last: number } | null }) {
  const stats = getLatencyStats();
  
  if (!stats) return null;
  
  // Fonction helper pour déterminer la couleur selon la latence
  const getLatencyColor = (ms: number): string => {
    if (ms < 400) return '#10b981';  // vert (excellente)
    if (ms < 800) return '#f59e0b';  // orange (acceptable)
    return '#ef4444';                // rouge (élevée)
  };
  
  const color = getLatencyColor(stats.last);
  
  return (
    <div 
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono group cursor-help"
      style={{ 
        backgroundColor: `${color}10`,
        border: `1px solid ${color}30`,
      }}
      title={`Latence vocale\nDernière: ${stats.last}ms\nMoyenne: ${stats.avg}ms\nMin/Max: ${stats.min}/${stats.max}ms\nÉchantillons: ${stats.samples}`}
    >
      <Activity size={8} style={{ color }} />
      <span className="font-bold" style={{ color }}>
        {stats.last}ms
      </span>
      <span className="opacity-60 text-[10px]" style={{ color }}>
        (⌀{stats.avg}ms)
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

interface AgentPanelProps {
  /** Rendu en overlay modal centré. */
  inline?: boolean;
  /** Rendu en panneau latéral docké (comme le panneau Missions). */
  docked?: boolean;
  onClose?: () => void;
}

export function AgentPanel({ inline = false, docked = false, onClose }: AgentPanelProps) {
  // Subscribe to the global store — re-renders on every change
  const toolActivities = useSyncExternalStore(subscribe, getToolActivities);
  const delegatedTasks = useSyncExternalStore(subscribe, getAgentTasks);
  const { profile } = useProfile();
  const { connected, getLatencyStats } = useLiveAPIContext();

  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [tab, setTab] = useState<'roster' | 'live' | 'delegated'>('roster');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-switch to delegated tab when agents arrive
  const hasAgents = delegatedTasks.some(t => t.status === 'running' || t.status === 'pending');
  useEffect(() => {
    if (hasAgents) setTab('delegated');
  }, [hasAgents]);

  // Group tool activities by agent
  const groupedActivities = useMemo(() => {
    const groups = new Map<string, ToolActivityEntry[]>();
    for (const activity of toolActivities) {
      const list = groups.get(activity.agentId) || [];
      list.push(activity);
      groups.set(activity.agentId, list);
    }
    return groups;
  }, [toolActivities]);

  // Determine which roles are currently active (running tasks)
  const activeRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const task of delegatedTasks) {
      if (task.status === 'running' || task.status === 'pending') {
        roles.add(task.role);
      }
    }
    for (const [agentId, activities] of groupedActivities) {
      if (activities.some(a => a.status === 'running')) {
        roles.add(agentId);
      }
    }
    return roles;
  }, [delegatedTasks, groupedActivities]);

  // Stats
  const liveRunning = toolActivities.filter(a => a.status === 'running').length;
  const delegatedRunning = delegatedTasks.filter(t => t.status === 'running' || t.status === 'pending').length;
  const delegatedDone = delegatedTasks.filter(t => t.status === 'completed').length;
  const delegatedFailed = delegatedTasks.filter(t => t.status === 'failed').length;
  const totalDone = toolActivities.filter(a => a.status === 'done').length;

  const allowedCount = profile.agents.allowedRoles.length;
  const totalAgents = AGENT_ROSTER.length;

  // scrollable area height differs between modal and panel mode
  const scrollAreaStyle: React.CSSProperties = (inline || docked)
    ? { minHeight: 0 }          // conteneur flex (modal ou docké) — flex-1 gère la hauteur
    : { maxHeight: '60vh' };    // standalone Panel — need an explicit cap

  const content = (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Tab switcher + stats bar */}
      <div className="flex flex-col flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
        <div className="flex items-center gap-1 px-3 py-2">
          <TabBtn active={tab === 'roster'} onClick={() => setTab('roster')} count={allowedCount}>
            <Users size={10} /> Roster
          </TabBtn>
          <TabBtn active={tab === 'live'} onClick={() => setTab('live')} count={liveRunning}>
            <Activity size={10} /> Activité
          </TabBtn>
          <TabBtn active={tab === 'delegated'} onClick={() => setTab('delegated')} count={delegatedRunning}>
            <Bot size={10} /> Tâches
          </TabBtn>
          <div className="flex-1" />
          {tab !== 'roster' && (
            <IconButton
              variant="default"
              icon={<Trash2 className="w-3 h-3" />}
              onClick={tab === 'live' ? clearCompletedTools : clearCompletedTasks}
              tooltip="Effacer terminés"
              aria-label="Effacer terminés"
              className="p-1 rounded"
            />
          )}
        </div>
        {/* Quick stats */}
        <div className="flex items-center gap-3 px-3 pb-2">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', color: 'var(--accent-primary)' }}>
            <Users size={8} />
            <span className="font-bold">{allowedCount}</span>
            <span className="opacity-70">/{totalAgents} dispo</span>
          </div>
          <StatPill icon={<Loader2 size={8} className="animate-spin" />} value={liveRunning + delegatedRunning} label="actifs" color="var(--accent-secondary)" />
          <StatPill icon={<CheckCircle2 size={8} />} value={totalDone + delegatedDone} label="terminés" color="var(--color-success)" />
          {delegatedFailed > 0 && <StatPill icon={<XCircle size={8} />} value={delegatedFailed} label="erreurs" color="var(--color-error)" />}
          {/* Badge de latence vocale */}
          {connected && <VoiceLatencyBadge getLatencyStats={getLatencyStats} />}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5 custom-scrollbar" style={scrollAreaStyle}>
        {tab === 'roster' ? (
          <RosterTab allowedRoles={profile.agents.allowedRoles} activeRoles={activeRoles} />
        ) : tab === 'live' ? (
          <LiveTab groupedActivities={groupedActivities} expanded={expandedTask} onToggle={id => setExpandedTask(prev => prev === id ? null : id)} />
        ) : (
          <DelegatedTab tasks={delegatedTasks} expanded={expandedTask} onToggle={id => setExpandedTask(prev => prev === id ? null : id)} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );

  if (docked) {
    // Panneau latéral docké (même comportement que le panneau Missions) :
    // en-tête compact + contenu plein, sans overlay ni fond assombri.
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-base)' }}
        >
          <div className="flex items-center gap-2">
            <Users size={14} style={{ color: 'var(--accent-primary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Agents</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-dimmed)' }}>
              {liveRunning + delegatedRunning} actifs
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Fermer"
            >
              <XCircle size={15} />
            </button>
          )}
        </div>
        {content}
      </div>
    );
  }

  if (inline) {
    return (
      <motion.div
        className="fixed inset-0 flex items-center justify-center"
        style={{ zIndex: 'var(--z-modal)' as any }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <motion.div
          className="relative flex flex-col w-full max-w-lg overflow-hidden"
          style={{
            maxHeight: '75vh',
            height: '75vh',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
          }}
          initial={{ scale: 0.95, y: 12, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 12, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                <Users size={14} style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Agents</h2>
                <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                  {liveRunning + delegatedRunning} actifs
                </span>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Fermer"
              >
                <XCircle size={16} />
              </button>
            )}
          </div>
          {content}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <Panel title="Agents" icon={<Users className="w-4 h-4" />}
      actions={<span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-dimmed)' }}>
        {liveRunning + delegatedRunning} actifs
      </span>}>
      {content}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

function StatPill({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  if (value === 0) return null;
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs"
      style={{ backgroundColor: 'color-mix(in srgb, ' + color + ' 7%, transparent)', color }}>
      {icon}
      <span className="font-bold">{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

function TabBtn({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
      style={{
        color: active ? 'var(--accent-primary)' : 'var(--text-dimmed)',
        backgroundColor: active ? 'var(--accent-subtle)' : 'transparent',
      }}>
      {children}
      {count > 0 && (
        <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: active ? 'var(--accent-primary)' : 'var(--text-dimmed)', color: 'var(--bg-panel)' }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Roster Tab: Available agents and their status ────────────────────────

function RosterTab({ allowedRoles, activeRoles }: { allowedRoles: AgentRole[]; activeRoles: Set<string> }) {
  return (
    <div className="space-y-1.5">
      {AGENT_ROSTER.map(agent => {
        const isAllowed = allowedRoles.includes(agent.id);
        const isActive = activeRoles.has(agent.id);
        const Icon = agent.icon;

        return (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
            style={{
              backgroundColor: isActive ? `${agent.color}10` : 'var(--bg-input)',
              border: `1px solid ${isActive ? `${agent.color}40` : isAllowed ? 'var(--border-base)' : 'transparent'}`,
              opacity: isAllowed ? 1 : 0.45,
            }}
          >
            {/* Icon */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 relative"
              style={{ backgroundColor: `${agent.color}18` }}
            >
              <Icon size={14} style={{ color: agent.color }} />
              {isActive && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{ backgroundColor: 'var(--color-success)', borderColor: 'var(--bg-panel)' }} />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold" style={{ color: isAllowed ? 'var(--text-primary)' : 'var(--text-dimmed)' }}>
                  {agent.label}
                </span>
                {isActive && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider"
                    style={{ backgroundColor: 'var(--color-info-subtle)', color: 'var(--accent-secondary)' }}>
                    <Loader2 size={7} className="animate-spin" /> en cours
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-dimmed)' }}>
                {agent.desc}
              </p>
            </div>

            {/* Status */}
            <div className="flex-shrink-0">
              {isAllowed ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold"
                  style={{ backgroundColor: 'var(--color-success-subtle)', color: 'var(--color-success)' }}>
                  <CheckCircle2 size={9} /> Disponible
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold"
                  style={{ backgroundColor: 'rgba(113,113,122,0.1)', color: 'var(--text-dimmed)' }}>
                  <XCircle size={9} /> Désactivé
                </span>
              )}
            </div>
          </motion.div>
        );
      })}

      {/* Footer hint */}
      <p className="text-center text-xs pt-3 pb-1" style={{ color: 'var(--text-dimmed)' }}>
        Gérez les agents dans <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>Paramètres → Agents</span>
      </p>
    </div>
  );
}

// ── Live Tab: Tool activity grouped by agent ─────────────────────────────

function LiveTab({ groupedActivities, expanded, onToggle }: {
  groupedActivities: Map<string, ToolActivityEntry[]>;
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  if (groupedActivities.size === 0) {
    return <EmptyState message="Aucune activité en cours" sub="Les outils utilisés apparaîtront ici en temps réel" />;
  }

  return (
    <AnimatePresence initial={false}>
      {[...groupedActivities.entries()].map(([agentId, activities]) => (
        <AgentGroupCard key={agentId} agentId={agentId} activities={activities}
          expanded={expanded === agentId} onToggle={() => onToggle(agentId)} />
      ))}
    </AnimatePresence>
  );
}

function AgentGroupCard({ agentId, activities, expanded, onToggle }: {
  agentId: string;
  activities: ToolActivityEntry[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = getRoleMeta(agentId);
  const Icon = meta.icon;
  const running = activities.filter(a => a.status === 'running');
  const done = activities.filter(a => a.status === 'done');
  const isActive = running.length > 0;
  const lastActivity = activities[activities.length - 1];
  const progress = activities.length > 0 ? (done.length / activities.length) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: isActive ? `${meta.color}08` : 'var(--bg-input)',
        border: `1px solid ${isActive ? `${meta.color}30` : 'var(--border-base)'}`,
      }}>
      {/* Header */}
      <button className="w-full flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer hover:bg-white/5 transition"
        onClick={onToggle}>
        <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 relative"
          style={{ backgroundColor: `${meta.color}18` }}>
          {isActive ? (
            <Loader2 size={13} className="animate-spin" style={{ color: meta.color }} />
          ) : (
            <Icon size={13} style={{ color: meta.color }} />
          )}
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: meta.color, color: 'var(--text-primary)' }}>
            {activities.length}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              {done.length}/{activities.length} terminé{done.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {lastActivity?.label}
            {lastActivity?.args && (
              <span className="ml-1 opacity-60">→ {formatArgs(lastActivity.args)}</span>
            )}
          </div>
        </div>
        {isActive && <RunningElapsed startTime={running[0].timestamp} />}
        <motion.div animate={{ rotate: expanded ? 90 : 0 }} className="flex-shrink-0">
          <ChevronRight size={10} style={{ color: 'var(--text-dimmed)' }} />
        </motion.div>
      </button>

      {/* Progress bar */}
      {activities.length > 1 && (
        <div className="px-2.5 pb-1">
          <div className="h-0.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-base)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: meta.color }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      )}

      {/* Expanded: action list */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-2 pb-2 space-y-0.5 pt-1" style={{ borderTop: '1px solid var(--border-base)' }}>
              <div className="px-2 py-1 mb-1">
                <p className="text-xs italic" style={{ color: 'var(--text-dimmed)' }}>{meta.description}</p>
              </div>
              {activities.slice(-15).map(activity => (
                <ToolActivityRow key={activity.id} activity={activity} color={meta.color} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ToolActivityRow({ activity, color }: { activity: ToolActivityEntry; color: string }) {
  const elapsed = activity.endTimestamp
    ? formatDuration(activity.endTimestamp - activity.timestamp)
    : '';

  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded hover:bg-white/5 group">
      <div className="flex-shrink-0 mt-0.5">
        {activity.status === 'running' ?
          <Loader2 size={9} className="animate-spin" style={{ color }} /> :
          <CheckCircle2 size={9} style={{ color: 'var(--color-success)' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono font-medium truncate" style={{ color: 'var(--text-muted)' }}>
            {activity.label}
          </span>
          {elapsed && (
            <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
              {elapsed}
            </span>
          )}
        </div>
        {activity.args && (
          <div className="text-xs font-mono truncate mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--text-dimmed)' }}>
            <ArrowRight size={7} className="inline mr-0.5" />
            {formatArgs(activity.args)}
          </div>
        )}
      </div>
      <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
        {timeLabel(activity.timestamp)}
      </span>
    </div>
  );
}

function RunningElapsed({ startTime }: { startTime: number }) {
  const elapsed = useElapsed(startTime, true);
  return (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded-md flex-shrink-0"
      style={{ backgroundColor: 'var(--color-info-subtle)', color: 'var(--accent-secondary)' }}>
      ⏱ {elapsed || '0s'}
    </span>
  );
}

// ── Delegated Tab: Multi-role agent tasks ────────────────────────────────

function DelegatedTab({ tasks, expanded, onToggle }: {
  tasks: AgentTaskEntry[];
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  if (tasks.length === 0) {
    return <EmptyState message="Aucun agent déclenché" sub="Les agents multi-rôles s'activent quand Leanna délègue une tâche complexe (test, docs, refactor, security, review, architect)" />;
  }

  return (
    <AnimatePresence initial={false}>
      {tasks.map(task => (
        <DelegatedTaskCard key={task.id} task={task}
          expanded={expanded === task.id}
          onToggle={() => onToggle(task.id)} />
      ))}
    </AnimatePresence>
  );
}

function DelegatedTaskCard({ task, expanded, onToggle }: {
  task: AgentTaskEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = getRoleMeta(task.role);
  const Icon = meta.icon;
  const isRunning = task.status === 'running';

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: isRunning ? `${meta.color}08` : 'var(--bg-input)',
        border: `1px solid ${isRunning ? `${meta.color}30` : 'var(--border-base)'}`,
      }}>
      <button className="w-full flex items-center gap-2 px-2.5 py-2.5 text-left cursor-pointer hover:bg-white/5 transition"
        onClick={onToggle}>
        <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${meta.color}18` }}>
          {isRunning ? <Loader2 size={13} className="animate-spin" style={{ color: meta.color }} /> :
            <Icon size={13} style={{ color: meta.color }} />}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold truncate block" style={{ color: 'var(--text-primary)' }}>
            {task.title}
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs font-medium" style={{ color: meta.color }}>{task.agentName}</span>
            <span className="text-xs opacity-50">•</span>
            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{timeLabel(task.timestamp)}</span>
            {task.durationMs ? (
              <>
                <span className="text-xs opacity-50">•</span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>{formatDuration(task.durationMs)}</span>
              </>
            ) : null}
            {task.steps.length > 0 && (
              <>
                <span className="text-xs opacity-50">•</span>
                <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{task.steps.length} étape{task.steps.length > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isRunning && <RunningElapsed startTime={task.timestamp} />}
          <StatusBadge status={task.status} />
        </div>
        <motion.div animate={{ rotate: expanded ? 90 : 0 }} className="flex-shrink-0">
          <ChevronRight size={10} style={{ color: 'var(--text-dimmed)' }} />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3 py-2.5 space-y-2"
              style={{ borderTop: '1px solid var(--border-base)' }}>
              {/* Role description */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ backgroundColor: `${meta.color}08` }}>
                <Icon size={10} style={{ color: meta.color }} />
                <span className="text-xs" style={{ color: meta.color }}>{meta.description}</span>
              </div>

              {/* Steps timeline */}
              {task.steps.length > 0 && (
                <div className="space-y-0.5 ml-1">
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Étapes :</p>
                  {task.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-1.5 pl-2" style={{ borderLeft: `2px solid ${meta.color}30` }}>
                      <span className="text-xs font-mono flex-shrink-0 mt-0.5" style={{ color: meta.color }}>{i + 1}.</span>
                      <span className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{step}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Detail */}
              {task.detail && task.steps.length === 0 && (
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{task.detail}</p>
              )}

              {/* Summary */}
              {task.summary && (
                <div className="px-2 py-1.5 rounded-md" style={{ backgroundColor: 'var(--color-success-subtle)', border: '1px solid var(--border-success-subtle)' }}>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--color-success)' }}>Résumé</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>{task.summary}</p>
                </div>
              )}

              {/* Empty state */}
              {!task.detail && !task.summary && task.steps.length === 0 && (
                <p className="text-xs italic" style={{ color: 'var(--text-dimmed)' }}>
                  {isRunning
                    ? 'Exécution en cours… Les étapes apparaîtront au fur et à mesure.'
                    : 'Aucun détail disponible.'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-input)' }}>
        <Users size={18} style={{ color: 'var(--text-dimmed)' }} />
      </div>
      <div className="text-center px-4">
        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{message}</p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-dimmed)' }}>{sub}</p>
      </div>
    </div>
  );
}
