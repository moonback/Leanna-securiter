/**
 * MCP (Model Context Protocol) — Module d'intégration
 * 
 * Permet à Leanna de se connecter à n'importe quel serveur d'outils MCP
 * et d'exposer leurs outils à l'IA de manière transparente.
 * 
 * Usage:
 *   import { mcpBridge } from './server/mcp.js';
 *   await mcpBridge.initialize();
 *   skillManager.registerDynSkill(mcpBridge.toSkill(), 'mcp:bridge');
 */

export { McpClient, type McpClientStatus, type McpToolDefinition, type McpToolResult } from './McpClient.js';
export { McpBridge, mcpBridge, type McpServerStatus, type McpToolCallResult, type McpToolCallMetric } from './McpBridge.js';
export { 
  type McpServerConfig, 
  type McpConfigFile,
  loadMcpConfig, 
  saveMcpConfig, 
  upsertMcpServer, 
  removeMcpServer, 
  listMcpServers 
} from './mcpConfig.js';
