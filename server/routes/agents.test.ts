import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createAgentsRouter } from './agents.js';

test('agents routes: GET /status returns agent tools status', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [
      { name: 'agent_list_tasks', description: 'List tasks' },
      { name: 'agent_list_roles', description: 'List roles' },
    ],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.registered, true);
    assert.ok(Array.isArray(body.tools));
    assert.ok(body.stats);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /tasks returns task list', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
    handleToolCall: async (name: string) => {
      if (name === 'agent_list_tasks') {
        return { tasks: [{ id: '1', title: 'Test Task' }] };
      }
      return {};
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/tasks`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.tasks));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /roles returns available roles', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
    handleToolCall: async (name: string) => {
      if (name === 'agent_list_roles') {
        return { roles: ['coder', 'architect', 'test'] };
      }
      return {};
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/roles`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.roles));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /fleet returns fleet status', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/fleet`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /bus/metrics returns message bus metrics', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/bus/metrics`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /bus/history returns message history', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/bus/history?limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.messages));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /collaboration/patterns returns patterns', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/collaboration/patterns`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.patterns);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /collaboration/matrix returns delegation matrix', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/collaboration/matrix`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.matrix);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: POST /collaborate validates schema', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/collaborate`, {
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

test('agents routes: POST /delegate-autonomous validates schema', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/delegate-autonomous`, {
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

test('agents routes: GET /loop/config returns loop configuration', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/loop/config`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.description);
    assert.ok(body.roles);
    assert.ok(body.signals);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /persistence/status returns persistence status', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/persistence/status`);
    //  Le endpoint peut retourner 200 (endpoint configuré) ou 503 (registry non initialisé)
    assert.ok([200, 503].includes(res.status));
    if (res.status === 200) {
      const body = await res.json() as any;
      assert.ok('available' in body);
      assert.ok(typeof body.available === 'boolean');
      assert.ok(body.message);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /persistence/migration returns SQL migration', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/persistence/migration`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.description);
    assert.ok(body.sql);
    assert.ok(Array.isArray(body.instructions));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /tool-mapping returns tool-agent mapping', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/tool-mapping`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(body.mapping);
    assert.ok(typeof body.totalTools === 'number');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('agents routes: GET /tool-categories returns tool categories', async () => {
  const mockSkillManager: any = {
    getToolDeclarations: () => [],
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', createAgentsRouter(mockSkillManager));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/tool-categories`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.success, true);
    assert.ok(body.categories);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
