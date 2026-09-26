import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkflow,
  getWorkflow,
  toggleWorkflow,
  deleteWorkflow,
} from './workflow.js';

test('workflow: CRUD operations', async () => {

  const wf = await createWorkflow({
    name: 'Test Workflow',
    description: 'Unit test workflow',
    steps: [
      { id: 's1', action: 'time_get_current_time', args: {} }
    ]
  });

  assert.ok(wf.id);
  assert.equal(wf.name, 'Test Workflow');

  const fetched = getWorkflow(wf.id);
  assert.ok(fetched);
  assert.equal(fetched.name, 'Test Workflow');

  const toggled = await toggleWorkflow(wf.id, false);
  assert.ok(toggled);
  assert.equal(toggled.enabled, false);

  const deleted = await deleteWorkflow(wf.id);
  assert.equal(deleted, true);
  assert.equal(getWorkflow(wf.id), undefined);
});
