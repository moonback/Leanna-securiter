/**
 * NvdClient — Client pour l'API NVD (National Vulnerability Database) du NIST.
 * https://nvd.nist.gov/developers/vulnerabilities
 *
 * Nécessite une clé API (NVD_API_KEY) pour des limites de taux élevées.
 * Sans clé : 5 req/30s. Avec clé : 50 req/30s.
 */

export interface NvdCvssV3 {
  source: string;
  type: string;
  cvssData: {
    version: string;
    vectorString: string;
    attackVector: string;
    attackComplexity: string;
    privilegesRequired: string;
    userInteraction: string;
    scope: string;
    confidentialityImpact: string;
    integrityImpact: string;
    availabilityImpact: string;
    baseScore: number;
    baseSeverity: string;
  };
  exploitabilityScore: number;
  impactScore: number;
}

export interface NvdVulnerability {
  id: string;
  sourceIdentifier?: string;
  published: string;
  lastModified: string;
  vulnStatus: string;
  descriptions: Array<{ lang: string; value: string }>;
  metrics?: {
    cvssMetricV31?: NvdCvssV3[];
    cvssMetricV30?: NvdCvssV3[];
    cvssMetricV2?: Array<{ source: string; type: string; cvssData: { baseScore: number; vectorString: string } }>;
  };
  weaknesses?: Array<{ source: string; type: string; description: Array<{ lang: string; value: string }> }>;
  configurations?: unknown[];
  references?: Array<{ url: string; source: string; tags?: string[] }>;
}

export interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  format: string;
  version: string;
  timestamp: string;
  vulnerabilities: Array<{ cve: NvdVulnerability }>;
}

const NVD_API_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const NVD_API_KEY = process.env.NVD_API_KEY;

function nvdHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (NVD_API_KEY) headers["apiKey"] = NVD_API_KEY;
  return headers;
}

/**
 * Récupère les détails NVD d'une CVE par son ID.
 */
export async function getNvdCveById(cveId: string): Promise<NvdVulnerability | null> {
  try {
    const url = `${NVD_API_BASE}?cveId=${encodeURIComponent(cveId)}`;
    const res = await fetch(url, {
      headers: nvdHeaders(),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.warn(`[NvdClient] HTTP ${res.status} pour ${cveId}`);
      return null;
    }

    const data = (await res.json()) as NvdResponse;
    if (!data.vulnerabilities || data.vulnerabilities.length === 0) return null;
    return data.vulnerabilities[0].cve ?? null;
  } catch (err) {
    console.warn(`[NvdClient] Erreur réseau pour ${cveId}:`, err);
    return null;
  }
}

/**
 * Recherche des CVEs NVD modifiées depuis une date donnée.
 * Utile pour les mises à jour incrémentales de la base.
 */
export async function getNvdCvesSince(
  lastModifiedStart: Date,
  maxResults: number = 100
): Promise<NvdVulnerability[]> {
  try {
    const startDate = lastModifiedStart.toISOString().replace("Z", "+00:00");
    const endDate = new Date().toISOString().replace("Z", "+00:00");
    const url = `${NVD_API_BASE}?lastModStartDate=${encodeURIComponent(startDate)}&lastModEndDate=${encodeURIComponent(endDate)}&resultsPerPage=${maxResults}`;

    const res = await fetch(url, {
      headers: nvdHeaders(),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.warn(`[NvdClient] HTTP ${res.status} pour requête de mises à jour`);
      return [];
    }

    const data = (await res.json()) as NvdResponse;
    return (data.vulnerabilities ?? []).map((v) => v.cve);
  } catch (err) {
    console.warn("[NvdClient] Erreur réseau pour mises à jour:", err);
    return [];
  }
}

/**
 * Extrait le score CVSS v3.1 (ou v3.0) d'une vulnérabilité NVD.
 * Retourne null si aucun score n'est disponible.
 */
export function extractCvssV3Score(vuln: NvdVulnerability): {
  score: number;
  severity: string;
  vector: string;
} | null {
  const metrics = vuln.metrics?.cvssMetricV31 ?? vuln.metrics?.cvssMetricV30;
  if (!metrics || metrics.length === 0) return null;

  const primary = metrics.find((m) => m.type === "Primary") ?? metrics[0];
  if (!primary) return null;

  return {
    score: primary.cvssData.baseScore,
    severity: primary.cvssData.baseSeverity,
    vector: primary.cvssData.vectorString,
  };
}

/**
 * Extrait les CWE de la faiblesse principale d'une vulnérabilité NVD.
 */
export function extractCweIds(vuln: NvdVulnerability): string[] {
  if (!vuln.weaknesses) return [];
  const cweSet = new Set<string>();
  for (const weakness of vuln.weaknesses) {
    for (const desc of weakness.description) {
      if (desc.value && desc.value.startsWith("CWE-")) {
        cweSet.add(desc.value);
      }
    }
  }
  return Array.from(cweSet);
}
