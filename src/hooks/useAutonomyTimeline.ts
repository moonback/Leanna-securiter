import { useCallback, useEffect, useRef, useState } from 'react';

/** Autonomy event types mirrored from the server autonomy:* taxonomy. */
export type AutonomyEventType =
  | 'autonomy:heartbeat'
  | 'autonomy:stateChanged'
  | 'autonomy:health'
  | 'autonomy:taskCreated'
  | 'autonomy:taskStateChanged';

export interface AutonomyEvent {
  /** Monotonic client-side id used as a stable React key. */
  id: number;
  event: AutonomyEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface AutonomyState {
  status: string;
  activeTasks: number;
  pendingEvents: number;
  lastWakeAt?: number;
  health: 'healthy' | 'degraded';
  recentFailures: string[];
}

export interface AutonomyTask {
  id: string;
  type: string;
  title: string;
  priority: string;
  status: string;
  attempts: number;
  createdAt: number;
  error?: string;
}

interface SnapshotMessage {
  type: 'autonomy_snapshot';
  timestamp: string;
  state: AutonomyState;
  tasks: AutonomyTask[];
}

interface EventMessage {
  type: 'autonomy_event';
  event: AutonomyEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

type IncomingMessage = SnapshotMessage | EventMessage;

export type AutonomyConnectionStatus = 'connecting' | 'open' | 'closed';

interface UseAutonomyTimelineOptions {
  /** Activer/désactiver la connexion. */
  enabled?: boolean;
  /** Nombre maximal d'événements conservés dans la timeline (borné). */
  maxEvents?: number;
}

interface UseAutonomyTimelineResult {
  state: AutonomyState | null;
  tasks: AutonomyTask[];
  events: AutonomyEvent[];
  connection: AutonomyConnectionStatus;
}

/**
 * Hook read-only qui maintient une connexion WebSocket vers /autonomy et expose
 * la timeline temps réel des événements autonomy:*. Aucune commande n'est
 * envoyée : ce canal est purement observationnel.
 *
 * Robustesse alignée sur useSandboxWatcher :
 * - reconnect backoff exponential + jitter, borné
 * - guard contre "closed before connection is established" (toggle rapide)
 * - buffer d'événements borné (maxEvents)
 */
export function useAutonomyTimeline({
  enabled = true,
  maxEvents = 200,
}: UseAutonomyTimelineOptions = {}): UseAutonomyTimelineResult {
  const [state, setState] = useState<AutonomyState | null>(null);
  const [tasks, setTasks] = useState<AutonomyTask[]>([]);
  const [events, setEvents] = useState<AutonomyEvent[]>([]);
  const [connection, setConnection] = useState<AutonomyConnectionStatus>('closed');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const enabledRef = useRef(enabled);
  const lastConnectStartTs = useRef(0);
  const eventIdRef = useRef(0);
  const maxEventsRef = useRef(maxEvents);
  enabledRef.current = enabled;
  maxEventsRef.current = maxEvents;

  const MAX_RECONNECT = 10;
  const RECONNECT_BASE_MS = 1200;
  const RECONNECT_MAX_MS = 30_000;
  const MIN_CONNECTION_UPTIME_MS = 300;

  const cleanupConnection = useCallback((code = 1000, reason = 'cleanup') => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      try {
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.close(code, reason);
        }
      } catch { /* noop */ }
      wsRef.current = null;
    }
  }, []);

  const handleMessage = useCallback((raw: string) => {
    let data: IncomingMessage;
    try {
      data = JSON.parse(raw) as IncomingMessage;
    } catch {
      return; // message non-JSON ignoré
    }

    if (data.type === 'autonomy_snapshot') {
      setState(data.state ?? null);
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      return;
    }

    if (data.type === 'autonomy_event') {
      const entry: AutonomyEvent = {
        id: eventIdRef.current++,
        event: data.event,
        timestamp: data.timestamp,
        payload: data.payload ?? {},
      };
      setEvents((prev) => {
        const next = [entry, ...prev];
        return next.length > maxEventsRef.current ? next.slice(0, maxEventsRef.current) : next;
      });

      // Mettre à jour l'état dérivé à partir des événements pertinents.
      if (data.event === 'autonomy:stateChanged' && typeof data.payload?.to === 'string') {
        setState((prev) => (prev ? { ...prev, status: data.payload.to as string } : prev));
      }
      if (data.event === 'autonomy:health' && typeof data.payload?.status === 'string') {
        setState((prev) => (prev ? { ...prev, health: data.payload.status as AutonomyState['health'] } : prev));
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    const current = wsRef.current;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    cleanupConnection(1000, 'reconnect');
    lastConnectStartTs.current = Date.now();
    setConnection('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.host;
    try {
      const portStr = window.location.port;
      if (portStr) {
        const portNum = Number(portStr);
        const expressPort =
          Number((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SERVER_PORT) || 4000;
        if (!Number.isNaN(portNum) && portNum !== expressPort && !(portNum < 1024)) {
          host = `${window.location.hostname}:${expressPort}`;
        }
      }
    } catch { /* fallback sur window.location.host */ }

    const ws = new WebSocket(`${protocol}//${host}/autonomy`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCountRef.current = 0;
      setConnection('open');
    };

    ws.onmessage = (event) => {
      queueMicrotask(() => handleMessage(event.data as string));
    };

    ws.onclose = (evt) => {
      if (wsRef.current === ws) wsRef.current = null;
      setConnection('closed');
      if (!enabledRef.current) return;
      if (evt.wasClean && evt.code === 1000) return;

      if (reconnectCountRef.current < MAX_RECONNECT) {
        const uptime = Date.now() - lastConnectStartTs.current;
        const fastFailPenalty = uptime < MIN_CONNECTION_UPTIME_MS ? 2 : 1;
        const base = RECONNECT_BASE_MS * Math.pow(2, reconnectCountRef.current) * fastFailPenalty;
        const jitter = Math.random() * Math.min(base * 0.3, 3000);
        const delay = Math.min(base + jitter, RECONNECT_MAX_MS);
        reconnectCountRef.current++;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      /* onerror est suivi par onclose — rien de spécial */
    };
  }, [cleanupConnection, handleMessage]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      cleanupConnection(1000, 'disabled');
    }
    return cleanupConnection;
  }, [enabled, connect, cleanupConnection]);

  return { state, tasks, events, connection };
}
