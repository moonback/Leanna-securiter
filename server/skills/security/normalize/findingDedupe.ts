/**
 * findingDedupe — Déduplication canonique et fusion de vulnérabilités
 * 
 * Génère des fingerprints SHA-256 stables indépendamment des numéros de lignes
 * ou des légères variations de formattage afin d'éviter la prolifération de doublons.
 */

import { computeFingerprint } from '../../../security/findings/Fingerprint.js';
import type { Finding } from '../../../security/findings/Finding.js';

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();

  for (const f of findings) {
    const fp = f.fingerprint || computeFingerprint({
      filePath: f.location?.filePath || 'global',
      ruleId: f.ruleId,
      snippet: f.location?.snippet,
    });

    if (!seen.has(fp)) {
      seen.set(fp, { ...f, fingerprint: fp });
    } else {
      // Fusion enrichie : conserver le score CVSS/EPSS le plus précis
      const existing = seen.get(fp)!;
      if ((f.cvssScore ?? 0) > (existing.cvssScore ?? 0)) {
        existing.cvssScore = f.cvssScore;
      }
      if ((f.epssScore ?? 0) > (existing.epssScore ?? 0)) {
        existing.epssScore = f.epssScore;
      }
      if (f.cisaKev && !existing.cisaKev) {
        existing.cisaKev = true;
      }
      if (f.references) {
        existing.references = Array.from(new Set([...(existing.references || []), ...f.references]));
      }
    }
  }

  return Array.from(seen.values());
}
