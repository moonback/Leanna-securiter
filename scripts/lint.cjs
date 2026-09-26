/**
 * Linter statique intégré pour Leanna.
 * Vérifie le code source sans dépendance externe (ESLint non installé).
 * Usage : node scripts/lint.cjs [--fix] [chemin...]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_LINE_LENGTH = 150;
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".Leanna",
  "release",
  "assets",
  "electron",
  "supabase",
  "tests",
]);
const IGNORE_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".yml",
  ".yaml",
  ".lock",
  ".ico",
  ".bat",
  ".ps1",
]);

// ─── Types de violations ─────────────────────────────────────────────────────

class LintViolation {
  /**
   * @param {string} file
   * @param {number} line
   * @param {number} column
   * @param {"error"|"warning"} severity
   * @param {string} rule
   * @param {string} message
   */
  constructor(file, line, column, severity, rule, message) {
    this.file = file;
    this.line = line;
    this.column = column;
    this.severity = severity;
    this.rule = rule;
    this.message = message;
  }

  toString() {
    const rel = path.relative(ROOT, this.file).replace(/\\/g, "/");
    return `${rel}:${this.line}:${this.column} - ${this.severity} ${this.rule}: ${this.message}`;
  }
}

// ─── Collecte des fichiers ───────────────────────────────────────────────────

/**
 * @param {string} dir
 * @param {string[]} result
 */
function collectFiles(dir, result = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) collectFiles(full, result);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          !IGNORE_EXTENSIONS.has(ext) &&
          /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(entry.name)
        ) {
          result.push(full);
        }
      }
    }
  } catch {
    // skip inaccessible dirs
  }
}

/**
 * Liste les fichiers à linter. Si des chemins sont passés en args, on les utilise.
 * Sinon, on scanne les dossiers src/ et server/.
 * @param {string[]} targets
 * @returns {string[]}
 */
function getFiles(targets) {
  if (targets.length > 0) {
    const files = [];
    for (const t of targets) {
      const abs = path.resolve(ROOT, t);
      if (fs.existsSync(abs)) {
        if (fs.statSync(abs).isDirectory()) collectFiles(abs, files);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(abs)) files.push(abs);
      } else {
        console.error(`Fichier/dossier introuvable : ${t}`);
      }
    }
    return files;
  }

  // Scan par défaut : src/ et server/
  const files = [];
  for (const sub of ["src", "server", "scripts"]) {
    const dir = path.join(ROOT, sub);
    if (fs.existsSync(dir)) collectFiles(dir, files);
  }
  // Ajouter les fichiers racine .ts/.js
  collectFiles(ROOT, files);
  return files.filter(
    (f) => !f.includes("node_modules") && !f.includes("dist") && !f.includes(".git")
  );
}

// ─── Règles de lint ──────────────────────────────────────────────────────────

/**
 * Vérifie les lignes trop longues.
 */
function checkLineLength(filePath, lines) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    // Ignorer les imports, les URLs longues et les commentaires de licence
    const line = lines[i];
    if (line.length > MAX_LINE_LENGTH && !line.trim().startsWith("//") && !line.includes("http://") && !line.includes("https://")) {
      violations.push(
        new LintViolation(filePath, i + 1, MAX_LINE_LENGTH, "warning", "max-line-length", `Ligne dépasse ${MAX_LINE_LENGTH} caractères (${line.length})`)
      );
    }
  }
  return violations;
}

/**
 * Vérifie les espaces blancs en fin de ligne.
 */
function checkTrailingWhitespace(filePath, lines) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (lines[i] !== trimmed && lines[i].trim().length > 0) {
      violations.push(
        new LintViolation(filePath, i + 1, lines[i].trimEnd().length, "warning", "no-trailing-spaces", "Espace blanc en fin de ligne")
      );
    }
  }
  return violations;
}

/**
 * Vérifie la présence d'un newline à la fin du fichier.
 */
function checkNewline(filePath, lines, content) {
  const violations = [];
  if (content.length > 0 && !content.endsWith("\n")) {
    violations.push(
      new LintViolation(filePath, lines.length, 1, "warning", "eol-last", "Pas de nouvelle ligne à la fin du fichier")
    );
  }
  return violations;
}

/**
 * Vérifie les console.log/warn/error (sauf dans les fichiers .test.ts, tests/ et scripts/).
 */
