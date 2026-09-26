import React, { useEffect, useRef } from 'react';
import { AlertTriangle, FolderPlus, FilePlus, X, Pencil } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

export type ModalMode =
  | { type: 'create-file';   dir: string }
  | { type: 'create-folder'; dir: string }
  | { type: 'rename';        oldPath: string; oldName: string }
  | { type: 'confirm-delete'; filePath: string; isDir?: boolean };

interface IdeModalProps {
  mode: ModalMode;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function IdeModal({ mode, onConfirm, onCancel }: IdeModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (mode.type === 'rename') {
      // Sélectionne le nom sans l'extension
      const dot = mode.oldName.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : mode.oldName.length);
    }
  }, [mode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode.type === 'confirm-delete') {
      onConfirm();
    } else {
      const val = inputRef.current?.value.trim();
      if (val) onConfirm(val);
    }
  };

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  // ── Header config ─────────────────────────────────────────────────────────
  const headerIcon = () => {
    if (mode.type === 'create-file')    return <FilePlus   size={15} style={{ color: 'var(--accent-primary)' }} />;
    if (mode.type === 'create-folder')  return <FolderPlus size={15} style={{ color: 'var(--accent-primary)' }} />;
    if (mode.type === 'rename')         return <Pencil     size={15} style={{ color: 'var(--accent-primary)' }} />;
    return <AlertTriangle size={15} className="text-red-400" />;
  };
  const headerTitle = () => {
    if (mode.type === 'create-file')   return 'Nouveau fichier';
    if (mode.type === 'create-folder') return 'Nouveau dossier';
    if (mode.type === 'rename')        return 'Renommer';
    return 'Confirmer la suppression';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-5 shadow-2xl"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {headerIcon()}
            <span className="text-sm font-semibold">{headerTitle()}</span>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 transition hover:bg-white/10" aria-label="Fermer">
            <X size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode.type === 'confirm-delete' ? (
            <div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Supprimer définitivement {mode.isDir ? 'ce dossier' : 'ce fichier'} ?
              </p>
              <p
                className="mt-1 truncate rounded-md px-2 py-1.5 font-mono text-xs"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                title={mode.filePath}
              >
                {mode.filePath}
              </p>
              <p className="mt-2 text-xs text-red-400">Cette action est irréversible.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={onCancel}
                  className="rounded-lg border px-3 py-1.5 text-sm transition hover:bg-white/10"
                  style={{ borderColor: 'var(--border-base)' }}>
                  Annuler
                </button>
                <button type="submit"
                  className="rounded-lg border border-red-500/40 bg-red-500/20 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/30">
                  Supprimer
                </button>
              </div>
            </div>
          ) : (
            <div>
              {(mode.type === 'create-file' || mode.type === 'create-folder') && (
                <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Dans :{' '}
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                    {mode.dir === '.' ? 'workspace/' : `${mode.dir}/`}
                  </span>
                </p>
              )}
              {mode.type === 'rename' && (
                <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Ancien nom :{' '}
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{mode.oldName}</span>
                </p>
              )}
              <input
                ref={inputRef}
                type="text"
                defaultValue={mode.type === 'rename' ? mode.oldName : ''}
                placeholder={
                  mode.type === 'create-file'   ? 'nom.ts'  :
                  mode.type === 'create-folder' ? 'dossier' : ''
                }
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--bg-input, rgba(255,255,255,0.06))',
                  borderColor: 'var(--border-base)',
                  color: 'var(--text-primary)',
                }}
                onKeyDown={e => e.key === 'Escape' && onCancel()}
              />
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={onCancel}
                  className="rounded-lg border px-3 py-1.5 text-sm transition hover:bg-white/10"
                  style={{ borderColor: 'var(--border-base)' }}>
                  Annuler
                </button>
                <button type="submit"
                  className="rounded-lg px-3 py-1.5 text-sm transition hover:opacity-90"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
                  {mode.type === 'rename' ? 'Renommer' : 'Créer'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export type { ModalMode as default };
