/**
 * ScanPolicy — Politique et profils d'analyse de sécurité (ex-AutonomyPolicy)
 * 
 * Définit :
 * - Les profils d'analyse (quick, standard, full, custom)
 * - Les exclusions de fichiers et répertoires
 * - Les seuils de sévérité bloquants (pour CI/CD / PR gates)
 * - Les plafonds de taille de fichier et de timeouts
 */

import type { FindingSeverity } from '../findings/Finding.js';

export type ScanProfileType = 'quick' | 'standard' | 'full' | 'custom';

export interface ScannerSelection {
  sast: boolean;
  sca: boolean;
  secrets: boolean;
  iac: boolean;
  dast: boolean;
}

export interface ScanPolicyConfig {
  profile: ScanProfileType;
  scanners: ScannerSelection;
  excludePaths: string[];
  maxFileSize: number; // en octets (défaut: 1_000_000 = 1Mo)
  maxFilesTotal: number;
  timeoutMs: number;
  blockingSeverity: FindingSeverity; // seuil provoquant l'échec du scan
  incrementalOnly?: boolean; // si true, n'analyse que les fichiers modifiés depuis le dernier commit
}

export const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  '.gemini',
  '.agents',
  'dist',
  'build',
  'release',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '*.min.js',
  '*.bundle.js',
];

export const PRESET_PROFILES: Record<ScanProfileType, Omit<ScanPolicyConfig, 'profile'>> = {
  quick: {
    scanners: { sast: true, sca: false, secrets: true, iac: false, dast: false },
    excludePaths: [...DEFAULT_EXCLUDES],
    maxFileSize: 500_000,
    maxFilesTotal: 200,
    timeoutMs: 30_000,
    blockingSeverity: 'critical',
    incrementalOnly: true,
  },
  standard: {
    scanners: { sast: true, sca: true, secrets: true, iac: true, dast: false },
    excludePaths: [...DEFAULT_EXCLUDES],
    maxFileSize: 1_000_000,
    maxFilesTotal: 1_000,
    timeoutMs: 120_000,
    blockingSeverity: 'high',
    incrementalOnly: false,
  },
  full: {
    scanners: { sast: true, sca: true, secrets: true, iac: true, dast: true },
    excludePaths: [...DEFAULT_EXCLUDES],
    maxFileSize: 2_000_000,
    maxFilesTotal: 5_000,
    timeoutMs: 300_000,
    blockingSeverity: 'medium',
    incrementalOnly: false,
  },
  custom: {
    scanners: { sast: true, sca: true, secrets: true, iac: true, dast: false },
    excludePaths: [...DEFAULT_EXCLUDES],
    maxFileSize: 1_000_000,
    maxFilesTotal: 1_000,
    timeoutMs: 120_000,
    blockingSeverity: 'high',
    incrementalOnly: false,
  },
};

export class ScanPolicy {
  private config: ScanPolicyConfig;

  constructor(custom?: Partial<ScanPolicyConfig>) {
    const baseProfile = custom?.profile ?? 'standard';
    const preset = PRESET_PROFILES[baseProfile];

    this.config = {
      profile: baseProfile,
      scanners: custom?.scanners ?? { ...preset.scanners },
      excludePaths: custom?.excludePaths ? [...DEFAULT_EXCLUDES, ...custom.excludePaths] : [...preset.excludePaths],
      maxFileSize: custom?.maxFileSize ?? preset.maxFileSize,
      maxFilesTotal: custom?.maxFilesTotal ?? preset.maxFilesTotal,
      timeoutMs: custom?.timeoutMs ?? preset.timeoutMs,
      blockingSeverity: custom?.blockingSeverity ?? preset.blockingSeverity,
      incrementalOnly: custom?.incrementalOnly ?? preset.incrementalOnly,
    };
  }

  public getConfig(): ScanPolicyConfig {
    return { ...this.config };
  }

  public isScannerActive(scanner: keyof ScannerSelection): boolean {
    return !!this.config.scanners[scanner];
  }

  public isPathExcluded(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return this.config.excludePaths.some((ex) => {
      const normEx = ex.replace(/\\/g, '/');
      return normalized.includes(normEx) || (normEx.startsWith('*.') && normalized.endsWith(normEx.slice(1)));
    });
  }

  public isBlocking(severity: FindingSeverity): boolean {
    const SEV_WEIGHT: Record<FindingSeverity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      info: 0,
    };

    return SEV_WEIGHT[severity] >= SEV_WEIGHT[this.config.blockingSeverity];
  }
}
