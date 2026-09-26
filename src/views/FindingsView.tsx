import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Filter, ChevronDown, ChevronUp, ArrowRight,
  AlertTriangle, AlertCircle, Info, CheckCircle2,
  RefreshCw, Download, Loader2, X
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Finding {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  cwe?: string;
  owasp?: string;
  scanner: 'sast' | 'sca' | 'secrets' | 'iac' | 'dast';
  file?: string;
  line?: number;
  snippet?: string;
  description: string;
  impact?: string;
  remediation?: string;
  suggestedPatch?: string;
  cvss?: number;
  epss?: number;
  kev?: boolean;
  status: 'open' | 'acknowledged' | 'false_positive' | 'fixed';
  fingerprint: string;
  detectedAt: string;
  taintFlow?: Array<{
    step: number;
    filePath: string;
    line: number;
    kind: 'source' | 'propagation' | 'sanitizer' | 'sink';
    description: string;
    variableName?: string;
  }>;
  references?: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { label: 'Critique', color: '#dc2626', bg: '#dc262615', icon: AlertCircle },
  high: { label: 'Haute', color: '#ea580c', bg: '#ea580c15', icon: AlertTriangle },
  medium: { label: 'Moyenne', color: '#d97706', bg: '#d9770615', icon: AlertTriangle },
  low: { label: 'Faible', color: '#2563eb', bg: '#2563eb15', icon: Info },
  info: { label: 'Info', color: '#6b7280', bg: '#6b728015', icon: Info },
} as const;

const SCANNER_LABELS: Record<string, string> = {
  sast: 'SAST',
  sca: 'SCA',
  secrets: 'Secrets',
  iac: 'IaC',
  dast: 'DAST',
};

const STATUS_CONFIG = {
  open: { label: 'Ouvert', color: '#ef4444' },
  acknowledged: { label: 'Reconnu', color: '#f59e0b' },
  false_positive: { label: 'Faux positif', color: '#6b7280' },
  fixed: { label: 'Corrigé', color: '#22c55e' },
};

// ─── Mock findings for demo (replaced by API data when available) ──────────────

const MOCK_FINDINGS: Finding[] = [
  {
    id: 'f001',
    title: 'Injection SQL via paramètre non validé',
    severity: 'critical',
    cwe: 'CWE-89',
    owasp: 'A03:2021',
    scanner: 'sast',
    file: 'server/routes/api.ts',
    line: 142,
    snippet: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)',
    description: 'La valeur req.params.id est directement interpolée dans une requête SQL sans validation ni paramétrage. Un attaquant peut injecter du SQL arbitraire.',
    remediation: 'Utilisez des requêtes paramétrées ou un ORM. Ex: db.query("SELECT * FROM users WHERE id = $1", [req.params.id])',
    cvss: 9.8,
    epss: 0.87,
    kev: false,
    status: 'open',
    fingerprint: 'sha256:abc123',
    detectedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'f002',
    title: 'Secret AWS exposé dans le code source',
    severity: 'critical',
    cwe: 'CWE-798',
    scanner: 'secrets',
    file: 'src/config/aws.ts',
    line: 8,
    snippet: 'const AWS_SECRET = "AKIAIOSFODNN7EXAMPLE..."',
    description: 'Une clé d\'accès AWS est codée en dur dans le fichier source. Elle est visible dans l\'historique git.',
    remediation: 'Révoquez immédiatement cette clé AWS. Utilisez des variables d\'environnement ou AWS Secrets Manager.',
    cvss: 9.1,
    epss: 0.72,
    kev: false,
    status: 'open',
    fingerprint: 'sha256:def456',
    detectedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'f003',
    title: 'XSS via rendu HTML non sanitisé',
    severity: 'high',
    cwe: 'CWE-79',
    owasp: 'A03:2021',
    scanner: 'sast',
    file: 'src/components/ui/RichText.tsx',
    line: 67,
    snippet: '<div dangerouslySetInnerHTML={{ __html: userContent }} />',
    description: 'Le contenu fourni par l\'utilisateur est rendu sans sanitisation HTML. Permet une attaque XSS stockée ou réfléchie.',
    remediation: 'Utilisez DOMPurify.sanitize() avant le rendu. Ex: dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }}',
    cvss: 7.4,
    epss: 0.34,
    kev: false,
    status: 'open',
    fingerprint: 'sha256:ghi789',
    detectedAt: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    id: 'f004',
    title: 'Dépendance avec CVE connue : lodash@4.17.15',
    severity: 'high',
    cwe: 'CWE-1321',
    owasp: 'A06:2021',
    scanner: 'sca',
    description: 'lodash@4.17.15 est vulnérable à CVE-2021-23337 (Prototype Pollution, CVSS 7.2). Une mise à jour vers >=4.17.21 est disponible.',
    remediation: 'Mettez à jour lodash vers la version 4.17.21 ou supérieure.',
    cvss: 7.2,
    epss: 0.45,
    kev: false,
    status: 'acknowledged',
    fingerprint: 'sha256:jkl012',
    detectedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'f005',
    title: 'Image Docker root : pas de USER défini',
    severity: 'medium',
    cwe: 'CWE-250',
    scanner: 'iac',
    file: 'Dockerfile',
    line: 1,
    description: 'Le Dockerfile ne définit pas d\'instruction USER. Le conteneur s\'exécute en tant que root, augmentant le blast radius en cas de compromission.',
    remediation: 'Ajoutez `USER nonroot` avant CMD/ENTRYPOINT. Créez d\'abord l\'utilisateur: RUN useradd -r nonroot',
    cvss: 5.3,
    epss: 0.12,
    kev: false,
    status: 'open',
    fingerprint: 'sha256:mno345',
    detectedAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'f006',
    title: 'SSRF via URL controllée par l\'utilisateur',
    severity: 'high',
    cwe: 'CWE-918',
    owasp: 'A10:2021',
    scanner: 'sast',
    file: 'server/skills/browser.ts',
    line: 234,
    description: 'L\'URL passée à fetch() provient directement de l\'input utilisateur sans validation. Permet un SSRF vers des services internes.',
    remediation: 'Validez et whitelistez les URLs autorisées. Bloquez les ranges IP internes (10.x, 172.16.x, 192.168.x, 127.x, ::1).',
    cvss: 8.1,
    epss: 0.56,
    kev: false,
    status: 'open',
    fingerprint: 'sha256:pqr678',
    detectedAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function SeverityBadge({ severity, size = 'md' }: { severity: Finding['severity']; size?: 'sm' | 'md' }) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md font-semibold"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.color}44`,
        fontSize: size === 'sm' ? '10px' : '11px',
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
      }}
    >
      <Icon size={size === 'sm' ? 9 : 10} />
      {cfg.label}
    </span>
  );
}

