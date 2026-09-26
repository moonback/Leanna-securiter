/**
 * Service sandbox API — centralise les appels /api/sandbox/*.
 *
 * Optimisations:
 * - fetchWithRetry (backoff exponentiel sur 429/5xx, Retry-After)
 * - Cache TTL pour endpoints fréquemment pollés (/status, /diff)
 * - In-flight deduplication (évite appels parallèles identiques)
 * - Écoute de Leanna-sandbox-changed avec debounce pour invalider le cache
 */

type CacheEntry<T> = { value: T; ts: number };
type CacheKey = string;

const caches: Map<CacheKey, CacheEntry<any>> = new Map();
const inFlight: Map<CacheKey, Promise<any>> = new Map();
const invalidateTimers: Map<CacheKey, ReturnType<typeof setTimeout>> = new Map();

/** TTL (ms) des endpoints de status légers */
const STATUS_TTL_MS = 2500;
/** TTL (ms) des endpoints compute-légers comme /diff */
const DIFF_TTL_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Lis / écris le token Leanna depuis localStorage */
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 250 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);
      const retryable =
        response.status === 429 ||
        (response.status >= 500 && response.status < 600);
      if (retryable && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? Math.max(0, Number(retryAfter) * 1000)
          : baseDelayMs * Math.pow(2, attempt);
        await sleep(delayMs + Math.random() * delayMs * 0.2);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const d = baseDelayMs * Math.pow(2, attempt);
        await sleep(d + Math.random() * d * 0.2);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('sandboxApi.fetchWithRetry failed');
}

/**
 * Exécute un GET avec cache + dedup in-flight.
 * Utiliser pour tous les endpoints GET /api/sandbox/*.
 */
async function cachedGet<T = any>(
  url: string,
  ttlMs: number,
  force = false,
): Promise<T> {
  if (!force) {
    const cached = caches.get(url);
    if (cached && Date.now() - cached.ts < ttlMs) {
      return cached.value as T;
    }
    const flying = inFlight.get(url);
    if (flying) return flying as Promise<T>;
  }

  const p = (async () => {
    try {
      const res = await fetchWithRetry(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      caches.set(url, { value: json, ts: Date.now() });
      return json as T;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, p);
  return p;
}

function invalidateCache(url: string) {
  caches.delete(url);
  const t = invalidateTimers.get(url);
  if (t) clearTimeout(t);
}

/** Invalide TOUS les caches sandbox (appelé après mutation side-effect) */
function invalidateAll() {
  for (const key of Array.from(caches.keys())) caches.delete(key);
  for (const t of Array.from(invalidateTimers.values())) clearTimeout(t);
  invalidateTimers.clear();
}

/* ── Écoute globale de Leanna-sandbox-changed ────────────────────────────────
 * Quand ce CustomEvent est émis, on invalide les caches de façon debouncée
 * pour éviter une rafale d'appels si l'événement est émis 30x/s.
 */
let sandboxListenersInstalled = false;
let sandboxDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function handleSandboxChanged() {
  if (sandboxDebounceTimer) clearTimeout(sandboxDebounceTimer);
  sandboxDebounceTimer = setTimeout(() => invalidateAll(), 200);
}

function handleSandboxFileChanged() {
  if (sandboxDebounceTimer) clearTimeout(sandboxDebounceTimer);
  sandboxDebounceTimer = setTimeout(() => invalidateAll(), 200);
}

function installSandboxListeners() {
  if (typeof window === 'undefined' || sandboxListenersInstalled) return;
  
  window.addEventListener('Leanna-sandbox-changed', handleSandboxChanged);
  window.addEventListener('Leanna-sandbox-file-changed', handleSandboxFileChanged);
  sandboxListenersInstalled = true;
}

/**
 * Nettoie les event listeners du sandboxApi.
 * À appeler lors du reload ou de la fermeture de l'application.
 */
export function cleanupSandboxListeners() {
  if (typeof window === 'undefined' || !sandboxListenersInstalled) return;
  
  window.removeEventListener('Leanna-sandbox-changed', handleSandboxChanged);
  window.removeEventListener('Leanna-sandbox-file-changed', handleSandboxFileChanged);
  
  if (sandboxDebounceTimer) {
    clearTimeout(sandboxDebounceTimer);
    sandboxDebounceTimer = null;
  }
  
  sandboxListenersInstalled = false;
}

// Auto-installer au chargement du module
installSandboxListeners();

export type SandboxStatus = {
  status: 'success' | 'error';
  sandbox?: {
    active: boolean;
    path?: string;
    root?: string;
  };
};

export type SandboxDiff = {
  status: 'success' | 'error';
  diff?: string;
};

export const sandboxApi = {
  /** /api/sandbox/status (cached 2.5s, dédupliqué) */
  async getStatus(force = false): Promise<SandboxStatus> {
    return cachedGet<SandboxStatus>('/api/sandbox/status', STATUS_TTL_MS, force);
  },

  /** /api/sandbox/diff (cached 4s) */
  async getDiff(force = false): Promise<SandboxDiff> {
    return cachedGet<SandboxDiff>('/api/sandbox/diff', DIFF_TTL_MS, force);
  },

  /** Mutations POST — invalide immédiatement les caches après succès */
  async init(): Promise<any> {
    const res = await fetchWithRetry('/api/sandbox/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invalidateAll();
    return res.json();
  },

  async activate(): Promise<any> {
    const res = await fetchWithRetry('/api/sandbox/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invalidateAll();
    return res.json();
  },

  async deactivate(): Promise<any> {
    const res = await fetchWithRetry('/api/sandbox/deactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invalidateAll();
    return res.json();
  },

  async discard(): Promise<any> {
    const res = await fetchWithRetry('/api/sandbox/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invalidateAll();
    return res.json();
  },
};
