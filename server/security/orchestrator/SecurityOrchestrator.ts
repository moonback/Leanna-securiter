/**
 * SecurityOrchestrator — Coordinateur central de sécurité (Phase 4)
 *
 * Architecture :
 *  ┌────────────────────────────────────────────────────────────┐
 *  │  ScanTriggerEngine  ──►  ScanQueue  ──►  ScanPolicy        │
 *  │         │                   │               │              │
 *  │         ▼                   ▼               ▼              │
 *  │  [WorkspaceHashCache]  [Runner fn]  [Scanner selections]   │
 *  │                             │                              │
 *  │                             ▼                              │
 *  │               [SAST | SCA | Secrets | IaC | DAST]         │
 *  │                             │                              │
 *  │                             ▼                              │
 *  │                    FindingManager.ingest()                 │
 *  │                             │                              │
 *  │                             ▼                              │
 *  │                  ScanExecutionResult + SARIF/SBOM          │
 *  └────────────────────────────────────────────────────────────┘
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import type { Finding, FindingStatus } from '../findings/Finding.js';
import { buildSarifReport } from '../reporting/SarifBuilder.js';
import { buildCycloneDxSbom, type SbomComponent } from '../reporting/SbomBuilder.js';
import { writeSecurityReportToSandbox } from '../reporting/ReportWriter.js';

import { ScanPolicy, type ScanPolicyConfig, type ScanProfileType } from './ScanPolicy.js';
import { ScanTriggerEngine, type TriggerType, type ScanTriggerEvent } from './ScanTriggerEngine.js';
import { ScanQueue } from './ScanQueue.js';
import { FindingManager, type FindingFilterOptions, type TriageAuditEntry } from './FindingManager.js';

import { scanFileForSecrets } from '../scanners/SecretsScanner.js';
import { scanIacFile } from '../scanners/IacScanner.js';
import { scanDependencies } from '../scanners/DependencyScanner.js';
import { analyzeFileTaint } from '../scanners/TaintAnalyzer.js';

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export type { ScanProfileType };
export type { ScanTriggerEvent, TriggerType };
export type { FindingFilterOptions, TriageAuditEntry };

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ScanExecutionResult {
  scanId: string;
  targetPath: string;
  profile: ScanProfileType;
  triggerType: TriggerType;
  status: 'completed' | 'failed' | 'blocked' | 'in_progress';
  /** Populated when status === 'blocked' */
  blockingReason?: string;
  startTime: string;
  endTime?: string;
  durationMs: number;
  filesScanned: number;
  filesSkipped: number;
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
  /** true if SCA successfully queried OSV/EPSS online */
  scaOnlineEnrichment: boolean;
  /** Number of files tracked in the incremental hash cache */
  cacheSize: number;
  /**
   * Rapports écrits dans la sandbox (chemins relatifs à la racine sandbox).
   * `null` si la sandbox n'était pas prête au moment du scan.
   */
  report: {
    markdownPath: string;
    sarifPath: string;
  } | null;
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

// Code file extensions eligible for static analysis
const ANALYSABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.env', '.yaml', '.yml', '.tf', '.toml',
]);

// ---------------------------------------------------------------------------
// SecurityOrchestrator
// ---------------------------------------------------------------------------

export class SecurityOrchestrator {
  private static instance: SecurityOrchestrator;

  // Orchestration primitives
  private readonly triggerEngine = new ScanTriggerEngine();
  private readonly scanQueue    = new ScanQueue();
  private readonly findingManager = new FindingManager();

  // SBOM storage (updated after each SCA run)
  private sbomStore: SbomComponent[] = [];

  // Cached last scan metadata (status only — findings are in findingManager)
  private lastScanResult: ScanExecutionResult | null = null;

  // -------------------------------------------------------------------------
  // Singleton
  // -------------------------------------------------------------------------

