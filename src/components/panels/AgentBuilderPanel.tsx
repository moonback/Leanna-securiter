import React, { useState, useCallback, useSyncExternalStore, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Plus, Save, Trash2, Copy, Download, Upload,
  Bot, Sparkles, Wand2, ChevronRight, ChevronDown,
  Palette, Brain, Wrench, Zap, Settings2, Eye,
  Play, RotateCcw, Pencil, Check, AlertTriangle,
} from 'lucide-react';
import { Tooltip } from '../ui/Tooltip.js';
import {
  getCustomAgents, createCustomAgent, updateCustomAgent,
  deleteCustomAgent, duplicateCustomAgent, exportCustomAgents,
  importCustomAgents, subscribe, initCustomAgentStore,
  type CustomAgentConfig, type CustomAgentDraft,
} from '../../stores/customAgentStore.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const AVAILABLE_TOOLS = [
  { id: 'read_project_file', label: 'Lire fichier', category: 'lecture' },
  { id: 'write_project_file', label: 'Écrire fichier', category: 'ecriture' },
  { id: 'apply_patch', label: 'Appliquer un patch', category: 'ecriture' },
  { id: 'search_in_files', label: 'Chercher dans fichiers', category: 'lecture' },
  { id: 'list_project_files', label: 'Lister fichiers', category: 'lecture' },
  { id: 'read_file_outline', label: 'Plan du fichier', category: 'lecture' },
  { id: 'system_execute_command', label: 'Exécuter commande', category: 'systeme' },
  { id: 'automation_navigate', label: 'Naviguer web', category: 'web' },
  { id: 'automation_extract', label: 'Extraire web', category: 'web' },
  { id: 'save_memory', label: 'Sauver mémoire', category: 'memoire' },
  { id: 'search_memory', label: 'Chercher mémoire', category: 'memoire' },
  { id: 'reasoning_think', label: 'Réfléchir', category: 'reflexion' },
  { id: 'agent_delegate', label: 'Déléguer tâche', category: 'agents' },
];

const CAPABILITY_PRESETS = [
  { id: 'redaction', label: 'Rédaction complète', tools: ['read_project_file', 'write_project_file', 'apply_patch', 'search_in_files', 'list_project_files'] },
  { id: 'lecture-seule', label: 'Lecture seule (recherche/analyse)', tools: ['read_project_file', 'search_in_files', 'list_project_files', 'read_file_outline'] },
  { id: 'web-research', label: 'Recherche web', tools: ['automation_navigate', 'automation_extract', 'search_memory'] },
  { id: 'planification', label: 'Planification', tools: ['read_project_file', 'list_project_files', 'read_file_outline', 'reasoning_think'] },
  { id: 'redacteur-complet', label: 'Rédacteur complet', tools: ['read_project_file', 'write_project_file', 'apply_patch', 'search_in_files', 'list_project_files', 'read_file_outline', 'reasoning_think', 'agent_delegate'] },
];

const AVATAR_OPTIONS = ['🤖', '🧠', '⚡', '🔧', '🎯', '🛡️', '📝', '🔍', '🚀', '💡', '🎨', '🏗️', '📊', '🔬', '🌐', '🗂️'];

const COLOR_OPTIONS = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6',
  '#10b981', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6',
];

const MODEL_OPTIONS = [
  { id: 'default', label: 'Par défaut (profil)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna (OpenRouter)' },
];

