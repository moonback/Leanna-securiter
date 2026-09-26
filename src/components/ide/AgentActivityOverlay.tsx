import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot, Target, Loader2, ChevronUp, ChevronDown, Zap,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getAgentTasks, subscribe, type AgentTaskEntry } from '../../stores/agentActivityStore.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Activity Overlay — Indicateur flottant toujours visible
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Overlay compact affiché en bas à droite de l'IDE quand des agents
 * ou des missions travaillent en arrière-plan.
 * 
 * Permet de voir en un coup d'œil:
 * - Nombre d'agents actifs
 * - Mission en cours avec progression
 * - Dernière action et son résultat
 * - Confiance de l'agent
 *
 * Cliquable pour ouvrir/fermer les détails.
 */

interface AgentActivity {
  taskId: string;
  role: string;
  agentName: string;
  title: string;
  status: string;
  timestamp: Date;
  progress?: AgentTaskEntry['progress'];
  steps: string[];
}

interface MissionActivity {
  missionId: string;
  title: string;
  status: string;
  confidence: number;
  currentGoal?: string;
  lastAction?: string;
  lastDecision?: string;
}

interface AgentActivityOverlayProps {
  /** Callback to open the full Agents panel */
  onOpenAgents?: () => void;
  /** Callback to open the full Missions panel */
  onOpenMissions?: () => void;
  /** Hide the pill when the chat panel is open */
  isChatOpen?: boolean;
}

