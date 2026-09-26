/**
 * DocumentsView — Page complète de gestion du Knowledge System documentaire
 *
 * Onglets :
 *   📄 Documents — Upload, liste, recherche, détails
 *   🧠 Mémoire   — Faits extraits, ajout manuel
 *   🔗 Relations — Liens inter-documents
 *   📊 Stats     — Métriques du système
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Upload, Search, Brain, Link2, BarChart3,
  Trash2, RefreshCw, Plus, Clock,
  Loader2, X, Globe, FileType, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useToast } from '../components/ui/Toast.js';
import { ViewHeader } from '../components/ui/ViewHeader.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DocumentItem {
  id: string;
  title: string;
  type: string;
  source: string;
  summary: string;
  keywords: string[];
  tags: string[];
  collection?: string;
  language: string;
  wordCount?: number;
  addedAt: string;
  accessCount: number;
}

interface FactItem {
  id: string;
  content: string;
  category: string;
  tags: string[];
  sourceDocuments: string[];
  confidence: number;
  importance: number;
  verified: boolean;
  createdAt: string;
  relatedConcepts: string[];
}

// Fait de la mémoire projet (knowledge_memory_add)
interface ProjectFactItem {
  id: string;
  content: string;
  category: string;
  tags: string[];
  sourceFile?: string;
  confidence: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  isStructural?: boolean;
}

// Fait unifié pour affichage
interface UnifiedFact {
  id: string;
  content: string;
  category: string;
  tags: string[];
  confidence: number;
  createdAt: string;
  source: 'document' | 'project';
  // Champs spécifiques aux documents
  sourceDocuments?: string[];
  importance?: number;
  verified?: boolean;
  relatedConcepts?: string[];
  // Champs spécifiques au projet
  sourceFile?: string;
  usageCount?: number;
  updatedAt?: string;
  isStructural?: boolean;
}

interface RelationItem {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description: string;
  confidence: number;
  autoDetected: boolean;
  createdAt: string;
}

interface StatsData {
  totalDocuments: number;
  totalFacts: number;
  totalRelations: number;
  totalWords: number;
  totalSections: number;
  totalEntities: number;
  documentsByType: Record<string, number>;
  factsByCategory: Record<string, number>;
  relationsByType: Record<string, number>;
  averageDocumentSize: number;
  lastActivity: string;
}

interface SearchResultItem {
  resultType: string;
  id: string;
  title: string;
  snippet: string;
  relevance: number;
  documentId?: string;
  documentTitle?: string;
}

type Tab = 'documents' | 'memory' | 'relations' | 'stats';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}j`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return 'maintenant';
}

const TYPE_ICONS: Record<string, string> = {
  pdf: '📕', docx: '📘', txt: '📄', markdown: '📝',
  html: '🌐', url: '🔗', image: '🖼️', other: '📎',
};

const CATEGORY_COLORS: Record<string, string> = {
  // Catégories documents
  definition: '#60a5fa', fact: '#34d399', insight: '#fbbf24',
  procedure: '#a78bfa', decision: '#f87171', reference: '#06b6d4',
  quote: '#f472b6', summary: '#818cf8', question: '#fb923c',
  contradiction: '#ef4444', timeline: '#84cc16', relationship: '#e879f9',
  // Catégories mémoire projet
  architecture: '#06b6d4', convention: '#818cf8', pattern: '#fbbf24',
  'known-bug': '#ef4444', api: '#34d399', module: '#a78bfa',
  workflow: '#f87171', security: '#f472b6', stack: '#60a5fa',
  refactoring: '#fb923c', todo: '#84cc16',
};

// ─── Composant Principal ─────────────────────────────────────────────────────

export default function DocumentsView() {
  const [activeTab, setActiveTab] = useState<Tab>('documents');

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Header */}
      <ViewHeader
        icon={FileText}
        title="Knowledge System"
        badge="Documents"
        description="Gérez vos documents, faits extraits et relations"
      />

      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-5 py-2 flex-shrink-0 border-b lg:px-7"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
      >
        {([
          { key: 'documents' as Tab, icon: FileText, label: 'Documents' },
          { key: 'memory' as Tab, icon: Brain, label: 'Mémoire' },
          { key: 'relations' as Tab, icon: Link2, label: 'Relations' },
          { key: 'stats' as Tab, icon: BarChart3, label: 'Statistiques' },
        ]).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              backgroundColor: activeTab === key ? 'var(--accent-subtle)' : 'transparent',
              color: activeTab === key ? 'var(--accent-secondary)' : 'var(--text-muted)',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'documents' && <DocumentsTab />}
        {activeTab === 'memory' && <MemoryTab />}
        {activeTab === 'relations' && <RelationsTab />}
        {activeTab === 'stats' && <StatsTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Documents Tab
// ═══════════════════════════════════════════════════════════════════════════════

function DocumentsTab() {
  const { success, error: toastError } = useToast();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [workspaceDocuments, setWorkspaceDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null);
  const [filterCollection, setFilterCollection] = useState<string>('');
  const [collections, setCollections] = useState<{ name: string; documentCount: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterCollection ? `?collection=${encodeURIComponent(filterCollection)}` : '';
      const [docsRes, wsDocsRes] = await Promise.all([
        fetch(`/api/documents${params}`),
        fetch('/api/knowledge/documents'),
      ]);
      if (docsRes.ok) {
        const data = await docsRes.json();
        setDocuments(data.documents || []);
      }
      if (wsDocsRes.ok) {
        const wsData = await wsDocsRes.json();
        setWorkspaceDocuments(wsData.documents || []);
      }
    } catch (e: any) {
      toastError('Impossible de charger les documents');
    } finally {
      setLoading(false);
    }
  }, [toastError, filterCollection]);

  const loadCollections = useCallback(async () => {
    try {
      const res = await fetch('/api/documents/collections');
      if (!res.ok) return;
      const data = await res.json();
      setCollections(data.collections || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadDocuments(); loadCollections(); }, [loadDocuments, loadCollections]);

  // ── Auto-refresh: knowledge_progress done + polling toutes les 30s ────────
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { phase: string };
      if (d.phase === 'done') { loadDocuments(); loadCollections(); }
    };
    window.addEventListener('Leanna-knowledge-progress', handler);
    const interval = setInterval(() => { loadDocuments(); loadCollections(); }, 30_000);
    return () => {
      window.removeEventListener('Leanna-knowledge-progress', handler);
      clearInterval(interval);
    };
  }, [loadDocuments, loadCollections]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (filterCollection) formData.append('collection', filterCollection);
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      success(`Document "${data.document.title}" ajouté (${data.document.wordCount} mots)`);
      await loadDocuments();
      await loadCollections();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [success, toastError, loadDocuments, loadCollections, filterCollection]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    try {
      const res = await fetch(`/api/documents/search?q=${encodeURIComponent(searchQuery)}&max=20`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      toastError('Erreur de recherche');
    }
  }, [searchQuery, toastError]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      success('Document supprimé');
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch {
      toastError('Impossible de supprimer');
    }
  }, [success, toastError]);

  const [showUrlForm, setShowUrlForm] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [ingestingUrl, setIngestingUrl] = useState(false);

  const handleIngestUrl = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    setIngestingUrl(true);
    try {
      const res = await fetch('/api/documents/ingest-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, collection: filterCollection || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      success(`Page ingérée : "${data.document.title}"`);
      setUrlInput('');
      setShowUrlForm(false);
      await loadDocuments();
      await loadCollections();
    } catch (err: any) {
      toastError(err.message || 'Impossible d\'ingérer l\'URL');
    } finally {
      setIngestingUrl(false);
    }
  }, [urlInput, success, toastError, loadDocuments, loadCollections, filterCollection]);

  return (
    <div className="p-5 lg:p-7 space-y-4">
      {/* Actions bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? 'Upload...' : 'Uploader'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.html,.docx,.png,.jpg,.jpeg,.webp"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          className="hidden"
        />

        {/* URL ingest */}
        <button
          onClick={() => setShowUrlForm(prev => !prev)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
            showUrlForm ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'hover:bg-white/5'
          }`}
          style={!showUrlForm ? { borderColor: 'var(--border-base)', color: 'var(--text-muted)' } : undefined}
        >
          <Globe className="w-3.5 h-3.5" />
          Depuis URL
        </button>

        {/* Collection filter */}
        {collections.length > 0 && (
          <select
            value={filterCollection}
            onChange={e => setFilterCollection(e.target.value)}
            className="px-3 py-2 rounded-xl text-xs border outline-none"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: 'var(--border-base)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">Toutes les collections</option>
            {collections.map(c => (
              <option key={c.name} value={c.name}>{c.name} ({c.documentCount})</option>
            ))}
          </select>
        )}

        {/* Refresh */}
        <button
          onClick={loadDocuments}
          className="p-2 rounded-xl border transition-colors hover:bg-white/5"
          style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* Count */}
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
          {documents.length + workspaceDocuments.length} document{(documents.length + workspaceDocuments.length) !== 1 ? 's' : ''}
          {workspaceDocuments.length > 0 && ` (${workspaceDocuments.length} auto-extraits)`}
        </span>
      </div>

      {/* URL ingest form */}
      <AnimatePresence>
        {showUrlForm && (
          <motion.form
            onSubmit={handleIngestUrl}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              className="p-3.5 rounded-2xl border space-y-3"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  Ingérer un document depuis une URL
                </span>
                <button
                  type="button"
                  onClick={() => setShowUrlForm(false)}
                  className="p-1 rounded-lg hover:bg-white/5 transition"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://example.com/article..."
                  autoFocus
                  required
                  disabled={ingestingUrl}
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none border"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    borderColor: 'var(--border-base)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="submit"
                  disabled={ingestingUrl || !urlInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
                >
                  {ingestingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {ingestingUrl ? 'Ingestion...' : 'Ingérer'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUrlForm(false)}
                  disabled={ingestingUrl}
                  className="px-3 py-2 rounded-xl text-xs font-medium border hover:bg-white/5 transition"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                >
                  Annuler
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Rechercher dans les documents (Entrée pour lancer)..."
          className="w-full pl-9 pr-10 py-2.5 rounded-xl text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-primary)',
          }}
        />
        {searchResults && (
          <button
            onClick={() => { setSearchResults(null); setSearchQuery(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
          >
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {/* Search results */}
      {searchResults && (
        <div className="space-y-2">
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {searchResults.length} résultat{searchResults.length !== 1 ? 's' : ''} pour "{searchQuery}"
          </p>
          {searchResults.map(r => (
            <div
              key={r.id}
              className="p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
                  {r.resultType}
                </span>
                <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {r.title}
                </span>
                <span className="ml-auto text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                  {(r.relevance * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                {r.snippet}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Document list */}
      {!searchResults && (
        loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement...</p>
          </div>
        ) : documents.length === 0 && workspaceDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--bg-panel)' }}>
              <FileText className="w-8 h-8" style={{ color: 'var(--text-dimmed)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Aucun document</p>
            <p className="text-xs text-center max-w-xs" style={{ color: 'var(--text-dimmed)' }}>
              Uploadez des PDF, fichiers texte ou ingérez des pages web pour alimenter la base de connaissances.
              Les documents du workspace (.md, .txt, .rst, etc.) seront extraits automatiquement au démarrage.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Uploaded documents */}
            {documents.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <AnimatePresence initial={false}>
                  {documents.map((doc, i) => (
                <motion.div
                  key={doc.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18, delay: i < 12 ? i * 0.02 : 0 }}
                  className="group p-4 rounded-2xl border flex flex-col gap-2 transition-all hover:border-[var(--border-focus)]"
                  style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
                >
                  {/* Header */}
                  <div className="flex items-start gap-2">
                    <span className="text-base flex-shrink-0">{TYPE_ICONS[doc.type] || '📎'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {doc.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                          {doc.type} • {doc.wordCount ?? '?'} mots
                        </span>
                        {doc.collection && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                            {doc.collection}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3 h-3" style={{ color: 'var(--color-error)' }} />
                    </button>
                  </div>

                  {/* Summary */}
                  <p className="text-[10px] leading-relaxed line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                    {doc.summary || 'Pas de résumé disponible.'}
                  </p>

                  {/* Keywords */}
                  {doc.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-auto pt-1">
                      {doc.keywords.slice(0, 5).map(kw => (
                        <span key={kw} className="text-[8px] px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-dimmed)' }}>
                          {kw}
                        </span>
                      ))}
                      {doc.keywords.length > 5 && (
                        <span className="text-[8px] px-1 py-0.5" style={{ color: 'var(--text-dimmed)' }}>
                          +{doc.keywords.length - 5}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border-base)' }}>
                    <span className="text-[9px] flex items-center gap-1" style={{ color: 'var(--text-dimmed)' }}>
                      <Clock className="w-2.5 h-2.5" />
                      {timeAgo(doc.addedAt)}
                    </span>
                    <span className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                      {doc.language.toUpperCase()}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
            )}

            {/* Workspace documents (auto-extracted) */}
            {workspaceDocuments.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-base)' }} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    📄 Documents du Workspace ({workspaceDocuments.length})
                  </span>
                  <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-base)' }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {workspaceDocuments.map((doc: any) => (
                    <div
                      key={doc.id}
                      className="group p-4 rounded-2xl border flex flex-col gap-2 transition-all hover:border-cyan-500/30"
                      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-base flex-shrink-0">📝</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                            {doc.fileName}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                              {doc.mimeType} • {(doc.textLength / 1000).toFixed(1)}k chars
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-medium">
                              auto-extrait
                            </span>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                        {doc.summary || 'Extrait automatiquement du workspace.'}
                      </p>
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-auto pt-1">
                          {doc.tags.slice(0, 5).map((tag: string, i: number) => (
                            <span key={i} className="text-[8px] px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-dimmed)' }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory Tab
// ═══════════════════════════════════════════════════════════════════════════════

function MemoryTab() {
  const { success, error: toastError } = useToast();
  const [facts, setFacts] = useState<UnifiedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFact, setNewFact] = useState({ content: '', category: 'fact' });

  const loadFacts = useCallback(async () => {
    setLoading(true);
    try {
      // Charger TOUS les faits des documents (sans filtre)
      const docRes = await fetch('/api/documents/facts/list');
      const docData = docRes.ok ? await docRes.json() : { facts: [] };
      
      // Charger TOUS les faits de la mémoire projet (sans filtre)
      const projRes = await fetch('/api/knowledge/memory');
      const projData = projRes.ok ? await projRes.json() : { facts: [] };
      
      // Convertir les faits documents en UnifiedFact
      const documentFacts: UnifiedFact[] = (docData.facts || []).map((f: FactItem) => ({
        ...f,
        source: 'document' as const,
      }));
      
      // Convertir les faits projet en UnifiedFact
      const projectFacts: UnifiedFact[] = (projData.facts || []).map((f: ProjectFactItem) => ({
        ...f,
        source: 'project' as const,
        // Mapper les champs communs
        tags: f.tags || [],
        importance: undefined,
        verified: undefined,
        relatedConcepts: undefined,
      }));
      
      // Fusionner et trier par date de création (plus récent d'abord)
      let allFacts = [...documentFacts, ...projectFacts]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      // Appliquer le filtre de catégorie côté client
      if (filterCategory) {
        allFacts = allFacts.filter(f => f.category === filterCategory);
      }
      
      setFacts(allFacts);
    } catch {
      toastError('Impossible de charger les faits');
    } finally {
      setLoading(false);
    }
  }, [toastError, filterCategory]);

  useEffect(() => { loadFacts(); }, [loadFacts]);

  // ── Auto-refresh: knowledge_progress done + polling toutes les 30s ────────
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { phase: string };
      if (d.phase === 'done') loadFacts();
    };
    window.addEventListener('Leanna-knowledge-progress', handler);
    const interval = setInterval(() => loadFacts(), 30_000);
    return () => {
      window.removeEventListener('Leanna-knowledge-progress', handler);
      clearInterval(interval);
    };
  }, [loadFacts]);

  const handleAddFact = useCallback(async () => {
    if (!newFact.content.trim()) return;
    try {
      const res = await fetch('/api/documents/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newFact.content, category: newFact.category }),
      });
      if (!res.ok) throw new Error();
      success('Fait ajouté à la mémoire');
      setNewFact({ content: '', category: 'fact' });
      setShowAddForm(false);
      await loadFacts();
    } catch {
      toastError('Impossible d\'ajouter le fait');
    }
  }, [newFact, success, toastError, loadFacts]);

  const handleDeleteFact = useCallback(async (id: string) => {
    try {
      await fetch(`/api/documents/facts/${id}`, { method: 'DELETE' });
      setFacts(prev => prev.filter(f => f.id !== id));
      success('Fait supprimé');
    } catch {
      toastError('Erreur');
    }
  }, [success, toastError]);

  // Catégories pour les documents + catégories pour la mémoire projet
  const categories = [
    // Catégories documents
    'definition', 'fact', 'insight', 'procedure', 'decision',
    'reference', 'quote', 'summary', 'question', 'contradiction', 'timeline', 'relationship',
    // Catégories mémoire projet (knowledge_memory_add)
    'architecture', 'convention', 'pattern', 'known-bug', 'api', 'module', 'workflow', 'security', 'stack', 'refactoring', 'todo',
  ];

  return (
    <div className="p-5 lg:p-7 space-y-4">
      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter un fait
        </button>

        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs border outline-none"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
        >
          <option value="">Toutes catégories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <button onClick={loadFacts} className="p-2 rounded-xl border hover:bg-white/5 transition"
          style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
          {facts.length} fait{facts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-2xl border space-y-3"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              <textarea
                value={newFact.content}
                onChange={e => setNewFact(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Contenu du fait à mémoriser..."
                rows={3}
                className="w-full rounded-xl p-3 text-xs outline-none resize-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
              />
              <div className="flex items-center gap-3">
                <select
                  value={newFact.category}
                  onChange={e => setNewFact(prev => ({ ...prev, category: e.target.value }))}
                  className="px-3 py-2 rounded-xl text-xs border outline-none"
                  style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  onClick={handleAddFact}
                  disabled={!newFact.content.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 transition active:scale-95"
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
                >
                  Sauvegarder
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-2 rounded-xl text-xs transition hover:bg-white/5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Annuler
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Facts list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      ) : facts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Brain className="w-10 h-10" style={{ color: 'var(--text-dimmed, #888)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted, #888)' }}>Aucun fait mémorisé</p>
        </div>
      ) : (
        <div className="space-y-2">
          {facts.map(fact => (
            <div
              key={fact.id}
              className="group p-3 rounded-xl border flex items-start gap-3 transition hover:border-[var(--border-focus)]"
              style={{ 
                backgroundColor: 'var(--bg-panel, #1a1a2e)', 
                borderColor: 'var(--border-base)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <div
                className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                style={{ backgroundColor: CATEGORY_COLORS[fact.category] || '#6b7280' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-relaxed" style={{ 
                  color: 'var(--text-primary)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                }}>
                  {fact.content}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: `${CATEGORY_COLORS[fact.category] || '#6b7280'}20`, color: CATEGORY_COLORS[fact.category] || '#6b7280' }}>
                    {fact.category}
                  </span>
                  {/* Indicateur de source */}
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: fact.source === 'project' ? 'var(--bg-base)' : 'transparent', color: 'var(--text-dimmed)' }}>
                    {fact.source === 'project' ? '📦 Projet' : '📄 Document'}
                  </span>
                  {/* Badge "vérifié" pour les faits documents */}
                  {fact.verified && (
                    <span className="text-[9px] flex items-center gap-0.5 text-emerald-400">
                      <CheckCircle2 className="w-2.5 h-2.5" /> vérifié
                    </span>
                  )}
                  {/* Badge "structural" pour les faits projet */}
                  {fact.isStructural && (
                    <span className="text-[9px] flex items-center gap-0.5 text-purple-400">
                      <CheckCircle2 className="w-2.5 h-2.5" /> structurel
                    </span>
                  )}
                  <span className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                    confiance: {(fact.confidence * 100).toFixed(0)}%
                  </span>
                  {/* Afficher usageCount pour les faits projet */}
                  {fact.source === 'project' && fact.usageCount !== undefined && fact.usageCount > 0 && (
                    <span className="text-[9px] flex items-center gap-0.5" style={{ color: 'var(--text-dimmed)' }}>
                      👁️ {fact.usageCount}
                    </span>
                  )}
                  <span className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                    {timeAgo(fact.createdAt)}
                  </span>
                </div>
              </div>
              {/* Bouton de suppression - seulement pour les faits documents */}
              {fact.source === 'document' && (
                <button
                  onClick={() => handleDeleteFact(fact.id)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 transition hover:bg-red-500/10"
                >
                  <Trash2 className="w-3 h-3" style={{ color: 'var(--color-error)' }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Relations Tab
// ═══════════════════════════════════════════════════════════════════════════════

function RelationsTab() {
  const { error: toastError } = useToast();
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRelations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents/relations/list');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRelations(data.relations || []);
    } catch {
      toastError('Impossible de charger les relations');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { loadRelations(); }, [loadRelations]);

  // ── Auto-refresh: knowledge_progress done + polling toutes les 30s ────────
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { phase: string };
      if (d.phase === 'done') loadRelations();
    };
    window.addEventListener('Leanna-knowledge-progress', handler);
    const interval = setInterval(() => loadRelations(), 30_000);
    return () => {
      window.removeEventListener('Leanna-knowledge-progress', handler);
      clearInterval(interval);
    };
  }, [loadRelations]);

  const RELATION_COLORS: Record<string, string> = {
    references: '#60a5fa', extends: '#34d399', contradicts: '#f87171',
    summarizes: '#818cf8', updates: '#fbbf24', related: '#a78bfa',
    sequential: '#06b6d4', depends_on: '#f472b6', derived_from: '#84cc16',
    similar: '#e879f9',
  };

  return (
    <div className="p-5 lg:p-7 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={loadRelations} className="p-2 rounded-xl border hover:bg-white/5 transition"
          style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
          {relations.length} relation{relations.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      ) : relations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Link2 className="w-10 h-10" style={{ color: 'var(--text-dimmed)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucune relation détectée</p>
          <p className="text-xs text-center max-w-xs" style={{ color: 'var(--text-dimmed)' }}>
            Les relations sont créées automatiquement quand des documents partagent des thèmes communs.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {relations.map(rel => (
            <div key={rel.id} className="p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: `${RELATION_COLORS[rel.type] || '#6b7280'}20`,
                    color: RELATION_COLORS[rel.type] || '#6b7280',
                  }}>
                  {rel.type}
                </span>
                <span className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                  {(rel.confidence * 100).toFixed(0)}% confiance
                </span>
                {rel.autoDetected && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-dimmed)' }}>
                    auto
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-medium truncate max-w-[35%]">{rel.sourceId}</span>
                <Link2 className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
                <span className="font-medium truncate max-w-[35%]">{rel.targetId}</span>
              </div>
              {rel.description && (
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{rel.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats Tab
// ═══════════════════════════════════════════════════════════════════════════════

function StatsTab() {
  const { error: toastError } = useToast();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [workspaceStats, setWorkspaceStats] = useState<{
    documentCount: number;
    totalWords: number;
    documentsByType: Record<string, number>;
  } | null>(null);
  const [projectMemoryStats, setProjectMemoryStats] = useState<{
    totalFacts: number;
    factsByCategory: Record<string, number>;
    structuralFacts: number;
  } | null>(null);
  const [kgStats, setKgStats] = useState<{
    totalRelations: number;
    cycleCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const [docsStatsRes, wsDocsRes, kgHealthRes, kgDashboardRes] = await Promise.all([
        fetch('/api/documents/stats'),
        fetch('/api/knowledge/documents'),
        fetch('/api/knowledge/health'),
        fetch('/api/knowledge/dashboard'),
      ]);

      if (docsStatsRes.ok) {
        const docsData = await docsStatsRes.json();
        setStats(docsData.stats);
      }

      if (wsDocsRes.ok) {
        const wsData = await wsDocsRes.json();
        const totalWords = wsData.documents.reduce((sum: number, d: any) =>
          sum + (d.textLength || 0), 0);

        const docsByType: Record<string, number> = {};
        wsData.documents.forEach((d: any) => {
          const type = d.mimeType || 'auto_extracted';
          docsByType[type] = (docsByType[type] || 0) + 1;
        });

        setWorkspaceStats({
          documentCount: wsData.documentCount,
          totalWords,
          documentsByType: docsByType,
        });
      }

      if (kgHealthRes.ok) {
        const kgData = await kgHealthRes.json();
        setProjectMemoryStats({
          totalFacts: kgData.projectMemory?.totalFacts || 0,
          factsByCategory: kgData.projectMemory?.categoryBreakdown || {},
          structuralFacts: kgData.projectMemory?.structuralFacts || 0,
        });
      }

      if (kgDashboardRes.ok) {
        const kgDbData = await kgDashboardRes.json();
        setKgStats({
          totalRelations: kgDbData.graph?.relations?.total || 0,
          cycleCount: kgDbData.graph?.cycleCount || 0,
        });
      }
    } catch {
      toastError('Impossible de charger les statistiques');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Auto-refresh: knowledge_progress done + polling toutes les 30s ────────
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { phase: string };
      if (d.phase === 'done') loadStats();
    };
    window.addEventListener('Leanna-knowledge-progress', handler);
    const interval = setInterval(() => loadStats(), 30_000);
    return () => {
      window.removeEventListener('Leanna-knowledge-progress', handler);
      clearInterval(interval);
    };
  }, [loadStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
      </div>
    );
  }

  if (!stats && !workspaceStats && !projectMemoryStats && !kgStats) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="w-8 h-8" style={{ color: 'var(--text-dimmed)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Aucun document trouvé
        </p>
      </div>
    );
  }

  const totalDocuments = (stats?.totalDocuments || 0) + (workspaceStats?.documentCount || 0);
  const totalWords = (stats?.totalWords || 0) + (workspaceStats?.totalWords || 0);
  const totalFacts = (stats?.totalFacts || 0) + (projectMemoryStats?.totalFacts || 0);
  const totalRelations = (stats?.totalRelations || 0) + (kgStats?.totalRelations || 0);
  const totalSections = stats?.totalSections || 0;
  const totalEntities = stats?.totalEntities || 0;
  const averageDocumentSize = totalDocuments > 0
    ? Math.round((totalWords / totalDocuments) * 100) / 100
    : 0;

  const allDocumentsByType = {
    ...workspaceStats?.documentsByType,
    ...stats?.documentsByType,
  };

  const allFactsByCategory = {
    ...stats?.factsByCategory,
    ...projectMemoryStats?.factsByCategory,
  };

  return (
    <div className="p-5 lg:p-7 space-y-6">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <BarChart3 className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Statistiques du Knowledge System
        </h2>
        {workspaceStats?.documentCount && workspaceStats.documentCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{
            backgroundColor: 'var(--bg-base)',
            color: 'var(--text-muted)'
          }}>
            {workspaceStats.documentCount} docs auto-extraits
          </span>
        )}
        {projectMemoryStats?.totalFacts && projectMemoryStats.totalFacts > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{
            backgroundColor: 'var(--bg-base)',
            color: 'var(--text-muted)'
          }}>
            {projectMemoryStats.totalFacts} faits projet
          </span>
        )}
        {kgStats?.totalRelations && kgStats.totalRelations > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{
            backgroundColor: 'var(--bg-base)',
            color: 'var(--text-muted)'
          }}>
            {kgStats.totalRelations} relations code
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Documents" value={totalDocuments} icon={FileText} color="#818cf8" />
        <StatCard label="Faits" value={totalFacts} icon={Brain} color="#34d399" />
        <StatCard label="Relations" value={totalRelations} icon={Link2} color="#f472b6" />
        <StatCard
          label="Mots total"
          value={totalWords.toLocaleString()}
          icon={FileType}
          color="#fbbf24"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.keys(allDocumentsByType).length > 0 && (
          <div className="p-4 rounded-2xl border space-y-3"
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Documents par type
            </h3>
            <div className="space-y-2">
              {Object.entries(allDocumentsByType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-xs flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                      {TYPE_ICONS[type.split('/')[1] || type] || '📎'} {type}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {Object.keys(allFactsByCategory).length > 0 && (
          <div className="p-4 rounded-2xl border space-y-3"
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Faits par catégorie
            </h3>
            <div className="space-y-2">
              {Object.entries(allFactsByCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-xs flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] || '#6b7280' }} />
                      {cat}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 rounded-2xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Métriques additionnelles
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <div>
            <span style={{ color: 'var(--text-dimmed)' }}>Sections :</span>{' '}
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{totalSections}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-dimmed)' }}>Entités :</span>{' '}
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{totalEntities}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-dimmed)' }}>Taille moy. :</span>{' '}
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {averageDocumentSize.toLocaleString()} mots
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-dimmed)' }}>Dernière activité :</span>{' '}
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {timeAgo(stats?.lastActivity || new Date().toISOString())}
            </span>
          </div>
        </div>
      </div>

      {totalDocuments === 0 && totalFacts === 0 && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
          <p className="text-sm text-blue-200">
            💡 <strong>Astuce</strong> : Upload des documents via l'onglet <strong>Documents</strong> pour les voir apparaître ici.<br />
            Les documents du workspace sont auto-extraits et les agents ajoutent des faits projet automatiquement.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: any; color: string;
}) {
  return (
    <div className="p-4 rounded-2xl border space-y-2"
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
      </div>
      <p className="text-xl font-black" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}
