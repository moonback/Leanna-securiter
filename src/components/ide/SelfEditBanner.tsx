import React from 'react';
import { AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SelfEditBannerProps {
  /** Le fichier en cours d'édition par l'IA */
  editingFile: string | null;
  /** Si le fichier est marqué "critique" */
  isCritical?: boolean;
  /** Callback pour déclencher un rollback */
  onRollback?: () => void;
  /** Callback pour valider le changement */
  onAccept?: () => void;
}

/**
 * Bandeau discret affiché quand l'IA modifie un fichier actuellement ouvert.
 * Évite la confusion "pourquoi mon fichier bouge tout seul" et offre un rollback rapide.
 */
export const SelfEditBanner = React.memo(function SelfEditBanner({
  editingFile,
  isCritical = false,
  onRollback,
  onAccept,
}: SelfEditBannerProps) {
  return (
    <AnimatePresence>
      {editingFile && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div
            className="flex items-center gap-2.5 px-3.5 py-2 text-xs border-b"
            style={{
              borderColor: isCritical
                ? 'color-mix(in srgb, var(--color-error) 30%, transparent)'
                : 'color-mix(in srgb, var(--color-accent-alt) 20%, transparent)',
              backgroundColor: isCritical
                ? 'color-mix(in srgb, var(--color-error) 6%, transparent)'
                : 'color-mix(in srgb, var(--color-accent-alt) 4%, transparent)',
            }}
          >
            <AlertTriangle
              size={13}
              style={{ color: isCritical ? 'var(--color-error)' : 'var(--color-accent-alt)', flexShrink: 0 }}
            />
            <span style={{ color: 'var(--text-primary)' }} className="flex-1 truncate">
              <span className="font-medium">Auto-modification</span>
              {' — '}
              <span className="font-mono opacity-80">{editingFile}</span>
              {isCritical && (
                <span className="ml-1.5 text-xs px-1 py-0.5 rounded font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 15%, transparent)', color: 'var(--color-error)' }}>
                  CRITIQUE
                </span>
              )}
            </span>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {onRollback && (
                <button
                  onClick={onRollback}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium transition-colors hover:bg-white/10"
                  style={{ color: 'var(--color-warning)' }}
                  title="Annuler ce changement"
                >
                  <RotateCcw size={11} />
                  Rollback
                </button>
              )}
              {onAccept && (
                <button
                  onClick={onAccept}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium transition-colors hover:bg-white/10"
                  style={{ color: 'var(--color-success)' }}
                  title="Accepter le changement"
                >
                  <CheckCircle2 size={11} />
                  OK
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
