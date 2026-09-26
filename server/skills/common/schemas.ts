/**
 * Référentiel partagé des paramètres d'outils fréquents.
 *
 * Utilisation :
 *   import { PATH_PARAM, FILES_PARAM, PRIORITY_PARAM } from "./common/schemas.js";
 *
 * Avantages :
 *   - Cohérence sémantique entre tous les skills.
 *   - Réduction de la duplication dans les déclarations.
 *   - Maintenance centralisée (une seule ligne à modifier).
 */

// ─── Paramètres de chemin ─────────────────────────────────────────────────────

export const PATH_PARAM = {
  type: "STRING",
  description: "Chemin relatif depuis la racine du projet (ex: src/App.tsx).",
} as const;

export const PATH_OPTIONAL_PARAM = {
  type: "STRING",
  description: "Chemin relatif depuis la racine du projet (optionnel, défaut: racine).",
} as const;

export const DIR_PARAM = {
  type: "STRING",
  description: "Chemin relatif du répertoire depuis la racine du projet (ex: src/components).",
} as const;

// ─── Paramètres de fichiers multiples ─────────────────────────────────────────

export const FILES_PARAM = {
  type: "ARRAY",
  items: { type: "STRING" },
  description: "Liste de chemins relatifs depuis la racine du projet.",
} as const;

export const FILES_OPTIONAL_PARAM = {
  type: "ARRAY",
  items: { type: "STRING" },
  description: "Fichiers pertinents pour la tâche (optionnel).",
} as const;

// ─── Paramètres de pagination / limites ───────────────────────────────────────

export const MAX_RESULTS_PARAM = {
  type: "NUMBER",
  description: "Nombre max de résultats à retourner (défaut: 10, max: 30).",
} as const;

export const MAX_FILES_PARAM = {
  type: "NUMBER",
  description: "Nombre max de fichiers à retourner (défaut: 15, max: 30).",
} as const;

// ─── Paramètres de lignes ─────────────────────────────────────────────────────

export const START_LINE_PARAM = {
  type: "NUMBER",
  description: "Première ligne à lire (1-based). Utiliser pour cibler un extrait, éviter la lecture complète.",
} as const;

export const END_LINE_PARAM = {
  type: "NUMBER",
  description: "Dernière ligne à lire (1-based). Combiner avec startLine pour cibler un extrait.",
} as const;

// ─── Paramètres de priorité ───────────────────────────────────────────────────

export const PRIORITY_PARAM = {
  type: "STRING",
  description: "Priorité : low, medium (défaut), high, critical.",
  enum: ["low", "medium", "high", "critical"],
} as const;

// ─── Paramètres de recherche ──────────────────────────────────────────────────

export const QUERY_PARAM = {
  type: "STRING",
  description: "Terme, concept ou expression à rechercher.",
} as const;

export const MIN_SCORE_PARAM = {
  type: "NUMBER",
  description: "Score minimum de pertinence 0-1 (défaut: 0.1). Augmenter pour plus de précision.",
} as const;

// ─── Paramètres d'identifiant ─────────────────────────────────────────────────

export const ID_PARAM = {
  type: "STRING",
  description: "Identifiant unique de la ressource.",
} as const;

// ─── Paramètres de contenu ────────────────────────────────────────────────────

export const CONTENT_PARAM = {
  type: "STRING",
  description: "Contenu textuel complet à écrire ou traiter.",
} as const;

export const DESCRIPTION_PARAM = {
  type: "STRING",
  description: "Description détaillée incluant le contexte et les contraintes.",
} as const;

export const TITLE_PARAM = {
  type: "STRING",
  description: "Titre court et descriptif.",
} as const;

export const INSTRUCTIONS_PARAM = {
  type: "STRING",
  description: "Instructions supplémentaires ou contexte complémentaire (optionnel).",
} as const;
