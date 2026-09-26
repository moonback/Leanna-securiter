import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, AlertTriangle, AlertCircle, Info, ExternalLink,
  CheckCircle2, Copy, Loader2, Eye, BookOpen, Wrench, TrendingUp, GitBranch
} from 'lucide-react';
import type { Finding } from './FindingsView.js';

// ─── Mock detail (replaced by real API) ───────────────────────────────────────

const MOCK_FINDING: Finding = {
  id: 'f001',
  title: 'Injection SQL via paramètre non validé',
  severity: 'critical',
  cwe: 'CWE-89',
  owasp: 'A03:2021 — Injection',
  scanner: 'sast',
  file: 'server/routes/api.ts',
  line: 142,
  snippet: `// server/routes/api.ts:140-145
router.get('/user/:id', async (req, res) => {
  // ⚠️ VULNERABLE: user-controlled input directly in SQL
  const result = await db.query(\`SELECT * FROM users WHERE id = \${req.params.id}\`);
  res.json(result.rows);
});`,
  description: `La valeur **req.params.id** est directement interpolée dans une requête SQL sans aucune validation ni paramétrage.

Un attaquant peut forger une URL telle que \`/user/1 OR 1=1\` pour exfiltrer toutes les données de la table users, ou \`/user/1; DROP TABLE users\` pour détruire la base de données.

**Chemin de taint :**
\`req.params.id\` (source non validée) → interpolation dans template string → \`db.query()\` (sink SQL)`,
  remediation: `**Correction recommandée :** Utilisez des requêtes paramétrées :

\`\`\`typescript
// ✅ SAFE: parameterized query
const result = await db.query(
  'SELECT * FROM users WHERE id = $1',
  [req.params.id]
);
\`\`\`

Ou validez/castez le paramètre si l'ID est un entier :

\`\`\`typescript
const id = parseInt(req.params.id, 10);
if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
\`\`\``,
  cvss: 9.8,
  epss: 0.87,
  kev: false,
  status: 'open',
  fingerprint: 'sha256:abc123def456',
  detectedAt: new Date(Date.now() - 3600000).toISOString(),
};

// ─── Severity config ───────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { label: 'Critique', color: '#dc2626', bg: '#dc262615', icon: AlertCircle },
  high: { label: 'Haute', color: '#ea580c', bg: '#ea580c15', icon: AlertTriangle },
  medium: { label: 'Moyenne', color: '#d97706', bg: '#d9770615', icon: AlertTriangle },
  low: { label: 'Faible', color: '#2563eb', bg: '#2563eb15', icon: Info },
  info: { label: 'Info', color: '#6b7280', bg: '#6b728015', icon: Info },
} as const;

const STATUS_OPTIONS = [
  { value: 'open', label: 'Ouvert', color: '#ef4444' },
  { value: 'acknowledged', label: 'Reconnu', color: '#f59e0b' },
  { value: 'false_positive', label: 'Faux positif', color: '#6b7280' },
  { value: 'fixed', label: 'Corrigé', color: '#22c55e' },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function CvssGauge({ score }: { score: number }) {
  const color = score >= 9 ? '#dc2626' : score >= 7 ? '#ea580c' : score >= 4 ? '#d97706' : '#22c55e';
  const label = score >= 9 ? 'Critique' : score >= 7 ? 'Haute' : score >= 4 ? 'Moyenne' : 'Faible';
  const pct = (score / 10) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>CVSS 3.1</span>
        <span className="text-sm font-bold" style={{ color }}>{score.toFixed(1)} — {label}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function EpssBar({ score }: { score: number }) {
  const pct = score * 100;
  const color = pct > 70 ? '#dc2626' : pct > 40 ? '#ea580c' : pct > 20 ? '#d97706' : '#22c55e';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>EPSS (exploitation 30j)</span>
        <span className="text-sm font-bold" style={{ color }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </div>
    </div>
  );
}

function CodeBlock({ code, language = 'typescript' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-base)' }}>
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] transition-colors"
          style={{ color: copied ? '#22c55e' : 'var(--text-muted)' }}
        >
          {copied ? <CheckCircle2 size={10} /> : <Copy size={10} />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre
        className="p-4 overflow-x-auto text-xs font-mono leading-relaxed"
        style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)', margin: 0 }}
      >
        {code}
      </pre>
    </div>
  );
}

function MarkdownSimple({ content }: { content: string }) {
  // Very lightweight markdown renderer for the detail view
  const lines = content.split('\n');
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (line.startsWith('```')) return null;
        if (line.startsWith('**')) {
          const text = line.replace(/\*\*/g, '');
          return <p key={i} className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{text}</p>;
        }
        if (line.startsWith('- ')) {
          return <li key={i} className="text-xs ml-3" style={{ color: 'var(--text-secondary)' }}>{line.slice(2)}</li>;
        }
        if (line.trim() === '') return <br key={i} />;
        return <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{line}</p>;
      })}
    </div>
  );
}

