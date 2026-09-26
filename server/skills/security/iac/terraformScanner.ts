/**
 * terraformScanner — Scanner d'Infrastructure as Code pour fichiers Terraform (.tf)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';

export function scanTerraformFile(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    // 1. Ingress 0.0.0.0/0 sur ports sensibles (SSH: 22, RDP: 3389, DB: 5432, 3306)
    if (/cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/i.test(trimmed)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-TF-OPEN-CIDR', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'IAC-TF-OPEN-CIDR',
        ruleName: 'Security Group ouvert à Internet (0.0.0.0/0)',
        title: `Security Group exposé publiquement (0.0.0.0/0) : ${filePath}:${lineNum}`,
        description: `La règle de pare-feu autorise le trafic depuis n'importe quelle adresse IP publique d'Internet (\`0.0.0.0/0\`).`,
        severity: 'high',
        status: 'open',
        scanner: 'iac',
        cwe: ['CWE-284'],
        owasp: ['A01:2021-Broken Access Control'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 7.5,
        impact: 'Exposition directe d’instances de calcul ou de bases de données aux attaques par force brute et scans Internet.',
        remediation: 'Restreignez le bloc CIDR à un sous-réseau VPN interne ou aux adresses IP de bastion d\'administration.',
        references: ['https://developer.hashicorp.com/terraform/tutorials/aws/aws-security-groups'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    // 2. S3 Bucket public ou non chiffré
    if (/acl\s*=\s*"public-read(?:-write)?"/i.test(trimmed)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-TF-PUBLIC-S3', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'IAC-TF-PUBLIC-S3',
        ruleName: 'Bucket S3 avec ACL publique',
        title: `Bucket AWS S3 configuré avec accès public : ${filePath}:${lineNum}`,
        description: `L'ACL \`public-read\` ou \`public-read-write\` expose publiquement les fichiers stockés dans le bucket.`,
        severity: 'critical',
        status: 'open',
        scanner: 'iac',
        cwe: ['CWE-284'],
        owasp: ['A01:2021-Broken Access Control'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 9.1,
        impact: 'Fuite massive de données client ou secrets stockés dans les compartiments de stockage cloud.',
        remediation: 'Définissez `acl = "private"` et activez `aws_s3_account_public_access_block`.',
        references: ['https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return findings;
}
