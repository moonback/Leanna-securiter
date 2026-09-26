/**
 * Store pour les agents personnalisés créés via l'Agent Builder.
 * Persiste côté serveur dans .Leanna/custom-agents.json via l'API REST.
 * Expose un pattern subscribe pour useSyncExternalStore.
 */

export interface CustomAgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  color: string;
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  temperature: number;
  maxTokens: number;
  maxConcurrency: number;
  defaultTimeoutMs: number;
  triggerKeywords: string[];
  autoDelegate: boolean;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export type CustomAgentDraft = Omit<CustomAgentConfig, 'id' | 'createdAt' | 'updatedAt'>;

type Listener = () => void;

let agents: CustomAgentConfig[] = [];
let listeners: Listener[] = [];
let initialized = false;
let loading = false;

function notify() {
  for (const fn of listeners) fn();
}

// ─── API Calls ───────────────────────────────────────────────────────────────

async function fetchAgents(): Promise<CustomAgentConfig[]> {
  try {
    const res = await fetch('/api/custom-agents');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.agents) ? data.agents : [];
  } catch { return []; }
}

async function apiCreate(draft: CustomAgentDraft): Promise<CustomAgentConfig | null> {
  try {
    const res = await fetch('/api/custom-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.agent || null;
  } catch { return null; }
}

async function apiUpdate(id: string, updates: Partial<CustomAgentDraft>): Promise<CustomAgentConfig | null> {
  try {
    const res = await fetch(`/api/custom-agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.agent || null;
  } catch { return null; }
}

async function apiDelete(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/custom-agents/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

async function apiImport(agentsList: any[]): Promise<number> {
  try {
    const res = await fetch('/api/custom-agents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: agentsList }),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count || 0;
  } catch { return 0; }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function initCustomAgentStore() {
  if (initialized || loading) return;
  loading = true;
  agents = await fetchAgents();
  initialized = true;
  loading = false;
  notify();
}

export function getCustomAgents(): CustomAgentConfig[] {
  if (!initialized && !loading) {
    // Trigger async load (won't block)
    initCustomAgentStore();
  }
  return agents;
}

export function getCustomAgent(id: string): CustomAgentConfig | undefined {
  return agents.find(a => a.id === id);
}

export async function createCustomAgent(draft: CustomAgentDraft): Promise<CustomAgentConfig | null> {
  const agent = await apiCreate(draft);
  if (agent) {
    agents = [...agents, agent];
    notify();
  }
  return agent;
}

export async function updateCustomAgent(id: string, updates: Partial<CustomAgentDraft>): Promise<CustomAgentConfig | null> {
  const updated = await apiUpdate(id, updates);
  if (updated) {
    agents = agents.map(a => a.id === id ? updated : a);
    notify();
  }
  return updated;
}

export async function deleteCustomAgent(id: string): Promise<boolean> {
  const success = await apiDelete(id);
  if (success) {
    agents = agents.filter(a => a.id !== id);
    notify();
  }
  return success;
}

export async function duplicateCustomAgent(id: string): Promise<CustomAgentConfig | null> {
  const source = agents.find(a => a.id === id);
  if (!source) return null;
  const { id: _, createdAt: __, updatedAt: ___, ...draft } = source;
  return createCustomAgent({ ...draft, name: `${draft.name} (copie)` });
}

export function exportCustomAgents(): string {
  return JSON.stringify(agents, null, 2);
}

export async function importCustomAgents(json: string): Promise<number> {
  try {
    const imported = JSON.parse(json);
    const list = Array.isArray(imported) ? imported : [];
    const count = await apiImport(list);
    if (count > 0) {
      // Reload from server to get proper IDs
      agents = await fetchAgents();
      notify();
    }
    return count;
  } catch { return 0; }
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}
