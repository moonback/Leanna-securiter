/**
 * Routes API pour la persistance des agents personnalisés dans .Leanna/custom-agents.json
 * et leur enregistrement dans le DynamicAgentRegistry pour exécution.
 */

import type { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { dynamicAgentRegistry } from "../agents/DynamicAgentRegistry.js";
import { agentRegistry } from "../agents/AgentRegistry.js";
import { getAgentDefinition } from "../agents/roles.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("CustomAgentsAPI");

// ── Schémas de validation ────────────────────────────────────────────────────

/** Schéma d'un agent personnalisé à créer */
const AgentDraftSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  role: z.string().min(1, "Le rôle est requis").regex(/^[a-zA-Z0-9_-]+$/, "Le rôle ne peut contenir que des lettres, chiffres, tirets et underscores"),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  defaultTimeoutMs: z.number().int().min(1000).max(600_000).optional(),
  triggerKeywords: z.array(z.string()).optional(),
});

/** Schéma de mise à jour partielle d'un agent (toutes les clés sont optionnelles) */
const AgentUpdateSchema = AgentDraftSchema.partial().strict();

/** Schéma d'import d'agents en masse */
const AgentImportSchema = z.object({
  agents: z.array(z.object({
    name: z.string().min(1),
    role: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  }).passthrough()),
});

function getAgentsFilePath(): string {
  return path.join(SELF_ROOT, ".Leanna", "custom-agents.json");
}

