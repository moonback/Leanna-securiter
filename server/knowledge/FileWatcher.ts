/**
 * FileWatcher — Surveillance incrémentale des fichiers projet
 *
 * Surveille les changements de fichiers dans le projet et déclenche
 * une ré-indexation incrémentale (fichier par fichier) plutôt qu'un
 * scan complet. Utilise fs.watch natif avec debounce pour performance.
 *
 * Architecture :
 *   FileWatcher.start()
 *     ├── fs.watch(root, { recursive: true })
 *     ├── debounce(300ms) → accumule les changements
 *     └── ProjectIndexer.scanFile() ou .removeFile() par fichier
 *
 * Avantages vs scanAll() :
 *   - Indexation quasi-instantanée (<50ms par fichier modifié)
 *   - Pas de freeze du serveur sur gros projets
 *   - Graphe toujours à jour sans intervention manuelle
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../utils/logger.js";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { isSandboxActive, getSandboxRoot } from "../utils/sandbox.js";

const log = createLogger("FileWatcher");

// ─── Configuration ──────────────────────────────────────────────────────────

/** Délai de debounce : accumule les changements pendant cette durée */
const DEBOUNCE_MS = 500;

/** Extensions surveillées (même liste que ProjectIndexer) */
const WATCHABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".css", ".scss", ".html",
]);

/** Dossiers ignorés */
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".Leanna", "dist", "build", "out",
  "release", "coverage", ".vscode", ".idea", "assets", "public",
]);

/** Fichiers ignorés */
const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  ".project-knowledge.json", ".project-memory.json",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// FileWatcher
// ═══════════════════════════════════════════════════════════════════════════════

export type FileChangeType = "created" | "modified" | "deleted";

export interface FileChangeEvent {
  relativePath: string;
  type: FileChangeType;
  timestamp: number;
}

export type FileChangeHandler = (events: FileChangeEvent[]) => Promise<void> | void;

export class FileWatcher {
  private watcher: fs.FSWatcher | null = null;
  private pendingChanges: Map<string, FileChangeType> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Set<FileChangeHandler> = new Set();
  private isRunning: boolean = false;
  private stats = {
    totalEventsProcessed: 0,
    totalBatchesDispatched: 0,
    lastEventAt: 0,
  };

  /**
   * Retourne la racine du workspace actif.
   */
  private getRoot(): string {
    if (isSandboxActive()) return getSandboxRoot();
    return SELF_ROOT;
  }

  /**
   * Enregistre un handler appelé à chaque batch de changements.
   */
  onChange(handler: FileChangeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Démarre la surveillance des fichiers.
   * Utilise fs.watch en mode récursif (Windows et macOS supporté nativement).
   */
  start(): boolean {
    if (this.isRunning) {
      log.debug("FileWatcher déjà actif");
      return true;
    }

    const root = this.getRoot();

    try {
      this.watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Normaliser le chemin (Windows → forward slashes)
        const relativePath = filename.replace(/\\/g, "/");

        // Filtrer les fichiers non pertinents
        if (!this.shouldWatch(relativePath)) return;

        // Déterminer le type de changement
        const absPath = path.join(root, relativePath);
        let changeType: FileChangeType;

        try {
          if (fs.existsSync(absPath)) {
            // Le fichier existe → modification ou création
            changeType = this.pendingChanges.has(relativePath) ? "modified" : "modified";
            // Détection création : si le fichier n'était pas dans le batch précédent
            // On simplifie : "rename" = création/suppression, "change" = modification
            if (eventType === "rename") {
              changeType = "created";
            }
          } else {
            // Le fichier n'existe plus → suppression
            changeType = "deleted";
          }
        } catch {
          changeType = "modified";
        }

        this.pendingChanges.set(relativePath, changeType);
        this.scheduleBatch();
      });

      this.isRunning = true;
      log.info(`👁️ FileWatcher démarré sur: ${root}`);
      return true;
    } catch (err) {
      log.error(`❌ Impossible de démarrer le FileWatcher: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Arrête la surveillance.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();
    this.isRunning = false;
    log.info("🛑 FileWatcher arrêté");
  }

  /**
   * Retourne si le watcher est actif.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Retourne les statistiques du watcher.
   */
  getStats() {
    return { ...this.stats, running: this.isRunning };
  }

  // ─── Logique interne ──────────────────────────────────────────────────────

  /**
   * Vérifie si un fichier doit être surveillé.
   */
  private shouldWatch(relativePath: string): boolean {
    // Vérifier les dossiers ignorés
    const parts = relativePath.split("/");
    for (const part of parts) {
      if (IGNORED_DIRS.has(part)) return false;
    }

    // Vérifier le nom de fichier
    const filename = path.basename(relativePath);
    if (IGNORED_FILES.has(filename)) return false;

    // Vérifier l'extension
    const ext = path.extname(filename).toLowerCase();
    if (!WATCHABLE_EXTENSIONS.has(ext)) return false;

    // Ignorer les fichiers cachés
    if (filename.startsWith(".")) return false;

    return true;
  }

  /**
   * Programme l'envoi d'un batch de changements après le debounce.
   */
  private scheduleBatch(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.dispatchBatch();
    }, DEBOUNCE_MS);
  }

  /**
   * Envoie le batch de changements accumulés aux handlers.
   */
  private async dispatchBatch(): Promise<void> {
    if (this.pendingChanges.size === 0) return;

    const events: FileChangeEvent[] = [];
    const now = Date.now();

    for (const [relativePath, type] of this.pendingChanges) {
      events.push({ relativePath, type, timestamp: now });
    }

    this.pendingChanges.clear();
    this.stats.totalEventsProcessed += events.length;
    this.stats.totalBatchesDispatched++;
    this.stats.lastEventAt = now;

    log.info(`📦 Batch: ${events.length} fichier(s) changé(s) [${events.map(e => `${e.type}:${path.basename(e.relativePath)}`).join(", ")}]`);

    // Notifier tous les handlers
    for (const handler of this.handlers) {
      try {
        await handler(events);
      } catch (err) {
        log.error(`❌ Handler FileWatcher a échoué: ${(err as Error).message}`);
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du FileWatcher */
export const fileWatcher = new FileWatcher();
