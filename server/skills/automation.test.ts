import test from 'node:test';
import assert from 'node:assert/strict';
import { automationSkill, getScheduledTasksSnapshot, stopAllScheduledTasks } from './automation.js';

test('automationSkill: metadata and tool execution', async () => {
  assert.equal(automationSkill.name, 'automation');
  const declNames = automationSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('automation_navigate'));
  assert.ok(declNames.includes('automation_schedule_task'));

  const snapshot = getScheduledTasksSnapshot();
  assert.ok(Array.isArray(snapshot));

  stopAllScheduledTasks();
  assert.equal(getScheduledTasksSnapshot().length, snapshot.length);
});
