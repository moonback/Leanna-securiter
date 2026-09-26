import puppeteer, { Browser } from 'puppeteer';
import { exportToStandaloneHtml, HtmlExportOptions } from './htmlExporter.js';

export interface PdfExportOptions extends HtmlExportOptions {
  format?: 'A4' | 'Letter';
  landscape?: boolean;
  printBackground?: boolean;
}

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.connected) {
    sharedBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  }
  return sharedBrowser;
}

/**
 * Génère un document PDF binaire (Buffer) à partir de Markdown.
 */
export async function exportToPdf(markdown: string, options: PdfExportOptions = {}): Promise<Buffer> {
  const html = exportToStandaloneHtml(markdown, { ...options, theme: 'light' });
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    
    const pdfBuffer = await page.pdf({
      format: (options.format || 'A4') as any,
      landscape: options.landscape ?? false,
      printBackground: options.printBackground ?? true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '20mm',
        right: '20mm',
      },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size: 8px; color: #94a3b8; width: 100%; text-align: right; padding-right: 20mm;">${options.title || 'Leanna'}</div>`,
      footerTemplate: '<div style="font-size: 8px; color: #94a3b8; width: 100%; text-align: center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

/**
 * Ferme le navigateur Chromium partagé (utilisé lors du shutdown).
 */
export async function closePdfBrowser(): Promise<void> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      // ignore
    }
    sharedBrowser = null;
  }
}
