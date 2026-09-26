import { createHash } from "crypto";
import type { VerificationIssue, VerificationRecord } from "./WorkspaceState.js";

export type RepairAction = "continue" | "change_strategy" | "stop";
export interface RepairDirective {
  action: RepairAction;
  requiredAction: string;
  issues: VerificationIssue[];
  currentHash?: string;
  currentVersion?: number;
  reason: string;
}

/** Deterministic repair policy based on issue root causes and observed change progress. */
export class AgentRepairLoop {
  private previousIssueKeys = new Set<string>();
  private previousPatch?: string;
  private previousHash?: string;
  private stalls = 0;

  assess(input: { issues: VerificationIssue[]; record?: VerificationRecord; currentHash?: string; currentVersion?: number; patch?: string }): RepairDirective {
    const issues = input.issues;
    const issueKeys = new Set(issues.map((issue) => `${issue.type}:${issue.rule}:${issue.file}:${issue.line ?? ""}`));
    const patchHash = input.patch ? createHash("sha256").update(input.patch).digest("hex") : undefined;
    const repeatedPatch = Boolean(patchHash && patchHash === this.previousPatch);
    const unresolved = [...issueKeys].filter((key) => this.previousIssueKeys.has(key)).length;
    const progress = issues.length < this.previousIssueKeys.size || unresolved < this.previousIssueKeys.size || (input.currentHash && input.currentHash !== this.previousHash);
    const strongRegression = issues.some((issue) => issue.severity === "critical") || issues.length > Math.max(3, this.previousIssueKeys.size * 2);
    this.stalls = progress ? 0 : this.stalls + 1;
    this.previousIssueKeys = issueKeys;
    this.previousPatch = patchHash;
    this.previousHash = input.currentHash;
    const grouped = this.groupRootCauses(issues);
    const context = `hash=${input.currentHash ?? "unknown"}, version=${input.currentVersion ?? "unknown"}; causes: ${grouped.join("; ") || "verification state unavailable"}.`;
    if (strongRegression || repeatedPatch || this.stalls >= 2) {
      return { action: "stop", issues, currentHash: input.currentHash, currentVersion: input.currentVersion, reason: strongRegression ? "Régression forte détectée." : repeatedPatch ? "Patch identique répété." : "Aucun progrès mesurable sur deux corrections.", requiredAction: `REQUIRED ACTION: stop automatic patching and report the blocker. ${context}` };
    }
    if (!progress && this.stalls === 1) {
      return { action: "change_strategy", issues, currentHash: input.currentHash, currentVersion: input.currentVersion, reason: "La correction n'a pas réduit les causes racines.", requiredAction: `REQUIRED ACTION: change strategy, re-read the current file, and address the grouped root cause before another patch. ${context}` };
    }
    return { action: "continue", issues, currentHash: input.currentHash, currentVersion: input.currentVersion, reason: "Progrès mesurable ou nouvelle cause traitable.", requiredAction: `REQUIRED ACTION: re-read the exact current content and apply one targeted correction, then verify its current hash. ${context}` };
  }

  private groupRootCauses(issues: VerificationIssue[]): string[] {
    return [...new Set(issues.map((issue) => `${issue.type}/${issue.rule} in ${issue.file}`))];
  }
}
