import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Finding, FindingStatus, ScannerCategory, FindingSeverity } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";
import { scanFileForSecrets } from "../scanners/SecretsScanner.js";
import { scanIacFile } from "../scanners/IacScanner.js";
import { scanDependencies } from "../scanners/DependencyScanner.js";
import { analyzeFileTaint } from "../scanners/TaintAnalyzer.js";
import { buildSarifReport } from "../reporting/SarifBuilder.js";
import { buildCycloneDxSbom, type SbomComponent } from "../reporting/SbomBuilder.js";
import { computeRiskPriority } from "../findings/SeverityScorer.js";

export interface ScanProfileConfig {
  id: string;
  name: string;
  scanners: {
    sast: boolean;
    sca: boolean;
    secrets: boolean;
    iac: boolean;
    dast: boolean;
  };
  excludePaths?: string[];
  severityThreshold?: FindingSeverity;
}

export interface ScanExecutionResult {
  scanId: string;
  targetPath: string;
  status: 'completed' | 'failed' | 'in_progress';
  startTime: string;
  endTime?: string;
  durationMs: number;
  filesScanned: number;
  findingsCount: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: Finding[];
  sbomComponents: SbomComponent[];
  /** true si le SCA a pu interroger OSV.dev/EPSS en ligne */
  scaOnlineEnrichment?: boolean;
}

export interface AttackSurfaceNode {
  id: string;
  label: string;
  type: 'entrypoint' | 'service' | 'database' | 'storage' | 'external';
  riskScore: number;
  vulnCount: number;
}

export interface AttackSurfaceEdge {
  source: string;
  target: string;
  protocol?: string;
  tainted?: boolean;
}

export interface AttackSurfaceGraph {
  nodes: AttackSurfaceNode[];
  edges: AttackSurfaceEdge[];
  summary: {
    totalEntrypoints: number;
    criticalPaths: number;
    exposureIndex: number; // 0..100
  };
}

export class SecurityOrchestrator {
  private static instance: SecurityOrchestrator;
  private findingsStore = new Map<string, Finding>();
  private sbomStore: SbomComponent[] = [];
  private lastScanResult: ScanExecutionResult | null = null;
  private isScanning = false;

  public static getInstance(): SecurityOrchestrator {
    if (!SecurityOrchestrator.instance) {
      SecurityOrchestrator.instance = new SecurityOrchestrator();
    }
    return SecurityOrchestrator.instance;
  }

  public getStatus() {
    return {
      isScanning: this.isScanning,
      lastScan: this.lastScanResult,
      totalFindings: this.findingsStore.size,
    };
  }

