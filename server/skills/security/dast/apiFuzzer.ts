/**
 * apiFuzzer — Fuzzer dynamique d'API (DAST) avec garde-fou d'opt-in explicite
 * 
 * NÉCESSITE UN OPT-IN EXPLICITE : ne s'exécute jamais automatiquement sans
 * confirmation formelle de la part de l'utilisateur (danger d'effets de bord).
 */

import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';

export interface FuzzOptions {
  targetUrl: string;
  explicitOptIn: boolean;
  endpoints?: string[];
  maxRequests?: number;
}

export interface FuzzReport {
  status: 'completed' | 'aborted_missing_opt_in' | 'error';
  endpointsFuzzed: number;
  anomaliesDetected: number;
  findings: Finding[];
}

const COMMON_PROBES = [
  { payload: "' OR '1'='1", name: 'SQL Injection probe' },
  { payload: '<script>alert(1)</script>', name: 'XSS probe' },
  { payload: '../../../../etc/passwd', name: 'Path traversal probe' },
  { payload: '${7*7}', name: 'SSTI probe' },
];

export async function fuzzApiEndpoints(options: FuzzOptions): Promise<FuzzReport> {
  if (!options.explicitOptIn) {
    return {
      status: 'aborted_missing_opt_in',
      endpointsFuzzed: 0,
      anomaliesDetected: 0,
      findings: [],
    };
  }

  const findings: Finding[] = [];
  const endpoints = options.endpoints || ['/'];
  const maxReq = options.maxRequests || 20;
  let requestsSent = 0;

  for (const ep of endpoints) {
    if (requestsSent >= maxReq) break;

    for (const probe of COMMON_PROBES) {
      if (requestsSent >= maxReq) break;
      requestsSent++;

      try {
        const fullUrl = new URL(ep, options.targetUrl);
        fullUrl.searchParams.set('q', probe.payload);

        const res = await fetch(fullUrl.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });

        // Détection d'erreurs 500 ou fuites de stacktrace
        if (res.status === 500) {
          const body = await res.text().catch(() => '');
          const hasStackTrace = /at\s+.*?\s+\(.*?\)|Traceback\s+\(most\s+recent\s+call\s+last\)/i.test(body);

          const fingerprint = computeFingerprint({
            filePath: ep,
            ruleId: 'DAST-UNHANDLED-500',
            snippet: probe.payload,
          });

          findings.push({
            id: crypto.randomUUID(),
            fingerprint,
            ruleId: 'DAST-UNHANDLED-500',
            ruleName: 'Erreur 500 non gérée avec injection de payload',
            title: `Anomalie 500 détectée sur ${ep} avec ${probe.name}`,
            description: `L'envoi du payload test \`${probe.payload}\` sur l'endpoint \`${ep}\` a déclenché une erreur serveur interne HTTP 500.${hasStackTrace ? ' Une stack trace technique a été divulguée dans la réponse.' : ''}`,
            severity: hasStackTrace ? 'high' : 'medium',
            status: 'open',
            scanner: 'dast',
            cwe: hasStackTrace ? ['CWE-209', 'CWE-20'] : ['CWE-20'],
            owasp: ['A05:2021-Security Misconfiguration'],
            location: { filePath: ep, startLine: 1, snippet: fullUrl.toString() },
            cvssScore: hasStackTrace ? 7.2 : 5.3,
            impact: 'Divulgation d’informations internes de débogage et instabilité du service.',
            remediation: 'Interceptez les erreurs via un middleware global d’erreur et retournez des messages génériques en masquant la stack trace.',
            references: ['https://cwe.mitre.org/data/definitions/209.html'],
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          });
        }
      } catch {
        // Erreur réseau lors du probe : ignorer
      }
    }
  }

  return {
    status: 'completed',
    endpointsFuzzed: endpoints.length,
    anomaliesDetected: findings.length,
    findings,
  };
}
