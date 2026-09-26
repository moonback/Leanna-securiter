#!/usr/bin/env node
/**
 * Purge des données de conversation et d'agents (Supabase).
 *
 * ⚠️ OPÉRATION DESTRUCTRICE ET IRRÉVERSIBLE. Exige --confirm pour s'exécuter.
 *
 * Périmètre (voie 2 : API là où elle existe, Supabase direct sinon) :
 *   • conversations (+ conversation_messages en cascade)  → via API DELETE /api/conversations/all
 *   • memories                                            → via API DELETE /api/memories/all
 *   • agent_messages                                      → Supabase direct (aucun endpoint)
 *   • agent_tasks                                         → Supabase direct (aucun endpoint)
 *   • agent_orchestrations                                → Supabase direct (aucun endpoint)
 *   • missions                                            → Supabase direct (endpoint = delete par id seulement)
 *
 * Prérequis :
 *   • Pour la partie API : le backend doit tourner (npm run dev).
 *   • Pour la partie Supabase directe : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env.
 *   • @supabase/supabase-js est déjà une dépendance du projet.
 *
 * Usage :
 *   node scripts/purge-conversation-agent-data.mjs               # aperçu (dry-run), ne supprime RIEN
 *   node scripts/purge-conversation-agent-data.mjs --confirm     # exécute la purge
 *   node scripts/purge-conversation-agent-data.mjs --confirm --skip-api      # ignore la partie API
 *   node scripts/purge-conversation-agent-data.mjs --confirm --skip-supabase # ignore la partie Supabase directe
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Chargement minimal du .env ─────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnv();

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SKIP_API = args.includes("--skip-api");
const SKIP_SUPABASE = args.includes("--skip-supabase");

const PORT = process.env.VITE_SERVER_PORT || "4000";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TOKEN = (process.env.Leanna_API_TOKEN || "").trim();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Sentinelle "tout" utilisée par le code du projet : delete où id != uuid nul.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const AGENT_TABLES = ["agent_messages", "agent_tasks", "agent_orchestrations"];

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (TOKEN) h["x-leanna-token"] = TOKEN;
  return h;
}

// ─── Partie API (conversations + memories) ──────────────────────────────────
async function deleteViaApi(label, pathname) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${JSON.stringify(body)}`);
  const deleted = body?.deleted ?? "?";
  console.log(`  ✓ ${label} : ${deleted} enregistrement(s) supprimé(s)`);
  return deleted;
}

// ─── Partie Supabase directe (agents + missions) ────────────────────────────
async function countTable(supabase, table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table} (count) : ${error.message}`);
  return count ?? 0;
}

async function deleteAllFrom(supabase, table) {
  const before = await countTable(supabase, table);
  if (!CONFIRM) {
    console.log(`  • ${table} : ${before} enregistrement(s) — SERAIENT supprimés`);
    return before;
  }
  const { error } = await supabase.from(table).delete().neq("id", NIL_UUID);
  if (error) throw new Error(`${table} (delete) : ${error.message}`);
  console.log(`  ✓ ${table} : ${before} enregistrement(s) supprimé(s)`);
  return before;
}

async function apiPreview() {
  // On ne peut pas compter via l'API sans exécuter ; on signale juste l'action.
  console.log("  • conversations (+ messages en cascade) : DELETE /api/conversations/all");
  console.log("  • memories                               : DELETE /api/memories/all");
}

async function main() {
  console.log("═".repeat(68));
  console.log("PURGE — données de conversation & d'agents");
  console.log("═".repeat(68));
  console.log(`Mode : ${CONFIRM ? "⚠️  EXÉCUTION RÉELLE" : "aperçu (dry-run) — rien ne sera supprimé"}`);
  console.log(`API  : ${SKIP_API ? "ignorée" : BASE_URL}`);
  console.log(`Supabase : ${SKIP_SUPABASE ? "ignorée" : SUPABASE_URL ? "configuré" : "NON configuré"}`);
  console.log("");

  // ── Partie API ──
  if (!SKIP_API) {
    console.log("── API (conversations + memories) ──");
    if (!CONFIRM) {
      await apiPreview();
    } else {
      // Vérifie que le serveur répond avant de tenter les suppressions.
      try {
        const ping = await fetch(`${BASE_URL}/api/health`, { method: "GET" });
        if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
      } catch (err) {
        console.log(
          `  ❌ Serveur injoignable sur ${BASE_URL} (${err.message}).\n` +
            `     Démarre le backend (npm run dev) ou relance avec --skip-api.`
        );
        process.exitCode = 1;
        return;
      }
      try {
        await deleteViaApi("conversations (+ messages)", "/api/conversations/all");
      } catch (err) {
        console.log(`  ❌ conversations : ${err.message}`);
      }
      try {
        await deleteViaApi("memories", "/api/memories/all");
      } catch (err) {
        console.log(`  ❌ memories : ${err.message}`);
      }
    }
    console.log("");
  }

  // ── Partie Supabase directe ──
  if (!SKIP_SUPABASE) {
    console.log("── Supabase direct (agent_messages, agent_tasks, agent_orchestrations, missions) ──");
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.log("  ❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents du .env. Partie ignorée.");
    } else {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      for (const table of [...AGENT_TABLES, "missions"]) {
        try {
          await deleteAllFrom(supabase, table);
        } catch (err) {
          console.log(`  ❌ ${err.message}`);
        }
      }
    }
    console.log("");
  }

  console.log("═".repeat(68));
  if (!CONFIRM) {
    console.log("Aperçu terminé. Aucune donnée supprimée.");
    console.log("Pour exécuter réellement : node scripts/purge-conversation-agent-data.mjs --confirm");
  } else {
    console.log("Purge terminée.");
  }
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
