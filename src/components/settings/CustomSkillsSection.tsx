import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Plus, Trash2, Edit3, Power, Save,
  X, ChevronDown, ChevronUp, Zap, Globe, Database as DbIcon,
  Briefcase, Code2, AlertCircle, ClipboardPaste, FileCode, Star
} from 'lucide-react';
import { Section, TextInput } from './SettingsPrimitives.js';
import { useToast } from '../ui/Toast.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkillParam {
  name: string;
  type: "STRING" | "NUMBER" | "BOOLEAN" | "ARRAY";
  description: string;
  required: boolean;
}

interface CustomSkill {
  id: string;
  name: string;
  description: string;
  parameters: SkillParam[];
  instruction: string;
  category: string;
  enabled: boolean;
  icon: string;
  created_at: string;
  updated_at: string;
}

type FormMode = 'idle' | 'create' | 'edit';

const CATEGORIES = [
  { id: 'custom', label: 'Custom', icon: Sparkles },
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'web', label: 'Web', icon: Globe },
  { id: 'data', label: 'Data', icon: DbIcon },
  { id: 'productivity', label: 'Productivité', icon: Briefcase },
];

const PARAM_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'ARRAY'] as const;

// ─── Import parser — détecte et parse différents formats de skills ─────────────

interface ParsedSkill {
  name: string;
  description: string;
  parameters: SkillParam[];
  instruction: string;
  category: string;
}

function parseImportedSkill(raw: string): ParsedSkill | null {
  const trimmed = raw.trim();

  // 1. JSON pur
  try {
    const json = JSON.parse(trimmed);
    return parseFromJson(json);
  } catch { /* pas du JSON */ }

  // 2. Extraire un objet JSON dans du code
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const cleaned = jsonMatch[0]
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,(\s*[}\]])/g, '$1');
      const json = JSON.parse(cleaned);
      return parseFromJson(json);
    } catch { /* pas parsable */ }
  }

  // 3. TypeScript
  return parseFromTypeScript(trimmed);
}

function parseFromJson(json: any): ParsedSkill | null {
  if (json.name && json.instruction) {
    return {
      name: toSnakeCase(json.name),
      description: json.description || '',
      parameters: normalizeParams(json.parameters),
      instruction: json.instruction,
      category: json.category || 'custom',
    };
  }
  if (json.name && json.parameters?.properties) {
    const params = extractParamsFromProperties(json.parameters.properties, json.parameters.required);
    return {
      name: toSnakeCase(json.name),
      description: json.description || '',
      parameters: params,
      instruction: json.instruction || json.description || '',
      category: json.category || 'custom',
    };
  }
  if (json.declarations && Array.isArray(json.declarations) && json.declarations.length > 0) {
    const decl = json.declarations[0];
    const params = decl.parameters?.properties
      ? extractParamsFromProperties(decl.parameters.properties, decl.parameters.required)
      : [];
    return {
      name: toSnakeCase(json.name || decl.name || ''),
      description: decl.description || '',
      parameters: params,
      instruction: json.instruction || decl.description || '',
      category: json.category || 'custom',
    };
  }
  if (json.tool_name || json.input_schema) {
    const schema = json.input_schema || json.schema || {};
    const params = schema.properties
      ? extractParamsFromProperties(schema.properties, schema.required)
      : [];
    return {
      name: toSnakeCase(json.tool_name || json.name || ''),
      description: json.description || '',
      parameters: params,
      instruction: json.instruction || json.description || '',
      category: json.category || 'custom',
    };
  }
  return null;
}

