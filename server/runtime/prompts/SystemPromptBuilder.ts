/**
 * SystemPromptBuilder — Orchestrateur du pipeline de compilation de prompt
 *
 * Évolution : d'un simple assembleur de sections vers un compilateur de politique.
 *
 * Pipeline interne :
 *   SystemPromptConfig
 *       ↓ ContextResolver
 *   PromptContext
 *       ↓ RuleRegistry  (CORE_RULES + règles chargées depuis .md)
 *   PromptRule[]  (candidates filtrées par scope/when)
 *       ↓ ConflictResolver
 *   PromptRule[]  (après résolution P0–P7)
 *       ↓ SectionRegistry  (sections .md sélectionnées par contexte)
 *   PromptSection[]
 *       ↓ PromptCompiler
 *   BuiltPrompt  { content, rules, sections, conflicts, metadata }
 *
 * Rétrocompatibilité totale :
 *   - build(config): string            → inchangé
 *   - buildSystemPrompt(config): string → inchangé
 *   - getSystemPromptBuilder()         → inchangé
 *   - buildSystemInstructionV3()       → inchangé (@deprecated)
 *   - getRegistry()                    → inchangé
 *   - loadTemplates()                  → inchangé
 *
 * Nouvelles API :
 *   - buildFull(config): BuiltPrompt   → prompt + audit complet
 *   - explain(config): string          → explication lisible du build
 */

import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import process from "node:process";

import { PromptRegistry }   from "../PromptRegistry.js";
import { loadPromptTemplates } from "./loader.js";
import { ContextResolver }  from "./ContextResolver.js";
import { RuleRegistry }     from "./RuleRegistry.js";
import { ConflictResolver } from "./ConflictResolver.js";
import { SectionRegistry }  from "./SectionRegistry.js";
import { PromptCompiler }   from "./PromptCompiler.js";
import { CORE_RULES }       from "./rules/core.js";

import type { BuiltPrompt }   from "./types/builder.js";
import type { PromptSection } from "./types/builder.js";
import type { PromptContext } from "./types/context.js";
import type { RuleScope }     from "./types/rules.js";

import {
  SystemPromptConfig,
  AgentRole,
  AGENT_ROLES_INFO,
  LANG_INSTRUCTIONS_FR,
  STYLE_INSTRUCTIONS_FR,
} from "./types.js";
import type { TaskType } from "./types/context.js";

/**
 * Dossier du module, robuste en ESM (dev via tsx) comme en CJS (bundle esbuild).
 * En CJS bundlé, `import.meta.url` est vide et `fileURLToPath("")` lève
 * ERR_INVALID_URL : on privilégie donc le global `__dirname` (fourni par esbuild)
 * et on ne recourt à `import.meta.url` que s'il est exploitable, sans jamais
 * lever au chargement du module.
 */
const __dirname_compat: string = (() => {
  if (typeof __dirname !== "undefined") return __dirname;
  try {
    const url = import.meta.url;
    if (url) return path.dirname(fileURLToPath(url));
  } catch {
    // import.meta.url absent/vide en CJS — on retombe sur le cwd
  }
  return process.cwd();
})();

// ═══════════════════════════════════════════════════════════════════════════════
// SystemPromptBuilder
// ═══════════════════════════════════════════════════════════════════════════════

export class SystemPromptBuilder {
  // ── Pipeline components ───────────────────────────────────────────────────

  private readonly contextResolver  = new ContextResolver();
  private readonly ruleRegistry     = new RuleRegistry();
  private readonly conflictResolver = new ConflictResolver();
  private readonly sectionRegistry  = new SectionRegistry();
  private readonly compiler         = new PromptCompiler();

  // ── Legacy PromptRegistry (templates Markdown) ───────────────────────────
  // Conservé pour la rétrocompatibilité de getRegistry() et du rendu compact.

  private readonly legacyRegistry: PromptRegistry;
  private loaded = false;

  constructor(registry?: PromptRegistry) {
    this.legacyRegistry = registry ?? new PromptRegistry();

    // Charger les règles core au démarrage
    this.ruleRegistry.registerAll(CORE_RULES);
  }

  // ─── Chargement des templates .md ─────────────────────────────────────────

