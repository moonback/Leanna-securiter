import test from 'node:test';
import assert from 'node:assert/strict';
import { guidelinesSkill, getSystemGuidelines } from './guidelines.js';

test('guidelinesSkill: returns system guidelines', () => {
  const system = getSystemGuidelines();
  assert.ok(system.priorities.includes('Security'));
  assert.ok(system.selfModificationProtocol.includes('Source Code Self-Modification'));

  assert.equal(guidelinesSkill.name, 'guidelines');
  const declNames = guidelinesSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('get_project_standards'));
  assert.ok(declNames.includes('get_all_guidelines'));
});
