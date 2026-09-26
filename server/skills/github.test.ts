import test from 'node:test';
import assert from 'node:assert/strict';
import { githubSkill } from './github.js';

test('githubSkill: metadata', () => {
  assert.equal(githubSkill.name, 'github');
  const declNames = githubSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('get_github_user'));
  assert.ok(declNames.includes('get_github_repo'));
  assert.ok(declNames.includes('list_github_repo_files'));
  // 'ingest_github_repository' a été retiré : l'agent n'a plus accès aux notebooks.
  assert.ok(!declNames.includes('ingest_github_repository'));
});

test('githubSkill: list_github_repo_files declaration', () => {
  const listFilesDecl = githubSkill.declarations.find((d: any) => d.name === 'list_github_repo_files');
  assert.ok(listFilesDecl);
  assert.equal(listFilesDecl.parameters.properties.owner.type, 'STRING');
  assert.equal(listFilesDecl.parameters.properties.repo.type, 'STRING');
  assert.equal(listFilesDecl.parameters.required[0], 'owner');
  assert.equal(listFilesDecl.parameters.required[1], 'repo');
});

test('githubSkill: ingest_github_repository est retiré (pas d\'accès notebooks)', () => {
  const ingestDecl = githubSkill.declarations.find((d: any) => d.name === 'ingest_github_repository');
  assert.equal(ingestDecl, undefined);
});
