import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Finding } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";

function calculateEntropy(str: string): number {
  const len = str.length;
  if (len === 0) return 0;
  const frequencies = new Map<string, number>();
  for (let i = 0; i < len; i++) {
    const char = str[i];
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

interface SecretPattern {
  id: string;
  name: string;
  pattern: RegExp;
  minEntropy?: number;
  severity: 'critical' | 'high' | 'medium';
  cvssScore: number;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'SEC-AWS-KEY',
    name: 'AWS Access Key ID',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    severity: 'critical',
    cvssScore: 9.1,
  },
  {
    id: 'SEC-GITHUB-TOKEN',
    name: 'GitHub Personal Access Token',
    pattern: /\b(gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{82})\b/g,
    severity: 'critical',
    cvssScore: 9.3,
  },
  {
    id: 'SEC-GOOGLE-KEY',
    name: 'Google API Key',
    pattern: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
    severity: 'high',
    cvssScore: 8.2,
  },
  {
    id: 'SEC-SLACK-TOKEN',
    name: 'Slack Bot/User Token',
    pattern: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/g,
    severity: 'high',
    cvssScore: 8.0,
  },
  {
    id: 'SEC-PRIVATE-KEY',
    name: 'Private Cryptographic Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    severity: 'critical',
    cvssScore: 9.8,
  },
  {
    id: 'SEC-OPENAI-KEY',
    name: 'OpenAI / Anthropic API Key',
    pattern: /\b(sk-[a-zA-Z0-9]{20,50}|sk-ant-[a-zA-Z0-9_-]{20,80})\b/g,
    severity: 'critical',
    cvssScore: 9.1,
  },
  {
    id: 'SEC-STRIPE-KEY',
    name: 'Stripe Secret Key',
    pattern: /\b(sk_live_[0-9a-zA-Z]{24,34})\b/g,
    severity: 'critical',
    cvssScore: 9.5,
  },
  {
    id: 'SEC-GENERIC-PASSWORD',
    name: 'Identifiants ou secret codé en dur',
    pattern: /(?:password|passwd|secret|jwt_secret|api_key|token|auth_token)\s*[:=]\s*["']([A-Za-z0-9!@#$%^&*()_+=\-`~[\]{}|:;<>?,./]{10,64})["']/gi,
    minEntropy: 3.5,
    severity: 'high',
    cvssScore: 7.8,
  },
];

export async function scanFileForSecrets(filePath: string, content: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Ignore test mocks or false positive lines
    if (line.includes('example') || line.includes('dummy') || line.includes('fake') || line.includes('test-key')) {
      continue;
    }

    for (const rule of SECRET_PATTERNS) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = rule.pattern.exec(line)) !== null) {
        const secretCandidate = match[1] || match[0];

        if (rule.minEntropy && calculateEntropy(secretCandidate) < rule.minEntropy) {
          continue;
        }

        const id = crypto.randomUUID();
        const fingerprint = computeFingerprint({
          filePath,
          ruleId: rule.id,
          snippet: line.trim(),
          startLine: lineIdx + 1,
        });

        // Masquer le secret pour affichage sécurisé
        const masked = secretCandidate.length > 8
          ? secretCandidate.slice(0, 4) + '••••••••' + secretCandidate.slice(-4)
          : '••••••••';

        findings.push({
          id,
          fingerprint,
          ruleId: rule.id,
          ruleName: rule.name,
          title: `Secret détecté : ${rule.name}`,
          description: `Un secret ou jeton d'authentification (${rule.name}) a été détecté en clair dans le code source : ${masked}`,
          severity: rule.severity,
          status: 'open',
          scanner: 'secrets',
          cwe: ['CWE-798', 'CWE-200'],
          owasp: ['A07:2021-Identification and Authentication Failures'],
          location: {
            filePath,
            startLine: lineIdx + 1,
            snippet: line.trim().replace(secretCandidate, masked),
          },
          cvssScore: rule.cvssScore,
          impact: 'Un attaquant ayant accès au code source ou au dépôt peut usurper l\'identité du service, exfiltrer des données ou compromettre l\'infrastructure.',
          remediation: 'Révoquez immédiatement ce jeton/secret. Utilisez des variables d\'environnement ou un gestionnaire de coffre-fort (Vault, AWS Secrets Manager, GitHub Secrets).',
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    }
  }

  return findings;
}
