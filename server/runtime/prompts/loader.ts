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
 * Front-matter (HTML comment en première ligne) — format original :
 *   <!-- extends: base, category: system -->
 *
 * Front-matter étendu — nouveaux champs pour le policy compiler :
 *   <!-- category: system, scope: full coding, priority: 10, requires: safety.core -->
 *
 *   scope    : liste de RuleScope séparés par des espaces
 *   priority : entier (ordre d'insertion de la section, défaut 100)
 *   requires : liste d'IDs de règles séparés par des espaces
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
  /** Contenu du fichier sans la ligne de front-matter. */
  content: string;

  // ── Champs legacy ──────────────────────────────────────────────────────────

  /** ID du template parent (héritage PromptRegistry). */
  extends?: string;

  /** Catégorie du template (ex: "system", "directives"). */
  category?: string;

  // ── Champs policy compiler ─────────────────────────────────────────────────

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
      const id       = file.replace(/\.md$/, "");
      const meta     = parseFrontMatter(raw);

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
      const id       = file.replace(/\.md$/, "");
      result.set(id, parseFrontMatter(raw));
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
 * Parse le front-matter HTML-comment d'un fichier .md.
 *
 * Format supporté (première ligne uniquement) :
 *
 *   <!-- key: value, key2: value2 value3 -->
 *
 * Champs reconnus :
 *   extends   → string (ID du template parent)
 *   category  → string (catégorie PromptRegistry)
 *   scope     → string (mots séparés par des espaces → RuleScope[])
 *   priority  → number
 *   requires  → string (mots séparés par des espaces → string[])
 *
 * La valeur d'un champ peut contenir des espaces (ex: `scope: full coding`).
 * Les champs sont séparés par `, ` (virgule+espace) pour éviter les ambiguïtés.
 * Pour les champs simples (extends, category, priority), la virgule seule suffit.
 *
 * Exemples :
 *   <!-- extends: base, category: system -->
 *   <!-- category: system, scope: full coding, priority: 10 -->
 *   <!-- scope: ask, priority: 15, requires: safety.no-secret-disclosure -->
 */
export function parseFrontMatter(raw: string): ParsedFrontMatter {
  const lines     = raw.split("\n");
  const firstLine = lines[0]?.trim();

  if (!firstLine?.startsWith("<!--") || !firstLine.endsWith("-->")) {
    return { content: raw };
  }

  // Extraire le contenu entre <!-- et -->
  const metaStr = firstLine.slice(4, -3).trim();

  // Splitter sur ", " (virgule + espace) pour préserver les valeurs multi-mots
  const pairs = parseMetaPairs(metaStr);

  const result: ParsedFrontMatter = {
    content:  lines.slice(1).join("\n").trimStart(),
    extends:  pairs["extends"],
    category: pairs["category"],
  };

  // scope : "full coding" → ["full", "coding"]
  if (pairs["scope"]) {
    result.scope = pairs["scope"]
      .split(/\s+/)
      .filter(Boolean) as RuleScope[];
  }

  // priority : "10" → 10
  if (pairs["priority"]) {
    const n = parseInt(pairs["priority"], 10);
    if (!isNaN(n)) result.priority = n;
  }

  // requires : "safety.core auth.workspace" → ["safety.core", "auth.workspace"]
  if (pairs["requires"]) {
    result.requires = pairs["requires"]
      .split(/\s+/)
      .filter(Boolean);
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
