import path from 'path';
import { fileURLToPath } from 'url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest, createRateLimiter, resolveWorkspacePath } from './security.js';
import { SELF_ROOT, normalizeSelfPath, isWriteForbidden, isCriticalFile, setSelfRoot } from './utils/selfRoot.js';

// ── SELF_ROOT bootstrap ───────────────────────────────────────────────────────
// security.test.ts lives in server/ → one level up is the project root.
// Must run before any test so that SELF_ROOT live binding is populated.
{
  const __filename_local = fileURLToPath(import.meta.url);
  setSelfRoot(path.resolve(path.dirname(__filename_local), '..'));
}

test('authenticateRequest allows requests when no token is configured', () => {
  const req = { headers: {} } as any;
  assert.deepEqual(authenticateRequest(req), { ok: true });
});

test('authenticateRequest rejects mismatched API tokens', () => {
  // Note: Node/Express lowercases all header names, so we test with lowercase
  const req = { headers: { 'x-leanna-token': 'wrong' } } as any;
  const result = authenticateRequest(req, { apiToken: 'secret' });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'Unauthorized');
});

test('authenticateRequest accepts a matching token', () => {
  // Note: Node/Express lowercases all header names, so we test with lowercase
  const req = { headers: { 'x-leanna-token': 'secret' } } as any;
  assert.deepEqual(authenticateRequest(req, { apiToken: 'secret' }), { ok: true });
});

test('createRateLimiter blocks requests after the configured limit', () => {
  const limiter = createRateLimiter(2, 1000);
  assert.equal(limiter.check('ip-1'), true);
  assert.equal(limiter.check('ip-1'), true);
  assert.equal(limiter.check('ip-1'), false);
});

test('resolveWorkspacePath rejects paths escaping the workspace root', () => {
  const result = resolveWorkspacePath('../outside.txt', 'C:/workspace/app');
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('resolveWorkspacePath accepts paths inside the workspace root', () => {
  const workspaceRoot = path.join('C:', 'workspace', 'app');
  const result = resolveWorkspacePath(path.join('src', 'App.tsx'), workspaceRoot);
  assert.equal(result.ok, true);
  assert.equal(result.absolutePath, path.join(workspaceRoot, 'src', 'App.tsx'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests Self-Root — Phase 1 : verrouillage du périmètre
// ═══════════════════════════════════════════════════════════════════════════════

test('SELF_ROOT is an absolute path', () => {
  assert.ok(path.isAbsolute(SELF_ROOT), `SELF_ROOT should be absolute, got: ${SELF_ROOT}`);
});

test('SELF_ROOT contains a package.json', async () => {
  const fs = await import('fs');
  const pkgPath = path.join(SELF_ROOT, 'package.json');
  assert.ok(fs.existsSync(pkgPath), `package.json not found at ${pkgPath}`);
});

test('normalizeSelfPath rejects path traversal attempts', () => {
  const attempts = [
    '../../../etc/passwd',
    '..\\..\\Windows\\System32\\config\\SAM',
    'src/../../outside.txt',
    '/absolute/path/elsewhere',
    'C:\\Users\\Other\\evil.txt',
  ];
  for (const attempt of attempts) {
    const result = normalizeSelfPath(attempt);
    // Should return null OR be within SELF_ROOT
    if (result !== null) {
      assert.ok(
        result.startsWith(SELF_ROOT + path.sep) || result === SELF_ROOT,
        `normalizeSelfPath("${attempt}") escaped: ${result}`
      );
    }
  }
});

test('normalizeSelfPath accepts valid relative paths', () => {
  const valid = [
    'src/App.tsx',
    'server/skills/codebase.ts',
    'package.json',
    './README.md',
  ];
  for (const p of valid) {
    const result = normalizeSelfPath(p);
    assert.ok(result !== null, `normalizeSelfPath("${p}") should not be null`);
    assert.ok(result!.startsWith(SELF_ROOT), `Result should start with SELF_ROOT`);
  }
});

test('isWriteForbidden blocks .git/config and node_modules', () => {
  assert.ok(isWriteForbidden(path.join(SELF_ROOT, '.git', 'config')));
  assert.ok(isWriteForbidden(path.join(SELF_ROOT, '.git', 'HEAD')));
  assert.ok(isWriteForbidden(path.join(SELF_ROOT, 'node_modules', 'express', 'index.js')));
});

test('isWriteForbidden allows regular source files', () => {
  assert.ok(!isWriteForbidden(path.join(SELF_ROOT, 'src', 'App.tsx')));
  assert.ok(!isWriteForbidden(path.join(SELF_ROOT, 'server', 'skills', 'codebase.ts')));
});

test('isCriticalFile flags sensitive files', () => {
  assert.ok(isCriticalFile(path.join(SELF_ROOT, 'server.ts')));
  assert.ok(isCriticalFile(path.join(SELF_ROOT, 'server', 'security.ts')));
  assert.ok(isCriticalFile(path.join(SELF_ROOT, '.env')));
  assert.ok(isCriticalFile(path.join(SELF_ROOT, '.env.local')));
  assert.ok(isCriticalFile(path.join(SELF_ROOT, '.gemini-keys.json')));
});

test('isCriticalFile does not flag regular source files', () => {
  assert.ok(!isCriticalFile(path.join(SELF_ROOT, 'src', 'App.tsx')));
  assert.ok(!isCriticalFile(path.join(SELF_ROOT, 'server', 'skills', 'git.ts')));
  assert.ok(!isCriticalFile(path.join(SELF_ROOT, 'README.md')));
});

test('SELF_ROOT can be changed via setSelfRoot', async () => {
  const { setSelfRoot } = await import('./utils/selfRoot');
  const originalRoot = SELF_ROOT;
  // setSelfRoot with an existing path should work
  const result = setSelfRoot(originalRoot);
  assert.equal(result, originalRoot);
  // setSelfRoot with nonexistent path should throw
  assert.throws(() => setSelfRoot('/nonexistent/path/that/does/not/exist'), /n'existe pas/);
});
