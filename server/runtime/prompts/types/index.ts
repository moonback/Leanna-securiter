/**
 * types/index.ts — Barrel des types du policy compiler
 *
 * Importez depuis ce fichier plutôt que des sous-modules :
 *   import type { PromptRule, BuiltPrompt } from "./types/index.js";
 */

export type { RuleScope, PromptRule } from "./rules.js";
export { RulePriority } from "./rules.js";

export type { TaskType, PromptContext } from "./context.js";

export type { PromptSection, PromptConflict, BuiltPrompt } from "./builder.js";
