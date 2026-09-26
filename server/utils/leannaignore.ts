/**
 * leannaignore.ts — Liste d'exclusion de chemins définie par l'utilisateur.
 *
 * Charge et interprète un fichier `.leannaignore` situé à la racine du projet
 * actif (SELF_ROOT). Chaque ligne décrit un dossier ou un motif de fichier
 * que l'agent n'a PAS le droit de modifier (écriture / création / suppression /
 * renommage). C'est un complément à FORBIDDEN_WRITE_TARGETS (durci en dur)
 * mais entièrement contrôlé par l'utilisateur.
 *
 * Format (proche de .gitignore) :
 *   - Une entrée par ligne.
 *   - Les lignes vides et celles commençant par `#` sont ignorées.
 *   - Les chemins sont relatifs à la racine du projet.
 *   - Un `/` final indique explicitement un dossier (facultatif : un dossier
 *     bloque de toute façon tout son contenu).
 *   - Motifs glob supportés : `*` (segment, hors `/`) et `**` (récursif).
 *   - Un `!` en début de ligne ré-autorise un chemin précédemment exclu
 *     (négation), utile pour créer des exceptions.
 *
 * Exemple :
 *   # Dossiers protégés
 *   secrets/
 *   infra/production/
 *   config/*.prod.json
 *   docs/**
 *   !docs/CONTRIBUTING.md
 *
 * Le fichier est mis en cache par racine et invalidé automatiquement via mtime,
 * si bien que toute modification prend effet sans redémarrage du serveur.
 */

import * as fs from "fs";
import * as path from "path";

export const LEANNAIGNORE_FILENAME = ".leannaignore";

export interface IgnoreRule {
  /** Motif original tel qu'écrit dans le fichier (sans le préfixe `!`). */
  pattern: string;
  /** Regex compilée testée contre un chemin relatif normalisé (forward slash). */
  regex: RegExp;
  /** true si la règle est une négation (`!pattern`) — ré-autorise le chemin. */
  negated: boolean;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  rules: IgnoreRule[];
}

/** Cache par racine absolue → règles compilées + signature du fichier. */
const cache = new Map<string, CacheEntry>();

/**
 * Échappe les caractères regex spéciaux d'un littéral, en laissant intacts
 * les jokers glob (`*`) qui sont traités séparément.
 */
function escapeRegexLiteral(segment: string): string {
  return segment.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convertit un motif de type gitignore en RegExp ancrée sur un chemin
 * relatif normalisé (séparateurs `/`, sans slash initial).
 */
export function compileIgnorePattern(rawPattern: string): RegExp {
  let pattern = rawPattern.trim().replace(/\\/g, "/");

  // Retirer un éventuel slash initial (les chemins sont relatifs à la racine).
  pattern = pattern.replace(/^\/+/, "");

  // Un slash final marque un dossier ; on le retire pour construire la base,
  // le suffixe récursif est ajouté ensuite de toute façon.
  const explicitDir = pattern.endsWith("/");
  if (explicitDir) {
    pattern = pattern.replace(/\/+$/, "");
  }

  // Construire la regex segment par segment pour gérer `**`, `*` et littéraux.
  // On remplace d'abord les tokens glob par des sentinelles improbables afin
  // qu'ils survivent à l'échappement des littéraux.
  const DOUBLE_STAR = "\u0000DS\u0000";
  const SINGLE_STAR = "\u0000SS\u0000";

  let tokenized = pattern
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR);

  tokenized = escapeRegexLiteral(tokenized);

  // Cas particulier : un motif se terminant par `/**` (ex: `docs/**`) doit
  // aussi bloquer le dossier de base lui-même (`docs`), pas seulement son
  // contenu. On retire le suffixe `/**` : la base bloque déjà tout le contenu
  // via le suffixe `(?:/.*)?` ajouté plus bas.
  tokenized = tokenized.replace(new RegExp("/" + DOUBLE_STAR + "$"), "");

  // `**` → n'importe quelle profondeur (y compris zéro segment).
  // `*`  → n'importe quel caractère sauf `/`.
  let body = tokenized
    .replace(new RegExp(DOUBLE_STAR + "/", "g"), "(?:.*/)?")
    .replace(new RegExp(DOUBLE_STAR, "g"), ".*")
    .replace(new RegExp(SINGLE_STAR, "g"), "[^/]*");

  // La règle bloque le chemin lui-même ET tout son contenu (sous-chemins).
  // Ex : `secrets` bloque `secrets`, `secrets/a`, `secrets/a/b`.
  const source = `^${body}(?:/.*)?$`;
  return new RegExp(source);
}

