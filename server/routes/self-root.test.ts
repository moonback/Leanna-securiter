import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSelfRootRouter } from './self-root.js';
import { setSelfRoot, SELF_ROOT } from '../utils/selfRoot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

// Ensure root is set
setSelfRoot(projectRoot);

async function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/self-root', createSelfRootRouter(() => null));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/api/self-root`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('self-root routes: GET /status returns root status', async () => {
  const testApp = await createTestServer();
  try {
    const res = await fetch(`${testApp.baseUrl}/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.locked, true);
    assert.ok(data.rootPath);
    assert.equal(path.resolve(data.rootPath), projectRoot);
  } finally {
    await testApp.close();
  }
});

test('self-root routes: GET /workspaces returns registered workspaces', async () => {
  const testApp = await createTestServer();
  try {
    const res = await fetch(`${testApp.baseUrl}/workspaces`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.workspaces));
    assert.equal(path.resolve(data.activeRoot), projectRoot);
  } finally {
    await testApp.close();
  }
});

test('self-root routes: POST /workspaces/validate checks path safety', async () => {
  const testApp = await createTestServer();
  try {
    // Valid path
    const validRes = await fetch(`${testApp.baseUrl}/workspaces/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectRoot }),
    });
    assert.equal(validRes.status, 200);
    const validData = await validRes.json();
    assert.equal(validData.valid, true);
    assert.equal(validData.hasPackageJson, true);

    // Invalid non-existent path
    const invalidRes = await fetch(`${testApp.baseUrl}/workspaces/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(projectRoot, 'does-not-exist-xyz') }),
    });
    assert.equal(invalidRes.status, 200);
    const invalidData = await invalidRes.json();
    assert.equal(invalidData.valid, false);

    // System path rejected
    const sysPath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const sysRes = await fetch(`${testApp.baseUrl}/workspaces/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sysPath }),
    });
    assert.equal(sysRes.status, 200);
    const sysData = await sysRes.json();
    assert.equal(sysData.valid, false);
  } finally {
    await testApp.close();
  }
});

test('self-root routes: PATCH and DELETE /workspaces/:id', async () => {
  const testApp = await createTestServer();
  try {
    const { addOrUpdateWorkspace } = await import('../utils/selfRoot.js');
    const ws = addOrUpdateWorkspace(path.resolve(projectRoot, 'src'), undefined, 'Src Workspace');

    // Patch metadata
    const patchRes = await fetch(`${testApp.baseUrl}/workspaces/${ws.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Src Workspace', siteUrl: 'https://mysite.com' }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.equal(patchData.success, true);
    assert.equal(patchData.workspace.name, 'Renamed Src Workspace');

    // Delete workspace entry
    const deleteRes = await fetch(`${testApp.baseUrl}/workspaces/${ws.id}`, {
      method: 'DELETE',
    });
    assert.equal(deleteRes.status, 200);
    const deleteData = await deleteRes.json();
    assert.equal(deleteData.success, true);
  } finally {
    await testApp.close();
  }
});
