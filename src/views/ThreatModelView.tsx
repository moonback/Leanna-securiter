import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert, Loader2, RefreshCw, AlertCircle, Crosshair,
  Target, ChevronDown, ChevronRight, DoorOpen,
} from 'lucide-react';

// ─── Types (miroir de server/security/threat/ThreatModelEngine.ts) ─────────────

type StrideCategory =
  | 'spoofing' | 'tampering' | 'repudiation'
  | 'information_disclosure' | 'denial_of_service' | 'elevation_of_privilege';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface MitreTechnique { id: string; name: string; tactic: string; }

interface EntryPoint {
  id: string; kind: string; verb: string; route: string;
  sourceFile: string; parameterized: boolean;
}

interface Threat {
  id: string;
  stride: StrideCategory;
  title: string;
  description: string;
  severity: Severity;
  affects: string[];
  evidenceFindingIds: string[];
  mitre: MitreTechnique | null;
}

interface StrideCoverageRow {
  entryPointId: string;
  route: string;
  verb: string;
  covered: Record<StrideCategory, boolean>;
  threatCount: number;
}

interface ThreatModel {
  generatedAt: string;
  entryPoints: EntryPoint[];
  threats: Threat[];
  strideCoverage: StrideCoverageRow[];
  summary: {
    entryPointCount: number;
    threatCount: number;
    criticalThreats: number;
    mitreTechniqueCount: number;
  };
}

// ─── Config ────────────────────────────────────────────────────────────────────

const STRIDE_ORDER: StrideCategory[] = [
  'spoofing', 'tampering', 'repudiation',
  'information_disclosure', 'denial_of_service', 'elevation_of_privilege',
];

const STRIDE_CONFIG: Record<StrideCategory, { short: string; label: string; color: string }> = {
  spoofing:               { short: 'S', label: 'Spoofing',                color: '#3b82f6' },
  tampering:              { short: 'T', label: 'Tampering',               color: '#f59e0b' },
  repudiation:            { short: 'R', label: 'Repudiation',             color: '#8b5cf6' },
  information_disclosure: { short: 'I', label: 'Information Disclosure',  color: '#06b6d4' },
  denial_of_service:      { short: 'D', label: 'Denial of Service',       color: '#ef4444' },
  elevation_of_privilege: { short: 'E', label: 'Elevation of Privilege',  color: '#dc2626' },
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#6b7280',
};

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border px-4 py-3 flex-1 min-w-[120px]" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  );
}

function ThreatRow({ threat }: { threat: Threat }) {
  const [open, setOpen] = useState(false);
  const stride = STRIDE_CONFIG[threat.stride];
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-3 p-3 text-left"
      >
        {open ? <ChevronDown size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              : <ChevronRight size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${stride.color}22`, color: stride.color }}>
              {stride.label}
            </span>
            {threat.mitre && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: '#7c3aed22', color: '#a78bfa' }}>
                <Crosshair size={9} /> {threat.mitre.id}
              </span>
            )}
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${SEVERITY_COLOR[threat.severity]}22`, color: SEVERITY_COLOR[threat.severity] }}>
              {threat.severity}
            </span>
          </div>
          <p className="text-xs font-medium mt-1 truncate" style={{ color: 'var(--text-primary)' }}>{threat.title}</p>
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 border-t space-y-2" style={{ borderColor: 'var(--border-base)' }}>
              <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{threat.description}</p>
              {threat.mitre && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  MITRE ATT&CK : <span style={{ color: '#a78bfa' }}>{threat.mitre.id} — {threat.mitre.name}</span> ({threat.mitre.tactic})
                </p>
              )}
              {threat.affects.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Target size={11} style={{ color: 'var(--text-muted)' }} />
                  {threat.affects.map(a => (
                    <span key={a} className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{a}</span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main View ──────────────────────────────────────────────────────────────────

export default function ThreatModelView() {
  const [model, setModel] = useState<ThreatModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/security/threat-model');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { success: boolean; threatModel: ThreatModel };
      if (data.success) setModel(data.threatModel);
      else throw new Error('Réponse invalide');
    } catch {
      setError("Impossible de charger le modèle de menace. Lancez d'abord un scan pour générer des findings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const threatsSorted = model
    ? [...model.threats].sort((a, b) => {
        const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
        return order.indexOf(a.severity) - order.indexOf(b.severity);
      })
    : [];

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #dc262630 0%, #7c3aed30 100%)', border: '1px solid #dc262640' }}>
            <ShieldAlert size={18} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Modèle de menace STRIDE / MITRE</h1>
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              {loading ? <><Loader2 size={11} className="animate-spin" /> Génération…</>
                : model ? <>{model.summary.threatCount} menaces · {model.summary.mitreTechniqueCount} techniques MITRE · {model.summary.entryPointCount} points d'entrée</>
                : 'Aucun modèle'}
            </p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Régénérer
        </motion.button>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b flex-shrink-0" style={{ borderColor: '#ef444430', backgroundColor: '#ef444410' }}>
            <div className="px-4 py-2.5 flex items-center gap-2">
              <AlertCircle size={13} style={{ color: '#ef4444' }} />
              <p className="text-[11px] flex-1" style={{ color: '#ef4444' }}>{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {model && (
          <>
            {/* Stats */}
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Menaces" value={model.summary.threatCount} color="var(--text-primary)" />
              <StatCard label="Critiques" value={model.summary.criticalThreats} color="#dc2626" />
              <StatCard label="Techniques MITRE" value={model.summary.mitreTechniqueCount} color="#a78bfa" />
              <StatCard label="Points d'entrée" value={model.summary.entryPointCount} color="#3b82f6" />
            </div>

            {/* STRIDE coverage matrix */}
            <div>
              <h2 className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <DoorOpen size={13} /> Couverture STRIDE par point d'entrée
              </h2>
              {model.strideCoverage.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Aucun point d'entrée HTTP découvert.</p>
              ) : (
                <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--border-base)' }}>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-panel)' }}>
                        <th className="text-[10px] font-semibold px-3 py-2" style={{ color: 'var(--text-muted)' }}>Route</th>
                        {STRIDE_ORDER.map(s => (
                          <th key={s} className="text-[10px] font-bold px-2 py-2 text-center" title={STRIDE_CONFIG[s].label} style={{ color: STRIDE_CONFIG[s].color }}>
                            {STRIDE_CONFIG[s].short}
                          </th>
                        ))}
                        <th className="text-[10px] font-semibold px-3 py-2 text-center" style={{ color: 'var(--text-muted)' }}>#</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.strideCoverage.map(row => (
                        <tr key={row.entryPointId} className="border-t" style={{ borderColor: 'var(--border-base)' }}>
                          <td className="text-[11px] font-mono px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{row.verb}</span> {row.route}
                          </td>
                          {STRIDE_ORDER.map(s => (
                            <td key={s} className="px-2 py-1.5 text-center">
                              {row.covered[s]
                                ? <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STRIDE_CONFIG[s].color }} />
                                : <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--border-base)' }} />}
                            </td>
                          ))}
                          <td className="text-[11px] px-3 py-1.5 text-center" style={{ color: 'var(--text-muted)' }}>{row.threatCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Un point rempli = au moins une menace concrète couvre cette catégorie STRIDE pour cette route.
              </p>
            </div>

            {/* Threat list */}
            <div>
              <h2 className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Menaces identifiées</h2>
              {threatsSorted.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Aucune menace — aucun finding ouvert à modéliser.</p>
              ) : (
                <div className="space-y-2">
                  {threatsSorted.map(t => <ThreatRow key={t.id} threat={t} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
