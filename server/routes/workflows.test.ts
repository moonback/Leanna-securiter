import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import workflowsRouter from './workflows.js';

test('workflows routes: GET / returns workflows list', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'success');
    assert.ok(Array.isArray(body.workflows));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workflows routes: GET /active-runs returns active workflow runs', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows/active-runs`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'success');
    assert.ok(Array.isArray(body.runs));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workflows routes: POST / validates workflow creation', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.equal(body.status, 'error');
    assert.ok(body.error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workflows routes: POST /:id/run returns 404 for non-existent workflow', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows/non-existent-id/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as any;
    assert.equal(body.status, 'not_found');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workflows routes: POST /:id/toggle validates enabled field', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows/test-id/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('enabled'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workflows routes: POST /:id/toggle returns 404 for non-existent workflow', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows/non-existent/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as any;
    assert.equal(body.status, 'not_found');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('workflows routes: DELETE /:id returns success status', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workflows/test-id`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(['success', 'not_found'].includes(body.status));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
