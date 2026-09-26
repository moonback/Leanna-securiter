/**
 * DependencyScanner — Analyse des dépendances open source (SCA).
 *
 * Pipeline d'enrichissement en 4 phases :
 *  1. Lecture de package.json → liste de (nom, version)
 *  2. OSV.dev batch query → CVEs par paquet (gratuit, sans clé)
 *  3. EPSS batch query → scores d'exploitabilité pour chaque CVE trouvé
 *  4. NVD query → scores CVSS réels (si NVD_API_KEY configuré)
 *
 * En cas d'indisponibilité réseau, on retombe sur la base locale KNOWN_VULNS
 * pour garantir un résultat offline déterministe.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Finding, FindingSeverity } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";
import type { SbomComponent } from "../reporting/SbomBuilder.js";
import { calculateSeverityTier } from "../findings/SeverityScorer.js";
import { queryOsvBatch, type OsvVulnerability } from "../integrations/OsvClient.js";
import { getEpssScoresBatch } from "../integrations/EpssClient.js";
import { getNvdCveById, extractCvssV3Score, extractCweIds } from "../integrations/NvdClient.js";

// ─── Base locale de CVEs connues (fallback offline) ────────────────────────────

interface KnownVulnerability {
  cve: string;
  pkg: string;
  affectedRange: string;
  patchedVersion: string;
  title: string;
  severity: FindingSeverity;
  cvssScore: number;
  epssScore: number;
  cisaKev: boolean;
  cwe: string[];
  owasp: string[];
  description: string;
  remediation: string;
}

const KNOWN_VULNS: KnownVulnerability[] = [
  {
    cve: "CVE-2021-23337",
    pkg: "lodash",
    affectedRange: "<4.17.21",
    patchedVersion: "4.17.21",
    title: "Command Injection dans lodash.template",
    severity: "high",
    cvssScore: 7.2,
    epssScore: 0.85,
    cisaKev: false,
    cwe: ["CWE-78", "CWE-94"],
    owasp: ["A03:2021-Injection"],
    description:
      "Une injection de commande est possible via la fonction template de lodash lorsque des variables non fiables sont utilisées.",
    remediation: "Mettez à jour lodash vers la version 4.17.21 ou supérieure.",
  },
  {
    cve: "CVE-2020-8203",
    pkg: "lodash",
    affectedRange: "<4.17.19",
    patchedVersion: "4.17.19",
    title: "Prototype Pollution dans lodash (zipObjectDeep)",
    severity: "high",
    cvssScore: 7.4,
    epssScore: 0.72,
    cisaKev: false,
    cwe: ["CWE-1321"],
    owasp: ["A03:2021-Injection"],
    description:
      "Pollution de prototype globale permettant la modification des propriétés d'Object.prototype.",
    remediation: "Mettez à jour lodash vers 4.17.19+.",
  },
  {
    cve: "CVE-2023-45857",
    pkg: "axios",
    affectedRange: "<1.6.0",
    patchedVersion: "1.6.0",
    title: "Cross-Site Request Forgery / Data Leak via redirect",
    severity: "medium",
    cvssScore: 6.5,
    epssScore: 0.15,
    cisaKev: false,
    cwe: ["CWE-200"],
    owasp: ["A01:2021-Broken Access Control"],
    description:
      "Axios transmettait les headers Authorization lors de redirections inter-domaines.",
    remediation: "Mettez à jour axios vers 1.6.0 ou supérieure.",
  },
  {
    cve: "CVE-2024-21538",
    pkg: "cross-spawn",
    affectedRange: "<7.0.5",
    patchedVersion: "7.0.5",
    title: "Command Injection sur Windows via arguments non assainis",
    severity: "critical",
    cvssScore: 9.8,
    epssScore: 0.92,
    cisaKev: true,
    cwe: ["CWE-78"],
    owasp: ["A03:2021-Injection"],
    description:
      "Exécution arbitraire de commandes sur Windows via cmd.exe sans échappement adéquat.",
    remediation: "Mettez à jour cross-spawn vers la version 7.0.5.",
  },
  {
    cve: "CVE-2022-25883",
    pkg: "semver",
    affectedRange: "<7.5.2",
    patchedVersion: "7.5.2",
    title: "Regular Expression Denial of Service (ReDoS)",
    severity: "high",
    cvssScore: 7.5,
    epssScore: 0.35,
    cisaKev: false,
    cwe: ["CWE-1333"],
    owasp: ["A06:2021-Vulnerable and Outdated Components"],
    description:
      "Une chaîne de version spécialement conçue peut entraîner un déni de service par épuisement CPU.",
    remediation: "Mettez à jour semver vers la version 7.5.2 ou plus récente.",
  },
  {
    cve: "CVE-2019-10744",
    pkg: "lodash",
    affectedRange: "<4.17.12",
    patchedVersion: "4.17.12",
    title: "Prototype Pollution via defaultsDeep",
    severity: "critical",
    cvssScore: 9.1,
    epssScore: 0.89,
    cisaKev: false,
    cwe: ["CWE-1321"],
    owasp: ["A03:2021-Injection"],
    description:
      "Pollution de prototype via defaultsDeep permettant la modification de propriétés système.",
    remediation: "Mettez à jour lodash vers 4.17.12+.",
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isVersionAffected(installed: string, range: string): boolean {
  const cleanInst = installed.replace(/^[~^>=<v]+/, "").trim();
  const cleanTarget = range.replace(/^[~^>=<v]+/, "").trim();
  const partsInst = cleanInst.split(".").map((n) => parseInt(n, 10) || 0);
  const partsTarget = cleanTarget.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = partsInst[i] ?? 0;
    const b = partsTarget[i] ?? 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

/**
 * Extrait les CVE IDs (ex: "CVE-2021-44228") depuis les alias d'une vulnérabilité OSV.
 */
