import { Router, Request, Response } from 'express';
import { exportToPdf } from '../export/pdfExporter.js';
import { exportToDocx } from '../export/docxExporter.js';
import { exportToStandaloneHtml } from '../export/htmlExporter.js';
import { notebookManager } from '../notebooks/index.js';

export function createExportRouter(): Router {
  const router = Router();

  // POST /api/export/pdf — Exporte un contenu markdown en PDF
  router.post('/pdf', async (req: Request, res: Response) => {
    try {
      const { markdown, title, filename } = req.body as { markdown?: string; title?: string; filename?: string };
      if (!markdown || typeof markdown !== 'string') {
        return res.status(400).json({ error: 'markdown est requis.' });
      }

      const pdfBuffer = await exportToPdf(markdown, { title: title || 'Document Leanna' });
      const safeFilename = encodeURIComponent((filename || title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error('[Export] Erreur export PDF:', e);
      res.status(500).json({ error: e.message || 'Erreur lors de la génération du PDF.' });
    }
  });

  // POST /api/export/docx — Exporte un contenu markdown en DOCX
  router.post('/docx', (req: Request, res: Response) => {
    try {
      const { markdown, title, filename } = req.body as { markdown?: string; title?: string; filename?: string };
      if (!markdown || typeof markdown !== 'string') {
        return res.status(400).json({ error: 'markdown est requis.' });
      }

      const docxBuffer = exportToDocx(markdown, { title: title || 'Document Leanna' });
      const safeFilename = encodeURIComponent((filename || title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_') + '.doc');

      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Length', docxBuffer.length);
      res.send(docxBuffer);
    } catch (e: any) {
      console.error('[Export] Erreur export DOCX:', e);
      res.status(500).json({ error: e.message || 'Erreur lors de la génération du DOCX.' });
    }
  });

  // POST /api/export/html — Exporte un contenu markdown en HTML autonome
  router.post('/html', (req: Request, res: Response) => {
    try {
      const { markdown, title, theme, filename } = req.body as { markdown?: string; title?: string; theme?: 'dark' | 'light' | 'modern'; filename?: string };
      if (!markdown || typeof markdown !== 'string') {
        return res.status(400).json({ error: 'markdown est requis.' });
      }

      const html = exportToStandaloneHtml(markdown, { title: title || 'Document Leanna', theme: theme || 'modern' });
      const safeFilename = encodeURIComponent((filename || title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_') + '.html');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.send(html);
    } catch (e: any) {
      console.error('[Export] Erreur export HTML:', e);
      res.status(500).json({ error: e.message || 'Erreur lors de la génération du HTML.' });
    }
  });

  // POST /api/export/notebook/:id — Exporte un notebook complet (sources + notes)
  router.post('/notebook/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { format = 'pdf', theme = 'light' } = req.body as { format?: 'pdf' | 'docx' | 'html'; theme?: 'dark' | 'light' };
      
      const notebook = notebookManager.getNotebook(id);
      if (!notebook) {
        return res.status(404).json({ error: 'Notebook introuvable.' });
      }

      let markdown = `# 📓 ${notebook.title || 'Notebook'}\n\n`;
      if (notebook.description) {
        markdown += `> ${notebook.description}\n\n`;
      }

      if (notebook.sources && notebook.sources.length > 0) {
        markdown += `## 📚 Sources (${notebook.sources.length})\n\n`;
        for (const source of notebook.sources) {
          markdown += `### ${source.title || source.origin}\n\n`;
          if (source.summary) markdown += `**Résumé :**\n${source.summary}\n\n`;
          if (source.rawText && source.rawText.length < 5000) {
            markdown += `**Extrait :**\n\`\`\`\n${source.rawText.slice(0, 1000)}\n\`\`\`\n\n`;
          }
        }
      }

      if (notebook.notes && notebook.notes.length > 0) {
        markdown += `## 📝 Notes & Synthèses (${notebook.notes.length})\n\n`;
        for (const note of notebook.notes) {
          markdown += `### ${note.title || 'Note'}\n\n${note.content || ''}\n\n`;
        }
      }

      const safeTitle = notebook.title || 'notebook';

      if (format === 'html') {
        const html = exportToStandaloneHtml(markdown, { title: safeTitle, theme });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.html"`);
        return res.send(html);
      }

      if (format === 'docx') {
        const docxBuffer = exportToDocx(markdown, { title: safeTitle });
        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.doc"`);
        res.setHeader('Content-Length', docxBuffer.length);
        return res.send(docxBuffer);
      }

      // Default to PDF
      const pdfBuffer = await exportToPdf(markdown, { title: safeTitle });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error('[Export] Erreur export notebook:', e);
      res.status(500).json({ error: e.message || 'Erreur lors de l\'export du notebook.' });
    }
  });

  return router;
}

export default createExportRouter;
