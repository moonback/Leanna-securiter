import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createMarketplaceRouter } from './marketplace.js';

test('marketplace routes: GET /search returns search results', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/search?query=test&page=1&limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.packages));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: GET /search validates query params', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/search?page=invalid`);
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: GET /featured returns featured packages', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/featured`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.packages));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: GET /installed returns installed packages', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/installed`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.packages));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: GET /stats returns marketplace stats', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/stats`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(body.stats);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: GET /package/:id returns 404 for non-existent package', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/package/non-existent-id`);
    assert.equal(res.status, 404);
    const body = await res.json() as any;
    assert.ok(body.error.includes('introuvable'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: POST /install validates body', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: POST /install returns 404 for non-existent package', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'non-existent-package' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as any;
    assert.ok(body.error.includes('introuvable'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: POST /uninstall validates packageId', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/uninstall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('packageId'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: POST /publish validates body', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error);
    assert.ok(Array.isArray(body.details));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: POST /rate validates body', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: POST /validate-security validates package', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/validate-security`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Package',
        version: '1.0.0',
        description: 'A test package',
        author: { name: 'Test Author', email: 'test@example.com' },
        type: 'agent',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(body.securityReport);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('marketplace routes: GET /export/:id returns 404 for non-existent package', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', createMarketplaceRouter());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/marketplace/export/non-existent`);
    assert.equal(res.status, 404);
    const body = await res.json() as any;
    assert.ok(body.error.includes('introuvable'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
