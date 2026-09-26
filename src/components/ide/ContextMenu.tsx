import React, { useEffect, useRef } from 'react';
import {
  FilePlus, FolderPlus, Pencil, Copy, Trash2,
  Clipboard, ChevronRight, GitCompare, Scissors, ClipboardPaste, Files, Bot, BookPlus, Globe,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

export type ContextTarget =
  | { kind: 'file';   path: string; name: string }
  | { kind: 'folder'; path: string; name: string };

export interface ClipboardEntry {
  path: string;
  name: string;
  op: 'cut' | 'copy';
}

export interface ContextMenuAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  dividerBefore?: boolean;
}

interface ContextMenuProps {
  target: ContextTarget;
  x: number;
  y: number;
  /** Chemin du fichier actif (pour les actions contextuelles) */
  activeFilePath?: string | null;
  /** Contenu du presse-papier interne (couper/copier) */
  clipboardEntry?: ClipboardEntry | null;
  /** Indique si l'assistant IA est connecté */
  assistantConnected?: boolean;
  onAction: (id: string, target: ContextTarget) => void;
  onClose: () => void;
}

// ── Actions par type de cible ──────────────────────────────────────────────

function getActions(
  target: ContextTarget,
  activeFilePath?: string | null,
  clipboardEntry?: ClipboardEntry | null
): ContextMenuAction[] {
  const canPaste = !!clipboardEntry;

  if (target.kind === 'file') {
    const isActive = target.path === activeFilePath;
    const isHtml = /\.html?$/i.test(target.name);
    return [
      { id: 'open',        label: 'Ouvrir',              icon: <ChevronRight size={13} /> },
      ...(isHtml ? [{ id: 'open-in-browser', label: 'Ouvrir dans le navigateur', icon: <Globe size={13} /> }] : []),
      { id: 'send-to-ai',  label: "Envoyer à l'IA",    icon: <Bot size={13} /> },
      { id: 'import-to-notebook', label: 'Importer dans un notebook', icon: <BookPlus size={13} /> },
      { id: 'rename',      label: 'Renommer',            icon: <Pencil size={13} />, dividerBefore: true },
      { id: 'duplicate',   label: 'Dupliquer',           icon: <Files size={13} /> },
      { id: 'cut',         label: 'Couper',              icon: <Scissors size={13} /> },
      { id: 'copy',        label: 'Copier',              icon: <Copy size={13} /> },
      { id: 'copy-path',   label: 'Copier le chemin',    icon: <Clipboard size={13} /> },
      ...(isActive ? [{ id: 'view-diff', label: 'Voir les diff.', icon: <GitCompare size={13} />, dividerBefore: true }] : []),
      { id: 'delete',      label: 'Supprimer',           icon: <Trash2 size={13} />, danger: true, dividerBefore: true },
    ];
  }
  return [
    { id: 'new-file',    label: 'Nouveau fichier ici',  icon: <FilePlus size={13} /> },
    { id: 'new-folder',  label: 'Nouveau dossier ici',  icon: <FolderPlus size={13} /> },
    { id: 'rename',      label: 'Renommer',             icon: <Pencil size={13} />, dividerBefore: true },
    { id: 'duplicate',   label: 'Dupliquer',            icon: <Files size={13} /> },
    { id: 'cut',         label: 'Couper',               icon: <Scissors size={13} /> },
    { id: 'copy',        label: 'Copier',               icon: <Copy size={13} /> },
    { id: 'copy-path',   label: 'Copier le chemin',     icon: <Clipboard size={13} /> },
    ...(canPaste ? [{
      id: 'paste',
      label: `Coller${clipboardEntry!.op === 'cut' ? ' (déplacer)' : ''}`,
      icon: <ClipboardPaste size={13} />,
      dividerBefore: true,
    }] : []),
    { id: 'delete',      label: 'Supprimer',            icon: <Trash2 size={13} />, danger: true, dividerBefore: !canPaste },
  ];
}

// ── Component ──────────────────────────────────────────────────────────────

export function ContextMenu({ target, x, y, activeFilePath, clipboardEntry, assistantConnected = true, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Fermer sur clic extérieur ou Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouse);
    };
  }, [onClose]);

  const actions = getActions(target, activeFilePath, clipboardEntry);

  // Ajuster position si le menu sort de l'écran
  const menuW = 210;
  const menuH = actions.length * 32 + 16;
  const safeX = x + menuW > window.innerWidth  ? x - menuW : x;
  const safeY = y + menuH > window.innerHeight ? y - menuH : y;

  return (
    <div
      ref={menuRef}
      className="fixed min-w-48 rounded-xl border py-1 shadow-2xl"
      style={{
        zIndex: 'var(--z-dropdown)' as any,
        left: safeX,
        top: safeY,
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-base)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Header — nom cible */}
      <div
        className="truncate px-3 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
        title={target.path}
      >
        {target.name}
      </div>

      {/* Indicateur clipboard actif */}
      {clipboardEntry && (
        <div
          className="mx-2 mb-1 px-2 py-0.5 rounded text-xs flex items-center gap-1.5"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
            color: 'var(--accent-primary)',
          }}
        >
          {clipboardEntry.op === 'cut' ? <Scissors size={9} /> : <Copy size={9} />}
          <span className="truncate">{clipboardEntry.name}</span>
          <span className="opacity-60">({clipboardEntry.op === 'cut' ? 'coupé' : 'copié'})</span>
        </div>
      )}

      {actions.map(action => {
        const disabled = action.id === 'send-to-ai' && !assistantConnected;
        return (
          <React.Fragment key={action.id}>
            {action.dividerBefore && (
              <div className="my-1 border-t" style={{ borderColor: 'var(--border-base)' }} />
            )}
            <button
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition hover:bg-white/10"
              style={{
                color: action.danger ? 'var(--color-error)' : disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              disabled={disabled}
              title={disabled ? 'Assistant non connecté' : undefined}
              onClick={() => { if (!disabled) { onAction(action.id, target); onClose(); } }}
            >
              <span style={{ color: action.danger ? 'var(--color-error)' : 'var(--text-muted)' }}>
                {action.icon}
              </span>
              {action.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
