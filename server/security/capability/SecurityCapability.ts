/**
 * SecurityCapability — Passerelle de capacité sécurité gouvernée (Phase 5)
 *
 * Objectif : donner à Leanna (et aux agents autorisés) UNE interface unique,
 * bornée et non privilégiée pour auditer le workspace, sans exposer directement
 * les scanners individuels, le FindingManager, le filesystem, npm ou les API CVE.
 *
 *   Leanna
 *      │  security.audit()
 *      ▼
 *   SecurityCapability   ← politique d'accès (canScan / canNetwork / containment)
 *      │
 *      ▼
 *   SecurityOrchestrator ← orchestration réelle (SAST | SCA | Secrets | IaC)
 *
 * Principe clé : accès à la *capacité*, pas un accès système général. La
 * passerelle refuse par défaut toute cible hors du workspace et n'autorise ni
 * exécution shell ni écriture. La remédiation reste hors périmètre (approbation
 * explicite via un autre outil).
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  SecurityOrchestrator,
  type ScanExecutionResult,
  type AttackSurfaceGraph,
  type ScanProfileType,
} from '../orchestrator/SecurityOrchestrator.js';
import type { Finding, FindingStatus } from '../findings/Finding.js';
import type { FindingFilterOptions } from '../orchestrator/FindingManager.js';

// ---------------------------------------------------------------------------
// Modes d'audit exposés à Leanna (section 14 du plan)
// ---------------------------------------------------------------------------

export type AuditMode = 'quick' | 'standard' | 'deep';

/** Mapping mode logique → profil d'orchestrateur. */
const MODE_TO_PROFILE: Record<AuditMode, ScanProfileType> = {
  quick: 'quick',
  standard: 'standard',
  deep: 'full',
};

export interface AuditOptions {
  /** Sous-chemin relatif à auditer (défaut : racine du workspace). */
  targetPath?: string;
  /** Profondeur de l'audit. */
  mode?: AuditMode;
  /** Autoriser l'enrichissement réseau (OSV/EPSS/KEV). */
  onlineEnrichment?: boolean;
  /** Liste de fichiers modifiés (ex. git diff) pour un audit ciblé. */
  changedFiles?: string[];
}

export interface SecurityCapability {
  audit(options?: AuditOptions): Promise<ScanExecutionResult>;
  scanFile(filePath: string): Promise<Finding[]>;
  scanDependencies(targetPath?: string): Promise<Finding[]>;
  getFindings(filters?: FindingFilterOptions): Finding[];
  getFinding(id: string): Finding | undefined;
  getAttackSurface(): AttackSurfaceGraph;
  generateSarif(): Record<string, unknown>;
  generateSbom(projectName: string, projectVersion: string): Record<string, unknown>;
  updateFindingStatus(id: string, status: FindingStatus, rationale?: string, author?: string): boolean;
}

// ---------------------------------------------------------------------------
// Erreur de politique
// ---------------------------------------------------------------------------

export class SecurityCapabilityDeniedError extends Error {
  constructor(reason: string) {
    super(`[SecurityCapability] Accès refusé : ${reason}`);
    this.name = 'SecurityCapabilityDeniedError';
  }
}

// ---------------------------------------------------------------------------
// Implémentation
// ---------------------------------------------------------------------------

export class SecurityCapabilityGateway implements SecurityCapability {
  private readonly orchestrator: SecurityOrchestrator;

  constructor(
    private readonly workspaceRoot: string,
    orchestrator?: SecurityOrchestrator,
  ) {
    if (!workspaceRoot || !workspaceRoot.trim()) {
      throw new SecurityCapabilityDeniedError('aucun workspace actif.');
    }
    this.orchestrator = orchestrator ?? SecurityOrchestrator.getInstance();
  }

  // --- Politique d'accès (SecurityPolicyEngine condensé) -------------------

  /**
   * Résout une cible **strictement à l'intérieur du workspace**.
   * Refuse chemins absolus, remontées `..` et sorties via symlink/junction.
   */
  private resolveInsideWorkspace(target?: string): string {
    const realRoot = this.safeRealpath(path.resolve(this.workspaceRoot));

    if (target === undefined || target === null || target.trim() === '' || target.trim() === '.') {
      return realRoot;
    }

    const requested = target.trim();
    if (
      path.isAbsolute(requested) ||
      path.win32.isAbsolute(requested) ||
      path.posix.isAbsolute(requested) ||
      /^[a-zA-Z]:/.test(requested) ||
      requested.startsWith('\\\\')
    ) {
      throw new SecurityCapabilityDeniedError(`chemin absolu interdit : "${requested}".`);
    }

    const candidate = path.resolve(realRoot, requested);
    const real = this.safeRealpath(candidate);
    const rel = path.relative(realRoot, real);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new SecurityCapabilityDeniedError(`cible hors du workspace : "${requested}".`);
    }
    return real;
  }

  private safeRealpath(p: string): string {
    try {
      return fs.existsSync(p) ? fs.realpathSync(p) : p;
    } catch {
      return p;
    }
  }

  // --- Capacités -----------------------------------------------------------

  async audit(options: AuditOptions = {}): Promise<ScanExecutionResult> {
    const targetDir = this.resolveInsideWorkspace(options.targetPath);
    const profile = MODE_TO_PROFILE[options.mode ?? 'standard'];

    return this.orchestrator.runScan(targetDir, {
      profile,
      triggerType: 'api',
      changedFiles: options.changedFiles,
      // L'enrichissement réseau est une décision de politique explicite.
      policyOverride: options.onlineEnrichment === false
        ? { scanners: { sast: true, sca: false, secrets: true, iac: true, dast: false } }
        : undefined,
    });
  }

  async scanFile(filePath: string): Promise<Finding[]> {
    // Un scan de fichier unique passe par un audit ciblé et confiné.
    const abs = this.resolveInsideWorkspace(filePath);
    const result = await this.orchestrator.runScan(abs, { profile: 'quick', triggerType: 'api' });
    return result.findings;
  }

  async scanDependencies(targetPath?: string): Promise<Finding[]> {
    const targetDir = this.resolveInsideWorkspace(targetPath);
    const result = await this.orchestrator.runScan(targetDir, {
      profile: 'standard',
      triggerType: 'api',
      policyOverride: { scanners: { sast: false, sca: true, secrets: false, iac: false, dast: false } },
    });
    return result.findings.filter((f) => f.scanner === 'sca');
  }

  getFindings(filters?: FindingFilterOptions): Finding[] {
    return this.orchestrator.getAllFindings(filters);
  }

  getFinding(id: string): Finding | undefined {
    return this.orchestrator.getFindingById(id);
  }

  getAttackSurface(): AttackSurfaceGraph {
    return this.orchestrator.getAttackSurface();
  }

  generateSarif(): Record<string, unknown> {
    return this.orchestrator.generateSarifReport(this.workspaceRoot);
  }

  generateSbom(projectName: string, projectVersion: string): Record<string, unknown> {
    return this.orchestrator.generateCycloneDxSbom(projectName, projectVersion);
  }

  updateFindingStatus(id: string, status: FindingStatus, rationale?: string, author?: string): boolean {
    return this.orchestrator.updateFindingStatus(id, status, rationale, author);
  }
}

/**
 * Fabrique une passerelle liée au workspace actif. Renvoie `null` si aucun
 * workspace n'est ouvert (l'appelant doit alors refuser proprement l'audit).
 */
export function createSecurityCapability(workspaceRoot: string | null | undefined): SecurityCapability | null {
  if (!workspaceRoot || !workspaceRoot.trim()) return null;
  return new SecurityCapabilityGateway(workspaceRoot);
}
