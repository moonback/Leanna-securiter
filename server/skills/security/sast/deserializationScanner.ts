/**
 * deserializationScanner — Scanner spécialisé Désérialisation non sécurisée (CWE-502)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import { cwe502Rule } from './rules/cwe-502.js';

export function scanDeserialization(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  const patterns = [
    { re: /yaml\.load\s*\(/i, name: 'Insecure yaml.load (use yaml.safeLoad)' },
    { re: /node-serialize|serialize\.unserialize\s*\(/i, name: 'Insecure node-serialize unserialize' },
    { re: /JSON\.parse\s*\([^)]*?\)\s*as\s+Function/i, name: 'Deserialization into executable Function' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const pat of patterns) {
      if (pat.re.test(line)) {
        const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-502', snippet: trimmed });
        findings.push({
          id: crypto.randomUUID(),
          fingerprint,
          ruleId: 'CWE-502',
          ruleName: cwe502Rule.name,
          title: `Désérialisation non sécurisée (${pat.name}) : ${filePath}:${lineNum}`,
          description: `Utilisation d'une fonction de désérialisation permettant l'instanciation de classes arbitraires.\n\nCode : \`${trimmed}\``,
          severity: 'critical',
          status: 'open',
          scanner: 'sast',
          cwe: ['CWE-502'],
          owasp: ['A08:2021-Software and Data Integrity Failures'],
          location: { filePath, startLine: lineNum, snippet: trimmed },
          cvssScore: 9.8,
          impact: 'Exécution de code à distance (RCE) via des gadgets de désérialisation.',
          remediation: cwe502Rule.remediation!,
          references: cwe502Rule.references!,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    }
  }

  return findings;
}
