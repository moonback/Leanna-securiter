/**
 * Tests unitaires — parseLLMPlanResponse (validation Zod du plan LLM)
 *
 * Couvre le contrat de parsing sécurisé de la sortie brute du LLM :
 * 1. Plan valide extrait et normalisé (dependsOn par défaut à [])
 * 2. Texte parasite autour du JSON toléré (isolation du bloc {...})
 * 3. Absence de JSON → null
 * 4. JSON syntaxiquement invalide → null (pas d'exception propagée)
 * 5. `stages` manquant / vide → null
 * 6. `role` d'étape manquant → null
 * 7. `dependsOn` non-tableau → null
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseLLMPlanResponse } from "./DynamicPlanner.js";

describe("parseLLMPlanResponse", () => {
  it("valide et normalise un plan LLM bien formé", () => {
    const raw = JSON.stringify({
      architectureRationale: "Stratégie en deux temps",
      stages: [
        { id: "s1", role: "coder", title: "Impl", reason: "coder", instructions: "fais X" },
        { id: "s2", role: "tester", dependsOn: ["s1"] },
      ],
    });

    const parsed = parseLLMPlanResponse(raw);
    assert.ok(parsed, "le plan valide doit être retourné");
    assert.equal(parsed!.stages.length, 2);
    // dependsOn absent → défaut []
    assert.deepEqual(parsed!.stages[0].dependsOn, []);
    assert.deepEqual(parsed!.stages[1].dependsOn, ["s1"]);
    assert.equal(parsed!.architectureRationale, "Stratégie en deux temps");
  });

  it("isole le bloc JSON même entouré de texte parasite", () => {
    const raw = `Voici le plan demandé :\n\n{"stages":[{"role":"coder"}]}\n\nJ'espère que cela convient.`;
    const parsed = parseLLMPlanResponse(raw);
    assert.ok(parsed, "le JSON noyé dans du texte doit être extrait");
    assert.equal(parsed!.stages.length, 1);
    assert.equal(parsed!.stages[0].role, "coder");
  });

  it("retourne null quand aucun objet JSON n'est présent", () => {
    assert.equal(parseLLMPlanResponse("désolé, je ne peux pas répondre"), null);
    assert.equal(parseLLMPlanResponse(""), null);
  });

  it("retourne null (sans lever) quand le JSON est syntaxiquement invalide", () => {
    const raw = `{"stages": [{"role": "coder",}]}`; // virgule traînante illégale
    assert.doesNotThrow(() => parseLLMPlanResponse(raw));
    assert.equal(parseLLMPlanResponse(raw), null);
  });

  it("retourne null quand `stages` est manquant ou vide", () => {
    assert.equal(parseLLMPlanResponse(`{"architectureRationale":"x"}`), null);
    assert.equal(parseLLMPlanResponse(`{"stages":[]}`), null);
  });

  it("retourne null quand une étape n'a pas de `role`", () => {
    const raw = `{"stages":[{"title":"sans rôle"}]}`;
    assert.equal(parseLLMPlanResponse(raw), null);
  });

  it("retourne null quand `dependsOn` n'est pas un tableau de chaînes", () => {
    const raw = `{"stages":[{"role":"coder","dependsOn":"s0"}]}`;
    assert.equal(parseLLMPlanResponse(raw), null);
  });

  it("tolère les champs supplémentaires inconnus (passthrough)", () => {
    const raw = `{"stages":[{"role":"coder","unexpected":123,"note":"ok"}]}`;
    const parsed = parseLLMPlanResponse(raw);
    assert.ok(parsed, "les champs inconnus ne doivent pas invalider le plan");
    assert.equal(parsed!.stages[0].role, "coder");
  });
});
