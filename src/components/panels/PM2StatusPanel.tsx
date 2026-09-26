import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Server, Cpu, MemoryStick, Clock, RefreshCw, Loader2, AlertCircle,
  Play, Square, Repeat, Trash2, FileText, ChevronDown, ChevronRight,
  HardDrive, Power, Boxes, CheckCircle2, XCircle,
} from 'lucide-react';
import { pm2Api, type Pm2AppStatus, type Pm2StatusResponse } from '../../services/pm2Api.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} Go`;
  return `${Math.round(mb)} Mo`;
}

function formatUptimeSeconds(seconds: number | null): string {
  if (seconds == null) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}j ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'online') return 'var(--color-success)';
  if (s.includes('err') || s.includes('error')) return 'var(--color-error)';
  if (s.includes('stopped') || s.includes('stop')) return 'var(--text-dimmed)';
  if (s.includes('launch') || s.includes('start')) return 'var(--color-warning)';
  return 'var(--text-muted)';
}

function cpuColor(pct: number): string {
  if (pct >= 80) return 'var(--color-error)';
  if (pct >= 50) return 'var(--color-warning)';
  return 'var(--color-success)';
}

function memColor(pct: number): string {
  if (pct > 85) return 'var(--color-error)';
  if (pct > 60) return 'var(--color-warning)';
  return 'var(--color-success)';
}

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  return `il y a ${h}h`;
}

interface PM2StatusPanelProps {
  onClose?: () => void;
}

