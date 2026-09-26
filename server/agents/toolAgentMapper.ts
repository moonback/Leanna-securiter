/**
 * Tool-Agent Mapper
 * 
 * Ce module fournit un mapping dynamique entre les outils (tools) et les agents,
 * basé sur les capabilities définies dans les rôles d'agents.
 * 
 * Il remplace le mapping statique TOOL_TO_AGENT de agentActivityStore.ts
 * par une approche basée sur les définitions centralisées dans roles.ts.
 */

import { getAgentDefinition, listAgentDefinitions } from './roles.js';
import type { AgentRole } from './types.js';
import type { ToolAttribution, ToolPermission } from '../runtime/types.js';

/**
 * Rôle neutre pour les outils exécutables non rattachés à un agent spécialisé.
 * Doit rester synchronisé avec `UNATTRIBUTED_ROLE` côté renderer
 * (src/stores/agentActivityStore.ts). Ne JAMAIS retomber sur 'writer' : cela
 * attribue faussement des primitives système (browser, telegram, exec…) au
 * Rédacteur et corrompt la télémétrie agentique.
 */
export const UNATTRIBUTED_ROLE: AgentRole = 'system';

/**
 * Rôle d'affichage pour une attribution PAR CATÉGORIE (ensemble d'agents).
 *
 * Un outil comme `search_in_files` appartient légitimement à plusieurs agents
 * (debugger, reviewer, architect, security, tester, refactor). Le désigner
 * comme un propriétaire unique « probable » serait un mensonge d'observabilité.
 * On l'affiche donc comme « plusieurs agents » : l'ensemble réel reste
 * disponible via `getAgentsForTool()`. Doit rester synchronisé avec
 * `MULTI_ROLE` côté renderer (src/stores/agentActivityStore.ts).
 */
export const MULTI_ROLE: AgentRole = 'multi';

// ═══════════════════════════════════════════════════════════════════════════════
// Cache pour le mapping outil → rôle(s)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mapping dynamique outil → rôle(s) d'agent(s)
 * Généré à partir des capabilities des agents définis dans roles.ts
 */
let toolToAgentsCache: Map<string, AgentRole[]> = new Map();

/**
 * Mapping outil → rôle principal (pour compatibilité avec l'ancien système)
 * Chaque outil est associé au premier rôle d'agent qui le supporte
 */
let toolToPrimaryAgentCache: Map<string, AgentRole> = new Map();

/**
 * Attribution explicite déclarée par le ToolRegistry (source de vérité).
 * Renseignée via `applyToolRegistryAttribution()`. Quand un outil y figure,
 * son attribution PRIME sur le mapping dérivé des capabilities de rôle.
 *
 * - `preferred` : rôle principal affiché (télémétrie/audit).
 * - `allowed`   : rôles autorisés (superset du principal).
 */
let toolAttributionCache: Map<string, { preferred: AgentRole; allowed: AgentRole[] }> = new Map();

/**
 * Forme minimale d'une définition d'outil consommée par le mapper.
 * Structurellement compatible avec `ToolDefinition` (server/runtime/types.ts),
 * de sorte que `runtime.tools.getDefinitions()` soit accepté directement.
 */
export interface ToolAttributionInput {
  declaration: { name: string };
  attribution?: ToolAttribution;
}

/**
 * Enregistre l'attribution explicite portée par les définitions du ToolRegistry.
 *
 * Le ToolRegistry devient ainsi la source unique de vérité pour l'attribution :
 * tout outil qui déclare `attribution.preferredAgent` (ou un premier
 * `allowedAgents`) sera rattaché à ce rôle, indépendamment des capabilities
 * déclarées sur les rôles. Les outils sans attribution conservent le
 * comportement historique (mapping par capability puis rôle neutre).
 *
 * Idempotent : recalcule intégralement le cache d'attribution à chaque appel.
 * À appeler après le démarrage du runtime (tous les tools enregistrés).
 *
 * @param definitions - Définitions d'outils (typiquement `runtime.tools.getDefinitions()`).
 */
