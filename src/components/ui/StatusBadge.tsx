/**
 * StatusBadge — Badge sémantique accessible et cohérent.
 * Associe couleur, icône et libellé pour chaque état.
 */

import React from 'react';
import {
  CheckCircle2, AlertCircle, Loader2, Clock,
  Pause, XCircle, Wifi, WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StatusType =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'
  | 'warning'
  | 'waiting'
  | 'paused'
  | 'connected'
  | 'disconnected';

interface StatusConfig {
  icon: LucideIcon;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const STATUS_MAP: Record<StatusType, StatusConfig> = {
  idle: {
    icon: Clock,
    label: 'En attente',
    color: 'var(--text-muted)',
    bgColor: 'var(--bg-input)',
    borderColor: 'var(--border-base)',
  },
  running: {
    icon: Loader2,
    label: 'En cours',
    color: 'var(--accent-primary)',
    bgColor: 'var(--accent-subtle)',
    borderColor: 'rgba(0, 194, 255, 0.25)',
  },
  success: {
    icon: CheckCircle2,
    label: 'Terminé',
    color: 'var(--color-success)',
    bgColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--color-success) 25%, transparent)',
  },
  error: {
    icon: XCircle,
    label: 'Erreur',
    color: 'var(--color-error)',
    bgColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)',
  },
  warning: {
    icon: AlertCircle,
    label: 'Attention',
    color: 'var(--color-warning)',
    bgColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--color-warning) 25%, transparent)',
  },
  waiting: {
    icon: Clock,
    label: 'En attente d\'approbation',
    color: 'var(--color-info)',
    bgColor: 'color-mix(in srgb, var(--color-info) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--color-info) 25%, transparent)',
  },
  paused: {
    icon: Pause,
    label: 'En pause',
    color: 'var(--text-muted)',
    bgColor: 'var(--bg-input)',
    borderColor: 'var(--border-base)',
  },
  connected: {
    icon: Wifi,
    label: 'Connecté',
    color: 'var(--color-success)',
    bgColor: 'color-mix(in srgb, var(--color-success) 8%, transparent)',
    borderColor: 'color-mix(in srgb, var(--color-success) 20%, transparent)',
  },
  disconnected: {
    icon: WifiOff,
    label: 'Déconnecté',
    color: 'var(--text-muted)',
    bgColor: 'var(--bg-input)',
    borderColor: 'var(--border-base)',
  },
};

export interface StatusBadgeProps {
  status: StatusType;
  /** Override du label par défaut */
  label?: string;
  /** Afficher uniquement le dot (sans texte) */
  dotOnly?: boolean;
  /** Taille */
  size?: 'sm' | 'md';
  /** Pulse animation pour les états actifs */
  pulse?: boolean;
}

export function StatusBadge({
  status,
  label,
  dotOnly = false,
  size = 'md',
  pulse,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status];
  const Icon = config.icon;
  const displayLabel = label ?? config.label;
  const isAnimated = status === 'running' || pulse;
  const dotSize = size === 'sm' ? 6 : 8;
  const fontSize = size === 'sm' ? '0.75rem' : '0.875rem'; // text-sm (12px) / text-base (14px)
  const iconSize = size === 'sm' ? 12 : 14;
  const padding = size === 'sm' ? '0.125rem 0.375rem' : '0.25rem 0.5rem'; // ~2px 6px / ~4px 8px

  if (dotOnly) {
    return (
      <span
        className="inline-flex items-center justify-center relative"
        role="status"
        aria-label={displayLabel}
        title={displayLabel}
      >
        {isAnimated && (
          <span
            className="absolute rounded-full animate-ping"
            style={{
              width: dotSize,
              height: dotSize,
              backgroundColor: config.color,
              opacity: 0.4,
            }}
          />
        )}
        <span
          className="rounded-full relative"
          style={{
            width: dotSize,
            height: dotSize,
            backgroundColor: config.color,
          }}
        />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-medium"
      style={{
        padding,
        fontSize,
        backgroundColor: config.bgColor,
        color: config.color,
        border: `1px solid ${config.borderColor}`,
      }}
      role="status"
      aria-label={displayLabel}
    >
      {status === 'running' ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        <Icon size={iconSize} />
      )}
      <span>{displayLabel}</span>
    </span>
  );
}
