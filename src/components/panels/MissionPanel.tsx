import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Target, Loader2, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, Brain, Zap, RotateCcw, Pause, Play,
  TrendingUp, TrendingDown, Minus, Clock, Plus, Trash2, X,
} from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { usePendingApprovals, clearPendingApproval } from '../../hooks/usePendingApprovals.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface MissionEvent {
  type: 'mission_event';
  event: string;
  missionId: string;
  title?: string;
  status?: string;
  goalId?: string;
  goalTitle?: string;
  actionId?: string;
  skill?: string;
  success?: boolean;
  confidence?: number;
  decision?: string;
  reason?: string;
  durationMs?: number;
  error?: string;
  timestamp: string;
  plan?: MissionPlan;
  /** Arguments de l'action (pour les demandes d'approbation). */
  args?: Record<string, unknown>;
  /** Délai avant refus automatique d'une approbation (ms). */
  timeoutMs?: number;
}

import type { PendingApprovalInfo } from '../../hooks/usePendingApprovals.js';

/** Demande d'approbation en attente pour une action à effet de bord. */
type PendingApproval = PendingApprovalInfo;

interface MissionPlan {
  objectives: string[];
  targetedFiles: string[];
  tools: string[];
  risks: string[];
  estimatedTokens: number;
  stopConditions: string[];
}

interface MissionEntry {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'paused';
  priority: string;
  goals: GoalEntry[];
  activeGoalId: string | null;
  confidence: number;
  metrics: {
    totalActions: number;
    successfulActions: number;
    failedActions: number;
  };
  createdAt: Date;
  plan?: MissionPlan;
}

interface GoalEntry {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  actions: ActionEntry[];
}

