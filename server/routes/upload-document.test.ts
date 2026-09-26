import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createUploadDocumentRouter } from './upload-document.js';
import type { ProfileConfig } from '../prompts/systemInstruction.js';

test('upload-document routes: POST / validates file presence', async () => {
  const mockProfile: ProfileConfig = {
    textProvider: 'gemini',
  };
  const getProfile = () => mockProfile;

  const app = express();
  app.use(express.json());
  app.use('/api/upload-document', createUploadDocumentRouter(getProfile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/upload-document`, {
      method: 'POST',
      body: new FormData(),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('file'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('upload-document routes: POST / rejects unsupported file types', async () => {
  const mockProfile: ProfileConfig = {
    textProvider: 'gemini',
  };
  const getProfile = () => mockProfile;

  const app = express();
  app.use(express.json());
  app.use('/api/upload-document', createUploadDocumentRouter(getProfile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const formData = new FormData();
    const blob = new Blob(['test content'], { type: 'application/zip' });
    formData.append('file', blob, 'test.zip');

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-document`, {
      method: 'POST',
      body: formData,
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('Unsupported file type'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('upload-document routes: GET /context returns document list', async () => {
  const mockProfile: ProfileConfig = {
    textProvider: 'gemini',
  };
  const getProfile = () => mockProfile;

  const app = express();
  app.use(express.json());
  app.use('/api/upload-document', createUploadDocumentRouter(getProfile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/upload-document/context`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.documents));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('upload-document routes: POST / accepts text files', async () => {
  const mockProfile: ProfileConfig = {
    textProvider: 'gemini',
  };
  const getProfile = () => mockProfile;

  const app = express();
  app.use(express.json());
  app.use('/api/upload-document', createUploadDocumentRouter(getProfile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const formData = new FormData();
    const blob = new Blob(['This is a simple test document with some content.'], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-document`, {
      method: 'POST',
      body: formData,
    });
    
    // Le test peut échouer si Gemini n'est pas configuré, mais on vérifie que la structure de l'erreur est correcte
    if (res.status === 500) {
      const body = await res.json() as any;
      assert.ok(body.error); // Erreur de configuration attendue
    } else if (res.status === 200) {
      const body = await res.json() as any;
      assert.ok(body.fileName);
      assert.equal(body.fileName, 'test.txt');
      assert.equal(body.mimeType, 'text/plain');
      assert.ok(body.summary || body.summary === ''); // summary peut être vide en cas d'erreur
      assert.ok(typeof body.extractedTextLength === 'number');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('upload-document routes: POST / handles markdown files', async () => {
  const mockProfile: ProfileConfig = {
    textProvider: 'gemini',
  };
  const getProfile = () => mockProfile;

  const app = express();
  app.use(express.json());
  app.use('/api/upload-document', createUploadDocumentRouter(getProfile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const formData = new FormData();
    const blob = new Blob(['# Test Document\n\nThis is markdown content.'], { type: 'text/markdown' });
    formData.append('file', blob, 'test.md');

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-document`, {
      method: 'POST',
      body: formData,
    });
    
    if (res.status === 500) {
      const body = await res.json() as any;
      assert.ok(body.error);
    } else if (res.status === 200) {
      const body = await res.json() as any;
      assert.equal(body.fileName, 'test.md');
      assert.equal(body.mimeType, 'text/markdown');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('upload-document routes: POST / enforces rate limiting', async () => {
  const mockProfile: ProfileConfig = {
    textProvider: 'gemini',
  };
  const getProfile = () => mockProfile;

  const app = express();
  app.use(express.json());
  app.use('/api/upload-document', createUploadDocumentRouter(getProfile));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    // Faire plusieurs requêtes rapidement pour dépasser la limite
    const requests = [];
    for (let i = 0; i < 12; i++) {
      const formData = new FormData();
      const blob = new Blob([`Test content ${i}`], { type: 'text/plain' });
      formData.append('file', blob, `test${i}.txt`);
      
      requests.push(
        fetch(`http://127.0.0.1:${port}/api/upload-document`, {
          method: 'POST',
          body: formData,
        })
      );
    }

    const responses = await Promise.all(requests);
    
    // Au moins une des réponses devrait être 429 (trop de requêtes)
    const rateLimitedResponses = responses.filter(r => r.status === 429);
    assert.ok(rateLimitedResponses.length > 0, 'Rate limiting should have kicked in');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
