/**
 * injectionScanner — Détecteur spécialisé d'injections (SQLi, NoSQLi, Command Injection, LDAP)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import { cwe89Rule } from './rules/cwe-89.js';
import { cwe78Rule } from './rules/cwe-78.js';
import { cwe943Rule } from './rules/cwe-943.js';

export function scanInjections(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  // 1. SQL Injection (CWE-89)
  const sqlPattern = /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\s+.*?\$\{|db\.query\s*\(\s*[`'"][^`'"]*[`'"]\s*\+|queryRaw\s*`[^`]*?\$\{|(?:execute|rawQuery)\s*\(\s*[`'"][^`'"]*[`'"]\s*\+/i;
  // 2. Command Injection (CWE-78)
  const cmdPattern = /(?:child_process|exec|execSync|spawn|spawnSync)\s*\(\s*(?:`[^`]*?\$\{|['"][^'"]*?\+\s*[a-zA-Z0-9_]+)/i;
  // 3. NoSQL Injection (CWE-943)
  const nosqlPattern = /(?:\.find|\.findOne|\.countDocuments)\s*\(\s*\{\s*[^}]*?\$ne\s*:\s*(?:req\.|params|query|body)/i;
  // 4. LDAP Injection (CWE-90)
  const ldapPattern = /(?:ldap\.search|client\.search)\s*\([^)]*?(?:req\.body|req\.query|filter\s*:\s*[`'"][^`'"]*?\+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Commentaires ignorés
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

    if (sqlPattern.test(line)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-89', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'CWE-89',
        ruleName: cwe89Rule.name,
        title: `Injection SQL détectée : interpolation directe dans requête (${filePath}:${lineNum})`,
        description: `Une requête SQL est construite en interpolant des expressions dynamiques non paramétrées.\n\nCode : \`${trimmed}\``,
        severity: 'critical',
        status: 'open',
        scanner: 'sast',
        cwe: ['CWE-89'],
        owasp: ['A03:2021-Injection'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 9.8,
        impact: 'Exfiltration complète de base de données, destruction de tables ou élévation de privilèges.',
        remediation: cwe89Rule.remediation!,
        references: cwe89Rule.references!,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    if (cmdPattern.test(line)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-78', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'CWE-78',
        ruleName: cwe78Rule.name,
        title: `Injection de commande OS : exécution de chaîne dynamique (${filePath}:${lineNum})`,
        description: `Exécution d'une commande système avec des arguments concaténés ou interpolés.\n\nCode : \`${trimmed}\``,
        severity: 'critical',
        status: 'open',
        scanner: 'sast',
        cwe: ['CWE-78'],
        owasp: ['A03:2021-Injection'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 9.8,
        impact: 'Exécution de code arbitraire à distance (RCE) avec les privilèges du processus hôte.',
        remediation: cwe78Rule.remediation!,
        references: cwe78Rule.references!,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    if (nosqlPattern.test(line)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-943', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'CWE-943',
        ruleName: cwe943Rule.name,
        title: `Injection NoSQL : passage direct de sélecteur MongoDB ($ne) (${filePath}:${lineNum})`,
        description: `Un filtre NoSQL utilise des paramètres utilisateur sans validation de type strict.\n\nCode : \`${trimmed}\``,
        severity: 'high',
        status: 'open',
        scanner: 'sast',
        cwe: ['CWE-943'],
        owasp: ['A03:2021-Injection'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 8.2,
        impact: 'Contournement des mécanismes d’authentification ou extraction de documents non autorisés.',
        remediation: cwe943Rule.remediation!,
        references: cwe943Rule.references!,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    if (ldapPattern.test(line)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-90', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'CWE-90',
        ruleName: 'LDAP Injection',
        title: `Injection LDAP : filtre de recherche non échappé (${filePath}:${lineNum})`,
        description: `Un filtre LDAP est concaténé avec des données utilisateur sans échappement.\n\nCode : \`${trimmed}\``,
        severity: 'high',
        status: 'open',
        scanner: 'sast',
        cwe: ['CWE-90'],
        owasp: ['A03:2021-Injection'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 7.5,
        impact: 'Contournement de contrôle d’accès sur l’annuaire d’entreprise LDAP/Active Directory.',
        remediation: 'Échappez les caractères spéciaux LDAP (*, (, ), \\, NUL) avant incorporation dans le filtre.',
        references: ['https://cwe.mitre.org/data/definitions/90.html'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return findings;
}
