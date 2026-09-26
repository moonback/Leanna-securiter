/**
 * securityApi.ts
 * Frontend service that bridges the Security Console UI to the
 * SecurityOrchestrator REST endpoints.
 *
 * All methods accept an optional AbortSignal for cancellation.
 */

import type { FindingCardData, FindingStatus, ScannerCategory } from '../components/security/FindingCard.js';
import type { SbomEntry } from '../components/security/SbomTable.js';
import type { SurfaceGraph } from '../components/security/AttackSurfaceGraph.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE = '/api/security';

// ─── DTOs (matching backend ScanExecutionResult) ──────────────────────────────

export interface ScanStatus {
  isScanning: boolean;
  queueStats: { queued: number; active: number; activeTargets: string[] };
  findingStats: {
    total: number; open: number; confirmed: number;
    falsePositive: number; fixed: number; ignored: number;
    critical: number; high: number; cisaKev: number;
  };
  cacheSize: number;
  lastScan: {
    scanId: string;
    status: 'completed' | 'blocked' | 'failed' | 'in_progress';
    profile: string;
    endTime?: string;
    findingsCount: { total: number; critical: number; high: number; medium: number; low: number; info: number };
  } | null;
}

export interface ScanStartRequest {
  targetDir: string;
  profile?: 'quick' | 'standard' | 'full' | 'custom';
  triggerType?: 'api' | 'git_commit' | 'pre_push' | 'cron' | 'file_change';
  changedFiles?: string[];
  policyOverride?: {
    blockingSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
    maxFilesTotal?: number;
    excludePaths?: string[];
  };
}

export interface ScanResult {
  scanId: string;
  targetPath: string;
  profile: string;
  triggerType: string;
  status: 'completed' | 'blocked' | 'failed' | 'in_progress';
  blockingReason?: string;
  startTime: string;
  endTime?: string;
  durationMs: number;
  filesScanned: number;
  filesSkipped: number;
  findingsCount: { total: number; critical: number; high: number; medium: number; low: number; info: number };
  scaOnlineEnrichment: boolean;
  cacheSize: number;
}

export interface FindingFilter {
  status?: FindingStatus | 'all';
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'all';
  scanner?: ScannerCategory | 'all';
  searchQuery?: string;
  cwe?: string;
  cisaKevOnly?: boolean;
}

export interface TriageUpdate {
  status: FindingStatus;
  rationale?: string;
  author?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    signal,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[securityApi] ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const securityApi = {

  /** GET /api/security/status */
  getStatus(signal?: AbortSignal): Promise<ScanStatus> {
    return apiFetch<ScanStatus>('/status', undefined, signal);
  },

  /** POST /api/security/scan — triggers a new scan */
  startScan(req: ScanStartRequest, signal?: AbortSignal): Promise<ScanResult> {
    return apiFetch<ScanResult>('/scan', {
      method: 'POST',
      body: JSON.stringify(req),
    }, signal);
  },

  /** GET /api/security/findings — with optional filters as query params */
  getFindings(filter?: FindingFilter, signal?: AbortSignal): Promise<FindingCardData[]> {
    const params = new URLSearchParams();
    if (filter?.status && filter.status !== 'all')   params.set('status',   filter.status);
    if (filter?.severity && filter.severity !== 'all') params.set('severity', filter.severity);
    if (filter?.scanner && filter.scanner !== 'all')   params.set('scanner',  filter.scanner);
    if (filter?.searchQuery) params.set('q', filter.searchQuery);
    if (filter?.cwe)         params.set('cwe', filter.cwe);
    if (filter?.cisaKevOnly) params.set('kevOnly', 'true');
    const qs = params.toString();
    return apiFetch<FindingCardData[]>(`/findings${qs ? '?' + qs : ''}`, undefined, signal);
  },

  /** GET /api/security/findings/:id */
  getFinding(id: string, signal?: AbortSignal): Promise<FindingCardData> {
    return apiFetch<FindingCardData>(`/findings/${id}`, undefined, signal);
  },

  /** PATCH /api/security/findings/:id/status */
  updateFindingStatus(id: string, update: TriageUpdate, signal?: AbortSignal): Promise<FindingCardData> {
    return apiFetch<FindingCardData>(`/findings/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }, signal);
  },

  /** GET /api/security/sbom */
  getSbom(signal?: AbortSignal): Promise<SbomEntry[]> {
    return apiFetch<SbomEntry[]>('/sbom', undefined, signal);
  },

  /** GET /api/security/attack-surface */
  getAttackSurface(signal?: AbortSignal): Promise<SurfaceGraph> {
    return apiFetch<SurfaceGraph>('/attack-surface', undefined, signal);
  },

  /** GET /api/security/sarif — SARIF 2.1.0 report */
  downloadSarif(signal?: AbortSignal): Promise<Blob> {
    return fetch(BASE + '/sarif', { signal })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error('SARIF download failed')));
  },

  /** GET /api/security/sbom/cyclonedx */
  downloadCycloneDx(signal?: AbortSignal): Promise<Blob> {
    return fetch(BASE + '/sbom/cyclonedx', { signal })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error('CycloneDX download failed')));
  },

  /** GET /api/security/triage-audit/:findingId — triage history */
  getTriageAuditLog(findingId?: string, signal?: AbortSignal) {
    const path = findingId ? `/triage-audit/${findingId}` : '/triage-audit';
    return apiFetch<unknown[]>(path, undefined, signal);
  },
};
