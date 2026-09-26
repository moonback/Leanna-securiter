/**
 * Tests du modèle de permissions par skill appliqué au runtime.
 *
 * Couvre :
 *   - PermissionPolicy.evaluate/enforce (modes enforce/audit/off)
 *   - fromEnv (Leanna_PERMISSION_MODE / Leanna_GRANTED_PERMISSIONS)
 *   - Application au runtime via ToolRegistry.call
 *   - Propagation des permissions déclarées via SkillAdapter
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PermissionPolicy,
  PermissionDeniedError,
  ALL_PERMISSIONS,
  UNDECLARED_PERMISSION,
  AGENT_NOT_ALLOWED,
} from "./PermissionPolicy.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { DryRunController } from "./DryRun.js";
import { adaptSkill } from "./compat/SkillAdapter.js";
import { applyRuntimeAgentAuthorization } from "../agents/toolAgentMapper.js";
import type { ToolDefinition } from "./types.js";
import { normalizePermissions } from "./types.js";
import type { LegacySkill } from "./compat/SkillAdapter.js";

// ═══════════════════════════════════════════════════════════════════════════════
// normalizePermissions
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalizePermissions", () => {
  it("mappe execute → exec et dédoublonne", () => {
    assert.deepEqual(normalizePermissions(["execute", "exec", "read"]), ["read", "exec"]);
  });

  it("retourne un tableau vide pour undefined", () => {
    assert.deepEqual(normalizePermissions(undefined), []);
  });

  it("trie selon l'ordre canonique", () => {
    assert.deepEqual(
      normalizePermissions(["dangerous", "write", "read", "network"]),
      ["read", "write", "network", "dangerous"]
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PermissionPolicy
// ═══════════════════════════════════════════════════════════════════════════════

describe("PermissionPolicy", () => {
  it("autorise quand toutes les permissions requises sont accordées", () => {
    const policy = new PermissionPolicy({ mode: "enforce", granted: ["read", "write"] });
    const decision = policy.evaluate("write_file", ["write"]);
    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.missing, []);
  });

  it("refuse en mode enforce quand une permission manque", () => {
    const policy = new PermissionPolicy({ mode: "enforce", granted: ["read"] });
    const decision = policy.evaluate("write_file", ["write"]);
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.missing, ["write"]);
  });

  it("laisse passer mais journalise en mode audit", () => {
    const policy = new PermissionPolicy({ mode: "audit", granted: ["read"] });
    const decision = policy.enforce("write_file", ["write"]);
    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.missing, ["write"]);
    assert.equal(policy.getDenials().length, 1);
  });

  it("ne vérifie rien en mode off", () => {
    const policy = new PermissionPolicy({ mode: "off", granted: [] });
    const decision = policy.evaluate("exec_cmd", ["exec"]);
    assert.equal(decision.allowed, true);
  });

  it("REFUSE un outil sans permission déclarée en enforce (fermeture du passe-droit)", () => {
    // Régression sécurité : avant, un outil sans permission (`[]` ou undefined)
    // passait inconditionnellement en enforce, y compris un outil à effet de
    // bord dont le nom n'était pas reconnu par l'inférence. Désormais refus
    // déterministe avec le motif `undeclared`.
    const policy = new PermissionPolicy({ mode: "enforce", granted: [...ALL_PERMISSIONS] });
    const emptyDecision = policy.evaluate("noop", []);
    assert.equal(emptyDecision.allowed, false);
    assert.deepEqual(emptyDecision.missing, [UNDECLARED_PERMISSION]);

    const undefDecision = policy.evaluate("noop", undefined);
    assert.equal(undefDecision.allowed, false);
    assert.deepEqual(undefDecision.missing, [UNDECLARED_PERMISSION]);
  });

  it("le refus des non-déclarés est indépendant du jeu accordé", () => {
    // Même avec write/exec/dangerous accordés, un outil non déclaré est refusé :
    // il ne doit pas se faufiler parce qu'une permission à effet de bord est
    // accordée globalement.
    const policy = new PermissionPolicy({ mode: "enforce", granted: [...ALL_PERMISSIONS] });
    assert.equal(policy.evaluate("mystery_side_effect", []).allowed, false);
  });

  it("denyUndeclared:false restaure le passe-droit historique (opt-out explicite)", () => {
    const policy = new PermissionPolicy({
      mode: "enforce",
      granted: [],
      denyUndeclared: false,
    });
    assert.equal(policy.evaluate("noop", []).allowed, true);
    assert.equal(policy.evaluate("noop", undefined).allowed, true);
  });

  it("mode off laisse passer un outil non déclaré (legacy)", () => {
    const policy = new PermissionPolicy({ mode: "off", granted: [] });
    const decision = policy.evaluate("noop", []);
    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.missing, []);
  });

  it("mode audit laisse passer un outil non déclaré mais signale le motif undeclared", () => {
    const policy = new PermissionPolicy({ mode: "audit", granted: [] });
    const decision = policy.enforce("noop", []);
    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.missing, [UNDECLARED_PERMISSION]);
    assert.equal(policy.getDenials().length, 1);
  });

  it("enforce lève une décision refusée avec message dédié pour un outil non déclaré", () => {
    const policy = new PermissionPolicy({ mode: "enforce", granted: [...ALL_PERMISSIONS] });
    const decision = policy.enforce("mystery", []);
    assert.equal(decision.allowed, false);
    const err = new PermissionDeniedError(decision);
    assert.ok(err.message.includes("aucune permission"));
    assert.ok(err.missing.includes(UNDECLARED_PERMISSION));
  });

  it("un outil déclarant read reste autorisé (le durcissement ne touche que les non-déclarés)", () => {
    const policy = new PermissionPolicy({ mode: "enforce", granted: ["read"] });
    assert.equal(policy.evaluate("read_only", ["read"]).allowed, true);
  });

  it("normalise execute vers exec lors de l'évaluation", () => {
    const policy = new PermissionPolicy({ mode: "enforce", granted: ["exec"] });
    assert.equal(policy.evaluate("legacy", ["execute"]).allowed, true);
  });

  it("grant/revoke modifie le jeu accordé", () => {
    const policy = new PermissionPolicy({ mode: "enforce", granted: ["read"] });
    assert.equal(policy.evaluate("t", ["network"]).allowed, false);
    policy.grant("network");
    assert.equal(policy.evaluate("t", ["network"]).allowed, true);
    policy.revoke("network");
    assert.equal(policy.evaluate("t", ["network"]).allowed, false);
  });

  it("fromEnv lit le mode et les permissions accordées", () => {
    const policy = PermissionPolicy.fromEnv({
      Leanna_PERMISSION_MODE: "enforce",
      Leanna_GRANTED_PERMISSIONS: "read, network",
    } as NodeJS.ProcessEnv);
    assert.equal(policy.getMode(), "enforce");
    assert.deepEqual(policy.getGranted(), ["read", "network"]);
  });

  it("fromEnv accorde toutes les permissions par défaut", () => {
    const policy = PermissionPolicy.fromEnv({} as NodeJS.ProcessEnv);
    assert.equal(policy.getMode(), "enforce");
    assert.deepEqual(policy.getGranted(), normalizePermissions([...ALL_PERMISSIONS]));
  });

  it("fromEnv retombe sur enforce pour un mode invalide", () => {
    const policy = PermissionPolicy.fromEnv({ Leanna_PERMISSION_MODE: "banana" } as NodeJS.ProcessEnv);
    assert.equal(policy.getMode(), "enforce");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ToolRegistry — application au runtime
// ═══════════════════════════════════════════════════════════════════════════════

describe("ToolRegistry + PermissionPolicy", () => {
  function makeRegistry(policy: PermissionPolicy): ToolRegistry {
    const registry = new ToolRegistry({ permissionPolicy: policy, enableMetrics: false });
    registry.register({
      declaration: { name: "read_thing", description: "", parameters: {} },
      handler: async () => "read-ok",
      permissions: ["read"],
    });
    registry.register({
      declaration: { name: "write_thing", description: "", parameters: {} },
      handler: async () => "write-ok",
      permissions: ["write"],
    });
    return registry;
  }

  it("exécute un outil dont la permission est accordée", async () => {
    const registry = makeRegistry(new PermissionPolicy({ mode: "enforce", granted: ["read"] }));
    assert.equal(await registry.call("read_thing", {}), "read-ok");
  });

  it("refuse au runtime un outil dont la permission manque", async () => {
    const registry = makeRegistry(new PermissionPolicy({ mode: "enforce", granted: ["read"] }));
    await assert.rejects(
      () => registry.call("write_thing", {}),
      (err: unknown) => err instanceof PermissionDeniedError && err.missing.includes("write")
    );
  });

  it("applique la politique indépendamment des callerPermissions", async () => {
    // Même si l'appelant prétend avoir "write", la politique runtime prime.
    const registry = makeRegistry(new PermissionPolicy({ mode: "enforce", granted: ["read"] }));
    await assert.rejects(
      () => registry.call("write_thing", {}, { callerPermissions: ["write"] }),
      (err: unknown) => err instanceof PermissionDeniedError
    );
  });

  it("laisse tout passer en mode off", async () => {
    const registry = makeRegistry(new PermissionPolicy({ mode: "off", granted: [] }));
    assert.equal(await registry.call("write_thing", {}), "write-ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ToolRegistry — outil à permissions vides (fermeture du passe-droit, bout-en-bout)
// ═══════════════════════════════════════════════════════════════════════════════

describe("ToolRegistry + outil sans permission déclarée", () => {
  let executed = false;

  function makeRegistry(policy: PermissionPolicy, dryRun?: DryRunController): ToolRegistry {
    executed = false;
    const registry = new ToolRegistry({
      permissionPolicy: policy,
      dryRun,
      enableMetrics: false,
    });
    // Outil à EFFET DE BORD dont le nom n'est pas reconnu par l'inférence :
    // il arrive au registre avec `permissions: []`. C'est le cas dangereux.
    registry.register({
      declaration: { name: "mystery_side_effect", description: "", parameters: {} },
      handler: async () => {
        executed = true;
        return "did-something";
      },
      permissions: [],
    });
    return registry;
  }

  it("REFUSE l'exécution en enforce + dry-run off (le handler ne tourne jamais)", async () => {
    const registry = makeRegistry(
      new PermissionPolicy({ mode: "enforce", granted: [...ALL_PERMISSIONS] }),
      new DryRunController({ enabled: false })
    );
    await assert.rejects(
      () => registry.call("mystery_side_effect", {}),
      (err: unknown) =>
        err instanceof PermissionDeniedError && err.missing.includes(UNDECLARED_PERMISSION)
    );
    assert.equal(executed, false, "le handler à effet de bord ne doit PAS s'exécuter");
  });

  it("simule (n'exécute pas) l'outil non déclaré en dry-run, sans refus de permission", async () => {
    // En dry-run, la protection existante intercepte AVANT que le refus enforce
    // n'ait à jouer : l'ordre dans call() applique enforce d'abord. On désactive
    // donc denyUndeclared pour valider spécifiquement la voie dry-run/simulation.
    const registry = makeRegistry(
      new PermissionPolicy({
        mode: "enforce",
        granted: [...ALL_PERMISSIONS],
        denyUndeclared: false,
      }),
      new DryRunController({ enabled: true })
    );
    const result = (await registry.call("mystery_side_effect", {})) as { simulated?: boolean };
    assert.equal(executed, false, "le handler ne doit pas s'exécuter en dry-run");
    assert.equal(result?.simulated, true);
  });

  it("un outil déclarant read reste exécutable en enforce", async () => {
    const registry = new ToolRegistry({
      permissionPolicy: new PermissionPolicy({ mode: "enforce", granted: ["read"] }),
      enableMetrics: false,
    });
    registry.register({
      declaration: { name: "read_only", description: "", parameters: {} },
      handler: async () => "read-ok",
      permissions: ["read"],
    });
    assert.equal(await registry.call("read_only", {}), "read-ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Chantier C — Autorisation déterministe PAR AGENT
// ═══════════════════════════════════════════════════════════════════════════════

describe("PermissionPolicy — autorisation par agent", () => {
  const grantedAll = () =>
    new PermissionPolicy({ mode: "enforce", granted: [...ALL_PERMISSIONS] });

  it("refuse un agent hors allowedAgents sur un outil à risque (enforce)", () => {
    const policy = grantedAll();
    const decision = policy.enforce("git_push", ["network"], "reviewer", {
      allowedAgents: ["coder"],
      risk: "dangerous",
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.missing.some((m) => m.startsWith(`${AGENT_NOT_ALLOWED}:`)));
  });

  it("autorise un agent présent dans allowedAgents", () => {
    const policy = grantedAll();
    const decision = policy.enforce("git_push", ["network"], "coder", {
      allowedAgents: ["coder"],
      risk: "dangerous",
    });
    assert.equal(decision.allowed, true);
  });

  it("ne restreint PAS un outil de lecture même avec allowedAgents", () => {
    // risk=read (ou absent) → la règle par-agent ne s'applique pas.
    const policy = grantedAll();
    const decision = policy.enforce("read_thing", ["read"], "reviewer", {
      allowedAgents: ["coder"],
      risk: "read",
    });
    assert.equal(decision.allowed, true);
  });

  it("sans allowedAgents, aucun agent n'est restreint", () => {
    const policy = grantedAll();
    const decision = policy.enforce("run_tests", ["exec"], "writer", { risk: "exec" });
    assert.equal(decision.allowed, true);
  });

  it("rétro-compatibilité : sans agentId, la règle par-agent ne s'applique pas", () => {
    const policy = grantedAll();
    const decision = policy.enforce("git_push", ["network"], undefined, {
      allowedAgents: ["coder"],
      risk: "dangerous",
    });
    assert.equal(decision.allowed, true);
  });

  it("mode audit : laisse passer un agent hors liste mais signale le motif", () => {
    const policy = new PermissionPolicy({ mode: "audit", granted: [...ALL_PERMISSIONS] });
    const decision = policy.enforce("git_push", ["network"], "reviewer", {
      allowedAgents: ["coder"],
      risk: "dangerous",
    });
    assert.equal(decision.allowed, true);
    assert.ok(decision.missing.some((m) => m.startsWith(`${AGENT_NOT_ALLOWED}:`)));
  });

  it("mode off : aucun contrôle par agent", () => {
    const policy = new PermissionPolicy({ mode: "off", granted: [] });
    const decision = policy.enforce("git_push", ["network"], "reviewer", {
      allowedAgents: ["coder"],
      risk: "dangerous",
    });
    assert.equal(decision.allowed, true);
  });

  it("PermissionDeniedError porte un message dédié à l'agent", () => {
    const policy = grantedAll();
    const decision = policy.enforce("delete_project_file", ["dangerous"], "writer", {
      allowedAgents: ["coder", "refactor"],
      risk: "dangerous",
    });
    const err = new PermissionDeniedError(decision);
    assert.ok(err.message.includes('agent "writer"'));
  });
});

describe("ToolRegistry — autorisation par agent (bout-en-bout)", () => {
  function makeRegistry(): ToolRegistry {
    const registry = new ToolRegistry({
      permissionPolicy: new PermissionPolicy({ mode: "enforce", granted: [...ALL_PERMISSIONS] }),
      enableMetrics: false,
    });
    registry.register({
      declaration: { name: "delete_project_file", description: "", parameters: {} },
      handler: async () => "deleted",
      permissions: ["write", "dangerous"],
      attribution: { allowedAgents: ["coder", "refactor"], risk: "dangerous" },
    });
    return registry;
  }

  it("refuse l'exécution pour un agent hors liste", async () => {
    const registry = makeRegistry();
    await assert.rejects(
      () => registry.call("delete_project_file", {}, { agentId: "writer" }),
      (err: unknown) =>
        err instanceof PermissionDeniedError &&
        err.missing.some((m) => String(m).startsWith(`${AGENT_NOT_ALLOWED}:`))
    );
  });

  it("autorise l'exécution pour un agent de la liste", async () => {
    const registry = makeRegistry();
    assert.equal(await registry.call("delete_project_file", {}, { agentId: "coder" }), "deleted");
  });

  it("rétro-compatibilité : un appel sans agentId n'est pas soumis à la règle", async () => {
    const registry = makeRegistry();
    assert.equal(await registry.call("delete_project_file", {}), "deleted");
  });
});

describe("applyRuntimeAgentAuthorization — estampillage des outils sensibles", () => {
  it("estampille allowedAgents + risk sur un outil sensible sans attribution", () => {
    const defs: ToolDefinition[] = [
      {
        declaration: { name: "git_push", description: "", parameters: {} },
        handler: async () => null,
        permissions: ["network"],
      },
    ];
    const stamped = applyRuntimeAgentAuthorization(defs);
    assert.equal(stamped, 1);
    assert.deepEqual(defs[0].attribution?.allowedAgents, ["coder"]);
    assert.equal(defs[0].attribution?.risk, "dangerous");
  });

  it("ne surcharge PAS une attribution déjà déclarée par l'outil", () => {
    const defs: ToolDefinition[] = [
      {
        declaration: { name: "delete_project_file", description: "", parameters: {} },
        handler: async () => null,
        permissions: ["write", "dangerous"],
        attribution: { allowedAgents: ["architect"], risk: "write" },
      },
    ];
    applyRuntimeAgentAuthorization(defs);
    assert.deepEqual(defs[0].attribution?.allowedAgents, ["architect"]);
    assert.equal(defs[0].attribution?.risk, "write");
  });

  it("ignore les outils non sensibles", () => {
    const defs: ToolDefinition[] = [
      {
        declaration: { name: "read_project_file", description: "", parameters: {} },
        handler: async () => null,
        permissions: ["read"],
      },
    ];
    const stamped = applyRuntimeAgentAuthorization(defs);
    assert.equal(stamped, 0);
    assert.equal(defs[0].attribution, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SkillAdapter — propagation des permissions déclarées
// ═══════════════════════════════════════════════════════════════════════════════

describe("SkillAdapter — permissions déclarées", () => {
  it("utilise les permissions par outil déclarées sur le skill", () => {
    const skill: LegacySkill = {
      name: "demo",
      permissions: ["read"],
      toolPermissions: { danger: ["write", "exec"] },
      declarations: [
        { name: "peek", description: "", parameters: {} },
        { name: "danger", description: "", parameters: {} },
      ],
      handleToolCall: async () => null,
    };

    const defs = adaptSkill(skill);
    const peek = defs.find((d) => d.declaration.name === "peek")!;
    const danger = defs.find((d) => d.declaration.name === "danger")!;

    assert.deepEqual(peek.permissions, ["read"]);
    assert.deepEqual(danger.permissions, ["write", "exec"]);
  });

  it("privilégie la permission déclarée sur la déclaration d'outil", () => {
    const skill: LegacySkill = {
      name: "demo2",
      permissions: ["read"],
      declarations: [{ name: "special", description: "", parameters: {}, permissions: ["network"] }],
      handleToolCall: async () => null,
    };
    const [def] = adaptSkill(skill);
    assert.deepEqual(def.permissions, ["network"]);
  });

  it("retombe sur l'inférence par nom quand rien n'est déclaré", () => {
    const skill: LegacySkill = {
      name: "misc",
      declarations: [{ name: "read_config", description: "", parameters: {} }],
      handleToolCall: async () => null,
    };
    const [def] = adaptSkill(skill);
    assert.ok(def.permissions?.includes("read"));
  });

  it("ne classe PAS en lecture seule un outil au nom non reconnu (fail-safe)", () => {
    // Régression sécurité : un outil à effet de bord dont le nom ne matche aucun
    // mot-clé (ex: telegram_notify, automation_click, agent_delegate avant
    // déclaration explicite) ne doit pas hériter de ["read"]. Il doit obtenir un
    // tableau vide, que le dry-run et l'AutonomyPolicy traitent comme un effet
    // de bord potentiel.
    const skill: LegacySkill = {
      name: "misc",
      declarations: [{ name: "notify_owner", description: "", parameters: {} }],
      handleToolCall: async () => null,
    };
    const [def] = adaptSkill(skill);
    assert.deepEqual(def.permissions, []);
  });
});
