/**
 * types/builder.ts — Structures de sortie du pipeline de compilation
 */

import type { AssistantMode } from "../types.js";
import type { TaskType } from "./context.js";
import type { PromptRule, RuleScope } from "./rules.js";
import type { PromptContext } from "./context.js";

// ═══════════════════════════════════════════════════════════════════════════════
// PromptSection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Bloc de texte contextuel inséré dans le prompt compilé.
 * Contrairement aux PromptRule, les sections ne participent pas à la
 * résolution de conflits — elles sont sélectionnées ou ignorées.
 */
export interface PromptSection {
  /** Identifiant unique de la section. */
  id: string;

  /**
   * Ordre d'insertion. Plus petit = inséré plus tôt.
   * Défaut implicite : 100.
   */
  priority?: number;

  /**
   * Scopes dans lesquels cette section doit apparaître.
   * Si absent, la section est toujours incluse.
   */
  scope?: RuleScope[];

  /** Contenu de la section. */
  content: string;

  /**
   * Condition runtime évaluée au moment de la sélection.
   * Si retourne false, la section est exclue.
   */
  when?: (context: PromptContext) => boolean;

  /**
   * Source (fichier .md ou module) pour le debug/audit.
   */
  source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PromptConflict
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enregistrement d'un conflit détecté et résolu entre deux règles.
 */
export interface PromptConflict {
  /** ID de la première règle. */
  ruleA: string;
  /** ID de la deuxième règle. */
  ruleB: string;
  /** ID de la règle qui a remporté le conflit. Absent si non résolu. */
  winner?: string;
  /** Explication lisible de la résolution. */
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BuiltPrompt
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Résultat complet de la compilation.
 * Expose le contenu final et toutes les informations d'audit.
 */
export interface BuiltPrompt {
  /** Texte du prompt système, prêt à être envoyé au modèle. */
  content: string;

  /** Règles actives après résolution des conflits, triées par priorité. */
  rules: PromptRule[];

  /** Sections sélectionnées, triées par priorité d'insertion. */
  sections: PromptSection[];

  /** Conflits détectés et résolus pendant la compilation. */
  conflicts: PromptConflict[];

  /** Métadonnées pour le monitoring et le debugging. */
  metadata: {
    mode: AssistantMode;
    taskType: TaskType;
    ruleCount: number;
    sectionCount: number;
    conflictCount: number;
    buildTimeMs: number;
  };
}
