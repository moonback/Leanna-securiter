/**
 * Prompt Loader — Charge les fichiers .md dans le PromptRegistry
 *
 * Automatise la découverte et l'enregistrement des templates de prompts
 * depuis le dossier server/runtime/prompts/*.md
 *
 * Convention de nommage :
 *   base.md          → id: "base"
 *   autonomy.md      → id: "autonomy"
 *   agents-system.md → id: "agents-system"
 *
 * Deux formats de front-matter sont supportés :
 *
 * 1. YAML délimité par des fences `---` (format des fichiers *.md actuels) :
 *      ---
 *      id: security
 *      priority: 20
 *      always: true
 *      condition: agents.enabled === true
 *      appliesTo: [security, recon, threat_modeler]
 *      tokensBudget: 700
 *      ---
 *
 * 2. HTML comment sur la première ligne (format legacy) :
 *      <!-- extends: base, category: system -->
 *      <!-- category: system, scope: full coding, priority: 10, requires: safety.core -->
 *
 * Champs reconnus (indépendants du format) :
 *   id           : identifiant explicite de la section (sinon nom de fichier)
 *   extends      : ID du template parent (héritage PromptRegistry)
 *   category     : catégorie PromptRegistry
 *   scope        : liste de RuleScope séparés par des espaces
 *   priority     : entier (ordre d'insertion de la section, défaut 100)
 *   requires     : liste d'IDs de règles séparés par des espaces
 *   always       : booléen (section toujours active)
 *   condition    : expression d'activation évaluée par le builder
 *   appliesTo    : liste de rôles d'agents (`[a, b]` ou `a b`)
 *   tokensBudget : entier (budget de tokens indicatif)
 *
 * Ces champs sont retournés dans ParsedFrontMatter et utilisés par
 * SystemPromptBuilder.syncSectionsFromLegacy() pour enrichir le SectionRegistry.
 */

import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PromptRegistry } from "../PromptRegistry.js";
import type { RuleScope } from "./types/rules.js";

const __dirname_compat = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Métadonnées extraites du front-matter d'un fichier .md.
 * Expose les champs legacy (extends, category) ET les nouveaux champs
 * du policy compiler (scope, priority, requires).
 */
export interface ParsedFrontMatter {
  /** Contenu du fichier sans le bloc de front-matter. */
  content: string;

  // ── Champs legacy (front-matter HTML-comment) ───────────────────────────────

  /** ID du template parent (héritage PromptRegistry). */
  extends?: string;

  /** Catégorie du template (ex: "system", "directives"). */
  category?: string;

  // ── Champs policy compiler ─────────────────────────────────────────────────

  /**
   * Identifiant explicite de la section (front-matter YAML `id:`).
   * Quand absent, le loader retombe sur le nom de fichier.
   */
  id?: string;

  /**
   * Scopes dans lesquels cette section s'applique.
   * Parsé depuis `scope: full coding` → ["full", "coding"].
   */
  scope?: RuleScope[];

  /**
   * Priorité d'insertion de la section (ordre d'affichage).
   * Plus petit = affiché plus tôt. Défaut implicite : 100.
   */
  priority?: number;

  /**
   * IDs de règles qui doivent être actives pour que cette section
   * soit incluse. Parsé depuis `requires: safety.core authority.workspace`.
   */
  requires?: string[];

  // ── Champs front-matter YAML (format des fichiers *.md actuels) ─────────────

  /**
   * Section toujours active, quel que soit le scope/condition.
   * Parsé depuis `always: true`.
   */
  always?: boolean;

  /**
   * Expression de condition d'activation, évaluée par le builder.
   * Ex: `condition: agents.enabled === true`.
   */
  condition?: string;

  /**
   * Rôles d'agents auxquels la section s'applique.
   * Parsé depuis `appliesTo: [security, recon, ...]`.
   */
  appliesTo?: string[];

