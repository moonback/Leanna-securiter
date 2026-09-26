/**
 * Global store for agent/tool activity — persists even when AgentPanel is unmounted.
 * This ensures no events are lost when the panel is closed.
 */

export interface ToolActivityEntry {
  id: string;
  tool: string;
  label: string;
  agentId: string;
  status: 'running' | 'done';
  timestamp: number;
  endTimestamp?: number;
  args?: any;
  result?: string;
}

export interface AgentTaskEntry {
  id: string;
  role: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  agentName: string;
  detail?: string;
  summary?: string;
  timestamp: number;
  durationMs?: number;
  progress?: { current: number; total: number; label: string };
  steps: string[];
}

type Listener = () => void;

const MAX_TOOL_ACTIVITIES = 80;
const STALE_THRESHOLD_MS = 60000;

let toolActivities: ToolActivityEntry[] = [];
let agentTasks: AgentTaskEntry[] = [];
let listeners: Listener[] = [];
let initialized = false;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// ═══════════════════════════════════════════════════════════════════════════════
// Tool-Agent Mapping
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mapping dynamique outil → agent basé sur les capabilities des rôles d'agents.
 * Ce mapping est généré à partir des définitions centralisées dans server/agents/roles.ts
 * et est mis à jour automatiquement lors de l'initialisation.
 * 
 * Pour les outils non trouvés dans le mapping dynamique, un fallback statique est utilisé.
 */
let toolToAgentCache: Map<string, string> | null = null;

/**
 * Mapping statique de fallback pour les outils non couverts par le mapping dynamique.
 * Ce mapping est progressivement remplacé par le système dynamique basé sur les capabilities.
 */
const FALLBACK_TOOL_TO_AGENT: Record<string, string> = {
  read_project_file: 'writer', write_project_file: 'writer', modify_project_file: 'writer',
  patch_project_file: 'writer', analyze_project_file: 'researcher', search_in_files: 'researcher',
  read_file_outline: 'planner', open_project_file: 'writer',
  list_project_files: 'researcher', create_project_directory: 'writer',
  rename_project_file: 'writer', delete_project_file: 'writer', delete_project_folder: 'writer', get_workspace_info: 'researcher',
  git_status: 'writer', git_diff: 'writer', git_stage: 'writer', git_unstage: 'writer',
  git_commit: 'writer', git_push: 'writer', git_pull: 'writer', git_branches: 'writer',
  git_switch_branch: 'writer', git_log: 'writer',
  system_execute_command: 'writer', system_open: 'writer', system_notify: 'writer',
  automation_navigate: 'researcher', automation_click: 'researcher', automation_type: 'researcher',
  automation_extract: 'researcher', automation_search: 'researcher', automation_snapshot: 'researcher',
  save_memory: 'planner', search_memory: 'researcher', search_history: 'researcher',
  get_conversation_context: 'researcher',
  reasoning_delegate_task: 'planner', reasoning_think: 'planner',
  reasoning_list_strategies: 'planner',
  mission_create: 'planner', mission_status: 'planner', mission_list: 'planner',
  agent_delegate: 'planner', agent_orchestrate: 'planner',
};

/**
 * Initialise le mapping dynamique outil → agent.
 * Charge le mapping depuis le serveur si disponible (via window), 
 * sinon utilise le fallback statique.
 */
function initializeToolAgentMapping(): void {
  // Essayer de récupérer le mapping depuis le backend
  if (typeof window !== 'undefined' && window.LeannaToolAgentMapping) {
    toolToAgentCache = new Map(Object.entries(window.LeannaToolAgentMapping));
    console.log(`[agentActivityStore] Mapping outil→agent chargé depuis le backend (${toolToAgentCache.size} outils)`);
    return;
  }
  
  // Fallback : créer un mapping à partir du fallback statique
  toolToAgentCache = new Map(Object.entries(FALLBACK_TOOL_TO_AGENT));
  console.log(`[agentActivityStore] Mapping outil→agent initialisé avec fallback statique (${toolToAgentCache.size} outils)`);
}

function notify() {
  for (const fn of listeners) fn();
}

// ─── Tool Activity ───────────────────────────────────────────────────────────

function getAgentForTool(tool: string): string {
  // Vérifier si le cache est initialisé
  if (!toolToAgentCache) {
    initializeToolAgentMapping();
  }
  
  // Chercher dans le cache dynamique
  if (toolToAgentCache) {
    const agent = toolToAgentCache.get(tool);
    if (agent) {
      return agent;
    }
  }
  
  // Fallback vers le mapping statique, puis rôle neutre « Exécution système ».
  // Ne PAS retomber sur 'writer' : cela attribuerait faussement du travail
  // système au Rédacteur (fausse télémétrie).
  return FALLBACK_TOOL_TO_AGENT[tool] ?? UNATTRIBUTED_ROLE;
}

