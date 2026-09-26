/**
 * usePendingApprovals — source unique de vérité pour les demandes d'approbation
 * de missions en attente de l'aval de l'utilisateur.
 *
 * Pourquoi : l'`ApprovalCard` du `MissionPanel` gardait ces demandes dans un
 * état local — invisibles tant que le panneau n'était pas ouvert. Ce store
 * partagé écoute le même flux `Leanna-mission-event` que le reste de l'UI et
 * expose un compteur global, permettant d'afficher une pastille de
 * notification ailleurs (barre de statut, entrée « Missions »).
 *
 * Sécurité de la boucle humaine : chaque demande porte une échéance
 * (`expiresAt`). Passé ce délai — cohérent avec `CriticalEditConfirm` — la
 * demande est retirée localement (le serveur applique le refus « fail-closed »
 * de son côté), évitant une pastille fantôme qui resterait allumée.
 */

import { useSyncExternalStore } from 'react';

export interface PendingApprovalInfo {
  actionId: string;
  missionId: string;
  skill: string;
  reason: string;
  /** Arguments de l'action (aperçu affiché dans la carte d'approbation). */
  args?: Record<string, unknown>;
  requestedAt: number;
  /** Timestamp (ms) au-delà duquel la demande est considérée expirée. */
  expiresAt: number;
}

/** Délai de repli si l'événement ne fournit pas de `timeoutMs` (aligné sur les garde-fous). */
const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

interface MissionEventDetail {
  type?: string;
  event?: string;
  missionId?: string;
  actionId?: string;
  skill?: string;
  reason?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

// ── État module-level partagé entre tous les abonnés ────────────────────────
let approvals: PendingApprovalInfo[] = [];
const listeners = new Set<() => void>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function emit() {
  for (const l of listeners) l();
}

function setApprovals(next: PendingApprovalInfo[]) {
  approvals = next;
  emit();
}

/** Retire les demandes dont l'échéance est dépassée. */
function sweepExpired() {
  const now = Date.now();
  const alive = approvals.filter(a => a.expiresAt > now);
  if (alive.length !== approvals.length) setApprovals(alive);
  if (alive.length === 0 && sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function ensureSweeper() {
  if (!sweepTimer) sweepTimer = setInterval(sweepExpired, 1000);
}

function handleMissionEvent(e: Event) {
  const detail = (e as CustomEvent<MissionEventDetail>).detail;
  if (!detail || detail.type !== 'mission_event' || !detail.actionId) return;

  if (detail.event === 'approval_required') {
    if (approvals.some(a => a.actionId === detail.actionId)) return;
    const now = Date.now();
    setApprovals([
      ...approvals,
      {
        actionId: detail.actionId,
        missionId: detail.missionId ?? '?',
        skill: detail.skill ?? '?',
        reason: detail.reason ?? 'Approbation requise.',
        args: detail.args,
        requestedAt: now,
        expiresAt: now + (detail.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS),
      },
    ]);
    ensureSweeper();
  } else if (
    detail.event === 'action_denied' ||
    detail.event === 'approval_timeout' ||
    detail.event === 'action_completed'
  ) {
    // Résolue d'une manière ou d'une autre → retirer la demande.
    const next = approvals.filter(a => a.actionId !== detail.actionId);
    if (next.length !== approvals.length) setApprovals(next);
  }
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('Leanna-mission-event', handleMissionEvent);
}

function subscribe(callback: () => void): () => void {
  ensureInitialized();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): PendingApprovalInfo[] {
  return approvals;
}

const EMPTY: PendingApprovalInfo[] = [];
function getServerSnapshot(): PendingApprovalInfo[] {
  return EMPTY;
}

/** Résout localement une demande (après action utilisateur via l'API). */
export function clearPendingApproval(actionId: string) {
  const next = approvals.filter(a => a.actionId !== actionId);
  if (next.length !== approvals.length) setApprovals(next);
}

/** Liste réactive des approbations en attente. */
export function usePendingApprovals(): PendingApprovalInfo[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Nombre d'approbations en attente (pour pastilles/badges). */
export function usePendingApprovalCount(): number {
  return usePendingApprovals().length;
}
