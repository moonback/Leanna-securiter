import { useState, useRef, useCallback } from 'react';
import { Paperclip, FileText, Image, Loader2, CheckCircle2, X, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Tooltip } from '../ui/Tooltip.js';

interface DocumentUploadProps {
  connected: boolean;
  onDocumentAnalyzed: (result: DocumentResult) => void;
}

export interface DocumentResult {
  fileName: string;
  mimeType: string;
  summary: string;
  extractedTextLength: number;
  provider?: 'gemini' | 'openrouter';
}

/**
 * Document upload button for the ChatPanel input area.
 * Uploads to POST /api/upload-document, displays the analysis result,
 * and notifies the parent to inject context into the live session.
 */
export function DocumentUpload({ connected, onDocumentAnalyzed }: DocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DocumentResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setLastResult(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload-document', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: DocumentResult = await res.json();
      setLastResult(data);
      setShowResult(true);
      onDocumentAnalyzed(data);
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [onDocumentAnalyzed]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const getFileIcon = (mimeType?: string) => {
    if (!mimeType) return <FileText size={14} />;
    if (mimeType.startsWith('image/')) return <Image size={14} />;
    return <FileText size={14} />;
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.jpg,.jpeg,.png,.webp"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload button */}
      <Tooltip
        content="Uploader un document (PDF, image, texte)"
        as="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!connected || uploading}
        className="p-1.5 rounded-lg transition-all disabled:opacity-30 hover:bg-white/10"
      >
        {uploading ? (
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        ) : (
          <Paperclip size={14} style={{ color: 'var(--text-muted)' }} />
        )}
      </Tooltip>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 mx-2"
          >
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--color-error)',
              }}
            >
              <X size={12} className="flex-shrink-0 cursor-pointer" onClick={() => setError(null)} />
              <span className="truncate">{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result card */}
      <AnimatePresence>
        {showResult && lastResult && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            className="absolute bottom-full left-0 right-0 mb-2 mx-1"
          >
            <div
              className="rounded-lg overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-base)',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{ borderBottom: '1px solid var(--border-base)' }}
              >
                <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} />
                <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {lastResult.fileName}
                </span>
                <button
                  onClick={() => setShowResult(false)}
                  className="p-0.5 rounded hover:bg-white/10 transition"
                >
                  <X size={11} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
              {/* Summary preview */}
              <div className="px-3 py-2 max-h-[120px] overflow-y-auto custom-scrollbar">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {lastResult.summary.slice(0, 400)}
                  {lastResult.summary.length > 400 && '…'}
                </p>
              </div>
              {/* Footer */}
              <div
                className="flex items-center gap-2 px-3 py-1.5"
                style={{ borderTop: '1px solid var(--border-base)' }}
              >
                {getFileIcon(lastResult.mimeType)}
                <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                  {lastResult.extractedTextLength > 0
                    ? `${(lastResult.extractedTextLength / 1000).toFixed(1)}k caractères extraits`
                    : 'Image analysée'
                  }
                </span>
                <span className="text-xs ml-auto" style={{ color: 'var(--color-success)' }}>
                  ✓ {lastResult.provider === 'openrouter' ? 'OpenRouter' : 'Gemini'}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Drag & Drop Overlay ─────────────────────────────────────────────────────

interface DropZoneOverlayProps {
  isDragging: boolean;
}

/**
 * Full-panel drag & drop overlay shown when files are dragged over the chat.
 */
export function DropZoneOverlay({ isDragging }: DropZoneOverlayProps) {
  return (
    <AnimatePresence>
      {isDragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 pointer-events-none"
          style={{
            backgroundColor: 'rgba(14, 165, 233, 0.08)',
            border: '2px dashed rgba(14, 165, 233, 0.5)',
            borderRadius: '12px',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(14, 165, 233, 0.15)' }}
          >
            <Upload size={28} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--accent-primary)' }}>
              Déposez votre fichier
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              PDF, image ou texte — analysé par l'IA
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Hook: useDocumentDrop ───────────────────────────────────────────────────

interface UseDocumentDropOptions {
  connected: boolean;
  onDocumentAnalyzed: (result: DocumentResult) => void;
}

/**
 * Hook that manages drag & drop state and file upload for the ChatPanel.
 * Attach the returned handlers to the panel's root div.
 */
export function useDocumentDrop({ connected, onDocumentAnalyzed }: UseDocumentDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);

  const uploadFile = useCallback(async (file: File) => {
    if (!connected) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload-document', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: DocumentResult = await res.json();
      onDocumentAnalyzed(data);
    } catch (err: any) {
      console.error('[DocumentDrop] Upload error:', err.message);
    } finally {
      setUploading(false);
    }
  }, [connected, onDocumentAnalyzed]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = e.dataTransfer.files;
    if (files.length > 0 && connected) {
      // Upload the first file
      const file = files[0];
      const allowedTypes = [
        'application/pdf',
        'image/jpeg', 'image/png', 'image/webp',
        'text/plain', 'text/markdown',
      ];
      // Also check extension for markdown files (browser may not set correct mime)
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isAllowed = allowedTypes.includes(file.type)
        || ext === 'md' || ext === 'txt' || ext === 'pdf';

      if (isAllowed) {
        uploadFile(file);
      }
    }
  }, [connected, uploadFile]);

  return {
    isDragging,
    uploading,
    dropHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  };
}
