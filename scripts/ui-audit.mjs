#!/usr/bin/env node
/**
 * ui-audit.mjs — Audit automatisé des règles UI/UX
 *
 * Vérifie 12 règles dérivées du rapport d'audit du 17 septembre 2026.
 * Échoue (exit 1) si un compteur dépasse son budget fixé dans
 * scripts/ui-audit.budget.json.
 *
 * Usage :
 *   node scripts/ui-audit.mjs           # mode vérification (CI)
 *   node scripts/ui-audit.mjs --report  # affiche les détails complets
 *   node scripts/ui-audit.mjs --update-budget  # met à jour le budget
 *                                               # avec les valeurs actuelles
 *
 * Intégration CI (package.json) :
 *   "ui:audit": "node scripts/ui-audit.mjs"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { globSync } from 'fs'; // Node 22+ built-in glob — fallback ci-dessous

// ─── Compat glob (Node <22 n'a pas globSync natif) ─────────────────────────────
let glob;
try {
  // Node 22+ built-in
  glob = (await import('fs')).globSync;
  if (!glob) throw new Error('no built-in');
} catch {
  try {
    const g = await import('glob');
    glob = g.globSync ?? g.sync ?? g.default?.sync;
  } catch {
    // Implémentation minimaliste si glob n'est pas disponible
    const { readdirSync, statSync } = await import('fs');
    glob = (pattern, { cwd }) => {
      const ext = pattern.match(/\*\.([\w|]+)$/)?.[1]?.split('|') ?? ['tsx', 'ts'];
      const result = [];
      function walk(dir) {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            if (!['node_modules', '.git', 'dist', '.Leanna', 'graphify-out'].includes(e.name)) walk(full);
          } else if (ext.some(x => e.name.endsWith(`.${x}`))) {
            result.push(relative(cwd, full).replace(/\\/g, '/'));
          }
        }
      }
      walk(cwd);
      return result;
    };
  }
}

// ─── Configuration ──────────────────────────────────────────────────────────────

const ROOT        = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const SRC         = join(ROOT, 'src');
const BUDGET_FILE = join(ROOT, 'scripts', 'ui-audit.budget.json');

const ARGS          = process.argv.slice(2);
const MODE_REPORT   = ARGS.includes('--report');
const MODE_UPDATE   = ARGS.includes('--update-budget');

// ─── Collecte des fichiers sources ──────────────────────────────────────────────

const files = glob('**/*.{tsx,ts}', {
  cwd: SRC,
  ignore: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
}).map(f => ({ rel: f, abs: join(SRC, f) }));

// Lire le contenu une seule fois
const fileContents = files.map(f => ({
  ...f,
  src: readFileSync(f.abs, 'utf8'),
}));

// ─── Règles d'audit ─────────────────────────────────────────────────────────────

/**
 * Chaque règle retourne un tableau de { file, line?, detail } pour chaque
 * occurrence trouvée.
 */

/** Règle 1 : Tailles de texte arbitraires text-[Npx] */
function ruleArbitraryTextSize() {
  const re = /text-\[\d+(\.\d+)?px\]/g;
  return matchAll(re, 'text-[Npx] arbitraire');
}

/** Règle 2 : Couleurs hexadécimales en dur */
function ruleHardcodedHex() {
  // Exclure les commentaires et les tokens CSS (commence par var( ou color-mix)
  const re = /#[0-9a-fA-F]{3,8}\b/g;
  return matchAll(re, 'couleur hex codée en dur', (line) => {
    // Ignorer les lignes qui sont des commentaires CSS/JS
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  });
}

/** Règle 3 : Couleurs de palette Tailwind figées (non sémantiques) */
function ruleHardcodedTailwindPalette() {
  // Chercher des classes de couleur directes Tailwind (red-400, emerald-500, etc.)
  const re = /\b(text|bg|border|ring|from|to|via)-(red|green|blue|yellow|orange|purple|pink|indigo|emerald|teal|cyan|rose|violet|amber|lime|sky|fuchsia)-\d{2,3}\b/g;
  return matchAll(re, 'couleur palette Tailwind figée');
}

/** Règle 4 : Overlays manuels fixed inset-0 */
function ruleManualOverlay() {
  const re = /fixed\s+inset-0/g;
  return matchAll(re, 'overlay fixed inset-0 manuel');
}