function parseFromTypeScript(code: string): ParsedSkill | null {
  // D'abord, vérifier si c'est du Markdown (instructions/prompt brut)
  if (code.startsWith('#') || code.match(/^---\s*$/m)) {
    return parseFromMarkdown(code);
  }

  const nameMatch = code.match(/name:\s*["']([^"']+)["']/);
  const descMatch = code.match(/description:\s*["']([^"']+)["']/);
  const params: SkillParam[] = [];
  const propsMatch = code.match(/properties:\s*\{([\s\S]*?)\}\s*,?\s*required/);
  if (propsMatch) {
    const propRegex = /(\w+):\s*\{\s*type:\s*["'](\w+)["']\s*,?\s*description:\s*["']([^"']+)["']\s*\}/g;
    let match;
    while ((match = propRegex.exec(propsMatch[1])) !== null) {
      params.push({ name: match[1], type: match[2].toUpperCase() as SkillParam['type'], description: match[3], required: false });
    }
  }
  const reqMatch = code.match(/required:\s*\[([\s\S]*?)\]/);
  if (reqMatch) {
    const reqNames = reqMatch[1].match(/["'](\w+)["']/g)?.map(s => s.replace(/["']/g, '')) || [];
    params.forEach(p => { if (reqNames.includes(p.name)) p.required = true; });
  }
  if (!nameMatch && !descMatch && params.length === 0) return null;
  return {
    name: toSnakeCase(nameMatch?.[1] || ''),
    description: descMatch?.[1] || '',
    parameters: params,
    instruction: descMatch?.[1] || '',
    category: 'custom',
  };
}

function parseFromMarkdown(md: string): ParsedSkill {
  // Extraire le titre (premier # heading)
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/[^a-zA-Z0-9\s_-]/g, '').trim() || 'imported_skill';

  // Extraire la première ligne de description (après le titre, "Best for:" ou premier paragraphe)
  const descMatch = md.match(/^#[^#].*\n+(?:---\s*\n+)?(.+)/m);
  const description = descMatch?.[1]?.replace(/^#+\s*/, '').trim() || title;

  return {
    name: toSnakeCase(title),
    description: description.slice(0, 120),
    parameters: [{ name: 'input', type: 'STRING', description: 'Texte ou requete a traiter', required: true }],
    instruction: md.trim(),
    category: 'custom',
  };
}

function extractParamsFromProperties(properties: Record<string, any>, required?: string[]): SkillParam[] {
  const reqSet = new Set(required ?? []);
  return Object.entries(properties).map(([name, prop]: [string, any]) => ({
    name, type: normalizeType(prop.type), description: prop.description || '', required: reqSet.has(name),
  }));
}

function normalizeType(t: string | undefined): SkillParam['type'] {
  if (!t) return 'STRING';
  const upper = t.toUpperCase();
  if (['STRING', 'NUMBER', 'BOOLEAN', 'ARRAY'].includes(upper)) return upper as SkillParam['type'];
  if (upper === 'INTEGER' || upper === 'FLOAT') return 'NUMBER';
  if (upper === 'BOOL') return 'BOOLEAN';
  return 'STRING';
}

function normalizeParams(params: any): SkillParam[] {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map(p => ({ name: p.name || '', type: normalizeType(p.type), description: p.description || '', required: !!p.required }));
  }
  if (params.properties) return extractParamsFromProperties(params.properties, params.required);
  return [];
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').replace(/[-\s]+/g, '_').replace(/^_/, '').replace(/_+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// ─── API helpers (via WebSocket ou fetch) ──────────────────────────────────────

async function apiCall(action: string, payload: any = {}): Promise<any> {
  const res = await fetch('/api/custom-skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Lit le profil pour connaître le skill automatique sélectionné. */
async function fetchAutoSkill(): Promise<string | null> {
  const res = await fetch('/api/profile');
  if (!res.ok) return null;
  const profile = await res.json().catch(() => ({}));
  return (profile?.autoSkill as string | undefined)?.trim() || null;
}

/** Persiste le skill automatique (ou le retire avec null) dans le profil. */
async function saveAutoSkill(skillName: string | null): Promise<void> {
  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoSkill: skillName ?? '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function CustomSkillsSection() {
  const { success, error: toastError } = useToast();
  const [skills, setSkills] = useState<CustomSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoSkill, setAutoSkill] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formInstruction, setFormInstruction] = useState('');
  const [formCategory, setFormCategory] = useState('custom');
  const [formParams, setFormParams] = useState<SkillParam[]>([]);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  // ── Load skills ──────────────────────────────────────────────────────────────

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true);
      const [data, auto] = await Promise.all([apiCall('list'), fetchAutoSkill()]);
      setSkills(data.skills ?? []);
      setAutoSkill(auto);
    } catch (err: any) {
      toastError(err.message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  // ── Skill automatique (appliqué à chaque session) ─────────────────────────────

  const toggleAutoSkill = async (skill: CustomSkill) => {
    const next = autoSkill === skill.name ? null : skill.name;
    const previous = autoSkill;
    setAutoSkill(next); // optimiste
    try {
      // Un skill doit être activé pour pouvoir être utilisé automatiquement.
      if (next && !skill.enabled) {
        await apiCall('update', { id: skill.id, enabled: true });
        setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: true } : s));
      }
      await saveAutoSkill(next);
      success(next
        ? `"${skill.name}" sera utilisé automatiquement à chaque session.`
        : `"${skill.name}" ne sera plus utilisé automatiquement.`);
    } catch (err: any) {
      setAutoSkill(previous); // rollback
      toastError(err.message);
    }
  };

  // ── Reset form ───────────────────────────────────────────────────────────────

  const resetForm = () => {
    setFormMode('idle');
    setEditingId(null);
    setFormName('');
    setFormDesc('');
    setFormInstruction('');
    setFormCategory('custom');
    setFormParams([]);
    setShowImport(false);
    setImportText('');
  };

  // ── Import from paste ────────────────────────────────────────────────────────

  const handleImport = () => {
    if (!importText.trim()) {
      toastError('Colle le code ou JSON du skill à importer.');
      return;
    }
    const parsed = parseImportedSkill(importText);
    if (!parsed) {
      toastError('Format non reconnu. Colle du JSON, un objet declarations, ou du TypeScript.');
      return;
    }
    setFormMode('create');
    setFormName(parsed.name);
    setFormDesc(parsed.description);
    setFormInstruction(parsed.instruction);
    setFormCategory(parsed.category);
    setFormParams(parsed.parameters);
    setShowImport(false);
    setImportText('');
    success(`Skill "${parsed.name}" importé — vérifie et enregistre.`);
  };

  // ── Open edit mode ───────────────────────────────────────────────────────────

  const openEdit = (skill: CustomSkill) => {
    setFormMode('edit');
    setEditingId(skill.id);
    setFormName(skill.name);
    setFormDesc(skill.description);
    setFormInstruction(skill.instruction);
    setFormCategory(skill.category);
    setFormParams([...skill.parameters]);
  };

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!formName.trim() || !formInstruction.trim()) {
      toastError('Nom et instruction requis.');
      return;
    }

    // Validate name format
    if (!/^[a-z0-9_]+$/.test(formName)) {
      toastError('Nom: lettres minuscules, chiffres et underscores uniquement.');
      return;
    }

    try {
      if (formMode === 'create') {
        await apiCall('create', {
          name: formName,
          description: formDesc,
          instruction: formInstruction,
          category: formCategory,
          parameters: formParams,
        });
        success(`Skill "${formName}" créé !`);
      } else if (formMode === 'edit' && editingId) {
        await apiCall('update', {
          id: editingId,
          name: formName,
          description: formDesc,
          instruction: formInstruction,
          category: formCategory,
          parameters: formParams,
        });
        success(`Skill "${formName}" mis à jour.`);
      }
      resetForm();
      loadSkills();
    } catch (err: any) {
      toastError(err.message);
    }
  };

  // ── Toggle enabled ───────────────────────────────────────────────────────────

  const toggleEnabled = async (skill: CustomSkill) => {
    try {
      await apiCall('update', { id: skill.id, enabled: !skill.enabled });
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: !s.enabled } : s));
    } catch (err: any) {
      toastError(err.message);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async (skill: CustomSkill) => {
    try {
      await apiCall('delete', { id: skill.id });
      setSkills(prev => prev.filter(s => s.id !== skill.id));
      success(`Skill "${skill.name}" supprimé.`);
    } catch (err: any) {
      toastError(err.message);
    }
  };

  // ── Add/remove param ─────────────────────────────────────────────────────────

  const addParam = () => {
    setFormParams(prev => [...prev, { name: '', type: 'STRING', description: '', required: false }]);
  };

  const removeParam = (idx: number) => {
    setFormParams(prev => prev.filter((_, i) => i !== idx));
  };

  const updateParam = (idx: number, field: keyof SkillParam, value: any) => {
    setFormParams(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const getCategoryIcon = (cat: string) => {
    const found = CATEGORIES.find(c => c.id === cat);
    return found?.icon ?? Sparkles;
  };

  return (
    <Section
      icon={Code2}
      title="Skills personnalisés"
      description="Crée des skills custom stockés en BDD — disponibles immédiatement pour l'IA"
      badge={`${skills.filter(s => s.enabled).length} actifs`}
    >
      {/* ── Header actions ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
          {skills.length} skill{skills.length !== 1 ? 's' : ''} au total
        </p>
        {formMode === 'idle' && (
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowImport(!showImport)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: showImport ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                border: `1px solid ${showImport ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                color: showImport ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              <ClipboardPaste className="w-3 h-3" />
              Importer
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { setShowImport(false); setFormMode('create'); }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'white',
              }}
            >
              <Plus className="w-3 h-3" />
              Nouveau skill
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Import panel (coller un skill) ─────────────────────────────────── */}
      <AnimatePresence>
        {showImport && formMode === 'idle' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-lg p-4 flex flex-col gap-3 mt-2"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    Importer un skill (copier-coller)
                  </h3>
                </div>
                <button onClick={() => { setShowImport(false); setImportText(''); }} className="p-1 rounded hover:bg-black/10 transition-colors">
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Colle ici le code d'un skill (JSON, TypeScript, ou format Claude Code). Le parser détecte automatiquement le format et pré-remplit le formulaire.
              </p>

              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={'Exemples acceptés :\n\n• JSON : { "name": "mon_skill", "description": "...", "instruction": "..." }\n• TypeScript declarations\n• Claude Code MCP : { "tool_name": "...", "input_schema": {...} }'}
                rows={8}
                className="w-full rounded px-3 py-2.5 text-sm font-mono outline-none resize-y transition-all duration-150"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--text-primary)',
                  minHeight: '120px',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
              />

              <div className="flex justify-between items-center">
                <div className="flex gap-1.5 flex-wrap">
                  {['JSON', 'TypeScript', 'Claude Code', 'Gemini'].map(tag => (
                    <span key={tag} className="rounded px-1.5 py-0.5 text-xs font-mono"
                      style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)', color: 'var(--text-dimmed)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleImport}
                  disabled={!importText.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-40"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                >
                  <ClipboardPaste className="w-3 h-3" />
                  Parser & importer
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Form (create/edit) ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {formMode !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-lg p-4 flex flex-col gap-3 mt-2"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formMode === 'create' ? '✨ Nouveau skill' : '✏️ Modifier le skill'}
                </h3>
                <button onClick={resetForm} className="p-1 rounded hover:bg-black/10 transition-colors">
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              {/* Name */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Nom (snake_case) *
                </label>
                <TextInput
                  value={formName}
                  onChange={setFormName}
                  placeholder="ex: resume_youtube"
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Description (pour l'IA) *
                </label>
                <TextInput
                  value={formDesc}
                  onChange={setFormDesc}
                  placeholder="Quand est-ce que l'IA doit utiliser ce skill ?"
                />
              </div>

              {/* Category */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Catégorie
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setFormCategory(cat.id)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: formCategory === cat.id ? 'var(--accent-subtle)' : 'var(--bg-panel)',
                        border: `1px solid ${formCategory === cat.id ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                        color: formCategory === cat.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                      }}
                    >
                      <cat.icon className="w-3 h-3" />
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Instruction */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Instruction / Prompt *
                </label>
                <textarea
                  value={formInstruction}
                  onChange={e => setFormInstruction(e.target.value)}
                  placeholder="Décris ce que l'IA doit faire quand ce skill est appelé..."
                  rows={4}
                  className="w-full rounded px-2.5 py-2 text-sm font-mono outline-none resize-y transition-all duration-150"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-base)',
                    color: 'var(--text-primary)',
                    minHeight: '80px',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
                />
              </div>

              {/* Parameters */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Paramètres ({formParams.length})
                  </label>
                  <button
                    onClick={addParam}
                    className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded transition-colors"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    <Plus className="w-2.5 h-2.5" /> Ajouter
                  </button>
                </div>

                {formParams.map((param, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-1.5 items-center rounded p-2"
                    style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
                  >
                    <input
                      className="col-span-3 rounded px-1.5 py-1 text-xs font-mono outline-none"
                      style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                      placeholder="nom"
                      value={param.name}
                      onChange={e => updateParam(idx, 'name', e.target.value)}
                    />
                    <select
                      className="col-span-2 rounded px-1 py-1 text-xs outline-none"
                      style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                      value={param.type}
                      onChange={e => updateParam(idx, 'type', e.target.value)}
                    >
                      {PARAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      className="col-span-4 rounded px-1.5 py-1 text-xs outline-none"
                      style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                      placeholder="description"
                      value={param.description}
                      onChange={e => updateParam(idx, 'description', e.target.value)}
                    />
                    <label className="col-span-2 flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <input
                        type="checkbox"
                        checked={param.required}
                        onChange={e => updateParam(idx, 'required', e.target.checked)}
                        className="w-3 h-3 accent-[var(--accent-primary)]"
                      />
                      requis
                    </label>
                    <button
                      onClick={() => removeParam(idx)}
                      className="col-span-1 flex justify-center p-1 rounded hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" style={{ color: 'var(--color-error, var(--color-error))' }} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Save / Cancel */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={resetForm}
                  className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
                >
                  Annuler
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold transition-colors"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                >
                  <Save className="w-3 h-3" />
                  {formMode === 'create' ? 'Créer' : 'Enregistrer'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Skills list ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2">
          <Sparkles className="w-8 h-8 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Aucun skill personnalisé. Crée ton premier !
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mt-1">
          {skills.map(skill => {
            const CatIcon = getCategoryIcon(skill.category);
            const isExpanded = expandedId === skill.id;

            return (
              <motion.div
                key={skill.id}
                layout
                className="rounded-lg overflow-hidden transition-all"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: `1px solid ${skill.enabled ? 'var(--border-base)' : 'var(--border-base)'}`,
                  opacity: skill.enabled ? 1 : 0.6,
                }}
              >
                {/* Row header */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <CatIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      {skill.name}
                      {autoSkill === skill.name && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}
                        >
                          <Star className="w-2.5 h-2.5" fill="currentColor" /> Auto
                        </span>
                      )}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {skill.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Auto (utilisé automatiquement à chaque session) */}
                    <button
                      onClick={() => toggleAutoSkill(skill)}
                      className="p-1 rounded transition-colors hover:bg-black/5"
                      title={autoSkill === skill.name
                        ? 'Utilisé automatiquement — cliquer pour désactiver'
                        : 'Utiliser automatiquement à chaque session'}
                      style={{ color: autoSkill === skill.name ? 'var(--accent-primary)' : 'var(--text-dimmed)' }}
                    >
                      <Star
                        className="w-3.5 h-3.5"
                        fill={autoSkill === skill.name ? 'currentColor' : 'none'}
                      />
                    </button>
                    {/* Toggle */}
                    <button
                      onClick={() => toggleEnabled(skill)}
                      className="p-1 rounded transition-colors"
                      title={skill.enabled ? 'Désactiver' : 'Activer'}
                      style={{ color: skill.enabled ? 'var(--accent-primary)' : 'var(--text-dimmed)' }}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => openEdit(skill)}
                      className="p-1 rounded transition-colors hover:bg-black/5"
                      title="Modifier"
                    >
                      <Edit3 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(skill)}
                      className="p-1 rounded transition-colors hover:bg-red-500/10"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--color-error, var(--color-error))' }} />
                    </button>
                    {/* Expand */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : skill.id)}
                      className="p-1 rounded transition-colors hover:bg-black/5"
                    >
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      }
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-1 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border-base)' }}>
                        <div>
                          <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-dimmed)' }}>
                            Instruction
                          </span>
                          <p className="text-xs font-mono mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                            {skill.instruction}
                          </p>
                        </div>
                        {skill.parameters.length > 0 && (
                          <div>
                            <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-dimmed)' }}>
                              Paramètres
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {skill.parameters.map((p, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-mono"
                                  style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}
                                >
                                  {p.name}
                                  <span style={{ color: 'var(--text-dimmed)' }}>:{p.type.toLowerCase()}</span>
                                  {p.required && <span style={{ color: 'var(--color-error, var(--color-error))' }}>*</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                          <span>Catégorie: {skill.category}</span>
                          <span>Créé: {new Date(skill.created_at).toLocaleDateString('fr-FR')}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Info note ────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 mt-3 rounded-lg p-2.5" style={{ backgroundColor: 'var(--accent-subtle)' }}>
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-primary)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Les skills personnalisés sont exposés à l'IA sous le préfixe <code className="font-mono">custom_</code>.
          Par exemple, un skill "resume_youtube" sera appelable via <code className="font-mono">custom_resume_youtube</code>.
          Ils sont rechargés dynamiquement — pas besoin de redémarrer.
          Clique sur l'étoile <Star className="inline w-3 h-3 -mt-0.5" /> pour qu'un skill soit appliqué
          <strong> automatiquement</strong> à chaque session : son instruction est injectée dans le prompt
          système et Leanna l'applique sans que tu aies à l'appeler.
        </p>
      </div>
    </Section>
  );
}
