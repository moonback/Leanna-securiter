/**
 * regexScanner — Détecteur haute précision de secrets et tokens
 * 
 * Combine :
 * - Signatures regex d'identifiants connus (AWS, GitHub, Stripe, Slack, JWT...)
 * - Mesure d'entropie de Shannon pour repérer les secrets aléatoires inconnus
 * - Filtrage par allowlist contextuelle
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import { isAllowedSecret } from './allowlist.js';

interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp;
  minEntropy?: number;
  severity: 'critical' | 'high' | 'medium';
  cwe: string;
}

const SECRET_RULES: SecretRule[] = [
  {
    id: 'SEC-AWS-KEY',
    name: 'Clé d\'accès AWS (AKIA...)',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/,
    minEntropy: 3.0,
    severity: 'critical',
    cwe: 'CWE-798',
  },
  {
    id: 'SEC-GITHUB-PAT',
    name: 'GitHub Personal Access Token (ghp_...)',
    pattern: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/,
    severity: 'critical',
    cwe: 'CWE-798',
  },
  {
    id: 'SEC-SLACK-TOKEN',
    name: 'Token d\'API Slack (xox[baprs]-...)',
    pattern: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/,
    severity: 'high',
    cwe: 'CWE-798',
  },
  {
    id: 'SEC-STRIPE-KEY',
    name: 'Clé secrète Stripe (sk_live_...)',
    pattern: /\b(sk_live_[0-9a-zA-Z]{24})\b/,
    severity: 'critical',
    cwe: 'CWE-798',
  },
  {
    id: 'SEC-PRIVATE-KEY',
    name: 'Clé privée RSA / OpenSSH / EC',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    severity: 'critical',
    cwe: 'CWE-312',
  },
  {
    id: 'SEC-JWT-TOKEN',
    name: 'Token JWT codé en dur',
    pattern: /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/,
    minEntropy: 4.2,
    severity: 'medium',
    cwe: 'CWE-798',
  },
];

/** Calcule l'entropie de Shannon d'une chaîne de caractères (en bits/caractère) */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }

  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

export function scanFileSecrets(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    for (const rule of SECRET_RULES) {
      const match = rule.pattern.exec(line);
      if (match) {
        const secretVal = match[1] || match[0];

        // Vérifier l'allowlist
        if (isAllowedSecret(secretVal, filePath)) continue;

        // Vérifier l'entropie minimale si requise
        if (rule.minEntropy && calculateShannonEntropy(secretVal) < rule.minEntropy) {
          continue;
        }

        const maskedSnippet = trimmed.replace(secretVal, `${secretVal.slice(0, 4)}••••••••`);
        const fingerprint = computeFingerprint({
          filePath,
          ruleId: rule.id,
          snippet: maskedSnippet,
        });

        findings.push({
          id: crypto.randomUUID(),
          fingerprint,
          ruleId: rule.id,
          ruleName: rule.name,
          title: `Secret exposé : ${rule.name} dans ${filePath}:${lineNum}`,
          description: `Un secret ou token d'authentification potentiel a été détecté dans le code source.\n\nLigne masquée : \`${maskedSnippet}\``,
          severity: rule.severity,
          status: 'open',
          scanner: 'secrets',
          cwe: [rule.cwe],
          owasp: ['A07:2021-Identification and Authentication Failures'],
          location: {
            filePath,
            startLine: lineNum,
            snippet: maskedSnippet,
          },
          cvssScore: rule.severity === 'critical' ? 9.1 : 7.4,
          impact: 'Compromission immédiate des ressources cloud ou API associées au secret exposé.',
          remediation: `Révoquez immédiatement ce token et stockez-le dans les variables d'environnement (.env non commité) ou un coffre de secrets.`,
          references: [
            'https://cwe.mitre.org/data/definitions/798.html',
            'https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/',
          ],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    }
  }

  return findings;
}
