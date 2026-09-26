/**
 * Rule — Modèle canonique d'une règle de sécurité.
 *
 * Une règle définit :
 * - L'identifiant unique (ex: "CWE-89", "OWASP-A03-2021", "LEANNA-SEC-001")
 * - La famille (SAST, SCA, secrets, IaC, DAST)
 * - Les patterns de détection (regex, AST patterns, critères)
 * - La sévérité de base et le mapping CWE/OWASP
 */

export type RuleFamily = "sast" | "sca" | "secrets" | "iac" | "dast";
export type RuleSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface RulePattern {
  /**
   * Pattern regex (pour une détection par expression régulière).
   * La regex est testée sur le contenu textuel du fichier.
   */
  regex?: string;
  /**
   * Flags regex (ex: "i" pour insensible à la casse, "m" pour multiline).
   */
  regexFlags?: string;
  /**
   * Extensions de fichiers ciblées (ex: [".ts", ".js", ".py"]).
   * Si vide, la règle s'applique à tous les fichiers.
   */
  extensions?: string[];
  /**
   * Chemins à exclure (glob patterns).
   */
  excludePaths?: string[];
  /**
   * Sinks connus (pour taint analysis) — noms de fonctions/méthodes dangereuses.
   */
  sinks?: string[];
  /**
   * Sources connues (pour taint analysis) — noms de fonctions/variables d'entrée.
   */
  sources?: string[];
}

export interface Rule {
  /** Identifiant unique de la règle (ex: "CWE-89", "SECRETS-AWS-KEY") */
  id: string;
  /** Nom court de la règle */
  name: string;
  /** Description complète */
  description: string;
  /** Famille de scanner */
  family: RuleFamily;
  /** Sévérité de base (peut être ajustée par le contexte) */
  severity: RuleSeverity;
  /** Référence CWE (ex: "CWE-89") */
  cwe?: string;
  /** Référence OWASP Top 10 2021 (ex: "A03:2021") */
  owasp?: string;
  /** Référence MITRE ATT&CK (ex: "T1190") */
  mitre?: string;
  /** Règle active ou désactivée */
  enabled: boolean;
  /** Patterns de détection */
  patterns: RulePattern[];
  /** Tags pour la catégorisation */
  tags: string[];
  /** Références extérieures (CWE, OWASP, CVE docs) */
  references: string[];
  /** Conseil de remédiation */
  remediation?: string;
  /** Confiance de base de la règle (0–1) */
  confidence?: number;
}
