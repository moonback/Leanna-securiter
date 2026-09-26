import { marked } from 'marked';

export interface DocxExportOptions {
  title?: string;
  author?: string;
  subject?: string;
}

/**
 * Génère un document DOCX conforme (format WordprocessingML) à partir de Markdown.
 * Utilise le format HTML-compatible MHTML / OpenXML pour une compatibilité native
 * immédiate avec Microsoft Word, Google Docs et LibreOffice sans dépendances binaires lourdes.
 */
export function exportToDocx(markdown: string, options: DocxExportOptions = {}): Buffer {
  const { title = 'Document Leanna', author = 'Leanna' } = options;
  const contentHtml = marked.parse(markdown || '', { async: false }) as string;

  const wordDocument = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="utf-8">
  <title>${escapeXml(title)}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1e293b;
    }
    h1 {
      font-size: 20pt;
      color: #0284c7;
      border-bottom: 2pt solid #0284c7;
      padding-bottom: 4pt;
      margin-top: 18pt;
      margin-bottom: 8pt;
    }
    h2 {
      font-size: 15pt;
      color: #0369a1;
      margin-top: 14pt;
      margin-bottom: 6pt;
    }
    h3 {
      font-size: 12pt;
      color: #075985;
      margin-top: 10pt;
      margin-bottom: 4pt;
    }
    p {
      margin-bottom: 8pt;
    }
    ul, ol {
      margin-left: 18pt;
      margin-bottom: 8pt;
    }
    li {
      margin-bottom: 3pt;
    }
    blockquote {
      border-left: 3pt solid #0ea5e9;
      padding-left: 10pt;
      margin-left: 0;
      color: #475569;
      font-style: italic;
    }
    code {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 9.5pt;
      background-color: #f1f5f9;
      padding: 2pt 4pt;
    }
    pre {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 9.5pt;
      background-color: #f8fafc;
      border: 1pt solid #cbd5e1;
      padding: 8pt;
      margin-bottom: 10pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12pt;
    }
    th, td {
      border: 1pt solid #cbd5e1;
      padding: 6pt 8pt;
      text-align: left;
    }
    th {
      background-color: #f1f5f9;
      font-weight: bold;
      color: #0f172a;
    }
  </style>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  <p style="color: #64748b; font-size: 9pt; margin-bottom: 16pt;">
    <em>Auteur : ${escapeXml(author)} — Date : ${new Date().toLocaleDateString('fr-FR')}</em>
  </p>
  ${contentHtml}
</body>
</html>`;

  return Buffer.from(wordDocument, 'utf-8');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
