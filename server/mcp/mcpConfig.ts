/**
 * MCP Server Configuration Management
 * 
 * Gère la configuration persistante des serveurs MCP (Model Context Protocol).
 * Les configurations sont stockées dans .Leanna/mcp.json à la racine du workspace.
 * 
 * SECURITY NOTE:
 * MCP server commands are executed as subprocesses with the same privileges as the
 * Leanna server. Only configure MCP servers from trusted sources. The command and
 * args are passed to child_process.spawn() with shell enabled on Windows for .cmd
 * files. While arguments are passed as an array (which Node.js escapes properly),
 * malicious command values could still be dangerous. Always validate MCP server
 * configurations before adding them.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SELF_ROOT } from '../utils/selfRoot.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpServerConfig {
  /** Identifiant unique du serveur */
  id: string;
  /** Nom affiché */
  name: string;
  /** Type de transport: stdio (subprocess) ou sse (HTTP Server-Sent Events) */
  transport: 'stdio' | 'sse';
  /** Commande à exécuter (pour stdio) */
  command?: string;
  /** Arguments de la commande (pour stdio) */
  args?: string[];
  /** URL du endpoint SSE (pour sse) */
  url?: string;
  /** Variables d'environnement supplémentaires */
  env?: Record<string, string>;
  /** Serveur désactivé ? */
  disabled?: boolean;
  /** Outils auto-approuvés (pas de confirmation requise) */
  autoApprove?: string[];
  /** Description optionnelle */
  description?: string;
  /** Timeout en ms pour les requêtes JSON-RPC (défaut: 30000) */
  timeout?: number;
  /** Nombre max de tentatives de reconnexion automatique (défaut: 5, 0 = désactivé) */
  maxRetries?: number;
  /** Tags/catégories pour filtrage dans l'UI */
  tags?: string[];
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration File Management
// ═══════════════════════════════════════════════════════════════════════════════

function getConfigPath(): string {
  const configRoot = process.env.Leanna_CONFIG_PATH || process.env.ELECTRON_APP_PATH || SELF_ROOT;
  return path.join(configRoot, '.Leanna', 'mcp.json');
}

/**
 * Charge la configuration MCP depuis le fichier .Leanna/mcp.json
 */
export function loadMcpConfig(): McpConfigFile {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Assurer la structure minimale
      if (!parsed.mcpServers) parsed.mcpServers = {};
      // Ajouter les champs manquants basés sur la clé et la forme de la config
      for (const [key, config] of Object.entries(parsed.mcpServers)) {
        const c = config as McpServerConfig;
        c.id = key;
        // Inférer le nom si absent
        if (!c.name) c.name = key;
        // Inférer le transport si absent
        if (!c.transport) {
          if (c.command) c.transport = 'stdio';
          else if (c.url) c.transport = 'sse';
          else c.transport = 'stdio'; // défaut
        }
      }
      return parsed as McpConfigFile;
    }
  } catch (e) {
    console.error('[MCP Config] Erreur lecture config:', e);
  }
  return { mcpServers: {} };
}

/**
 * Sauvegarde la configuration MCP dans .Leanna/mcp.json
 */
export function saveMcpConfig(config: McpConfigFile): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  
  // Créer le dossier .Leanna si nécessaire
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Retirer les champs 'id' internes avant la sérialisation (la clé sert d'id)
  const toSave: any = { mcpServers: {} };
  for (const [key, serverConfig] of Object.entries(config.mcpServers)) {
    const { id, ...rest } = serverConfig;
    toSave.mcpServers[key] = rest;
  }

  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf-8');
  console.log(`[MCP Config] Configuration sauvegardée: ${Object.keys(config.mcpServers).length} serveur(s)`);
}

/**
 * Ajoute ou met à jour un serveur MCP dans la configuration
 */
export function upsertMcpServer(id: string, config: Omit<McpServerConfig, 'id'>): McpConfigFile {
  const current = loadMcpConfig();
  current.mcpServers[id] = { ...config, id };
  saveMcpConfig(current);
  return current;
}

/**
 * Supprime un serveur MCP de la configuration
 */
export function removeMcpServer(id: string): McpConfigFile {
  const current = loadMcpConfig();
  delete current.mcpServers[id];
  saveMcpConfig(current);
  return current;
}

/**
 * Liste tous les serveurs configurés
 */
export function listMcpServers(): McpServerConfig[] {
  const config = loadMcpConfig();
  return Object.values(config.mcpServers);
}
