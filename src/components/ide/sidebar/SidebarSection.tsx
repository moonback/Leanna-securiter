import { useRef, useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { SidebarItem } from './SidebarItem.js';
import { FlyoutMenu, FlyoutHeader, FlyoutItem } from './FlyoutMenu.js';
import type { SidebarSectionConfig } from '../../../config/ideSidebarConfig.js';

// ─── Props ───────────────────────────────────────────────────────────────────

interface SidebarSectionProps {
  config: SidebarSectionConfig;
  state: Record<string, any>;
  actions: Record<string, (...args: any[]) => void>;
  assistantConnected: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SidebarSection({ config, state, actions, assistantConnected }: SidebarSectionProps) {
  // Skip the AI/Agent section entirely - those items are now in the right-click menu on the agent status indicator
  if (config.id === 'ai-agent') {
    return null;
  }

  return (
    <>
      {config.items.map((item) => {
        // Skip items requiring assistant when not connected
        if (item.requiresAssistant && !assistantConnected) return null;

        if (item.type === 'submenu') {
          return (
            <SubmenuItem
              key={item.id}
              id={item.id}
              icon={item.icon}
              label={item.label}
              children={item.children || []}
              state={state}
              actions={actions}
              assistantConnected={assistantConnected}
            />
          );
        }

        // Regular button
        const isActive = item.stateKey ? Boolean(state[item.stateKey]) : false;
        const dot = item.dotStateKey && state[item.dotStateKey] ? 'var(--color-success)' : undefined;
        const handler = item.actionKey ? actions[item.actionKey] : undefined;

        // Show a subtle blue dot for assistant-required items when connected but not active
        const assistantDot = item.requiresAssistant && assistantConnected && !isActive && !dot
          ? 'var(--accent-primary)'
          : dot;

        return (
          <SidebarItem
            key={item.id}
            icon={item.icon}
            active={isActive}
            onClick={handler || (() => {})}
            title={item.label}
            dot={assistantDot}
          />
        );
      })}
    </>
  );
}

// ─── Submenu Item ────────────────────────────────────────────────────────────

interface SubmenuItemProps {
  id: string;
  icon: any;
  label: string;
  children: Array<{
    id: string;
    type: string;
    icon: any;
    label: string;
    stateKey?: string;
    actionKey?: string;
  }>;
  state: Record<string, any>;
  actions: Record<string, (...args: any[]) => void>;
  assistantConnected: boolean;
}

function SubmenuItem({ icon, label, children, state, actions }: SubmenuItemProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close flyout when any panel state changes (user navigated elsewhere)
  const activeKey = children.find(c => c.stateKey && Boolean(state[c.stateKey]))?.stateKey || '';
  useEffect(() => {
    setOpen(false);
  }, [activeKey]);

  // Compute active children info
  const anyChildActive = children.some(
    (child) => child.stateKey && Boolean(state[child.stateKey])
  );
  const activeCount = children.filter(
    (child) => child.stateKey && Boolean(state[child.stateKey])
  ).length;

  return (
    <div className="relative w-full" ref={menuRef}>
      <SidebarItem
        icon={icon}
        active={anyChildActive}
        onClick={() => setOpen(!open)}
        title={activeCount > 0 ? `${label} (${activeCount} actif${activeCount > 1 ? 's' : ''})` : label}
        hasSubmenu
      />
      <AnimatePresence>
        {open && (
          <FlyoutMenu>
            <FlyoutHeader>{label}</FlyoutHeader>
            {children.map((child) => {
              const isActive = child.stateKey ? Boolean(state[child.stateKey]) : false;
              const handler = child.actionKey ? actions[child.actionKey] : undefined;
              return (
                <FlyoutItem
                  key={child.id}
                  icon={child.icon}
                  label={child.label}
                  active={isActive}
                  onClick={() => {
                    handler?.();
                    setOpen(false);
                  }}
                />
              );
            })}
          </FlyoutMenu>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Separator ───────────────────────────────────────────────────────────────

export function SidebarSeparator({ thin, className }: { thin?: boolean; className?: string }) {
  return (
    <div
      className={`w-full flex items-center justify-center${className ? ` ${className}` : ''}`}
      style={{ padding: thin ? '3px 0' : '5px 0' }}
      aria-hidden="true"
    >
      <div
        style={{
          width: thin ? '14px' : '28px',
          height: '1px',
          background: thin
            ? 'var(--border-base)'
            : 'linear-gradient(90deg, transparent, var(--border-strong) 25%, var(--border-strong) 75%, transparent)',
          opacity: thin ? 0.3 : 0.55,
          borderRadius: '1px',
        }}
      />
    </div>
  );
}
