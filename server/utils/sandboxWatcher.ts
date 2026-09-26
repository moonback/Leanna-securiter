/**
 * sandboxWatcher.ts — Surveillance en temps réel des fichiers du sandbox.
 *
 * Utilise fs.watch (récursif sur Windows) pour détecter les changements dans
 * .Leanna/sandbox/ et broadcaster les événements aux clients WebSocket connectés.
 */

import fs from "fs";
import path from "path";
import { WebSocket } from "ws";
import { getSandboxRoot, isSandboxActive, markFileModified } from "./sandbox.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SandboxFileEvent {
  type: "file-changed" | "file-created" | "file-deleted" | "tree-changed";
  path: string;          // chemin relatif dans le sandbox
  timestamp: number;
}

// ── State ────────────────────────────────────────────────────────────────────

const connectedClients = new Set<WebSocket>();
let watcher: fs.FSWatcher | null = null;
let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 150; // debounce pour éviter les doublons

// Patterns à ignorer (node_modules, .git, fichiers temporaires)
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git[\/\\]/,
  /\.DS_Store/,
  /~$/,
  /\.swp$/,
  /\.tmp$/,
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ajoute un client WebSocket pour recevoir les événements du sandbox.
 */
export function addWatchClient(ws: WebSocket): void {
  connectedClients.add(ws);
  
  const handleDisconnect = () => {
    connectedClients.delete(ws);
    console.log(`[SandboxWatcher] Client déconnecté (${connectedClients.size} restant(s))`);
    
    // Si plus aucun client, arrêter la surveillance pour économiser les ressources
    if (connectedClients.size === 0 && watcher) {
      console.log('[SandboxWatcher] Plus de clients, arrêt de la surveillance');
      stopWatching();
    }
  };
  
  ws.on("close", handleDisconnect);
  ws.on("error", (err) => {
    console.error('[SandboxWatcher] Erreur client WebSocket:', err.message);
    handleDisconnect();
  });

  // Envoyer l'état initial
  ws.send(JSON.stringify({
    type: "sandbox-watch-connected",
    active: isSandboxActive(),
    watching: watcher !== null,
  }));
  
  console.log(`[SandboxWatcher] ✅ Client ajouté (${connectedClients.size} total)`);
}

/**
 * Démarre la surveillance du dossier sandbox.
 * Appelé automatiquement lors de l'activation du sandbox.
 */
export function startWatching(): void {
  if (watcher) {
    console.log('[SandboxWatcher] Surveillance déjà active, ignoré');
    return; // déjà actif
  }

  const sandboxRoot = getSandboxRoot();
  if (!fs.existsSync(sandboxRoot)) {
    console.log('[SandboxWatcher] Dossier sandbox inexistant:', sandboxRoot);
    return;
  }

  try {
    watcher = fs.watch(sandboxRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const relativePath = filename.replace(/\\/g, "/");

      // Ignorer les patterns non pertinents
      if (IGNORE_PATTERNS.some(p => p.test(relativePath))) return;

      // Debounce par fichier pour éviter les rafales d'événements
      const existing = debounceTimers.get(relativePath);
      if (existing) clearTimeout(existing);

      debounceTimers.set(relativePath, setTimeout(() => {
        debounceTimers.delete(relativePath);
        handleFileEvent(relativePath, sandboxRoot);
      }, DEBOUNCE_MS));
    });

    console.log(`[SandboxWatcher] ✅ Surveillance démarrée: ${sandboxRoot} (${connectedClients.size} client(s))`);
  } catch (e: any) {
    console.error("[SandboxWatcher] ❌ Erreur lors du démarrage:", e.message);
  }
}

/**
 * Arrête la surveillance.
 */
export function stopWatching(): void {
  if (!watcher) {
    console.log('[SandboxWatcher] Aucune surveillance active, ignoré');
    return;
  }

  watcher.close();
  watcher = null;

  // Nettoyer les debounce timers
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  console.log(`[SandboxWatcher] ✅ Surveillance arrêtée (${connectedClients.size} client(s) restant(s))`);
}

/**
 * Retourne le nombre de clients connectés.
 */
export function getWatchClientCount(): number {
  return connectedClients.size;
}

// ── Internals ────────────────────────────────────────────────────────────────

function handleFileEvent(relativePath: string, sandboxRoot: string): void {
  const fullPath = path.join(sandboxRoot, relativePath);

  let eventType: SandboxFileEvent["type"];

  try {
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        eventType = "tree-changed";
      } else {
        // Vérifier si c'est un nouveau fichier ou une modification
        // (fs.watch ne distingue pas de manière fiable rename/change)
        eventType = "file-changed";
      }
    } else {
      // Le fichier n'existe plus → supprimé
      eventType = "file-deleted";
    }
  } catch {
    eventType = "file-changed";
  }

  // Marquer le fichier comme modifié dans le sandbox pour que le sync
  // prenne en compte les changements manuels (explorateur de fichiers, IDE, etc.)
  if (isSandboxActive() && eventType !== "tree-changed") {
    try {
      markFileModified(relativePath);
    } catch (error: any) {
      console.warn(`[SandboxWatcher] Modification ignorée hors sandbox sûr: ${relativePath}`, error?.message ?? error);
      return;
    }
  }

  const event: SandboxFileEvent = {
    type: eventType,
    path: relativePath,
    timestamp: Date.now(),
  };

  broadcast(event);
}

function broadcast(event: SandboxFileEvent): void {
  const message = JSON.stringify(event);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch {
        connectedClients.delete(client);
      }
    }
  }
}
