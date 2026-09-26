import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SecurityPostureTracker,
  computePostureScore,
  type SeverityCounts,
} from './SecurityPostureTracker.js';
import type { ScanExecutionResult } from '../orchestrator/SecurityOrchestrator.js';

function counts(partial: Partial<SeverityCounts>): SeverityCounts {
  return { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, ...partial };
}

function scanResult(c: SeverityCounts, scanId = 'scan', endTime = new Date().toISOString()): ScanExecutionResult {
  return {
    scanId, targetPath: '.', profile: 'standard', triggerType: 'api', status: 'completed',
    startTime: '', endTime, durationMs: 1, filesScanned: 0, filesSkipped: 0,
    findingsCount: c, findings: [], sbomComponents: [], scaOnlineEnrichment: false, cacheSize: 0,
  };
}

test('computePostureScore: clean project scores 100', () => {
  assert.equal(computePostureScore(counts({})), 100);
});

test('computePostureScore: severities reduce the score and floor at 0', () => {
  assert.equal(computePostureScore(counts({ high: 1, total: 1 })), 88); // 100 - 12
  assert.equal(computePostureScore(counts({ critical: 1, total: 1 })), 75); // 100 - 25
  // Many criticals floor at 0, never negative.
  assert.equal(computePostureScore(counts({ critical: 10, total: 10 })), 0);
});

test('recordFromScan derives a snapshot with score', () => {
  const t = new SecurityPostureTracker();
  const snap = t.recordFromScan(scanResult(counts({ high: 1, total: 1 }), 's1'));
  assert.equal(snap.scanId, 's1');
  assert.equal(snap.score, 88);
  assert.equal(t.size(), 1);
  assert.equal(t.latest()?.scanId, 's1');
});

test('trend: improving when score rises beyond the stable band', () => {
  const t = new SecurityPostureTracker();
  t.recordFromScan(scanResult(counts({ critical: 1, total: 1 }), 's1')); // score 75
  t.recordFromScan(scanResult(counts({ total: 0 }), 's2'));              // score 100
  const tr = t.trend();
  assert.equal(tr.trend, 'improving');
  assert.equal(tr.scoreDelta, 25);
  assert.equal(tr.totalDelta, -1);
});

test('trend: regressing when score drops beyond the stable band', () => {
  const t = new SecurityPostureTracker();
  t.recordFromScan(scanResult(counts({ total: 0 }), 's1'));               // 100
  t.recordFromScan(scanResult(counts({ critical: 1, total: 1 }), 's2'));  // 75
  const tr = t.trend();
  assert.equal(tr.trend, 'regressing');
  assert.equal(tr.scoreDelta, -25);
});

test('trend: stable within the band and with insufficient history', () => {
  const t = new SecurityPostureTracker();
  assert.equal(t.trend().trend, 'stable'); // no snapshots
  t.recordFromScan(scanResult(counts({ low: 1, total: 1 }), 's1')); // 99
  assert.equal(t.trend().trend, 'stable'); // only one snapshot
  t.recordFromScan(scanResult(counts({ low: 2, total: 2 }), 's2')); // 98, delta -1 within band
  assert.equal(t.trend().trend, 'stable');
});

test('ring buffer keeps only the most recent N snapshots', () => {
  const t = new SecurityPostureTracker(3);
  for (let i = 0; i < 5; i++) {
    t.recordFromScan(scanResult(counts({ total: i }), 's' + i));
  }
  assert.equal(t.size(), 3);
  const ids = t.list().map((s) => s.scanId);
  assert.deepEqual(ids, ['s2', 's3', 's4']);
});

test('maxSnapshots < 1 is rejected', () => {
  assert.throws(() => new SecurityPostureTracker(0));
});
