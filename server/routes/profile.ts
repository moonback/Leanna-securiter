import { Router, Request, Response } from 'express';
import { ProfileConfig } from '../prompts/systemInstruction.js';

export function createProfileRouter(
  getProfile: () => ProfileConfig,
  setProfile: (p: ProfileConfig) => void,
  saveProfile: (p: ProfileConfig) => void,
  getWorkspaceRoot: () => string,
  updateEnvFile: (key: string, value: string) => void,
): Router {
  const router = Router();

  // GET /api/profile
  router.get('/profile', (_req: Request, res: Response) => {
    res.json(getProfile());
  });

  // POST /api/profile
  router.post('/profile', (req: Request, res: Response) => {
    const incoming = req.body as ProfileConfig;
    const merged = { ...getProfile(), ...incoming };
    setProfile(merged);
    saveProfile(merged);
    console.log('[Profile] Updated (keys:', Object.keys(incoming).join(','), ')');
    res.json({ success: true, profile: merged });
  });

  return router;
}

// Token validation helper
async function validateToken(key: string, value: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    switch (key) {
      case 'GEMINI_API_KEY': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${value}`, { signal: controller.signal });
        return r.ok;
      }
      case 'SUPABASE_URL': {
        const url = value.endsWith('/') ? value : value + '/';
        const r = await fetch(`${url}rest/v1/`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '' }, signal: controller.signal });
        return r.status !== 404 && r.status < 500;
      }
      case 'SUPABASE_SERVICE_ROLE_KEY': {
        const supaUrl = process.env.SUPABASE_URL;
        if (!supaUrl) return false;
        const url = supaUrl.endsWith('/') ? supaUrl : supaUrl + '/';
        const r = await fetch(`${url}rest/v1/`, { headers: { apikey: value, Authorization: `Bearer ${value}` }, signal: controller.signal });
        return r.ok || r.status === 200;
      }
      case 'OPENROUTER_API_KEY': {
        const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${value}` }, signal: controller.signal });
        return r.ok;
      }
      case 'GITHUB_TOKEN': {
        const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${value}`, 'User-Agent': 'Leanna' }, signal: controller.signal });
        return r.ok;
      }
      default:
        return false;
    }
  } catch { return false; } finally { clearTimeout(timeoutId); }
}

const TOKEN_KEYS = [
  { key: 'GEMINI_API_KEY', label: 'Gemini API Key' },
  { key: 'SUPABASE_URL', label: 'Supabase URL' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Role Key' },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API Key' },
  { key: 'GITHUB_TOKEN', label: 'GitHub Token' },
];

export function createTokensRouter(updateEnvFile: (key: string, value: string) => void, onGeminiKeyUpdate?: () => Promise<void>): Router {
  const router = Router();

  // GET /api/tokens
  router.get('/tokens', async (_req: Request, res: Response) => {
    const results = await Promise.all(TOKEN_KEYS.map(async ({ key, label }) => {
      const value = process.env[key] || '';
      let valid: boolean | null = null;
      if (value) {
        try { valid = await validateToken(key, value); } catch { valid = false; }
      }
      return {
        key, label, configured: !!value, valid,
        preview: value ? value.slice(0, 4) + '•'.repeat(Math.min(value.length - 4, 20)) : '',
      };
    }));
    res.json({ status: 'success', tokens: results });
  });

  // POST /api/tokens
  router.post('/tokens', async (req: Request, res: Response) => {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key || typeof value !== 'string') return res.status(400).json({ status: 'error', error: 'key et value sont requis.' });
    const allowed = TOKEN_KEYS.map(t => t.key);
    if (!allowed.includes(key)) return res.status(400).json({ status: 'error', error: `Clé non autorisée: ${key}` });
    try {
      updateEnvFile(key, value);
      if (key === 'GEMINI_API_KEY' && onGeminiKeyUpdate) await onGeminiKeyUpdate();
      res.json({ status: 'success', key, configured: !!value });
    } catch (e: any) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  return router;
}
