/**
 * AgentTaskCard — Carte de tâche agent standardisée.
 * Affiche l'objectif, les fichiers concernés, l'état, les étapes,
 * la durée et les actions disponibles.
 */

import React from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2, Loader2, AlertCircle, Clock,
  FileText, X, Play, RotateCcw, Eye,
} from 'lucide-react';
import { StatusBadge, type StatusType } from './StatusBadge.js';

export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  duration?: string;
}

export interface AgentTaskCardProps {
  /** Objectif de la tâche */
  objective: string;
  /** Statut global */
  status: StatusType;
  /** Fichiers touchés */
  files?: string[];
  /** Étapes de la tâche */
  steps?: TaskStep[];
  /** Durée totale */
  duration?: string;
  /** Résumé final */
  summary?: string;
  /** Actions */
  onStop?: () => void;
  onRetry?: () => void;
  onViewDiff?: () => void;
  onDismiss?: () => void;
}

export function AgentTaskCard({
  objective,
  status,
  files = [],
  steps = [],
  duration,
  summary,
  onStop,
  onRetry,
  onViewDiff,
  onDismiss,
}: AgentTaskCardProps) {
  const isRunning = status === 'running';
  const isDone = status === 'success';
  const isError = status === 'error';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-panel)',
        border: `1px solid ${isRunning ? 'var(--accent-primary)' : 'var(--border-base)'}`,
        boxShadow: isRunning ? '0 0 12px var(--accent-subtle)' : 'var(--shadow-sm)',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-base)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={status} size="sm" />
            {duration && (
              <span
                className="text-sm font-mono tabular-nums"
                style={{ color: 'var(--text-dimmed)' }}
              >
                {duration}
              </span>
            )}
          </div>
          <p
            className="text-sm font-medium leading-snug line-clamp-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {objective}
          </p>
        </div>
        {onDismiss && !isRunning && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-md transition-colors hover:bg-[var(--ctrl-hover)]"
            style={{ color: 'var(--text-dimmed)' }}
            aria-label="Fermer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Steps timeline */}
      {steps.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2">
              {step.status === 'running' && <Loader2 size={10} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />}
              {step.status === 'done' && <CheckCircle2 size={10} style={{ color: 'var(--color-success)' }} />}
              {step.status === 'error' && <AlertCircle size={10} style={{ color: 'var(--color-error)' }} />}
              {step.status === 'pending' && <Clock size={10} style={{ color: 'var(--text-dimmed)' }} />}
              <span
                className="text-xs flex-1 truncate"
                style={{
                  color: step.status === 'running' ? 'var(--text-primary)' :
                         step.status === 'done' ? 'var(--text-secondary)' :
                         step.status === 'error' ? 'var(--color-error)' : 'var(--text-dimmed)',
                  fontWeight: step.status === 'running' ? 500 : 400,
                }}
              >
                {step.label}
              </span>
              {step.duration && (
                <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                  {step.duration}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Files touched */}
      {files.length > 0 && (
        <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
          <div className="flex flex-wrap gap-1.5">
            {files.slice(0, 5).map((file) => (
              <span
                key={file}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm font-mono"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-base)',
                }}
              >
                <FileText size={9} />
                {file.split(/[/\\]/).pop()}
              </span>
            ))}
            {files.length > 5 && (
              <span className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
                +{files.length - 5} fichiers
              </span>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {summary}
          </p>
        </div>
      )}

      {/* Actions */}
      {(onStop || onRetry || onViewDiff) && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-t"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
        >
          {isRunning && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
                color: 'var(--color-error)',
                border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)',
              }}
            >
              <X size={10} />
              Arrêter
            </button>
          )}
          {isError && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent-primary)',
                border: '1px solid rgba(0, 194, 255, 0.25)',
              }}
            >
              <RotateCcw size={10} />
              Réessayer
            </button>
          )}
          {(isDone || isError) && onViewDiff && (
            <button
              type="button"
              onClick={onViewDiff}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-base)',
              }}
            >
              <Eye size={10} />
              Voir les changements
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
