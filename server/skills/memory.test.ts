import test from 'node:test';
import assert from 'node:assert/strict';
import { memorySkill } from './memory.js';

test('memorySkill: metadata', () => {
  assert.equal(memorySkill.name, 'memory');
  const declNames = memorySkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('save_memory'));
  assert.ok(declNames.includes('search_memory'));
});
