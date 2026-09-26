/**
 * OsvClient — Client pour l'API OSV.dev (Open Source Vulnerability database).
 * https://osv.dev/docs/
 *
 * Fournit une interface pour :
 * - Requêter les CVE par nom de paquet et version (query)
 * - Requêter par hash de commit
 * - Récupérer les détails d'une vulnérabilité par ID
 */

export interface OsvVulnerability {
  id: string;
  summary: string;
  details: string;
  severity?: Array<{ type: string; score: string }>;
  affected: Array<{
    package: { name: string; ecosystem: string; purl?: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
    versions?: string[];
  }>;
  references?: Array<{ type: string; url: string }>;
  aliases?: string[];
  published?: string;
  modified?: string;
  database_specific?: Record<string, unknown>;
}

export interface OsvQueryResult {
  vulns?: OsvVulnerability[];
}

const OSV_API_BASE = process.env.OSV_API_URL ?? "https://api.osv.dev/v1";

/**
 * Interroge OSV pour trouver des vulnérabilités pour un paquet/version donné.
 */
export async function queryOsvByPackage(
  name: string,
  version: string,
  ecosystem: string = "npm"
): Promise<OsvVulnerability[]> {
  try {
    const body = {
      version,
      package: { name, ecosystem },
    };

    const res = await fetch(`${OSV_API_BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[OsvClient] HTTP ${res.status} pour ${name}@${version}`);
      return [];
    }

    const data = (await res.json()) as OsvQueryResult;
    return data.vulns ?? [];
  } catch (err) {
    console.warn(`[OsvClient] Erreur réseau pour ${name}@${version}:`, err);
    return [];
  }
}

/**
 * Récupère les détails complets d'une vulnérabilité OSV par ID.
 */
export async function getOsvById(id: string): Promise<OsvVulnerability | null> {
  try {
    const res = await fetch(`${OSV_API_BASE}/vulns/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[OsvClient] Vulnérabilité introuvable: ${id}`);
      return null;
    }

    return (await res.json()) as OsvVulnerability;
  } catch (err) {
    console.warn(`[OsvClient] Erreur réseau pour ${id}:`, err);
    return null;
  }
}

/**
 * Interroge OSV par liste de paquets (batch).
 * Limite à 1000 requêtes par lot (contrainte OSV API).
 */
export async function queryOsvBatch(
  queries: Array<{ name: string; version: string; ecosystem?: string }>
): Promise<Map<string, OsvVulnerability[]>> {
  const results = new Map<string, OsvVulnerability[]>();

  // OSV batch endpoint
  try {
    const body = {
      queries: queries.slice(0, 1000).map((q) => ({
        version: q.version,
        package: { name: q.name, ecosystem: q.ecosystem ?? "npm" },
      })),
    };

    const res = await fetch(`${OSV_API_BASE}/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[OsvClient] Batch HTTP ${res.status}`);
      return results;
    }

    const data = (await res.json()) as { results?: OsvQueryResult[] };
    const batchResults = data.results ?? [];

    batchResults.forEach((r, i) => {
      const q = queries[i];
      const key = `${q.name}@${q.version}`;
      results.set(key, r.vulns ?? []);
    });
  } catch (err) {
    console.warn("[OsvClient] Erreur batch:", err);
  }

  return results;
}
