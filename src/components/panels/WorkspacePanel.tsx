import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, CheckCircle2, AlertCircle, Loader2,
  RefreshCw, Save, FolderSearch, Upload, HardDrive,
} from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { IconButton } from '../ui/IconButton.js';
import { motion, AnimatePresence } from 'motion/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceState {
  workspace: string;
  exists: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Access Electron API if available (desktop mode) */
function getElectronAPI(): { selectFolder: () => Promise<string | null> } | null {
  const w = window as any;
  return w.electronAPI?.selectFolder ? w.electronAPI : null;
}

/** Fallback: Web File System Access API (Chrome/Edge only) */
async function webSelectFolder(): Promise<string | null> {
  try {
    // @ts-ignore — showDirectoryPicker not in all TS libs
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    return handle.name;
  } catch {
    return null; // User cancelled
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const WorkspacePanel = React.memo(function WorkspacePanel() {
  const [current, setCurrent]   = useState<WorkspaceState | null>(null);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  // ── Fetch current workspace ─────────────────────────────────────────────
  const fetchWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/workspace');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as WorkspaceState;
      setCurrent(data);
      setInput(data.workspace);
    } catch {
      setError('Impossible de récupérer le workspace actuel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchWorkspace(); }, [fetchWorkspace]);

  // ── Save new workspace ──────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === current?.workspace) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/workspace', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workspace: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erreur inconnue.');
      } else {
        setCurrent({ workspace: data.workspace, exists: true });
        setInput(data.workspace);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        window.dispatchEvent(new CustomEvent('Leanna-workspace-changed', {
          detail: { workspace: data.workspace },
        }));
      }
    } catch (e: any) {
      setError(e.message || 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }, [input, current]);

  // ── Browse folder ───────────────────────────────────────────────────────
  const electronAPI = getElectronAPI();
  const canBrowse   = !!electronAPI || typeof (window as any).showDirectoryPicker === 'function';

  const handleBrowse = useCallback(async () => {
    const selected = electronAPI
      ? await electronAPI.selectFolder()
      : await webSelectFolder();
    if (selected) {
      setInput(selected);
      setError(null);
      setSuccess(false);
    }
  }, [electronAPI]);

  // ── Derived state ───────────────────────────────────────────────────────
  const isChanged = input.trim() !== (current?.workspace ?? '');
  const isEmpty   = !input.trim();
  const canSave   = !saving && !isEmpty && isChanged;

  return (
    <Panel
      title="Workspace"
      icon={<FolderOpen className="w-4 h-4" />}
      actions={
        <IconButton
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          onClick={fetchWorkspace}
          tooltip="Rafraîchir"
          aria-label="Rafraîchir le workspace"
        />
      }
    >
      <div className="flex flex-col gap-4">

        {/* ── Status card ──────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {loading && !current && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 py-3 justify-center"
              style={{ color: 'var(--text-dimmed)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Chargement…</span>
            </motion.div>
          )}

          {current && (
            <motion.div
              key="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-xl border px-4 py-3 flex items-center gap-3"
              style={{
                borderColor: current.exists ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
                backgroundColor: current.exists ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: current.exists ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                }}
              >
                {current.exists
                  ? <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
                  : <AlertCircle  className="w-4 h-4" style={{ color: 'var(--color-error)' }} />
                }
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs font-bold"
                  style={{ color: current.exists ? 'var(--color-success)' : 'var(--color-error)' }}
                >
                  {current.exists ? 'Workspace actif' : 'Dossier introuvable'}
                </p>
                <p
                  className="text-xs font-mono break-all mt-0.5 leading-snug"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {current.workspace}
                </p>
              </div>
              <HardDrive className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-dimmed)', opacity: 0.4 }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Path input ───────────────────────────────────── */}
        <div>
          <label
            htmlFor="workspace-path-input"
            className="block text-xs font-semibold mb-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Nouveau chemin
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderSearch
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--text-dimmed)' }}
              />
              <input
                id="workspace-path-input"
                type="text"
                value={input}
                onChange={e => { setInput(e.target.value); setError(null); setSuccess(false); }}
                onKeyDown={e => { if (e.key === 'Enter') void handleSave(); }}
                placeholder="C:\Users\…\mon-projet"
                className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs font-mono transition-colors focus:ring-1 focus:ring-[var(--accent-primary)]"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: error ? 'rgba(248,113,113,0.6)' : 'var(--border-base)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
                spellCheck={false}
                autoComplete="off"
                aria-describedby="workspace-path-help"
                aria-invalid={!!error}
              />
            </div>
            {canBrowse && (
              <button
                type="button"
                onClick={() => void handleBrowse()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 hover:opacity-80"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--accent-primary)',
                  cursor: 'pointer',
                }}
                title="Parcourir les dossiers"
                aria-label="Parcourir les dossiers"
              >
                <Upload className="w-3.5 h-3.5" />
                Parcourir
              </button>
            )}
          </div>
          <p id="workspace-path-help" className="text-sm mt-1.5" style={{ color: 'var(--text-dimmed)' }}>
            {canBrowse
              ? "Cliquez sur « Parcourir » ou saisissez le chemin absolu."
              : "Chemin absolu vers le dossier racine de l'application cible."
            }
          </p>
        </div>

        {/* ── Feedback ─────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 rounded-lg border px-3 py-2 overflow-hidden"
              style={{
                borderColor: 'rgba(248,113,113,0.4)',
                backgroundColor: 'rgba(248,113,113,0.08)',
              }}
              role="alert"
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-error)' }} />
              <p className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>
            </motion.div>
          )}

          {success && (
            <motion.div
              key="success"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 overflow-hidden"
              style={{
                borderColor: 'rgba(74,222,128,0.4)',
                backgroundColor: 'rgba(74,222,128,0.08)',
              }}
              role="status"
            >
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
              <p className="text-xs" style={{ color: 'var(--color-success)' }}>Workspace mis à jour avec succès.</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Save button ──────────────────────────────────── */}
        <motion.button
          onClick={() => void handleSave()}
          disabled={!canSave}
          whileTap={canSave ? { scale: 0.97 } : undefined}
          className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-xs font-bold transition-all"
          style={{
            backgroundColor: canSave ? 'var(--accent-primary)' : 'var(--border-base)',
            color: canSave ? 'var(--bg-base)' : 'var(--text-dimmed)',
            cursor: canSave ? 'pointer' : 'not-allowed',
            border: 'none',
            boxShadow: canSave ? '0 2px 8px rgba(14,165,233,0.2)' : 'none',
          }}
          aria-label="Appliquer le nouveau workspace"
        >
          {saving
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enregistrement…</>
            : <><Save className="w-3.5 h-3.5" /> Appliquer le workspace</>
          }
        </motion.button>

        {/* ── Note ─────────────────────────────────────────── */}
        <p className="text-sm text-center" style={{ color: 'var(--text-dimmed)' }}>
          Le changement est actif immédiatement. L'IDE se recharge automatiquement.
        </p>
      </div>
    </Panel>
  );
});