function extractCveIds(vuln: OsvVulnerability): string[] {
  const cveIds: string[] = [];
  if (vuln.id.startsWith("CVE-")) cveIds.push(vuln.id);
  for (const alias of vuln.aliases ?? []) {
    if (alias.startsWith("CVE-")) cveIds.push(alias);
  }
  return [...new Set(cveIds)];
}

/**
 * Extrait la version fixée la plus récente depuis les plages OSV affectées.
 */
function extractFixedVersion(vuln: OsvVulnerability, pkgName: string): string {
  for (const affected of vuln.affected ?? []) {
    if (affected?.package?.name?.toLowerCase() === pkgName.toLowerCase()) {
      for (const range of affected.ranges ?? []) {
        for (const event of range.events ?? []) {
          if (event.fixed) return event.fixed;
        }
      }
    }
  }
  return "inconnue";
}

/**
 * Mappe un score CVSS brut en `FindingSeverity` (ou se rabat sur le label OSV).
 */
function osvSeverityToFinding(
  osvSeverity: OsvVulnerability["severity"],
  cvssScore: number | null
): FindingSeverity {
  if (cvssScore !== null) return calculateSeverityTier(cvssScore);

  // Fallback sur le texte de sévérité OSV
  const label = (osvSeverity?.[0]?.score ?? "").toUpperCase();
  if (label.startsWith("CRITICAL") || Number(label) >= 9) return "critical";
  if (label.startsWith("HIGH") || Number(label) >= 7) return "high";
  if (label.startsWith("MEDIUM") || Number(label) >= 4) return "medium";
  if (label.startsWith("LOW") || Number(label) > 0) return "low";
  return "medium";
}

// ─── Types publics ─────────────────────────────────────────────────────────────

export interface DependencyScanResult {
  findings: Finding[];
  components: SbomComponent[];
  onlineEnrichment: boolean; // true si OSV/EPSS ont pu être interrogés
}

// ─── Pipeline principal ────────────────────────────────────────────────────────

