/**
 * promptConfig.ts — Ré-exports pour compatibilité ascendante
 * 
 * Tous les types et constantes ont été centralisés dans server/runtime/prompts/types.ts
 * Ce fichier est conservé pour la compatibilité avec les imports existants.
 * 
 * @deprecated Utiliser directement les exports depuis server/runtime/prompts/types.ts
 */

// Ré-export des types avec 'export type' pour isolatedModules
export type {
  // Types de base
  ResponseStyle,
  Language,
  AssistantMode,
  PromptProfile,
  AgentRole,
  
  // Interfaces
  AgentsConfig,
  ProfileConfig,
  SystemPromptConfig,
} from "../runtime/prompts/types.js";

// Ré-export des constantes (non-types)
export {
  // Mappings
  LANG_INSTRUCTIONS,
  STYLE_INSTRUCTIONS,
  LANG_INSTRUCTIONS_FR,
  STYLE_INSTRUCTIONS_FR,
  
  // Informations sur les agents
  AGENT_ROLES_INFO,
  ALL_AGENT_ROLES,
} from "../runtime/prompts/types.js";
