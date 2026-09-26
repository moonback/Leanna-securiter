/**
 * SectionRegistry — Catalogue des sections contextuelles du prompt
 *
 * Les sections sont des blocs de texte Markdown sélectionnés dynamiquement
 * selon le contexte (mode, taskType, agents.enabled…).
 *
 * Contrairement aux PromptRule, les sections :
 * - Ne participent pas à la résolution de conflits
 * - Sont triées par priority d'insertion (ordre d'affichage)
 * - Peuvent être activées/désactivées via un prédicat when()
 *
 * Les sections sont alimentées par le loader Markdown étendu OU
 * enregistrées programmatiquement depuis SystemPromptBuilder.
 */

import type { PromptSection } from "./types/builder.js";
import type { PromptContext } from "./types/context.js";
import type { RuleScope } from "./types/rules.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SectionRegistry
// ═══════════════════════════════════════════════════════════════════════════════

export class SectionRegistry {
  private readonly sections = new Map<string, PromptSection>();

  // ─── Enregistrement ───────────────────────────────────────────────────────

  /**
   * Enregistre une section.
   * Lance une erreur si l'ID est déjà pris.
   */
  register(section: PromptSection): void {
    if (this.sections.has(section.id)) {
      throw new Error(
        `[SectionRegistry] Section dupliquée : "${section.id}".`,
      );
    }
    this.sections.set(section.id, section);
  }

  /**
   * Enregistre ou remplace une section (utile pour le rechargement à chaud).
   */
  set(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  /**
   * Enregistre plusieurs sections.
   */
  registerAll(sections: PromptSection[]): void {
    for (const section of sections) {
      this.register(section);
    }
  }

  /**
   * Supprime une section.
   */
  unregister(id: string): boolean {
    return this.sections.delete(id);
  }

  // ─── Sélection contextuelle ───────────────────────────────────────────────

  /**
   * Retourne toutes les sections actives pour le contexte donné,
   * triées par priority croissante.
   */
  select(context: PromptContext): PromptSection[] {
    return [...this.sections.values()]
      .filter(section => this.isActive(section, context))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  // ─── Lecture brute ────────────────────────────────────────────────────────

  get(id: string): PromptSection | undefined {
    return this.sections.get(id);
  }

  has(id: string): boolean {
    return this.sections.has(id);
  }

  all(): PromptSection[] {
    return [...this.sections.values()];
  }

  get size(): number {
    return this.sections.size;
  }

  // ─── Privé ────────────────────────────────────────────────────────────────

  private isActive(section: PromptSection, context: PromptContext): boolean {
    // Condition runtime explicite
    if (section.when && !section.when(context)) {
      return false;
    }

    // Pas de scope → toujours active
    if (!section.scope || section.scope.length === 0) {
      return true;
    }

    return section.scope.some(scope => this.matchesScope(scope, context));
  }

  private matchesScope(scope: RuleScope, context: PromptContext): boolean {
    if (scope === "global") return true;
    if (scope === context.mode) return true;
    if (scope === context.taskType) return true;
    if (scope === "agent" && context.agents.enabled) return true;
    return false;
  }
}
