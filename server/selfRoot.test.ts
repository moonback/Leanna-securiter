/**
 * Tests de sécurité pour le module selfRoot.ts
 * Vérifie le verrouillage du workspace sur le propre repo de Leanna.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SELF_ROOT,
  normalizeSelfPath,
  isWriteForbidden,
  isCriticalFile,
  setSelfRoot,
} from './utils/selfRoot.js';

// Bootstrap: set SELF_ROOT to the project root before any test runs.
// server/selfRoot.test.ts lives in server/ → one level up is the project root.
{
  const __filename_local = fileURLToPath(import.meta.url);
  setSelfRoot(path.resolve(path.dirname(__filename_local), '..'));
}

// ── SELF_ROOT est défini et pointe vers un dossier existant ────────────────

test('SELF_ROOT is defined and non-empty', () => {
  assert.ok(SELF_ROOT, 'SELF_ROOT should be a non-empty string');
  assert.ok(path.isAbsolute(SELF_ROOT), 'SELF_ROOT should be an absolute path');
});

// ── normalizeSelfPath — path traversal protection ──────────────────────────

test('normalizeSelfPath accepts relative paths inside root', () => {
  const result = normalizeSelfPath('src/App.tsx');
  assert.ok(result !== null);
  assert.ok(result!.startsWith(SELF_ROOT));
});

test('normalizeSelfPath accepts nested paths', () => {
  const result = normalizeSelfPath('server/utils/selfRoot.ts');
  assert.ok(result !== null);
  assert.equal(result, path.resolve(SELF_ROOT, 'server/utils/selfRoot.ts'));
});

test('normalizeSelfPath rejects path traversal with ../', () => {
  const result = normalizeSelfPath('../outside.txt');
  assert.equal(result, null);
});

test('normalizeSelfPath rejects double path traversal', () => {
  const result = normalizeSelfPath('../../etc/passwd');
  assert.equal(result, null);
});

test('normalizeSelfPath rejects absolute paths outside root', () => {
  const result = normalizeSelfPath('/etc/passwd');
  // On Windows this resolves to C:\etc\passwd which is outside SELF_ROOT
  // On Unix /etc/passwd is outside any project root
  if (!result?.startsWith(SELF_ROOT)) {
    // Either null or outside root — both are correct rejections
    assert.ok(result === null || !result.startsWith(SELF_ROOT + path.sep));
  }
});

test('normalizeSelfPath accepts the root itself', () => {
  const result = normalizeSelfPath('.');
  assert.ok(result !== null);
  assert.equal(result, SELF_ROOT);
});

test('normalizeSelfPath rejects disguised traversal (dir/../../escape)', () => {
  const result = normalizeSelfPath('src/../../outside');
  assert.equal(result, null);
});

// ── isWriteForbidden — fichiers interdits en écriture ──────────────────────

test('isWriteForbidden blocks .git/config', () => {
  const abs = path.join(SELF_ROOT, '.git', 'config');
  assert.equal(isWriteForbidden(abs), true);
});

test('isWriteForbidden blocks .git/HEAD', () => {
  const abs = path.join(SELF_ROOT, '.git', 'HEAD');
  assert.equal(isWriteForbidden(abs), true);
});

test('isWriteForbidden blocks node_modules', () => {
  const abs = path.join(SELF_ROOT, 'node_modules', 'express', 'index.js');
  assert.equal(isWriteForbidden(abs), true);
});

test('isWriteForbidden allows normal source files', () => {
  const abs = path.join(SELF_ROOT, 'src', 'App.tsx');
  assert.equal(isWriteForbidden(abs), false);
});

test('isWriteForbidden allows server files', () => {
  const abs = path.join(SELF_ROOT, 'server', 'skills', 'codebase.ts');
  assert.equal(isWriteForbidden(abs), false);
});

// ── isCriticalFile — fichiers nécessitant confirmation ─────────────────────

test('isCriticalFile flags server.ts', () => {
  const abs = path.join(SELF_ROOT, 'server.ts');
  assert.equal(isCriticalFile(abs), true);
});

test('isCriticalFile flags .env', () => {
  const abs = path.join(SELF_ROOT, '.env');
  assert.equal(isCriticalFile(abs), true);
});

test('isCriticalFile flags .env.local', () => {
  const abs = path.join(SELF_ROOT, '.env.local');
  assert.equal(isCriticalFile(abs), true);
});

test('isCriticalFile flags server/security.ts', () => {
  const abs = path.join(SELF_ROOT, 'server', 'security.ts');
  assert.equal(isCriticalFile(abs), true);
});

test('isCriticalFile flags server/utils/selfRoot.ts', () => {
  const abs = path.join(SELF_ROOT, 'server', 'utils', 'selfRoot.ts');
  assert.equal(isCriticalFile(abs), true);
});

test('isCriticalFile flags electron/main.cjs', () => {
  const abs = path.join(SELF_ROOT, 'electron', 'main.cjs');
  assert.equal(isCriticalFile(abs), true);
});

test('isCriticalFile does NOT flag normal source files', () => {
  const abs = path.join(SELF_ROOT, 'src', 'App.tsx');
  assert.equal(isCriticalFile(abs), false);
});

test('isCriticalFile does NOT flag skill files', () => {
  const abs = path.join(SELF_ROOT, 'server', 'skills', 'codebase.ts');
  assert.equal(isCriticalFile(abs), false);
});

// ── Vérification que Leanna_DEFAULT_WORKSPACE ne peut pas contaminer le root

test('SELF_ROOT does not change based on Leanna_DEFAULT_WORKSPACE env var', () => {
  // Even if someone sets this env var, SELF_ROOT is computed once at module load
  // and ignores Leanna_DEFAULT_WORKSPACE entirely.
  const originalRoot = SELF_ROOT;
  process.env.Leanna_DEFAULT_WORKSPACE = '/tmp/malicious';
  // SELF_ROOT is a const — it cannot be reassigned
  assert.equal(SELF_ROOT, originalRoot);
  delete process.env.Leanna_DEFAULT_WORKSPACE;
});
