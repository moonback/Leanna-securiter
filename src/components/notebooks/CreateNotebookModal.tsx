/**
 * CreateNotebookModal — Modal pour créer un nouveau notebook
 * 
 * Design cohérent avec NotebookPickerModal, avec animations fluides
 * et intégration des tokens de design du projet.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, Plus, X, Loader2 } from 'lucide-react';
import { useToast } from '../ui/Toast.js';

interface CreateNotebookModalProps {
  onClose: () => void;
  onCreated: () => void;
}

// Critically damped default — graceful, no overshoot
const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.3 };

const SPRING_MOMENTUM = { type: 'spring' as const, bounce: 0.18, duration: 0.3 };

export function CreateNotebookModal({ onClose, onCreated }: CreateNotebookModalProps) {
  const { success, error: toastError } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      if (!res.ok) throw new Error('Erreur création');
      const data = await res.json();
      success(`Notebook "${data.notebook.title}" créé`);
      setTitle('');
      setDescription('');
      onCreated();
      onClose();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setCreating(false);
    }
  }, [title, description, success, toastError, onClose, onCreated]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    handleCreate();
  }, [handleCreate]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={handleBackdrop}
    >
      <motion.div
        initial={{
          opacity: 0,
          scale: prefersReducedMotion ? 1 : 0.9,
          backdropFilter: 'blur(0px)',
        }}
        animate={{ opacity: 1, scale: 1, backdropFilter: 'blur(20px)' }}
        exit={{
          opacity: 0,
          scale: prefersReducedMotion ? 1 : 0.92,
        }}
        transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border p-5 shadow-2xl"
        style={{
          backgroundColor: 'var(--notebook-surface-elevated)',
          borderColor: 'var(--notebook-border)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Créer un notebook"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5" style={{ color: 'var(--notebook-accent)' }} />
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Créer un notebook
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Recherche IA avec citations sur vos documents
              </p>
            </div>
          </div>
          <motion.button
            onClick={onClose}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.1 }}
            className="p-1.5 rounded-lg"
            style={{ color: 'var(--text-dimmed)' }}
            aria-label="Fermer"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Titre
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Nom du notebook"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none transition-colors duration-150 focus:ring-2"
              style={{
                backgroundColor: 'var(--notebook-surface-muted)',
                border: '1px solid var(--notebook-border)',
                color: 'var(--text-primary)',
                ['--tw-ring-color' as any]: 'var(--accent-primary)',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Description (optionnel)
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ajoutez une description (optionnel)"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors duration-150 focus:ring-2"
              style={{
                backgroundColor: 'var(--notebook-surface-muted)',
                border: '1px solid var(--notebook-border)',
                color: 'var(--text-primary)',
                ['--tw-ring-color' as any]: 'var(--accent-primary)',
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <motion.button
              type="button"
              onClick={onClose}
              whileTap={{ scale: 0.96 }}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--notebook-surface-muted)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              Annuler
            </motion.button>
            <motion.button
              type="submit"
              disabled={!title.trim() || creating}
              whileHover={{ scale: title.trim() ? 1.02 : 1 }}
              whileTap={{ scale: title.trim() ? 0.97 : 1 }}
              transition={SPRING_MOMENTUM}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{
                backgroundColor: 'var(--notebook-accent)',
                color: 'var(--notebook-accent-text)',
              }}
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Créer
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
