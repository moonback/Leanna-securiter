import { motion } from 'motion/react';

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function Toggle({ checked, onChange, disabled, 'aria-label': ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className="w-10 h-6 rounded-full relative flex-shrink-0 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-40 disabled:pointer-events-none"
      style={{ backgroundColor: checked ? 'var(--accent-primary)' : 'var(--border-strong)' }}
    >
      <motion.div
        className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      />
    </button>
  );
}
