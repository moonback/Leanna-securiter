import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Code, Plus, Trash2, RefreshCw, FileCode, X, Search, Layers3, Clock3 } from 'lucide-react';
import { useToast } from '../components/ui/Toast.js';
import { useConfirm } from '../components/ui/ConfirmDialog.js';
import { ViewHeader } from '../components/ui/ViewHeader.js';

interface SnippetSummary {
  name: string;
  count: number;
  updatedAt: string;
}

interface SnippetDetails {
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export default function ListsView() {
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [snippets, setSnippets] = useState<SnippetSummary[]>([]);
  const [selected, setSelected] = useState<SnippetDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/lists');
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setSnippets(data.lists || []);
      } else {
        throw new Error(data.error || 'Unable to load snippets');
      }
    } catch (e) {
      toastError('Impossible de charger les snippets');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  const loadSnippet = useCallback(async (name: string) => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setSelected({
          ...data.list,
          content: Array.isArray(data.list.items) ? data.list.items.join('\n') : data.list.content || ''
        });
      } else {
        throw new Error(data.error || 'Unable to load snippet');
      }
    } catch (e) {
      toastError('Impossible de charger le snippet');
    } finally {
      setRefreshing(false);
    }
  }, [toastError]);

  useEffect(() => { loadSnippets(); }, [loadSnippets]);

  const handleCreateSnippet = useCallback(async (name?: string, content?: string) => {
    const finalName = name || newName;
    const finalContent = content || newContent;

    if (!finalName.trim()) {
      toastError('Le nom du snippet est requis');
      return;
    }

    const items = [finalContent];

    setActiveAction('create');
    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName.trim(), items }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        success(`Snippet '${finalName.trim()}' créé`);
        setNewName('');
        setNewContent('');
        setShowCreateModal(false);
        await loadSnippets();
      } else {
        throw new Error(data.error || 'Unable to create snippet');
      }
    } catch (e) {
      toastError('Échec de création du snippet');
    } finally {
      setActiveAction(null);
    }
  }, [newName, newContent, loadSnippets, success, toastError]);

  const handleSelect = useCallback(async (name: string) => {
    await loadSnippet(name);
  }, [loadSnippet]);

  const handleDeleteSnippet = useCallback(async () => {
    if (!selected) return;
    
    const confirmed = await confirm({
      title: 'Supprimer le snippet',
      message: `Supprimer le snippet '${selected.name}' ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      variant: 'danger',
    });
    
    if (!confirmed) return;

    setActiveAction('delete');
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(selected.name)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        success(`Snippet '${selected.name}' supprimé`);
        setSelected(null);
        await loadSnippets();
      } else {
        throw new Error(data.error || 'Unable to delete snippet');
      }
    } catch {
      toastError('Échec de la suppression du snippet');
    } finally {
      setActiveAction(null);
    }
  }, [selected, loadSnippets, success, toastError, confirm]);

  const filteredSnippets = snippets.filter(snippet =>
    snippet.name.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
      <ViewHeader
        icon={Code}
        title="Snippets"
        badge="Bibliothèque"
        description="Tes blocs de code réutilisables, centralisés dans Leanna"
        actions={
          <>
            <div className="hidden items-center gap-1.5 rounded-lg border px-3 py-2 sm:flex" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)' }}>
              <Layers3 className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{snippets.length} snippet{snippets.length > 1 ? 's' : ''}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[10px] font-semibold shadow-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
            >
              <Plus className="h-3.5 w-3.5" />
              Nouveau snippet
            </button>
          </>
        }
      />

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-5 py-5 lg:px-7 lg:py-6">
          <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border p-4 shadow-sm" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Vos snippets</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{snippets.length} snippets</p>
                </div>
                <button
                  type="button"
                  onClick={loadSnippets}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Rafraîchir
                </button>
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  placeholder="Rechercher un snippet..."
                  className="w-full rounded-lg border py-2 pl-8 pr-3 text-[10px] outline-none transition-colors focus:border-[var(--accent-primary)]"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="space-y-1.5">
                {filteredSnippets.map(snippet => (
                  <button
                    key={snippet.name}
                    type="button"
                    onClick={() => handleSelect(snippet.name)}
                    className="group w-full rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5"
                    style={{
                      backgroundColor: selected?.name === snippet.name ? 'var(--accent-subtle)' : 'var(--bg-base)',
                      borderColor: selected?.name === snippet.name ? 'var(--accent-primary)' : 'var(--border-base)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <FileCode className="h-3.5 w-3.5 flex-shrink-0" style={{ color: selected?.name === snippet.name ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{snippet.name}</span>
                      <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{snippet.count}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 pl-5 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                      <Clock3 className="h-2.5 w-2.5" />
                      {new Date(snippet.updatedAt).toLocaleDateString('fr-FR')}
                    </div>
                  </button>
                ))}
                {filteredSnippets.length === 0 && (
                  <div className="rounded-xl border border-dashed px-3 py-6 text-center text-[10px]" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)', borderColor: 'var(--border-base)' }}>
                    {snippets.length === 0 ? 'Aucun snippet trouvé. Crée ton premier snippet.' : 'Aucun résultat pour cette recherche.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border p-4 shadow-sm" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileCode className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Contenu du snippet</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {selected ? selected.name : 'Sélectionne un snippet pour voir son contenu.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => selected && loadSnippet(selected.name)}
                  disabled={!selected || refreshing}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  Rafraîchir
                </button>
              </div>

              {!selected ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)', borderColor: 'var(--border-base)' }}>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                    <FileCode className="h-5 w-5" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Aucun snippet sélectionné</p>
                  <p className="mt-1 max-w-xs text-[10px]" style={{ color: 'var(--text-muted)' }}>Choisis un élément dans la bibliothèque pour afficher son contenu ici.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)' }}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Code</p>
                      <button
                        type="button"
                        onClick={handleDeleteSnippet}
                        disabled={activeAction === 'delete'}
                        className="inline-flex items-center gap-2 rounded-xl px-3 py-1 text-xs font-semibold"
                        style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--color-error)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5 inline-block" />
                        Supprimer le snippet
                      </button>
                    </div>
                    <div className="mt-3">
                      <pre className="rounded-xl p-4 text-sm font-mono overflow-x-auto custom-scrollbar" style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-base)' }}>
                        <code>{selected.content}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* Create Snippet Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-xl rounded-2xl p-5 shadow-2xl"
              style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Créer un nouveau snippet</h2>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="p-1.5 rounded-lg text-muted hover:bg-ctrl-hover"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Nom du snippet</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Ex : hook-useLocalStorage"
                    className="mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Contenu</label>
                  <textarea
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    placeholder="Colle ton code ici"
                    rows={12}
                    className="mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none font-mono"
                    style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateSnippet()}
                  disabled={activeAction === 'create'}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
                >
                  <Plus className="w-4 h-4" />
                  Créer le snippet
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
