import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import healthRouter from './routes/health.js';
import { createSandboxRouter } from './routes/sandbox.js';
import { createCheckpointRouter } from './routes/checkpoint.js';
import { createGeminiKeysRouter } from './routes/gemini-keys.js';

test('server-bootstrap smoke test: health endpoint responds 200', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', healthRouter);
  app.use('/api/sandbox', createSandboxRouter());
  app.use('/api/checkpoint', createCheckpointRouter());
  app.use('/api/gemini-keys', createGeminiKeysRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string };
    assert.equal(body.status, 'ok');

    const keysRes = await fetch(`http://127.0.0.1:${port}/api/gemini-keys`);
    assert.equal(keysRes.status, 200);
    const keysBody = await keysRes.json() as { status: string };
    assert.equal(keysBody.status, 'success');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
