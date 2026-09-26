/**
 * AgentFleetPanel — Tableau de bord de la flotte d'agents autonomes (Modal)
 *
 * Onglets :
 * - Flotte   : statut temps réel de chaque agent
 * - Bus      : messages inter-agents
 * - Métriques: taux de succès, dead-letter, subscriptions
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Users, Radio, BarChart3, RefreshCw, Loader2, X,
  AlertTriangle, ArrowRight, Zap, FlaskConical, FileText,
  Shield, Eye, Building2, Mail, Inbox, Bell, BellOff, Clock,
} from 'lucide-react';
import { useAgentNotifications } from '../../hooks/useAgentNotifications.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentStat {
  role: string;
  name: string;
  status: 'idle' | 'busy' | 'overloaded' | 'offline';
  isOnline: boolean;
  runningTasks: number;
  queuedTasks: number;
  delegatedSubTasks: number;
  delegationSuccess: number;
}

interface FleetStatus {
  initialized: boolean;
  summary?: { totalAgents: number; online: number; idle: number; busy: number; overloaded: number };
  agents?: AgentStat[];
  busMetrics?: BusMetrics;
  recommendation?: string;
  message?: string;
}

interface BusMetrics {
  totalMessages: number;
  successRate: number;
  successRatePercent?: number;
  byAgentRole: Record<string, number>;
  byMessageType: Record<string, number>;
  pendingRequests: number;
  activeSubscriptions: number;
  deadLetterQueue?: Record<string, number>;
}

interface BusMessage {
  id: string;
  type: string;
  from: string;
  to: string;
  priority: string;
  timestamp: string;
  summary: string;
  hasCorrelation: boolean;
  isAutonomous: boolean;
}

interface IncomingAgentEvent {
  type: 'agent_event';
  event: string;
  taskId: string;
  role: string;
  title: string;
  status: string;
  agentName: string;
  detail?: string;
  timestamp: string;
  summary?: string;
  durationMs?: number;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ROLE_META: Record<string, { icon: any; color: string; label: string }> = {
  test:      { icon: FlaskConical, color: 'var(--color-success)', label: 'Tests' },
  docs:      { icon: FileText,     color: 'var(--color-info)', label: 'Docs' },
  refactor:  { icon: RefreshCw,    color: 'var(--color-warning)', label: 'Refactor' },
  security:  { icon: Shield,       color: 'var(--color-error)', label: 'Sécurité' },
  review:    { icon: Eye,          color: 'var(--color-accent-alt)', label: 'Review' },
  architect: { icon: Building2,    color: 'var(--color-warning)', label: 'Architect' },
};

const TYPE_COLOR: Record<string, string> = {
  task_request:          'var(--color-info)',
  task_response:         'var(--color-success)',
  collaboration_request: 'var(--color-warning)',
  status_query:          'var(--text-muted)',
  status_response:       'var(--text-muted)',
  broadcast:             'var(--color-warning)',
  event:                 'var(--color-accent-alt)',
};

function apiHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface AgentFleetPanelProps {
  /** Rendu en overlay modal centré. */
  inline?: boolean;
  /** Rendu en panneau latéral docké (comme le panneau Missions). */
  docked?: boolean;
  onClose?: () => void;
}

