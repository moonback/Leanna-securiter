import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield, Plus, Trash2, Download, Upload, ToggleLeft, ToggleRight,
  ChevronDown, ChevronRight, Tag, AlertCircle,
  Package, Search, RefreshCw, Loader2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RulePack {
  id: string;
  name: string;
  description: string;
  category: 'owasp' | 'cwe' | 'cisa' | 'custom';
  rulesCount: number;
  enabled: boolean;
  version: string;
  author: string;
  tags: string[];
  severity: 'critical' | 'high' | 'medium' | 'low' | 'mixed';
}

// Backend RulePackMeta shape from /api/security/rules
interface BackendPackMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  ruleCount: number;
  enabled: boolean;
}

// ─── Category mapping (backend pack IDs → frontend categories) ─────────────

function inferCategory(id: string): RulePack['category'] {
  if (id.startsWith('owasp')) return 'owasp';
  if (id.startsWith('cwe')) return 'cwe';
  if (id.startsWith('cisa')) return 'cisa';
  return 'custom';
}

function inferTags(id: string): string[] {
  const map: Record<string, string[]> = {
    'owasp-top10-2021': ['injection', 'xss', 'ssrf', 'auth', 'a01-a10'],
    'cwe-top25': ['cwe-79', 'cwe-89', 'cwe-287', 'cwe-502', 'cwe-918'],
    'cisa-kev': ['kev', 'log4shell', 'spring4shell', 'actively-exploited'],
  };
  return map[id] ?? [];
}

function backendToUiPack(meta: BackendPackMeta): RulePack {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    category: inferCategory(meta.id),
    rulesCount: meta.ruleCount,
    enabled: meta.enabled,
    version: meta.version,
    author: meta.author,
    tags: inferTags(meta.id),
    severity: 'mixed',
  };
}

// Fallback static packs shown while loading or if API is unavailable
const FALLBACK_PACKS: RulePack[] = [
  { id: 'owasp-top10-2021', name: 'OWASP Top 10 (2021)', description: 'Règles OWASP Top 10 2021.', category: 'owasp', rulesCount: 8, enabled: true, version: '2021.0.1', author: 'Leanna Security', tags: ['injection', 'xss', 'ssrf', 'auth'], severity: 'mixed' },
  { id: 'cwe-top25', name: 'CWE Top 25 (2023)', description: 'Les 25 faiblesses logicielles CWE les plus dangereuses.', category: 'cwe', rulesCount: 15, enabled: true, version: '2023.0.1', author: 'Leanna Security', tags: ['cwe-79', 'cwe-89', 'cwe-502'], severity: 'critical' },
  { id: 'cisa-kev', name: 'CISA KEV', description: 'Patterns CISA Known Exploited Vulnerabilities.', category: 'cisa', rulesCount: 7, enabled: true, version: '2024.0.1', author: 'Leanna Security', tags: ['kev', 'log4shell', 'actively-exploited'], severity: 'critical' },
];

// ─── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  owasp: { label: 'OWASP', color: '#7c3aed', bg: '#7c3aed15' },
  cwe: { label: 'CWE/MITRE', color: '#3b82f6', bg: '#3b82f615' },
  cisa: { label: 'CISA KEV', color: '#ef4444', bg: '#ef444415' },
  custom: { label: 'Custom', color: '#22c55e', bg: '#22c55e15' },
};

