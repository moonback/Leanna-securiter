/**
 * LegacyBridge — Pont de compatibilité avec l'ancien système
 * 
 * Permet au nouveau runtime de coexister avec l'ancien code pendant la migration.
 * Ce module expose les interfaces de l'ancien système (SkillManager, AgentOrchestrator)
 * mais route les appels vers le nouveau runtime.
 * 
 * Ce fichier sera supprimé une fois la migration complète.
 */

import type { AgentRuntime } from "../AgentRuntime.js";
import type { ToolRegistry } from "../ToolRegistry.js";
import type { ToolDefinition } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Adaptateur SkillManager → ToolRegistry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convertit un ancien Skill (format SkillManager) en ToolDefinitions pour le ToolRegistry.
 */
export function convertLegacySkill(skill: LegacySkill): ToolDefinition[] {
  return skill.declarations.map((decl) => ({
    declaration: {
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters ?? {},
    },
    handler: async (args: Record<string, unknown>) => {
      return skill.handleToolCall(decl.name, args);
    },
    category: skill.name,
    timeoutMs: 120_000, // Augmenté de 30s à 2 minutes pour les tâches complexes
  }));
}

/**
 * Enregistre toutes les skills legacy dans le nouveau ToolRegistry.
 */
export function registerLegacySkills(
  registry: ToolRegistry,
  skills: LegacySkill[]
): void {
  for (const skill of skills) {
    const definitions = convertLegacySkill(skill);
    registry.registerAll(definitions);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Adaptateur AgentOrchestrator → AgentRuntime
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Crée un proxy qui expose l'interface de l'ancien AgentOrchestrator
 * mais délègue au nouveau runtime.
 */
export function createOrchestratorProxy(runtime: AgentRuntime) {
  return {
    async delegateTask(params: {
      role: string;
      title: string;
      description: string;
      files?: string[];
      instructions?: string;
      priority?: string;
      timeoutMs?: number;
    }) {
      const task = await runtime.submit({
        agentId: params.role,
        title: params.title,
        description: params.description,
        files: params.files,
        instructions: params.instructions,
        priority: (params.priority ?? "medium") as any,
        timeoutMs: params.timeoutMs,
      });

      // Format compatible ancien système
      return {
        id: task.id,
        role: task.agentId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.state,
        context: { files: task.context.files, instructions: task.context.instructions },
        createdAt: new Date(task.createdAt).toISOString(),
        timeoutMs: task.timeoutMs,
      };
    },

    getTask(taskId: string) {
      const task = runtime.getTask(taskId);
      if (!task) return undefined;
      return {
        id: task.id,
        role: task.agentId,
        title: task.title,
        status: task.state,
        result: task.result,
      };
    },

    listTasks(filters?: { role?: string; status?: string; limit?: number }) {
      return runtime.listTasks({
        agentId: filters?.role,
        state: filters?.status as any,
        limit: filters?.limit,
      }).map((t) => ({
        id: t.id,
        role: t.agentId,
        title: t.title,
        status: t.state,
        createdAt: new Date(t.createdAt).toISOString(),
      }));
    },

    getStats() {
      return runtime.getStats();
    },

    setSkillHandler(_handler: (name: string, args: any) => Promise<any>) {
      // No-op dans le nouveau système — les outils sont enregistrés dans le ToolRegistry
      console.log("[LegacyBridge] setSkillHandler() appelé — ignoré (utiliser ToolRegistry.register)");
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Legacy (pour la conversion)
// ═══════════════════════════════════════════════════════════════════════════════

export interface LegacySkill {
  name: string;
  declarations: Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  }>;
  handleToolCall: (name: string, args: any) => Promise<any>;
}
