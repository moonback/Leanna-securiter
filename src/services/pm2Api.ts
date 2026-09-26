// Service léger pour consommer les endpoints PM2 du backend.
// Respecte le style de ideApi.ts : throw en cas de statut non-ok,
// mais sans cache car les données PM2 doivent être fraîches.

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

function mergeAuthHeaders(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...getAuthHeaders(),
    },
  };
}

export interface Pm2AppStatus {
  id: number;
  pid: number | null;
  name: string;
  status: string;
  mode: string | null;
  instances: number;
  cpu: number;
  memoryMB: number;
  uptimeSeconds: number | null;
  restartCount: number;
  unstableRestarts: number;
  nodeVersion: string | null;
  cwd: string | null;
  execPath: string | null;
}

export interface Pm2StatusResponse {
  status: 'ok';
  daemon: {
    pid?: number | null;
    uptimeSeconds?: number | null;
  };
  apps: Pm2AppStatus[];
  host: {
    hostname: string;
    arch: string;
    platform: string;
    cores: number;
  };
  queriedAt: string;
}

export interface Pm2LogsResponse {
  status: 'ok';
  name: string;
  lines: number;
  entries: string[];
}

export interface Pm2ActionResponse {
  status: 'ok';
  action: string;
  name?: string;
  file?: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    let msg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed?.error) msg = parsed.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const pm2Api = {
  async getStatus(): Promise<Pm2StatusResponse> {
    const res = await fetch('/api/pm2/status', mergeAuthHeaders({ cache: 'no-store' }));
    return parseJson<Pm2StatusResponse>(res);
  },

  async restart(name: string): Promise<Pm2ActionResponse> {
    const res = await fetch(`/api/pm2/${encodeURIComponent(name)}/restart`, mergeAuthHeaders({ method: 'POST' }));
    return parseJson<Pm2ActionResponse>(res);
  },

  async stop(name: string): Promise<Pm2ActionResponse> {
    const res = await fetch(`/api/pm2/${encodeURIComponent(name)}/stop`, mergeAuthHeaders({ method: 'POST' }));
    return parseJson<Pm2ActionResponse>(res);
  },

  async reload(file = 'ecosystem.config.cjs'): Promise<Pm2ActionResponse> {
    const url = new URL('/api/pm2/reload', window.location.origin);
    if (file) url.searchParams.set('file', file);
    const res = await fetch(url.toString(), mergeAuthHeaders({ method: 'POST' }));
    return parseJson<Pm2ActionResponse>(res);
  },

  async flush(): Promise<Pm2ActionResponse> {
    const res = await fetch('/api/pm2/flush', mergeAuthHeaders({ method: 'POST' }));
    return parseJson<Pm2ActionResponse>(res);
  },

  async getLogs(name: string, opts: { lines?: number } = {}): Promise<Pm2LogsResponse> {
    const url = new URL(`/api/pm2/logs/${encodeURIComponent(name)}`, window.location.origin);
    if (typeof opts.lines === 'number') url.searchParams.set('lines', String(opts.lines));
    const res = await fetch(url.toString(), mergeAuthHeaders({ cache: 'no-store' }));
    return parseJson<Pm2LogsResponse>(res);
  },
};