export function PM2StatusPanel({ onClose }: PM2StatusPanelProps) {
  const [data, setData] = useState<Pm2StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, { entries: string[]; loading: boolean; error?: string | null }>>({});

  const loadStatus = useCallback(async () => {
    try {
      const d = await pm2Api.getStatus();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Impossible de charger le statut PM2');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadStatus, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, loadStatus]);

  const aggregateMemory = data?.apps.reduce((s, a) => s + a.memoryMB, 0) ?? 0;
  const aggregateCpu = data?.apps.reduce((s, a) => s + a.cpu, 0) ?? 0;
  const totalInstances = data?.apps.reduce((s, a) => s + a.instances, 0) ?? 0;
  const onlineApps = data?.apps.filter(a => a.status.toLowerCase() === 'online').length ?? 0;

  const withBusy = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(b => ({ ...b, [key]: true }));
    try {
      return await fn();
    } finally {
      setBusy(b => ({ ...b, [key]: false }));
    }
  };

  const handleAction = useCallback(async (
    action: 'restart' | 'stop' | 'reload' | 'flush',
    name?: string,
  ) => {
    try {
      if (action === 'restart' && name) {
        await withBusy(`restart:${name}`, () => pm2Api.restart(name));
      } else if (action === 'stop' && name) {
        await withBusy(`stop:${name}`, () => pm2Api.stop(name));
      } else if (action === 'reload') {
        await withBusy('reload', () => pm2Api.reload());
      } else if (action === 'flush') {
        await withBusy('flush', () => pm2Api.flush());
        setLogs({});
      }
      setTimeout(loadStatus, 1200);
    } catch (e: any) {
      setError(e?.message || `Erreur pendant l'action "${action}"`);
    }
  }, [loadStatus]);

  const loadLogs = useCallback(async (name: string) => {
    setLogs(prev => ({ ...prev, [name]: { entries: prev[name]?.entries || [], loading: true, error: null } }));
    try {
      const r = await pm2Api.getLogs(name, { lines: 120 });
      setLogs(prev => ({ ...prev, [name]: { entries: r.entries, loading: false, error: null } }));
    } catch (e: any) {
      setLogs(prev => ({ ...prev, [name]: { entries: prev[name]?.entries || [], loading: false, error: e?.message || 'Erreur logs' } }));
    }
  }, []);

  const toggleExpand = (app: Pm2AppStatus) => {
    const next = expandedApp === app.name ? null : app.name;
    setExpandedApp(next);
    if (next && (!logs[app.name] || logs[app.name].entries.length === 0)) {
      loadLogs(app.name);
    }
  };

  return (
    <div
      className="flex flex-col w-full h-full min-h-0 border-l"
      style={{
        width: 420,
        minWidth: 420,
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      {/* Header */}
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
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}
          >
            <Boxes size={14} />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              PM2 · Gestionnaire de processus
            </span>
            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              {data ? `${onlineApps}/${data.apps.length} app${data.apps.length > 1 ? 's' : ''} en ligne · ${relativeTime(data.queriedAt)}` : 'Chargement…'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={loadStatus}
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
            title="Actualisation auto toutes les 10s"
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
          <button
            onClick={() => handleAction('reload')}
            className="h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition hover:brightness-110 disabled:opacity-50"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)',
              color: 'var(--accent-primary)',
            }}
            title="Recharger ecosystem.config.cjs (zéro-downtime)"
            disabled={!!busy['reload']}
          >
            {busy['reload'] ? <Loader2 size={12} className="animate-spin" /> : <Repeat size={12} />}
            Reload
          </button>
          <button
            onClick={() => handleAction('flush')}
            className="h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition hover:brightness-110 disabled:opacity-50"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)',
              color: 'var(--color-warning)',
            }}
            title="Vider tous les logs PM2"
            disabled={!!busy['flush']}
          >
            {busy['flush'] ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Flush
          </button>
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-dimmed)' }} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Interrogation du démon PM2…
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
                <p className="text-sm font-semibold">PM2 inaccessible</p>
                <p className="text-sm mt-1 opacity-90">{error}</p>
                <p className="text-xs mt-2 opacity-80">
                  Vérifiez que le démon PM2 est lancé (ex : <code>pm2 ping</code>).
                </p>
              </div>
            </div>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Host / Daemon */}
            <div
              className="rounded-2xl p-3.5 space-y-2"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-primary) 7%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-primary) 13%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Server size={12} style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                  Hôte & Démon
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Machine</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{data.host.hostname}</p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>OS</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {data.host.platform} · {data.host.arch}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>CPU</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {data.host.cores} cœurs
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Démon PID</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {data.daemon.pid ?? '—'}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-dimmed)' }}>Uptime démon</span>
                  <p className="font-semibold font-mono truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {formatUptimeSeconds(data.daemon.uptimeSeconds ?? null)}
                  </p>
                </div>
              </div>
            </div>

            {/* Stats globales */}
            <div
              className="rounded-2xl p-3.5 space-y-3"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-secondary) 7%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-secondary) 13%, transparent)',
              }}
            >
              <div className="flex items-center gap-2">
                <HardDrive size={12} style={{ color: 'var(--accent-secondary)' }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-secondary)' }}>
                  Agrégats ({totalInstances} instance{totalInstances > 1 ? 's' : ''})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniStat
                  icon={<Cpu size={14} />}
                  label="CPU total"
                  value={`${aggregateCpu.toFixed(1)} %`}
                  color={cpuColor(aggregateCpu)}
                />
                <MiniStat
                  icon={<MemoryStick size={14} />}
                  label="RAM totale"
                  value={formatMB(aggregateMemory)}
                  color={memColor(Math.min(100, (aggregateMemory / Math.max(1, data.host.cores * 2048)) * 100))}
                />
                <MiniStat
                  icon={<Power size={14} />}
                  label="Apps en ligne"
                  value={`${onlineApps}/${data.apps.length}`}
                  color={onlineApps === data.apps.length ? 'var(--color-success)' : 'var(--color-warning)'}
                />
                <MiniStat
                  icon={<Clock size={14} />}
                  label="Plus vieille app"
                  value={formatUptimeSeconds(
                    data.apps.length
                      ? Math.max(...data.apps.map(a => a.uptimeSeconds ?? 0))
                      : null,
                  )}
                  color="var(--accent-secondary)"
                />
              </div>
            </div>

            {/* Apps list */}
            <div className="space-y-2">
              {data.apps.length === 0 && (
                <div
                  className="rounded-2xl p-4 text-center text-sm"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--text-dimmed) 4%, transparent)',
                    border: '1px dashed var(--border-base)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Aucune application PM2 enregistrée.
                </div>
              )}

              {data.apps.map(app => (
                <AppCard
                  key={`${app.id}-${app.name}`}
                  app={app}
                  hostCores={data.host.cores}
                  expanded={expandedApp === app.name}
                  busyRestart={!!busy[`restart:${app.name}`]}
                  busyStop={!!busy[`stop:${app.name}`]}
                  logsState={logs[app.name]}
                  onToggle={() => toggleExpand(app)}
                  onRestart={() => handleAction('restart', app.name)}
                  onStop={() => handleAction('stop', app.name)}
                  onRefreshLogs={() => loadLogs(app.name)}
                />
              ))}
            </div>

            {/* Footer */}
            <p className="text-xs text-center py-2" style={{ color: 'var(--text-dimmed)' }}>
              {autoRefresh && 'Auto-rafraîchissement actif (10s) · '}
              Mis à jour {new Date(data.queriedAt).toLocaleString('fr-FR')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub components ──────────────────────────────────────────────────────────

function MiniStat({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="rounded-xl p-2.5 flex flex-col gap-1"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color, display: 'flex' }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
          {label}
        </span>
      </div>
      <span className="text-sm font-bold font-mono leading-none" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

interface AppCardProps {
  app: Pm2AppStatus;
  hostCores: number;
  expanded: boolean;
  busyRestart: boolean;
  busyStop: boolean;
  logsState?: { entries: string[]; loading: boolean; error?: string | null };
  onToggle: () => void;
  onRestart: () => void;
  onStop: () => void;
  onRefreshLogs: () => void;
}

function AppCard({
  app, hostCores, expanded, busyRestart, busyStop, logsState,
  onToggle, onRestart, onStop, onRefreshLogs,
}: AppCardProps) {
  const col = statusColor(app.status);
  const memSharePct = hostCores > 0 ? Math.min(100, (app.memoryMB / (hostCores * 2048)) * 100) : 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        border: `1px solid color-mix(in srgb, ${col} 18%, transparent)`,
        backgroundColor: 'color-mix(in srgb, var(--bg-secondary) 92%, transparent)',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 text-left flex items-start gap-2 hover:bg-white/5 transition"
      >
        <span className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {app.name}
            </span>
            <span
              className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: `color-mix(in srgb, ${col} 12%, transparent)`, color: col, border: `1px solid color-mix(in srgb, ${col} 20%, transparent)` }}
            >
              {app.status}
            </span>
            {app.mode && (
              <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono" style={{ backgroundColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
                {app.mode}
              </span>
            )}
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
              #{app.id} · {app.instances} × worker
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <MetricRow
              icon={<Cpu size={10} />}
              label="CPU"
              value={`${app.cpu.toFixed(1)}%`}
              color={cpuColor(app.cpu)}
            />
            <MetricRow
              icon={<MemoryStick size={10} />}
              label="RAM"
              value={formatMB(app.memoryMB)}
              color={memColor(memSharePct)}
            />
            <MetricRow
              icon={<Clock size={10} />}
              label="Uptime"
              value={formatUptimeSeconds(app.uptimeSeconds)}
              color="var(--text-muted)"
            />
            <MetricRow
              icon={<Repeat size={10} />}
              label="Restarts"
              value={String(app.restartCount) + (app.unstableRestarts ? ` (+${app.unstableRestarts} instables)` : '')}
              color={app.unstableRestarts ? 'var(--color-error)' : 'var(--text-muted)'}
            />
          </div>
        </div>
      </button>

      {/* Actions row (visible aussi quand replié pour action rapide) */}
      <div
        className="flex items-center gap-1.5 px-3 pb-2.5"
      >
        <button
          onClick={(e) => { e.stopPropagation(); onRestart(); }}
          disabled={busyRestart || busyStop}
          className="h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition hover:brightness-110 disabled:opacity-50"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
            color: 'var(--color-success)',
          }}
          title="Redémarrer l'application"
        >
          {busyRestart ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Redémarrer
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onStop(); }}
          disabled={busyRestart || busyStop}
          className="h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition hover:brightness-110 disabled:opacity-50"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)',
            color: 'var(--color-error)',
          }}
          title="Arrêter l'application"
        >
          {busyStop ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
          Stop
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition hover:brightness-110"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-secondary) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent-secondary) 18%, transparent)',
            color: 'var(--accent-secondary)',
          }}
          title={expanded ? 'Masquer les logs' : 'Afficher les logs'}
        >
          <FileText size={12} />
          {expanded ? 'Masquer logs' : 'Voir logs'}
        </button>
        <div className="ml-auto text-[10px] font-mono text-right" style={{ color: 'var(--text-dimmed)' }}>
          {app.nodeVersion && <div>Node {app.nodeVersion}</div>}
          {app.pid ? <div>PID {app.pid}</div> : null}
        </div>
      </div>

      {/* Logs expandable area */}
      {expanded && (
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'color-mix(in srgb, #000 10%, transparent)' }}
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-1.5">
              <FileText size={11} style={{ color: 'var(--text-muted)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Journaux · {app.name}
              </span>
            </div>
            <button
              onClick={onRefreshLogs}
              className="h-6 px-2 rounded-md text-[10px] font-semibold flex items-center gap-1"
              style={{
                backgroundColor: 'var(--border-base)',
                color: 'var(--text-primary)',
              }}
            >
              <RefreshCw size={10} className={logsState?.loading ? 'animate-spin' : ''} />
              Rafraîchir
            </button>
          </div>

          {logsState?.loading && !logsState.entries.length && (
            <div className="flex items-center gap-2 py-4 text-xs" style={{ color: 'var(--text-dimmed)' }}>
              <Loader2 size={12} className="animate-spin" />
              Chargement des logs…
            </div>
          )}

          {logsState?.error && (
            <div className="text-xs p-2 rounded-lg" style={{ color: 'var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}>
              {logsState.error}
            </div>
          )}

          {!logsState?.loading && !logsState?.error && (!logsState || logsState.entries.length === 0) && (
            <div className="text-xs py-4 text-center" style={{ color: 'var(--text-dimmed)' }}>
              Aucune ligne disponible
            </div>
          )}

          {logsState && logsState.entries.length > 0 && (
            <pre
              className="text-[11px] leading-relaxed font-mono max-h-72 overflow-auto custom-scrollbar p-2 rounded-lg whitespace-pre-wrap break-words"
              style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)', color: 'var(--text-muted)' }}
            >
              {logsState.entries.join('\n')}
            </pre>
          )}

          {app.execPath && (
            <div className="mt-2 flex items-start gap-2 text-[10px] font-mono">
              <span style={{ color: 'var(--text-dimmed)' }}>entry:</span>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{app.execPath}</span>
            </div>
          )}
          {app.cwd && (
            <div className="flex items-start gap-2 text-[10px] font-mono">
              <span style={{ color: 'var(--text-dimmed)' }}>cwd:</span>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{app.cwd}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricRow({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <div className="flex items-center gap-1 min-w-0">
        <span style={{ color: 'var(--text-dimmed)', display: 'flex' }}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-bold truncate" style={{ color: 'var(--text-dimmed)' }}>
          {label}
        </span>
      </div>
      <span className="font-mono font-semibold truncate" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
