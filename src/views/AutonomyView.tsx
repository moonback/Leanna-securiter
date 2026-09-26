/**
 * AutonomyView — Centre de contrôle Autonomie
 *
 * Point d'entrée unique qui consolide, en une vue, les surfaces auparavant
 * dispersées (réglages, navigation, menu agent, in-context) :
 *   1. Niveau d'autonomie (sélecteur pilotable)
 *   2. Approbations en attente (boucle humaine)
 *   3. Garde-fous actifs (résumé + lien vers les réglages)
 *   4. Statut du runtime + dernières actions (timeline temps réel)
 *
 * La timeline reste purement observationnelle ; les autres blocs sont pilotables
 * et partagent leur état avec les réglages détaillés (mêmes hooks/stores).
 */

import { useCallback, useState } from 'react';
import { SlidersHorizontal, ShieldCheck, Settings, Loader2, Play, XCircle, Clock } from 'lucide-react';
import { ViewHeader } from '../components/ui/ViewHeader.js';
import { AutonomyTimeline } from '../components/AutonomyTimeline.js';
import { AutonomyLevelSelector } from '../components/autonomy/AutonomyLevelSelector.js';
import { useSafeguardsConfig } from '../hooks/useSafeguardsConfig.js';
import { usePendingApprovals, clearPendingApproval, type PendingApprovalInfo } from '../hooks/usePendingApprovals.js';

const SAFEGUARD_LABELS: { key: 'autoCheckpoint' | 'postEditValidation' | 'criticalFileConfirm' | 'autoRestart'; label: string }[] = [
  { key: 'autoCheckpoint', label: 'Checkpoint auto' },
  { key: 'postEditValidation', label: 'Validation post-édition' },
  { key: 'criticalFileConfirm', label: 'Confirmation fichiers critiques' },
  { key: 'autoRestart', label: 'Redémarrage contrôlé' },
];

export default function AutonomyView() {
  const { config, update } = useSafeguardsConfig();
  const approvals = usePendingApprovals();

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: 'var(--bg-base)' }}>
      <ViewHeader
        title="Centre de contrôle Autonomie"
        icon={SlidersHorizontal}
        description="Niveau d'autonomie, approbations, garde-fous et activité du runtime — en un seul endroit"
        badge="En direct"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">

          {/* 1 — Niveau d'autonomie */}
          <ControlCard icon={SlidersHorizontal} title="Niveau d'autonomie">
            <p className="mb-2.5 text-sm" style={{ color: 'var(--text-muted)' }}>
              Détermine jusqu'où l'IA peut agir seule avant de demander votre aval.
            </p>
            <AutonomyLevelSelector
              value={config.autonomyLevel ?? 'manual'}
              onChange={level => void update({ autonomyLevel: level })}
            />
          </ControlCard>

          {/* 2 — Approbations en attente */}
          <PendingApprovalsCard approvals={approvals} />

          {/* 3 — Garde-fous actifs */}
          <ControlCard
            icon={ShieldCheck}
            title="Garde-fous actifs"
            action={
              <a
                href="#/settings"
                className="flex items-center gap-1 text-xs font-medium"
                style={{ color: 'var(--accent-primary)' }}
                title="Ouvrir les réglages détaillés"
              >
                <Settings size={11} /> Réglages
              </a>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {SAFEGUARD_LABELS.map(({ key, label }) => {
                const on = Boolean(config[key]);
                return (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: on
                        ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                        : 'var(--bg-input)',
                      border: `1px solid ${on ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : 'var(--border-base)'}`,
                      color: on ? 'var(--color-success)' : 'var(--text-dimmed)',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: on ? 'var(--color-success)' : 'var(--text-dimmed)' }}
                    />
                    {label}
                    <span className="opacity-70">{on ? 'activé' : 'désactivé'}</span>
                  </span>
                );
              })}
            </div>
          </ControlCard>

          {/* 4 — Statut du runtime + dernières actions */}
          <div
            className="flex min-h-[22rem] flex-col overflow-hidden rounded-lg border shadow-sm"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
          >
            <AutonomyTimeline className="h-full" />
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ControlCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.FC<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border p-4 shadow-sm"
      style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color: 'var(--accent-primary)' }} />
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PendingApprovalsCard({ approvals }: { approvals: PendingApprovalInfo[] }) {
  const [resolving, setResolving] = useState<string | null>(null);

  const resolve = useCallback(async (missionId: string, actionId: string, approved: boolean) => {
    setResolving(actionId);
    try {
      const res = await fetch(`/api/missions/${missionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, approved }),
      });
      if (res.ok || res.status === 404) clearPendingApproval(actionId);
    } catch {
      /* l'expiration côté serveur reste le filet de sécurité */
    } finally {
      setResolving(null);
    }
  }, []);

  return (
    <ControlCard
      icon={Clock}
      title={`Approbations en attente${approvals.length > 0 ? ` (${approvals.length})` : ''}`}
    >
      {approvals.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
          Aucune action en attente de votre validation.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {approvals.map(a => (
            <li
              key={a.actionId}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {a.skill}
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{a.reason}</p>
              </div>
              <button
                onClick={() => resolve(a.missionId, a.actionId, true)}
                disabled={resolving === a.actionId}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition disabled:opacity-50"
                style={{ color: 'var(--color-success)', backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)' }}
              >
                {resolving === a.actionId ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                Approuver
              </button>
              <button
                onClick={() => resolve(a.missionId, a.actionId, false)}
                disabled={resolving === a.actionId}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition disabled:opacity-50"
                style={{ color: 'var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)' }}
              >
                <XCircle size={11} />
                Refuser
              </button>
            </li>
          ))}
        </ul>
      )}
    </ControlCard>
  );
}
