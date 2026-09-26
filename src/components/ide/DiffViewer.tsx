import { useCallback, useEffect, useRef, useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import * as monacoInstance from 'monaco-editor';
// Use the bundled monaco instance to avoid CDN loader (fixes CSP violations)
loader.config({ monaco: monacoInstance });
import { X, RefreshCcw, RotateCcw } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  /** Chemin du fichier à comparer */
  filePath: string;
  /** Contenu actuel (éditeur) */
  currentContent: string;
  /** Thème Monaco */
  theme?: string;
  /** Callback pour fermer le viewer */
  onClose: () => void;
}

// ── Auth helpers ───────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

// ── Component ──────────────────────────────────────────────────────────────

export function DiffViewer({ filePath, currentContent, theme = 'vs-dark', onClose }: DiffViewerProps) {
  const [savedContent, setSavedContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Référence à l'instance DiffEditor de Monaco, pour la disposer proprement
  // au démontage. Sans ça, Monaco annule ses tâches différées (layout, workers)
  // à l'unmount et rejette des promesses `Canceled` non catchées, qui polluent
  // la console avec « Uncaught (in promise) Canceled ».
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const handleEditorMount = useCallback((editor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor;
  }, []);

  useEffect(() => {
    return () => {
      const editor = diffEditorRef.current;
      if (!editor) return;
      // Dispose des modèles original/modifié puis de l'éditeur : coupe court
      // aux tâches en vol avant que React ne démonte le nœud, ce qui évite les
      // rejets `Canceled` remontés en console.
      try {
        const model = editor.getModel();
        model?.original?.dispose();
        model?.modified?.dispose();
        editor.dispose();
      } catch { /* déjà disposé — sans effet */ }
      diffEditorRef.current = null;
    };
  }, []);

  // ── Load saved file content ────────────────────────────────────────────────

  const loadSavedContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/ide/file?${new URLSearchParams({ path: filePath })}`, {
        headers: getAuthHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setSavedContent(data.content || '');
    } catch (e: any) {
      console.error('Erreur lors du chargement du fichier sauvegardé:', e);
      setError(e.message || 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    loadSavedContent();
  }, [loadSavedContent]);

  // ── Keyboard handling ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasChanges = currentContent !== savedContent;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: 'var(--bg-main)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b p-3"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-3">
          <h2 className="font-medium" style={{ color: 'var(--text-primary)' }}>
            Comparaison : {filePath.split('/').pop()}
          </h2>
          <div
            className={`rounded-full px-2 py-1 text-xs ${
              hasChanges 
                ? 'bg-orange-500/20 text-orange-400' 
                : 'bg-green-500/20 text-green-400'
            }`}
          >
            {hasChanges ? 'Modifié' : 'Aucune modification'}
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {hasChanges && (
            <>
              <button
                onClick={() => {
                  // Accept current changes — save the file
                  fetch(`/api/ide/file`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ path: filePath, content: currentContent }),
                  }).then(() => onClose());
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition hover:opacity-90"
                style={{
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: 'var(--color-success)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                }}
                title="Accepter les modifications"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Accepter
              </button>
              <button
                onClick={() => {
                  // Revert to saved — dispatch event to reload
                  window.dispatchEvent(new CustomEvent('Leanna-ide-file-changed', { detail: { path: filePath } }));
                  onClose();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition hover:opacity-90"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  color: 'var(--color-error)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                }}
                title="Revenir à la version sauvegardée"
              >
                <RotateCcw size={11} />
                Revenir
              </button>
            </>
          )}
          <button
            onClick={loadSavedContent}
            disabled={loading}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-50"
            title="Actualiser"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <RefreshCcw size={12} style={{ color: 'var(--text-muted)' }} />
          </button>
          
          <button
            onClick={onClose}
            className="p-1.5 transition hover:bg-white/10"
            title="Fermer (Escape)"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        {loading ? (
          <div
            className="flex h-full items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            Chargement de la version sauvegardée...
          </div>
        ) : error ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <div className="text-red-400">Erreur : {error}</div>
            <button
              onClick={loadSavedContent}
              className="rounded border px-3 py-1.5 text-sm transition hover:bg-white/10"
              style={{ borderColor: 'var(--border-base)' }}
              title="Réessayer le chargement"
            >
              Réessayer
            </button>
          </div>
        ) : (
          <DiffEditor
            original={savedContent}
            modified={currentContent}
            theme={theme}
            onMount={handleEditorMount}
            options={{
              renderSideBySide: true,
              readOnly: true,
              fontSize: 14,
              wordWrap: 'on',
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
              originalEditable: false,
              diffWordWrap: 'on',
              ignoreTrimWhitespace: false,
              renderWhitespace: 'boundary',
            }}
          />
        )}
      </div>

      {/* Footer - Legend */}
      <div
        className="border-t px-3 py-2 text-xs"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-muted)' }}
      >
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-red-400"></div>
            Supprimé
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-green-400"></div>
            Ajouté
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-orange-400"></div>
            Modifié
          </span>
          <span className="ml-auto">
            Gauche: Version sauvegardée • Droite: Version courante
          </span>
        </div>
      </div>
    </div>
  );
}