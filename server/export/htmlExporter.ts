import { marked } from 'marked';

export interface HtmlExportOptions {
  title?: string;
  author?: string;
  theme?: 'dark' | 'light' | 'academic' | 'modern';
  _includeToc?: boolean;
  headerDate?: string;
}

/**
 * Génère un document HTML autonome et moderne à partir de Markdown.
 */
export function exportToStandaloneHtml(markdown: string, options: HtmlExportOptions = {}): string {
  const {
    title = 'Document Leanna',
    author = 'Leanna',
    theme = 'modern',
    headerDate = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
  } = options;

  const contentHtml = marked.parse(markdown || '', { async: false }) as string;

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0f172a' : '#ffffff';
  const textColor = isDark ? '#f8fafc' : '#1e293b';
  const headingColor = isDark ? '#38bdf8' : '#0284c7';
  const codeBg = isDark ? '#1e293b' : '#f1f5f9';
  const borderColor = isDark ? '#334155' : '#e2e8f0';

  return `<!DOCTYPE html>
<html lang="fr" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');

    :root {
      --bg: ${bgColor};
      --text: ${textColor};
      --heading: ${headingColor};
      --code-bg: ${codeBg};
      --border: ${borderColor};
      --primary: #0ea5e9;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.7;
      padding: 2.5rem 1.5rem;
      max-width: 900px;
      margin: 0 auto;
    }

    header {
      border-bottom: 2px solid var(--border);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
    }

    header h1 {
      font-size: 2.2rem;
      color: var(--heading);
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 0.5rem;
    }

    .meta {
      font-size: 0.9rem;
      color: #64748b;
      display: flex;
      gap: 1.5rem;
    }

    h1, h2, h3, h4, h5, h6 {
      color: var(--heading);
      margin-top: 1.8rem;
      margin-bottom: 0.8rem;
      font-weight: 600;
    }

    h2 { font-size: 1.6rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    h3 { font-size: 1.3rem; }
    h4 { font-size: 1.1rem; }

    p {
      margin-bottom: 1.2rem;
    }

    ul, ol {
      margin-bottom: 1.2rem;
      padding-left: 1.8rem;
    }

    li {
      margin-bottom: 0.4rem;
    }

    blockquote {
      border-left: 4px solid var(--primary);
      padding: 0.8rem 1.2rem;
      background: var(--code-bg);
      border-radius: 0 8px 8px 0;
      margin-bottom: 1.5rem;
      font-style: italic;
    }

    code {
      font-family: 'Fira Code', monospace;
      background: var(--code-bg);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-size: 0.9em;
    }

    pre {
      background: var(--code-bg);
      padding: 1.2rem;
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 1.5rem;
      border: 1px solid var(--border);
    }

    pre code {
      padding: 0;
      background: transparent;
      font-size: 0.88em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
    }

    th, td {
      border: 1px solid var(--border);
      padding: 0.75rem 1rem;
      text-align: left;
    }

    th {
      background: var(--code-bg);
      font-weight: 600;
    }

    tr:nth-child(even) {
      background: rgba(0, 0, 0, 0.02);
    }

    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }

    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.85rem;
      color: #64748b;
    }

    @media print {
      body {
        padding: 0;
        max-width: 100%;
        color: #000;
        background: #fff;
      }
      header h1 { color: #0284c7; }
      pre, blockquote, table { page-break-inside: avoid; }
      @page {
        margin: 2cm;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>Auteur : ${escapeHtml(author)}</span>
      <span>Date : ${escapeHtml(headerDate)}</span>
    </div>
  </header>

  <main>
    ${contentHtml}
  </main>

  <footer>
    Document généré automatiquement par Leanna — ${escapeHtml(headerDate)}
  </footer>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
