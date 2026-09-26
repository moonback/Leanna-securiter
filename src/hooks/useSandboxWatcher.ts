import { useEffect, useRef, useCallback } from 'react';

export interface SandboxFileEvent {
  type: 'file-changed' | 'file-created' | 'file-deleted' | 'tree-changed' | 'sandbox-watch-connected';
  path?: string;
  timestamp?: number;
  active?: boolean;
  watching?: boolean;
}

interface UseSandboxWatcherOptions {
  /** Appelé quand un fichier ouvert dans l'éditeur est modifié dans le sandbox */
  onFileChanged?: (relativePath: string) => void;
  /** Appelé quand l'arbre de fichiers doit être rechargé */
  onTreeChanged?: () => void;
  /** Appelé quand un fichier est supprimé */
  onFileDeleted?: (relativePath: string) => void;
  /** Activer/désactiver la connexion */
  enabled?: boolean;
}

/**
 * Hook qui maintient une connexion WebSocket vers /sandbox-watch
 * et notifie le composant parent des changements de fichiers en temps réel.
 *
 * Corrections importantes:
 * - Handlers stockés dans useRef (évite reconnect si parent passe inline callbacks)
 * - Guard contre "closed before connection is established" (toggle rapide)
 * - Dispatch messages via queueMicrotask (évite [Violation] 'message' handler took Nms)
 * - Reconnect backoff exponential + jitter + limite max (30s)
 */
export function useSandboxWatcher({
  onFileChanged,
  onTreeChanged,
  onFileDeleted,
  enabled = true,
}: UseSandboxWatcherOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const enabledRef = useRef(enabled);
  const lastConnectStartTs = useRef(0);

  // Toujours à jour mais NE PROVOQUENT PAS de reconnect quand ils changent
  const onFileChangedRef = useRef(onFileChanged);
  const onTreeChangedRef = useRef(onTreeChanged);
  const onFileDeletedRef = useRef(onFileDeleted);
  onFileChangedRef.current = onFileChanged;
  onTreeChangedRef.current = onTreeChanged;
  onFileDeletedRef.current = onFileDeleted;
  enabledRef.current = enabled;

  const MAX_RECONNECT = 10;
  const RECONNECT_BASE_MS = 1200;
  const RECONNECT_MAX_MS = 30_000;
  // Si le socket meurt < MIN_CONNECTION_UPTIME_MS après création, on double le délai
  // (évite reconnect loop "closed before connect" dû à mount/unmount rapides)
  const MIN_CONNECTION_UPTIME_MS = 300;

  const cleanupConnection = useCallback((code = 1000, reason = 'cleanup') => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      try {
        // Évite d'appeler close() sur un socket qui n'a jamais été OPEN
        if (
          ws.readyState !== WebSocket.CLOSED &&
          ws.readyState !== WebSocket.CLOSING
        ) {
          ws.close(code, reason);
        }
      } catch { /* noop */ }
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    cleanupConnection(1000, 'reconnect');
    lastConnectStartTs.current = Date.now();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Le token est maintenant passé uniquement via cookie, plus par URL

    let host = window.location.host;
    try {
      const portStr = window.location.port;
      if (portStr) {
        const portNum = Number(portStr);
        const expressPort = Number((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SERVER_PORT) || 4000;
        if (!Number.isNaN(portNum) && portNum !== expressPort && !(portNum < 1024)) {
          host = `${window.location.hostname}:${expressPort}`;
        }
      }
    } catch { /* fallback sur window.location.host en cas d'erreur */ }

    const ws = new WebSocket(`${protocol}//${host}/sandbox-watch`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      // Dispatch le traitement hors du handler 'message' synchron pour
      // éviter les violations "[Violation] 'message' handler took <N>ms".
      // L'ordre relatif des messages est préservé (queueMicrotask FIFO).
      queueMicrotask(() => {
        try {
          const data: SandboxFileEvent = JSON.parse(event.data);
          switch (data.type) {
            case 'file-changed':
            case 'file-created':
              if (data.path) onFileChangedRef.current?.(data.path);
              if (data.type === 'file-created') onTreeChangedRef.current?.();
              break;
            case 'file-deleted':
              if (data.path) onFileDeletedRef.current?.(data.path);
              onTreeChangedRef.current?.();
              break;
            case 'tree-changed':
              onTreeChangedRef.current?.();
              break;
            case 'sandbox-watch-connected':
            default:
              break;
          }
        } catch {
          /* message non-JSON ignoré */
        }
      });
    };

    ws.onclose = (evt) => {
      if (wsRef.current === ws) wsRef.current = null;
      if (!enabledRef.current) return;
      if (evt.wasClean && evt.code === 1000) return;

      // Auto-reconnect avec backoff exponential + jitter
      if (reconnectCountRef.current < MAX_RECONNECT) {
        const uptime = Date.now() - lastConnectStartTs.current;
        // Si le socket meurt trop vite (toggle rapide/mount-unmount), ajouter délai bonus
        const fastFailPenalty = uptime < MIN_CONNECTION_UPTIME_MS ? 2 : 1;
        const base = RECONNECT_BASE_MS * Math.pow(2, reconnectCountRef.current) * fastFailPenalty;
        const jitter = Math.random() * Math.min(base * 0.3, 3000);
        const delay = Math.min(base + jitter, RECONNECT_MAX_MS);
        reconnectCountRef.current++;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      /* onerror est systématiquement suivi par onclose — rien de spécial */
    };
  }, [cleanupConnection]);

  // Connecter/déconnecter en fonction de `enabled` (seulement)
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      cleanupConnection(1000, 'disabled');
    }
    return cleanupConnection;
  }, [enabled, connect, cleanupConnection]);
}
