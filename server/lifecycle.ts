import type { Server as HttpServer } from "http";
import type { WebSocketServer } from "ws";
import type { AgentRuntime } from "./runtime/AgentRuntime.js";
import type { Observability } from "./runtime/Observability.js";
import type { LeannaCore } from "./autonomy/LeannaCore.js";
import type { ProjectMemory } from "./knowledge/ProjectMemory.js";
import type { KnowledgeGraph } from "./knowledge/KnowledgeGraph.js";
import type { McpBridge } from "./mcp/McpBridge.js";
import type { NotebookManager } from "./notebooks/NotebookManager.js";
import type { EmbeddingStore } from "./notebooks/EmbeddingStore.js";
import { telemetryService } from "./observability/TelemetryService.js";

export interface GracefulShutdownDeps {
  server: HttpServer;
  wss: WebSocketServer;
  runtimeV2: AgentRuntime;
  autonomyCore?: LeannaCore;
  eventBridge?: { stop(): Promise<void> };
  observability: Observability;
  activeGeminiSessions: Set<{ close(): void }>;
  projectMemory: ProjectMemory;
  knowledgeGraph: KnowledgeGraph;
  mcpBridge: McpBridge;
  notebookManager: NotebookManager;
  embeddingStore: EmbeddingStore;
  stopAllWorkflowTimers: () => void;
  stopAllScheduledTasks: () => void;
  stopCustomSkillsHotReload: () => void;
  stopTelegramBot?: () => Promise<void>;
}

export type GracefulShutdownFn = (reason: string) => Promise<void>;

export function setupGracefulShutdown(deps: GracefulShutdownDeps): GracefulShutdownFn {
  let isShuttingDown = false;

  const gracefulShutdown: GracefulShutdownFn = async (reason: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Lifecycle] Arrêt gracieux déclenché (${reason})...`);

    // 1. Fermer toutes les sessions Gemini actives
    for (const s of deps.activeGeminiSessions) {
      try { s.close(); } catch { /* ignore — déjà fermée */ }
    }
    deps.activeGeminiSessions.clear();
    console.log('[Lifecycle] Sessions Gemini Live fermées.');

    // 2. Fermer les WebSocket servers
    await Promise.all([
      new Promise<void>(resolve => deps.wss.close(() => resolve())),
    ]);
    console.log('[Lifecycle] WebSocket servers fermés.');

    // 3. Arrêter les timers (ordre indifférent, les deux sont indépendants)
    deps.stopAllWorkflowTimers();
    deps.stopAllScheduledTasks();
    deps.stopCustomSkillsHotReload();

    // 3b. Arrêter les serveurs MCP
    await deps.mcpBridge.shutdown();
    console.log('[Lifecycle] Serveurs MCP déconnectés.');

    // 3c. Flush persistance : ProjectMemory, KnowledgeGraph, NotebookManager et EmbeddingStore
    try { deps.projectMemory.save(); console.log('[Lifecycle] ProjectMemory flushé.'); } catch {}
    try { deps.knowledgeGraph.flushAll(); console.log('[Lifecycle] KnowledgeGraph flushé.'); } catch {}
    try { (deps.notebookManager as any).flushAll?.(); console.log('[Lifecycle] NotebookManager flushé.'); } catch {}
    try { deps.embeddingStore.flushAll(); console.log('[Lifecycle] EmbeddingStore flushé.'); } catch {}

    // 3d. Stop accepting autonomous work before stopping the shared runtime.
    try { await deps.autonomyCore?.stop(); console.log('[Lifecycle] Autonomy core arrêté.'); } catch {}

    // 3d-bis. Détacher le pont Redis Streams (arrête la consommation et ferme les connexions).
    try { await deps.eventBridge?.stop(); console.log('[Lifecycle] EventBus Redis bridge arrêté.'); } catch {}

    // 3e. Arrêter le runtime V2
    try { await deps.runtimeV2.stop(); deps.observability.detach(); console.log('[Lifecycle] RuntimeV2 arrêté.'); } catch {}

    // 3f. Arrêter le bot Telegram si actif
    if (deps.stopTelegramBot) {
      try { await deps.stopTelegramBot(); console.log('[Lifecycle] Bot Telegram arrêté.'); } catch {}
    }

    // 3g. Flush telemetry (token usage records) to Supabase
    try { await telemetryService.shutdown(); console.log('[Lifecycle] TelemetryService flushé.'); } catch {}

    // 4. Fermer le serveur HTTP
    await new Promise<void>(resolve => deps.server.close(() => resolve()));
    console.log('[Lifecycle] Arrêt complet.');
  };

  // Signaux Unix (SIGTERM envoyé par nodemon/electron-reload, SIGINT par Ctrl+C)
  process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.once('SIGINT',  () => void gracefulShutdown('SIGINT'));
  // beforeExit se déclenche quand la boucle d'événements est vide
  // (utile sur Windows où les signaux sont limités)
  process.once('beforeExit', () => void gracefulShutdown('beforeExit'));

  // Exposer le shutdown sur le process pour que electron/main.cjs puisse l'appeler
  (process as any).__LeannaShutdown = gracefulShutdown;

  return gracefulShutdown;
}
