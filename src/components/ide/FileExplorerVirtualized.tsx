import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Folder, FolderOpen, Plus, RefreshCcw, ChevronRight, ChevronDown, ChevronUp,
  Shield, Search, X, ArrowDownAZ, ArrowUpZA, Layers, GripVertical,
  Eye, EyeOff, FolderInput, ShieldOff,
} from 'lucide-react';
import { FileIcon } from './FileIcon.js';
import { LeannaIgnoreModal } from './LeannaIgnoreModal.js';
import type { TreeEntry } from '../../types/ide.js';
import Tree from 'react-window-tree';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

type SortMode = 'name-asc' | 'name-desc' | 'type';

export type DiffInfo = {
  status: 'added' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
};

type FileExplorerProps = {
  tree: TreeEntry[];
  workspaceTree?: TreeEntry[];
  diffPaths?: Map<string, DiffInfo>;
  expandedDirs: Set<string>;
  loading: boolean;
  currentDir: string;
  /** Largeur du panneau en pixels (260 par défaut). */
  width?: number;
  onOpenFile: (path: string) => void;
  onOpenFileDiff?: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onLoadDirectory?: (path: string) => void;
  onLoadWorkspaceDirectory?: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
  onCreateFile: () => void;
  onRefresh: () => void;
  onNavigate: (dir: string) => void;
  onMoveEntry?: (srcPath: string, destDir: string) => void;
};

interface DataNode {
  key: string;
  title: React.ReactNode;
  children?: DataNode[];
  isLeaf?: boolean;
  originalEntry: TreeEntry;
}

type TreeProps = {
  treeData: DataNode[];
  height: number;
  itemHeight: number;
  virtual: boolean;
  showLine: boolean;
  expandedKeys: React.Key[];
  onExpand: (keys: React.Key[]) => void;
  selectable: boolean;
  defaultExpandParent: boolean;
  prefixCls: string;
};

const TreeComponent = Tree as unknown as React.ComponentType<TreeProps>;

type DragHandlers = {
  onDragStart: (e: React.DragEvent, entry: TreeEntry) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, entry: TreeEntry) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, entry: TreeEntry) => void;
};

// ════════════════════════════════════════════════════════════════════════════
// Constantes
// ════════════════════════════════════════════════════════════════════════════

const SORT_MODES: SortMode[] = ['name-asc', 'name-desc', 'type'];
const ROW_HEIGHT = 28;
const INDENT = 16;
const DEFAULT_WIDTH = 260;
const SANDBOX_POLL_MS = 3000;
const SANDBOX_EVENT_DEBOUNCE_MS = 150;
const SEARCH_DEBOUNCE_MS = 200;
const DRAG_EXPAND_DELAY_MS = 700;
const WORKSPACE_MIN_HEIGHT = 120;
const PREFS_KEY = 'leanna.fileExplorer.prefs';

// Largeurs fixes : évite le scintillement d'un Math.random() à chaque rendu.
const SKELETON_WIDTHS = [96, 130, 84, 148, 72, 118, 104, 140, 90, 124];

const EVENTS = {
  workspaceChanged: 'Leanna-workspace-changed',
  openWorkspaceSwitcher: 'Leanna-open-workspace-switcher',
  sandboxChanged: 'Leanna-sandbox-changed',
  sandboxFileChanged: 'Leanna-sandbox-file-changed',
} as const;

const STATUS_COLOR: Record<DiffInfo['status'], string> = {
  added: 'var(--color-success)',
  modified: 'var(--color-warning)',
  deleted: 'var(--color-error)',
};

const STATUS_LETTER: Record<DiffInfo['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
};

