/**
 * SkillManagerV2 — Remplacement simplifié du SkillManager
 * 
 * Réduit 957 lignes à ~200 en déléguant au ToolRegistry.
 * Conserve l'interface publique exacte pour la compatibilité avec:
 *   - server.ts (handleToolCall, getToolDeclarations, getRelevantToolDeclarations)
 *   - AgentOrchestrator (setSkillHandler)
 *   - Workflow Engine (setWorkflowSkillHandler)
 *   - Mission System (initMissionSystem)
 * 
 * Différences avec l'ancien SkillManager:
 *   - Plus de lazy loading complexe (tout enregistré au démarrage via ToolRegistry)
 *   - Plus de scoring par keywords (le LLM choisit ses outils)
 *   - Plus de self-healing (séparé dans son propre module si nécessaire)
 *   - Plus de 5 systèmes d'initialisation chaînés
 */

import { ToolRegistry } from "../ToolRegistry.js";
import { EventBus } from "../EventBus.js";
import { adaptSkill, adaptAllSkills, createToolCallProxy } from "./SkillAdapter.js";
import type { LegacySkill } from "./SkillAdapter.js";
import type { ToolCallMetrics } from "../types.js";
import type { Skill } from "../../skills/base.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SkillManagerV2
// ═══════════════════════════════════════════════════════════════════════════════

export class SkillManagerV2 {
  private registry: ToolRegistry;
  private eventBus: EventBus;
  private skills: LegacySkill[] = [];
  private customSkillsReloadTimer: ReturnType<typeof setInterval> | null = null;
  private customSkillsReloadInFlight = false;
  private _missionExecutor: any = null;
  // private initialized = false;

  constructor(config?: { eventBus?: EventBus; registry?: ToolRegistry }) {
    this.eventBus = config?.eventBus ?? new EventBus();
    this.registry = config?.registry ?? new ToolRegistry({
      enableMetrics: true,
      eventBus: this.eventBus,
      defaultTimeoutMs: 120_000, // Augmenté de 30s à 2 minutes
    });
  }

  // ─── Initialisation ────────────────────────────────────────────────────────

  /**
   * Enregistre une skill legacy dans le nouveau système.
   * Convertit ses déclarations en ToolDefinitions et les enregistre dans le ToolRegistry.
   */
  registerSkill(skill: LegacySkill): void {
    // Éviter les doublons
    const previousSkill = this.skills.find((s) => s.name === skill.name);
    if (previousSkill) {
      // Remplacer
      this.skills = this.skills.filter((s) => s.name !== skill.name);
      // Unregister les anciens outils de cette skill
      for (const decl of previousSkill.declarations) {
        this.registry.unregister(decl.name);
      }
    }

    this.skills.push(skill);
    const definitions = adaptSkill(skill);
    this.registry.registerAll(definitions);
  }

  /**
   * Enregistre toutes les skills d'un coup (démarrage).
   */
  registerAllSkills(skills: LegacySkill[]): void {
    const definitions = adaptAllSkills(skills);
    this.registry.registerAll(definitions);
    this.skills = [...skills];

    console.log(
      `[SkillManagerV2] ${definitions.length} outil(s) enregistrés depuis ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`
    );
  }

  // ─── Interface publique (compatible SkillManager v1) ───────────────────────

  /**
   * Appelle un outil par son nom.
   * Interface identique à l'ancien SkillManager.handleToolCall().
   */
  async handleToolCall(
    name: string,
    args: any,
    context?: any,
    options?: { dryRun?: boolean }
  ): Promise<any> {
    // Normalisation du nom (compatibilité Gemini qui préfixe)
    let normalizedName = name;
    if (name.includes(":")) {
      normalizedName = name.split(":").pop()!;
    } else if (!this.registry.has(name)) {
      // Tenter de détecter un préfixe de skill
      for (const skill of this.skills) {
        const prefix = skill.name + "_";
        if (name.startsWith(prefix)) {
          const stripped = name.slice(prefix.length);
          if (this.registry.has(stripped)) {
            normalizedName = stripped;
            break;
          }
        }
      }
    }

    // Si un contexte est fourni, chercher la skill correspondante et appeler son handler
    // directement pour préserver le contexte (nécessaire pour emitIdeAction, etc.)
    if (context) {
      for (const skill of this.skills) {
        const tool = skill.declarations.find(d => d.name === normalizedName);
        if (tool) {
          // En dry-run, on ne court-circuite PAS vers le handler direct pour les
          // outils à effet de bord : on les intercepte via le registre pour
          // garantir la simulation. Les outils en lecture seule passent en direct.
          const dryRunActive = options?.dryRun ?? this.registry.getDryRun().isEnabled();
          const def = this.registry.getDefinition(normalizedName);
          if (dryRunActive && def && this.registry.getDryRun().hasSideEffect(def.permissions)) {
            return this.registry.call(normalizedName, args ?? {}, { context, dryRun: true });
          }
          return skill.handleToolCall(normalizedName, args, context);
        }
      }
    }

    // Sinon, utiliser le ToolRegistry normal
    return this.registry.call(normalizedName, args ?? {}, { context, dryRun: options?.dryRun });
  }

