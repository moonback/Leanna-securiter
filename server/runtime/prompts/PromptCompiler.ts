/**
 * PromptCompiler — Assemble règles + sections en texte final
 *
 * Responsabilité unique : prendre les règles résolues et les sections
 * sélectionnées, et produire le string qui sera envoyé au modèle.
 *
 * Le format de sortie utilise des balises structurées (plutôt que des headings
 * Markdown qui s'imbriqueraient mal avec les H1/H2 des sections .md) :
 *
 *   <policy>
 *   - <contenu de chaque règle, sans son id>
 *   </policy>
 *
 *   <instructions>
 *   <section name="<id>">
 *   <contenu>
 *   </section>
 *   </instructions>
 *
 * Les ids de règles ne sont pas imprimés (audit uniquement, via built.rules).
 * Note : le compilateur n'interprète pas les règles. Il les assemble
 * dans l'ordre déjà établi par le pipeline en amont.
 */

import type { PromptRule } from "./types/rules.js";
import type { PromptSection, BuiltPrompt, PromptConflict } from "./types/builder.js";
import type { PromptContext } from "./types/context.js";

// ═══════════════════════════════════════════════════════════════════════════════
// PromptCompiler
// ═══════════════════════════════════════════════════════════════════════════════

export class PromptCompiler {
  /**
   * Compile l'ensemble du prompt et retourne un BuiltPrompt.
   *
   * @param context   Contexte résolu.
   * @param rules     Règles actives, triées par priorité.
   * @param sections  Sections sélectionnées, triées par ordre d'insertion.
   * @param conflicts Journal des conflits résolus.
   * @param startMs   Timestamp de début de build (pour buildTimeMs).
   */
  compile(
    context:   PromptContext,
    rules:     PromptRule[],
    sections:  PromptSection[],
    conflicts: PromptConflict[],
    startMs:   number,
  ): BuiltPrompt {
    const content = this.buildContent(rules, sections);

    return {
      content,
      rules,
      sections,
      conflicts,
      metadata: {
        mode:          context.mode,
        taskType:      context.taskType,
        ruleCount:     rules.length,
        sectionCount:  sections.length,
        conflictCount: conflicts.length,
        buildTimeMs:   Date.now() - startMs,
      },
    };
  }

  /**
   * Génère une explication lisible de la compilation — utile pour le debug.
   *
   * Exemple de sortie :
   *
   *   SYSTEM PROMPT EXPLANATION
   *   ═══════════════════════════
   *   Mode    : full
   *   Task    : debugging
   *
   *   Rules (6)
   *   ─────────
   *   P0  safety.no-secret-disclosure
   *   P0  workspace.sandbox-only
   *   …
   *
   *   Sections (4)
   *   ────────────
   *   [10] core
   *   [30] debugging
   *   …
   *
   *   Conflicts (1)
   *   ─────────────
   *   workspace.direct-write  ←  workspace.sandbox-only
   *   Reason: Priorité : P0 (workspace.sandbox-only) > P6 (workspace.direct-write)
   */
  explain(built: BuiltPrompt): string {
    const lines: string[] = [];

    lines.push("SYSTEM PROMPT EXPLANATION");
    lines.push("═".repeat(40));
    lines.push(`Mode    : ${built.metadata.mode}`);
    lines.push(`Task    : ${built.metadata.taskType}`);
    lines.push(`Rules   : ${built.metadata.ruleCount}`);
    lines.push(`Sections: ${built.metadata.sectionCount}`);
    lines.push(`Built in: ${built.metadata.buildTimeMs}ms`);
    lines.push("");

    // Règles
    lines.push(`Rules (${built.rules.length})`);
    lines.push("─".repeat(30));
    if (built.rules.length === 0) {
      lines.push("  (aucune)");
    } else {
      for (const rule of built.rules) {
        lines.push(`  P${rule.priority.toString().padEnd(3)} ${rule.id}`);
      }
    }
    lines.push("");

    // Sections
    lines.push(`Sections (${built.sections.length})`);
    lines.push("─".repeat(30));
    if (built.sections.length === 0) {
      lines.push("  (aucune)");
    } else {
      for (const section of built.sections) {
        const prio = (section.priority ?? 100).toString().padStart(3);
        lines.push(`  [${prio}] ${section.id}`);
      }
    }
    lines.push("");

    // Conflits
    if (built.conflicts.length > 0) {
      lines.push(`Conflicts (${built.conflicts.length})`);
      lines.push("─".repeat(30));
      for (const c of built.conflicts) {
        const arrow = c.winner
          ? (c.winner === c.ruleB ? `${c.ruleA}  ←  ${c.ruleB}` : `${c.ruleB}  ←  ${c.ruleA}`)
          : `${c.ruleA}  ↔  ${c.ruleB}`;
        lines.push(`  ${arrow}`);
        lines.push(`  Reason: ${c.reason}`);
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  // ─── Privé ────────────────────────────────────────────────────────────────

  private buildContent(rules: PromptRule[], sections: PromptSection[]): string {
    const parts: string[] = [];

    // ── Règles de politique ──
    //   Les règles sont regroupées sous une balise <policy>. On n'imprime PAS
    //   les ids (`safety.no-secret-disclosure`, etc.) : ils servent à l'audit
    //   (conservés dans built.rules) et gaspillent des tokens dans le prompt.
    //   Les headings Markdown `###` sont remplacés par des balises structurées
    //   pour éviter que les H1/H2 des .md ne s'imbriquent sous un `### base`.
    if (rules.length > 0) {
      const body = rules.map(rule => `- ${rule.content.trim()}`).join("\n");
      parts.push(`<policy>\n${body}\n</policy>`);
    }

    // ── Instructions contextuelles ──
    if (sections.length > 0) {
      const body = sections
        .map(section => `<section name="${section.id}">\n${section.content.trim()}\n</section>`)
        .join("\n\n");
      parts.push(`<instructions>\n${body}\n</instructions>`);
    }

    return parts.filter(Boolean).join("\n\n");
  }
}
