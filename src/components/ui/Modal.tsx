/**
 * Modal — Primitive de modale compartimentée.
 *
 * API composée :
 *   <Modal open={open} onClose={onClose} title="Titre">
 *     <Modal.Header>          ← optionnel si `title` suffit
 *     <Modal.Body>            ← seul ce bloc défile
 *     <Modal.Footer>          ← actions collées en bas
 *   </Modal>
 *
 * Props de <Modal> :
 *   size     : 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
 *   tone     : 'default' | 'danger' | 'warning' | 'info'
 *   layer    : 'modal' | 'critical'  → sélectionne le palier z-index
 *   title    : string                → aria-labelledby auto
 *   hideClose: boolean               → masque le bouton ×
 *   onClose  : () => void
 *
 * Garanties :
 *   - Focus piégé dans la boîte (Tab/Shift+Tab)
 *   - Focus rendu au déclencheur à la fermeture
 *   - Défilement arrière-plan bloqué
 *   - Escape respecte l'empilement (le plus récent gagne)
 *   - Clic voile sécurisé (drag ne ferme pas)
 *   - Seul Modal.Body défile — Header et Footer restent fixes
 *   - Rendu dans #modal-root (portail) ou document.body
 *   - Animations via motion/react, respecte prefers-reduced-motion
 *   - ARIA complet : role="dialog", aria-modal, aria-labelledby,
 *     aria-describedby
 */

import React, {
  createContext,
  useContext,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useOverlay } from '../../hooks/useOverlay.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type ModalTone = 'default' | 'danger' | 'warning' | 'info';
export type ModalLayer = 'modal' | 'critical';

export interface ModalProps {
  /** Ouvert ou fermé */
  open: boolean;
  /** Appelé pour fermer (Escape, clic voile, bouton ×) */
  onClose: () => void;
  /** Titre du dialogue — alimente aria-labelledby */
  title?: string;
  /** Masquer le bouton × dans le header */
  hideClose?: boolean;
  /** Taille de la boîte */
  size?: ModalSize;
  /** Teinte du header et du bouton de confirmation */
  tone?: ModalTone;
  /** Palier z-index : 'modal' (var(--z-modal)) ou 'critical' (var(--z-critical)) */
  layer?: ModalLayer;
  /** Désactiver la fermeture par Escape */
  disableEscape?: boolean;
  /** Désactiver la fermeture par clic sur le voile */
  disableBackdropClick?: boolean;
  /** Contenu (Modal.Header / Modal.Body / Modal.Footer) */
  children: ReactNode;
  /** Classe CSS additionnelle sur la boîte */
  className?: string;
  /** aria-describedby : id de l'élément décrivant le dialogue */
  'aria-describedby'?: string;
}

// ─── Context interne ────────────────────────────────────────────────────────────

interface ModalContextValue {
  titleId: string;
  descId: string;
  tone: ModalTone;
  onClose: () => void;
  hideClose: boolean;
}

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('<Modal.Header/Body/Footer> must be used inside <Modal>');
  return ctx;
}

// ─── Taille → largeur max ───────────────────────────────────────────────────────

const SIZE_VAR: Record<ModalSize, string> = {
  xs:  'var(--modal-w-xs)',
  sm:  'var(--modal-w-sm)',
  md:  'var(--modal-w-md)',
  lg:  'var(--modal-w-lg)',
  xl:  'var(--modal-w-xl)',
  '2xl': 'var(--modal-w-2xl)',
};

// ─── Teinte → styles header / icône ────────────────────────────────────────────

const TONE_STYLES: Record<ModalTone, { border: string; accent: string }> = {
  default: {
    border: 'var(--border-base)',
    accent: 'var(--accent-primary)',
  },
  danger: {
    border: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
    accent: 'var(--color-error)',
  },
  warning: {
    border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
    accent: 'var(--color-warning)',
  },
  info: {
    border: 'color-mix(in srgb, var(--color-info) 30%, transparent)',
    accent: 'var(--color-info)',
  },
};

// ─── Palier z-index ─────────────────────────────────────────────────────────────

const LAYER_Z: Record<ModalLayer, string> = {
  modal:    'var(--z-modal)',
  critical: 'var(--z-critical)',
};

// ─── Portail cible ──────────────────────────────────────────────────────────────

function getPortalTarget(): HTMLElement {
  if (typeof document === 'undefined') return document.body;
  return document.getElementById('modal-root') ?? document.body;
}

// ═══════════════════════════════════════════════
//  COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════

