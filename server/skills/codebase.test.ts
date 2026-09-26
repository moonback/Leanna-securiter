import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { codebaseSkill, buildAnalysisPrompt } from './codebase.js';
import { normalizeProjectPath } from './codebaseHelpers.js';
import { resetSelfRoot, setSelfRoot } from '../utils/selfRoot.js';

test('buildAnalysisPrompt creates a concise analysis prompt for the codebase markdown', () => {
  const codebaseMarkdown = '# Codebase\n\n## Structure\n- src/\n';
  const prompt = buildAnalysisPrompt(codebaseMarkdown);

  assert.match(prompt, /Analyse ce codebase/i);
  assert.match(prompt, /Redige un resume executif/i);
  assert.match(prompt, /Risques/i);
  assert.match(prompt, /Prochaines etapes/i);
});

test('codebaseSkill in no-workspace mode (SELF_ROOT = "") does not leak process.cwd()', async () => {
  resetSelfRoot();

  // normalizeProjectPath must return null (not process.cwd()!)
  assert.equal(normalizeProjectPath('package.json'), null);
  assert.equal(normalizeProjectPath('.'), null);

  // get_workspace_info must report no_workspace and empty detectedConfigFiles
  const info = await codebaseSkill.handleToolCall('get_workspace_info', {}) as any;
  assert.equal(info.status, 'no_workspace');
  assert.equal(info.workspace, null);
  assert.equal(info.exists, false);
  assert.deepEqual(info.detectedConfigFiles, []);

  // file reader tools must reject cleanly
  const listResult = await codebaseSkill.handleToolCall('list_project_files', {}) as any;
  assert.ok(listResult.error, 'list_project_files should return an error when no workspace is open');
  assert.match(listResult.error, /Aucun workspace ouvert/i);

  const readResult = await codebaseSkill.handleToolCall('read_project_file', { path: 'package.json' }) as any;
  assert.ok(readResult.error, 'read_project_file should return an error when no workspace is open');
  assert.match(readResult.error, /Aucun workspace ouvert/i);
});

test('codebaseSkill with active workspace detects config files properly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Leanna-ws-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test-app"}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    setSelfRoot(tmpDir);

    const info = await codebaseSkill.handleToolCall('get_workspace_info', {}) as any;
    assert.equal(info.status, 'success');
    assert.equal(info.exists, true);
    assert.ok(info.detectedConfigFiles.includes('package.json'));
    assert.ok(info.detectedConfigFiles.includes('tsconfig.json'));
    assert.ok(!info.detectedConfigFiles.includes('.env'));
  } finally {
    resetSelfRoot();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