  public async runScan(
    targetDir: string,
    options: {
      scanners?: Partial<ScanProfileConfig['scanners']>;
      excludePaths?: string[];
    } = {}
  ): Promise<ScanExecutionResult> {
    this.isScanning = true;
    const scanId = `scan-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const startTime = new Date();

    const activeScanners = {
      sast: options.scanners?.sast ?? true,
      sca: options.scanners?.sca ?? true,
      secrets: options.scanners?.secrets ?? true,
      iac: options.scanners?.iac ?? true,
      dast: options.scanners?.dast ?? false,
    };

    const excludes = new Set([
      'node_modules',
      '.git',
      'dist',
      'release',
      'build',
      '.gemini',
      ...(options.excludePaths || []),
    ]);

    const collectedFiles: string[] = [];

    const walkDir = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (excludes.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          collectedFiles.push(fullPath);
        }
      }
    };

    walkDir(targetDir);

    const scanFindings: Finding[] = [];

    // 1. Scan SCA (Dépendances)
    let scaOnlineEnrichment = false;
    if (activeScanners.sca) {
      try {
        const scaRes = await scanDependencies(targetDir);
        scanFindings.push(...scaRes.findings);
        this.sbomStore = scaRes.components;
        scaOnlineEnrichment = scaRes.onlineEnrichment;
        if (scaRes.onlineEnrichment) {
          console.info(`[SecurityOrchestrator] SCA enrichi via OSV/EPSS (${scaRes.findings.length} findings)`);
        } else {
          console.info(`[SecurityOrchestrator] SCA fallback offline (${scaRes.findings.length} findings)`);
        }
      } catch (err) {
        console.error("[SecurityOrchestrator] Erreur scanner SCA:", err);
      }
    }

    // 2. Scan SAST, Secrets, IaC fichier par fichier
    const codeExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.json', '.env', '.yaml', '.yml', '.tf',
      'dockerfile',
    ]);

    for (const file of collectedFiles) {
      const ext = path.extname(file).toLowerCase();
      const baseName = path.basename(file).toLowerCase();

      if (!codeExtensions.has(ext) && !baseName.startsWith('dockerfile')) {
        continue;
      }

      let content = '';
      try {
        const stat = fs.statSync(file);
        if (stat.size > 1_000_000) continue; // Limite 1MB par fichier pour performance
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      const relFile = path.relative(targetDir, file);

      // Secrets Scanner
      if (activeScanners.secrets) {
        try {
          const secrets = await scanFileForSecrets(relFile, content);
          scanFindings.push(...secrets);
        } catch (err) {
          console.error(`[SecretsScanner] Erreur sur ${relFile}:`, err);
        }
      }

      // IaC Scanner
      if (activeScanners.iac) {
        try {
          const iacIssues = await scanIacFile(relFile, content);
          scanFindings.push(...iacIssues);
        } catch (err) {
          console.error(`[IacScanner] Erreur sur ${relFile}:`, err);
        }
      }

      // SAST / Taint Analyzer
      if (activeScanners.sast && ['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
        try {
          const sastIssues = await analyzeFileTaint(relFile, content);
          scanFindings.push(...sastIssues);
        } catch (err) {
          console.error(`[TaintAnalyzer] Erreur sur ${relFile}:`, err);
        }
      }
    }

    // Déduplication et stockage dans le store
    const dedupeMap = new Map<string, Finding>();
    for (const finding of scanFindings) {
      if (!dedupeMap.has(finding.fingerprint)) {
        dedupeMap.set(finding.fingerprint, finding);
        // Conserver les statuts manuels précédents si existants
        const existing = this.findingsStore.get(finding.id);
        if (existing) {
          finding.status = existing.status;
        }
        this.findingsStore.set(finding.id, finding);
      }
    }

    const uniqueFindings = Array.from(dedupeMap.values());
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const counts = {
      total: uniqueFindings.length,
      critical: uniqueFindings.filter((f) => f.severity === 'critical').length,
      high: uniqueFindings.filter((f) => f.severity === 'high').length,
      medium: uniqueFindings.filter((f) => f.severity === 'medium').length,
      low: uniqueFindings.filter((f) => f.severity === 'low').length,
      info: uniqueFindings.filter((f) => f.severity === 'info').length,
    };

    const result: ScanExecutionResult = {
      scanId,
      targetPath: targetDir,
      status: 'completed',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs,
      filesScanned: collectedFiles.length,
      findingsCount: counts,
      findings: uniqueFindings,
      sbomComponents: this.sbomStore,
      scaOnlineEnrichment,
    };

    this.lastScanResult = result;
    this.isScanning = false;
    return result;
  }

  public getAllFindings(filters?: {
    severity?: FindingSeverity;
    scanner?: ScannerCategory;
    status?: FindingStatus;
  }): Finding[] {
    let list = Array.from(this.findingsStore.values());
    if (filters?.severity) {
      list = list.filter((f) => f.severity === filters.severity);
    }
    if (filters?.scanner) {
      list = list.filter((f) => f.scanner === filters.scanner);
    }
    if (filters?.status) {
      list = list.filter((f) => f.status === filters.status);
    }
    return list;
  }

  public getFindingById(id: string): Finding | undefined {
    return this.findingsStore.get(id);
  }

  public updateFindingStatus(id: string, status: FindingStatus): Finding | null {
    const finding = this.findingsStore.get(id);
    if (!finding) return null;
    finding.status = status;
    finding.lastSeen = new Date().toISOString();
    return finding;
  }

  public getAttackSurface(): AttackSurfaceGraph {
    const findings = Array.from(this.findingsStore.values());

    const nodes: AttackSurfaceNode[] = [
      { id: 'ep-api-routes', label: 'API Express Endpoints (/api/*)', type: 'entrypoint', riskScore: 82, vulnCount: 0 },
      { id: 'ep-websocket', label: 'WebSocket Stream (:3001/ws)', type: 'entrypoint', riskScore: 65, vulnCount: 0 },
      { id: 'srv-orchestrator', label: 'Security Orchestrator Core', type: 'service', riskScore: 40, vulnCount: 0 },
      { id: 'srv-agent-runtime', label: 'Multi-Agent Runtime (VM Sandbox)', type: 'service', riskScore: 55, vulnCount: 0 },
      { id: 'db-sqlite-local', label: 'SQLite Memory & Graph DB', type: 'database', riskScore: 30, vulnCount: 0 },
      { id: 'ext-llm-providers', label: 'LLM APIs (Gemini, OpenRouter)', type: 'external', riskScore: 45, vulnCount: 0 },
      { id: 'fs-workspace-sandbox', label: 'Workspace Filesystem', type: 'storage', riskScore: 60, vulnCount: 0 },
    ];

    // Corréler les vulnérabilités aux nœuds de surface
    findings.forEach((f) => {
      if (f.scanner === 'sast' && f.ruleId.includes('SQL')) {
        const db = nodes.find((n) => n.id === 'db-sqlite-local');
        if (db) db.vulnCount++;
      } else if (f.scanner === 'secrets') {
        const ext = nodes.find((n) => n.id === 'ext-llm-providers');
        if (ext) ext.vulnCount++;
      } else {
        const ep = nodes.find((n) => n.id === 'ep-api-routes');
        if (ep) ep.vulnCount++;
      }
    });

    const edges: AttackSurfaceEdge[] = [
      { source: 'ep-api-routes', target: 'srv-orchestrator', protocol: 'HTTP REST', tainted: true },
      { source: 'ep-websocket', target: 'srv-orchestrator', protocol: 'WS / WSS', tainted: false },
      { source: 'srv-orchestrator', target: 'srv-agent-runtime', protocol: 'IPC / Node VM', tainted: true },
      { source: 'srv-orchestrator', target: 'db-sqlite-local', protocol: 'SQLite / Better-sqlite3', tainted: false },
      { source: 'srv-agent-runtime', target: 'fs-workspace-sandbox', protocol: 'Fail-closed FS', tainted: true },
      { source: 'srv-agent-runtime', target: 'ext-llm-providers', protocol: 'HTTPS TLS 1.3', tainted: false },
    ];

    const exposureIndex = Math.min(
      95,
      Math.round(20 + findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length * 8)
    );

    return {
      nodes,
      edges,
      summary: {
        totalEntrypoints: nodes.filter((n) => n.type === 'entrypoint').length,
        criticalPaths: edges.filter((e) => e.tainted).length,
        exposureIndex,
      },
    };
  }

  public generateSarifReport(workspaceRoot?: string): Record<string, unknown> {
    const findings = Array.from(this.findingsStore.values());
    return buildSarifReport(findings, workspaceRoot);
  }

  public generateCycloneDxSbom(projectName: string, projectVersion: string): Record<string, unknown> {
    return buildCycloneDxSbom({
      projectName,
      projectVersion,
      components: this.sbomStore,
    });
  }
}

export const securityOrchestrator = SecurityOrchestrator.getInstance();