function ModalRoot({
  open,
  onClose,
  title,
  hideClose = false,
  size = 'sm',
  tone = 'default',
  layer = 'modal',
  disableEscape = false,
  disableBackdropClick = false,
  children,
  className,
  'aria-describedby': ariaDescribedBy,
}: ModalProps) {
  const titleId = useId();
  const descId  = useId();
  const triggerRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement)
      : null,
  );

  const { containerRef, backdropProps } = useOverlay<HTMLDivElement>({
    open,
    onClose,
    disableEscape,
    disableBackdropClick,
    returnFocusTo: triggerRef.current,
  });

  const toneStyle = TONE_STYLES[tone];
  const zIndex    = LAYER_Z[layer];

  const content = (
    <ModalContext.Provider value={{ titleId, descId, tone, onClose, hideClose }}>
      <AnimatePresence>
        {open && (
          /* Voile */
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{
              zIndex,
              backgroundColor: 'var(--overlay-veil)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
            {...(backdropProps as React.HTMLAttributes<HTMLDivElement>)}
          >
            {/* Boîte */}
            <motion.div
              ref={containerRef}
              key="modal-box"
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-describedby={ariaDescribedBy ?? descId}
              className={clsx(
                'relative flex flex-col w-full rounded-2xl shadow-2xl',
                'outline-none',
                className,
              )}
              style={{
                maxWidth: SIZE_VAR[size],
                maxHeight: 'calc(100dvh - 32px)',
                backgroundColor: 'var(--bg-panel)',
                border: `1px solid ${toneStyle.border}`,
                color: 'var(--text-primary)',
              }}
              // Empêcher que le clic à l'intérieur de la boîte
              // remonte jusqu'au voile et déclenche onClose
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Header auto si `title` est fourni sans Modal.Header explicite */}
              {title && (
                <ModalHeaderInternal
                  titleId={titleId}
                  title={title}
                  tone={tone}
                  onClose={onClose}
                  hideClose={hideClose}
                />
              )}
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalContext.Provider>
  );

  return createPortal(content, getPortalTarget());
}

// ─── Header interne (utilisé quand `title` prop est fournie) ───────────────────

function ModalHeaderInternal({
  titleId,
  title,
  tone,
  onClose,
  hideClose,
}: {
  titleId: string;
  title: string;
  tone: ModalTone;
  onClose: () => void;
  hideClose: boolean;
}) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <div
      className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
      style={{ borderColor: toneStyle.border }}
    >
      <h2
        id={titleId}
        className="text-sm font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h2>
      {!hideClose && (
        <CloseButton onClose={onClose} />
      )}
    </div>
  );
}

// ─── Bouton × partagé ──────────────────────────────────────────────────────────

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
      style={{ color: 'var(--text-muted)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          'var(--ctrl-hover)';
        (e.currentTarget as HTMLButtonElement).style.color =
          'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          'transparent';
        (e.currentTarget as HTMLButtonElement).style.color =
          'var(--text-muted)';
      }}
      aria-label="Fermer"
    >
      <X size={14} />
    </button>
  );
}

// ═══════════════════════════════════════════════
//  SOUS-COMPOSANTS
// ═══════════════════════════════════════════════

// ─── Modal.Header ──────────────────────────────────────────────────────────────

export interface ModalHeaderProps {
  /** Contenu du header (icône, titre, badge…) */
  children: ReactNode;
  className?: string;
}

function ModalHeader({ children, className }: ModalHeaderProps) {
  const { titleId, tone, onClose, hideClose } = useModalContext();
  const toneStyle = TONE_STYLES[tone];

  return (
    <div
      id={titleId}
      className={clsx(
        'flex items-center justify-between px-5 py-4 border-b flex-shrink-0',
        className,
      )}
      style={{ borderColor: toneStyle.border }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {children}
      </div>
      {!hideClose && <CloseButton onClose={onClose} />}
    </div>
  );
}

// ─── Modal.Body ────────────────────────────────────────────────────────────────

export interface ModalBodyProps {
  /** Contenu principal — seul ce bloc défile */
  children: ReactNode;
  className?: string;
  /** Supprimer le padding interne */
  noPadding?: boolean;
}

function ModalBody({ children, className, noPadding = false }: ModalBodyProps) {
  const { descId } = useModalContext();
  return (
    <div
      id={descId}
      className={clsx(
        'flex-1 overflow-y-auto custom-scrollbar min-h-0',
        !noPadding && 'px-5 py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Modal.Footer ──────────────────────────────────────────────────────────────

export interface ModalFooterProps {
  /** Actions (boutons Annuler / Confirmer) */
  children: ReactNode;
  className?: string;
  /** Aligner les boutons à gauche au lieu de la droite */
  align?: 'left' | 'right' | 'center' | 'between';
}

const FOOTER_ALIGN: Record<NonNullable<ModalFooterProps['align']>, string> = {
  left:    'justify-start',
  right:   'justify-end',
  center:  'justify-center',
  between: 'justify-between',
};

function ModalFooter({ children, className, align = 'right' }: ModalFooterProps) {
  const { tone } = useModalContext();
  const toneStyle = TONE_STYLES[tone];
  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-5 py-4 border-t flex-shrink-0',
        FOOTER_ALIGN[align],
        className,
      )}
      style={{ borderColor: toneStyle.border }}
    >
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════
//  EXPORT COMPOSÉ
// ═══════════════════════════════════════════════

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body:   ModalBody,
  Footer: ModalFooter,
});

export type {
  ModalHeaderProps,
  ModalBodyProps,
  ModalFooterProps,
};
