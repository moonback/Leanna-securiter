import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Finding } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";
import type { SbomComponent } from "../reporting/SbomBuilder.js";

interface KnownVulnerability {
  cve: string;
  pkg: string;
  affectedRange: string;
  patchedVersion: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cvssScore: number;
  epssScore: number;
  cisaKev: boolean;
  cwe: string[];
  owasp: string[];
  description: string;
  remediation: string;
}

// Base locale de CVEs connues pour audit offline rapide & déterministe
const KNOWN_VULNS: KnownVulnerability[] = [
  {
    cve: 'CVE-2021-23337',
    pkg: 'lodash',
    affectedRange: '<4.17.21',
    patchedVersion: '4.17.21',
    title: 'Command Injection dans lodash.template',
    severity: 'high',
    cvssScore: 7.2,
    epssScore: 0.85,
    cisaKev: false,
    cwe: ['CWE-78', 'CWE-94'],
    owasp: ['A03:2021-Injection'],
    description: 'Une injection de commande est possible via la fonction template de lodash lorsque des variables non fiables sont utilisées.',
    remediation: 'Mettez à jour lodash vers la version 4.17.21 ou supérieure.',
  },
  {
    cve: 'CVE-2020-8203',
    pkg: 'lodash',
    affectedRange: '<4.17.19',
    patchedVersion: '4.17.19',
    title: 'Prototype Pollution dans lodash (zipObjectDeep)',
    severity: 'high',
    cvssScore: 7.4,
    epssScore: 0.72,
    cisaKev: false,
    cwe: ['CWE-1321'],
    owasp: ['A03:2021-Injection'],
    description: 'Pollution de prototype globale permettant la modification des propriétés d\'Object.prototype.',
    remediation: 'Mettez à jour lodash vers 4.17.19+.',
  },
  {
    cve: 'CVE-2023-45857',
    pkg: 'axios',
    affectedRange: '<1.6.0',
    patchedVersion: '1.6.0',
    title: 'Cross-Site Request Forgery / Data Leak via redirect',
    severity: 'medium',
    cvssScore: 6.5,
    epssScore: 0.15,
    cisaKev: false,
    cwe: ['CWE-200'],
    owasp: ['A01:2021-Broken Access Control'],
    description: 'Axios transmettait les headers Authorization lors de redirections inter-domaines.',
    remediation: 'Mettez à jour axios vers 1.6.0 ou supérieure.',
  },
  {
    cve: 'CVE-2024-21538',
    pkg: 'cross-spawn',
    affectedRange: '<7.0.5',
    patchedVersion: '7.0.5',
    title: 'Command Injection sur Windows via arguments non assainis',
    severity: 'critical',
    cvssScore: 9.8,
    epssScore: 0.92,
    cisaKev: true,
    cwe: ['CWE-78'],
    owasp: ['A03:2021-Injection'],
    description: 'Exécution arbitraire de commandes sur Windows via cmd.exe sans échappement adéquat.',
    remediation: 'Mettez à jour cross-spawn vers la version 7.0.5.',
  },
  {
    cve: 'CVE-2022-25883',
    pkg: 'semver',
    affectedRange: '<7.5.2',
    patchedVersion: '7.5.2',
    title: 'Regular Expression Denial of Service (ReDoS)',
    severity: 'high',
    cvssScore: 7.5,
    epssScore: 0.35,
    cisaKev: false,
    cwe: ['CWE-1333'],
    owasp: ['A06:2021-Vulnerable and Outdated Components'],
    description: 'Une chaîne de version spécialement conçue peut entraîner un déni de service par épuisement CPU.',
    remediation: 'Mettez à jour semver vers la version 7.5.2 ou plus récente.',
  },
];

function isVersionAffected(installed: string, range: string): boolean {
  const cleanInst = installed.replace(/^[~^>=<v]+/, '').trim();
  const cleanTarget = range.replace(/^[~^>=<v]+/, '').trim();

  // Comparaison sémantique simple major.minor.patch
  const partsInst = cleanInst.split('.').map((n) => parseInt(n, 10) || 0);
  const partsTarget = cleanTarget.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const a = partsInst[i] ?? 0;
    const b = partsTarget[i] ?? 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

export interface DependencyScanResult {
  findings: Finding[];
  components: SbomComponent[];
}

export async function scanDependencies(projectRoot: string): Promise<DependencyScanResult> {
  const findings: Finding[] = [];
  const components: SbomComponent[] = [];

  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return { findings, components };
  }

  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(raw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    for (const [name, versionSpec] of Object.entries(deps)) {
      const versionStr = String(versionSpec);
      const cleanVer = versionStr.replace(/^[~^>=<v]+/, '');

      const comp: SbomComponent = {
        name,
        version: cleanVer,
        type: 'library',
        purl: `pkg:npm/${name}@${cleanVer}`,
      };

      // Vérifier les vulnérabilités connues
      for (const vuln of KNOWN_VULNS) {
        if (vuln.pkg.toLowerCase() === name.toLowerCase()) {
          if (isVersionAffected(cleanVer, vuln.affectedRange)) {
            const findingId = crypto.randomUUID();
            const fingerprint = computeFingerprint({
              filePath: "package.json",
              ruleId: vuln.cve,
              snippet: `"${name}": "${versionStr}"`,
            });

            findings.push({
              id: findingId,
              fingerprint,
              ruleId: vuln.cve,
              ruleName: `${vuln.cve} - ${vuln.title}`,
              title: `Dépendance vulnérable : ${name}@${cleanVer} (${vuln.cve})`,
              description: vuln.description,
              severity: vuln.severity,
              status: 'open',
              scanner: 'sca',
              cwe: vuln.cwe,
              owasp: vuln.owasp,
              location: {
                filePath: "package.json",
                startLine: 1,
                snippet: `"${name}": "${versionStr}"`,
              },
              cvssScore: vuln.cvssScore,
              epssScore: vuln.epssScore,
              cisaKev: vuln.cisaKev,
              impact: `Une faille connue dans ${name} peut compromettre l\'application hôte ou les conteneurs associés.`,
              remediation: vuln.remediation,
              references: [`https://nvd.nist.gov/vuln/detail/${vuln.cve}`, `https://osv.dev/vulnerability/${vuln.cve}`],
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
            });

            if (!comp.vulnerabilities) comp.vulnerabilities = [];
            comp.vulnerabilities.push({
              id: vuln.cve,
              severity: vuln.severity,
              description: vuln.title,
            });
          }
        }
      }

      components.push(comp);
    }
  } catch (err) {
    console.error("[DependencyScanner] Erreur lors de la lecture du package.json:", err);
  }

  return { findings, components };
}
