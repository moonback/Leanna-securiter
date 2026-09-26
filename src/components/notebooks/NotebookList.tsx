/**
 * NotebookList — Page d'accueil des notebooks (style NotebookLM)
 *
 * Design épuré et moderne avec cards colorées, animations fluides,
 * création rapide, recherche et tri.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  BookOpen, Plus, Trash2, Clock, FileText, MessageSquare,
  Search, SortAsc, SortDesc, ArrowRight, Github, LayoutGrid, X,
} from 'lucide-react';
import { CreateNotebookModal } from './CreateNotebookModal.js';
import { GitHubRepositoryImportModal } from './GitHubRepositoryImportModal.js';
import { useToast } from '../ui/Toast.js';

interface NotebookSummary {
  id: string;
  title: string;
  description: string;
  sourcesCount: number;
  notesCount: number;
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  onSelectNotebook: (id: string) => void;
  onClose?: () => void;
}

type SortBy = 'updatedAt' | 'title' | 'sourcesCount';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `il y a ${days}j`;
  if (hours > 0) return `il y a ${hours}h`;
  if (mins > 0) return `il y a ${mins}m`;
  return 'à l\'instant';
}

const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.3 };
const SPRING_MOMENTUM = { type: 'spring' as const, bounce: 0.18, duration: 0.3 };

export function NotebookList({ onSelectNotebook, onClose }: Props) {
  const { success, error: toastError } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGitHubImport, setShowGitHubImport] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadNotebooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notebooks');
      if (!res.ok) throw new Error('Erreur réseau');
      const data = await res.json();
      setNotebooks(data.notebooks || []);
    } catch (e: any) {
      toastError('Impossible de charger les notebooks');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { loadNotebooks(); }, [loadNotebooks]);

  // Re-charger la liste quand l'utilisateur change de workspace
  useEffect(() => {
    const handleWorkspaceChange = () => { loadNotebooks(); };
    window.addEventListener('Leanna-workspace-changed', handleWorkspaceChange);
    return () => window.removeEventListener('Leanna-workspace-changed', handleWorkspaceChange);
  }, [loadNotebooks]);

  const filteredNotebooks = useMemo(() => {
    let result = notebooks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(nb =>
        nb.title.toLowerCase().includes(q) ||
        nb.description.toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'updatedAt') cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      else if (sortBy === 'title') cmp = a.title.localeCompare(b.title);
      else if (sortBy === 'sourcesCount') cmp = a.sourcesCount - b.sourcesCount;
      return sortDesc ? -cmp : cmp;
    });
    return result;
  }, [notebooks, searchQuery, sortBy, sortDesc]);

  const handleDeleteClick = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(id);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/notebooks/${deleteTarget}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      success('Notebook supprimé');
      setNotebooks(prev => prev.filter(n => n.id !== deleteTarget));
    } catch {
      toastError('Impossible de supprimer');
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, success, toastError]);

  return (
    <div className="notebook-workspace h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>

      {/* ─── Header ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 px-6 lg:px-12 pt-8 pb-6">
        <div className="flex items-start justify-between gap-4 max-w-8xl mx-auto">
          {/* Title block */}
          <div>
            <div
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3"
              style={{
                color: 'var(--notebook-accent)',
              }}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Espace de recherche
            </div>
            <h1
              className="text-2xl font-bold tracking-tight notebook-heading"
              style={{ color: 'var(--text-primary)' }}
            >
              Vos notebooks
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Retrouvez vos recherches et continuez là où vous vous êtes arrêté.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => setShowCreateModal(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={SPRING_MOMENTUM}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{
                backgroundColor: 'var(--notebook-accent)',
                color: 'var(--notebook-accent-text)',
              }}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              <span>Nouveau</span>
            </motion.button>
            
            <motion.button
              onClick={() => setShowGitHubImport(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="notebook-icon-button rounded-lg"
              style={{ borderColor: 'var(--border-base)' }}
              title="Importer depuis GitHub"
            >
              <Github className="w-4 h-4" />
            </motion.button>
            
            {onClose && (
              <motion.button
                onClick={onClose}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.92 }}
                transition={{ duration: 0.1 }}
                className="notebook-icon-button rounded-lg"
                aria-label="Retour au sélecteur IDE / Notebook"
                title="Retour au sélecteur IDE / Notebook"
              >
                <LayoutGrid className="w-4 h-4" />
              </motion.button>
            )}
          </div>
        </div>
      </header>

      {/* ─── Divider ────────────────────────────────────────── */}
      {notebooks.length > 0 && (
        <div className="flex-shrink-0 mx-6 lg:mx-12" style={{ height: 1, backgroundColor: 'var(--notebook-border)' }} />
      )}

      {/* ─── Search & Sort Bar ──────────────────────────────── */}
      {notebooks.length > 0 && (
        <div className="flex-shrink-0 px-6 lg:px-12 py-4">
          <div className="flex items-center gap-3 max-w-8xl mx-auto">
            {/* Search */}
            <div
              className="flex items-center gap-2.5 flex-1 max-w-md px-3.5 py-2.5 rounded-lg transition-all duration-150 focus-within:ring-2"
              style={{
                backgroundColor: 'var(--notebook-surface-muted)',
                border: '1px solid var(--notebook-border)',
                ['--tw-ring-color' as any]: 'var(--accent-primary)',
              }}
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher…"
                className="flex-1 bg-transparent outline-none text-xs"
                style={{ color: 'var(--text-primary)' }}
              />
              {searchQuery && (
                <motion.button
                  onClick={() => setSearchQuery('')}
                  whileTap={{ scale: 0.85 }}
                  className="p-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--notebook-surface-muted)' }}
                >
                  <X className="h-3 w-3" style={{ color: 'var(--text-dimmed)' }} />
                </motion.button>
              )}
            </div>

            {/* Sort controls */}
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Trier par</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortBy)}
                className="px-3 py-2 rounded-lg text-xs font-medium outline-none cursor-pointer transition-colors duration-150"
                style={{
                  backgroundColor: 'var(--notebook-surface-muted)',
                  border: '1px solid var(--notebook-border)',
                  color: 'var(--text-secondary)',
                }}
              >
                <option value="updatedAt">Récent</option>
                <option value="title">Titre</option>
                <option value="sourcesCount">Sources</option>
              </select>
              <motion.button
                onClick={() => setSortDesc(!sortDesc)}
                whileTap={{ scale: 0.9, rotate: sortDesc ? -8 : 8 }}
                transition={{ duration: 0.1 }}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-dimmed)' }}
                title={sortDesc ? 'Décroissant' : 'Croissant'}
              >
                {sortDesc ? <SortDesc className="w-3.5 h-3.5" /> : <SortAsc className="w-3.5 h-3.5" />}
              </motion.button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Notebook Cards ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 lg:px-12 pb-10 pt-2">
        <div className="max-w-8xl mx-auto">
        {loading ? (
          /* ─── Skeleton ─── */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--notebook-border)', backgroundColor: 'var(--notebook-card-bg)' }}
              >
                <div className="h-1" style={{ background: 'var(--notebook-surface-muted)' }} />
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-4 w-2/3 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                      <div className="h-3 w-1/3 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                    </div>
                  </div>
                  <div className="h-3 w-full rounded-lg animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                  <div className="h-3 w-4/5 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                  <div className="flex gap-2 pt-2">
                    <div className="h-6 w-20 rounded-full animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                    <div className="h-6 w-16 rounded-full animate-pulse" style={{ backgroundColor: 'var(--notebook-surface-muted)' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : notebooks.length === 0 ? (
            /* ─── Empty state ─── */
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING_UI}
            className="flex flex-col items-center justify-center text-center py-20 gap-5 border rounded-xl"
            style={{ borderColor: 'var(--notebook-border)', backgroundColor: 'var(--notebook-surface)' }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                backgroundColor: 'var(--notebook-accent-surface)',
                color: 'var(--notebook-accent)',
              }}
            >
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <h2
                className="text-lg font-bold notebook-heading"
                style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
              >
                Créez votre premier notebook
              </h2>
              <p className="text-sm max-w-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Importez vos documents et posez des questions.
                L'IA répondra en citant les passages pertinents.
              </p>
            </div>

            <motion.button
              onClick={() => setShowCreateModal(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={SPRING_MOMENTUM}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
              style={{
                backgroundColor: 'var(--notebook-accent)',
                color: 'var(--notebook-accent-text)',
              }}
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              Créer un notebook
            </motion.button>
          </motion.div>

        ) : filteredNotebooks.length === 0 ? (
          /* ─── No results ─── */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-16 gap-3"
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'var(--notebook-surface-muted)' }}
            >
              <Search className="w-5 h-5" style={{ color: 'var(--text-dimmed)' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Aucun résultat
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Aucun notebook pour « {searchQuery} »
              </p>
            </div>
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs font-semibold mt-1 px-3 py-1.5 rounded-full transition-colors duration-150"
              style={{
                color: 'var(--accent-primary)',
                backgroundColor: 'var(--notebook-accent-surface)',
              }}
            >
              Effacer la recherche
            </button>
          </motion.div>

        ) : (
          /* ─── Grid View ─── */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <AnimatePresence initial={false}>
              {filteredNotebooks.map((nb, i) => (
                  <motion.div
                    key={nb.id}
                    layout
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    whileHover={prefersReducedMotion ? undefined : { y: -4, scale: 1.008 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{
                      ...(prefersReducedMotion ? { duration: 0.1 } : SPRING_MOMENTUM),
                      delay: i < 12 ? i * 0.03 : 0,
                    }}
                    onClick={() => onSelectNotebook(nb.id)}
                    className="group cursor-pointer rounded-xl border border-transparent overflow-hidden flex flex-col relative transition-all duration-200"
                    style={{
                      backgroundColor: 'var(--notebook-card-bg)',
                      borderColor: 'var(--notebook-border)',
                      boxShadow: 'var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.04))',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = nb.color || 'var(--accent-primary)';
                      e.currentTarget.style.boxShadow = '0 10px 20px rgba(0,0,0,0.08), 0 0 0 1px var(--notebook-border)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--notebook-border)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.04))';
                    }}
                  >
                  <div
                    className="h-1 w-full flex-shrink-0"
                    style={{ backgroundColor: nb.color || 'var(--accent-primary)' }}
                  />

                  <div className="p-4 flex flex-col gap-4 flex-1">
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-2">
                        <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg leading-none transition-colors duration-200"
                          style={{
                            backgroundColor: 'var(--notebook-surface-muted)',
                            border: `1px solid var(--notebook-border)`,
                          }}
                        >
                          {nb.icon || '📓'}
                        </div>
                        <div className="min-w-0">
                          <h3
                            className="text-sm font-semibold truncate notebook-body transition-colors duration-200 group-hover:text-[var(--notebook-accent)]"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {nb.title}
                          </h3>
                          <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            {timeAgo(nb.updatedAt)}
                          </p>
                        </div>

                      {/* Delete button */}
                      <motion.button
                        onClick={(e) => handleDeleteClick(nb.id, e)}
                        whileTap={{ scale: 0.82 }}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 flex-shrink-0"
                        style={{ color: 'var(--color-error, #ef4444)' }}
                        title="Supprimer"
                        aria-label="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>

                    {/* Description */}
                    {nb.description && (
                      <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {nb.description}
                      </p>
                    )}

                    {/* Footer stats + open cta */}
                    {/* Footer stats + open cta */}
                    <div className="flex items-center gap-4 mt-auto pt-4 border-t" style={{ borderColor: 'var(--notebook-surface-muted)' }}>
                      <span
                        className="flex items-center gap-1.5 text-xs font-medium"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
                        {nb.sourcesCount}
                      </span>
                      <span
                        className="flex items-center gap-1.5 text-xs font-medium"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
                        {nb.notesCount}
                      </span>
                      <span
                        className="ml-auto flex items-center gap-1.5 text-xs font-semibold opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 -translate-x-1"
                        style={{ color: 'var(--notebook-accent)' }}
                      >
                        Ouvrir
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ─── Create Notebook Modal ──────────────────────────── */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateNotebookModal
            onClose={() => setShowCreateModal(false)}
            onCreated={loadNotebooks}
          />
        )}
      </AnimatePresence>

      {/* ─── Delete Confirmation Modal ──────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.88, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.92, y: 4 }}
              transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border p-6"
              style={{
                backgroundColor: 'var(--notebook-surface-elevated)',
                borderColor: 'var(--notebook-border)',
                boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(239,68,68,0.12)' }}
                >
                  <Trash2 className="w-4.5 h-4.5 text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Supprimer ce notebook ?
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Cette action est irréversible
                  </p>
                </div>
              </div>

              <p className="text-xs leading-relaxed mb-6 p-3 rounded-xl" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--notebook-surface-muted)' }}>
                Toutes les sources, notes et conversations associées seront définitivement supprimées.
              </p>

              <div className="flex items-center justify-end gap-2">
                <motion.button
                  onClick={() => setDeleteTarget(null)}
                  whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--notebook-surface-muted)',
                    border: '1px solid var(--notebook-border)',
                  }}
                >
                  Annuler
                </motion.button>
                <motion.button
                  onClick={handleDeleteConfirm}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  transition={SPRING_MOMENTUM}
                  className="px-5 py-2 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: '#ef4444',
                    color: 'white',
                    boxShadow: '0 2px 8px rgba(239,68,68,0.35)',
                  }}
                >
                  Supprimer
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* GitHub Import Modal */}
      {showGitHubImport && (
        <GitHubRepositoryImportModal
          onClose={() => setShowGitHubImport(false)}
          onImportSuccess={(notebookId, repository) => {
            success(`Dépôt ${repository} ingéré avec succès !`);
            loadNotebooks();
            onSelectNotebook(notebookId);
          }}
        />
      )}
      
      </div>
    </div>
  );
}