  /**
   * Charge les fichiers .md dans le legacy PromptRegistry ET
   * enregistre les sections dans le SectionRegistry pour le nouveau pipeline.
   *
   * Appeler une seule fois au démarrage (ou laisser build() le faire lazily).
   */
  loadTemplates(promptsDir?: string): void {
    const dir = promptsDir ?? SystemPromptBuilder.resolvePromptsDir();
    loadPromptTemplates(this.legacyRegistry, dir);
    this.syncSectionsFromLegacy(dir);
    this.loaded = true;
  }

  /**
   * Localise le dossier contenant les fichiers `.md` de prompts.
   *
   * En dev (`tsx`), les `.md` sont à côté de ce module. En build bundlé
   * (`dist/server.cjs`), le module vit dans `dist/` : on cherche alors un
   * sous-dossier `prompts/` copié par le build, puis on retombe sur le chemin
   * source relatif au cwd. Le premier dossier contenant `base.md` gagne.
   */
  private static resolvePromptsDir(): string {
    const candidates = [
      __dirname_compat,
      path.join(__dirname_compat, "prompts"),
      path.join(process.cwd(), "dist", "prompts"),
      path.join(process.cwd(), "server", "runtime", "prompts"),
    ];
    for (const dir of candidates) {
      try {
        if (fs.existsSync(path.join(dir, "base.md"))) return dir;
      } catch {
        // ignore et continue
      }
    }
    // Dernier recours : le dossier du module (comportement historique).
    return __dirname_compat;
  }

  // ─── API principale ───────────────────────────────────────────────────────

  /**
   * Construit le prompt système complet.
   *
   * Rétrocompatible : même signature et même type de retour qu'avant.
   * Utilise désormais le nouveau pipeline en interne.
   */
  build(config: SystemPromptConfig & { taskType?: TaskType } = {}): string {
    return this.buildFull(config).content;
  }

  /**
   * Construit le prompt et retourne le résultat complet (contenu + audit).
   *
   * Nouvelle API — permet au runtime d'inspecter rules/sections/conflicts.
   */
  buildFull(config: SystemPromptConfig & { taskType?: TaskType } = {}): BuiltPrompt {
    if (!this.loaded) {
      this.loadTemplates();
    }

    const startMs = Date.now();

    // ── 1. Résoudre le contexte ──
    const context = this.contextResolver.resolve(config);

    // ── 2. Filtrer les règles candidates (scope + when) ──
    const candidates = this.ruleRegistry
      .all()
      .filter(rule => this.isRuleActive(rule, context));

    // ── 3. Résoudre les conflits ──
    const { rules: resolvedRules, conflicts } =
      this.conflictResolver.resolve(candidates);

    // ── 4. Trier les règles par priorité ──
    const orderedRules = [...resolvedRules].sort(
      (a, b) => a.priority - b.priority,
    );

    // ── 5. Sélectionner les sections contextuelles (nouveau pipeline) ──
    const sections = this.sectionRegistry.select(context);

    // ── 6. Ajouter les sections additionnelles du legacy pipeline ──
    //   (workspace, extra sections, footer) pour la rétrocompatibilité.
    const legacySections = this.buildLegacySections(config, context);

    // ── 6b. Tri final par priorité + injection des variables ──
    //   Les sections .md sont pré-rendues sans variables (syncSectionsFromLegacy
    //   utilise { compact: true } sans passer de variables). Elles sont donc
    //   substituées ici, au moment du build, sur l'ensemble consolidé — sinon
    //   le modèle reçoit littéralement « {{aiName}} », etc.
    const vars: Record<string, string> = {
      aiName:   config.aiName   ?? "Leanna",
      userName: config.userName ?? "",
      userRole: config.userRole ?? "",
    };
    const renderVars = (text: string): string =>
      text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
        vars[key] !== undefined && vars[key] !== "" ? vars[key] : "",
      );

    const allSections = [...sections, ...legacySections]
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
      .map(s => ({ ...s, content: this.cleanupEmptyVars(renderVars(s.content)) }));

    // ── 7. Compiler ──
    const built = this.compiler.compile(
      context,
      orderedRules,
      allSections,
      conflicts,
      startMs,
    );

    // ── 8. Si aucune règle n'est active (cas edge), fallback sur le
    //   legacy pipeline pour garantir la rétrocompatibilité totale. ──
    if (orderedRules.length === 0 && allSections.length === 0) {
      const legacyContent = this.buildLegacy(config);
      return {
        content:   legacyContent,
        rules:     [],
        sections:  [],
        conflicts: [],
        metadata: {
          mode:          context.mode,
          taskType:      context.taskType,
          ruleCount:     0,
          sectionCount:  0,
          conflictCount: 0,
          buildTimeMs:   Date.now() - startMs,
        },
      };
    }

