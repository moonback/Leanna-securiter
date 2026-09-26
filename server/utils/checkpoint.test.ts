/**
 * checkpoint.test.ts — Tests du système de checkpoint (Phase 5 QA).
 *
 * Note : ces tests vérifient la robustesse des fonctions checkpoint sans
 * nécessiter d'état git particulier. Ils valident que les fonctions ne
 * crashent pas et retournent des structures cohérentes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { listCheckpoints, validateBuild } from "./checkpoint.js";

test("listCheckpoints retourne un tableau", async () => {
  const checkpoints = await listCheckpoints(5);
  assert.ok(Array.isArray(checkpoints), "doit retourner un tableau");
  // Chaque checkpoint (s'il y en a) doit avoir la bonne structure
  for (const cp of checkpoints) {
    assert.ok(typeof cp.hash === "string", "hash doit être une string");
    assert.ok(typeof cp.date === "string", "date doit être une string");
    assert.ok(typeof cp.message === "string", "message doit être une string");
  }
});

test("listCheckpoints respecte la limite count", async () => {
  const checkpoints = await listCheckpoints(3);
  assert.ok(checkpoints.length <= 3, `doit retourner au plus 3 checkpoints, got ${checkpoints.length}`);
});

test("validateBuild retourne un résultat structuré", async () => {
  const result = await validateBuild();
  assert.ok(typeof result.valid === "boolean", "valid doit être un booléen");
  if (!result.valid) {
    assert.ok(typeof result.errors === "string", "errors doit être fourni en cas d'échec");
  }
});
