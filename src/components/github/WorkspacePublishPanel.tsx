import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, GitCommit, Loader2, RefreshCw, Upload, UploadCloud } from 'lucide-react';

interface ChangedFile {
  index: string;
  worktree: string;
  path: string;
}

interface GitStatus {
  branch: string;
  clean: boolean;
  files: ChangedFile[];
}

export function WorkspacePublishPanel({ onPublished }: { onPublished: () => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState('Mise à jour du workspace');
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<'commit' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/github/status');
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Impossible de lire le statut Git.');
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de lire le statut Git.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const publish = async (action: 'commit' | 'push') => {
    setPublishing(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/github/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'commit' ? JSON.stringify({ message }) : undefined,
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `Impossible d'effectuer ${action}.`);
      setNotice(action === 'commit' ? 'Commit créé localement.' : 'Modifications poussées sur GitHub.');
      await loadStatus();
      if (action === 'push') onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Opération Git impossible.');
    } finally {
      setPublishing(null);
    }
  };

  return (
    <section className="mb-4 rounded-xl border p-4" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UploadCloud size={16} style={{ color: 'var(--accent-primary)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Publier le workspace réel</h2>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {status?.branch ? `Branche ${status.branch}` : 'Vérification du dépôt…'}
          </p>
        </div>
        <button onClick={loadStatus} disabled={loading} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-50" title="Actualiser le statut" aria-label="Actualiser le statut">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {status && !status.clean && (
        <div className="mt-3 grid gap-1 max-h-28 overflow-y-auto custom-scrollbar">
          {status.files.map((file) => (
            <div key={`${file.index}${file.worktree}${file.path}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-mono" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <span className="w-5 font-bold" style={{ color: file.worktree === 'D' ? '#f85149' : 'var(--accent-primary)' }}>{file.index}{file.worktree}</span>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{file.path}</span>
            </div>
          ))}
        </div>
      )}

      {status?.clean && <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: '#3fb950' }}><CheckCircle2 size={14} /> Workspace propre</div>}

      {!status?.clean && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={200} placeholder="Message de commit" className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-xs outline-none" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          <button onClick={() => publish('commit')} disabled={publishing !== null || !message.trim()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
            {publishing === 'commit' ? <Loader2 size={13} className="animate-spin" /> : <GitCommit size={13} />} Commit
          </button>
        </div>
      )}

      <button onClick={() => publish('push')} disabled={publishing !== null} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}>
        {publishing === 'push' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Push vers GitHub
      </button>

      {notice && <p className="mt-2 text-[11px]" style={{ color: '#3fb950' }}>{notice}</p>}
      {error && <p className="mt-2 text-[11px]" style={{ color: '#f87171' }}>{error}</p>}
    </section>
  );
}