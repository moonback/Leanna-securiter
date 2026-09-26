import type { VerificationIssue } from "./WorkspaceState.js";

export interface ValidationSnapshot {
  typecheckErrors: number;
  lintErrors: number;
  securityErrors: number;
  testsFailed: number;
  raw: unknown;
}

export interface RegressionReport {
  passed: boolean;
  regressions: VerificationIssue[];
  baseline: ValidationSnapshot;
  current: ValidationSnapshot;
}

/**
 * Compares executable global-validation evidence. Existing project failures are
 * tolerated only when they do not increase; a task may never hide a regression.
 */
export class AgentValidation {
  static snapshot(result: any): ValidationSnapshot {
    const typecheckErrors = Number(result?.typecheck?.errorCount ?? result?.typecheck?.errors?.length ?? result?.parsedErrors?.length ?? 0);
    const lintErrors = Number(result?.lint?.summary?.errors ?? result?.lint?.violations?.filter((issue: any) => issue.severity === "error").length ?? 0);
    const securityErrors = Number(result?.security?.summary?.critical ?? 0) + Number(result?.security?.summary?.high ?? 0);
    const testsFailed = Number(result?.tests?.failed ?? result?.test?.ok === false ? 1 : 0);
    return { typecheckErrors, lintErrors, securityErrors, testsFailed, raw: result };
  }

  static compare(baseline: ValidationSnapshot, current: ValidationSnapshot): RegressionReport {
    const checks: Array<[keyof Omit<ValidationSnapshot, "raw">, "typecheck" | "lint" | "security" | "test"]> = [
      ["typecheckErrors", "typecheck"], ["lintErrors", "lint"], ["securityErrors", "security"], ["testsFailed", "test"],
    ];
    const regressions = checks.flatMap(([field, type]) => current[field] > baseline[field]
      ? [{ type, file: "<workspace>", line: null, column: null, severity: "error" as const, rule: "regression", message: `${type}: ${baseline[field]} → ${current[field]} erreur(s).`, suggestion: "Lire les diagnostics actuels et corriger la cause racine avant de terminer." }]
      : []);
    return { passed: regressions.length === 0, regressions, baseline, current };
  }
}