export function AgentFleetPanel({ inline = false, docked = false, onClose }: AgentFleetPanelProps) {
  const [tab, setTab] = useState<'fleet' | 'bus' | 'metrics'>('fleet');
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [messages, setMessages] = useState<BusMessage[]>([]);
  const [metrics, setMetrics] = useState<BusMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const busRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // Transition des onglets : simple fondu, neutralisé si mouvement réduit.
  const tabFade = prefersReducedMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

  const { permission, requestPermission } = useAgentNotifications({
    notifyOnComplete: notificationsEnabled,
    notifyOnFailed: notificationsEnabled,
    notifyOnStart: false,
  });

  const handleToggleNotifications = useCallback(() => {
    if (!notificationsEnabled && permission !== 'granted') {
      requestPermission().then(p => {
        if (p === 'granted') setNotificationsEnabled(true);
      });
    } else {
      setNotificationsEnabled(prev => !prev);
    }
  }, [notificationsEnabled, permission, requestPermission]);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fleetData, msgData, metricsData] = await Promise.all([
        fetchJSON<FleetStatus>('/api/agents/fleet'),
        fetchJSON<{ messages: BusMessage[] }>('/api/agents/bus/history?limit=50'),
        fetchJSON<BusMetrics>('/api/agents/bus/metrics'),
      ]);
      setFleet(fleetData);
      setMessages(msgData.messages ?? []);
      setMetrics(metricsData);
    } catch (e: any) {
      setError(e.message ?? 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── WebSocket events ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleAgentEvent = (e: Event) => {
      const ev = (e as CustomEvent<IncomingAgentEvent>).detail;
      if (!ev || ev.type !== 'agent_event') return;

      if (ev.detail?.startsWith('bus:')) {
        const parts = ev.detail.split(':');
        const msgType = parts[1] ?? 'event';
        const fromRole = parts[2] ?? ev.role;
        const toRole = parts[3] ?? '?';
        const isAuto = parts[4] === 'auto';
        if (msgType === 'status_query' || msgType === 'broadcast') return;

        const busMsg: BusMessage = {
          id: `bus-${ev.taskId.slice(0, 8)}`,
          type: msgType,
          from: fromRole,
          to: toRole,
          priority: 'medium',
          timestamp: ev.timestamp,
          summary: ev.title.replace('[bus] ', ''),
          hasCorrelation: false,
          isAutonomous: isAuto,
        };
        setMessages(prev => {
          if (prev.some(m => m.id === busMsg.id)) return prev;
          return [...prev.slice(-99), busMsg];
        });
        return;
      }

      const newStatus: AgentStat['status'] =
        ev.event === 'task_started' ? 'busy' :
        ev.event === 'task_completed' ? 'idle' :
        ev.event === 'task_failed' ? 'idle' :
        ev.event === 'task_progress' ? 'busy' : 'idle';

      setFleet(prev => {
        if (!prev?.agents) return prev;
        const agents = prev.agents.map(a => {
          if (a.role !== ev.role) return a;
          const delta = ev.event === 'task_started' ? 1 : ev.event === 'task_completed' || ev.event === 'task_failed' ? -1 : 0;
          return {
            ...a,
            status: newStatus,
            runningTasks: Math.max(0, a.runningTasks + delta),
            delegationSuccess: ev.event === 'task_completed' ? a.delegationSuccess + 1 : a.delegationSuccess,
          };
        });
        const online = agents.filter(a => a.isOnline).length;
        const idle = agents.filter(a => a.status === 'idle').length;
        const busy = agents.filter(a => a.status === 'busy').length;
        const overloaded = agents.filter(a => a.status === 'overloaded').length;
        return { ...prev, agents, summary: prev.summary ? { ...prev.summary, online, idle, busy, overloaded } : prev.summary };
      });

      const syntheticEvent: BusMessage = {
        id: `ev-${ev.taskId.slice(0, 8)}-${ev.event}`,
        type: 'event',
        from: ev.role,
        to: 'orchestrator',
        priority: 'medium',
        timestamp: ev.timestamp,
        summary: `${ev.agentName}: ${ev.event.replace('task_', '')} — ${ev.title}${ev.durationMs ? ` (${(ev.durationMs / 1000).toFixed(1)}s)` : ''}`,
        hasCorrelation: false,
        isAutonomous: false,
      };
      setMessages(prev => {
        if (prev.some(m => m.id === syntheticEvent.id)) return prev;
        return [...prev.slice(-99), syntheticEvent];
      });

      setTimeout(() => {
        fetchJSON<BusMetrics>('/api/agents/bus/metrics').then(setMetrics).catch((err) => {
          console.debug('[AgentFleetPanel] Failed to fetch bus metrics:', err);
        });
      }, 400);
    };

    window.addEventListener('Leanna-agent-event', handleAgentEvent);
    return () => window.removeEventListener('Leanna-agent-event', handleAgentEvent);
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refresh]);

  useEffect(() => {
    if (tab === 'bus' && busRef.current) {
      busRef.current.scrollTop = busRef.current.scrollHeight;
    }
  }, [messages, tab]);

  const totalActive = (fleet?.summary?.busy ?? 0) + (fleet?.summary?.overloaded ?? 0);
  const deadLetterCount = Object.values(metrics?.deadLetterQueue ?? {}).reduce((a, b) => a + b, 0);
  const isFirstLoad = loading && fleet === null;

  const tabs = [
    { id: 'fleet' as const, label: 'Flotte', icon: Users, badge: fleet?.summary?.online },
    { id: 'bus' as const, label: 'Bus', icon: Radio, badge: messages.length > 0 ? messages.length : undefined },
    { id: 'metrics' as const, label: 'Stats', icon: BarChart3, badge: deadLetterCount > 0 ? deadLetterCount : undefined },
  ];

  const panelContent = (
    <div className="flex flex-col h-full min-h-0">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
        {tabs.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              color: tab === id ? 'var(--accent-primary)' : 'var(--text-dimmed)',
              backgroundColor: tab === id ? 'var(--accent-subtle)' : 'transparent',
            }}
          >
            <Icon size={11} />
            {label}
            {badge !== undefined && badge > 0 && (
              <span
                className="min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: tab === id ? 'var(--accent-primary)' : 'var(--border-base)', color: tab === id ? 'white' : 'var(--text-muted)' }}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleToggleNotifications}
          className="p-1.5 rounded-md hover:bg-white/8 transition"
          title={notificationsEnabled ? 'Désactiver notifications' : 'Activer notifications'}
        >
          {notificationsEnabled
            ? <Bell size={11} style={{ color: 'var(--color-success)' }} />
            : <BellOff size={11} style={{ color: 'var(--text-dimmed)' }} />}
        </button>
        <button
          onClick={refresh}
          className="p-1.5 rounded-md hover:bg-white/8 transition"
          title="Rafraîchir"
        >
          {loading ? <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent-primary)' }} /> : <RefreshCw size={11} style={{ color: 'var(--text-muted)' }} />}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)', color: 'var(--color-error)' }}>
          <AlertTriangle size={11} />
          <span>{error}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0" ref={tab === 'bus' ? busRef : undefined}>
        <AnimatePresence mode="wait">
          {tab === 'fleet' && (
            <motion.div key="fleet" {...tabFade} className="p-3 space-y-2">
              {isFirstLoad ? <LoadingState /> : !fleet?.initialized || !fleet?.summary ? (
                <EmptyState icon={Zap} title="Flotte non initialisée" sub={fleet?.message ?? 'Lancez une tâche pour démarrer la flotte.'} />
              ) : (
                <>
                  <FleetSummary summary={fleet.summary} recommendation={fleet.recommendation} />
                  <div className="grid grid-cols-1 gap-1.5">
                    {(fleet.agents ?? []).map(a => <AgentCard key={a.role} agent={a} />)}
                  </div>
                </>
              )}
            </motion.div>
          )}
          {tab === 'bus' && (
            <motion.div key="bus" {...tabFade} className="p-2 space-y-0.5">
              {isFirstLoad ? <LoadingState /> : messages.length === 0 ? (
                <EmptyState icon={Radio} title="Aucun message" sub="Les communications inter-agents apparaîtront ici." />
              ) : (
                messages.slice(-30).map(m => <BusMessageRow key={m.id} msg={m} />)
              )}
            </motion.div>
          )}
          {tab === 'metrics' && (
            <motion.div key="metrics" {...tabFade} className="p-3 space-y-4">
              {isFirstLoad ? <LoadingState /> : metrics ? <MetricsView metrics={metrics} /> : (
                <EmptyState icon={BarChart3} title="Aucune donnée" sub="Les métriques apparaîtront après la première tâche." />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  // ── Render: docké (panneau latéral) ─────────────────────────────────────────
  if (docked) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-base)' }}
        >
          <div className="flex items-center gap-2">
            <Users size={14} style={{ color: 'var(--accent-primary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Flotte d'Agents</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-dimmed)' }}>
              {totalActive > 0 ? `${totalActive} actif${totalActive > 1 ? 's' : ''}` : 'au repos'}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Fermer"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {panelContent}
      </div>
    );
  }

  // ── Render: Modal (inline) or Panel ─────────────────────────────────────────
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
          className="relative flex flex-col w-full max-w-xl overflow-hidden"
          style={{
            maxHeight: '80vh',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-base)',
            borderRadius: '16px',
            boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
          }}
          initial={prefersReducedMotion ? { opacity: 0 } : { scale: 0.95, y: 12, opacity: 0 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { scale: 1, y: 0, opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { scale: 0.95, y: 12, opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0.15 : 0.2, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                <Users size={15} style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Flotte d'Agents</h2>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {totalActive > 0 ? `${totalActive} agent${totalActive > 1 ? 's' : ''} actif${totalActive > 1 ? 's' : ''}` : 'Tous au repos'}
                </span>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition hover:bg-white/10"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Fermer"
              >
                <X size={15} />
              </button>
            )}
          </div>
          {panelContent}
        </motion.div>
      </motion.div>
    );
  }

  return panelContent;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FleetSummary({ summary, recommendation }: {
  summary: NonNullable<FleetStatus['summary']>;
  recommendation?: string;
}) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {summary.online}/{summary.totalAgents} en ligne
        </span>
        <div className="flex gap-1.5">
          {summary.idle > 0 && <Pill label={`${summary.idle} libres`} color="var(--color-success)" />}
          {summary.busy > 0 && <Pill label={`${summary.busy} occupés`} color="var(--color-warning)" />}
          {summary.overloaded > 0 && <Pill label={`${summary.overloaded} surchargés`} color="var(--color-error)" />}
        </div>
      </div>
      {recommendation && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{recommendation}</p>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentStat }) {
  const meta = ROLE_META[agent.role] ?? { icon: Users, color: 'var(--text-muted)', label: agent.role };
  const Icon = meta.icon;
  const isActive = agent.status === 'busy' || agent.status === 'overloaded';

  return (
    <div
      className="rounded-xl px-3 py-2.5 flex items-center gap-3 transition-all"
      style={{
        backgroundColor: isActive ? `color-mix(in srgb, ${meta.color} 6%, transparent)` : 'var(--bg-input)',
        border: `1px solid ${isActive ? `color-mix(in srgb, ${meta.color} 25%, transparent)` : 'var(--border-base)'}`,
      }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}>
        {isActive
          ? <Loader2 size={14} className="animate-spin" style={{ color: meta.color }} />
          : <Icon size={14} style={{ color: meta.color }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{meta.label}</span>
          <StatusDot status={agent.status} />
          <span className="text-xs capitalize" style={{ color: 'var(--text-dimmed)' }}>{agent.status}</span>
        </div>
        <div className="text-xs mt-0.5 flex gap-3" style={{ color: 'var(--text-muted)' }}>
          {agent.runningTasks > 0 && <span className="flex items-center gap-1"><Loader2 size={8} className="animate-spin" />{agent.runningTasks} en cours</span>}
          {agent.queuedTasks > 0 && <span className="flex items-center gap-1"><Clock size={8} />{agent.queuedTasks} en queue</span>}
          {agent.delegationSuccess > 0 && <span style={{ color: 'var(--color-success)' }}>✓ {agent.delegationSuccess}</span>}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: AgentStat['status'] }) {
  const colors: Record<string, string> = { idle: 'var(--color-success)', busy: 'var(--color-warning)', overloaded: 'var(--color-error)', offline: 'var(--text-dimmed)' };
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'busy' || status === 'overloaded' ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: colors[status] ?? 'var(--text-dimmed)' }}
    />
  );
}

