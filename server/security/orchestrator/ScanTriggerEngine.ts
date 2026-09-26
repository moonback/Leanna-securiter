/**
 * ScanTriggerEngine — Moteur de déclenchement d'analyse de sécurité (ex-PerceptionEngine)
 * 
 * Capture les événements de déclenchement :
 * - Invocations explicites via API ou UI
 * - Détection de commits git / modifications locales (diff)
 * - Tâches planifiées (cron)
 * 
 * Maintient un cache de hash SHA-256 (WorkspaceState) par fichier pour ne rescanner
 * que les fichiers réellement altérés lors d'une analyse incrémentale.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type TriggerType = 'api' | 'git_commit' | 'file_change' | 'cron' | 'pre_push';

export interface ScanTriggerEvent {
  id: string;
  type: TriggerType;
  targetDir: string;
  timestamp: string;
  changedFiles?: string[];
  metadata?: Record<string, unknown>;
}

export class ScanTriggerEngine {
  /** Cache d'empreinte de fichiers : filePath -> SHA-256 hash */
  private fileHashMap = new Map<string, string>();
  private lastTriggerTime = 0;

  /**
   * Calcule le hash SHA-256 du contenu d'un fichier.
   */
  public computeFileHash(filePath: string): string | null {
    try {
      const buffer = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch {
      return null;
    }
  }

  /**
   * Détecte les fichiers modifiés ou ajoutés depuis la dernière indexation.
   */
  public detectChangedFiles(files: string[]): { changed: string[]; unchanged: string[] } {
    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const file of files) {
      const currentHash = this.computeFileHash(file);
      if (!currentHash) continue;

      const previousHash = this.fileHashMap.get(file);
      if (previousHash !== currentHash) {
        changed.push(file);
        this.fileHashMap.set(file, currentHash);
      } else {
        unchanged.push(file);
      }
    }

    return { changed, unchanged };
  }

  /**
   * Crée un événement de déclenchement formel.
   */
  public createTriggerEvent(
    type: TriggerType,
    targetDir: string,
    changedFiles?: string[],
    metadata?: Record<string, unknown>
  ): ScanTriggerEvent {
    this.lastTriggerTime = Date.now();
    return {
      id: `trig-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      type,
      targetDir,
      timestamp: new Date().toISOString(),
      changedFiles,
      metadata,
    };
  }

  public getCacheSize(): number {
    return this.fileHashMap.size;
  }

  public clearCache(): void {
    this.fileHashMap.clear();
  }
}
