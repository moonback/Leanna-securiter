/**
 * ContextResolver — Résout la configuration runtime en PromptContext
 *
 * Le builder ne détermine plus lui-même le contexte : il délègue à ce
 * composant, qui normalise la config et déduit le taskType manquant.
 *
 * Point d'extension : le runtime peut injecter un taskType déjà classifié
 * via SystemPromptConfig, rendant le builder totalement déterministe.
 */

import type { SystemPromptConfig } from "./types.js";
import type { PromptContext, TaskType } from "./types/context.js";

// ═══════════════════════════════════════════════════════════════════════════════
// ContextResolver
// ═══════════════════════════════════════════════════════════════════════════════

export class ContextResolver {
  /**
   * Résout une SystemPromptConfig en PromptContext normalisé.
   *
   * Ordre de priorité pour taskType :
   *   1. config.taskType (fourni explicitement par le runtime/classifieur)
   *   2. Déduction depuis config.mode
   *   3. Valeur par défaut : "general"
   */
  resolve(config: SystemPromptConfig & { taskType?: TaskType } = {}): PromptContext {
    const mode = config.mode ?? "full";

    return {
      mode,
      taskType: this.resolveTaskType(config),

      aiName: config.aiName ?? "Leanna",
      userName: config.userName,
      userRole: config.userRole,

      workspace: config.workspace,

      agents: {
        enabled: config.agents?.enabled !== false, // activé par défaut
        allowedRoles: config.agents?.allowedRoles,
      },

      tools: {
        available: (config as any).tools?.available ?? [],
        enabled:   (config as any).tools?.enabled   ?? [],
      },

      language:      config.language,
      responseStyle: config.responseStyle,

      extraSections: config.extraSections?.map(s => ({
        id:      s.id,
        content: s.content,
        // Les extra sections n'ont pas de scope : elles sont toujours incluses
      })),
    };
  }

  // ─── Privé ────────────────────────────────────────────────────────────────

  private resolveTaskType(
    config: SystemPromptConfig & { taskType?: TaskType },
  ): TaskType {
    // 1. Fourni explicitement — le builder est alors totalement déterministe
    if (config.taskType) {
      return config.taskType;
    }

    // 2. Déduction depuis le mode
    if (config.mode === "ask") {
      return "document";
    }

    // 3. Défaut
    return "general";
  }
}
