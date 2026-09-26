import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import { setSelfRoot, SELF_ROOT } from './utils/selfRoot.js';
import { authenticateToken } from './security.js';
import { createTerminalRouter, setupTerminalWebSocket } from './routes/terminal.js';
import { attachLiveWebSocket, type LiveSocketDeps } from './live/LiveSocketHandler.js';

{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname_local = path.dirname(__filename);
  setSelfRoot(path.resolve(__dirname_local, '..'));
}

function waitForWsOpen(ws: WebSocket, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const timer = setTimeout(() => reject(new Error('Timeout waiting for WebSocket open')), timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForCondition(check: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (check()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for condition after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

function closeWebSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.terminate();
  });
}

function closeHttpServer(server: http.Server): Promise<void> {
  server.close();
  server.closeAllConnections();
  return Promise.resolve();
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) client.terminate();
  wss.close();
  return Promise.resolve();
}

// ─── Tests Routeur REST Terminal ─────────────────────────────────────────────

test('terminal REST: GET /terminal/config returns environment configuration', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/terminal/config`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.shell, 'shell should be defined');
    assert.ok(body.cwd, 'cwd should be defined');
    assert.ok(body.platform, 'platform should be defined');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('terminal REST: GET /terminal/sessions and POST /terminal/close', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const sessionsRes = await fetch(`http://127.0.0.1:${port}/api/terminal/sessions`);
    assert.equal(sessionsRes.status, 200);
    const sessionsBody = await sessionsRes.json() as any;
    assert.equal(typeof sessionsBody.count, 'number');
    assert.ok(Array.isArray(sessionsBody.sessions));

    const closeRes = await fetch(`http://127.0.0.1:${port}/api/terminal/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(closeRes.status, 200);
    const closeBody = await closeRes.json() as any;
    assert.equal(closeBody.success, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ─── Tests WebSocket Terminal ────────────────────────────────────────────────

test('terminal WebSocket: connects, receives welcome message, accepts input & resize', async () => {
  const server = http.createServer();
  const terminalWss = new WebSocketServer({ noServer: true });
  setupTerminalWebSocket(terminalWss, undefined);

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname === '/terminal') {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
  const receivedMessages: any[] = [];

  ws.on('message', (data) => {
    try {
      receivedMessages.push(JSON.parse(data.toString('utf8')));
    } catch {
      receivedMessages.push({ type: 'raw', data: data.toString('utf8') });
    }
  });

  try {
    await waitForWsOpen(ws);
    assert.equal(ws.readyState, WebSocket.OPEN);

    // 1. Attendre le message initial de bienvenue
    await waitForCondition(() =>
      receivedMessages.some((msg) =>
        msg.type === 'output' && (msg.data.includes('Leanna Terminal') || msg.data.includes('Working directory'))
      ),
      5000
    );

    // 2. Envoyer un redimensionnement
    ws.send(JSON.stringify({
      type: 'resize',
      data: { cols: 120, rows: 40 },
    }));

    // 3. Envoyer une commande
    ws.send(JSON.stringify({
      type: 'input',
      data: 'echo test_ws_output',
    }));

    // 4. Attendre la confirmation/sortie
    await waitForCondition(() =>
      receivedMessages.some((msg) =>
        msg.type === 'output' && typeof msg.data === 'string' && msg.data.length > 0
      ),
      5000
    );

    // 5. Fermeture explicite via le message 'close'
    ws.send(JSON.stringify({ type: 'close' }));
  } finally {
    await closeWebSocket(ws);
    await new Promise<void>((resolve) => {
      closeWebSocketServer(terminalWss).then(() => closeHttpServer(server)).then(resolve);
    });
  }
});

test('terminal WebSocket: rejects unauthorized connection when token is required and invalid', async () => {
  const server = http.createServer();
  const terminalWss = new WebSocketServer({ noServer: true });
  setupTerminalWebSocket(terminalWss, 'secret-super-token');

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname === '/terminal') {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  // Envoyer un mauvais token via Sec-WebSocket-Protocol au lieu de l'URL
  const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`, ['token', 'bad-token']);

  try {
    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    assert.equal(closeEvent.code, 1008);
    assert.equal(closeEvent.reason, 'Unauthorized');
  } finally {
    await new Promise<void>((resolve) => {
      closeWebSocketServer(terminalWss).then(() => closeHttpServer(server)).then(resolve);
    });
  }
});

