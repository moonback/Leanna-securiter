import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { createSandboxRouter } from './sandbox.js';
import { setSelfRoot } from '../utils/selfRoot.js';
import { stopWatching } from '../utils/sandboxWatcher.js';

{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname_local = path.dirname(__filename);
  setSelfRoot(path.resolve(__dirname_local, '..', '..'));
}


test('sandbox routes: GET /status returns sandbox status', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox', createSandboxRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sandbox/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'success');
    assert.ok(typeof body.sandbox === 'object');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('sandbox routes: GET /diff returns diffs array', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox', createSandboxRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sandbox/diff`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'success');
    assert.ok(Array.isArray(body.diffs));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('sandbox routes: verify-exit-code rejects invalid code', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox', createSandboxRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sandbox/verify-exit-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    });
    // If SANDBOX_EXIT_CODE is not configured in test env, returns 403
    assert.equal(res.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('sandbox routes: POST /discard succeeds when project is active', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox', createSandboxRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sandbox/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200);
    assert.equal(body.status, 'success');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('sandbox routes: POST /reset with valid exit code succeeds', async () => {
  process.env.SANDBOX_EXIT_CODE = '123456';
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox', createSandboxRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sandbox/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200);
    assert.equal(body.status, 'success');
  } finally {
    stopWatching();
    delete process.env.SANDBOX_EXIT_CODE;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