export function applyToolRegistryAttribution(definitions: ToolAttributionInput[]): void {
  toolAttributionCache = new Map();

  // Socle : attributions explicites des outils sensibles. Elles garantissent
  // qu'un outil à fort impact (sécurité, exécution shell, suppression, tests)
  // ne sera JAMAIS attribué par l'heuristique de catégorie (priorité 3). Un
  // outil qui déclare sa propre `attribution` côté ToolRegistry écrase ce
  // socle (boucle ci-dessous), qui reste donc un défaut sûr, pas un verrou.
  for (const [tool, spec] of Object.entries(SENSITIVE_TOOL_ATTRIBUTION)) {
    toolAttributionCache.set(tool, {
      preferred: spec.preferred,
      allowed: spec.allowed ?? [spec.preferred],
    });
  }

  for (const def of definitions) {
    const attr = def.attribution;
    if (!attr) continue;
    const allowed = (attr.allowedAgents ?? []).filter(Boolean) as AgentRole[];
    const preferred = (attr.preferredAgent ?? allowed[0]) as AgentRole | undefined;
    if (!preferred) continue;
    toolAttributionCache.set(def.declaration.name, {
      preferred,
      allowed: allowed.length > 0 ? allowed : [preferred],
    });
  }
}

/**
 * Estampille l'AUTORISATION par agent (chantier C) sur les définitions d'outils
 * sensibles, à partir de `SENSITIVE_TOOL_ATTRIBUTION`.
 *
 * Contrairement à `applyToolRegistryAttribution` (qui alimente un cache
 * d'AFFICHAGE consulté par le renderer), cette fonction écrit directement
 * `attribution.allowedAgents` + `attribution.risk` sur la `ToolDefinition`
 * vivante du ToolRegistry. C'est cette métadonnée que `PermissionPolicy.enforce`
 * lit à l'exécution pour refuser un agent hors liste sur un outil à risque.
 *
 * Règle de non-régression : on NE surcharge PAS une attribution déjà déclarée
 * par l'outil lui-même (un outil qui définit explicitement `allowedAgents`/`risk`
 * reste maître de sa politique). On ne fait que renseigner ce qui manque, à
 * partir du socle sensible.
 *
 * Idempotent. À appeler au démarrage, après l'enregistrement de tous les outils.
 *
 * @param definitions - Définitions vivantes (typiquement `runtime.tools.getDefinitions()`).
 * @returns Le nombre d'outils effectivement estampillés (pour le log de boot).
 */
export function applyRuntimeAgentAuthorization(definitions: ToolAttributionInput[]): number {
  let stamped = 0;
  for (const def of definitions) {
    const spec = SENSITIVE_TOOL_ATTRIBUTION[def.declaration.name];
    if (!spec) continue;

    const current: ToolAttribution = def.attribution ?? {};
    const allowedAgents =
      current.allowedAgents && current.allowedAgents.length > 0
        ? current.allowedAgents
        : (spec.allowed ?? [spec.preferred]);
    const risk = current.risk ?? spec.risk;

    def.attribution = {
      ...current,
      allowedAgents,
      preferredAgent: current.preferredAgent ?? spec.preferred,
      ...(risk ? { risk } : {}),
    };
    stamped++;
  }
  return stamped;
}

/**
 * Attribution explicite des outils sensibles (B2).
 *
 * Ces outils ont un impact fort (audit sécurité, exécution shell, tests,
 * suppression, push git). Une attribution *heuristique* par catégorie serait
 * dangereuse pour l'observabilité (ex: `security_audit` classé comme un simple
 * outil d'analyse générique). On fixe donc ici leur agent responsable, avec
 * priorité 1 (explicite). Ce socle est appliqué avant toute attribution
 * déclarée par le ToolRegistry, qui peut le surcharger si besoin.
 */
const SENSITIVE_TOOL_ATTRIBUTION: Record<
  string,
  { preferred: AgentRole; allowed?: AgentRole[]; risk?: ToolPermission }
> = {
  // Sécurité — jamais présenté comme un rôle générique.
  security_audit: { preferred: 'security', allowed: ['security', 'reviewer'], risk: 'exec' },
  // Tests & vérification — pilotés par le testeur/débogueur.
  run_tests: { preferred: 'tester', allowed: ['tester', 'debugger', 'coder'], risk: 'exec' },
  verify_full: { preferred: 'tester', allowed: ['tester', 'reviewer', 'debugger'], risk: 'exec' },
  verify_typecheck: { preferred: 'tester', allowed: ['tester', 'coder', 'debugger'], risk: 'exec' },
  verify_lint: { preferred: 'tester', allowed: ['tester', 'reviewer', 'coder'], risk: 'exec' },
  verify_file: { preferred: 'tester', allowed: ['tester', 'coder', 'debugger'], risk: 'exec' },
  // Exécution shell — attribuée au développeur (contexte d'exécution projet).
  run_project_command: { preferred: 'coder', allowed: ['coder', 'tester', 'debugger'], risk: 'exec' },
  system_execute_command: { preferred: 'coder', allowed: ['coder', 'tester'], risk: 'exec' },
  // Opérations destructrices — développeur, jamais deviné.
  delete_project_file: { preferred: 'coder', allowed: ['coder', 'refactor'], risk: 'dangerous' },
  delete_project_folder: { preferred: 'coder', allowed: ['coder', 'refactor'], risk: 'dangerous' },
  // Push distant — impact hors machine.
  git_push: { preferred: 'coder', allowed: ['coder'], risk: 'dangerous' },
};