function checkConsoleUsage(filePath, lines) {
  const violations = [];
  const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(filePath) || filePath.includes("\\tests\\") || filePath.includes("/tests/") || filePath.includes("\\scripts\\") || filePath.includes("/scripts/");

  if (isTestFile) return violations; // toléré dans les tests

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignorer les commentaires
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

    const consoleMatch = line.match(/console\.(log|warn|error)\s*\(/);
    if (consoleMatch) {
      violations.push(
        new LintViolation(filePath, i + 1, line.indexOf("console"), "warning", "no-console", `console.${consoleMatch[1]}() détecté. Utiliser le logger dédié.`)
      );
    }
  }
  return violations;
}

/**
 * Vérifie les marqueurs TODO/FIXME/HACK dans le code.
 */
function checkMarkers(filePath, lines) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const todoMatch = line.match(/\b(TODO|FIXME|HACK|XXX)\b/);
    if (todoMatch) {
      violations.push(
        new LintViolation(filePath, i + 1, line.indexOf(todoMatch[1]), "info", "no-todo-markers", `Marqueur '${todoMatch[1]}' détecté dans le code`)
      );
    }
  }
  return violations;
}

/**
 * Vérifie les require/import en double ou inutiles.
 * Règle simple : détecte les imports indentiques sur des lignes consécutives.
 */
function checkDuplicateImports(filePath, lines) {
  const violations = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1].trim();
    const curr = lines[i].trim();
    if (
      (prev.startsWith("import ") || prev.startsWith("const ") || prev.startsWith("let ")) &&
      prev === curr
    ) {
      violations.push(
        new LintViolation(filePath, i + 1, 0, "error", "no-duplicate-import", "Import/const dupliqué")
      );
    }
  }
  return violations;
}

/**
 * Vérifie les variables inutilisées (naïf : déclaration sans usage dans le même fichier).
 * Règle basique — tsc s'assure déjà du typage strict.
 */
function checkUnusedVariables(filePath, lines) {
  const violations = [];
  // Simple vérification des paramètres nommés `_` préfixés (convention "inutilisé")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Vérifie les paramètres de fonction qui ne commencent pas par _
    // On ne signale que les patterns évidents
    if (/^\s*(catch)\s*\(\s*[a-zA-Z]/.test(line) && !/^\s*(catch)\s*\(\s*_/.test(line)) {
      const match = line.match(/catch\s*\(\s*([a-zA-Z]\w*)/);
      if (match && match[1] !== "e") {
        violations.push(
          new LintViolation(filePath, i + 1, line.indexOf(match[1]), "info", "catch-name", `Le paramètre catch '${match[1]}' pourrait être nommé 'e' ou '_' par convention`)
        );
      }
    }
  }
  return violations;
}

// ─── Linter principal ────────────────────────────────────────────────────────

/**
 * Exécute toutes les règles sur un fichier.
 * @param {string} filePath
 * @returns {LintViolation[]}
 */
function lintFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);

  const violations = [
    ...checkLineLength(filePath, lines),
    ...checkTrailingWhitespace(filePath, lines),
    ...checkNewline(filePath, lines, content),
    ...checkConsoleUsage(filePath, lines),
    ...checkMarkers(filePath, lines),
    ...checkDuplicateImports(filePath, lines),
    ...checkUnusedVariables(filePath, lines),
  ];

  return violations;
}

/** Applique uniquement les corrections de formatage sans modifier le contenu. */
function formatFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const formatted = content
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n");
    const normalized = formatted.length > 0 && !formatted.endsWith("\n")
      ? `${formatted}\n`
      : formatted;
    if (normalized !== content) fs.writeFileSync(filePath, normalized, "utf-8");
  } catch {
    // Les erreurs de lecture sont rapportées par lintFile.
  }
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes("--fix");
  const targets = args.filter((a) => a !== "--fix");

  const files = getFiles(targets);

  if (fixMode) {
    for (const file of files) formatFile(file);
  }

  let allViolations = [];
  let fileCount = 0;

  for (const file of files) {
    const violations = lintFile(file);
    if (violations.length > 0) {
      fileCount++;
      allViolations = allViolations.concat(violations);
    }
  }

  // Trier par fichier puis ligne
  allViolations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  // Affichage
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const v of allViolations) {
    console.log(v.toString());
    if (v.severity === "error") errorCount++;
    else if (v.severity === "warning") warningCount++;
    else infoCount++;
  }

  const total = allViolations.length;

  console.log(`\n📊 ${total} violation(s) trouvée(s) dans ${fileCount} fichier(s) :`);
  console.log(`   ${errorCount} erreur(s) | ${warningCount} avertissement(s) | ${infoCount} info(s)`);

  // Code de sortie : erreur si des violations "error" existent
  process.exit(errorCount > 0 ? 1 : 0);
}

main();

