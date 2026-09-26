/**
 * ScanQueue — File d'attente et ordonnanceur de scans de sécurité (ex-TaskManager)
 * 
 * Garanties :
 * - Exclusion mutuelle par workspace : 1 seul scan actif par repo/dossier à la fois
 * - Gestion des priorités : Diffs/Commit checks (100) > API on-demand (50) > Full cron audit (10)
 * - Traitement FIFO dans chaque tranche de priorité
 */

export interface QueuedScanJob {
  jobId: string;
  targetDir: string;
  priority: number;
  enqueuedAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  runner: () => Promise<unknown>;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export class ScanQueue {
  private queue: QueuedScanJob[] = [];
  private activeJobs = new Map<string, QueuedScanJob>(); // targetDir -> running job

  /**
   * Ajoute une analyse à la file d'attente avec priorité.
   */
  public enqueue<T>(
    targetDir: string,
    priority: number,
    runner: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const job: QueuedScanJob = {
        jobId,
        targetDir,
        priority,
        enqueuedAt: Date.now(),
        status: 'queued',
        runner,
        resolve,
        reject,
      };

      this.queue.push(job);
      // Tri par priorité décroissante, puis par date d'insertion croissante (FIFO)
      this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);

      this.processNext();
    });
  }

  /**
   * Traite les éléments de la file pour les cibles sans scan actif.
   */
  private async processNext(): Promise<void> {
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      if (this.activeJobs.has(job.targetDir)) {
        continue; // La cible est occupée par un autre scan en cours
      }

      // Retirer de la file d'attente et marquer comme actif
      this.queue.splice(i, 1);
      job.status = 'running';
      this.activeJobs.set(job.targetDir, job);

      // Exécution asynchrone non-bloquante pour la boucle
      (async () => {
        try {
          const result = await job.runner();
          job.status = 'completed';
          job.resolve(result);
        } catch (err) {
          job.status = 'failed';
          job.reject(err);
        } finally {
          this.activeJobs.delete(job.targetDir);
          this.processNext();
        }
      })();

      break;
    }
  }

  public isBusy(targetDir?: string): boolean {
    if (targetDir) return this.activeJobs.has(targetDir);
    return this.activeJobs.size > 0;
  }

  public getStats() {
    return {
      queued: this.queue.length,
      active: this.activeJobs.size,
      activeTargets: Array.from(this.activeJobs.keys()),
    };
  }

  public cancel(jobId: string): boolean {
    const idx = this.queue.findIndex((j) => j.jobId === jobId);
    if (idx !== -1) {
      const [job] = this.queue.splice(idx, 1);
      job.status = 'cancelled';
      job.reject(new Error('Scan job cancelled'));
      return true;
    }
    return false;
  }
}