export async function scanDependencies(
  projectRoot: string
): Promise<DependencyScanResult> {
  const findings: Finding[] = [];
  const components: SbomComponent[] = [];

  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return { findings, components, onlineEnrichment: false };
  }

  // ── 1. Lecture du package.json ──────────────────────────────────────────────
  let deps: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch (err) {
    console.error("[DependencyScanner] Erreur lecture package.json:", err);
    return { findings, components, onlineEnrichment: false };
  }

  const depEntries = Object.entries(deps).map(([name, versionSpec]) => ({
    name,
    versionSpec,
    cleanVer: String(versionSpec).replace(/^[~^>=<v]+/, ""),
  }));

  // ── 2. OSV.dev — batch query (online) ──────────────────────────────────────
  let osvResults = new Map<string, OsvVulnerability[]>();
  let onlineEnrichment = false;

  try {
    const queries = depEntries.map((d) => ({
      name: d.name,
      version: d.cleanVer,
      ecosystem: "npm",
    }));
    osvResults = await queryOsvBatch(queries);
    onlineEnrichment = true;
    console.info(`[DependencyScanner] OSV: ${osvResults.size} paquets interrogés`);
  } catch (err) {
    console.warn("[DependencyScanner] OSV indisponible, fallback offline:", err);
  }

  // ── 3. Collecter tous les CVE IDs trouvés → EPSS batch ─────────────────────
  const allCveIds = new Set<string>();
  for (const vulns of osvResults.values()) {
    for (const v of vulns) {
      for (const cveId of extractCveIds(v)) {
        allCveIds.add(cveId);
      }
    }
  }

  // Cache EPSS par CVE ID
  let epssCache = new Map<string, number>(); // cveId → epssScore (0–1)
  if (allCveIds.size > 0) {
    try {
      const epssMap = await getEpssScoresBatch(Array.from(allCveIds));
      for (const [cveId, entry] of epssMap) {
        epssCache.set(cveId, entry.epss);
      }
      console.info(`[DependencyScanner] EPSS: ${epssCache.size}/${allCveIds.size} CVEs enrichis`);
    } catch (err) {
      console.warn("[DependencyScanner] EPSS indisponible:", err);
    }
  }

  // ── 4. Construire les findings ──────────────────────────────────────────────
  // On garde une map fingerprint → true pour dédupliquer
  const seenFingerprints = new Set<string>();

  for (const dep of depEntries) {
    const { name, versionSpec, cleanVer } = dep;

    const comp: SbomComponent = {
      name,
      version: cleanVer,
      type: "library",
      purl: `pkg:npm/${name}@${cleanVer}`,
    };

    const key = `${name}@${cleanVer}`;
    const osvVulns = osvResults.get(key) ?? [];

    // ── 4a. Findings depuis OSV (online) ─────────────────────────────────────
    for (const vuln of osvVulns) {
      const cveIds = extractCveIds(vuln);
      const primaryCve = cveIds[0] ?? vuln.id;
      const fixedVersion = extractFixedVersion(vuln, name);

      // Enrichissement NVD pour le score CVSS réel (best-effort, limité à 1 appel/vuln)
      let cvssScore: number | null = null;
      let cvssVector: string | undefined;
      let nvdCwe: string[] = [];

      if (process.env.NVD_API_KEY && primaryCve.startsWith("CVE-")) {
        try {
          const nvd = await getNvdCveById(primaryCve);
          if (nvd) {
            const cvssInfo = extractCvssV3Score(nvd);
            if (cvssInfo) {
              cvssScore = cvssInfo.score;
              cvssVector = cvssInfo.vector;
            }
            nvdCwe = extractCweIds(nvd);
          }
        } catch {
          // NVD non disponible — on continue sans CVSS réel
        }
      }

      const epssScore = epssCache.get(primaryCve);
      const severity = osvSeverityToFinding(vuln.severity, cvssScore);

      const fingerprint = computeFingerprint({
        filePath: "package.json",
        ruleId: primaryCve,
        snippet: `"${name}": "${versionSpec}"`,
      });

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const title = vuln.summary?.slice(0, 120) || `${primaryCve} — ${name}@${cleanVer}`;
      const patchedInfo =
        fixedVersion !== "inconnue" ? `Mettez à jour ${name} vers ${fixedVersion}+.` : `Mettez à jour ${name} vers la dernière version.`;

      findings.push({
        id: crypto.randomUUID(),
        fingerprint,
        ruleId: primaryCve,
        ruleName: `${primaryCve} — ${name}`,
        title: `Dépendance vulnérable : ${name}@${cleanVer} (${primaryCve})`,
        description: vuln.details ?? title,
        severity,
        status: "open",
        scanner: "sca",
        cwe: nvdCwe.length > 0 ? nvdCwe : [],
        owasp: ["A06:2021-Vulnerable and Outdated Components"],
        location: {
          filePath: "package.json",
          startLine: 1,
          snippet: `"${name}": "${versionSpec}"`,
        },
        cvssScore: cvssScore ?? 5.0,
        cvssVector,
        epssScore,
        cisaKev: false, // enrichi via CisaKev si disponible
        impact: `La vulnérabilité ${primaryCve} dans ${name} peut compromettre l'application hôte.`,
        remediation: patchedInfo,
        references: [
          `https://osv.dev/vulnerability/${vuln.id}`,
          ...(primaryCve !== vuln.id ? [`https://nvd.nist.gov/vuln/detail/${primaryCve}`] : []),
          ...(vuln.references?.map((r) => r.url) ?? []).slice(0, 3),
        ],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        metadata: {
          osvId: vuln.id,
          aliases: vuln.aliases ?? [],
          fixedVersion,
          publishedAt: vuln.published,
        },
      });

      if (!comp.vulnerabilities) comp.vulnerabilities = [];
      comp.vulnerabilities.push({
        id: primaryCve,
        severity,
        description: title,
      });
    }

    // ── 4b. Fallback offline si OSV n'a rien trouvé OU pas disponible ────────
    if (!onlineEnrichment || osvVulns.length === 0) {
      for (const vuln of KNOWN_VULNS) {
        if (vuln.pkg.toLowerCase() !== name.toLowerCase()) continue;
        if (!isVersionAffected(cleanVer, vuln.affectedRange)) continue;

        const fingerprint = computeFingerprint({
          filePath: "package.json",
          ruleId: vuln.cve,
          snippet: `"${name}": "${versionSpec}"`,
        });

        if (seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);

        // Enrichissement EPSS offline (si batch a quand même fonctionné)
        const liveEpss = epssCache.get(vuln.cve);

        findings.push({
          id: crypto.randomUUID(),
          fingerprint,
          ruleId: vuln.cve,
          ruleName: `${vuln.cve} — ${vuln.title}`,
          title: `Dépendance vulnérable : ${name}@${cleanVer} (${vuln.cve})`,
          description: vuln.description,
          severity: vuln.severity,
          status: "open",
          scanner: "sca",
          cwe: vuln.cwe,
          owasp: vuln.owasp,
          location: {
            filePath: "package.json",
            startLine: 1,
            snippet: `"${name}": "${versionSpec}"`,
          },
          cvssScore: vuln.cvssScore,
          epssScore: liveEpss ?? vuln.epssScore,
          cisaKev: vuln.cisaKev,
          impact: `Une faille connue dans ${name} peut compromettre l'application hôte.`,
          remediation: vuln.remediation,
          references: [
            `https://nvd.nist.gov/vuln/detail/${vuln.cve}`,
            `https://osv.dev/vulnerability/${vuln.cve}`,
          ],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          metadata: { source: "offline-db" },
        });

        if (!comp.vulnerabilities) comp.vulnerabilities = [];
        comp.vulnerabilities.push({
          id: vuln.cve,
          severity: vuln.severity,
          description: vuln.title,
        });
      }
    }

    components.push(comp);
  }

  const totalVulnDeps = components.filter((c) => (c.vulnerabilities?.length ?? 0) > 0).length;
  console.info(
    `[DependencyScanner] ${findings.length} finding(s) SCA · ${totalVulnDeps}/${components.length} paquets vulnérables · enrichissement online: ${onlineEnrichment}`
  );

  return { findings, components, onlineEnrichment };
}
