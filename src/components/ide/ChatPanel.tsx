import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useReducedMotion, animate } from 'motion/react';
import {
  Send, Mic, MicOff, User, Bot, Eye, X,
  Trash2, Power, GripVertical, Minus, PanelRight, Maximize2, Minimize2,
  ChevronDown, Download, MessageSquare, MoreVertical, ArrowDown,
  Copy, CheckCheck, RefreshCw, Sparkles, Hash,
} from 'lucide-react';
import { marked } from 'marked';
import { sanitizeMarkdownHtml } from '../../utils/sanitizeMarkdownHtml.js';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';
import { useProfile, type UserProfile } from '../../context/UserProfileContext.js';
import { ActivityFeed } from './ActivityFeed.js';
import { MultiAgentIndicator } from './MultiAgentIndicator.js';
import { MentionDropdown } from './MentionDropdown.js';
import { SlashCommandDropdown } from './SlashCommandDropdown.js';
import { useFileMention } from '../../hooks/useFileMention.js';
import { useSlashCommand } from '../../hooks/useSlashCommand.js';
import { DocumentUpload, DropZoneOverlay, useDocumentDrop, type DocumentResult } from './DocumentUpload.js';
import { SkillPicker } from './SkillPicker.js';
import type { CustomSkill } from '../../hooks/useCustomSkills.js';
import type { TranscriptEntry, ContextSource } from '../../hooks/useLiveAPI.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const RADII = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '20px',
  full: '9999px',
};

const TRANSITIONS = {
  fast:   { duration: 0.12, ease: 'ease' },
  normal: { duration: 0.2,  ease: 'ease' },
  slow:   { duration: 0.3,  ease: [0.22, 1, 0.36, 1] },
  spring: { type: 'spring', bounce: 0.2, duration: 0.4 } as const,
};

const BUBBLE_STYLES = {
  assistant: {
    bg:           'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
    border:       'var(--border-base)',
    borderRadius: `4px ${RADII.lg} ${RADII.lg} ${RADII.lg}`,
    shadow:       '0 2px 10px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  user: {
    bg:           'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 22%, transparent), color-mix(in srgb, var(--accent-primary) 12%, transparent))',
    border:       'color-mix(in srgb, var(--accent-primary) 38%, transparent)',
    borderRadius: `${RADII.lg} 4px ${RADII.lg} ${RADII.lg}`,
    shadow:       '0 2px 12px color-mix(in srgb, var(--accent-primary) 18%, transparent)',
  },
} as const;

// ─── Pending message type ─────────────────────────────────────────────────────

interface PendingChatMessage {
  text: string;
  displayText?: string;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  icon?: React.ReactNode;
  onDone: () => void;
}

const Toast = memo(function Toast({ message, icon, onDone }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[99999] flex items-center gap-2.5
                 px-4 py-2.5 rounded-full text-sm font-medium shadow-lg pointer-events-none"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg-panel) 88%, transparent)',
        border: '1px solid var(--border-base)',
        color: 'var(--text-primary)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05), 0 0 20px var(--accent-glow)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {icon}
      {message}
    </motion.div>
  );
});

// ─── Message queue hook ───────────────────────────────────────────────────────