interface ActionEntry {
  id: string;
  skill: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  confidence?: number;
  decision?: string;
  durationMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function confidenceColor(conf: number): string {
  if (conf >= 0.7) return 'var(--color-success)';
  if (conf >= 0.4) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function confidenceIcon(conf: number) {
  if (conf >= 0.7) return <TrendingUp size={10} />;
  if (conf >= 0.4) return <Minus size={10} />;
  return <TrendingDown size={10} />;
}

function statusIcon(status: string, size = 10) {
  switch (status) {
    // Seul l'état réellement en cours anime le spinner. Toute autre valeur
    // affiche une icône statique — plus aucun tournoiement après la fin.
    case 'in_progress': return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--color-info)' }} />;
    case 'completed': return <CheckCircle2 size={size} style={{ color: 'var(--color-success)' }} />;
    case 'failed': return <XCircle size={size} style={{ color: 'var(--color-error)' }} />;
    case 'blocked': return <AlertTriangle size={size} style={{ color: 'var(--color-warning)' }} />;
    case 'paused': return <Pause size={size} style={{ color: 'var(--color-warning)' }} />;
    default: return <Clock size={size} style={{ color: 'var(--text-dimmed)' }} />;
  }
}

/** Libellé lisible du statut de mission, affiché à côté du titre. */
function statusLabel(status: string): { text: string; color: string } {
  switch (status) {
    case 'in_progress': return { text: 'En cours', color: 'var(--color-info)' };
    case 'completed': return { text: 'Terminée', color: 'var(--color-success)' };
    case 'failed': return { text: 'Échouée', color: 'var(--color-error)' };
    case 'blocked': return { text: 'Bloquée', color: 'var(--color-warning)' };
    case 'paused': return { text: 'En pause', color: 'var(--color-warning)' };
    default: return { text: 'En attente', color: 'var(--text-dimmed)' };
  }
}

function decisionBadge(decision: string) {
  // `label` reste court pour la place disponible ; `hint` explicite la portée
  // concrète de la décision du superviseur (affiché en info-bulle).
  const config: Record<string, { color: string; label: string; hint: string; icon: React.ReactNode }> = {
    continue: {
      color: 'var(--color-success)',
      label: 'Continue',
      hint: 'Continuer : l’action a réussi, la mission passe à l’étape suivante.',
      icon: <Play size={8} />,
    },
    retry: {
      color: 'var(--color-warning)',
      label: 'Réessai',
      hint: 'Réessai : rejoue la même action à l’identique (échec jugé passager).',
      icon: <RotateCcw size={8} />,
    },
    replan: {
      color: 'var(--color-warning)',
      label: 'Replanif.',
      hint: 'Replanification : l’approche a échoué, l’agent recalcule un nouveau plan.',
      icon: <Brain size={8} />,
    },
    escalate: {
      color: 'var(--color-error)',
      label: 'Escalade',
      hint: 'Escalade : l’agent ne peut pas résoudre seul et remonte à l’utilisateur.',
      icon: <AlertTriangle size={8} />,
    },
    abort: {
      color: 'var(--color-error)',
      label: 'Abandon',
      hint: 'Abandon : arrêt de la mission. Les actions déjà effectuées ne sont pas annulées automatiquement.',
      icon: <XCircle size={8} />,
    },
  };
  const c = config[decision] ?? config.continue;
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-bold uppercase"
      style={{ color: c.color, backgroundColor: `color-mix(in srgb, ${c.color} 6%, transparent)` }}
      title={c.hint}
    >
      {c.icon} {c.label}
    </span>
  );
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Fige les objectifs et actions restés « in_progress » lorsqu'une mission se
 * termine. Sans ça, un événement `action_completed`/`goal_completed` manquant
 * laisse tourner les spinners indéfiniment alors que rien ne s'exécute plus.
 * `missionSucceeded` détermine l'état de repli des étapes non résolues.
 */
function finalizeGoals(goals: GoalEntry[], missionSucceeded: boolean): GoalEntry[] {
  const fallbackGoal = missionSucceeded ? ('completed' as const) : ('blocked' as const);
  const fallbackAction = missionSucceeded ? ('completed' as const) : ('failed' as const);
  return goals.map(g => ({
    ...g,
    status: g.status === 'in_progress' || g.status === 'pending' ? fallbackGoal : g.status,
    actions: g.actions.map(a =>
      a.status === 'in_progress' || a.status === 'pending'
        ? { ...a, status: fallbackAction }
        : a
    ),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

interface MissionPanelProps {
  inline?: boolean;
  /** Callback de fermeture. Affiche un bouton « fermer » dans l'en-tête. */
  onClose?: () => void;
}

export function MissionPanel({ inline = false, onClose }: MissionPanelProps) {
  const [missions, setMissions] = useState<MissionEntry[]>([]);
  const [expandedMission, setExpandedMission] = useState<string | null>(null);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  // Source partagée : les approbations en attente sont aussi lues par la barre
  // de statut (pastille globale), pour rester visibles panneau fermé.
  const approvals = usePendingApprovals();
  const [resolving, setResolving] = useState<string | null>(null);
  const [busyMission, setBusyMission] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Crée une mission via la route déterministe (indépendante du LLM).
  const createMission = useCallback(async () => {
    if (!newTitle.trim() || !newDescription.trim()) {
      setCreateError('Titre et description requis.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), description: newDescription.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(data?.error ?? `Erreur ${res.status}`);
        return;
      }
      // Réinitialiser le formulaire ; la carte apparaîtra via l'événement mission_plan/started.
      setNewTitle('');
      setNewDescription('');
      setShowCreate(false);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [newTitle, newDescription]);

  // Résout une approbation (approuve ou refuse) via l'API.
  const resolveApproval = useCallback(async (missionId: string, actionId: string, approved: boolean) => {
    setResolving(actionId);
    try {
      const res = await fetch(`/api/missions/${missionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, approved }),
      });
      // Qu'elle réussisse ou expire côté serveur, on retire la demande localement.
      if (res.ok || res.status === 404) {
        clearPendingApproval(actionId);
      }
    } catch (err) {
      console.error('[MissionPanel] Échec de résolution d\'approbation:', err);
    } finally {
      setResolving(null);
    }
  }, []);

  // Met en pause / reprend / annule / supprime une mission via l'API.
  // La liste locale est ensuite mise à jour par les événements WebSocket,
  // mais on applique aussi une mise à jour optimiste pour la réactivité.
  const controlMission = useCallback(async (
    missionId: string,
    action: 'pause' | 'resume' | 'cancel' | 'delete',
  ) => {
    setBusyMission(missionId);
    try {
      const isDelete = action === 'delete';
      const res = await fetch(
        isDelete ? `/api/missions/${missionId}` : `/api/missions/${missionId}/${action}`,
        { method: isDelete ? 'DELETE' : 'POST' },
      );
      if (!res.ok && res.status !== 404) return;

      // Mise à jour optimiste locale.
      setMissions(prev => {
        if (action === 'delete') return prev.filter(m => m.id !== missionId);
        return prev.map(m => {
          if (m.id !== missionId) return m;
          if (action === 'pause') return { ...m, status: 'paused' as const };
          if (action === 'resume') return { ...m, status: 'in_progress' as const };
          if (action === 'cancel') return { ...m, status: 'failed' as const };
          return m;
        });
      });
    } catch (err) {
      console.error(`[MissionPanel] Échec de l'action "${action}":`, err);
    } finally {
      setBusyMission(null);
    }
  }, []);

  // Récupère l'état complet des missions depuis le serveur et fusionne dans le
  // state local. Fusion (et non remplacement) : on préserve les détails déjà
  // reçus en temps réel via WebSocket pour les missions déjà connues, et on
  // ajoute/rafraîchit celles renvoyées par le serveur.
  const syncMissionsFromServer = useCallback(() => {
    let cancelled = false;
    fetch('/api/missions')
      .then(res => (res.ok ? res.json() : { missions: [] }))
      .then((data: { missions?: any[] }) => {
        if (cancelled || !Array.isArray(data.missions)) return;
        const serverEntries = data.missions.map((m): MissionEntry => ({
          id: m.id,
          title: m.title ?? 'Mission',
          status: m.status ?? 'pending',
          priority: m.priority ?? 'medium',
          goals: Array.isArray(m.goals) ? m.goals : [],
          activeGoalId: m.activeGoalId ?? null,
          confidence: typeof m.confidence === 'number' ? m.confidence : 0.5,
          metrics: {
            totalActions: m.metrics?.totalActions ?? 0,
            successfulActions: m.metrics?.successfulActions ?? 0,
            failedActions: m.metrics?.failedActions ?? 0,
          },
          createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
        }));
        setMissions(prev => {
          const byId = new Map(prev.map(m => [m.id, m]));
          for (const s of serverEntries) {
            const existing = byId.get(s.id);
            // Le serveur fait autorité sur status/goals/metrics. Pour une
            // mission déjà connue, on ne conserve que les goals détaillés reçus
            // en live si le serveur n'en renvoie pas encore.
            byId.set(s.id, existing
              ? { ...existing, ...s, goals: s.goals.length > 0 ? s.goals : existing.goals }
              : s);
          }
          return Array.from(byId.values());
        });
      })
      .catch(() => { /* pas de mission system dispo — panneau vide, normal */ });
    return () => { cancelled = true; };
  }, []);

  // Charger l'état initial des missions depuis le serveur (au montage).
  // Le panneau est ensuite mis à jour en temps réel par les événements WebSocket.
  useEffect(() => {
    return syncMissionsFromServer();
  }, [syncMissionsFromServer]);

  // Indique si une mission est « vivante » (tourne, en pause ou bloquée). Lu par
  // le polling via une ref, pour éviter de recréer l'intervalle à chaque
  // changement d'état des missions.
  const hasActiveRef = useRef(false);
  hasActiveRef.current = missions.some(
    m => m.status === 'in_progress' || m.status === 'paused' || m.status === 'blocked'
  );

  // Filet de rafraîchissement : les événements `mission_event` transitent
  // uniquement par le WebSocket `/live` (session de chat). Sans session Live
  // active — cas des missions créées via l'API REST ou le harness — le panneau
  // ne recevrait aucune mise à jour en direct et resterait figé jusqu'à sa
  // réouverture. On complète donc le flux WebSocket par un polling léger de
  // `/api/missions` tant que le panneau est monté. La fusion côté
  // `syncMissionsFromServer` fait autorité sur status/goals/metrics, donc ce
  // polling ne « bat » jamais les événements live plus fins reçus entre-temps.
  //
  // L'intervalle est stable (dépend uniquement de `syncMissionsFromServer`) et
  // se re-planifie lui-même avec un rythme adaptatif : réactif (3 s) quand une
  // mission tourne, économe (10 s) au repos.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cleanup: (() => void) | undefined;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        cleanup?.();
        cleanup = syncMissionsFromServer();
        schedule();
      }, hasActiveRef.current ? 3000 : 10000);
    };
    schedule();

    return () => {
      stopped = true;
      clearTimeout(timer);
      cleanup?.();
    };
  }, [syncMissionsFromServer]);

  // Listen for mission events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MissionEvent>).detail;
      if (!detail || detail.type !== 'mission_event') return;

      // Les demandes d'approbation sont désormais gérées par le store partagé
      // `usePendingApprovals` (écoute le même flux d'événements), afin de rester
      // visibles hors du panneau. On ne les traite donc plus localement ici.

      // Reprise au démarrage : la mission revient d'abord via `mission_resumed`
      // (émis par Executor.resumePending) avec un payload minimal. On resynchronise
      // depuis le serveur pour récupérer l'état complet (goals, métriques, etc.),
      // même si le fetch initial du montage était arrivé trop tôt ou vide.
      if (detail.event === 'mission_resumed') {
        syncMissionsFromServer();
      }

      setMissions(prev => {
        const existing = prev.find(m => m.id === detail.missionId);

        switch (detail.event) {
          case 'mission_plan':
            if (existing) {
              return prev.map(m => m.id === detail.missionId ? { ...m, plan: detail.plan } : m);
            }
            return [...prev, {
              id: detail.missionId,
              title: detail.title ?? 'Mission',
              status: 'pending',
              priority: 'medium',
              goals: [],
              activeGoalId: null,
              confidence: 0.5,
              metrics: { totalActions: 0, successfulActions: 0, failedActions: 0 },
              createdAt: new Date(detail.timestamp),
              plan: detail.plan,
            }];

          case 'mission_started':
            if (existing) return prev.map(m => m.id === detail.missionId ? { ...m, status: 'in_progress' as const } : m);
            return [...prev, {
              id: detail.missionId,
              title: detail.title ?? 'Mission',
              status: 'in_progress',
              priority: 'medium',
              goals: [],
              activeGoalId: null,
              confidence: 0.5,
              metrics: { totalActions: 0, successfulActions: 0, failedActions: 0 },
              createdAt: new Date(detail.timestamp),
            }];

          case 'goal_started':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              const goalExists = m.goals.find(g => g.id === detail.goalId);
              if (goalExists) {
                return {
                  ...m,
                  activeGoalId: detail.goalId!,
                  goals: m.goals.map(g => g.id === detail.goalId ? { ...g, status: 'in_progress' as const } : g),
                };
              }
              return {
                ...m,
                activeGoalId: detail.goalId!,
                goals: [...m.goals, {
                  id: detail.goalId!,
                  title: detail.goalTitle ?? 'Objectif',
                  status: 'in_progress' as const,
                  actions: [],
                }],
              };
            });

          case 'action_started':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              return {
                ...m,
                goals: m.goals.map(g => {
                  if (g.id !== detail.goalId) return g;
                  // Idempotent: an action_started event can fire more than once
                  // for the same actionId (skill re-run / duplicated event). Avoid
                  // pushing a duplicate id, which would collide as a React key.
                  const existing = g.actions.find(a => a.id === detail.actionId);
                  if (existing) {
                    return {
                      ...g,
                      actions: g.actions.map(a =>
                        a.id === detail.actionId
                          ? { ...a, skill: detail.skill ?? a.skill, status: 'in_progress' as const }
                          : a
                      ),
                    };
                  }
                  return {
                    ...g,
                    actions: [...g.actions, {
                      id: detail.actionId!,
                      skill: detail.skill ?? '?',
                      status: 'in_progress' as const,
                    }],
                  };
                }),
              };
            });

          case 'action_completed':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              return {
                ...m,
                confidence: detail.confidence ?? m.confidence,
                metrics: {
                  totalActions: m.metrics.totalActions + 1,
                  successfulActions: m.metrics.successfulActions + (detail.success ? 1 : 0),
                  failedActions: m.metrics.failedActions + (detail.success ? 0 : 1),
                },
                goals: m.goals.map(g => {
                  if (g.id !== detail.goalId) return g;
                  return {
                    ...g,
                    actions: g.actions.map(a => {
                      if (a.id !== detail.actionId) return a;
                      return {
                        ...a,
                        status: detail.success ? 'completed' as const : 'failed' as const,
                        confidence: detail.confidence,
                        decision: detail.decision,
                        durationMs: detail.durationMs,
                      };
                    }),
                  };
                }),
              };
            });

