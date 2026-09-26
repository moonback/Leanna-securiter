import { useState, useCallback, useEffect, useRef, memo, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';

import {
  LoaderCircle,
  Hash,
  AlertTriangle,
  BrainCircuit,
  FileText,
  RefreshCcw,
  X,
  Users,
  Radio,
  ScrollText,
  DatabaseZap,
  Github,
  Send,
  Play,
  Square,
  Target,
  Wifi,
  WifiOff,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';
import { useProfile } from '../../context/UserProfileContext.js';


import { type TelegramStatus } from './TelegramStatusModal.js';
import { formatExactTokenCount, formatTokenCount } from '../../utils/tokenFormatting.js';
import { getAgentTasks, getToolActivities, subscribe as subscribeActivity } from '../../stores/agentActivityStore.js';
import { usePendingApprovalCount } from '../../hooks/usePendingApprovals.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface StatusBarProps {
  filePath?: string | null;
  language?: string;
  line?: number;
  column?: number;
  dirty?: boolean;
  encoding?: string;
  assistantBusy?: boolean;
  onToggleMcp?: () => void;
  onToggleSandbox?: () => void;
  onToggleAgents?: () => void;
  onToggleFleet?: () => void;
  onToggleLogs?: () => void;
  onToggleGitHub?: () => void;
  onToggleMissions?: () => void;
  onToggleTelegram?: () => void;
  onToggleModelPicker?: () => void;
  onToggleTokenDetail?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getModifierKey(): string {
  return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
}

// Style partagé pour tous les boutons de la barre — cohérence visuelle,
// coins doux, transition sur toutes les propriétés et halo au survol.
const PILL =
  'group/pill relative flex items-center gap-1.5 px-2.5 h-[22px] rounded-md ' +
  'text-xs font-medium leading-none transition-all duration-200 ' +
  'hover:bg-[var(--accent-subtle)] active:scale-[0.97]';

// Petit point d'état avec halo doux.
function StatusDot({
  color,
  pulse,
  glow = true,
}: {
  color: string;
  pulse?: boolean;
  glow?: boolean;
}) {
  return (
    <motion.span
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{
        backgroundColor: color,
        boxShadow: glow ? `0 0 6px ${color}` : undefined,
      }}
          animate={pulse ? { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] } : { scale: 1 }}
          transition={pulse ? { repeat: Infinity, duration: 2, ease: 'easeInOut' } : { duration: 0 }}
    />
  );
}

// Badge compteur réutilisable (agents, missions, sandbox).
function CountBadge({ value, color }: { value: number; color: string }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.6, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      className="min-w-[15px] h-[15px] flex items-center justify-center rounded-full text-[9px] font-bold tabular-nums leading-none px-1"
      style={{ backgroundColor: color, color: 'var(--bg-base)', boxShadow: `0 0 8px ${color}` }}
    >
      {value > 99 ? '99+' : value}
    </motion.span>
  );
}

// Séparateur vertical léger.
function Divider() {
  return (
    <div
      className="w-px h-3.5 rounded-full flex-shrink-0"
      style={{ background: 'linear-gradient(var(--border-base), transparent)', opacity: 0.5 }}
    />
  );
}

// ── Menu "Outils" (modal) ──────────────────────────────────────────────────
// Regroupe les actions occasionnelles (panneaux secondaires) dans une modale
// centrée, pour garder la barre de statut lisible sans risque de débordement
// d'écran. Même gabarit que la modale de confirmation Reset plus bas dans ce
// fichier, pour rester cohérent visuellement.

interface ToolsMenuItem {
  key: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick?: () => void;
  iconColor?: string;
  iconBg?: string;
  count?: number;
  countColor?: string;
  /** Rendu personnalisé à droite de l'item (ex : bouton start/stop Telegram) */
  trailing?: React.ReactNode;
}

function ToolsMenuRow({ item }: { item: ToolsMenuItem }) {
  const { icon: Icon, label, description, onClick, iconColor, iconBg, count, countColor, trailing } = item;
  return (
    <div className="group flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors duration-150 hover:bg-[var(--bg-hover)]">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!onClick}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: iconBg ?? 'var(--bg-hover)' }}
        >
          <Icon size={16} style={{ color: iconColor ?? 'var(--text-muted)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {label}
          </div>
          {description && (
            <div className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {description}
            </div>
          )}
        </div>
      </button>
      {typeof count === 'number' && count > 0 && (
        <CountBadge value={count} color={countColor ?? 'var(--accent-primary)'} />
      )}
      {trailing}
    </div>
  );
}

