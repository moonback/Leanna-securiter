/**
 * SkillAdapter — Convertit les Skills legacy en ToolDefinitions
 * 
 * Ce module est le cœur de la Phase 2 de la migration.
 * Il permet d'utiliser toutes les skills existantes dans le nouveau ToolRegistry
 * sans modifier les fichiers de skills.
 * 
 * Flux :
 *   Skill existante (server/skills/*.ts)
 *     ↓ adaptSkill()
 *   ToolDefinition[] 
 *     ↓ ToolRegistry.registerAll()
 *   Nouveau runtime
 */

import type { ToolDefinition, ToolDeclaration, ToolPermission } from "../types.js";
import { normalizePermissions } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Interface Legacy Skill (contractuelle, pas d'import depuis l'ancien code)
// ═══════════════════════════════════════════════════════════════════════════════

export interface LegacySkillDeclaration {
  name: string;
  description: string;
  parameters?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  /** Permissions déclarées au niveau de la déclaration d'outil. */
  permissions?: ToolPermission[];
}

export interface LegacySkill {
  name: string;
  declarations: LegacySkillDeclaration[];
  handleToolCall: (name: string, args: any, context?: any) => Promise<any> | any;
  /** Permissions par défaut pour tous les outils de ce skill. */
  permissions?: ToolPermission[];
  /** Permissions par outil (surcharge `permissions`). */
  toolPermissions?: Record<string, ToolPermission[]>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill → ToolDefinition conversion
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convertit une skill legacy en une liste de ToolDefinitions pour le ToolRegistry.
 * 
 * @param skill - L'instance de skill legacy
 * @param options - Options de conversion
 * @returns Les ToolDefinitions correspondantes
 */
export function adaptSkill(skill: LegacySkill, options: AdaptOptions = {}): ToolDefinition[] {
  return skill.declarations.map((decl) => adaptDeclaration(skill, decl, options));
}

/**
 * Convertit une seule déclaration en ToolDefinition.
 */
function adaptDeclaration(
  skill: LegacySkill,
  decl: LegacySkillDeclaration,
  options: AdaptOptions
): ToolDefinition {
  const declaration: ToolDeclaration = {
    name: decl.name,
    description: decl.description,
    parameters: decl.parameters ?? {},
  };

  return {
    declaration,
    // Arité 2 volontaire : signale au ToolRegistry qu'il doit transmettre le
    // contexte par appel (qui porte notamment le `signal` du kill-switch
    // temps-réel). Le contexte statique de l'adaptateur (options.context) est
    // fusionné avec le contexte par appel, ce dernier ayant priorité.
    handler: async (args: Record<string, unknown>, callContext?: any) => {
      const mergedContext =
        callContext || options.context
          ? { ...(options.context ?? {}), ...(callContext ?? {}) }
          : undefined;
      return skill.handleToolCall(decl.name, args, mergedContext);
    },
    category: options.category ?? skill.name,
    timeoutMs: options.timeoutMs ?? inferTimeout(decl.name),
    permissions: resolvePermissions(skill, decl, options),
  };
}

/**
 * Résout les permissions d'un outil selon l'ordre de priorité :
 *   1. override explicite fourni à l'adaptateur (options.permissions)
 *   2. permissions déclarées sur la déclaration d'outil (decl.permissions)
 *   3. permissions par outil déclarées sur le skill (skill.toolPermissions)
 *   4. permissions par défaut du skill (skill.permissions)
 *   5. déduction depuis le nom de l'outil (fallback historique)
 */
function resolvePermissions(
  skill: LegacySkill,
  decl: LegacySkillDeclaration,
  options: AdaptOptions
): ToolPermission[] {
  const declared =
    options.permissions ??
    decl.permissions ??
    skill.toolPermissions?.[decl.name] ??
    skill.permissions;

  if (declared?.length) {
    return normalizePermissions(declared);
  }

  return normalizePermissions(inferPermissions(decl.name, skill.name));
}

const ADAPTED_TOOL_TIMEOUTS: Record<string, number> = {
  agent_execute: 180_000,
  reasoning_think: 180_000,
  agent_orchestrate: 180_000,
  verify_full: 180_000,
  verify_typecheck: 120_000,
  verify_lint: 120_000,
  verify_file: 60_000,
  analyze_project_file: 90_000,
  knowledge_build_context: 90_000,
  knowledge_impact_analyze: 90_000,
  knowledge_semantic_search: 45_000,
  write_project_file: 60_000,
  apply_patch: 60_000,
  patch_project_file: 60_000,
  modify_project_file: 60_000,
  search_in_files: 45_000,
  read_project_file: 30_000,
  read_file_outline: 20_000,
  list_project_files: 20_000,
};

function inferTimeout(toolName: string): number {
  return ADAPTED_TOOL_TIMEOUTS[toolName] ?? 60_000;
}

/**
 * Déduit les permissions d'un outil à partir de son nom et de sa catégorie.
 *
 * ⚠️ Fallback historique, faillible par conception : l'inférence par mot-clé
 * ne « voit » pas les effets de bord non nommés (envoi Telegram, clic
 * navigateur, orchestration multi-agents…). Un skill DEVRAIT toujours déclarer
 * ses permissions explicitement (`permissions` / `toolPermissions`).
 *
 * Point clé de sûreté : quand aucun mot-clé ne matche, on retourne un tableau
 * VIDE — surtout PAS `["read"]`. C'est ce qui permet aux garde-fous fail-safe
 * (`DryRunController.hasSideEffect` et `AutonomyPolicy.hasSideEffect`, qui
 * traitent « aucune permission déclarée » comme un effet de bord potentiel) de
 * se déclencher. Défaut sur `["read"]` masquerait ces effets de bord aux trois
 * couches de sécurité simultanément.
 */
function inferPermissions(toolName: string, skillName: string): ToolDefinition["permissions"] {
  const name = toolName.toLowerCase();
  const permissions: ToolDefinition["permissions"] = [];

  // Lecture
  if (name.includes("read") || name.includes("list") || name.includes("get") || name.includes("search") || name.includes("outline")) {
    permissions.push("read");
  }

  // Écriture
  if (name.includes("write") || name.includes("patch") || name.includes("modify") || name.includes("create") || name.includes("delete") || name.includes("update")) {
    permissions.push("write");
  }

  // Exécution
  if (name.includes("run") || name.includes("exec") || name.includes("command")) {
    permissions.push("execute");
  }

  // Réseau
  if (skillName === "github" || skillName === "weather" || name.includes("navigate") || name.includes("fetch")) {
    permissions.push("network");
  }

  // Dangereux
  if (name.includes("delete") || name.includes("remove") || name.includes("drop")) {
    permissions.push("dangerous");
  }

  // Aucun mot-clé reconnu → tableau VIDE (et non ["read"]). Un outil sans
  // permission déclarée est ainsi traité prudemment comme un effet de bord
  // potentiel par le dry-run et l'AutonomyPolicy, au lieu d'être classé
  // silencieusement en lecture seule. Voir le commentaire ci-dessus.
  return permissions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Batch adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convertit un ensemble de skills legacy en ToolDefinitions.
 * Utile pour la migration en masse au démarrage.
 */
export function adaptAllSkills(
  skills: LegacySkill[],
  options: AdaptOptions = {}
): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    const adapted = adaptSkill(skill, { ...options, category: skill.name });
    for (const def of adapted) {
      // Déduplication par nom d'outil
      if (!seen.has(def.declaration.name)) {
        seen.add(def.declaration.name);
        definitions.push(def);
      }
    }
  }

  return definitions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reverse adapter (ToolRegistry → SkillManager handleToolCall interface)
// ═══════════════════════════════════════════════════════════════════════════════

import type { ToolRegistry } from "../ToolRegistry.js";

/**
 * Crée une fonction handleToolCall compatible avec l'ancien SkillManager
 * mais qui route les appels vers le nouveau ToolRegistry.
 * 
 * Cela permet aux composants qui dépendent de `handleToolCall(name, args)`
 * de fonctionner sans modification pendant la transition.
 */
export function createToolCallProxy(registry: ToolRegistry): (name: string, args: any) => Promise<any> {
  return async (name: string, args: any) => {
    // Normalisation du nom (même logique que l'ancien SkillManager)
    let normalizedName = name;
    if (name.includes(':')) {
      normalizedName = name.split(':').pop()!;
    }

    return registry.call(normalizedName, args ?? {});
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AdaptOptions {
  /** Catégorie à assigner (sinon: skill.name) */
  category?: string;
  /** Timeout par défaut pour les handlers */
  timeoutMs?: number;
  /** Permissions override */
  permissions?: ToolDefinition["permissions"];
  /** Contexte à passer aux handlers */
  context?: any;
}
