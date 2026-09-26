/**
 * xssScanner — Scanner spécialisé XSS (Cross-Site Scripting)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import { cwe79Rule } from './rules/cwe-79.js';

export function scanXss(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  const xssPatterns = [
    {
      re: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*([^}]+)\}\s*\}/i,
      name: 'React dangerouslySetInnerHTML',
      severity: 'high' as const,
      cvss: 7.5,
    },
    {
      re: /(?:element|\$|document)\.innerHTML\s*=\s*(?:req\.|props\.|state\.|params\.|[a-zA-Z0-9_]+HTML)/i,
      name: 'DOM innerHTML Assignment',
      severity: 'high' as const,
      cvss: 7.2,
    },
    {
      re: /document\.write(?:ln)?\s*\(/i,
      name: 'document.write Call',
      severity: 'medium' as const,
      cvss: 6.1,
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const pat of xssPatterns) {
      if (pat.re.test(line)) {
        const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-79', snippet: trimmed });
        findings.push({
          id: crypto.randomUUID(),
          fingerprint,
          ruleId: 'CWE-79',
          ruleName: pat.name,
          title: `XSS (${pat.name}) détecté : ${filePath}:${lineNum}`,
          description: `Injection possible de markup ou script dans le DOM client sans sanitisation préalable.\n\nCode : \`${trimmed}\``,
          severity: pat.severity,
          status: 'open',
          scanner: 'sast',
          cwe: ['CWE-79'],
          owasp: ['A03:2021-Injection'],
          location: { filePath, startLine: lineNum, snippet: trimmed },
          cvssScore: pat.cvss,
          impact: 'Vol de tokens de session, redirection malveillante ou exécution de code JavaScript dans le contexte de la session utilisateur.',
          remediation: cwe79Rule.remediation!,
          references: cwe79Rule.references!,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    }
  }

  return findings;
}
