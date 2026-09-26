import React, { useMemo } from 'react';
import { marked } from 'marked';
import { sanitizeMarkdownHtml } from '../../utils/sanitizeMarkdownHtml.js';

interface MarkdownPreviewProps {
  content: string;
}

// Configure marked for safe rendering
marked.setOptions({
  gfm: true,
  breaks: true,
});

export const MarkdownPreview = React.memo(function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    try {
      // marked.parse is synchronous when no async extensions are used
      const result = marked.parse(content);
      return typeof result === 'string' ? sanitizeMarkdownHtml(result) : '';
    } catch {
      return '<p>Erreur lors du rendu Markdown.</p>';
    }
  }, [content]);

  return (
    <div
      className="flex-1 w-full min-h-0 overflow-y-auto custom-scrollbar px-8 py-6"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div
        className="markdown-body max-w-[1024px] mx-auto w-full"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML sanitized with sanitizeMarkdownHtml
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
