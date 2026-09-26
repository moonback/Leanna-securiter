import test from 'node:test';
import assert from 'node:assert/strict';
import { timeSkill } from './time.js';

test('timeSkill: get_current_time returns time and date', async () => {
  assert.equal(timeSkill.name, 'time');
  const result: any = await timeSkill.handleToolCall('get_current_time', {});
  assert.ok(result.time);
  assert.ok(result.date);
});
