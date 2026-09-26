import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, Loader2, CheckCircle2, AlertCircle, FileCheck, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../ui/Toast.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { useConfirm } from '../ui/ConfirmDialog.js';

interface NotebookLight {
  id: string;
  title: string;
  description: string;
  sourcesCount: number;
  color: string;
  icon: string;
}

interface NotebookPickerModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
  autoCreate?: boolean;
  defaultNotebookTitle?: string;
  defaultNotebookDescription?: string;
}

/**
 * Modal permettant de choisir un notebook dans lequel importer un fichier.
 */
export function NotebookPickerModal({
  filePath,
  fileName,
  onClose,
  autoCreate = false,
  defaultNotebookTitle = 'Mon premier notebook',
  defaultNotebookDescription = '',
}: NotebookPickerModalProps) {
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [notebooks, setNotebooks] = useState<NotebookLight[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [deletingNotebook, setDeletingNotebook] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newNotebookTitle, setNewNotebookTitle] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [alreadyIn, setAlreadyIn] = useState<Set<string>>(new Set());

  const createNotebook = useCallback(async (title: string, description?: string): Promise<string | null> => {
    setCreatingNotebook(true);
    try {
      const res = await fetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description?.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Erreur lors de la création du notebook'); }
      const data = await res.json();
      success(`Notebook "${data.notebook.title}" créé`);
      return data.notebook.id;
    } catch (e: any) { toastError(e.message || 'Impossible de créer un notebook'); return null; }
    finally { setCreatingNotebook(false); }
  }, [success, toastError]);

  const createDefaultNotebook = useCallback(async (): Promise<string | null> => {
    return createNotebook(
      defaultNotebookTitle,
      defaultNotebookDescription || `Créé automatiquement pour l'import de ${fileName}`,
    );
  }, [defaultNotebookTitle, defaultNotebookDescription, fileName, createNotebook]);

  const loadAndCheckNotebooks = useCallback(async (createdId?: string) => {
    setLoading(true); setFeedback(null);
    try {
      const res = await fetch('/api/notebooks');
      const data = await res.json();
      let nbs: NotebookLight[] = data.notebooks ?? [];
      if (createdId && !nbs.some(nb => nb.id === createdId)) {
        const newNbRes = await fetch(`/api/notebooks/${createdId}`);
        const newNbData = await newNbRes.json();
        if (newNbData.status === 'success' && newNbData.notebook) nbs = [newNbData.notebook, ...nbs];
      }
      setNotebooks(nbs);
      const checks = await Promise.allSettled(nbs.map(nb => fetch(`/api/notebooks/${nb.id}`).then(r => r.json())));
      const presentIn = new Set<string>();
      checks.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value.status === 'success') {
          const sources: Array<{ title: string; origin: string }> = result.value.notebook?.sources ?? [];
          if (sources.some(s => s.title === fileName || s.origin === filePath || s.origin === fileName)) {
            presentIn.add(nbs[idx].id);
          }
        }
      });
      setAlreadyIn(presentIn);
    } catch { setFeedback({ type: 'error', msg: 'Impossible de charger les notebooks' }); }
    finally { setLoading(false); }
  }, [fileName, filePath]);

  useEffect(() => {
    (async () => {
      const initialRes = await fetch('/api/notebooks');
      const initialData = await initialRes.json();
      const hasNotebooks = (initialData.notebooks || []).length > 0;
      if (autoCreate && !hasNotebooks) {
        const newNotebookId = await createDefaultNotebook();
        if (newNotebookId) { await loadAndCheckNotebooks(newNotebookId); return; }
      }
      await loadAndCheckNotebooks();
    })();
  }, [loadAndCheckNotebooks, autoCreate, createDefaultNotebook]);

  const handleImport = useCallback(async (notebookId: string) => {
    setImporting(notebookId); setFeedback(null);
    try {
      const fileRes = await fetch(`/api/ide/file?path=${encodeURIComponent(filePath)}`);
      if (!fileRes.ok) { setFeedback({ type: 'error', msg: 'Impossible de lire le fichier' }); setImporting(null); return; }
      const fileData = await fileRes.json();
      const content = fileData.content ?? '';
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const mimeMap: Record<string, string> = {
        md: 'text/markdown', txt: 'text/plain', json: 'application/json',
        ts: 'text/typescript', tsx: 'text/typescript', js: 'text/javascript',
        jsx: 'text/javascript', html: 'text/html', css: 'text/css',
        yaml: 'text/yaml', yml: 'text/yaml', csv: 'text/csv',
        py: 'text/x-python', rs: 'text/x-rust', go: 'text/x-go',
      };
      const blob = new Blob([content], { type: mimeMap[ext] || 'text/plain' });
      const formData = new FormData();
      formData.append('file', blob, fileName);
      const uploadRes = await fetch(`/api/notebooks/${notebookId}/sources/upload`, { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (uploadData.status === 'success') {
        setFeedback({ type: 'success', msg: `${fileName} importé dans le notebook` });
        setAlreadyIn(prev => new Set([...prev, notebookId]));
        window.dispatchEvent(new CustomEvent('notebook-sources-changed', { detail: { notebookId } }));
        setTimeout(onClose, 1200);
      } else {
        setFeedback({ type: 'error', msg: uploadData.error || "Erreur lors de l'import" });
      }
    } catch { setFeedback({ type: 'error', msg: 'Erreur réseau' }); }
    finally { setImporting(null); }
  }, [filePath, fileName, onClose]);

  const handleDeleteNotebook = useCallback(async (notebookId: string, title: string) => {
    // ← useConfirm() remplace window.confirm (lot 5b)
    const ok = await confirm({
      title: 'Supprimer le notebook',
      message: `Supprimer le notebook « ${title} » et toutes ses sources ?`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setDeletingNotebook(notebookId); setFeedback(null);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setNotebooks(prev => prev.filter(nb => nb.id !== notebookId));
      setAlreadyIn(prev => { const next = new Set(prev); next.delete(notebookId); return next; });
    } catch { setFeedback({ type: 'error', msg: 'Impossible de supprimer le notebook' }); }
    finally { setDeletingNotebook(null); }
  }, [confirm]);

  return (
    <Modal open onClose={onClose} size="sm" tone="default">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <BookOpen size={17} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Importer dans un notebook</span>
        </div>
      </Modal.Header>

      <Modal.Body>
        {/* File info */}
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Fichier : <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{fileName}</span>
        </p>

        {/* Feedback */}
        {feedback && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
            role="alert"
            style={{
              backgroundColor: feedback.type === 'success' ? 'var(--color-success-subtle)' : 'var(--color-error-subtle)',
              color: feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {feedback.msg}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
          </div>
        ) : (
          <>
            {notebooks.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun notebook disponible.</p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                {notebooks.map(nb => {
                  const isPresent = alreadyIn.has(nb.id);
                  return (
                    <div
                      key={nb.id}
                      className="w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left"
                      style={{ borderColor: 'var(--border-base)' }}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-base flex-shrink-0"
                        style={{ backgroundColor: `${nb.color}22`, color: nb.color || 'var(--accent-primary)' }}
                      >
                        {nb.icon || '📓'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{nb.title}</div>
                        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {nb.sourcesCount} source{nb.sourcesCount !== 1 ? 's' : ''}
                          {nb.description ? ` · ${nb.description}` : ''}
                        </div>
                      </div>
                      {isPresent && (
                        <span className="flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
                          <FileCheck size={11} /> Déjà présent
                        </span>
                      )}
                      {importing === nb.id && <Loader2 size={14} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />}
                      <button
                        type="button"
                        onClick={() => handleImport(nb.id)}
                        disabled={importing !== null || deletingNotebook !== null || isPresent}
                        className="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-default disabled:opacity-40"
                        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                      >
                        {isPresent ? 'Déjà ajouté' : 'Sélectionner'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteNotebook(nb.id, nb.title)}
                        disabled={importing !== null || deletingNotebook !== null}
                        className="flex-shrink-0 rounded-lg p-1.5 transition disabled:opacity-40"
                        style={{ color: 'var(--color-error)' }}
                        aria-label={`Supprimer ${nb.title}`}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-error-subtle)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {deletingNotebook === nb.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inline create form */}
            {showCreateForm && (
              <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: 'var(--border-base)' }}>
                <input
                  type="text"
                  value={newNotebookTitle}
                  onChange={(e) => setNewNotebookTitle(e.target.value)}
                  placeholder={defaultNotebookTitle || 'Nom du notebook...'}
                  autoFocus
                  aria-label="Nom du nouveau notebook"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newNotebookTitle.trim()) {
                      const id = await createNotebook(newNotebookTitle.trim(), `Créé pour l'import de ${fileName}`);
                      if (id) { await loadAndCheckNotebooks(id); setShowCreateForm(false); setNewNotebookTitle(''); }
                    }
                    if (e.key === 'Escape') { setShowCreateForm(false); setNewNotebookTitle(''); }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setShowCreateForm(false); setNewNotebookTitle(''); }}>Annuler</Button>
                  <Button
                    variant="primary" size="sm"
                    disabled={!newNotebookTitle.trim()}
                    loading={creatingNotebook}
                    onClick={async () => {
                      if (!newNotebookTitle.trim()) return;
                      const id = await createNotebook(newNotebookTitle.trim(), `Créé pour l'import de ${fileName}`);
                      if (id) { await loadAndCheckNotebooks(id); setShowCreateForm(false); setNewNotebookTitle(''); }
                    }}
                  >
                    Créer
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Modal.Body>

      <Modal.Footer align="between">
        {!showCreateForm && (
          <Button
            variant="secondary" size="sm"
            disabled={creatingNotebook}
            iconLeft={<Plus size={14} />}
            onClick={() => { setShowCreateForm(true); setNewNotebookTitle(defaultNotebookTitle); }}
          >
            Créer un nouveau
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>Fermer</Button>
      </Modal.Footer>
    </Modal>
  );
}
