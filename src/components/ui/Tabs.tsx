/**
 * Tabs — Onglets accessibles au clavier.
 *
 * Conformité ARIA : roles tablist / tab / tabpanel, liaison aria-controls /
 * aria-labelledby, navigation aux flèches directionnelles, Début / Fin.
 *
 * API composée :
 *   <Tabs defaultValue="overview" onChange={setTab}>
 *     <Tabs.List>
 *       <Tabs.Tab value="overview">Vue d'ensemble</Tabs.Tab>
 *       <Tabs.Tab value="settings">Paramètres</Tabs.Tab>
 *     </Tabs.List>
 *     <Tabs.Panel value="overview">…</Tabs.Panel>
 *     <Tabs.Panel value="settings">…</Tabs.Panel>
 *   </Tabs>
 *
 * Navigation :
 *   ← / →        — onglet précédent / suivant (cycle)
 *   Début / Fin  — premier / dernier onglet
 *   Espace / Entrée — sélectionner l'onglet focusé
 *
 * Contrôle externe :
 *   <Tabs value={activeTab} onChange={setActiveTab}>…</Tabs>
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { clsx } from 'clsx';
import { motion } from 'motion/react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsVariant = 'underline' | 'pills' | 'contained';

export interface TabsProps {
  /** Onglet actif (mode contrôlé) */
  value?: string;
  /** Onglet actif initial (mode non contrôlé) */
  defaultValue?: string;
  /** Appelé lors du changement d'onglet */
  onChange?: (value: string) => void;
  /** Orientation (horizontal par défaut) */
  orientation?: TabsOrientation;
  /** Style visuel */
  variant?: TabsVariant;
  children: ReactNode;
  className?: string;
}

// ─── Context interne ────────────────────────────────────────────────────────────

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (value: string) => void;
  /** uid de base pour les ids aria */
  uid: string;
  orientation: TabsOrientation;
  variant: TabsVariant;
  /** Liste ordonnée des valeurs d'onglets (pour la navigation clavier) */
  registerTab: (value: string) => void;
  unregisterTab: (value: string) => void;
  tabOrder: React.MutableRefObject<string[]>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('<Tabs.Tab> and <Tabs.Panel> must be used inside <Tabs>');
  return ctx;
}

// ─── Composant racine ───────────────────────────────────────────────────────────

