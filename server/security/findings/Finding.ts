/**
 * Modèle canonique normalisé pour un résultat d'audit de sécurité (Finding).
 * Aligné sur SARIF 2.1.0, CWE et OWASP Top 10.
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingStatus = 'open' | 'confirmed' | 'false_positive' | 'fixed' | 'ignored';

export type ScannerCategory = 'sast' | 'sca' | 'secrets' | 'iac' | 'dast';

export interface FindingLocation {
  filePath: string;
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: string;
  functionName?: string;
}

export interface TaintFlowStep {
  step: number;
  filePath: string;
  line: number;
  kind: 'source' | 'propagation' | 'sanitizer' | 'sink';
  description: string;
  variableName?: string;
}

export interface Finding {
  id: string;
  fingerprint: string;
  ruleId: string;
  ruleName: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  scanner: ScannerCategory;
  cwe: string[];
  owasp: string[];
  location: FindingLocation;
  cvssScore: number;
  cvssVector?: string;
  epssScore?: number;
  cisaKev?: boolean;
  impact?: string;
  remediation?: string;
  suggestedPatch?: string;
  taintFlow?: TaintFlowStep[];
  references?: string[];
  firstSeen: string;
  lastSeen: string;
  metadata?: Record<string, unknown>;
}
