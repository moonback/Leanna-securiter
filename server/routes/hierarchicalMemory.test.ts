import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "http";
import hierarchicalMemoryRouter from "./hierarchicalMemory.js";

test("hierarchicalMemory routes: CRUD and workflow", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/memory/hierarchical", hierarchicalMemoryRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api/memory/hierarchical`;

  try {
    // 1. GET /stats
    const statsRes = await fetch(`${baseUrl}/stats`);
    assert.equal(statsRes.status, 200);
    const statsBody = (await statsRes.json()) as any;
    assert.equal(statsBody.success, true);
    assert.ok(statsBody.stats);
    assert.ok(typeof statsBody.stats.session.count === "number");

    // 2. POST /store (session)
    const storeRes = await fetch(`${baseUrl}/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tier: "session",
        content: "API endpoint test item for hierarchical memory",
        tags: ["api-test"],
      }),
    });
    assert.equal(storeRes.status, 201);
    const storeBody = (await storeRes.json()) as any;
    assert.equal(storeBody.success, true);
    assert.ok(storeBody.item.id);
    const createdId = storeBody.item.id;

    // 3. GET /search
    const searchRes = await fetch(`${baseUrl}/search?query=endpoint%20test&tier=session`);
    assert.equal(searchRes.status, 200);
    const searchBody = (await searchRes.json()) as any;
    assert.equal(searchBody.success, true);
    assert.ok(searchBody.results.length >= 1);

    // 4. GET /list
    const listRes = await fetch(`${baseUrl}/list?tier=session`);
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as any;
    assert.equal(listBody.success, true);
    assert.ok(listBody.items.some((i: any) => i.id === createdId));

    // 5. POST /promote
    const promoteRes = await fetch(`${baseUrl}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: createdId,
        fromTier: "session",
        toTier: "project",
        category: "decision",
        removeSource: true,
      }),
    });
    assert.equal(promoteRes.status, 200);
    const promoteBody = (await promoteRes.json()) as any;
    assert.equal(promoteBody.success, true);
    assert.equal(promoteBody.item.tier, "project");

    // 6. DELETE /:tier/:id
    const deleteRes = await fetch(`${baseUrl}/session/${createdId}`, {
      method: "DELETE",
    });
    assert.equal(deleteRes.status, 200);

    // 7. DELETE /:tier/clear
    const clearRes = await fetch(`${baseUrl}/session/clear`, {
      method: "DELETE",
    });
    assert.equal(clearRes.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
