import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hierarchicalMemorySkill } from "./hierarchicalMemory.js";

describe("hierarchicalMemorySkill", () => {
  it("devrait exposer les métadonnées et déclarations correctes", () => {
    assert.equal(hierarchicalMemorySkill.name, "hierarchical_memory");
    assert.equal(hierarchicalMemorySkill.declarations.length, 4);

    const declNames = hierarchicalMemorySkill.declarations.map((d: any) => d.name);
    assert.ok(declNames.includes("hierarchical_memory_search"));
    assert.ok(declNames.includes("hierarchical_memory_store"));
    assert.ok(declNames.includes("hierarchical_memory_promote"));
    assert.ok(declNames.includes("hierarchical_memory_stats"));
  });

  it("devrait exécuter hierarchical_memory_store et hierarchical_memory_search via handleToolCall", async () => {
    const storeRes = await hierarchicalMemorySkill.handleToolCall("hierarchical_memory_store", {
      tier: "session",
      content: "Une mémoire de test pour le skill",
      tags: ["skill-test"],
    });

    assert.equal(storeRes.status, "success");
    assert.ok(storeRes.item);
    assert.equal(storeRes.item.tier, "session");

    const searchRes = await hierarchicalMemorySkill.handleToolCall("hierarchical_memory_search", {
      query: "mémoire de test pour le skill",
      tier: "session",
    });

    assert.equal(searchRes.status, "success");
    assert.ok(searchRes.results.length >= 1);
  });

  it("devrait renvoyer les stats via hierarchical_memory_stats", async () => {
    const statsRes = await hierarchicalMemorySkill.handleToolCall("hierarchical_memory_stats", {});
    assert.equal(statsRes.status, "success");
    assert.ok(statsRes.stats);
    assert.ok(typeof statsRes.stats.total === "number");
  });
});
