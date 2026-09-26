/**
 * cveResolver — Résolution multi-sources de vulnérabilités CVE
 * 
 * Interroge de manière coordonnée :
 * - OSV.dev (Open Source Vulnerabilities)
 * - NIST NVD API v2
 * - GitHub Advisory Database (GHSA)
 */

import { queryOsvBatch, queryOsvByPackage, type OsvVulnerability } from '../../../security/integrations/OsvClient.js';
import { getNvdCveById, extractCvssV3Score, extractCweIds } from '../../../security/integrations/NvdClient.js';
import { queryGhsaByPackage } from '../../../security/integrations/GithubAdvisoryClient.js';

export interface ResolvedCveData {
  cveId: string;
  title: string;
  description: string;
  cvssScore: number;
  cvssVector?: string;
  cwes: string[];
  references: string[];
  sources: ('osv' | 'nvd' | 'ghsa')[];
}

export async function resolvePackageCves(packageName: string, version: string, ecosystem = 'npm'): Promise<ResolvedCveData[]> {
  const results: ResolvedCveData[] = [];
  const seenCves = new Set<string>();

  // 1. OSV Query
  try {
    const osvVulns = await queryOsvByPackage(packageName, version, ecosystem);
    for (const v of osvVulns) {
      const cveAliases = (v.aliases || []).filter((a) => a.startsWith('CVE-'));
      const primaryId = cveAliases[0] || v.id;

      if (seenCves.has(primaryId)) continue;
      seenCves.add(primaryId);

      let cvss = 5.0;
      let vector: string | undefined;
      let cwes: string[] = [];

      // 2. Si on a un CVE- ID et que NVD est configuré, enrichir avec NVD
      if (primaryId.startsWith('CVE-')) {
        try {
          const nvd = await getNvdCveById(primaryId);
          if (nvd) {
            const cvssInfo = extractCvssV3Score(nvd);
            if (cvssInfo) {
              cvss = cvssInfo.score;
              vector = cvssInfo.vector;
            }
            cwes = extractCweIds(nvd);
          }
        } catch {
          // Best effort
        }
      }

      results.push({
        cveId: primaryId,
        title: v.summary?.slice(0, 140) || `${primaryId} dans ${packageName}@${version}`,
        description: v.details || v.summary || '',
        cvssScore: cvss,
        cvssVector: vector,
        cwes,
        references: [
          `https://osv.dev/vulnerability/${v.id}`,
          ...(v.references?.map((r) => r.url) || []).slice(0, 3),
        ],
        sources: ['osv', ...(cwes.length > 0 ? ['nvd' as const] : [])],
      });
    }
  } catch (err) {
    console.warn(`[cveResolver] Failed to resolve OSV for ${packageName}@${version}:`, err);
  }

  // 3. GitHub Advisory fallback si aucun résultat OSV et token disponible
  if (results.length === 0 && process.env.GITHUB_TOKEN) {
    try {
      const ghsaVulns = await queryGhsaByPackage(packageName, ecosystem);
      for (const g of ghsaVulns) {
        const id = g.ghsaId || g.summary;
        if (seenCves.has(id)) continue;
        seenCves.add(id);

        results.push({
          cveId: id,
          title: g.summary,
          description: g.description,
          cvssScore: g.cvss?.score ?? 5.0,
          cvssVector: g.cvss?.vectorString,
          cwes: g.cwes?.map((c) => c.cweId) || [],
          references: [`https://github.com/advisories/${g.ghsaId}`],
          sources: ['ghsa'],
        });
      }
    } catch {
      // Best effort
    }
  }

  return results;
}
