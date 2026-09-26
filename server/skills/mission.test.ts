import test from 'node:test';
import assert from 'node:assert/strict';
import { missionSkill, updateMissionSkills } from './mission.js';

test('missionSkill: metadata and skills update', () => {
  assert.equal(missionSkill.name, 'mission');
  const declNames = missionSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('mission_create'));
  assert.ok(declNames.includes('mission_status'));

  assert.doesNotThrow(() => {
    updateMissionSkills(['skill1', 'skill2']);
  });
});
