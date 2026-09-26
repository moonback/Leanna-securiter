import test from 'node:test';
import assert from 'node:assert/strict';
import { Executor } from './Executor.js';

test('Executor emits an explicit plan before mission start', async () => {
  const events: string[] = [];
  let plan: Record<string, unknown> | undefined;
  const executor = new Executor();
  executor.setSkillHandler(async () => null);
  executor.setEventEmitter((event, data) => {
    events.push(event);
    if (event === 'mission_plan') plan = data.plan as Record<string, unknown>;
  });

  await executor.startMission({
    title: 'Inspect server.ts',
    description: 'Analyser server.ts et vérifier les conditions de déploiement.',
    availableSkills: [],
  });

  assert.equal(events[0], 'mission_plan');
  assert.equal(events[1], 'mission_started');
  assert.ok(plan);
  for (const key of ['objectives', 'targetedFiles', 'tools', 'risks', 'estimatedTokens', 'stopConditions']) {
    assert.ok(key in plan);
  }
  assert.deepEqual(plan.targetedFiles, ['server.ts']);
});

test('Executor exposes a completion promise for autonomous callers', async () => {
  const executor = new Executor();
  executor.setSkillHandler(async () => null);
  const mission = await executor.startMission({
    title: 'Autonomy completion',
    description: 'Verify that autonomous callers observe a terminal mission state.',
    availableSkills: [],
  });

  const completed = await executor.waitForMission(mission.id);
  assert.ok(completed);
  assert.ok(['completed', 'failed'].includes(completed.status));
  const learning = executor.getLearningResult(mission.id);
  assert.ok(learning, 'terminal missions should produce reviewable learning proposals');
  assert.deepEqual(learning.improvementsApplied, [], 'mission finalization must not auto-apply learning proposals');
});
