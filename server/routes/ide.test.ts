import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import ideRouter from './ide.js';
import { setSelfRoot } from '../utils/selfRoot.js';

{
  const __filename_local = fileURLToPath(import.meta.url);
  setSelfRoot(path.resolve(path.dirname(__filename_local), '..', '..'));
}

test('ide routes: GET /tree returns workspace entries', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ide', ideRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ide/tree`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.path);
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.entries.length > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('ide routes: GET /file returns file content for valid path', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ide', ideRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ide/file?path=package.json`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.path, 'package.json');
    assert.ok(body.content.includes('Leanna'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('ide routes: GET /file returns 403 on path traversal attempt', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ide', ideRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ide/file?path=../../etc/passwd`);
    assert.equal(res.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