function formatToolLabel(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/^(read|write|modify|patch|list|create|delete|rename|get|search|run|verify|save|analyze|open)/, (m) => m + ':')
    .replace(/project file/, 'fichier')
    .replace(/project files/, 'fichiers');
}

function mapStatus(status: string): AgentTaskEntry['status'] {
  if (status === 'running' || status === 'pending' || status === 'completed' || status === 'failed' || status === 'cancelled') {
    return status;
  }
  return 'pending';
}

function handleToolStart(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail?.tool) return;
  const agentId = getAgentForTool(detail.tool);
  const id = `${detail.tool}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toolActivities = [...toolActivities.slice(-(MAX_TOOL_ACTIVITIES - 1)), {
    id,
    tool: detail.tool,
    label: formatToolLabel(detail.tool),
    agentId,
    status: 'running',
    timestamp: Date.now(),
    args: detail.args,
  }];
  notify();
}

function handleToolDone(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail?.tool) return;
  const idx = [...toolActivities].reverse().findIndex(a => a.tool === detail.tool && a.status === 'running');
  if (idx === -1) return;
  const realIdx = toolActivities.length - 1 - idx;
  toolActivities = [...toolActivities];
  toolActivities[realIdx] = {
    ...toolActivities[realIdx],
    status: 'done',
    endTimestamp: Date.now(),
    result: detail.info || detail.result,
  };
  notify();
}

function handleAgentEvent(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail || detail.type !== 'agent_event') return;

  const existing = agentTasks.find(t => t.id === detail.taskId);
  if (existing) {
    agentTasks = agentTasks.map(t => t.id === detail.taskId ? {
      ...t,
      status: mapStatus(detail.status),
      detail: detail.detail || t.detail,
      summary: detail.summary || t.summary,
      durationMs: detail.durationMs || t.durationMs,
      progress: detail.progress || t.progress,
      steps: detail.detail && !t.steps.includes(detail.detail)
        ? [...t.steps, detail.detail]
        : t.steps,
    } : t);
  } else {
    agentTasks = [...agentTasks, {
      id: detail.taskId,
      role: detail.role,
      title: detail.title,
      status: mapStatus(detail.status),
      agentName: detail.agentName,
      detail: detail.detail,
      summary: detail.summary,
      timestamp: detail.timestamp ? new Date(detail.timestamp).getTime() : Date.now(),
      durationMs: detail.durationMs,
      progress: detail.progress,
      steps: detail.detail ? [detail.detail] : [],
    }];
  }
  notify();
}

// ─── Cleanup (called periodically) ──────────────────────────────────────────

function cleanup() {
  const now = Date.now();
  const beforeLen = toolActivities.length;
  toolActivities = toolActivities.filter(a =>
    a.status === 'running' || (now - a.timestamp) < STALE_THRESHOLD_MS
  );
  if (toolActivities.length !== beforeLen) notify();
}

// ─── Role → Agent name mapping (mirrors AgentPanel.tsx / AgentsSection.tsx) ──

/**
 * Rôle neutre pour les outils exécutables non rattachés à un agent spécialisé
 * (primitives système : browser, telegram, weather, system_execute, etc.).
 *
 * IMPORTANT : ne JAMAIS retomber sur 'writer' pour ces outils. Attribuer du
 * travail système au « Rédacteur » crée une fausse télémétrie agentique
 * (observabilité, audit, historique, attribution des coûts). Ce rôle doit
 * rester synchronisé avec le fallback backend `UNATTRIBUTED_ROLE`
 * dans server/agents/toolAgentMapper.ts.
 */
export const UNATTRIBUTED_ROLE = 'system';

/**
 * Rôle d'affichage pour une attribution par catégorie (ensemble d'agents).
 * Doit rester synchronisé avec `MULTI_ROLE` côté serveur
 * (server/agents/toolAgentMapper.ts). Un outil marqué `multi` est utilisable
 * par plusieurs agents : on n'en désigne aucun comme propriétaire unique.
 */
export const MULTI_ROLE = 'multi';

const ROLE_TO_AGENT_NAME: Record<string, string> = {
  coder:      'Développeur',
  refactor:   'Refactorisation',
  debugger:   'Débogueur',
  reviewer:   'Revue de Code',
  tester:     'QA & Tests',
  security:   'Sécurité & Audit',
  architect:  'Architecte',
  vision:     'Analyse Visuelle',
  writer:     'Rédacteur',
  formatter:  'Mise en forme',
  researcher: 'Recherche',
  proofreader:'Correcteur',
  translator: 'Traducteur',
  summarizer: 'Synthèse',
  planner:    'Planificateur',
  [UNATTRIBUTED_ROLE]: 'Exécution système',
  [MULTI_ROLE]: 'Plusieurs agents',
};

// ─── Server sync ─────────────────────────────────────────────────────────────

/**
 * Récupère les tâches actives (running/pending) depuis le serveur et les
 * injecte dans le store. Appelé à chaque reconnexion WebSocket pour restaurer
 * le suivi des agents qui tournaient pendant la déconnexion.
 * 
 * Idempotent : les tâches déjà présentes dans le store sont mises à jour,
 * les nouvelles sont ajoutées, les terminées ne sont pas modifiées.
 */
export async function syncActiveTasksFromServer(): Promise<void> {
  try {
    const res = await fetch('/api/agents/tasks');
    if (!res.ok) return;

    const data: { count: number; tasks: Array<{
      id: string;
      role: string;
      title: string;
      status: string;
      priority: string;
      createdAt: string;
      completedAt?: string | null;
      hasResult: boolean;
    }> } = await res.json();

    if (!data?.tasks?.length) return;

    // Ne garder que les tâches actives (running ou pending)
    const activeTasks = data.tasks.filter(t => t.status === 'running' || t.status === 'pending');
    if (activeTasks.length === 0) return;

    let changed = false;

    for (const serverTask of activeTasks) {
      const existing = agentTasks.find(t => t.id === serverTask.id);
      const agentName = ROLE_TO_AGENT_NAME[serverTask.role] ?? serverTask.role;
      const status = mapStatus(serverTask.status);

      if (existing) {
        // Mettre à jour le statut si différent
        if (existing.status !== status) {
          agentTasks = agentTasks.map(t => t.id === serverTask.id ? { ...t, status } : t);
          changed = true;
        }
      } else {
        // Nouvelle tâche inconnue du store — l'ajouter
        agentTasks = [...agentTasks, {
          id: serverTask.id,
          role: serverTask.role,
          title: serverTask.title,
          status,
          agentName,
          detail: `Repris après reconnexion`,
          timestamp: new Date(serverTask.createdAt).getTime(),
          steps: [],
        }];
        changed = true;
      }
    }

    if (changed) notify();
  } catch {
    // Silencieux — la sync est best-effort, elle ne doit jamais casser l'UI
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function initActivityStore() {
  if (initialized) {
    console.log('[agentActivityStore] ⚠️ Déjà initialisé, ignoré');
    return;
  }
  initialized = true;
  
  console.log('[agentActivityStore] 🚀 Initialisation...');
  
  // Initialiser le mapping outil → agent
  initializeToolAgentMapping();
  
  window.addEventListener('Leanna-tool-start', handleToolStart);
  window.addEventListener('Leanna-tool-done', handleToolDone);
  window.addEventListener('Leanna-agent-event', handleAgentEvent);
  // Cleanup every 3s
  cleanupInterval = setInterval(cleanup, 3000);
  
  console.log('[agentActivityStore] ✅ Initialisé avec succès');
}

/**
 * Nettoie toutes les ressources du store (event listeners, interval)
 * Doit être appelé lors de la fermeture de l'application ou du reload
 * pour éviter les fuites mémoire.
 */
export function destroyActivityStore() {
  if (!initialized) {
    console.log('[agentActivityStore] ⚠️ Pas initialisé, rien à détruire');
    return;
  }
  
  console.log('[agentActivityStore] 🧹 Nettoyage...');
  
  // Nettoyer les event listeners
  window.removeEventListener('Leanna-tool-start', handleToolStart);
  window.removeEventListener('Leanna-tool-done', handleToolDone);
  window.removeEventListener('Leanna-agent-event', handleAgentEvent);
  
  // Nettoyer l'interval de cleanup
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  
  // Réinitialiser l'état
  toolActivities = [];
  agentTasks = [];
  listeners = [];
  initialized = false;
  
  console.log('[agentActivityStore] ✅ Nettoyé avec succès');
}

export function getToolActivities(): ToolActivityEntry[] {
  return toolActivities;
}

export function getAgentTasks(): AgentTaskEntry[] {
  return agentTasks;
}

export function clearCompletedTools() {
  toolActivities = toolActivities.filter(a => a.status === 'running');
  notify();
}

export function clearCompletedTasks() {
  agentTasks = agentTasks.filter(t => t.status === 'running' || t.status === 'pending');
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}
