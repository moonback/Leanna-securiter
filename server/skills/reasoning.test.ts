import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningSkill } from './reasoning.js';

test('reasoningSkill: metadata', () => {
  assert.equal(reasoningSkill.name, 'reasoning');
  const declNames = reasoningSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('reasoning_think'));
});
