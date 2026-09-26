import test from 'node:test';
import assert from 'node:assert/strict';
import { historySkill } from './history.js';

test('historySkill: metadata', () => {
  assert.equal(historySkill.name, 'history');
  const declNames = historySkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('search_history'));
  assert.ok(declNames.includes('get_conversation_context'));
});
