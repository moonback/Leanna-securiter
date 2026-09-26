import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Monitor, Trash2 } from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { IconButton } from '../ui/IconButton.js';
import type { LogEntry } from '../../hooks/useLiveAPI.js';

// Colour per log type
const LOG_COLORS: Record<LogEntry['type'], string> = {
  system: 'var(--text-secondary)',
  action: 'var(--accent-primary)',   // sky-400 — always visible on both themes
  error:  'var(--color-error)',   // red-400
  info:   'var(--color-success)',   // emerald-400
};

const LOG_PREFIXES: Record<LogEntry['type'], string> = {
  system: '·',
  action: '⚡',
  error:  '✕',
  info:   '✓',
};

interface SystemLogsPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const SystemLogsPanel = React.memo(function SystemLogsPanel({ logs, onClear }: SystemLogsPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new log
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <Panel
      title="System Logs"
      icon={<Monitor className="w-4 h-4" />}
      actions={
        <IconButton
          variant="default"
          icon={<Trash2 className="w-3.5 h-3.5" />}
          onClick={onClear}
          tooltip="Clear logs"
          aria-label="Clear logs"
          className="p-1.5 rounded-lg"
        />
      }
    >
      <div
        className="h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar"
        role="log"
        aria-live="polite"
        aria-label="System activity log"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-4">
            <Monitor className="w-6 h-6" style={{ color: 'var(--text-dimmed)' }} />
            <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              En attente de connexion...
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {logs.map(log => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-start gap-2 font-mono text-sm leading-tight pl-1 py-0.5 rounded"
              >
                {/* Prefix icon */}
                <span className="flex-shrink-0 w-3 text-center" style={{ color: LOG_COLORS[log.type] }}>
                  {LOG_PREFIXES[log.type]}
                </span>
                {/* Timestamp */}
                <span className="flex-shrink-0 tabular-nums" style={{ color: 'var(--text-dimmed)' }}>
                  {formatTime(log.timestamp)}
                </span>
                {/* Message */}
                <span style={{ color: LOG_COLORS[log.type] }}>{log.msg}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </Panel>
  );
});