const SEVERITY_CONFIG = {
  critical: { label: 'Critique', color: '#dc2626' },
  high: { label: 'Haute', color: '#ea580c' },
  medium: { label: 'Moyenne', color: '#d97706' },
  low: { label: 'Faible', color: '#2563eb' },
  mixed: { label: 'Mixte', color: '#6b7280' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function RulePackCard({
  pack,
  onToggle,
  onDelete,
  expanded,
  onExpand,
}: {
  pack: RulePack;
  onToggle: () => void;
  onDelete: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const cat = CATEGORY_CONFIG[pack.category];
  const sev = SEVERITY_CONFIG[pack.severity];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: pack.enabled ? `${cat.color}55` : 'var(--border-base)',
        backgroundColor: 'var(--bg-panel)',
        opacity: pack.enabled ? 1 : 0.7,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        {/* Toggle */}
        <motion.button
          type="button"
          onClick={onToggle}
          whileTap={{ scale: 0.9 }}
          className="flex-shrink-0 mt-0.5"
        >
          {pack.enabled
            ? <ToggleRight size={22} style={{ color: cat.color }} />
            : <ToggleLeft size={22} style={{ color: 'var(--text-muted)' }} />
          }
        </motion.button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  {pack.name}
                </span>
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: cat.bg, color: cat.color }}
                >
                  {cat.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>v{pack.version}</span>
              </div>
              <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {pack.description}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <motion.button
                onClick={onExpand}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-1 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </motion.button>
              {pack.category === 'custom' && (
                <motion.button
                  onClick={onDelete}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1 rounded-lg transition-colors"
                  style={{ color: '#ef4444' }}
                >
                  <Trash2 size={13} />
                </motion.button>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-[10px] font-semibold" style={{ color: cat.color }}>
              {pack.rulesCount} règles
            </span>
            <span className="text-[10px]" style={{ color: sev.color }}>
              {sev.label}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              par {pack.author}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-4 pt-0 border-t"
              style={{ borderColor: 'var(--border-base)' }}
            >
              <p className="text-[10px] font-semibold mt-3 mb-2" style={{ color: 'var(--text-muted)' }}>TAGS</p>
              <div className="flex gap-1.5 flex-wrap">
                {pack.tags.map(tag => (
                  <span
                    key={tag}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function RulesView() {
  const [packs, setPacks] = useState<RulePack[]>(FALLBACK_PACKS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const loadPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/security/rules');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { success: boolean; packs: BackendPackMeta[] };
      if (data.success && data.packs.length > 0) {
        setPacks(data.packs.map(backendToUiPack));
      }
    } catch {
      setError('Impossible de charger les règles depuis le serveur. Affichage des règles par défaut.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPacks(); }, [loadPacks]);

  const togglePack = useCallback(async (id: string) => {
    const pack = packs.find(p => p.id === id);
    if (!pack) return;
    const newEnabled = !pack.enabled;
    // Optimistic update
    setPacks(prev => prev.map(p => p.id === id ? { ...p, enabled: newEnabled } : p));
    try {
      await fetch(`/api/security/rules/${encodeURIComponent(id)}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });
    } catch {
      // Revert on error
      setPacks(prev => prev.map(p => p.id === id ? { ...p, enabled: !newEnabled } : p));
    }
  }, [packs]);

  const deletePack = useCallback((id: string) => {
    setPacks(prev => prev.filter(p => p.id !== id));
  }, []);

  const filtered = packs.filter(p => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchesCat = filterCategory === 'all' || p.category === filterCategory;
    return matchesSearch && matchesCat;
  });

  const enabledCount = packs.filter(p => p.enabled).length;
  const totalRules = packs.filter(p => p.enabled).reduce((sum, p) => sum + p.rulesCount, 0);

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed30 0%, #3b82f630 100%)', border: '1px solid #7c3aed40' }}
          >
            <Shield size={18} style={{ color: '#7c3aed' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Packs de règles
            </h1>
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              {loading
                ? <><Loader2 size={11} className="animate-spin" /> Chargement…</>
                : <>{enabledCount}/{packs.length} packs actifs · {totalRules} règles au total</>
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={loadPacks}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Rafraîchir
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowImport(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)' }}
          >
            <Upload size={13} /> Importer
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)' }}
          >
            <Download size={13} /> Exporter
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)',
              color: '#fff',
            }}
          >
            <Plus size={13} /> Nouveau pack
          </motion.button>
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b flex-shrink-0"
            style={{ borderColor: '#ef444430', backgroundColor: '#ef444410' }}
          >
            <div className="px-4 py-2.5 flex items-center gap-2">
              <AlertCircle size={13} style={{ color: '#ef4444' }} />
              <p className="text-[11px] flex-1" style={{ color: '#ef4444' }}>{error}</p>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setError(null)}
                className="text-[10px] underline"
                style={{ color: '#ef4444' }}
              >Ignorer</motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import panel */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
          >
            <div className="px-6 py-4">
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Importer un pack de règles (JSON / YAML)
              </p>
              <div
                className="border-2 border-dashed rounded-xl p-6 text-center"
                style={{ borderColor: 'var(--border-base)' }}
              >
                <Package size={24} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Glissez-déposez un fichier ou{' '}
                  <span style={{ color: 'var(--accent-primary)', cursor: 'pointer' }}>parcourez…</span>
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Compatible Semgrep, CodeQL, règles Leanna JSON
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}>
          <Search size={13} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom, tag…"
            className="flex-1 bg-transparent text-xs outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 rounded-lg border text-xs outline-none"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        >
          <option value="all">Toutes les catégories</option>
          {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <Tag size={24} style={{ color: 'var(--text-muted)' }} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun pack correspondant</p>
          </div>
        ) : (
          filtered.map(pack => (
            <RulePackCard
              key={pack.id}
              pack={pack}
              onToggle={() => togglePack(pack.id)}
              onDelete={() => deletePack(pack.id)}
              expanded={expandedPack === pack.id}
              onExpand={() => setExpandedPack(p => p === pack.id ? null : pack.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
