import { useState, useCallback } from 'react';

export interface ActivityStep {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
  timestamp: Date;
  /** Set when the step transitions from running → done/error */
  endTimestamp?: Date;
}

export interface ModifiedFile {
  path: string;
  tool: 'write_project_file' | 'modify_project_file' | 'create_project_directory';
  timestamp: Date;
}

export interface ReasoningStep {
  index: number;
  label: string;
  content: string;
  status: 'running' | 'done' | 'skipped' | 'failed';
  durationMs?: number;
}

export interface ReasoningState {
  active: boolean;
  strategy?: string;
  strategyLabel?: string;
  announcement?: string;
  /** Texte reçu progressivement pendant les stratégies streamées. */
  streamText?: string;
  /** Dernier fragment reçu, utile pour les consommateurs temps réel. */
  chunk?: string;
  cached?: boolean;
  /** Étapes CoT visibles en temps réel */
  steps?: ReasoningStep[];
  /** Complexité détectée : simple | moderate | complex | critical */
  complexity?: 'simple' | 'moderate' | 'complex' | 'critical';
  /** Nombre d'étapes total prévu (si connu) */
  totalSteps?: number;
}

function toolLabel(tool: string, args?: Record<string, unknown>): string {
  const p = (key: string) => (args?.[key] as string | undefined) ?? '';
  const labels: Record<string, (a: typeof args) => string> = {
    list_project_files:        () => `Explorer ${p('path') || '.'}`,
    read_project_file:         () => `Lire ${p('path')}`,
    write_project_file:        () => `Écrire ${p('path')}`,
    modify_project_file:       () => `Modifier ${p('path')}`,
    search_in_files:           () => `Chercher "${p('query')}"`,
    open_project_file:         () => `Ouvrir ${p('path')}`,
    create_project_directory:  () => `Créer dossier ${p('path')}`,
    rename_project_file:       () => `Renommer ${p('oldPath')}`,
    delete_project_file:       () => `Supprimer ${p('path')}`,
    delete_project_folder:     () => `Supprimer dossier ${p('path')}`,
    analyze_project_file:      () => `Analyser ${p('path')}`,
    get_workspace_info:        () => 'Info workspace',
    generate_codebase_markdown:() => 'Générer codebase.md',
    open_ide:                  () => 'Ouvrir IDE',
    save_memory:               () => 'Sauvegarder en mémoire',
    search_memory:             () => `Chercher en mémoire: ${p('query')}`,
    automation_navigate:       () => `Naviguer vers ${p('url')}`,
    automation_search:         () => `Rechercher: ${p('query')}`,
    create_rich_document:      () => `Créer document "${p('title')}"`,
    automation_snapshot:       () => 'Capture page',
    automation_click:          () => `Cliquer ${p('selector')}`,
    automation_type:           () => `Saisir dans ${p('selector')}`,
    automation_extract:        () => 'Extraire contenu',
    reasoning_delegate_task:   () => `Déléguer: ${p('task_type')}`,
    reasoning_think:           () => `🧠 Raisonnement: ${p('strategy') || 'auto'}`,
    reasoning_list_strategies: () => 'Lister stratégies de pensée',
    // Agent multi-rôles
    agent_delegate:            () => `🤖 Déléguer → ${p('role')}: ${p('title') || 'tâche'}`,
    agent_orchestrate:         () => `🎯 Orchestration: ${p('title') || 'multi-agents'}`,
    agent_status:              () => `📊 Statut agent: ${p('taskId')?.slice(0, 8) || '...'}`,
    agent_list_tasks:          () => `📋 Tâches agents${p('role') ? ` (${p('role')})` : ''}`,
    agent_list_roles:          () => '🤖 Lister les agents disponibles',
    agent_cancel:              () => `🚫 Annuler tâche: ${p('taskId')?.slice(0, 8) || '...'}`,
    agent_stats:               () => '📈 Statistiques agents',
  };
  const fn = labels[tool];
  return fn ? fn(args) : tool.replace(/_/g, ' ');
}

export function useActivity() {
  const [activity, setActivity] = useState<ActivityStep[]>([]);
  const [modifiedFiles, setModifiedFiles] = useState<ModifiedFile[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [reasoning, setReasoning] = useState<ReasoningState>({ active: false });

  const startActivity = useCallback((tool: string, args?: Record<string, unknown>) => {
    const step: ActivityStep = {
      id: Date.now().toString() + Math.random(),
      tool,
      label: toolLabel(tool, args),
      status: 'running',
      timestamp: new Date(),
    };
    setActivity(prev => [...prev.slice(-19), step]);

    // Track files being written/modified by the assistant
    const writingTools = ['write_project_file', 'modify_project_file'] as const;
    if (writingTools.includes(tool as any) && args?.path) {
      const filePath = args.path as string;
      setModifiedFiles(prev => {
        const exists = prev.some(f => f.path === filePath);
        if (exists) return prev;
        return [...prev, {
          path: filePath,
          tool: tool as ModifiedFile['tool'],
          timestamp: new Date(),
        }];
      });
    }
  }, []);

  const completeActivity = useCallback((tool: string, isError = false) => {
    setActivity(prev => prev.map(s =>
      s.tool === tool && s.status === 'running'
        ? { ...s, status: isError ? 'error' : 'done', endTimestamp: new Date() }
        : s
    ));
  }, []);

  const clearActivity = useCallback(() => setActivity([]), []);
  const clearModifiedFiles = useCallback(() => setModifiedFiles([]), []);

  const resetActivityState = useCallback(() => {
    setActivity([]);
    setModifiedFiles([]);
    setIsBusy(false);
    setReasoning({ active: false });
  }, []);

  return {
    activity,
    modifiedFiles,
    isBusy,
    reasoning,
    setIsBusy,
    setReasoning,
    startActivity,
    completeActivity,
    clearActivity,
    clearModifiedFiles,
    resetActivityState,
  };
}
