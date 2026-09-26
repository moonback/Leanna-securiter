import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createGithubRouter } from './github.js';

test('github routes: GET /issues validates missing params', async () => {
  const mockSkillManager: any = {
    handleToolCall: async () => ({ status: 'success' }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/github', createGithubRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/github/issues`);
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('owner'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('github routes: GET /repos delegates to skillManager', async () => {
  let calledTool = '';
  const mockSkillManager: any = {
    handleToolCall: async (name: string) => {
      calledTool = name;
      return { repos: [{ name: 'Leanna' }] };
    },
  };

  const app = express();
  app.use(express.json());
  const router = createGithubRouter(mockSkillManager);
  app.use('/api/git', router);
  app.use('/api/github', router);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const resGithub = await fetch(`http://127.0.0.1:${port}/api/github/repos`);
    assert.equal(resGithub.status, 200);
    const bodyGithub = await resGithub.json() as any;
    assert.equal(calledTool, 'list_github_repos');
    assert.equal(bodyGithub.repos[0].name, 'Leanna');

    // Test /api/git alias
    const resGit = await fetch(`http://127.0.0.1:${port}/api/git/repos`);
    assert.equal(resGit.status, 200);
    const bodyGit = await resGit.json() as any;
    assert.equal(bodyGit.repos[0].name, 'Leanna');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('github routes: POST /commit requires a message', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/github', createGithubRouter({ handleToolCall: async () => ({}) } as any));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/github/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.ok(body.error.includes('message'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('github routes: GET /user delegates to get_github_user', async () => {
  let calledTool = '';
  let calledArgs: any = null;
  const mockSkillManager: any = {
    handleToolCall: async (name: string, args: any) => {
      calledTool = name;
      calledArgs = args;
      return { login: 'octocat', public_repos: 8 };
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/github', createGithubRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/github/user?username=octocat`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(calledTool, 'get_github_user');
    assert.equal(calledArgs.username, 'octocat');
    assert.equal(body.login, 'octocat');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('github routes: GET /repo-info validates params and delegates to get_github_repo', async () => {
  let calledTool = '';
  let calledArgs: any = null;
  const mockSkillManager: any = {
    handleToolCall: async (name: string, args: any) => {
      calledTool = name;
      calledArgs = args;
      return { full_name: 'octocat/Hello-World', private: false };
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/github', createGithubRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const resMissing = await fetch(`http://127.0.0.1:${port}/api/github/repo-info?owner=octocat`);
    assert.equal(resMissing.status, 400);

    const resOk = await fetch(`http://127.0.0.1:${port}/api/github/repo-info?owner=octocat&repo=Hello-World`);
    assert.equal(resOk.status, 200);
    const body = await resOk.json() as any;
    assert.equal(calledTool, 'get_github_repo');
    assert.equal(calledArgs.owner, 'octocat');
    assert.equal(calledArgs.repo, 'Hello-World');
    assert.equal(body.full_name, 'octocat/Hello-World');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

