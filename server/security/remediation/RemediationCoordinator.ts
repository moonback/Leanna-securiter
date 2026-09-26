/**
 * RemediationCoordinator — Boucle de remédiation gouvernée (Phase 5, section 16)
 *
 * Impose le cycle :
 *
 *   AUDIT → FINDINGS → TRIAGE → (APPROBATION) → REMEDIATION → TESTS → RE-AUDIT
 *
 * Invariants de sécurité :
 *   - Un simple audit ne déclenche JAMAIS de correctif (pas de fix implicite).
 *   - Seuls les findings triés « confirmed » entrent dans la file de remédiation.
 *   - Chaque remédiation exige DEUX conditions : la politique
 *     (`SecurityPolicyEngine.canRemediate` → `approval`) ET une approbation
 *     explicite fournie par l'appelant. Sans les deux, la boucle se bloque.
 *   - Le coordinateur n'exécute jamais lui-même d'écriture ou de shell : il
 *     délègue à des ports injectés (applier de correctif, runner de tests).
 *
 * Le coordinateur est un orchestrateur d'état, pas un exécuteur privilégié.
 */

import type { Finding } from '../findings/Finding.js';
import type { SecurityPolicyEngine } from '../policy/SecurityPolicyEngine.js';

// ---------------------------------------------------------------------------
// Phases & décisions
// ---------------------------------------------------------------------------

export type RemediationPhase =
  | 'idle'
  | 'audited'
  | 'triaged'
  | 'awaiting_approval'
  | 'remediating'
  | 'testing'
  | 're_auditing'
  | 'completed'
  | 'blocked';

export type TriageDecision = 'confirmed' | 'false_positive' | 'accepted_risk';

export interface TriageEntry {
  findingId: string;
  decision: TriageDecision;
  rationale?: string;
}

/** Approbation explicite d'une remédiation, par finding. */
export interface RemediationApproval {
  findingId: string;
  approvedBy: string;
}

// ---------------------------------------------------------------------------
// Ports injectés (aucune exécution privilégiée dans le coordinateur)
// ---------------------------------------------------------------------------

export interface AuditPort {
  /** Lance un audit et renvoie les findings ouverts. */
  runAudit(): Promise<Finding[]>;
}

export interface RemediationApplierPort {
  /**
   * Applique un correctif pour un finding confirmé et approuvé.
   * Renvoie true si un changement a été appliqué.
   */
  applyFix(finding: Finding): Promise<{ applied: boolean; detail?: string }>;
}

export interface TestPort {
  /** Exécute la suite de tests/vérification. */
  runTests(): Promise<{ passed: boolean; detail?: string }>;
}

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

export interface RemediationOutcome {
  findingId: string;
  status: 'remediated' | 'skipped_not_confirmed' | 'blocked_no_approval' | 'blocked_policy' | 'apply_failed';
  detail?: string;
}

export interface RemediationRunReport {
  phase: RemediationPhase;
  auditedCount: number;
  confirmedCount: number;
  outcomes: RemediationOutcome[];
  tests?: { passed: boolean; detail?: string };
  reAudit?: {
    before: number;
    after: number;
    resolved: number;
    regressions: number;
  };
  blockedReason?: string;
}

// ---------------------------------------------------------------------------
// Coordinateur
// ---------------------------------------------------------------------------

export interface RemediationPorts {
  audit: AuditPort;
  applier: RemediationApplierPort;
  tests: TestPort;
}

export class RemediationCoordinator {
  private phase: RemediationPhase = 'idle';

  constructor(
    private readonly policy: SecurityPolicyEngine,
    private readonly ports: RemediationPorts,
  ) {}

  getPhase(): RemediationPhase {
    return this.phase;
  }

