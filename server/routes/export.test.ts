import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createExportRouter } from './export.js';

test('export routes: POST /html returns standalone HTML', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/export', createExportRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/export/html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown: '# Mon Titre\n\nContenu généré.',
        title: 'Export Test',
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const body = await res.text();
    assert.ok(body.includes('<h1>Mon Titre</h1>'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('export routes: POST /docx returns doc binary attachment', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/export', createExportRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/export/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown: '# Mon Document Word\n\nParagraphe DOCX.',
        title: 'Docx Test',
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('application/msword'));
    const arrayBuffer = await res.arrayBuffer();
    assert.ok(arrayBuffer.byteLength > 100);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('export routes: POST /pdf returns 400 when markdown is missing', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/export', createExportRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('markdown'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
