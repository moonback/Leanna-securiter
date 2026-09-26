/**
 * QuitConfirmDialog — Modale de confirmation pour quitter l'application Electron.
 *
 * Alignée sur le langage visuel des autres modales du projet
 * (CriticalEditConfirm, TelegramStatusModal, etc.) :
 *   - <Modal.Header> avec tuile icône + titre/sous-titre
 *   - Cartes internes rounded-xl sur --bg-secondary / --border-base
 *   - Icônes lucide-react, échelle typographique standard (text-xs/text-sm)
 *   - Composant <Button> pour les actions
 *
 * Le seul accent décoratif conservé est le léger "battement" de la tuile
 * icône (respecte prefers-reduced-motion).
 */

import { Power, AlertTriangle, ShieldCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';

interface QuitConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function QuitConfirmDialog({ open, onClose, onConfirm }: QuitConfirmDialogProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      tone="danger"
      layer="critical"
      aria-describedby="quit-desc"
    >
      <Modal.Header>
        <div className="flex items-center gap-3">
          {/* Tuile icône — même gabarit que les autres modales */}
          <motion.div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--color-error-subtle)' }}
            animate={prefersReducedMotion ? undefined : { scale: [1, 1.06, 1] }}
            transition={{ duration: 3.4, ease: 'easeInOut', repeat: Infinity }}
          >
            <Power className="w-5 h-5" style={{ color: 'var(--color-error)' }} />
          </motion.div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Quitter Leanna
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Arrêt de l'Intelligence Core
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-3">
          {/* Carte d'avertissement */}
          <div
            className="rounded-xl p-4 flex items-start gap-3"
            style={{
              backgroundColor: 'var(--color-warning-subtle)',
              border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
            }}
          >
            <AlertTriangle
              className="w-4 h-4 mt-0.5 flex-shrink-0"
              style={{ color: 'var(--color-warning)' }}
            />
            <p id="quit-desc" className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Les modifications non enregistrées pourraient être perdues.{' '}
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                Confirmer l'arrêt du système ?
              </span>
            </p>
          </div>

          
        </div>
      </Modal.Body>

      <Modal.Footer>
        {/* Annuler reçoit le focus auto (premier focusable) */}
        <Button variant="secondary" size="sm" onClick={onClose}>
          Annuler
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onConfirm}
          iconLeft={<Power className="w-3.5 h-3.5" />}
        >
          Quitter
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