const LABELS = {
  explorer: 'Explorer',
  root: 'Racine',
  switchProject: 'Changer de projet racine',
  ignore: "Chemins interdits à l'agent (.leannaignore)",
  parent: 'Parent',
  parentTitle: "Remonter d'un niveau",
  search: 'Rechercher (Ctrl/Cmd+Shift+F)',
  searchPlaceholder: 'Filtrer les fichiers…',
  clear: 'Effacer',
  closeSearch: 'Fermer la recherche',
  showHidden: 'Afficher les fichiers cachés',
  hideHidden: 'Masquer les fichiers cachés',
  newFile: 'Nouveau fichier',
  refresh: 'Actualiser',
  resetSort: 'Réinitialiser le tri',
  sandboxOn: 'Mode Sandbox actif',
  sandboxOff: 'Mode Sandbox inactif',
  realFolders: 'Dossiers Réels',
  reviewHint: 'Cliquez sur un fichier pour examiner et valider les modifications',
  allValidated: 'Tous les fichiers sont validés et synchronisés sur le workspace réel',
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Helpers purs
// ════════════════════════════════════════════════════════════════════════════

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

const mix = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const getExt = (name: string) => {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
};

const parentPath = (p: string) => {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
};

function sortLabel(mode: SortMode): string {
  if (mode === 'name-asc') return 'Tri : A→Z';
  if (mode === 'name-desc') return 'Tri : Z→A';
  return 'Tri : Type';
}

function nextSort(mode: SortMode): SortMode {
  if (mode === 'name-asc') return 'name-desc';
  if (mode === 'name-desc') return 'type';
  return 'name-asc';
}

/** Un dossier peut-il être la destination de `src` ? (aucun no-op, aucune boucle) */
function canDropInto(src: string | null, dest: string): boolean {
  if (!src) return true; // glisser venant d'ailleurs : on laisse le drop décider
  if (src === dest) return false;
  if (dest.startsWith(`${src}/`)) return false; // dossier dans son propre sous-arbre
  if (parentPath(src) === dest) return false; // déjà dans ce dossier
  return true;
}

function sortEntries(entries: TreeEntry[], mode: SortMode): TreeEntry[] {
  const dirs = entries.filter(e => e.type === 'directory');
  const files = entries.filter(e => e.type === 'file');
  const byName = (a: TreeEntry, b: TreeEntry) => collator.compare(a.name, b.name);

  switch (mode) {
    case 'name-asc':
      return [...dirs.sort(byName), ...files.sort(byName)];
    case 'name-desc':
      return [...dirs.sort((a, b) => byName(b, a)), ...files.sort((a, b) => byName(b, a))];
    case 'type':
      return [
        ...dirs.sort(byName),
        ...files.sort((a, b) => collator.compare(getExt(a.name), getExt(b.name)) || byName(a, b)),
      ];
  }
}

// ── Diffs ───────────────────────────────────────────────────────────────────

type DiffLookup = { size: number; get: (path: string) => DiffInfo | undefined };

const normalizePath = (p: string) =>
  p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase().trim();

const toSegments = (p: string) => normalizePath(p).split('/').filter(Boolean);

/**
 * Indexe une seule fois les chemins de diff. Chaque recherche coûte ensuite
 * O(profondeur) au lieu de O(nombre de diffs), et la correspondance se fait
 * uniquement sur des frontières de segments (fini les faux positifs par
 * simple `includes`).
 */
function createDiffLookup(diffs?: Map<string, DiffInfo>): DiffLookup | undefined {
  if (!diffs || diffs.size === 0) return undefined;

  const exact = new Map<string, DiffInfo>();
  const tails = new Map<string, DiffInfo>(); // suffixes des clés (clé plus longue que la cible)

  for (const [key, value] of diffs) {
    const segs = toSegments(key);
    if (segs.length === 0) continue;
    exact.set(segs.join('/'), value);
    for (let i = 1; i < segs.length; i++) {
      const tail = segs.slice(i).join('/');
      if (!tails.has(tail)) tails.set(tail, value);
    }
  }

  return {
    size: diffs.size,
    get(path) {
      const segs = toSegments(path);
      if (segs.length === 0) return undefined;
      const full = segs.join('/');
      const direct = exact.get(full) ?? tails.get(full);
      if (direct) return direct;
      // clé plus courte que la cible : on teste chaque suffixe de la cible
      for (let i = 1; i < segs.length; i++) {
        const hit = exact.get(segs.slice(i).join('/'));
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

function sameDiffs(a: Map<string, DiffInfo>, b: Map<string, DiffInfo>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, va] of a) {
    const vb = b.get(key);
    if (!vb || va.status !== vb.status || va.additions !== vb.additions || va.deletions !== vb.deletions) {
      return false;
    }
  }
  return true;
}

/** Nombre de fichiers modifiés sous chaque dossier (une seule passe). */
function collectDirChangeCounts(
  entries: TreeEntry[],
  lookup: DiffLookup | undefined,
  out: Map<string, number> = new Map(),
): Map<string, number> {
  const walk = (list: TreeEntry[]): number => {
    let total = 0;
    for (const e of list) {
      if (e.type === 'file') {
        if (lookup?.get(e.path)) total++;
      } else {
        const n = walk(e.children ?? []);
        if (n > 0) out.set(e.path, n);
        total += n;
      }
    }
    return total;
  };
  if (lookup) walk(entries);
  return out;
}

// ── Filtrage + tri en une passe ─────────────────────────────────────────────

type PrepareOptions = {
  query: string;
  showHidden: boolean;
  sortMode: SortMode;
  /** Si défini, seuls les fichiers présents dans les diffs sont conservés. */
  onlyDiffs?: DiffLookup;
};

/**
 * Filtre (fichiers cachés, recherche, diffs) puis trie à chaque niveau.
 * Quand un dossier correspond à la recherche, tout son contenu reste visible.
 */
function prepareTree(entries: TreeEntry[], opts: PrepareOptions): TreeEntry[] {
  const { showHidden, sortMode, onlyDiffs } = opts;
  const q = opts.query.toLowerCase();

  const visit = (list: TreeEntry[], inheritedMatch: boolean): TreeEntry[] => {
    const out: TreeEntry[] = [];
    for (const entry of list) {
      if (!showHidden && entry.name.startsWith('.')) continue;

      const matched = inheritedMatch || (q !== '' && entry.name.toLowerCase().includes(q));
      const queryOk = q === '' || matched;

      if (entry.type === 'directory') {
        const children = entry.children ? visit(entry.children, matched) : undefined;
        const hasVisibleChildren = !!children && children.length > 0;
        if (hasVisibleChildren || (!onlyDiffs && queryOk)) {
          out.push(children ? { ...entry, children } : entry);
        }
      } else if (queryOk && (!onlyDiffs || onlyDiffs.get(entry.path))) {
        out.push(entry);
      }
    }
    return sortEntries(out, sortMode);
  };

  return visit(entries, false);
}

function countFiles(entries: TreeEntry[]): number {
  return entries.reduce(
    (acc, e) => (e.type === 'file' ? acc + 1 : acc + countFiles(e.children ?? [])),
    0,
  );
}

/** Dossiers à déployer automatiquement : ceux qui contiennent un vrai résultat. */
function collectSearchExpanded(entries: TreeEntry[], q: string, out: Set<string>): boolean {
  let found = false;
  for (const e of entries) {
    const self = e.name.toLowerCase().includes(q);
    const below = e.type === 'directory' && e.children
      ? collectSearchExpanded(e.children, q, out)
      : false;
    if (below) out.add(e.path);
    if (self || below) found = true;
  }
  return found;
}

// ── Préférences persistées ──────────────────────────────────────────────────

function readPrefs(): { sortMode: SortMode; showHidden: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        sortMode: SORT_MODES.includes(parsed.sortMode) ? parsed.sortMode : 'name-asc',
        showHidden: Boolean(parsed.showHidden),
      };
    }
  } catch { /* stockage indisponible ou JSON invalide */ }
  return { sortMode: 'name-asc', showHidden: false };
}

