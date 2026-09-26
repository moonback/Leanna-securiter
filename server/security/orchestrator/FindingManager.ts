/**
 * FindingManager — Gestionnaire de cycle de vie et triage des vulnérabilités (ex-GoalManager)
 * 
 * - Déduplication par empreinte SARIF primaire (primaryLocationHash / fingerprint)
 * - Triage : transitions d'état (open → acknowledged → fixed / false_positive)
 * - Persistance en mémoire et journal d'audit de triage
 * - Filtrage et recherche avancée multi-critères
 */

import type { Finding, FindingStatus, FindingSeverity, ScannerCategory } from '../findings/Finding.js';
import { computeFingerprint } from '../findings/Fingerprint.js';

export interface TriageAuditEntry {
  findingId: string;
  previousStatus: FindingStatus;
  newStatus: FindingStatus;
  timestamp: string;
  rationale?: string;
  author?: string;
}

export interface FindingFilterOptions {
  status?: FindingStatus | 'all';
  severity?: FindingSeverity | 'all';
  scanner?: ScannerCategory | 'all';
  searchQuery?: string;
  cwe?: string;
  cisaKevOnly?: boolean;
}

export class FindingManager {
  private findings = new Map<string, Finding>(); // findingId -> Finding
  private fingerprintIndex = new Map<string, string>(); // fingerprint -> findingId
  private triageAuditLog: TriageAuditEntry[] = [];

  /**
   * Enregistre ou fusionne un lot de vulnérabilités découvertes.
   * Conserve les statuts de triage existants (false_positive, acknowledged, fixed).
   */
  public ingest(incoming: Finding[]): Finding[] {
    const updated: Finding[] = [];

    for (const f of incoming) {
      const fp = f.fingerprint || computeFingerprint({
        filePath: f.location?.filePath || 'unknown',
        ruleId: f.ruleId,
        snippet: f.location?.snippet,
      });

      const existingId = this.fingerprintIndex.get(fp);

      if (existingId && this.findings.has(existingId)) {
        const current = this.findings.get(existingId)!;

        // Mettre à jour les scores CVSS/EPSS si plus récents/élevés
        if ((f.cvssScore ?? 0) > (current.cvssScore ?? 0)) {
          current.cvssScore = f.cvssScore;
        }
        if ((f.epssScore ?? 0) > (current.epssScore ?? 0)) {
          current.epssScore = f.epssScore;
        }
        if (f.cisaKev && !current.cisaKev) {
          current.cisaKev = true;
        }

        current.lastSeen = new Date().toISOString();
        updated.push(current);
      } else {
        const item: Finding = {
          ...f,
          fingerprint: fp,
          status: f.status || 'open',
          firstSeen: f.firstSeen || new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };

        this.findings.set(item.id, item);
        this.fingerprintIndex.set(fp, item.id);
        updated.push(item);
      }
    }

    return updated;
  }

  public getById(id: string): Finding | undefined {
    return this.findings.get(id);
  }

  public updateStatus(
    id: string,
    newStatus: FindingStatus,
    rationale?: string,
    author?: string
  ): boolean {
    const finding = this.findings.get(id);
    if (!finding) return false;

    const previousStatus = finding.status;
    finding.status = newStatus;

    this.triageAuditLog.push({
      findingId: id,
      previousStatus,
      newStatus,
      timestamp: new Date().toISOString(),
      rationale,
      author: author || 'security-operator',
    });

    return true;
  }

  public query(options: FindingFilterOptions = {}): Finding[] {
    let result = Array.from(this.findings.values());

    if (options.status && options.status !== 'all') {
      result = result.filter((f) => f.status === options.status);
    }
    if (options.severity && options.severity !== 'all') {
      result = result.filter((f) => f.severity === options.severity);
    }
    if (options.scanner && options.scanner !== 'all') {
      result = result.filter((f) => f.scanner === options.scanner);
    }
    if (options.cisaKevOnly) {
      result = result.filter((f) => f.cisaKev);
    }
    if (options.cwe) {
      result = result.filter((f) => f.cwe?.includes(options.cwe!));
    }
    if (options.searchQuery) {
      const q = options.searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.location.filePath.toLowerCase().includes(q) ||
          f.ruleId.toLowerCase().includes(q)
      );
    }

    return result;
  }

  public getStats() {
    const all = Array.from(this.findings.values());
    return {
      total:        all.length,
      open:         all.filter((f) => f.status === 'open').length,
      confirmed:    all.filter((f) => f.status === 'confirmed').length,
      falsePositive:all.filter((f) => f.status === 'false_positive').length,
      fixed:        all.filter((f) => f.status === 'fixed').length,
      ignored:      all.filter((f) => f.status === 'ignored').length,
      critical:     all.filter((f) => f.severity === 'critical' && f.status === 'open').length,
      high:         all.filter((f) => f.severity === 'high'     && f.status === 'open').length,
      cisaKev:      all.filter((f) => f.cisaKev                && f.status === 'open').length,
    };
  }

  public getAuditLog(findingId?: string): TriageAuditEntry[] {
    if (findingId) {
      return this.triageAuditLog.filter((l) => l.findingId === findingId);
    }
    return [...this.triageAuditLog];
  }

  public clear(): void {
    this.findings.clear();
    this.fingerprintIndex.clear();
    this.triageAuditLog = [];
  }
}
