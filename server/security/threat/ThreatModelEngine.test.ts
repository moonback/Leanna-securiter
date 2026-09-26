import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverHttpEntryPoints,
  strideForFinding,
  mitreForFinding,
  ThreatModelEngine,
} from './ThreatModelEngine.js';
import type { Finding } from '../findings/Finding.js';

function makeFinding(partial: Partial<Finding>): Finding {
  return {
    id: partial.id ?? 'f-' + Math.random().toString(36).slice(2),
    fingerprint: 'fp',
    ruleId: partial.ruleId ?? 'RULE',
    ruleName: 'rule',
    title: partial.title ?? 'title',
    description: 'desc',
    severity: partial.severity ?? 'high',
    status: 'open',
    scanner: partial.scanner ?? 'sast',
    cwe: partial.cwe ?? [],
    owasp: [],
    location: partial.location ?? { filePath: 'server/routes/x.ts', startLine: 1 },
    cvssScore: 5,
    firstSeen: '',
    lastSeen: '',
    ...partial,
  } as Finding;
}

test('discoverHttpEntryPoints extracts routes from a fixture', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-'));
  const routesDir = path.join(tmp, 'server', 'routes');
  fs.mkdirSync(routesDir, { recursive: true });
  fs.writeFileSync(
    path.join(routesDir, 'sample.ts'),
    `router.get('/users', h);\nrouter.post('/users/:id', h);\nrouter.delete("/users/:id", h);\n`
  );
  // A test file that must be ignored
  fs.writeFileSync(path.join(routesDir, 'sample.test.ts'), `router.get('/ignored', h);`);

  const eps = discoverHttpEntryPoints(routesDir);
  const routes = eps.map((e) => `${e.verb} ${e.route}`);
  assert.ok(routes.includes('GET /users'));
  assert.ok(routes.includes('POST /users/:id'));
  assert.ok(routes.includes('DELETE /users/:id'));
  assert.ok(!routes.some((r) => r.includes('/ignored')));
  assert.equal(eps.find((e) => e.route === '/users/:id')?.parameterized, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('discoverHttpEntryPoints returns empty for missing dir', () => {
  assert.deepEqual(discoverHttpEntryPoints(path.join(os.tmpdir(), 'does-not-exist-xyz')), []);
});

test('strideForFinding maps scanner/CWE to STRIDE categories', () => {
  assert.equal(strideForFinding(makeFinding({ scanner: 'secrets' })), 'information_disclosure');
  assert.equal(strideForFinding(makeFinding({ scanner: 'sca' })), 'elevation_of_privilege');
  assert.equal(strideForFinding(makeFinding({ scanner: 'sast', cwe: ['CWE-89'] })), 'tampering');
  assert.equal(strideForFinding(makeFinding({ scanner: 'sast', cwe: ['CWE-22'] })), 'information_disclosure');
  assert.equal(strideForFinding(makeFinding({ scanner: 'sast', cwe: ['CWE-918'] })), 'information_disclosure');
});

test('ThreatModelEngine.build synthesizes a model with threats per finding', () => {
  const engine = new ThreatModelEngine(path.resolve(process.cwd()));
  const findings = [
    makeFinding({ id: 'a', scanner: 'secrets', severity: 'critical' }),
    makeFinding({ id: 'b', scanner: 'sast', cwe: ['CWE-89'], severity: 'high' }),
  ];
  const model = engine.build(findings);

  assert.equal(model.threats.length, 2);
  assert.equal(model.summary.threatCount, 2);
  assert.equal(model.summary.criticalThreats, 1);
  // secrets finding surfaces the credential asset
  assert.ok(model.assets.some((a) => a.id === 'asset-secrets'));
  // SQL finding is attached to the DB asset
  const sqlThreat = model.threats.find((t) => t.evidenceFindingIds.includes('b'));
  assert.ok(sqlThreat?.affects.includes('asset-db'));
  assert.ok(model.actors.length >= 3);
  assert.ok(model.trustBoundaries.length >= 1);

  // MITRE mapping: SQL injection → T1190, secret → T1552.
  assert.equal(sqlThreat?.mitre?.id, 'T1190');
  const secretThreat = model.threats.find((t) => t.evidenceFindingIds.includes('a'));
  assert.equal(secretThreat?.mitre?.id, 'T1552');
  assert.equal(model.summary.mitreTechniqueCount >= 2, true);

  // STRIDE coverage matrix is present and has one row per entry point.
  assert.equal(Array.isArray(model.strideCoverage), true);
  assert.equal(model.strideCoverage.length, model.entryPoints.length);
});

test('mitreForFinding returns null when no technique clearly applies', () => {
  const f = makeFinding({ scanner: 'sast', cwe: ['CWE-1004'], ruleId: 'MISC' });
  assert.equal(mitreForFinding(f), null);
});