// ════════════════════════════════════════════════════════════════════════════
// Hooks
// ════════════════════════════════════════════════════════════════════════════

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Mesure la hauteur d'un élément (ref-callback : fonctionne avec un montage conditionnel). */
function useElementHeight(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!el) return;
    setHeight(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const h = Math.floor(entries[0].contentRect.height);
      setHeight(prev => (prev === h ? prev : h));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return [setEl, height];
}

// ── Sandbox ─────────────────────────────────────────────────────────────────

type SandboxState = {
  active: boolean;
  modifiedCount: number;
  diffs: Map<string, DiffInfo>;
};

const INITIAL_SANDBOX: SandboxState = { active: false, modifiedCount: 0, diffs: new Map() };

let sandboxApiPromise: Promise<typeof import('../../services/sandboxApi.js')> | null = null;
function loadSandboxApi() {
  if (!sandboxApiPromise) {
    sandboxApiPromise = import('../../services/sandboxApi.js').catch(err => {
      sandboxApiPromise = null; // permet de réessayer plus tard
      throw err;
    });
  }
  return sandboxApiPromise;
}

/**
 * Statut + diffs du sandbox.
 * - import dynamique mis en cache (au lieu d'un import par tick)
 * - polling suspendu quand l'onglet est masqué
 * - l'état n'est remplacé que si les données ont réellement changé, ce qui
 *   évite de reconstruire tout l'arbre toutes les 3 secondes
 */
function useSandboxState(): SandboxState {
  const [state, setState] = useState<SandboxState>(INITIAL_SANDBOX);

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const { sandboxApi } = await loadSandboxApi();
        const [statusData, diffData] = await Promise.all([
          sandboxApi.getStatus(true),
          sandboxApi.getDiff(true),
        ]);
        if (!mounted) return;

        const status = statusData as any;
        const diff = diffData as any;

        setState(prev => {
          const ok = status.status === 'success';
          const active = ok ? Boolean(status.sandbox?.active) : prev.active;
          const modifiedCount = ok ? Number(status.sandbox?.modifiedCount ?? 0) : prev.modifiedCount;

          let diffs = prev.diffs;
          if (diff.status === 'success' && Array.isArray(diff.diff)) {
            const next = new Map<string, DiffInfo>();
            for (const item of diff.diff) {
              next.set(item.path, {
                status: item.status,
                additions: item.additions ?? 0,
                deletions: item.deletions ?? 0,
              });
            }
            if (!sameDiffs(prev.diffs, next)) diffs = next;
          }

          if (active === prev.active && modifiedCount === prev.modifiedCount && diffs === prev.diffs) {
            return prev;
          }
          return { active, modifiedCount, diffs };
        });
      } catch {
        /* silencieux : le prochain tick réessaiera */
      } finally {
        inFlight = false;
      }
    };

    const scheduleCheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(check, SANDBOX_EVENT_DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (!document.hidden) check();
    };

    check();
    const interval = setInterval(check, SANDBOX_POLL_MS);
    window.addEventListener(EVENTS.sandboxChanged, scheduleCheck);
    window.addEventListener(EVENTS.sandboxFileChanged, scheduleCheck);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener(EVENTS.sandboxChanged, scheduleCheck);
      window.removeEventListener(EVENTS.sandboxFileChanged, scheduleCheck);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return state;
}

// ── Expansion ───────────────────────────────────────────────────────────────

/**
 * Relie l'état d'expansion à `react-window-tree`.
 * `onExpand` reçoit la liste COMPLÈTE des clés ouvertes : on ne bascule donc
 * que la différence (l'ancien code basculait toutes les clés, ce qui refermait
 * les dossiers déjà ouverts).
 */
function useTreeExpansion(
  expanded: Set<string>,
  toggle: (path: string, willExpand: boolean) => void,
) {
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const expandedKeys = useMemo(() => Array.from(expanded), [expanded]);

  const onExpand = useCallback((keys: React.Key[]) => {
    const next = new Set(keys.map(String));
    const current = expandedRef.current;
    next.forEach(k => { if (!current.has(k)) toggle(k, true); });
    current.forEach(k => { if (!next.has(k)) toggle(k, false); });
  }, [toggle]);

  const activate = useCallback(
    (path: string) => toggle(path, !expandedRef.current.has(path)),
    [toggle],
  );

  return { expandedKeys, onExpand, activate };
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

function useTreeDragAndDrop({
  onMoveEntry,
  isExpanded,
  expand,
}: {
  onMoveEntry?: (srcPath: string, destDir: string) => void;
  isExpanded: (path: string) => boolean;
  expand: (path: string) => void;
}) {
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setOver = useCallback((path: string | null) => {
    overRef.current = path;
    setDragOverPath(path);
  }, []);

  const reset = useCallback(() => {
    draggingRef.current = null;
    setDraggingPath(null);
    setOver(null);
    clearTimer();
  }, [clearTimer, setOver]);

  useEffect(() => clearTimer, [clearTimer]);

  const handlers = useMemo<DragHandlers>(() => ({
    onDragStart: (e, entry) => {
      draggingRef.current = entry.path;
      setDraggingPath(entry.path);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', entry.path);
    },
    onDragEnd: reset,
    onDragOver: (e, entry) => {
      if (entry.type !== 'directory' || !canDropInto(draggingRef.current, entry.path)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overRef.current === entry.path) return;

      clearTimer();
      setOver(entry.path);
      // Comme dans VS Code : survoler un dossier fermé l'ouvre après un court délai.
      if (!isExpanded(entry.path)) {
        timerRef.current = setTimeout(() => expand(entry.path), DRAG_EXPAND_DELAY_MS);
      }
    },
    onDragLeave: e => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
        clearTimer();
        setOver(null);
      }
    },
    onDrop: (e, entry) => {
      e.preventDefault();
      const src = draggingRef.current ?? e.dataTransfer.getData('text/plain');
      reset();
      if (entry.type !== 'directory' || !src || !canDropInto(src, entry.path)) return;
      onMoveEntry?.(src, entry.path);
    },
  }), [clearTimer, setOver, reset, isExpanded, expand, onMoveEntry]);

  return { draggingPath, dragOverPath, handlers };
}

