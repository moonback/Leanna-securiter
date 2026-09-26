/**
 * SourcePanel — Gestion des sources d'un notebook
 *
 * Upload multi-fichiers avec drag & drop, ingestion d'URLs, ajout de texte.
 * UI/UX améliorée : hiérarchie plus claire, feedback immédiat, animations
 * ressort cohérentes (damping fort par défaut, cf. apple-design), accessibilité.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Upload, Globe, FileText, Trash2, Loader2, Type, CheckCircle2, XCircle,
  Search, Eye, RefreshCw, Tag, ClipboardPaste, BarChart3, X, FolderCode,
  CheckSquare, Square, Plus, Sparkles, Github,
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';
import { SourcesSummaryCard } from './SourcesSummaryCard.js';
import { GitHubRepositoryImportModal } from './GitHubRepositoryImportModal.js';

interface SourceItem {
  id: string;
  title: string;
  type: string;
  origin: string;
  summary: string;
  keywords: string[];
  wordCount: number;
  language: string;
  addedAt: string;
  chunksCount: number;
}

interface Props {
  notebookId: string;
  sources: SourceItem[];
  onRefresh: () => void;
  /** Reports upload progress to parent (total files, completed count, active boolean) */
  onUploadProgress?: (state: { total: number; done: number; active: boolean }) => void;
  compact?: boolean;
  /** Called when a source is clicked in compact mode — opens it in the main panel */
  onSelectSource?: (sourceId: string) => void;
  /** Currently selected source ID (for highlighting in compact mode) */
  selectedSourceId?: string | null;
}

interface UploadFileStatus {
  name: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

const TYPE_ICONS: Record<string, string> = {
  pdf: '📕', text: '📄', markdown: '📝', url: '🌐',
  html: '🌍', youtube: '📺', audio: '🎵', docx: '📘', image: '🖼️',
  'github-repo': '💻',
};

const TYPE_COLORS: Record<string, string> = {
  pdf: 'var(--color-error)', text: 'var(--text-muted)', markdown: 'var(--color-accent-alt)', url: 'var(--accent-primary)',
  html: 'var(--accent-secondary)', youtube: 'var(--color-error)', audio: 'var(--color-warning)', docx: 'var(--accent-primary)', image: 'var(--color-success)',
  'github-repo': 'var(--accent-primary)',
};

const ACCEPTED_EXTENSIONS = '.pdf,.txt,.md,.html,.docx,.doc,.rtf,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg';

// Ressort par défaut : critically damped, pas de rebond — cf. apple-design (UI non gestuelle)
const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.35 };
const SPRING_SNAPPY = { type: 'spring' as const, bounce: 0, duration: 0.22 };