/**
 * Parse le contenu brut d'un fichier `.leannaignore` en règles compilées.
 * Exporté pour tests et usage direct (contenu déjà en mémoire).
 */
export function parseIgnoreContent(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1).trim();
      if (!line) continue;
    }

    try {
      const regex = compileIgnorePattern(line);
      // Label normalisé (slashes forward, sans slash initial/final) pour un
      // affichage et un round-trip cohérents.
      const normalizedPattern = line
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      rules.push({
        pattern: normalizedPattern,
        regex,
        negated,
      });
    } catch {
      // Motif invalide → ignoré silencieusement pour ne pas casser les écritures.
    }
  }

  return rules;
}

/**
 * Charge les règles `.leannaignore` pour une racine donnée, avec cache mtime.
 * Retourne un tableau vide si aucun fichier n'existe ou en cas d'erreur.
 */
export function loadIgnoreRules(root: string): IgnoreRule[] {
  if (!root) return [];
  const absoluteRoot = path.resolve(root);
  const ignorePath = path.join(absoluteRoot, LEANNAIGNORE_FILENAME);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(ignorePath);
  } catch {
    // Fichier absent → pas de règles, purge d'un éventuel cache obsolète.
    cache.delete(absoluteRoot);
    return [];
  }

  const cached = cache.get(absoluteRoot);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.rules;
  }

  let rules: IgnoreRule[] = [];
  try {
    const content = fs.readFileSync(ignorePath, "utf-8");
    rules = parseIgnoreContent(content);
  } catch {
    rules = [];
  }

  cache.set(absoluteRoot, { mtimeMs: stat.mtimeMs, size: stat.size, rules });
  return rules;
}

/**
 * Normalise un chemin (absolu ou relatif) en chemin relatif à la racine,
 * avec séparateurs `/`. Retourne null si le chemin sort de la racine.
 */
function toRelative(root: string, target: string): string | null {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(absoluteRoot, target);

  const relative = path.relative(absoluteRoot, absoluteTarget).replace(/\\/g, "/");
  if (relative === "" || relative === ".") return "";
  if (relative.startsWith("../") || relative === "..") return null;
  return relative;
}

/**
 * Détermine si un chemin (absolu ou relatif à la racine) est exclu en écriture
 * par le fichier `.leannaignore`. Les règles de négation (`!`) sont appliquées
 * dans l'ordre : la dernière règle correspondante l'emporte.
 */
export function isIgnoredForWrite(root: string, target: string): boolean {
  const rules = loadIgnoreRules(root);
  if (rules.length === 0) return false;

  const relative = toRelative(root, target);
  if (relative === null || relative === "") return false;

  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(relative)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

/**
 * Retourne le chemin absolu du fichier `.leannaignore` pour une racine donnée.
 */
export function getIgnoreFilePath(root: string): string {
  return path.join(path.resolve(root), LEANNAIGNORE_FILENAME);
}

/**
 * Invalide le cache pour une racine (ou tout le cache si root omis).
 * Utile après une écriture programmatique du fichier `.leannaignore`.
 */
export function clearIgnoreCache(root?: string): void {
  if (root) {
    cache.delete(path.resolve(root));
  } else {
    cache.clear();
  }
}
