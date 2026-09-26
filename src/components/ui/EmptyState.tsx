/**
 * EmptyState — Composant réutilisable pour les états vides.
 * Affiche un message clair avec action primaire et aide secondaire.
 */

import React from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  /** Icône illustrative */
  icon: LucideIcon;
  /** Titre court */
  title: string;
  /** Description explicative */
  description?: string;
  /** Texte du bouton d'action primaire */
  actionLabel?: string;
  /** Callback de l'action primaire */
  onAction?: () => void;
  /** Lien ou texte d'aide secondaire */
  secondaryLabel?: string;
  /** Callback de l'aide secondaire */
  onSecondary?: () => void;
  /** Taille du composant */
  size?: 'sm' | 'md' | 'lg';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  size = 'md',
}: EmptyStateProps) {
  const sizeConfig = {
    sm: { icon: 32, title: 'text-sm', desc: 'text-xs', gap: 'gap-2', pad: 'p-4' },
    md: { icon: 40, title: 'text-base', desc: 'text-sm', gap: 'gap-3', pad: 'p-6' },
    lg: { icon: 48, title: 'text-lg', desc: 'text-base', gap: 'gap-4', pad: 'p-8' },
  }[size];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex flex-col items-center justify-center text-center ${sizeConfig.gap} ${sizeConfig.pad}`}
    >
      <div
        className="flex items-center justify-center rounded-lg"
        style={{
          width: sizeConfig.icon + 16,
          height: sizeConfig.icon + 16,
          backgroundColor: 'var(--accent-subtle)',
        }}
      >
        <Icon
          size={sizeConfig.icon * 0.5}
          style={{ color: 'var(--accent-primary)' }}
        />
      </div>

      <div className="flex flex-col gap-1 max-w-[280px]">
        <h3
          className={`font-semibold ${sizeConfig.title}`}
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>
        {description && (
          <p
            className={`leading-relaxed ${sizeConfig.desc}`}
            style={{ color: 'var(--text-muted)' }}
          >
            {description}
          </p>
        )}
      </div>

      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-3 mt-1">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="px-4 py-2 rounded-md text-sm font-medium transition-all duration-150"
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="px-3 py-2 rounded-md text-xs font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
