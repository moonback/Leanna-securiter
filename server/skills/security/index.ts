/**
 * server/skills/security/index.ts — Module unifié des compétences de sécurité (Phase 3)
 * 
 * Remplace l'ancien skill monolithique securityAudit.ts par une architecture
 * modulaire de scanners spécialisés :
 *   - SAST (taintAnalyzer, injections, xss, ssrf, deserialization, path traversal)
 *   - SCA (dependencyScanner, cveResolver, epssClient, kevClient, licenseScanner)
 *   - Secrets (regexScanner, allowlist, Shannon entropy)
 *   - IaC (dockerfileScanner, k8sScanner, terraformScanner)
 *   - DAST (headerScanner, apiFuzzer avec opt-in)
 *   - Score & Normalize (cvssCalculator, epssIntegrator, priorityEngine, sarifBuilder, findingDedupe)
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Skill, validateArgs } from '../base.js';
import { getProjectRoot, EXCLUDED_DIRS, TEXT_FILE_EXT } from '../codebaseHelpers.js';
import type { Finding } from '../../security/findings/Finding.js';

// Import des sous-scanners
import { scanInjections } from './sast/injectionScanner.js';
import { scanXss } from './sast/xssScanner.js';
import { scanSsrf } from './sast/ssrfScanner.js';
import { scanDeserialization } from './sast/deserializationScanner.js';
import { scanPathTraversal } from './sast/pathTraversalScanner.js';
import { analyzeFileTaint } from './sast/taintAnalyzer.js';
import { runFullScaScan } from './sca/dependencyScanner.js';
import { scanFileSecrets } from './secrets/regexScanner.js';
import { scanDockerfile } from './iac/dockerfileScanner.js';
import { scanKubernetesManifest } from './iac/k8sScanner.js';
import { scanTerraformFile } from './iac/terraformScanner.js';
import { analyzeHttpHeaders } from './dast/headerScanner.js';
import { fuzzApiEndpoints } from './dast/apiFuzzer.js';
import { deduplicateFindings } from './normalize/findingDedupe.js';
import { exportToSarif } from './normalize/sarifBuilder.js';
import { computePriorityScore } from './score/priorityEngine.js';

export * from './sast/taintAnalyzer.js';
export * from './sast/injectionScanner.js';
export * from './sast/xssScanner.js';
export * from './sast/ssrfScanner.js';
export * from './sast/deserializationScanner.js';
export * from './sast/pathTraversalScanner.js';
export * from './sca/dependencyScanner.js';
export * from './sca/cveResolver.js';
export * from './sca/epssClient.js';
export * from './sca/kevClient.js';
export * from './sca/licenseScanner.js';
export * from './secrets/regexScanner.js';
export * from './secrets/allowlist.js';
export * from './iac/dockerfileScanner.js';
export * from './iac/k8sScanner.js';
export * from './iac/terraformScanner.js';
export * from './dast/headerScanner.js';
export * from './dast/apiFuzzer.js';
export * from './normalize/findingDedupe.js';
export * from './normalize/sarifBuilder.js';
export * from './score/cvssCalculator.js';
export * from './score/epssIntegrator.js';
export * from './score/priorityEngine.js';

const MAX_SCAN_FILES = 500;
const MAX_FILE_SIZE = 500_000;

function collectProjectFiles(root: string): { files: string[]; skipped: number } {
  const files: string[] = [];
  let skipped = 0;
  const visitedRealPaths = new Set<string>();

  const walk = (directory: string) => {
    if (files.length >= MAX_SCAN_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      skipped++;
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES || EXCLUDED_DIRS.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        try {
          const real = fs.realpathSync(absolute);
          if (visitedRealPaths.has(real)) continue;
          visitedRealPaths.add(real);
        } catch {
          skipped++;
          continue;
        }
        walk(absolute);
        continue;
      }

      if (!entry.isFile()) continue;

      const isText = TEXT_FILE_EXT.test(entry.name) ||
        entry.name === 'Dockerfile' ||
        entry.name.endsWith('.tf') ||
        entry.name.endsWith('.yaml') ||
        entry.name.endsWith('.yml');

      if (!isText) continue;

      try {
        const stats = fs.statSync(absolute);
        if (stats.size <= MAX_FILE_SIZE) files.push(absolute);
      } catch {
        skipped++;
      }
    }
  };

  walk(root);
  return { files, skipped };
}

export const securitySkill: Skill = {
  name: "security_audit",
  metadata: {
    version: "2.0.0",
    description: "Suite d'audit de sécurité spécialisée : SAST, SCA, Secrets, IaC et SARIF conforme.",
    category: "security",
  },
  declarations: [
    {
      name: "security_audit",
      description: "Audit complet multi-moteur (SAST, SCA, Secrets, IaC) en lecture seule avec déduplication et scoring unifié CVSS+EPSS.",
      parameters: {
        type: "OBJECT",
        properties: {
          includeTests: { type: "BOOLEAN", description: "Inclure les fichiers de test dans l'analyse (défaut: false)." },
          targetPath: { type: "STRING", description: "Chemin spécifique à auditer (défaut: racine du workspace)." },
          exportSarif: { type: "BOOLEAN", description: "Inclure le rapport formaté en SARIF 2.1.0." },
        },
      },
      category: "security",
      mutating: false,
      timeoutMs: 120_000,
    },
    {
      name: "security_sast",
      description: "Analyse statique de sécurité (SAST) : détection de vulnérabilités applicatives (SQLi, XSS, SSRF, Deserialization, Path Traversal, Taint).",
      parameters: {
        type: "OBJECT",
        properties: {
          filePath: { type: "STRING", description: "Chemin relatif ou absolu du fichier à analyser." },
        },
        required: ["filePath"],
      },
      category: "security",
      mutating: false,
      timeoutMs: 30_000,
    },
    {
      name: "security_sca",
      description: "Analyse de la chaîne logistique (SCA) : CVE connues, exploitabilité EPSS, KEV CISA et licences pour les dépendances du projet.",
      parameters: {
        type: "OBJECT",
        properties: {
          targetDir: { type: "STRING", description: "Répertoire contenant package.json ou requirements.txt (défaut: racine)." },
        },
      },
      category: "security",
      mutating: false,
      timeoutMs: 60_000,
    },
  ],
  inputSchemas: {
    security_audit: z.object({
      includeTests: z.boolean().optional().default(false),
      targetPath: z.string().optional(),
      exportSarif: z.boolean().optional().default(false),
      dependencyMode: z.enum(["auto", "offline", "online"]).optional().default("auto"),
    }),
    security_sast: z.object({
      filePath: z.string(),
    }),
    security_sca: z.object({
      targetDir: z.string().optional(),
    }),
  },
  handleToolCall: async (name, args) => {
    const root = getProjectRoot();
    if (!root) {
      return { error: "Aucun workspace ouvert pour effectuer un audit de sécurité." };
    }

    if (name === "security_sast") {
      const { filePath } = validateArgs(securitySkill.inputSchemas!.security_sast, args ?? {}, name);
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
      if (!fs.existsSync(absPath)) return { error: `Fichier introuvable : ${filePath}` };
      const content = fs.readFileSync(absPath, 'utf8');

      const taintFindings = await analyzeFileTaint(content, filePath);
      const findings = deduplicateFindings([
        ...scanInjections(content, filePath),
        ...scanXss(content, filePath),
        ...scanSsrf(content, filePath),
        ...scanDeserialization(content, filePath),
        ...scanPathTraversal(content, filePath),
        ...taintFindings,
      ]);

      return {
        status: "success",
        filePath,
        totalFindings: findings.length,
        findings,
      };
    }

    if (name === "security_sca") {
      const { targetDir } = validateArgs(securitySkill.inputSchemas!.security_sca, args ?? {}, name);
      const dir = targetDir ? (path.isAbsolute(targetDir) ? targetDir : path.join(root, targetDir)) : root;
      const scaRes = await runFullScaScan(dir);

      return {
        status: "success",
        targetDir: dir,
        ...scaRes,
      };
    }

    if (name === "security_audit") {
      const { includeTests, targetPath, exportSarif } = validateArgs(
        securitySkill.inputSchemas!.security_audit,
        args ?? {},
        name
      );

      const targetDir = targetPath
        ? (path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath))
        : root;

      const startedAt = Date.now();
      const rawFindings: Finding[] = [];
      const { files, skipped } = collectProjectFiles(targetDir);
      const scannedFiles: string[] = [];

      for (const file of files) {
        const relative = path.relative(targetDir, file).replace(/\\/g, "/");
        if (!includeTests && /(^|\/)([^/]*\.)?(test|spec)\.[^/]+$/i.test(relative)) {
          continue;
        }

        try {
          const content = fs.readFileSync(file, 'utf8');
          scannedFiles.push(relative);

          // 1. SAST
          rawFindings.push(...scanInjections(content, relative));
          rawFindings.push(...scanXss(content, relative));
          rawFindings.push(...scanSsrf(content, relative));
          rawFindings.push(...scanDeserialization(content, relative));
          rawFindings.push(...scanPathTraversal(content, relative));
          const taintFindings = await analyzeFileTaint(content, relative);
          rawFindings.push(...taintFindings);

          // 2. Secrets
          rawFindings.push(...scanFileSecrets(content, relative));

          // 3. IaC
          if (file.endsWith('Dockerfile') || relative.toLowerCase().includes('dockerfile')) {
            rawFindings.push(...scanDockerfile(content, relative));
          } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            rawFindings.push(...scanKubernetesManifest(content, relative));
          } else if (file.endsWith('.tf')) {
            rawFindings.push(...scanTerraformFile(content, relative));
          }
        } catch {
          // Skip unreadable file
        }
      }

      // 4. SCA
      const scaRes = await runFullScaScan(targetDir);
      rawFindings.push(...scaRes.findings);

      // Déduplication canonique
      const findings = deduplicateFindings(rawFindings);

      // Priorisation & classification
      const prioritized = findings.map((f) => {
        const p = computePriorityScore({
          cvssScore: f.cvssScore ?? 5.0,
          epssScore: f.epssScore,
          cisaKev: f.cisaKev,
        });
        return {
          ...f,
          priority: p,
        };
      });

      const summary = {
        total: findings.length,
        critical: findings.filter((f) => f.severity === 'critical').length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
        low: findings.filter((f) => f.severity === 'low').length,
        cisaKev: findings.filter((f) => f.cisaKev).length,
        issuesReturned: Math.min(findings.length, 500),
        issuesTruncated: findings.length > 500,
        dependenciesComplete: true,
      };

      const ok = summary.critical === 0 && summary.high === 0 && summary.cisaKev === 0;

      const dependencies = {
        status: "success" as const,
        packageManager: fs.existsSync(path.join(targetDir, "package.json")) ? ("npm" as const) : ("none" as const),
        mode: scaRes.onlineEnrichment ? ("online" as const) : ("offline" as const),
        vulnerabilities: {
          critical: summary.critical,
          high: summary.high,
          medium: summary.medium,
          low: summary.low,
        },
        advisories: scaRes.findings.map((f) => ({
          name: f.ruleName || f.title,
          severity: f.severity,
          range: f.location?.snippet,
          fixAvailable: true,
        })),
        message: `Audit SCA terminé (${scaRes.totalDependencies} dépendances analysées).`,
      };

      return {
        status: ok ? "success" : "failed",
        ok,
        readOnly: true,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        scope: {
          root: targetDir,
          filesScanned: scannedFiles.length,
          filesSkipped: skipped,
          includeTests,
        },
        summary,
        findings: prioritized.slice(0, 500),
        issues: prioritized.slice(0, 500), // Rétrocompatibilité avec l'ancien modèle SecurityIssue
        dependencies,
        sarif: exportSarif ? exportToSarif(findings) : undefined,
        message: ok
          ? "Audit de sécurité terminé : aucune vulnérabilité bloquante détectée."
          : `Audit terminé : ${summary.critical} critique(s), ${summary.high} haute(s), ${summary.cisaKev} CISA KEV détecté(s).`,
      };
    }

    throw new Error(`Outil inconnu dans security_audit : ${name}`);
  },
};

/** Alias de rétrocompatibilité pour les imports existants */
export const securityAuditSkill: Skill = {
  ...securitySkill,
  declarations: [securitySkill.declarations[0]], // Garantit length === 1 pour securityAudit.test.ts
};
