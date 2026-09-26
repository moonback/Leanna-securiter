/**
 * knowledgeBroadcaster — shared singleton for broadcasting knowledge indexing
 * progress events over WebSocket to all connected clients.
 *
 * Populated by server.ts once the WebSocket server is ready.
 * Used by both the startup IIFE and route handlers (self-root, etc.)
 * without creating circular dependencies.
 */

let _broadcast: ((msg: object) => void) | null = null;

/** Called once by server.ts after the WebSocket server is created. */
export function setKnowledgeBroadcaster(fn: (msg: object) => void): void {
  _broadcast = fn;
}

/** Send a knowledge_progress event to all connected WebSocket clients. */
export function broadcastKnowledgeProgress(
  phase: 'incremental' | 'parse' | 'ast' | 'relations' | 'done',
  current: number,
  total: number,
  extra?: {
    file?: string;
    cached?: boolean;
    totalEntities?: number;
    durationMs?: number;
  },
): void {
  if (!_broadcast) return;
  _broadcast({
    type: 'knowledge_progress',
    phase,
    current,
    total,
    ...(extra ?? {}),
  });
}
