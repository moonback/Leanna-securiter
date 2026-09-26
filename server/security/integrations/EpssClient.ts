/**
 * EpssClient — Client pour l'API EPSS (Exploit Prediction Scoring System).
 * https://www.first.org/epss/api
 *
 * EPSS fournit une probabilité (0–1) qu'une CVE soit exploitée dans les 30 prochains jours.
 * Combiné au CVSS, il permet une priorisation réaliste des vulnérabilités.
 */

export interface EpssEntry {
  cve: string;
  epss: number;       // 0.0 → 1.0
  percentile: number; // 0.0 → 1.0
  date: string;       // YYYY-MM-DD
}

export interface EpssResponse {
  status: string;
  status_code: number;
  version: string;
  access: string;
  total: number;
  offset: number;
  limit: number;
  data: EpssEntry[];
}

const EPSS_API_BASE = process.env.EPSS_API_URL ?? "https://api.first.org/data/v1";

/**
 * Récupère le score EPSS pour une CVE donnée.
 * Retourne null si la CVE n'est pas dans la base EPSS (< 2021 ou non CVE).
 */
export async function getEpssScore(cveId: string): Promise<EpssEntry | null> {
  try {
    const url = `${EPSS_API_BASE}/epss?cve=${encodeURIComponent(cveId)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.warn(`[EpssClient] HTTP ${res.status} pour ${cveId}`);
      return null;
    }

    const data = (await res.json()) as EpssResponse;
    if (!data.data || data.data.length === 0) return null;
    return data.data[0] ?? null;
  } catch (err) {
    console.warn(`[EpssClient] Erreur réseau pour ${cveId}:`, err);
    return null;
  }
}

/**
 * Récupère les scores EPSS pour plusieurs CVEs en une seule requête.
 * L'API EPSS accepte des listes séparées par virgule.
 */
export async function getEpssScoresBatch(
  cveIds: string[]
): Promise<Map<string, EpssEntry>> {
  const scoreMap = new Map<string, EpssEntry>();
  if (cveIds.length === 0) return scoreMap;

  // EPSS accepte max ~500 CVEs par requête
  const CHUNK_SIZE = 400;
  const chunks: string[][] = [];
  for (let i = 0; i < cveIds.length; i += CHUNK_SIZE) {
    chunks.push(cveIds.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const url = `${EPSS_API_BASE}/epss?cve=${chunk.join(",")}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[EpssClient] Batch HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json()) as EpssResponse;
      for (const entry of data.data ?? []) {
        scoreMap.set(entry.cve, entry);
      }
    } catch (err) {
      console.warn("[EpssClient] Erreur batch EPSS:", err);
    }
  }

  return scoreMap;
}

/**
 * Classe un score EPSS en label de priorité humain.
 */
export function classifyEpss(epssScore: number): {
  label: "critical" | "high" | "medium" | "low";
  description: string;
} {
  if (epssScore >= 0.5) {
    return { label: "critical", description: "Exploitation très probable (>50%)" };
  }
  if (epssScore >= 0.1) {
    return { label: "high", description: "Exploitation probable (10–50%)" };
  }
  if (epssScore >= 0.01) {
    return { label: "medium", description: "Exploitation possible (1–10%)" };
  }
  return { label: "low", description: "Exploitation improbable (<1%)" };
}
