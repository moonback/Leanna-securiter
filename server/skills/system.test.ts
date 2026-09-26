import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNpmExecution, systemSkill } from './system.js';

test('systemSkill: metadata', () => {
  assert.equal(systemSkill.name, 'system');
  const declNames = systemSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('system_info'));
  assert.ok(declNames.includes('system_execute_command'));
});

test('npm execution policy distinguishes known-safe project scripts', () => {
  assert.equal(classifyNpmExecution(['npm', 'run', 'test']), 'known-safe-project');
  assert.equal(classifyNpmExecution(['npm', 'run', 'build']), 'known-safe-project');
  assert.equal(classifyNpmExecution(['npm', 'run', 'typecheck']), 'known-safe-project');
  assert.equal(classifyNpmExecution(['npm', 'run', 'release']), 'arbitrary-script');
  assert.equal(classifyNpmExecution(['npm', 'ls']), 'read-only');
});
