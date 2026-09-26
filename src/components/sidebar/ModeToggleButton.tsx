/**
 * ModeToggleButton — Toggle visuel Agent/Chat mode.
 * Extrait pour réduire la taille de la sidebar principale.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface ModeToggleButtonProps {
  mode: 'full' | 'ask';
  onToggle: () => void;
}

export function ModeToggleButton({ mode, onToggle }: ModeToggleButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isFull = mode === 'full';

  return (
    <div
      className="relative w-full h-11 flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={onToggle}
        className="w-9 h-5 rounded-full relative flex items-center overflow-hidden flex-shrink-0"
        style={{
          backgroundColor: isFull
            ? 'color-mix(in srgb, var(--color-warning) 18%, transparent)'
            : 'color-mix(in srgb, var(--color-info) 18%, transparent)',
          border: `1px solid ${isFull ? 'color-mix(in srgb, var(--color-warning) 31%, transparent)' : 'color-mix(in srgb, var(--color-info) 31%, transparent)'}`,
          boxShadow: isFull
            ? '0 0 8px color-mix(in srgb, var(--color-warning) 19%, transparent)'
            : '0 0 8px color-mix(in srgb, var(--color-info) 19%, transparent)',
          transition: 'background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
        }}
        title={`Mode actuel : ${isFull ? '⚡ Agent' : '💬 Chat'} — clic pour basculer`}
        aria-label={`Basculer le mode : ${isFull ? 'Agent' : 'Chat'}`}
      >
        {/* Track labels */}
        <span
          className="absolute left-1 text-xs font-bold uppercase tracking-wide pointer-events-none select-none"
          style={{
            color: isFull ? 'var(--color-warning)' : 'transparent',
            transition: 'color 0.2s ease',
          }}
          aria-hidden="true"
        >
          ⚡
        </span>
        <span
          className="absolute right-1 text-xs font-bold uppercase tracking-wide pointer-events-none select-none"
          style={{
            color: !isFull ? 'var(--color-info)' : 'transparent',
            transition: 'color 0.2s ease',
          }}
          aria-hidden="true"
        >
          💬
        </span>

        {/* Thumb */}
        <motion.div
          className="w-3.5 h-3.5 rounded-full absolute top-0.5"
          animate={{ left: isFull ? '0.5' : '5' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={{
            backgroundColor: isFull ? 'var(--color-warning)' : 'var(--color-info)',
            boxShadow: isFull ? '0 0 8px color-mix(in srgb, var(--color-warning) 50%, transparent)' : '0 0 8px color-mix(in srgb, var(--color-info) 50%, transparent)',
          }}
        />
      </motion.button>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute left-full ml-2.5 pointer-events-none whitespace-nowrap"
            style={{ zIndex: 'var(--z-tooltip)' as any }}
            style={{ top: '50%', transform: 'translateY(-50%)' }}
            role="tooltip"
          >
            <div
              className="absolute top-1/2 -left-1 -translate-y-1/2"
              style={{
                width: 0, height: 0,
                borderTop: '1px solid transparent',
                borderBottom: '1px solid transparent',
                borderRight: '1px solid var(--border-strong)',
              }}
              aria-hidden="true"
            />
            <div
              className="absolute top-1/2 -left-0.5 -translate-y-1/2"
              style={{
                width: 0, height: 0,
                borderTop: '0.75px solid transparent',
                borderBottom: '0.75px solid transparent',
                borderRight: '0.75px solid var(--bg-ctrl)',
              }}
              aria-hidden="true"
            />
            <div
              className="px-2.5 py-1.5 rounded-lg"
              style={{
                backgroundColor: 'var(--bg-ctrl)',
                border: '1px solid var(--border-strong)',
                boxShadow: 'var(--shadow-md)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Mode : <span style={{ color: isFull ? 'var(--color-warning)' : 'var(--color-info)' }}>{isFull ? '⚡ Agent' : '💬 Chat'}</span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
