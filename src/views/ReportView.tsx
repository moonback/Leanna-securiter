import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Download, CheckCircle2, Loader2, Settings2,
  FileCode, FileJson, Globe, ChevronDown, ChevronRight
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportConfig {
  format: 'sarif' | 'html' | 'pdf' | 'json' | 'markdown';
  includeExecutiveSummary: boolean;
  includeRemediation: boolean;
  includePoC: boolean;
  includeSbom: boolean;
  severityThreshold: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  author: string;
  targetApp: string;
}

// ─── Format config ─────────────────────────────────────────────────────────────

const FORMAT_META = [
  {
    id: 'sarif',
    label: 'SARIF 2.1.0',
    desc: 'Standard output compatible GitHub Code Scanning, VS Code, DefectDojo',
    icon: FileCode,
    color: '#3b82f6',
    badge: 'Recommandé',
  },
  {
    id: 'html',
    label: 'Rapport HTML',
    desc: 'Rapport complet avec mise en forme, graphiques et code snippets',
    icon: Globe,
    color: '#f97316',
    badge: null,
  },
  {
    id: 'pdf',
    label: 'Rapport PDF',
    desc: 'Format imprimable pour livraison au client ou archivage',
    icon: FileText,
    color: '#ef4444',
    badge: null,
  },
  {
    id: 'json',
    label: 'JSON brut',
    desc: 'Export des findings au format JSON pour intégration pipeline',
    icon: FileJson,
    color: '#22c55e',
    badge: null,
  },
];

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critique uniquement', color: '#dc2626' },
  { value: 'high', label: 'Haute et plus', color: '#ea580c' },
  { value: 'medium', label: 'Moyenne et plus', color: '#d97706' },
  { value: 'low', label: 'Faible et plus', color: '#2563eb' },
  { value: 'info', label: 'Toutes', color: '#6b7280' },
];

// ─── Default report preview stats (overridden by API) ─────────────────────────

const DEFAULT_PREVIEW_STATS = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  total: 0,
  scanners: ['SAST', 'SCA', 'Secrets', 'IaC'],
  duration: '< 1s',
  scannedFiles: 0,
  lastScan: 'Aucun scan récent',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormatCard({
  format,
  selected,
  onSelect,
}: {
  format: typeof FORMAT_META[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = format.icon;
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      className="flex items-start gap-3 p-4 rounded-xl border text-left w-full transition-all cursor-pointer"
      style={{
        borderColor: selected ? format.color : 'var(--border-base)',
        backgroundColor: selected
          ? `color-mix(in srgb, ${format.color} 8%, var(--bg-panel))`
          : 'var(--bg-secondary)',
      }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${format.color}22`, border: `1px solid ${format.color}44` }}
      >
        <Icon size={16} style={{ color: format.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{format.label}</span>
          {format.badge && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${format.color}22`, color: format.color }}
            >
              {format.badge}
            </span>
          )}
          {selected && <CheckCircle2 size={12} style={{ color: format.color, marginLeft: 'auto' }} />}
        </div>
        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {format.desc}
        </p>
      </div>
    </motion.button>
  );
}

