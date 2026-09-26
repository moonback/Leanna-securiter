import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from './FileIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import {
  Search, Command, Save, WrapText, Map, AlignJustify,
  X, ArrowUp, ArrowDown, CornerDownLeft,
} from 'lucide-react';
import { Modal } from '../ui/Modal.js';

// ── Auth helpers ───────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

// ── Types ──────────────────────────────────────────────────────────────────

type PaletteMode = 'files' | 'commands';

interface FileEntry { path: string; name: string; }

interface CommandEntry {
  id: string;
  label: string;
  description?: string;
  category?: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  mode: PaletteMode;
  openFiles: { path: string }[];
  onOpenFile: (path: string) => void;
  onClose: () => void;
  onSave: () => void;
  onFormat: () => void;
  onToggleMinimap: () => void;
  onToggleWordWrap: () => void;
  onToggleSettings: () => void;
  onShowDiff: () => void;
}

// ── Fuzzy match ────────────────────────────────────────────────────────────

function fuzzyMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let ni = 0;
  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (h[hi] === n[ni]) ni++;
  }
  return ni === n.length;
}

function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (h === n) return 100;
  if (h.includes(n)) return 80;
  const filename = h.split('/').pop() ?? h;
  if (filename.includes(n)) return 60;
  return 20;
}

// ── Component ──────────────────────────────────────────────────────────────

