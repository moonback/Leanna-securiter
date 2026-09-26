/**
 * Tools Registry Status — Vue unifiée de tous les outils disponibles
 * 
 * Ce fichier résout les discordances entre :
 * - runtime.tools (ToolRegistry du nouveau système)
 * - skillManager.getToolDeclarations() (compatibilité legacy)
 * - MCP servers (outils externes)
 * 
 * Endpoint : GET /api/tools/registry
 */

import { Router, Request, Response } from 'express';

export interface ToolsRegistryStatus {
  /** Nombre total d'outils uniques disponibles */
  totalTools: number;
  /** Outils du ToolRegistry (nouveau système) */
  runtime: {
    count: number;
    tools: string[];
  };
  /** Outils déclarés par le SkillManager (legacy) */
  skillManager: {
    count: number;
    tools: string[];
  };
  /** Outils MCP externes */
  mcp: {
    count: number;
    servers: Array<{
      id: string;
      toolCount: number;
      tools: string[];
    }>;
  };
  /** Outils en doublon entre les sources */
  duplicates: {
    count: number;
    tools: string[];
  };
  /** Métadonnées de synchronisation */
  sync: {
    timestamp: string;
    runtimeToolsMatchSkillManager: boolean;
    allSourcesAligned: boolean;
  };
}

export function createToolsRegistryRouter(
  runtime?: any,
  skillManager?: any,
  mcpBridge?: any
): Router {
  const router = Router();

  router.get('/registry', async (_req: Request, res: Response) => {
    try {
      const timestamp = new Date().toISOString();
      
      // ── 1. Collecter les outils du Runtime (ToolRegistry) ─────────────────
      const runtimeTools: string[] = [];
      if (runtime?.tools) {
        const entries = runtime.tools.getDefinitions?.() || [];
        runtimeTools.push(...entries.map((d: any) => d.declaration?.name || d.name).filter(Boolean));
      }

      // ── 2. Collecter les outils du SkillManager (legacy) ─────────────────
      const skillManagerTools: string[] = [];
      if (skillManager?.getToolDeclarations) {
        const decls = skillManager.getToolDeclarations();
        skillManagerTools.push(...decls.map((d: any) => d.name).filter(Boolean));
      }

      // ── 3. Collecter les outils MCP ──────────────────────────────────────
      const mcpServers: Array<{ id: string; toolCount: number; tools: string[] }> = [];
      let mcpToolsCount = 0;

      if (mcpBridge?.getServers) {
        try {
          const servers = await mcpBridge.getServers();
          for (const server of servers) {
            if (server.tools && Array.isArray(server.tools)) {
              const toolNames = server.tools.map((t: any) => t.name).filter(Boolean);
              mcpServers.push({
                id: server.id,
                toolCount: toolNames.length,
                tools: toolNames,
              });
              mcpToolsCount += toolNames.length;
            }
          }
        } catch (e) {
          console.warn('[ToolsRegistry] Erreur lors de la récupération des outils MCP:', e);
        }
      }

      // ── 4. Détecter les doublons ─────────────────────────────────────────
      const allTools = new Set<string>([...runtimeTools, ...skillManagerTools]);
      const mcpToolsFlat = mcpServers.flatMap(s => s.tools);
      mcpToolsFlat.forEach(t => allTools.add(t));

      const duplicates: string[] = [];
      const seen = new Set<string>();
      const checkDuplicates = (toolList: string[], source: string) => {
        for (const tool of toolList) {
          if (seen.has(tool)) {
            if (!duplicates.includes(tool)) {
              duplicates.push(tool);
            }
          } else {
            seen.add(tool);
          }
        }
      };

      checkDuplicates(runtimeTools, 'runtime');
      checkDuplicates(skillManagerTools, 'skillManager');
      checkDuplicates(mcpToolsFlat, 'mcp');

      // ── 5. Vérifier l'alignement ─────────────────────────────────────────
      const runtimeSet = new Set(runtimeTools);
      const skillManagerSet = new Set(skillManagerTools);
      
      // Le runtime et skillManager devraient avoir les mêmes outils (ils partagent le ToolRegistry)
      const runtimeToolsMatchSkillManager = 
        runtimeTools.length === skillManagerTools.length &&
        runtimeTools.every(t => skillManagerSet.has(t)) &&
        skillManagerTools.every(t => runtimeSet.has(t));

      // Tous les systèmes sont alignés si runtime == skillManager et pas de doublons
      const allSourcesAligned = runtimeToolsMatchSkillManager && duplicates.length === 0;

      // ── 6. Construire la réponse ─────────────────────────────────────────
      const status: ToolsRegistryStatus = {
        totalTools: allTools.size,
        runtime: {
          count: runtimeTools.length,
          tools: runtimeTools.sort(),
        },
        skillManager: {
          count: skillManagerTools.length,
          tools: skillManagerTools.sort(),
        },
        mcp: {
          count: mcpToolsCount,
          servers: mcpServers,
        },
        duplicates: {
          count: duplicates.length,
          tools: duplicates.sort(),
        },
        sync: {
          timestamp,
          runtimeToolsMatchSkillManager,
          allSourcesAligned,
        },
      };

      res.json(status);
    } catch (e: any) {
      console.error('[ToolsRegistry] Erreur:', e);
      res.status(500).json({
        error: 'Erreur lors de la récupération du statut des outils',
        details: e.message,
      });
    }
  });

  // ── Endpoint de diagnostic simplifié ───────────────────────────────────
  router.get('/count', (_req: Request, res: Response) => {
    try {
      const runtimeCount = runtime?.tools?.size || 0;
      const skillManagerCount = skillManager?.getToolDeclarations?.()?.length || 0;
      const mcpCount = 0; // TODO: implement MCP count

      res.json({
        runtime: runtimeCount,
        skillManager: skillManagerCount,
        mcp: mcpCount,
        total: runtimeCount + mcpCount,
        aligned: runtimeCount === skillManagerCount,
      });
    } catch (e: any) {
      res.status(500).json({
        error: 'Erreur lors du comptage des outils',
        details: e.message,
      });
    }
  });

  return router;
}
