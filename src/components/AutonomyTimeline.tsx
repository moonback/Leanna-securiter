import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Heart,
  Moon,
  Pause,
  Play,
  Plus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  useAutonomyTimeline,
  type AutonomyEvent,
  type AutonomyEventType,
} from '../hooks/useAutonomyTimeline.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds < 5) return "à l'instant";
  if (seconds < 60) return `il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `il y a ${hours}h`;
}

const EVENT_LABELS: Record<AutonomyEventType, string> = {
  'autonomy:heartbeat': 'Heartbeat',
  'autonomy:stateChanged': "Changement d'état",
  'autonomy:health': 'Santé',
  'autonomy:taskCreated': 'Tâche créée',
  'autonomy:taskStateChanged': 'Tâche mise à jour',
};

/** Couleur sémantique (token CSS) associée à un type d'événement. */
function eventColor(event: AutonomyEventType): string {
  switch (event) {
    case 'autonomy:heartbeat': return 'var(--accent-secondary)';
    case 'autonomy:stateChanged': return 'var(--accent-primary)';
    case 'autonomy:health': return 'var(--color-success)';
    case 'autonomy:taskCreated': return 'var(--color-info)';
    case 'autonomy:taskStateChanged': return 'var(--color-warning)';
    default: return 'var(--text-muted)';
  }
}

function EventIcon({ event }: { event: AutonomyEventType }) {
  const color = eventColor(event);
  const cls = 'w-3.5 h-3.5';
  switch (event) {
    case 'autonomy:heartbeat': return <Heart className={cls} style={{ color }} />;
    case 'autonomy:stateChanged': return <Activity className={cls} style={{ color }} />;
    case 'autonomy:health': return <CheckCircle2 className={cls} style={{ color }} />;
    case 'autonomy:taskCreated': return <Plus className={cls} style={{ color }} />;
    case 'autonomy:taskStateChanged': return <CircleDot className={cls} style={{ color }} />;
    default: return <CircleDot className={cls} style={{ color }} />;
  }
}

/**
 * Phrase de vérité : décrit ce que le runtime fait *réellement* en ce moment,
 * dérivé de son statut live. Évite l'écart attente/réalité relevé dans l'audit
 * (docs contradictoires « observe mais n'agit pas » vs chaîne perception→action
 * réellement câblée). La source unique est l'état du runtime, pas la doc.
 */
function autonomyScope(status: string | undefined, activeTasks: number): {
  acting: boolean;
  text: string;
} {
  switch (status) {
    case 'executing':
      return {
        acting: true,
        text:
          activeTasks > 0
            ? `Le système agit en ce moment : ${activeTasks} tâche${activeTasks > 1 ? 's' : ''} en cours d'exécution.`
            : "Le système exécute une action de façon autonome.",
      };
    case 'watching':
      return {
        acting: true,
        text: "Le système surveille activement et peut décider d'agir seul selon vos garde-fous.",
      };
    case 'idle':
      return {
        acting: false,
        text: "Le système est en veille active : il observe, sans action en cours.",
      };
    case 'sleeping':
      return {
        acting: false,
        text: 'Le système est en sommeil : ni observation ni action pour le moment.',
      };
    case 'error':
      return {
        acting: false,
        text: "Le runtime autonome est en erreur : aucune action n'est entreprise.",
      };
    default:
      return {
        acting: false,
        text: 'Portée de l\u2019autonomie en cours de détermination…',
      };
  }
}

function StatusIcon({ status }: { status: string }) {
  const cls = 'w-3.5 h-3.5';
  switch (status) {
    case 'watching':
    case 'executing':
      return <Play className={cls} style={{ color: 'var(--color-success)' }} />;
    case 'idle':
      return <Pause className={cls} style={{ color: 'var(--color-warning)' }} />;
    case 'sleeping':
      return <Moon className={cls} style={{ color: 'var(--accent-primary)' }} />;
    case 'error':
      return <AlertTriangle className={cls} style={{ color: 'var(--color-error)' }} />;
    default:
      return <CircleDot className={cls} style={{ color: 'var(--text-muted)' }} />;
  }
}

