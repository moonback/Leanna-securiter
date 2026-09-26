/**
 * ContinuousAuditManager — Audit de sécurité continu (Phase 5, section 14)
 *
 * Réagit à des événements du cycle de vie du projet pour déclencher des audits
 * ciblés et automatiques, SANS jamais lancer de remédiation implicite :
 *
 *   commit            → audit standard des fichiers du diff
 *   file_change       → audit quick des fichiers modifiés (débouncé)
 *   dependency_change → audit standard (dépendances)
 *   new_endpoint      → audit standard ciblé (nouvelle surface exposée)
 *
 * Les rafales d'événements sont regroupées via un debounce pour éviter de
 * relancer un scan à chaque frappe. Toute l'exécution passe par la
 * SecurityCapability (gouvernance + containment).
 */

import path from 'node:path';
import {
  discoverHttpEntryPoints,
  type EntryPoint,
} from '../threat/ThreatModelEngine.js';
import type { AuditMode, AuditOptions } from '../capability/SecurityCapability.js';
import type { ScanExecutionResult } from '../orchestrator/SecurityOrchestrator.js';

export type ContinuousEventType =
  | 'commit'
  | 'file_change'
  | 'dependency_change'
  | 'new_endpoint';

export interface ContinuousEvent {
  type: ContinuousEventType;
  /** Fichiers concernés (diff, sauvegarde, etc.). */
  files?: string[];
  /** Sous-chemin ciblé (défaut : racine du workspace). */
  targetPath?: string;
}

/** Sous-ensemble de SecurityCapability requis par le manager (testable). */
export interface AuditRunner {
  audit(options?: AuditOptions): Promise<ScanExecutionResult>;
}

export interface ContinuousAuditOptions {
  /** Fenêtre de debounce en ms (défaut : 1500). */
  debounceMs?: number;
  /** Callback appelé après chaque audit automatique. */
  onResult?: (result: ScanExecutionResult, event: ContinuousEvent) => void;
  /** Callback en cas d'erreur d'audit (non bloquant). */
  onError?: (error: unknown, event: ContinuousEvent) => void;
  /** Setter de timer injectable (tests). Défaut : setTimeout. */
  scheduler?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Clear de timer injectable (tests). Défaut : clearTimeout. */
  clearScheduler?: (handle: ReturnType<typeof setTimeout>) => void;
}

/** Priorité de mode : deep > standard > quick. */
const MODE_RANK: Record<AuditMode, number> = { quick: 1, standard: 2, deep: 3 };

/** Mode d'audit associé à chaque type d'événement. */
const MODE_FOR_EVENT: Record<ContinuousEventType, AuditMode> = {
  commit: 'standard',
  file_change: 'quick',
  dependency_change: 'standard',
  new_endpoint: 'standard',
};

export class ContinuousAuditManager {
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  // Agrégat de la rafale courante.
  private pendingFiles = new Set<string>();
  private pendingMode: AuditMode = 'quick';
  private pendingEvent: ContinuousEvent | null = null;

  private readonly debounceMs: number;
  private readonly scheduler: NonNullable<ContinuousAuditOptions['scheduler']>;
  private readonly clearScheduler: NonNullable<ContinuousAuditOptions['clearScheduler']>;

  constructor(
    private readonly runner: AuditRunner,
    private readonly options: ContinuousAuditOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 1500;
    this.scheduler = options.scheduler ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearScheduler = options.clearScheduler ?? ((h) => clearTimeout(h));
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    if (this.timer) {
      this.clearScheduler(this.timer);
      this.timer = null;
    }
    this.resetPending();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Signale un événement. Regroupe la rafale et (re)programme un flush débouncé.
   * Ignoré si le manager est désactivé.
   */
  notify(event: ContinuousEvent): void {
    if (!this.enabled) return;

    for (const f of event.files ?? []) this.pendingFiles.add(f);

    // Le mode retenu pour la rafale est le plus « fort » rencontré.
    const evMode = MODE_FOR_EVENT[event.type];
    if (MODE_RANK[evMode] > MODE_RANK[this.pendingMode]) {
      this.pendingMode = evMode;
    }
    // Conserve le dernier événement comme représentant (pour targetPath/type).
    this.pendingEvent = event;

    if (this.timer) this.clearScheduler(this.timer);
    this.timer = this.scheduler(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /**
   * Force l'exécution immédiate de l'audit agrégé (utile pour les tests et le
   * déclenchement pre_push où l'on ne veut pas attendre le debounce).
   */
  async flush(): Promise<ScanExecutionResult | null> {
    if (this.timer) {
      this.clearScheduler(this.timer);
      this.timer = null;
    }
    const event = this.pendingEvent;
    if (!event) return null;

    const files = [...this.pendingFiles];
    const mode = this.pendingMode;
    this.resetPending();

    try {
      const result = await this.runner.audit({
        mode,
        targetPath: event.targetPath,
        changedFiles: files.length > 0 ? files : undefined,
      });
      this.options.onResult?.(result, event);
      return result;
    } catch (err) {
      this.options.onError?.(err, event);
      return null;
    }
  }

  private resetPending(): void {
    this.pendingFiles.clear();
    this.pendingMode = 'quick';
    this.pendingEvent = null;
  }
}

// ---------------------------------------------------------------------------
// Détection de changements de points d'entrée
// ---------------------------------------------------------------------------

export interface EntryPointDiff {
  added: EntryPoint[];
  removed: EntryPoint[];
}

/**
 * Suit l'ensemble des points d'entrée HTTP et détecte les ajouts/suppressions
 * entre deux inspections. Permet d'émettre un événement `new_endpoint` quand
 * une nouvelle route apparaît.
 */
export class EndpointWatcher {
  private snapshot = new Map<string, EntryPoint>();

  constructor(private readonly routesDir: string) {}

  /** Initialise la référence sans émettre de diff. */
  prime(): void {
    this.snapshot = this.currentSnapshot();
  }

  /** Compare l'état courant à la référence et met à jour la référence. */
  diff(): EntryPointDiff {
    const current = this.currentSnapshot();
    const added: EntryPoint[] = [];
    const removed: EntryPoint[] = [];

    for (const [key, ep] of current) {
      if (!this.snapshot.has(key)) added.push(ep);
    }
    for (const [key, ep] of this.snapshot) {
      if (!current.has(key)) removed.push(ep);
    }

    this.snapshot = current;
    return { added, removed };
  }

  private currentSnapshot(): Map<string, EntryPoint> {
    const map = new Map<string, EntryPoint>();
    for (const ep of discoverHttpEntryPoints(this.routesDir)) {
      map.set(`${ep.verb} ${ep.route} @ ${ep.sourceFile}`, ep);
    }
    return map;
  }
}

// ---------------------------------------------------------------------------
// Fabrique
// ---------------------------------------------------------------------------

/**
 * Assemble un manager d'audit continu + un watcher de points d'entrée liés au
 * workspace. `capability` doit exposer `audit()` (toute SecurityCapability
 * convient). Le manager est créé désactivé : l'appelant décide quand `enable()`.
 */
export function createContinuousAudit(
  workspaceRoot: string,
  capability: AuditRunner,
  options: ContinuousAuditOptions = {},
): { manager: ContinuousAuditManager; endpoints: EndpointWatcher } {
  if (!workspaceRoot || !workspaceRoot.trim()) {
    throw new Error('[createContinuousAudit] workspaceRoot requis.');
  }
  const manager = new ContinuousAuditManager(capability, options);
  const endpoints = new EndpointWatcher(path.join(workspaceRoot, 'server', 'routes'));
  return { manager, endpoints };
}
