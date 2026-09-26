import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Trash2, User, Cpu } from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { IconButton } from '../ui/IconButton.js';
import type { TranscriptEntry } from '../../hooks/useLiveAPI.js';
import { useProfile } from '../../context/UserProfileContext.js';

interface SessionTranscriptPanelProps {
  transcript: TranscriptEntry[];
  onClear: () => void;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export const SessionTranscriptPanel = React.memo(function SessionTranscriptPanel({
  transcript,
  onClear,
}: SessionTranscriptPanelProps) {
  const { profile } = useProfile();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length]);

  return (
    <Panel
      title="Session"
      icon={<MessageSquare className="w-4 h-4" />}
      actions={
        <IconButton
          variant="default"
          icon={<Trash2 className="w-3.5 h-3.5" />}
          onClick={onClear}
          tooltip="Clear transcript"
          aria-label="Clear transcript"
          className="p-1.5 rounded-lg"
        />
      }
    >
      <div
        className="h-64 overflow-y-auto flex flex-col gap-3 pr-1 custom-scrollbar"
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
      >
        {transcript.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <MessageSquare className="w-6 h-6" style={{ color: 'var(--text-dimmed)' }} />
            <p className="text-xs text-center" style={{ color: 'var(--text-dimmed)' }}>
              La conversation apparaîtra ici.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {transcript.map((entry) => {
              const isAssistant = entry.role === 'assistant';
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex gap-2 ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}
                >
                  {/* Avatar */}
                  <div
                    className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                    style={{
                      backgroundColor: isAssistant ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                      border: `1px solid ${isAssistant ? 'var(--border-focus)' : 'var(--border-base)'}`,
                    }}
                  >
                    {isAssistant
                      ? <Cpu className="w-3 h-3" style={{ color: 'var(--accent-primary)' }} />
                      : <User className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                    }
                  </div>

                  {/* Bubble */}
                  <div className={`flex flex-col gap-0.5 max-w-[80%] ${isAssistant ? 'items-start' : 'items-end'}`}>
                    <div
                      className="px-3 py-2 rounded-2xl text-xs leading-relaxed"
                      style={{
                        backgroundColor: isAssistant ? 'var(--bg-secondary)' : 'var(--accent-subtle)',
                        border: `1px solid ${isAssistant ? 'var(--border-base)' : 'var(--border-focus)'}`,
                        color: isAssistant ? 'var(--text-primary)' : 'var(--accent-primary)',
                        borderRadius: isAssistant
                          ? '4px 14px 14px 14px'
                          : '14px 4px 14px 14px',
                      }}
                    >
                      {/* Speaker label */}
                      <span
                        className="block text-xs font-mono uppercase tracking-wider mb-1 opacity-60"
                      >
                        {isAssistant ? profile.aiName || 'Leanna' : profile.userName || 'Vous'}
                      </span>
                      {entry.text}
                    </div>
                    <span className="text-xs font-mono px-1" style={{ color: 'var(--text-dimmed)' }}>
                      {timeLabel(entry.timestamp)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </Panel>
  );
});
