import fs from 'node:fs';
import path from 'node:path';
import { SELF_ROOT } from './utils/selfRoot.js';

export interface AuditEvent {
  timestamp: string;
  action: string;
  target: string;
  details?: string;
  actor?: string;
  /** Diff sommaire (première ligne de changement) — enrichi Phase 4 */
  diff?: string;
}

export async function appendAuditEvent(event: Omit<AuditEvent, 'timestamp'> & { logPath?: string }) {
  const logPath = event.logPath || path.join(SELF_ROOT, '.Leanna-audit.log');
  const safeEvent: AuditEvent = {
    timestamp: new Date().toISOString(),
    action: event.action,
    target: event.target,
    details: event.details,
    actor: event.actor || 'system',
    diff: event.diff,
  };

  const serialized = JSON.stringify(safeEvent) + '\n';
  await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
  await fs.promises.appendFile(logPath, serialized, 'utf8');
  return safeEvent;
}

/**
 * Génère un diff sommaire entre l'ancien et le nouveau contenu.
 * Retourne les premières lignes modifiées (max 500 chars) pour l'audit.
 */
export function generateDiffSummary(before: string | null, after: string | null, maxLength = 500): string {
  if (!before && after) return `[NEW] ${after.slice(0, maxLength)}`;
  if (before && !after) return `[DELETED] ${before.slice(0, maxLength)}`;
  if (!before || !after) return '[EMPTY]';

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const changes: string[] = [];
  const maxCheck = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxCheck && changes.length < 5; i++) {
    const bLine = beforeLines[i] || '';
    const aLine = afterLines[i] || '';
    if (bLine !== aLine) {
      if (bLine && !aLine) changes.push(`-L${i + 1}: ${bLine.trim().slice(0, 80)}`);
      else if (!bLine && aLine) changes.push(`+L${i + 1}: ${aLine.trim().slice(0, 80)}`);
      else changes.push(`~L${i + 1}: ${aLine.trim().slice(0, 80)}`);
    }
  }

  const summary = changes.join(' | ');
  return summary.length > maxLength ? summary.slice(0, maxLength) + '…' : summary;
}

export async function readAuditEntries(logPath: string, limit = 50): Promise<AuditEvent[]> {
  try {
    await fs.promises.access(logPath);
  } catch {
    return [];
  }
  const raw = await fs.promises.readFile(logPath, 'utf8');
  const lines = raw.trim().split(/\n+/).filter(Boolean);
  return lines.slice(-limit).map(line => JSON.parse(line) as AuditEvent);
}


export async function analyzeAuditLog(logPath: string, actionFilter?: string): Promise<Record<string, number>> {
  const events = await readAuditEntries(logPath, 1000);
  const analysis: Record<string, number> = {};

  events.forEach(event => {
    if (actionFilter && event.action !== actionFilter) return;
    const key = `${event.action} on ${event.target}`;
    analysis[key] = (analysis[key] || 0) + 1;
  });

  return analysis;
}
