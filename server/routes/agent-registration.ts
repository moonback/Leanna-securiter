/**
 * Route API pour l'enregistrement et la gestion des agents dynamiques.
 * Permet à l'Agent Builder d'enregistrer de nouveaux agents qui seront
 * disponibles pour la délégation et l'exécution.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { dynamicAgentRegistry } from '../agents/DynamicAgentRegistry.js';
import { agentRegistry } from '../agents/AgentRegistry.js';
import { getAgentDefinition, STATIC_AGENT_REGISTRY, listAgentDefinitions } from '../agents/roles.js';
import type { AgentRole } from '../agents/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger("AgentRegistrationAPI");

/**
 * Schéma de validation pour l'enregistrement d'un agent.
 * Doit contenir au minimum : role, name, description, systemPrompt, capabilities.
 */
interface RegisterAgentRequest {
  /** Rôle unique de l'agent (identifiant) */
  role: string;
  /** Nom affiché de l'agent */
  name: string;
  /** Description de l'agent */
  description: string;
  /** Instructions système pour l'agent */
  systemPrompt: string;
  /** Liste des capacités/outils auxquels l'agent a accès */
  capabilities: string[];
  /** Nombre max de tâches simultanées */
  maxConcurrency?: number;
  /** Timeout par défaut en ms */
  defaultTimeoutMs?: number;
  /** Version de l'agent */
  version?: string;
  /** Tags pour catégorisation */
  tags?: string[];
  /** Configuration de boucle autonome */
  loopConfig?: {
    maxIterations: number;
    minConfidenceScore: number;
  };
}

