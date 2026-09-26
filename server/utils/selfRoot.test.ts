import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SELF_ROOT,
  normalizeSelfPath,
  isWriteForbidden,
  isCriticalFile,
  resolveRealPathWithinSelf,
  auditSymlinks,
  setSelfRoot,
  validateWorkspacePath,
  listWorkspaces,
  addOrUpdateWorkspace,
  removeWorkspace,
  updateWorkspaceMeta,
} from './selfRoot.js';

// Ensure SELF_ROOT is initialised — needed in test environments where no
// project has been persisted yet. Walk up from server/utils/ to project root.
{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname_local = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname_local, '..', '..');
  setSelfRoot(projectRoot);
}

test('selfRoot: root value and normalization', () => {
  assert.ok(typeof SELF_ROOT === 'string');

  // Should successfully normalize relative paths within root
  const normalPath = normalizeSelfPath('package.json');
  assert.ok(normalPath);
  assert.ok(normalPath.startsWith(SELF_ROOT));

  // Should reject paths attempting to escape root
  const escapedPath = normalizeSelfPath('../outside-folder');
  assert.equal(escapedPath, null);
});

test('selfRoot: critical and forbidden check', () => {
  // Critical files require confirmation
  assert.equal(isCriticalFile(path.resolve(SELF_ROOT, 'server.ts')), true);
  assert.equal(isCriticalFile(path.resolve(SELF_ROOT, '.env')), true);
  assert.equal(isCriticalFile(path.resolve(SELF_ROOT, 'random.ts')), false);

  // Forbidden files completely blocked
  assert.equal(isWriteForbidden(path.resolve(SELF_ROOT, '.git/config')), true);
  assert.equal(isWriteForbidden(path.resolve(SELF_ROOT, 'node_modules/some-lib')), true);
  assert.equal(isWriteForbidden(path.resolve(SELF_ROOT, 'src/App.tsx')), false);
});

test('selfRoot: resolveRealPathWithinSelf', async () => {
  const result = await resolveRealPathWithinSelf(path.resolve(SELF_ROOT, 'package.json'));
  assert.ok(result);
  assert.ok(result.startsWith(SELF_ROOT));
});

test('selfRoot: auditSymlinks', async () => {
  const result = await auditSymlinks();
  assert.ok(Array.isArray(result));
});

test('selfRoot: validateWorkspacePath security checks', async () => {
  // Valid current repo directory
  const validRes = await validateWorkspacePath(SELF_ROOT);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.hasPackageJson, true);
  assert.equal(validRes.isGit, true);

  // Non-existent directory
  const invalidRes = await validateWorkspacePath(path.join(SELF_ROOT, 'non-existent-directory-xyz-123'));
  assert.equal(invalidRes.valid, false);
  assert.ok(invalidRes.error?.includes('n\'existe pas'));

  // Empty string
  const emptyRes = await validateWorkspacePath('');
  assert.equal(emptyRes.valid, false);

  // Prohibited system root paths
  const systemPaths = process.platform === 'win32'
    ? ['C:\\', 'C:\\Windows', 'C:\\Program Files']
    : ['/', '/etc', '/sys', '/proc'];

  for (const sysPath of systemPaths) {
    const sysRes = await validateWorkspacePath(sysPath);
    assert.equal(sysRes.valid, false);
    assert.ok(sysRes.error?.includes('répertoire système') || sysRes.error?.includes('interdit') || sysRes.error?.includes('protégé'));
  }
});

test('selfRoot: multi-workspace registry management', () => {
  const testWorkspacePath = path.resolve(SELF_ROOT, 'server');
  const entry = addOrUpdateWorkspace(testWorkspacePath, 'https://example.com', 'Custom Test Workspace');

  assert.ok(entry.id);
  assert.equal(entry.name, 'Custom Test Workspace');
  assert.equal(entry.siteUrl, 'https://example.com');
  assert.equal(entry.path, testWorkspacePath);

  // Listing includes added workspace
  const list = listWorkspaces();
  assert.ok(list.some(w => w.id === entry.id || w.path === testWorkspacePath));

  // Update workspace metadata
  const updated = updateWorkspaceMeta(entry.id, { name: 'Renamed Test Workspace', siteUrl: 'https://updated.com' });
  assert.ok(updated);
  assert.equal(updated.name, 'Renamed Test Workspace');
  assert.equal(updated.siteUrl, 'https://updated.com');

  // Remove workspace
  const removed = removeWorkspace(entry.id);
  assert.equal(removed, true);
  const afterRemoveList = listWorkspaces();
  assert.ok(!afterRemoveList.some(w => w.id === entry.id));
});

