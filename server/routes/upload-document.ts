import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createRateLimiter } from '../security.js';
import { withGeminiRetry } from '../utils/geminiKeyPool.js';
import { ProfileConfig } from '../prompts/systemInstruction.js';
import { scanPromptInjection } from '../utils/promptInjectionGuard.js';
import { createLogger } from '../utils/logger.js';
import { getDocumentStore } from '../knowledge/DocumentStore.js';

const log = createLogger('UploadDocumentRoute');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const uploadLimiter = createRateLimiter(10, 60_000);

export function createUploadDocumentRouter(getProfile: () => ProfileConfig): Router {
  const router = Router();
  const documentContextStore: { fileName: string; summary: string; extractedText: string; uploadedAt: string }[] = [];

  function enforceRateLimit(key: string, res: Response): boolean {
    if (!uploadLimiter.check(key)) {
      res.status(429).json({ error: 'Too many requests' });
      return false;
    }
    return true;
  }

  // POST /api/upload-document
  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] || req.ip || 'unknown';
      if (!enforceRateLimit(clientIp, res)) return;
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const file = req.file;
      const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/markdown'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        res.status(400).json({ error: 'Unsupported file type. Please upload PDF, images, or text files.' });
        return;
      }

      let extractedText = '';
      let analysisPrompt = '';
      let promptInjection = scanPromptInjection('');

      if (file.mimetype === 'application/pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: file.buffer });
        const pdfData = await parser.getText();
        await parser.destroy();
        extractedText = pdfData.text || '';
        promptInjection = scanPromptInjection(extractedText);
        const safeExtractedText = promptInjection.sanitizedText;
        const pageCount = pdfData.total || 0;
        const maxChars = 80_000;
        const textForAnalysis = safeExtractedText.length > maxChars
          ? safeExtractedText.slice(0, maxChars) + '\n\n[… texte tronqué …]'
          : safeExtractedText;
        analysisPrompt = [
          `Voici le contenu textuel extrait d'un document PDF intitulé "${file.originalname}" (${pageCount} pages):`,
          '',
          textForAnalysis,
          '',
          'Résume en français les informations clés de ce document.',
          'Sois concis et structure ta réponse avec des titres et bullet points.',
        ].join('\n');
      } else if (file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
        extractedText = file.buffer.toString('utf-8');
        promptInjection = scanPromptInjection(extractedText);
        analysisPrompt = [
          `Voici le contenu d'un fichier texte "${file.originalname}":`,
          '',
          promptInjection.sanitizedText.slice(0, 80_000),
          '',
          'Résume en français les informations clés de ce document.',
          'Sois concis et structure ta réponse.',
        ].join('\n');
      } else {
        analysisPrompt = 'Décris cette image en français et extrais les textes pertinents. Sois concis et structure ta réponse.';
      }

      // The regex guard is only a heuristic, but a high-risk text document must
      // never be forwarded to a model without an explicit user decision.
      if (promptInjection.blocked) {
        log.warn('High-risk document rejected before model analysis', {
          fileName: file.originalname,
          mimeType: file.mimetype,
          riskScore: promptInjection.riskScore,
          findings: promptInjection.findings.map((finding) => finding.pattern),
        });
        res.status(422).json({
          error: 'Document potentiellement malveillant : analyse automatique refusée.',
          fileName: file.originalname,
          promptInjection: {
            riskScore: promptInjection.riskScore,
            blocked: true,
            findings: promptInjection.findings,
          },
        });
        return;
      }

      const profile = getProfile();
      const provider = profile.textProvider || 'gemini';
      let summary = '';

      if (provider === 'openrouter') {
        const orKey = (profile as any).openrouterApiKey?.trim() || process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_FREE_API_KEY;
        if (!orKey) {
          res.status(400).json({ error: 'Aucune clé API OpenRouter disponible. Configurez-la dans les réglages.' });
          return;
        }
        const orModel = (profile as any).openrouterModel || 'google/gemini-3.6-flash';

        let messages: any[];
        if (file.mimetype.startsWith('image/')) {
          messages = [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` } },
            { type: 'text', text: analysisPrompt },
          ]}];
        } else {
          messages = [{ role: 'user', content: analysisPrompt }];
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60_000);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://Leanna.local', 'X-Title': 'Leanna' },
          body: JSON.stringify({ model: orModel, messages, temperature: 0.3, max_tokens: 1024 }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
        }
        const data = await response.json();
        summary = data.choices?.[0]?.message?.content || '';
      } else {
        let geminiParts: any[];
        if (file.mimetype.startsWith('image/')) {
          geminiParts = [
            { inlineData: { data: file.buffer.toString('base64'), mimeType: file.mimetype } },
            { text: analysisPrompt },
          ];
        } else {
          geminiParts = [{ text: analysisPrompt }];
        }
        const response = await withGeminiRetry((ai) => ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: geminiParts }],
        }));
        summary = response.text || '';
      }

      documentContextStore.push({
        fileName: file.originalname,
        summary,
        extractedText: extractedText.slice(0, 20_000),
        uploadedAt: new Date().toISOString(),
      });
      if (documentContextStore.length > 5) documentContextStore.shift();

      // Persister dans le DocumentStore pour l'analyse inter-documents
      try {
        const docStore = getDocumentStore();
        docStore.addDocument({
          fileName: file.originalname,
          mimeType: file.mimetype,
          summary,
          extractedText: extractedText.slice(0, 30_000),
          uploadedAt: new Date().toISOString(),
          originalTextLength: extractedText.length,
          tags: [],
        });
      } catch (persistErr: any) {
        log.warn('DocumentStore persistence warning:', persistErr.message);
      }

      res.json({
        summary,
        fileName: file.originalname,
        mimeType: file.mimetype,
        extractedTextLength: extractedText.length,
        provider,
        promptInjection: {
          riskScore: promptInjection.riskScore,
          blocked: promptInjection.blocked,
          findings: promptInjection.findings,
        },
      });
      return;
    } catch (e: any) {
      log.error('Upload error:', e);
      res.status(500).json({ error: e.message });
      return;
    }
  });

  // GET /api/upload-document/context
  router.get('/context', (_req: Request, res: Response) => {
    res.json({ documents: documentContextStore });
  });

  return router;
}
