/**
 * BackupService — Sauvegarde automatique des notebooks
 *
 * Fonctionnalités :
 *   - Backup périodique configurable (par défaut toutes les 30 min)
 *   - Rotation des backups (garde les N derniers)
 *   - Backup incrémental (ne sauvegarde que les notebooks modifiés)
 *   - Restauration à partir d'un backup
 *   - Export complet (JSON + embeddings)
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../utils/logger.js";
import { SELF_ROOT } from "../utils/selfRoot.js";

const log = createLogger("NotebookBackup");

// ─── Configuration ──────────────────────────────────────────────────────────

interface BackupConfig {
  /** Intervalle entre les backups en ms (défaut: 30 min) */
  intervalMs: number;
  /** Nombre maximum de backups conservés */
  maxBackups: number;
  /** Répertoire de stockage des backups */
  backupDir: string;
  /** Activer les backups automatiques */
  enabled: boolean;
}

interface BackupMetadata {
  id: string;
  timestamp: string;
  notebookCount: number;
  totalSources: number;
  totalSizeBytes: number;
  incrementalIds: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════

export class BackupService {
  private config: BackupConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastBackupTimestamps: Map<string, string> = new Map();
  private isRunning = false;

  constructor(config?: Partial<BackupConfig>) {
    const baseDir = process.env.Leanna_CONFIG_PATH || process.env.ELECTRON_APP_PATH || SELF_ROOT || process.cwd();
    this.config = {
      intervalMs: config?.intervalMs ?? 30 * 60 * 1000, // 30 minutes
      maxBackups: config?.maxBackups ?? 10,
      backupDir: config?.backupDir ?? path.join(baseDir, ".Leanna", "notebooks", "backups"),
      enabled: config?.enabled ?? true,
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Démarre les backups automatiques */
  start(): void {
    if (!this.config.enabled || this.timer) return;

    this.ensureBackupDir();
    this.loadLastTimestamps();

    this.timer = setInterval(() => {
      this.runBackup().catch(e => {
        log.error(`Erreur backup automatique: ${e.message}`);
      });
    }, this.config.intervalMs);

    log.info(`✅ Backup automatique activé (intervalle: ${this.config.intervalMs / 60000} min, max: ${this.config.maxBackups} backups)`);
  }

  /** Arrête les backups automatiques */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("⏹️ Backup automatique arrêté");
    }
  }

  /** Exécute un backup immédiat */
  async runBackup(): Promise<BackupMetadata | null> {
    if (this.isRunning) {
      log.warn("Backup déjà en cours, skip");
      return null;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.ensureBackupDir();

      // Lire les notebooks actuels
      const notebooksDir = this.getNotebooksDir();
      if (!fs.existsSync(notebooksDir)) {
        log.info("Aucun notebook à sauvegarder");
        return null;
      }

      const files = fs.readdirSync(notebooksDir).filter(f => f.endsWith(".json") && !f.startsWith("backup"));
      if (files.length === 0) {
        return null;
      }

      // Identifier les notebooks modifiés depuis le dernier backup
      const modifiedFiles: string[] = [];
      for (const file of files) {
        const filePath = path.join(notebooksDir, file);
        const stat = fs.statSync(filePath);
        const lastBackup = this.lastBackupTimestamps.get(file);

        if (!lastBackup || stat.mtime.toISOString() > lastBackup) {
          modifiedFiles.push(file);
        }
      }

      if (modifiedFiles.length === 0) {
        log.debug("Aucun notebook modifié depuis le dernier backup");
        return null;
      }

      // Créer le backup
      const backupId = `backup-${Date.now()}`;
      const backupPath = path.join(this.config.backupDir, backupId);
      fs.mkdirSync(backupPath, { recursive: true });

      let totalSize = 0;
      let totalSources = 0;
      const incrementalIds: string[] = [];

      for (const file of modifiedFiles) {
        const sourcePath = path.join(notebooksDir, file);
        const destPath = path.join(backupPath, file);

        try {
          const content = fs.readFileSync(sourcePath, "utf-8");
          fs.writeFileSync(destPath, content, "utf-8");
          totalSize += Buffer.byteLength(content, "utf-8");

          // Compter les sources
          const notebook = JSON.parse(content);
          totalSources += notebook.sources?.length || 0;
          incrementalIds.push(file.replace(".json", ""));

          // Mettre à jour le timestamp
          this.lastBackupTimestamps.set(file, new Date().toISOString());
        } catch (e: any) {
          log.warn(`Erreur copie notebook ${file}: ${e.message}`);
        }
      }

      // Sauvegarder aussi les embeddings
      const embeddingsDir = path.join(notebooksDir, "embeddings");
      if (fs.existsSync(embeddingsDir)) {
        const embBackupDir = path.join(backupPath, "embeddings");
        fs.mkdirSync(embBackupDir, { recursive: true });

        const embFiles = fs.readdirSync(embeddingsDir).filter(f => f.endsWith(".json"));
        for (const file of embFiles) {
          const notebookId = file.replace(".json", "");
          if (incrementalIds.includes(notebookId)) {
            try {
              const content = fs.readFileSync(path.join(embeddingsDir, file), "utf-8");
              fs.writeFileSync(path.join(embBackupDir, file), content, "utf-8");
              totalSize += Buffer.byteLength(content, "utf-8");
            } catch { /* skip */ }
          }
        }
      }

      // Écrire les métadonnées du backup
      const metadata: BackupMetadata = {
        id: backupId,
        timestamp: new Date().toISOString(),
        notebookCount: modifiedFiles.length,
        totalSources,
        totalSizeBytes: totalSize,
        incrementalIds,
      };

      fs.writeFileSync(
        path.join(backupPath, "_metadata.json"),
        JSON.stringify(metadata, null, 2),
        "utf-8"
      );

      // Rotation : supprimer les anciens backups au-delà de maxBackups
      this.rotateBackups();

      // Persister les timestamps
      this.saveLastTimestamps();

      const duration = Date.now() - startTime;
      log.info(`💾 Backup "${backupId}" terminé: ${modifiedFiles.length} notebook(s), ${(totalSize / 1024).toFixed(1)} KB (${duration}ms)`);

      return metadata;
    } finally {
      this.isRunning = false;
    }
  }

