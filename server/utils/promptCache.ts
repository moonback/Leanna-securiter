/**
 * Prompt Cache — Mécanisme de cache pour les system prompts
 * 
 * Ce module permet de marquer les parties statiques des prompts comme cache-ables
 * pour réduire la consommation de tokens avec les modèles qui supportent le prompt caching
 * (Claude, GPT-4, Gemini, etc.)
 * 
 * Principe :
 * - BASE_SYSTEM_PROMPT est identique pour tous les agents → cache global
 * - Chaque agent a un bloc spécifique statique (missions, règles, etc.) → cache par rôle
 * - Les parties dynamiques (contexte de tâche, fichiers, etc.) ne sont jamais cachées
 * 
 * Format du cache : Map<cacheKey, { content: string, hash: string, createdAt: number }>
 * où cacheKey = "base" | "agent:{role}"
 */

import { createHash } from 'crypto';

interface CacheEntry {
  content: string;
  hash: string;
  createdAt: number;
  version: string; // Version du prompt pour invalider si changement
}

// Version actuelle du système de prompts - à incrémenter si la structure change
const PROMPT_VERSION = 'v2.0';

// Durées de cache (en ms)
const CACHE_DURATIONS = {
  base: 24 * 60 * 60 * 1000, // 24 heures pour le base system prompt
  agent: 24 * 60 * 60 * 1000, // 24 heures pour les prompts par agent
};

/**
 * Cache simple en mémoire pour les prompts statiques.
 * En production, pourrait être persisté sur disque ou en Redis.
 */
export class PromptCache {
  private cache: Map<string, CacheEntry> = new Map();
  private hits: number = 0;
  private misses: number = 0;

  /**
   * Génère une clé de cache pour un prompt
   */
  private generateCacheKey(type: 'base' | 'agent', role?: string): string {
    return type === 'base' ? 'prompt:base' : `prompt:agent:${role}`;
  }

  /**
   * Calcul le hash d'un contenu
   */
  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Stocke un prompt dans le cache
   */
  setPrompt(type: 'base' | 'agent', role: string, content: string): string {
    const key = this.generateCacheKey(type, type === 'agent' ? role : undefined);
    const hash = this.computeHash(content);
    
    const entry: CacheEntry = {
      content,
      hash,
      createdAt: Date.now(),
      version: PROMPT_VERSION,
    };

    this.cache.set(key, entry);
    return hash;
  }

  /**
   * Récupère un prompt depuis le cache
   */
  getPrompt(type: 'base' | 'agent', role: string): CacheEntry | null {
    const key = this.generateCacheKey(type, type === 'agent' ? role : undefined);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Vérifier l'expiration
    const duration = CACHE_DURATIONS[type];
    if (Date.now() - entry.createdAt > duration) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Vérifier la version
    if (entry.version !== PROMPT_VERSION) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry;
  }

  /**
   * Vérifie si un prompt est dans le cache et valide
   */
  hasPrompt(type: 'base' | 'agent', role: string): boolean {
    return this.getPrompt(type, role) !== null;
  }

