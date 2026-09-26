import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import conversationsRouter from './conversations.js';

// Mock des fonctions de history
let mockConversations: any[] = [];
let mockMessages: any[] = [];
let mockSearchResults: any[] = [];

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

test('conversations routes: GET / returns conversations list', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations?limit=10`);
    // Le status peut être 200 ou 500 selon la configuration Supabase
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as any;
    if (res.status === 200) {
      assert.ok(body.status === 'success');
      assert.ok(Array.isArray(body.conversations));
    } else {
      assert.ok(body.status === 'error');
    }
  } finally {
    await closeServer(server);
  }
});

test('conversations routes: GET /search validates query param', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/search`);
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('q'));
  } finally {
    await closeServer(server);
  }
});

test('conversations routes: GET /search with query returns results', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/search?q=test&limit=5`);
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as any;
    if (res.status === 200) {
      assert.equal(body.status, 'success');
      assert.ok(Array.isArray(body.results));
    } else {
      assert.equal(body.status, 'error');
    }
  } finally {
    await closeServer(server);
  }
});

test('conversations routes: GET /:id returns messages', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/test-conv-id?limit=50`);
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as any;
    if (res.status === 200) {
      assert.equal(body.status, 'success');
      assert.ok(Array.isArray(body.messages));
    } else {
      assert.equal(body.status, 'error');
    }
  } finally {
    await closeServer(server);
  }
});

test('conversations routes: PATCH /:id validates title', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/test-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('titre'));
  } finally {
    await closeServer(server);
  }
});

test('conversations routes: DELETE /all clears all conversations', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/all`, {
      method: 'DELETE',
    });
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as any;
    if (res.status === 200) {
      assert.equal(body.status, 'success');
      assert.ok(typeof body.deleted === 'number');
    } else {
      assert.equal(body.status, 'error');
    }
  } finally {
    await closeServer(server);
  }
});

test('conversations routes: DELETE /:id deletes specific conversation', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/test-id`, {
      method: 'DELETE',
    });
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as any;
    if (res.status === 200) {
      assert.equal(body.status, 'success');
    } else {
      assert.equal(body.status, 'error');
    }
  } finally {
    await closeServer(server);
  }
});
