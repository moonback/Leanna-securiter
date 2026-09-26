import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  Play,
  RotateCcw,
  Copy,
  Check,
  Code,
  Terminal,
  Clock,
  CloudRain,
  Github,
  Globe,
  Database,
  Monitor,
  Blocks,
  ShieldCheck,
  CheckCircle2,
  FolderTree,
  Bot,
  Crosshair,
  GitBranch,
  FileText,
  BookOpen,
  Link as LinkIcon,
  Sparkles,
  AlertCircle,
  Shield,
  Layers,
  Wrench,
  Loader2,
  SlidersHorizontal,
  ChevronRight,
  List,
} from 'lucide-react';

// ─── Map des icônes de skills ──────────────────────────────────────────────────

const ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  Clock,
  CloudRain,
  Github,
  Globe,
  Database,
  Monitor,
  Blocks,
  ShieldCheck,
  CheckCircle2,
  FolderTree,
  Bot,
  Crosshair,
  GitBranch,
  FileText,
  BookOpen,
  Link: LinkIcon,
  Sparkles,
  List,
  Code,
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ToolParamDoc {
  type: string;
  description?: string;
  required?: boolean;
  enum?: any[];
  default?: any;
  items?: any;
}

export interface ToolDoc {
  name: string;
  category: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParamDoc>;
    required: string[];
  };
  permissions: string[];
  timeoutMs: number;
  metrics: {
    calls: number;
    failures: number;
    avgMs: number;
  };
  example: Record<string, any>;
  codeSnippets: {
    typescript: string;
    curl: string;
    json: string;
  };
}

export interface SkillDoc {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  status: 'active' | 'authenticated' | 'requires_auth';
  toolCount: number;
  isCustom: boolean;
  tools: ToolDoc[];
}

export interface SkillsDocResponse {
  summary: {
    totalSkills: number;
    totalTools: number;
    categories: string[];
    totalCalls: number;
    totalFailures: number;
    generatedAt: string;
  };
  skills: SkillDoc[];
}

interface SkillsDocumentationProps {
  embedded?: boolean;
  initialToolName?: string;
}

// ─── Badge Permissions ────────────────────────────────────────────────────────

function PermissionBadge({ perm }: { perm: string }) {
  const isDangerous = perm === 'dangerous';
  const isWrite = perm === 'write' || perm === 'execute';

  const color = isDangerous
    ? 'var(--color-error)'
    : isWrite
      ? 'var(--color-warning)'
      : 'var(--color-info)';

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-mono font-medium px-2 py-0.5 rounded-md uppercase tracking-wider"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      <Shield className="w-3 h-3" />
      {perm}
    </span>
  );
}

// ─── Composant Principal ───────────────────────────────────────────────────────

