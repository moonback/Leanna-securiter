/**
 * Tests pour leannaignore.ts et son intégration dans isWriteForbidden.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseIgnoreContent,
  compileIgnorePattern,
  isIgnoredForWrite,
  loadIgnoreRules,
  clearIgnoreCache,
  getIgnoreFilePath,
  LEANNAIGNORE_FILENAME,
} from './leannaignore.js';
import { isWriteForbidden, setSelfRoot, resetSelfRoot } from './selfRoot.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'leannaignore-'));
}

function writeIgnore(root: string, content: string): void {
  fs.writeFileSync(path.join(root, LEANNAIGNORE_FILENAME), content, 'utf-8');
  clearIgnoreCache(root);
}

// ── compileIgnorePattern ─────────────────────────────────────────────────────

test('compileIgnorePattern: dossier bloque son contenu', () => {
  const re = compileIgnorePattern('secrets/');
  assert.equal(re.test('secrets'), true);
  assert.equal(re.test('secrets/key.pem'), true);
  assert.equal(re.test('secrets/nested/deep.txt'), true);
  assert.equal(re.test('secretsx'), false);
  assert.equal(re.test('src/secrets'), false);
});

test('compileIgnorePattern: joker * ne traverse pas les slashes', () => {
  const re = compileIgnorePattern('config/*.prod.json');
  assert.equal(re.test('config/app.prod.json'), true);
  assert.equal(re.test('config/db.prod.json'), true);
  assert.equal(re.test('config/app.dev.json'), false);
  assert.equal(re.test('config/sub/app.prod.json'), false);
});

test('compileIgnorePattern: ** traverse les sous-dossiers', () => {
  const re = compileIgnorePattern('docs/**');
  assert.equal(re.test('docs'), true);
  assert.equal(re.test('docs/a.md'), true);
  assert.equal(re.test('docs/guide/intro.md'), true);
  assert.equal(re.test('documentation/a.md'), false);
});

test('compileIgnorePattern: caractères regex spéciaux échappés', () => {
  const re = compileIgnorePattern('a.b+c');
  assert.equal(re.test('a.b+c'), true);
  assert.equal(re.test('aXbYc'), false);
});

// ── parseIgnoreContent ───────────────────────────────────────────────────────

test('parseIgnoreContent: ignore commentaires et lignes vides', () => {
  const rules = parseIgnoreContent('# comment\n\n  \nsecrets/\n');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].pattern, 'secrets');
  assert.equal(rules[0].negated, false);
});

test('parseIgnoreContent: détecte la négation !', () => {
  const rules = parseIgnoreContent('docs/**\n!docs/README.md\n');
  assert.equal(rules.length, 2);
  assert.equal(rules[1].negated, true);
  assert.equal(rules[1].pattern, 'docs/README.md');
});

// ── isIgnoredForWrite (fichier sur disque) ───────────────────────────────────

test('isIgnoredForWrite: bloque un dossier listé', () => {
  const root = makeTempRoot();
  try {
    writeIgnore(root, 'secrets/\n');
    assert.equal(isIgnoredForWrite(root, path.join(root, 'secrets', 'key.pem')), true);
    assert.equal(isIgnoredForWrite(root, path.join(root, 'src', 'App.tsx')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isIgnoredForWrite: négation crée une exception', () => {
  const root = makeTempRoot();
  try {
    writeIgnore(root, 'docs/**\n!docs/CONTRIBUTING.md\n');
    assert.equal(isIgnoredForWrite(root, path.join(root, 'docs', 'secret.md')), true);
    assert.equal(isIgnoredForWrite(root, path.join(root, 'docs', 'CONTRIBUTING.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isIgnoredForWrite: aucun fichier .leannaignore → rien de bloqué', () => {
  const root = makeTempRoot();
  try {
    assert.equal(isIgnoredForWrite(root, path.join(root, 'anything.txt')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isIgnoredForWrite: chemin hors racine non bloqué (géré ailleurs)', () => {
  const root = makeTempRoot();
  try {
    writeIgnore(root, 'secrets/\n');
    assert.equal(isIgnoredForWrite(root, path.join(root, '..', 'outside.txt')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadIgnoreRules: cache invalidé quand le fichier change (mtime/size)', () => {
  const root = makeTempRoot();
  try {
    writeIgnore(root, 'secrets/\n');
    assert.equal(loadIgnoreRules(root).length, 1);

    // Réécrire avec plus de règles ; clearIgnoreCache force la relecture.
    writeIgnore(root, 'secrets/\ninfra/\nconfig/*.prod.json\n');
    assert.equal(loadIgnoreRules(root).length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('getIgnoreFilePath: pointe vers .leannaignore à la racine', () => {
  const root = makeTempRoot();
  try {
    assert.equal(getIgnoreFilePath(root), path.join(path.resolve(root), LEANNAIGNORE_FILENAME));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Intégration isWriteForbidden ─────────────────────────────────────────────

test('isWriteForbidden respecte .leannaignore du projet actif', () => {
  const root = makeTempRoot();
  // setSelfRoot exige que la racine existe et soit un dossier — c'est le cas.
  try {
    writeIgnore(root, 'secrets/\ninfra/production/\n');
    setSelfRoot(root);

    assert.equal(isWriteForbidden(path.join(root, 'secrets', 'k.pem')), true);
    assert.equal(isWriteForbidden(path.join(root, 'infra', 'production', 'main.tf')), true);
    // Cible durcie en dur toujours bloquée.
    assert.equal(isWriteForbidden(path.join(root, 'node_modules', 'x', 'i.js')), true);
    // Fichier source normal autorisé.
    assert.equal(isWriteForbidden(path.join(root, 'src', 'App.tsx')), false);
  } finally {
    resetSelfRoot();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
