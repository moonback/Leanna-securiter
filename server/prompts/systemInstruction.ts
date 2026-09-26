/**
 * System Instruction — Point d'entrée de la construction du prompt système
 * 
 * Ce fichier est un pont vers le nouveau SystemPromptBuilder (server/runtime/prompts/).
 * Il conserve l'interface publique exacte pour la compatibilité avec server.ts et les routes.
 * 
 * Anciennement : 12 fichiers d'instructions assemblés ici.
 * Maintenant : délègue au SystemPromptBuilder qui utilise des fichiers .md.
 * 
 * Les types sont centralisés dans server/runtime/prompts/types.ts
 */

import { buildSystemPrompt } from "../runtime/prompts/SystemPromptBuilder.js";
import type { ProfileConfig, SystemPromptConfig } from "../runtime/prompts/types.js";

// Ré-export des types pour compatibilité ascendante
export type { ProfileConfig, SystemPromptConfig };
export { LANG_INSTRUCTIONS, STYLE_INSTRUCTIONS, AGENT_ROLES_INFO, ALL_AGENT_ROLES } from "../runtime/prompts/types.js";

// buildLifeInstruction est maintenant un no-op (le contenu est dans base.md)
export function buildLifeInstruction(): string {
  return "";
}

/**
 * Construit le prompt système complet.
 * Façade de compatibilité vers buildSystemPrompt.
 * 
 * @param profile - Configuration du profil utilisateur
 * @returns Le prompt système complet assemblé
 */
export function buildSystemInstruction(profile: ProfileConfig = {}): string {
  const extraSections = profile.customSystemPrompt
    ? [{ id: 'custom-user-prompt', content: `## Instructions personnalisées de l'utilisateur\n\n${profile.customSystemPrompt}` }]
    : undefined;

  // Convertir ProfileConfig en SystemPromptConfig pour le builder
  const builderConfig: SystemPromptConfig = {
    aiName: profile.aiName,
    userName: profile.userName,
    userRole: profile.userRole,
    language: profile.language,
    responseStyle: profile.responseStyle,
    compact: profile.compactPrompt,
    mode: profile.mode,
    agents: profile.agents,
    workspace: profile.workspace,
    extraSections,
  };

  return buildSystemPrompt(builderConfig);
}

/**
 * Façade V2 de compatibilité vers la source canonique.
 */
export function buildSystemInstructionV2(config: SystemPromptConfig = {}): string {
  return buildSystemPrompt(config);
}