export function createAgentRegistrationRouter(): Router {
  const router = Router();

  /**
   * POST /api/agent-registration/register
   * Enregistre un nouvel agent dynamique.
   */
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const body = req.body as RegisterAgentRequest;

      // Validation minimale
      if (!body.role || !body.name || !body.description || !body.systemPrompt || !body.capabilities) {
        return res.status(400).json({
          error: "Champs manquants",
          required: ["role", "name", "description", "systemPrompt", "capabilities"],
        });
      }

      // Vérifier que le rôle n'existe pas déjà dans les agents statiques
      const existingStatic = getAgentDefinition(body.role);
      if (existingStatic) {
        return res.status(409).json({
          error: `Le rôle "${body.role}" est déjà utilisé par un agent statique`,
        });
      }

      // Vérifier que le rôle n'existe pas déjà dans les agents dynamiques
      if (dynamicAgentRegistry.hasAgent(body.role)) {
        return res.status(409).json({
          error: `Le rôle "${body.role}" est déjà enregistré comme agent dynamique`,
        });
      }

      // Valider le rôle (doit être un identifiant valide)
      const role = body.role.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(role)) {
        return res.status(400).json({
          error: "Le rôle doit commencer par une lettre minuscule et contenir uniquement des lettres minuscules, chiffres, underscores ou tirets (max 64 caractères)",
        });
      }

      // Créer la définition de l'agent
      const agentDefinition = {
        role: role as AgentRole,
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        capabilities: body.capabilities,
        maxConcurrency: body.maxConcurrency ?? 2,
        defaultTimeoutMs: body.defaultTimeoutMs ?? 60_000,
        version: body.version ?? "1.0.0",
        tags: body.tags ?? [],
        isActive: true,
        author: "agent-builder",
        createdAt: new Date().toISOString(),
      };

      // Enregistrer dans le registre dynamique
      dynamicAgentRegistry.registerAgent(agentDefinition);

      // Démarrer l'agent dans le AgentRegistry (s'il est déjà initialisé)
      if (agentRegistry.isReady) {
        const loopConfig = body.loopConfig ?? { maxIterations: 2, minConfidenceScore: 0.60 };
        agentRegistry.registerAndStartDynamicAgent(role, loopConfig);
      }

      log.info(`✅ Agent "${role}" enregistré et démarré`);

      return res.json({
        success: true,
        agent: {
          role,
          name: body.name,
          description: body.description,
          registeredAt: new Date().toISOString(),
        },
        message: `Agent "${role}" enregistré avec succès`,
      });
    } catch (err: any) {
      log.error(`Erreur lors de l'enregistrement de l'agent: ${err.message}`);
      return res.status(500).json({
        error: `Erreur lors de l'enregistrement: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/agent-registration/list
   * Liste tous les agents dynamiques enregistrés.
   */
  router.get('/list', (_req: Request, res: Response) => {
    try {
      const agents = dynamicAgentRegistry.getAllAgents();
      return res.json({
        success: true,
        agents: agents.map((a) => ({
          role: a.role,
          name: a.name,
          description: a.description,
          version: a.version,
          tags: a.tags,
          isActive: a.isActive,
          createdAt: a.createdAt,
          capabilities: a.capabilities,
        })),
      });
    } catch (err: any) {
      log.error(`Erreur lors de la liste des agents: ${err.message}`);
      return res.status(500).json({
        error: `Erreur lors de la liste: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/agent-registration/list/all
   * Liste tous les agents (statiques + dynamiques).
   */
  router.get('/list/all', (_req: Request, res: Response) => {
    try {
      const allAgents = listAgentDefinitions();
      
      return res.json({
        success: true,
        count: allAgents.length,
        agents: allAgents.map((a) => ({
          role: a.role,
          name: a.name,
          description: a.description,
          isStatic: a.role in STATIC_AGENT_REGISTRY,
          capabilities: a.capabilities,
          maxConcurrency: a.maxConcurrency,
          defaultTimeoutMs: a.defaultTimeoutMs,
        })),
      });
    } catch (err: any) {
      log.error(`Erreur lors de la liste complète: ${err.message}`);
      return res.status(500).json({
        error: `Erreur: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/agent-registration/check/:role
   * Vérifie si un agent (statique ou dynamique) existe.
   */
  router.get('/check/:role', (req: Request, res: Response) => {
    try {
      const { role } = req.params;
      const exists = dynamicAgentRegistry.hasAgent(role) || !!getAgentDefinition(role);
      
      return res.json({
        success: true,
        role,
        exists,
        isStatic: !!getAgentDefinition(role),
        isDynamic: dynamicAgentRegistry.hasAgent(role),
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err.message,
      });
    }
  });

  /**
   * DELETE /api/agent-registration/:role
   * Supprime un agent dynamique.
   */
  router.delete('/:role', (req: Request, res: Response) => {
    try {
      const { role } = req.params;

      // Ne pas supprimer les agents statiques
      if (getAgentDefinition(role)) {
        return res.status(400).json({
          error: `Impossible de supprimer un agent statique: ${role}`,
        });
      }

      // Arrêter l'agent dans le AgentRegistry
      if (agentRegistry.isReady) {
        agentRegistry.unregisterDynamicAgent(role);
      }

      // Supprimer du registre dynamique
      const deleted = dynamicAgentRegistry.unregisterAgent(role);

      if (!deleted) {
        return res.status(404).json({
          error: `Agent dynamique "${role}" non trouvé`,
        });
      }

      log.info(`🗑️ Agent dynamique "${role}" supprimé`);

      return res.json({
        success: true,
        message: `Agent "${role}" supprimé avec succès`,
      });
    } catch (err: any) {
      log.error(`Erreur lors de la suppression: ${err.message}`);
      return res.status(500).json({
        error: `Erreur: ${err.message}`,
      });
    }
  });

  /**
   * POST /api/agent-registration/:role/start
   * Démarre un agent dynamique déjà enregistré.
   */
  router.post('/:role/start', (req: Request, res: Response) => {
    try {
      const { role } = req.params;

      // Vérifier que l'agent existe
      if (!dynamicAgentRegistry.hasAgent(role)) {
        return res.status(404).json({
          error: `Agent "${role}" non trouvé dans les agents dynamiques`,
        });
      }

      // Démarrer l'agent
      if (!agentRegistry.isReady) {
        return res.status(503).json({
          error: "AgentRegistry non initialisé. Veuillez réessayer plus tard.",
        });
      }

      const loopConfig = req.body.loopConfig ?? { maxIterations: 2, minConfidenceScore: 0.60 };
      const started = agentRegistry.registerAndStartDynamicAgent(role, loopConfig);

      if (!started) {
        return res.status(409).json({
          error: `Agent "${role}" déjà démarré`,
        });
      }

      log.info(`✅ Agent dynamique "${role}" démarré`);

      return res.json({
        success: true,
        message: `Agent "${role}" démarré avec succès`,
      });
    } catch (err: any) {
      log.error(`Erreur lors du démarrage: ${err.message}`);
      return res.status(500).json({
        error: `Erreur: ${err.message}`,
      });
    }
  });

  /**
   * POST /api/agent-registration/:role/stop
   * Arrête un agent dynamique.
   */
  router.post('/:role/stop', (req: Request, res: Response) => {
    try {
      const { role } = req.params;

      if (!agentRegistry.isReady) {
        return res.status(503).json({
          error: "AgentRegistry non initialisé",
        });
      }

      const stopped = agentRegistry.unregisterDynamicAgent(role);

      if (!stopped) {
        return res.status(404).json({
          error: `Agent "${role}" non trouvé ou impossible à arrêter`,
        });
      }

      log.info(`🛑 Agent dynamique "${role}" arrêté`);

      return res.json({
        success: true,
        message: `Agent "${role}" arrêté avec succès`,
      });
    } catch (err: any) {
      log.error(`Erreur lors de l'arrêt: ${err.message}`);
      return res.status(500).json({
        error: `Erreur: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/agent-registration/stats
   * Statistiques des agents dynamiques.
   */
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = dynamicAgentRegistry.getStats();
      return res.json({
        success: true,
        ...stats,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err.message,
      });
    }
  });

  return router;
}
