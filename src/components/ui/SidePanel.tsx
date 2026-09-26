/**
 * SidePanel — Panneau latéral unifié avec cycle de vie standard.
 * Supporte les modes : closed, open, pinned et overlay.
 * Redimensionnable, persistance de taille et restauration du focus.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Pin, PinOff, GripVertical } from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';

export type SidePanelPosition = 'left' | 'right';
export type SidePanelMode = 'closed' | 'open' | 'pinned' | 'overlay';

export interface SidePanelProps {
  /** Visible ou non */
  open: boolean;
  /** Fermer le panneau */
  onClose: () => void;
  /** Titre du panneau */
  title: string;
  /** Icône du titre */
  icon?: LucideIcon;
  /** Côté du panneau */
  position?: SidePanelPosition;
  /** Largeur par défaut en px */
  defaultWidth?: number;
  /** Largeur min en px */
  minWidth?: number;
  /** Largeur max en px */
  maxWidth?: number;
  /** Clé localStorage pour persister la largeur */
  storageKey?: string;
  /** Mode overlay (flottant au-dessus du contenu) */
  overlay?: boolean;
  /** Actions dans le header */
  actions?: React.ReactNode;
  /** Contenu */
  children: React.ReactNode;
  /** Classe CSS additionnelle */
  className?: string;
}

export function SidePanel({
  open,
  onClose,
  title,
  icon: Icon,
  position = 'right',
  defaultWidth = 320,
  minWidth = 240,
  maxWidth = 600,
  storageKey,
  overlay = false,
  actions,
  children,
  className,
}: SidePanelProps) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`sidepanel-width-${storageKey}`);
      if (saved) return Math.min(Math.max(Number(saved), minWidth), maxWidth);
    }
    return defaultWidth;
  });

  const [pinned, setPinned] = useState(false);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save width to localStorage
  useEffect(() => {
    if (storageKey && !resizing) {
      localStorage.setItem(`sidepanel-width-${storageKey}`, String(width));
    }
  }, [width, storageKey, resizing]);

  // Focus management
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the panel close button after animation
      const timer = setTimeout(() => {
        panelRef.current?.querySelector<HTMLButtonElement>('[data-panel-close]')?.focus();
      }, 200);
      return () => clearTimeout(timer);
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open || pinned) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, pinned, onClose]);

  // Resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const handleMove = (ev: MouseEvent) => {
      const delta = position === 'right'
        ? startX - ev.clientX
        : ev.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth);
      setWidth(newWidth);
    };

    const handleUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [width, position, minWidth, maxWidth]);

  const slideDirection = position === 'right' ? { x: 24 } : { x: -24 };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay backdrop (only in overlay mode) */}
          {overlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={pinned ? undefined : onClose}
            />
          )}

          <motion.aside
            ref={panelRef}
            initial={{ opacity: 0, ...slideDirection }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, ...slideDirection }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={clsx(
              'flex flex-col h-full',
              overlay ? 'fixed z-50 top-0 bottom-0 shadow-2xl' : 'relative',
              overlay && position === 'right' && 'right-0',
              overlay && position === 'left' && 'left-0',
              className,
            )}
            style={{
              width,
              backgroundColor: 'var(--bg-panel)',
              borderLeft: position === 'right' ? '1px solid var(--border-base)' : undefined,
              borderRight: position === 'left' ? '1px solid var(--border-base)' : undefined,
            }}
            role="complementary"
            aria-label={title}
          >
            {/* Resize handle */}
            <div
              className={clsx(
                'absolute top-0 bottom-0 w-1 cursor-col-resize group z-10',
                'hover:bg-[var(--accent-primary)] hover:opacity-30 transition-opacity',
                position === 'right' ? 'left-0' : 'right-0',
                resizing && 'bg-[var(--accent-primary)] opacity-40',
              )}
              onMouseDown={handleResizeStart}
              title="Redimensionner"
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical size={10} style={{ color: 'var(--text-dimmed)' }} />
              </div>
            </div>

            {/* Header */}
            <header
              className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-base)' }}
            >
              {Icon && (
                <div
                  className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0"
                  style={{ backgroundColor: 'var(--accent-subtle)' }}
                >
                  <Icon size={14} style={{ color: 'var(--accent-primary)' }} />
                </div>
              )}
              <h2
                className="flex-1 text-sm font-semibold truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {title}
              </h2>

              {actions}

              {/* Pin toggle */}
              <button
                type="button"
                onClick={() => setPinned(!pinned)}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  color: pinned ? 'var(--accent-primary)' : 'var(--text-dimmed)',
                  backgroundColor: pinned ? 'var(--accent-subtle)' : 'transparent',
                }}
                aria-label={pinned ? 'Détacher le panneau' : 'Épingler le panneau'}
                title={pinned ? 'Détacher' : 'Épingler'}
              >
                {pinned ? <Pin size={12} /> : <PinOff size={12} />}
              </button>

              {/* Close */}
              <button
                type="button"
                data-panel-close
                onClick={onClose}
                className="p-1.5 rounded-md transition-colors hover:bg-[var(--ctrl-hover)]"
                style={{ color: 'var(--text-dimmed)' }}
                aria-label="Fermer le panneau"
              >
                <X size={14} />
              </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
