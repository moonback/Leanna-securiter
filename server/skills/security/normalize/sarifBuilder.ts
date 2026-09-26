/**
 * sarifBuilder — Normalisation des alertes en format SARIF 2.1.0 (OASIS)
 */

import { buildSarifReport } from '../../../security/reporting/SarifBuilder.js';
import type { Finding } from '../../../security/findings/Finding.js';

export function exportToSarif(findings: Finding[], workspaceRoot?: string): Record<string, unknown> {
  return buildSarifReport(findings, workspaceRoot);
}

export function exportToSarifJson(findings: Finding[], workspaceRoot?: string): string {
  return JSON.stringify(exportToSarif(findings, workspaceRoot), null, 2);
}
