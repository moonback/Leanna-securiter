/**
 * MCP Client — Connexion à un serveur MCP individuel
 * 
 * Supporte les transports:
 * - stdio: communication via stdin/stdout d'un subprocess
 * - sse: communication via HTTP Server-Sent Events (streamable HTTP)
 * 
 * Implémente le protocole JSON-RPC 2.0 utilisé par MCP.
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import type { McpServerConfig } from './mcpConfig.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types MCP Protocol
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { uri: string; text?: string; blob?: string };
  }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

// JsonRpcResponse: réponses parsées via parseMessage() — interface conservée pour référence
// interface JsonRpcResponse {
//   jsonrpc: '2.0';
//   id: number;
//   result?: any;
//   error?: { code: number; message: string; data?: any };
// }

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ═══════════════════════════════════════════════════════════════════════════════
// McpClient
// ═══════════════════════════════════════════════════════════════════════════════

export type McpClientStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export class McpClient extends EventEmitter {
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  private _status: McpClientStatus = 'disconnected';
  private _tools: McpToolDefinition[] = [];
  private _serverInfo: { name?: string; version?: string } = {};
  private _error: string | null = null;
  private sseAbortController: AbortController | null = null;
  private sseSessionUrl: string | null = null;

  /** Timeout SSE initial fetch et POST des messages */
  private static readonly SSE_CONNECT_TIMEOUT_MS = 30_000;

  /** Timeout par itération de lecture du stream SSE (inactivité max) */
  private static readonly SSE_READ_IDLE_TIMEOUT_MS = 120_000;

  /** Timeout par défaut pour les requêtes JSON-RPC (30s) */
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;

  /** Timeout effectif (configurable par serveur) */
  private get requestTimeoutMs(): number {
    return this.config.timeout || McpClient.DEFAULT_TIMEOUT_MS;
  }

  constructor(config: McpServerConfig) {
    super();
    this.config = config;
  }

  get status(): McpClientStatus { return this._status; }
  get tools(): McpToolDefinition[] { return this._tools; }
  get serverInfo() { return this._serverInfo; }
  get error(): string | null { return this._error; }
  get serverId(): string { return this.config.id; }

  // ─── Health Check ───────────────────────────────────────────────────────────

  /**
   * Vérifie si le serveur MCP est toujours joignable via un ping léger.
   * Retourne true si le serveur répond dans les 5 secondes.
   */
  async ping(): Promise<boolean> {
    if (this._status !== 'ready') return false;
    try {
      // Utiliser un timeout court spécifique au ping
      await this.sendRequestWithTimeout('ping', {}, 5_000);
      return true;
    } catch {
      // Certains serveurs ne supportent pas ping — tenter tools/list comme fallback
      try {
        await this.sendRequestWithTimeout('tools/list', {}, 5_000);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Connecte au serveur MCP et effectue le handshake (initialize + tools/list)
   */
  async connect(): Promise<void> {
    if (this._status === 'ready' || this._status === 'connecting') return;

    this._status = 'connecting';
    this._error = null;
    this.emit('statusChange', this._status);

    try {
      if (this.config.transport === 'stdio') {
        await this.connectStdio();
      } else if (this.config.transport === 'sse') {
        await this.connectSse();
      } else {
        throw new Error(`Transport non supporté: ${(this.config as any).transport}`);
      }

      // Handshake MCP: initialize
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          // On ne supporte pas sampling/resources côté client pour le moment
        },
        clientInfo: {
          name: 'Leanna',
          version: '1.0.0',
        },
      });

      this._serverInfo = initResult.serverInfo || {};
      
      // Notification initialized (pas de réponse attendue)
      this.sendNotification('notifications/initialized', {});

      // Lister les outils disponibles
      await this.refreshTools();

      this._status = 'ready';
      this.emit('statusChange', this._status);
      console.log(`[MCP Client] ✓ Connecté à "${this.config.name}" — ${this._tools.length} outil(s) disponibles`);

    } catch (err: any) {
      this._status = 'error';
      this._error = err.message;
      this.emit('statusChange', this._status);
      this.emit('error', err);
      console.error(`[MCP Client] ✗ Erreur connexion "${this.config.name}":`, err.message);
      // Cleanup
      this.cleanup();
      throw err;
    }
  }

  /**
   * Déconnecte proprement du serveur MCP
   */
  async disconnect(): Promise<void> {
    if (this._status === 'disconnected') return;
    
    try {
      // Tenter un shutdown gracieux (non bloquant)
      if (this._status === 'ready') {
        await Promise.race([
          this.sendRequest('shutdown', {}).catch(() => {}),
          new Promise(r => setTimeout(r, 2000)),
        ]);
      }
    } catch { /* ignore */ }
    
    this.cleanup();
    this._status = 'disconnected';
    this._tools = [];
    this._error = null;
    this.emit('statusChange', this._status);
    console.log(`[MCP Client] Déconnecté de "${this.config.name}"`);
  }

  // ─── Tool Execution ─────────────────────────────────────────────────────────

  /**
   * Appelle un outil MCP et retourne le résultat
   */
  async callTool(toolName: string, args: Record<string, any> = {}): Promise<McpToolResult> {
    if (this._status !== 'ready') {
      throw new Error(`Serveur MCP "${this.config.name}" n'est pas connecté (status: ${this._status})`);
    }

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    return result as McpToolResult;
  }

  /**
   * Rafraîchit la liste des outils disponibles
   */
  async refreshTools(): Promise<McpToolDefinition[]> {
    const result = await this.sendRequest('tools/list', {});
    this._tools = result.tools || [];
    this.emit('toolsChanged', this._tools);
    return this._tools;
  }

  // ─── Stdio Transport ────────────────────────────────────────────────────────

  private async connectStdio(): Promise<void> {
    const { command, args = [], env = {} } = this.config;
    if (!command) throw new Error('Commande manquante pour le transport stdio');

    // Résoudre la commande (support npx, uvx, etc.)
    const resolvedCommand = command;
    
    const mergedEnv = { ...process.env, ...env };

    // Node.js 21+ déconseille de mélanger shell:true avec args[]
    // Node.js 20+ gère automatiquement les .cmd/.bat sur Windows
    // Il suffit de passer le nom sans extension ; Node résoudra npx.cmd, uvx.cmd etc. via PATH.
    const isWin = process.platform === 'win32';

    // Sur Windows, si la commande est un wrapper connu livré en .cmd, on spécifie
    // l'extension explicitement pour que CreateProcess le trouve sans shell.
    // On ne couvre que les commandes sans extension et sans chemin absolu/relatif.
    const CMD_WRAPPERS = ['npx', 'uvx', 'npm', 'node', 'yarn', 'pnpm'];
    let finalCommand = resolvedCommand;
    if (
      isWin &&
      !resolvedCommand.includes('/') &&
      !resolvedCommand.includes('\\') &&
      !resolvedCommand.includes('.') &&
      CMD_WRAPPERS.includes(resolvedCommand)
    ) {
      finalCommand = resolvedCommand + '.cmd';
    }

    const spawnOptions: import('child_process').SpawnOptions = {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false, // shell:true avec args[] génère DEP0190 sur Node.js 21+
    };

    this.process = spawn(finalCommand, args, spawnOptions);

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Impossible de créer les pipes stdio');
    }

    // Lecture stdout (messages JSON-RPC)
    this.process.stdout.on('data', (chunk: Buffer) => {
      this.onStdioData(chunk.toString('utf-8'));
    });

    // Stderr → logs (non-protocole)
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        // Filtrer les logs verbeux courants
        if (!text.includes('Debugger attached') && !text.includes('Waiting for')) {
          console.log(`[MCP:${this.config.id}:stderr] ${text}`);
        }
      }
    });

    this.process.on('close', (code) => {
      if (this._status !== 'disconnected') {
        console.warn(`[MCP Client] Process "${this.config.name}" terminé (code ${code})`);
        this._status = 'error';
        this._error = `Process terminé avec code ${code}`;
        this.emit('statusChange', this._status);
        this.rejectAllPending(new Error(`MCP server process exited with code ${code}`));
      }
    });

    this.process.on('error', (err) => {
      console.error(`[MCP Client] Erreur process "${this.config.name}":`, err.message);
      this._status = 'error';
      this._error = err.message;
      this.emit('statusChange', this._status);
      this.rejectAllPending(err);
    });

    // Attendre un peu que le process démarre
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 500);
      this.process!.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private onStdioData(data: string): void {
    this.buffer += data;
    
    // Le protocole MCP/JSON-RPC utilise des messages séparés par des newlines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Garder le fragment incomplet

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch {
        // Ignorer les lignes non-JSON (logs du serveur)
      }
    }
  }

  // ─── SSE Transport ──────────────────────────────────────────────────────────

  private async connectSse(): Promise<void> {
    const { url } = this.config;
    if (!url) throw new Error('URL manquante pour le transport SSE');

    this.sseAbortController = new AbortController();

    const connectTimeoutId = setTimeout(() => {
      this.sseAbortController?.abort(new Error(`SSE connect timeout (${McpClient.SSE_CONNECT_TIMEOUT_MS}ms)`));
    }, McpClient.SSE_CONNECT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'text/event-stream' },
        signal: this.sseAbortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      this.sseSessionUrl = response.headers.get('x-mcp-session-url') || url;
    } finally {
      clearTimeout(connectTimeoutId);
    }

    this.readSseStream(response!).catch(err => {
      if (err.name !== 'AbortError') {
        console.error(`[MCP:${this.config.id}] SSE stream error:`, err.message);
        this._status = 'error';
        this._error = err.message;
        this.emit('statusChange', this._status);
      }
    });
  }

  private async readSseStream(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No readable stream');
    
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        const idlePromise = new Promise<never>((_, reject) => {
          idleTimer = setTimeout(() => {
            reject(new Error(`SSE read idle timeout (${McpClient.SSE_READ_IDLE_TIMEOUT_MS}ms)`));
          }, McpClient.SSE_READ_IDLE_TIMEOUT_MS);
        });

        const readResult = await Promise.race([
          reader.read(),
          idlePromise,
        ]);

        const { done, value } = readResult;
        if (done) break;
        
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const event of events) {
          const dataLine = event.split('\n').find(l => l.startsWith('data: '));
          if (dataLine) {
            try {
              const message = JSON.parse(dataLine.slice(6));
              this.handleMessage(message);
            } catch { /* ignore malformed */ }
          }
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
    }
  }

  // ─── JSON-RPC Protocol ──────────────────────────────────────────────────────

  private sendRequest(method: string, params?: any): Promise<any> {
    return this.sendRequestWithTimeout(method, params, this.requestTimeoutMs);
  }

  /**
   * Envoie une requête JSON-RPC avec un timeout spécifique
   */
  private sendRequestWithTimeout(method: string, params: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.writeMessage(request);
    });
  }

  private sendNotification(method: string, params?: any): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.writeMessage(notification);
  }

  private writeMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    const serialized = JSON.stringify(message) + '\n';

    if (this.config.transport === 'stdio' && this.process?.stdin) {
      this.process.stdin.write(serialized);
    } else if (this.config.transport === 'sse' && this.sseSessionUrl) {
      const postAbort = new AbortController();
      const postTimeout = setTimeout(() => {
        postAbort.abort(new Error(`SSE POST timeout (${McpClient.SSE_CONNECT_TIMEOUT_MS}ms)`));
      }, McpClient.SSE_CONNECT_TIMEOUT_MS);
      fetch(this.sseSessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
        signal: postAbort.signal,
      }).then(() => clearTimeout(postTimeout)).catch(err => {
        clearTimeout(postTimeout);
        if (err.name !== 'AbortError') {
          console.error(`[MCP:${this.config.id}] Erreur envoi SSE:`, err.message);
        }
      });
    }
  }

  private handleMessage(message: any): void {
    if (!message || message.jsonrpc !== '2.0') return;

    // Réponse à une requête
    if ('id' in message && (message.result !== undefined || message.error)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);
        
        if (message.error) {
          pending.reject(new Error(`MCP Error [${message.error.code}]: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Notification du serveur (pas d'id)
    if ('method' in message && !('id' in message)) {
      this.handleNotification(message);
      return;
    }

    // Requête du serveur (id présent mais pas de result/error) — ex: sampling
    if ('method' in message && 'id' in message) {
      // Pour l'instant on ne supporte pas les requêtes serveur→client
      this.writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        method: message.method,
        params: { error: { code: -32601, message: 'Method not supported' } },
      } as any);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'notifications/tools/list_changed':
        // Les outils ont changé, re-fetch
        this.refreshTools().catch(err => {
          console.error(`[MCP:${this.config.id}] Erreur refresh tools:`, err.message);
        });
        break;
      case 'notifications/progress':
        this.emit('progress', notification.params);
        break;
      default:
        // Notification inconnue — log en debug
        break;
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  private cleanup(): void {
    // Fermer le process stdio
    if (this.process) {
      try {
        if (process.platform === 'win32') {
          // Sur Windows, SIGTERM n'est pas fiable — utiliser taskkill pour tuer l'arbre
          const pid = this.process.pid;
          if (pid) {
            try {
              execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
            } catch { /* ignore — process déjà mort */ }
          }
        } else {
          this.process.kill('SIGTERM');
          // Force kill après 3s
          const proc = this.process;
          setTimeout(() => {
            try { proc?.kill('SIGKILL'); } catch { /* ignore */ }
          }, 3000);
        }
      } catch { /* ignore */ }
      this.process = null;
    }

    // Annuler la connexion SSE
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }

    this.rejectAllPending(new Error('Client disconnected'));
    this.buffer = '';
  }

  private rejectAllPending(error: Error): void {
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
