import test from 'node:test';
import assert from 'node:assert/strict';
import { listSkill } from './list.js';

test('listSkill: metadata', () => {
  assert.equal(listSkill.name, 'list');
  const declNames = listSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('list_create'));
  assert.ok(declNames.includes('list_add_item'));
});
