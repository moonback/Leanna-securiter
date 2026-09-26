/**
 * NotesPanel — Gestion des notes d'un notebook
 *
 * UI améliorée avec meilleur layout, compteur de caractères, et animations plus fluides.
 */

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Pin, Trash2, Edit3, Save, X, StickyNote, Clock, Search, ArrowUpDown,
  Download, FileText, Layout, ListChecks, BookOpen, Grid3X3, List, Link2,
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';
import { NotesCanvas } from './NotesCanvas.js';
import { TemplateSelectorModal } from '../templates/TemplateSelectorModal.js';
import { Sparkles } from 'lucide-react';

interface NoteItem {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteEditorData {
  id?: string;
  title: string;
  content: string;
}

interface Props {
  notebookId: string;
  notes: NoteItem[];
  onRefresh: () => void;
  compact?: boolean;
  /** Called when user wants to create/edit a note in the center column */
  onOpenNoteEditor?: (data: NoteEditorData) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}j`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return 'now';
}

export function NotesPanel({ notebookId, notes, onRefresh, compact = false, onOpenNoteEditor }: Props) {
  const { success, error: toastError } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'alpha'>('newest');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'canvas'>('list');
  const [showSearchModal, setShowSearchModal] = useState(false);

  // ─── Note Templates ────────────────────────────────────────────────────────

  const templates = useMemo(() => [
    {
      id: 'cornell',
      label: 'Méthode Cornell',
      icon: Layout,
      color: 'var(--accent-primary)',
      title: 'Notes Cornell — ',
      content: `## Questions / Indices\n\n- \n- \n\n## Notes principales\n\n\n\n## Résumé\n\n`,
    },
    {
      id: 'resume',
      label: 'Résumé',
      icon: FileText,
      color: 'var(--color-success)',
      title: 'Résumé — ',
      content: `## Points clés\n\n1. \n2. \n3. \n\n## Détails\n\n\n\n## Conclusion\n\n`,
    },
    {
      id: 'todo',
      label: 'To-do / Actions',
      icon: ListChecks,
      color: 'var(--color-warning)',
      title: 'Actions — ',
      content: `## À faire\n\n- [ ] \n- [ ] \n- [ ] \n\n## En cours\n\n- [ ] \n\n## Terminé\n\n- [x] \n`,
    },
    {
      id: 'meeting',
      label: 'Compte-rendu',
      icon: BookOpen,
      color: 'var(--color-accent-alt)',
      title: 'Réunion — ',
      content: `## Participants\n\n- \n\n## Ordre du jour\n\n1. \n\n## Décisions\n\n- \n\n## Actions à suivre\n\n- [ ] \n\n## Prochaine réunion\n\n`,
    },
  ], []);

  const applyTemplate = useCallback((template: typeof templates[0]) => {
    if (onOpenNoteEditor) {
      onOpenNoteEditor({ title: template.title, content: template.content });
    } else {
      setTitle(template.title);
      setContent(template.content);
      setShowForm(true);
      setShowTemplates(false);
      setEditingId(null);
    }
  }, [onOpenNoteEditor]);

  // ─── Export all notes ─────────────────────────────────────────────────────

  const handleExportAll = useCallback(() => {
    if (notes.length === 0) return;

    const markdown = notes
      .map(note => `# ${note.title}\n\n${note.content}\n\n---\n`)
      .join('\n');

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    success('Notes exportées en Markdown');
  }, [notes, success]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) throw new Error();
      success('Note créée');
      setTitle('');
      setContent('');
      setShowForm(false);
      onRefresh();
    } catch {
      toastError('Erreur');
    }
  }, [title, content, notebookId, success, toastError, onRefresh]);

  const handleUpdate = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) throw new Error();
      success('Note mise à jour');
      setEditingId(null);
      setTitle('');
      setContent('');
      onRefresh();
    } catch {
      toastError('Erreur');
    }
  }, [title, content, notebookId, success, toastError, onRefresh]);

  const handleDelete = useCallback(async (noteId: string) => {
    try {
      await fetch(`/api/notebooks/${notebookId}/notes/${noteId}`, { method: 'DELETE' });
      success('Note supprimée');
      onRefresh();
    } catch {
      toastError('Erreur');
    }
  }, [notebookId, success, toastError, onRefresh]);

  const handleTogglePin = useCallback(async (noteId: string, pinned: boolean) => {
    try {
      await fetch(`/api/notebooks/${notebookId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !pinned }),
      });
      onRefresh();
    } catch { /* ignore */ }
  }, [notebookId, onRefresh]);

  const startEdit = (note: NoteItem) => {
    if (onOpenNoteEditor) {
      onOpenNoteEditor({ id: note.id, title: note.title, content: note.content });
    } else {
      setEditingId(note.id);
      setTitle(note.title);
      setContent(note.content);
      setShowForm(false);
    }
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setTitle('');
    setContent('');
  };

  // Trier et filtrer
  const sorted = useMemo(() => {
    let filtered = [...notes];

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
      );
    }

    // Sort: pinned always first
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      switch (sortOrder) {
        case 'oldest':
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'alpha':
          return a.title.localeCompare(b.title, 'fr');
        case 'newest':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    return filtered;
  }, [notes, searchQuery, sortOrder]);

  const pinnedCount = notes.filter(n => n.pinned).length;

  // ─── Backlinks detection ──────────────────────────────────────────────────

  const backlinks = useMemo(() => {
    const links: Record<string, string[]> = {};
    notes.forEach(note => {
      links[note.id] = [];
      notes.forEach(other => {
        if (note.id === other.id) return;
        // Check if this note's title is mentioned in the other's content
        if (other.content.toLowerCase().includes(note.title.toLowerCase()) && note.title.length > 2) {
          links[note.id].push(other.id);
        }
      });
    });
    return links;
  }, [notes]);

  const getNoteTitle = useCallback((id: string) => {
    return notes.find(n => n.id === id)?.title || 'Note inconnue';
  }, [notes]);

  if (compact) {
    const compactNotes = sorted.slice(0, 6);
    return (
      <div className="h-full overflow-y-auto custom-scrollbar px-4 pb-4">
        {compactNotes.length === 0 ? (
          <div className="rounded-xl bg-[var(--notebook-surface)] p-5 text-sm text-[var(--text-muted)]">
Enregistrez les réponses utiles de l'IA sous forme de notes et elles apparaîtront ici.          </div>
        ) : (
          <div className="space-y-3">
            {compactNotes.map(note => (
              <article key={note.id} className="notebook-note-card">
                <div className="flex items-start gap-2">
                  {note.pinned && <Pin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent-primary)]" />}
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startEdit(note)}>
                    <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{note.title}</h3>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{note.content}</p>
                    <p className="mt-3 text-xs text-[var(--text-muted)]">{timeAgo(note.updatedAt || note.createdAt)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`h-full ${viewMode === 'canvas' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto custom-scrollbar'} p-5 lg:p-7 space-y-5`}>
      {/* Header with stats */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              if (onOpenNoteEditor) {
                onOpenNoteEditor({ title: '', content: '' });
              } else {
                setShowForm(true); setEditingId(null); setTitle(''); setContent('');
              }
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 shadow-sm"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
            title="Nouvelle note"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowSearchModal(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium border transition-all hover:bg-white/5 active:scale-95"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
            title="Rechercher"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* Templates dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium border transition-all hover:bg-white/5 active:scale-95"
              style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
              title="Modèles"
            >
              <Layout className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  className="absolute top-full left-0 mt-1 z-30 w-48 rounded-xl overflow-hidden shadow-xl"
                  style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
                >
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => applyTemplate(tpl)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-xs transition-colors hover:bg-[var(--accent-subtle)]"
                    >
                      <tpl.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: tpl.color }} />
                      <span style={{ color: 'var(--text-primary)' }}>{tpl.label}</span>
                    </button>
                  ))}
                  <div className="border-t border-[var(--border-base)] my-1" />
                  <button
                    onClick={() => { setShowTemplates(false); setShowTemplateModal(true); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-subtle)]"
                  >
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <span>Bibliothèque complète...</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : prev === 'oldest' ? 'alpha' : 'newest')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium border transition-all hover:bg-white/5"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
            title="Tri"
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortOrder === 'newest' ? 'Récentes' : sortOrder === 'oldest' ? 'Anciennes' : 'A → Z'}
          </button>

          {notes.length > 0 && (
            <button
              onClick={handleExportAll}
              className="p-1.5 rounded-full border transition-all hover:bg-white/5 active:scale-95"
              style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
              title="Exporter"
            >
              <Download className="w-3 h-3" />
            </button>
          )}

          <div className="flex items-center rounded-lg overflow-hidden border ml-auto" style={{ borderColor: 'var(--border-base)' }}>
            <button
              onClick={() => setViewMode('list')}
              className="p-1.5 transition-colors"
              style={{
                backgroundColor: viewMode === 'list' ? 'var(--accent-subtle)' : 'transparent',
                color: viewMode === 'list' ? 'var(--accent-primary)' : 'var(--text-dimmed)',
              }}
              title="Liste"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('canvas')}
              className="p-1.5 transition-colors"
              style={{
                backgroundColor: viewMode === 'canvas' ? 'var(--accent-subtle)' : 'transparent',
                color: viewMode === 'canvas' ? 'var(--accent-primary)' : 'var(--text-dimmed)',
              }}
              title="Canvas"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
            </button>
          </div>

          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Search Modal */}
      <AnimatePresence>
        {showSearchModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowSearchModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="w-full max-w-md mx-4 rounded-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <Search className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Rechercher dans les notes..."
                    className="flex-1 text-sm outline-none"
                    style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                    autoFocus
                  />
                  <button
                    onClick={() => setShowSearchModal(false)}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              </div>

              {/* Search Results */}
              <div className="max-h-96 overflow-y-auto custom-scrollbar px-5 pb-5">
                {sorted.length === 0 ? (
                  <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Aucune note trouvée
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sorted.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => {
                          setShowSearchModal(false);
                          startEdit(note);
                        }}
                        className="w-full text-left p-3 rounded-xl hover:bg-white/5 transition-colors border"
                        style={{ borderColor: 'var(--border-base)' }}
                      >
                        <div className="flex items-center gap-2">
                          {note.pinned && <Pin className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                              {note.title}
                            </p>
                            {note.content && (
                              <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                                {note.content}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                                <Clock className="w-2.5 h-2.5" />
                                {timeAgo(note.updatedAt)}
                              </span>
                              {note.content && (
                                <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                                  {note.content.length} car.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline fallback form (only when no onOpenNoteEditor prop provided) */}
      {!onOpenNoteEditor && (
        <AnimatePresence>
          {(showForm || editingId) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div
                className="p-5 rounded-2xl border space-y-3"
                style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--accent-primary)', boxShadow: '0 0 0 1px var(--accent-primary)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StickyNote className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {editingId ? 'Modifier la note' : 'Nouvelle note'}
                    </p>
                  </div>
                  <button onClick={cancelForm} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                    <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Titre de la note..."
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-full text-sm font-medium outline-none transition-all focus:ring-1 focus:ring-[var(--accent-primary)]"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                />
                <div className="relative">
                  <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Contenu de la note..."
                    rows={6}
                    className="w-full px-4 py-3 rounded-xl text-xs outline-none resize-none transition-all focus:ring-1 focus:ring-[var(--accent-primary)] leading-relaxed"
                    style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                  />
                  <span className="absolute bottom-2 right-3 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                    {content.length} car.
                  </span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
                    disabled={!title.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold disabled:opacity-40 transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {editingId ? 'Mettre à jour' : 'Créer'}
                  </button>
                  <button
                    onClick={cancelForm}
                    className="flex items-center gap-1 px-3 py-2.5 rounded-full text-xs transition-colors hover:bg-white/5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Annuler
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Canvas View */}
      {viewMode === 'canvas' && notes.length > 0 ? (
        <div className="flex-1 min-h-0 -mx-5 -mb-5 lg:-mx-7 lg:-mb-7">
          <NotesCanvas notes={notes} onSelectNote={(id) => { const note = notes.find(n => n.id === id); if (note) startEdit(note); }} />
        </div>
      ) : (
      <>
      {/* Notes List */}
      {sorted.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-14 gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-subtle)' }}
          >
            <StickyNote className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Aucune note
            </p>
            <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
              Créez des notes pour organiser vos idées, annotations et insights.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AnimatePresence initial={false}>
            {sorted.map((note) => (
              <motion.div
                key={note.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className="group p-4 rounded-2xl border transition-all hover:shadow-md hover:-translate-y-0.5"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderColor: note.pinned ? 'var(--accent-primary)' : 'var(--border-base)',
                  borderWidth: note.pinned ? '1.5px' : '1px',
                }}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startEdit(note)}>
                    <div className="flex items-center gap-1.5">
                      {note.pinned && <Pin className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />}
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {note.title}
                      </p>
                    </div>
                    {note.content && (
                      <p className="text-xs mt-1.5 whitespace-pre-wrap line-clamp-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {note.content}
                      </p>
                    )}
                    {/* Meta */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(note.updatedAt)}
                      </span>
                      {note.content && (
                        <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                          {note.content.length} car.
                        </span>
                      )}
                      {backlinks[note.id]?.length > 0 && (
                        <span
                          className="flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}
                          title={`Mentionné dans : ${backlinks[note.id].map(id => getNoteTitle(id)).join(', ')}`}
                        >
                          <Link2 className="w-2.5 h-2.5" />
                          {backlinks[note.id].length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => handleTogglePin(note.id, note.pinned)}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      title={note.pinned ? 'Désépingler' : 'Épingler'}
                    >
                      <Pin className="w-3 h-3" style={{ color: note.pinned ? 'var(--accent-primary)' : 'var(--text-dimmed)' }} />
                    </button>
                    <button
                      onClick={() => startEdit(note)}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      title="Modifier"
                    >
                      <Edit3 className="w-3 h-3" style={{ color: 'var(--text-dimmed)' }} />
                    </button>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3 h-3" style={{ color: 'var(--color-error)' }} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      </>
      )}

      {/* Modal de sélection de templates */}
      <TemplateSelectorModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onCreateNote={(noteTitle, noteContent) => {
          setTitle(noteTitle);
          setContent(noteContent);
          setShowForm(true);
        }}
      />
    </div>
  );
}