/**
 * Indique si le cache a été initialisé
 */
let isInitialized = false;

// ═══════════════════════════════════════════════════════════════════════════════
// Catégories d'outils pour classification sémantique
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Catégories d'outils pour une classification sémantique.
 * Chaque catégorie regroupe des outils similaires et est associée à des rôles d'agents typiques.
 * 
 * Ces catégories sont utilisées pour :
 * 1. L'auto-complétion et la découverte d'outils
 * 2. Le routing intelligent des requêtes
 * 3. La spécialisation des agents
 */
export const TOOL_CATEGORIES: Record<string, { 
  label: string; 
  description: string; 
  typicalRoles: AgentRole[]; 
  keywords: string[]; 
}> = {
  // Catégories Code & Ingénierie
  file_operations: {
    label: 'Opérations sur fichiers',
    description: 'Lecture, écriture, modification et gestion de fichiers projet',
    typicalRoles: ['coder', 'refactor', 'debugger', 'writer', 'formatter', 'architect'],
    keywords: ['file', 'fichier', 'read', 'write', 'modify', 'patch', 'create', 'delete', 'rename'],
  },
  code_analysis: {
    label: 'Analyse de code',
    description: 'Analyse statique, vérification de syntaxe et de types',
    typicalRoles: ['reviewer', 'security', 'architect', 'debugger'],
    keywords: ['analyze', 'verify', 'lint', 'typecheck', 'check', 'review', 'audit'],
  },
  code_search: {
    label: 'Recherche dans le code',
    description: 'Recherche de motifs, navigation dans la codebase',
    typicalRoles: ['researcher', 'debugger', 'reviewer', 'architect'],
    keywords: ['search', 'find', 'grep', 'locate', 'explore', 'navigate'],
  },
  version_control: {
    label: 'Contrôle de version',
    description: 'Opérations Git et gestion de versions',
    typicalRoles: ['coder', 'writer'],
    keywords: ['git', 'commit', 'push', 'pull', 'branch', 'merge', 'diff', 'status'],
  },
  
  // Catégories Connaissance & Mémoire
  knowledge: {
    label: 'Connaissance et mémoire projet',
    description: 'Gestion de la mémoire persistante et analyse d\'impact',
    typicalRoles: ['researcher', 'planner', 'architect', 'coder'],
    keywords: ['knowledge', 'memory', 'context', 'impact', 'semantic', 'entity', 'graph'],
  },
  
  // Catégories Qualité & Tests
  testing: {
    label: 'Tests et validation',
    description: 'Exécution de tests et validation de qualité',
    typicalRoles: ['tester', 'reviewer', 'security', 'debugger'],
    keywords: ['test', 'verify', 'validate', 'lint', 'build', 'compile', 'check'],
  },
  
  // Catégories Rédaction & Documentation
  documentation: {
    label: 'Rédaction et documentation',
    description: 'Création et modification de documents',
    typicalRoles: ['writer', 'formatter', 'proofreader', 'translator', 'summarizer'],
    keywords: ['write', 'document', 'format', 'proofread', 'translate', 'summarize'],
  },
  
  // Catégories Recherche & Analyse
  research: {
    label: 'Recherche et analyse',
    description: 'Collecte d\'informations et analyse technique',
    typicalRoles: ['researcher', 'architect', 'planner'],
    keywords: ['research', 'analyze', 'collect', 'synthesize', 'understand', 'impact'],
  },
  
  // Catégories Planification & Orchestration
  planning: {
    label: 'Planification et orchestration',
    description: 'Création de plans et orchestration multi-agents',
    typicalRoles: ['planner', 'architect'],
    keywords: ['plan', 'orchestrate', 'delegate', 'mission', 'task', 'strategy'],
  },
  
  // Catégories Système & Automatisation
  system: {
    label: 'Opérations système',
    description: 'Exécution de commandes système et notifications',
    typicalRoles: ['coder', 'writer'],
    keywords: ['system', 'execute', 'command', 'notify', 'open', 'process'],
  },
  
  // Catégories Automatisation & Vision
  automation: {
    label: 'Automatisation et interaction',
    description: 'Navigation web, capture d\'écran et interaction automatisée',
    typicalRoles: ['researcher', 'vision'],
    keywords: ['automation', 'browser', 'navigate', 'click', 'screenshot', 'inspect', 'extract'],
  },
  vision: {
    label: 'Analyse visuelle',
    description: 'Analyse de captures d\'écran et perception visuelle',
    typicalRoles: ['vision'],
    keywords: ['vision', 'screenshot', 'analyze', 'visual', 'image', 'detect', 'perceive'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Initialisation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialise le mapping outil → agent à partir des définitions d'agents.
 * Doit être appelé au démarrage de l'application.
 */
export function initializeToolAgentMapper(): void {
  if (isInitialized) return;
  
  const agents = listAgentDefinitions();
  
  // Réinitialiser les caches
  toolToAgentsCache = new Map();
  toolToPrimaryAgentCache = new Map();
  
  // Pour chaque agent, enregistrer ses capabilities
  for (const agent of agents) {
    const role = agent.role;
    
    for (const capability of agent.capabilities) {
      // Ajouter le rôle à la liste des agents capables d'utiliser cet outil
      if (!toolToAgentsCache.has(capability)) {
        toolToAgentsCache.set(capability, []);
      }
      
      const rolesForTool = toolToAgentsCache.get(capability)!;
      
      // Éviter les doublons
      if (!rolesForTool.includes(role)) {
        rolesForTool.push(role);
      }
      
      // Si c'est le premier rôle pour cet outil, le définir comme rôle principal
      if (!toolToPrimaryAgentCache.has(capability)) {
        toolToPrimaryAgentCache.set(capability, role);
      }
    }
  }
  
  isInitialized = true;
  console.log(`[ToolAgentMapper] Mapping initialisé: ${toolToAgentsCache.size} outils mappés vers ${agents.length} agents`);
}

/**
 * Résolution sémantique par catégorie (priorité 3).
 *
 * Quand un outil n'a NI attribution explicite (ToolRegistry) NI capability de
 * rôle, on tente de le rattacher à un agent plausible via sa catégorie
 * sémantique (TOOL_CATEGORIES + getToolCategory). L'agent retenu est le
 * premier `typicalRoles` de la catégorie détectée.
 *
 * C'est une HEURISTIQUE assumée : elle produit une attribution *probable*, pas
 * *certaine*. Elle est infiniment préférable au rôle neutre `system` pour
 * l'observabilité (un outil `git_*` remonte comme "coder" plutôt que comme
 * "Exécution système"), mais elle NE DOIT PAS s'appliquer aux outils
 * sensibles : ceux-ci portent une attribution explicite (priorité 1) qui la
 * court-circuite. Retourne `undefined` si aucune catégorie ne matche.
 */
function getCategoryRolesForTool(tool: string): AgentRole[] | undefined {
  const category = getToolCategory(tool);
  if (!category) return undefined;
  const roles = TOOL_CATEGORIES[category]?.typicalRoles;
  if (!roles || roles.length === 0) return undefined;
  return [...roles];
}

/**
 * Obtient tous les rôles d'agents capables d'utiliser un outil donné.
 * 
 * @param tool - Le nom de l'outil
 * @returns Tableau des rôles d'agents (peut être vide si l'outil n'est pas trouvé)
 */
export function getAgentsForTool(tool: string): AgentRole[] {
  if (!isInitialized) {
    initializeToolAgentMapper();
  }
  
  // Priorité 1 : attribution explicite du ToolRegistry (source de vérité).
  const explicit = toolAttributionCache.get(tool);
  if (explicit) {
    return [...explicit.allowed];
  }
  
  // Priorité 2 : mapping dérivé des capabilities de rôle.
  const byCapability = toolToAgentsCache.get(tool);
  if (byCapability && byCapability.length > 0) {
    return [...byCapability];
  }

  // Priorité 3 : attribution sémantique par catégorie (heuristique).
  return getCategoryRolesForTool(tool) ?? [];
}

/**
 * Obtient le rôle d'agent principal pour un outil donné.
 * Utilisé pour la compatibilité avec le système existant.
 * 
 * @param tool - Le nom de l'outil
 * @returns Le rôle principal, ou le rôle neutre `UNATTRIBUTED_ROLE` en fallback
 */
export function getPrimaryAgentForTool(tool: string): AgentRole {
  if (!isInitialized) {
    initializeToolAgentMapper();
  }
  
  // Priorité 1 : attribution explicite du ToolRegistry (source de vérité).
  const explicit = toolAttributionCache.get(tool);
  if (explicit) {
    return explicit.preferred;
  }
  
  // Priorité 2 : mapping dérivé des capabilities de rôle.
  const byCapability = toolToPrimaryAgentCache.get(tool);
  if (byCapability) {
    return byCapability;
  }

  // Priorité 3 : attribution sémantique par catégorie (ENSEMBLE d'agents).
  // On NE choisit PAS un propriétaire unique : l'outil appartient à plusieurs
  // agents. On renvoie le rôle d'affichage `multi` (« plusieurs agents »),
  // l'ensemble réel restant accessible via getAgentsForTool().
  const byCategory = getCategoryRolesForTool(tool);
  if (byCategory && byCategory.length > 0) {
    return byCategory.length === 1 ? byCategory[0] : MULTI_ROLE;
  }

  // Dernier recours : rôle neutre. On ne ment jamais sur l'agent.
  return UNATTRIBUTED_ROLE;
}

/**
 * Indique comment un outil a été attribué à un rôle. Sert à distinguer une
 * attribution *certaine* (explicite/capability) d'une attribution *probable*
 * (catégorie) et d'une absence d'attribution (system), pour une télémétrie
 * honnête côté UI et diagnostic.
 */
export type AttributionSource = 'explicit' | 'capability' | 'category' | 'unattributed';

/**
 * Résout l'attribution d'un outil ET sa provenance, sans effet de bord.
 * Reflète exactement la cascade de priorités de `getPrimaryAgentForTool`.
 */
export function resolveToolAttribution(tool: string): { role: AgentRole; source: AttributionSource } {
  if (!isInitialized) {
    initializeToolAgentMapper();
  }
  const explicit = toolAttributionCache.get(tool);
  if (explicit) return { role: explicit.preferred, source: 'explicit' };

  const byCapability = toolToPrimaryAgentCache.get(tool);
  if (byCapability) return { role: byCapability, source: 'capability' };

  const byCategory = getCategoryRolesForTool(tool);
  if (byCategory && byCategory.length > 0) return { role: byCategory[0], source: 'category' };

  return { role: UNATTRIBUTED_ROLE, source: 'unattributed' };
}

/**
 * Retourne la liste des outils portant une attribution explicite via le
 * ToolRegistry (renseignée par `applyToolRegistryAttribution`). Utilisé par
 * l'endpoint de mapping pour exposer aussi les outils attribués qui ne sont
 * déclarés comme capability d'aucun rôle.
 */
export function getExplicitlyAttributedTools(): string[] {
  return [...toolAttributionCache.keys()];
}

/**
 * Vérifie si un rôle d'agent peut utiliser un outil donné.
 * 
 * @param role - Le rôle de l'agent
 * @param tool - Le nom de l'outil
 * @returns true si l'agent peut utiliser l'outil
 */
export function canAgentUseTool(role: AgentRole, tool: string): boolean {
  const definition = getAgentDefinition(role);
  if (!definition) return false;
  
  return definition.capabilities.includes(tool);
}

/**
 * Obtient la catégorie d'un outil à partir de son nom.
 * 
 * @param tool - Le nom de l'outil
 * @returns La catégorie correspondante ou undefined
 */
export function getToolCategory(tool: string): string | undefined {
  for (const [category, config] of Object.entries(TOOL_CATEGORIES)) {
    if (config.keywords.some(keyword => tool.toLowerCase().includes(keyword.toLowerCase()))) {
      return category;
    }
  }
  return undefined;
}

/**
 * Obtient toutes les catégories disponibles.
 */
export function getAllToolCategories(): typeof TOOL_CATEGORIES {
  return { ...TOOL_CATEGORIES };
}

/**
 * Obtient tous les outils disponibles pour un rôle d'agent donné.
 * 
 * @param role - Le rôle de l'agent
 * @returns Tableau des outils disponibles
 */
export function getToolsForAgent(role: AgentRole): string[] {
  const definition = getAgentDefinition(role);
  return definition ? [...definition.capabilities] : [];
}

/**
 * Obtient les rôles d'agents recommandés pour une catégorie d'outil donnée.
 * 
 * @param category - La catégorie d'outil
 * @returns Tableau des rôles d'agents recommandés
 */
export function getRecommendedRolesForCategory(category: string): AgentRole[] {
  const config = TOOL_CATEGORIES[category];
  return config ? [...config.typicalRoles] : [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export {
  toolToAgentsCache,
  toolToPrimaryAgentCache,
  isInitialized,
};