// ─── Tests WebSocket /live et /sandbox-watch Handshake & Upgrade ──────────────

test('live & sandbox WebSocket: upgrade auth verification (unauthorized vs authorized)', async () => {
  const server = http.createServer();
  const liveWss = new WebSocketServer({ noServer: true });
  const sandboxWss = new WebSocketServer({ noServer: true });

  const apiToken = 'live-token-secret';

  const mockDeps: LiveSocketDeps = {
    skillManager: {
      getToolDeclarations: () => [],
      handleToolCall: async () => ({ success: true }),
      missionExecutor: null,
    } as any,
    getCurrentProfile: () => ({
      aiName: 'Leanna',
      aiVoice: 'Aoede',
      userName: 'Dev',
      userRole: 'Developer',
      language: 'fr',
      responseStyle: 'Direct',
    }),
    getWorkspaceRoot: () => SELF_ROOT,
    createGeminiAI: () => ({
      live: {
        connect: async () => ({
          send: () => {},
          close: () => {},
          on: () => {},
          receive: async function* () {},
          [Symbol.asyncIterator]: async function* () {},
        }),
      },
    } as any),
    activeGeminiSessions: new Set(),
    browserReadPending: new Map(),
    browserActionPending: new Map(),
  };

  attachLiveWebSocket(liveWss, sandboxWss, mockDeps);

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/live' || pathname === '/sandbox-watch') {
      // Extraire le token depuis les cookies uniquement
      const cookieHeader = request.headers.cookie || '';
      const cookies: Record<string, string> = {};
      cookieHeader.split(';').forEach(c => {
        const parts = c.split('=');
        if (parts.length >= 2) {
          cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('='));
        }
      });
      const token = cookies['Leanna_token'];
      const authResult = authenticateToken(token, apiToken);
      if (!authResult.ok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    if (pathname === '/live') {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    } else if (pathname === '/sandbox-watch') {
      sandboxWss.handleUpgrade(request, socket, head, (ws) => {
        sandboxWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  // 1. Connexion /live sans token -> Doit être rejetée (401 / erreur de handshake)
  const badLiveWs = new WebSocket(`ws://127.0.0.1:${port}/live`);
  const liveRejected = await new Promise<boolean>((resolve) => {
    badLiveWs.on('error', () => resolve(true));
    badLiveWs.on('open', () => resolve(false));
  });
  assert.equal(liveRejected, true, 'Live WS connection without token should be rejected');

  // 2. Connexion /live avec token valide en cookie -> Doit réussir
  const goodLiveWs = new WebSocket(`ws://127.0.0.1:${port}/live`, {
    headers: { 'Cookie': `Leanna_token=${apiToken}` }
  });
  await waitForWsOpen(goodLiveWs);
  assert.equal(goodLiveWs.readyState, WebSocket.OPEN);
  await closeWebSocket(goodLiveWs);

  // 3. Connexion /sandbox-watch avec token valide en cookie -> Doit réussir
  const sandboxWs = new WebSocket(`ws://127.0.0.1:${port}/sandbox-watch`, {
    headers: { 'Cookie': `Leanna_token=${apiToken}` }
  });
  await waitForWsOpen(sandboxWs);
  assert.equal(sandboxWs.readyState, WebSocket.OPEN);
  await closeWebSocket(sandboxWs);

  await new Promise<void>((resolve) => {
    closeWebSocketServer(liveWss)
      .then(() => closeWebSocketServer(sandboxWss))
      .then(() => closeHttpServer(server))
      .then(resolve);
  });
});
