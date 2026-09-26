/**
 * ConflictResolver — Résolution des conflits entre règles
 *
 * Trois niveaux de résolution (appliqués dans cet ordre) :
 *
 *   1. Priorité numérique — la règle dont le numéro est le plus petit gagne.
 *      Une règle P0 écrase toujours une règle P7.
 *
 *   2. Déclaration explicite — conflictsWith[] lie deux règles.
 *      Quand les deux sont candidates, seule la plus prioritaire survit.
 *
 *   3. Vérification des dépendances — requires[] : si une règle dépend d'une
 *      autre qui a été éliminée, elle est aussi retirée (cascade).
 *
 * Le résultat inclut la liste des règles actives ET un journal d'audit
 * de chaque conflit résolu.
 */

import type { PromptRule } from "./types/rules.js";
import type { PromptConflict } from "./types/builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types internes
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConflictResolution {
  rules:     PromptRule[];
  conflicts: PromptConflict[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ConflictResolver
// ═══════════════════════════════════════════════════════════════════════════════

export class ConflictResolver {
  /**
   * Résout les conflits dans un ensemble de règles candidates.
   *
   * @param candidates - Règles pré-filtrées (scope + when) déjà actives.
   * @returns         Règles survivantes + journal des conflits.
   */
  resolve(candidates: PromptRule[]): ConflictResolution {
    const conflicts: PromptConflict[] = [];

    // Phase 1 : résoudre les conflits déclarés (conflictsWith)
    const afterExplicit = this.resolveExplicitConflicts(candidates, conflicts);

    // Phase 2 : éliminer les règles dont les dépendances (requires) ont été
    //           retirées pendant la phase 1
    const afterDeps = this.resolveDependencies(afterExplicit, conflicts);

    return {
      rules:     afterDeps,
      conflicts,
    };
  }

  // ─── Phase 1 : conflits explicites ────────────────────────────────────────

  private resolveExplicitConflicts(
    rules:     PromptRule[],
    conflicts: PromptConflict[],
  ): PromptRule[] {
    // Travailler avec une map pour des suppressions O(1)
    const active = new Map<string, PromptRule>(
      rules.map(r => [r.id, r]),
    );

    // Trier par priorité croissante : les règles les plus fortes traitées en premier
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      // La règle a peut-être déjà été éliminée par une règle plus forte
      if (!active.has(rule.id)) continue;

      for (const conflictId of (rule.conflictsWith ?? [])) {
        const opponent = active.get(conflictId);
        if (!opponent) continue;

        // Les deux sont actives → résoudre
        const [winner, loser] = this.pickWinner(rule, opponent);

        conflicts.push({
          ruleA:  rule.id,
          ruleB:  conflictId,
          winner: winner.id,
          reason: this.buildReason(winner, loser),
        });

        active.delete(loser.id);
      }
    }

    return [...active.values()];
  }

  // ─── Phase 2 : dépendances ────────────────────────────────────────────────

  private resolveDependencies(
    rules:     PromptRule[],
    conflicts: PromptConflict[],
  ): PromptRule[] {
    const activeIds = new Set(rules.map(r => r.id));
    let changed = true;

    // Itérer jusqu'à stabilité (cascade)
    while (changed) {
      changed = false;

      for (const rule of [...rules]) {
        if (!activeIds.has(rule.id)) continue;

        const missingDep = (rule.requires ?? []).find(dep => !activeIds.has(dep));
        if (!missingDep) continue;

        // Dépendance manquante → retirer la règle
        activeIds.delete(rule.id);
        changed = true;

        conflicts.push({
          ruleA:  rule.id,
          ruleB:  missingDep,
          reason: `Dépendance manquante : "${rule.id}" requiert "${missingDep}" qui n'est pas actif.`,
        });
      }
    }

    return rules.filter(r => activeIds.has(r.id));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private pickWinner(a: PromptRule, b: PromptRule): [PromptRule, PromptRule] {
    // Priorité numérique — le plus petit gagne
    if (a.priority < b.priority) return [a, b];
    if (b.priority < a.priority) return [b, a];
    // Égalité de priorité → la règle déclarante (a) gagne par défaut
    return [a, b];
  }

  private buildReason(winner: PromptRule, loser: PromptRule): string {
    if (winner.priority !== loser.priority) {
      return (
        `Priorité : P${winner.priority} (${winner.id}) ` +
        `> P${loser.priority} (${loser.id})`
      );
    }
    return `Priorités égales (${winner.priority}) : "${winner.id}" conservé par ordre de déclaration.`;
  }
}
