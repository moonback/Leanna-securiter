/**
 * AgentStatusBlock — Section agent IA de la sidebar.
 * Design cohérent avec le reste de la sidebar :
 * - Icône principale : connecter (si off) / ouvrir chat (si on)
 * - Bouton chevron visible (▾) : ouvre le menu de contrôle IA
 */

import { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Mic, MicOff, Power, Sparkles, MessageCircle,
  Bot, Cpu, ChevronDown,
} from 'lucide-react';

import { SidebarItem } from '../ide/sidebar/SidebarItem.js';
import { FlyoutMenu, FlyoutHeader, FlyoutItem, FlyoutSeparator } from '../ide/sidebar/FlyoutMenu.js';
import { SidebarSeparator } from '../ide/sidebar/SidebarSection.js';
import type { AIMenuItem, IDEPanelState, IDEPanelActions } from './types.js';

interface AgentStatusBlockProps {
  assistantConnected: boolean;
  assistantWorking: boolean;
  assistantMuted: boolean;
  assistantMenuOpen: boolean;
  assistantMenuRef: React.RefObject<HTMLDivElement | null>;
  setAssistantMenuOpen: (v: boolean) => void;
  aiMenuItems: AIMenuItem[];
  state: IDEPanelState;
  actions: IDEPanelActions;
  mode: 'full' | 'ask';
  onToggleChat: () => void;
  onToggleMode: () => void;
  onConnectAssistant: () => void;
  onDisconnectAssistant: () => void;
  onMuteToggle: () => void;
}

export function AgentStatusBlock({
  assistantConnected,
  assistantWorking,
  assistantMuted,
  assistantMenuOpen,
  assistantMenuRef,
  setAssistantMenuOpen,
  aiMenuItems,
  state,
  actions,
  mode,
  onToggleChat,
  onToggleMode,
  onConnectAssistant,
  onDisconnectAssistant,
  onMuteToggle,
}: AgentStatusBlockProps) {
  // Escape closes flyout
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && assistantMenuOpen) {
      setAssistantMenuOpen(false);
    }
  }, [assistantMenuOpen, setAssistantMenuOpen]);

  useEffect(() => {
    if (!assistantMenuOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [assistantMenuOpen, handleKeyDown]);

  const stateRecord = state as unknown as Record<string, boolean | string | null>;
  const actionsRecord = actions as unknown as Record<string, () => void>;

  // Status dot color
  const statusDot = assistantConnected
    ? assistantWorking
      ? 'var(--accent-primary)'
      : assistantMuted
        ? 'var(--color-warning)'
        : 'var(--color-success)'
    : undefined;

  // Main click: connect or open chat
  const handleMainClick = useCallback(() => {
    if (!assistantConnected) {
      onConnectAssistant();
    } else {
      onToggleChat();
    }
  }, [assistantConnected, onConnectAssistant, onToggleChat]);

  // Menu toggle
  const toggleMenu = useCallback(() => {
    setAssistantMenuOpen(!assistantMenuOpen);
  }, [assistantMenuOpen, setAssistantMenuOpen]);

  return (
    <>
      <SidebarSeparator thin />

      <div
        className="relative w-full"
        ref={assistantMenuRef}
        role="group"
        aria-label="Agent IA"
      >
        {/* ── Main row: icon + optional menu trigger ── */}
        <div
          className="relative w-full flex items-center justify-center"
          onContextMenu={(e) => {
            e.preventDefault();
            if (assistantConnected) toggleMenu();
          }}
        >
          {/* Principal action button */}
          <SidebarItem
            icon={assistantConnected ? Cpu : Bot}
            active={assistantConnected && (state.showChat || assistantWorking)}
            onClick={handleMainClick}
            title={assistantConnected ? 'Chat IA (Ctrl+L) · Clic droit : menu' : 'Connecter l\'agent IA'}
            dot={statusDot}
            hasSubmenu={assistantConnected}
          />

          {/* Visible menu chevron — only when connected */}
          {assistantConnected && (
            <button
              type="button"
              onClick={toggleMenu}
              className="absolute top-1.5 right-1 w-3.5 h-3.5 flex items-center justify-center rounded-sm transition-all"
              style={{
                color: assistantMenuOpen ? 'var(--accent-primary)' : 'var(--text-dimmed)',
                backgroundColor: assistantMenuOpen ? 'var(--accent-subtle)' : 'transparent',
                opacity: assistantMenuOpen ? 1 : 0.6,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
              onMouseLeave={(e) => { if (!assistantMenuOpen) { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--text-dimmed)'; }}}
              aria-label="Menu de contrôle IA"
              aria-expanded={assistantMenuOpen}
              aria-haspopup="menu"
            >
              <ChevronDown size={9} />
            </button>
          )}

          {/* Working pulse */}
          {assistantConnected && assistantWorking && (
            <motion.div
              className="absolute bottom-px left-1/2 -translate-x-1/2 w-3.5 h-px rounded-full"
              style={{ backgroundColor: 'var(--accent-primary)' }}
              animate={{ opacity: [0.3, 1, 0.3], scaleX: [0.5, 1, 0.5] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* ── Flyout menu ── */}
        <AnimatePresence mode="wait">
          {assistantMenuOpen && (
            <FlyoutMenu align="bottom">
              <FlyoutHeader>
                <span className="flex items-center gap-2">
                  <Sparkles size={13} style={{ color: 'var(--accent-primary)' }} />
                  Contrôle IA
                </span>
              </FlyoutHeader>

              <div role="menu" aria-label="Options de l'agent IA">
                <FlyoutItem
                  icon={MessageCircle}
                  label="Chat"
                  active={state.showChat}
                  onClick={() => { onToggleChat(); setAssistantMenuOpen(false); }}
                />

                <FlyoutSeparator />

                {/* {aiMenuItems.map((item) => (
                  <FlyoutItem
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    active={item.stateKey ? Boolean(stateRecord[item.stateKey]) : false}
                    dot={item.dotStateKey ? (Boolean(stateRecord[item.dotStateKey]) ? 'var(--accent-secondary)' : undefined) : undefined}
                    onClick={() => {
                      if (item.actionKey && actionsRecord[item.actionKey]) {
                        actionsRecord[item.actionKey]();
                        setAssistantMenuOpen(false);
                      }
                    }}
                  />
                ))} */}
              </div>

              <FlyoutSeparator />

              <FlyoutItem
                icon={assistantMuted ? MicOff : Mic}
                label={assistantMuted ? 'Réactiver le micro' : 'Couper le micro'}
                active={!assistantMuted}
                onClick={() => { setAssistantMenuOpen(false); onMuteToggle(); }}
              />
              <FlyoutItem
                icon={Sparkles}
                label={mode === 'full' ? 'Mode : Complet' : 'Mode : Question'}
                active={false}
                onClick={() => { onToggleMode(); setAssistantMenuOpen(false); }}
              />

              <FlyoutSeparator />

              <FlyoutItem
                icon={Power}
                label="Déconnecter"
                active={false}
                onClick={() => { setAssistantMenuOpen(false); onDisconnectAssistant(); }}
              />
            </FlyoutMenu>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