function TabsRoot({
  value: controlledValue,
  defaultValue = '',
  onChange,
  orientation = 'horizontal',
  variant = 'underline',
  children,
  className,
}: TabsProps) {
  const uid = useId();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const tabOrder = useRef<string[]>([]);

  const activeTab = controlledValue ?? internalValue;

  const setActiveTab = useCallback(
    (val: string) => {
      if (controlledValue === undefined) setInternalValue(val);
      onChange?.(val);
    },
    [controlledValue, onChange],
  );

  const registerTab = useCallback((value: string) => {
    if (!tabOrder.current.includes(value)) {
      tabOrder.current = [...tabOrder.current, value];
    }
  }, []);

  const unregisterTab = useCallback((value: string) => {
    tabOrder.current = tabOrder.current.filter((v) => v !== value);
  }, []);

  return (
    <TabsContext.Provider
      value={{
        activeTab,
        setActiveTab,
        uid,
        orientation,
        variant,
        registerTab,
        unregisterTab,
        tabOrder,
      }}
    >
      <div
        className={clsx(
          orientation === 'vertical' && 'flex gap-0',
          className,
        )}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

// ─── Tabs.List ──────────────────────────────────────────────────────────────────

export interface TabsListProps {
  children: ReactNode;
  className?: string;
  /** Label accessible pour le groupe d'onglets */
  'aria-label'?: string;
}

function TabsList({
  children,
  className,
  'aria-label': ariaLabel,
}: TabsListProps) {
  const { orientation, variant } = useTabsContext();
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    if (tabs.length === 0) return;

    const currentIndex = tabs.findIndex((t) => t === document.activeElement);

    const isNext =
      orientation === 'horizontal' ? e.key === 'ArrowRight' : e.key === 'ArrowDown';
    const isPrev =
      orientation === 'horizontal' ? e.key === 'ArrowLeft' : e.key === 'ArrowUp';

    if (isNext) {
      e.preventDefault();
      const next = tabs[(currentIndex + 1) % tabs.length];
      next.focus();
    } else if (isPrev) {
      e.preventDefault();
      const prev = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
      prev.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      tabs[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      tabs[tabs.length - 1].focus();
    }
  };

  const variantListStyles: Record<TabsVariant, string> = {
    underline: clsx(
      'border-b',
    ),
    pills: clsx(
      'p-1 rounded-lg gap-1',
    ),
    contained: clsx(
      'p-1 rounded-lg gap-0',
    ),
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={clsx(
        'flex',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        variantListStyles[variant],
        className,
      )}
      style={
        variant === 'underline'
          ? { borderColor: 'var(--border-base)' }
          : variant === 'pills' || variant === 'contained'
            ? { backgroundColor: 'var(--bg-input)' }
            : undefined
      }
    >
      {children}
    </div>
  );
}

// ─── Tabs.Tab ───────────────────────────────────────────────────────────────────

export interface TabProps {
  /** Valeur unique identifiant cet onglet */
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** Icône à gauche du label */
  icon?: ReactNode;
}

function Tab({ value, children, className, disabled = false, icon }: TabProps) {
  const { activeTab, setActiveTab, uid, variant } = useTabsContext();

  const tabId  = `${uid}-tab-${value}`;
  const panelId = `${uid}-panel-${value}`;
  const isActive = activeTab === value;

  // S'assurer que le premier onglet enregistré est l'actif initial si aucun n'est défini
  const { registerTab, unregisterTab } = useTabsContext();
  React.useEffect(() => {
    registerTab(value);
    return () => unregisterTab(value);
  }, [value, registerTab, unregisterTab]);

  const handleClick = () => {
    if (!disabled) setActiveTab(value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) setActiveTab(value);
    }
  };

  // Styles par variante
  const tabStyles = (): { className: string; style: React.CSSProperties } => {
    switch (variant) {
      case 'underline':
        return {
          className: clsx(
            'relative px-4 py-2.5 text-sm font-medium',
            'transition-colors duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--accent-primary)]',
            'focus-visible:rounded-md',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'border-b-2 -mb-px',
          ),
          style: {
            color: isActive
              ? 'var(--accent-primary)'
              : 'var(--text-muted)',
            borderBottomColor: isActive
              ? 'var(--accent-primary)'
              : 'transparent',
          },
        };

      case 'pills':
        return {
          className: clsx(
            'px-3 py-1.5 text-sm font-medium rounded-md',
            'transition-all duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--accent-primary)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          ),
          style: {
            color: isActive ? 'var(--btn-active-text)' : 'var(--text-muted)',
            backgroundColor: isActive ? 'var(--btn-active-bg)' : 'transparent',
          },
        };

      case 'contained':
        return {
          className: clsx(
            'px-3 py-1.5 text-sm font-medium rounded-md',
            'transition-all duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--accent-primary)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          ),
          style: {
            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
            backgroundColor: isActive ? 'var(--bg-panel)' : 'transparent',
            boxShadow: isActive ? 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.12))' : 'none',
          },
        };
    }
  };

  const { className: tabClassName, style: tabStyle } = tabStyles();

  return (
    <button
      id={tabId}
      role="tab"
      type="button"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={clsx(
        'inline-flex items-center gap-2 whitespace-nowrap',
        tabClassName,
        className,
      )}
      style={tabStyle}
    >
      {icon && (
        <span className="flex-shrink-0" aria-hidden>
          {icon}
        </span>
      )}
      {children}
      {/* Indicateur animé pour la variante underline */}
      {variant === 'underline' && isActive && (
        <motion.span
          layoutId={`${uid}-underline`}
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
          style={{ backgroundColor: 'var(--accent-primary)' }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
    </button>
  );
}

// ─── Tabs.Panel ─────────────────────────────────────────────────────────────────

export interface TabPanelProps {
  /** Doit correspondre à la value d'un <Tabs.Tab> */
  value: string;
  children: ReactNode;
  className?: string;
  /** Garder le DOM même quand l'onglet est inactif (pour préserver l'état) */
  keepMounted?: boolean;
}

function TabPanel({ value, children, className, keepMounted = false }: TabPanelProps) {
  const { activeTab, uid } = useTabsContext();
  const isActive = activeTab === value;

  const tabId   = `${uid}-tab-${value}`;
  const panelId = `${uid}-panel-${value}`;

  if (!isActive && !keepMounted) return null;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      hidden={!isActive}
      className={clsx('focus-visible:outline-none', className)}
    >
      {children}
    </div>
  );
}

// ─── Export composé ─────────────────────────────────────────────────────────────

export const Tabs = Object.assign(TabsRoot, {
  List:  TabsList,
  Tab:   Tab,
  Panel: TabPanel,
});

export type {
  TabsListProps,
  TabProps,
  TabPanelProps,
};
