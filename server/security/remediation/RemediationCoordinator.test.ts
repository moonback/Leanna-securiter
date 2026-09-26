import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  RemediationCoordinator,
  type AuditPort,
  type RemediationApplierPort,
  type TestPort,
  type RemediationPorts,
} from './RemediationCoordinator.js';
import { SecurityPolicyEngine } from '../policy/SecurityPolicyEngine.js';
import type { Finding } from '../findings/Finding.js';

const ROOT = path.resolve(process.cwd());

function makeFinding(id: string, severity: Finding['severity'] = 'high'): Finding {
  return {
    id, fingerprint: 'fp-' + id, ruleId: 'RULE', ruleName: 'r', title: 't', description: 'd',
    severity, status: 'open', scanner: 'sast', cwe: [], owasp: [],
    location: { filePath: 'server/x.ts', startLine: 1 }, cvssScore: 5, firstSeen: '', lastSeen: '',
  } as Finding;
}

/** Ports configurables. auditQueue permits distinct before/after audits. */
function makePorts(auditRuns: Finding[][]): {
  ports: RemediationPorts;
  applied: string[];
  testsRan: () => number;
} {
  let runIdx = 0;
  const applied: string[] = [];
  let testsRunCount = 0;

  const audit: AuditPort = {
    async runAudit() {
      const res = auditRuns[Math.min(runIdx, auditRuns.length - 1)];
      runIdx++;
      return res;
    },
  };
  const applier: RemediationApplierPort = {
    async applyFix(f) {
      applied.push(f.id);
      return { applied: true, detail: 'patched ' + f.id };
    },
  };
  const tests: TestPort = {
    async runTests() {
      testsRunCount++;
      return { passed: true };
    },
  };
  return { ports: { audit, applier, tests }, applied, testsRan: () => testsRunCount };
}

test('no implicit fix: read-only policy blocks all remediation', async () => {
  const { ports, applied } = makePorts([[makeFinding('a')]]);
  const policy = new SecurityPolicyEngine(ROOT); // allowWrite=false by default
  const coord = new RemediationCoordinator(policy, ports);

  const report = await coord.run(
    [{ findingId: 'a', decision: 'confirmed' }],
    [{ findingId: 'a', approvedBy: 'user' }],
  );

  assert.equal(applied.length, 0);
  assert.equal(report.phase, 'blocked');
  const outcome = report.outcomes.find((o) => o.findingId === 'a');
  assert.equal(outcome?.status, 'blocked_policy');
});

test('approval gate: write enabled but no explicit approval blocks the fix', async () => {
  const { ports, applied } = makePorts([[makeFinding('a')]]);
  const policy = new SecurityPolicyEngine(ROOT, { allowWrite: true });
  const coord = new RemediationCoordinator(policy, ports);

  const report = await coord.run(
    [{ findingId: 'a', decision: 'confirmed' }],
    [], // no approvals
  );

  assert.equal(applied.length, 0);
  assert.equal(report.phase, 'blocked');
  assert.equal(report.outcomes.find((o) => o.findingId === 'a')?.status, 'blocked_no_approval');
});

test('confirmed-only: unconfirmed findings are never remediated', async () => {
  const { ports, applied } = makePorts([[makeFinding('a'), makeFinding('b'), makeFinding('c')]]);
  const policy = new SecurityPolicyEngine(ROOT, { allowWrite: true });
  const coord = new RemediationCoordinator(policy, ports);

  const report = await coord.run(
    [
      { findingId: 'a', decision: 'confirmed' },
      { findingId: 'b', decision: 'false_positive' },
      { findingId: 'c', decision: 'accepted_risk' },
    ],
    [{ findingId: 'a', approvedBy: 'user' }],
    { reAudit: false },
  );

  assert.deepEqual(applied, ['a']);
  assert.equal(report.confirmedCount, 1);
  assert.equal(report.outcomes.find((o) => o.findingId === 'b')?.status, 'skipped_not_confirmed');
  assert.equal(report.outcomes.find((o) => o.findingId === 'c')?.status, 'skipped_not_confirmed');
});

test('full loop: remediate then re-audit reports resolved delta', async () => {
  // before: [a, b]  → after: [b]  → a resolved, no regressions
  const { ports, applied } = makePorts([
    [makeFinding('a'), makeFinding('b')],
    [makeFinding('b')],
  ]);
  const policy = new SecurityPolicyEngine(ROOT, { allowWrite: true });
  const coord = new RemediationCoordinator(policy, ports);

  const report = await coord.run(
    [{ findingId: 'a', decision: 'confirmed' }],
    [{ findingId: 'a', approvedBy: 'user' }],
  );

  assert.deepEqual(applied, ['a']);
  assert.equal(report.phase, 'completed');
  assert.equal(report.tests?.passed, true);
  assert.equal(report.reAudit?.before, 2);
  assert.equal(report.reAudit?.after, 1);
  assert.equal(report.reAudit?.resolved, 1);
  assert.equal(report.reAudit?.regressions, 0);
});

test('failing tests after remediation block the loop before re-audit', async () => {
  const { ports } = makePorts([[makeFinding('a')]]);
  // Override tests to fail
  ports.tests.runTests = async () => ({ passed: false, detail: 'unit test X failed' });
  const policy = new SecurityPolicyEngine(ROOT, { allowWrite: true });
  const coord = new RemediationCoordinator(policy, ports);

  const report = await coord.run(
    [{ findingId: 'a', decision: 'confirmed' }],
    [{ findingId: 'a', approvedBy: 'user' }],
  );

  assert.equal(report.phase, 'blocked');
  assert.match(report.blockedReason ?? '', /tests en échec/);
  assert.equal(report.reAudit, undefined);
});

test('empty confirmed set completes cleanly without touching applier', async () => {
  const { ports, applied, testsRan } = makePorts([[makeFinding('a')]]);
  const policy = new SecurityPolicyEngine(ROOT, { allowWrite: true });
  const coord = new RemediationCoordinator(policy, ports);

  const report = await coord.run([{ findingId: 'a', decision: 'false_positive' }], []);

  assert.equal(applied.length, 0);
  assert.equal(testsRan(), 0);
  assert.equal(report.phase, 'completed');
});
