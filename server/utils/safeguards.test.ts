/**
 * safeguards.test.ts — Tests d'intégration des garde-fous auto-modification (Phase 5 QA).
 *
 * Couvre :
 * - confirmationBridge : demande/réponse/timeout
 * - serverRestart : détection des fichiers serveur
 * - postEditValidator : scheduling et état
 * - audit : génération de diff
 * - MCP sandboxing : validation des chemins (via selfRoot)
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";

import { requestConfirmation, handleConfirmationResponse, getPendingCount, cancelAllPending } from "./confirmationBridge.js";
import { requiresRestart } from "./serverRestart.js";
import { generateDiffSummary } from "../audit.js";
import { normalizeSelfPath, SELF_ROOT, setSelfRoot } from "./selfRoot.js";

// Ensure SELF_ROOT is set before any test assertions — walk up from server/utils/
{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname_local = path.dirname(__filename);
  setSelfRoot(path.resolve(__dirname_local, '..', '..'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// confirmationBridge
// ═══════════════════════════════════════════════════════════════════════════════

test("requestConfirmation émet une demande et enregistre un pending", async () => {
  let emitted: any = null;
  const promise = requestConfirmation("server.ts", "write", (data) => { emitted = data; }, "test");

  assert.ok(emitted, "un message doit être émis");
  assert.equal(emitted.type, "confirm-critical-edit");
  assert.equal(emitted.filePath, "server.ts");
  assert.equal(emitted.operation, "write");
  assert.ok(emitted.requestId, "un requestId doit être fourni");
  assert.equal(getPendingCount(), 1, "une confirmation doit être en attente");

  // Répondre pour résoudre la promesse
  handleConfirmationResponse(emitted.requestId, true);
  const approved = await promise;
  assert.equal(approved, true, "la promesse doit se résoudre avec true");
  assert.equal(getPendingCount(), 0, "plus aucune confirmation en attente");
});

test("handleConfirmationResponse avec refus résout false", async () => {
  let emitted: any = null;
  const promise = requestConfirmation("server/security.ts", "delete", (data) => { emitted = data; });

  handleConfirmationResponse(emitted.requestId, false);
  const approved = await promise;
  assert.equal(approved, false, "un refus doit résoudre false");
});

test("handleConfirmationResponse avec requestId inconnu retourne false", () => {
  const handled = handleConfirmationResponse("inexistant-id", true);
  assert.equal(handled, false, "un requestId inconnu ne doit pas être traité");
});

test("cancelAllPending résout toutes les confirmations en attente à false", async () => {
  let e1: any = null, e2: any = null;
  const p1 = requestConfirmation("a.ts", "write", (d) => { e1 = d; });
  const p2 = requestConfirmation("b.ts", "write", (d) => { e2 = d; });
  assert.equal(getPendingCount(), 2);

  cancelAllPending();
  assert.equal(getPendingCount(), 0);
  assert.equal(await p1, false);
  assert.equal(await p2, false);
});

test("requestConfirmation gère l'échec d'émission (résout false)", async () => {
  const approved = await requestConfirmation("x.ts", "write", () => {
    throw new Error("WS fermé");
  });
  assert.equal(approved, false, "un échec d'émission doit résoudre false");
});

// ═══════════════════════════════════════════════════════════════════════════════
// serverRestart — détection des fichiers nécessitant un restart
// ═══════════════════════════════════════════════════════════════════════════════

test("requiresRestart détecte les fichiers serveur", () => {
  assert.ok(requiresRestart("server.ts"), "server.ts doit nécessiter un restart");
  assert.ok(requiresRestart("server/skills/codebase.ts"), "les fichiers server/ doivent nécessiter un restart");
  assert.ok(requiresRestart("electron/main.cjs"), "les fichiers electron/ doivent nécessiter un restart");
});

test("requiresRestart ignore les fichiers frontend", () => {
  assert.ok(!requiresRestart("src/App.tsx"), "les fichiers src/ ne nécessitent pas de restart");
  assert.ok(!requiresRestart("README.md"), "les docs ne nécessitent pas de restart");
  assert.ok(!requiresRestart("package.json"), "package.json seul ne matche pas les patterns serveur");
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit — génération de diff
// ═══════════════════════════════════════════════════════════════════════════════

test("generateDiffSummary détecte un nouveau fichier", () => {
  const diff = generateDiffSummary(null, "const x = 1;");
  assert.match(diff, /\[NEW\]/, "un nouveau fichier doit être marqué [NEW]");
});

test("generateDiffSummary détecte une suppression", () => {
  const diff = generateDiffSummary("const x = 1;", null);
  assert.match(diff, /\[DELETED\]/, "une suppression doit être marquée [DELETED]");
});

test("generateDiffSummary détecte les lignes modifiées", () => {
  const before = "line1\nline2\nline3";
  const after = "line1\nMODIFIED\nline3";
  const diff = generateDiffSummary(before, after);
  assert.match(diff, /~L2/, "la ligne 2 modifiée doit être détectée");
  assert.match(diff, /MODIFIED/, "le nouveau contenu doit apparaître");
});

test("generateDiffSummary tronque les diffs trop longs", () => {
  const before = "x";
  const after = "y".repeat(2000);
  const diff = generateDiffSummary(before, after, 100);
  assert.ok(diff.length <= 101, `le diff doit être tronqué (got ${diff.length})`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP sandboxing — validation des chemins
// ═══════════════════════════════════════════════════════════════════════════════

test("normalizeSelfPath rejette les tentatives de sortie pour les tools MCP", () => {
  // Simule ce que fait McpBridge.sanitizePathArgs
  const maliciousPaths = [
    "../../../etc/passwd",
    "..\\..\\Windows\\System32",
    "/absolute/outside",
  ];
  for (const p of maliciousPaths) {
    const resolved = normalizeSelfPath(p);
    if (resolved !== null) {
      assert.ok(resolved.startsWith(SELF_ROOT), `MCP path escape: ${p} → ${resolved}`);
    }
  }
});

test("normalizeSelfPath accepte les chemins MCP légitimes", () => {
  const resolved = normalizeSelfPath("src/components/App.tsx");
  assert.ok(resolved !== null && resolved.startsWith(SELF_ROOT));
});