  public static getInstance(): SecurityOrchestrator {
    if (!SecurityOrchestrator.instance) {
      SecurityOrchestrator.instance = new SecurityOrchestrator();
    }
    return SecurityOrchestrator.instance;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  public getStatus() {
    return {
      isScanning:   this.scanQueue.isBusy(),
      queueStats:   this.scanQueue.getStats(),
      findingStats: this.findingManager.getStats(),
      cacheSize:    this.triggerEngine.getCacheSize(),
      lastScan: this.lastScanResult
        ? {
            scanId:        this.lastScanResult.scanId,
            status:        this.lastScanResult.status,
            profile:       this.lastScanResult.profile,
            endTime:       this.lastScanResult.endTime,
            findingsCount: this.lastScanResult.findingsCount,
          }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // runScan — public entry point
  // -------------------------------------------------------------------------

  /**
   * Schedules and executes a security scan on `targetDir`.
   *
   * Queue priorities:
   *   git_commit / pre_push → 100  (highest — blocks PRs)
   *   api (on-demand)       →  50
   *   cron / file_change    →  10  (background)
   */
  public async runScan(
    targetDir: string,
    options: {
      profile?: ScanProfileType;
      policyOverride?: Partial<ScanPolicyConfig>;
      triggerType?: TriggerType;
      /** Caller-supplied changed file list (e.g. from git diff) */
      changedFiles?: string[];
    } = {}
  ): Promise<ScanExecutionResult> {
    const triggerType: TriggerType = options.triggerType ?? 'api';

    const policy = new ScanPolicy({
      profile: options.profile ?? 'standard',
      ...options.policyOverride,
    });

    const triggerEvent = this.triggerEngine.createTriggerEvent(
      triggerType,
      targetDir,
      options.changedFiles
    );

    const priority = this._triggerPriority(triggerType);

    return this.scanQueue.enqueue<ScanExecutionResult>(
      targetDir,
      priority,
      () => this._executeScan(targetDir, policy, triggerEvent)
    );
  }

  // -------------------------------------------------------------------------
  // Internal scan execution (runs inside the ScanQueue)
  // -------------------------------------------------------------------------

  private async _executeScan(
    targetDir: string,
    policy: ScanPolicy,
    trigger: ScanTriggerEvent
  ): Promise<ScanExecutionResult> {
    const scanId   = `scan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const startTime = new Date();
    const cfg       = policy.getConfig();

    // ------------------------------------------------------------------
    // 1. Collect all candidate files respecting policy excludes
    // ------------------------------------------------------------------
    const allFiles = this._walkDirectory(targetDir, policy);

    // ------------------------------------------------------------------
    // 2. Incremental filter (SHA-256 hash cache or caller-supplied diff)
    // ------------------------------------------------------------------
    let filesToScan: string[];
    if (cfg.incrementalOnly && trigger.changedFiles && trigger.changedFiles.length > 0) {
      filesToScan = trigger.changedFiles.filter((f) => allFiles.includes(f));
    } else if (cfg.incrementalOnly) {
      const { changed } = this.triggerEngine.detectChangedFiles(allFiles);
      filesToScan = changed;
    } else {
      filesToScan = allFiles;
    }

    // Enforce maxFilesTotal policy cap
    const filesSkipped = Math.max(0, filesToScan.length - cfg.maxFilesTotal);
    filesToScan = filesToScan.slice(0, cfg.maxFilesTotal);

    const rawFindings: Finding[] = [];
    let scaOnlineEnrichment = false;

    // ------------------------------------------------------------------
    // 3. SCA (project-level, not per-file)
    // ------------------------------------------------------------------
    if (policy.isScannerActive('sca')) {
      try {
        const scaRes = await scanDependencies(targetDir);
        rawFindings.push(...scaRes.findings);
        this.sbomStore       = scaRes.components;
        scaOnlineEnrichment  = scaRes.onlineEnrichment;
        console.info(
          `[SecurityOrchestrator][${scanId}] SCA → ${scaRes.findings.length} finding(s) | ` +
          `online=${scaOnlineEnrichment}`
        );
      } catch (err) {
        console.error(`[SecurityOrchestrator][${scanId}] SCA error:`, err);
      }
    }

    // ------------------------------------------------------------------
    // 4. Per-file scanners: Secrets, IaC, SAST
    // ------------------------------------------------------------------
    for (const filePath of filesToScan) {
      const ext      = path.extname(filePath).toLowerCase();
      const baseName = path.basename(filePath).toLowerCase();
      const isDockerfile = baseName === 'dockerfile' || baseName.startsWith('dockerfile.');

      if (!ANALYSABLE_EXTENSIONS.has(ext) && !isDockerfile) continue;

      let content = '';
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > cfg.maxFileSize) continue;
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const relFile = path.relative(targetDir, filePath);

      if (policy.isScannerActive('secrets')) {
        try {
          rawFindings.push(...await scanFileForSecrets(relFile, content));
        } catch (err) {
          console.error(`[SecretsScanner][${scanId}] ${relFile}:`, err);
        }
      }

      if (policy.isScannerActive('iac')) {
        try {
          rawFindings.push(...await scanIacFile(relFile, content));
        } catch (err) {
          console.error(`[IacScanner][${scanId}] ${relFile}:`, err);
        }
      }

      if (
        policy.isScannerActive('sast') &&
        ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)
      ) {
        try {
          rawFindings.push(...await analyzeFileTaint(relFile, content));
        } catch (err) {
          console.error(`[TaintAnalyzer][${scanId}] ${relFile}:`, err);
        }
      }
    }

    // ------------------------------------------------------------------
    // 5. Ingest into FindingManager (dedup by SARIF fingerprint +
    //    preservation of manual triage states)
    // ------------------------------------------------------------------
    const uniqueFindings = this.findingManager.ingest(rawFindings);

    // ------------------------------------------------------------------
    // 6. Blocking gate evaluation
    //
    // Le gate bloquant est un mécanisme CI/CD : il ne doit s'appliquer QUE
    // pour les déclencheurs qui gardent une PR / un push (git_commit, pre_push).
    // Un audit à la demande (api, cron, file_change) rapporte les findings sans
    // marquer le scan 'blocked' — sinon la moindre CVE 'medium' d'une dépendance
    // transitive ferait échouer tout scan manuel, ce qui n'a pas de sens.
    // ------------------------------------------------------------------
    const gateEnforced = this._isBlockingTrigger(trigger.type);
    const blockingFindings = uniqueFindings.filter(
      (f) => f.status === 'open' && policy.isBlocking(f.severity)
    );
    const blocked       = gateEnforced && blockingFindings.length > 0;
    const blockingReason = blocked
      ? `${blockingFindings.length} finding(s) at or above '${cfg.blockingSeverity}' severity`
      : undefined;

    const endTime   = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const counts     = this._countBySeverity(uniqueFindings);

    const result: ScanExecutionResult = {
      scanId,
      targetPath: targetDir,
      profile: cfg.profile,
      triggerType: trigger.type,
      status: blocked ? 'blocked' : 'completed',
      blockingReason,
      startTime: startTime.toISOString(),
      endTime:   endTime.toISOString(),
      durationMs,
      filesScanned: filesToScan.length,
      filesSkipped,
      findingsCount: counts,
      findings: uniqueFindings,
      sbomComponents: this.sbomStore,
      scaOnlineEnrichment,
      cacheSize: this.triggerEngine.getCacheSize(),
      report: null,
    };

    // ------------------------------------------------------------------
    // 7. Écriture des livrables de rapport DANS LA SANDBOX
    //    (rapport.md + rapport.sarif.json). Non bloquant : un échec
    //    d'écriture (sandbox non prête, etc.) ne fait pas échouer le scan.
    // ------------------------------------------------------------------
    const reportResult = writeSecurityReportToSandbox(
      {
        scanId,
        targetPath: targetDir,
        profile: cfg.profile,
        status: result.status,
        startTime: result.startTime,
        endTime: result.endTime,
        durationMs,
        filesScanned: filesToScan.length,
        filesSkipped,
        findings: uniqueFindings,
        findingsCount: counts,
        blockingReason,
      },
      targetDir,
    );

    if (reportResult.written && reportResult.report) {
      result.report = reportResult.report;
      console.info(
        `[SecurityOrchestrator][${scanId}] 📄 Rapport écrit dans la sandbox → ` +
        `${reportResult.report.markdownPath}, ${reportResult.report.sarifPath}`
      );
    } else {
      console.warn(
        `[SecurityOrchestrator][${scanId}] Rapport non écrit : ${reportResult.reason}`
      );
    }

    this.lastScanResult = result;

    console.info(
      `[SecurityOrchestrator][${scanId}] ${result.status.toUpperCase()} | ` +
      `${durationMs}ms | ${filesToScan.length} files | ` +
      `${counts.total} findings (${counts.critical}C ${counts.high}H)`
    );

    if (blocked) {
      console.warn(`[SecurityOrchestrator][${scanId}] ⛔ Gate blocked: ${blockingReason}`);
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Finding management (delegated to FindingManager)
  // -------------------------------------------------------------------------

  public getAllFindings(filters?: FindingFilterOptions): Finding[] {
    return this.findingManager.query(filters ?? {});
  }

  public getFindingById(id: string): Finding | undefined {
    return this.findingManager.getById(id);
  }

  public updateFindingStatus(
    id: string,
    status: FindingStatus,
    rationale?: string,
    author?: string
  ): boolean {
    return this.findingManager.updateStatus(id, status, rationale, author);
  }

  public getTriageAuditLog(findingId?: string): TriageAuditEntry[] {
    return this.findingManager.getAuditLog(findingId);
  }

  public getFindingStats() {
    return this.findingManager.getStats();
  }

  // -------------------------------------------------------------------------
  // Attack surface graph
  // -------------------------------------------------------------------------

  /**
   * Construit le graphe de surface d'attaque.
   *
   * La topologie (nœuds/arêtes) reflète l'architecture du système ; en revanche
   * `riskScore`, `vulnCount` et `tainted` sont désormais **dérivés des findings
   * réels** plutôt que codés en dur. Chaque finding est associé à un nœud selon
   * son scanner/règle, puis le score de risque du nœud est calculé par
   * pondération de sévérité. Une arête est marquée `tainted` si au moins un de
   * ses nœuds porte un finding.
   */
  public getAttackSurface(): AttackSurfaceGraph {
    const findings = this.findingManager.query({ status: 'open' });

    // Poids de sévérité pour le calcul de risque.
    const SEV_WEIGHT: Record<Finding['severity'], number> = {
      critical: 40, high: 25, medium: 12, low: 5, info: 1,
    };

    // Topologie de base (labels/types stables), risque initialisé à 0.
    const nodes: AttackSurfaceNode[] = [
      { id: 'ep-api-routes',        label: 'API Express Endpoints (/api/*)',   type: 'entrypoint', riskScore: 0, vulnCount: 0 },
      { id: 'ep-websocket',         label: 'WebSocket Stream (:3001/ws)',       type: 'entrypoint', riskScore: 0, vulnCount: 0 },
      { id: 'srv-orchestrator',     label: 'Security Orchestrator Core',        type: 'service',    riskScore: 0, vulnCount: 0 },
      { id: 'srv-agent-runtime',    label: 'Multi-Agent Runtime (VM Sandbox)',  type: 'service',    riskScore: 0, vulnCount: 0 },
      { id: 'db-sqlite-local',      label: 'SQLite Memory & Graph DB',          type: 'database',   riskScore: 0, vulnCount: 0 },
      { id: 'ext-llm-providers',    label: 'LLM APIs (Gemini, OpenRouter)',     type: 'external',   riskScore: 0, vulnCount: 0 },
      { id: 'fs-workspace-sandbox', label: 'Workspace Filesystem',              type: 'storage',    riskScore: 0, vulnCount: 0 },
    ];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    // Cumul de risque brut par nœud (avant normalisation).
    const rawRisk = new Map<string, number>();
    const addRisk = (id: string, weight: number) => {
      rawRisk.set(id, (rawRisk.get(id) ?? 0) + weight);
    };

    /** Associe un finding à un nœud de la surface d'attaque. */
    const nodeForFinding = (f: Finding): string => {
      const rule = f.ruleId.toUpperCase();
      const file = f.location?.filePath?.toLowerCase() ?? '';
      if (f.scanner === 'sca') return 'ext-llm-providers'; // dépendances externes
      if (f.scanner === 'secrets') return 'ext-llm-providers';
      if (f.scanner === 'iac') return 'fs-workspace-sandbox';
      if (f.scanner === 'dast') return 'ep-api-routes';
      // SAST : router selon la nature de la règle / le fichier.
      if (rule.includes('SQL') || rule.includes('CWE-89') || rule.includes('CWE-943')) return 'db-sqlite-local';
      if (file.includes('websocket') || file.includes('/ws')) return 'ep-websocket';
      if (file.includes('route') || file.includes('/api/') || file.includes('server')) return 'ep-api-routes';
      if (file.includes('agent') || file.includes('runtime')) return 'srv-agent-runtime';
      return 'srv-orchestrator';
    };

    for (const f of findings) {
      const nodeId = nodeForFinding(f);
      const node = nodeById.get(nodeId);
      if (!node) continue;
      node.vulnCount++;
      addRisk(nodeId, SEV_WEIGHT[f.severity] ?? 1);
    }

    // Normalisation du risque en 0..100 (saturation à 100).
    for (const node of nodes) {
      node.riskScore = Math.min(100, rawRisk.get(node.id) ?? 0);
    }

    // Topologie des arêtes ; `tainted` dérivé de la présence de vulnérabilités.
    const baseEdges: Array<Omit<AttackSurfaceEdge, 'tainted'>> = [
      { source: 'ep-api-routes',     target: 'srv-orchestrator',     protocol: 'HTTP REST' },
      { source: 'ep-websocket',      target: 'srv-orchestrator',     protocol: 'WS / WSS' },
      { source: 'srv-orchestrator',  target: 'srv-agent-runtime',    protocol: 'IPC / Node VM' },
      { source: 'srv-orchestrator',  target: 'db-sqlite-local',      protocol: 'SQLite / better-sqlite3' },
      { source: 'srv-agent-runtime', target: 'fs-workspace-sandbox', protocol: 'Fail-closed FS' },
      { source: 'srv-agent-runtime', target: 'ext-llm-providers',    protocol: 'HTTPS TLS 1.3' },
    ];
    const edges: AttackSurfaceEdge[] = baseEdges.map((e) => ({
      ...e,
      tainted: (nodeById.get(e.source)?.vulnCount ?? 0) > 0 || (nodeById.get(e.target)?.vulnCount ?? 0) > 0,
    }));

    const highCritCount = findings.filter(
      (f) => f.severity === 'critical' || f.severity === 'high'
    ).length;

    return {
      nodes,
      edges,
      summary: {
        totalEntrypoints: nodes.filter((n) => n.type === 'entrypoint').length,
        criticalPaths:    edges.filter((e) => e.tainted).length,
        exposureIndex:    Math.min(95, 20 + highCritCount * 8),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Report generation
  // -------------------------------------------------------------------------

  public generateSarifReport(workspaceRoot?: string): Record<string, unknown> {
    return buildSarifReport(this.findingManager.query({}), workspaceRoot);
  }

  public generateCycloneDxSbom(projectName: string, projectVersion: string): Record<string, unknown> {
    return buildCycloneDxSbom({ projectName, projectVersion, components: this.sbomStore });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Recursively walk `rootDir` respecting policy path exclusions. */
  private _walkDirectory(rootDir: string, policy: ScanPolicy): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath  = path.relative(rootDir, fullPath);

        if (policy.isPathExcluded(entry.name) || policy.isPathExcluded(relPath)) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };

    walk(rootDir);
    return files;
  }

  /** Count findings by severity. */
  private _countBySeverity(findings: Finding[]) {
    return {
      total:    findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high:     findings.filter((f) => f.severity === 'high').length,
      medium:   findings.filter((f) => f.severity === 'medium').length,
      low:      findings.filter((f) => f.severity === 'low').length,
      info:     findings.filter((f) => f.severity === 'info').length,
    };
  }

  /** Map trigger type to queue scheduling priority. */
  private _triggerPriority(type: TriggerType): number {
    switch (type) {
      case 'git_commit':
      case 'pre_push':
        return 100;
      case 'api':
        return 50;
      case 'file_change':
      case 'cron':
      default:
        return 10;
    }
  }

  /**
   * Indique si un déclencheur doit faire respecter le gate bloquant.
   *
   * Seuls les déclencheurs CI/CD (garde de commit / push) bloquent : un scan
   * `blocked` empêche l'action git. Les scans à la demande (api, cron,
   * file_change) sont informatifs et ne doivent jamais être marqués `blocked`.
   */
  private _isBlockingTrigger(type: TriggerType): boolean {
    return type === 'git_commit' || type === 'pre_push';
  }
}

// Singleton export
export const securityOrchestrator = SecurityOrchestrator.getInstance();
