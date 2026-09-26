
import React, { useEffect, useState } from 'react';
import { Play, Pause, Trash2, Zap, Clock, GitBranch, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { WorkflowsPanel, WorkflowViewModel } from '../components/panels/WorkflowsPanel.js';
import { ViewHeader } from '../components/ui/ViewHeader.js';
import { useToast } from '../components/ui/Toast.js';
import { EmptyState } from '../components/ui/EmptyState.js';

interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  interval: string;
  enabled: boolean;
  nextRunAt: string | null;
}

export default function AutomationView() {
  const { error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<'workflows' | 'tasks'>('workflows');
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowViewModel[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/automation/scheduled-tasks');
      const data = await response.json();
      if (data.status === 'success') {
        setTasks(data.tasks);
      }
    } catch (error) {
      toastError('Impossible de charger les tâches planifiées');
      console.error('Erreur lors de la récupération des tâches:', error);
    }
  };

  const fetchWorkflows = async () => {
    try {
      const response = await fetch('/api/workflows');
      const data = await response.json();
      if (data.status === 'success' && Array.isArray(data.workflows)) {
        setWorkflows(data.workflows);
      }
    } catch (error) {
      toastError('Impossible de charger les workflows');
      console.error('Erreur lors de la récupération des workflows:', error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchTasks(), fetchWorkflows()]);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
    const timer = setInterval(() => {
      fetchTasks();
      fetchWorkflows();
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const toggleTask = async (id: string, currentlyEnabled: boolean) => {
    try {
      const action = currentlyEnabled ? 'pause' : 'resume';
      await fetch(`/api/automation/scheduled-tasks/${id}/${action}`, { method: 'POST' });
      fetchTasks();
    } catch (error) {
      const action = currentlyEnabled ? 'pause' : 'resume';
      console.error(`Erreur lors du changement d'état (${action}) de la tâche:`, error);
    }
  };

  const runNow = async (id: string) => {
    try {
      await fetch(`/api/automation/scheduled-tasks/${id}/run`, { method: 'POST' });
      fetchTasks();
    } catch (error) {
      console.error('Erreur lors de l’exécution immédiate:', error);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await fetch(`/api/automation/scheduled-tasks/${id}`, { method: 'DELETE' });
      fetchTasks();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
      <ViewHeader
        icon={Zap}
        title="Automatisations & Workflows"
        badge="Low-Code"
        description="Crée et surveille tes workflows visuels et tâches planifiées"
        actions={
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-ctrl)] border border-[var(--border-base)]">
            <button
              onClick={() => setActiveTab('workflows')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                activeTab === 'workflows'
                  ? 'bg-[var(--bg-panel)] text-[var(--accent-primary)] shadow-sm border border-[var(--border-base)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              <GitBranch className="w-3.5 h-3.5" /> Workflows visuels ({workflows.length})
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                activeTab === 'tasks'
                  ? 'bg-[var(--bg-panel)] text-[var(--accent-primary)] shadow-sm border border-[var(--border-base)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              <Zap className="w-3.5 h-3.5" /> Tâches ({tasks.length})
            </button>
          </div>
        }
      />

      <main className="custom-scrollbar flex-1 overflow-y-auto p-5 lg:p-7">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement des automatisations...</p>
          </div>
        ) : activeTab === 'workflows' ? (
          <WorkflowsPanel workflows={workflows} onRefresh={fetchWorkflows} />
        ) : tasks.length === 0 ? (
          <div className="border-2 border-dashed border-[var(--border-base)] rounded-2xl p-12 text-center bg-[var(--bg-panel)]">
            <Zap className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
            <p className="text-[var(--text-muted)] font-medium">Aucune tâche planifiée pour le moment.</p>
            <p className="text-sm text-[var(--text-dimmed)] mt-1">Une fois créées, elles apparaîtront ici.</p>
          </div>
        ) : (
          <div className="grid gap-5">
            {tasks.map(task => (
              <div key={task.id} 
                className="group border border-[var(--border-base)] p-5 rounded-2xl bg-[var(--bg-panel)] flex items-center justify-between gap-6 transition-all hover:border-[var(--border-strong)] hover:shadow-lg hover:-translate-y-0.5"
                style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className={clsx(
                      'w-3 h-3 rounded-full relative',
                      task.enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
                    )}>
                      <span className={clsx(
                        'absolute inset-0 rounded-full animate-ping opacity-75',
                        task.enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
                      )} style={{ animationDuration: '2s' }}></span>
                    </span>
                    <h3 className="font-bold text-lg text-[var(--text-primary)] truncate">
                      {task.name}
                    </h3>
                  </div>
                  
                  <p className="text-sm text-[var(--text-secondary)] mt-1.5 line-clamp-2 leading-relaxed">
                    {task.description || 'Pas de description fournie.'}
                  </p>
                  
                  <div className="flex items-center gap-4 mt-3.5 text-[12px] text-[var(--text-muted)] bg-[var(--bg-ctrl)] px-3 py-1.5 rounded-full w-fit border border-[var(--border-base)]">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="w-3.5 h-3.5" /> Intervalle: <span className="text-[var(--text-primary)] font-semibold">{task.interval}</span>
                    </span>
                    <span className="w-1 h-1 rounded-full bg-[var(--border-strong)]" />
                    <span className="font-medium">
                      Prochain lancement: <span className="text-[var(--text-primary)] font-semibold">{task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : 'N/A'}</span>
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <button onClick={() => runNow(task.id)} 
                    className="p-3 rounded-xl transition-colors hover:bg-[var(--ctrl-hover)] text-[var(--ctrl-icon)] hover:text-[var(--accent-primary)] bg-[var(--bg-ctrl)] border border-[var(--border-base)]"
                    title="Lancer maintenant">
                    <Play className="w-5 h-5" />
                  </button>
                  <button onClick={() => toggleTask(task.id, task.enabled)} 
                    className="p-3 rounded-xl transition-colors hover:bg-[var(--ctrl-hover)] text-[var(--ctrl-icon)] hover:text-[var(--accent-primary)] bg-[var(--bg-ctrl)] border border-[var(--border-base)]"
                    title={task.enabled ? 'Désactiver' : 'Activer'}>
                    {task.enabled ? <Pause className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                  </button>
                  <button onClick={() => deleteTask(task.id)} 
                    className="p-3 rounded-xl transition-colors hover:bg-[var(--ctrl-hover)] text-[var(--color-error)] hover:bg-[var(--color-error)]/10 bg-[var(--bg-ctrl)] border border-[var(--border-base)]"
                    title="Supprimer">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