function ensureDir() {
  const dir = path.join(SELF_ROOT, ".Leanna");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readAgents(): any[] {
  const filePath = getAgentsFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAgents(agents: any[]) {
  ensureDir();
  fs.writeFileSync(getAgentsFilePath(), JSON.stringify(agents, null, 2), "utf-8");
}

/**
 * Charge et enregistre tous les agents personnalisés au démarrage.
 * Doit être appelé après l'initialisation du AgentRegistry.
 */
export function initCustomAgents(): void {
  try {
    const agents = readAgents();
    let registeredCount = 0;
    
    for (const agent of agents) {
      if (!agent?.name || !agent?.role) continue;
      
      // Vérifier que le rôle n'existe pas déjà dans les statiques
      if (getAgentDefinition(agent.role)) {
        log.warn(`⚠️ Agent personnalisé "${agent.role}" ignoré : rôle statique existant`);
        continue;
      }
      
      // Vérifier que l'agent n'est pas déjà enregistré
      if (dynamicAgentRegistry.hasAgent(agent.role)) {
        continue;
      }
      
      // Enregistrer dans le registre dynamique
      dynamicAgentRegistry.registerAgent({
        role: agent.role,
        name: agent.name,
        description: agent.description || '',
        systemPrompt: agent.systemPrompt || '',
        capabilities: agent.capabilities || agent.tools || [],
        maxConcurrency: agent.maxConcurrency ?? 2,
        defaultTimeoutMs: agent.defaultTimeoutMs ?? 60_000,
        version: "1.0.0",
        tags: agent.triggerKeywords || [],
        isActive: true,
        author: "agent-builder",
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      });
      
      // Démarrer l'agent si le AgentRegistry est initialisé
      if (agentRegistry.isReady) {
        agentRegistry.registerAndStartDynamicAgent(agent.role);
      }
      
      registeredCount++;
    }
    
    if (registeredCount > 0) {
      log.info(`✅ ${registeredCount} agent(s) personnalisé(s) chargé(s) et enregistré(s)`);
    }
  } catch (err: any) {
    log.error(`⚠️ Erreur lors du chargement des agents personnalisés: ${err.message}`);
  }
}

/** GET /api/custom-agents — Liste tous les agents */
export function handleListAgents(_req: Request, res: Response): void {
  try {
    const agents = readAgents();
    res.json({ success: true, agents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/custom-agents — Créer un nouvel agent */
export function handleCreateAgent(req: Request, res: Response): void {
  try {
    const parsed = AgentDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Corps de requête invalide.",
        details: parsed.error.errors.map((e) => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
      return;
    }
    const draft = parsed.data;
    
    // Vérifier que le rôle n'existe pas déjà dans les agents statiques
    if (getAgentDefinition(draft.role)) {
      res.status(409).json({
        error: `Le rôle "${draft.role}" est déjà utilisé par un agent statique`,
      });
      return;
    }
    
    // Vérifier que le rôle n'existe pas déjà dans les agents dynamiques
    if (dynamicAgentRegistry.hasAgent(draft.role)) {
      res.status(409).json({
        error: `Le rôle "${draft.role}" est déjà enregistré comme agent personnalisé`,
      });
      return;
    }
    
    const agents = readAgents();
    const now = new Date().toISOString();
    const agent = {
      ...draft,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    agents.push(agent);
    writeAgents(agents);
    
    // Enregistrer l'agent dans le registre dynamique
    try {
      dynamicAgentRegistry.registerAgent({
        role: draft.role,
        name: draft.name,
        description: draft.description || '',
        systemPrompt: draft.systemPrompt || '',
        capabilities: draft.capabilities || draft.tools || [],
        maxConcurrency: draft.maxConcurrency ?? 2,
        defaultTimeoutMs: draft.defaultTimeoutMs ?? 60_000,
        version: "1.0.0",
        tags: draft.triggerKeywords || [],
        isActive: true,
        author: "agent-builder",
      });
      
      // Démarrer l'agent si le AgentRegistry est initialisé
      if (agentRegistry.isReady) {
        agentRegistry.registerAndStartDynamicAgent(draft.role);
      }
      
      log.info(`✅ Agent personnalisé "${draft.role}" créé et enregistré`);
    } catch (registerErr: any) {
      log.error(`⚠️ Erreur lors de l'enregistrement dynamique de "${draft.role}": ${registerErr.message}`);
      // Ne pas échouer la création, mais logger l'erreur
    }
    
    res.json({ success: true, agent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/** PUT /api/custom-agents/:id — Mettre à jour un agent */
export function handleUpdateAgent(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    const parsed = AgentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Corps de requête invalide.",
        details: parsed.error.errors.map((e) => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
      return;
    }
    const updates = parsed.data;
    const agents = readAgents();
    const idx = agents.findIndex((a: any) => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: "Agent non trouvé" });
      return;
    }

    agents[idx] = { ...agents[idx], ...updates, updatedAt: new Date().toISOString() };
    writeAgents(agents);
    res.json({ success: true, agent: agents[idx] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/** DELETE /api/custom-agents/:id — Supprimer un agent */
export function handleDeleteAgent(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    let agents = readAgents();
    const idx = agents.findIndex((a: any) => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: "Agent non trouvé" });
      return;
    }
    
    const agentToDelete = agents[idx];
    const role = agentToDelete?.role;
    
    agents = agents.filter((a: any) => a.id !== id);
    writeAgents(agents);
    
    // Désenregistrer l'agent du registre dynamique
    if (role && !getAgentDefinition(role)) {
      try {
        dynamicAgentRegistry.unregisterAgent(role);
        
        // Arrêter l'agent dans le AgentRegistry
        if (agentRegistry.isReady) {
          agentRegistry.unregisterDynamicAgent(role);
        }
        
        log.info(`🗑️ Agent personnalisé "${role}" supprimé et désenregistré`);
      } catch (unregisterErr: any) {
        log.error(`⚠️ Erreur lors du désenregistrement de "${role}": ${unregisterErr.message}`);
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/custom-agents/import — Importer des agents depuis JSON */
export function handleImportAgents(req: Request, res: Response): void {
  try {
    const parsed = AgentImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Format invalide, attendu { agents: [...] }",
        details: parsed.error.errors.map((e) => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
      return;
    }
    const imported = parsed.data.agents;

    const agents = readAgents();
    let count = 0;
    const now = new Date().toISOString();
    
    for (const item of imported) {
      if (item?.name && item?.role) {
        // Vérifier que le rôle n'existe pas déjà (statique ou dynamique)
        if (getAgentDefinition(item.role)) {
          log.warn(`⚠️ Impossible d'importer l'agent "${item.role}" : rôle déjà utilisé par un agent statique`);
          continue;
        }
        
        if (dynamicAgentRegistry.hasAgent(item.role)) {
          log.warn(`⚠️ Impossible d'importer l'agent "${item.role}" : rôle déjà enregistré`);
          continue;
        }
        
        agents.push({
          ...item,
          id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${count}`,
          createdAt: now,
          updatedAt: now,
        });
        
        // Enregistrer dans le registre dynamique
        try {
          const anyItem = item as any;
          dynamicAgentRegistry.registerAgent({
            role: item.role,
            name: item.name,
            description: anyItem.description || '',
            systemPrompt: anyItem.systemPrompt || '',
            capabilities: anyItem.capabilities || anyItem.tools || [],
            maxConcurrency: anyItem.maxConcurrency ?? 2,
            defaultTimeoutMs: anyItem.defaultTimeoutMs ?? 60_000,
            version: "1.0.0",
            tags: anyItem.triggerKeywords || [],
            isActive: true,
            author: "agent-builder",
          });
          
          // Démarrer l'agent si le AgentRegistry est initialisé
          if (agentRegistry.isReady) {
            agentRegistry.registerAndStartDynamicAgent(item.role);
          }
          
          log.info(`✅ Agent importé "${item.role}" enregistré`);
        } catch (registerErr: any) {
          log.error(`⚠️ Erreur lors de l'enregistrement de "${item.role}": ${registerErr.message}`);
        }
        
        count++;
      }
    }
    
    writeAgents(agents);
    res.json({ success: true, count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
