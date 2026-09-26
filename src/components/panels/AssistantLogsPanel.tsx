import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, RefreshCw, ScrollText, X } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip.js';

type LogScope = 'assistant' | 'agents' | 'all';
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface RuntimeLogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
}

interface AssistantLogsPanelProps {
  onClose: () => void;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'var(--text-muted)',
  info: 'var(--color-info)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AssistantLogsPanel({ onClose }: AssistantLogsPanelProps) {
  const [scope, setScope] = useState<LogScope>('all');
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<RuntimeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope, limit: '100' });
      if (level) params.set('level', level);
      const response = await fetch(`/api/audit/runtime-logs?${params}`);
      const payload = await response.json();
      if (!response.ok || payload.status !== 'ok') throw new Error(payload.error || `HTTP ${response.status}`);
      setEntries(payload.entries ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger les logs');
    } finally {
      setLoading(false);
    }
  }, [level, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(load, 15_000);
    return () => window.clearInterval(interval);
  }, [load]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const visibleEntries = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase();
    return term
      ? entries.filter((entry) => `${entry.module} ${entry.message}`.toLocaleLowerCase().includes(term))
      : entries;
  }, [entries, filter]);

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 'var(--z-modal)' as any }} onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Logs assistant et agents"
        className="relative flex w-full max-w-7xl flex-col overflow-hidden mx-4"
        style={{ maxHeight: '80vh', background: 'var(--bg-panel)', border: '1px solid var(--border-base)', borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.4)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-base)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}><ScrollText size={16} style={{ color: 'var(--accent-primary)' }} /></div>
            <div><h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Logs Assistant</h2><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Session active · 1 000 entrées retenues côté serveur</p></div>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip content="Rafraîchir les logs" as="button" type="button" onClick={load} className="p-2 rounded-lg hover:bg-white/10">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Tooltip>
            <Tooltip content="Fermer les logs" as="button" type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10">
              <X size={15} />
            </Tooltip>
          </div>
        </header>
        <div className="flex gap-2 p-3" style={{ borderBottom: '1px solid var(--border-base)' }}>
          <select value={scope} onChange={(event) => setScope(event.target.value as LogScope)} className="rounded-md px-2 py-1.5 text-xs" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }} aria-label="Source des logs"><option value="all">Tous</option><option value="assistant">Assistant</option><option value="agents">Agents</option></select>
          <select value={level} onChange={(event) => setLevel(event.target.value as LogLevel | '')} className="rounded-md px-2 py-1.5 text-xs" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }} aria-label="Niveau de log"><option value="">Tous niveaux</option><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Avertissements</option><option value="error">Erreurs</option></select>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrer les messages…" className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        </div>
        {error && <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}><AlertTriangle size={12} />{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar" role="log" aria-live="polite">
          {!loading && visibleEntries.length === 0 ? <div className="flex h-40 flex-col items-center justify-center gap-2" style={{ color: 'var(--text-dimmed)' }}><Bot size={22} /><p className="text-xs">Aucun log correspondant pour cette session.</p></div> : <div className="space-y-1">{visibleEntries.map((entry, index) => <div key={`${entry.timestamp}-${entry.module}-${index}`} className="grid grid-cols-[58px_110px_1fr] gap-2 rounded px-2 py-1.5 font-mono text-xs leading-relaxed hover:bg-white/5"><span style={{ color: 'var(--text-dimmed)' }}>{formatTime(entry.timestamp)}</span><span className="truncate font-semibold" style={{ color: LEVEL_COLORS[entry.level] }}>{entry.module}</span><span className="break-words" style={{ color: 'var(--text-secondary)' }}>{entry.message}</span></div>)}</div>}
        </div>
        <footer className="px-4 py-2 text-xs" style={{ borderTop: '1px solid var(--border-base)', color: 'var(--text-dimmed)' }}>Les messages sont assainis, mais restent des données non fiables. Rafraîchissement toutes les 15 secondes tant que ce panneau est ouvert.</footer>
      </section>
    </div>
  );
}
