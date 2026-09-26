/**
 * ssrfScanner — Scanner spécialisé SSRF (Server-Side Request Forgery)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import { cwe918Rule } from './rules/cwe-918.js';

export function scanSsrf(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  const ssrfRegex = /(?:fetch|axios(?:\.get|\.post)?|http\.get|https\.get|got(?:\.get|\.post)?)\s*\(\s*(?:req\.(?:query|body|params)|url|targetUrl|userUrl|inputUrl)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    if (ssrfRegex.test(line)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-918', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'CWE-918',
        ruleName: cwe918Rule.name,
        title: `SSRF potentiel : URL contrôlée par l'utilisateur (${filePath}:${lineNum})`,
        description: `Une requête réseau sortante est effectuée à destination d'une URL provenant d'entrées utilisateur sans filtrage d'IP privée.\n\nCode : \`${trimmed}\``,
        severity: 'high',
        status: 'open',
        scanner: 'sast',
        cwe: ['CWE-918'],
        owasp: ['A10:2021-Server-Side Request Forgery'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 8.5,
        impact: 'Scan de ports internes, accès aux métadonnées cloud (AWS 169.254.169.254) ou requêtes internes forgées.',
        remediation: cwe918Rule.remediation!,
        references: cwe918Rule.references!,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return findings;
}
