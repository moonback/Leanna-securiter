/**
 * Tests du dry-run global (simulation sans effet de bord).
 *
 * Couvre :
 *   - DryRunController.shouldSimulate / sideEffectsOf / simulate / report
 *   - Interception au niveau du ToolRegistry (les outils à effet de bord ne
 *     sont pas exécutés ; les lectures le sont)
 *   - Override par appel (options.dryRun) vs état global
 *   - fromEnv (Leanna_DRY_RUN)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DryRunController } from "./DryRun.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { PermissionPolicy } from "./PermissionPolicy.js";

// ═══════════════════════════════════════════════════════════════════════════════
// DryRunController
// ═══════════════════════════════════════════════════════════════════════════════

describe("DryRunController", () => {
  it("ne simule rien quand il est désactivé", () => {
    const dr = new DryRunController({ enabled: false });
    assert.equal(dr.shouldSimulate(["write"]), false);
    assert.equal(dr.shouldSimulate(["read"]), false);
  });

  it("simule les outils à effet de bord mais pas les lectures", () => {
    const dr = new DryRunController({ enabled: true });
    assert.equal(dr.shouldSimulate(["read"]), false);
    assert.equal(dr.shouldSimulate(["write"]), true);
    assert.equal(dr.shouldSimulate(["exec"]), true);
    assert.equal(dr.shouldSimulate(["network"]), true);
    assert.equal(dr.shouldSimulate(["read", "write"]), true);
  });

  it("traite execute comme exec (normalisation)", () => {
    const dr = new DryRunController({ enabled: true });
    assert.equal(dr.shouldSimulate(["execute"]), true);
  });

  it("traite un outil sans permission déclarée comme effet de bord (prudence)", () => {
    const dr = new DryRunController({ enabled: true });
    assert.equal(dr.shouldSimulate(undefined), true);
    assert.equal(dr.shouldSimulate([]), true);
    assert.deepEqual(dr.sideEffectsOf(undefined), ["write"]);
  });

  it("enregistre un effet simulé et produit un rapport", () => {
    const dr = new DryRunController({ enabled: true });
    const res = dr.simulate("write_file", ["write"], { path: "a.ts" });
    assert.equal(res.simulated, true);
    assert.equal(res.__dryRun, true);
    assert.deepEqual(res.wouldHaveEffects, ["write"]);

    dr.simulate("run_cmd", ["exec"], { command: "rm -rf /" });
    const report = dr.getReport();
    assert.equal(report.totalSimulated, 2);
    assert.equal(report.byTool["write_file"], 1);
    assert.equal(report.byTool["run_cmd"], 1);
    assert.equal(report.byEffect["write"], 1);
    assert.equal(report.byEffect["exec"], 1);
  });

  it("tronque les arguments volumineux dans le journal", () => {
    const dr = new DryRunController({ enabled: true });
    const big = "x".repeat(500);
    dr.simulate("write_file", ["write"], { content: big });
    const effect = dr.getReport().effects[0];
    assert.ok((effect.args.content as string).length < 500);
    assert.match(effect.args.content as string, /car\.\)$/);
  });

  it("reset vide le journal", () => {
    const dr = new DryRunController({ enabled: true });
    dr.simulate("write_file", ["write"], {});
    dr.reset();
    assert.equal(dr.getReport().totalSimulated, 0);
  });

  it("fromEnv active via Leanna_DRY_RUN", () => {
    assert.equal(DryRunController.fromEnv({ Leanna_DRY_RUN: "true" } as NodeJS.ProcessEnv).isEnabled(), true);
    assert.equal(DryRunController.fromEnv({ Leanna_DRY_RUN: "1" } as NodeJS.ProcessEnv).isEnabled(), true);
    assert.equal(DryRunController.fromEnv({} as NodeJS.ProcessEnv).isEnabled(), false);
    assert.equal(DryRunController.fromEnv({ Leanna_DRY_RUN: "no" } as NodeJS.ProcessEnv).isEnabled(), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ToolRegistry — interception dry-run
// ═══════════════════════════════════════════════════════════════════════════════

describe("ToolRegistry + DryRun", () => {
  function makeRegistry(dr: DryRunController): { registry: ToolRegistry; calls: string[] } {
    const calls: string[] = [];
    // Politique permissive pour isoler le comportement dry-run.
    const registry = new ToolRegistry({
      dryRun: dr,
      enableMetrics: false,
      permissionPolicy: new PermissionPolicy({ mode: "off" }),
    });
    registry.register({
      declaration: { name: "read_file", description: "", parameters: {} },
      handler: async () => {
        calls.push("read_file");
        return "real-read";
      },
      permissions: ["read"],
    });
    registry.register({
      declaration: { name: "write_file", description: "", parameters: {} },
      handler: async () => {
        calls.push("write_file");
        return "real-write";
      },
      permissions: ["write"],
    });
    return { registry, calls };
  }

  it("exécute réellement les lectures même en dry-run", async () => {
    const { registry, calls } = makeRegistry(new DryRunController({ enabled: true }));
    const res = await registry.call("read_file", {});
    assert.equal(res, "real-read");
    assert.deepEqual(calls, ["read_file"]);
  });

  it("simule les écritures sans exécuter le handler", async () => {
    const dr = new DryRunController({ enabled: true });
    const { registry, calls } = makeRegistry(dr);
    const res = (await registry.call("write_file", { path: "x.ts" })) as any;
    assert.equal(res.simulated, true);
    assert.equal(res.toolName, "write_file");
    // Le handler réel n'a PAS été appelé — aucun effet de bord.
    assert.deepEqual(calls, []);
    assert.equal(dr.getReport().totalSimulated, 1);
  });

  it("n'intercepte rien quand le dry-run global est désactivé", async () => {
    const { registry, calls } = makeRegistry(new DryRunController({ enabled: false }));
    const res = await registry.call("write_file", {});
    assert.equal(res, "real-write");
    assert.deepEqual(calls, ["write_file"]);
  });

  it("respecte l'override par appel (dryRun:true) même si global désactivé", async () => {
    const { registry, calls } = makeRegistry(new DryRunController({ enabled: false }));
    const res = (await registry.call("write_file", {}, { dryRun: true })) as any;
    assert.equal(res.simulated, true);
    assert.deepEqual(calls, []);
  });

  it("respecte l'override par appel (dryRun:false) même si global activé", async () => {
    const { registry, calls } = makeRegistry(new DryRunController({ enabled: true }));
    const res = await registry.call("write_file", {}, { dryRun: false });
    assert.equal(res, "real-write");
    assert.deepEqual(calls, ["write_file"]);
  });
});
