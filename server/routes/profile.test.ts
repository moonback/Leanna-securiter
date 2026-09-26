import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createProfileRouter, createTokensRouter } from './profile.js';
import type { ProfileConfig } from '../prompts/systemInstruction.js';

test('profile routes: GET /profile returns current profile', async () => {
  const mockProfile: ProfileConfig = {
    name: 'Test User',
    role: 'developer',
    expertise: ['typescript', 'nodejs'],
  };

  const getProfile = () => mockProfile;
  const setProfile = () => {};
  const saveProfile = () => {};
  const getWorkspaceRoot = () => '/test/workspace';
  const updateEnvFile = () => {};

  const app = express();
  app.use(express.json());
  app.use('/api', createProfileRouter(getProfile, setProfile, saveProfile, getWorkspaceRoot, updateEnvFile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/profile`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.name, 'Test User');
    assert.equal(body.role, 'developer');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('profile routes: POST /profile updates profile', async () => {
  let currentProfile: ProfileConfig = {
    name: 'Test User',
    role: 'developer',
  };

  const getProfile = () => currentProfile;
  const setProfile = (p: ProfileConfig) => { currentProfile = p; };
  const saveProfile = () => {};
  const getWorkspaceRoot = () => '/test/workspace';
  const updateEnvFile = () => {};

  const app = express();
  app.use(express.json());
  app.use('/api', createProfileRouter(getProfile, setProfile, saveProfile, getWorkspaceRoot, updateEnvFile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated User', role: 'architect' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.equal(body.profile.name, 'Updated User');
    assert.equal(body.profile.role, 'architect');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('tokens routes: GET /tokens returns token status', async () => {
  const updateEnvFile = () => {};

  const app = express();
  app.use(express.json());
  app.use('/api', createTokensRouter(updateEnvFile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tokens`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'success');
    assert.ok(Array.isArray(body.tokens));
    assert.ok(body.tokens.length > 0);
    
    // Vérifier la structure d'un token
    const token = body.tokens[0];
    assert.ok(token.key);
    assert.ok(token.label);
    assert.ok(typeof token.configured === 'boolean');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('tokens routes: POST /tokens validates required fields', async () => {
  const updateEnvFile = () => {};

  const app = express();
  app.use(express.json());
  app.use('/api', createTokensRouter(updateEnvFile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('requis'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('tokens routes: POST /tokens rejects unauthorized keys', async () => {
  const updateEnvFile = () => {};

  const app = express();
  app.use(express.json());
  app.use('/api', createTokensRouter(updateEnvFile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'INVALID_KEY', value: 'test' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('non autorisée'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('tokens routes: POST /tokens updates valid token', async () => {
  let updatedKey = '';
  let updatedValue = '';
  const updateEnvFile = (key: string, value: string) => {
    updatedKey = key;
    updatedValue = value;
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createTokensRouter(updateEnvFile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'GEMINI_API_KEY', value: 'test-key-123' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'success');
    assert.equal(body.key, 'GEMINI_API_KEY');
    assert.equal(updatedKey, 'GEMINI_API_KEY');
    assert.equal(updatedValue, 'test-key-123');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
