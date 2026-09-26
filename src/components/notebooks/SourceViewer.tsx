/**
 * SourceViewer — Affiche le contenu complet d'une source dans le panneau principal.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { FileText, Loader2, X, RefreshCw, Tag } from 'lucide-react';
import { marked } from 'marked';
import { sanitizeMarkdownHtml } from '../../utils/sanitizeMarkdownHtml.js';

interface SourceData {
  id: string;
  title: string;
  type: string;
  summary: string;
  keywords: string[];
  wordCount: number;
  language: string;
  chunksCount: number;
}

interface Props {
  notebookId: string;
  sourceId: string;
  source?: SourceData;
  onClose: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  pdf: '📕', text: '📄', markdown: '📝', url: '🌐',
  html: '🌍', youtube: '📺', audio: '🎵', docx: '📘', image: '🖼️',
};

const TYPE_COLORS: Record<string, string> = {
  pdf: 'var(--color-error)', text: 'var(--text-muted)', markdown: 'var(--color-accent-alt)', url: 'var(--accent-primary)',
  html: 'var(--accent-secondary)', youtube: 'var(--color-error)', audio: 'var(--color-warning)', docx: 'var(--accent-primary)', image: 'var(--color-success)',
};

export function SourceViewer({ notebookId, sourceId, source, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [htmlData, setHtmlData] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'visual' | 'text'>('visual');

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/content`);
      if (!res.ok) throw new Error('Impossible de charger le contenu');
      const data = await res.json();
      setContent(data.content || data.text || 'Contenu non disponible');
      // If it's an image source, store the image data
      if (data.type === 'image' && data.imageBase64) {
        setImageData({ base64: data.imageBase64, mimeType: data.imageMimeType || 'image/png' });
        setHtmlData(null);
      } else if (data.type === 'html' && data.rawHtml) {
        setHtmlData(data.rawHtml);
        setImageData(null);
      } else {
        setImageData(null);
        setHtmlData(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [notebookId, sourceId]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <span className="text-xl flex-shrink-0">
          {TYPE_ICONS[source?.type || ''] || '📎'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {source?.title || 'Source'}
            </h2>
            {source?.type && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-bold uppercase flex-shrink-0"
                style={{
                  backgroundColor: `${TYPE_COLORS[source.type] || 'var(--text-muted)'}15`,
                  color: TYPE_COLORS[source.type] || 'var(--text-dimmed)',
                }}
              >
                {source.type}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {source?.wordCount && (
              <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                {source.wordCount.toLocaleString()} mots
              </span>
            )}
            {source?.chunksCount && (
              <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                {source.chunksCount} passages
              </span>
            )}
            {source?.language && (
              <span className="text-xs uppercase" style={{ color: 'var(--text-dimmed)' }}>
                {source.language}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Toggle view mode for HTML sources */}
          {htmlData && (
            <div className="flex items-center rounded-lg overflow-hidden border mr-2" style={{ borderColor: 'var(--border-base)' }}>
              <button
                onClick={() => setViewMode('visual')}
                className="px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: viewMode === 'visual' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'visual' ? 'white' : 'var(--text-muted)',
                }}
              >
                🌍 Visuel
              </button>
              <button
                onClick={() => setViewMode('text')}
                className="px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: viewMode === 'text' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'text' ? 'white' : 'var(--text-muted)',
                }}
              >
                📄 Texte
              </button>
            </div>
          )}
          <button
            onClick={fetchContent}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            title="Recharger le contenu"
          >
            <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            title="Fermer"
          >
            <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Keywords */}
      {source?.keywords && source.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
          <Tag className="w-3 h-3 mt-0.5" style={{ color: 'var(--text-dimmed)' }} />
          {source.keywords.map((kw) => (
            <span
              key={kw}
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 lg:p-7">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement du contenu...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <FileText className="w-8 h-8" style={{ color: 'var(--color-error)' }} />
            <p className="text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>
            <button
              onClick={fetchContent}
              className="px-4 py-2 rounded-full text-xs font-semibold transition active:scale-95"
              style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
            >
              Réessayer
            </button>
          </div>
        ) : imageData ? (
          <div className="space-y-4">
            {/* Image display */}
            <div
              className="rounded-2xl overflow-hidden border shadow-sm"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
            >
              <img
                src={`data:${imageData.mimeType};base64,${imageData.base64}`}
                alt={source?.title || 'Image source'}
                className="w-full h-auto"
                style={{ maxHeight: '600px', objectFit: 'contain' }}
              />
            </div>

            {/* Download button */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = `data:${imageData.mimeType};base64,${imageData.base64}`;
                  link.download = source?.title || 'image.png';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all hover:shadow-sm active:scale-95"
                style={{
                  backgroundColor: 'var(--color-success)20',
                  color: 'var(--color-success)',
                  border: '1px solid var(--color-success)40',
                }}
              >
                📥 Télécharger l'image
              </button>
            </div>

            {/* AI description */}
            {content && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-dimmed)' }}>
                  🤖 Description IA
                </p>
                <div
                  className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap p-4 rounded-xl border"
                  style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)' }}
                >
                  {content}
                </div>
              </div>
            )}
          </div>
        ) : htmlData && viewMode === 'visual' ? (
          <div className="h-full flex flex-col gap-3">
            <div
              className="flex-1 rounded-2xl overflow-hidden border shadow-sm"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'white' }}
            >
              <iframe
                srcDoc={htmlData}
                title={source?.title || 'HTML source'}
                className="w-full h-full border-0"
                sandbox="allow-same-origin"
                style={{ minHeight: '500px' }}
              />
            </div>
          </div>
        ) : (
          <RenderedContent content={content || ''} type={source?.type} />
        )}
      </div>
    </motion.div>
  );
}

/* ─── Markdown / Text renderer ─────────────────────────────────────────────── */

function RenderedContent({ content, type }: { content: string; type?: string }) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const isMarkdownLike = type === 'markdown' || type === 'text';
      if (isMarkdownLike) {
        const result = marked.parse(content, { gfm: true, breaks: true });
        return typeof result === 'string' ? sanitizeMarkdownHtml(result) : '';
      }
      // Fallback: wrap in <pre> for other text types
      const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre style="white-space:pre-wrap;word-break:break-word;">${escaped}</pre>`;
    } catch {
      return `<p>Erreur lors du rendu.</p>`;
    }
  }, [content, type]);

  return (
    <div
      className="markdown-body max-w-none"
      style={{ color: 'var(--text-primary)' }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML sanitized with sanitizeMarkdownHtml
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
