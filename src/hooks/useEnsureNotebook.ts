/**
 * useEnsureNotebook — Hook pour garantir qu'un notebook existe
 * 
 * Si aucun notebook n'existe, crée automatiquement un notebook par défaut.
 * Retourne l'ID du notebook à utiliser.
 */

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ui/Toast.js';

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

interface UseEnsureNotebookOptions {
  /** Titre du notebook par défaut si création nécessaire */
  defaultTitle?: string;
  /** Description du notebook par défaut */
  defaultDescription?: string;
  /** Couleur par défaut */
  defaultColor?: string;
  /** Icône par défaut */
  defaultIcon?: string;
  /** Si vrai, crée automatiquement un notebook si aucun n'existe */
  autoCreate?: boolean;
}

interface UseEnsureNotebookResult {
  /** ID du notebook (null si chargement en cours ou erreur) */
  notebookId: string | null;
  /** État de chargement */
  loading: boolean;
  /** Erreur éventuelle */
  error: Error | null;
  /** Liste des notebooks existants */
  notebooks: NotebookSummary[];
  /** Fonction pour rafraîchir la liste */
  refresh: () => Promise<void>;
  /** Fonction pour créer un notebook */
  createNotebook: (title: string, description?: string) => Promise<string>;
}

export function useEnsureNotebook(options: UseEnsureNotebookOptions = {}): UseEnsureNotebookResult {
  const { 
    defaultTitle = 'Mon premier notebook', 
    defaultDescription = 'Notebook créé automatiquement pour l\'import',
    defaultColor = 'var(--accent-primary)',
    defaultIcon = '📓',
    autoCreate = true 
  } = options;
  
  const { error: toastError } = useToast();
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Charger les notebooks existants
  const loadNotebooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/notebooks');
      if (!res.ok) {
        throw new Error('Erreur lors du chargement des notebooks');
      }
      const data = await res.json();
      setNotebooks(data.notebooks || []);
    } catch (e: any) {
      setError(e);
      toastError('Impossible de charger les notebooks');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // Créer un nouveau notebook
  const createNotebook = useCallback(async (title: string, description?: string): Promise<string> => {
    try {
      const res = await fetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: title.trim(), 
          description: description?.trim() 
        }),
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de la création du notebook');
      }
      
      const data = await res.json();
      await loadNotebooks(); // Rafraîchir la liste
      return data.notebook.id;
    } catch (e: any) {
      toastError(e.message);
      throw e;
    }
  }, [loadNotebooks, toastError]);

  // Rafraîchir la liste (alias de loadNotebooks)
  const refresh = useCallback(async () => {
    await loadNotebooks();
  }, [loadNotebooks]);

  // Charger les notebooks au montage
  useEffect(() => {
    loadNotebooks();
  }, [loadNotebooks]);

  // Si autoCreate est vrai et qu'il n'y a aucun notebook, en créer un
  useEffect(() => {
    if (autoCreate && !loading && notebooks.length === 0 && !error) {
      (async () => {
        try {
          await createNotebook(defaultTitle, defaultDescription);
        } catch {
          // L'erreur est déjà gérée par createNotebook
        }
      })();
    }
  }, [autoCreate, loading, notebooks.length, error, createNotebook, defaultTitle, defaultDescription]);

  // Retourner l'ID du premier notebook, ou null si aucun
  const notebookId = notebooks.length > 0 ? notebooks[0].id : null;

  return {
    notebookId,
    loading,
    error,
    notebooks,
    refresh,
    createNotebook,
  };
}

// Hook simplifié qui retourne juste un notebookId garanti
export function useNotebookId(options: Omit<UseEnsureNotebookOptions, 'autoCreate'> = {}) : { notebookId: string | null; loading: boolean; } {
  const { notebookId, loading } = useEnsureNotebook({ ...options, autoCreate: true });
  return { notebookId, loading };
}
