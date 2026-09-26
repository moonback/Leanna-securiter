import { WebSocketServer, WebSocket } from 'ws';
import { addWatchClient, startWatching, stopWatching, getWatchClientCount } from '../utils/sandboxWatcher.js';
import { authenticateToken } from '../security.js';
import { isSandboxActive } from '../utils/sandbox.js';

let sandboxWss: WebSocketServer | null = null;

export function initSandboxWatchWSS(): WebSocketServer {
  // Éviter la création multiple du serveur WebSocket
  if (sandboxWss) {
    console.log('[SandboxWatch] Réutilisation du serveur WebSocket existant');
    return sandboxWss;
  }

  sandboxWss = new WebSocketServer({ noServer: true });
  
  sandboxWss.on('connection', (clientWs, req) => {
    console.log('[SandboxWatch] Client connecté');
    addWatchClient(clientWs);
    
    // Démarrer la surveillance si le sandbox est actif
    if (isSandboxActive()) {
      startWatching();
    }
  });

  console.log('[SandboxWatch] Serveur WebSocket initialisé');
  return sandboxWss;
}

export function getSandboxWSS(): WebSocketServer | null {
  return sandboxWss;
}

// WebSocket upgrade handler for /sandbox-watch
export function handleSandboxWatchUpgrade(
  request: any,
  socket: any,
  head: any,
  apiToken: string | undefined
): boolean {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname !== '/sandbox-watch') {
    return false;
  }

  const cookieHeader = request.headers.cookie || '';
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('='));
    }
  });

  const token = cookies['Leanna_token'] || url.searchParams.get('token');
  const authResult = authenticateToken(token, apiToken);
  if (!authResult.ok) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return true;
  }

  if (sandboxWss) {
    sandboxWss.handleUpgrade(request, socket, head, (ws) => {
      sandboxWss!.emit('connection', ws, request);
    });
  }
  return true;
}

export { addWatchClient, startWatching, stopWatching, getWatchClientCount };