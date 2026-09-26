/**
 * Unified Real-time Cache Service
 * 
 * Consolidates caching logic from:
 * - useSandboxWatcher (WebSocket connection + event handlers)
 * - useFileSystem (tree, open files, expanded dirs)
 * - ideApi (treeCache, readFileCache)
 * - sandboxApi (status cache, diff cache)
 * 
 * Provides a single source of truth for real-time file system state
 * with deduplication, TTL caching, and event-driven invalidation.
 */

import { ideApi, type TreeEntry } from './ideApi.js';
import { sandboxApi, type SandboxStatus, type SandboxDiff } from './sandboxApi.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type FileEventType = 
  | 'file-changed' 
  | 'file-created' 
  | 'file-deleted' 
  | 'tree-changed' 
  | 'sandbox-watch-connected';

export interface FileEvent {
  type: FileEventType;
  path?: string;
  timestamp: number;
  active?: boolean;
  watching?: boolean;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  stale: boolean;
}

export interface RealTimeState {
  // File tree
  tree: TreeEntry[];
  treeLoading: boolean;
  treeError: Error | null;
  
  // Open files
  openFiles: Map<string, OpenFileState>;
  activeFile: string | null;
  
  // Sandbox status
  sandboxStatus: SandboxStatus | null;
  sandboxStatusLoading: boolean;
  sandboxDiff: SandboxDiff | null;
  sandboxDiffLoading: boolean;
  
  // Connection state
  wsConnected: boolean;
  wsConnecting: boolean;
  wsError: Error | null;
  
  // Expanded directories
  expandedDirs: Set<string>;
}

export interface OpenFileState {
  path: string;
  content: string;
  dirty: boolean;
  language: string;
  lastSynced: number;
  reloadKey: number;
}

export interface CacheConfig {
  treeTtlMs: number;
  readFileTtlMs: number;
  statusTtlMs: number;
  diffTtlMs: number;
  maxOpenFiles: number;
  maxTreeDepth: number;
}

// ─── Configuration ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CacheConfig = {
  treeTtlMs: 800,
  readFileTtlMs: 1500,
  statusTtlMs: 2500,
  diffTtlMs: 4000,
  maxOpenFiles: 50,
  maxTreeDepth: 100,
};

// ─── In-flight deduplication ──────────────────────────────────────────────

interface InFlight<T> {
  promise: Promise<T>;
  timestamp: number;
}

const inFlightRequests = new Map<string, InFlight<any>>();
const IN_FLIGHT_TTL_MS = 5000;

function deduplicate<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = inFlightRequests.get(key);
  
  if (existing && now - existing.timestamp < IN_FLIGHT_TTL_MS) {
    return existing.promise as Promise<T>;
  }
  
  const promise = factory();
  inFlightRequests.set(key, { promise, timestamp: now });
  
  // Cleanup
  promise.finally(() => {
    const current = inFlightRequests.get(key);
    if (current === inFlightRequests.get(key)) {
      inFlightRequests.delete(key);
    }
  });
  
  return promise;
}

// ─── Event Bus ────────────────────────────────────────────────────────────

type EventCallback = (event: FileEvent) => void;
const eventCallbacks: EventCallback[] = [];

export function subscribeToFileEvents(callback: EventCallback): () => void {
  eventCallbacks.push(callback);
  return () => {
    const idx = eventCallbacks.indexOf(callback);
    if (idx >= 0) eventCallbacks.splice(idx, 1);
  };
}

function emitFileEvent(event: FileEvent): void {
  for (const cb of eventCallbacks) {
    try {
      cb(event);
    } catch (e) {
      console.error('[realtimeCache] Event callback error:', e);
    }
  }
  
  // Also dispatch as CustomEvent for backward compatibility
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('Leanna-realtime-file-event', { detail: event }));
  }
}

// ─── Cache Instances ──────────────────────────────────────────────────────

let treeCache: CacheEntry<TreeEntry[]> | null = null;
const readFileCache = new Map<string, CacheEntry<string>>();
let statusCache: CacheEntry<SandboxStatus> | null = null;
let diffCache: CacheEntry<SandboxDiff> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────