  // ─── Restauration ──────────────────────────────────────────────────────────

  /** Liste les backups disponibles */
  listBackups(): BackupMetadata[] {
    this.ensureBackupDir();
    const entries = fs.readdirSync(this.config.backupDir, { withFileTypes: true });
    const backups: BackupMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;

      const metaPath = path.join(this.config.backupDir, entry.name, "_metadata.json");
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as BackupMetadata;
          backups.push(meta);
        } catch { /* skip corrupted */ }
      }
    }

    return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /** Restaure un notebook depuis un backup spécifique */
  restoreNotebook(backupId: string, notebookId: string): boolean {
    const backupPath = path.join(this.config.backupDir, backupId);
    if (!fs.existsSync(backupPath)) {
      log.error(`Backup introuvable: ${backupId}`);
      return false;
    }

    const notebookFile = `${notebookId}.json`;
    const sourcePath = path.join(backupPath, notebookFile);
    if (!fs.existsSync(sourcePath)) {
      log.error(`Notebook ${notebookId} non trouvé dans le backup ${backupId}`);
      return false;
    }

    const destPath = path.join(this.getNotebooksDir(), notebookFile);
    try {
      fs.copyFileSync(sourcePath, destPath);

      // Restaurer aussi les embeddings si disponibles
      const embSource = path.join(backupPath, "embeddings", notebookFile);
      if (fs.existsSync(embSource)) {
        const embDest = path.join(this.getNotebooksDir(), "embeddings", notebookFile);
        fs.copyFileSync(embSource, embDest);
      }

      log.info(`♻️ Notebook ${notebookId} restauré depuis ${backupId}`);
      return true;
    } catch (e: any) {
      log.error(`Erreur restauration: ${e.message}`);
      return false;
    }
  }

  /** Restaure tous les notebooks d'un backup */
  restoreAll(backupId: string): { restored: number; errors: number } {
    const backupPath = path.join(this.config.backupDir, backupId);
    if (!fs.existsSync(backupPath)) {
      return { restored: 0, errors: 1 };
    }

    const files = fs.readdirSync(backupPath).filter(f => f.endsWith(".json") && f !== "_metadata.json");
    let restored = 0;
    let errors = 0;

    for (const file of files) {
      const notebookId = file.replace(".json", "");
      if (this.restoreNotebook(backupId, notebookId)) {
        restored++;
      } else {
        errors++;
      }
    }

    return { restored, errors };
  }

  // ─── Utilitaires ───────────────────────────────────────────────────────────

  private getNotebooksDir(): string {
    const baseDir = process.env.Leanna_CONFIG_PATH || process.env.ELECTRON_APP_PATH || SELF_ROOT || process.cwd();
    return path.join(baseDir, ".Leanna", "notebooks");
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
    }
  }

  private rotateBackups(): void {
    const backups = this.listBackups();
    if (backups.length <= this.config.maxBackups) return;

    // Supprimer les plus anciens
    const toDelete = backups.slice(this.config.maxBackups);
    for (const backup of toDelete) {
      const backupPath = path.join(this.config.backupDir, backup.id);
      try {
        fs.rmSync(backupPath, { recursive: true, force: true });
        log.debug(`🗑️ Ancien backup supprimé: ${backup.id}`);
      } catch (e: any) {
        log.warn(`Erreur suppression ancien backup: ${e.message}`);
      }
    }
  }

  private getTimestampsPath(): string {
    return path.join(this.config.backupDir, "_last-timestamps.json");
  }

  private loadLastTimestamps(): void {
    const tsPath = this.getTimestampsPath();
    if (fs.existsSync(tsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(tsPath, "utf-8"));
        this.lastBackupTimestamps = new Map(Object.entries(data));
      } catch { /* reset */ }
    }
  }

  private saveLastTimestamps(): void {
    const tsPath = this.getTimestampsPath();
    const obj = Object.fromEntries(this.lastBackupTimestamps);
    fs.writeFileSync(tsPath, JSON.stringify(obj, null, 2), "utf-8");
  }

  /** Retourne la configuration active */
  getConfig(): BackupConfig {
    return { ...this.config };
  }

  /** Met à jour la configuration */
  updateConfig(updates: Partial<BackupConfig>): void {
    if (updates.intervalMs !== undefined) this.config.intervalMs = updates.intervalMs;
    if (updates.maxBackups !== undefined) this.config.maxBackups = updates.maxBackups;
    if (updates.enabled !== undefined) this.config.enabled = updates.enabled;

    // Redémarrer le timer si l'intervalle change
    if (updates.intervalMs !== undefined || updates.enabled !== undefined) {
      this.stop();
      if (this.config.enabled) this.start();
    }
  }
}

// Singleton
export const backupService = new BackupService();