function TaintFlowVisualizer({
  taintFlow,
  file,
  line,
}: {
  taintFlow?: Finding['taintFlow'];
  file?: string;
  line?: number;
}) {
  if (!taintFlow || taintFlow.length === 0) {
    return (
      <div
        className="p-8 flex flex-col items-center justify-center gap-3 rounded-2xl border text-center"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
        >
          <TrendingUp size={22} style={{ color: 'var(--accent-primary)' }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Analyse de propagation Taint
        </p>
        <p className="text-xs max-w-md leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Cette vulnérabilité est localisée à l'emplacement{' '}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            {file ? `${file}:${line ?? ''}` : 'source'}
          </code>
          . Le moteur de Taint Tracking enregistre le chemin source-vers-sink dès qu'une propagation inter-variables est identifiée lors du scan SAST.
        </p>
      </div>
    );
  }

  const STEP_CONFIG = {
    source: { label: 'Source Entrée', color: '#3b82f6', bg: '#3b82f615' },
    propagation: { label: 'Propagation', color: '#f59e0b', bg: '#f59e0b15' },
    sanitizer: { label: 'Sanitizer / Filtre', color: '#22c55e', bg: '#22c55e15' },
    sink: { label: 'Sink Vulnérable', color: '#ef4444', bg: '#ef444415' },
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Chemin de flux de données teinté ({taintFlow.length} étapes)
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Traçabilité de l'entrée non sécurisée jusqu'au point d'exécution critique.
          </p>
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#ef444415', color: '#ef4444', border: '1px solid #ef444440' }}
        >
          Flux Taint Détecté
        </span>
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-4 before:bottom-4 before:w-0.5 before:bg-[var(--border-base)]">
        {taintFlow.map((step, idx) => {
          const cfg = STEP_CONFIG[step.kind] || STEP_CONFIG.propagation;
          return (
            <motion.div
              key={step.step || idx}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="relative rounded-xl border p-4 shadow-sm"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
            >
              <div
                className="absolute -left-6 top-4 w-3.5 h-3.5 rounded-full border-2 -translate-x-1/2"
                style={{ backgroundColor: cfg.color, borderColor: 'var(--bg-base)' }}
              />

              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
                  >
                    Étape {step.step || idx + 1} · {cfg.label}
                  </span>
                  {step.variableName && (
                    <code
                      className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--accent-primary)' }}
                    >
                      ${step.variableName}
                    </code>
                  )}
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {step.filePath}:{step.line}
                </span>
              </div>

              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {step.description}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function FindingDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [finding, setFinding] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'code' | 'remediation' | 'taint' | 'audit'>('overview');
  const [status, setStatus] = useState<Finding['status']>('open');
  const [auditTrail, setAuditTrail] = useState<any[]>([]);

  // Triage rationale modal / inline
  const [triageTargetStatus, setTriageTargetStatus] = useState<Finding['status'] | null>(null);
  const [triageRationale, setTriageRationale] = useState('');
  const [triageSubmitting, setTriageSubmitting] = useState(false);

  const loadFinding = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/security/findings/${id}`);
      const data = res.ok ? await res.json() : null;
      const raw = data?.finding ?? data;

      if (raw && (raw.id || raw.title)) {
        const normalized: Finding = {
          id: raw.id,
          title: raw.title || raw.ruleName || 'Vulnérabilité sans titre',
          severity: raw.severity || 'medium',
          cwe: Array.isArray(raw.cwe) ? raw.cwe.join(', ') : raw.cwe,
          owasp: Array.isArray(raw.owasp) ? raw.owasp.join(', ') : raw.owasp,
          scanner: raw.scanner || 'sast',
          file: raw.location?.filePath || raw.file || '',
          line: raw.location?.startLine ?? raw.line,
          snippet: raw.location?.snippet || raw.snippet,
          description: raw.description || '',
          impact: raw.impact,
          remediation: raw.remediation,
          suggestedPatch: raw.suggestedPatch,
          cvss: raw.cvssScore ?? raw.cvss,
          epss: raw.epssScore ?? raw.epss,
          kev: raw.cisaKev ?? raw.kev ?? false,
          status: raw.status || 'open',
          fingerprint: raw.fingerprint,
          detectedAt: raw.firstSeen || raw.detectedAt || new Date().toISOString(),
          taintFlow: raw.taintFlow,
          references: raw.references,
        };
        setFinding(normalized);
        setStatus(normalized.status);
      } else {
        setFinding(MOCK_FINDING);
        setStatus(MOCK_FINDING.status);
      }
    } catch {
      setFinding(MOCK_FINDING);
      setStatus(MOCK_FINDING.status);
    } finally {
      setLoading(false);
    }
  };

  const loadAudit = async () => {
    try {
      const res = await fetch(`/api/security/triage-audit/${id}`);
      if (res.ok) {
        const data = await res.json();
        setAuditTrail(Array.isArray(data) ? data : data?.auditTrail ?? []);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadFinding();
    loadAudit();
  }, [id]);

  const handleOpenTriage = (newStatus: Finding['status']) => {
    if (newStatus === status) return;
    setTriageTargetStatus(newStatus);
    setTriageRationale('');
  };

  const handleConfirmTriage = async () => {
    if (!triageTargetStatus) return;
    setTriageSubmitting(true);
    try {
      await fetch(`/api/security/findings/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: triageTargetStatus,
          rationale: triageRationale.trim() || undefined,
          author: 'Analyste Sécurité',
        }),
      });
      setStatus(triageTargetStatus);
      if (finding) setFinding({ ...finding, status: triageTargetStatus });
      setTriageTargetStatus(null);
      await loadAudit();
    } catch (e) {
      console.error('Triage status update failed:', e);
    } finally {
      setTriageSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: 'var(--bg-base)' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ backgroundColor: 'var(--bg-base)' }}>
        <Info size={32} style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Vulnérabilité introuvable</p>
        <button onClick={() => navigate('/findings')} className="text-xs" style={{ color: 'var(--accent-primary)' }}>← Retour</button>
      </div>
    );
  }

  const sc = SEVERITY_CONFIG[finding.severity];
  const Icon = sc.icon;
  const TABS = [
    { id: 'overview', label: 'Vue d\'ensemble', icon: Eye },
    { id: 'code', label: 'Code source', icon: GitBranch },
    { id: 'remediation', label: 'Remédiation & Patch', icon: Wrench },
    { id: 'taint', label: 'Flux Taint', icon: TrendingUp },
    { id: 'audit', label: 'Audit Triage', icon: BookOpen },
  ] as const;

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* Header */}
      <div
        className="flex items-start gap-4 px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <button
          onClick={() => navigate('/findings')}
          className="flex items-center gap-1.5 text-xs mt-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={13} /> Retour
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 mb-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: sc.bg, border: `1px solid ${sc.color}44` }}
            >
              <Icon size={15} style={{ color: sc.color }} />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                {finding.title}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: sc.bg, color: sc.color, border: `1px solid ${sc.color}44` }}
                >
                  {sc.label}
                </span>
                {finding.cwe && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                    {finding.cwe}
                  </span>
                )}
                {finding.owasp && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed33' }}>
                    {finding.owasp}
                  </span>
                )}
                {finding.kev && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#dc262620', color: '#dc2626', border: '1px solid #dc262640' }}>
                    🔴 CISA KEV
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status changer */}
          <div className="flex items-center gap-2 ml-11">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Statut :</span>
            <div className="flex gap-1">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleOpenTriage(opt.value as Finding['status'])}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-all cursor-pointer"
                  style={{
                    backgroundColor: status === opt.value ? `${opt.color}20` : 'var(--bg-secondary)',
                    color: status === opt.value ? opt.color : 'var(--text-muted)',
                    border: status === opt.value ? `1px solid ${opt.color}44` : '1px solid transparent',
                    fontWeight: status === opt.value ? 600 : 400,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Triage Rationale Dialog Banner */}
          <AnimatePresence>
            {triageTargetStatus && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 ml-11 p-3 rounded-xl border space-y-2 overflow-hidden"
                style={{ borderColor: 'var(--accent-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Changement de statut vers « {STATUS_OPTIONS.find(o => o.value === triageTargetStatus)?.label} »
                  </span>
                  <button
                    onClick={() => setTriageTargetStatus(null)}
                    className="text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Annuler
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Justification du triage (ex: Faux positif vérifié, Corrigé via PR #42...)"
                  value={triageRationale}
                  onChange={(e) => setTriageRationale(e.target.value)}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setTriageTargetStatus(null)}
                    className="px-2.5 py-1 text-xs rounded-lg border"
                    style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleConfirmTriage}
                    disabled={triageSubmitting}
                    className="px-3 py-1 text-xs font-medium rounded-lg flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
                  >
                    {triageSubmitting && <Loader2 size={11} className="animate-spin" />}
                    Confirmer le statut
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        {TABS.map(tab => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all cursor-pointer"
              style={{
                borderBottomColor: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              <TabIcon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="p-6 grid grid-cols-3 gap-6">
            {/* Left: description */}
            <div className="col-span-2 space-y-6">
              <section>
                <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Description</h2>
                <div
                  className="rounded-xl border p-4"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                >
                  <MarkdownSimple content={finding.description} />
                </div>
              </section>

              {finding.impact && (
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Impact Sécurité</h2>
                  <div
                    className="rounded-xl border p-4"
                    style={{ borderColor: '#ef444430', backgroundColor: '#ef444408' }}
                  >
                    <MarkdownSimple content={finding.impact} />
                  </div>
                </section>
              )}

              {finding.snippet && (
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                    Extrait vulnérable
                    {finding.file && (
                      <span className="ml-2 normal-case font-mono font-normal text-[10px]" style={{ color: 'var(--accent-primary)' }}>
                        {finding.file}:{finding.line}
                      </span>
                    )}
                  </h2>
                  <CodeBlock code={finding.snippet} />
                </section>
              )}
            </div>

            {/* Right: scores & metadata */}
            <div className="space-y-4">
              {finding.cvss !== undefined && (
                <div
                  className="rounded-xl border p-4 space-y-4"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                >
                  <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Scoring</h2>
                  <CvssGauge score={finding.cvss} />
                  {finding.epss !== undefined && <EpssBar score={finding.epss} />}
                </div>
              )}

              <div
                className="rounded-xl border p-4 space-y-3"
                style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
              >
                <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Métadonnées</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Scanner</span>
                    <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {finding.scanner.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Détecté le</span>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>
                      {new Date(finding.detectedAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Fingerprint</span>
                    <span className="text-[10px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
                      {finding.fingerprint}
                    </span>
                  </div>
                </div>
              </div>

              {finding.owasp && (
                <a
                  href={`https://owasp.org/Top10/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border p-3 transition-all"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)' }}
                >
                  <div className="flex items-center gap-2">
                    <BookOpen size={13} style={{ color: '#7c3aed' }} />
                    <span className="text-xs font-medium">OWASP Top 10</span>
                  </div>
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div className="p-6 space-y-6">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Visualisation du code vulnérable analysé par le scanner.
            </p>
            {finding.snippet && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                  Code vulnérable — {finding.file}:{finding.line}
                </h2>
                <CodeBlock code={finding.snippet} />
              </section>
            )}
          </div>
        )}

        {activeTab === 'remediation' && (
          <div className="p-6 space-y-6 max-w-4xl">
            {finding.remediation ? (
              <>
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Correction recommandée</h2>
                  <div className="rounded-xl border p-4" style={{ borderColor: '#22c55e44', backgroundColor: '#22c55e08' }}>
                    <MarkdownSimple content={finding.remediation} />
                  </div>
                </section>

                {finding.suggestedPatch && (
                  <section>
                    <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                      Patch suggéré (Diff)
                    </h2>
                    <CodeBlock code={finding.suggestedPatch} language="diff" />
                  </section>
                )}

                {finding.cwe && (
                  <section>
                    <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Références</h2>
                    <div className="space-y-2">
                      <a
                        href={`https://cwe.mitre.org/data/definitions/${finding.cwe.replace('CWE-', '')}.html`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs transition-colors"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        <ExternalLink size={11} /> {finding.cwe} — MITRE CWE
                      </a>
                      {finding.owasp && (
                        <a
                          href="https://owasp.org/Top10/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs transition-colors"
                          style={{ color: 'var(--accent-primary)' }}
                        >
                          <ExternalLink size={11} /> {finding.owasp} — OWASP Top 10
                        </a>
                      )}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucune remédiation disponible.</p>
            )}
          </div>
        )}

        {activeTab === 'taint' && (
          <div className="p-6">
            <TaintFlowVisualizer
              taintFlow={finding.taintFlow}
              file={finding.file}
              line={finding.line}
            />
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="p-6 space-y-4 max-w-3xl">
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Journal d'audit de triage ({auditTrail.length} entrées)
            </h2>
            {auditTrail.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Aucune modification de statut enregistrée pour cette vulnérabilité.
              </p>
            ) : (
              <div className="space-y-3">
                {auditTrail.map((entry, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border p-3 text-xs space-y-1"
                    style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                  >
                    <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      <span>{new Date(entry.timestamp).toLocaleString('fr-FR')}</span>
                      <span>par {entry.author || 'Analyste'}</span>
                    </div>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Statut : {entry.previousStatus} → {entry.newStatus}
                    </p>
                    {entry.rationale && (
                      <p className="text-[11px] italic" style={{ color: 'var(--text-secondary)' }}>
                        « {entry.rationale} »
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