function BusMessageRow({ msg }: { msg: BusMessage }) {
  const color = TYPE_COLOR[msg.type] ?? 'var(--text-muted)';
  const time = new Date(msg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-white/5 transition">
      <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}>
        <Radio size={9} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold" style={{ color }}>{msg.type.replace(/_/g, ' ')}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg.from}</span>
          <ArrowRight size={8} style={{ color: 'var(--text-dimmed)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg.to}</span>
          {msg.isAutonomous && (
            <span className="text-xs font-bold px-1 py-0.5 rounded uppercase"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>auto</span>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-dimmed)' }}>{msg.summary}</p>
      </div>
      <span className="text-xs font-mono flex-shrink-0 mt-0.5" style={{ color: 'var(--text-dimmed)' }}>{time}</span>
    </div>
  );
}

function MetricsView({ metrics }: { metrics: BusMetrics }) {
  const rate = metrics.successRatePercent ?? Math.round((metrics.successRate ?? 1) * 100);
  const rateColor = rate >= 95 ? 'var(--color-success)' : rate >= 80 ? 'var(--color-warning)' : 'var(--color-error)';
  const deadLetterEntries = Object.entries(metrics.deadLetterQueue ?? {});

  return (
    <>
      {/* Success rate */}
      <div className="rounded-xl p-3.5" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Taux de succès</span>
          <span className="text-base font-bold font-mono" style={{ color: rateColor }}>{rate}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-input)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: rateColor }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, rate)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Messages', value: metrics.totalMessages, icon: Mail, color: 'var(--color-info)' },
          { label: 'Subscriptions', value: metrics.activeSubscriptions, icon: Radio, color: 'var(--color-accent-alt)' },
          { label: 'En attente', value: metrics.pendingRequests, icon: Clock, color: 'var(--color-warning)' },
          { label: 'Dead-letter', value: deadLetterEntries.reduce((a, [, v]) => a + v, 0), icon: Inbox, color: 'var(--color-error)' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon size={10} style={{ color: value > 0 ? color : 'var(--text-dimmed)' }} />
              <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{label}</span>
            </div>
            <span className="text-base font-bold font-mono" style={{ color: value > 0 ? color : 'var(--text-primary)' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Dead-letter detail */}
      {deadLetterEntries.length > 0 && (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 15%, transparent)' }}>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-error)' }}>⚠️ Messages non délivrés</p>
          {deadLetterEntries.map(([role, count]) => (
            <div key={role} className="flex items-center justify-between py-1 text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{role}</span>
              <span className="font-mono font-bold" style={{ color: 'var(--color-error)' }}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Message type distribution */}
      {Object.keys(metrics.byMessageType).length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Par type</p>
          <div className="space-y-1">
            {Object.entries(metrics.byMessageType).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: TYPE_COLOR[type] ?? 'var(--text-muted)' }} />
                <span className="flex-1" style={{ color: 'var(--text-muted)' }}>{type.replace(/_/g, ' ')}</span>
                <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      {label}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement…</p>
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 px-6 text-center">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-input)' }}>
        <Icon size={18} style={{ color: 'var(--text-dimmed)' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{title}</p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dimmed)' }}>{sub}</p>
    </div>
  );
}
