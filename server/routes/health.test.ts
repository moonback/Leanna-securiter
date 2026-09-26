import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import healthRouter from './health.js';

test('health routes: GET /health returns status ok', async () => {
  const app = express();
  app.use('/api', healthRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ok');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
