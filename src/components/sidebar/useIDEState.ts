/**
 * Hook custom qui consolide les props IDE en objets state/actions typés.
 * Élimine les useMemo fragiles avec dépendances manuelles.
 */

import { useMemo } from 'react';
import type { UnifiedSidebarProps } from './types.js';
import type { IDEPanelState, IDEPanelActions } from './types.js';

const noop = () => {};

export function useIDEState(props: UnifiedSidebarProps) {
  const state: IDEPanelState = useMemo(() => ({
    showExplorer: props.showExplorer ?? false,
    showGlobalSearch: props.showGlobalSearch ?? false,
    showSettings: props.showSettings ?? false,
    showRunMenu: props.showRunMenu ?? false,
    showSandbox: props.showSandbox ?? false,
    showGitHub: props.showGitHub ?? false,
    showWorkflow: props.showWorkflow ?? false,
    showSkillsMonitor: props.showSkillsMonitor ?? false,
    showChat: props.showChat ?? false,
    showAgents: props.showAgents ?? false,
    showAgentBuilder: props.showAgentBuilder ?? false,
    showMarketplace: props.showMarketplace ?? false,
    showSkillsDoc: props.showSkillsDoc ?? false,
    showMissions: props.showMissions ?? false,
    showKnowledge: props.showKnowledge ?? false,
    showNotebooks: props.showNotebooks ?? false,
    showSystemHealth: props.showSystemHealth ?? false,
    showPM2: props.showPM2 ?? false,
    showMcp: props.showMcp ?? false,
    showFleet: props.showFleet ?? false,
    showBrowser: props.showBrowser ?? false,
    showTerminal: props.showTerminal ?? false,
    visionEnabled: props.visionEnabled ?? false,
    screenShareEnabled: props.screenShareEnabled ?? false,
  }), [
    props.showExplorer, props.showGlobalSearch,
    props.showSettings, props.showRunMenu,
    props.showSandbox, props.showGitHub, props.showWorkflow, props.showSkillsMonitor,
    props.showChat, props.showAgents, props.showAgentBuilder, props.showMarketplace, props.showSkillsDoc, props.showMissions,
    props.showKnowledge, props.showNotebooks, props.showSystemHealth, props.showPM2, props.showMcp,
    props.showFleet, props.showBrowser, props.showTerminal,
    props.visionEnabled, props.screenShareEnabled,
  ]);

  const actions: IDEPanelActions = useMemo(() => ({
    onToggleExplorer: props.onToggleExplorer ?? noop,
    onToggleSearch: props.onToggleSearch ?? noop,
    onToggleSettings: props.onToggleSettings ?? noop,
    onToggleRunMenu: props.onToggleRunMenu ?? noop,
    onToggleSandbox: props.onToggleSandbox ?? noop,
    onToggleGitHub: props.onToggleGitHub ?? noop,
    onToggleWorkflow: props.onToggleWorkflow ?? noop,
    onToggleSkillsMonitor: props.onToggleSkillsMonitor ?? noop,
    onToggleChat: props.onToggleChat ?? noop,
    onToggleAgents: props.onToggleAgents ?? noop,
    onToggleAgentBuilder: props.onToggleAgentBuilder ?? noop,
    onToggleMarketplace: props.onToggleMarketplace ?? noop,
    onToggleSkillsDoc: props.onToggleSkillsDoc ?? noop,
    onToggleMissions: props.onToggleMissions ?? noop,
    onToggleKnowledge: props.onToggleKnowledge ?? noop,
    onToggleNotebooks: props.onToggleNotebooks ?? noop,
    onToggleSystemHealth: props.onToggleSystemHealth ?? noop,
    onTogglePM2: props.onTogglePM2 ?? noop,
    onToggleMcp: props.onToggleMcp ?? noop,
    onToggleFleet: props.onToggleFleet ?? noop,
    onToggleBrowser: props.onToggleBrowser ?? noop,
    onToggleTerminal: props.onToggleTerminal ?? noop,
    onToggleVision: props.onToggleVision ?? noop,
    onToggleScreenShare: props.onToggleScreenShare ?? noop,
  }), [
    props.onToggleExplorer, props.onToggleSearch,
    props.onToggleSettings, props.onToggleRunMenu,
    props.onToggleSandbox, props.onToggleGitHub, props.onToggleWorkflow, props.onToggleSkillsMonitor,
    props.onToggleChat, props.onToggleAgents, props.onToggleAgentBuilder, props.onToggleMarketplace, props.onToggleSkillsDoc, props.onToggleMissions,
    props.onToggleKnowledge, props.onToggleNotebooks, props.onToggleSystemHealth, props.onTogglePM2, props.onToggleMcp,
    props.onToggleFleet, props.onToggleBrowser, props.onToggleTerminal,
    props.onToggleVision, props.onToggleScreenShare,
  ]);

  return { state, actions };
}