function useMessageQueue(
  isBusy: boolean,
  connected: boolean,
  sendTextMessage: (text: string, displayText?: string) => void
) {
  const [queue, setQueue] = useState<PendingChatMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isBusy && queue.length > 0 && connected) {
      timerRef.current = setTimeout(() => {
        const [next, ...rest] = queue;
        sendTextMessage(next.text, next.displayText);
        setQueue(rest);
        timerRef.current = null;
      }, 300);
    }
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [isBusy, queue, connected, sendTextMessage]);

  const enqueue = useCallback((message: PendingChatMessage) => {
    setQueue(prev => [...prev, message]);
  }, []);

  return { queue, enqueue };
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      const result = marked.parse(text, { gfm: true, breaks: true });
      return typeof result === 'string' ? sanitizeMarkdownHtml(result) : '';
    } catch {
      const escaped = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<p>${escaped}</p>`;
    }
  }, [text]);

  return (
    <div
      className="chat-markdown"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML sanitized with sanitizeMarkdownHtml
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ color: 'var(--text-primary)' }}
    />
  );
});

// ─── Breathing dots ───────────────────────────────────────────────────────────

const BreathingDots = memo(function BreathingDots({
  color,
  reduceMotion,
  size = 6,
}: {
  color: string;
  reduceMotion: boolean;
  size?: number;
}) {
  const dot = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    backgroundColor: color,
  };

  if (reduceMotion) {
    return (
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map(i => <div key={i} style={{ ...dot, opacity: 0.5 }} />)}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          style={dot}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
});

// ─── Chat message ─────────────────────────────────────────────────────────────

const ChatMessage = memo(function ChatMessage({
  entry,
  profile: _profile,
  reduceMotion,
  onExcludeSource,
  onCopy,
  onRetry,
  isLast,
}: {
  entry: TranscriptEntry;
  profile: UserProfile;
  reduceMotion: boolean;
  onExcludeSource?: (source: ContextSource) => void;
  onCopy?: (text: string) => void;
  onRetry?: () => void;
  isLast?: boolean;
}) {
  const isAssistant = entry.role === 'assistant';
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [showSources, setShowSources] = useState(false);
  const [copied, setCopied] = useState(false);
  const bubbleStyle = isAssistant ? BUBBLE_STYLES.assistant : BUBBLE_STYLES.user;
  const visibleSources = entry.sources?.filter(s => !excludedIds.has(s.id)) ?? [];

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(entry.text).then(() => {
      setCopied(true);
      onCopy?.(entry.text);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [entry.text, onCopy]);

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? { duration: 0.1 } : TRANSITIONS.spring}
      className={`flex gap-3 group relative ${isAssistant ? '' : 'flex-row-reverse'}`}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 transition-transform group-hover:scale-105"
        style={{
          backgroundColor: isAssistant
            ? 'color-mix(in srgb, var(--accent-primary) 12%, transparent)'
            : 'rgba(255, 255, 255, 0.04)',
          border: `1px solid ${isAssistant ? 'color-mix(in srgb, var(--accent-primary) 25%, transparent)' : 'var(--border-base)'}`,
          boxShadow: isAssistant ? '0 0 12px color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'none',
        }}
      >
        {isAssistant
          ? <Bot size={14} style={{ color: 'var(--accent-primary)' }} />
          : <User size={14} style={{ color: 'var(--text-muted)' }} />
        }
      </div>

      {/* Content */}
      <div className={`max-w-[86%] flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}>
        <div
          className="px-4 py-3 text-sm leading-relaxed inline-block text-left transition-shadow duration-200 hover:shadow-lg"
          style={{
            background: bubbleStyle.bg,
            border: `1px solid ${bubbleStyle.border}`,
            borderRadius: bubbleStyle.borderRadius,
            color: 'var(--text-primary)',
            boxShadow: bubbleStyle.shadow,
            backdropFilter: 'blur(8px)',
          }}
        >
          {isAssistant ? <ChatMarkdown text={entry.text} /> : (
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entry.text}</span>
          )}
        </div>

        {/* Footer: timestamp + actions */}
        <div
          className={`flex items-center gap-1.5 mt-1.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ${isAssistant ? '' : 'flex-row-reverse'}`}
        >
          <span
            className="text-[10px] font-mono tracking-wide"
            style={{ color: 'var(--text-dimmed)' }}
          >
            {entry.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>

          {/* Copy button */}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded-md transition-colors hover:bg-white/10"
            title="Copier le message"
            aria-label="Copier le message"
          >
            {copied
              ? <CheckCheck size={11} style={{ color: 'var(--color-success)' }} />
              : <Copy size={11} style={{ color: 'var(--text-dimmed)' }} />
            }
          </button>

          {/* Retry button — only on last assistant message */}
          {isAssistant && isLast && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="p-1 rounded-md transition-colors hover:bg-white/10"
              title="Régénérer la réponse"
              aria-label="Régénérer la réponse"
            >
              <RefreshCw size={11} style={{ color: 'var(--text-dimmed)' }} />
            </button>
          )}
        </div>

        {/* Sources */}
        {isAssistant && visibleSources.length > 0 && (
          <div className="mt-2 text-left w-full">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] transition-all
                         hover:bg-white/5 hover:border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)]"
              style={{
                color: 'var(--text-muted)',
                border: '1px solid var(--border-base)',
                backgroundColor: 'color-mix(in srgb, var(--bg-input) 55%, transparent)',
              }}
              aria-expanded={showSources}
              aria-controls={`sources-${entry.id}`}
              onClick={() => setShowSources(v => !v)}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-md"
                style={{ backgroundColor: 'var(--accent-subtle)' }}
              >
                <Eye size={9} style={{ color: 'var(--accent-primary)' }} />
              </span>
              <span className="font-medium">Sources</span>
              <span
                className="rounded-full px-1.5 py-px font-mono text-[9px] ml-0.5"
                style={{ color: 'var(--accent-primary)', backgroundColor: 'var(--accent-subtle)' }}
              >
                {visibleSources.length}
              </span>
              <span className="ml-auto text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                {showSources ? 'Masquer' : 'Voir'}
              </span>
              <ChevronDown
                size={10}
                style={{
                  color: 'var(--text-dimmed)',
                  transform: showSources ? 'rotate(180deg)' : undefined,
                  transition: 'transform 0.2s ease',
                }}
              />
            </button>

            <AnimatePresence initial={false}>
              {showSources && (
                <motion.div
                  id={`sources-${entry.id}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: reduceMotion ? 0.05 : 0.18 }}
                  className="mt-1 max-h-48 overflow-y-auto rounded-xl custom-scrollbar"
                  style={{ border: '1px solid var(--border-base)', backgroundColor: 'var(--bg-input)' }}
                >
                  <div className="divide-y" style={{ borderColor: 'var(--border-base)' }}>
                    {visibleSources.map(source => (
                      <div
                        key={source.id}
                        className="flex items-center gap-1.5 px-2.5 py-2 min-w-0 transition-colors hover:bg-white/5"
                      >
                        <span
                          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
                          style={{ backgroundColor: 'var(--accent-subtle)' }}
                        >
                          <Eye size={9} style={{ color: 'var(--accent-primary)' }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className="font-mono text-[11px] truncate"
                            title={source.path}
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {source.path}
                          </div>
                          <div
                            className="flex items-center gap-1.5 text-[9px] truncate"
                            style={{ color: 'var(--text-dimmed)' }}
                          >
                            {source.lines && (
                              <span
                                className="rounded px-1"
                                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--text-muted)' }}
                              >
                                {source.lines}
                              </span>
                            )}
                            <span className="truncate">via {source.tool}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="p-1 rounded transition-opacity opacity-50 hover:opacity-100 hover:bg-white/10 flex-shrink-0"
                          aria-label={`Exclure ${source.path} du contexte`}
                          title="Exclure du contexte"
                          onClick={() => {
                            setExcludedIds(prev => new Set(prev).add(source.id));
                            onExcludeSource?.(source);
                          }}
                        >
                          <X size={9} style={{ color: 'var(--text-muted)' }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
});

// ─── Cursor util ──────────────────────────────────────────────────────────────

function setCursorPosition(textarea: HTMLTextAreaElement, pos: number): void {
  requestAnimationFrame(() => {
    textarea.selectionStart = pos;
    textarea.selectionEnd = pos;
    textarea.focus();
  });
}

// ─── Input area ───────────────────────────────────────────────────────────────

interface InputAreaProps {
  connected: boolean;
  isBusy: boolean;
  onSend: (text: string) => void;
  onDocumentAnalyzed: (result: DocumentResult) => void;
  onToast: (msg: string, icon?: React.ReactNode) => void;
}

function InputArea({ connected, isBusy, onSend, onDocumentAnalyzed, onToast: _onToast }: InputAreaProps) {
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSend = connected && !isBusy;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const newH = Math.min(ta.scrollHeight, 140);
    ta.style.height = `${newH}px`;
  }, [input]);

  // Typing indicator
  useEffect(() => {
    if (input.length > 0) {
      setIsTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 1200);
    } else {
      setIsTyping(false);
    }
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [input]);

  const {
    suggestions, showSuggestions, selectedIndex, setSelectedIndex,
    handleMentionKeyDown, acceptSuggestion, mentionQuery,
  } = useFileMention(input, cursorPos);

  const {
    suggestions: slashSuggestions, showSuggestions: showSlashSuggestions,
    selectedIndex: slashSelectedIndex, setSelectedIndex: setSlashSelectedIndex,
    handleSlashKeyDown, acceptCommand, commandQuery,
  } = useSlashCommand(input, cursorPos);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !canSend) return;
    onSend(text);
    setInput('');
    setCursorPos(0);
    // reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  }, [input, canSend, onSend]);

  // Activation d'un skill custom : préremplit la saisie avec l'invocation du skill.
  // L'utilisateur peut alors compléter les arguments avant d'envoyer.
  const handleSelectSkill = useCallback((skill: CustomSkill) => {
    const hasParams = skill.parameters && skill.parameters.length > 0;
    const paramsHint = hasParams
      ? ` ${skill.parameters.map(p => `${p.name}=`).join(' ')}`
      : '';
    const invocation = `/custom_${skill.name}${paramsHint} `;
    setInput(invocation);
    const pos = invocation.length;
    setCursorPos(pos);
    if (textareaRef.current) setCursorPosition(textareaRef.current, pos);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashSuggestions && slashSuggestions.length > 0) {
        if (['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) { handleSlashKeyDown(e); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          const sel = slashSuggestions[slashSelectedIndex];
          if (sel) {
            e.preventDefault();
            const { newInput, newCursorPos } = acceptCommand(sel);
            setInput(newInput);
            setCursorPos(newCursorPos);
            if (textareaRef.current) setCursorPosition(textareaRef.current, newCursorPos);
          }
          return;
        }
      }
      if (showSuggestions && suggestions.length > 0) {
        if (['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) { handleMentionKeyDown(e); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          const sel = suggestions[selectedIndex];
          if (sel) {
            e.preventDefault();
            const { newInput, newCursorPos } = acceptSuggestion(sel);
            setInput(newInput);
            setCursorPos(newCursorPos);
            if (textareaRef.current) setCursorPosition(textareaRef.current, newCursorPos);
          }
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      showSlashSuggestions, slashSuggestions, slashSelectedIndex, handleSlashKeyDown, acceptCommand,
      showSuggestions, suggestions, selectedIndex, handleMentionKeyDown, acceptSuggestion, handleSend,
    ]
  );

  const charLimit = 2000;
  const nearLimit = input.length > charLimit * 0.8;
  const overLimit = input.length > charLimit;

  return (
    <div
      className="flex-shrink-0 px-3 pb-3 pt-2"
      style={{ borderTop: '1px solid var(--border-base)' }}
    >
      {/* Outer wrapper — relative so dropdowns (bottom-full) can escape overflow-hidden */}
      <div className="relative">

        {/* Dropdowns — outside the overflow-hidden container so they aren't clipped */}
        {showSuggestions && suggestions.length > 0 && (
          <MentionDropdown
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            onSelect={(s) => {
              const { newInput, newCursorPos } = acceptSuggestion(s);
              setInput(newInput);
              setCursorPos(newCursorPos);
              if (textareaRef.current) setCursorPosition(textareaRef.current, newCursorPos);
            }}
            onHover={setSelectedIndex}
            query={mentionQuery}
          />
        )}
        {showSlashSuggestions && slashSuggestions.length > 0 && (
          <SlashCommandDropdown
            suggestions={slashSuggestions}
            selectedIndex={slashSelectedIndex}
            onSelect={(s) => {
              const { newInput, newCursorPos } = acceptCommand(s);
              setInput(newInput);
              setCursorPos(newCursorPos);
              if (textareaRef.current) setCursorPosition(textareaRef.current, newCursorPos);
            }}
            onHover={setSlashSelectedIndex}
            query={commandQuery}
          />
        )}

      {/* Input container — overflow-hidden only here for border-radius */}
      <div
        className="flex flex-col transition-[border-color,box-shadow] duration-200 rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-input)',
          border: `1px solid ${isFocused ? 'var(--accent-primary)' : 'var(--border-base)'}`,
          boxShadow: isFocused
            ? '0 0 0 3px color-mix(in srgb, var(--accent-primary) 18%, transparent), 0 0 20px var(--accent-glow), inset 0 1px 2px rgba(0,0,0,0.15)'
            : 'inset 0 1px 2px rgba(0,0,0,0.15)',
        }}
      >

        {/* Textarea row */}
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCursorPos(e.target.selectionStart ?? 0);
            }}
            onSelect={(e) => {
              setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0);
            }}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              setIsFocused(true);
              setCursorPos(e.target.selectionStart ?? 0);
            }}
            onBlur={() => setIsFocused(false)}
            placeholder={connected ? 'Message… (@fichier, /commande)' : 'Connectez-vous d\'abord…'}
            disabled={!canSend}
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none
                       placeholder:text-[var(--text-dimmed)] placeholder:opacity-60
                       leading-[1.55] custom-scrollbar"
            style={{
              color: 'var(--text-primary)',
              minHeight: '28px',
              maxHeight: '140px',
              overflowY: 'auto',
            }}
            aria-label="Saisie du message"
            aria-describedby="chat-input-hints"
            aria-autocomplete="list"
            aria-haspopup="listbox"
          />

          <div className="flex items-center gap-1 pb-0.5 flex-shrink-0">
            <SkillPicker onSelect={handleSelectSkill} disabled={!canSend} />
            <DocumentUpload connected={connected} onDocumentAnalyzed={onDocumentAnalyzed} />

            <motion.button
              onClick={handleSend}
              disabled={!input.trim() || !canSend}
              whileTap={input.trim() && canSend ? { scale: 0.88 } : undefined}
              className="p-2 rounded-lg transition-all duration-150 disabled:opacity-30 focus:outline-none
                         focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
              style={{
                background: input.trim() && canSend
                  ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-hover))'
                  : 'transparent',
                color: input.trim() && canSend ? '#0a1628' : 'var(--accent-primary)',
                boxShadow: input.trim() && canSend ? '0 2px 12px var(--accent-glow)' : 'none',
              }}
              title="Envoyer (Enter)"
              aria-label="Envoyer le message"
            >
              <Send size={16} />
            </motion.button>
          </div>
        </div>

        {/* Bottom info bar */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-t"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'color-mix(in srgb, var(--bg-input) 40%, transparent)' }}
        >
          <span
            id="chat-input-hints"
            className="text-[10px] tracking-wide"
            style={{ color: 'var(--text-dimmed)' }}
          >
            <kbd className="font-mono">Enter</kbd> envoyer &nbsp;·&nbsp;
            <kbd className="font-mono">⇧Enter</kbd> saut de ligne &nbsp;·&nbsp;
            <kbd className="font-mono">@</kbd> fichier &nbsp;·&nbsp;
            <kbd className="font-mono">/</kbd> commande
          </span>

          <div className="flex items-center gap-2">
            {/* Char counter */}
            {input.length > 0 && (
              <span
                className="text-[10px] font-mono transition-colors"
                style={{
                  color: overLimit
                    ? 'var(--color-error)'
                    : nearLimit
                      ? 'var(--color-warning)'
                      : 'var(--text-dimmed)',
                }}
              >
                {input.length}/{charLimit}
              </span>
            )}

            {/* Status dots */}
            {connected && (
              <span
                className="text-[10px] flex items-center gap-1.5"
                style={{ color: isBusy ? 'var(--accent-primary)' : 'var(--color-success)' }}
              >
                <BreathingDots
                  color={isBusy ? 'var(--accent-primary)' : 'var(--color-success)'}
                  reduceMotion={false}
                  size={4}
                />
                {isBusy ? 'En cours…' : isTyping ? 'Frappe…' : 'Connecté'}
              </span>
            )}
          </div>
        </div>
      </div>
      </div>  {/* end outer wrapper */}
    </div>
  );
}

// ─── Rubber-band helpers ──────────────────────────────────────────────────────

function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function clampWithRubberband(value: number, min: number, max: number, dimension: number): number {
  if (value < min) return min + rubberband(value - min, dimension);
  if (value > max) return max + rubberband(value - max, dimension);
  return value;
}

// ─── Draggable panel hook ─────────────────────────────────────────────────────

interface DragSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  anchorRect: DOMRect;
  startX: number;
  startY: number;
  moved: boolean;
}

const DRAG_HYSTERESIS = 6;
const EDGE_MARGIN = 8;

function useDraggablePanel(
  panelRef: React.RefObject<HTMLDivElement | null>,
  disabled: boolean,
  reduceMotion: boolean,
) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const [isDragging, setIsDragging] = useState(false);
  const session = useRef<DragSession | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const panel = panelRef.current;
    if (!panel) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    session.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorRect: panel.getBoundingClientRect(),
      startX: mx.get(),
      startY: my.get(),
      moved: false,
    };
  }, [disabled, panelRef, mx, my]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startClientX;
    const dy = e.clientY - s.startClientY;
    if (!s.moved) {
      if (Math.hypot(dx, dy) < DRAG_HYSTERESIS) return;
      s.moved = true;
      setIsDragging(true);
    }
    const minLeft = EDGE_MARGIN;
    const maxLeft = window.innerWidth - EDGE_MARGIN - s.anchorRect.width;
    const minTop = EDGE_MARGIN;
    const maxTop = window.innerHeight - EDGE_MARGIN - s.anchorRect.height;
    const cl = clampWithRubberband(s.anchorRect.left + dx, minLeft, maxLeft, window.innerWidth);
    const ct = clampWithRubberband(s.anchorRect.top + dy, minTop, maxTop, window.innerHeight);
    mx.set(s.startX + (cl - s.anchorRect.left));
    my.set(s.startY + (ct - s.anchorRect.top));
  }, [mx, my]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    setIsDragging(false);
    const minLeft = EDGE_MARGIN;
    const maxLeft = window.innerWidth - EDGE_MARGIN - s.anchorRect.width;
    const minTop = EDGE_MARGIN;
    const maxTop = window.innerHeight - EDGE_MARGIN - s.anchorRect.height;
    const curLeft = s.anchorRect.left + (mx.get() - s.startX);
    const curTop = s.anchorRect.top + (my.get() - s.startY);
    const tl = Math.min(Math.max(curLeft, minLeft), maxLeft);
    const tt = Math.min(Math.max(curTop, minTop), maxTop);
    if (tl !== curLeft) {
      animate(mx, mx.get() + (tl - curLeft), reduceMotion
        ? { duration: 0.15, ease: 'easeOut' }
        : { type: 'spring', bounce: 0.15, duration: 0.4, velocity: mx.getVelocity() });
    }
    if (tt !== curTop) {
      animate(my, my.get() + (tt - curTop), reduceMotion
        ? { duration: 0.15, ease: 'easeOut' }
        : { type: 'spring', bounce: 0.15, duration: 0.4, velocity: my.getVelocity() });
    }
    session.current = null;
  }, [mx, my, reduceMotion]);

  const resetPosition = useCallback(() => { mx.set(0); my.set(0); }, [mx, my]);

  return {
    mx, my, isDragging, resetPosition,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
  };
}

// ─── Resizable panel hook ─────────────────────────────────────────────────────

interface ResizeSession {
  pointerId: number;
  startClientX: number;
  startWidth: number;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 860;

function useResizablePanel(
  disabled: boolean,
  initialWidth: number,
  onWidthChange: (w: number) => void,
) {
  const [width, setWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeSession = useRef<ResizeSession | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeSession.current = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: width };
    setIsResizing(true);
  }, [disabled, width]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    const s = resizeSession.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = s.startClientX - e.clientX;
    setWidth(Math.min(Math.max(s.startWidth + dx, MIN_WIDTH), MAX_WIDTH));
  }, []);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    const s = resizeSession.current;
    if (!s || e.pointerId !== s.pointerId) return;
    setIsResizing(false);
    resizeSession.current = null;
    onWidthChange(width);
  }, [width, onWidthChange]);

  return {
    width, isResizing, setWidth,
    resizeHandlers: {
      onPointerDown: handleResizeStart,
      onPointerMove: handleResizeMove,
      onPointerUp: handleResizeEnd,
      onPointerCancel: handleResizeEnd,
    },
  };
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

interface ChatPanelProps {
  pendingMessage?: PendingChatMessage | null;
  onPendingMessageConsumed?: () => void;
  onDockedChange?: (docked: boolean) => void;
  onWidthChange?: (width: number) => void;
  initialDocked?: boolean;
  onClose?: () => void;
}

export function ChatPanel({
  pendingMessage,
  onPendingMessageConsumed,
  onDockedChange,
  onWidthChange,
  initialDocked = false,
  onClose,
}: ChatPanelProps = {}) {
  const {
    connected, connecting, connect, disconnect,
    sendTextMessage, sendRawMessage, transcript, clearTranscript,
    activity, isBusy, muted, toggleMute,
  } = useLiveAPIContext();
  const { profile } = useProfile();

  // ── UI state ────────────────────────────────────────────────────────────────
  const [minimized, setMinimized] = useState(false);
  const [docked, setDocked] = useState(() => {
    try { return JSON.parse(localStorage.getItem('Leanna_chat_docked') ?? 'null') ?? initialDocked; }
    catch { return initialDocked; }
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [showInput, setShowInput] = useState(() => {
    try { return JSON.parse(localStorage.getItem('Leanna_chat_show_input') ?? 'null') ?? false; }
    catch { return false; }
  });
  const [showMenu, setShowMenu] = useState(false);

  // ── Toast state ─────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; icon?: React.ReactNode } | null>(null);
  const showToast = useCallback((message: string, icon?: React.ReactNode) => {
    setToast({ message, icon });
  }, []);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const menuRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesInnerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const reduceMotion = !!useReducedMotion();

  // ── Width / resize ──────────────────────────────────────────────────────────
  const handleWidthChange = useCallback((newWidth: number) => {
    try { localStorage.setItem('Leanna_chat_width', JSON.stringify(newWidth)); } catch { /* noop */ }
    onWidthChange?.(newWidth);
  }, [onWidthChange]);

  const initialWidth = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('Leanna_chat_width') ?? 'null') ?? 400; }
    catch { return 400; }
  }, []);

  const { width, isResizing, resizeHandlers } = useResizablePanel(
    !docked || fullscreen,
    initialWidth,
    handleWidthChange,
  );

  // ── Persist state ───────────────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('Leanna_chat_docked', JSON.stringify(docked)); } catch { /* noop */ }
  }, [docked]);

  useEffect(() => {
    try { localStorage.setItem('Leanna_chat_show_input', JSON.stringify(showInput)); } catch { /* noop */ }
  }, [showInput]);

  useEffect(() => { onDockedChange?.(docked); }, [docked, onDockedChange]);

  // Notify parent of initial width
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onWidthChange?.(width); }, []);

  // ── Close menu on outside click ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showMenu && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape: close menu or fullscreen
      if (e.key === 'Escape') {
        if (showMenu) { setShowMenu(false); return; }
        if (fullscreen) { setFullscreen(false); return; }
      }
      // Ctrl/Cmd+Shift+C: toggle panel (if onClose provided)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showMenu, fullscreen, onClose]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const { mx, my, isDragging: isDraggingPanel, resetPosition, dragHandlers } =
    useDraggablePanel(panelRef, docked || fullscreen, reduceMotion);

  useEffect(() => {
    if (docked || fullscreen) resetPosition();
  }, [docked, fullscreen, resetPosition]);

  // ── Message queue ───────────────────────────────────────────────────────────
  const { queue, enqueue } = useMessageQueue(isBusy, connected, sendTextMessage);

  // ── Scroll helpers ──────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    const container = messagesRef.current;
    if (!container) return;
    isProgrammaticScrollRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    const target = container.scrollHeight - container.clientHeight;
    if (target < 0) { isProgrammaticScrollRef.current = false; return; }
    if (smooth && !reduceMotion) {
      container.scrollTo({ top: target, behavior: 'smooth' });
      scrollTimeoutRef.current = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 350);
    } else {
      container.scrollTop = target;
      requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
    }
    shouldAutoScrollRef.current = true;
    setShowScrollBtn(false);
  }, [reduceMotion]);

  useEffect(() => () => { if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current); }, []);

  const handleMessagesScroll = useCallback(() => {
    const c = messagesRef.current;
    if (!c || isProgrammaticScrollRef.current) return;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    shouldAutoScrollRef.current = dist <= 80;
    setShowScrollBtn(dist > 80 && transcript.length > 1);
  }, [transcript.length]);

  const lastEntry = transcript[transcript.length - 1];
  const lastEntryText = lastEntry?.text;
  const lastEntryId = lastEntry?.id;

  useLayoutEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom(false);
      const raf = requestAnimationFrame(() => {
        if (shouldAutoScrollRef.current) scrollToBottom(false);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [transcript.length, lastEntryId, lastEntryText, queue.length, isBusy, connecting, activity.length, scrollToBottom]);

  useEffect(() => {
    const inner = messagesInnerRef.current;
    if (!inner) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (shouldAutoScrollRef.current) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (shouldAutoScrollRef.current) scrollToBottom(false);
        });
      }
    });
    observer.observe(inner);
    return () => { observer.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
  }, [scrollToBottom]);

  // ── Send helpers ─────────────────────────────────────────────────────────────
  const handleSend = useCallback((text: string, displayText?: string) => {
    if (!connected) return;
    try {
      shouldAutoScrollRef.current = true;
      scrollToBottom(true);
      if (isBusy) enqueue({ text, displayText });
      else sendTextMessage(text, displayText);
    } catch (err) {
      console.error('[ChatPanel] sendTextMessage failed:', err);
    }
  }, [connected, isBusy, enqueue, sendTextMessage, scrollToBottom]);

  // Retry: resend last user message
  const handleRetry = useCallback(() => {
    const lastUser = [...transcript].reverse().find(e => e.role === 'user');
    if (!lastUser || !connected) return;
    handleSend(lastUser.text, lastUser.text);
    showToast('Régénération en cours…', <RefreshCw size={13} style={{ color: 'var(--accent-primary)' }} />);
  }, [transcript, connected, handleSend, showToast]);

  // ── Pending message ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingMessage) return;
    if (!connected) {
      if (!connecting) connect([], 'full');
      return;
    }
    shouldAutoScrollRef.current = true;
    scrollToBottom(true);
    handleSend(pendingMessage.text, pendingMessage.displayText);
    onPendingMessageConsumed?.();
  }, [pendingMessage, connected, connecting, connect, handleSend, onPendingMessageConsumed, scrollToBottom]);

  // ── Document upload ─────────────────────────────────────────────────────────
  const handleDocumentAnalyzed = useCallback((result: DocumentResult) => {
    if (!connected) return;
    try {
      sendRawMessage({ type: 'document_context', fileName: result.fileName, summary: result.summary });
    } catch (err) {
      console.error('[ChatPanel] sendRawMessage failed:', err);
    }
  }, [connected, sendRawMessage]);

  const { isDragging, dropHandlers } = useDocumentDrop({ connected, onDocumentAnalyzed: handleDocumentAnalyzed });

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => clearTranscript(), [clearTranscript]);
  const handleToggleMute = useCallback(() => toggleMute(), [toggleMute]);
  const handleToggleConnect = useCallback(() => {
    if (connected) disconnect(); else connect([], 'full');
  }, [connected, disconnect, connect]);

  const handleExport = useCallback(() => {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        assistant: profile?.aiName || 'Leanna',
        messages: transcript.map(e => ({
          role: e.role,
          content: e.text,
          timestamp: e.timestamp.toISOString(),
          sources: e.sources?.map(s => ({ path: s.path, lines: s.lines, tool: s.tool })),
        })),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leanna-conversation-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Conversation exportée', <Download size={13} style={{ color: 'var(--accent-primary)' }} />);
    } catch (err) {
      console.error('[ChatPanel] Export failed:', err);
    }
  }, [transcript, profile, showToast]);

  // Last assistant message index (for retry button)
  const lastAssistantIdx = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].role === 'assistant') return i;
    }
    return -1;
  }, [transcript]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Global Toast */}
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            icon={toast.icon}
            onDone={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <motion.div
        ref={panelRef}
        className="fixed flex flex-col overflow-hidden"
        style={{
          top:    fullscreen ? '0' : docked ? '0'    : '80px',
          right:  fullscreen ? '0' : docked ? '0'    : '24px',
          left:   fullscreen ? '0' : undefined,
          bottom: fullscreen ? '0' : docked ? '32px' : '40px',
          width:  fullscreen ? '100vw' : `${width}px`,
          height: fullscreen
            ? '100vh'
            : minimized
              ? 'auto'
              : docked
                ? 'calc(100vh - 32px)'
                : 'calc(100vh - 152px)',
          maxHeight: fullscreen ? '100vh' : minimized ? undefined : docked ? 'calc(100vh - 32px)' : 'calc(100vh - 152px)',
          minWidth:  fullscreen ? undefined : `${MIN_WIDTH}px`,
          zIndex:    fullscreen ? 99999 : 9990,
          backgroundColor: 'var(--bg-panel)',
          border:     fullscreen || docked ? 'none' : '1px solid var(--border-base)',
          borderLeft: !fullscreen && docked ? '1px solid var(--border-base)' : undefined,
          borderRadius: fullscreen ? '0' : docked ? '0' : RADII.xl,
          x: fullscreen || docked ? 0 : mx,
          y: fullscreen || docked ? 0 : my,
          cursor: isDraggingPanel && !docked && !fullscreen ? 'grabbing' : isResizing ? 'ew-resize' : 'default',
          userSelect: isDraggingPanel || isResizing ? 'none' : 'auto',
          boxShadow: fullscreen
            ? 'none'
            : docked
              ? '-4px 0 32px rgba(0,0,0,0.28), -1px 0 0 var(--border-base), inset 1px 0 0 rgba(255,255,255,0.03)'
              : isDraggingPanel
                ? '0 28px 80px rgba(0,0,0,0.55), 0 0 0 1px var(--border-base), 0 0 40px var(--accent-glow)'
                : '0 16px 56px rgba(0,0,0,0.4), 0 0 0 1px var(--border-base), 0 0 24px color-mix(in srgb, var(--accent-primary) 8%, transparent)',
          transition: reduceMotion || isDraggingPanel || isResizing
            ? 'box-shadow 0.15s'
            : 'top 0.3s cubic-bezier(0.22,1,0.36,1), right 0.3s cubic-bezier(0.22,1,0.36,1), width 0.3s cubic-bezier(0.22,1,0.36,1), height 0.3s cubic-bezier(0.22,1,0.36,1), bottom 0.3s cubic-bezier(0.22,1,0.36,1), border-radius 0.3s',
          backdropFilter: fullscreen ? 'none' : 'blur(24px)',
        }}
        {...dropHandlers}
      >
        <DropZoneOverlay isDragging={isDragging} />

        {/* ── Resize handle ────────────────────────────────────────────────── */}
        {docked && !fullscreen && (
          <div
            {...resizeHandlers}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize group z-50"
            style={{ touchAction: 'none' }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-4 -translate-x-1/2" />
            <div
              className="absolute left-0 top-0 bottom-0 w-0.5 transition-colors"
              style={{ backgroundColor: isResizing ? 'var(--accent-primary)' : 'transparent' }}
            />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-14 rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ backgroundColor: 'var(--accent-primary)', boxShadow: '0 0 10px color-mix(in srgb, var(--accent-primary) 50%, transparent)' }}
            />
          </div>
        )}

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div
          {...(docked || fullscreen ? {} : dragHandlers)}
          className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0 relative"
          style={{
            borderBottom: '1px solid var(--border-base)',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 7%, var(--bg-panel)) 0%, var(--bg-panel) 55%, color-mix(in srgb, var(--accent-secondary) 4%, var(--bg-panel)) 100%)',
            cursor: docked || fullscreen ? 'default' : (isDraggingPanel ? 'grabbing' : 'grab'),
            touchAction: docked || fullscreen ? undefined : 'none',
          }}
        >
          {!docked && !fullscreen && (
            <GripVertical
              size={14}
              className="flex-shrink-0"
              style={{ color: 'var(--text-dimmed)', opacity: 0.35 }}
            />
          )}

          {/* Bot avatar with pulsing status dot */}
          <div className="relative flex-shrink-0">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{
                background: connected
                  ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 18%, transparent), color-mix(in srgb, var(--accent-secondary) 8%, transparent))'
                  : 'color-mix(in srgb, var(--text-muted) 8%, transparent)',
                border: `1px solid ${connected ? 'color-mix(in srgb, var(--accent-primary) 25%, transparent)' : 'var(--border-base)'}`,
                boxShadow: connected ? '0 0 14px color-mix(in srgb, var(--accent-primary) 20%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)' : 'none',
              }}
            >
              <Bot size={16} style={{ color: connected ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
            </div>
            {/* Status dot */}
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-panel)]">
              {connected && !reduceMotion ? (
                <motion.div
                  className="w-full h-full rounded-full"
                  style={{ backgroundColor: 'var(--color-success)' }}
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              ) : (
                <div
                  className="w-full h-full rounded-full"
                  style={{
                    backgroundColor: connected ? 'var(--color-success)' : connecting ? 'var(--color-warning)' : 'var(--text-dimmed)',
                  }}
                />
              )}
            </div>
          </div>

          {/* Title + status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {profile?.aiName || 'Leanna'}
              </span>
              {transcript.length > 0 && (
                <span
                  className="flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{
                    color: 'var(--text-dimmed)',
                    backgroundColor: 'color-mix(in srgb, var(--text-dimmed) 10%, transparent)',
                  }}
                >
                  <Hash size={8} />
                  {transcript.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="text-[11px]"
                style={{
                  color: connected ? 'var(--color-success)' : connecting ? 'var(--color-warning)' : 'var(--text-dimmed)',
                }}
              >
                {connecting ? 'Connexion…' : isBusy ? 'Réflexion…' : connected ? 'En ligne' : 'Hors ligne'}
              </span>
              <MultiAgentIndicator steps={activity} />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5">
            {/* Mute */}
            {connected && (
              <motion.button
                onClick={handleToggleMute}
                whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                title={muted ? 'Activer le micro' : 'Désactiver le micro'}
                aria-label={muted ? 'Activer le micro' : 'Désactiver le micro'}
              >
                {muted
                  ? <MicOff size={15} style={{ color: 'var(--color-warning)' }} />
                  : <Mic size={15} style={{ color: 'var(--color-success)' }} />
                }
              </motion.button>
            )}

            {/* Toggle input */}
            <motion.button
              onClick={() => setShowInput((s: boolean) => !s)}
              whileTap={reduceMotion ? undefined : { scale: 0.88 }}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
              title={showInput ? 'Masquer la saisie' : 'Afficher la saisie'}
              aria-label={showInput ? 'Masquer la saisie' : 'Afficher la saisie'}
              style={{
                backgroundColor: showInput ? 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' : 'transparent',
              }}
            >
              <MessageSquare
                size={15}
                style={{ color: showInput ? 'var(--accent-primary)' : 'var(--text-muted)' }}
              />
            </motion.button>

            {/* More menu */}
            <div className="relative" ref={menuRef}>
              <motion.button
                onClick={() => setShowMenu(v => !v)}
                whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                title="Plus d'options"
                aria-label="Plus d'options"
                aria-expanded={showMenu}
                style={{
                  backgroundColor: showMenu ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)' : 'transparent',
                }}
              >
                <MoreVertical size={15} style={{ color: showMenu ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
              </motion.button>

              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.94 }}
                    transition={{ duration: 0.13 }}
                    className="absolute right-0 top-full mt-1.5 w-52 rounded-xl overflow-hidden z-50"
                    style={{
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-base)',
                      boxShadow: '0 12px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04)',
                    }}
                  >
                    {transcript.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1">
                          <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                            Conversation
                          </span>
                        </div>
                        <MenuButton
                          icon={<Download size={13} style={{ color: 'var(--accent-primary)' }} />}
                          label="Exporter"
                          onClick={() => { handleExport(); setShowMenu(false); }}
                        />
                        <MenuButton
                          icon={<Trash2 size={13} style={{ color: 'var(--color-error)' }} />}
                          label="Effacer"
                          onClick={() => { handleClear(); setShowMenu(false); }}
                          danger
                        />
                        <div className="h-px mx-3 my-1" style={{ backgroundColor: 'var(--border-base)' }} />
                      </>
                    )}

                    <div className="px-3 pt-1 pb-1">
                      <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                        Affichage
                      </span>
                    </div>

                    <MenuButton
                      icon={fullscreen
                        ? <Minimize2 size={13} style={{ color: 'var(--accent-primary)' }} />
                        : <Maximize2 size={13} style={{ color: 'var(--text-muted)' }} />
                      }
                      label={fullscreen ? 'Quitter plein écran' : 'Plein écran'}
                      onClick={() => {
                        setFullscreen(f => { if (!f) { setDocked(false); setMinimized(false); } return !f; });
                        setShowMenu(false);
                      }}
                    />
                    <MenuButton
                      icon={<PanelRight size={13} style={{ color: docked ? 'var(--accent-primary)' : 'var(--text-muted)' }} />}
                      label={docked ? 'Détacher' : 'Ancrer au bord'}
                      onClick={() => { setDocked((d: boolean) => !d); setShowMenu(false); }}
                    />
                    {!docked && (
                      <MenuButton
                        icon={<Minus size={13} style={{ color: 'var(--text-muted)' }} />}
                        label={minimized ? 'Agrandir' : 'Réduire'}
                        onClick={() => { setMinimized(m => !m); setShowMenu(false); }}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--border-base)' }} />

            {/* Power */}
            <motion.button
              onClick={handleToggleConnect}
              whileTap={reduceMotion ? undefined : { scale: 0.88 }}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
              title={connected ? 'Déconnecter' : 'Connecter'}
              aria-label={connected ? 'Déconnecter' : 'Connecter'}
            >
              <Power size={15} style={{ color: connected ? 'var(--color-error)' : 'var(--accent-primary)' }} />
            </motion.button>

            {/* Close */}
            {onClose && (
              <>
                <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--border-base)' }} />
                <motion.button
                  onClick={onClose}
                  whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                  title="Fermer (Ctrl+Shift+C)"
                  aria-label="Fermer le panneau"
                >
                  <X size={15} style={{ color: 'var(--text-muted)' }} />
                </motion.button>
              </>
            )}
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        {!minimized && (
          <>
            {/* Messages */}
            <div className="relative flex-1 min-h-0 flex flex-col">
              <div
                ref={messagesRef}
                onScroll={handleMessagesScroll}
                className="flex-1 overflow-y-auto px-3 py-4 custom-scrollbar"
                style={{
                  maxWidth: fullscreen ? '860px' : undefined,
                  margin: fullscreen ? '0 auto' : undefined,
                  width: fullscreen ? '100%' : undefined,
                }}
              >
                <div ref={messagesInnerRef} className="space-y-4">

                  {/* Connecting indicator */}
                  {connecting && (
                    <div
                      className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                      style={{ backgroundColor: 'var(--bg-secondary)' }}
                    >
                      <BreathingDots color="var(--accent-primary)" reduceMotion={reduceMotion} />
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Connexion en cours…
                      </span>
                    </div>
                  )}

                  {/* Empty state */}
                  {transcript.length === 0 && activity.length === 0 && !connecting && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      className="flex flex-col items-center justify-center py-12 gap-5"
                    >
                      {/* Glowing orb icon */}
                      <div className="relative">
                        <div
                          className="w-16 h-16 rounded-2xl flex items-center justify-center relative overflow-hidden"
                          style={{
                            background: connected
                              ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 16%, transparent), color-mix(in srgb, var(--accent-secondary) 10%, transparent))'
                              : 'color-mix(in srgb, var(--text-muted) 8%, transparent)',
                            border: `1px solid ${connected ? 'color-mix(in srgb, var(--accent-primary) 28%, transparent)' : 'var(--border-base)'}`,
                            boxShadow: connected
                              ? '0 0 36px color-mix(in srgb, var(--accent-primary) 22%, transparent), inset 0 1px 0 rgba(255,255,255,0.08)'
                              : 'none',
                          }}
                        >
                          {connected
                            ? <Sparkles size={26} style={{ color: 'var(--accent-primary)' }} />
                            : <Bot size={26} style={{ color: 'var(--text-muted)' }} />
                          }
                        </div>
                        {/* Pulse rings (dual, staggered) */}
                        {connected && !reduceMotion && (
                          <>
                            <motion.div
                              className="absolute inset-0 rounded-2xl"
                              style={{ border: '2px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)' }}
                              animate={{ scale: [1, 1.22], opacity: [0.8, 0] }}
                              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                            />
                            <motion.div
                              className="absolute inset-0 rounded-2xl"
                              style={{ border: '1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent)' }}
                              animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
                              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
                            />
                          </>
                        )}
                      </div>

                      <div className="text-center space-y-1.5 px-4">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {connected ? `Bonjour, je suis ${profile?.aiName || 'Leanna'}` : 'Agent hors ligne'}
                        </p>
                        <p className="text-xs leading-relaxed max-w-[260px]" style={{ color: 'var(--text-muted)' }}>
                          {connected
                            ? 'Posez une question, mentionnez un @fichier ou tapez une /commande.'
                            : 'Connectez-vous via le bouton ⏻ pour démarrer.'
                          }
                        </p>
                      </div>

                    </motion.div>
                  )}

                  {/* Messages */}
                  <AnimatePresence initial={false}>
                    {transcript.map((entry, idx) => (
                      <ChatMessage
                        key={entry.id}
                        entry={entry}
                        profile={profile!}
                        reduceMotion={reduceMotion}
                        isLast={idx === lastAssistantIdx && entry.role === 'assistant'}
                        onExcludeSource={(source) => sendRawMessage({ context_exclude: source.path })}
                        onCopy={() => showToast('Copié dans le presse-papiers', <CheckCheck size={13} style={{ color: 'var(--color-success)' }} />)}
                        onRetry={handleRetry}
                      />
                    ))}
                  </AnimatePresence>

                  {/* Thinking indicator */}
                  {isBusy && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="flex items-center gap-3 pl-11"
                    >
                      <BreathingDots color="var(--accent-primary)" reduceMotion={reduceMotion} />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {profile?.aiName || 'Leanna'} réfléchit…
                      </span>
                    </motion.div>
                  )}

                  {/* Queue */}
                  {queue.length > 0 && (
                    <div className="space-y-1.5 pl-11">
                      {queue.map((msg, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2.5 pl-3 pr-3 py-2 rounded-xl relative overflow-hidden"
                          style={{
                            backgroundColor: 'color-mix(in srgb, var(--accent-primary) 6%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                          }}
                        >
                          <div
                            className="absolute left-0 top-0 bottom-0 w-0.5"
                            style={{ backgroundColor: 'var(--accent-primary)', opacity: 0.5 }}
                          />
                          <span className="text-sm truncate ml-1" style={{ color: 'var(--text-muted)' }}>
                            {msg.displayText ?? msg.text}
                          </span>
                          <span className="text-[10px] flex-shrink-0 ml-auto" style={{ color: 'var(--text-dimmed)' }}>
                            en attente
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div />
                </div>
              </div>

              {/* Scroll to bottom button */}
              <AnimatePresence>
                {showScrollBtn && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 8 }}
                    transition={{ duration: 0.15 }}
                    whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                    onClick={() => scrollToBottom(true)}
                    className="absolute right-3 bottom-3 p-2.5 rounded-full shadow-lg z-30 flex items-center justify-center cursor-pointer"
                    style={{
                      backgroundColor: 'var(--accent-primary)',
                      color: '#fff',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.15)',
                    }}
                    title="Aller au dernier message"
                    aria-label="Aller au dernier message"
                  >
                    <ArrowDown size={14} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* Activity feed */}
            <ActivityFeed steps={activity} connected={connected} />

            {/* Input area */}
            {showInput && (
              <InputArea
                connected={connected}
                isBusy={isBusy}
                onSend={handleSend}
                onDocumentAnalyzed={handleDocumentAnalyzed}
                onToast={showToast}
              />
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

// ─── Menu button helper ───────────────────────────────────────────────────────

function MenuButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors text-left hover:bg-white/8"
      style={{ color: danger ? 'var(--color-error)' : 'var(--text-primary)' }}
    >
      {icon}
      {label}
    </button>
  );
}

export default ChatPanel;
