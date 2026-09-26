/**
 * GithubAdvisoryClient — Client pour l'API GitHub Security Advisories (GHSA).
 * https://docs.github.com/en/rest/security-advisories
 *
 * Complète OSV/NVD avec les advisories spécifiques à l'écosystème npm/GitHub.
 * Nécessite optionnellement un token GitHub (GITHUB_TOKEN) pour des limites de taux élevées.
 */

export interface GhsaVulnerability {
  package: { ecosystem: string; name: string };
  severity: string;
  vulnerableVersionRange: string;
  firstPatchedVersion?: { identifier: string };
}

export interface GhsaAdvisory {
  ghsaId: string;
  cveId?: string;
  summary: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  publishedAt: string;
  updatedAt: string;
  withdrawnAt?: string;
  vulnerabilities: GhsaVulnerability[];
  cvss?: { score: number; vectorString: string };
  cwes?: Array<{ cweId: string; name: string }>;
  references: string[];
  identifiers: Array<{ type: string; value: string }>;
  url: string;
}

export interface GhsaSearchResult {
  data: {
    securityAdvisories: {
      nodes: GhsaAdvisory[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  };
}

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/vnd.github+json",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

const GHSA_QUERY = `
query SearchAdvisories($ecosystem: SecurityAdvisoryEcosystem, $packageName: String, $first: Int) {
  securityAdvisories(ecosystem: $ecosystem, package: $packageName, first: $first) {
    nodes {
      ghsaId
      summary
      description
      severity
      publishedAt
      updatedAt
      withdrawnAt
      vulnerabilities(first: 5) {
        nodes {
          package { ecosystem name }
          severity
          vulnerableVersionRange
          firstPatchedVersion { identifier }
        }
      }
      cvss { score vectorString }
      cwes(first: 5) { nodes { cweId name } }
      references { url }
      identifiers { type value }
      permalink
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

/**
 * Recherche les advisories GitHub pour un paquet npm donné.
 */
export async function queryGhsaByPackage(
  packageName: string,
  ecosystem: string = "NPM",
  maxResults: number = 10
): Promise<GhsaAdvisory[]> {
  if (!GITHUB_TOKEN) {
    console.debug("[GhsaClient] Pas de GITHUB_TOKEN, requête anonyme limitée à 60/h");
  }

  try {
    const res = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: githubHeaders(),
      body: JSON.stringify({
        query: GHSA_QUERY,
        variables: {
          ecosystem: ecosystem.toUpperCase(),
          packageName,
          first: maxResults,
        },
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.warn(`[GhsaClient] HTTP ${res.status} pour ${packageName}`);
      return [];
    }

    const data = (await res.json()) as {
      data?: {
        securityAdvisories?: {
          nodes?: unknown[];
        };
      };
    };
    const nodes = data?.data?.securityAdvisories?.nodes ?? [];

    // Normaliser les nœuds (GraphQL a des sous-objets `nodes` pour les listes)
    return nodes.map((n: unknown) => normalizeGhsaNode(n as Record<string, unknown>));
  } catch (err) {
    console.warn(`[GhsaClient] Erreur réseau pour ${packageName}:`, err);
    return [];
  }
}

function normalizeGhsaNode(node: Record<string, unknown>): GhsaAdvisory {
  const vulnNodes =
    (node.vulnerabilities as { nodes?: unknown[] })?.nodes ?? [];
  const cweNodes =
    (node.cwes as { nodes?: unknown[] })?.nodes ?? [];
  const refNodes =
    (node.references as Array<{ url?: string }>) ?? [];

  return {
    ghsaId: (node.ghsaId as string) ?? "",
    cveId: undefined,
    summary: (node.summary as string) ?? "",
    description: (node.description as string) ?? "",
    severity: ((node.severity as string)?.toLowerCase() as GhsaAdvisory["severity"]) ?? "unknown",
    publishedAt: (node.publishedAt as string) ?? "",
    updatedAt: (node.updatedAt as string) ?? "",
    withdrawnAt: (node.withdrawnAt as string | undefined),
    vulnerabilities: vulnNodes.map((v: unknown) => {
      const vuln = v as Record<string, unknown>;
      const pkg = vuln.package as { ecosystem?: string; name?: string } | undefined;
      const fpv = vuln.firstPatchedVersion as { identifier?: string } | undefined;
      return {
        package: { ecosystem: pkg?.ecosystem ?? "", name: pkg?.name ?? "" },
        severity: (vuln.severity as string) ?? "",
        vulnerableVersionRange: (vuln.vulnerableVersionRange as string) ?? "",
        firstPatchedVersion: fpv?.identifier ? { identifier: fpv.identifier } : undefined,
      };
    }),
    cvss: (node.cvss as { score: number; vectorString: string } | undefined),
    cwes: cweNodes.map((c: unknown) => {
      const cwe = c as { cweId?: string; name?: string };
      return { cweId: cwe.cweId ?? "", name: cwe.name ?? "" };
    }),
    references: refNodes.map((r) => r.url ?? "").filter(Boolean),
    identifiers: (node.identifiers as Array<{ type: string; value: string }>) ?? [],
    url: (node.permalink as string) ?? "",
  };
}

/**
 * Récupère une advisory GHSA par son identifiant GHSA-xxx-yyy-zzz.
 */
export async function getGhsaById(ghsaId: string): Promise<GhsaAdvisory | null> {
  try {
    const query = `
      query GetAdvisory($ghsaId: String!) {
        securityAdvisory(ghsaId: $ghsaId) {
          ghsaId summary description severity publishedAt updatedAt
          cvss { score vectorString }
          cwes(first: 5) { nodes { cweId name } }
          references { url }
          identifiers { type value }
          permalink
          vulnerabilities(first: 10) {
            nodes {
              package { ecosystem name }
              severity vulnerableVersionRange
              firstPatchedVersion { identifier }
            }
          }
        }
      }
    `;

    const res = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: githubHeaders(),
      body: JSON.stringify({ query, variables: { ghsaId } }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { securityAdvisory?: Record<string, unknown> } };
    const node = data?.data?.securityAdvisory;
    if (!node) return null;
    return normalizeGhsaNode(node);
  } catch {
    return null;
  }
}
