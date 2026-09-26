import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { SecurityGraph } from './SecurityGraph.js';
import { ThreatModelEngine } from '../threat/ThreatModelEngine.js';
import type { Finding } from '../findings/Finding.js';
import type { AttackSurfaceGraph } from '../orchestrator/SecurityOrchestrator.js';

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

function surface(): AttackSurfaceGraph {
  return {
    nodes: [
      { id: 'ep-api-routes', label: 'API', type: 'entrypoint', riskScore: 50, vulnCount: 1 },
      { id: 'srv-orchestrator', label: 'Orchestrator', type: 'service', riskScore: 10, vulnCount: 0 },
      { id: 'db-sqlite-local', label: 'DB', type: 'database', riskScore: 40, vulnCount: 1 },
      { id: 'fs-workspace-sandbox', label: 'FS', type: 'storage', riskScore: 0, vulnCount: 0 },
      { id: 'ext-llm-providers', label: 'LLM', type: 'external', riskScore: 0, vulnCount: 0 },
      { id: 'srv-agent-runtime', label: 'Runtime', type: 'service', riskScore: 0, vulnCount: 0 },
      { id: 'ep-websocket', label: 'WS', type: 'entrypoint', riskScore: 0, vulnCount: 0 },
    ],
    edges: [
      { source: 'ep-api-routes', target: 'srv-orchestrator', tainted: true },
      { source: 'srv-orchestrator', target: 'db-sqlite-local', tainted: true },
      { source: 'srv-agent-runtime', target: 'fs-workspace-sandbox', tainted: false },
    ],
    summary: { totalEntrypoints: 2, criticalPaths: 2, exposureIndex: 40 },
  };
}

function build(findings: Finding[]) {
  const threatModel = new ThreatModelEngine(path.resolve(process.cwd())).build(findings);
  return SecurityGraph.build({ findings, attackSurface: surface(), threatModel });
}

test('SecurityGraph fuses findings, surface and threat nodes', () => {
  const findings = [
    makeFinding({ id: 'sql', ruleId: 'CWE-89', scanner: 'sast', severity: 'critical' }),
    makeFinding({ id: 'sec', scanner: 'secrets', severity: 'high' }),
  ];
  const g = build(findings);

  assert.equal(g.getNodes('finding').length, 2);
  assert.equal(g.getNodes('threat').length, 2);
  assert.ok(g.getNodes('surface').length >= 5);
  assert.ok(g.getNodes('asset').length >= 4);

  // The SQL finding must be located on the DB surface node.
  const located = g.getEdges('locatedOn').find((e) => e.source === 'finding:sql');
  assert.equal(located?.target, 'db-sqlite-local');

  // Threats must be evidenced by their findings.
  assert.ok(g.getEdges('evidencedBy').some((e) => e.target === 'finding:sql'));
});

test('SecurityGraph edges only connect existing nodes', () => {
  const g = build([makeFinding({ id: 'a', scanner: 'sast' })]);
  for (const e of g.getEdges()) {
    assert.ok(g.getNode(e.source), `source ${e.source} exists`);
    assert.ok(g.getNode(e.target), `target ${e.target} exists`);
  }
});

test('topRiskNodes returns highest-risk nodes first', () => {
  const g = build([
    makeFinding({ id: 'crit', severity: 'critical' }),
    makeFinding({ id: 'low', severity: 'low' }),
  ]);
  const top = g.topRiskNodes(3, 'finding');
  assert.equal(top[0].attributes.severity, 'critical');
});

test('neighbors and toJSON summary are consistent', () => {
  const g = build([makeFinding({ id: 'sql', ruleId: 'CWE-89', scanner: 'sast' })]);
  const json = g.toJSON();
  assert.equal(json.summary.nodeCount, json.nodes.length);
  assert.equal(json.summary.edgeCount, json.edges.length);
  assert.ok(json.summary.byType.finding >= 1);

  // The DB surface node should have the SQL finding as a neighbor.
  const dbNeighbors = g.neighbors('db-sqlite-local').map((n) => n.id);
  assert.ok(dbNeighbors.includes('finding:sql'));
});