export function CommandPalette({
  mode: initialMode,
  openFiles,
  onOpenFile,
  onClose,
  onSave,
  onFormat,
  onToggleMinimap,
  onToggleWordWrap,
  onToggleSettings,
  onShowDiff,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState('');
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setSelectedIndex(0);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'files') return;
    const fetchFiles = async () => {
      try {
        const response = await fetch('/api/ide/tree', { headers: getAuthHeaders() });
        if (!response.ok) return;
        const data = await response.json();
        const files: FileEntry[] = [];
        const walk = (entries: any[]) => {
          for (const e of entries) {
            if (e.type === 'file') files.push({ path: e.path, name: e.name });
            else if (e.children) walk(e.children);
          }
        };
        walk(data.entries ?? []);
        setAllFiles(files);
      } catch { /* silent */ }
    };
    fetchFiles();
  }, [mode]);

  const commands = useMemo<CommandEntry[]>(() => [
    { id: 'save',           label: 'Sauvegarder',              description: 'Sauvegarder le fichier actif',                      category: 'Fichier',     icon: <Save size={14} />,        shortcut: 'Ctrl+S',    action: () => { onSave();            onClose(); } },
    { id: 'format',         label: 'Formater le document',     description: 'Formater le fichier actif avec Prettier',           category: 'Fichier',     icon: <AlignJustify size={14} />, shortcut: 'Shift+Alt+F', action: () => { onFormat();         onClose(); } },
    { id: 'toggle-minimap', label: 'Basculer la minimap',      description: 'Afficher ou masquer la minimap',                    category: 'Affichage',   icon: <Map size={14} />,                                action: () => { onToggleMinimap();  onClose(); } },
    { id: 'toggle-wrap',    label: 'Basculer le retour ligne', description: 'Activer ou désactiver le word wrap',                category: 'Affichage',   icon: <WrapText size={14} />,    shortcut: 'Alt+Z',     action: () => { onToggleWordWrap(); onClose(); } },
    { id: 'settings',       label: "Paramètres de l'éditeur",  description: 'Ouvrir le panneau de paramètres',                   category: 'Préférences', icon: <Command size={14} />,                           action: () => { onToggleSettings(); onClose(); } },
    { id: 'diff',           label: 'Voir les différences',     description: 'Comparer le fichier actif avec la version sauvegardée', category: 'Fichier', icon: <Search size={14} />,                            action: () => { onShowDiff();       onClose(); } },
  ], [onSave, onFormat, onToggleMinimap, onToggleWordWrap, onToggleSettings, onShowDiff, onClose]);

  const results = useMemo(() => {
    if (mode === 'files') {
      return allFiles
        .filter(f => fuzzyMatch(query, f.path))
        .sort((a, b) => fuzzyScore(query, b.path) - fuzzyScore(query, a.path))
        .slice(0, 20);
    }
    return commands.filter(c => fuzzyMatch(query, c.label) || fuzzyMatch(query, c.description ?? ''));
  }, [mode, query, allFiles, commands]);

  useEffect(() => { setSelectedIndex(0); }, [results.length, query]);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback((index: number) => {
    if (mode === 'files') {
      const file = results[index] as FileEntry | undefined;
      if (file) { onOpenFile(file.path); onClose(); }
    } else {
      const cmd = results[index] as CommandEntry | undefined;
      if (cmd) cmd.action();
    }
  }, [mode, results, onOpenFile, onClose]);

  // Keyboard nav inside the input — does NOT conflict with Modal's Escape stack
  // because Modal's useEscapeStack fires first (LIFO) and calls onClose before
  // this handler would see Escape.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(selectedIndex);
    }
    // Escape is handled by Modal's useEscapeStack → onClose
  }, [results.length, selectedIndex, handleSelect]);

  return (
    <Modal open onClose={onClose} size="md" tone="default" hideClose>
      {/* Mode tabs + search — en tant que Modal.Header personnalisé */}
      <Modal.Header>
        <div className="flex-1 flex flex-col gap-0 -mx-1">
          {/* Tab row */}
          <div className="flex items-center border-b" style={{ borderColor: 'var(--border-base)', marginBottom: 0 }}>
            <button
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition border-b-2 ${mode === 'files' ? 'border-[var(--accent-primary)]' : 'border-transparent opacity-60 hover:opacity-100'}`}
              style={{ color: 'var(--text-primary)' }}
              aria-label="Rechercher un fichier (Ctrl+P)"
              onClick={() => { setMode('files'); setQuery(''); }}
            >
              <Search size={12} aria-hidden /> Fichiers
              <span className="ml-1 opacity-50">Ctrl+P</span>
            </button>
            <button
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition border-b-2 ${mode === 'commands' ? 'border-[var(--accent-primary)]' : 'border-transparent opacity-60 hover:opacity-100'}`}
              style={{ color: 'var(--text-primary)' }}
              aria-label="Exécuter une commande (Ctrl+Shift+P)"
              onClick={() => { setMode('commands'); setQuery(''); }}
            >
              <Command size={12} aria-hidden /> Commandes
              <span className="ml-1 opacity-50">Ctrl+Shift+P</span>
            </button>
          </div>

          {/* Search input */}
          <div className="flex items-center gap-2 pt-3">
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'files' ? 'Chercher un fichier...' : 'Chercher une commande...'}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
              aria-label={mode === 'files' ? 'Chercher un fichier' : 'Chercher une commande'}
              aria-autocomplete="list"
            />
            {query && (
              <Tooltip content="Effacer" as="button" onClick={() => setQuery('')} className="rounded p-0.5 hover:bg-white/10" aria-label="Effacer la recherche">
                <X size={12} style={{ color: 'var(--text-muted)' }} />
              </Tooltip>
            )}
          </div>
        </div>
      </Modal.Header>

      {/* Results */}
      <Modal.Body noPadding>
        <div ref={listRef} className="py-1" role="listbox" aria-label="Résultats">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Aucun résultat pour «{query}»
            </div>
          ) : mode === 'files' ? (
            (results as FileEntry[]).map((file, i) => (
              <button
                key={file.path}
                role="option"
                aria-selected={i === selectedIndex}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${i === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'}`}
                onClick={() => handleSelect(i)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <FileIcon filePath={file.path} size={14} />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{file.name}</span>
                  <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{file.path}</span>
                </div>
              </button>
            ))
          ) : (
            (() => {
              const grouped: { category: string; items: { cmd: CommandEntry; globalIndex: number }[] }[] = [];
              let flatIndex = 0;
              (results as CommandEntry[]).forEach((cmd) => {
                const cat = cmd.category || 'Autres';
                let group = grouped.find(g => g.category === cat);
                if (!group) { group = { category: cat, items: [] }; grouped.push(group); }
                group.items.push({ cmd, globalIndex: flatIndex });
                flatIndex++;
              });
              return grouped.map((group) => (
                <div key={group.category}>
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                      {group.category}
                    </span>
                  </div>
                  {group.items.map(({ cmd, globalIndex: i }) => (
                    <button
                      key={cmd.id}
                      role="option"
                      aria-selected={i === selectedIndex}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${i === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'}`}
                      onClick={() => handleSelect(i)}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>{cmd.icon}</span>
                      <div className="flex flex-1 flex-col min-w-0">
                        <span style={{ color: 'var(--text-primary)' }}>{cmd.label}</span>
                        {cmd.description && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{cmd.description}</span>
                        )}
                      </div>
                      {cmd.shortcut && (
                        <kbd className="px-1.5 py-0.5 text-sm" style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}>
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  ))}
                </div>
              ));
            })()
          )}
        </div>
      </Modal.Body>

      {/* Footer hint */}
      <Modal.Footer align="between">
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="flex items-center gap-1"><ArrowUp size={10} aria-hidden /><ArrowDown size={10} aria-hidden /> naviguer</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={10} aria-hidden /> ouvrir</span>
          <span className="flex items-center gap-1">
            <kbd className="rounded px-1 py-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>Esc</kbd> fermer
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {results.length} résultat{results.length !== 1 ? 's' : ''}
        </span>
      </Modal.Footer>
    </Modal>
  );
}
