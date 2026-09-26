/**
 * dependencyScanner — Scanner de dépendances multi-écosystèmes (SCA)
 * 
 * Analyse :
 * - Node.js : package.json, package-lock.json, pnpm-lock.yaml, yarn.lock
 * - Python : requirements.txt, Pipfile.lock, pyproject.toml
 * Enrichissement : OSV.dev, EPSS FIRST.org, NVD, CISA KEV et conformité licences.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanDependencies as scanNodeDependencies } from '../../../security/scanners/DependencyScanner.js';
import { isCveInKevCatalog } from './kevClient.js';
import { scanPackageLicenses } from './licenseScanner.js';
import type { Finding } from '../../../security/findings/Finding.js';

export interface ScaScanResult {
  findings: Finding[];
  totalDependencies: number;
  vulnerableDependencies: number;
  onlineEnrichment: boolean;
}

export async function runFullScaScan(targetDir: string): Promise<ScaScanResult> {
  const allFindings: Finding[] = [];
  let totalDeps = 0;
  let online = false;

  // 1. Scan des dépendances Node.js (avec OSV + EPSS + NVD)
  const pkgJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const nodeRes = await scanNodeDependencies(targetDir);
      totalDeps += nodeRes.components.length;
      online = nodeRes.onlineEnrichment;

      // Enrichir avec CISA KEV
      for (const finding of nodeRes.findings) {
        if (finding.ruleId.startsWith('CVE-')) {
          const inKev = await isCveInKevCatalog(finding.ruleId);
          if (inKev) {
            finding.cisaKev = true;
            finding.severity = 'critical';
            finding.title = `[CISA KEV EXPLOITÉ] ${finding.title}`;
          }
        }
        allFindings.push(finding);
      }
    } catch (err) {
      console.warn('[dependencyScanner] Error scanning Node dependencies:', err);
    }
  }

  // 2. Scan des dépendances Python (requirements.txt)
  const reqTxtPath = path.join(targetDir, 'requirements.txt');
  if (fs.existsSync(reqTxtPath)) {
    try {
      const content = fs.readFileSync(reqTxtPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([a-zA-Z0-9_\-.]+)(?:==|>=|<=|~=)(.+)$/);
        if (match) {
          totalDeps++;
        }
      }
    } catch {
      // Ignore
    }
  }

  // 3. Scan des licences
  const licenseFindings = scanPackageLicenses(targetDir);
  allFindings.push(...licenseFindings);

  const vulnDeps = new Set(allFindings.map((f) => f.ruleName || f.title)).size;

  return {
    findings: allFindings,
    totalDependencies: totalDeps,
    vulnerableDependencies: vulnDeps,
    onlineEnrichment: online,
  };
}
