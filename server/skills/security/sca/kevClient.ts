/**
 * kevClient — Client du catalogue CISA Known Exploited Vulnerabilities (KEV)
 */

import { cisaKevRules } from '../../../security/rules/packs/cisa-kev.js';

// Cache des CVEs KEV actives connues localement
const KNOWN_KEV_CVES = new Set(
  cisaKevRules.map((r) => r.cwe || r.id).concat([
    'CVE-2021-44228', // Log4Shell
    'CVE-2021-23337', // Lodash command injection
    'CVE-2022-22965', // Spring4Shell
    'CVE-2023-38606', // Apple WebKit
    'CVE-2023-4863',  // libwebp
    'CVE-2024-3094',  // XZ Utils backdoor
  ])
);

export async function isCveInKevCatalog(cveId: string): Promise<boolean> {
  if (KNOWN_KEV_CVES.has(cveId)) return true;

  // Tentative de vérification en ligne via l'API CISA officielle (best effort)
  try {
    const res = await fetch(`https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.vulnerabilities)) {
        const found = data.vulnerabilities.some((v: any) => v.cveID === cveId);
        if (found) KNOWN_KEV_CVES.add(cveId);
        return found;
      }
    }
  } catch {
    // Fallback silencieux vers la liste locale
  }

  return false;
}