export function AgentActivityOverlay({ onOpenAgents, onOpenMissions, isChatOpen }: AgentActivityOverlayProps) {
  const agentTasks = useSyncExternalStore(subscribe, getAgentTasks, getAgentTasks);
  const agents = agentTasks.map((task): AgentActivity => ({
    taskId: task.id,
    role: task.role,
    agentName: task.agentName,
    title: task.title,
    status: task.status,
    timestamp: new Date(task.timestamp),
    progress: task.progress,
    steps: task.steps,
  }));
  const [missions, setMissions] = useState<MissionActivity[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [lastEvent, setLastEvent] = useState<string>('');
  const [tick, setTick] = useState(0);

  // ── Ticker: force cleanup of stale entries every 2s ──
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 2000);
    return () => clearInterval(interval);
  }, []);

  // ── Re-sync active agents on WebSocket reconnect ──
  // The overlay's local state is ephemeral; after a disconnect it shows nothing.
  // On every reconnect we fetch the server's current running/pending tasks and
  // inject them so the overlay immediately reflects the real agent state.
  useEffect(() => {
    const handleReconnected = async () => {
      try {
        const res = await fetch('/api/agents/tasks');
        if (!res.ok) return;
        const data: { tasks: Array<{ id: string; role: string; title: string; status: string; createdAt: string }> } = await res.json();
        const active = (data.tasks ?? []).filter(t => t.status === 'running' || t.status === 'pending');
        if (active.length === 0) return;

        setLastEvent(`${active.length} agent(s) en cours repris`);
      } catch {
        // best-effort — ne pas bloquer l'UI
      }
    };

    window.addEventListener('Leanna-session-reconnected', handleReconnected);
    return () => window.removeEventListener('Leanna-session-reconnected', handleReconnected);
  }, []);

  // Listen for agent events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      if (detail.type === 'agent_event') {
        setLastEvent(`${detail.agentName}: ${detail.detail || detail.title}`);
      }
    };

    const missionHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== 'mission_event') return;

      setMissions(prev => {
        const existing = prev.find(m => m.missionId === detail.missionId);

        switch (detail.event) {
          case 'mission_started':
            if (existing) return prev;
            return [...prev, {
              missionId: detail.missionId,
              title: detail.title ?? 'Mission',
              status: 'in_progress',
              confidence: 0.5,
            }];

          case 'goal_started':
            return prev.map(m => m.missionId === detail.missionId
              ? { ...m, currentGoal: detail.goalTitle ?? detail.goalId }
              : m
            );

          case 'action_completed':
            return prev.map(m => m.missionId === detail.missionId
              ? {
                  ...m,
                  confidence: detail.confidence ?? m.confidence,
                  lastAction: detail.skill,
                  lastDecision: detail.decision,
                }
              : m
            );

          case 'mission_completed':
          case 'mission_cancelled':
          case 'mission_failed':
            return prev.map(m => m.missionId === detail.missionId
              ? { ...m, status: detail.success ? 'completed' : 'failed' }
              : m
            );

          default:
            return prev;
        }
      });
    };

    window.addEventListener('Leanna-agent-event', handler);
    window.addEventListener('Leanna-mission-event', missionHandler);
    return () => {
      window.removeEventListener('Leanna-agent-event', handler);
      window.removeEventListener('Leanna-mission-event', missionHandler);
    };
  }, []);

  const activeAgents = useMemo(
    () => agents.filter(a => a.status === 'running' || a.status === 'pending'),
    [agents, tick]
  );
  const activeMissions = useMemo(
    () => missions.filter(m => m.status === 'in_progress'),
    [missions, tick]
  );

  // ── Cleanup stale entries (completed/failed for > 5s) via ticker ──
  useEffect(() => {
    setMissions(prev => {
      const cleaned = prev.filter(m => m.status === 'in_progress');
      return cleaned.length !== prev.length ? cleaned : prev;
    });
  }, [tick]);

  // Ne rien afficher si rien d'actif ou si le chat panel est ouvert
  if (activeAgents.length === 0 && activeMissions.length === 0) return null;
  if (isChatOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      style={{ maxWidth: '320px' }}
    >
      {/* Expanded detail panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            className="w-72 rounded-xl overflow-hidden shadow-2xl backdrop-blur-sm"
            style={{
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-base)',
            }}
          >
            {/* Active missions */}
            {activeMissions.map(mission => (
              <div
                key={mission.missionId}
                className="px-3 py-2.5 cursor-pointer hover:bg-white/5 transition"
                onClick={onOpenMissions}
                style={{ borderBottom: '1px solid var(--border-base)' }}
              >
                <div className="flex items-center gap-2">
                  <Target size={11} style={{ color: 'var(--accent-primary)' }} />
                  <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                    {mission.title}
                  </span>
                  <span className="text-xs font-mono font-bold"
                    style={{ color: mission.confidence >= 0.7 ? 'var(--color-success)' : mission.confidence >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                    {Math.round(mission.confidence * 100)}%
                  </span>
                </div>
                {mission.currentGoal && (
                  <div className="flex items-center gap-1.5 mt-1 ml-5">
                    <Loader2 size={8} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                    <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {mission.currentGoal}
                    </span>
                  </div>
                )}
                {mission.lastAction && (
                  <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                    <Zap size={8} style={{ color: 'var(--text-dimmed)' }} />
                    <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                      {mission.lastAction}
                    </span>
                    {mission.lastDecision && mission.lastDecision !== 'continue' && (
                      <span className="text-xs font-bold px-1 rounded"
                        style={{
                          color: mission.lastDecision === 'retry' ? 'var(--color-warning)' : 'var(--color-error)',
                          backgroundColor: mission.lastDecision === 'retry' ? 'rgba(251,191,36,0.1)' : 'rgba(248,113,113,0.1)',
                        }}>
                        {mission.lastDecision}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Active agents */}
            {activeAgents.map(agent => (
              <div
                key={agent.taskId}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 transition"
                onClick={onOpenAgents}
              >
                <Loader2 size={10} className="animate-spin" style={{ color: 'var(--color-accent-alt)' }} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block" style={{ color: 'var(--text-primary)' }}>
                    {agent.agentName}
                  </span>
                  <span className="text-xs truncate block" style={{ color: 'var(--text-dimmed)' }}>
                    {agent.title}
                  </span>
                  {agent.progress && (
                    <>
                      <div className="h-1 mt-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-base)' }}>
                        <motion.div className="h-full rounded-full" style={{ backgroundColor: 'var(--color-accent-alt)' }} animate={{ width: `${Math.round(agent.progress.current / agent.progress.total * 100)}%` }} />
                      </div>
                      <span className="text-xs truncate block" style={{ color: 'var(--text-dimmed)' }}>
                        {agent.progress.current}/{agent.progress.total} · {agent.progress.label}
                      </span>
                    </>
                  )}
                  {agent.steps.length > 0 && (
                    <span className="text-xs truncate block" style={{ color: 'var(--text-dimmed)' }}>
                      Journal: {agent.steps[agent.steps.length - 1]}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact indicator pill */}
      <motion.button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-full shadow-lg cursor-pointer select-none hover:scale-105 transition-transform"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-base)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
      >
        {/* Pulsing indicator */}
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-blue-400 animate-ping opacity-50" />
        </div>

        {/* Content */}
        <div className="flex items-center gap-1.5">
          {activeMissions.length > 0 && (
            <div className="flex items-center gap-1">
              <Target size={10} style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--accent-primary)' }}>
                {activeMissions.length}
              </span>
            </div>
          )}
          {activeAgents.length > 0 && (
            <div className="flex items-center gap-1">
              <Bot size={10} style={{ color: 'var(--color-accent-alt)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--color-accent-alt)' }}>
                {activeAgents.length}
              </span>
            </div>
          )}
        </div>

        {/* Last event text */}
        {lastEvent && (
          <span className="text-xs max-w-[140px] truncate" style={{ color: 'var(--text-muted)' }}>
            {lastEvent}
          </span>
        )}

        {/* Expand/collapse icon */}
        {expanded ? (
          <ChevronDown size={10} style={{ color: 'var(--text-dimmed)' }} />
        ) : (
          <ChevronUp size={10} style={{ color: 'var(--text-dimmed)' }} />
        )}
      </motion.button>
    </motion.div>
  );
}
