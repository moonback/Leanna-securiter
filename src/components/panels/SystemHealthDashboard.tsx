import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Server, Cpu, MemoryStick, CheckCircle2, AlertCircle, XCircle,
  RefreshCw, Clock, ShieldCheck, Gauge, Circle, Loader2, Puzzle,
  Bot, Zap,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditReport {
  platform: string;
  release: string;
  arch: string;
  cpus: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  uptimeHours: number;
  nodeVersion: string;
  activeSkills: string[];
  supabaseOk: boolean;
  geminiOk: boolean;
  openrouterOk: boolean;
  telegramOk: boolean;
  telegramConfigured: boolean;
  mcpOk: boolean;
  mcpConnected: number;
  mcpTotal: number;
  projectRoot: string;
  generatedAt: string;
}

type ServiceName = 'gemini' | 'supabase' | 'openrouter' | 'telegram' | 'mcp';

interface ServiceHealth {
  name: ServiceName;
  label: string;
  ok: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} Go`;
  return `${Math.round(mb)} Mo`;
}

function formatUptime(hours: number): string {
  const days = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  if (days > 0) return `${days}j ${h}h`;
  return `${h}h`;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 50) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function memColor(pct: number): string {
  if (pct > 85) return 'var(--color-error)';
  if (pct > 60) return 'var(--color-warning)';
  return 'var(--color-success)';
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, color, sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-2xl p-3.5 flex flex-col gap-2"
      style={{
        backgroundColor: 'color-mix(in srgb, ' + color + ' 7%, transparent)',
        border: '1px solid color-mix(in srgb, ' + color + ' 13%, transparent)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, ' + color + ' 10%, transparent)', color }}
        >
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-xl font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
          {value}
        </span>
        {sub && <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ─── Service Badge ───────────────────────────────────────────────────────────

function ServiceBadge({ name, label, ok }: ServiceHealth) {
  const color = ok ? 'var(--color-success)' : 'var(--color-error)';
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{
        backgroundColor: `${color}0D`,
        border: `1px solid ${color}22`,
      }}
    >
      {ok
        ? <CheckCircle2 size={14} style={{ color }} />
        : <XCircle size={14} style={{ color }} />
      }
      <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
      <span
        className="text-xs font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {ok ? 'OK' : 'DOWN'}
      </span>
    </div>
  );
}

// ─── Health Score Ring ───────────────────────────────────────────────────────

function HealthScoreRing({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          background: `conic-gradient(${color} ${score * 3.6}deg, var(--border-base) ${score * 3.6}deg)`,
        }}
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <span
            className="text-2xl font-bold font-mono"
            style={{ color }}
          >
            {score}
          </span>
        </div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Santé globale
      </span>
    </div>
  );
}

// ─── MemBar ──────────────────────────────────────────────────────────────────

function MemBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const color = memColor(pct);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
          {formatBytes(used)} / {formatBytes(total)}
        </span>
        <span className="text-xs font-mono font-bold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-base)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── System Health Dashboard ─────────────────────────────────────────────────

interface SystemHealthDashboardProps {
  onClose?: () => void;
}

export function SystemHealthDashboard({ onClose }: SystemHealthDashboardProps) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/audit');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(json.error || 'Erreur API');
      setReport(json.report as AuditReport);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Derived values
  const services: ServiceHealth[] = useMemo(() => {
    const list: ServiceHealth[] = [
      { name: 'gemini', label: 'Gemini (IA)', ok: report?.geminiOk ?? false },
      { name: 'supabase', label: 'Supabase (DB)', ok: report?.supabaseOk ?? false },
      { name: 'openrouter', label: 'OpenRouter (LLM)', ok: report?.openrouterOk ?? false },
    ];
    // Telegram et MCP ne sont affichés que s'ils sont réellement configurés,
    // pour éviter d'afficher des services "DOWN" que l'utilisateur n'a jamais activés.
    if (report?.telegramConfigured) {
      list.push({ name: 'telegram', label: 'Telegram (Bot)', ok: report.telegramOk });
    }
    if (report && report.mcpTotal > 0) {
      list.push({ name: 'mcp', label: `MCP (${report.mcpConnected}/${report.mcpTotal})`, ok: report.mcpOk });
    }
    return list;
  }, [report]);

  const serviceScore = report
    ? (services.filter(s => s.ok).length / services.length) * 50
    : 0;
  const memPct = report
    ? ((report.totalMemoryMB - report.freeMemoryMB) / report.totalMemoryMB) * 100
    : 0;
  const resourceScore = report ? Math.max(0, 50 - memPct * 0.3) : 0;
  const healthScore = report ? Math.round(serviceScore + resourceScore) : 0;

  const servicesOk = services.filter(s => s.ok).length;

  return (
    <div
      className="flex flex-col w-full h-full min-h-0 border-l"
      style={{
        width: 420,
        minWidth: 320,
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      {/* ── Header ────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-base)',
          backgroundColor: 'var(--bg-panel-alt)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-7 h-7 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)', color: 'var(--color-success)' }}
          >
            <Activity size={14} />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              Santé Système
            </span>
            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              {report ? relativeTime(report.generatedAt) : 'Chargement…'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-white/5 transition flex items-center justify-center"
            title="Rafraîchir"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--text-muted)' }} />
          </button>
          <label
            className="flex items-center gap-1.5 px-2 h-7 rounded-lg text-xs cursor-pointer"
            style={{
              backgroundColor: autoRefresh ? 'color-mix(in srgb, var(--accent-secondary) 9%, transparent)' : 'transparent',
              border: `1px solid ${autoRefresh ? 'color-mix(in srgb, var(--accent-secondary) 20%, transparent)' : 'var(--border-base)'}`,
              color: autoRefresh ? 'var(--accent-secondary)' : 'var(--text-muted)',
            }}
            title="Actualisation auto toutes les 30s"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: autoRefresh ? 'var(--accent-secondary)' : 'var(--text-dimmed)' }}
            />
            Auto
            <input
              type="checkbox"
              className="hidden"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
          </label>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/5 transition flex items-center justify-center"
              title="Fermer"
            >
              <span className="text-sm leading-none" style={{ color: 'var(--text-dimmed)' }}>✕</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-dimmed)' }} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Analyse du système…
            </span>
          </div>
        )}

        {error && !loading && (
          <div
            className="p-4 rounded-2xl"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)', color: 'var(--color-error)' }}
          >
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Erreur de chargement</p>
                <p className="text-sm mt-1 opacity-90">{error}</p>
              </div>
            </div>
          </div>
        )}

        {report && !loading && (
          <>
            {/* Health Score */}
            <div className="flex justify-center py-2">
              <HealthScoreRing score={healthScore} />
            </div>

            {/* OS & Runtime */}
            <div
              className="rounded-2xl p-3.5 space-y-2"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-primary) 7%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-primary) 13%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Server size={12} style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                  Système & Runtime
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Plateforme</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{report.platform}</p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Architecture</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{report.arch}</p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Kernel</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{report.release}</p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Node.js</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{report.nodeVersion}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Racine du projet</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }} title={report.projectRoot}>
                    {report.projectRoot}
                  </p>
                </div>
              </div>
            </div>

            {/* CPU & RAM */}
            <div
              className="rounded-2xl p-3.5 space-y-2"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 7%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-warning) 13%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={12} style={{ color: 'var(--color-warning)' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-warning)' }}>
                  Ressources
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  icon={<Cpu size={14} />}
                  label="CPU"
                  value={`${report.cpus} cœurs`}
                  color="var(--color-warning)"
                />
                <StatCard
                  icon={<Clock size={14} />}
                  label="Uptime"
                  value={formatUptime(report.uptimeHours)}
                  color="var(--accent-secondary)"
                />
              </div>
              <div
                className="rounded-xl p-3"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 6%, transparent)' }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <MemoryStick size={12} style={{ color: 'var(--text-dimmed)' }} />
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Mémoire vive
                  </span>
                </div>
                <MemBar
                  used={report.totalMemoryMB - report.freeMemoryMB}
                  total={report.totalMemoryMB}
                />
              </div>
            </div>

            {/* Services */}
            <div
              className="rounded-2xl p-3.5 space-y-2"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-secondary) 3%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-secondary) 9%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Zap size={12} style={{ color: 'var(--accent-secondary)' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-secondary)' }}>
                  Services ({servicesOk}/{services.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {services.map(svc => (
                  <ServiceBadge key={svc.name} {...svc} />
                ))}
              </div>
            </div>

            {/* Active Skills */}
            {report.activeSkills.length > 0 && (
              <div
                className="rounded-2xl p-3.5 space-y-2"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-alt) 3%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent-alt) 9%, transparent)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Puzzle size={12} style={{ color: 'var(--color-accent-alt)' }} />
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-alt)' }}>
                    Skills actifs ({report.activeSkills.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {report.activeSkills.map(s => (
                    <span
                      key={s}
                      className="px-2 py-0.5 rounded-lg text-xs font-mono"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-accent-alt) 4%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--color-accent-alt) 9%, transparent)',
                        color: 'var(--color-accent-alt)',
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <p className="text-xs text-center py-2" style={{ color: 'var(--text-dimmed)' }}>
              Généré le {new Date(report.generatedAt).toLocaleString('fr-FR')}
              {autoRefresh && ' · Auto-rafraîchissement actif'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}