export const realtimeCache = {
  // ── Configuration ──────────────────────────────────────────────────────
  
  config: { ...DEFAULT_CONFIG },
  
  setConfig(partial: Partial<CacheConfig>): void {
    Object.assign(realtimeCache.config, partial);
  },
  
  // ── Tree Cache ─────────────────────────────────────────────────────────
  
  getTree(): TreeEntry[] | null {
    if (!treeCache) return null;
    if (Date.now() - treeCache.timestamp > realtimeCache.config.treeTtlMs) {
      treeCache.stale = true;
      return treeCache.value;
    }
    return treeCache.value;
  },
  
  setTree(tree: TreeEntry[]): void {
    if (treeCache) {
      treeCache.value = tree;
      treeCache.timestamp = Date.now();
      treeCache.stale = false;
    }
  },
  
  invalidateTree(): void {
    if (treeCache) {
      treeCache.stale = true;
      treeCache.timestamp = 0;
    }
  },
  
  async loadTree(force = false): Promise<TreeEntry[]> {
    const cached = realtimeCache.getTree();
    if (cached && !force) return cached;
    
    return deduplicate('tree', async () => {
      const tree = await ideApi.loadTree(force);
      realtimeCache.setTree(tree);
      emitFileEvent({ type: 'tree-changed', timestamp: Date.now() });
      return tree;
    });
  },
  
  // ── File Content Cache ─────────────────────────────────────────────────
  
  getFileContent(path: string): string | null {
    const cached = readFileCache.get(path);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > realtimeCache.config.readFileTtlMs) {
      cached.stale = true;
      return cached.value;
    }
    return cached.value;
  },
  
  setFileContent(path: string, content: string): void {
    readFileCache.set(path, { value: content, timestamp: Date.now(), stale: false });
  },
  
  invalidateFile(path: string): void {
    const cached = readFileCache.get(path);
    if (cached) {
      cached.stale = true;
      cached.timestamp = 0;
    }
  },
  
  invalidateAllFiles(): void {
    const entries = Array.from(readFileCache.entries());
    for (const [, cached] of entries) {
      cached.stale = true;
      cached.timestamp = 0;
    }
  },
  
  async readFile(path: string, force = false): Promise<string> {
    const cached = realtimeCache.getFileContent(path);
    if (cached && !force) return cached;
    
    return deduplicate(`file:${path}`, async () => {
      const content = await ideApi.readFile(path, force);
      realtimeCache.setFileContent(path, content);
      return content;
    });
  },
  
  // ── Sandbox Status Cache ───────────────────────────────────────────────
  
  getSandboxStatus(): SandboxStatus | null {
    if (!statusCache) return null;
    if (Date.now() - statusCache.timestamp > realtimeCache.config.statusTtlMs) {
      statusCache.stale = true;
      return statusCache.value;
    }
    return statusCache.value;
  },
  
  setSandboxStatus(status: SandboxStatus): void {
    if (statusCache) {
      statusCache.value = status;
      statusCache.timestamp = Date.now();
      statusCache.stale = false;
    }
  },
  
  invalidateSandboxStatus(): void {
    if (statusCache) {
      statusCache.stale = true;
      statusCache.timestamp = 0;
    }
  },
  
  async getSandboxStatusFresh(force = false): Promise<SandboxStatus> {
    const cached = realtimeCache.getSandboxStatus();
    if (cached && !force) return cached;
    
    return deduplicate('sandbox:status', async () => {
      const status = await sandboxApi.getStatus(force);
      realtimeCache.setSandboxStatus(status);
      return status;
    });
  },
  
  // ── Sandbox Diff Cache ─────────────────────────────────────────────────
  
  getSandboxDiff(): SandboxDiff | null {
    if (!diffCache) return null;
    if (Date.now() - diffCache.timestamp > realtimeCache.config.diffTtlMs) {
      diffCache.stale = true;
      return diffCache.value;
    }
    return diffCache.value;
  },
  
  setSandboxDiff(diff: SandboxDiff): void {
    if (diffCache) {
      diffCache.value = diff;
      diffCache.timestamp = Date.now();
      diffCache.stale = false;
    }
  },
  
  invalidateSandboxDiff(): void {
    if (diffCache) {
      diffCache.stale = true;
      diffCache.timestamp = 0;
    }
  },
  
  async getSandboxDiffFresh(force = false): Promise<SandboxDiff> {
    const cached = realtimeCache.getSandboxDiff();
    if (cached && !force) return cached;
    
    return deduplicate('sandbox:diff', async () => {
      const diff = await sandboxApi.getDiff(force);
      realtimeCache.setSandboxDiff(diff);
      return diff;
    });
  },

  // ── WebSocket Message Handler ────────────────────────────────────────────

  handleWsMessage(data: FileEvent): void {
    switch (data.type) {
      case 'file-changed':
      case 'file-created':
        if (data.path) {
          realtimeCache.invalidateForFileChange(data.path);
          if (data.type === 'file-created') {
            realtimeCache.invalidateForFileCreate(data.path);
          }
        }
        break;
      case 'file-deleted':
        if (data.path) {
          realtimeCache.invalidateForFileDelete(data.path);
        }
        break;
      case 'tree-changed':
        realtimeCache.invalidateTree();
        emitFileEvent({ type: 'tree-changed', timestamp: Date.now() });
        break;
      case 'sandbox-watch-connected':
        // Connection status handled in onopen
        break;
    }
  },

  // ── Invalidation Helpers ───────────────────────────────────────────────
  
  /**
   * Invalidate all caches after a mutation (save, create, delete, rename)
   */
  invalidateAll(): void {
    realtimeCache.invalidateTree();
    realtimeCache.invalidateAllFiles();
    realtimeCache.invalidateSandboxStatus();
    realtimeCache.invalidateSandboxDiff();
    emitFileEvent({ type: 'tree-changed', timestamp: Date.now() });
  },
  
  /**
   * Invalidate caches affected by a file change
   */
  invalidateForFileChange(path: string): void {
    realtimeCache.invalidateFile(path);
    realtimeCache.invalidateTree();
    realtimeCache.invalidateSandboxStatus();
    realtimeCache.invalidateSandboxDiff();
    emitFileEvent({ type: 'file-changed', path, timestamp: Date.now() });
  },
  
  /**
   * Invalidate caches for file creation
   */
  invalidateForFileCreate(path: string): void {
    realtimeCache.invalidateTree();
    realtimeCache.invalidateSandboxStatus();
    realtimeCache.invalidateSandboxDiff();
    emitFileEvent({ type: 'file-created', path, timestamp: Date.now() });
  },
  
  /**
   * Invalidate caches for file deletion
   */
  invalidateForFileDelete(path: string): void {
    realtimeCache.invalidateFile(path);
    realtimeCache.invalidateTree();
    realtimeCache.invalidateSandboxStatus();
    realtimeCache.invalidateSandboxDiff();
    emitFileEvent({ type: 'file-deleted', path, timestamp: Date.now() });
  },
  
  // ── Event Subscription ─────────────────────────────────────────────────
  
  subscribeToFileEvents,
  
  // ── Cache Stats (for debugging) ────────────────────────────────────────
  
  getStats() {
    return {
      tree: treeCache ? { 
        size: JSON.stringify(treeCache.value).length, 
        age: Date.now() - treeCache.timestamp,
        stale: treeCache.stale 
      } : null,
      files: {
        count: readFileCache.size,
        entries: Array.from(readFileCache.entries()).map(([k, v]) => ({
          path: k,
          size: v.value.length,
          age: Date.now() - v.timestamp,
          stale: v.stale
        }))
      },
      status: statusCache ? {
        age: Date.now() - statusCache.timestamp,
        stale: statusCache.stale
      } : null,
      diff: diffCache ? {
        age: Date.now() - diffCache.timestamp,
        stale: diffCache.stale
      } : null,
      inFlight: inFlightRequests.size
    };
  },
  
  // ── Cleanup ────────────────────────────────────────────────────────────
  
  clear(): void {
    if (treeCache) {
      treeCache.value = [];
      treeCache.timestamp = 0;
      treeCache.stale = true;
    }
    readFileCache.clear();
    if (statusCache) {
      statusCache.value = null as any;
      statusCache.timestamp = 0;
      statusCache.stale = true;
    }
    if (diffCache) {
      diffCache.value = null as any;
      diffCache.timestamp = 0;
      diffCache.stale = true;
    }
    inFlightRequests.clear();
  }
};

