/**
 * SeverityBadge.tsx
 * CVSS/OWASP-aligned severity indicator with animated glow on critical.
 */
import { motion } from 'motion/react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface SeverityBadgeProps {
  severity: Severity;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  cvssScore?: number;
  animated?: boolean;
}

const SEV: Record<Severity, {
  label: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}> = {
  critical: {
    label: 'Critique',
    color: '#dc2626',
    bg: 'rgba(220,38,38,0.12)',
    border: 'rgba(220,38,38,0.35)',
    glow: '0 0 12px rgba(220,38,38,0.45)',
    Icon: AlertCircle,
  },
  high: {
    label: 'Haute',
    color: '#ea580c',
    bg: 'rgba(234,88,12,0.12)',
    border: 'rgba(234,88,12,0.35)',
    glow: '0 0 8px rgba(234,88,12,0.35)',
    Icon: AlertTriangle,
  },
  medium: {
    label: 'Moyenne',
    color: '#d97706',
    bg: 'rgba(217,119,6,0.12)',
    border: 'rgba(217,119,6,0.30)',
    glow: '',
    Icon: AlertTriangle,
  },
  low: {
    label: 'Faible',
    color: '#2563eb',
    bg: 'rgba(37,99,235,0.10)',
    border: 'rgba(37,99,235,0.25)',
    glow: '',
    Icon: Info,
  },
  info: {
    label: 'Info',
    color: '#6b7280',
    bg: 'rgba(107,114,128,0.10)',
    border: 'rgba(107,114,128,0.20)',
    glow: '',
    Icon: Info,
  },
};

const SIZE = {
  sm: { px: '6px 8px', fontSize: '11px', iconSize: 11, gap: 4 },
  md: { px: '6px 10px', fontSize: '12px', iconSize: 13, gap: 5 },
  lg: { px: '8px 13px', fontSize: '13px', iconSize: 15, gap: 6 },
};

export function SeverityBadge({
  severity,
  size = 'md',
  showLabel = true,
  cvssScore,
  animated = false,
}: SeverityBadgeProps) {
  const cfg = SEV[severity];
  const sz = SIZE[size];
  const { Icon } = cfg;

  const badge = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sz.gap,
        padding: sz.px,
        fontSize: sz.fontSize,
        fontWeight: 600,
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.03em',
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 'var(--radius-md, 6px)',
        boxShadow: cfg.glow || undefined,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <Icon size={sz.iconSize} />
      {showLabel && <span>{cfg.label.toUpperCase()}</span>}
      {cvssScore !== undefined && (
        <span style={{ opacity: 0.75, fontWeight: 500 }}>{cvssScore.toFixed(1)}</span>
      )}
    </span>
  );

  if (animated && severity === 'critical') {
    return (
      <motion.span
        animate={{ boxShadow: ['0 0 8px rgba(220,38,38,0.4)', '0 0 18px rgba(220,38,38,0.7)', '0 0 8px rgba(220,38,38,0.4)'] }}
        transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        style={{ display: 'inline-flex', borderRadius: 'var(--radius-md, 6px)' }}
      >
        {badge}
      </motion.span>
    );
  }

  return badge;
}

/** Compact CVSS gauge bar (0–10 scale) */
export function CvssBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 9 ? '#dc2626' : score >= 7 ? '#ea580c' : score >= 4 ? '#d97706' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ height: '100%', background: color, borderRadius: 99 }}
        />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32, fontFamily: 'var(--font-mono)' }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}
