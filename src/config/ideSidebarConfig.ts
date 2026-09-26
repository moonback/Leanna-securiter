/**
 * Configuration externe de la sidebar IDE.
 * Réorganisée en 5 icônes principales par domaine fonctionnel.
 *
 * Icônes visibles (5 au total) :
 * 1. Explorateur (accès direct)
 * 2. Code (sous-menu : Recherche, Terminal, Prévisualisation)
 * 3. Git & CI/CD (sous-menu : Sandbox, Workflow)
 * 4. Données (sous-menu : Knowledge, Notebooks, Santé système)
 * 5. Outils (sous-menu : Agent Builder, Caméra, Partage écran)
 * (IA via le menu agent en bas — inchangé)
 */

import {
  Search,
  GitBranch, Github, Camera, Monitor, Boxes,
  FolderTree, ChartNoAxesColumnIncreasing, Workflow,
  Container, Bot, Crosshair, Database,
  Activity, Wrench, Users,
  Wand2, BookOpen, Globe, Terminal, Store,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SidebarItemType = 'button' | 'submenu';

export interface SidebarItemConfig {
  id: string;
  type: SidebarItemType;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  /** Key in the sidebar state that tracks visibility/active status */
  stateKey?: string;
  /** Toggle handler key */
  actionKey?: string;
  /** Show dot indicator when this state key is truthy */
  dotStateKey?: string;
  /** Only show when assistant is connected */
  requiresAssistant?: boolean;
  /** Sub-items for submenu type */
  children?: SidebarItemConfig[];
}

export interface SidebarSectionConfig {
  id: string;
  label?: string;
  items: SidebarItemConfig[];
}

// ─── Configuration ───────────────────────────────────────────────────────────

export const sidebarSections: SidebarSectionConfig[] = [

  // ═══ 1. EXPLORATEUR — accès direct (icône toujours visible) ═══
  {
    id: 'explorer',
    label: 'Explorateur',
    items: [
      {
        id: 'explorer',
        type: 'button',
        icon: FolderTree,
        label: 'Explorateur',
        shortcut: 'Ctrl+Shift+E',
        stateKey: 'showExplorer',
        actionKey: 'onToggleExplorer',
      },
    ],
  },

  // ═══ 2. CODE — sous-menu pour les outils de code ═══
  {
    id: 'code',
    label: 'Code',
    items: [
      {
        id: 'code-menu',
        type: 'submenu',
        icon: Terminal,
        label: 'Code',
        children: [
          {
            id: 'search',
            type: 'button',
            icon: Search,
            label: 'Recherche',
            shortcut: 'Ctrl+Shift+F',
            stateKey: 'showGlobalSearch',
            actionKey: 'onToggleSearch',
          },
          {
            id: 'terminal',
            type: 'button',
            icon: Terminal,
            label: 'Terminal',
            shortcut: 'Ctrl+`',
            stateKey: 'showTerminal',
            actionKey: 'onToggleTerminal',
          },
          {
            id: 'browser',
            type: 'button',
            icon: Globe,
            label: 'Prévisualisation',
            shortcut: 'Ctrl+Shift+B',
            stateKey: 'showBrowser',
            actionKey: 'onToggleBrowser',
          },
        ],
      },
    ],
  },

  // ═══ 3. GIT & CI/CD — sous-menu pour versionnement et déploiement ═══
  {
    id: 'git-cicd',
    label: 'Git & CI/CD',
    items: [
      {
        id: 'git-menu',
        type: 'submenu',
        icon: GitBranch,
        label: 'Git & CI/CD',
        children: [
          {
            id: 'github',
            type: 'button',
            icon: Github,
            label: 'GitHub',
            stateKey: 'showGitHub',
            actionKey: 'onToggleGitHub',
          },
          {
            id: 'sandbox',
            type: 'button',
            icon: Container,
            label: 'Sandbox',
            stateKey: 'showSandbox',
            actionKey: 'onToggleSandbox',
          },
          {
            id: 'workflow',
            type: 'button',
            icon: Workflow,
            label: 'Workflow CI/CD',
            stateKey: 'showWorkflow',
            actionKey: 'onToggleWorkflow',
          },
        ],
      },
    ],
  },

  // ═══ 4. DONNÉES — sous-menu pour knowledge et outils analytiques ═══
  {
    id: 'data',
    label: 'Données',
    items: [
      {
        id: 'data-menu',
        type: 'submenu',
        icon: Database,
        label: 'Données',
        children: [
          {
            id: 'knowledge',
            type: 'button',
            icon: Database,
            label: 'Knowledge',
            stateKey: 'showKnowledge',
            actionKey: 'onToggleKnowledge',
          },
          {
            id: 'notebooks-panel',
            type: 'button',
            icon: BookOpen,
            label: 'Notebooks',
            stateKey: 'showNotebooks',
            actionKey: 'onToggleNotebooks',
          },
          {
            id: 'system-health',
            type: 'button',
            icon: Activity,
            label: 'Santé système',
            stateKey: 'showSystemHealth',
            actionKey: 'onToggleSystemHealth',
          },
          {
            id: 'pm2-monitor',
            type: 'button',
            icon: Boxes,
            label: 'PM2 · Processus',
            stateKey: 'showPM2',
            actionKey: 'onTogglePM2',
          },
          // {
          //   id: 'mcp',
          //   type: 'button',
          //   icon: Cable,
          //   label: 'Serveurs MCP',
          //   stateKey: 'showMcp',
          //   actionKey: 'onToggleMcp',
          // },
        ],
      },
    ],
  },

  // ═══ 5. OUTILS — sous-menu pour outils avancés ═══
  {
    id: 'tools',
    label: 'Outils',
    items: [
      {
        id: 'tools-menu',
        type: 'submenu',
        icon: Wrench,
        label: 'Outils',
        children: [
          {
            id: 'agent-builder',
            type: 'button',
            icon: Wand2,
            label: 'Agent Builder',
            stateKey: 'showAgentBuilder',
            actionKey: 'onToggleAgentBuilder',
          },
          {
            id: 'marketplace',
            type: 'button',
            icon: Store,
            label: 'Marketplace',
            stateKey: 'showMarketplace',
            actionKey: 'onToggleMarketplace',
          },
          {
            id: 'skills-doc',
            type: 'button',
            icon: BookOpen,
            label: 'Docs Skills',
            stateKey: 'showSkillsDoc',
            actionKey: 'onToggleSkillsDoc',
          },
          {
            id: 'vision',
            type: 'button',
            icon: Camera,
            label: 'Caméra',
            stateKey: 'visionEnabled',
            actionKey: 'onToggleVision',
            requiresAssistant: true,
          },
          {
            id: 'screen-share',
            type: 'button',
            icon: Monitor,
            label: 'Partage écran',
            stateKey: 'screenShareEnabled',
            actionKey: 'onToggleScreenShare',
            requiresAssistant: true,
          },
        ],
      },
    ],
  },


  // ═══ IA — items exposés via le flyout du status agent (non compté dans les 5 icônes) ═══
  {
    id: 'ai-agent',
    label: 'Intelligence Artificielle',
    items: [
      // {
      //   id: 'chat',
      //   type: 'button',
      //   icon: MessageCircle,
      //   label: 'Chat',
      //   shortcut: 'Ctrl+L',
      //   stateKey: 'showChat',
      //   actionKey: 'onToggleChat',
      //   requiresAssistant: true,
      // },
      {
        id: 'agents',
        type: 'button',
        icon: Bot,
        label: 'Agents',
        stateKey: 'showAgents',
        actionKey: 'onToggleAgents',
        requiresAssistant: true,
      },
      {
        id: 'fleet',
        type: 'button',
        icon: Users,
        label: 'Flotte',
        stateKey: 'showFleet',
        actionKey: 'onToggleFleet',
        requiresAssistant: true,
      },
      {
        id: 'missions',
        type: 'button',
        icon: Crosshair,
        label: 'Missions',
        stateKey: 'showMissions',
        actionKey: 'onToggleMissions',
        requiresAssistant: true,
      },
      {
        id: 'skills-monitor',
        type: 'button',
        icon: ChartNoAxesColumnIncreasing,
        label: 'Suivi Agent',
        stateKey: 'showSkillsMonitor',
        actionKey: 'onToggleSkillsMonitor',
        requiresAssistant: true,
      },
    ],
  },
];

// ─── Run Commands ────────────────────────────────────────────────────────────

export const runCommands = [
  { label: 'npm run dev', cmd: 'npm run dev' },
  { label: 'npm install', cmd: 'npm install' },
  { label: 'npm run build', cmd: 'npm run build' },
  { label: 'npm run desktop', cmd: 'npm run desktop' },
  { label: 'npm test', cmd: 'npm test' },
];
