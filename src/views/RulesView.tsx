import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield, Plus, Trash2, Download, Upload, ToggleLeft, ToggleRight,
  ChevronDown, ChevronRight, Tag, AlertCircle, CheckCircle2, Info,
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

// ─── Built-in rule packs ───────────────────────────────────────────────────────

const DEFAULT_PACKS: RulePack[] = [
  {
    id: 'owasp-top10-2021',
    name: 'OWASP Top 10 (2021)',
    description: 'Règles couvrant les 10 principales vulnérabilités OWASP : injection, XSS, SSRF, auth brisée, etc.',
    category: 'owasp',
    rulesCount: 47,
    enabled: true,
    version: '2.1.0',
    author: 'OWASP Foundation',
    tags: ['injection', 'xss', 'ssrf', 'auth', 'a01-a10'],
    severity: 'mixed',
  },
  {
    id: 'cwe-top25-2023',
    name: 'CWE Top 25 (2023)',
    description: 'Les 25 failles logicielles les plus dangereuses selon MITRE — focus sur les CWE les plus exploitées.',
    category: 'cwe',
    rulesCount: 25,
    enabled: true,
    version: '1.3.0',
    author: 'MITRE Corporation',
    tags: ['cwe-79', 'cwe-89', 'cwe-287', 'cwe-502', 'cwe-918'],
    severity: 'critical',
  },
  {
    id: 'cisa-kev-patterns',
    name: 'CISA KEV Patterns',
    description: 'Patterns de détection basés sur les vulnérabilités activement exploitées (CISA Known Exploited Vulnerabilities).',
    category: 'cisa',
    rulesCount: 18,
    enabled: true,
    version: '1.0.2',
    author: 'CISA',
    tags: ['kev', 'actively-exploited', 'ransomware'],
    severity: 'critical',
  },
  {
    id: 'secrets-detection',
    name: 'Détection de secrets',
    description: 'Patterns regex d\'entropie pour détecter les tokens, clés API, credentials codés en dur (AWS, GCP, GitHub, JWT…).',
    category: 'custom',
    rulesCount: 84,
    enabled: true,
    version: '3.0.1',
    author: 'Leanna Security',
    tags: ['aws', 'gcp', 'github', 'jwt', 'oauth', 'entropy'],
    severity: 'high',
  },
  {
    id: 'nodejs-security',
    name: 'Node.js Security',
    description: 'Règles spécifiques à l\'écosystème Node.js : eval(), command injection, path traversal, prototype pollution.',
    category: 'custom',
    rulesCount: 32,
    enabled: true,
    version: '2.0.0',
    author: 'Leanna Security',
    tags: ['nodejs', 'eval', 'prototype-pollution', 'path-traversal'],
    severity: 'high',
  },
  {
    id: 'react-security',
    name: 'React / Frontend Security',
    description: 'Règles pour les applications React : dangerouslySetInnerHTML, XSS via props, open redirects, postMessage.',
    category: 'custom',
    rulesCount: 19,
    enabled: false,
    version: '1.1.0',
    author: 'Leanna Security',
    tags: ['react', 'xss', 'dangerouslySetInnerHTML', 'csrf'],
    severity: 'medium',
  },
  {
    id: 'iac-security',
    name: 'Infrastructure as Code',
    description: 'Dockerfile, Kubernetes, Terraform, CloudFormation — détection de misconfigurations de sécurité.',
    category: 'custom',
    rulesCount: 56,
    enabled: false,
    version: '1.4.0',
    author: 'Leanna Security',
    tags: ['docker', 'kubernetes', 'terraform', 'aws-cloudformation'],
    severity: 'mixed',
  },
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
  const [packs, setPacks] = useState<RulePack[]>(DEFAULT_PACKS);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const togglePack = useCallback((id: string) => {
    setPacks(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  }, []);

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
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {enabledCount}/{packs.length} packs actifs · {totalRules} règles au total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
