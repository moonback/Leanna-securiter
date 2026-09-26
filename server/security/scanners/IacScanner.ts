import crypto from "crypto";
import path from "path";
import type { Finding } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";

interface IacRule {
  id: string;
  name: string;
  category: 'docker' | 'kubernetes' | 'terraform';
  filePattern: RegExp;
  check: (content: string, filePath: string) => Finding[];
}

const IAC_RULES: IacRule[] = [
  // ── Dockerfile Rules ──
  {
    id: 'IAC-DOCKER-ROOT',
    name: 'Conteneur exécuté en tant que root',
    category: 'docker',
    filePattern: /Dockerfile(\..*)?$/i,
    check: (content, filePath) => {
      const findings: Finding[] = [];
      const lines = content.split(/\r?\n/);
      const hasUser = lines.some((l) => /^\s*USER\s+[a-zA-Z0-9_-]+/i.test(l));

      if (!hasUser) {
        findings.push({
          id: crypto.randomUUID(),
          fingerprint: computeFingerprint({ filePath, ruleId: 'IAC-DOCKER-ROOT' }),
          ruleId: 'IAC-DOCKER-ROOT',
          ruleName: 'Exécution du conteneur en tant que root (USER absent)',
          title: 'Conteneur Docker exécuté sans directive USER non-privilégiée',
          description: 'Le Dockerfile ne définit aucune instruction USER. Par défaut, le conteneur s\'exécutera avec les privilèges root, augmentant le risque d\'évasion de conteneur en cas d\'exploit.',
          severity: 'high',
          status: 'open',
          scanner: 'iac',
          cwe: ['CWE-250', 'CWE-269'],
          owasp: ['A05:2021-Security Misconfiguration'],
          location: {
            filePath,
            startLine: 1,
            snippet: lines[0] || 'FROM ...',
          },
          cvssScore: 7.8,
          impact: 'Si une application dans le conteneur est compromise, l\'attaquant possède les privilèges root dans le conteneur et peut tenter une évasion vers l\'hôte.',
          remediation: 'Ajoutez un utilisateur système sans privilèges : RUN adduser -D appuser && USER appuser',
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
      return findings;
    },
  },
  {
    id: 'IAC-DOCKER-LATEST',
    name: 'Image de base Docker non épinglée (tag latest)',
    category: 'docker',
    filePattern: /Dockerfile(\..*)?$/i,
    check: (content, filePath) => {
      const findings: Finding[] = [];
      const lines = content.split(/\r?\n/);

      lines.forEach((line, idx) => {
        if (/^\s*FROM\s+[\w./-]+(:latest)?(\s+AS\s+.*)?$/i.test(line) && !line.includes('@sha256:') && (!line.includes(':') || line.includes(':latest'))) {
          findings.push({
            id: crypto.randomUUID(),
            fingerprint: computeFingerprint({ filePath, ruleId: 'IAC-DOCKER-LATEST', startLine: idx + 1 }),
            ruleId: 'IAC-DOCKER-LATEST',
            ruleName: 'Utilisation de tag latest ou non versionné',
            title: 'Image de base Docker non épinglée avec digest ou version exacte',
            description: `La ligne "${line.trim()}" utilise une image sans version stricte ou avec ":latest". Les builds ne sont pas reproductibles et peuvent intégrer des régressions ou failles inattendues.`,
            severity: 'medium',
            status: 'open',
            scanner: 'iac',
            cwe: ['CWE-1104'],
            owasp: ['A06:2021-Vulnerable and Outdated Components'],
            location: {
              filePath,
              startLine: idx + 1,
              snippet: line.trim(),
            },
            cvssScore: 5.3,
            impact: 'Non-déterminisme des déploiements et risque d\'introduction de vulnérabilités en production.',
            remediation: 'Spécifiez une version exacte ou un digest SHA256 (ex: FROM node:20.11-alpine@sha256:...)',
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          });
        }
      });
      return findings;
    },
  },
  // ── Kubernetes Rules ──
  {
    id: 'IAC-K8S-PRIVILEGED',
    name: 'Conteneur Kubernetes en mode privilégié',
    category: 'kubernetes',
    filePattern: /\.(yaml|yml)$/i,
    check: (content, filePath) => {
      const findings: Finding[] = [];
      if (!content.includes('apiVersion') || !content.includes('kind:')) return findings;

      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/privileged\s*:\s*true/i.test(line)) {
          findings.push({
            id: crypto.randomUUID(),
            fingerprint: computeFingerprint({ filePath, ruleId: 'IAC-K8S-PRIVILEGED', startLine: idx + 1 }),
            ruleId: 'IAC-K8S-PRIVILEGED',
            ruleName: 'Conteneur Kubernetes privilégié',
            title: 'Conteneur déployé avec securityContext.privileged: true',
            description: 'Le conteneur possède tous les privilèges du noyau hôte, équivalent à un accès root complet sur le nœud hôte.',
            severity: 'critical',
            status: 'open',
            scanner: 'iac',
            cwe: ['CWE-250'],
            owasp: ['A05:2021-Security Misconfiguration'],
            location: {
              filePath,
              startLine: idx + 1,
              snippet: line.trim(),
            },
            cvssScore: 9.6,
            impact: 'Évasion immédiate vers l\'hôte du cluster Kubernetes en cas de compromission du conteneur.',
            remediation: 'Définissez privileged: false et utilisez des Linux capabilities granulaires avec securityContext.capabilities.add.',
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          });
        }
      });
      return findings;
    },
  },
  // ── Terraform Rules ──
  {
    id: 'IAC-TF-OPEN-INGRESS',
    name: 'Groupe de sécurité ouvert sur 0.0.0.0/0',
    category: 'terraform',
    filePattern: /\.(tf|hcl)$/i,
    check: (content, filePath) => {
      const findings: Finding[] = [];
      const lines = content.split(/\r?\n/);

      lines.forEach((line, idx) => {
        if (line.includes('0.0.0.0/0') && (line.includes('cidr_blocks') || line.includes('cidr'))) {
          // Vérifier si c'est pour du port 22 (SSH) ou 3389 (RDP)
          const contextWindow = lines.slice(Math.max(0, idx - 8), Math.min(lines.length, idx + 8)).join(' ');
          if (contextWindow.includes('22') || contextWindow.includes('3389') || contextWindow.includes('ssh')) {
            findings.push({
              id: crypto.randomUUID(),
              fingerprint: computeFingerprint({ filePath, ruleId: 'IAC-TF-OPEN-INGRESS', startLine: idx + 1 }),
              ruleId: 'IAC-TF-OPEN-INGRESS',
              ruleName: 'Port d\'administration ouvert publiquement sur Internet',
              title: 'Port SSH/RDP accessible depuis 0.0.0.0/0',
              description: 'Le groupe de sécurité Terraform autorise le trafic entrant depuis n\'importe quelle adresse IP publique vers un port d\'administration sensible.',
              severity: 'critical',
              status: 'open',
              scanner: 'iac',
              cwe: ['CWE-284'],
              owasp: ['A01:2021-Broken Access Control'],
              location: {
                filePath,
                startLine: idx + 1,
                snippet: line.trim(),
              },
              cvssScore: 9.1,
              impact: 'Exposition directe aux attaques par force brute ou exploits zero-day sur le service de gestion.',
              remediation: 'Restreignez le bloc CIDR à un VPN d\'entreprise ou une IP bastion spécifique.',
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
            });
          }
        }
      });
      return findings;
    },
  },
];

export async function scanIacFile(filePath: string, content: string): Promise<Finding[]> {
  const fileName = path.basename(filePath);
  const findings: Finding[] = [];

  for (const rule of IAC_RULES) {
    if (rule.filePattern.test(fileName)) {
      findings.push(...rule.check(content, filePath));
    }
  }

  return findings;
}