  /**
   * Budget de tokens indicatif pour la section (troncature/priorisation).
   * Parsé depuis `tokensBudget: 700`.
   */
  tokensBudget?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Loader
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Charge tous les fichiers .md du dossier prompts dans le PromptRegistry.
 *
 * Rétrocompatible : même signature et comportement qu'avant.
 * Les métadonnées étendues (scope, priority, requires) sont parsées mais
 * stockées dans le template via le champ `category` étendu uniquement
 * pour référence — leur consommation principale est via parseFrontMatter()
 * appelé directement dans SystemPromptBuilder.syncSectionsFromLegacy().
 *
 * @returns Nombre de fichiers chargés avec succès.
 */
export function loadPromptTemplates(
  registry:   PromptRegistry,
  promptsDir?: string,
): number {
  const dir = promptsDir ?? __dirname_compat;
  let count = 0;

  if (!fs.existsSync(dir)) {
    console.warn(`[PromptLoader] Dossier introuvable: ${dir}`);
    return 0;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const raw      = fs.readFileSync(filePath, "utf-8");
      const meta     = parseFrontMatter(raw);
      // L'`id:` du front-matter fait autorité ; sinon on retombe sur le nom
      // de fichier (convention de nommage historique).
      const id       = meta.id ?? file.replace(/\.md$/, "");

      registry.registerContent(id, meta.content, {
        name:     id,
        extends:  meta.extends,
        category: meta.category ?? "system",
        version:  1,
      });

      count++;
    } catch (err) {
      console.error(
        `[PromptLoader] Erreur chargement ${file}:`,
        (err as Error).message,
      );
    }
  }

  return count;
}

/**
 * Charge tous les fichiers .md et retourne les métadonnées étendues
 * pour chaque fichier (scope, priority, requires).
 *
 * Utilisé par SystemPromptBuilder.syncSectionsFromLegacy() pour enrichir
 * le SectionRegistry avec les informations du front-matter étendu.
 *
 * @returns Map<id, ParsedFrontMatter> pour chaque .md trouvé.
 */
export function loadPromptMeta(promptsDir?: string): Map<string, ParsedFrontMatter> {
  const dir    = promptsDir ?? __dirname_compat;
  const result = new Map<string, ParsedFrontMatter>();

  if (!fs.existsSync(dir)) return result;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const raw      = fs.readFileSync(filePath, "utf-8");
      const meta     = parseFrontMatter(raw);
      const id       = meta.id ?? file.replace(/\.md$/, "");
      result.set(id, meta);
    } catch {
      // Silently skip unreadable files
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Front-matter parser
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse le front-matter d'un fichier .md. Deux formats sont supportés :
 *
 * 1. Front-matter YAML délimité par des fences `---` (format des fichiers
 *    actuels) :
 *
 *      ---
 *      id: security
 *      priority: 20
 *      always: true
 *      condition: agents.enabled === true
 *      appliesTo: [security, recon, threat_modeler]
 *      tokensBudget: 700
 *      ---
 *
 * 2. Front-matter HTML-comment sur la première ligne (format legacy) :
 *
 *      <!-- key: value, key2: value2 value3 -->
 *
 * Le bloc de front-matter est retiré de `content` dans les deux cas. Quand
 * aucun front-matter n'est reconnu, le contenu brut est retourné tel quel.
 */
export function parseFrontMatter(raw: string): ParsedFrontMatter {
  const lines     = raw.split(/\r?\n/);
  const firstLine = lines[0]?.trim();

  // ── Format 1 : YAML délimité par `---` ─────────────────────────────────────
  if (firstLine === "---") {
    // Trouver la fence de fermeture (première ligne `---` après l'ouverture).
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        closeIdx = i;
        break;
      }
    }

    // Sans fence de fermeture, on ne traite pas comme du front-matter.
    if (closeIdx !== -1) {
      const yamlLines = lines.slice(1, closeIdx);
      const content   = lines.slice(closeIdx + 1).join("\n").trimStart();
      return buildFromPairs(parseYamlPairs(yamlLines), content);
    }
  }

  // ── Format 2 : HTML-comment legacy sur la première ligne ────────────────────
  if (firstLine?.startsWith("<!--") && firstLine.endsWith("-->")) {
    const metaStr = firstLine.slice(4, -3).trim();
    const content = lines.slice(1).join("\n").trimStart();
    return buildFromPairs(parseMetaPairs(metaStr), content);
  }

  // ── Aucun front-matter reconnu ──────────────────────────────────────────────
  return { content: raw };
}

/**
 * Construit un ParsedFrontMatter typé à partir d'un dictionnaire clé/valeur
 * brut (issu du YAML ou du HTML-comment) et du contenu déjà nettoyé.
 * Centralise le typage des champs pour que les deux formats se comportent
 * de façon identique.
 */
