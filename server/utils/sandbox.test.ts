import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { setSelfRoot } from './selfRoot.js';
import {
  getSandboxRoot,
  isSandboxActive,
  getSandboxModifiedFiles,
  markFileModified,
  resolveSandboxPath,
  activateSandbox,
  deactivateSandbox,
  getSandboxStatus,
} from './sandbox.js';

// Ensure SELF_ROOT is set before sandbox functions are exercised.
// sandbox.ts reads SELF_ROOT dynamically at call-time, so setting it here
// (before any test runs) is sufficient.
{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname_local = path.dirname(__filename);
  setSelfRoot(path.resolve(__dirname_local, '..', '..'));
}

test('sandbox: state management and path resolution', () => {
  const root = getSandboxRoot();
  assert.ok(root.includes('sandbox'));

  activateSandbox();
  assert.equal(isSandboxActive(), true);

  const sandboxTestPath = resolveSandboxPath('server/test.ts');
  assert.ok(sandboxTestPath);
  fs.mkdirSync(path.dirname(sandboxTestPath), { recursive: true });
  fs.writeFileSync(sandboxTestPath, '// sandbox-only change\n', 'utf-8');
  markFileModified('server/test.ts');
  const modified = getSandboxModifiedFiles();
  assert.ok(modified.includes('server/test.ts'));

  fs.rmSync(sandboxTestPath, { force: true });
  markFileModified('server/test.ts');
  assert.ok(!getSandboxModifiedFiles().includes('server/test.ts'));

  deactivateSandbox();
  assert.equal(isSandboxActive(), false);
  assert.throws(() => markFileModified('server/blocked.ts'), { name: 'SandboxGuardError' });

  const validPath = resolveSandboxPath('server/test.ts');
  assert.ok(validPath !== null);
  assert.ok(validPath.startsWith(root));

  const invalidPath = resolveSandboxPath('../../outside.ts');
  assert.equal(invalidPath, null);

  const status = getSandboxStatus();
  assert.ok('active' in status);
  assert.ok('modifiedCount' in status);
});
