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

import {
  SecurityOrchestrator,
  type ScanExecutionResult,
  type AttackSurfaceGraph,
  type ScanProfileType,
} from '../orchestrator/SecurityOrchestrator.js';
import type { Finding, FindingStatus } from '../findings/Finding.js';
import type { FindingFilterOptions } from '../orchestrator/FindingManager.js';
import { SecurityPolicyEngine, type PolicyDecision } from '../policy/SecurityPolicyEngine.js';
import { ThreatModelEngine, type ThreatModel } from '../threat/ThreatModelEngine.js';
import { SecurityGraph } from '../graph/SecurityGraph.js';
import { SecurityPostureTracker, type PostureSnapshot, type PostureTrendReport } from '../posture/SecurityPostureTracker.js';

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
  /**
   * Évalue si une analyse dynamique (DAST) peut cibler `target`, en tenant
   * compte de l'opt-in explicite ET de la classification d'environnement.
   * Ne lance PAS la DAST : renvoie uniquement la décision de gouvernance.
   */
  checkDastTarget(target: string, explicitOptIn: boolean): PolicyDecision;
  /**
   * Construit un modèle de menace STRIDE à partir des findings courants
   * (ou d'un filtre optionnel) et des points d'entrée découverts.
   */
  generateThreatModel(filters?: FindingFilterOptions): ThreatModel;
  /**
   * Fusionne findings + surface d'attaque + modèle de menace en un graphe de
   * sécurité unifié et interrogeable (section 17 du plan).
   */
  generateSecurityGraph(filters?: FindingFilterOptions): SecurityGraph;
  /** Historique des instantanés de posture enregistrés après chaque audit. */
  getPostureHistory(): PostureSnapshot[];
  /** Tendance de posture (improving/stable/regressing) entre les deux derniers audits. */
  getPostureTrend(): PostureTrendReport;
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
  private readonly policy: SecurityPolicyEngine;
  private readonly threatEngine: ThreatModelEngine;
  private readonly posture: SecurityPostureTracker;

  constructor(
    private readonly workspaceRoot: string,
    orchestrator?: SecurityOrchestrator,
    policy?: SecurityPolicyEngine,
    threatEngine?: ThreatModelEngine,
    posture?: SecurityPostureTracker,
  ) {
    if (!workspaceRoot || !workspaceRoot.trim()) {
      throw new SecurityCapabilityDeniedError('aucun workspace actif.');
    }
    this.orchestrator = orchestrator ?? SecurityOrchestrator.getInstance();
    this.policy = policy ?? new SecurityPolicyEngine(workspaceRoot);
    this.threatEngine = threatEngine ?? new ThreatModelEngine(workspaceRoot);
    this.posture = posture ?? new SecurityPostureTracker();
  }

  // --- Politique d'accès (déléguée au SecurityPolicyEngine) ----------------

  /**
   * Résout une cible **strictement à l'intérieur du workspace** via le moteur
   * de politique. Lève `SecurityCapabilityDeniedError` si la cible est refusée.
   */
  private resolveInsideWorkspace(target?: string): string {
    const decision = this.policy.canScan(target);
    if (decision.effect !== 'allow' || !decision.target) {
      throw new SecurityCapabilityDeniedError(decision.reason);
    }
    return decision.target;
  }

  // --- Capacités -----------------------------------------------------------

  async audit(options: AuditOptions = {}): Promise<ScanExecutionResult> {
    const targetDir = this.resolveInsideWorkspace(options.targetPath);
    const profile = MODE_TO_PROFILE[options.mode ?? 'standard'];

    const result = await this.orchestrator.runScan(targetDir, {
      profile,
      triggerType: 'api',
      changedFiles: options.changedFiles,
      // L'enrichissement réseau est une décision de politique explicite.
      policyOverride: options.onlineEnrichment === false
        ? { scanners: { sast: true, sca: false, secrets: true, iac: true, dast: false } }
        : undefined,
    });

    // Enregistre la posture pour le suivi temporel (section 18).
    this.posture.recordFromScan(result);
    return result;
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

  checkDastTarget(target: string, explicitOptIn: boolean): PolicyDecision {
    return this.policy.canRunDast(target, explicitOptIn);
  }

  generateThreatModel(filters?: FindingFilterOptions): ThreatModel {
    const findings = this.orchestrator.getAllFindings(filters ?? { status: 'open' });
    return this.threatEngine.build(findings);
  }

  generateSecurityGraph(filters?: FindingFilterOptions): SecurityGraph {
    const findings = this.orchestrator.getAllFindings(filters ?? { status: 'open' });
    const attackSurface = this.orchestrator.getAttackSurface();
    const threatModel = this.threatEngine.build(findings);
    return SecurityGraph.build({ findings, attackSurface, threatModel });
  }

  getPostureHistory(): PostureSnapshot[] {
    return this.posture.list();
  }

  getPostureTrend(): PostureTrendReport {
    return this.posture.trend();
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
