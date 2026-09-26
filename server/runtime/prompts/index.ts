/**
 * Index des exports du module runtime/prompts
 *
 * Ce fichier centralise tous les exports publics du système de prompts.
 * Les exports sont groupés en trois couches :
 *
 *   1. Types legacy (types.ts)   — rétrocompatibilité totale
 *   2. Types du policy compiler  — types/index.ts
 *   3. Composants du pipeline    — ContextResolver, RuleRegistry, etc.
 *   4. Builder et helpers        — API publique principale
 *   5. Loader                    — chargement des .md
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Types legacy — exports inchangés pour la rétrocompatibilité
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  ResponseStyle,
  Language,
  AssistantMode,
  PromptProfile,
  AgentRole,
  AgentsConfig,
  ProfileConfig,
  SystemPromptConfig,
} from "./types.js";

export {
  LANG_INSTRUCTIONS,
  STYLE_INSTRUCTIONS,
  LANG_INSTRUCTIONS_FR,
  STYLE_INSTRUCTIONS_FR,
  AGENT_ROLES_INFO,
  ALL_AGENT_ROLES,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Types du policy compiler
// ═══════════════════════════════════════════════════════════════════════════════

// Règles
export type { RuleScope, PromptRule } from "./types/rules.js";
export { RulePriority }               from "./types/rules.js";

// Contexte
export type { TaskType, PromptContext } from "./types/context.js";

// Builder output
export type { PromptSection, PromptConflict, BuiltPrompt } from "./types/builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Composants du pipeline
// ═══════════════════════════════════════════════════════════════════════════════

export { ContextResolver }  from "./ContextResolver.js";
export { RuleRegistry }     from "./RuleRegistry.js";
export { ConflictResolver } from "./ConflictResolver.js";
export { SectionRegistry }  from "./SectionRegistry.js";
export { PromptCompiler }   from "./PromptCompiler.js";

// Règles core
export { CORE_RULES, SAFETY_RULES, AUTHORITY_RULES, RUNTIME_RULES, TASK_RULES,
         ROUTING_RULES, TOOLS_RULES, PROCEDURE_RULES, STYLE_RULES } from "./rules/core.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Builder et helpers — API publique principale
// ═══════════════════════════════════════════════════════════════════════════════

export {
  SystemPromptBuilder,
  getSystemPromptBuilder,
  buildSystemPrompt,
  buildSystemInstructionV3,
} from "./SystemPromptBuilder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Loader
// ═══════════════════════════════════════════════════════════════════════════════

export { loadPromptTemplates, loadPromptMeta, parseFrontMatter } from "./loader.js";
export type { ParsedFrontMatter } from "./loader.js";
