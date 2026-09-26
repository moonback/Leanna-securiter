/**
 * Service for all IDE-related API calls
 *
 * Optimisations ajoutées:
 * - fetchWithRetry: 429 / 5xx avec backoff exponentiel + header Retry-After
 * - Short-TTL memory cache pour loadTree (lecture fréquente/polling)
 * - In-flight deduplication pour éviter des appels parallèles identiques
 */

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

/** Attend N ms */
function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

/**
 * Wrapper fetch qui retente sur 429 / 5xx avec backoff exponentiel.
 * Respecte le header `Retry-After` si présent (en secondes).
 */
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
      // Si c'est un 429 ou 5xx et qu'on peut encore retenter → backoff
      const isRetryable =
        response.status === 429 ||
        (response.status >= 500 && response.status < 600);

      if (isRetryable && attempt < maxRetries) {
        const retryAfterSec = response.headers.get('Retry-After');
        const retryAfterMs = retryAfterSec
          ? Math.max(0, Number(retryAfterSec) * 1000)
          : baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * (retryAfterMs * 0.2);
        await sleep(retryAfterMs + jitter);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay + Math.random() * delay * 0.2);
        continue;
      }
      throw err;
    }
  }
  // Inatteignable en général, on rethrow last erreur
  throw lastError ?? new Error('fetchWithRetry failed');
}

/** Cache court TTL pour loadTree (évite les 429 en polling) */
type CacheEntry<T> = { value: T; ts: number };
const treeCache = {
  entry: null as CacheEntry<TreeEntry[]> | null,
  ttlMs: 800,
  inFlight: null as Promise<TreeEntry[]> | null,
};

/** Cache pour le workspace tree (hors sandbox), TTL 2s */
const workspaceTreeCache = {
  entry: null as CacheEntry<TreeEntry[]> | null,
  ttlMs: 2000,
  inFlight: null as Promise<TreeEntry[]> | null,
};

/** Cache TTL pour readFile (évite reloads à chaque clic) */
const readFileCache = new Map<string, CacheEntry<string>>();
const READ_FILE_TTL_MS = 1500;

export type TreeEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeEntry[];
};

export type FileContentResponse = {
  content: string;
};

export type FileCountResponse = {
  count: number;
};

export const ideApi = {
  async countFiles(): Promise<number> {
    const response = await fetchWithRetry('/api/ide/file-count', {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: FileCountResponse = await response.json();
    return data.count;
  },

  /**
   * Load the file tree from the server (cached 800ms + dedup in-flight)
   */
  async loadTree(force = false, requestedPath?: string): Promise<TreeEntry[]> {
    if (requestedPath) {
      const response = await fetchWithRetry(`/api/ide/tree?path=${encodeURIComponent(requestedPath)}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.entries || [];
    }

    const now = Date.now();
    if (
      !force &&
      treeCache.entry &&
      now - treeCache.entry.ts < treeCache.ttlMs
    ) {
      return treeCache.entry.value;
    }
    if (!force && treeCache.inFlight) {
      return treeCache.inFlight;
    }
    const p = (async () => {
      try {
        const response = await fetchWithRetry('/api/ide/tree', {
          headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const entries: TreeEntry[] = data.entries || [];
        treeCache.entry = { value: entries, ts: Date.now() };
        return entries;
      } finally {
        treeCache.inFlight = null;
      }
    })();
    treeCache.inFlight = p;
    return p;
  },

  /**
   * Load the real workspace tree (outside sandbox), cached 2s + dedup.
   */
  async loadWorkspaceTree(force = false, requestedPath?: string): Promise<TreeEntry[]> {
    if (requestedPath) {
      const response = await fetchWithRetry(`/api/ide/tree-workspace?path=${encodeURIComponent(requestedPath)}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.entries || [];
    }

    const now = Date.now();
    if (
      !force &&
      workspaceTreeCache.entry &&
      now - workspaceTreeCache.entry.ts < workspaceTreeCache.ttlMs
    ) {
      return workspaceTreeCache.entry.value;
    }
    if (!force && workspaceTreeCache.inFlight) {
      return workspaceTreeCache.inFlight;
    }
    const p = (async () => {
      try {
        const response = await fetchWithRetry('/api/ide/tree-workspace', {
          headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const entries: TreeEntry[] = data.entries || [];
        workspaceTreeCache.entry = { value: entries, ts: Date.now() };
        return entries;
      } finally {
        workspaceTreeCache.inFlight = null;
      }
    })();
    workspaceTreeCache.inFlight = p;
    return p;
  },

  /**
   * Invalide tous les caches (arbre + fichiers).
   * À appeler après un changement de repo pour forcer un rechargement complet.
   */
  invalidateCache(): void {
    treeCache.entry = null;
    treeCache.inFlight = null;
    workspaceTreeCache.entry = null;
    workspaceTreeCache.inFlight = null;
    readFileCache.clear();
  },

  /**
   * Read file content from the server (cached 1500ms, invalidé sur save)
   */
  async readFile(filePath: string, force = false): Promise<string> {
    const now = Date.now();
    if (!force) {
      const cached = readFileCache.get(filePath);
      if (cached && now - cached.ts < READ_FILE_TTL_MS) {
        return cached.value;
      }
    }
    const response = await fetchWithRetry(
      `/api/ide/file?${new URLSearchParams({ path: filePath })}`,
      { headers: getAuthHeaders() },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: FileContentResponse = await response.json();
    readFileCache.set(filePath, { value: data.content, ts: Date.now() });
    return data.content;
  },

  /**
   * Save file content to the server + invalide caches
   */
  async saveFile(filePath: string, content: string): Promise<void> {
    const response = await fetchWithRetry('/api/ide/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    readFileCache.delete(filePath);
    treeCache.entry = null;
  },

  /**
   * Create a new file on the server + invalide cache tree
   */
  async createFile(filePath: string): Promise<void> {
    const response = await fetchWithRetry('/api/ide/create-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ path: filePath }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    treeCache.entry = null;
  },

  /**
   * Create a new directory on the server + invalide cache tree
   */
  async createDirectory(dirPath: string): Promise<void> {
    const response = await fetchWithRetry('/api/ide/create-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ path: dirPath }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    treeCache.entry = null;
  },

  /**
   * Rename a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const response = await fetchWithRetry('/api/ide/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ oldPath, newPath }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    readFileCache.delete(oldPath);
    treeCache.entry = null;
  },

  /**
   * Delete a file or directory
   */
  async deleteEntry(entryPath: string): Promise<void> {
    const response = await fetchWithRetry(
      `/api/ide/file?${new URLSearchParams({ path: entryPath })}`,
      { method: 'DELETE', headers: getAuthHeaders() },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    readFileCache.delete(entryPath);
    treeCache.entry = null;
  },

  /**
   * Copy a file or directory to a new path
   */
  async copyEntry(srcPath: string, destPath: string): Promise<string> {
    const response = await fetchWithRetry('/api/ide/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ srcPath, destPath }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    treeCache.entry = null;
    return data.destPath as string;
  },

  /**
   * Move a file or directory (rename with new parent directory)
   */
  async moveEntry(srcPath: string, destPath: string): Promise<void> {
    const response = await fetchWithRetry('/api/ide/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ oldPath: srcPath, newPath: destPath }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    readFileCache.delete(srcPath);
    treeCache.entry = null;
  },
};