  /**
   * Invalide le cache pour un rôle spécifique ou tout le cache
   */
  invalidate(role?: string): void {
    if (role) {
      const key = this.generateCacheKey('agent', role);
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Invalide tout le cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Retourne les statistiques du cache
   */
  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Prépare un prompt avec des marqueurs de cache pour l'API
   * 
   * Pour les modèles qui supportent le prompt caching (Claude, GPT-4, etc.),
   * on peut structurer le prompt avec des sections marquées comme cache-ables.
   * 
   * Format pour Claude : 
   * {
   *   "anthropic_version": "bedrock-2023-05-31",
   *   "max_tokens": 1024,
   *   "cache_control": {
   *     "type": "ephemeral",
   *     "cache_ttl": "24h"
   *   },
   *   "messages": [...]
   * }
   * 
   * Format pour OpenAI :
   * {
   *   "model": "gpt-4",
   *   "messages": [...],
   *   "prompt_cache_key": "unique_key_for_cached_part"
   * }
   */
  formatForApi(
    prompt: string,
    modelProvider: 'anthropic' | 'openai' | 'gemini' | 'unknown',
    cacheableSections: { start: number; end: number; key: string }[] = []
  ): { prompt: string; cacheConfig?: any } {
    // Pour l'instant, on retourne le prompt tel quel avec une configuration de cache
    // L'intégration complète nécessiterait de modifier l'appel API dans le skillHandler
    
    const cacheConfig = this.buildCacheConfig(modelProvider, cacheableSections);
    
    return {
      prompt,
      cacheConfig,
    };
  }

  /**
   * Construit la configuration de cache pour un fournisseur donné
   */
  private buildCacheConfig(
    provider: 'anthropic' | 'openai' | 'gemini' | 'unknown',
    sections: { start: number; end: number; key: string }[]
  ): any {
    switch (provider) {
      case 'anthropic':
        return {
          cache_control: {
            type: 'ephemeral',
            cache_ttl: '24h',
          },
        };
      case 'openai':
        // OpenAI utilise prompt_cache_key pour marquer les parties à cacher
        return {
          prompt_cache_key: sections.map(s => s.key).join('|'),
        };
      case 'gemini':
        return {
          // Gemini supporte le cache de prompt via l'API
          // Voir : https://ai.google.dev/gemini-api/docs/caching
          cache: {
            enable: true,
            ttl: 86400, // 24 heures en secondes
          },
        };
      default:
        return undefined;
    }
  }
}

// Instance singleton pour une utilisation globale
export const promptCache = new PromptCache();

/**
 * Utilitaire pour extraire et marquer les sections cache-ables d'un prompt
 */
export function extractCacheableSections(prompt: string, agentRole?: string): { start: number; end: number; key: string }[] {
  const sections: { start: number; end: number; key: string }[] = [];
  
  // Base system prompt - toujours cache-able
  const baseStart = 0;
  const baseEnd = findBaseSystemPromptEnd(prompt);
  if (baseEnd > baseStart) {
    sections.push({
      start: baseStart,
      end: baseEnd,
      key: `base:${PROMPT_VERSION}`,
    });
  }

  // Agent-specific sections - cache-able par rôle
  if (agentRole) {
    const agentStart = findAgentSectionStart(prompt, agentRole);
    const agentEnd = findAgentSectionEnd(prompt, agentRole);
    if (agentStart >= 0 && agentEnd > agentStart) {
      sections.push({
        start: agentStart,
        end: agentEnd,
        key: `agent:${agentRole}:${PROMPT_VERSION}`,
      });
    }
  }

  // Utiliser les variables pour éviter les warnings TypeScript
  void baseEnd;

  return sections;
}

/**
 * Trouve la fin du BASE_SYSTEM_PROMPT dans un prompt
 */
function findBaseSystemPromptEnd(prompt: string): number {
  // Le base system prompt se termine généralement avant la section spécifique de l'agent
  // ou avant "# Tâche :" ou "## Tâche :"
  const markers = [
    '\n# Tâche :',
    '\n## Tâche :',
    '\nTâche :',
    '\n---',
    '\n\nIDENTITÉ :',
    '\n\nMISSION',
  ];
  
  let end = prompt.length;
  for (const marker of markers) {
    const idx = prompt.indexOf(marker);
    if (idx > 0 && idx < end) {
      end = idx;
    }
  }
  
  return end;
}

/**
 * Trouve le début de la section spécifique à l'agent
 */
function findAgentSectionStart(prompt: string, agentRole: string): number {
  // Chercher des marqueurs comme "IDENTITÉ : Agent X" ou "MISSION"
  const identityMarker = `IDENTITÉ : Agent ${agentRole}`;
  const missionMarker = 'MISSION';
  
  const identityIdx = prompt.indexOf(identityMarker);
  const missionIdx = prompt.indexOf(missionMarker);
  
  if (identityIdx >= 0) return identityIdx;
  if (missionIdx >= 0) return missionIdx;
  
  return -1;
}

/**
 * Trouve la fin de la section spécifique à l'agent
 */
function findAgentSectionEnd(prompt: string, _agentRole: string): number {
  // La section agent se termine avant le contexte de tâche ou les instructions
  const markers = [
    '\n# Tâche :',
    '\n## Tâche :',
    '\nTâche :',
    '\n## Contrat d\'exécution',
    '\n## Instructions supplémentaires',
    '\n## Fichiers de contexte',
  ];
  
  let end = prompt.length;
  for (const marker of markers) {
    const idx = prompt.indexOf(marker);
    if (idx > 0 && idx < end) {
      end = idx;
    }
  }
  
  return end;
}
