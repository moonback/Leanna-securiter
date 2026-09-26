/**
 * pathTraversalScanner — Scanner spécialisé Path Traversal (CWE-22)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import { cwe22Rule } from './rules/cwe-22.js';

export function scanPathTraversal(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  const traversalRegex = /(?:fs\.readFile|fs\.readFileSync|fs\.createReadStream|res\.sendFile)\s*\(\s*(?:path\.join|path\.resolve)?\s*\([^)]*?(?:req\.(?:params|query|body)|filename|userFile|filePath)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // S'il n'y a pas de vérification startsWith ou includes ..
    if (traversalRegex.test(line) && !line.includes('startsWith') && !line.includes('normalize')) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'CWE-22', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'CWE-22',
        ruleName: cwe22Rule.name,
        title: `Path Traversal potentiel : lecture de fichier avec chemin utilisateur (${filePath}:${lineNum})`,
        description: `Un accès au système de fichiers utilise un paramètre non validé sans contrôle de confinement sous le répertoire racine.\n\nCode : \`${trimmed}\``,
        severity: 'high',
        status: 'open',
        scanner: 'sast',
        cwe: ['CWE-22'],
        owasp: ['A01:2021-Broken Access Control'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 7.8,
        impact: 'Lecture arbitraire de fichiers système sensibles (/etc/passwd, .env, clés privées).',
        remediation: cwe22Rule.remediation!,
        references: cwe22Rule.references!,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return findings;
}