// ════════════════════════════════════════════════════════════════════════════
// Composants de présentation
// ════════════════════════════════════════════════════════════════════════════

function SortIcon({ mode }: { mode: SortMode }) {
  if (mode === 'name-asc') return <ArrowDownAZ size={12} />;
  if (mode === 'name-desc') return <ArrowUpZA size={12} />;
  return <Layers size={12} />;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const idx = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          backgroundColor: mix('var(--accent-primary)', 30),
          color: 'inherit',
          borderRadius: '2px',
          padding: '0 2px',
        }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function Pill({
  color,
  children,
  title,
  className = '',
}: {
  color: string;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${className}`}
      style={{
        color,
        backgroundColor: mix(color, 15),
        border: `1px solid ${mix(color, 30)}`,
      }}
    >
      {children}
    </span>
  );
}

function ToolbarButton({
  label,
  onClick,
  active = false,
  pressed,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`rounded-md p-1.5 transition-all duration-200 hover:bg-[var(--bg-panel)] hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${
        active ? 'bg-[var(--bg-panel)]' : ''
      } ${className}`}
      style={{ color: active ? 'var(--accent-primary)' : 'var(--text-muted)' }}
    >
      {children}
    </button>
  );
}

function SandboxBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${active ? 'shadow-sm' : ''}`}
      style={
        active
          ? {
              backgroundColor: mix('var(--color-success)', 15),
              color: 'var(--color-success)',
              border: `1px solid ${mix('var(--color-success)', 30)}`,
            }
          : {
              backgroundColor: 'var(--bg-panel)',
              color: 'var(--text-dimmed)',
              border: '1px solid var(--border-base)',
            }
      }
      title={active ? LABELS.sandboxOn : LABELS.sandboxOff}
    >
      <Shield size={10} />
      SBX
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
  action?: { label: string; icon?: React.ReactNode; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
        style={{ backgroundColor: mix('var(--accent-primary)', 12) }}
      >
        <Icon size={28} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      <p className="text-sm mb-5 leading-relaxed opacity-60" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition hover:shadow-lg hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="space-y-2 px-3 py-3" aria-busy="true" aria-live="polite">
      {SKELETON_WIDTHS.map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-2 animate-pulse"
          style={{ paddingLeft: `${8 + (i % 5) * 14}px` }}
        >
          <div className="w-4 h-4 rounded-md flex-shrink-0" style={{ background: 'var(--bg-input)' }} />
          <div className="h-2.5 rounded-md flex-1" style={{ background: 'var(--bg-input)', maxWidth: `${w}px` }} />
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Ligne de l'arbre
// ════════════════════════════════════════════════════════════════════════════

type RowContextValue = {
  query: string;
  dragOverPath: string | null;
  draggingPath: string | null;
  /** Absent = lignes non déplaçables (ex. arbre « Dossiers Réels »). */
  dnd?: DragHandlers;
  onActivateFile: (path: string) => void;
  onActivateDirectory: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
};

const RowContext = createContext<RowContextValue | null>(null);

function useRowContext(): RowContextValue {
  const ctx = useContext(RowContext);
  if (!ctx) throw new Error('TreeRow doit être rendu dans un <RowContext.Provider>');
  return ctx;
}

function focusSiblingRow(el: HTMLElement, delta: 1 | -1) {
  const container = el.closest('[data-explorer-tree]');
  if (!container) return;
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  rows[rows.indexOf(el) + delta]?.focus();
}

function DiffStats({ diff }: { diff: DiffInfo }) {
  const additions = diff.additions ?? 0;
  const deletions = diff.deletions ?? 0;
  const color = STATUS_COLOR[diff.status];

  return (
    <div className="ml-auto flex items-center gap-1 text-xs font-mono shrink-0 pl-2">
      {additions > 0 && (
        <span
          className="font-bold px-1.5 py-0.5 rounded"
          style={{
            color: 'var(--color-success)',
            backgroundColor: mix('var(--color-success)', 15),
            border: `1px solid ${mix('var(--color-success)', 25)}`,
          }}
          title={`${additions} ${plural(additions, 'ligne ajoutée')}`}
        >
          +{additions}
        </span>
      )}
      {deletions > 0 && (
        <span
          className="font-bold px-1.5 py-0.5 rounded"
          style={{
            color: 'var(--color-error)',
            backgroundColor: mix('var(--color-error)', 15),
            border: `1px solid ${mix('var(--color-error)', 25)}`,
          }}
          title={`${deletions} ${plural(deletions, 'ligne retirée')}`}
        >
          −{deletions}
        </span>
      )}
      {additions === 0 && deletions === 0 && (
        <span
          className="font-bold uppercase px-1.5 py-0.5 rounded"
          style={{
            color,
            backgroundColor: mix(color, 18),
            border: `1px solid ${mix(color, 30)}`,
          }}
        >
          {STATUS_LETTER[diff.status]}
        </span>
      )}
    </div>
  );
}

type TreeRowProps = {
  entry: TreeEntry;
  depth: number;
  isExpanded: boolean;
  diff?: DiffInfo;
  changedCount: number;
};

const TreeRow = memo(function TreeRow({ entry, depth, isExpanded, diff, changedCount }: TreeRowProps) {
  const ctx = useRowContext();
  const { dnd } = ctx;

  const isDir = entry.type === 'directory';
  const isDragTarget = ctx.dragOverPath === entry.path;
  const isDragging = ctx.draggingPath === entry.path;
  const status = diff?.status;
  const color = status ? STATUS_COLOR[status] : undefined;

  const rowBg = isDragTarget
    ? mix('var(--accent-primary)', 20)
    : color
      ? mix(color, 10)
      : 'transparent';

  const activate = () => {
    if (isDir) ctx.onActivateDirectory(entry.path);
    else ctx.onActivateFile(entry.path);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        activate();
        break;
      case 'ArrowRight':
        if (isDir && !isExpanded) { e.preventDefault(); activate(); }
        break;
      case 'ArrowLeft':
        if (isDir && isExpanded) { e.preventDefault(); activate(); }
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        focusSiblingRow(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
        break;
    }
  };

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-level={depth + 1}
      aria-expanded={isDir ? isExpanded : undefined}
      className="flex items-center gap-1.5 px-2 text-sm cursor-pointer select-none relative group rounded-md bg-[var(--row-bg)] hover:bg-[var(--bg-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      style={
        {
          '--row-bg': rowBg, // variable CSS : l'état :hover reste possible (un style inline l'écraserait)
          height: ROW_HEIGHT,
          paddingLeft: `${12 + depth * INDENT}px`,
          color: color ?? 'var(--text-primary)',
          opacity: isDragging ? 0.5 : 1,
          boxShadow: isDragTarget ? 'inset 0 0 0 2px var(--accent-primary)' : 'none',
          transition: 'background-color 0.15s, box-shadow 0.15s, opacity 0.15s',
        } as React.CSSProperties
      }
      onClick={activate}
      onKeyDown={handleKeyDown}
      onContextMenu={e => ctx.onContextMenu(e, entry)}
      draggable={!!dnd}
      onDragStart={dnd ? e => dnd.onDragStart(e, entry) : undefined}
      onDragEnd={dnd?.onDragEnd}
      onDragOver={dnd ? e => dnd.onDragOver(e, entry) : undefined}
      onDragLeave={dnd?.onDragLeave}
      onDrop={dnd ? e => dnd.onDrop(e, entry) : undefined}
    >
      {dnd && (
        <span
          aria-hidden="true"
          className="opacity-0 group-hover:opacity-40 transition-opacity absolute"
          style={{ left: `${depth * INDENT + 4}px` }}
        >
          <GripVertical size={12} />
        </span>
      )}

      {isDir ? (
        <span
          aria-hidden="true"
          className="opacity-60 group-hover:opacity-100 mr-0.5 transition-transform duration-200"
          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRight size={14} />
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {status && (
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full shrink-0 shadow-sm"
            style={{ backgroundColor: color }}
          />
        )}

        {isDir ? (
          isDragTarget || isExpanded ? (
            <FolderOpen size={16} style={{ color: color ?? 'var(--accent-primary)' }} />
          ) : (
            <Folder size={16} style={{ color: color ?? 'var(--accent-primary)' }} />
          )
        ) : (
          <FileIcon filePath={entry.path} size={16} />
        )}

        <span
          className={`truncate ${status ? 'font-medium' : 'font-normal'}`}
          title={entry.path}
        >
          {ctx.query ? <HighlightMatch text={entry.name} query={ctx.query} /> : entry.name}
        </span>

        {/* Dossier replié : résume le nombre de fichiers modifiés qu'il contient */}
        {isDir && !isExpanded && changedCount > 0 && (
          <span
            className="ml-auto shrink-0 text-xs font-medium px-1.5 rounded-full"
            style={{
              color: 'var(--color-warning)',
              backgroundColor: mix('var(--color-warning)', 18),
            }}
            title={`${changedCount} ${plural(changedCount, 'fichier modifié', 'fichiers modifiés')}`}
          >
            {changedCount}
          </span>
        )}

        {diff && <DiffStats diff={diff} />}
      </div>
    </div>
  );
});

// ── Construction des nœuds ──────────────────────────────────────────────────

function buildNodes(
  entries: TreeEntry[],
  depth: number,
  expanded: Set<string>,
  lookup: DiffLookup | undefined,
  dirChangeCounts: Map<string, number>,
): DataNode[] {
  return entries.map(entry => {
    const isDir = entry.type === 'directory';
    const isExpanded = isDir && expanded.has(entry.path);

    return {
      key: entry.path,
      title: (
        <TreeRow
          entry={entry}
          depth={depth}
          isExpanded={isExpanded}
          diff={isDir ? undefined : lookup?.get(entry.path)}
          changedCount={dirChangeCounts.get(entry.path) ?? 0}
        />
      ),
      children:
        isExpanded && entry.children && entry.children.length > 0
          ? buildNodes(entry.children, depth + 1, expanded, lookup, dirChangeCounts)
          : undefined,
      isLeaf: !isDir,
      originalEntry: entry,
    };
  });
}

const ExplorerTree = memo(function ExplorerTree({
  nodes,
  height,
  expandedKeys,
  onExpand,
  rowContext,
}: {
  nodes: DataNode[];
  height: number;
  expandedKeys: React.Key[];
  onExpand: (keys: React.Key[]) => void;
  rowContext: RowContextValue;
}) {
  return (
    <RowContext.Provider value={rowContext}>
      <div data-explorer-tree>
        <TreeComponent
          treeData={nodes}
          height={height}
          itemHeight={ROW_HEIGHT}
          virtual
          showLine
          expandedKeys={expandedKeys}
          onExpand={onExpand}
          selectable={false}
          defaultExpandParent
          prefixCls="rc-tree"
        />
      </div>
    </RowContext.Provider>
  );
});

// ════════════════════════════════════════════════════════════════════════════
// Composant principal
// ════════════════════════════════════════════════════════════════════════════

const FileExplorer = memo(function FileExplorer({
  tree,
  workspaceTree,
  diffPaths,
  expandedDirs,
  loading,
  currentDir,
  width = DEFAULT_WIDTH,
  onOpenFile,
  onOpenFileDiff,
  onToggleDirectory,
  onLoadDirectory,
  onLoadWorkspaceDirectory,
  onContextMenu,
  onCreateFile,
  onRefresh,
  onNavigate,
  onMoveEntry,
}: FileExplorerProps) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Préférences, recherche ────────────────────────────────────────────────
  const [initialPrefs] = useState(readPrefs);
  const [sortMode, setSortMode] = useState<SortMode>(initialPrefs.sortMode);
  const [showHidden, setShowHidden] = useState(initialPrefs.showHidden);
  const [showSearch, setShowSearch] = useState(false);
  const [showIgnoreModal, setShowIgnoreModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery.trim(), SEARCH_DEBOUNCE_MS);
  const isSearching = debouncedSearch.length > 0;

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sortMode, showHidden }));
    } catch { /* stockage indisponible */ }
  }, [sortMode, showHidden]);

  const openSearch = useCallback(() => {
    setShowSearch(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
  }, []);

  const toggleSearch = useCallback(() => {
    if (showSearch) closeSearch();
    else openSearch();
  }, [showSearch, openSearch, closeSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
      }
      // Échap ne ferme la recherche que si le focus est dans l'explorateur
      if (e.key === 'Escape' && showSearch && rootRef.current?.contains(document.activeElement)) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSearch, openSearch, closeSearch]);

  // ── Compteur de fichiers du projet ────────────────────────────────────────
  const [projectFileCount, setProjectFileCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    // Petit délai : `tree` change à chaque chargement de dossier
    const timer = setTimeout(() => {
      import('../../services/ideApi.js')
        .then(({ ideApi }) => ideApi.countFiles())
        .then(count => { if (mounted) setProjectFileCount(count); })
        .catch(() => { if (mounted) setProjectFileCount(null); });
    }, 300);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [tree]);

  // ── Sandbox & diffs ───────────────────────────────────────────────────────
  const sandbox = useSandboxState();

  const effectiveDiffPaths = useMemo(
    () => (sandbox.diffs.size > 0 ? sandbox.diffs : diffPaths),
    [sandbox.diffs, diffPaths],
  );
  const diffLookup = useMemo(() => createDiffLookup(effectiveDiffPaths), [effectiveDiffPaths]);

  // ── Arbre principal ───────────────────────────────────────────────────────
  const processedTree = useMemo(
    () => prepareTree(tree, { query: debouncedSearch, showHidden, sortMode }),
    [tree, debouncedSearch, showHidden, sortMode],
  );

  const expandedDirsRef = useRef(expandedDirs);
  expandedDirsRef.current = expandedDirs;

  // Pendant une recherche, les dossiers contenant un résultat sont ouverts d'office
  const effectiveExpanded = useMemo(() => {
    if (!isSearching) return expandedDirs;
    const forced = new Set<string>();
    collectSearchExpanded(processedTree, debouncedSearch.toLowerCase(), forced);
    return new Set([...expandedDirs, ...forced]);
  }, [isSearching, expandedDirs, processedTree, debouncedSearch]);

  const toggleMain = useCallback((path: string, willExpand: boolean) => {
    if (expandedDirsRef.current.has(path) === willExpand) return; // déjà dans l'état voulu
    onToggleDirectory(path);
    if (willExpand) onLoadDirectory?.(path); // plus de rechargement à la fermeture
  }, [onToggleDirectory, onLoadDirectory]);

  const mainExpansion = useTreeExpansion(effectiveExpanded, toggleMain);
  const expandForDrag = useCallback((path: string) => toggleMain(path, true), [toggleMain]);
  const isExpandedForDrag = useCallback((path: string) => expandedDirsRef.current.has(path), []);

  const dnd = useTreeDragAndDrop({
    onMoveEntry,
    isExpanded: isExpandedForDrag,
    expand: expandForDrag,
  });

  const mainDirCounts = useMemo(
    () => collectDirChangeCounts(processedTree, diffLookup),
    [processedTree, diffLookup],
  );

  const treeData = useMemo(
    () => buildNodes(processedTree, 0, effectiveExpanded, diffLookup, mainDirCounts),
    [processedTree, effectiveExpanded, diffLookup, mainDirCounts],
  );

  const mainRowContext = useMemo<RowContextValue>(() => ({
    query: debouncedSearch,
    dragOverPath: dnd.dragOverPath,
    draggingPath: dnd.draggingPath,
    dnd: dnd.handlers,
    onActivateFile: onOpenFile,
    onActivateDirectory: mainExpansion.activate,
    onContextMenu,
  }), [
    debouncedSearch, dnd.dragOverPath, dnd.draggingPath, dnd.handlers,
    onOpenFile, mainExpansion.activate, onContextMenu,
  ]);

  // ── Arbre « Dossiers Réels » (workspace) ──────────────────────────────────
  const [wsExpandedDirs, setWsExpandedDirs] = useState<Set<string>>(() => new Set());
  const [showWorkspace, setShowWorkspace] = useState(true);
  const hasAutoCollapsed = useRef(false);

  const processedWorkspaceTree = useMemo(() => {
    if (!workspaceTree || workspaceTree.length === 0) return [];
    return prepareTree(workspaceTree, {
      query: debouncedSearch,
      showHidden,
      sortMode,
      onlyDiffs: diffLookup, // undefined => pas de filtre sur les diffs
    });
  }, [workspaceTree, diffLookup, debouncedSearch, showHidden, sortMode]);

  // Replie la section une seule fois à la première apparition de données
  useEffect(() => {
    if (processedWorkspaceTree.length === 0) {
      hasAutoCollapsed.current = false;
      return;
    }
    if (!hasAutoCollapsed.current) {
      hasAutoCollapsed.current = true;
      setWsExpandedDirs(new Set());
      setShowWorkspace(false);
    }
  }, [processedWorkspaceTree]);

  const toggleWorkspaceDir = useCallback((path: string, willExpand: boolean) => {
    setWsExpandedDirs(prev => {
      if (prev.has(path) === willExpand) return prev;
      const next = new Set(prev);
      if (willExpand) next.add(path);
      else next.delete(path);
      return next;
    });
    if (willExpand) onLoadWorkspaceDirectory?.(path);
  }, [onLoadWorkspaceDirectory]);

  const wsExpansion = useTreeExpansion(wsExpandedDirs, toggleWorkspaceDir);

  const wsDirCounts = useMemo(
    () => collectDirChangeCounts(processedWorkspaceTree, diffLookup),
    [processedWorkspaceTree, diffLookup],
  );

  const wsTreeData = useMemo(
    () => buildNodes(processedWorkspaceTree, 0, wsExpandedDirs, diffLookup, wsDirCounts),
    [processedWorkspaceTree, wsExpandedDirs, diffLookup, wsDirCounts],
  );

  const wsRowContext = useMemo<RowContextValue>(() => ({
    query: debouncedSearch,
    dragOverPath: null,
    draggingPath: null,
    dnd: undefined,
    onActivateFile: onOpenFileDiff ?? onOpenFile,
    onActivateDirectory: wsExpansion.activate,
    onContextMenu,
  }), [debouncedSearch, onOpenFileDiff, onOpenFile, wsExpansion.activate, onContextMenu]);

  // ── Dimensions (remplacent les hauteurs codées en dur 320/600/280) ────────
  const [setMainEl, mainHeight] = useElementHeight();
  const [setWsEl, wsHeight] = useElementHeight();

  // ── Dérivés d'affichage ───────────────────────────────────────────────────
  const fileCount = useMemo(() => countFiles(processedTree), [processedTree]);
  const displayedFileCount = isSearching ? fileCount : (projectFileCount ?? fileCount);

  const atRoot = currentDir === '.' || !currentDir;
  const onlyHiddenEntries =
    !loading && tree.length > 0 && processedTree.length === 0 && !isSearching && !showHidden;
  const noSearchResults = !loading && processedTree.length === 0 && isSearching;
  const isEmpty = !loading && processedTree.length === 0 && !isSearching && !onlyHiddenEntries;

  const handleSwitchWorkspace = useCallback(async () => {
    // Ferme les onglets et désactive le workspace courant
    window.dispatchEvent(new CustomEvent(EVENTS.workspaceChanged, { detail: { workspace: null } }));
    try {
      const res = await fetch('/api/self-root/clear', { method: 'POST' });
      if (!res.ok) console.error('[FileExplorer] Failed to clear workspace:', res.status);
    } catch (e) {
      console.error('[FileExplorer] Failed to clear workspace:', e);
    }
    // Ouvre la modale de sélection
    window.dispatchEvent(new CustomEvent(EVENTS.openWorkspaceSwitcher));
  }, []);

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      className="flex flex-col border-r h-full select-none shrink-0"
      style={{
        width,
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-sidebar)',
      }}
    >
      {/* En-tête */}
      <div
        className="flex items-center justify-between border-b px-3 py-1.5"
        style={{ borderColor: 'var(--border-base)', minHeight: '44px' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleSwitchWorkspace}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--bg-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
            style={{ color: 'var(--accent-primary)' }}
            title={LABELS.switchProject}
            aria-label={LABELS.switchProject}
          >
            <FolderInput size={14} />
          </button>
          <div className="min-w-0">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              {LABELS.explorer}
            </span>
            <div
              className="text-xs truncate font-mono"
              style={{ color: 'var(--text-muted)' }}
              title={currentDir || LABELS.root}
            >
              {currentDir === '.' ? '~/projet' : currentDir}
            </div>
          </div>
          {!loading && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ color: 'var(--text-dimmed)', background: 'var(--bg-input)' }}
            >
              {displayedFileCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {!atRoot && (
            <button
              type="button"
              onClick={() => onNavigate(currentDir.split('/').slice(0, -1).join('/') || '.')}
              className="flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--bg-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
              style={{ color: 'var(--accent-primary)' }}
              title={LABELS.parentTitle}
              aria-label={LABELS.parentTitle}
            >
              <ChevronUp size={14} />
              <span className="hidden sm:inline ml-0.5">{LABELS.parent}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowIgnoreModal(true)}
            className="flex items-center rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--bg-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
            style={{ color: 'var(--color-warning)' }}
            title={LABELS.ignore}
            aria-label={LABELS.ignore}
          >
            <ShieldOff size={14} />
          </button>
          <SandboxBadge active={sandbox.active} />
        </div>
      </div>

      {/* Barre d'outils */}
      <div
        className="flex items-center gap-0.5 px-2 border-b"
        style={{ height: '36px', borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
      >
        <ToolbarButton label={LABELS.search} onClick={toggleSearch} active={showSearch} pressed={showSearch}>
          <Search size={14} />
        </ToolbarButton>
        <ToolbarButton
          label={showHidden ? LABELS.hideHidden : LABELS.showHidden}
          onClick={() => setShowHidden(v => !v)}
          active={showHidden}
          pressed={showHidden}
        >
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </ToolbarButton>
        <ToolbarButton
          label={sortLabel(sortMode)}
          onClick={() => setSortMode(nextSort)}
          active={sortMode !== 'name-asc'}
        >
          <SortIcon mode={sortMode} />
        </ToolbarButton>
        <div className="flex-1" />
        <ToolbarButton label={LABELS.newFile} onClick={onCreateFile}>
          <Plus size={14} />
        </ToolbarButton>
        <ToolbarButton label={LABELS.refresh} onClick={onRefresh} className="hover:rotate-90">
          <RefreshCcw size={14} />
        </ToolbarButton>
      </div>

      {/* Champ de recherche */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="flex items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
            >
              <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={LABELS.searchPlaceholder}
                aria-label={LABELS.searchPlaceholder}
                className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
                style={{ color: 'var(--text-primary)' }}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="rounded-full p-1 hover:bg-[var(--bg-panel)] transition"
                  title={LABELS.clear}
                  aria-label={LABELS.clear}
                >
                  <X size={12} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
              <button
                type="button"
                onClick={closeSearch}
                className="rounded-full p-1 hover:bg-[var(--bg-panel)] transition"
                title={LABELS.closeSearch}
                aria-label={LABELS.closeSearch}
              >
                <X size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
            {isSearching && (
              <div
                className="px-3 py-1 text-xs border-b flex items-center gap-2"
                role="status"
                aria-live="polite"
                style={{
                  borderColor: 'var(--border-base)',
                  color: 'var(--text-dimmed)',
                  backgroundColor: mix('var(--accent-primary)', 6),
                }}
              >
                <span className="font-medium">{fileCount}</span>
                <span>{plural(fileCount, 'résultat')}</span>
                <span className="opacity-50">pour</span>
                <span className="font-mono font-medium truncate" style={{ color: 'var(--accent-primary)' }}>
                  «{debouncedSearch}»
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Indicateur de tri */}
      {sortMode !== 'name-asc' && !showSearch && (
        <div
          className="flex items-center gap-2 px-3 py-1 text-xs border-b"
          style={{
            borderColor: 'var(--border-base)',
            backgroundColor: mix('var(--accent-primary)', 8),
            color: 'var(--accent-primary)',
          }}
        >
          <SortIcon mode={sortMode} />
          <span className="font-medium">{sortLabel(sortMode)}</span>
          <button
            type="button"
            className="ml-auto rounded-full p-0.5 hover:bg-[var(--bg-panel)] transition"
            onClick={() => setSortMode('name-asc')}
            title={LABELS.resetSort}
            aria-label={LABELS.resetSort}
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* Corps : les arbres sont virtualisés, le conteneur ne défile donc pas lui-même */}
      <div className="flex-1 min-h-0 flex flex-col">
        {loading ? (
          <TreeSkeleton />
        ) : noSearchResults ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <Search size={32} className="mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm opacity-60" style={{ color: 'var(--text-muted)' }}>
              Aucun fichier ne correspond à{' '}
              <span className="font-mono font-medium" style={{ color: 'var(--accent-primary)' }}>
                «{debouncedSearch}»
              </span>
            </p>
          </div>
        ) : onlyHiddenEntries ? (
          <EmptyState
            icon={EyeOff}
            title="Fichiers cachés masqués"
            description="Ce dossier ne contient que des fichiers cachés."
            action={{
              label: LABELS.showHidden,
              icon: <Eye size={16} />,
              onClick: () => setShowHidden(true),
            }}
          />
        ) : isEmpty ? (
          <EmptyState
            icon={Folder}
            title={atRoot ? 'Aucun projet ouvert' : 'Dossier vide'}
            description={
              atRoot
                ? 'Ouvrez un projet pour commencer à travailler.'
                : 'Créez un fichier pour commencer.'
            }
            action={atRoot ? undefined : { label: LABELS.newFile, icon: <Plus size={16} />, onClick: onCreateFile }}
          />
        ) : (
          <>
            {sandbox.active && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0"
                style={{
                  borderColor: 'var(--border-base)',
                  backgroundColor: 'color-mix(in srgb, var(--color-success) 8%, var(--bg-sidebar))',
                }}
              >
                <Shield size={12} style={{ color: 'var(--color-success)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--color-success)' }}>
                  Sandbox
                </span>
                {effectiveDiffPaths && effectiveDiffPaths.size > 0 && (
                  <Pill color="var(--color-warning)" className="ml-auto">
                    {effectiveDiffPaths.size} diff{effectiveDiffPaths.size > 1 ? 's' : ''}
                  </Pill>
                )}
              </div>
            )}

            <div ref={setMainEl} className="flex-1 min-h-0 py-1">
              {mainHeight > 0 && (
                <ExplorerTree
                  nodes={treeData}
                  height={Math.max(0, mainHeight - 8)}
                  expandedKeys={mainExpansion.expandedKeys}
                  onExpand={mainExpansion.onExpand}
                  rowContext={mainRowContext}
                />
              )}
            </div>

            {sandbox.active && processedWorkspaceTree.length > 0 && (
              <>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-1.5 border-t border-b w-full text-left shrink-0 transition-colors hover:bg-[var(--bg-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                  style={{
                    borderColor: 'var(--border-base)',
                    backgroundColor: 'color-mix(in srgb, var(--accent-primary) 6%, var(--bg-sidebar))',
                  }}
                  onClick={() => setShowWorkspace(prev => !prev)}
                  aria-expanded={showWorkspace}
                >
                  <span
                    aria-hidden="true"
                    className="opacity-60 transition-transform duration-200"
                    style={{ transform: showWorkspace ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    <ChevronDown size={12} />
                  </span>
                  <FolderInput size={12} style={{ color: 'var(--accent-primary)' }} />
                  <span className="text-sm font-bold" style={{ color: 'var(--accent-primary)' }}>
                    {LABELS.realFolders}
                  </span>
                  {sandbox.modifiedCount > 0 ? (
                    <Pill color="var(--color-warning)" title={LABELS.reviewHint} className="ml-auto flex items-center gap-1">
                      <span>
                        {sandbox.modifiedCount} modif{sandbox.modifiedCount > 1 ? 's' : ''}
                      </span>
                      <span aria-hidden="true">↔</span>
                    </Pill>
                  ) : (
                    <Pill color="var(--color-success)" title={LABELS.allValidated} className="ml-auto">
                      ✓ Validé
                    </Pill>
                  )}
                </button>

                {showWorkspace && (
                  <div
                    ref={setWsEl}
                    className="shrink-0"
                    style={{ flex: '0 0 40%', minHeight: WORKSPACE_MIN_HEIGHT }}
                  >
                    {wsHeight > 0 && (
                      <ExplorerTree
                        nodes={wsTreeData}
                        height={wsHeight}
                        expandedKeys={wsExpansion.expandedKeys}
                        onExpand={wsExpansion.onExpand}
                        rowContext={wsRowContext}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <LeannaIgnoreModal open={showIgnoreModal} onClose={() => setShowIgnoreModal(false)} />
    </div>
  );
});

export { FileExplorer };