function Toggle({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        {desc && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors cursor-pointer"
        style={{ backgroundColor: value ? 'var(--accent-primary)' : 'var(--border-base)' }}
      >
        <motion.div
          className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
          animate={{ x: value ? 20 : 4 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function ReportView() {
  const [config, setConfig] = useState<ReportConfig>({
    format: 'sarif',
    includeExecutiveSummary: true,
    includeRemediation: true,
    includePoC: false,
    includeSbom: true,
    severityThreshold: 'medium',
    title: 'Rapport d\'audit de sécurité',
    author: '',
    targetApp: '',
  });
  const [previewStats, setPreviewStats] = useState(DEFAULT_PREVIEW_STATS);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ url: string; filename: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetch('/api/security/stats')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setPreviewStats(prev => ({
            ...prev,
            critical: data.critical ?? 0,
            high: data.high ?? 0,
            medium: data.medium ?? 0,
            low: data.low ?? 0,
            total: data.total ?? 0,
            lastScan: new Date().toLocaleString('fr-FR'),
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGenerated(null);

    try {
      const res = await fetch('/api/security/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        const data = await res.json();
        let contentStr = '';
        if (typeof data.content === 'string') {
          contentStr = data.content;
        } else if (data.content) {
          contentStr = JSON.stringify(data.content, null, 2);
        } else {
          contentStr = JSON.stringify(data, null, 2);
        }

        const mime = data.mimeType || (config.format === 'html' ? 'text/html' : config.format === 'markdown' ? 'text/markdown' : 'application/json');
        const blob = new Blob([contentStr], { type: mime });
        const url = URL.createObjectURL(blob);
        setGenerated({
          url,
          filename: data.filename || `security-report-${Date.now()}.${config.format === 'sarif' ? 'sarif.json' : config.format}`,
        });
      }
    } catch (err) {
      console.error('Report generation error:', err);
    } finally {
      setGenerating(false);
    }
  }, [config]);

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
            style={{ background: 'linear-gradient(135deg, #22c55e30 0%, #3b82f630 100%)', border: '1px solid #22c55e40' }}
          >
            <FileText size={18} style={{ color: '#22c55e' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Génération de rapport
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              SARIF · HTML · PDF · JSON — conforme OWASP/CVSS/EPSS
            </p>
          </div>
        </div>
        <motion.button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: generating ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #22c55e 0%, #3b82f6 100%)',
            color: generating ? 'var(--text-muted)' : '#fff',
            cursor: generating ? 'not-allowed' : 'pointer',
          }}
          whileHover={!generating ? { scale: 1.03, y: -1 } : {}}
          whileTap={!generating ? { scale: 0.97 } : {}}
        >
          {generating ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {generating ? 'Génération…' : 'Générer le rapport'}
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Generated report */}
        <AnimatePresence>
          {generated && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ borderColor: '#22c55e55', backgroundColor: '#22c55e10' }}
            >
              <CheckCircle2 size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
              <div className="flex-1">
                <p className="text-xs font-semibold" style={{ color: '#22c55e' }}>Rapport généré avec succès</p>
                <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{generated.filename}</p>
              </div>
              <a
                href={generated.url}
                download={generated.filename}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                style={{ backgroundColor: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}
              >
                <Download size={12} /> Télécharger
              </a>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scan preview */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Dernier scan disponible
          </h2>
          <div
            className="rounded-xl border p-4 grid grid-cols-4 gap-4"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
          >
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Critique</p>
              <p className="text-lg font-bold" style={{ color: '#dc2626' }}>{previewStats.critical}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Haute</p>
              <p className="text-lg font-bold" style={{ color: '#ea580c' }}>{previewStats.high}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Moyenne</p>
              <p className="text-lg font-bold" style={{ color: '#d97706' }}>{previewStats.medium}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Total</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{previewStats.total}</p>
            </div>
            <div className="col-span-4 flex items-center gap-4 pt-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Scanners : {previewStats.scanners.join(', ')}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {previewStats.scannedFiles} fichiers · {previewStats.duration}
              </span>
              <span className="text-[11px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                {previewStats.lastScan}
              </span>
            </div>
          </div>
        </section>

        {/* Format */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Format de sortie
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {FORMAT_META.map(fmt => (
              <FormatCard
                key={fmt.id}
                format={fmt}
                selected={config.format === fmt.id}
                onSelect={() => setConfig(c => ({ ...c, format: fmt.id as ReportConfig['format'] }))}
              />
            ))}
          </div>
        </section>

        {/* Severity threshold */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Sévérité minimale incluse
          </h2>
          <div className="flex gap-2 flex-wrap">
            {SEVERITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setConfig(c => ({ ...c, severityThreshold: opt.value as ReportConfig['severityThreshold'] }))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                style={{
                  borderColor: config.severityThreshold === opt.value ? opt.color : 'var(--border-base)',
                  backgroundColor: config.severityThreshold === opt.value ? `${opt.color}18` : 'var(--bg-secondary)',
                  color: config.severityThreshold === opt.value ? opt.color : 'var(--text-muted)',
                  fontWeight: config.severityThreshold === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Content options */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Contenu du rapport
          </h2>
          <div
            className="rounded-xl border p-4 space-y-4"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
          >
            <Toggle
              label="Résumé exécutif"
              desc="Vue d'ensemble pour les décideurs (non-techniques)"
              value={config.includeExecutiveSummary}
              onChange={v => setConfig(c => ({ ...c, includeExecutiveSummary: v }))}
            />
            <div className="h-px" style={{ backgroundColor: 'var(--border-base)' }} />
            <Toggle
              label="Remédiation détaillée"
              desc="Patches suggérés et références CWE pour chaque vulnérabilité"
              value={config.includeRemediation}
              onChange={v => setConfig(c => ({ ...c, includeRemediation: v }))}
            />
            <div className="h-px" style={{ backgroundColor: 'var(--border-base)' }} />
            <Toggle
              label="SBOM (Software Bill of Materials)"
              desc="Inventaire des dépendances au format CycloneDX 1.5"
              value={config.includeSbom}
              onChange={v => setConfig(c => ({ ...c, includeSbom: v }))}
            />
            <div className="h-px" style={{ backgroundColor: 'var(--border-base)' }} />
            <Toggle
              label="PoC démonstratifs"
              desc="Preuves de concept non-exploitables (requiert révision manuelle)"
              value={config.includePoC}
              onChange={v => setConfig(c => ({ ...c, includePoC: v }))}
            />
          </div>
        </section>

        {/* Advanced */}
        <section>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-2 text-xs font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Settings2 size={13} />
            Métadonnées du rapport
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className="mt-3 p-4 rounded-xl border space-y-3"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                >
                  {[
                    { key: 'title', label: 'Titre du rapport', placeholder: 'Rapport d\'audit de sécurité' },
                    { key: 'author', label: 'Auteur / Organisation', placeholder: 'Votre nom' },
                    { key: 'targetApp', label: 'Application cible', placeholder: 'Nom de l\'application' },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        {field.label}
                      </label>
                      <input
                        type="text"
                        value={(config as any)[field.key]}
                        onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                        style={{
                          borderColor: 'var(--border-base)',
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
