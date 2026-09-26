/**
 * RuleEngine — Moteur de règles de sécurité.
 *
 * Gère le chargement, l'activation et l'exécution des rule packs.
 * Chaque pack contribue des règles qui sont fusionnées dans un registre global.
 *
 * Usage :
 *   import { ruleEngine } from './RuleEngine.js';
 *   const rules = ruleEngine.getRulesForFamily('sast');
 */

import type { Rule, RuleFamily, RuleSeverity } from "./Rule.js";

// ─── Built-in rule packs ───────────────────────────────────────────────────────

import { owaspTop10Rules } from "./packs/owasp-top10-2021.js";
import { cweTop25Rules } from "./packs/cwe-top25.js";
import { cisaKevRules } from "./packs/cisa-kev.js";

// ─── RuleEngine ────────────────────────────────────────────────────────────────

export interface RulePackMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  ruleCount: number;
  enabled: boolean;
}

class RuleEngine {
  private readonly packs = new Map<string, { meta: RulePackMeta; rules: Rule[] }>();
  private cachedRules: Rule[] | null = null;

  constructor() {
    this.registerPack("owasp-top10-2021", {
      id: "owasp-top10-2021",
      name: "OWASP Top 10 (2021)",
      version: "2021.0.1",
      description: "Les 10 risques de sécurité applicative les plus critiques selon l'OWASP — édition 2021.",
      author: "Leanna Security",
      ruleCount: owaspTop10Rules.length,
      enabled: true,
    }, owaspTop10Rules);

    this.registerPack("cwe-top25", {
      id: "cwe-top25",
      name: "CWE Top 25 (2023)",
      version: "2023.0.1",
      description: "Les 25 faiblesses logicielles les plus dangereuses selon le CWE/SANS.",
      author: "Leanna Security",
      ruleCount: cweTop25Rules.length,
      enabled: true,
    }, cweTop25Rules);

    this.registerPack("cisa-kev", {
      id: "cisa-kev",
      name: "CISA KEV (Known Exploited Vulnerabilities)",
      version: "2024.0.1",
      description: "Règles basées sur les vulnérabilités connues exploitées activement par la CISA.",
      author: "Leanna Security",
      ruleCount: cisaKevRules.length,
      enabled: true,
    }, cisaKevRules);
  }

  /**
   * Enregistre un nouveau pack de règles.
   */
  registerPack(packId: string, meta: RulePackMeta, rules: Rule[]): void {
    this.packs.set(packId, { meta, rules });
    this.cachedRules = null; // invalidate cache
  }

  /**
   * Active ou désactive un pack.
   */
  setPackEnabled(packId: string, enabled: boolean): boolean {
    const pack = this.packs.get(packId);
    if (!pack) return false;
    pack.meta.enabled = enabled;
    this.cachedRules = null;
    return true;
  }

  /**
   * Retourne toutes les règles activées (tous packs confondus).
   */
  getAllEnabledRules(): Rule[] {
    if (this.cachedRules) return this.cachedRules;

    const rules: Rule[] = [];
    for (const { meta, rules: packRules } of this.packs.values()) {
      if (!meta.enabled) continue;
      for (const rule of packRules) {
        if (rule.enabled) rules.push(rule);
      }
    }

    this.cachedRules = rules;
    return rules;
  }

  /**
   * Retourne les règles d'une famille spécifique.
   */
  getRulesForFamily(family: RuleFamily): Rule[] {
    return this.getAllEnabledRules().filter((r) => r.family === family);
  }

  /**
   * Retourne les règles pour un CWE donné.
   */
  getRulesForCwe(cweId: string): Rule[] {
    return this.getAllEnabledRules().filter(
      (r) => r.cwe === cweId || r.id === cweId
    );
  }

  /**
   * Retourne les règles pour un niveau de sévérité minimum.
   */
  getRulesBySeverity(minSeverity: RuleSeverity): Rule[] {
    const order: RuleSeverity[] = ["critical", "high", "medium", "low", "info"];
    const minIdx = order.indexOf(minSeverity);
    return this.getAllEnabledRules().filter((r) => {
      const idx = order.indexOf(r.severity);
      return idx !== -1 && idx <= minIdx;
    });
  }

  /**
   * Retourne une règle par son ID.
   */
  getRuleById(id: string): Rule | undefined {
    return this.getAllEnabledRules().find((r) => r.id === id);
  }

  /**
   * Liste les métadonnées de tous les packs.
   */
  listPacks(): RulePackMeta[] {
    return Array.from(this.packs.values()).map((p) => p.meta);
  }

  /**
   * Retourne les règles d'un pack spécifique.
   */
  getPackRules(packId: string): Rule[] {
    return this.packs.get(packId)?.rules ?? [];
  }

  /**
   * Test rapide : applique les patterns regex d'une règle sur un contenu texte.
   * Retourne les numéros de ligne correspondants.
   */
  testRuleAgainstContent(
    rule: Rule,
    content: string,
    filePath: string
  ): Array<{ line: number; match: string; pattern: string }> {
    const matches: Array<{ line: number; match: string; pattern: string }> = [];

    for (const pattern of rule.patterns) {
      // Vérification d'extension
      if (pattern.extensions && pattern.extensions.length > 0) {
        const ext = filePath.substring(filePath.lastIndexOf("."));
        if (!pattern.extensions.includes(ext)) continue;
      }

      // Vérification d'exclusion de chemin
      if (pattern.excludePaths && pattern.excludePaths.length > 0) {
        const excluded = pattern.excludePaths.some((excl) => filePath.includes(excl));
        if (excluded) continue;
      }

      // Test regex
      if (pattern.regex) {
        try {
          const flags = pattern.regexFlags ?? "gm";
          const regex = new RegExp(pattern.regex, flags);
          const lines = content.split("\n");
          lines.forEach((line, idx) => {
            regex.lastIndex = 0;
            if (regex.test(line)) {
              matches.push({
                line: idx + 1,
                match: line.trim().slice(0, 200),
                pattern: pattern.regex!,
              });
            }
          });
        } catch (err) {
          console.warn(`[RuleEngine] Regex invalide pour la règle ${rule.id}: ${pattern.regex}`);
        }
      }
    }

    return matches;
  }
}

// Singleton global
export const ruleEngine = new RuleEngine();
