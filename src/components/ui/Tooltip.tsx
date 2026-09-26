/**
 * Tooltip — Composant tooltip unifié avec positionnement intelligent,
 * raccourci clavier optionnel et accessibilité.
 * 
 * Utilisation:
 *   <Tooltip content="Description">
 *     <button>Hover me</button>
 *   </Tooltip>
 * 
 *   // Pour les boutons icônes avec accessibilité
 *   <Tooltip content="Supprimer" as="button" onClick={handleDelete} aria-label="Supprimer">
 *     <Trash2 />
 *   </Tooltip>
 */

import React, { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';

export interface TooltipProps {
  /** Contenu du tooltip */
  content: string;
  /** Raccourci clavier optionnel */
  shortcut?: string;
  /** Position préférée */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Délai d'apparition en ms */
  delay?: number;
  /** Enfants (trigger) */
  children: React.ReactNode;
  /** Désactiver le tooltip */
  disabled?: boolean;
  /** Élément HTML à rendre (par défaut: div) */
  as?: 'button' | 'div' | 'span' | 'a';
  /** Props supplémentaires à passer à l'élément trigger */
  className?: string;
  /** Style supplémentaire */
  style?: React.CSSProperties;
  /** onClick handler pour les boutons */
  onClick?: (e: React.MouseEvent) => void;
  /** onKeyDown handler */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** role pour l'accessibilité */
  role?: string;
  /** tabIndex pour la navigation clavier */
  tabIndex?: number;
  /** type pour les boutons */
  type?: 'button' | 'submit' | 'reset';
  /** disabled state */
  isDisabled?: boolean;
  /** Accessibilité: label pour les lecteurs d'écran. Si non fourni, utilise content */
  'aria-label'?: string;
}

export const Tooltip = forwardRef<HTMLElement, TooltipProps>(function Tooltip(
  {
    content,
    shortcut,
    position = 'top',
    delay = 400,
    children,
    disabled = false,
    as: Component = 'div',
    className = '',
    style = {},
    onClick,
    onKeyDown,
    role,
    tabIndex,
    type,
    isDisabled = false,
    'aria-label': ariaLabel,
  },
  ref
) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement>(null);

  const show = useCallback(() => {
    if (disabled || isDisabled) return;
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay, disabled, isDisabled]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const positionStyles: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowStyles: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 -mt-[3px] rotate-45',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 -mb-[3px] rotate-45',
    left: 'left-full top-1/2 -translate-y-1/2 -ml-[3px] rotate-45',
    right: 'right-full top-1/2 -translate-y-1/2 -mr-[3px] rotate-45',
  };

  // Gérer l'aria-label: utiliser le prop aria-label ou content par défaut
  const computedAriaLabel = ariaLabel || content;

  // Props communes pour l'élément trigger
  const triggerProps = {
    ref: (node: HTMLElement) => {
      triggerRef.current = node;
      if (ref) {
        if (typeof ref === 'function') ref(node);
        else (ref as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    className: clsx('relative inline-flex', className),
    style,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') hide();
      onKeyDown?.(e);
    },
    role,
    tabIndex: tabIndex ?? (onClick || role === 'button' ? 0 : undefined),
    type: Component === 'button' ? type : undefined,
    disabled: Component === 'button' ? (disabled || isDisabled) : undefined,
    'aria-label': computedAriaLabel,
  };

  return (
    <Component {...triggerProps}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className={clsx(
              'absolute pointer-events-none',
              'whitespace-nowrap px-2.5 py-1.5 rounded-lg',
              'text-xs font-medium',
              'shadow-lg backdrop-blur-sm',
              'flex items-center gap-2',
              positionStyles[position],
            )}
            style={{
              zIndex: 'var(--z-tooltip)' as any,
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-base)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <span>{content}</span>
            {shortcut && (
              <kbd
                className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-base)',
                }}
              >
                {shortcut}
              </kbd>
            )}
            <span
              className={clsx('absolute w-[6px] h-[6px]', arrowStyles[position])}
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderRight: '1px solid var(--border-base)',
                borderBottom: '1px solid var(--border-base)',
              }}
              aria-hidden
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Component>
  );
});

// Export des types pour compatibilité
export type { TooltipProps };
