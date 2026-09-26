import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers, Loader2, RefreshCw, AlertCircle, Flame, ShieldCheck,
  FileWarning, ChevronDown, ChevronRight, Wrench,
} from 'lucide-react';

// ─── Types (miroir de server/security/triage/TriageClusterEngine.ts) ───────────

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface TriageCluster {
  id: string;
  rootCauseKey: string;
  title: string;
  dominantCwe: string | null;
  dominantOwasp: string | null;
  maxSeverity: Severity;
  size: number;
  findingIds: string[];
  affectedFiles: string[];
  hasKev: boolean;
  hasConfirmed: boolean;
  maxEpss: number | null;
  riskScore: number;
  consolidatedRemediation: string;
}

interface TriageClusterReport {
  generatedAt: string;
  totalFindings: number;
  clusterCount: number;
  clusters: TriageCluster[];
  summary: { criticalClusters: number; topClusterId: string | null };
}

// ─── Config ────────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#6b7280',
};

function riskColor(score: number): string {
  if (score >= 80) return '#dc2626';
  if (score >= 60) return '#ea580c';
  if (score >= 40) return '#d97706';
  if (score >= 20) return '#2563eb';
  return '#6b7280';
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border px-4 py-3 flex-1 min-w-[120px]" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  );
}

function ClusterCard({ cluster, rank }: { cluster: TriageCluster; rank: number }) {
  const [open, setOpen] = useState(rank === 0);
  const rColor = riskColor(cluster.riskScore);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: `${rColor}44`, backgroundColor: 'var(--bg-panel)' }}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-start gap-3 p-4 text-left">
        {/* Risk gauge */}
        <div className="flex flex-col items-center flex-shrink-0" style={{ width: 46 }}>
          <span className="text-lg font-bold leading-none" style={{ color: rColor }}>{cluster.riskScore}</span>
          <span className="text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>RISQUE</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>#{rank + 1}</span>
            <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{cluster.title}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${SEVERITY_COLOR[cluster.maxSeverity]}22`, color: SEVERITY_COLOR[cluster.maxSeverity] }}>
              {cluster.maxSeverity}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
              {cluster.size} occurrence{cluster.size > 1 ? 's' : ''}
            </span>
            {cluster.dominantCwe && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: '#3b82f622', color: '#60a5fa' }}>{cluster.dominantCwe}</span>
            )}
            {cluster.hasKev && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: '#dc262622', color: '#f87171' }}>
                <Flame size={9} /> KEV
              </span>
            )}
            {cluster.hasConfirmed && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: '#16a34a22', color: '#4ade80' }}>
                <ShieldCheck size={9} /> Confirmé
              </span>
            )}
            {cluster.maxEpss !== null && (
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                EPSS {(cluster.maxEpss * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        {open ? <ChevronDown size={14} className="mt-1 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              : <ChevronRight size={14} className="mt-1 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-0 border-t space-y-3" style={{ borderColor: 'var(--border-base)' }}>
              <div className="mt-3">
                <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>CAUSE RACINE</p>
                <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{cluster.rootCauseKey}</p>
              </div>

              <div>
                <p className="text-[10px] font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <FileWarning size={10} /> FICHIERS TOUCHÉS ({cluster.affectedFiles.length})
                </p>
                <div className="space-y-0.5">
                  {cluster.affectedFiles.map(f => (
                    <p key={f} className="text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{f}</p>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border p-3" style={{ borderColor: '#22c55e33', backgroundColor: '#22c55e10' }}>
                <p className="text-[10px] font-semibold mb-1 flex items-center gap-1" style={{ color: '#22c55e' }}>
                  <Wrench size={10} /> REMÉDIATION CONSOLIDÉE
                </p>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{cluster.consolidatedRemediation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main View ──────────────────────────────────────────────────────────────────

export default function TriageView() {
  const [report, setReport] = useState<TriageClusterReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/security/triage/clusters');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as TriageClusterReport & { success: boolean };
      if (data.success) setReport(data);
      else throw new Error('Réponse invalide');
    } catch {
      setError("Impossible de charger le triage. Lancez d'abord un scan pour générer des findings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #ea580c30 0%, #dc262630 100%)', border: '1px solid #ea580c40' }}>
            <Layers size={18} style={{ color: '#ea580c' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Triage par cause racine</h1>
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              {loading ? <><Loader2 size={11} className="animate-spin" /> Regroupement…</>
                : report ? <>{report.clusterCount} grappes · {report.totalFindings} findings · {report.summary.criticalClusters} à risque critique</>
                : 'Aucun triage'}
            </p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rafraîchir
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
        {report && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Grappes" value={report.clusterCount} color="var(--text-primary)" />
              <StatCard label="Risque critique (≥80)" value={report.summary.criticalClusters} color="#dc2626" />
              <StatCard label="Findings triés" value={report.totalFindings} color="#3b82f6" />
            </div>

            {report.clusters.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-3">
                <Layers size={24} style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucune grappe — aucun finding ouvert à trier.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {report.clusters.map((c, i) => <ClusterCard key={c.id} cluster={c} rank={i} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
