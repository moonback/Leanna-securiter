/**
 * UnifiedSidebar — Sidebar unifiée (48px fixe, mode compact uniquement).
 *
 * Structure :
 * 1. Brand Row (logo)
 * 2. IDE Tools (panneaux contextuels)
 * 3. Agent Status (contrôle IA)
 * 4. Navigation Globale (flyout)
 * 5. Footer (paramètres, aide, quit)
 */

import { useRef, useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  History,
  Zap,
  Power,
  Settings,
  BrainCircuit,
  LayoutList,
  FileText,
  BookOpen,
  Menu,
  FolderOpen,
  BarChart2,
  Activity,
  // Security icons
  Shield,
  Scan,
  AlertTriangle,
  Network,
  FileJson,
  Tag,
  Code2,
  ShieldAlert,
  Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useTheme } from '../context/ThemeContext.js';
import { useProfile } from '../context/UserProfileContext.js';
import { SidebarSection, SidebarSeparator } from './ide/sidebar/SidebarSection.js';
import { SidebarItem } from './ide/sidebar/SidebarItem.js';
import { sidebarSections } from '../config/ideSidebarConfig.js';
// @ts-ignore - Assets handled by bundler
import logoDark from '../../assets/images/icon-sombre.png';
// @ts-ignore - Assets handled by bundler
import logoLight from '../../assets/images/icon-light.png';

import { QuitConfirmDialog } from './sidebar/QuitConfirmDialog.js';
import { AgentStatusBlock } from './sidebar/AgentStatusBlock.js';
import { buildAIMenuItems } from './sidebar/buildAIMenuItems.js';
import { useIDEState } from './sidebar/useIDEState.js';
import type { UnifiedSidebarProps, SidebarContext } from './sidebar/types.js';

// Re-export types for consumers
export type { UnifiedSidebarProps } from './sidebar/types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const noop = () => {};

// ─── Composant Principal ───────────────────────────────────────────────────────

