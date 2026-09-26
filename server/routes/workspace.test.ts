import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createWorkspaceRouter } from './workspace.js';

test('workspace routes: GET /workspace returns workspace info', async () => {
  const mockGetWorkspaceRoot = () => '/test/workspace';

  const app = express();
  app.use(express.json());
  app.use('/api', createWorkspaceRouter(mockGetWorkspaceRoot));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.workspace, '/test/workspace');
    assert.ok(typeof body.exists === 'boolean');
    assert.equal(body.selfReferential, true);
    assert.ok(typeof body.sandbox === 'boolean');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workspace routes: POST /workspace is forbidden', async () => {
  const mockGetWorkspaceRoot = () => '/test/workspace';

  const app = express();
  app.use(express.json());
  app.use('/api', createWorkspaceRouter(mockGetWorkspaceRoot));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/new/workspace' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.ok(body.error.includes('verrouillé'));
    // Le workspace dans la réponse provient de SELF_ROOT, pas de notre mock
    assert.ok('workspace' in body);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workspace routes: GET /workspace returns current workspace root', async () => {
  const actualWorkspaceRoot = process.cwd();
  const mockGetWorkspaceRoot = () => actualWorkspaceRoot;

  const app = express();
  app.use(express.json());
  app.use('/api', createWorkspaceRouter(mockGetWorkspaceRoot));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.workspace, actualWorkspaceRoot);
    assert.equal(body.exists, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
