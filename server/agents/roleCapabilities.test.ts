/**
 * Tests de cohérence — Capacités d'agents vs outils réellement exécutables
 *
 * Objectif : détecter les « outils fantômes » — un outil listé dans les
 * `capabilities` d'un agent mais absent de l'allowlist d'exécution, donc refusé
 * à l'exécution. Ce désalignement fait échouer une tâche dès que l'agent tente
 * d'appeler l'outil (ex: le bug historique `knowledge_graph_query`, et le cas
 * des outils `automation_*` de l'agent vision qui étaient refusés).
 *
 * Source de vérité : `EXECUTABLE_AGENT_TOOLS` (AgentExecutor) — l'ensemble exact
 * des outils que l'AgentExecutor accepte d'exécuter (voir la garde ligne ~863 :
 * `EXECUTABLE_AGENT_TOOLS.has(call.name) && agent.capabilities.includes(...)`).
 * Toute capacité d'agent DOIT y figurer, sinon l'appel serait refusé.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { STATIC_AGENT_REGISTRY } from "./roles.js";
import { EXECUTABLE_AGENT_TOOLS } from "./AgentExecutor.js";

describe("Cohérence capacités d'agents ↔ outils exécutables", () => {
  it("aucun agent statique ne déclare un outil fantôme (non exécutable)", () => {
    const phantoms: Array<{ role: string; tool: string }> = [];

    for (const [role, def] of Object.entries(STATIC_AGENT_REGISTRY)) {
      for (const tool of def.capabilities) {
        if (EXECUTABLE_AGENT_TOOLS.has(tool)) continue;
        phantoms.push({ role, tool });
      }
    }

    assert.deepEqual(
      phantoms,
      [],
      `Outils fantômes détectés (déclarés en capacité mais non exécutables) :\n` +
        phantoms.map((p) => `  - agent "${p.role}" → "${p.tool}"`).join("\n") +
        `\n\nSoit retirer l'outil des capabilities de l'agent (roles.ts), soit l'enregistrer ` +
        `dans EXECUTABLE_AGENT_TOOLS (AgentExecutor.ts) s'il existe réellement.`
    );
  });

  it("l'agent vision peut exécuter ses outils automation_*", () => {
    const vision = STATIC_AGENT_REGISTRY["vision"];
    assert.ok(vision, "L'agent vision doit exister");
    const automationCaps = vision.capabilities.filter((c) => c.startsWith("automation_"));
    assert.ok(automationCaps.length > 0, "L'agent vision doit déclarer des outils automation_*");
    for (const tool of automationCaps) {
      assert.ok(
        EXECUTABLE_AGENT_TOOLS.has(tool),
        `L'outil "${tool}" de l'agent vision doit être exécutable (présent dans EXECUTABLE_AGENT_TOOLS)`
      );
    }
  });

  it("chaque agent statique déclare au moins une capacité", () => {
    for (const [role, def] of Object.entries(STATIC_AGENT_REGISTRY)) {
      assert.ok(
        Array.isArray(def.capabilities) && def.capabilities.length > 0,
        `L'agent "${role}" doit déclarer au moins une capacité`
      );
    }
  });

  it("le correctif du bug historique tient : knowledge_graph_query n'est plus déclaré", () => {
    for (const [role, def] of Object.entries(STATIC_AGENT_REGISTRY)) {
      assert.ok(
        !def.capabilities.includes("knowledge_graph_query"),
        `L'agent "${role}" ne doit plus référencer l'outil fantôme "knowledge_graph_query"`
      );
    }
  });
});
