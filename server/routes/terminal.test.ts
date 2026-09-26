import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createTerminalRouter } from './terminal.js';

test('terminal routes: GET /terminal/config returns configuration', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/terminal/config`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.shell);
    assert.ok(body.cwd);
    assert.ok(body.platform);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('terminal routes: GET /terminal/sessions returns active sessions', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/terminal/sessions`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(typeof body.count === 'number');
    assert.ok(Array.isArray(body.sessions));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('terminal routes: POST /terminal/close closes terminal', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/terminal/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(body.message);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('terminal routes: GET /terminal/config with auth requires authentication', async () => {
  const authOptions = {
    apiToken: 'test-token-12345',
    requireAuth: true,
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter(authOptions));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    // Sans authentification
    const res = await fetch(`http://127.0.0.1:${port}/api/terminal/config`);
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.ok(body.error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('terminal routes: GET /terminal/config with auth accepts valid token', async () => {
  const authOptions = {
    apiToken: 'test-token-12345',
    requireAuth: true,
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createTerminalRouter(authOptions));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/terminal/config`, {
      headers: { 'X-API-Token': 'test-token-12345' },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.shell);
    assert.ok(body.cwd);
    assert.ok(body.platform);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