function buildFromPairs(
  pairs:   Record<string, string>,
  content: string,
): ParsedFrontMatter {
  const result: ParsedFrontMatter = {
    content,
    id:       pairs["id"],
    extends:  pairs["extends"],
    category: pairs["category"],
    condition: pairs["condition"],
  };

  // scope : "full coding" → ["full", "coding"]
  if (pairs["scope"]) {
    result.scope = splitList(pairs["scope"]) as RuleScope[];
  }

  // priority : "10" → 10
  const priority = parseIntOrUndefined(pairs["priority"]);
  if (priority !== undefined) result.priority = priority;

  // tokensBudget : "700" → 700
  const tokensBudget = parseIntOrUndefined(pairs["tokensBudget"]);
  if (tokensBudget !== undefined) result.tokensBudget = tokensBudget;

  // always : "true" → true
  if (pairs["always"] !== undefined) {
    result.always = /^true$/i.test(pairs["always"].trim());
  }

  // requires : "safety.core auth.workspace" → ["safety.core", "auth.workspace"]
  if (pairs["requires"]) {
    result.requires = splitList(pairs["requires"]);
  }

  // appliesTo : "[security, recon]" ou "security recon" → ["security", "recon"]
  if (pairs["appliesTo"]) {
    result.appliesTo = parseSequence(pairs["appliesTo"]);
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse une chaîne de métadonnées en paires clé/valeur.
 *
 * Stratégie : split sur `, ` (virgule+espace) en premier pour préserver les
 * valeurs qui contiennent un espace simple (ex: `scope: full coding`).
 * Fallback sur `,` seul pour les formats legacy sans espace après la virgule.
 *
 * Exemples :
 *   "extends: base, category: system"
 *     → { extends: "base", category: "system" }
 *
 *   "category: system, scope: full coding, priority: 10"
 *     → { category: "system", scope: "full coding", priority: "10" }
 */
function parseMetaPairs(meta: string): Record<string, string> {
  // Tenter d'abord le split sur ", " (virgule + espace)
  const segments = meta.includes(", ")
    ? meta.split(", ")
    : meta.split(",");

  return segments.reduce((acc, segment) => {
    const colonIdx = segment.indexOf(":");
    if (colonIdx === -1) return acc;

    const key   = segment.slice(0, colonIdx).trim();
    const value = segment.slice(colonIdx + 1).trim();

    if (key) acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
}

/**
 * Parse les lignes d'un bloc YAML simple (`key: value` par ligne) en paires
 * clé/valeur brutes. Volontairement minimal — pas de dépendance YAML : le
 * front-matter des prompts n'utilise que des scalaires et des listes inline.
 *
 * - Les lignes vides et les commentaires (`# …`) sont ignorés.
 * - Une ligne sans `:` est ignorée.
 * - Les guillemets entourant la valeur sont retirés.
 *
 * Exemple :
 *   ["id: security", "priority: 20", "appliesTo: [a, b]"]
 *     → { id: "security", priority: "20", appliesTo: "[a, b]" }
 */
function parseYamlPairs(lines: string[]): Record<string, string> {
  const acc: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key   = trimmed.slice(0, colonIdx).trim();
    let   value = trimmed.slice(colonIdx + 1).trim();

    // Retirer un éventuel commentaire de fin de ligne hors valeur entre guillemets.
    // (Prudence : on ne coupe que si le `#` n'est pas dans une liste/valeur citée.)
    if (!/["'\[]/.test(value)) {
      const hashIdx = value.indexOf(" #");
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }

    // Retirer les guillemets englobants.
    value = stripQuotes(value);

    if (key) acc[key] = value;
  }

  return acc;
}

/** Retire une paire de guillemets simples/doubles englobant une valeur. */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last  = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Découpe une valeur multi-mots séparée par des espaces en liste nettoyée. */
function splitList(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Parse une séquence YAML, qu'elle soit inline (`[a, b, c]`) ou séparée par
 * des espaces (`a b c`). Les guillemets par élément sont retirés.
 */
function parseSequence(value: string): string[] {
  let inner = value.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  return inner
    .split(/[,\s]+/)
    .map((item) => stripQuotes(item.trim()))
    .filter(Boolean);
}

/** parseInt tolérant : retourne undefined si la valeur n'est pas un entier. */
function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}
