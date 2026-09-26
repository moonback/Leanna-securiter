/**
 * k8sScanner — Scanner d'Infrastructure as Code pour manifestes Kubernetes (YAML)
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';

export function scanKubernetesManifest(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  // Vérifier si c'est un manifeste k8s
  const isK8s = /apiVersion\s*:\s*[a-zA-Z0-9./]+/i.test(content) && /kind\s*:\s*(?:Pod|Deployment|StatefulSet|DaemonSet|Job)/i.test(content);
  if (!isK8s) return findings;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // 1. Conteneur privilégié
    if (/privileged\s*:\s*true/i.test(trimmed)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-K8S-PRIVILEGED', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'IAC-K8S-PRIVILEGED',
        ruleName: 'Conteneur Kubernetes privilégié (privileged: true)',
        title: `Conteneur privilégié détecté dans le manifeste : ${filePath}:${lineNum}`,
        description: `L'attribut \`privileged: true\` désactive toutes les protections Linux de confinement (namespaces, capabilities, cgroups) et donne un accès direct aux périphériques hôtes.`,
        severity: 'critical',
        status: 'open',
        scanner: 'iac',
        cwe: ['CWE-250'],
        owasp: ['A05:2021-Security Misconfiguration'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 9.3,
        impact: 'Prise de contrôle immédiate du nœud Kubernetes hôte en cas d’intrusion dans le pod.',
        remediation: 'Supprimez `privileged: true` et ajoutez uniquement les Linux capabilities strictement indispensables via `securityContext.capabilities.add`.',
        references: ['https://kubernetes.io/docs/concepts/security/pod-security-standards/'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    // 2. hostNetwork ou hostPID
    if (/hostNetwork\s*:\s*true/i.test(trimmed) || /hostPID\s*:\s*true/i.test(trimmed)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-K8S-HOST-ACCESS', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'IAC-K8S-HOST-ACCESS',
        ruleName: 'Partage de namespace hôte (hostNetwork / hostPID)',
        title: `Partage de namespace avec le nœud hôte : ${filePath}:${lineNum}`,
        description: `Le pod partage l'espace de nommage réseau ou de processus de l'hôte, permettant l'écoute du trafic des autres pods ou l'inspection de processus système.`,
        severity: 'high',
        status: 'open',
        scanner: 'iac',
        cwe: ['CWE-668'],
        owasp: ['A05:2021-Security Misconfiguration'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 8.1,
        impact: 'Écoute passive du réseau de cluster et contournement de la segmentation réseau des pods.',
        remediation: 'Configurez `hostNetwork: false` et `hostPID: false`.',
        references: ['https://kubernetes.io/docs/concepts/security/pod-security-standards/'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return findings;
}