function ToolsMenuModal({ items, onClose }: { items: (ToolsMenuItem | 'divider')[]; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center p-4 backdrop-blur-sm bg-black/50"
      style={{ zIndex: 50 as any }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tools-menu-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border-base)' }}
        >
          <h3 id="tools-menu-title" className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Outils
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-2 overflow-y-auto min-h-0">
          {items.map((item, i) =>
            item === 'divider' ? (
              <div key={`div-${i}`} className="my-1.5 mx-2 h-px" style={{ backgroundColor: 'var(--border-base)', opacity: 0.6 }} />
            ) : (
              <ToolsMenuRow key={item.key} item={item} />
            )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── StatusBar Component ────────────────────────────────────────────────────

export const StatusBar = memo(function StatusBar({
  filePath,
  line: _line,
  column: _column,
  dirty,
  encoding: _encoding = 'UTF-8',
  assistantBusy,
  onToggleMcp,
  onToggleSandbox,
  onToggleAgents,
  onToggleFleet,
  onToggleLogs,
  onToggleGitHub,
  onToggleMissions,
  onToggleTelegram,
  onToggleModelPicker,
  onToggleTokenDetail,
}: StatusBarProps) {
  const { status, tokenUsage, promptContext } = useLiveAPIContext();
  const { profile } = useProfile();


  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const resetInputRef = useRef<HTMLInputElement | null>(null);
  // Réinitialisation en cours : pilote la barre de progression de la modale.
  const [resetInProgress, setResetInProgress] = useState(false);
  const [resetProgress, setResetProgress] = useState(0);
  const resetProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const [mcpStatus, setMcpStatus] = useState<'ok' | 'error' | 'loading'>('loading');
  const [sandboxActive, setSandboxActive] = useState(false);
  const [sandboxModifiedCount, setSandboxModifiedCount] = useState(0);

  // ── Missions ─────────────────────────────────────────────────────────────
  // Nombre de missions actives (in_progress). Alimenté par le fetch initial
  // puis mis à jour en temps réel via les événements 'Leanna-mission-event',
  // exactement comme le MissionPanel.
  const [activeMissionCount, setActiveMissionCount] = useState(0);

  // Demandes d'approbation en attente — source partagée, visibles même panneau fermé.
  const pendingApprovalCount = usePendingApprovalCount();

  // ── Telegram ───────────────────────────────────────────────────────────────
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramActionLoading, setTelegramActionLoading] = useState(false);

  // ── Agent activity ─────────────────────────────────────────────────────────

  const delegatedTasks  = useSyncExternalStore(subscribeActivity, getAgentTasks);
  const liveActivities  = useSyncExternalStore(subscribeActivity, getToolActivities);

  const activeAgentCount =
    delegatedTasks.filter(t => t.status === 'running' || t.status === 'pending').length +
    liveActivities.filter(a => a.status === 'running').length;

  const modifierKey = getModifierKey();
  const sandboxLabel = 'Sandbox';

  // ── MCP ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const fetchMcp = async () => {
      try {
        const token = localStorage.getItem('Leanna_api_token');
        const headers: Record<string, string> = token ? { 'x-Leanna-token': token } : {};
        const res = await fetch('/api/mcp/status', { headers });
        const data = await res.json();
        if (!cancelled) {
          setMcpStatus(data.status === 'success' ? 'ok' : 'error');
        }
      } catch {
        if (!cancelled) setMcpStatus('error');
      }
    };
    fetchMcp();
    const interval = setInterval(fetchMcp, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ── Missions : suivi du nombre de missions actives ─────────────────────────

  useEffect(() => {
    // statuts par mission, pour recalculer le nombre d'actives à chaque event
    const statuses = new Map<string, string>();
    const recompute = () => {
      let count = 0;
      for (const s of statuses.values()) {
        // Ne compter que les missions réellement en cours d'exécution.
        // 'blocked' (escaladé), 'pending', 'completed' et 'failed' ne sont
        // PAS des missions actives — les inclure faisait apparaître un badge
        // fantôme alors qu'aucune mission ne tournait.
        if (s === 'in_progress' || s === 'paused') count += 1;
      }
      setActiveMissionCount(count);
    };

    let cancelled = false;
    fetch('/api/missions')
      .then(res => (res.ok ? res.json() : { missions: [] }))
      .then((data: { missions?: Array<{ id: string; status?: string }> }) => {
        if (cancelled || !Array.isArray(data.missions)) return;
        for (const m of data.missions) statuses.set(m.id, m.status ?? 'pending');
        recompute();
      })
      .catch(() => { /* système de missions indisponible — badge à 0, normal */ });

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string; event?: string; missionId?: string; success?: boolean }>).detail;
      if (!detail || detail.type !== 'mission_event' || !detail.missionId) return;
      switch (detail.event) {
        case 'mission_plan':
          if (!statuses.has(detail.missionId)) statuses.set(detail.missionId, 'pending');
          break;
        case 'mission_started':
        case 'goal_started':
        case 'action_started':
        case 'goal_escalated':
        case 'goal_blocked':
          // Un objectif bloqué/escaladé n'arrête pas la mission (d'autres
          // objectifs peuvent tourner en parallèle) → toujours "en cours".
          statuses.set(detail.missionId, 'in_progress');
          break;
        case 'mission_paused':
        case 'mission_resumed':
          // Reste comptée comme active dans les deux cas.
          statuses.set(detail.missionId, 'in_progress');
          break;
        case 'mission_deleted':
          statuses.delete(detail.missionId);
          break;
        case 'mission_completed':
          statuses.set(detail.missionId, detail.success ? 'completed' : 'failed');
          break;
        case 'mission_cancelled':
          statuses.set(detail.missionId, 'failed');
          break;
        default:
          return;
      }
      recompute();
    };

    window.addEventListener('Leanna-mission-event', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('Leanna-mission-event', handler);
    };
  }, []);

  // ── Telegram ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const fetchTelegram = async () => {
      try {
        const res = await fetch('/api/telegram/status');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.status === 'success') {
            setTelegramStatus(data.data);
          }
        }
      } catch {
        /* silent */
      }
    };

    const handleTelegramChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setTelegramStatus(detail);
      } else {
        fetchTelegram();
      }
    };

    fetchTelegram();
    const interval = setInterval(fetchTelegram, 10000);
    window.addEventListener('Leanna-telegram-status-changed', handleTelegramChanged);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('Leanna-telegram-status-changed', handleTelegramChanged);
    };
  }, []);

  const handleQuickToggleTelegram = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (telegramActionLoading || !telegramStatus?.isConfigured) return;
    setTelegramActionLoading(true);
    try {
      const endpoint = telegramStatus.isRunning ? '/api/telegram/stop' : '/api/telegram/start';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.data) {
        setTelegramStatus(data.data);
        window.dispatchEvent(new CustomEvent('Leanna-telegram-status-changed', { detail: data.data }));
      }
    } catch {
      /* silent */
    } finally {
      setTelegramActionLoading(false);
    }
  }, [telegramActionLoading, telegramStatus]);

  // ── Build ──────────────────────────────────────────────────────────────────


  // ── Sandbox ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const fetchSandbox = async () => {
      try {
        const token = localStorage.getItem('Leanna_api_token');
        const headers: Record<string, string> = token ? { 'x-Leanna-token': token } : {};
        const res = await fetch('/api/sandbox/status', { headers });
        const data = await res.json();
        if (!cancelled && data.status === 'success') {
          setSandboxActive(data.sandbox?.active ?? false);
          setSandboxModifiedCount(data.sandbox?.modifiedCount ?? 0);
        }
      } catch {
        /* silent */
      }
    };
    const handleSandboxChanged = () => { fetchSandbox(); };
    fetchSandbox();
    const interval = setInterval(fetchSandbox, 5000);
    window.addEventListener('Leanna-sandbox-changed', handleSandboxChanged);
    window.addEventListener('Leanna-sandbox-file-changed', handleSandboxChanged);
    window.addEventListener('Leanna-sandbox-file-deleted', handleSandboxChanged);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('Leanna-sandbox-changed', handleSandboxChanged);
      window.removeEventListener('Leanna-sandbox-file-changed', handleSandboxChanged);
      window.removeEventListener('Leanna-sandbox-file-deleted', handleSandboxChanged);
    };
  }, []);

  const handleConfirmReset = useCallback(async () => {
    if (resetInProgress) return;
    setResetError(null);
    setResetInProgress(true);
    setResetProgress(8);

    // Progression simulée : la route de reset ne streame pas d'avancement,
    // on fait donc grimper la barre de façon fluide jusqu'à ~90% en attendant
    // la réponse, puis on complète à 100% une fois terminé.
    if (resetProgressTimerRef.current) clearInterval(resetProgressTimerRef.current);
    resetProgressTimerRef.current = setInterval(() => {
      setResetProgress(prev => (prev >= 90 ? prev : prev + Math.max(1, Math.round((90 - prev) * 0.12))));
    }, 120);

    const stopTimer = () => {
      if (resetProgressTimerRef.current) {
        clearInterval(resetProgressTimerRef.current);
        resetProgressTimerRef.current = null;
      }
    };

    try {
      const token = localStorage.getItem('Leanna_api_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { 'x-Leanna-token': token } : {}),
      };
      const res = await fetch('/api/sandbox/reset', {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: resetCode }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        stopTimer();
        setResetProgress(100);
        window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
        // Laisse la barre atteindre 100% visuellement avant de fermer.
        setTimeout(() => {
          setShowResetConfirm(false);
          setResetCode('');
          setResetInProgress(false);
          setResetProgress(0);
        }, 450);
      } else {
        stopTimer();
        setResetInProgress(false);
        setResetProgress(0);
        // Show error to user
        setResetError(data.error || 'Erreur lors de la réinitialisation');
      }
    } catch {
      stopTimer();
      setResetInProgress(false);
      setResetProgress(0);
      setResetError('Erreur réseau');
    }
  }, [resetCode, resetInProgress]);

  useEffect(() => {
    if (!showResetConfirm) return;
    const handler = (e: KeyboardEvent) => {
      // Ne pas fermer pendant une réinitialisation en cours.
      if (e.key === 'Escape' && !resetInProgress) {
        setShowResetConfirm(false);
        setResetCode('');
        setResetError(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showResetConfirm, resetInProgress]);

  // Nettoyage du timer de progression au démontage.
  useEffect(() => {
    return () => {
      if (resetProgressTimerRef.current) clearInterval(resetProgressTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (showResetConfirm) {
      resetInputRef.current?.focus();
    }
  }, [showResetConfirm]);

  // ── Indexing progress ─────────────────────────────────────────────────────

  const [indexing, setIndexing] = useState<{
    active: boolean;
    phase: string;
    current: number;
    total: number;
    file?: string;
  }>({ active: false, phase: '', current: 0, total: 0 });

  // Auto-dismiss 2s after phase=done
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        phase: string;
        current: number;
        total: number;
        file?: string;
      };
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);

      if (d.phase === 'done') {
        setIndexing(prev => ({ ...prev, active: true, phase: 'done', current: d.current ?? prev.current, total: d.total ?? prev.total }));
        dismissTimerRef.current = setTimeout(() => {
          setIndexing(prev => ({ ...prev, active: false }));
          dismissTimerRef.current = null;
        }, 2000);
      } else {
        setIndexing({ active: true, phase: d.phase, current: d.current, total: d.total, file: d.file });
      }
    };
    window.addEventListener('Leanna-knowledge-progress', handler);
    return () => {
      window.removeEventListener('Leanna-knowledge-progress', handler);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  // ── Manual reindex ────────────────────────────────────────────────────────

  const [reindexing, setReindexing] = useState(false);

  // ── Menu Outils ───────────────────────────────────────────────────────────
  const [showToolsMenu, setShowToolsMenu] = useState(false);

  const handleReindex = useCallback(async () => {
    if (reindexing || indexing.active) return;
    setReindexing(true);
    try {
      const token = localStorage.getItem('Leanna_api_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { 'x-Leanna-token': token } : {}),
      };
      await fetch('/api/knowledge/reindex', { method: 'POST', headers });
    } catch { /* silent — progress bar will not appear, that's fine */ }
    finally {
      setReindexing(false);
    }
  }, [reindexing, indexing.active]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const { suggestion } = promptContext;

  // Actions occasionnelles regroupées dans le menu "Outils" — l'ordre suit
  // la fréquence d'usage estimée (agents/missions en haut, réindexation en bas).
  const toolsMenuItems: (ToolsMenuItem | 'divider')[] = [
    {
      key: 'telegram',
      icon: Send,
      label: 'Telegram',
      description: !telegramStatus?.isConfigured
        ? 'Non configuré'
        : telegramStatus.isRunning
        ? `En ligne (@${telegramStatus.botInfo?.username || 'bot'})`
        : telegramStatus.lastError
        ? 'Erreur — cliquer pour voir'
        : 'Arrêté',
      onClick: () => { onToggleTelegram?.(); setShowToolsMenu(false); },
      iconColor: telegramStatus?.isRunning ? 'var(--color-success)' : 'var(--text-muted)',
      iconBg: telegramStatus?.isRunning ? 'var(--color-success-subtle, var(--bg-hover))' : undefined,
      trailing: telegramStatus?.isConfigured ? (
        <button
          type="button"
          onClick={handleQuickToggleTelegram}
          disabled={telegramActionLoading}
          className="p-1 rounded-md hover:bg-[var(--accent-subtle)] transition-all duration-200 active:scale-90 disabled:opacity-40 flex-shrink-0"
          title={telegramStatus.isRunning ? 'Arrêter le bot Telegram' : 'Démarrer le bot Telegram'}
          aria-label={telegramStatus.isRunning ? 'Arrêter le bot Telegram' : 'Démarrer le bot Telegram'}
        >
          {telegramActionLoading ? (
            <LoaderCircle size={11} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
          ) : telegramStatus.isRunning ? (
            <Square size={11} style={{ color: 'var(--color-error)' }} fill="currentColor" />
          ) : (
            <Play size={11} style={{ color: 'var(--color-success)' }} fill="currentColor" />
          )}
        </button>
      ) : undefined,
    },
    'divider',
    ...(profile.agents.enabled ? [
      {
        key: 'agents',
        icon: Users,
        label: 'Agents',
        description: activeAgentCount > 0 ? `${activeAgentCount} en cours` : 'Ouvrir le panneau',
        onClick: () => { onToggleAgents?.(); setShowToolsMenu(false); },
        iconColor: 'var(--accent-primary)',
        count: activeAgentCount,
      } satisfies ToolsMenuItem,
      {
        key: 'fleet',
        icon: Radio,
        label: 'Flotte',
        description: "Flotte d'agents",
        onClick: () => { onToggleFleet?.(); setShowToolsMenu(false); },
        iconColor: 'var(--color-accent-alt)',
      } satisfies ToolsMenuItem,
    ] : []),
    {
      key: 'missions',
      icon: Target,
      // Une approbation en attente prime sur le nombre de missions actives :
      // c'est une action qui réclame l'aval de l'utilisateur (boucle humaine).
      label: 'Missions',
      description: pendingApprovalCount > 0
        ? `${pendingApprovalCount} approbation${pendingApprovalCount > 1 ? 's' : ''} en attente`
        : activeMissionCount > 0
          ? `${activeMissionCount} active${activeMissionCount > 1 ? 's' : ''}`
          : 'Ouvrir le panneau',
      onClick: () => { onToggleMissions?.(); setShowToolsMenu(false); },
      iconColor: pendingApprovalCount > 0 ? 'var(--color-warning)' : 'var(--color-info)',
      count: pendingApprovalCount > 0 ? pendingApprovalCount : activeMissionCount,
      countColor: pendingApprovalCount > 0 ? 'var(--color-warning)' : 'var(--color-info)',
    },
    'divider',
    {
      key: 'logs',
      icon: ScrollText,
      label: 'Logs',
      description: "Logs de l'assistant et des agents",
      onClick: () => { onToggleLogs?.(); setShowToolsMenu(false); },
      iconColor: 'var(--accent-secondary)',
    },
    {
      key: 'github',
      icon: Github,
      label: 'GitHub',
      description: 'Publier les modifications',
      onClick: () => { onToggleGitHub?.(); setShowToolsMenu(false); },
      iconColor: 'var(--accent-primary)',
    },
    {
      key: 'reindex',
      icon: DatabaseZap,
      label: reindexing || (indexing.active && indexing.phase !== 'done') ? 'Réindexation…' : 'Réindexer',
      description: 'Scanner le projet et les documents',
      onClick: (reindexing || indexing.active) ? undefined : () => { handleReindex(); setShowToolsMenu(false); },
      iconColor: 'var(--accent-primary)',
    },
  ];

  const toolsMenuBadgeCount = activeAgentCount + activeMissionCount + pendingApprovalCount;

  return (
    <>
      {/* ─── Knowledge Indexing Progress Bar ──────────────────────────────── */}
      <AnimatePresence>
        {indexing.active && (
          <motion.div
            key="indexing-bar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
            style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-base)' }}
          >
            {/* Progress track */}
            <div className="h-0.5 w-full" style={{ backgroundColor: 'var(--bg-hover)' }}>
              <motion.div
                className="h-full"
                style={{ backgroundColor: 'var(--accent-primary)', originX: 0 }}
                animate={{
                  width: indexing.phase === 'done' || indexing.total === 0
                    ? '100%'
                    : `${Math.max(2, Math.round((indexing.current / indexing.total) * 100))}%`,
                }}
                transition={{ type: 'spring', stiffness: 80, damping: 18 }}
              />
            </div>
            {/* Label row */}
            <div className="flex items-center gap-2 px-4 py-0.5 text-xs select-none" style={{ color: 'var(--text-muted)' }}>
              {indexing.phase !== 'done' && (
                <LoaderCircle size={10} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
              )}
              <span className="font-medium" style={{ color: 'var(--accent-primary)' }}>
                {indexing.phase === 'done'
                  ? `✓ Indexation terminée (${indexing.total} fichiers)`
                  : indexing.phase === 'relations'
                  ? 'Extraction des relations…'
                  : indexing.phase === 'incremental'
                  ? `Mise à jour incrémentale — ${indexing.current} / ${indexing.total}`
                  : `Indexation — ${indexing.current} / ${indexing.total}`}
              </span>
              {indexing.phase === 'parse' && indexing.file && (
                <span className="truncate opacity-60 max-w-[300px]">{indexing.file}</span>
              )}
              {indexing.phase !== 'done' && indexing.total > 0 && (
                <span className="ml-auto tabular-nums opacity-70">
                  {Math.round((indexing.current / indexing.total) * 100)}%
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="group/bar flex items-center gap-2 px-3 h-9 border-t select-none text-sm backdrop-blur"
        style={{
          borderColor: 'var(--border-base)',
          background: 'linear-gradient(to top, var(--bg-secondary), color-mix(in srgb, var(--bg-secondary) 92%, transparent))',
          boxShadow: '0 -1px 8px rgba(0,0,0,0.12)',
        }}
      >
        {/* ─── Zone gauche : statuts en permanence visibles ──────────────── */}
        <div className="flex items-center gap-1">
          {/* Gemini Live Connection Status */}
          <button
            type="button"
            className={PILL}
            style={{ color: 'var(--text-secondary)' }}
            title={`Statut Gemini Live : ${status}`}
          >
            {status === 'connected' ? (
              <Wifi size={13} style={{ color: 'var(--color-success)' }} />
            ) : status === 'connecting' ? (
              <LoaderCircle size={13} className="animate-spin" style={{ color: 'var(--color-warning)' }} />
            ) : (
              <WifiOff size={13} style={{ color: 'var(--text-muted)' }} />
            )}
            <span className="truncate max-w-[110px] capitalize">
              {status}
            </span>
          </button>
          {/* Sandbox — dot + label */}
          <button
            type="button"
            onClick={() => onToggleSandbox?.()}
            className={PILL}
            title={sandboxActive ? 'Sandbox actif' : 'Sandbox inactif'}
          >
            <StatusDot color={sandboxActive ? 'var(--color-success)' : 'var(--text-muted)'} pulse={sandboxActive} />
            <span style={{ color: sandboxActive ? 'var(--color-success)' : 'var(--text-muted)' }}>
              {sandboxLabel}
            </span>
            {sandboxModifiedCount > 0 && (
              <CountBadge value={sandboxModifiedCount} color="var(--accent-primary)" />
            )}
          </button>

          <Divider />

          {/* AI Model — compact, clickable */}
          <button
            type="button"
            onClick={() => onToggleModelPicker?.()}
            className={PILL}
            style={{ color: 'var(--text-secondary)' }}
            title="Changer de modèle IA"
          >
            <BrainCircuit size={13} style={{ color: 'var(--accent-primary)' }} />
            <span className="truncate max-w-[110px]">
              {profile.textProvider === 'openrouter'
                ? profile.openrouterModel.split('/').pop()
                : 'Gemini Live'}
            </span>
          </button>

          

          <button
            type="button"
            onClick={onToggleMcp}
            className={PILL}
            style={{ color: 'var(--text-muted)' }}
            title={`MCP: ${mcpStatus}`}
          >
            <StatusDot
              color={
                mcpStatus === 'ok' ? 'var(--color-success)' :
                mcpStatus === 'error' ? 'var(--color-error)' : 'var(--text-muted)'
              }
              glow={mcpStatus !== 'loading'}
            />
            <span>MCP</span>
          </button>

          <Divider />

          {/* Menu "Outils" — regroupe les actions occasionnelles (Telegram,
              Agents, Flotte, Missions, Logs, GitHub, Réindexer) dans une
              modale pour garder la barre lisible. Le badge reflète
              l'activité en cours. */}
          <button
            type="button"
            onClick={() => setShowToolsMenu(true)}
            className={`${PILL} relative`}
            style={{ color: showToolsMenu ? 'var(--text-primary)' : 'var(--text-muted)' }}
            title="Ouvrir le menu Outils"
            aria-haspopup="dialog"
            aria-expanded={showToolsMenu}
          >
            <MoreHorizontal size={13} style={{ color: 'var(--accent-primary)' }} />
            <span>Outils</span>
            {toolsMenuBadgeCount > 0 && (
              <span className="absolute -top-1 -right-1">
                <CountBadge
                  value={toolsMenuBadgeCount}
                  color={pendingApprovalCount > 0 ? 'var(--color-warning)' : 'var(--accent-primary)'}
                />
              </span>
            )}
          </button>
        </div>

        {/* ─── Spacer ───────────────────────────────────────────────────── */}
        <div className="flex-1" />

        {/* ─── Zone droite : Tokens · Status · Édition · Shortcut ───────── */}
        <div className="flex items-center gap-1.5">
          {/* Busy indicator */}
          <AnimatePresence>
            {assistantBusy && (
              <motion.span
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="flex items-center gap-1.5 px-2.5 h-[22px] rounded-md text-xs font-medium leading-none"
                style={{ color: 'var(--color-warning)', backgroundColor: 'var(--color-warning-subtle)' }}
              >
                <LoaderCircle size={12} className="animate-spin" />
                <span>Traitement…</span>
              </motion.span>
            )}
          </AnimatePresence>

          {/* File state */}
          {filePath && (
            <span className="flex items-center gap-1.5 text-xs font-medium leading-none px-1">
              <StatusDot
                color={dirty ? 'var(--color-warning)' : 'var(--color-success)'}
                pulse={dirty}
              />
              <span style={{ color: dirty ? 'var(--color-warning)' : 'var(--color-success)' }}>
                {dirty ? 'Modifié' : 'Sauvé'}
              </span>
            </span>
          )}

          <Divider />

          {/* Tokens — clickable */}
          <button
            type="button"
            onClick={() => onToggleTokenDetail?.()}
            className="group/pill relative flex items-center gap-2.5 px-2.5 h-[22px] rounded-md transition-all duration-200 hover:bg-[var(--accent-subtle)] active:scale-[0.97]"
            style={{ color: 'var(--text-muted)' }}
            title={`Tokens : ${formatExactTokenCount(tokenUsage.totalTokens)} · Contexte : ${formatExactTokenCount(promptContext.currentSize)} / ${formatExactTokenCount(promptContext.maxSize)}`}
          >
            <span className="flex items-center gap-1 tabular-nums font-semibold text-xs leading-none">
              <Hash size={11} className="opacity-50" />
              {tokenUsage.totalTokens > 0 ? formatTokenCount(tokenUsage.totalTokens) : '—'}
            </span>
            <span className="flex items-center gap-1 tabular-nums font-semibold text-xs leading-none">
              <FileText size={11} className="opacity-50" />
              {formatTokenCount(promptContext.currentSize)}/{formatTokenCount(promptContext.maxSize)}
            </span>
            {suggestion && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                style={{ backgroundColor: 'var(--color-warning)', boxShadow: '0 0 6px var(--color-warning)' }}
              />
            )}
          </button>

          <Divider />

          

          {/* Reset — discret, visible on hover */}
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-1 px-2 h-[22px] rounded-md text-xs font-medium leading-none opacity-0 group-hover/bar:opacity-100 transition-all duration-300 hover:bg-[var(--color-warning-subtle)] active:scale-95"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-warning)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            title="Réinitialiser le sandbox"
          >
            <RefreshCcw size={11} strokeWidth={1.8} />
            <span className="hidden sm:inline">Reset</span>
          </button>

          {/* Command palette shortcut */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))}
            className="flex items-center gap-1 px-2 h-[22px] rounded-md font-mono text-[11px] leading-none transition-all duration-200 hover:bg-[var(--accent-subtle)] active:scale-95"
            style={{ color: 'var(--text-dimmed)' }}
            title="Palette de commandes"
          >
            <kbd
              className="px-1 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)' }}
            >
              {modifierKey}
            </kbd>
            <kbd
              className="px-1 py-0.5 rounded font-semibold"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)' }}
            >
              P
            </kbd>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showToolsMenu && (
          <ToolsMenuModal items={toolsMenuItems} onClose={() => setShowToolsMenu(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
      {showResetConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center p-4 backdrop-blur-sm bg-black/50"
          style={{ zIndex: 50 as any }}
          onClick={() => {
            if (resetInProgress) return;
            setShowResetConfirm(false);
            setResetCode('');
            setResetError(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-base)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-warning-subtle)' }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: 'var(--color-warning)' }} />
                </div>
                <div className="text-left">
                  <h3 id="reset-confirm-title" className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Confirmer la réinitialisation
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Supprimez toutes les modifications en cours et restaurez l'état d'origine.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowResetConfirm(false); setResetCode(''); }}
                disabled={resetInProgress}
                className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Fermer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Entrez le code de confirmation pour valider la réinitialisation du sandbox.
              </p>
              {resetError && (
                <p className="text-xs" style={{ color: 'var(--color-error)' }}>
                  {resetError}
                </p>
              )}
              <input
                ref={resetInputRef}
                type="text"
                maxLength={6}
                disabled={resetInProgress}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e: any) => {
                  if (resetInProgress) return;
                  if (e.key === 'Enter' && resetCode.length === 6) handleConfirmReset();
                  if (e.key === 'Escape') {
                    setShowResetConfirm(false);
                    setResetCode('');
                  }
                }}
                value={resetCode}
                className="w-full rounded-xl border px-4 py-3 text-center text-sm font-mono tracking-[0.45em] outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }}
                placeholder="000000"
              />

              {/* ─── Barre de progression de la réinitialisation ─────────── */}
              <AnimatePresence>
                {resetInProgress && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                      <span className="flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
                        <LoaderCircle size={11} className="animate-spin" />
                        {resetProgress >= 100 ? 'Réinitialisation terminée' : 'Réinitialisation en cours…'}
                      </span>
                      <span className="tabular-nums">{Math.round(resetProgress)}%</span>
                    </div>
                    <div
                      className="h-1.5 w-full rounded-full overflow-hidden"
                      style={{ backgroundColor: 'var(--bg-hover)' }}
                      role="progressbar"
                      aria-valuenow={Math.round(resetProgress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Progression de la réinitialisation"
                    >
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: 'var(--color-warning)' }}
                        animate={{ width: `${resetProgress}%` }}
                        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border-base)' }}>
              <button
                type="button"
                onClick={() => { setShowResetConfirm(false); setResetCode(''); setResetError(null); }}
                disabled={resetInProgress}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                disabled={resetCode.length !== 6 || resetInProgress}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                style={{ backgroundColor: 'var(--color-warning)', color: 'var(--bg-base)' }}
              >
                {resetInProgress && <LoaderCircle size={13} className="animate-spin" />}
                {resetInProgress ? 'Réinitialisation…' : 'Réinitialiser'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

    </>
  );
});
