#!/usr/bin/env node
/**
 * copy-prompts.cjs — Copie les prompts .md dans le bundle.
 *
 * Le serveur est bundlé en `dist/server.cjs`, mais les fichiers de prompts
 * (`server/runtime/prompts/*.md`) ne sont pas inlinés par esbuild : ils sont
 * lus à l'exécution via le système de fichiers. Ce script les copie dans
 * `dist/prompts/` pour que `SystemPromptBuilder.resolvePromptsDir()` les trouve.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "server", "runtime", "prompts");
const destDir = path.join(root, "dist", "prompts");

if (!fs.existsSync(srcDir)) {
  console.error(`[copy-prompts] Dossier source introuvable: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
let count = 0;
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  count++;
}

console.log(`[copy-prompts] ${count} fichier(s) .md copié(s) vers dist/prompts/`);
