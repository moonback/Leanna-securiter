/**
 * ImportToNotebookButton — Bouton pour importer des fichiers dans un notebook
 * 
 * Si aucun notebook n'existe, en crée un automatiquement avant l'import.
 * Peut être utilisé dans différents contextes (IDE, drag & drop global, etc.)
 */

import React, { useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Upload, Plus, Loader2, BookOpen } from 'lucide-react';
import { useToast } from '../ui/Toast.js';
import { NotebookPickerModal } from '../ide/NotebookPickerModal.js';

interface ImportToNotebookButtonProps {
  /** Callback appelé après import réussi (optionnel) */
  onImported?: (notebookId: string, filePath: string) => void;
  /** Style personnalisé pour le bouton */
  className?: string;
  /** Texte du bouton */
  children?: React.ReactNode;
  /** Si vrai, utilise un style compact */
  compact?: boolean;
  /** Si vrai, crée automatiquement un notebook si aucun n'existe */
  autoCreate?: boolean;
  /** Titre par défaut pour le notebook créé automatiquement */
  defaultNotebookTitle?: string;
  /** Description par défaut pour le notebook créé automatiquement */
  defaultNotebookDescription?: string;
}

export function ImportToNotebookButton({
  onImported,
  className,
  children,
  compact = false,
  autoCreate = true,
  defaultNotebookTitle = 'Mon premier notebook',
  defaultNotebookDescription = '',
}: ImportToNotebookButtonProps) {
  const { success, error: toastError } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [showPicker, setShowPicker] = useState(false);
  const [fileToImport, setFileToImport] = useState<{ path: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const SPRING_MOMENTUM = { type: 'spring' as const, bounce: 0.18, duration: 0.3 };

  // Gérer la sélection de fichier (pour les inputs file)
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Pour le moment, on simule un chemin
    // Dans une vraie implémentation, il faudrait gérer le upload direct
    // ou utiliser un chemin temporaire
    setFileToImport({
      path: URL.createObjectURL(file),
      name: file.name
    });
    setShowPicker(true);
    
    // Reset l'input pour permettre la même sélection
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleImportSuccess = useCallback((notebookId: string, filePath: string) => {
    success(`Fichier importé dans le notebook`);
    onImported?.(notebookId, filePath);
    setFileToImport(null);
    setShowPicker(false);
  }, [success, onImported]);

  const handleClick = useCallback(() => {
    // Si on a un input file caché, on le déclenche
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    
    const file = files[0];
    setFileToImport({
      path: URL.createObjectURL(file),
      name: file.name
    });
    setShowPicker(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Style par défaut du bouton
  const defaultButton = (
    <motion.button
      onClick={handleClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_MOMENTUM}
      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${className || ''}`}
      style={{
        background: 'linear-gradient(135deg, var(--accent-primary), var(--notebook-accent))',
        color: 'white',
        boxShadow: '0 2px 8px rgba(59,130,246,0.25)',
        ...(compact ? { padding: '0.5rem 1rem', fontSize: '0.75rem' } : {}),
      }}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <>
          <Upload className={`w-4 h-4 ${compact ? 'w-3 h-3' : ''}`} />
          <span>{children || 'Importer dans un notebook'}</span>
        </>
      )}
    </motion.button>
  );

  // Zone de drop si compact n'est pas activé
  const dropZone = !compact && (
    <motion.div
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className="relative flex items-center justify-center gap-2 px-6 py-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
      style={{
        borderColor: 'var(--accent-primary)',
        backgroundColor: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)',
        color: 'var(--accent-primary)',
      }}
    >
      <Upload className="w-5 h-5" />
      <div className="text-center">
        <div className="text-sm font-medium">Glissez-déposez un fichier</div>
        <div className="text-xs opacity-70">ou cliquez pour sélectionner</div>
      </div>
    </motion.div>
  );

  return (
    <>
      {/* Input file caché */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        accept=".pdf,.txt,.md,.html,.docx,.doc,.rtf,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg"
        className="hidden"
        multiple={false}
      />

      {/* Bouton ou zone de drop */}
      {compact ? defaultButton : dropZone}

      {/* Modal de sélection de notebook */}
      {showPicker && fileToImport && (
        <NotebookPickerModal
          filePath={fileToImport.path}
          fileName={fileToImport.name}
          onClose={() => {
            setShowPicker(false);
            setFileToImport(null);
          }}
          autoCreate={autoCreate}
          defaultNotebookTitle={defaultNotebookTitle}
          defaultNotebookDescription={defaultNotebookDescription}
        />
      )}
    </>
  );
}

// Version simplifiée pour un usage direct avec une action
interface ImportActionProps {
  /** Chemin du fichier à importer */
  filePath: string;
  /** Nom du fichier */
  fileName: string;
  /** Callback après import */
  onComplete?: (notebookId: string) => void;
  /** Si vrai, crée automatiquement un notebook */
  autoCreate?: boolean;
  /** Titre par défaut pour le notebook créé automatiquement */
  defaultNotebookTitle?: string;
  /** Description par défaut pour le notebook créé automatiquement */
  defaultNotebookDescription?: string;
}

export async function importToNotebookAction({
  filePath,
  fileName,
  onComplete,
  autoCreate = true,
  defaultNotebookTitle = 'Mon premier notebook',
  defaultNotebookDescription = '',
}: ImportActionProps): Promise<string | null> {
  // Récupérer les notebooks existants
  const res = await fetch('/api/notebooks');
  const data = await res.json();
  const notebooks = data.notebooks || [];

  let notebookId: string | null = null;

  // Si aucun notebook et autoCreate activé, en créer un
  if (notebooks.length === 0 && autoCreate) {
    const title = defaultNotebookTitle || 'Mon premier notebook';
    const description = defaultNotebookDescription || `Créé automatiquement pour l'import de ${fileName}`;
    
    const createRes = await fetch('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        title,
        description
      }),
    });
    
    if (!createRes.ok) {
      console.error('Erreur lors de la création du notebook');
      return null;
    }
    
    const createData = await createRes.json();
    notebookId = createData.notebook.id;
    notebooks.push(createData.notebook);
  }

  // Si on a toujours aucun notebook, retourner null
  if (notebooks.length === 0) {
    console.error('Aucun notebook disponible');
    return null;
  }

  // Utiliser le premier notebook disponible
  notebookId = notebooks[0].id;

  // Importer le fichier
  try {
    const formData = new FormData();
    // Pour l'instant, on assume que filePath est un blob URL ou un chemin valide
    // Dans une vraie implémentation, il faudrait récupérer le contenu
    const fileRes = await fetch(`/api/ide/file?path=${encodeURIComponent(filePath)}`);
    if (!fileRes.ok) {
      console.error('Impossible de lire le fichier');
      return null;
    }
    
    const fileData = await fileRes.json();
    const content = fileData.content || '';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      'md': 'text/markdown', 'txt': 'text/plain', 'json': 'application/json',
      'ts': 'text/typescript', 'tsx': 'text/typescript', 'js': 'text/javascript',
      'jsx': 'text/javascript', 'html': 'text/html', 'css': 'text/css',
      'yaml': 'text/yaml', 'yml': 'text/yaml', 'csv': 'text/csv',
      'py': 'text/x-python', 'rs': 'text/x-rust', 'go': 'text/x-go',
    };
    const mimeType = mimeMap[ext] || 'text/plain';
    
    const blob = new Blob([content], { type: mimeType });
    formData.append('file', blob, fileName);
    
    const uploadRes = await fetch(`/api/notebooks/${notebookId}/sources/upload`, {
      method: 'POST',
      body: formData,
    });
    
    if (!uploadRes.ok) {
      console.error('Erreur lors de l\'import');
      return null;
    }
    
    onComplete?.(notebookId);
    return notebookId;
  } catch (e) {
    console.error('Erreur lors de l\'import:', e);
    return null;
  }
}