export function SkillsDocumentation({ embedded = false, initialToolName }: SkillsDocumentationProps) {
  const [data, setData] = useState<SkillsDocResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPermission, setSelectedPermission] = useState<string>('all');

  // Sélection courante
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);

  // Test Runner state
  const [runnerInputs, setRunnerInputs] = useState<Record<string, any>>({});
  const [rawJsonInput, setRawJsonInput] = useState<string>('{}');
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    success: boolean;
    durationMs: number;
    result?: any;
    error?: string;
  } | null>(null);

  // Snippets tab & Copy feedback
  const [snippetTab, setSnippetTab] = useState<'typescript' | 'curl' | 'json'>('typescript');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Chargement des données
  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('Leanna_api_token') || '';
      const headers: Record<string, string> = {};
      if (token) headers['x-Leanna-token'] = token;

      const res = await fetch('/api/skills/docs', { headers });
      if (!res.ok) {
        throw new Error(`Erreur ${res.status}: ${res.statusText}`);
      }
      const json: SkillsDocResponse = await res.json();
      setData(json);

      // Sélection par défaut
      if (!selectedToolName) {
        if (initialToolName) {
          setSelectedToolName(initialToolName);
        } else if (json.skills.length > 0 && json.skills[0].tools.length > 0) {
          setSelectedToolName(json.skills[0].tools[0].name);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Impossible de charger la documentation des skills');
    } finally {
      setLoading(false);
    }
  }, [initialToolName, selectedToolName]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Tous les outils aplatis
  const allTools = useMemo(() => {
    if (!data) return [];
    return data.skills.flatMap((s) =>
      s.tools.map((t) => ({ ...t, parentSkill: s }))
    );
  }, [data]);

  // Filtrage
  const filteredTools = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return allTools.filter((t) => {
      const matchesCategory =
        selectedCategory === 'all' ||
        t.category.toLowerCase() === selectedCategory.toLowerCase() ||
        t.parentSkill.id.toLowerCase() === selectedCategory.toLowerCase();

      const matchesPermission =
        selectedPermission === 'all' ||
        t.permissions.includes(selectedPermission);

      if (!matchesCategory || !matchesPermission) return false;

      if (!q) return true;

      const matchName = t.name.toLowerCase().includes(q);
      const matchDesc = t.description.toLowerCase().includes(q);
      const matchSkill = t.parentSkill.name.toLowerCase().includes(q);
      const matchParam = Object.keys(t.parameters.properties).some((p) =>
        p.toLowerCase().includes(q)
      );

      return matchName || matchDesc || matchSkill || matchParam;
    });
  }, [allTools, searchQuery, selectedCategory, selectedPermission]);

  // Catégories uniques avec comptage
  const categoriesWithCounts = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    for (const tool of allTools) {
      const cat = tool.category || 'general';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data, allTools]);

  // Outil actif sélectionné
  const activeTool = useMemo(() => {
    if (!selectedToolName) return filteredTools[0] || null;
    return allTools.find((t) => t.name === selectedToolName) || filteredTools[0] || null;
  }, [selectedToolName, allTools, filteredTools]);

  // Initialiser le runner inputs quand l'outil change
  useEffect(() => {
    if (activeTool) {
      const initialArgs = { ...activeTool.example };
      setRunnerInputs(initialArgs);
      setRawJsonInput(JSON.stringify(initialArgs, null, 2));
      setRunResult(null);
    }
  }, [activeTool?.name]);

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Exécuter l'outil (Test Runner)
  const handleExecuteTool = async () => {
    if (!activeTool) return;
    setRunning(true);
    setRunResult(null);

    let payloadArgs: Record<string, any> = {};
    if (inputMode === 'json') {
      try {
        payloadArgs = JSON.parse(rawJsonInput);
      } catch (err: any) {
        setRunResult({
          success: false,
          durationMs: 0,
          error: `JSON invalide : ${err.message}`,
        });
        setRunning(false);
        return;
      }
    } else {
      payloadArgs = runnerInputs;
    }

    try {
      const token = localStorage.getItem('Leanna_api_token') || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['x-Leanna-token'] = token;

      const res = await fetch('/api/skills/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          toolName: activeTool.name,
          args: payloadArgs,
        }),
      });

      const resData = await res.json();
      setRunResult(resData);
    } catch (err: any) {
      setRunResult({
        success: false,
        durationMs: 0,
        error: err?.message || 'Échec de la requête vers le serveur',
      });
    } finally {
      setRunning(false);
    }
  };

  // ─── Rendu État de chargement / erreur ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-3 min-h-[350px]">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
          Génération de la documentation des skills depuis les déclarations…
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4 text-center">
        <AlertCircle className="w-10 h-10" style={{ color: 'var(--color-error)' }} />
        <div>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Impossible de générer la documentation
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {error}
          </p>
        </div>
        <button
          onClick={fetchDocs}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90 cursor-pointer"
          style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
        >
          <RotateCcw className="w-4 h-4" />
          Réessayer
        </button>
      </div>
    );
  }

  // ─── Rendu Principal ──────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-full w-full ${embedded ? '' : 'p-6 max-w-7xl mx-auto'}`}>
      {/* ─── Barre de métriques supérieure ───────────────────────────────────── */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 p-4 rounded-2xl border"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-base)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
              color: 'var(--accent-primary)',
            }}
          >
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              {data.summary.totalSkills}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Compétences
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
              color: 'var(--color-success)',
            }}
          >
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              {data.summary.totalTools}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Outils déclarés
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-info) 15%, transparent)',
              color: 'var(--color-info)',
            }}
          >
            <Play className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              {data.summary.totalCalls}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Exécutions totales
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
              color: 'var(--color-warning)',
            }}
          >
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-success)' }}>
              Auto-généré
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Schémas & Validation Live
            </div>
          </div>
        </div>
      </div>

      {/* ─── Filtres & Recherche ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Recherche */}
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom d'outil, description, paramètre..."
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm border outline-none transition-all"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-base)',
              color: 'var(--text-primary)',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Bouton d'actualisation */}
        <button
          onClick={fetchDocs}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border hover:bg-white/5 transition-colors cursor-pointer"
          style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
          title="Actualiser la liste"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* Badges de catégories */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-thin">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-indigo-500 text-white shadow-sm'
              : 'hover:bg-white/5'
          }`}
          style={{
            backgroundColor: selectedCategory === 'all' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: selectedCategory === 'all' ? '#fff' : 'var(--text-muted)',
            border: '1px solid var(--border-base)',
          }}
        >
          Tous ({allTools.length})
        </button>
        {categoriesWithCounts.map(([cat, count]) => {
          const isSelected = selectedCategory.toLowerCase() === cat.toLowerCase();
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(isSelected ? 'all' : cat)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
              style={{
                backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: isSelected ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border-base)',
              }}
            >
              <span className="capitalize">{cat}</span>
              <span
                className="text-[10px] px-1 rounded-full font-mono"
                style={{
                  backgroundColor: isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── Explorateur à deux volets (Master-Detail) ─────────────────────────── */}
      <div
        className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 min-h-[550px] border rounded-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-base)',
        }}
      >
        {/* Volet gauche : Liste des outils */}
        <div
          className="md:col-span-4 border-r flex flex-col min-h-[300px] max-h-[750px] overflow-y-auto"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
        >
          <div
            className="p-3 border-b flex items-center justify-between text-xs font-semibold"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
          >
            <span>OUTILS DISPONIBLES ({filteredTools.length})</span>
            {selectedCategory !== 'all' && (
              <span className="capitalize text-indigo-400 font-mono">
                {selectedCategory}
              </span>
            )}
          </div>

          <div className="divide-y divide-white/5">
            {filteredTools.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Aucun outil ne correspond aux critères.
              </div>
            ) : (
              filteredTools.map((tool) => {
                const isSelected = activeTool?.name === tool.name;
                const Icon = ICON_MAP[tool.parentSkill.icon] || Blocks;

                return (
                  <button
                    key={tool.name}
                    onClick={() => setSelectedToolName(tool.name)}
                    className="w-full text-left p-3.5 transition-all flex items-start gap-3 group cursor-pointer"
                    style={{
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--accent-primary) 12%, transparent)'
                        : 'transparent',
                      borderLeft: isSelected
                        ? '3px solid var(--accent-primary)'
                        : '3px solid transparent',
                    }}
                  >
                    <div
                      className="p-2 rounded-lg flex-shrink-0 transition-transform group-hover:scale-105"
                      style={{
                        backgroundColor: isSelected
                          ? 'var(--accent-primary)'
                          : 'var(--bg-panel)',
                        color: isSelected ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="text-xs font-mono font-bold truncate"
                          style={{
                            color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                          }}
                        >
                          {tool.name}
                        </span>
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded capitalize"
                          style={{
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {tool.category}
                        </span>
                      </div>
                      <p
                        className="text-xs mt-1 line-clamp-2 leading-relaxed"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {tool.description}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Volet droit : Documentation détaillée & Runner */}
        <div className="md:col-span-8 flex flex-col max-h-[750px] overflow-y-auto p-5">
          {activeTool ? (
            <div className="space-y-6">
              {/* En-tête de l'outil */}
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                      color: 'var(--accent-primary)',
                    }}
                  >
                    {activeTool.parentSkill.name}
                  </span>
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    ⏱ {Math.round(activeTool.timeoutMs / 1000)}s timeout
                  </span>
                  {activeTool.permissions.map((p) => (
                    <PermissionBadge key={p} perm={p} />
                  ))}
                  {activeTool.metrics.calls > 0 && (
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: 'rgba(16,185,129,0.1)',
                        color: 'var(--color-success)',
                      }}
                    >
                      {activeTool.metrics.calls} appels ({activeTool.metrics.avgMs}ms moy.)
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-xl font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                    {activeTool.name}
                  </h2>
                  <button
                    onClick={() => handleCopy(activeTool.name, 'tool-name')}
                    className="p-1.5 rounded-lg border hover:bg-white/5 transition-colors text-xs flex items-center gap-1 cursor-pointer"
                    style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                    title="Copier le nom de l'outil"
                  >
                    {copiedKey === 'tool-name' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary, var(--text-primary))' }}>
                  {activeTool.description}
                </p>
              </div>

              {/* Paramètres & Schéma */}
              <div
                className="p-4 rounded-xl border"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-base)',
                }}
              >
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                  Paramètres de l'outil
                </h3>

                {Object.keys(activeTool.parameters.properties).length === 0 ? (
                  <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                    Cet outil ne nécessite aucun paramètre d'entrée.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b" style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
                          <th className="pb-2 font-medium">Nom</th>
                          <th className="pb-2 font-medium">Type</th>
                          <th className="pb-2 font-medium">Statut</th>
                          <th className="pb-2 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono">
                        {Object.entries(activeTool.parameters.properties).map(([pName, pMeta]) => {
                          const isRequired = activeTool.parameters.required.includes(pName);
                          return (
                            <tr key={pName} className="hover:bg-white/[0.02]">
                              <td className="py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>
                                {pName}
                              </td>
                              <td className="py-2.5">
                                <span
                                  className="px-1.5 py-0.5 rounded text-[11px] font-mono"
                                  style={{
                                    backgroundColor: 'color-mix(in srgb, var(--accent-secondary) 15%, transparent)',
                                    color: 'var(--accent-secondary)',
                                  }}
                                >
                                  {pMeta.type}
                                </span>
                              </td>
                              <td className="py-2.5">
                                {isRequired ? (
                                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/25">
                                    Requis
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                                    Optionnel
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 font-sans leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                {pMeta.description || '—'}
                                {pMeta.enum && (
                                  <span className="block text-[11px] font-mono text-indigo-300 mt-0.5">
                                    Valeurs : [{pMeta.enum.map((v) => `"${v}"`).join(', ')}]
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Snippets de code */}
              <div
                className="rounded-xl border overflow-hidden"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-base)',
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-2 border-b"
                  style={{ borderColor: 'var(--border-base)' }}
                >
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Exemple d'intégration
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {(['typescript', 'curl', 'json'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setSnippetTab(tab)}
                        className="px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer"
                        style={{
                          backgroundColor: snippetTab === tab ? 'var(--bg-panel)' : 'transparent',
                          color: snippetTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        {tab.toUpperCase()}
                      </button>
                    ))}
                    <button
                      onClick={() => handleCopy(activeTool.codeSnippets[snippetTab], `snippet-${snippetTab}`)}
                      className="p-1 rounded hover:bg-white/5 transition-colors ml-2 cursor-pointer"
                      title="Copier le code"
                    >
                      {copiedKey === `snippet-${snippetTab}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </button>
                  </div>
                </div>

                <pre
                  className="p-4 text-xs font-mono overflow-x-auto text-emerald-400 leading-relaxed max-h-48"
                  style={{ backgroundColor: '#090d16' }}
                >
                  {activeTool.codeSnippets[snippetTab]}
                </pre>
              </div>

              {/* ─── Test Runner Interactif ("Try It Out") ──────────────────── */}
              <div
                className="p-5 rounded-2xl border relative overflow-hidden"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-strong, var(--border-base))',
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      Bac à sable interactif — Tester "{activeTool.name}"
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const ex = { ...activeTool.example };
                        setRunnerInputs(ex);
                        setRawJsonInput(JSON.stringify(ex, null, 2));
                      }}
                      className="text-xs px-2.5 py-1 rounded-lg border hover:bg-white/5 transition-colors cursor-pointer"
                      style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                    >
                      Charger l'exemple
                    </button>

                    <div className="border-l h-4" style={{ borderColor: 'var(--border-base)' }} />

                    <button
                      onClick={() => setInputMode(inputMode === 'form' ? 'json' : 'form')}
                      className="text-xs font-mono px-2 py-1 rounded-lg border hover:bg-white/5 transition-colors cursor-pointer"
                      style={{ borderColor: 'var(--border-base)', color: 'var(--accent-primary)' }}
                    >
                      Mode {inputMode === 'form' ? 'JSON' : 'Formulaire'}
                    </button>
                  </div>
                </div>

                {/* Formulaire dynamique ou JSON */}
                <div className="space-y-3 mb-4">
                  {inputMode === 'json' ? (
                    <div>
                      <label className="block text-xs font-mono text-gray-400 mb-1">
                        Arguments (JSON Payload) :
                      </label>
                      <textarea
                        value={rawJsonInput}
                        onChange={(e) => setRawJsonInput(e.target.value)}
                        rows={5}
                        className="w-full p-3 font-mono text-xs rounded-xl border outline-none"
                        style={{
                          backgroundColor: '#090d16',
                          borderColor: 'var(--border-base)',
                          color: '#e2e8f0',
                        }}
                      />
                    </div>
                  ) : (
                    <div>
                      {Object.keys(activeTool.parameters.properties).length === 0 ? (
                        <p className="text-xs italic py-2" style={{ color: 'var(--text-muted)' }}>
                          Aucun paramètre requis pour exécuter cet outil.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {Object.entries(activeTool.parameters.properties).map(([pName, pMeta]) => {
                            const isRequired = activeTool.parameters.required.includes(pName);
                            const val = runnerInputs[pName] ?? '';

                            return (
                              <div key={pName} className="space-y-1">
                                <label className="flex items-center justify-between text-xs font-mono">
                                  <span style={{ color: 'var(--text-primary)' }}>
                                    {pName} {isRequired && <span className="text-rose-400">*</span>}
                                  </span>
                                  <span className="text-[10px] text-gray-500">{pMeta.type}</span>
                                </label>

                                {pMeta.type === 'BOOLEAN' ? (
                                  <div className="flex items-center gap-2 pt-1">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(runnerInputs[pName])}
                                      onChange={(e) =>
                                        setRunnerInputs((prev) => ({
                                          ...prev,
                                          [pName]: e.target.checked,
                                        }))
                                      }
                                      className="rounded cursor-pointer"
                                    />
                                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                      {runnerInputs[pName] ? 'true' : 'false'}
                                    </span>
                                  </div>
                                ) : (
                                  <input
                                    type={pMeta.type === 'NUMBER' ? 'number' : 'text'}
                                    value={
                                      typeof val === 'object' ? JSON.stringify(val) : val
                                    }
                                    onChange={(e) => {
                                      const rawVal = e.target.value;
                                      const finalVal =
                                        pMeta.type === 'NUMBER'
                                          ? Number(rawVal)
                                          : rawVal;
                                      setRunnerInputs((prev) => ({
                                        ...prev,
                                        [pName]: finalVal,
                                      }));
                                    }}
                                    placeholder={pMeta.description || pName}
                                    className="w-full px-3 py-1.5 rounded-lg border text-xs font-mono outline-none"
                                    style={{
                                      backgroundColor: 'var(--bg-panel)',
                                      borderColor: 'var(--border-base)',
                                      color: 'var(--text-primary)',
                                    }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Bouton d'action */}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-gray-500">
                    Exécution directe via le ToolRegistry Leanna
                  </span>

                  <button
                    onClick={handleExecuteTool}
                    disabled={running}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-500/20"
                    style={{
                      backgroundColor: 'var(--accent-primary)',
                      color: '#fff',
                    }}
                  >
                    {running ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Exécution en cours…
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        Tester l'outil
                      </>
                    )}
                  </button>
                </div>

                {/* Console de Résultat */}
                <AnimatePresence>
                  {runResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="mt-4 pt-4 border-t"
                      style={{ borderColor: 'var(--border-base)' }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: runResult.success
                                ? 'var(--color-success)'
                                : 'var(--color-error)',
                            }}
                          />
                          <span
                            className="text-xs font-bold font-mono uppercase"
                            style={{
                              color: runResult.success
                                ? 'var(--color-success)'
                                : 'var(--color-error)',
                            }}
                          >
                            {runResult.success ? 'Succès' : 'Erreur'}
                          </span>
                          <span className="text-xs font-mono text-gray-400">
                            ⏱ {runResult.durationMs}ms
                          </span>
                        </div>

                        <button
                          onClick={() =>
                            handleCopy(
                              JSON.stringify(runResult.result || runResult.error, null, 2),
                              'run-result'
                            )
                          }
                          className="p-1 text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer"
                        >
                          {copiedKey === 'run-result' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>Copier</span>
                        </button>
                      </div>

                      <pre
                        className="p-3.5 text-xs font-mono rounded-xl overflow-x-auto leading-relaxed max-h-60"
                        style={{
                          backgroundColor: '#090d16',
                          color: runResult.success ? '#86efac' : '#fca5a5',
                          border: `1px solid ${
                            runResult.success ? 'rgba(74,222,128,0.2)' : 'rgba(251,113,133,0.2)'
                          }`,
                        }}
                      >
                        {JSON.stringify(runResult.result || runResult.error, null, 2)}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center my-auto">
              <Sparkles className="w-10 h-10 mb-3 text-indigo-400" />
              <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Sélectionnez un outil
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Choisissez un outil dans la colonne de gauche pour inspecter sa documentation et le tester en direct.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default SkillsDocumentation;