  /**
   * Exécute la boucle complète de remédiation gouvernée.
   *
   * @param triage       Décisions de triage (par finding).
   * @param approvals    Approbations explicites de remédiation (par finding).
   * @param options.runTests   Lance les tests après remédiation (défaut true).
   * @param options.reAudit    Relance un audit après remédiation (défaut true).
   */
  async run(
    triage: TriageEntry[],
    approvals: RemediationApproval[],
    options: { runTests?: boolean; reAudit?: boolean } = {},
  ): Promise<RemediationRunReport> {
    const runTests = options.runTests ?? true;
    const reAudit = options.reAudit ?? true;

    // 1. AUDIT ---------------------------------------------------------------
    this.phase = 'audited';
    const before = await this.ports.audit.runAudit();
    const byId = new Map(before.map((f) => [f.id, f]));

    // 2. TRIAGE : ne garder que les findings existants marqués « confirmed ».
    this.phase = 'triaged';
    const confirmedIds = new Set(
      triage.filter((t) => t.decision === 'confirmed' && byId.has(t.findingId)).map((t) => t.findingId),
    );
    const approvalById = new Map(approvals.map((a) => [a.findingId, a]));

    const outcomes: RemediationOutcome[] = [];

    // Findings non confirmés → jamais remédiés (traçabilité).
    for (const f of before) {
      if (!confirmedIds.has(f.id)) {
        outcomes.push({ findingId: f.id, status: 'skipped_not_confirmed' });
      }
    }

    // 3. APPROBATION + REMEDIATION ------------------------------------------
    this.phase = 'awaiting_approval';
    let anyApplied = false;

    for (const findingId of confirmedIds) {
      const finding = byId.get(findingId)!;

      // (a) Politique : doit renvoyer « approval » (write activé). Sinon bloqué.
      const decision = this.policy.canRemediate({ id: finding.id, severity: finding.severity });
      if (decision.effect !== 'approval') {
        outcomes.push({ findingId, status: 'blocked_policy', detail: decision.reason });
        continue;
      }

      // (b) Approbation explicite requise en plus de la politique.
      const approval = approvalById.get(findingId);
      if (!approval) {
        outcomes.push({ findingId, status: 'blocked_no_approval' });
        continue;
      }

      // (c) Application déléguée au port (jamais dans le coordinateur).
      this.phase = 'remediating';
      try {
        const res = await this.ports.applier.applyFix(finding);
        if (res.applied) {
          anyApplied = true;
          outcomes.push({ findingId, status: 'remediated', detail: res.detail });
        } else {
          outcomes.push({ findingId, status: 'apply_failed', detail: res.detail ?? 'aucun changement appliqué' });
        }
      } catch (err) {
        outcomes.push({ findingId, status: 'apply_failed', detail: (err as Error)?.message });
      }
    }

    const report: RemediationRunReport = {
      phase: this.phase,
      auditedCount: before.length,
      confirmedCount: confirmedIds.size,
      outcomes,
    };

    // Si rien n'a été appliqué, inutile de tester / ré-auditer.
    if (!anyApplied) {
      this.phase = confirmedIds.size === 0 ? 'completed' : 'blocked';
      report.phase = this.phase;
      if (this.phase === 'blocked') {
        report.blockedReason = 'aucune remédiation appliquée (approbation ou politique manquante)';
      }
      return report;
    }

    // 4. TESTS ---------------------------------------------------------------
    if (runTests) {
      this.phase = 'testing';
      const tests = await this.ports.tests.runTests();
      report.tests = tests;
      if (!tests.passed) {
        this.phase = 'blocked';
        report.phase = this.phase;
        report.blockedReason = `tests en échec après remédiation : ${tests.detail ?? ''}`.trim();
        return report;
      }
    }

    // 5. RE-AUDIT ------------------------------------------------------------
    if (reAudit) {
      this.phase = 're_auditing';
      const after = await this.ports.audit.runAudit();
      const beforeIds = new Set(before.map((f) => f.id));
      const afterIds = new Set(after.map((f) => f.id));
      const resolved = [...beforeIds].filter((id) => !afterIds.has(id)).length;
      const regressions = [...afterIds].filter((id) => !beforeIds.has(id)).length;
      report.reAudit = { before: before.length, after: after.length, resolved, regressions };
    }

    this.phase = 'completed';
    report.phase = this.phase;
    return report;
  }
}
