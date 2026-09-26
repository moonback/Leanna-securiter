/**
 * dockerfileScanner — Scanner d'Infrastructure as Code pour Dockerfiles
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';

export function scanDockerfile(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  let hasUserInstruction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) continue;

    if (/^USER\s+/i.test(trimmed)) {
      hasUserInstruction = true;
    }

    // 1. Tag :latest utilisé
    if (/^FROM\s+[^\s:]+:latest\b/i.test(trimmed) || /^FROM\s+[^\s:]+\s*$/i.test(trimmed)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-DOCKER-LATEST', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'IAC-DOCKER-LATEST',
        ruleName: 'Utilisation du tag Docker :latest',
        title: `Image Docker basée sur un tag non immuable (:latest) : ${filePath}:${lineNum}`,
        description: `L'instruction FROM utilise le tag \`:latest\` ou n'en spécifie aucun. Les builds ne sont pas reproductibles et peuvent intégrer des régressions inattendues.`,
        severity: 'medium',
        status: 'open',
        scanner: 'iac',
        cwe: ['CWE-1188'],
        owasp: ['A05:2021-Security Misconfiguration'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 5.3,
        impact: 'Instabilité des conteneurs en production lors de mises à jour amont silencieuses.',
        remediation: 'Épinglez une version précise de l\'image de base (ex: node:20.11-alpine ou SHA256 digest).',
        references: ['https://docs.docker.com/develop/develop-images/dockerfile_best-practices/'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    // 2. Secret exposé dans ENV ou ARG
    if (/^(?:ENV|ARG)\s+.*?(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)\s*=/i.test(trimmed)) {
      const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-DOCKER-SECRET-ENV', snippet: trimmed });
      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: 'IAC-DOCKER-SECRET-ENV',
        ruleName: 'Secret hardcodé dans ENV/ARG Docker',
        title: `Secret exposé dans les variables Dockerfile : ${filePath}:${lineNum}`,
        description: `Les variables définies via ENV ou ARG sont visibles dans les métadonnées de l'image (docker inspect/history) et persistent dans les couches.`,
        severity: 'critical',
        status: 'open',
        scanner: 'iac',
        cwe: ['CWE-798'],
        owasp: ['A07:2021-Identification and Authentication Failures'],
        location: { filePath, startLine: lineNum, snippet: trimmed },
        cvssScore: 8.9,
        impact: 'Exfiltration de secrets d’infrastructure par simple inspection de l’image conteneur.',
        remediation: 'Utilisez BuildKit secrets (--secret id=mysecret) ou injectez les identifiants au runtime.',
        references: ['https://docs.docker.com/build/building/secrets/'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  // 3. Absence d'instruction USER (exécution root)
  if (!hasUserInstruction && lines.length > 3) {
    const fingerprint = computeFingerprint({ filePath, ruleId: 'IAC-DOCKER-ROOT', snippet: 'MISSING_USER' });
    findings.push({
      id: crypto.randomUUID(),
      fingerprint,
      ruleId: 'IAC-DOCKER-ROOT',
      ruleName: 'Conteneur s\'exécutant en tant que root',
      title: `Aucune instruction USER définie dans le Dockerfile : ${filePath}`,
      description: `Le conteneur s'exécute avec les privilèges root par défaut. En cas de vulnérabilité ou évasion de conteneur, l'attaquant dispose des droits root.`,
      severity: 'medium',
      status: 'open',
      scanner: 'iac',
      cwe: ['CWE-250'],
      owasp: ['A05:2021-Security Misconfiguration'],
      location: { filePath, startLine: 1, snippet: lines[0] || 'FROM ...' },
      cvssScore: 6.5,
      impact: 'Augmentation du rayon d’impact (blast radius) lors d’une attaque par container breakout.',
      remediation: 'Ajoutez `USER nonroot` ou `USER 1001` avant la commande CMD / ENTRYPOINT.',
      references: ['https://cwe.mitre.org/data/definitions/250.html'],
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
  }

  return findings;
}