// ─── WebSocket Connection Manager ────────────────────────────────────────

interface WsConnectionState {
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectCount: number;
  lastConnectAttempt: number;
  enabled: boolean;
}

const wsState: WsConnectionState = {
  ws: null,
  reconnectTimer: null,
  reconnectCount: 0,
  lastConnectAttempt: 0,
  enabled: true,
};

const WS_CONFIG = {
  MAX_RECONNECT: 10,
  RECONNECT_BASE_MS: 1200,
  RECONNECT_MAX_MS: 30000,
  MIN_UPTIME_MS: 300,
};

export const realtimeWs = {
  connect(): void {
    if (!wsState.enabled) return;
    if (wsState.ws && (wsState.ws.readyState === WebSocket.OPEN || wsState.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Le token est maintenant passé uniquement via cookie, plus par URL
    const ws = new WebSocket(`${protocol}//${window.location.host}/sandbox-watch`);
    
    wsState.ws = ws;
    wsState.lastConnectAttempt = Date.now();
    
    ws.onopen = () => {
      wsState.reconnectCount = 0;
      emitFileEvent({ type: 'sandbox-watch-connected', active: true, watching: true, timestamp: Date.now() });
    };
    
    ws.onmessage = (event) => {
      queueMicrotask(() => {
        try {
          const data: FileEvent = JSON.parse(event.data);
          realtimeCache.handleWsMessage(data);
        } catch {
          // Ignore non-JSON messages
        }
      });
    };
    
    ws.onclose = (evt) => {
      if (wsState.ws === ws) wsState.ws = null;
      if (!wsState.enabled) return;
      if (evt.wasClean && evt.code === 1000) return;
      
      // Auto-reconnect with exponential backoff
      if (wsState.reconnectCount < WS_CONFIG.MAX_RECONNECT) {
        const uptime = Date.now() - wsState.lastConnectAttempt;
        const fastFailPenalty = uptime < WS_CONFIG.MIN_UPTIME_MS ? 2 : 1;
        const base = WS_CONFIG.RECONNECT_BASE_MS * Math.pow(2, wsState.reconnectCount) * fastFailPenalty;
        const jitter = Math.random() * Math.min(base * 0.3, 3000);
        const delay = Math.min(base + jitter, WS_CONFIG.RECONNECT_MAX_MS);
        
        wsState.reconnectCount++;
        wsState.reconnectTimer = setTimeout(() => realtimeWs.connect(), delay);
      }
    };
    
    ws.onerror = () => {
      // onclose will handle reconnection
    };
  },
  
  disconnect(): void {
    wsState.enabled = false;
    if (wsState.reconnectTimer) {
      clearTimeout(wsState.reconnectTimer);
      wsState.reconnectTimer = null;
    }
    if (wsState.ws) {
      wsState.ws.close(1000, 'intentional disconnect');
      wsState.ws = null;
    }
  },
  
  setEnabled(enabled: boolean): void {
    wsState.enabled = enabled;
    if (enabled) {
      realtimeWs.connect();
    } else {
      realtimeWs.disconnect();
    }
  },
  
  isConnected(): boolean {
    return wsState.ws?.readyState === WebSocket.OPEN;
  },
};

// ─── WebSocket Message Handler ───────────────────────────────────────────

realtimeCache.handleWsMessage = (data: FileEvent): void => {
  switch (data.type) {
    case 'file-changed':
    case 'file-created':
      if (data.path) {
        realtimeCache.invalidateForFileChange(data.path);
        if (data.type === 'file-created') {
          realtimeCache.invalidateForFileCreate(data.path);
        }
      }
      break;
    case 'file-deleted':
      if (data.path) {
        realtimeCache.invalidateForFileDelete(data.path);
      }
      break;
    case 'tree-changed':
      realtimeCache.invalidateTree();
      emitFileEvent({ type: 'tree-changed', timestamp: Date.now() });
      break;
    case 'sandbox-watch-connected':
      // Connection status handled in onopen
      break;
  }
};

// ─── Backward-compatible Event Listeners ──────────────────────────────────

// Listen for legacy events and forward to unified system
let legacyListenersInstalled = false;

function handleLegacySandboxChanged() {
  realtimeCache.invalidateAll();
}

function handleLegacySandboxFileChanged(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (detail?.path) {
    realtimeCache.invalidateForFileChange(detail.path);
  }
}

function handleLegacySandboxFileDeleted(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (detail?.path) {
    realtimeCache.invalidateForFileDelete(detail.path);
  }
}

function installLegacyListeners() {
  if (typeof window === 'undefined' || legacyListenersInstalled) return;
  
  window.addEventListener('Leanna-sandbox-changed', handleLegacySandboxChanged);
  window.addEventListener('Leanna-sandbox-file-changed', handleLegacySandboxFileChanged);
  window.addEventListener('Leanna-sandbox-file-deleted', handleLegacySandboxFileDeleted);
  legacyListenersInstalled = true;
}

/**
 * Nettoie les event listeners legacy du realtimeCache.
 * À appeler lors du reload ou de la fermeture de l'application.
 */
export function cleanupRealtimeCacheListeners() {
  if (typeof window === 'undefined' || !legacyListenersInstalled) return;
  
  window.removeEventListener('Leanna-sandbox-changed', handleLegacySandboxChanged);
  window.removeEventListener('Leanna-sandbox-file-changed', handleLegacySandboxFileChanged);
  window.removeEventListener('Leanna-sandbox-file-deleted', handleLegacySandboxFileDeleted);
  legacyListenersInstalled = false;
}

// Auto-installer au chargement du module
installLegacyListeners();

export default realtimeCache;