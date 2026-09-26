import test from 'node:test';
import assert from 'node:assert/strict';
import { gitSkill, invalidateGitStatusCache } from './git.js';

test('gitSkill: metadata and cache invalidation', () => {
  assert.equal(gitSkill.name, 'git');
  const declNames = gitSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('git_status'));
  assert.ok(declNames.includes('git_diff'));

  assert.doesNotThrow(() => {
    invalidateGitStatusCache();
  });
});
