/**
 * safeguards.ignore.test.ts — Tests des endpoints .leannaignore de safeguards,
 * en particulier le miroir vers le sandbox actif.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

import safeguardsRouter from './safeguards.js';
import { setSelfRoot, resetSelfRoot } from '../utils/selfRoot.js';
import {
  getSandboxRoot,
  activateSandbox,
  deactivateSandbox,
  isSandboxActive,
} from '../utils/sandbox.js';
import { LEANNAIGNORE_FILENAME } from '../utils/leannaignore.js';

async function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/safeguards', safeguardsRouter);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/safeguards`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function makeTempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leanna-ign-route-'));
  // setSelfRoot exige un dossier existant ; un package.json rend le workspace crédible.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'tmp' }), 'utf-8');
  return root;
}

test('POST /ignore écrit dans le projet principal (sans sandbox)', async () => {
  const root = makeTempProject();
  const app = await createTestServer();
  try {
    deactivateSandbox();
    setSelfRoot(root);

    const res = await fetch(`${app.baseUrl}/ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'secrets/\n!secrets/README.md' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'success');
    assert.equal(data.mirroredToSandbox, false);

    const mainContent = fs.readFileSync(path.join(root, LEANNAIGNORE_FILENAME), 'utf-8');
    assert.match(mainContent, /secrets\//);
    // Les règles parsées sont renvoyées (motif + négation).
    assert.ok(data.rules.some((r: any) => r.pattern === 'secrets' && !r.negated));
    assert.ok(data.rules.some((r: any) => r.pattern === 'secrets/README.md' && r.negated));
  } finally {
    resetSelfRoot();
    deactivateSandbox();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('POST /ignore miroite le fichier dans le sandbox actif', async () => {
  const root = makeTempProject();
  const app = await createTestServer();
  try {
    setSelfRoot(root);
    // Créer la copie isolée puis publier l'état READY sans lancer initSandbox
    // (activateSandbox vérifie uniquement l'existence du dossier sandbox).
    fs.mkdirSync(getSandboxRoot(), { recursive: true });
    activateSandbox();
    assert.equal(isSandboxActive(), true);

    const res = await fetch(`${app.baseUrl}/ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'infra/production/\nconfig/*.prod.json' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'success');
    assert.equal(data.mirroredToSandbox, true);

    const mainPath = path.join(root, LEANNAIGNORE_FILENAME);
    const sandboxPath = path.join(getSandboxRoot(), LEANNAIGNORE_FILENAME);
    assert.ok(fs.existsSync(mainPath), 'le fichier principal doit exister');
    assert.ok(fs.existsSync(sandboxPath), 'le miroir sandbox doit exister');
    // Contenu identique aux deux emplacements.
    assert.equal(
      fs.readFileSync(mainPath, 'utf-8'),
      fs.readFileSync(sandboxPath, 'utf-8'),
    );
  } finally {
    resetSelfRoot();
    deactivateSandbox();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /ignore renvoie le contenu enregistré', async () => {
  const root = makeTempProject();
  const app = await createTestServer();
  try {
    deactivateSandbox();
    setSelfRoot(root);
    fs.writeFileSync(path.join(root, LEANNAIGNORE_FILENAME), 'dist/\n', 'utf-8');

    const res = await fetch(`${app.baseUrl}/ignore`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.exists, true);
    assert.equal(data.filename, LEANNAIGNORE_FILENAME);
    assert.match(data.content, /dist\//);
    assert.ok(data.rules.some((r: any) => r.pattern === 'dist' && !r.negated));
  } finally {
    resetSelfRoot();
    deactivateSandbox();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /ignore renvoie 409 quand aucun projet actif', async () => {
  const app = await createTestServer();
  try {
    resetSelfRoot();
    deactivateSandbox();
    const res = await fetch(`${app.baseUrl}/ignore`);
    assert.equal(res.status, 409);
  } finally {
    await app.close();
  }
});