          case 'action_denied':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              return {
                ...m,
                goals: m.goals.map(g => {
                  if (g.id !== detail.goalId) return g;
                  return {
                    ...g,
                    actions: g.actions.map(a =>
                      a.id === detail.actionId ? { ...a, status: 'failed' as const } : a
                    ),
                  };
                }),
              };
            });

          case 'goal_escalated':
          case 'goal_blocked':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              return {
                ...m,
                goals: m.goals.map(g => g.id === detail.goalId ? { ...g, status: 'blocked' as const } : g),
              };
            });

          case 'mission_completed':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              // Quand la mission se termine, on fige les objectifs/actions restés
              // « in_progress » pour éviter des spinners qui tournent à l'infini
              // alors que plus rien ne s'exécute.
              return {
                ...m,
                status: detail.success ? 'completed' as const : 'failed' as const,
                activeGoalId: null,
                goals: finalizeGoals(m.goals, detail.success ?? true),
              };
            });

          case 'mission_cancelled':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              // Idem à l'annulation : on stoppe toutes les animations en cours.
              return {
                ...m,
                status: 'failed' as const,
                activeGoalId: null,
                goals: finalizeGoals(m.goals, false),
              };
            });

          case 'mission_paused':
            return prev.map(m => {
              if (m.id !== detail.missionId) return m;
              return { ...m, status: 'paused' as const };
            });

          case 'mission_resumed':
            // Au redémarrage de l'app, le serveur relance les missions
            // interrompues (Executor.resumePending) et émet `mission_resumed`.
            // Cet événement peut arriver AVANT que le fetch initial de
            // `/api/missions` n'ait peuplé la liste (ou alors que ce fetch avait
            // répondu vide car la reprise côté serveur n'était pas terminée).
            // Il faut donc créer l'entrée si elle est absente — sinon la mission
            // reprise n'apparaît jamais et le panneau affiche « 0 active » alors
            // que la StatusBar la compte bien. On reflète le comportement de
            // `mission_started`.
            if (existing) {
              return prev.map(m => m.id === detail.missionId ? { ...m, status: 'in_progress' as const } : m);
            }
            return [...prev, {
              id: detail.missionId,
              title: detail.title ?? 'Mission',
              status: 'in_progress',
              priority: 'medium',
              goals: [],
              activeGoalId: null,
              confidence: 0.5,
              metrics: { totalActions: 0, successfulActions: 0, failedActions: 0 },
              createdAt: new Date(detail.timestamp),
            }];

          case 'mission_deleted':
            return prev.filter(m => m.id !== detail.missionId);

          default:
            return prev;
        }
      });
    };

    window.addEventListener('Leanna-mission-event', handler);
    return () => window.removeEventListener('Leanna-mission-event', handler);
  }, [syncMissionsFromServer]);

  // Auto-expand first active mission
  useEffect(() => {
    const active = missions.find(m => m.status === 'in_progress');
    if (active && !expandedMission) {
      setExpandedMission(active.id);
    }
  }, [missions, expandedMission]);

  const activeMissions = missions.filter(m => m.status === 'in_progress' || m.status === 'blocked' || m.status === 'paused');
  const completedMissions = missions.filter(m => m.status === 'completed' || m.status === 'failed');

  const content = (
    <div className="flex flex-col h-full">
      {/* Header stats */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
        <div className="flex items-center gap-1.5 flex-1">
          <StatChip count={activeMissions.length} label="actives" color="var(--color-info)" />
          <StatChip count={completedMissions.filter(m => m.status === 'completed').length} label="ok" color="var(--color-success)" />
          <StatChip count={completedMissions.filter(m => m.status === 'failed').length} label="err" color="var(--color-error)" />
        </div>
        <button
          onClick={() => { setShowCreate(v => !v); setCreateError(null); }}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer hover:opacity-80"
          style={{ color: 'var(--color-info)', backgroundColor: 'color-mix(in srgb, var(--color-info) 10%, transparent)' }}
          title="Créer une mission"
        >
          <Plus size={12} /> Nouvelle
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md transition-colors cursor-pointer hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Fermer"
            title="Fermer le panneau"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Formulaire de création */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border-base)' }}
          >
            <div className="px-3 py-2.5 space-y-2">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Titre de la mission"
                disabled={creating}
                className="w-full px-2 py-1.5 rounded-md text-xs outline-none"
                style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-base)' }}
              />
              <textarea
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                placeholder="Décris la tâche complexe à accomplir…"
                disabled={creating}
                rows={2}
                className="w-full px-2 py-1.5 rounded-md text-xs outline-none resize-none"
                style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-base)' }}
              />
              {createError && (
                <p className="text-xs" style={{ color: 'var(--color-error)' }}>{createError}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={createMission}
                  disabled={creating || !newTitle.trim() || !newDescription.trim()}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                  style={{ color: 'var(--color-info)', backgroundColor: 'color-mix(in srgb, var(--color-info) 12%, transparent)' }}
                >
                  {creating ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  Lancer
                </button>
                <button
                  onClick={() => { setShowCreate(false); setCreateError(null); }}
                  disabled={creating}
                  className="px-2 py-1.5 rounded-md text-xs font-medium transition disabled:opacity-50 cursor-pointer"
                  style={{ color: 'var(--text-dimmed)', backgroundColor: 'var(--bg-input)' }}
                >
                  Annuler
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Approbations en attente */}
      {approvals.length > 0 && (
        <div className="px-2 pt-2 space-y-1.5 flex-shrink-0">
          <AnimatePresence initial={false}>
            {approvals.map(approval => (
              <ApprovalCard
                key={approval.actionId}
                approval={approval}
                resolving={resolving === approval.actionId}
                onApprove={() => resolveApproval(approval.missionId, approval.actionId, true)}
                onReject={() => resolveApproval(approval.missionId, approval.actionId, false)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Mission list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 custom-scrollbar">
        {missions.length === 0 ? (
          <EmptyMissionState />
        ) : (
          <AnimatePresence initial={false}>
            {missions.map(mission => (
              <MissionCard
                key={mission.id}
                mission={mission}
                expanded={expandedMission === mission.id}
                expandedGoal={expandedGoal}
                busy={busyMission === mission.id}
                onToggle={() => setExpandedMission(prev => prev === mission.id ? null : mission.id)}
                onToggleGoal={(goalId) => setExpandedGoal(prev => prev === goalId ? null : goalId)}
                onPause={() => controlMission(mission.id, 'pause')}
                onResume={() => controlMission(mission.id, 'resume')}
                onCancel={() => controlMission(mission.id, 'cancel')}
                onDelete={() => controlMission(mission.id, 'delete')}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <Panel
      title="Missions"
      icon={<Target className="w-4 h-4" />}
      actions={
        <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-dimmed)' }}>
          {activeMissions.length} actives
        </span>
      }
    >
      {content}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

function StatChip({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 4.7%, transparent)` }}
    >
      <span className="font-bold">{count}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

function ApprovalCard({
  approval,
  resolving,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  resolving: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const argsPreview = approval.args && Object.keys(approval.args).length > 0
    ? JSON.stringify(approval.args)
    : null;

  // Compte à rebours aligné sur CriticalEditConfirm : sans réponse, la demande
  // expire (le serveur applique le refus « fail-closed »). La couleur s'intensifie
  // sous 10 s pour signaler l'urgence.
  const totalMs = Math.max(1, approval.expiresAt - approval.requestedAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, approval.expiresAt - now);
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const progressPct = Math.min(100, Math.max(0, Math.round((remainingMs / totalMs) * 100)));
  const urgent = secondsLeft <= 10;
  const timerColor = urgent ? 'var(--color-error)' : 'var(--color-warning)';
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
      }}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <Pause size={13} style={{ color: 'var(--color-warning)' }} className="flex-shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide flex-1" style={{ color: 'var(--color-warning)' }}>
            Approbation requise
          </span>
          <span className="text-xs font-mono px-1 py-0.5 rounded flex items-center gap-1"
            style={{ color: 'var(--accent-primary)', backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)' }}>
            <Zap size={9} /> {approval.skill}
          </span>
        </div>

        <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--text-muted)' }}>
          {approval.reason}
        </p>

        {argsPreview && (
          <p className="text-xs font-mono truncate mb-2 opacity-70" style={{ color: 'var(--text-dimmed)' }} title={argsPreview}>
            {argsPreview}
          </p>
        )}

        {/* Compte à rebours avant refus automatique */}
        <div className="flex items-center gap-2 mb-1" aria-hidden={false}>
          <Clock size={11} style={{ color: timerColor, flexShrink: 0 }} />
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: timerColor }}
              initial={false}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.5, ease: 'linear' }}
            />
          </div>
          <span className="text-xs font-mono tabular-nums" style={{ color: timerColor }}>
            {secondsLeft}s
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onApprove}
            disabled={resolving}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
            style={{ color: 'var(--color-success)', backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)' }}
          >
            {resolving ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Approuver
          </button>
          <button
            onClick={onReject}
            disabled={resolving}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
            style={{ color: 'var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)' }}
          >
            <XCircle size={11} />
            Refuser
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function MissionControlButton({
  title,
  onClick,
  disabled,
  color,
  icon,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center w-6 h-6 rounded-md transition disabled:opacity-40 cursor-pointer hover:bg-white/10"
      style={{ color }}
    >
      {icon}
    </button>
  );
}

function MissionCard({
  mission,
  expanded,
  expandedGoal,
  busy,
  onToggle,
  onToggleGoal,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: {
  mission: MissionEntry;
  expanded: boolean;
  expandedGoal: string | null;
  busy: boolean;
  onToggle: () => void;
  onToggleGoal: (goalId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isActive = mission.status === 'in_progress';
  const isPaused = mission.status === 'paused';
  const isRunning = isActive || isPaused || mission.status === 'blocked';
  const isTerminal = mission.status === 'completed' || mission.status === 'failed';
  const isCompleted = mission.status === 'completed';
  const isFailed = mission.status === 'failed';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confColor = confidenceColor(mission.confidence);
  const prefersReducedMotion = useReducedMotion();
  const progress = mission.metrics.totalActions > 0
    ? Math.round((mission.metrics.successfulActions / mission.metrics.totalActions) * 100)
    : 0;

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: isPaused
          ? 'color-mix(in srgb, var(--color-warning) 5%, transparent)'
          : isActive
          ? 'color-mix(in srgb, var(--color-info) 4%, transparent)'
          : isCompleted
          ? 'color-mix(in srgb, var(--color-success) 4%, transparent)'
          : isFailed
          ? 'color-mix(in srgb, var(--color-error) 4%, transparent)'
          : 'var(--bg-input)',
        border: `1px solid ${
          isPaused
            ? 'color-mix(in srgb, var(--color-warning) 25%, transparent)'
            : isActive
            ? 'color-mix(in srgb, var(--color-info) 20%, transparent)'
            : isCompleted
            ? 'color-mix(in srgb, var(--color-success) 18%, transparent)'
            : isFailed
            ? 'color-mix(in srgb, var(--color-error) 18%, transparent)'
            : 'var(--border-base)'
        }`,
      }}
    >
      {/* Mission header */}
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer hover:bg-white/5 transition"
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        {/* Status icon */}
        <div className="flex-shrink-0">
          {statusIcon(mission.status, 14)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {mission.title}
            </span>
            {(() => {
              const sl = statusLabel(mission.status);
              return (
                <span
                  className="flex-shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
                  style={{ color: sl.color, backgroundColor: `color-mix(in srgb, ${sl.color} 10%, transparent)` }}
                >
                  {sl.text}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {/* Progress bar */}
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: confColor }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            {/* Confidence */}
            <div className="flex items-center gap-0.5" style={{ color: confColor }}>
              {confidenceIcon(mission.confidence)}
              <span className="text-xs font-mono font-bold">
                {Math.round(mission.confidence * 100)}%
              </span>
            </div>
          </div>
        </div>

        {/* Contrôles : pause/reprise · annuler · supprimer */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {isRunning && (
            isPaused ? (
              <MissionControlButton
                title="Reprendre la mission"
                onClick={onResume}
                disabled={busy}
                color="var(--color-success)"
                icon={<Play size={12} />}
              />
            ) : (
              <MissionControlButton
                title="Mettre en pause"
                onClick={onPause}
                disabled={busy}
                color="var(--color-warning)"
                icon={<Pause size={12} />}
              />
            )
          )}

          {isRunning && (
            <MissionControlButton
              title="Annuler la mission"
              onClick={onCancel}
              disabled={busy}
              color="var(--color-error)"
              icon={<XCircle size={12} />}
            />
          )}

          {(isTerminal || isRunning) && (
            confirmDelete ? (
              <>
                <MissionControlButton
                  title="Confirmer la suppression"
                  onClick={() => { setConfirmDelete(false); onDelete(); }}
                  disabled={busy}
                  color="var(--color-error)"
                  icon={busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                />
                <MissionControlButton
                  title="Annuler la suppression"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  color="var(--text-dimmed)"
                  icon={<X size={12} />}
                />
              </>
            ) : (
              <MissionControlButton
                title="Supprimer la mission"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                color="var(--text-dimmed)"
                icon={<Trash2 size={12} />}
              />
            )
          )}
        </div>

        <motion.div animate={{ rotate: expanded ? 90 : 0 }} className="flex-shrink-0">
          <ChevronRight size={12} style={{ color: 'var(--text-dimmed)' }} />
        </motion.div>
      </div>

      {/* Expanded: Goal Stack */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5" style={{ borderTop: '1px solid var(--border-base)' }}>
              {mission.plan && <MissionPlanSummary plan={mission.plan} />}

              {/* Metrics row */}
              <div className="flex items-center gap-3 pt-2 pb-1">
                <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                  Actions: <span style={{ color: 'var(--color-success)' }}>{mission.metrics.successfulActions}✓</span>
                  {' '}<span style={{ color: 'var(--color-error)' }}>{mission.metrics.failedActions}✗</span>
                  {' '}/ {mission.metrics.totalActions}
                </span>
              </div>

              {/* Goals */}
              {mission.goals.length === 0 ? (
                <div className="text-xs italic py-2" style={{ color: 'var(--text-dimmed)' }}>
                  Planification en cours...
                </div>
              ) : (
                mission.goals.map(goal => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    isActive={goal.id === mission.activeGoalId}
                    expanded={expandedGoal === goal.id}
                    onToggle={() => onToggleGoal(goal.id)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MissionPlanSummary({ plan }: { plan: MissionPlan }) {
  const sections: Array<{ label: string; items: string[] }> = [
    { label: 'Objectifs', items: plan.objectives },
    { label: 'Fichiers ciblés', items: plan.targetedFiles },
    { label: 'Outils', items: plan.tools },
    { label: 'Risques', items: plan.risks },
    { label: "Conditions d'arrêt", items: plan.stopConditions },
  ];

  return (
    <div className="pt-2 pb-1 space-y-2" style={{ borderBottom: '1px solid var(--border-base)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-info)' }}>
          Plan d'action
        </span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
          ~{plan.estimatedTokens.toLocaleString('fr-FR')} tokens
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {sections.map(section => (
          <div key={section.label} className="text-xs">
            <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>{section.label}: </span>
            <span style={{ color: 'var(--text-dimmed)' }}>{section.items.join(' · ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  isActive,
  expanded,
  onToggle,
}: {
  goal: GoalEntry;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: isActive ? 'rgba(56,189,248,0.06)' : 'transparent',
        border: `1px solid ${isActive ? 'rgba(56,189,248,0.15)' : 'var(--border-base)'}`,
      }}
    >
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer hover:bg-white/5 transition"
        onClick={onToggle}
      >
        <div className="flex-shrink-0">{statusIcon(goal.status, 10)}</div>
        <span className="text-xs flex-1 truncate font-medium" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {goal.title}
        </span>
        {isActive && (
          <span className="text-xs px-1 py-0.5 rounded font-bold uppercase"
            style={{ color: 'var(--color-info)', backgroundColor: 'color-mix(in srgb, var(--color-info) 10%, transparent)' }}>
            actif
          </span>
        )}
        <motion.div animate={{ rotate: expanded ? 90 : 0 }}>
          <ChevronRight size={9} style={{ color: 'var(--text-dimmed)' }} />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && goal.actions.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 space-y-0.5" style={{ borderTop: '1px solid var(--border-base)' }}>
              {goal.actions.map(action => (
                <ActionRow key={action.id} action={action} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionRow({ action }: { action: ActionEntry }) {
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-white/5">
      <div className="flex-shrink-0">{statusIcon(action.status, 9)}</div>
      <Zap size={9} style={{ color: 'var(--accent-primary)' }} className="flex-shrink-0" />
      <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
        {action.skill}
      </span>
      {action.durationMs && (
        <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
          {formatDuration(action.durationMs)}
        </span>
      )}
      {action.decision && decisionBadge(action.decision)}
      {action.confidence !== undefined && (
        <span className="text-xs font-mono" style={{ color: confidenceColor(action.confidence) }}>
          {Math.round(action.confidence * 100)}%
        </span>
      )}
    </div>
  );
}

function EmptyMissionState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-input)' }}
      >
        <Target size={20} style={{ color: 'var(--text-dimmed)' }} />
      </div>
      <div className="text-center px-4">
        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
          Aucune mission active
        </p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-dimmed)' }}>
          Les missions se déclenchent pour les tâches complexes multi-étapes.
          L'IA décompose, planifie, exécute et vérifie automatiquement.
        </p>
      </div>
    </div>
  );
}
