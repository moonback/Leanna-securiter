import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HierarchicalMemoryService } from "./HierarchicalMemoryService.js";
import { Memory } from "./Memory.js";
import { ProjectMemory } from "../knowledge/ProjectMemory.js";
import { EventBus } from "./EventBus.js";

describe("HierarchicalMemoryService", () => {
  it("devrait stocker, lister et rechercher dans la mémoire de session (court-terme)", async () => {
    const mem = new Memory();
    const service = new HierarchicalMemoryService({ sessionStore: mem });

    const stored = await service.store("session", {
      key: "task_note_1",
      content: "L'utilisateur veut implémenter le composant de vue mémoire",
      tags: ["ui", "session-scratchpad"],
    });

    assert.equal(stored.tier, "session");
    assert.equal(stored.id, "task_note_1");

    // List
    const list = await service.list("session");
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "task_note_1");

    // Search
    const searchResults = await service.search("composant", { tier: "session" });
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, "task_note_1");
  });

  it("devrait stocker dans la mémoire projet (moyen-terme) et rechercher", async () => {
    const mem = new Memory();
    const projMem = new ProjectMemory();
    const service = new HierarchicalMemoryService({ sessionStore: mem, projectStore: projMem });

    const stored = await service.store("project", {
      content: "Convention de nommage : les fichiers de routes utilisent camelCase et se terminent par Router.",
      category: "convention",
      tags: ["convention", "routing"],
      confidence: 0.95,
    });

    assert.equal(stored.tier, "project");
    assert.ok(stored.id);

    const results = await service.search("Convention de nommage", { tier: "project" });
    assert.ok(results.length >= 1);
    const found = results.find((r) => r.id === stored.id);
    assert.ok(found);
    assert.equal(found.tier, "project");
  });

  it("devrait promouvoir une mémoire de session vers la mémoire projet", async () => {
    const mem = new Memory();
    const projMem = new ProjectMemory();
    const service = new HierarchicalMemoryService({ sessionStore: mem, projectStore: projMem });

    // Stockage en session
    const sessionItem = await service.store("session", {
      key: "temp_rule",
      content: "Règle importante découverte pendant la session : toujours passer par HierarchicalMemoryService.",
      tags: ["rule"],
    });

    // Promotion
    const promoted = await service.promote(sessionItem.id, "session", "project", {
      category: "decision",
      removeSource: true,
    });

    assert.equal(promoted.tier, "project");
    assert.equal(promoted.category, "decision");
    assert.ok(promoted.tags.includes("promoted-from-session"));

    // L'ancienne entrée session a bien été supprimée si removeSource = true
    const sessionList = await service.list("session");
    assert.equal(sessionList.find((i) => i.id === sessionItem.id), undefined);

    // L'entrée est accessible dans le projet
    const projectList = await service.list("project");
    assert.ok(projectList.some((i) => i.id === promoted.id));
  });

  it("devrait effectuer une recherche unifiée multi-tiers", async () => {
    const mem = new Memory();
    const projMem = new ProjectMemory();
    const service = new HierarchicalMemoryService({ sessionStore: mem, projectStore: projMem });

    await service.store("session", {
      key: "short_term_test",
      content: "Un mot-clef unique: SuperHierarchicalArchitecture pour session",
      tags: ["test"],
    });

    await service.store("project", {
      content: "Documentation sur SuperHierarchicalArchitecture pour le projet",
      category: "architecture",
      tags: ["test"],
    });

    const multiResults = await service.search("SuperHierarchicalArchitecture", { tier: "all" });
    assert.ok(multiResults.length >= 2);
    const tiersFound = new Set(multiResults.map((r) => r.tier));
    assert.ok(tiersFound.has("session"));
    assert.ok(tiersFound.has("project"));
  });

  it("devrait fournir des statistiques claires sur les tiers", async () => {
    const mem = new Memory();
    const projMem = new ProjectMemory();
    const service = new HierarchicalMemoryService({ sessionStore: mem, projectStore: projMem });

    await service.store("session", {
      key: "s1",
      content: "session data content",
    });

    const stats = await service.getStats();
    assert.ok(stats.session.count >= 1);
    assert.equal(stats.session.status, "active");
    assert.ok(stats.total >= 1);
  });

  it("devrait émettre des événements sur l'EventBus lors des modifications", async () => {
    const events: any[] = [];
    const eventBus = new EventBus();
    eventBus.onAny((event) => events.push(event));

    const mem = new Memory({ eventBus });
    const service = new HierarchicalMemoryService({ sessionStore: mem, eventBus });

    await service.store("session", {
      key: "evt_test",
      content: "Testing event emission",
    });

    assert.ok(events.some((e) => e.type === "memory:hierarchical:stored"));
  });
});
