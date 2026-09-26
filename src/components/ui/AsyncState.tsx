/**
 * AsyncState — Les quatre états d'un panneau de données.
 *
 * Rend l'un des quatre états exclusifs d'une source de données asynchrone :
 *   loading  — Squelettes animés (nombre configurable)
 *   error    — Message d'erreur + bouton Réessayer
 *   empty    — Écran vide avec illustration, message et action de sortie
 *   content  — Les enfants (données chargées)
 *
 * Utilisation déclarative (recommandé) :
 *   <AsyncState
 *     loading={isLoading}
 *     error={error?.message}
 *     empty={items.length === 0}
 *     onRetry={refetch}
 *     emptyTitle="Aucun agent"
 *     emptyMessage="Créez votre premier agent pour commencer."
 *     emptyAction={{ label: 'Créer un agent', onClick: openCreate }}
 *   >
 *     <AgentList items={items} />
 *   </AsyncState>
 *
 * Utilisation par sous-composants (avancé) :
 *   <AsyncState.Loading rows={3} />
 *   <AsyncState.Error message="Timeout" onRetry={refetch} />
 *   <AsyncState.Empty title="…" message="…" action={{ … }} />
 */

import React, { type ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, RefreshCw, Inbox } from 'lucide-react';
import { clsx } from 'clsx';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AsyncStateAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

export interface AsyncStateProps {
  /** Afficher l'état de chargement */
  loading?: boolean;
  /** Afficher l'état d'erreur avec ce message */
  error?: string | null;
  /** Afficher l'état vide */
  empty?: boolean;
  /** Callback de la tentative retry */
  onRetry?: () => void;
  /** Titre de l'état vide */
  emptyTitle?: string;
  /** Message de l'état vide */
  emptyMessage?: string;
  /** Action principale de l'état vide */
  emptyAction?: AsyncStateAction;
  /** Nombre de lignes squelettes à afficher */
  skeletonRows?: number;
  /** Contenu à afficher dans l'état content */
  children?: ReactNode;
  /** Classe CSS additionnelle du conteneur */
  className?: string;
}

// ─── Sous-composant : Loading ───────────────────────────────────────────────────

export interface AsyncLoadingProps {
  /** Nombre de rangées squelettes (défaut : 3) */
  rows?: number;
  className?: string;
}

function AsyncLoading({ rows = 3, className }: AsyncLoadingProps) {
  return (
    <div
      className={clsx('flex flex-col gap-3 p-4', className)}
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement en cours…"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          {/* Avatar / icône placeholder */}
          <div
            className="w-8 h-8 rounded-lg flex-shrink-0"
            style={{ backgroundColor: 'var(--border-base)', opacity: 0.6 }}
          />
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            {/* Ligne de titre */}
            <div
              className="h-3 rounded-md"
              style={{
                backgroundColor: 'var(--border-base)',
                width: `${60 + (i % 3) * 15}%`,
                opacity: 0.6,
              }}
            />
            {/* Ligne de détail */}
            <div
              className="h-2.5 rounded-md"
              style={{
                backgroundColor: 'var(--border-base)',
                width: `${35 + (i % 4) * 10}%`,
                opacity: 0.4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Sous-composant : Error ─────────────────────────────────────────────────────

export interface AsyncErrorProps {
  /** Message d'erreur à afficher */
  message?: string;
  /** Callback de nouvelle tentative */
  onRetry?: () => void;
  className?: string;
}

function AsyncError({ message, onRetry, className }: AsyncErrorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={clsx(
        'flex flex-col items-center justify-center gap-4 p-8 text-center',
        className,
      )}
      role="alert"
    >
      {/* Icône */}
      <div
        className="w-10 h-10 flex items-center justify-center rounded-xl"
        style={{ backgroundColor: 'var(--color-error-subtle)' }}
      >
        <AlertCircle size={20} style={{ color: 'var(--color-error)' }} />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Impossible de charger les données
        </p>
        {message && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {message}
          </p>
        )}
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'text-sm font-medium transition-all duration-150',
            'hover:opacity-90 active:scale-[0.97]',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--accent-primary)]',
          )}
          style={{
            backgroundColor: 'var(--color-error-subtle)',
            border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)',
            color: 'var(--color-error)',
          }}
        >
          <RefreshCw size={14} aria-hidden />
          Réessayer
        </button>
      )}
    </motion.div>
  );
}

// ─── Sous-composant : Empty ─────────────────────────────────────────────────────

export interface AsyncEmptyProps {
  /** Titre principal */
  title?: string;
  /** Message explicatif */
  message?: string;
  /** Action de sortie (ex. "Créer un agent") */
  action?: AsyncStateAction;
  /** Icône personnalisée (remplace Inbox par défaut) */
  icon?: ReactNode;
  className?: string;
}

function AsyncEmpty({
  title = 'Aucun élément',
  message,
  action,
  icon,
  className,
}: AsyncEmptyProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={clsx(
        'flex flex-col items-center justify-center gap-4 p-8 text-center',
        className,
      )}
    >
      {/* Icône */}
      <div
        className="w-12 h-12 flex items-center justify-center rounded-xl"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
      >
        {icon ?? <Inbox size={22} style={{ color: 'var(--accent-primary)' }} />}
      </div>

      <div className="flex flex-col gap-1.5 max-w-xs">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        {message && (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {message}
          </p>
        )}
      </div>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'text-sm font-medium transition-all duration-150',
            'hover:opacity-90 active:scale-[0.97]',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--accent-primary)]',
          )}
          style={{
            backgroundColor: 'var(--accent-primary)',
            border: '1px solid transparent',
            color: 'white',
          }}
        >
          {action.icon && <span aria-hidden>{action.icon}</span>}
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

// ─── Composant principal (déclaratif) ───────────────────────────────────────────

function AsyncStateRoot({
  loading = false,
  error,
  empty = false,
  onRetry,
  emptyTitle,
  emptyMessage,
  emptyAction,
  skeletonRows = 3,
  children,
  className,
}: AsyncStateProps) {
  if (loading) {
    return <AsyncLoading rows={skeletonRows} className={className} />;
  }

  if (error) {
    return (
      <AsyncError message={error} onRetry={onRetry} className={className} />
    );
  }

  if (empty) {
    return (
      <AsyncEmpty
        title={emptyTitle}
        message={emptyMessage}
        action={emptyAction}
        className={className}
      />
    );
  }

  return <>{children}</>;
}

// ─── Export composé ─────────────────────────────────────────────────────────────

export const AsyncState = Object.assign(AsyncStateRoot, {
  Loading: AsyncLoading,
  Error:   AsyncError,
  Empty:   AsyncEmpty,
});

export type {
  AsyncLoadingProps,
  AsyncErrorProps,
  AsyncEmptyProps,
};