function SeverityStats({ findings }: { findings: Finding[] }) {
  const counts = useMemo(() => {
    const r = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach(f => { r[f.severity]++; });
    return r;
  }, [findings]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {(Object.entries(counts) as [Finding['severity'], number][]).map(([sev, count]) => {
        if (count === 0) return null;
        const cfg = SEVERITY_CONFIG[sev];
        return (
          <div key={sev} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cfg.color }} />
            <span className="text-xs font-semibold" style={{ color: cfg.color }}>{count}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function FindingRow({ finding, onClick }: { finding: Finding; onClick: () => void }) {
  const sc = SEVERITY_CONFIG[finding.severity];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-4 px-4 py-3 text-left border-b transition-all group"
      style={{
        borderColor: 'var(--border-base)',
        backgroundColor: 'transparent',
      }}
      whileHover={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      {/* Severity stripe */}
      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: sc.color }} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 mb-1">
          <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {finding.title}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {finding.status !== 'open' && STATUS_CONFIG[finding.status] && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border" style={{ borderColor: `${STATUS_CONFIG[finding.status].color}44`, color: STATUS_CONFIG[finding.status].color, backgroundColor: `${STATUS_CONFIG[finding.status].color}15` }}>
                {STATUS_CONFIG[finding.status].label}
              </span>
            )}
            {finding.kev && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#dc262620', color: '#dc2626', border: '1px solid #dc262640' }}>
                KEV
              </span>
            )}
            <SeverityBadge severity={finding.severity} size="sm" />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {finding.cwe && (
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{finding.cwe}</span>
          )}
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          >
            {SCANNER_LABELS[finding.scanner]}
          </span>
          {finding.file && (
            <span className="text-[10px] font-mono truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
              {finding.file}{finding.line ? `:${finding.line}` : ''}
            </span>
          )}
          {finding.cvss !== undefined && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              CVSS <span style={{ color: finding.cvss >= 9 ? '#dc2626' : finding.cvss >= 7 ? '#ea580c' : '#d97706', fontWeight: 600 }}>{finding.cvss.toFixed(1)}</span>
            </span>
          )}
          {finding.epss !== undefined && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              EPSS <span style={{ color: finding.epss > 0.5 ? '#dc2626' : finding.epss > 0.2 ? '#ea580c' : 'var(--text-secondary)', fontWeight: 600 }}>{(finding.epss * 100).toFixed(1)}%</span>
            </span>
          )}
        </div>
      </div>

      <div
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowRight size={14} />
      </div>
    </motion.button>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function FindingsView() {
  const navigate = useNavigate();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterScanner, setFilterScanner] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('open');
  const [sortBy, setSortBy] = useState<'severity' | 'cvss' | 'date'>('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/security/findings');
      const data = r.ok ? await r.json() : null;
      const list = Array.isArray(data) ? data : (data?.findings && Array.isArray(data.findings)) ? data.findings : null;
      if (list && list.length > 0) {
        const normalized = list.map((f: any) => ({
          id: f.id,
          title: f.title || f.ruleName || 'Vulnérabilité sans titre',
          severity: f.severity || 'medium',
          cwe: Array.isArray(f.cwe) ? f.cwe.join(', ') : f.cwe,
          owasp: Array.isArray(f.owasp) ? f.owasp.join(', ') : f.owasp,
          scanner: f.scanner || 'sast',
          file: f.location?.filePath || f.file || '',
          line: f.location?.startLine ?? f.line,
          snippet: f.location?.snippet || f.snippet,
          description: f.description || '',
          impact: f.impact,
          remediation: f.remediation,
          cvss: f.cvssScore ?? f.cvss,
          epss: f.epssScore ?? f.epss,
          kev: f.cisaKev ?? f.kev ?? false,
          status: f.status || 'open',
          fingerprint: f.fingerprint,
          detectedAt: f.firstSeen || f.detectedAt || new Date().toISOString(),
          taintFlow: f.taintFlow,
          references: f.references,
        }));
        setFindings(normalized);
      } else if (list && list.length === 0) {
        setFindings([]);
      } else {
        setFindings(MOCK_FINDINGS);
      }
    } catch {
      setFindings(MOCK_FINDINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFindings();
  }, [fetchFindings]);

  const handleExportSarif = useCallback(async () => {
    try {
      const res = await fetch('/api/security/sarif');
      if (!res.ok) throw new Error('Erreur SARIF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leanna-sarif-${Date.now()}.sarif.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export SARIF error:', e);
    }
  }, []);

  const SEVERITY_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

  const filtered = useMemo(() => {
    let f = findings;

    if (filterStatus !== 'all') f = f.filter(x => x.status === filterStatus);
    if (filterSeverity !== 'all') f = f.filter(x => x.severity === filterSeverity);
    if (filterScanner !== 'all') f = f.filter(x => x.scanner === filterScanner);
    if (search) {
      const q = search.toLowerCase();
      f = f.filter(x =>
        x.title.toLowerCase().includes(q) ||
        x.description.toLowerCase().includes(q) ||
        x.file?.toLowerCase().includes(q) ||
        x.cwe?.toLowerCase().includes(q)
      );
    }

    f = [...f].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'severity') cmp = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
      else if (sortBy === 'cvss') cmp = (b.cvss ?? 0) - (a.cvss ?? 0);
      else cmp = new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
      return sortDir === 'desc' ? cmp : -cmp;
    });

    return f;
  }, [findings, search, filterSeverity, filterScanner, filterStatus, sortBy, sortDir]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

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
            style={{ background: 'linear-gradient(135deg, #ef444430 0%, #ea580c30 100%)', border: '1px solid #ef444440' }}
          >
            <AlertTriangle size={18} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Vulnérabilités
              <span
                className="ml-2 text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                {filtered.length}
              </span>
            </h1>
            <SeverityStats findings={findings.filter(f => f.status === 'open')} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-panel)' }}
            onClick={fetchFindings}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Rafraîchir
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-panel)' }}
            onClick={handleExportSarif}
          >
            <Download size={13} /> Export SARIF
          </motion.button>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        {/* Search */}
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par titre, fichier, CWE…"
            className="flex-1 bg-transparent text-xs outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {search && (
            <button onClick={() => setSearch('')}>
              <X size={11} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border text-xs outline-none"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        >
          <option value="all">Tous les statuts</option>
          <option value="open">Ouverts</option>
          <option value="acknowledged">Reconnus</option>
          <option value="false_positive">Faux positifs</option>
          <option value="fixed">Corrigés</option>
        </select>

        {/* More filters toggle */}
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => setShowFilters(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium"
          style={{
            borderColor: showFilters ? 'var(--accent-primary)' : 'var(--border-base)',
            backgroundColor: showFilters ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
            color: showFilters ? 'var(--accent-primary)' : 'var(--text-secondary)',
          }}
        >
          <Filter size={12} />
          Filtres
          {showFilters ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </motion.button>
      </div>

      {/* Extended filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
          >
            <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Sévérité :</span>
                <select
                  value={filterSeverity}
                  onChange={e => setFilterSeverity(e.target.value)}
                  className="px-2 py-1 rounded-lg border text-xs outline-none"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <option value="all">Toutes</option>
                  {Object.entries(SEVERITY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Scanner :</span>
                <select
                  value={filterScanner}
                  onChange={e => setFilterScanner(e.target.value)}
                  className="px-2 py-1 rounded-lg border text-xs outline-none"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <option value="all">Tous</option>
                  {Object.entries(SCANNER_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Trier par :</span>
                {(['severity', 'cvss', 'date'] as const).map(col => (
                  <button
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="px-2 py-1 rounded-lg border text-xs flex items-center gap-1"
                    style={{
                      borderColor: sortBy === col ? 'var(--accent-primary)' : 'var(--border-base)',
                      backgroundColor: sortBy === col ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                      color: sortBy === col ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    {col === 'severity' ? 'Sévérité' : col === 'cvss' ? 'CVSS' : 'Date'}
                    {sortBy === col && (sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />)}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Findings list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement des vulnérabilités…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <CheckCircle2 size={32} style={{ color: '#22c55e' }} />
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {search || filterSeverity !== 'all' || filterScanner !== 'all' ? 'Aucun résultat' : 'Aucune vulnérabilité détectée'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {search ? 'Modifiez vos filtres de recherche' : 'Lancez un scan pour détecter des vulnérabilités'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            {filtered.map(finding => (
              <FindingRow
                key={finding.id}
                finding={finding}
                onClick={() => navigate(`/findings/${finding.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
