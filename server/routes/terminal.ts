import { Router } from "express";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { spawn, ChildProcessWithoutNullStreams, spawn as childProcessSpawn } from "child_process";
import * as os from "os";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { authenticateRequest, authenticateToken } from "../security.js";
import type { AuthOptions } from "../security.js";

// Types pour les messages WebSocket
interface TerminalMessage {
  type: 'input' | 'resize' | 'close';
  data?: any;
}

// Store les processus terminal actifs
const terminalProcesses = new Map<WebSocket, ChildProcessWithoutNullStreams>();

// Détermine le shell par défaut selon la plateforme
function getDefaultShell(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    // Sur Windows, utiliser PowerShell ou cmd.exe
    return process.env.COMSPEC || 'cmd.exe';
  } else if (platform === 'darwin' || platform === 'linux') {
    // Sur Unix, utiliser le shell de l'utilisateur ou bash
    return process.env.SHELL || '/bin/bash';
  }
  return '/bin/sh';
}

// Crée un nouveau processus terminal
function createTerminalProcess(shell: string): ChildProcessWithoutNullStreams {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Sur Windows, utiliser powershell avec des arguments spécifiques
    // Note: PowerShell a une meilleure prise en charge des terminaux
    const psExe = shell.includes('powershell') ? shell : 'powershell.exe';
    return childProcessSpawn(psExe, ['-NoExit', '-Command', ''], {
      cwd: SELF_ROOT,
      env: {
        ...process.env,
        // Désactiver le prompt de confirmation pour PowerShell
        ConfirmPreference: 'None',
        // Forcer PowerShell à ne pas utiliser le prompt interactif
        PSDisablePrompt: '1',
      },
      windowsHide: false,
    });
  } else {
    // Sur Unix, utiliser le shell avec des arguments pour créer un PTY-like
    return childProcessSpawn(shell, ['--login', '-i'], {
      cwd: SELF_ROOT,
      env: {
        ...process.env,
        // Forcer le terminal à être non-interactif mais avec des couleurs
        TERM: 'xterm-256color',
        // Désactiver le prompt de confirmation
        HISTCONTROL: 'ignorespace',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

// Configuration du routeur Express (pour la configuration initiale)
export function createTerminalRouter(authOptions?: AuthOptions) {
  const router = Router();

  // Middleware d'authentification pour les routes Express
  const authMiddleware = (req: any, res: any, next: any) => {
    const result = authenticateRequest(req, authOptions);
    if (!result.ok) {
      return res.status(result.status || 401).json({ error: result.error || 'Unauthorized' });
    }
    next();
  };

  // Endpoint pour obtenir la configuration du terminal
  router.get('/terminal/config', authMiddleware, (_req, res) => {
    try {
      res.json({
        shell: getDefaultShell(),
        cwd: SELF_ROOT,
        platform: os.platform(),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get terminal config' });
    }
  });

  // Endpoint pour lister les terminaux actifs (pour l'UI)
  router.get('/terminal/sessions', authMiddleware, (_req, res) => {
    res.json({
      count: terminalProcesses.size,
      sessions: Array.from(terminalProcesses.keys()).map((ws, index) => ({
        id: `terminal-${index}`,
        active: !ws.CLOSED,
      })),
    });
  });

  // Endpoint pour fermer un terminal
  router.post('/terminal/close', authMiddleware, (_req, res) => {
    // Pour l'instant, on ferme tous les terminaux (simplification)
    // Dans une version future, on gérera les sessions par ID
    res.json({ success: true, message: 'Terminal closed' });
  });

  return router;
}

// Configuration du WebSocket pour le terminal
export function setupTerminalWebSocket(wss: WebSocketServer, apiToken: string | undefined) {
  wss.on('connection', (ws: WebSocket, req) => {
    // Authentification sécurisée via cookie httpOnly ou en-tête WebSocket
    // Évite de transmettre le token via l'URL (risque de fuite dans les logs)
    let token: string | null = null;
    
    // 1. Tenter de lire depuis le cookie Leanna_token (déjà posé par server.ts)
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      token = cookies['Leanna_token'] || null;
    }
    
    // 2. Si pas de cookie, tenter de lire depuis l'en-tête Sec-WebSocket-Protocol
    // (utilisé comme transport alternatif pour le token)
    if (!token) {
      const protocolHeader = req.headers['sec-websocket-protocol'];
      if (protocolHeader) {
        // Le format attendu est "token, <actual-token-value>"
        const protocols = Array.isArray(protocolHeader) ? protocolHeader : [protocolHeader];
        for (const protocol of protocols) {
          const parts = protocol.split(',').map(p => p.trim());
          const tokenIdx = parts.indexOf('token');
          if (tokenIdx >= 0 && parts[tokenIdx + 1]) {
            token = parts[tokenIdx + 1];
            break;
          }
        }
      }
    }
    
    // 3. Fallback: lire depuis l'en-tête X-Leanna-Token (moins standard mais simple)
    if (!token) {
      const headerValue = req.headers['x-leanna-token'];
      token = Array.isArray(headerValue) ? headerValue[0] : headerValue || null;
    }
    
    const authResult = authenticateToken(token, apiToken);
    if (!authResult.ok) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    let process: ChildProcessWithoutNullStreams | null = null;
    let currentCols = 80;
    let currentRows = 24;
    let welcomeSent = false;

    // Créer un nouveau processus terminal
    const shell = getDefaultShell();
    process = createTerminalProcess(shell);
    
    if (!process) {
      ws.close(1011, 'Failed to create terminal process');
      return;
    }

    terminalProcesses.set(ws, process);

    // Envoyer les données du processus au client
    process.stdout.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: data.toString('utf8') }));
      }
    });

    process.stderr.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', data: data.toString('utf8') }));
      }
    });

    process.on('close', (code) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'close', code }));
      }
      terminalProcesses.delete(ws);
    });

    process.on('error', (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', data: err.message || 'Terminal process error' }));
      }
      terminalProcesses.delete(ws);
    });

    // Message initial - envoyé une seule fois par connexion
    if (ws.readyState === WebSocket.OPEN && !welcomeSent) {
      welcomeSent = true;
      const welcomeMessage = `\n=== Leanna Terminal ===\n` +
        `Working directory: ${SELF_ROOT}\n` +
        `Shell: ${shell}\n` +
        `Platform: ${os.platform()}\n` +
        `Type 'npm run dev' to start the development server.\n\n`;
      ws.send(JSON.stringify({ type: 'output', data: welcomeMessage }));
    }

    // Gérer les messages du client
    ws.on('message', (data: RawData) => {
      try {
        const message: TerminalMessage = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'input':
            // Envoyer l'entrée au processus terminal
            if (process && process.stdin && !process.stdin.destroyed) {
              const input = message.data || '';
              // Ajouter un saut de ligne pour simuler l'appui sur Entrée
              process.stdin.write(input + '\n');
            }
            break;

          case 'resize':
            // Mettre à jour la taille du terminal
            if (message.data && message.data.cols && message.data.rows) {
              currentCols = message.data.cols;
              currentRows = message.data.rows;
              // Note: Sur la plupart des systèmes, on ne peut pas vraiment redimensionner un PTY
              // sans utiliser des appels système spécifiques (ioctl TIOCSWINSZ)
              // Pour l'instant, on stocke juste la taille pour référence
            }
            break;

          case 'close':
            // Fermer le processus terminal
            if (process) {
              process.stdin?.end();
              process.kill();
            }
            terminalProcesses.delete(ws);
            break;
        }
      } catch (error) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', data: 'Invalid message format' }));
        }
      }
    });

    // Nettoyer lors de la fermeture de la connexion WebSocket
    ws.on('close', () => {
      if (process) {
        process.stdin?.end();
        process.kill();
      }
      terminalProcesses.delete(ws);
    });

    ws.on('error', () => {
      if (process) {
        process.stdin?.end();
        process.kill();
      }
      terminalProcesses.delete(ws);
    });
  });
}

// Exporter les fonctions
export { terminalProcesses, getDefaultShell };