/** Résumé humain d'un événement à partir de son payload. */
function describeEvent(entry: AutonomyEvent): string {
  const p = entry.payload;
  switch (entry.event) {
    case 'autonomy:stateChanged':
      return `${String(p.from ?? '?')} → ${String(p.to ?? '?')}${p.reason ? ` — ${String(p.reason)}` : ''}`;
    case 'autonomy:health':
      return `${String(p.status ?? '?')}${p.reason ? ` — ${String(p.reason)}` : ''}`;
    case 'autonomy:heartbeat':
      return `${String(p.state ?? '?')}${p.reason ? ` — ${String(p.reason)}` : ''}`;
    case 'autonomy:taskCreated':
      return `${String(p.taskType ?? 'tâche')} (${String(p.taskId ?? '').slice(0, 8)})`;
    case 'autonomy:taskStateChanged':
      return `${String(p.taskType ?? 'tâche')}: ${String(p.from ?? '?')} → ${String(p.to ?? '?')}${
        p.error ? ` — ${String(p.error)}` : ''
      }`;
    default:
      return '';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface AutonomyTimelineProps {
  /** Activer/désactiver la connexion WebSocket (par défaut activée). */
  enabled?: boolean;
  className?: string;
}

/**
 * Panneau read-only qui affiche l'état du runtime autonome et la timeline temps
 * réel des événements autonomy:*. Purement observationnel : il ne déclenche
 * aucune action et n'envoie rien au serveur.
 *
 * Design : s'appuie exclusivement sur les tokens sémantiques (var(--*)) pour un
 * rendu cohérent sur tous les thèmes (voir DESIGN_TOKENS.md).
 */
export function AutonomyTimeline({ enabled = true, className = '' }: AutonomyTimelineProps) {
  const { state, tasks, events, connection } = useAutonomyTimeline({ enabled });
  const prefersReducedMotion = useReducedMotion();

  const runningTasks = tasks.filter((t) => t.status === 'running' || t.status === 'pending');
  const online = connection === 'open';
  const scope = autonomyScope(state?.status, state?.activeTasks ?? 0);

  const itemMotion = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, y: -6 },
        animate: { opacity: 1, y: 0 },
        transition: { type: 'spring' as const, stiffness: 500, damping: 32 },
      };

  const sectionLabel = 'text-xs font-semibold uppercase tracking-wider';

  return (
    <div className={`flex flex-col h-full min-h-0 ${className}`}>
      {/* Bandeau connexion */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ borderColor: 'var(--border-base)' }}
      >
        <span className={sectionLabel} style={{ color: 'var(--text-muted)' }}>
          Runtime autonome
        </span>
        <div className="flex items-center gap-1.5" title={`Connexion timeline : ${connection}`}>
          {online ? (
            <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
          ) : (
            <WifiOff className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          )}
          <span
            className="text-xs font-medium"
            style={{ color: online ? 'var(--color-success)' : 'var(--text-muted)' }}
          >
            {online ? 'En direct' : connection === 'connecting' ? 'Connexion…' : 'Hors ligne'}
          </span>
        </div>
      </div>

      {/* Phrase de vérité : ce que le système fait réellement, en direct */}
      <div
        className="flex items-start gap-2 px-4 py-2.5 border-b"
        style={{
          borderColor: 'var(--border-base)',
          backgroundColor: scope.acting
            ? 'color-mix(in srgb, var(--color-info) 8%, transparent)'
            : 'var(--bg-secondary)',
        }}
        role="status"
      >
        {scope.acting ? (
          <Play className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-info)' }} />
        ) : (
          <Activity className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
        )}
        <div className="min-w-0">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: scope.acting ? 'var(--color-info)' : 'var(--text-muted)' }}
          >
            {scope.acting ? 'Autonomie active' : 'Observation'}
          </span>
          <p className="text-sm leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {scope.text}
          </p>
        </div>
      </div>

      {/* Résumé d'état */}
      <div
        className="px-4 py-3 border-b grid grid-cols-3 gap-2"
        style={{ borderColor: 'var(--border-base)' }}
      >
        <StatCell label="Statut" icon={<StatusIcon status={state?.status ?? 'starting'} />} value={state?.status ?? '—'} />
        <StatCell
          label="Santé"
          icon={
            state?.health === 'degraded' ? (
              <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
            )
          }
          value={state?.health ?? '—'}
        />
        <StatCell
          label="Tâches actives"
          icon={<CircleDot className="w-3.5 h-3.5" style={{ color: 'var(--color-info)' }} />}
          value={state ? String(state.activeTasks) : '—'}
        />
      </div>

      {/* Tâches en cours */}
      {runningTasks.length > 0 && (
        <div className="px-4 pt-3 pb-1 border-b" style={{ borderColor: 'var(--border-base)' }}>
          <p className={`${sectionLabel} mb-1.5`} style={{ color: 'var(--text-muted)' }}>
            En cours ({runningTasks.length})
          </p>
          <div className="space-y-1 max-h-28 overflow-y-auto scrollbar-thin pr-1">
            {runningTasks.slice(0, 20).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 text-sm px-2 py-1 rounded-md"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <CircleDot className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-info)' }} />
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-secondary)' }}>
                  {task.title}
                </span>
                <span className="uppercase text-xs tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline d'événements */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 py-2">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
            <Moon className="w-6 h-6 mb-2" style={{ color: 'var(--text-dimmed)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Aucun événement pour l'instant
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>
              Les événements du runtime autonome apparaîtront ici en temps réel
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            <AnimatePresence initial={false}>
              {events.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout={!prefersReducedMotion}
                  {...itemMotion}
                  className="flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors"
                  style={{ ['--hover-bg' as string]: 'var(--bg-secondary)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {/* Pastille colorée par type */}
                  <span
                    className="mt-0.5 flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md"
                    style={{ backgroundColor: 'var(--accent-subtle)' }}
                  >
                    <EventIcon event={entry.event} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {EVENT_LABELS[entry.event]}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {timeAgo(entry.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {describeEvent(entry)}
                    </p>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Derniers échecs */}
      {state && state.recentFailures.length > 0 && (
        <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
          <p
            className={`${sectionLabel} mb-1 flex items-center gap-1`}
            style={{ color: 'var(--color-error)' }}
          >
            <AlertTriangle className="w-3 h-3" /> Échecs récents ({state.recentFailures.length})
          </p>
          <div className="space-y-0.5 max-h-20 overflow-y-auto scrollbar-thin pr-1">
            {state.recentFailures.slice(0, 5).map((failure, i) => (
              <p
                key={i}
                className="text-xs px-2 py-1 rounded-md truncate"
                style={{
                  color: 'var(--color-error)',
                  backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
                }}
              >
                {failure}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, icon, value }: { label: string; icon: React.ReactNode; value: string }) {
  return (
    <div className="px-2.5 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-1 mb-0.5">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <p className="text-sm font-bold capitalize truncate" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}
