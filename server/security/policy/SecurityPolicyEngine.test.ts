import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { SecurityPolicyEngine } from './SecurityPolicyEngine.js';

const ROOT = path.resolve(process.cwd());

test('containment: workspace-relative path is allowed', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  const d = engine.canScan('server/security');
  assert.equal(d.effect, 'allow');
  assert.ok(d.target?.startsWith(ROOT));
});

test('containment: empty/dot target resolves to workspace root', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  assert.equal(engine.canScan().effect, 'allow');
  assert.equal(engine.canScan('.').effect, 'allow');
});

test('containment: absolute path is denied', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  assert.equal(engine.canScan('/etc/passwd').effect, 'deny');
  assert.equal(engine.canScan('C:\\Windows\\System32').effect, 'deny');
});

test('containment: parent-directory traversal is denied', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  assert.equal(engine.canScan('../../secret.txt').effect, 'deny');
});

test('canExecute always denies for the security capability', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  assert.equal(engine.canExecute('anything').effect, 'deny');
});

test('canModify/canRemediate denied when read-only (default)', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  assert.equal(engine.canModify('server/x.ts').effect, 'deny');
  assert.equal(engine.canRemediate({ id: 'f1' }).effect, 'deny');
});

test('canModify requires approval when write allowed and inside workspace', () => {
  const engine = new SecurityPolicyEngine(ROOT, { allowWrite: true });
  assert.equal(engine.canModify('server/x.ts').effect, 'approval');
  assert.equal(engine.canRemediate({ id: 'f1' }).effect, 'approval');
});

test('canNetwork toggles with allowNetwork option', () => {
  assert.equal(new SecurityPolicyEngine(ROOT).canNetwork().effect, 'allow');
  assert.equal(new SecurityPolicyEngine(ROOT, { allowNetwork: false }).canNetwork().effect, 'deny');
});

test('DAST target classification', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  assert.equal(engine.classifyDastTarget('http://localhost:3000'), 'localhost');
  assert.equal(engine.classifyDastTarget('127.0.0.1'), 'localhost');
  assert.equal(engine.classifyDastTarget('https://staging.example.com'), 'staging');
  assert.equal(engine.classifyDastTarget('https://www.example.com'), 'production');
  assert.equal(engine.classifyDastTarget('some-internal-host'), 'unknown');
});

test('canRunDast enforces opt-in + classification gates', () => {
  const engine = new SecurityPolicyEngine(ROOT);
  // No opt-in → deny regardless of target
  assert.equal(engine.canRunDast('http://localhost', false).effect, 'deny');
  // localhost + opt-in → allow
  assert.equal(engine.canRunDast('http://localhost:3000', true).effect, 'allow');
  // staging + opt-in → approval
  assert.equal(engine.canRunDast('https://staging.example.com', true).effect, 'approval');
  // production + opt-in → deny
  assert.equal(engine.canRunDast('https://www.example.com', true).effect, 'deny');
  // unknown + opt-in → approval
  assert.equal(engine.canRunDast('internal-box', true).effect, 'approval');
});
