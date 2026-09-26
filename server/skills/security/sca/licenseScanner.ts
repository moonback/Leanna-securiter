/**
 * licenseScanner — Scanner de conformité et compatibilité des licences open source
 * 
 * Détecte les licences restrictives (Copyleft fort : AGPL, GPL, SSPL, EUPL)
 * incompatibles avec un usage commercial ou propriétaire fermé.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Finding } from '../../../security/findings/Finding.js';
import { computeFingerprint } from '../../../security/findings/Fingerprint.js';

const HIGH_RISK_COPYLEFT = new Set(['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'EUPL-1.2']);
const MODERATE_COPYLEFT = new Set(['LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'EPL-2.0']);

export interface LicenseCheckResult {
  packageName: string;
  license: string;
  risk: 'high' | 'medium' | 'permissive' | 'unknown';
}

export function scanPackageLicenses(projectRoot: string): Finding[] {
  const findings: Finding[] = [];
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return findings;

  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf8');
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [depName] of Object.entries(deps)) {
      // Tenter de lire le package.json installé dans node_modules
      const installedPkgPath = path.join(projectRoot, 'node_modules', depName, 'package.json');
      if (fs.existsSync(installedPkgPath)) {
        try {
          const installed = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8'));
          const license = typeof installed.license === 'string'
            ? installed.license
            : (installed.license?.type || installed.licenses?.[0]?.type || 'UNKNOWN');

          const upperLicense = license.toUpperCase();

          const isHigh = Array.from(HIGH_RISK_COPYLEFT).some((l) => upperLicense.includes(l.toUpperCase()));
          const isMod = Array.from(MODERATE_COPYLEFT).some((l) => upperLicense.includes(l.toUpperCase()));

          if (isHigh || isMod) {
            const fingerprint = computeFingerprint({
              filePath: 'package.json',
              ruleId: `LICENSE-${license}`,
              snippet: `"${depName}": "${license}"`,
            });

            findings.push({
              id: crypto.randomUUID(),
              fingerprint,
              ruleId: `LICENSE-COPYLEFT`,
              ruleName: `Licence ${isHigh ? 'Copyleft stricte' : 'Copyleft modérée'} (${license})`,
              title: `Risque juridique de licence : ${depName} utilise ${license}`,
              description: `Le paquet **${depName}** est distribué sous licence **${license}**. Cette licence oblige à redistribuer le code source complet de toute application qui l'incorpore ou l'expose sur un réseau.`,
              severity: isHigh ? 'high' : 'medium',
              status: 'open',
              scanner: 'sca',
              location: { filePath: 'package.json', startLine: 1, snippet: `"${depName}"` },
              cvssScore: isHigh ? 7.0 : 4.0,
              impact: 'Contamination virale du code propriétaire par obligation de diffusion publique sous la même licence.',
              remediation: `Remplacez **${depName}** par une alternative sous licence permissive (MIT, Apache 2.0, BSD, ISC).`,
              references: [`https://spdx.org/licenses/${license}.html`],
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
            });
          }
        } catch {
          // Skip if corrupted package.json
        }
      }
    }
  } catch (err) {
    console.warn('[licenseScanner] Erreur de lecture package.json:', err);
  }

  return findings;
}