const EMPTY_DRAFT: CustomAgentDraft = {
  name: '',
  role: '',
  description: '',
  avatar: '🤖',
  color: '#6366f1',
  systemPrompt: '',
  capabilities: [],
  tools: [],
  temperature: 0.7,
  maxTokens: 8192,
  maxConcurrency: 2,
  defaultTimeoutMs: 60000,
  triggerKeywords: [],
  autoDelegate: false,
  model: 'default',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

interface AgentBuilderPanelProps {
  inline?: boolean;
  onClose: () => void;
}

export function AgentBuilderPanel({ inline, onClose }: AgentBuilderPanelProps) {
  initCustomAgentStore();

  const agents = useSyncExternalStore(subscribe, getCustomAgents);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomAgentDraft>({ ...EMPTY_DRAFT });
  const [activeTab, setActiveTab] = useState<'identity' | 'prompt' | 'tools' | 'settings'>('identity');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // ─── AI Generation Handler ─────────────────────────────────────────────────

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim() || aiGenerating) return;
    setAiGenerating(true);
    setAiError(null);
    try {
      const res = await fetch('/api/agent-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiPrompt.trim(), model: 'default' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAiError(data.error || 'Erreur de génération');
        return;
      }
      // Load generated config into editor
      setEditingId(null);
      setDraft({
        name: data.agent.name || '',
        role: data.agent.role || '',
        description: data.agent.description || '',
        avatar: data.agent.avatar || '🤖',
        color: data.agent.color || 'var(--accent-secondary)',
        systemPrompt: data.agent.systemPrompt || '',
        capabilities: data.agent.capabilities || [],
        tools: data.agent.tools || [],
        temperature: data.agent.temperature ?? 0.7,
        maxTokens: data.agent.maxTokens ?? 8192,
        maxConcurrency: data.agent.maxConcurrency ?? 2,
        defaultTimeoutMs: data.agent.defaultTimeoutMs ?? 60000,
        triggerKeywords: data.agent.triggerKeywords || [],
        autoDelegate: data.agent.autoDelegate ?? false,
        model: data.agent.model || 'default',
      });
      setActiveTab('identity');
      setView('editor');
      setAiPrompt('');
    } catch (err: any) {
      setAiError(err.message || 'Erreur réseau');
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, aiGenerating]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const openNewAgent = useCallback(() => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT });
    setActiveTab('identity');
    setView('editor');
  }, []);

  const openEditAgent = useCallback((agent: CustomAgentConfig) => {
    setEditingId(agent.id);
    const { id: _, createdAt: __, updatedAt: ___, ...rest } = agent;
    setDraft(rest);
    setActiveTab('identity');
    setView('editor');
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft.name.trim() || !draft.role.trim()) return;
    if (editingId) {
      await updateCustomAgent(editingId, draft);
    } else {
      await createCustomAgent(draft);
    }
    setView('list');
    setEditingId(null);
  }, [draft, editingId]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteCustomAgent(id);
    setDeleteConfirm(null);
    if (editingId === id) {
      setView('list');
      setEditingId(null);
    }
  }, [editingId]);

  const handleDuplicate = useCallback(async (id: string) => {
    await duplicateCustomAgent(id);
  }, []);

  const handleExport = useCallback(() => {
    const json = exportCustomAgents();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Leanna-custom-agents.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const count = await importCustomAgents(reader.result as string);
        if (count > 0) {
          window.dispatchEvent(new CustomEvent('Leanna-toast', {
            detail: { message: `${count} agent(s) importé(s)`, type: 'success' },
          }));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const updateDraft = useCallback((key: keyof CustomAgentDraft, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--z-modal)' as any, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        className="relative flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: '900px',
          maxWidth: '95vw',
          height: '700px',
          maxHeight: '90vh',
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-base)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-sidebar)' }}>
          <div className="flex items-center gap-2.5">
            <Wand2 size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Agent Builder
            </h2>
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
              {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {view === 'list' ? (
              <AgentListView
                key="list"
                agents={agents}
                onNew={openNewAgent}
                onEdit={openEditAgent}
                onDelete={(id) => setDeleteConfirm(id)}
                onDuplicate={handleDuplicate}
                onExport={handleExport}
                onImport={handleImport}
                deleteConfirm={deleteConfirm}
                onConfirmDelete={handleDelete}
                onCancelDelete={() => setDeleteConfirm(null)}
                aiPrompt={aiPrompt}
                setAiPrompt={setAiPrompt}
                aiGenerating={aiGenerating}
                aiError={aiError}
                onAiGenerate={handleAiGenerate}
              />
            ) : (
              <AgentEditorView
                key="editor"
                draft={draft}
                editingId={editingId}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                updateDraft={updateDraft}
                onSave={handleSave}
                onCancel={() => setView('list')}
              />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Agent List View
// ═══════════════════════════════════════════════════════════════════════════════

function AgentListView({
  agents, onNew, onEdit, onDelete, onDuplicate,
  onExport, onImport, deleteConfirm, onConfirmDelete, onCancelDelete,
  aiPrompt, setAiPrompt, aiGenerating, aiError, onAiGenerate,
}: {
  agents: CustomAgentConfig[];
  onNew: () => void;
  onEdit: (a: CustomAgentConfig) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  deleteConfirm: string | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
  aiGenerating: boolean;
  aiError: string | null;
  onAiGenerate: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: 'var(--border-base)' }}>
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all hover:scale-105"
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: 'white',
            boxShadow: '0 2px 8px color-mix(in srgb, var(--accent-primary) 30%, transparent)',
          }}
        >
          <Plus size={13} /> Nouvel Agent
        </button>
        <div className="flex-1" />
        <button onClick={onImport}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/8"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}>
          <Upload size={11} /> Importer
        </button>
        {agents.length > 0 && (
          <button onClick={onExport}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/8"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}>
            <Download size={11} /> Exporter
          </button>
        )}
      </div>

      {/* AI Generation Section */}
      <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(99,102,241,0.03)' }}>
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles size={12} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
            Génération IA
          </span>
        </div>
        <div className="flex gap-2">
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onAiGenerate(); } }}
            placeholder="Décris l'agent que tu veux... ex: Un agent qui review mon code TypeScript et détecte les bugs"
            disabled={aiGenerating}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-all focus:ring-2 disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={onAiGenerate}
            disabled={aiGenerating || !aiPrompt.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary), var(--color-accent-alt))',
              color: 'white',
              boxShadow: '0 2px 12px color-mix(in srgb, var(--accent-primary) 30%, transparent)',
            }}
          >
            {aiGenerating ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Génération...
              </>
            ) : (
              <>
                <Sparkles size={12} /> Générer
              </>
            )}
          </button>
        </div>
        {aiError && (
          <div className="mt-2 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--color-error-subtle)', color: 'var(--color-error)' }}>
            <AlertTriangle size={11} /> {aiError}
          </div>
        )}
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-4">
        {agents.length === 0 ? (
          <EmptyState onNew={onNew} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={() => onEdit(agent)}
                onDelete={() => onDelete(agent.id)}
                onDuplicate={() => onDuplicate(agent.id)}
                isDeleting={deleteConfirm === agent.id}
                onConfirmDelete={() => onConfirmDelete(agent.id)}
                onCancelDelete={onCancelDelete}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-12">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: 'var(--accent-subtle)' }}>
        <Bot size={32} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <div className="text-center">
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Aucun agent personnalisé
        </h3>
        <p className="text-sm max-w-[280px]" style={{ color: 'var(--text-muted)' }}>
          Crée ton premier agent avec des instructions, outils et comportements sur-mesure.
        </p>
      </div>
      <button
        onClick={onNew}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105"
        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
      >
        <Sparkles size={13} /> Créer un agent
      </button>
    </div>
  );
}

