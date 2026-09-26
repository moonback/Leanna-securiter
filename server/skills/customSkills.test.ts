import test from 'node:test';
import assert from 'node:assert/strict';
import { customSkillsManagementSkill, invalidateCustomSkillsCache } from './customSkills.js';

test('customSkillsManagementSkill: metadata and cache invalidation', () => {
  assert.equal(customSkillsManagementSkill.name, 'custom_skills_management');
  const declNames = customSkillsManagementSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('list_custom_skills'));
  assert.ok(declNames.includes('create_custom_skill'));

  assert.doesNotThrow(() => {
    invalidateCustomSkillsCache();
  });
});
