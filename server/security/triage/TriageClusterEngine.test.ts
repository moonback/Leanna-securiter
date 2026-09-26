import assert from 'node:assert/strict';
import test from 'node:test';
import { TriageClusterEngine, rootCauseKeyFor } from './TriageClusterEngine.js';
import type { Finding } from '../findings/Finding.js';

function makeFinding(partial: Partial<Finding>): Finding {
  return {
    id: partial.id ?? 'f-' + Math.random().toString(36).slice(2),
    fingerprint: partial.fingerprint ?? 'fp-' + Math.random().toString(36).slice(2),
    ruleId: partial.ruleId ?? 'RULE',
    ruleName: partial.ruleName ?? 'rule',
    title: partial.title ?? 'title',
    description: 'desc',
    severity: partial.severity ?? 'high',
    status: partial.status ?? 'open',
    scanner: partial.scanner ?? 'sast',
    cwe: partial.cwe ?? [],
    owasp: partial.owasp ?? [],
    location: partial.location ?? { filePath: 'server/routes/x.ts', startLine: 1 },
    cvssScore: 5,
    firstSeen: '',
    lastSeen: '',
    ...partial,
  } as Finding;
}

test('rootCauseKeyFor groups by CWE and directory for SAST', () => {
  const a = makeFinding({ cwe: ['CWE-89'], location: { filePath: 'server/routes/a.ts', startLine: 1 } });
  const b = makeFinding({ cwe: ['CWE-89'], location: { filePath: 'server/routes/b.ts', startLine: 9 } });
  const c = makeFinding({ cwe: ['CWE-89'], location: { filePath: 'src/x.ts', startLine: 1 } });
  assert.equal(rootCauseKeyFor(a), rootCauseKeyFor(b)); // same CWE + same dir
  assert.notEqual(rootCauseKeyFor(a), rootCauseKeyFor(c)); // different dir
});

test('cluster merges same root cause and keeps distinct ones apart', () => {
  const engine = new TriageClusterEngine();
  const findings = [
    makeFinding({ id: '1', cwe: ['CWE-89'], location: { filePath: 'server/routes/a.ts', startLine: 1 } }),
    makeFinding({ id: '2', cwe: ['CWE-89'], location: { filePath: 'server/routes/b.ts', startLine: 2 } }),
    makeFinding({ id: '3', scanner: 'secrets', ruleId: 'AWS_KEY' }),
  ];
  const report = engine.cluster(findings);
  assert.equal(report.totalFindings, 3);
  assert.equal(report.clusterCount, 2); // two CWE-89 merge, secret stands alone
  const sqlCluster = report.clusters.find((c) => c.dominantCwe === 'CWE-89');
  assert.equal(sqlCluster?.size, 2);
  assert.equal(sqlCluster?.affectedFiles.length, 2);
});

test('risk score elevates KEV/confirmed clusters above nominal severity', () => {
  const engine = new TriageClusterEngine();
  const plain = engine.cluster([
    makeFinding({ id: 'p', severity: 'high', cwe: ['CWE-79'], location: { filePath: 'a/x.ts', startLine: 1 } }),
  ]).clusters[0];
  const exploited = engine.cluster([
    makeFinding({ id: 'k', severity: 'high', cwe: ['CWE-79'], cisaKev: true, status: 'confirmed', location: { filePath: 'a/x.ts', startLine: 1 } }),
  ]).clusters[0];
  assert.ok(exploited.riskScore > plain.riskScore);
  assert.ok(exploited.hasKev);
  assert.ok(exploited.hasConfirmed);
});

test('cluster output is deterministic and sorted by risk desc', () => {
  const engine = new TriageClusterEngine();
  const findings = [
    makeFinding({ id: '1', severity: 'low', cwe: ['CWE-200'], location: { filePath: 'a/x.ts', startLine: 1 } }),
    makeFinding({ id: '2', severity: 'critical', cwe: ['CWE-89'], location: { filePath: 'b/y.ts', startLine: 1 } }),
  ];
  const r1 = engine.cluster(findings);
  const r2 = engine.cluster(findings);
  assert.deepEqual(r1.clusters.map((c) => c.id), r2.clusters.map((c) => c.id));
  // Highest risk first.
  assert.ok(r1.clusters[0].riskScore >= r1.clusters[1].riskScore);
  assert.equal(r1.summary.topClusterId, r1.clusters[0].id);
});
