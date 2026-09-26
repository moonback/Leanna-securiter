#!/usr/bin/env node
/**
 * brain-smoke.mjs — Smoke-test réel de l'Agent Brain (scheduler DAG)
 *
 * Enchaîne un appel `plan_first` (planification + validation + Mermaid) puis,
 * en option, une exécution `auto` de bout en bout. Affiche le DAG Mermaid, la
 * liste des étapes avec leurs dépendances, et le rapport d'exécution.
 *
 * Prérequis : le serveur doit tourner (npm run dev) — port 4000 par défaut.
 * Le token est lu depuis .env (clé Leanna_API_TOKEN) ou la variable
 * d'environnement Leanna_API_TOKEN si présente.
 *
 * Usage :
 *   node scripts/brain-smoke.mjs                       # plan_first uniquement
 *   node scripts/brain-smoke.mjs --execute             # + exécution auto
 *   node scripts/brain-smoke.mjs --goal "Mon objectif" # objectif personnalisé
 *   node scripts/brain-smoke.mjs --url http://127.0.0.1:4000
 *
 * Codes de sortie : 0 = succès, 1 = échec (erreur réseau, plan invalide, etc.)
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Arguments CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const DO_EXECUTE = args.includes("--execute");
const BASE_URL = (argValue("--url", process.env.Leanna_SMOKE_URL) || "http://127.0.0.1:4000").replace(/\/$/, "");
const GOAL = argValue("--goal", "Modernise mon site et rends le header responsive");

// ─── Lecture du token depuis l'env ou .env ──────────────────────────────────────
function readToken() {
  if (process.env.Leanna_API_TOKEN) return process.env.Leanna_API_TOKEN.trim();
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return null;
  const line = readFileSync(envPath, "utf-8")
    .split(/\r?\n/)
    .find((l) => /^\s*Leanna_API_TOKEN\s*=/.test(l));
  if (!line) return null;
  const value = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return value || null;
}

const TOKEN = readToken();

// ─── Helpers d'affichage ─────────────────────────────────────────────────────
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function header(title) {
  console.log("\n" + c.bold(c.cyan(`── ${title} ` + "─".repeat(Math.max(0, 60 - title.length)))));
}

async function post(path, payload) {
  // Connection: close empêche undici de garder des sockets keep-alive ouverts,
  // ce qui évite l'assertion UV_HANDLE_CLOSING de libuv à la fermeture (Windows).
  const headers = { "Content-Type": "application/json", Connection: "close" };
  // Le serveur attend le header X-Leanna-Token (voir authenticateRequest).
  if (TOKEN) headers["X-Leanna-Token"] = TOKEN;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(c.red(`\n❌ Impossible de joindre ${BASE_URL}${path}`));
    console.error(c.dim(`   ${err.message}`));
    console.error(c.dim("   Le serveur est-il démarré ? (npm run dev)"));
    process.exit(1);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

// ─── Étape 1 : plan_first ────────────────────────────────────────────────────
async function runPlan() {
  header("plan_first — planification + validation + Mermaid");
  console.log(c.dim(`Objectif : ${GOAL}`));

  const { status, json } = await post("/api/agents/brain/plan", { goal: GOAL, contextFiles: [] });

  if (status !== 200) {
    console.error(c.red(`\n❌ Échec (HTTP ${status})`));
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const stages = json.stages ?? [];
  console.log(c.green(`\n✅ Plan généré : ${stages.length} étape(s)\n`));

  for (const s of stages) {
    const deps = (s.dependsOn ?? []).length ? ` ← [${s.dependsOn.join(", ")}]` : " (racine)";
    console.log(`  • ${c.bold(s.id)}  ${c.dim(`(${s.role})`)}  ${s.title}${c.dim(deps)}`);
  }

  if (json.mermaid) {
    header("DAG Mermaid (copie dans https://mermaid.live)");
    console.log(json.mermaid);
  } else {
    console.log(c.red("\n⚠️ Aucun champ 'mermaid' dans la réponse — vérifie le câblage plan_first."));
  }

  return json;
}

// ─── Étape 2 : exécution auto (optionnelle) ──────────────────────────────────
async function runExecute() {
  header("execute — exécution auto de bout en bout");
  console.log(c.dim("Regarde les logs du serveur pour les lignes '[BrainScheduler] ▶ Fan-out'."));

  const { status, json } = await post("/api/agents/brain/execute", {
    goal: GOAL,
    mode: "auto",
    maxCorrectionAttempts: 1,
    maxReplans: 1,
  });

  header(`Rapport d'exécution (HTTP ${status})`);
  console.log(`  Succès global : ${json.success ? c.green("oui") : c.red("non")}`);
  console.log(`  Résumé        : ${json.summary ?? "(n/a)"}`);
  if (Array.isArray(json.stagesExecuted)) {
    console.log("  Étapes :");
    for (const s of json.stagesExecuted) {
      const st = s.status ?? "?";
      const mark = st === "completed" ? c.green("✔") : c.red("✖");
      console.log(`    ${mark} ${s.role} — ${s.title} ${c.dim(`[${st}, ${s.durationMs ?? 0}ms]`)}`);
    }
  }
  if (Array.isArray(json.filesModified) && json.filesModified.length) {
    console.log(`  Fichiers modifiés : ${json.filesModified.join(", ")}`);
  }
  if (typeof json.correctionsApplied === "number") {
    console.log(`  Corrections appliquées : ${json.correctionsApplied}`);
  }

  // HTTP 207 = succès partiel (certaines branches ont abouti) ; on ne l'échoue pas.
  if (status !== 200 && status !== 207) {
    process.exit(1);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(c.bold(`\n🧠 Brain smoke-test → ${BASE_URL}`));
  console.log(c.dim(TOKEN ? "   Auth : header X-Leanna-Token détecté" : "   Auth : aucun token (Leanna_API_TOKEN absent)"));

  await runPlan();

  if (DO_EXECUTE) {
    await runExecute();
  } else {
    console.log(c.dim("\nℹ️  Ajoute --execute pour lancer aussi l'exécution auto de bout en bout."));
  }

  console.log(c.green("\n✅ Smoke-test terminé.\n"));

  // Laisser un court instant à undici pour fermer ses sockets (Connection:close),
  // puis sortir. Combiné à l'en-tête Connection:close, cela évite l'assertion
  // UV_HANDLE_CLOSING de libuv observée sous Windows à la fermeture du process.
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(0);
})().catch((err) => {
  console.error(c.red(`\n❌ Erreur inattendue : ${err?.message ?? err}`));
  process.exit(1);
});