    return built;
  }

  /**
   * Retourne une explication lisible du build — utile pour le debugging.
   *
   *   console.log(builder.explain({ mode: "full", taskType: "debugging" }))
   */
  explain(config: SystemPromptConfig & { taskType?: TaskType } = {}): string {
    const built = this.buildFull(config);
    return this.compiler.explain(built);
  }

  /**
   * Retourne le legacy PromptRegistry pour enregistrer des templates additionnels.
   * Conservé pour la rétrocompatibilité.
   */
  getRegistry(): PromptRegistry {
    return this.legacyRegistry;
  }

  /**
   * Retourne le RuleRegistry pour enregistrer des règles additionnelles.
   */
  getRuleRegistry(): RuleRegistry {
    return this.ruleRegistry;
  }

  /**
   * Retourne le SectionRegistry pour enregistrer des sections additionnelles.
   */
  getSectionRegistry(): SectionRegistry {
    return this.sectionRegistry;
  }

  /**
   * Renvoie true/false si un outil dont le nom commence par `prefix` est
   * disponible, ou `undefined` quand la liste d'outils est inconnue (vide).
   * Les appelants font `?? true` pour conserver le comportement historique
   * (section affichée) quand le runtime ne fournit pas la liste.
   */
  private hasToolPrefix(context: PromptContext, prefix: string): boolean | undefined {
    const available = context.tools?.available ?? [];
    if (available.length === 0) return undefined;
    return available.some(name => name.startsWith(prefix));
  }

  /**
   * Nettoie les artefacts laissés par une variable vide après substitution :
   *   « Utilisateur : () » quand userName/userRole sont vides.
   * Sans ça, le modèle lit une ligne d'identité incomplète et parasite.
   */
  private cleanupEmptyVars(text: string): string {
    return text
      // « Utilisateur () » ou « Utilisateur : () » ou « Utilisateur  () »
      .replace(/^.*Utilisateur\s*:?\s*\(\s*\).*$/gim, "")
      // parenthèses/deux-points orphelins laissés par un rôle vide
      .replace(/\(\s*\)/g, "")
      // lignes vides multiples introduites par le nettoyage
      .replace(/\n{3,}/g, "\n\n");
  }

  // ─── Synchronisation Legacy → SectionRegistry ─────────────────────────────

  /**
   * Lit les fichiers .md et les enregistre comme PromptSection dans le
   * SectionRegistry, avec les métadonnées de scope/priority du front-matter.
   */
  private syncSectionsFromLegacy(promptsDir: string): void {
    if (!fs.existsSync(promptsDir)) return;

    const files = fs.readdirSync(promptsDir).filter((f: string) => f.endsWith(".md"));

    const SECTION_SCOPE_MAP: Record<string, RuleScope[]> = {
      "base":                ["full"],
      "safety":              ["global"],
      "ai-studio-directives":["full", "coding"],
      "efficiency":          ["global"],
      "browser":             ["browser", "full"],
      "agents-system":       ["agent", "full"],
      "autonomy":            ["full"],
      "chat":                ["ask"],
      "security":            ["full", "coding"],
    };

    const SECTION_PRIORITY_MAP: Record<string, number> = {
      "base":                 10,
      "safety":               20,
      "ai-studio-directives": 30,
      "efficiency":           40,
      "browser":              50,
      "agents-system":        60,
      "autonomy":             70,
      "chat":                 15,
      "security":             80,
    };

    for (const file of files) {
      const id = file.replace(/\.md$/, "");
      if (this.sectionRegistry.has(id)) continue; // déjà enregistrée

      try {
        const filePath = path.join(promptsDir, file);
        const raw      = fs.readFileSync(filePath, "utf-8");
        const content  = this.legacyRegistry.has(id)
          ? this.legacyRegistry.render(id, { compact: true })
          : raw;

        const section: PromptSection = {
          id,
          content,
          scope:    SECTION_SCOPE_MAP[id] ?? ["global"],
          priority: SECTION_PRIORITY_MAP[id] ?? 100,
          source:   file,
        };

        // Conditions dynamiques pour les sections agents.
        // La section générique (14 rôles) n'est active que si aucun sous-ensemble
        // n'est imposé via allowedRoles ; sinon c'est agents-system-filtered qui
        // la remplace (sans quoi le modèle lirait les deux listes).
        if (id === "agents-system") {
          section.when = ctx =>
            ctx.agents.enabled && !(ctx.agents.allowedRoles && ctx.agents.allowedRoles.length > 0);
        }

        // Gating par outils : la section navigateur (~volumineuse) n'est chargée
        // que si un outil browser_* est effectivement disponible. Prudence :
        // quand tools.available est vide (inconnu), on garde le comportement
        // historique (section affichée) pour éviter toute régression.
        if (id === "browser") {
          section.when = ctx => this.hasToolPrefix(ctx, "browser_") ?? true;
        }

        // La section audit de sécurité n'est chargée que si l'outil security_audit
        // est disponible. Fallback : masquée quand la liste d'outils est inconnue
        // (undefined), car c'est un bloc spécialisé qui ne doit pas peser par défaut.
        if (id === "security") {
          section.when = ctx => this.hasToolPrefix(ctx, "security_audit") ?? false;
        }

        this.sectionRegistry.set(section);
      } catch {
        // Silently skip unreadable files
      }
    }
  }

  // ─── Legacy sections (workspace + extra + footer) ─────────────────────────

  /**
   * Construit les sections legacy qui ne font pas partie des fichiers .md :
   *   - Workspace section (dynamique, dépend du path)
   *   - Extra sections (fournies par le runtime)
   *   - Footer (langue + style)
   * Ces sections ont une priority élevée (> 200) pour apparaître en dernier.
   */
  private buildLegacySections(
    config:  SystemPromptConfig,
    _context: PromptContext,
  ): PromptSection[] {
    const sections: PromptSection[] = [];

    // ── Workspace ──
    sections.push({
      id:       "workspace",
      priority: 200,
      content:  this.buildWorkspaceSection(config.workspace),
      source:   "SystemPromptBuilder (dynamic)",
    });

    // ── Extra sections du runtime ──
    if (config.extraSections) {
      for (const [i, s] of config.extraSections.entries()) {
        sections.push({
          id:       s.id,
          priority: 210 + i,
          content:  s.content,
          source:   "config.extraSections",
        });
      }
    }

    // ── Agents filtrés (si allowedRoles défini) ──
    const agentsEnabled  = config.agents?.enabled !== false;
    const allowedRoles   = config.agents?.allowedRoles as AgentRole[] | undefined;
    if (agentsEnabled && allowedRoles && allowedRoles.length > 0) {
      // Remplacer la section agents-system générique par la version filtrée
      sections.push({
        id:       "agents-system-filtered",
        priority: 61, // juste après agents-system (60)
        content:  this.buildFilteredAgentsPrompt(allowedRoles),
        source:   "SystemPromptBuilder (filtered agents)",
        when:     ctx => ctx.agents.enabled,
      });
    }

    // ── Footer (langue + style) ──
    const footer = this.buildFooter(config);
    if (footer) {
      sections.push({
        id:       "footer",
        priority: 300,
        content:  footer,
        source:   "SystemPromptBuilder (footer)",
      });
    }

    return sections;
  }

  // ─── Scope matching (miroir de SectionRegistry) ───────────────────────────

  private isRuleActive(
    rule:    { scope: RuleScope[]; when?: (ctx: PromptContext) => boolean },
    context: PromptContext,
  ): boolean {
    if (rule.when && !rule.when(context)) return false;
    return rule.scope.some(scope => this.matchesScope(scope, context));
  }

  private matchesScope(scope: RuleScope, context: PromptContext): boolean {
    if (scope === "global")                             return true;
    if (scope === context.mode)                        return true;
    if (scope === context.taskType)                    return true;
    if (scope === "agent" && context.agents.enabled)   return true;
    return false;
  }

  // ─── Workspace section (inchangée) ────────────────────────────────────────

  private buildWorkspaceSection(workspace?: string): string {
    const trimmed = workspace?.trim();
    if (trimmed) {
      return [
        "## Workspace Projet Actif",
        `Le dossier du projet sur lequel tu travailles actuellement est : \`${trimmed}\`.`,
        "Toutes les opérations de lecture, recherche et modification de fichiers s'appliquent à ce projet.",
      ].join("\n");
    }

    return [
      "## Mode Sans Projet Ouvert",
      "Actuellement, AUCUN workspace (projet de code) n'est ouvert dans Leanna.",
      "- C'est un état normal et prévu : l'utilisateur utilise l'application pour de la discussion générale, du conseil, de l'assistance, de la conception ou de la recherche web.",
      "- Ne tente PAS d'appeler des outils d'inspection ou de manipulation de fichiers de projet (ex: get_workspace_info, list_project_files, read_project_file, search_in_files, etc.) car aucun projet n'est actif.",
      "- Ne signale JAMAIS d'erreur technique de workspace ou de problème d'ouverture de workspace : réponds simplement et directement aux questions de l'utilisateur.",
      "- Si l'utilisateur exprime le souhait de créer un nouveau projet, tu peux lui proposer d'utiliser l'outil `project_scaffold` pour générer un projet React/Vite/Next.js.",
      "- Si l'utilisateur demande à travailler sur du code existant, rappelle-lui gentiment qu'il peut sélectionner son dossier de projet via le sélecteur de workspace dans l'interface.",
    ].join("\n");
  }

  // ─── Agents filtrés (inchangé) ────────────────────────────────────────────

  private buildFilteredAgentsPrompt(allowedRoles: AgentRole[]): string {
    const lines: string[] = [];
    lines.push("# Système Multi-Agents");
    lines.push("");
    lines.push("Tu fais partie du système multi-agents Leanna, couvrant l'ingénierie de code et la rédaction.");
    lines.push(`**Agents activés :** ${allowedRoles.join(", ")}`);
    lines.push("");
    lines.push("## Règles de délégation");
    lines.push("");
    lines.push("Applique d'abord le routeur déterministe (règle `routing.deterministic-router`) : le code trivial et isolé se corrige directement, seul le code non trivial est délégué. Les rôles ci-dessous ne s'appliquent qu'aux cas à déléguer :");
    lines.push("");
    if (allowedRoles.includes("coder"))    lines.push("- **Code non trivial :** nouvelle fonctionnalité, bug, API, multi-fichiers → `coder` via `agent_delegate`.");
    if (allowedRoles.includes("refactor")) lines.push("- **Refactoring :** Clean Code et découpage de modules → `refactor`.");
    if (allowedRoles.includes("debugger")) lines.push("- **Débogage :** résolution d'erreurs et de stacktraces → `debugger`.");
    if (allowedRoles.includes("writer"))   lines.push("- **Rédaction :** document complexe ou spécialisé → `writer`.");
    lines.push("");
    lines.push("## Agents disponibles");
    lines.push("");
    lines.push("| Rôle | Description | Écriture |");
    lines.push("|------|-------------|----------|");
    for (const role of allowedRoles) {
      const info = AGENT_ROLES_INFO[role];
      if (info) {
        lines.push(`| **${role}** | ${info.description} | ${info.write ? "✅ OUI" : "❌ Lecture seule"} |`);
      }
    }
    lines.push("");
    lines.push("**Agents NON disponibles :** les rôles non listés ci-dessus sont désactivés. Ne tente pas de déléguer à un agent non autorisé.");
    return lines.join("\n");
  }

  // ─── Footer (inchangé) ────────────────────────────────────────────────────

  private buildFooter(config: SystemPromptConfig): string {
    const parts: string[] = [];
    // La directive de langue est TOUJOURS injectée, y compris pour le français :
    // la langue choisie par l'utilisateur est une consigne impérative, jamais
    // une valeur supposée par défaut. Sans ça, sélectionner « français » dans
    // les réglages n'avait aucun effet sur le prompt système.
    const language = config.language ?? "fr";
    const langInst = LANG_INSTRUCTIONS_FR[language];
    if (langInst) parts.push(langInst);

    if (config.responseStyle) {
      const inst = STYLE_INSTRUCTIONS_FR[config.responseStyle];
      if (inst) parts.push(inst);
    }
    return parts.length > 0
      ? `## Instructions de communication\n\n${parts.join("\n")}`
      : "";
  }

  // ─── Fallback legacy complet ──────────────────────────────────────────────

  /**
   * Pipeline legacy (pré-refactoring) — utilisé comme fallback si le nouveau
   * pipeline ne produit rien (edge case : registry vide, tests isolés…).
   *
   * Identique au build() d'origine, garanti de fonctionner sans le nouveau
   * pipeline.
   */
  private buildLegacy(config: SystemPromptConfig): string {
    const variables: Record<string, string> = {
      aiName:   config.aiName   ?? "Leanna",
      userName: config.userName ?? "",
      userRole: config.userRole ?? "",
    };

    const renderOpts = {
      variables,
      compact:  config.compact !== false,
      exclude:  config.excludeSections,
    };

    const isAskMode = config.mode === "ask";
    const sections:  string[] = [];

    if (isAskMode) {
      if (this.legacyRegistry.has("safety"))     sections.push(this.legacyRegistry.render("safety",     renderOpts));
      if (this.legacyRegistry.has("chat"))       sections.push(this.legacyRegistry.render("chat",       renderOpts));
      if (this.legacyRegistry.has("efficiency")) sections.push(this.legacyRegistry.render("efficiency", renderOpts));
    } else {
      if (this.legacyRegistry.has("base"))                  sections.push(this.legacyRegistry.render("base",                  renderOpts));
      if (this.legacyRegistry.has("safety"))                sections.push(this.legacyRegistry.render("safety",                renderOpts));
      if (this.legacyRegistry.has("ai-studio-directives"))  sections.push(this.legacyRegistry.render("ai-studio-directives",  renderOpts));
      if (this.legacyRegistry.has("efficiency"))            sections.push(this.legacyRegistry.render("efficiency",            renderOpts));
      if (this.legacyRegistry.has("browser"))               sections.push(this.legacyRegistry.render("browser",              renderOpts));

      const agentsEnabled = config.agents?.enabled !== false;
      if (agentsEnabled && this.legacyRegistry.has("agents-system")) {
        const allowedRoles = config.agents?.allowedRoles as AgentRole[] | undefined;
        sections.push(
          allowedRoles && allowedRoles.length > 0
            ? this.buildFilteredAgentsPrompt(allowedRoles)
            : this.legacyRegistry.render("agents-system", renderOpts),
        );
      } else if (!agentsEnabled) {
        sections.push(this.buildSoloModePrompt());
      }

      if (this.legacyRegistry.has("autonomy")) sections.push(this.legacyRegistry.render("autonomy", renderOpts));
    }

    sections.push(this.buildWorkspaceSection(config.workspace));

    if (config.extraSections) {
      for (const s of config.extraSections) sections.push(s.content);
    }

    const footer = this.buildFooter(config);
    if (footer) sections.push(footer);

    return sections.filter(Boolean).join("\n\n");
  }

  // ─── Solo mode (inchangé) ─────────────────────────────────────────────────

  private buildSoloModePrompt(): string {
    return [
      "# Mode Solo — Agents désactivés",
      "",
      "Le système multi-agents est **désactivé**. Tu agis seul.",
      "",
      "## Règles en mode solo",
      "",
      "1. **Toutes les modifications sont isolées dans la Sandbox (.Leanna/sandbox)** via `write_project_file`, `modify_project_file` ou `patch_project_file` sans impacter directement le workspace réel",
      "2. **Pas de délégation** — `agent_delegate` et `agent_orchestrate` ne sont pas disponibles",
      "3. **Vérification obligatoire dans la sandbox** — Après chaque modification, vérifie le résultat avec `verify_file`",
      "4. **Checkpoint git** — Avant une modification non triviale, crée un commit pour rollback",
      "5. **Lecture ciblée** — `read_file_outline` d'abord, puis lignes pertinentes uniquement",
      "",
      "## Processus d'exécution",
      "",
      "```",
      "Lire le fichier → Comprendre le contexte → Modifier dans la sandbox → Vérifier → Confirmer à l'utilisateur",
      "```",
    ].join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton — API publique inchangée
// ═══════════════════════════════════════════════════════════════════════════════

let _builder: SystemPromptBuilder | null = null;

/**
 * Retourne le builder singleton (lazy-init).
 */
export function getSystemPromptBuilder(): SystemPromptBuilder {
  if (!_builder) {
    _builder = new SystemPromptBuilder();
    _builder.loadTemplates();
  }
  return _builder;
}

/**
 * Source canonique de construction du prompt système.
 * Rétrocompatible — retourne toujours un string.
 */
export function buildSystemPrompt(
  config: SystemPromptConfig & { taskType?: TaskType } = {},
): string {
  return getSystemPromptBuilder().build(config);
}

/** @deprecated Utiliser buildSystemPrompt. */
export function buildSystemInstructionV3(
  config: SystemPromptConfig = {},
): string {
  return buildSystemPrompt(config);
}
