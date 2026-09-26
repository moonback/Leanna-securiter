/**
 * RuleRegistry — Source canonique des politiques de prompt
 *
 * Distinct du PromptRegistry existant (qui gère les templates Markdown) :
 * ce registry gère les PromptRule typées avec priorité, scope et conflits.
 *
 * Les règles sont enregistrées au démarrage (depuis rules/core.ts ou via
 * le loader étendu) et sont ensuite lues en lecture seule par le pipeline.
 */

import type { PromptRule } from "./types/rules.js";

// ═══════════════════════════════════════════════════════════════════════════════
// RuleRegistry
// ═══════════════════════════════════════════════════════════════════════════════

export class RuleRegistry {
  private readonly rules = new Map<string, PromptRule>();

  // ─── Enregistrement ───────────────────────────────────────────────────────

  /**
   * Enregistre une règle.
   * Lance une erreur si l'ID est déjà pris (doublon = bug de configuration).
   */
  register(rule: PromptRule): void {
    if (this.rules.has(rule.id)) {
      throw new Error(
        `[RuleRegistry] Règle dupliquée : "${rule.id}". ` +
        `Chaque règle doit avoir un ID unique.`,
      );
    }
    this.rules.set(rule.id, rule);
  }

  /**
   * Enregistre plusieurs règles d'un coup.
   */
  registerAll(rules: PromptRule[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  /**
   * Remplace une règle existante (utile pour les overrides de test).
   * Contrairement à register(), ne lance pas d'erreur si l'ID existe déjà.
   */
  override(rule: PromptRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Supprime une règle.
   */
  unregister(id: string): boolean {
    return this.rules.delete(id);
  }

  // ─── Lecture ──────────────────────────────────────────────────────────────

  /**
   * Retourne une règle par son ID.
   */
  get(id: string): PromptRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Vérifie l'existence d'une règle.
   */
  has(id: string): boolean {
    return this.rules.has(id);
  }

  /**
   * Retourne toutes les règles enregistrées.
   */
  all(): PromptRule[] {
    return [...this.rules.values()];
  }

  /**
   * Retourne les règles filtrées par priorité.
   */
  byPriority(priority: number): PromptRule[] {
    return this.all().filter(r => r.priority === priority);
  }

  /**
   * Retourne les règles filtrées par scope.
   */
  byScope(scope: string): PromptRule[] {
    return this.all().filter(r => r.scope.includes(scope as any));
  }

  /**
   * Nombre de règles enregistrées.
   */
  get size(): number {
    return this.rules.size;
  }
}
