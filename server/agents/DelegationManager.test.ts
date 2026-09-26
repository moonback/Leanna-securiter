/**
 * Tests pour DelegationManager (Node test runner)
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DelegationManager,
  delegationManager,
} from "./DelegationManager.js";

describe("DelegationManager", () => {
  let manager: DelegationManager;

  beforeEach(() => {
    manager = new DelegationManager();
  });

  // ─── Tests de parsing JSON ────────────────────────────────────────────────
  
  describe("parseFromJSON", () => {
    it("devrait parser une délégation simple valide", () => {
      const json = `{
        "targetRole": "coder",
        "title": "Implémenter une fonction",
        "description": "Créer une fonction utilitaire"
      }`;

      const result = manager.parseFromJSON(json, "planner");
      
      assert.equal(result.length, 1);
      assert.equal(result[0].targetRole, "coder");
      assert.equal(result[0].title, "Implémenter une fonction");
      assert.equal(result[0].description, "Créer une fonction utilitaire");
      assert.equal(result[0].priority, "medium");
    });

    it("devrait parser un tableau de délégations", () => {
      const json = `[{
        "targetRole": "coder",
        "title": "Tâche 1",
        "description": "Desc 1"
      }, {
        "targetRole": "tester",
        "title": "Tâche 2",
        "description": "Desc 2"
      }]`;

      const result = manager.parseFromJSON(json, "planner");
      
      assert.equal(result.length, 2);
      assert.equal(result[0].targetRole, "coder");
      assert.equal(result[1].targetRole, "tester");
    });

    it("devrait parser un batch de délégations", () => {
      const batchId = "550e8400-e29b-41d4-a716-446655440000";
      const json = `{
        "batchId": "${batchId}",
        "strategy": "parallel",
        "delegations": [
          {
            "targetRole": "coder",
            "title": "Tâche batch",
            "description": "Description batch"
          }
        ]
      }`;

      const result = manager.parseFromJSON(json, "planner");
      
      assert.equal(result.length, 1);
      assert.equal(result[0].targetRole, "coder");
    });

    it("devrait lever une erreur pour un JSON invalide", () => {
      const json = `{"invalid": true}`;
      
      assert.throws(() => {
        manager.parseFromJSON(json, "planner");
      });
    });

    it("devrait valider les champs obligatoires", () => {
      const json = `{
        "targetRole": "coder",
        "title": "Titre"
      }`; // description manquant

      assert.throws(() => {
        manager.parseFromJSON(json, "planner");
      });
    });
  });

  // ─── Tests de validation ──────────────────────────────────────────────────
  
  describe("Validation", () => {
    it("devrait accepter les valeurs par défaut", () => {
      const delegation = {
        targetRole: "coder" as const,
        title: "Test",
        description: "Description test"
      };

      // @ts-ignore - Appel interne
      const result = manager.validateAndEnrichDelegation(delegation, "planner");
      
      assert.equal(result.priority, "medium");
      assert.deepEqual(result.files, []);
      assert.deepEqual(result.context, {});
      assert.deepEqual(result.condition, { type: "always" });
    });

    it("devrait rejeter une délégation non autorisée", () => {
      const delegation = {
        targetRole: "vision" as any, // vision ne peut pas être déléguer par planner dans la matrice
        title: "Test",
        description: "Description test"
      };

      assert.throws(() => {
        // @ts-ignore - Appel interne
        manager.validateAndEnrichDelegation(delegation, "planner");
      }, /non autorisée/i);
    });
  });

  // ─── Tests de templates ──────────────────────────────────────────────────
  
  describe("Templates", () => {
    it("devrait générer un template de délégation valide", () => {
      const template = manager.generateDelegationTemplate("coder");
      
      assert.ok(template.includes('"targetRole": "coder"'));
      assert.ok(template.includes('"title":'));
      assert.ok(template.includes('"description":'));
    });

    it("devrait générer un template de batch valide", () => {
      const template = manager.generateBatchTemplate("parallel");
      
      assert.ok(template.includes('"strategy": "parallel"'));
      assert.ok(template.includes('"delegations":'));
    });
  });

  // ─── Tests de statistiques ──────────────────────────────────────────────
  
  describe("Statistiques", () => {
    it("devrait retourner des statistiques vides initialement", () => {
      const stats = manager.getStatistics();
      
      assert.equal(stats.totalDelegations, 0);
      assert.equal(stats.pending, 0);
      assert.equal(stats.completed, 0);
    });

    it("devrait retourner l'historique vide initialement", () => {
      const history = manager.getDelegationHistory();
      
      assert.equal(history.length, 0);
    });
  });
});

// ─── Tests du singleton ────────────────────────────────────────────────────

describe("DelegationManager Singleton", () => {
  it("devrait exporter une instance singleton", () => {
    assert.ok(delegationManager instanceof DelegationManager);
  });
});