/** Règle 5 : window.confirm */
function ruleWindowConfirm() {
  const re = /window\.confirm\s*\(/g;
  return matchAll(re, 'window.confirm — remplacer par useConfirm()');
}

/** Règle 6 : title= utilisé comme infobulle */
function ruleTitleTooltip() {
  // title= sur des éléments interactifs (button, a, div[onClick], span[onClick])
  const re = /\btitle=["'`{]/g;
  return matchAll(re, 'title= utilisé comme infobulle (utiliser <Tooltip>)');
}

/** Règle 7 : console.log en production */
function ruleConsoleLog() {
  const re = /console\.log\s*\(/g;
  return matchAll(re, 'console.log en production');
}

/** Règle 8 : z-index littéraux (z-50, z-[100]…) hors fichiers layers.css et useOverlay */
function ruleZIndexLiteral() {
  const EXCLUDED = ['layers.css', 'useOverlay.ts', 'index.css'];
  const re = /\bz-\[?(\d+)\]?\b/g;
  return matchAll(re, 'z-index littéral (utiliser var(--z-*))', null, (f) =>
    !EXCLUDED.some(ex => f.rel.endsWith(ex)),
  );
}

/** Règle 9 : backdrop-blur non standard (non-sm) */
function ruleNonStandardBlur() {
  const re = /backdrop-blur-(md|lg|xl|2xl|3xl)/g;
  return matchAll(re, 'backdrop-blur non standard (utiliser backdrop-blur-sm)');
}

/** Règle 10 : <div onClick> sans rôle clavier */
function ruleDivOnClick() {
  // div avec onClick mais sans role= ni tabIndex=
  const re = /<div[^>]*onClick[^>]*>/g;
  return matchAll(re, '<div onClick> sans role= ni tabIndex=', (line) => {
    return !line.includes('role=') && !line.includes('tabIndex=');
  });
}

/** Règle 11 : <button> brut (hors composants ui/) */
function ruleRawButton() {
  const re = /<button\b/g;
  return matchAll(re, '<button> brut (utiliser <Button> ou <IconButton>)', null, (f) => {
    // Autoriser dans les fichiers de primitives UI eux-mêmes
    const allowed = [
      'src/components/ui/',
      'src/hooks/',
      'examples/',
    ];
    const relNorm = f.rel.replace(/\\/g, '/');
    return !allowed.some(a => relNorm.includes(a));
  });
}

/** Règle 12 : <input> sans label associé (hors composants Field) */
function ruleInputWithoutLabel() {
  const re = /<input\b(?![^>]*aria-label)[^>]*>/g;
  return matchAll(re, '<input> sans aria-label (utiliser <Field><Input>)', (line) => {
    return (
      !line.includes('aria-label') &&
      !line.includes('aria-labelledby') &&
      !line.includes('type="hidden"') &&
      !line.includes('type={\'hidden\'}') &&
      !line.includes('type={"hidden"}')
    );
  }, (f) => {
    const relNorm = f.rel.replace(/\\/g, '/');
    return !relNorm.includes('src/components/ui/');
  });
}

// ─── Moteur d'exécution ─────────────────────────────────────────────────────────

/**
 * Parcourt tous les fichiers avec une regex et retourne les occurrences.
 * @param {RegExp} re         - Regex de recherche
 * @param {string} label      - Description de la règle
 * @param {Function|null} lineFilter - Filtre sur la ligne contenant le match
 * @param {Function|null} fileFilter - Filtre sur le fichier (retourne true pour inclure)
 */
function matchAll(re, label, lineFilter = null, fileFilter = null) {
  const results = [];
  for (const f of fileContents) {
    if (fileFilter && !fileFilter(f)) continue;
    const lines = f.src.split('\n');
    lines.forEach((line, idx) => {
      const matches = [...line.matchAll(re)];
      for (const m of matches) {
        if (lineFilter && !lineFilter(line)) continue;
        results.push({
          file:   f.rel.replace(/\\/g, '/'),
          line:   idx + 1,
          detail: m[0].slice(0, 80),
          label,
        });
      }
    });
  }
  return results;
}

// ─── Exécution de toutes les règles ────────────────────────────────────────────

const RULES = [
  { id: 'arbitrary_text_size',      fn: ruleArbitraryTextSize,       budget_key: 'arbitrary_text_size' },
  { id: 'hardcoded_hex',            fn: ruleHardcodedHex,            budget_key: 'hardcoded_hex' },
  { id: 'tailwind_palette',         fn: ruleHardcodedTailwindPalette, budget_key: 'tailwind_palette' },
  { id: 'manual_overlay',           fn: ruleManualOverlay,           budget_key: 'manual_overlay' },
  { id: 'window_confirm',           fn: ruleWindowConfirm,           budget_key: 'window_confirm' },
  { id: 'title_tooltip',            fn: ruleTitleTooltip,            budget_key: 'title_tooltip' },
  { id: 'console_log',              fn: ruleConsoleLog,              budget_key: 'console_log' },
  { id: 'z_index_literal',          fn: ruleZIndexLiteral,           budget_key: 'z_index_literal' },
  { id: 'non_standard_blur',        fn: ruleNonStandardBlur,         budget_key: 'non_standard_blur' },
  { id: 'div_onclick',              fn: ruleDivOnClick,              budget_key: 'div_onclick' },
  { id: 'raw_button',               fn: ruleRawButton,               budget_key: 'raw_button' },
  { id: 'input_without_label',      fn: ruleInputWithoutLabel,       budget_key: 'input_without_label' },
];

const results = {};
for (const rule of RULES) {
  results[rule.id] = rule.fn();
}

// ─── Chargement / mise à jour du budget ────────────────────────────────────────

let budget = {};
if (existsSync(BUDGET_FILE)) {
  try {
    budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
  } catch {
    console.warn('⚠ Impossible de lire ui-audit.budget.json — comparaison ignorée.');
  }
}

if (MODE_UPDATE) {
  const newBudget = {};
  for (const rule of RULES) {
    newBudget[rule.budget_key] = results[rule.id].length;
  }
  newBudget._updated = new Date().toISOString();
  writeFileSync(BUDGET_FILE, JSON.stringify(newBudget, null, 2) + '\n');
  console.log(`✅ Budget mis à jour → ${BUDGET_FILE}`);
  for (const [k, v] of Object.entries(newBudget)) {
    if (k !== '_updated') console.log(`   ${k.padEnd(30)} ${v}`);
  }
  process.exit(0);
}

// ─── Affichage et vérification ──────────────────────────────────────────────────

let hasFailure = false;

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' UI/UX AUDIT — Leanna (Jarvis-os-ori)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

for (const rule of RULES) {
  const hits    = results[rule.id];
  const count   = hits.length;
  const allowed = budget[rule.budget_key] ?? Infinity;
  const over    = count > allowed;

  const status = over
    ? '✗ FAIL'
    : count === 0
      ? '✓ OK  '
      : `⚑ ${count}/${allowed}`;

  const label = rule.id.replace(/_/g, ' ').padEnd(28);
  console.log(`  ${status}  ${label}  ${count} occurrence${count !== 1 ? 's' : ''}`);

  if (over) {
    hasFailure = true;
    console.log(`         Budget: ${allowed}  Actuel: ${count}  Régression: +${count - allowed}`);
  }

  if (MODE_REPORT && hits.length > 0) {
    const shown = hits.slice(0, 15);
    for (const h of shown) {
      console.log(`    → ${h.file}:${h.line}  ${h.detail}`);
    }
    if (hits.length > 15) {
      console.log(`    … et ${hits.length - 15} autres occurrences`);
    }
  }
}

// ─── Résumé ────────────────────────────────────────────────────────────────────

const total = Object.values(results).reduce((s, a) => s + a.length, 0);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (!existsSync(BUDGET_FILE)) {
  console.log('ℹ Budget non défini. Lancez avec --update-budget pour initialiser.');
  console.log(`  Total : ${total} occurrences\n`);
  process.exit(0);
}

if (hasFailure) {
  console.log(`✗ AUDIT ÉCHOUÉ — Des régressions ont été détectées.`);
  console.log(`  Corrigez les violations ou relancez avec --update-budget`);
  console.log(`  pour accepter les nouvelles valeurs (uniquement à la baisse).\n`);
  process.exit(1);
} else {
  console.log(`✓ AUDIT RÉUSSI — ${total} occurrences, dans le budget.\n`);
  process.exit(0);
}
