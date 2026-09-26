import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { SELF_ROOT, CRITICAL_FILES, hasProject } from '../utils/selfRoot.js';
import {
  LEANNAIGNORE_FILENAME,
  getIgnoreFilePath,
  parseIgnoreContent,
  clearIgnoreCache,
} from '../utils/leannaignore.js';
import { isSandboxActive, getSandboxRoot } from '../utils/sandbox.js';

const router = Router();

interface CacheEntry {
  value: any;
  expiresAt: number;
}
const readCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2000;

function cachedRead(configPath: string, fallback: any): any {
  const now = Date.now();
  const cached = readCache.get(configPath);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  let result: any;
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      result = JSON.parse(raw);
    } else {
      result = fallback;
    }
  } catch {
    result = fallback;
  }
  readCache.set(configPath, { value: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}

function invalidateCache(configPath: string) {
  readCache.delete(configPath);
}

// GET /api/safeguards/config
router.get('/config', (_req: Request, res: Response) => {
  const configPath = path.join(SELF_ROOT, '.Leanna', 'safeguards.json');
  const defaultConfig = {
    autoCheckpoint: true,
    postEditValidation: true,
    criticalFileConfirm: true,
    autoRestart: true,
    criticalFiles: [...CRITICAL_FILES],
  };
  const config = cachedRead(configPath, defaultConfig);
  res.json({ config });
});

// POST /api/safeguards/config
router.post('/config', (req: Request, res: Response) => {
  const configDir = path.join(SELF_ROOT, '.Leanna');
  const configPath = path.join(configDir, 'safeguards.json');
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2), 'utf-8');
    invalidateCache(configPath);
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/safeguards/checkpoints
router.get('/checkpoints', async (req: Request, res: Response) => {
  try {
    const { listCheckpoints } = await import('../utils/checkpoint.js');
    const count = parseInt(req.query.limit as string) || 5;
    const checkpoints = await listCheckpoints(count);
    res.json({ checkpoints });
  } catch (e: any) {
    res.json({ checkpoints: [] });
  }
});

// POST /api/safeguards/validate
router.post('/validate', async (_req: Request, res: Response) => {
  try {
    const { validateBuild } = await import('../utils/checkpoint.js');
    const result = await validateBuild();
    res.json({ success: result.valid, errors: result.errors });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// POST /api/safeguards/rollback
router.post('/rollback', async (req: Request, res: Response) => {
  try {
    const { rollbackToCheckpoint } = await import('../utils/checkpoint.js');
    const { hash } = req.body as { hash?: string };
    if (!hash) return res.status(400).json({ error: 'hash est requis.' });
    const ok = await rollbackToCheckpoint(hash);
    res.json({ success: ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Liste d'exclusion .leannaignore ──────────────────────────────────────────
//
// Dossiers/motifs de fichiers interdits en écriture à l'agent. Le fichier vit
// à la racine du projet actif (SELF_ROOT/.leannaignore). Les modifications
// prennent effet immédiatement (isWriteForbidden relit via cache mtime).

// Limite de taille pour éviter d'écrire un fichier démesuré depuis l'UI.
const MAX_IGNORE_BYTES = 64 * 1024; // 64 Kio

// GET /api/safeguards/ignore
router.get('/ignore', (_req: Request, res: Response) => {
  if (!hasProject()) {
    return res.status(409).json({ error: 'Aucun projet actif.' });
  }
  const ignorePath = getIgnoreFilePath(SELF_ROOT);
  try {
    let content = '';
    if (fs.existsSync(ignorePath)) {
      content = fs.readFileSync(ignorePath, 'utf-8');
    }
    const rules = parseIgnoreContent(content);
    res.json({
      exists: fs.existsSync(ignorePath),
      filename: LEANNAIGNORE_FILENAME,
      content,
      // Aperçu résolu des règles (motif + négation) pour affichage UI.
      rules: rules.map((r) => ({ pattern: r.pattern, negated: r.negated })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/safeguards/ignore  { content: string }
router.post('/ignore', (req: Request, res: Response) => {
  if (!hasProject()) {
    return res.status(409).json({ error: 'Aucun projet actif.' });
  }
  const { content } = req.body as { content?: unknown };
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Le champ "content" (string) est requis.' });
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_IGNORE_BYTES) {
    return res.status(413).json({ error: 'Fichier .leannaignore trop volumineux (max 64 Kio).' });
  }

  const ignorePath = getIgnoreFilePath(SELF_ROOT);
  try {
    // Normalise la fin de fichier avec un saut de ligne final unique.
    const normalized = content.replace(/\r\n/g, '\n').replace(/\s*$/, '') + '\n';

    // 1. Écriture dans le projet principal (source de vérité pour isWriteForbidden).
    fs.writeFileSync(ignorePath, normalized, 'utf-8');
    clearIgnoreCache(SELF_ROOT);

    // 2. Miroir dans le sandbox actif, afin que la copie isolée sur laquelle
    //    l'agent travaille reflète immédiatement la même liste d'exclusion.
    let mirroredToSandbox = false;
    if (isSandboxActive()) {
      try {
        const sandboxIgnorePath = getIgnoreFilePath(getSandboxRoot());
        fs.writeFileSync(sandboxIgnorePath, normalized, 'utf-8');
        clearIgnoreCache(getSandboxRoot());
        mirroredToSandbox = true;
      } catch (mirrorErr: any) {
        // Le miroir sandbox est best-effort : l'échec ne doit pas casser
        // l'enregistrement principal.
        console.warn('[Safeguards] Miroir .leannaignore vers le sandbox échoué:', mirrorErr?.message);
      }
    }

    const rules = parseIgnoreContent(normalized);
    res.json({
      status: 'success',
      mirroredToSandbox,
      rules: rules.map((r) => ({ pattern: r.pattern, negated: r.negated })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