export function SourcePanel({ notebookId, sources, onRefresh, onUploadProgress, compact = false, onSelectSource, selectedSourceId }: Props) {
  const { success, error: toastError } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [uploading, setUploading] = useState(false);
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [showTextForm, setShowTextForm] = useState(false);
  const [url, setUrl] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadFileStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<Record<string, string>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [showClipboardForm, setShowClipboardForm] = useState(false);
  const [tagInput, setTagInput] = useState<{ sourceId: string; value: string } | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  // ─── GitHub Repository import ─────────────────────────────────────────────
  const [showGitHubImport, setShowGitHubImport] = useState(false);
  
  // ─── Codebase import ──────────────────────────────────────────────────────
  const [showCodebaseForm, setShowCodebaseForm] = useState(false);
  const [codebaseTitle, setCodebaseTitle] = useState('');
  const [codebaseExtensions, setCodebaseExtensions] = useState('');
  const [codebaseMaxSizeKb, setCodebaseMaxSizeKb] = useState(100);
  const [codebaseIncludeConfig, setCodebaseIncludeConfig] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ressort adapté au réglage d'accessibilité de l'utilisateur
  const spring = prefersReducedMotion ? { duration: 0.15 } : SPRING_UI;
  const springSnappy = prefersReducedMotion ? { duration: 0.12 } : SPRING_SNAPPY;
  const tapScale = prefersReducedMotion ? {} : { whileTap: { scale: 0.96 } };

  // Report upload progress to parent
  useEffect(() => {
    if (!onUploadProgress) return;
    const done = uploadQueue.filter(f => f.status === 'success').length;
    onUploadProgress({ total: uploadQueue.length, done, active: uploading });
  }, [uploadQueue, uploading, onUploadProgress]);

  // Réinitialise la demande de confirmation si l'utilisateur clique ailleurs
  useEffect(() => {
    if (!confirmDeleteAll) return;
    const t = setTimeout(() => setConfirmDeleteAll(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDeleteAll]);

  // Filtered sources
  const filteredSources = useMemo(() => sources.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.keywords.some(k => k.toLowerCase().includes(q));
  }), [sources, searchQuery]);

  // ─── Multi-file upload ──────────────────────────────────────────────────────

  const handleMultiUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setUploading(true);
    setUploadQueue(files.map(f => ({ name: f.name, status: 'pending' })));

    if (files.length === 1) {
      const file = files[0];
      setUploadQueue([{ name: file.name, status: 'uploading' }]);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/notebooks/${notebookId}/sources/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setUploadQueue([{ name: file.name, status: 'success' }]);
        success(`Source "${data.source.title}" ajoutée (${data.source.wordCount} mots, ${data.source.chunksCount} chunks)`);
        onRefresh();
      } catch (e: any) {
        setUploadQueue([{ name: file.name, status: 'error', error: e.message }]);
        toastError(e.message);
      }
    } else {
      setUploadQueue(files.map(f => ({ name: f.name, status: 'uploading' })));
      try {
        const formData = new FormData();
        for (const file of files) formData.append('files', file);
        const res = await fetch(`/api/notebooks/${notebookId}/sources/upload-multi`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setUploadQueue(data.results.map((r: any) => ({
          name: r.filename, status: r.status, error: r.error,
        })));
        if (data.successCount > 0) {
          success(`${data.successCount}/${data.total} source(s) ajoutée(s)`);
          onRefresh();
        }
        if (data.errorCount > 0) toastError(`${data.errorCount} fichier(s) en erreur`);
      } catch (e: any) {
        setUploadQueue(files.map(f => ({ name: f.name, status: 'error', error: e.message })));
        toastError(e.message);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => setUploadQueue([]), 5000);
  }, [notebookId, success, toastError, onRefresh]);

  // ─── Drag & Drop ───────────────────────────────────────────────────────────

  const dragCounter = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) handleMultiUpload(droppedFiles);
  }, [handleMultiUpload]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) handleMultiUpload(files);
  }, [handleMultiUpload]);

  const handleUrlIngest = useCallback(async () => {
    if (!url.trim()) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Ingestion failed' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      success(`Source "${data.source.title}" ajoutée`);
      setUrl(''); setShowUrlForm(false);
      onRefresh();
    } catch (e: any) {
      toastError(e.message);
    } finally { setUploading(false); }
  }, [url, notebookId, success, toastError, onRefresh]);

  const handleTextAdd = useCallback(async () => {
    if (!textContent.trim()) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: textTitle.trim() || undefined, content: textContent }),
      });
      if (!res.ok) throw new Error('Erreur');
      const data = await res.json();
      success(`Source "${data.source.title}" ajoutée`);
      setTextTitle(''); setTextContent(''); setShowTextForm(false);
      onRefresh();
    } catch (e: any) { toastError(e.message); }
    finally { setUploading(false); }
  }, [textTitle, textContent, notebookId, success, toastError, onRefresh]);

  const handleDelete = useCallback(async (sourceId: string) => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      success('Source supprimée');
      onRefresh();
    } catch { toastError('Impossible de supprimer'); }
  }, [notebookId, success, toastError, onRefresh]);

  const handleToggleSelect = useCallback((sourceId: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceId) ? prev.filter(id => id !== sourceId) : [...prev, sourceId]
    );
  }, []);

  const allFilteredSelected = filteredSources.length > 0 && filteredSources.every(s => selectedSources.includes(s.id));

  const handleSelectAll = useCallback(() => {
    setSelectedSources(prev => {
      const allSelected = filteredSources.length > 0 && filteredSources.every(s => prev.includes(s.id));
      return allSelected ? [] : filteredSources.map(s => s.id);
    });
  }, [filteredSources]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedSources.length === 0) return;

    setUploading(true);
    try {
      for (const sourceId of selectedSources) {
        await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}`, { method: 'DELETE' });
      }
      success(`${selectedSources.length} source${selectedSources.length > 1 ? 's' : ''} supprimée${selectedSources.length > 1 ? 's' : ''}`);
      setSelectedSources([]);
      onRefresh();
    } catch {
      toastError('Impossible de supprimer les sources sélectionnées');
    } finally {
      setUploading(false);
    }
  }, [selectedSources, notebookId, success, toastError, onRefresh]);

  const handleDeleteAll = useCallback(async () => {
    if (sources.length === 0) return;
    if (!confirmDeleteAll) { setConfirmDeleteAll(true); return; }

    setConfirmDeleteAll(false);
    setUploading(true);
    try {
      for (const source of sources) {
        await fetch(`/api/notebooks/${notebookId}/sources/${source.id}`, { method: 'DELETE' });
      }
      success(`Toutes les ${sources.length} sources ont été supprimées`);
      setSelectedSources([]);
      onRefresh();
    } catch {
      toastError('Impossible de supprimer toutes les sources');
    } finally {
      setUploading(false);
    }
  }, [sources, notebookId, success, toastError, onRefresh, confirmDeleteAll]);

  // ─── Preview source content ────────────────────────────────────────────────

  const handleTogglePreview = useCallback(async (sourceId: string) => {
    if (expandedSource === sourceId) {
      setExpandedSource(null);
      return;
    }
    setExpandedSource(sourceId);

    // Fetch content if not cached
    if (!sourcePreview[sourceId]) {
      setLoadingPreview(true);
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/content`);
        if (res.ok) {
          const data = await res.json();
          setSourcePreview(prev => ({ ...prev, [sourceId]: data.content || data.text || 'Contenu non disponible' }));
        } else {
          setSourcePreview(prev => ({ ...prev, [sourceId]: 'Impossible de charger le contenu' }));
        }
      } catch {
        setSourcePreview(prev => ({ ...prev, [sourceId]: 'Erreur de chargement' }));
      } finally {
        setLoadingPreview(false);
      }
    }
  }, [expandedSource, sourcePreview, notebookId]);

  // ─── Re-index source ──────────────────────────────────────────────────────

  const handleReindex = useCallback(async (sourceId: string) => {
    setReindexingId(sourceId);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/reindex`, {
        method: 'POST',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      success(`Re-indexé : ${data.chunksCount || '?'} chunks générés`);
      onRefresh();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setReindexingId(null);
    }
  }, [notebookId, success, toastError, onRefresh]);

  // ─── Add tag to source ────────────────────────────────────────────────────

  const handleAddTag = useCallback(async (sourceId: string, tag: string) => {
    if (!tag.trim()) return;
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: tag.trim() }),
      });
      if (!res.ok) throw new Error();
      setTagInput(null);
      onRefresh();
    } catch {
      toastError('Erreur lors de l\'ajout du tag');
    }
  }, [notebookId, toastError, onRefresh]);

  const handleRemoveTag = useCallback(async (sourceId: string, tag: string) => {
    try {
      await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/tags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      });
      onRefresh();
    } catch { /* ignore */ }
  }, [notebookId, onRefresh]);

  // ─── Paste from clipboard ─────────────────────────────────────────────────

  const handleClipboardPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toastError('Le presse-papier est vide');
        return;
      }
      setTextContent(text);
      setTextTitle('Collé depuis le presse-papier');
      setShowTextForm(true);
      setShowClipboardForm(false);
      success('Contenu collé — vérifiez et validez');
    } catch {
      toastError('Impossible d\'accéder au presse-papier. Autorisez l\'accès dans le navigateur.');
    }
  }, [toastError, success]);

  // ─── Codebase import ──────────────────────────────────────────────────────

  const handleCodebaseImport = useCallback(async () => {
    setUploading(true);
    try {
      const extensions = codebaseExtensions.trim()
        ? codebaseExtensions.split(/[\s,;]+/).filter(Boolean).map(e => e.startsWith('.') ? e : `.${e}`)
        : undefined;

      const res = await fetch(`/api/notebooks/${notebookId}/sources/codebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: codebaseTitle.trim() || undefined,
          extensions,
          maxFileSizeKb: codebaseMaxSizeKb,
          includeConfig: codebaseIncludeConfig,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      success(
        `Codebase importé : "${data.source.title}" — ${data.stats.filesCollected} fichiers, ${data.source.wordCount.toLocaleString()} mots`
      );
      setShowCodebaseForm(false);
      setCodebaseTitle('');
      setCodebaseExtensions('');
      onRefresh();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setUploading(false);
    }
  }, [notebookId, codebaseTitle, codebaseExtensions, codebaseMaxSizeKb, codebaseIncludeConfig, success, toastError, onRefresh]);

  // Stats
  const totalWords = sources.reduce((acc, s) => acc + s.wordCount, 0);
  const totalChunks = sources.reduce((acc, s) => acc + s.chunksCount, 0);
  const uploadDone = uploadQueue.filter(f => f.status === 'success').length;
  const uploadErrors = uploadQueue.filter(f => f.status === 'error').length;

  // Hash des sources pour détecter les changements (ajout/suppression)
  const sourcesHash = useMemo(
    () => sources.map(s => s.id).sort().join('|'),
    [sources]
  );

  if (compact) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-4 flex-shrink-0 border-b border-[var(--notebook-border)]">
          <div className="min-w-0">
            <p className="text-sm uppercase font-semibold" style={{ color: 'var(--text-dimmed)', letterSpacing: '0.08em' }}>Sources</p>
            <h2 className="text-sm font-semibold truncate text-[var(--text-primary)]">
              {sources.length} document{sources.length !== 1 ? 's' : ''}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <AnimatePresence mode="wait" initial={false}>
              {selectedSources.length > 0 ? (
                <motion.div
                  key="selection-actions"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={springSnappy}
                  className="flex items-center gap-1.5"
                >
                  <motion.button
                    {...tapScale}
                    type="button"
                    onClick={handleSelectAll}
                    disabled={uploading}
                    className="p-1.5 rounded-lg hover:bg-[var(--notebook-surface-muted)] transition-colors disabled:opacity-50"
                    title={allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                    aria-label={allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                  >
                    <CheckSquare className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                  </motion.button>
                  <motion.button
                    {...tapScale}
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--red-500)', color: 'var(--color-error)' }}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    <span>Supprimer ({selectedSources.length})</span>
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="default-actions"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={springSnappy}
                  className="flex items-center gap-1.5"
                >
                  {sources.length > 0 && (
                    <motion.button
                      {...tapScale}
                      type="button"
                      onClick={handleDeleteAll}
                      disabled={uploading}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={confirmDeleteAll ? { backgroundColor: 'var(--red-500)' } : {}}
                      onMouseEnter={(e) => { if (!confirmDeleteAll) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239,68,68,0.1)'; }}
                      onMouseLeave={(e) => { if (!confirmDeleteAll) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      title={confirmDeleteAll ? 'Cliquez pour confirmer' : 'Supprimer toutes les sources'}
                      aria-label="Supprimer toutes les sources"
                    >
                      <Trash2 className="h-4 w-4" style={{ color: confirmDeleteAll ? 'var(--color-success)' : 'var(--color-error)' }} />
                    </motion.button>
                  )}
                  <motion.button
                    {...tapScale}
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium disabled:opacity-70"
                    style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>Ajouter</span>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} multiple onChange={handleFileInputChange} className="hidden" />
        </div>

        {/* Search */}
        {sources.length > 0 && (
          <div className="px-3 py-2.5 flex-shrink-0">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-full transition-colors focus-within:ring-2"
              style={{
                backgroundColor: 'var(--notebook-surface-muted)',
                border: '1px solid var(--notebook-border)',
                ...( { '--tw-ring-color': 'var(--accent-primary)' } as React.CSSProperties),
              }}
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                aria-label="Rechercher dans les sources"
                className="flex-1 bg-transparent outline-none text-xs min-w-0"
                style={{ color: 'var(--text-primary)' }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-0.5 rounded hover:bg-white/10 flex-shrink-0" aria-label="Effacer la recherche">
                  <X className="h-3 w-3" style={{ color: 'var(--text-dimmed)' }} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Source list */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 max-h-full">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-12 px-4 gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--notebook-surface-muted)' }}
              >
                <FileText className="h-5 w-5" style={{ color: 'var(--text-dimmed)' }} />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Aucune source</p>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-[220px]">
                Ajoutez des documents pour alimenter l'IA.
              </p>
              <motion.button
                {...tapScale}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 mt-1 px-3.5 py-2 rounded-full text-xs font-medium"
                style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une source
              </motion.button>
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Search className="h-4 w-4" style={{ color: 'var(--text-dimmed)' }} />
              <p className="text-xs text-[var(--text-muted)]">Aucun résultat pour « {searchQuery} »</p>
            </div>
          ) : (
            <div className="space-y-1 pt-1">
              <AnimatePresence initial={false}>
                {filteredSources.map((source) => {
                  const isSelected = selectedSources.includes(source.id);
                  const isSingleSelected = selectedSourceId === source.id;
                  const hasSelection = selectedSources.length > 0;

                  return (
                    <motion.div
                      key={source.id}
                      layout={!prefersReducedMotion}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                      className="group flex items-center gap-2 px-2.5 py-2.5 rounded-full cursor-pointer"
                      data-active={isSingleSelected || isSelected}
                      style={{
                        backgroundColor: isSingleSelected
                          ? 'var(--accent-subtle, rgba(59,130,246,0.08))'
                          : isSelected
                            ? 'rgba(59,130,246,0.15)'
                            : 'transparent',
                        border: (isSingleSelected || isSelected) ? '1px solid var(--accent-primary)' : '1px solid transparent',
                        transition: 'background-color 120ms ease, border-color 120ms ease',
                      }}
                      onClick={() => {
                        if (hasSelection) {
                          handleToggleSelect(source.id);
                        } else {
                          onSelectSource?.(source.id);
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (!isSingleSelected && !isSelected) {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--notebook-surface-muted)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSingleSelected && !isSelected) {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      {/* Selection checkbox — visible au survol, ou toujours si une sélection est active */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleToggleSelect(source.id); }}
                        className={`flex-shrink-0 p-0.5 rounded-lg hover:bg-white/10 transition-opacity ${hasSelection || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        aria-label={isSelected ? 'Désélectionner' : 'Sélectionner'}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                        ) : (
                          <Square className="h-4 w-4" style={{ color: 'var(--text-dimmed)' }} />
                        )}
                      </button>

                      {/* File type icon */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
                        style={{ backgroundColor: `${TYPE_COLORS[source.type] || 'var(--text-muted)'}14` }}
                      >
                        {TYPE_ICONS[source.type] || '📎'}
                      </div>

                      {/* Text content */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {source.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-dimmed)' }}>
                          {source.type} · {source.wordCount?.toLocaleString()} mots
                        </p>
                      </div>

                      {/* Delete button on hover */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(source.id); }}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 flex-shrink-0"
                        title="Supprimer"
                        aria-label={`Supprimer ${source.title}`}
                      >
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Footer stats */}
        {sources.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2.5 border-t border-[var(--notebook-border)]">
            <p className="text-xs text-center" style={{ color: 'var(--text-dimmed)' }}>
              {totalWords.toLocaleString()} mots · {totalChunks} chunks
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springSnappy}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-2xl pointer-events-none"
            style={{
              backgroundColor: 'var(--notebook-accent-surface)',
              border: '2.5px dashed var(--notebook-accent)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={spring}
              className="notebook-empty-state-icon"
              style={{ width: 64, height: 64 }}
            >
              <Upload className="w-7 h-7" />
            </motion.div>
            <p className="text-sm font-medium" style={{ color: 'var(--notebook-accent)' }}>
              Déposez vos fichiers ici
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              PDF, texte, Markdown, HTML, DOCX, CSV, JSON, YAML, Images
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sticky header + actions ─────────────────────────── */}
      <div
        className="flex-shrink-0 px-4 pt-3 pb-2 space-y-2"
        style={{ backgroundColor: 'var(--notebook-canvas, var(--bg-base))', borderBottom: '1px solid var(--notebook-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Sources
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {sources.length === 0
                ? 'Aucun document pour le moment'
                : `${sources.length} source${sources.length !== 1 ? 's' : ''} · ${totalWords.toLocaleString()} mots · ${totalChunks} chunks`}
            </p>
          </div>
        </div>

        {/* Upload progress queue */}
        <AnimatePresence>
          {uploadQueue.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <div
                className="p-4 rounded-xl border space-y-2"
                style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--accent-primary)' }}
              >
                <div className="flex items-center gap-2">
                  {uploadDone === uploadQueue.length ? (
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent-primary)' }} />
                  )}
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Upload {uploadDone}/{uploadQueue.length}
                    {uploadErrors > 0 && <span style={{ color: 'var(--color-error)' }}> · {uploadErrors} erreur{uploadErrors > 1 ? 's' : ''}</span>}
                  </p>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                    initial={{ width: '0%' }}
                    animate={{ width: `${(uploadDone / uploadQueue.length) * 100}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                  {uploadQueue.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {f.status === 'pending' && <Loader2 className="w-3 h-3 opacity-30 flex-shrink-0" />}
                      {f.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />}
                      {f.status === 'success' && <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-success)' }} />}
                      {f.status === 'error' && <XCircle className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-error)' }} />}
                      <span className="truncate flex-1" style={{ color: f.status === 'error' ? 'var(--color-error)' : 'var(--text-primary)' }}>
                        {f.name}
                      </span>
                      {f.error && <span className="text-xs opacity-60 truncate max-w-[150px]" title={f.error}>{f.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      {/* Actions row */}
      <div className="flex items-center gap-2 flex-wrap">
        <motion.button
          {...tapScale}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="notebook-fab disabled:opacity-50"
          style={{ padding: '7px 12px', fontSize: '12px' }}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Uploader
        </motion.button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleFileInputChange}
          className="hidden"
        />

        <motion.button
          {...tapScale}
          onClick={() => { setShowUrlForm(!showUrlForm); setShowTextForm(false); setShowCodebaseForm(false); }}
          className={`notebook-chip ${showUrlForm ? 'notebook-chip--active' : ''}`}
          style={showUrlForm ? { borderColor: 'var(--notebook-accent)', color: 'var(--notebook-accent)', background: 'var(--notebook-accent-surface)' } : {}}
        >
          <Globe className="w-3.5 h-3.5" />
          URL
        </motion.button>

        <motion.button
          {...tapScale}
          onClick={() => { setShowTextForm(!showTextForm); setShowUrlForm(false); setShowCodebaseForm(false); }}
          className={`notebook-chip ${showTextForm ? 'notebook-chip--active' : ''}`}
          style={showTextForm ? { borderColor: 'var(--notebook-accent)', color: 'var(--notebook-accent)', background: 'var(--notebook-accent-surface)' } : {}}
        >
          <Type className="w-3.5 h-3.5" />
          Texte
        </motion.button>

        <motion.button
          {...tapScale}
          onClick={handleClipboardPaste}
          className="notebook-chip"
          title="Coller depuis le presse-papier"
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          Coller
        </motion.button>

        <motion.button
          {...tapScale}
          onClick={() => setShowGitHubImport(true)}
          className="notebook-chip"
          title="Importer un dépôt GitHub"
          style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
        >
          <Github className="w-3.5 h-3.5" />
          GitHub
        </motion.button>

        <motion.button
          {...tapScale}
          onClick={() => { setShowCodebaseForm(!showCodebaseForm); setShowUrlForm(false); setShowTextForm(false); }}
          className={`notebook-chip ${showCodebaseForm ? 'notebook-chip--active' : ''}`}
          style={showCodebaseForm ? { borderColor: 'var(--notebook-accent)', color: 'var(--notebook-accent)', background: 'var(--notebook-accent-surface)' } : {}}
          title="Importer le codebase du workspace"
        >
          <FolderCode className="w-3.5 h-3.5" />
          Codebase
        </motion.button>

      </div>

      {/* Search (when >3 sources) */}
      {sources.length > 3 && (
        <div className="notebook-search-field">
          <Search className="h-4 w-4 flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher dans les sources..."
            aria-label="Rechercher dans les sources"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} aria-label="Effacer la recherche" className="p-0.5 rounded hover:bg-white/10">
              <X className="h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
            </button>
          )}
        </div>
      )}

      {/* URL Form */}
      <AnimatePresence>
        {showUrlForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="p-5 rounded-2xl border space-y-3"
              style={{ backgroundColor: 'var(--notebook-card-bg)', borderColor: 'var(--notebook-border)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Globe className="w-4 h-4" style={{ color: 'var(--notebook-accent)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Importer une URL</p>
              </div>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleUrlIngest()}
                placeholder="https://example.com/article..."
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-shadow focus:ring-2"
                style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
              />
              <div className="flex gap-2">
                <motion.button
                  {...tapScale}
                  onClick={handleUrlIngest}
                  disabled={!url.trim() || uploading}
                  className="notebook-fab disabled:opacity-40"
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Ingestion…</> : 'Importer'}
                </motion.button>
                <button
                  onClick={() => { setShowUrlForm(false); setUrl(''); }}
                  className="notebook-chip"
                >
                  Annuler
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Text Form */}
      <AnimatePresence>
        {showTextForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="p-5 rounded-2xl border space-y-3"
              style={{ backgroundColor: 'var(--notebook-card-bg)', borderColor: 'var(--notebook-border)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Type className="w-4 h-4" style={{ color: 'var(--notebook-accent)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Ajouter du texte</p>
              </div>
              <input
                type="text"
                value={textTitle}
                onChange={e => setTextTitle(e.target.value)}
                placeholder="Titre (optionnel)"
                className="w-full px-4 py-2.5 rounded-full text-sm outline-none transition-shadow focus:ring-2"
                style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
              />
              <div className="relative">
                <textarea
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                  placeholder="Collez votre texte ici..."
                  rows={6}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none transition-shadow focus:ring-2"
                  style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
                />
                {textContent && (
                  <span className="absolute bottom-2 right-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    ~{textContent.split(/\s+/).filter(Boolean).length} mots
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <motion.button
                  {...tapScale}
                  onClick={handleTextAdd}
                  disabled={!textContent.trim() || uploading}
                  className="notebook-fab disabled:opacity-40"
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Ajout…</> : 'Ajouter'}
                </motion.button>
                <button
                  onClick={() => { setShowTextForm(false); setTextTitle(''); setTextContent(''); }}
                  className="notebook-chip"
                >
                  Annuler
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Codebase Import Form */}
      <AnimatePresence>
        {showCodebaseForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="p-5 rounded-2xl border space-y-4"
              style={{ backgroundColor: 'var(--notebook-card-bg)', borderColor: 'var(--notebook-border)' }}>
              {/* Header */}
              <div className="flex items-center gap-2">
                <FolderCode className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--notebook-accent)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Importer le codebase du workspace</p>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Scanne tous les fichiers texte du projet actif et les consolide en un seul document Markdown indexé dans ce notebook.
              </p>

              {/* Titre personnalisé */}
              <input
                type="text"
                value={codebaseTitle}
                onChange={e => setCodebaseTitle(e.target.value)}
                placeholder="Titre de la source (optionnel)"
                className="w-full px-4 py-2.5 rounded-full text-sm outline-none transition-shadow focus:ring-2"
                style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
              />

              {/* Filtres d'extensions */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Extensions à inclure <span style={{ color: 'var(--text-dimmed)' }}>(vide = toutes les extensions texte)</span>
                </label>
                <input
                  type="text"
                  value={codebaseExtensions}
                  onChange={e => setCodebaseExtensions(e.target.value)}
                  placeholder=".ts .tsx .js .py .md ..."
                  className="w-full px-4 py-2.5 rounded-full text-sm outline-none font-mono transition-shadow focus:ring-2"
                  style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Options */}
              <div className="flex items-center gap-6 flex-wrap">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Taille max par fichier
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={codebaseMaxSizeKb}
                      onChange={e => setCodebaseMaxSizeKb(Number(e.target.value))}
                      className="w-20 px-3 py-2 rounded-full text-sm outline-none text-center transition-shadow focus:ring-2"
                      style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>Ko</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={codebaseIncludeConfig}
                    onChange={e => setCodebaseIncludeConfig(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-[var(--notebook-accent)]"
                  />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Inclure les fichiers de config
                    <span className="block text-xs" style={{ color: 'var(--text-dimmed)' }}>package.json, tsconfig.json…</span>
                  </span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <motion.button
                  {...tapScale}
                  onClick={handleCodebaseImport}
                  disabled={uploading}
                  className="notebook-fab disabled:opacity-40"
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  {uploading
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scan en cours…</>
                    : <><FolderCode className="w-3.5 h-3.5" /> Importer le codebase</>
                  }
                </motion.button>
                <button
                  onClick={() => { setShowCodebaseForm(false); setCodebaseTitle(''); setCodebaseExtensions(''); }}
                  className="notebook-chip"
                >
                  Annuler
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Résumé global des sources */}
      </div>{/* end sticky header */}

      {/* ── Scrollable content ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-3">
      <SourcesSummaryCard
        notebookId={notebookId}
        sourcesCount={sources.length}
        sourcesHash={sourcesHash}
      />

      {/* Sources List */}
      {sources.length === 0 ? (
        <div
          className="notebook-empty-state rounded-2xl border-2 border-dashed transition-colors"
          style={{ borderColor: dragOver ? 'var(--notebook-accent)' : 'var(--notebook-border)', padding: '48px 24px' }}
        >
          <div className="notebook-empty-state-icon" style={{ width: 56, height: 56 }}>
            <Sparkles className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Ajoutez vos premières sources
          </p>
          <p className="text-xs max-w-sm" style={{ color: 'var(--text-muted)' }}>
            Glissez-déposez des fichiers, ou utilisez les boutons ci-dessus pour importer.
          </p>
          <div className="flex flex-wrap gap-2 mt-2 justify-center">
            {['PDF', 'URL', 'Texte', 'DOCX', 'Markdown'].map(t => (
              <span key={t} className="notebook-chip" style={{ fontSize: '11px', padding: '4px 10px' }}>{t}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {filteredSources.map((source) => {
              const isSelected = selectedSources.includes(source.id);
              return (
                <motion.div
                  key={source.id}
                  layout={!prefersReducedMotion}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={spring}
                  className="group p-3 rounded-xl border flex gap-2"
                  style={{
                    backgroundColor: 'var(--notebook-card-bg)',
                    borderColor: isSelected ? 'var(--accent-primary)' : 'var(--notebook-border)',
                    boxShadow: isSelected ? '0 0 0 1px var(--accent-primary)' : 'none',
                    transition: 'border-color 150ms ease, box-shadow 150ms ease',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = 'var(--notebook-accent)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = 'var(--notebook-border)'; }}
                >
                  {/* Checkbox de sélection */}
                  <button
                    type="button"
                    onClick={() => handleToggleSelect(source.id)}
                    className={`flex-shrink-0 self-start mt-0.5 transition-opacity ${isSelected || selectedSources.length > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    aria-label={isSelected ? 'Désélectionner' : 'Sélectionner'}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    ) : (
                      <Square className="w-4 h-4" style={{ color: 'var(--text-dimmed)' }} />
                    )}
                  </button>

                  {/* Type icon with color indicator */}
                  <div
                    className="flex flex-col items-center gap-1 flex-shrink-0 w-7 h-7 rounded-full justify-center"
                    style={{ backgroundColor: `${TYPE_COLORS[source.type] || 'var(--text-muted)'}14` }}
                  >
                    <span className="text-sm leading-none">{TYPE_ICONS[source.type] || '📎'}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {source.title}
                      </p>
                      <span
                        className="text-sm px-1.5 py-0.5 rounded-full font-bold uppercase flex-shrink-0"
                        style={{ letterSpacing: '0.03em', backgroundColor: `${TYPE_COLORS[source.type] || 'var(--text-muted)'}15`, color: TYPE_COLORS[source.type] || 'var(--text-dimmed)' }}
                      >
                        {source.type}
                      </span>
                    </div>

                    <p className="text-xs mt-0.5 leading-relaxed line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                      {source.summary}
                    </p>

                    {/* Expanded content preview */}
                    <AnimatePresence>
                      {expandedSource === source.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={spring}
                          className="overflow-hidden"
                        >
                          <div
                            className="mt-2 p-3 rounded-xl text-xs leading-relaxed max-h-60 overflow-y-auto custom-scrollbar whitespace-pre-wrap"
                            style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}
                          >
                            {loadingPreview ? (
                              <div className="flex items-center gap-2" style={{ color: 'var(--text-dimmed)' }}>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Chargement du contenu...</span>
                              </div>
                            ) : (
                              sourcePreview[source.id] || source.summary
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-dimmed)' }}>
                        {source.wordCount.toLocaleString()} mots
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                        {source.chunksCount} chunks
                      </span>
                      <span className="text-xs uppercase font-medium" style={{ color: 'var(--text-dimmed)', letterSpacing: '0.02em' }}>
                        {source.language}
                      </span>
                    </div>

                    {/* Keywords + Tags */}
                    {source.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                        {source.keywords.slice(0, 6).map((kw: string) => (
                          <span
                            key={kw}
                            className="text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-all hover:line-through hover:opacity-50"
                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-dimmed)', border: '1px solid var(--border-base)' }}
                            onClick={() => handleRemoveTag(source.id, kw)}
                            title="Cliquer pour retirer"
                          >
                            {kw}
                          </span>
                        ))}
                        {source.keywords.length > 6 && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: 'var(--text-dimmed)' }}>
                            +{source.keywords.length - 6}
                          </span>
                        )}
                        {/* Add tag inline */}
                        {tagInput?.sourceId === source.id ? (
                          <form
                            onSubmit={(e) => { e.preventDefault(); handleAddTag(source.id, tagInput.value); }}
                            className="inline-flex"
                          >
                            <input
                              type="text"
                              value={tagInput.value}
                              onChange={(e) => setTagInput({ sourceId: source.id, value: e.target.value })}
                              placeholder="tag..."
                              autoFocus
                              onBlur={() => setTagInput(null)}
                              className="text-xs px-2 py-0.5 rounded-full w-16 outline-none"
                              style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }}
                            />
                          </form>
                        ) : (
                          <button
                            onClick={() => setTagInput({ sourceId: source.id, value: '' })}
                            className="text-xs px-2 py-0.5 rounded-full font-medium transition-colors hover:bg-[var(--accent-subtle)] opacity-0 group-hover:opacity-100"
                            style={{ color: 'var(--text-dimmed)', border: '1px dashed var(--border-base)' }}
                            title="Ajouter un tag"
                          >
                            + tag
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity self-start">
                    <motion.button
                      {...tapScale}
                      onClick={() => handleTogglePreview(source.id)}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      title="Voir le contenu"
                      aria-label="Voir le contenu"
                    >
                      <Eye className="w-3.5 h-3.5" style={{ color: expandedSource === source.id ? 'var(--accent-primary)' : 'var(--text-dimmed)' }} />
                    </motion.button>
                    <motion.button
                      {...tapScale}
                      onClick={() => handleReindex(source.id)}
                      disabled={reindexingId === source.id}
                      className="p-1.5 rounded-lg hover:bg-[var(--accent-subtle)] transition-colors disabled:opacity-40"
                      title="Re-indexer la source"
                      aria-label="Re-indexer la source"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${reindexingId === source.id ? 'animate-spin' : ''}`} style={{ color: 'var(--accent-primary)' }} />
                    </motion.button>
                    <motion.button
                      {...tapScale}
                      onClick={() => handleDelete(source.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      title="Supprimer"
                      aria-label={`Supprimer ${source.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} />
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {searchQuery && filteredSources.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="h-4 w-4" style={{ color: 'var(--text-dimmed)' }} />
              <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                Aucune source ne correspond à « {searchQuery} »
              </p>
            </div>
          )}
        </div>
      )}
      </div>{/* end scrollable content */}
      
      {/* GitHub Repository Import Modal */}
      {showGitHubImport && (
        <GitHubRepositoryImportModal
          onClose={() => setShowGitHubImport(false)}
          onImportSuccess={(targetNotebookId, repository) => {
            success(`Dépôt ${repository} ingéré avec succès !`);
            if (targetNotebookId && targetNotebookId !== notebookId) {
              window.location.hash = `notebook=${targetNotebookId}`;
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } else {
              onRefresh();
            }
          }}
          defaultNotebookId={notebookId}
        />
      )}
      
    </div>
  );
}