export const UnifiedSidebar = memo(function UnifiedSidebar(props: UnifiedSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const { profile } = useProfile();
  const { context } = props;

  const assistantMenuRef = useRef<HTMLDivElement>(null);
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasAnimatedRef = useRef(false);

  // ── Consolidated IDE state/actions via custom hook ──
  const { state, actions } = useIDEState(props);

  // ── AI Menu items (memoized) ──
  const aiMenuItems = useMemo(
    () => buildAIMenuItems(props.assistantConnected ?? false, profile.agents.enabled),
    [props.assistantConnected, profile.agents.enabled]
  );

  // ── Close assistant menu on outside click ──
  useEffect(() => {
    if (!assistantMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (assistantMenuRef.current && !assistantMenuRef.current.contains(event.target as Node)) {
        setAssistantMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [assistantMenuOpen]);

  // Mark animated after first render
  useEffect(() => { hasAnimatedRef.current = true; }, []);

  // ── Quit handlers ──
  const handleQuitClose = useCallback(() => setShowQuitConfirm(false), []);
  const handleQuitConfirm = useCallback(() => {
    setShowQuitConfirm(false);
    (window as any).electronAPI?.quit();
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile Toggle Button - Enhanced */}
      <motion.button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="md:hidden fixed top-3 left-3 z-50 p-2.5 rounded-lg border text-[var(--text-primary)] transition-all duration-200 hover:bg-[var(--bg-secondary)] shadow-md group"
        style={{ 
          borderColor: 'var(--border-base)', 
          backgroundColor: 'var(--bg-panel)',
          backdropFilter: 'blur(8px)',
        }}
        aria-label="Menu principal"
        whileHover={{ scale: 1.05, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
        whileTap={{ scale: 0.95 }}
      >
        <Menu className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" />
      </motion.button>

      {/* Mobile Backdrop Overlay - Enhanced */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            onClick={() => setMobileOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="md:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-md"
          />
        )}
      </AnimatePresence>

      {/* Global Sidebar Styles Injection - Using CSS variables */}
      <style>{`
        .sidebar-flyout-menu {
          --flyout-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
          --flyout-border-radius: 8px;
          --flyout-min-width: 200px;
        }
        
        /* Custom scrollbar for flyout menus */
        .sidebar-flyout-menu::-webkit-scrollbar {
          width: 6px;
        }
        .sidebar-flyout-menu::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidebar-flyout-menu::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb, rgba(128, 128, 128, 0.4));
          border-radius: 3px;
        }
        .sidebar-flyout-menu::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover, rgba(128, 128, 128, 0.6));
        }
        
        /* Tooltip styling */
        .sidebar-tooltip {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 8px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
          background: var(--bg-tooltip, var(--bg-panel));
          color: var(--text-primary);
          border: 1px solid var(--border-base);
          border-radius: 6px;
          box-shadow: var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.25));
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease, transform 0.2s ease;
          z-index: 1000;
          max-width: 220px;
        }
        
        .sidebar-tooltip::after {
          content: '';
          position: absolute;
          left: -6px;
          top: 50%;
          transform: translateY(-50%);
          border-width: 6px 6px 6px 0;
          border-style: solid;
          border-color: transparent var(--border-base, #ccc) transparent transparent;
        }
        
        .group:hover .sidebar-tooltip {
          opacity: 1;
          transform: translateY(-50%) translateX(4px);
        }
        
        /* Separator opacity styles */
        .sidebar-separator-low-opacity {
          opacity: 0.4 !important;
        }
        .sidebar-separator-medium-opacity {
          opacity: 0.6 !important;
        }
      `}</style>

      <motion.nav
        className={`Leanna-sidebar flex flex-col items-center select-none relative ${mobileOpen ? 'mobile-open' : ''}`}
        initial={false}
        animate={{ x: 0 }}
        transition={{ 
          type: 'spring', 
          bounce: 0, 
          duration: mobileOpen ? 0.3 : 0.4 
        }}
        style={{
          width: mobileOpen ? '280px' : 'var(--ide-sidebar-width)',
          borderRight: '1px solid var(--ide-sidebar-border)',
          backgroundColor: 'var(--ide-sidebar-bg)',
          height: '100%',
          paddingBottom: '12px',
          boxShadow: mobileOpen ? 'var(--shadow-xl, 0 8px 32px rgba(0,0,0,0.3))' : 'none',
          borderTopLeftRadius: 'var(--radius-base)',
          borderBottomLeftRadius: 'var(--radius-base)',
          gap: '2px',
          zIndex: mobileOpen ? 'var(--z-sidebar)' : 'auto',
          position: mobileOpen ? 'fixed' : 'relative',
          left: 0,
          top: 0,
        }}
        aria-label="Navigation principale"
      >
        {/* ═══ BRAND LOGO ═══ */}
        <BrandLogo theme={theme} onNavigate={() => { navigate('/scan'); setMobileOpen(false); }} />
        <NoWorkspaceBadge />

      {/* ═══ SECURITY CONSOLE OR IDE TOOLS ═══ */}
      <div className="flex-1 w-full flex flex-col min-h-0">
        {context === 'ide' ? (
          <IDEToolsSections
            state={state}
            actions={actions}
            assistantConnected={props.assistantConnected ?? false}
            skipAnimation={hasAnimatedRef.current}
          />
        ) : (
          <SecurityConsoleNavSection currentPath={location.pathname} navigate={navigate} />
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {context === 'ide' && (
          <>
            <SidebarSeparator thin className="sidebar-separator-low-opacity" />
            {/* ═══ AGENT STATUS (IDE only) ═══ */}
            <motion.div
              initial={false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="w-full pb-2 pt-1"
            >
              <AgentStatusBlock
                assistantConnected={props.assistantConnected ?? false}
                assistantWorking={props.assistantWorking ?? false}
                assistantMuted={props.assistantMuted ?? false}
                assistantMenuOpen={assistantMenuOpen}
                assistantMenuRef={assistantMenuRef}
                setAssistantMenuOpen={setAssistantMenuOpen}
                aiMenuItems={aiMenuItems}
                state={state}
                actions={actions}
                mode={props.mode ?? 'full'}
                onToggleChat={props.onToggleChat ?? noop}
                onToggleMode={props.onToggleMode ?? noop}
                onConnectAssistant={props.onConnectAssistant ?? noop}
                onDisconnectAssistant={props.onDisconnectAssistant ?? noop}
                onMuteToggle={props.onMuteToggle ?? noop}
              />
            </motion.div>
          </>
        )}
      </div>

      {/* ═══ BOTTOM — fixed ═══ */}
      <div className="w-full flex flex-col items-center flex-shrink-0 pt-2">
        <SidebarSeparator thin className="sidebar-separator-low-opacity mb-1" />
        
        <GlobalNavSection
          context={context}
          currentPath={location.pathname}
          navigate={navigate}
          showHistory={props.showHistory ?? false}
          onToggleHistory={props.onToggleHistory ?? noop}
          showAutomation={props.showAutomation ?? false}
          onToggleAutomation={props.onToggleAutomation ?? noop}
          showMemory={props.showMemory ?? false}
          onToggleMemory={props.onToggleMemory ?? noop}
          showNotebooks={props.showNotebooks ?? false}
          onToggleNotebooks={props.onToggleNotebooks ?? noop}
        />

        <SidebarSeparator thin className="sidebar-separator-low-opacity my-1" />
        
        <FooterSection
          context={context}
          currentPath={location.pathname}
          navigate={navigate}
        />

        {/* Quit App (Electron) */}
        {(window as any).electronAPI && (
          <>
            <SidebarSeparator thin className="sidebar-separator-low-opacity my-0.5" />
            <motion.div
              whileHover={{ scale: 1.02, x: 2 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="w-full group relative"
            >
              <SidebarItem
                icon={Power}
                active={false}
                onClick={() => setShowQuitConfirm(true)}
                title="Quitter Leanna"
              />
              <div className="sidebar-tooltip">Quitter l'application</div>
            </motion.div>
            <QuitConfirmDialog
              open={showQuitConfirm}
              onClose={handleQuitClose}
              onConfirm={handleQuitConfirm}
            />
          </>
        )}
      </div>
    </motion.nav>
    </>
  );
});

// ─── NoWorkspaceBadge ───────────────────────────────────────────────────────
/**
 * Indicateur compact affiché dans la sidebar quand l'utilisateur utilise Leanna
 * sans workspace actif (mode web / questions générales).
 * Cliquer dessus ouvre le sélecteur de workspace.
 */
function NoWorkspaceBadge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Vérifier l'état initial au montage
    setVisible(sessionStorage.getItem('Leanna-no-workspace-mode') === '1');

    const onNoWorkspace = () => setVisible(true);
    const onWorkspaceChanged = () => {
      setVisible(false);
    };

    window.addEventListener('Leanna-no-workspace-mode', onNoWorkspace);
    window.addEventListener('Leanna-workspace-changed', onWorkspaceChanged);
    window.addEventListener('Leanna-sandbox-changed', onWorkspaceChanged);

    return () => {
      window.removeEventListener('Leanna-no-workspace-mode', onNoWorkspace);
      window.removeEventListener('Leanna-workspace-changed', onWorkspaceChanged);
      window.removeEventListener('Leanna-sandbox-changed', onWorkspaceChanged);
    };
  }, []);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
      className="w-full flex items-center justify-center pb-1 group relative"
    >
      <motion.button
        type="button"
        onClick={async () => {
          // Fermer tous les onglets et désactiver le workspace actuel
          window.dispatchEvent(new CustomEvent('Leanna-workspace-changed', { detail: { workspace: null } }));
          
          // Désactiver le workspace côté serveur
          try {
            await fetch('/api/self-root/clear', { method: 'POST' });
          } catch (e) {
            console.error('[UnifiedSidebar] Failed to clear workspace:', e);
          }
          
          // Ouvrir la modale de sélection
          window.dispatchEvent(new CustomEvent('Leanna-open-workspace-switcher'));
        }}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 30%, transparent)',
          color: 'var(--color-warning, #f59e0b)',
        }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        aria-label="Aucun projet — ouvrir le sélecteur de workspace"
        title="Mode sans projet — cliquer pour ouvrir un workspace"
      >
        <FolderOpen className="w-4 h-4" />
        {/* Pulsing dot */}
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: 'var(--color-warning, #f59e0b)' }}
        />
      </motion.button>
      {/* Tooltip */}
      <div className="sidebar-tooltip">Sans projet — ouvrir workspace</div>
    </motion.div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function BrandLogo({ theme, onNavigate }: { theme: string; onNavigate: () => void }) {
  return (
    <div
      className="w-full h-[72px] flex items-center justify-center flex-shrink-0"
      style={{ borderBottom: '1px solid var(--ide-sidebar-border)' }}
    >
      <motion.button
        type="button"
        className="w-[44px] h-[44px] rounded-xl overflow-hidden flex items-center justify-center cursor-pointer transition-all duration-300 relative group"
        style={{
          background: 'var(--ide-sidebar-item-bg)',
          boxShadow: 'none',
          border: '1px solid var(--ide-sidebar-border)',
        }}
        onClick={onNavigate}
        aria-label="Retourner à l'éditeur"
        whileHover={{
          scale: 1.1,
          boxShadow: '0 0 16px rgba(var(--accent-primary-rgb, 0, 194, 255), 0.25), 0 4px 12px rgba(0,0,0,0.15)',
          borderColor: 'color-mix(in srgb, var(--accent-primary) 30%, transparent)',
        }}
        whileTap={{ scale: 0.92 }}
      >
        {/* Subtle glow effect on hover - now more subtle */}
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{
            background: 'radial-gradient(circle at center, color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%, transparent 70%)',
          }}
        />
        
        {/* Animated border ring - dynamic color from accent */}
        <motion.div
          className="absolute inset-[-2px] rounded-xl pointer-events-none"
          style={{
            border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)',
          }}
          animate={{ 
            scale: [1, 1.05, 1], 
            opacity: [0.2, 0.5, 0.2] 
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        <motion.img
          src={['dark', 'cyberpunk', 'high-contrast'].includes(theme) ? logoDark : logoLight}
          alt="Leanna"
          className="w-[32px] h-[32px] object-contain"
          whileHover={{ 
            scale: 1.12, 
            rotate: [0, -4, 4, 0] 
          }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
        />
        
        {/* Tooltip */}
        <div className="sidebar-tooltip">Accueil Sécurité (Scan)</div>
      </motion.button>
    </div>
  );
}

function SecurityConsoleNavSection({
  currentPath,
  navigate,
}: {
  currentPath: string;
  navigate: (path: string) => void;
}) {
  const items = [
    {
      id: 'scan',
      path: '/scan',
      icon: Scan,
      title: 'Scan & Audit',
      active: currentPath === '/scan' || currentPath === '/',
    },
    {
      id: 'findings',
      path: '/findings',
      icon: AlertTriangle,
      title: 'Vulnérabilités',
      active: currentPath.startsWith('/findings'),
    },
    {
      id: 'surface',
      path: '/surface',
      icon: Network,
      title: "Surface d'attaque",
      active: currentPath === '/surface',
    },
    {
      id: 'threat-model',
      path: '/threat-model',
      icon: ShieldAlert,
      title: 'Modèle de menace (STRIDE/MITRE)',
      active: currentPath === '/threat-model',
    },
    {
      id: 'triage',
      path: '/triage',
      icon: Layers,
      title: 'Triage par cause racine',
      active: currentPath === '/triage',
    },
    {
      id: 'report',
      path: '/report',
      icon: FileJson,
      title: 'Rapports & SARIF',
      active: currentPath === '/report',
    },
    {
      id: 'rules',
      path: '/rules',
      icon: Tag,
      title: 'Règles de sécurité',
      active: currentPath === '/rules',
    },
    {
      id: 'code-viewer',
      path: '/code-viewer',
      icon: Code2,
      title: 'Code Viewer (Monaco)',
      active: currentPath === '/code-viewer',
    },
  ];

  return (
    <div className="w-full flex flex-col gap-1 pt-2">
      {items.map((item) => (
        <div key={item.id} className="group relative w-full">
          <SidebarItem
            icon={item.icon}
            active={item.active}
            onClick={() => navigate(item.path)}
            title={item.title}
          />
          <div className="sidebar-tooltip">{item.title}</div>
        </div>
      ))}
    </div>
  );
}

function IDEToolsSections({
  state,
  actions,
  assistantConnected,
  skipAnimation,
}: {
  state: import('./sidebar/types.js').IDEPanelState;
  actions: import('./sidebar/types.js').IDEPanelActions;
  assistantConnected: boolean;
  skipAnimation: boolean;
}) {
  const stateRecord = state as unknown as Record<string, boolean | string | null>;
  const actionsRecord = actions as unknown as Record<string, () => void>;

  // Extract shortcuts from sidebar config for tooltips
  const getTooltipText = (section: typeof sidebarSections[number]) => {
    if (section.items.length === 1 && section.items[0].type === 'button') {
      const item = section.items[0];
      const baseText = section.label || item.label;
      const shortcut = item.shortcut ? ` (${item.shortcut})` : '';
      return baseText + shortcut;
    }
    return section.label || '';
  };

  return (
    <div className="w-full flex flex-col gap-0 pt-2">
      {sidebarSections.map((section, idx) => (
        <motion.div
          key={section.id}
          className="w-full"
          initial={skipAnimation ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ 
            delay: skipAnimation ? 0 : idx * 0.05, 
            duration: 0.3, 
            ease: [0.25, 0.46, 0.45, 0.94] 
          }}
        >
          <div className="group relative w-full">
            <SidebarSection
              config={section}
              state={stateRecord}
              actions={actionsRecord}
              assistantConnected={assistantConnected}
            />
            {/* Enhanced tooltip with shortcuts */}
            <div className="sidebar-tooltip">
              {getTooltipText(section)}
            </div>
          </div>
          {idx < sidebarSections.length - 1 && (
            <SidebarSeparator thin className="sidebar-separator-medium-opacity my-0.5" />
          )}
        </motion.div>
      ))}
    </div>
  );
}

function GlobalNavSection({
  context,
  currentPath,
  navigate,
  showHistory,
  onToggleHistory,
  showAutomation,
  onToggleAutomation,
  showMemory,
  onToggleMemory,
  showNotebooks,
  onToggleNotebooks,
}: {
  context: SidebarContext;
  currentPath: string;
  navigate: (path: string) => void;
  showHistory: boolean;
  onToggleHistory: () => void;
  showAutomation: boolean;
  onToggleAutomation: () => void;
  showMemory: boolean;
  onToggleMemory: () => void;
  showNotebooks: boolean;
  onToggleNotebooks: () => void;
}) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const submenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!submenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (submenuRef.current && !submenuRef.current.contains(e.target as Node)) {
        setSubmenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [submenuOpen]);

  useEffect(() => {
    setSubmenuOpen(false);
  }, [currentPath, showHistory, showAutomation, showMemory, showNotebooks]);

  const subItems = [
    { id: 'history', path: '/history', icon: History, label: 'Historique', active: showHistory, onClick: onToggleHistory },
    { id: 'memories', path: '/memories', icon: BrainCircuit, label: 'Mémoires', active: showMemory, onClick: onToggleMemory },
    { id: 'automation', path: '/automation', icon: Zap, label: 'Tâches', active: showAutomation, onClick: onToggleAutomation },
    { id: 'documents', path: '/documents', icon: FileText, label: 'Documents', active: currentPath === '/documents', onClick: () => navigate('/documents') },
    { id: 'notebooks', path: '/notebooks', icon: BookOpen, label: 'Notebooks', active: showNotebooks, onClick: onToggleNotebooks },
    { id: 'observability', path: '/observability', icon: BarChart2, label: 'Coûts & Tokens', active: currentPath === '/observability', onClick: () => navigate('/observability') },
    { id: 'autonomy', path: '/autonomy', icon: Activity, label: 'Autonomie', active: currentPath === '/autonomy', onClick: () => navigate('/autonomy') },
  ];

  const anyActive = subItems.some(item =>
    context === 'ide' ? item.active : item.path === currentPath
  );

  return (
    <div className="w-full flex flex-col items-center relative" role="navigation" aria-label="Navigation globale" ref={submenuRef}>
      <div className="group relative w-full">
        <SidebarItem
          icon={LayoutList}
          active={anyActive || submenuOpen}
          onClick={() => setSubmenuOpen(prev => !prev)}
          title="Navigation globale"
          hasSubmenu
        />
        <div className="sidebar-tooltip">Historique · Mémoires · Tâches · Documents · Autonomie</div>
      </div>

      <AnimatePresence>
        {submenuOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: -10, y: 0 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10, y: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="absolute left-[52px] bottom-0 z-50 py-1 rounded-lg border shadow-lg origin-top-left sidebar-flyout-menu"
            style={{
              backgroundColor: 'var(--bg-panel)',
              borderColor: 'var(--border-base)',
              boxShadow: 'var(--flyout-shadow)',
              minWidth: 'var(--flyout-min-width)',
              borderRadius: 'var(--flyout-border-radius)',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            {subItems.map(({ id, path, icon: Icon, label, active, onClick }) => {
              const isActive = context === 'ide' ? active : path === currentPath;
              const handleClick = context === 'ide' ? onClick : () => navigate(path);

              return (
                <motion.button
                  key={id}
                  onClick={() => {
                    handleClick();
                    setSubmenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-all duration-150 rounded-md group/item"
                  style={{
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-subtle)' : 'transparent',
                  }}
                  whileHover={{ 
                    x: 4, 
                    backgroundColor: 'var(--bg-secondary)' 
                  }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Icon 
                    size={14} 
                    style={{ 
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      transition: 'color 0.2s ease'
                    }} 
                  />
                  <span 
                    style={{ 
                      fontWeight: isActive ? 600 : 500,
                      transition: 'all 0.2s ease'
                    }}
                  >{label}</span>
                  
                  {/* Subtle highlight bar for active items */}
                  {isActive && (
                    <motion.div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r-sm"
                      style={{ backgroundColor: 'var(--accent-primary)' }}
                      initial={{ width: 0 }}
                      animate={{ width: 2 }}
                      transition={{ duration: 0.2 }}
                    />
                  )}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FooterSection({
  currentPath,
  navigate,
}: {
  context: SidebarContext;
  currentPath: string;
  navigate: (path: string) => void;
}) {
  return (
    <div className="w-full flex flex-col items-center gap-0.5" role="navigation" aria-label="Paramètres">
      <motion.div
        whileHover={{ scale: 1.02, x: 2 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="group relative w-full"
      >
        <SidebarItem
          icon={Settings}
          active={currentPath === '/settings'}
          onClick={() => navigate('/settings')}
          title="Paramètres (Ctrl+,)"
        />
        <div className="sidebar-tooltip">Paramètres</div>
      </motion.div>
    </div>
  );
}
