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

import fs from "node:fs";
import path from "node:path";

import type { Rule, RuleFamily, RuleSeverity } from "./Rule.js";
import type { Finding } from "../findings/Finding.js";

// ─── Built-in rule packs ───────────────────────────────────────────────────────

import { owaspTop10Rules } from "./packs/owasp-top10-2021.js";
import { cweTop25Rules } from "./packs/cwe-top25.js";
import { cisaKevRules } from "./packs/cisa-kev.js";
import { iacBaselineRules } from "./packs/iac-baseline.js";

// Fichier de persistance de l'état activé/désactivé des packs.
const STATE_FILE = path.join(process.cwd(), ".Leanna", "rule-packs.json");

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

    this.registerPack("iac-baseline", {
      id: "iac-baseline",
      name: "IaC Baseline (Docker / K8s / Terraform)",
      version: "2024.0.1",
      description: "Durcissement d'infrastructure : conteneurs root, tags latest, pods privilégiés, ingress ouverts.",
      author: "Leanna Security",
      ruleCount: iacBaselineRules.length,
      enabled: true,
    }, iacBaselineRules);

    // Restaure l'état activé/désactivé persisté (survit aux redémarrages).
    this.loadState();
  }

  // ─── Persistance de l'état activé/désactivé ───────────────────────────────────

  /**
   * Recharge l'état activé/désactivé depuis `.Leanna/rule-packs.json`, si présent.
   * Fail-open : en cas d'erreur, on conserve les valeurs par défaut (tous activés).
   */
  private loadState(): void {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as { packs?: Record<string, boolean> };
      if (!parsed || typeof parsed.packs !== "object" || parsed.packs === null) return;
      for (const [packId, enabled] of Object.entries(parsed.packs)) {
        const pack = this.packs.get(packId);
        if (pack && typeof enabled === "boolean") pack.meta.enabled = enabled;
      }
      this.cachedRules = null;
    } catch (err) {
      console.warn(`[RuleEngine] Impossible de charger l'état des packs: ${(err as Error).message}`);
    }
  }

  /**
   * Écrit l'état activé/désactivé courant sur disque. Non bloquant en cas d'échec.
   */
  private saveState(): void {
    try {
      const packs: Record<string, boolean> = {};
      for (const { meta } of this.packs.values()) packs[meta.id] = meta.enabled;
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ packs }, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[RuleEngine] Impossible de sauvegarder l'état des packs: ${(err as Error).message}`);
    }
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
    this.saveState();
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

  // ─── Filtrage des findings par packs activés ─────────────────────────────────

  /**
   * Construit l'ensemble des identifiants "revendiqués" par un pack : id de règle,
   * CWE et OWASP. Utilisé pour rattacher un finding produit par un scanner au(x)
   * pack(s) qui le couvrent.
   */
  private packClaims(packId: string): Set<string> {
    const claims = new Set<string>();
    const pack = this.packs.get(packId);
    if (!pack) return claims;
    for (const rule of pack.rules) {
      if (rule.id) claims.add(rule.id.toUpperCase());
      if (rule.cwe) claims.add(rule.cwe.toUpperCase());
      if (rule.owasp) claims.add(this.normalizeOwasp(rule.owasp));
    }
    return claims;
  }

  /** Normalise une référence OWASP en son préfixe de catégorie (ex: "A03:2021-Injection" → "A03:2021"). */
  private normalizeOwasp(value: string): string {
    const m = value.toUpperCase().match(/A\d{1,2}:\d{4}/);
    return m ? m[0] : value.toUpperCase();
  }

  /**
   * Retourne l'ensemble des identifiants d'un finding (ruleId, CWE, OWASP),
   * normalisés pour comparaison avec `packClaims`.
   */
  private findingIdentifiers(finding: Finding): string[] {
    const ids: string[] = [];
    if (finding.ruleId) ids.push(finding.ruleId.toUpperCase());
    const cwes = Array.isArray(finding.cwe) ? finding.cwe : finding.cwe ? [finding.cwe] : [];
    for (const c of cwes) if (c) ids.push(String(c).toUpperCase());
    const owasps = Array.isArray(finding.owasp) ? finding.owasp : finding.owasp ? [finding.owasp] : [];
    for (const o of owasps) if (o) ids.push(this.normalizeOwasp(String(o)));
    return ids;
  }

  /**
   * Détermine si un finding doit être conservé compte tenu de l'état des packs.
   *
   * Sémantique (fail-open pour les familles non couvertes) :
   *  - Si AUCUN pack (activé ou non) ne revendique le finding, il est conservé
   *    (ex: un secret non associé à un pack ne doit jamais disparaître en désactivant OWASP).
   *  - Si au moins un pack ACTIVÉ le revendique, il est conservé.
   *  - Si tous les packs qui le revendiquent sont désactivés, il est filtré.
   */
  isFindingAllowed(finding: Finding): boolean {
    const identifiers = this.findingIdentifiers(finding);
    if (identifiers.length === 0) return true;

    let claimedByAny = false;
    let claimedByEnabled = false;

    for (const { meta } of this.packs.values()) {
      const claims = this.packClaims(meta.id);
      const matches = identifiers.some((id) => claims.has(id));
      if (!matches) continue;
      claimedByAny = true;
      if (meta.enabled) {
        claimedByEnabled = true;
        break;
      }
    }

    // Non couvert par aucun pack → conservé. Sinon, conservé seulement si un pack actif le couvre.
    return !claimedByAny || claimedByEnabled;
  }

  /**
   * Filtre une liste de findings en ne conservant que ceux autorisés par les packs actifs.
   */
  filterFindings<T extends Finding>(findings: T[]): T[] {
    return findings.filter((f) => this.isFindingAllowed(f));
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
