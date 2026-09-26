import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createBrowserRouter, BrowserPendingEntry, BrowserActionPendingEntry } from './browser.js';

test('browser routes: POST /content-result validates requestId', async () => {
  const browserReadPending = new Map<string, BrowserPendingEntry>();
  const browserActionPending = new Map<string, BrowserActionPendingEntry>();

  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter(browserReadPending, browserActionPending));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/content-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: 'test' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('requestId'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('browser routes: POST /content-result ignores unknown requestId', async () => {
  const browserReadPending = new Map<string, BrowserPendingEntry>();
  const browserActionPending = new Map<string, BrowserActionPendingEntry>();

  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter(browserReadPending, browserActionPending));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/content-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'unknown-id', result: 'test' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ignored');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('browser routes: POST /content-result resolves pending request', async () => {
  const browserReadPending = new Map<string, BrowserPendingEntry>();
  const browserActionPending = new Map<string, BrowserActionPendingEntry>();

  let resolvedValue = '';
  const mockTimer = setTimeout(() => {}, 1000);
  browserReadPending.set('test-request-id', {
    resolve: (text: string) => { resolvedValue = text; },
    reject: () => {},
    timer: mockTimer,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter(browserReadPending, browserActionPending));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/content-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'test-request-id', result: 'Test Content' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ok');
    assert.equal(resolvedValue, 'Test Content');
    assert.equal(browserReadPending.has('test-request-id'), false);
  } finally {
    clearTimeout(mockTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('browser routes: POST /content-result rejects on error', async () => {
  const browserReadPending = new Map<string, BrowserPendingEntry>();
  const browserActionPending = new Map<string, BrowserActionPendingEntry>();

  let rejectedError: Error | null = null;
  const mockTimer = setTimeout(() => {}, 1000);
  browserReadPending.set('test-error-id', {
    resolve: () => {},
    reject: (err: Error) => { rejectedError = err; },
    timer: mockTimer,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter(browserReadPending, browserActionPending));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/content-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'test-error-id', error: 'Test error message' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ok');
    assert.ok(rejectedError);
    assert.equal(rejectedError?.message, 'Test error message');
    assert.equal(browserReadPending.has('test-error-id'), false);
  } finally {
    clearTimeout(mockTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('browser routes: POST /action-result validates requestId', async () => {
  const browserReadPending = new Map<string, BrowserPendingEntry>();
  const browserActionPending = new Map<string, BrowserActionPendingEntry>();

  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter(browserReadPending, browserActionPending));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/action-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: { success: true } }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('requestId'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('browser routes: POST /action-result resolves action', async () => {
  const browserReadPending = new Map<string, BrowserPendingEntry>();
  const browserActionPending = new Map<string, BrowserActionPendingEntry>();

  let resolvedValue: any = null;
  const mockTimer = setTimeout(() => {}, 1000);
  browserActionPending.set('action-id', {
    resolve: (value: any) => { resolvedValue = value; },
    reject: () => {},
    timer: mockTimer,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter(browserReadPending, browserActionPending));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/action-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'action-id', result: { clicked: true } }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ok');
    assert.deepEqual(resolvedValue, { clicked: true });
    assert.equal(browserActionPending.has('action-id'), false);
  } finally {
    clearTimeout(mockTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
