import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import memoriesRouter from './memories.js';

test('memories routes: GET / returns 500 when Supabase not configured', async () => {
  // Sauvegarder les valeurs actuelles
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Désactiver Supabase pour ce test
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const app = express();
  app.use(express.json());
  app.use('/api/memories', memoriesRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/memories`);
    assert.equal(res.status, 500);
    const body = await res.json() as any;
    assert.ok(body.error.includes('Supabase'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Restaurer les valeurs
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('memories routes: DELETE /all returns 500 when Supabase not configured', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const app = express();
  app.use(express.json());
  app.use('/api/memories', memoriesRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/memories/all`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 500);
    const body = await res.json() as any;
    assert.ok(body.error.includes('Supabase'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('memories routes: DELETE /:id returns 500 when Supabase not configured', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const app = express();
  app.use(express.json());
  app.use('/api/memories', memoriesRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/memories/test-id`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 500);
    const body = await res.json() as any;
    assert.ok(body.error.includes('Supabase'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
