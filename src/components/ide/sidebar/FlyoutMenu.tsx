import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

// ─── FlyoutMenu Container ────────────────────────────────────────────────────

interface FlyoutMenuProps {
  children: React.ReactNode;
  align?: 'center' | 'bottom';
}

export function FlyoutMenu({ children, align = 'center' }: FlyoutMenuProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -12, scale: 0.92 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="absolute left-full ml-2 flex flex-col z-50 overflow-hidden rounded-2xl backdrop-blur-sm"
      style={{
        ...(align === 'bottom' ? { bottom: 0 } : { top: '50%', transform: 'translateY(-50%)' }),
        minWidth: '220px',
        backgroundColor: 'var(--ide-panel-bg)',
        border: '1px solid var(--ide-shell-border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {children}
    </motion.div>
  );
}

// ─── FlyoutHeader ────────────────────────────────────────────────────────────

export function FlyoutHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-4 pt-3 pb-2.5 flex items-center justify-between select-none"
      style={{ borderBottom: '1px solid var(--ide-shell-border)' }}
    >
      <span
        className="text-xs font-bold uppercase tracking-[0.15em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {children}
      </span>
    </div>
  );
}

// ─── FlyoutItem ──────────────────────────────────────────────────────────────

interface FlyoutItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
  mono?: boolean;
  /** Optional color dot indicator (e.g. 'var(--color-info)') */
  dot?: string;
}

export function FlyoutItem({ icon: Icon, label, active, onClick, danger, mono, dot }: FlyoutItemProps) {
  return (
    <button
      className={`group flex items-center gap-3 px-3 py-2 text-left w-full transition duration-250 ${mono ? 'font-mono text-sm' : 'text-sm'}`}
      style={{
        color: danger ? 'var(--color-error)' : active ? 'var(--text-primary)' : 'var(--text-secondary)',
        backgroundColor: active ? 'var(--ide-sidebar-active)' : 'transparent',
        margin: '0.25rem',
        width: 'calc(100% - 0.5rem)',
        borderRadius: '12px',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--ide-sidebar-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* Icon badge */}
      <div
        className="w-6.5 h-6.5 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors duration-100"
        style={{
          backgroundColor: danger
            ? 'var(--color-error-subtle)'
            : active
              ? 'var(--accent-subtle)'
              : 'var(--ide-sidebar-item-bg)' ,
        }}
      >
        <Icon
          size={13}
          style={{
            color: danger
              ? 'var(--color-error)'
              : active
                ? 'var(--accent-primary)'
                : 'var(--text-muted)',
            filter: 'none',
            transition: 'filter 0.25s ease',
          }}
        />
      </div>

      <span className="flex-1 truncate font-medium">{label}</span>

      {dot && (
        <span
          className="ml-1 h-1.5 w-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: dot, boxShadow: `0 0 5px ${dot}80` }}
        />
      )}

      {active && !dot && (
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            backgroundColor: 'var(--accent-primary)',
            boxShadow: 'none',
          }}
        />
      )}
    </button>
  );
}

// ─── FlyoutSeparator ─────────────────────────────────────────────────────────

export function FlyoutSeparator() {
  return (
    <div className="my-1 mx-4 h-px" style={{ backgroundColor: 'var(--border-base)', opacity: 0.6 }} />
  );
}
