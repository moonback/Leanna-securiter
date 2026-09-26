import React from 'react';
import { motion } from 'motion/react';
import { clsx } from 'clsx';

interface PanelProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** Extra buttons/actions rendered in the header right */
  actions?: React.ReactNode;
  className?: string;
}

export function Panel({ title, icon, children, actions, className }: PanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={clsx('backdrop-blur-sm rounded-lg p-5 shadow-sm w-full', className)}
      style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-xs font-bold tracking-widest uppercase flex items-center gap-2"
          style={{ color: 'var(--text-muted)' }}
        >
          {icon}
          {title}
        </h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </motion.div>
  );
}
