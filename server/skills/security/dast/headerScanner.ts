/**
 * headerScanner — Scanner dynamique / statique d'en-têtes HTTP de sécurité
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';

export interface HeaderAnalysis {
  missingHeaders: string[];
  presentHeaders: Record<string, string>;
  findings: Finding[];
}

const RECOMMENDED_HEADERS: Record<string, { desc: string; severity: 'high' | 'medium' | 'low'; cwe: string }> = {
  'Content-Security-Policy': {
    desc: 'Protège contre les attaques XSS et les injections de scripts non autorisés.',
    severity: 'high',
    cwe: 'CWE-1021',
  },
  'Strict-Transport-Security': {
    desc: 'Force les connexions HTTPS chiffrées (HSTS) contre les attaques de downgrade.',
    severity: 'high',
    cwe: 'CWE-319',
  },
  'X-Frame-Options': {
    desc: 'Empêche l\'affichage du site dans une iframe (protection contre le Clickjacking).',
    severity: 'medium',
    cwe: 'CWE-1021',
  },
  'X-Content-Type-Options': {
    desc: 'Empêche le reniflage de type MIME (nosniff).',
    severity: 'low',
    cwe: 'CWE-16',
  },
  'Referrer-Policy': {
    desc: 'Contrôle la transmission de l\'en-tête Referer lors des navigations sortantes.',
    severity: 'low',
    cwe: 'CWE-200',
  },
};

export function analyzeHttpHeaders(headers: Record<string, string>, targetUrl = 'http://localhost'): HeaderAnalysis {
  const findings: Finding[] = [];
  const missingHeaders: string[] = [];
  const normalizedHeaders: Record<string, string> = {};

  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }

  for (const [hdr, meta] of Object.entries(RECOMMENDED_HEADERS)) {
    if (!normalizedHeaders[hdr.toLowerCase()]) {
      missingHeaders.push(hdr);

      const fingerprint = computeFingerprint({
        filePath: targetUrl,
        ruleId: `DAST-HEADER-${hdr.toUpperCase()}`,
        snippet: hdr,
      });

      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: `DAST-HEADER-${hdr.toUpperCase()}`,
        ruleName: `En-tête de sécurité manquant : ${hdr}`,
        title: `En-tête HTTP manquant : ${hdr} sur ${targetUrl}`,
        description: `La réponse HTTP ne contient pas l'en-tête recommandé **${hdr}**.\n\n${meta.desc}`,
        severity: meta.severity,
        status: 'open',
        scanner: 'dast',
        cwe: [meta.cwe],
        owasp: ['A05:2021-Security Misconfiguration'],
        location: { filePath: targetUrl, startLine: 1, snippet: `Missing: ${hdr}` },
        cvssScore: meta.severity === 'high' ? 6.5 : meta.severity === 'medium' ? 4.8 : 3.2,
        impact: `Affaiblissement de la sécurité du client et exposition accrue aux attaques web (Clickjacking, XSS, downgrade).`,
        remediation: `Configurez le middleware Helmet ou ajoutez l'en-tête \`${hdr}\` dans les en-têtes de réponse de votre serveur.`,
        references: ['https://owasp.org/www-project-secure-headers/'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return { missingHeaders, presentHeaders: headers, findings };
}
