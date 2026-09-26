import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Folder, FolderOpen, Plus, RefreshCw, ChevronRight, ChevronDown,
  Shield, Search, X, ArrowDownAZ, ArrowUpZA, Layers, GripVertical,
  FolderInput,
} from 'lucide-react';
import { FileIcon } from './FileIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import type { TreeEntry } from '../../types/ide.js';
import { sandboxApi } from '../../services/sandboxApi.js';

// ── Types ──────────────────────────────────────────────────────────────────

type SortMode = 'name-asc' | 'name-desc' | 'type';

type FileExplorerProps = {
  tree: TreeEntry[];
  expandedDirs: Set<string>;
  loading: boolean;
  currentDir: string;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
  onCreateFile: () => void;
  onRefresh: () => void;
  onNavigate: (dir: string) => void;
  onMoveEntry?: (srcPath: string, destDir: string) => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function sortEntries(entries: TreeEntry[], mode: SortMode): TreeEntry[] {
  const dirs  = entries.filter(e => e.type === 'directory');
  const files = entries.filter(e => e.type === 'file');

  const byName = (a: TreeEntry, b: TreeEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const byNameDesc = (a: TreeEntry, b: TreeEntry) => -byName(a, b);

  switch (mode) {
    case 'name-asc':
      return [...dirs.sort(byName), ...files.sort(byName)];
    case 'name-desc':
      return [...dirs.sort(byNameDesc), ...files.sort(byNameDesc)];
    case 'type':
      return [
        ...dirs.sort(byName),
        ...files.sort((a, b) => {
          const extA = a.name.includes('.') ? a.name.split('.').pop()! : '';
          const extB = b.name.includes('.') ? b.name.split('.').pop()! : '';
          return extA.localeCompare(extB) || a.name.localeCompare(b.name);
        }),
      ];
  }
}

function filterTree(entries: TreeEntry[], query: string): TreeEntry[] {
  if (!query) return entries;
  const q = query.toLowerCase();
  return entries.reduce<TreeEntry[]>((acc, entry) => {
    if (entry.type === 'directory' && entry.children) {
      const filteredChildren = filterTree(entry.children, query);
      if (filteredChildren.length > 0 || entry.name.toLowerCase().includes(q)) {
        acc.push({ ...entry, children: filteredChildren });
      }
    } else if (entry.name.toLowerCase().includes(q)) {
      acc.push(entry);
    }
    return acc;
  }, []);
}

// ── Sort Icon helper ────────────────────────────────────────────────────────

function SortIcon({ mode }: { mode: SortMode }) {
  if (mode === 'name-asc')  return <ArrowDownAZ size={11} />;
  if (mode === 'name-desc') return <ArrowUpZA size={11} />;
  return <Layers size={11} />;
}

function sortLabel(mode: SortMode): string {
  if (mode === 'name-asc')  return 'Tri : A→Z';
  if (mode === 'name-desc') return 'Tri : Z→A';
  return 'Tri : Type';
}

function nextSort(mode: SortMode): SortMode {
  if (mode === 'name-asc')  return 'name-desc';
  if (mode === 'name-desc') return 'type';
  return 'name-asc';
}

// ── HighlightMatch — highlight query in file names ─────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          backgroundColor: 'color-mix(in srgb, var(--accent-primary) 35%, transparent)',
          color: 'inherit',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Count total entries in a filtered tree ─────────────────────────────────

function countEntries(entries: TreeEntry[]): number {
  return entries.reduce((acc, e) => {
    if (e.type === 'file') return acc + 1;
    return acc + countEntries(e.children ?? []);
  }, 0);
}

// ── Main Component ──────────────────────────────────────────────────────────

const FileExplorer = memo(function FileExplorer({
  tree,
  expandedDirs,
  loading,
  currentDir,
  onOpenFile,
  onToggleDirectory,
  onContextMenu,
  onCreateFile,
  onRefresh,
  onNavigate,
  onMoveEntry,
}: FileExplorerProps) {
  // ── Sandbox status (cached via sandboxApi, pas de polling rafale) ──────────
  const [sandboxActive, setSandboxActive] = useState(false);

  useEffect(() => {
    let mounted = true;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const checkSandbox = async (force = false) => {
      try {
        const data = await sandboxApi.getStatus(force);
        if (mounted && data.status === 'success') {
          setSandboxActive(data.sandbox?.active ?? false);
        }
      } catch { /* silent */ }
    };

    checkSandbox();

    // Écoute debouncée: si l'event est émis plusieurs fois en rafale,
    // on ne fait qu'un seul re-fetch au bout de 150ms.
    const handleChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => checkSandbox(true), 150);
    };

    window.addEventListener('Leanna-sandbox-changed', handleChange);
    return () => {
      mounted = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('Leanna-sandbox-changed', handleChange);
    };
  }, []);

  // ── Search + Sort ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch]   = useState(false);
  const [sortMode, setSortMode]       = useState<SortMode>('name-asc');

  const toggleSearch = useCallback(() => {
    setShowSearch(prev => {
      if (prev) setSearchQuery('');
      return !prev;
    });
  }, []);

  const processedTree = useMemo(() => {
    const filtered = filterTree(tree, searchQuery);
    // Apply sort recursively
    const applySort = (entries: TreeEntry[]): TreeEntry[] =>
      sortEntries(entries, sortMode).map(e =>
        e.type === 'directory' && e.children
          ? { ...e, children: applySort(e.children) }
          : e
      );
    return applySort(filtered);
  }, [tree, searchQuery, sortMode]);

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, entry: TreeEntry) => {
    setDraggingPath(entry.path);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', entry.path);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, entry: TreeEntry) => {
    if (entry.type !== 'directory') return;
    if (entry.path === draggingPath) return;
    // Prevent dropping parent into its own child
    if (draggingPath && entry.path.startsWith(draggingPath + '/')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(entry.path);
  }, [draggingPath]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving to an element outside the item
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
      setDragOverPath(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, entry: TreeEntry) => {
    e.preventDefault();
    setDragOverPath(null);
    setDraggingPath(null);
    if (entry.type !== 'directory') return;
    const src = e.dataTransfer.getData('text/plain');
    if (!src || src === entry.path) return;
    if (src.startsWith(entry.path + '/')) return; // dropping into own child
    onMoveEntry?.(src, entry.path);
  }, [onMoveEntry]);

  const handleDragEnd = useCallback(() => {
    setDraggingPath(null);
    setDragOverPath(null);
  }, []);

  // ── Tree entry renderer ────────────────────────────────────────────────────

  const renderTreeEntry = useCallback((entry: TreeEntry, depth = 0): React.ReactNode => {
    const isExpanded = expandedDirs.has(entry.path);
    const hasChildren = entry.children && entry.children.length > 0;
    const isDraggingThis = draggingPath === entry.path;
    const isDragTarget   = dragOverPath === entry.path;

    const handleClick = () => {
      if (entry.type === 'file') {
        onOpenFile(entry.path);
      } else {
        onToggleDirectory(entry.path);
      }
    };

    return (
      <div
        key={entry.path}
        className="relative"
        style={{ opacity: isDraggingThis ? 0.4 : 1 }}
        onDragLeave={handleDragLeave}
      >
        {/* Indentation guide line (rendered only for child elements) */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none opacity-20"
            style={{
              left: `${10 + (depth - 1) * 12}px`,
              width: '1px',
              borderLeft: '1.2px dashed var(--text-primary)',
            }}
          />
        )}

        <div
          className="flex items-center gap-1.5 py-1 px-2 text-xs cursor-pointer select-none relative group transition-colors duration-100"
          style={{
            paddingLeft: `${8 + depth * 12}px`,
            color: 'var(--text-primary)',
            backgroundColor: isDragTarget
              ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)'
              : undefined,
            outline: isDragTarget ? '1px solid var(--accent-primary)' : undefined,
            outlineOffset: '-1px',
            borderRadius: isDragTarget ? '4px' : undefined,
          }}
          onClick={handleClick}
          onContextMenu={(e) => onContextMenu(e, entry)}
          /* Drag source */
          draggable
          onDragStart={(e) => handleDragStart(e, entry)}
          onDragEnd={handleDragEnd}
          /* Drop target (directories only) */
          onDragOver={(e) => handleDragOver(e, entry)}
          onDrop={(e) => handleDrop(e, entry)}
        >
          {/* Drag handle indicator */}
          <span className="opacity-0 group-hover:opacity-30 transition-opacity absolute" style={{ left: `${depth * 12 + 1}px` }}>
            <GripVertical size={9} />
          </span>

          {/* Arrow indicator for directories */}
          {entry.type === 'directory' ? (
            <span className="opacity-60 group-hover:opacity-100 mr-0.5">
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          ) : (
            // Tiny spacer to align files with folders that have arrows
            <span className="w-3.5" />
          )}

          <div className="flex items-center gap-1.5 flex-1 min-w-0 hover:bg-white/5 transition-colors">
            {entry.type === 'directory' ? (
              isDragTarget ? (
                <FolderOpen size={13} style={{ color: 'var(--accent-primary)' }} />
              ) : isExpanded ? (
                <FolderOpen size={13} style={{ color: 'var(--accent-primary)' }} />
              ) : (
                <Folder size={13} style={{ color: 'var(--accent-primary)' }} />
              )
            ) : (
              <FileIcon filePath={entry.path} />
            )}
            <span className="truncate font-medium opacity-90 group-hover:opacity-100" title={entry.name}>
              {/* Highlight search match */}
              {searchQuery ? (
                <HighlightMatch text={entry.name} query={searchQuery} />
              ) : (
                entry.name
              )}
            </span>
          </div>
        </div>

        {entry.type === 'directory' && isExpanded && hasChildren && (
          <div className="flex flex-col">
            {entry.children!.map((child) => renderTreeEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }, [
    expandedDirs,
    draggingPath,
    dragOverPath,
    onOpenFile,
    onToggleDirectory,
    onContextMenu,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDrop,
    handleDragLeave,
    searchQuery,
  ]);

  return (
    <div
      className="flex flex-col border-r h-full select-none"
      style={{
        width: '240px',
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-sidebar)',
      }}
    >
      {/* Change Project Header Button */}
      <div
        className="p-2 border-b"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <Tooltip
          content="Changer de projet racine"
          as="button"
          onClick={async () => {
            // Fermer tous les onglets et désactiver le workspace actuel
            window.dispatchEvent(new CustomEvent('Leanna-workspace-changed', { detail: { workspace: null } }));
            
            // Désactiver le workspace côté serveur
            try {
              await fetch('/api/self-root/clear', { method: 'POST' });
            } catch (e) {
              console.error('[FileExplorer] Failed to clear workspace:', e);
            }
            
            // Ouvrir la modale de sélection
            window.dispatchEvent(new CustomEvent('Leanna-open-workspace-switcher'));
          }}
          className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors hover:opacity-90 shadow-sm"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
            color: 'var(--accent-primary)',
            border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)',
          }}
        >
          <FolderInput size={14} />
          <span>Changer de projet</span>
        </Tooltip>
      </div>

      {/* Explorer Header */}
      <div className="flex items-center justify-between border-b px-3.5" style={{ height: '35px', borderColor: 'var(--border-base)' }}>
        <div className="flex items-center gap-1.5">
          {sandboxActive ? (
            <span
              className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md font-bold"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}
              title="Mode Sandbox actif — les modifications sont isolées"
            >
              <Shield size={9} />
              MODE SANDBOX
            </span>
          ) : (
            <span
              className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md font-bold"
              style={{ backgroundColor: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', color: 'var(--text-muted)' }}
              title="Mode Sandbox inactif — modifications directes sur les fichiers locaux"
            >
              <Shield size={9} style={{ opacity: 0.6 }} />
              SANDBOX INACTIVE
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          {/* Search toggle */}
        </div>
      </div>

      {/* Search bar (animated) */}
      {showSearch && (
        <div
          className="flex items-center gap-1.5 border-b px-2.5 py-1.5"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
        >
          <Search size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filtrer les fichiers…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:opacity-40"
            style={{ color: 'var(--text-primary)' }}
          />
          {searchQuery && (
            <Tooltip content="Effacer" as="button" onClick={() => setSearchQuery('')} className="opacity-50 hover:opacity-100 transition">
              <X size={10} style={{ color: 'var(--text-muted)' }} />
            </Tooltip>
          )}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="border-b px-3.5 py-1.5" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}>
        <Tooltip content="Rechercher" as="button" onClick={toggleSearch} className="rounded p-1 hover:bg-white/5 transition"
          style={{ color: showSearch ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
            <Search size={12} />
        </Tooltip>
          {/* Sort cycling */}
          <button
            onClick={() => setSortMode(nextSort)}
            className="rounded p-1 hover:bg-white/5 transition"
            title={sortLabel(sortMode)}
            style={{ color: sortMode !== 'name-asc' ? 'var(--accent-primary)' : 'var(--text-muted)' }}
          >
            <SortIcon mode={sortMode} />
          </button>
          <Tooltip content="Nouveau fichier" as="button" onClick={onCreateFile} className="rounded p-1 hover:bg-white/5 transition">
            <Plus size={12} style={{ color: 'var(--text-muted)' }} />
          </Tooltip>
          <Tooltip content="Actualiser" as="button" onClick={onRefresh} className="rounded p-1 hover:bg-white/5 transition">
            <RefreshCw size={12} style={{ color: 'var(--text-muted)' }} />
          </Tooltip>
      </div>

      {/* Sort mode indicator (when not default) */}
      {sortMode !== 'name-asc' && !searchQuery && (
        <div
          className="flex items-center gap-1 px-3 py-0.5 text-xs border-b"
          style={{
            borderColor: 'var(--border-base)',
            backgroundColor: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
            color: 'var(--accent-primary)',
          }}
        >
          <SortIcon mode={sortMode} />
          <span>{sortLabel(sortMode)}</span>
          <Tooltip content="Réinitialiser le tri" as="button" className="ml-auto opacity-60 hover:opacity-100 transition"
            onClick={() => setSortMode('name-asc')}
          >
            <X size={9} />
          </Tooltip>
        </div>
      )}

      {/* Search result count */}
      {searchQuery && (
        <div
          className="px-3 py-0.5 text-xs border-b"
          style={{
            borderColor: 'var(--border-base)',
            color: 'var(--text-muted)',
            backgroundColor: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)',
          }}
        >
          {countEntries(processedTree)} résultat{countEntries(processedTree) !== 1 ? 's' : ''} pour «{searchQuery}»
        </div>
      )}

      {/* Tree View Container */}
      <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {loading ? (
          /* Skeleton tree view loaders */
          <div className="space-y-1.5 px-3.5 py-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2" style={{ paddingLeft: `${8 + (i % 3) * 12}px` }}>
                <div className="skeleton w-3 h-3 rounded flex-shrink-0 opacity-40" />
                <div className="skeleton h-2.5 rounded flex-1 opacity-30" style={{ maxWidth: `${60 + Math.random() * 85}px` }} />
              </div>
            ))}
          </div>
        ) : processedTree.length === 0 && !searchQuery ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div
              className="w-8 h-8 rounded flex items-center justify-center mb-2.5"
              style={{ backgroundColor: 'var(--accent-subtle)' }}
            >
              <Folder size={16} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Aucun fichier
            </p>
            <p className="text-sm mb-3.5 leading-normal opacity-60" style={{ color: 'var(--text-muted)' }}>
              Ouvrez un projet ou créez un fichier pour commencer.
            </p>
            <button
              onClick={onCreateFile}
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-semibold transition hover:opacity-95"
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <Plus size={11} />
              Nouveau fichier
            </button>
          </div>
        ) : processedTree.length === 0 && searchQuery ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <Search size={20} className="mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-xs opacity-60" style={{ color: 'var(--text-muted)' }}>
              Aucun fichier ne correspond à «{searchQuery}»
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {processedTree.map((entry) => renderTreeEntry(entry))}
          </div>
        )}
      </div>
    </div>
  );
});

export { FileExplorer };