  /**
   * Normalise les paramètres d'outil pour supprimer les champs Zod internes.
   * Les déclarations destinées aux providers doivent être du JSON Schema,
   * jamais des instances Zod (qui exposent notamment `_def`).
   */
  private normalizeToolParameters(parameters: any): Record<string, unknown> {
    if (!parameters || typeof parameters !== 'object') return {};
    if (!parameters._def) return this.stripPrivateSchemaFields(parameters) as Record<string, unknown>;

    const definition = parameters._def as any;
    const shape = typeof definition.shape === 'function' ? definition.shape() : definition.shape;
    if (!shape || typeof shape !== 'object') return { type: 'OBJECT', properties: {} };

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, schema] of Object.entries(shape as Record<string, any>)) {
      const field = schema as any;
      const fieldDef = field?._def;
      const typeName = fieldDef?.typeName || '';
      const isOptional = typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable';
      const inner = isOptional ? fieldDef.innerType || fieldDef.type : field;
      const innerDef = inner?._def || {};
      const innerType = innerDef.typeName || '';
      let type = 'STRING';
      if (innerType === 'ZodNumber') type = 'NUMBER';
      else if (innerType === 'ZodBoolean') type = 'BOOLEAN';
      else if (innerType === 'ZodArray') type = 'ARRAY';
      else if (innerType === 'ZodObject' || innerType === 'ZodRecord') type = 'OBJECT';
      else if (innerType === 'ZodEnum' || innerType === 'ZodLiteral') type = 'STRING';
      properties[key] = { type };
      if (!isOptional) required.push(key);
    }

    return { type: 'OBJECT', properties, ...(required.length ? { required } : {}) };
  }

  /** Supprime toute propriété interne susceptible d'être envoyée au provider. */
  private stripPrivateSchemaFields(value: any): any {
    if (Array.isArray(value)) return value.map(item => this.stripPrivateSchemaFields(item));
    if (!value || typeof value !== 'object') return value;
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '_def' || key.startsWith('_')) continue;
      clean[key] = this.stripPrivateSchemaFields(item);
    }
    return clean;
  }

  /**
   * Normalise une déclaration d'outil pour le provider.
   * Gemini function declarations n'acceptent que ces trois champs.
   */
  private normalizeDeclaration(declaration: any): any {
    return {
      name: String(declaration?.name || ''),
      description: String(declaration?.description || ''),
      parameters: this.normalizeToolParameters(declaration?.parameters),
    };
  }

  /**
   * Retourne toutes les déclarations d'outils.
   * Compatible avec l'interface de l'ancien SkillManager.
   */
  getToolDeclarations(enabledSkillIds?: string[]): any[] {
    let declarations = this.registry.getDeclarations();
    
    if (enabledSkillIds) {
      // Filtrer par catégorie (= skill name dans notre mapping)
      declarations = enabledSkillIds.flatMap((id) => this.registry.getDeclarationsByCategory(id));
    }
    
    // Normaliser toutes les déclarations pour supprimer les champs Zod
    return declarations.map(d => this.normalizeDeclaration(d));
  }

  /**
   * Version simplifiée de getRelevantToolDeclarations.
   * 
   * Dans le nouveau système, on ne fait plus de scoring par keywords.
   * Le LLM est assez intelligent pour choisir les bons outils.
   * On retourne simplement toutes les déclarations.
   * 
   * Si on veut optimiser les tokens, on peut filtrer par catégorie.
   */
  getRelevantToolDeclarations(_query: string, enabledSkillIds?: string[]): {
    declarations: any[];
    scoredSkills: { name: string; score: number }[];
    alwaysLoaded: string[];
    dynamicallyLoaded: string[];
  } {
    const declarations = this.getToolDeclarations(enabledSkillIds);
    return {
      declarations,
      scoredSkills: this.skills.map((s) => ({ name: s.name, score: 10 })),
      alwaysLoaded: this.skills.map((s) => s.name),
      dynamicallyLoaded: [],
    };
  }

  // ─── Accès au ToolRegistry ─────────────────────────────────────────────────

  /**
   * Retourne le ToolRegistry interne (pour l'injection dans le runtime).
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * Retourne la liste des skills legacy enregistrées.
   */
  getSkills(): LegacySkill[] {
    return [...this.skills];
  }

  /**
   * Retourne l'EventBus interne.
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Crée un handler compatible avec l'ancien interface.
   * Utile pour les composants qui attendent (name, args) => Promise<any>.
   */
  createHandler(): (name: string, args: any) => Promise<any> {
    return createToolCallProxy(this.registry);
  }

  // ─── Métriques ─────────────────────────────────────────────────────────────

  /**
   * Retourne les métriques par outil.
   */
  getMetrics(): Record<string, { calls: number; failures: number; avgMs: number }> {
    return this.registry.getToolMetrics();
  }

  /**
   * Retourne l'historique des appels.
   */
  getCallHistory(limit = 50): ToolCallMetrics[] {
    return this.registry.getCallHistory(limit);
  }

  /**
   * Nombre total d'outils enregistrés.
   */
  get toolCount(): number {
    return this.registry.size;
  }

  /**
   * Vérifie si un outil existe.
   */
  hasTool(name: string): boolean {
    return this.registry.has(name);
  }

  /**
   * Liste les catégories (= noms de skills).
   */
  getCategories(): string[] {
    return this.registry.getCategories();
  }

  // ─── Mission System ─────────────────────────────────────────────────────────────

  /**
   * Getter pour missionExecutor (compatible avec l'ancien SkillManager).
   * Le missionExecutor doit être initialisé explicitement via ensureMissionExecutor()
   * ou dans le callback onReady de bootstrapRuntime.
   */
  get missionExecutor(): any {
    return this._missionExecutor;
  }

  // ─── Custom Skills ────────────────────────────────────────────────────────────

  /**
   * Charge les custom skills depuis Supabase et les enregistre.
   * Appelé au démarrage et peut être rappelé pour rafraîchir.
   * Compatible avec l'ancien SkillManager.loadCustomSkills().
   */
  public async loadCustomSkills(): Promise<void> {
    try {
      const { getCustomSkillDeclarations, handleCustomSkillCall, customSkillsManagementSkill } =
        await import('../../skills/customSkills');

      // Enregistrer le skill de gestion CRUD comme une skill classique
      const managementSkill = customSkillsManagementSkill as unknown as Skill;
      this.registerSkill({
        name: managementSkill.name,
        declarations: managementSkill.declarations,
        handleToolCall: managementSkill.handleToolCall.bind(managementSkill),
        permissions: managementSkill.permissions as any,
        toolPermissions: managementSkill.toolPermissions as any,
      });

      // Charger les déclarations des custom skills actifs
      const declarations = await getCustomSkillDeclarations();
      // Enregistrer aussi une liste vide pour retirer les skills désactivés ou supprimés.
      const customSkillProxy: LegacySkill = {
        name: "custom_skills_proxy",
        declarations: declarations as any[],
        handleToolCall: async (name: string, args: any) => {
          return handleCustomSkillCall(name, args);
        },
      };
      this.registerSkill(customSkillProxy);
      console.log(`[SkillManagerV2] ✓ ${declarations.length} custom skill(s) chargé(s) depuis la BDD.`);
    } catch (err: any) {
      // Non critique — les custom skills ne bloquent pas le démarrage
      console.warn(`[SkillManagerV2] Custom skills non chargés:`, err.message);
    }
  }

  /** Démarre le rafraîchissement périodique des custom skills. */
  public startCustomSkillsHotReload(intervalMs = 30_000): void {
    this.stopCustomSkillsHotReload();
    if (intervalMs <= 0) return;

    this.customSkillsReloadTimer = setInterval(() => {
      if (this.customSkillsReloadInFlight) return;
      this.customSkillsReloadInFlight = true;
      import('../../skills/customSkills')
        .then(({ invalidateCustomSkillsCache }) => {
          invalidateCustomSkillsCache();
          return this.loadCustomSkills();
        })
        .catch((err: unknown) => {
          console.warn('[SkillManagerV2] Hot-reload des custom skills échoué:', err);
        })
        .finally(() => {
          this.customSkillsReloadInFlight = false;
        });
    }, intervalMs);
  }

  /** Arrête le rafraîchissement périodique des custom skills. */
  public stopCustomSkillsHotReload(): void {
    if (this.customSkillsReloadTimer) {
      clearInterval(this.customSkillsReloadTimer);
      this.customSkillsReloadTimer = null;
    }
  }

  // ─── Compatibilité avec l'ancien SkillManager ─────────────────────────────

  /**
   * Découverte et chargement paresseux de skills (compatibilité).
   * Dans le nouveau système, toutes les skills sont chargées au démarrage,
   * donc cette méthode retourne simplement les outils déjà chargés.
   */
  public async discoverAndLoad(category: string): Promise<{ loaded: string[]; tools: string[] }> {
    // Toutes les skills sont déjà chargées via bootstrapRuntime
    // Retourner les outils de la catégorie demandée
    const allDeclarations = this.getToolDeclarations();
    const categoryDeclarations = this.getToolDeclarations([category]);
    
    const loaded = categoryDeclarations.length > 0 ? [category] : [];
    const tools = categoryDeclarations.map((d: any) => d.name);
    
    if (loaded.length === 0) {
      console.warn(`[SkillManagerV2] Catégorie "${category}" non trouvée ou déjà chargée.`);
    }
    
    return { loaded, tools };
  }

  /**
   * Enregistre l'utilisation d'un outil (compatibilité avec l'ancien système).
   * Dans le nouveau système, les métriques sont gérées automatiquement par ToolRegistry.
   */
  public recordToolUsage(toolName: string, success: boolean): void {
    // Le ToolRegistry gère déjà les métriques automatiquement
    // Cette méthode est conservée pour la compatibilité mais ne fait rien de spécial
    console.log(`[SkillManagerV2] Utilisation de l'outil "${toolName}": ${success ? '✓' : '✗'}`);
  }
}
