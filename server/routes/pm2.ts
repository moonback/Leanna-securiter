import { Router, Request, Response } from 'express';
import { execFile, exec } from 'child_process';
import os from 'os';

const router = Router();

function escapeShellArg(arg: string): string {
  if (process.platform === 'win32') {
    if (/[\s"]/.test(arg)) {
      return '"' + arg.replace(/"/g, '""') + '"';
    }
    return arg;
  }
  if (/[^\w@%+=:,./-]/.test(arg)) {
    return "'" + arg.replace(/'/g, "'\\''") + "'";
  }
  return arg;
}

function runPm2(args: string[]): Promise<string> {
  const timeout = 15_000;
  const maxBuffer = 10 * 1024 * 1024;
  const argLine = args.map(escapeShellArg).join(' ');

  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (err: Error | null, out?: string) => {
      if (finished) return;
      finished = true;
      if (err) reject(err);
      else resolve(out ?? '');
    };

    const tryUnix = () => {
      const cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
      let child;
      try {
        child = execFile(
          cmd,
          args,
          { timeout, maxBuffer, windowsHide: true },
          (err, stdout, stderr) => {
            if (err) {
              if (process.platform === 'win32') return tryShell();
              const hint = stderr?.toString()?.trim() || '';
              return done(new Error(hint || (err as Error).message || `pm2 ${args.join(' ')} failed`));
            }
            done(null, stdout.toString());
          },
        );
      } catch (e: any) {
        if (process.platform === 'win32') return tryShell();
        return done(e);
      }
      child.on('error', (e: any) => {
        if (process.platform === 'win32') return tryShell();
        done(e);
      });
    };

    const tryShell = () => {
      const cmdStr = 'pm2 ' + argLine;
      let child;
      try {
        child = exec(
          cmdStr,
          { timeout, maxBuffer, windowsHide: true },
          (err, stdout, stderr) => {
            if (err) {
              const hint = stderr?.toString()?.trim() || '';
              return done(new Error(hint || (err as Error).message || `pm2 ${args.join(' ')} failed`));
            }
            done(null, stdout.toString());
          },
        );
      } catch (e: any) {
        return done(e);
      }
      child.on('error', done);
    };

    tryUnix();
  });
}

interface Pm2Process {
  pid: number;
  name: string;
  pm_id: number;
  status: 'online' | 'stopped' | 'errored' | 'stopping' | 'launching' | 'waiting' | 'one-launch-status' | string;
  pm2_env: {
    pm_uptime?: number;
    created_at?: number;
    restart_time?: number;
    unstable_restarts?: number;
    node_version?: string;
    versioning?: { type?: string; url?: string; revision?: string; comment?: string } | null;
    NODE_APP_INSTANCE?: number;
    exec_mode?: 'cluster' | 'fork';
    instances?: number | string;
    node_args?: string;
    args?: string;
    pm_exec_path?: string;
    pm_cwd?: string;
    env?: Record<string, string | undefined>;
  };
  monit: {
    memory: number;
    cpu: number;
  };
}

interface Pm2StatusResponse {
  status: 'ok';
  daemon: {
    pid?: number | null;
    uptimeSeconds?: number | null;
  };
  apps: Array<{
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
  }>;
  host: {
    hostname: string;
    arch: string;
    platform: string;
    cores: number;
  };
  queriedAt: string;
}

function normalizeProcesses(list: Pm2Process[]): Pm2StatusResponse['apps'] {
  const grouped = new Map<string, { total: Pm2Process[]; first: Pm2Process }>();
  for (const p of list) {
    const key = p.name || `pm_id_${p.pm_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, { total: [], first: p });
    }
    grouped.get(key)!.total.push(p);
  }

  return [...grouped.entries()].map(([, g]) => {
    const procs = g.total;
    const first = g.first;
    const cpu = procs.reduce((s, p) => s + (p.monit?.cpu ?? 0), 0);
    const memBytes = procs.reduce((s, p) => s + (p.monit?.memory ?? 0), 0);
    const statuses = [...new Set(procs.map(p => p.status || 'unknown'))];
    const status = statuses.includes('online') && statuses.length === 1
      ? 'online'
      : statuses.join('/');
    const instances = procs.length;
    const now = Date.now();
    const uptimes = procs
      .map(p => (p.pm2_env?.pm_uptime ? (now - p.pm2_env.pm_uptime) / 1000 : null))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const uptimeSeconds = uptimes.length ? Math.max(...uptimes) : null;
    const restartCount = Math.max(...procs.map(p => p.pm2_env?.restart_time ?? 0));
    const unstableRestarts = Math.max(...procs.map(p => p.pm2_env?.unstable_restarts ?? 0));
    const nodeVersion = first.pm2_env?.node_version || null;
    const cwd = first.pm2_env?.pm_cwd || null;
    const execPath = first.pm2_env?.pm_exec_path || null;
    const mode = first.pm2_env?.exec_mode || null;
    const pid = procs[0]?.pid ?? null;

    return {
      id: first.pm_id,
      pid,
      name: first.name,
      status,
      mode,
      instances,
      cpu: Math.round(cpu * 10) / 10,
      memoryMB: Math.round(memBytes / 1024 / 1024),
      uptimeSeconds,
      restartCount,
      unstableRestarts,
      nodeVersion,
      cwd,
      execPath,
    };
  });
}

// GET /api/pm2/status
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const raw = await runPm2(['jlist']);
    let list: Pm2Process[] = [];
    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }

    let daemon: Pm2StatusResponse['daemon'] = { pid: null, uptimeSeconds: null };
    try {
      const pingRaw = await runPm2(['ping']).catch(() => '');
      const infoRaw = await runPm2(['info', '--json']).catch(() => '{}');
      try {
        const info = JSON.parse(infoRaw);
        if (info?.daemon?.pm2_daemon_pid) daemon.pid = info.daemon.pm2_daemon_pid;
        if (info?.daemon?.pm2_uptime) {
          daemon.uptimeSeconds = Math.max(0, Math.round((Date.now() - info.daemon.pm2_uptime) / 1000));
        }
      } catch {
        // best effort
      }
      if (!daemon.pid) {
        const pingNum = Number(String(pingRaw).trim());
        if (Number.isFinite(pingNum) && pingNum > 0) daemon.pid = pingNum;
      }
    } catch {
      // ignore
    }

    const apps = normalizeProcesses(list);
    const osHost = {
      hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname(),
      arch: process.arch,
      platform: process.platform,
      cores: os.cpus().length,
    };

    res.json({
      status: 'ok',
      daemon,
      apps,
      host: osHost,
      queriedAt: new Date().toISOString(),
    } satisfies Pm2StatusResponse);
  } catch (e: any) {
    const msg = e?.message || String(e) || 'PM2 indisponible';
    console.error('[PM2] GET /status failed:', msg, e?.code ? `(code=${e.code})` : '');
    res.status(503).json({ status: 'error', error: msg });
  }
});

// POST /api/pm2/:name/restart  (body optional: { ecosystem?: boolean })
router.post('/:name/restart', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) {
    res.status(400).json({ status: 'error', error: 'Nom d\'application invalide' });
    return;
  }
  try {
    await runPm2(['restart', name]);
    res.json({ status: 'ok', action: 'restart', name });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message || String(e) });
  }
});

// POST /api/pm2/:name/stop
router.post('/:name/stop', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) {
    res.status(400).json({ status: 'error', error: 'Nom d\'application invalide' });
    return;
  }
  try {
    await runPm2(['stop', name]);
    res.json({ status: 'ok', action: 'stop', name });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message || String(e) });
  }
});

// POST /api/pm2/flush
router.post('/flush', async (_req: Request, res: Response): Promise<void> => {
  try {
    await runPm2(['flush']);
    res.json({ status: 'ok', action: 'flush' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message || String(e) });
  }
});

// POST /api/pm2/reload   (optionnellement avec ?file=ecosystem.config.cjs)
router.post('/reload', async (req: Request, res: Response): Promise<void> => {
  const file = typeof req.query.file === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(req.query.file)
    ? req.query.file
    : 'ecosystem.config.cjs';
  try {
    await runPm2(['reload', file]);
    res.json({ status: 'ok', action: 'reload', file });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message || String(e) });
  }
});

// GET /api/pm2/logs/:name?lines=50&type=out|err|all
router.get('/logs/:name', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) {
    res.status(400).json({ status: 'error', error: 'Nom d\'application invalide' });
    return;
  }
  const lines = Math.max(1, Math.min(500, Number(req.query.lines) || 80));
  try {
    const raw = await runPm2(['logs', name, '--nostream', '--lines', String(lines), '--raw']);
    const entries = raw.split(/\r?\n/).filter(Boolean);
    res.json({ status: 'ok', name, lines: entries.length, entries });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message || String(e) });
  }
});

export default router;
