import React from 'react';
import { Clock3, CheckCircle2, Circle } from 'lucide-react';
import { Panel } from '../ui/Panel.js';

export interface ScheduledTaskViewModel {
  id: string;
  name: string;
  description: string;
  actionName: string;
  intervalMs: number;
  enabled?: boolean;
  lastRunAt?: number;
}

interface ScheduledTasksPanelProps {
  tasks: ScheduledTaskViewModel[];
  onRefresh?: () => Promise<void> | void;
}

function formatInterval(ms: number) {
  if (ms >= 3600_000) return `${(ms / 3600_000).toFixed(ms % 3600_000 === 0 ? 0 : 1)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function formatRelative(ts?: number) {
  if (!ts) return 'Jamais';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'À l’instant';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`; 
  return `${Math.round(diff / 3_600_000)}h`;
}

export const ScheduledTasksPanel = React.memo(function ScheduledTasksPanel({ tasks, onRefresh }: ScheduledTasksPanelProps) {
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const runAction = React.useCallback(async (path: string, method: 'POST' | 'DELETE' = 'POST') => {
    setBusyId(path);
    try {
      await fetch(path, { method });
      await onRefresh?.();
    } finally {
      setBusyId(null);
    }
  }, [onRefresh]);

  return (
    <Panel title="Tâches planifiées" icon={<Clock3 className="w-4 h-4" />}>
      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <div className="rounded-xl border px-3 py-3 text-xs" style={{ borderColor: 'var(--border-base)', color: 'var(--text-dimmed)' }}>
            Aucune tâche planifiée pour le moment.
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}>
              <div className="flex items-start gap-2">
                <div className="mt-0.5"><CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{task.name}</span>
                    <span className="text-sm font-mono" style={{ color: 'var(--text-dimmed)' }}>{formatInterval(task.intervalMs)}</span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>{task.description || task.actionName}</div>
                  <div className="flex items-center gap-2 mt-1 text-sm" style={{ color: 'var(--text-dimmed)' }}>
                    <span className="inline-flex items-center gap-1"><Circle className="w-2.5 h-2.5" style={{ color: 'var(--accent-primary)' }} />{task.actionName}</span>
                    <span>•</span>
                    <span>Dernière exécution: {formatRelative(task.lastRunAt)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => runAction(`/api/automation/scheduled-tasks/${task.id}/toggle`)}
                      disabled={busyId === task.id}
                      className="rounded-md border px-2 py-1 text-sm font-semibold disabled:opacity-50"
                      style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                    >
                      {task.enabled === false ? 'Reprendre' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(`/api/automation/scheduled-tasks/${task.id}/run`)}
                      disabled={busyId === task.id}
                      className="rounded-md border px-2 py-1 text-sm font-semibold disabled:opacity-50"
                      style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                    >
                      Exécuter
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(`/api/automation/scheduled-tasks/${task.id}`, 'DELETE')}
                      disabled={busyId === task.id}
                      className="rounded-md border px-2 py-1 text-sm font-semibold disabled:opacity-50"
                      style={{ borderColor: 'var(--border-base)', color: 'var(--accent-primary)' }}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
});