function AgentCard({
  agent, onEdit, onDelete, onDuplicate,
  isDeleting, onConfirmDelete, onCancelDelete,
}: {
  agent: CustomAgentConfig;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <motion.div
      layout
      className="group relative rounded-xl p-3.5 cursor-pointer transition-all hover:scale-[1.02]"
      style={{
        backgroundColor: 'var(--bg-input)',
        border: '1px solid var(--border-base)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
      onClick={onEdit}
      whileHover={{ boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}
    >
      {/* Delete confirmation overlay */}
      <AnimatePresence>
        {isDeleting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 rounded-xl flex items-center justify-center gap-2"
            style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(2px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <AlertTriangle size={14} style={{ color: 'var(--color-error)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-error)' }}>Supprimer ?</span>
            <button onClick={onConfirmDelete}
              className="px-2 py-1 rounded text-xs font-semibold bg-[var(--color-error-subtle)] text-[var(--color-error)] hover:bg-[color-mix(in srgb, var(--color-error) 30%, transparent)]">
              Oui
            </button>
            <button onClick={onCancelDelete}
              className="px-2 py-1 rounded text-xs font-semibold bg-white/10 hover:bg-white/20"
              style={{ color: 'var(--text-muted)' }}>
              Non
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: `${agent.color}20`, border: `1px solid ${agent.color}40` }}>
          {agent.avatar}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {agent.name}
            </h4>
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium uppercase"
              style={{ backgroundColor: `${agent.color}20`, color: agent.color }}>
              {agent.role}
            </span>
          </div>
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
            {agent.description || 'Aucune description'}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs px-1.5 py-0.5 rounded bg-white/5"
              style={{ color: 'var(--text-muted)' }}>
              {agent.tools.length} outil{agent.tools.length !== 1 ? 's' : ''}
            </span>
            {agent.autoDelegate && (
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--color-success-subtle)', color: 'var(--color-success)' }}>
                Auto-délégation
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}>
          <Tooltip content="Dupliquer" as="button" onClick={onDuplicate} className="p-1 rounded hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}>
            <Copy size={12} />
          </Tooltip>
          <Tooltip content="Supprimer" as="button" onClick={onDelete} className="p-1 rounded hover:bg-[var(--color-error-subtle)]"
            style={{ color: 'var(--color-error)' }}>
            <Trash2 size={12} />
          </Tooltip>
        </div>
      </div>
    </motion.div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Agent Editor View
// ═══════════════════════════════════════════════════════════════════════════════

function AgentEditorView({
  draft, editingId, activeTab, setActiveTab, updateDraft, onSave, onCancel,
}: {
  draft: CustomAgentDraft;
  editingId: string | null;
  activeTab: 'identity' | 'prompt' | 'tools' | 'settings';
  setActiveTab: (t: 'identity' | 'prompt' | 'tools' | 'settings') => void;
  updateDraft: (key: keyof CustomAgentDraft, value: any) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isValid = draft.name.trim().length > 0 && draft.role.trim().length > 0;

  const tabs = [
    { id: 'identity' as const, icon: Palette, label: 'Identité' },
    { id: 'prompt' as const, icon: Brain, label: 'Prompt Système' },
    { id: 'tools' as const, icon: Wrench, label: 'Outils & Capacités' },
    { id: 'settings' as const, icon: Settings2, label: 'Paramètres' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex flex-col h-full"
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 px-5 py-2 border-b overflow-x-auto"
        style={{ borderColor: 'var(--border-base)' }}>
        <button onClick={onCancel}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium mr-2 transition-colors hover:bg-white/8"
          style={{ color: 'var(--text-muted)' }}>
          <RotateCcw size={11} /> Retour
        </button>
        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-base)' }} />
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-muted)',
              backgroundColor: activeTab === tab.id ? 'var(--accent-subtle)' : 'transparent',
            }}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onSave}
          disabled={!isValid}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
          style={{
            backgroundColor: isValid ? 'var(--accent-primary)' : 'var(--bg-input)',
            color: isValid ? 'white' : 'var(--text-muted)',
          }}
        >
          <Save size={12} />
          {editingId ? 'Sauvegarder' : 'Créer'}
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <AnimatePresence mode="wait">
          {activeTab === 'identity' && (
            <TabIdentity key="identity" draft={draft} updateDraft={updateDraft} />
          )}
          {activeTab === 'prompt' && (
            <TabPrompt key="prompt" draft={draft} updateDraft={updateDraft} />
          )}
          {activeTab === 'tools' && (
            <TabTools key="tools" draft={draft} updateDraft={updateDraft} />
          )}
          {activeTab === 'settings' && (
            <TabSettings key="settings" draft={draft} updateDraft={updateDraft} />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Identity
// ═══════════════════════════════════════════════════════════════════════════════

function TabIdentity({ draft, updateDraft }: { draft: CustomAgentDraft; updateDraft: (k: keyof CustomAgentDraft, v: any) => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
      {/* Name & Role */}
      <div className="grid grid-cols-2 gap-4">
        <FieldGroup label="Nom de l'agent" required>
          <input
            value={draft.name}
            onChange={(e) => updateDraft('name', e.target.value)}
            placeholder="Ex: CodeReviewer, DocWriter..."
            className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
            }}
          />
        </FieldGroup>
        <FieldGroup label="Rôle" required>
          <input
            value={draft.role}
            onChange={(e) => updateDraft('role', e.target.value)}
            placeholder="Ex: reviewer, optimizer, designer..."
            className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
            }}
          />
        </FieldGroup>
      </div>

      {/* Description */}
      <FieldGroup label="Description">
        <textarea
          value={draft.description}
          onChange={(e) => updateDraft('description', e.target.value)}
          placeholder="Décris ce que fait cet agent..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none transition-all focus:ring-2"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-primary)',
          }}
        />
      </FieldGroup>

      {/* Avatar */}
      <FieldGroup label="Avatar">
        <div className="flex flex-wrap gap-2">
          {AVATAR_OPTIONS.map(emoji => (
            <button
              key={emoji}
              onClick={() => updateDraft('avatar', emoji)}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
              style={{
                backgroundColor: draft.avatar === emoji ? `${draft.color}20` : 'var(--bg-input)',
                border: draft.avatar === emoji ? `2px solid ${draft.color}` : '1px solid var(--border-base)',
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* Color */}
      <FieldGroup label="Couleur">
        <div className="flex flex-wrap gap-2">
          {COLOR_OPTIONS.map(color => (
            <button
              key={color}
              onClick={() => updateDraft('color', color)}
              className="w-7 h-7 rounded-full transition-all hover:scale-110"
              style={{
                backgroundColor: color,
                border: draft.color === color ? '3px solid white' : '2px solid transparent',
                boxShadow: draft.color === color ? `0 0 12px ${color}60` : 'none',
              }}
            />
          ))}
        </div>
      </FieldGroup>

      {/* Preview */}
      <FieldGroup label="Aperçu">
        <div className="flex items-center gap-3 p-3 rounded-xl"
          style={{ backgroundColor: 'var(--bg-sidebar)', border: '1px solid var(--border-base)' }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl"
            style={{ backgroundColor: `${draft.color}20`, border: `1px solid ${draft.color}40` }}>
            {draft.avatar}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {draft.name || 'Nom de l\'agent'}
              </span>
              {draft.role && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium uppercase"
                  style={{ backgroundColor: `${draft.color}20`, color: draft.color }}>
                  {draft.role}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {draft.description || 'Description de l\'agent...'}
            </p>
          </div>
        </div>
      </FieldGroup>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: System Prompt
// ═══════════════════════════════════════════════════════════════════════════════

function TabPrompt({ draft, updateDraft }: { draft: CustomAgentDraft; updateDraft: (k: keyof CustomAgentDraft, v: any) => void }) {
  const [showTemplates, setShowTemplates] = useState(false);

  const templates = [
    {
      id: 'reviewer',
      label: '🔍 Code Reviewer',
      prompt: `Tu es un expert en revue de code. Tu analyses le code pour trouver :
- Bugs potentiels et edge cases
- Violations des bonnes pratiques
- Problèmes de performance
- Failles de sécurité
- Améliorations de lisibilité

Sois constructif et propose des corrections concrètes.`,
    },
    {
      id: 'optimizer',
      label: '⚡ Optimiseur',
      prompt: `Tu es un spécialiste de l'optimisation de code. Tu cherches à :
- Réduire la complexité algorithmique
- Minimiser les allocations mémoire
- Optimiser les requêtes et I/O
- Identifier les goulots d'étranglement
- Proposer des structures de données plus efficaces

Mesure toujours l'impact avant/après.`,
    },
    {
      id: 'doc-writer',
      label: '📝 Documentaliste',
      prompt: `Tu es un rédacteur technique expert. Tu produis :
- Documentation API claire et complète
- Guides d'utilisation accessibles
- Commentaires de code pertinents
- README structurés
- Diagrammes d'architecture (en Mermaid)

Adapte le niveau technique au public cible.`,
    },
    {
      id: 'tester',
      label: '🧪 Testeur',
      prompt: `Tu es un expert en tests logiciels. Tu crées :
- Tests unitaires exhaustifs
- Tests d'intégration robustes
- Tests de performance (benchmarks)
- Tests de sécurité
- Scenarios edge-case

Vise une couverture > 90% et des tests maintenables.`,
    },
    {
      id: 'architect',
      label: '🏗️ Architecte',
      prompt: `Tu es un architecte logiciel senior. Tu évalues :
- La séparation des responsabilités
- Les patterns de conception appropriés
- La scalabilité et la maintenabilité
- Les dépendances et le couplage
- La cohérence de l'architecture globale

Propose des améliorations structurelles justifiées.`,
    },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
      {/* Templates */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Prompt Système
        </label>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors hover:bg-white/8"
          style={{ color: 'var(--accent-primary)' }}
        >
          <Sparkles size={11} /> Modèles
          {showTemplates ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
      </div>

      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 pb-3">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    updateDraft('systemPrompt', t.prompt);
                    setShowTemplates(false);
                  }}
                  className="p-2.5 rounded-lg text-left text-xs transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-base)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span className="font-semibold">{t.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor */}
      <textarea
        value={draft.systemPrompt}
        onChange={(e) => updateDraft('systemPrompt', e.target.value)}
        placeholder="Instructions personnalisées pour l'agent...&#10;&#10;Décris son comportement, ses contraintes, son style de réponse..."
        rows={18}
        className="w-full px-4 py-3 rounded-xl text-sm leading-relaxed outline-none resize-none font-mono transition-all focus:ring-2"
        style={{
          backgroundColor: 'var(--bg-input)',
          border: '1px solid var(--border-base)',
          color: 'var(--text-primary)',
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {draft.systemPrompt.length} caractères
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Markdown supporté
        </span>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Tools & Capabilities
// ═══════════════════════════════════════════════════════════════════════════════

function TabTools({ draft, updateDraft }: { draft: CustomAgentDraft; updateDraft: (k: keyof CustomAgentDraft, v: any) => void }) {
  const categories = useMemo(() => {
    const cats: Record<string, typeof AVAILABLE_TOOLS> = {};
    for (const tool of AVAILABLE_TOOLS) {
      if (!cats[tool.category]) cats[tool.category] = [];
      cats[tool.category].push(tool);
    }
    return cats;
  }, []);

  const toggleTool = useCallback((toolId: string) => {
    const current = draft.tools;
    if (current.includes(toolId)) {
      updateDraft('tools', current.filter(t => t !== toolId));
    } else {
      updateDraft('tools', [...current, toolId]);
    }
  }, [draft.tools, updateDraft]);

  const applyPreset = useCallback((preset: typeof CAPABILITY_PRESETS[number]) => {
    const merged = new Set([...draft.tools, ...preset.tools]);
    updateDraft('tools', Array.from(merged));
  }, [draft.tools, updateDraft]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
      {/* Quick Presets */}
      <FieldGroup label="Presets rapides">
        <div className="flex flex-wrap gap-2">
          {CAPABILITY_PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-base)',
                color: 'var(--text-primary)',
              }}
            >
              <Zap size={10} className="inline mr-1" style={{ color: 'var(--accent-primary)' }} />
              {preset.label}
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* Tools by Category */}
      {Object.entries(categories).map(([cat, tools]) => (
        <FieldGroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
          <div className="grid grid-cols-2 gap-1.5">
            {tools.map(tool => {
              const selected = draft.tools.includes(tool.id);
              return (
                <button
                  key={tool.id}
                  onClick={() => toggleTool(tool.id)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all text-left"
                  style={{
                    backgroundColor: selected ? `${draft.color}15` : 'var(--bg-input)',
                    border: selected ? `1px solid ${draft.color}50` : '1px solid var(--border-base)',
                    color: selected ? draft.color : 'var(--text-muted)',
                  }}
                >
                  <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: selected ? draft.color : 'transparent',
                      border: selected ? 'none' : '1px solid var(--border-base)',
                    }}>
                    {selected && <Check size={10} color="white" />}
                  </div>
                  {tool.label}
                </button>
              );
            })}
          </div>
        </FieldGroup>
      ))}

      {/* Custom Capabilities */}
      <FieldGroup label="Capacités personnalisées (une par ligne)">
        <textarea
          value={draft.capabilities.join('\n')}
          onChange={(e) => updateDraft('capabilities', e.target.value.split('\n').filter(Boolean))}
          placeholder="Ex: Analyse de performance&#10;Génération de diagrammes&#10;Refactoring TypeScript"
          rows={4}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none font-mono transition-all focus:ring-2"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-primary)',
          }}
        />
      </FieldGroup>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Settings
// ═══════════════════════════════════════════════════════════════════════════════

function TabSettings({ draft, updateDraft }: { draft: CustomAgentDraft; updateDraft: (k: keyof CustomAgentDraft, v: any) => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
      {/* Model */}
      <FieldGroup label="Modèle IA">
        <select
          value={draft.model}
          onChange={(e) => updateDraft('model', e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-primary)',
          }}
        >
          {MODEL_OPTIONS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </FieldGroup>

      {/* Temperature */}
      <FieldGroup label={`Température: ${draft.temperature.toFixed(2)}`}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={draft.temperature}
          onChange={(e) => updateDraft('temperature', parseFloat(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          <span>Précis (0)</span>
          <span>Équilibré (0.7)</span>
          <span>Créatif (2)</span>
        </div>
      </FieldGroup>

      {/* Max Tokens */}
      <FieldGroup label="Tokens max">
        <input
          type="number"
          value={draft.maxTokens}
          onChange={(e) => updateDraft('maxTokens', parseInt(e.target.value) || 4096)}
          min={1024}
          max={128000}
          step={1024}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-primary)',
          }}
        />
      </FieldGroup>

      {/* Concurrency */}
      <FieldGroup label={`Tâches simultanées: ${draft.maxConcurrency}`}>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={draft.maxConcurrency}
          onChange={(e) => updateDraft('maxConcurrency', parseInt(e.target.value))}
          className="w-full accent-blue-500"
        />
      </FieldGroup>

      {/* Timeout */}
      <FieldGroup label={`Timeout: ${(draft.defaultTimeoutMs / 1000).toFixed(0)}s`}>
        <input
          type="range"
          min="10000"
          max="300000"
          step="5000"
          value={draft.defaultTimeoutMs}
          onChange={(e) => updateDraft('defaultTimeoutMs', parseInt(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          <span>10s</span>
          <span>5min</span>
        </div>
      </FieldGroup>

      {/* Trigger Keywords */}
      <FieldGroup label="Mots-clés de déclenchement (séparés par virgule)">
        <input
          value={draft.triggerKeywords.join(', ')}
          onChange={(e) => updateDraft('triggerKeywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder="Ex: review, optimize, refactor..."
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-primary)',
          }}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          L'agent sera automatiquement sélectionné quand ces mots apparaissent dans une demande
        </p>
      </FieldGroup>

      {/* Auto Delegate */}
      <FieldGroup label="Délégation automatique">
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            className="w-9 h-5 rounded-full relative transition-colors cursor-pointer"
            style={{ backgroundColor: draft.autoDelegate ? 'var(--accent-primary)' : 'var(--bg-input)' }}
            onClick={() => updateDraft('autoDelegate', !draft.autoDelegate)}
          >
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ left: draft.autoDelegate ? '18px' : '2px' }} />
          </div>
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Permettre à cet agent de déléguer à d'autres agents
          </span>
        </label>
      </FieldGroup>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════════════

function FieldGroup({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1"
        style={{ color: 'var(--text-muted)' }}>
        {label}
        {required && <span style={{ color: 'var(--color-error)' }}>*</span>}
      </label>
      {children}
    </div>
  );
}
