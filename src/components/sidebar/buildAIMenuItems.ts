/**
 * buildAIMenuItems — Construit la liste plate des items du menu IA
 * à partir de la config sidebar, filtrée par état de connexion et agents.
 */

import { sidebarSections } from '../../config/ideSidebarConfig.js';
import type { AIMenuItem } from './types.js';

/** IDs des items qui nécessitent que les agents soient activés */
const AGENT_ITEM_IDS = new Set(['agents', 'fleet', 'skills-monitor']);

export function buildAIMenuItems(assistantConnected: boolean, agentsEnabled = true): AIMenuItem[] {
  const section = sidebarSections.find(s => s.id === 'ai-agent');
  if (!section) return [];

  return section.items
    .flatMap(item =>
      item.type === 'submenu' && item.children ? item.children : [item]
    )
    .filter(item => item.actionKey || item.stateKey)
    .filter(item => !item.requiresAssistant || assistantConnected)
    .filter(item => agentsEnabled || !AGENT_ITEM_IDS.has(item.id))
    .map(item => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      stateKey: item.stateKey,
      actionKey: item.actionKey,
      dotStateKey: item.dotStateKey,
    }));
}
