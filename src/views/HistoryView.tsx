import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, Search, Trash2, RefreshCw, MessageSquare, User, Cpu, ArrowRight } from 'lucide-react';
import { useToast } from '../components/ui/Toast.js';
import { ViewHeader } from '../components/ui/ViewHeader.js';

interface Conversation {
  id: string;
  title: string | null;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
}

interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (days > 0)  return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (hours > 0) return `Il y a ${hours}h`;
  if (mins > 0)  return `Il y a ${mins}m`;
  return 'À l\'instant';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryView() {
  const { success, error: toastError } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/conversations?limit=50')
      .then(r => r.json())
      .then(d => setConversations(d.conversations || []))
      .catch(() => toastError('Impossible de charger l\'historique'))
      .finally(() => setLoading(false));
  }, [toastError]);

  useEffect(() => { load(); }, [load]);

  const filtered = conversations.filter(c => {
    if (query.length === 0) return true;
    const title = (c.title || '').toLowerCase();
    return title.includes(query.toLowerCase());
  });

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConversations(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setMessages([]);
      }
      success('Conversation supprimée');
    } catch {
      toastError('Impossible de supprimer la conversation');
    } finally {
      setDeleting(null);
    }
  }, [success, toastError, selectedId]);

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/conversations/${id}?limit=200`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      toastError('Impossible de charger la conversation');
    } finally {
      setLoadingMessages(false);
    }
  }, [toastError]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--notebook-canvas, var(--bg-base))' }}>
      {/* Header */}
      <ViewHeader
        icon={History}
        title="Historique"
        badge="Persistant"
        description="Toutes vos conversations passées avec Leanna"
        actions={
          <>
            <span className="hidden text-[10px] sm:inline" style={{ color: 'var(--text-muted)' }}>{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</span>
            <button
              type="button"
              onClick={load}
              className="rounded-lg p-2 transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Rafraîchir"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left — Conversations list */}
        <div className="w-80 flex-shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--notebook-border, var(--border-base))', backgroundColor: 'var(--notebook-surface)' }}>
          {/* Search */}
          <div className="px-4 py-3 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher une conversation..."
                className="w-full pl-8 pr-3 py-2.5 rounded-lg text-xs outline-none transition focus:ring-2"
                style={{
                  backgroundColor: 'var(--notebook-surface-muted)',
                  border: '1px solid var(--notebook-border)',
                  color: 'var(--text-primary)',
                  ['--tw-ring-color' as any]: 'var(--notebook-accent)',
                }}
                aria-label="Rechercher dans les conversations"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-3 pb-4 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <History className="w-6 h-6 animate-pulse" style={{ color: 'var(--text-dimmed)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <MessageSquare className="w-8 h-8" style={{ color: 'var(--text-dimmed)' }} />
                <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                  {query ? 'Aucune correspondance' : 'Aucune conversation enregistrée'}
                </p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filtered.map((conv, i) => (
                  <motion.div
                    key={conv.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.15, delay: i < 10 ? i * 0.02 : 0 }}
                    onClick={() => handleSelect(conv.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(conv.id); }}
                    className={`w-full text-left p-3 rounded-lg mb-1.5 transition-all group cursor-pointer ${
                      selectedId === conv.id ? 'ring-1' : ''
                    }`}
                    style={{
                      backgroundColor: selectedId === conv.id ? 'var(--notebook-accent-surface)' : 'transparent',
                      border: `1px solid ${selectedId === conv.id ? 'var(--notebook-accent)' : 'var(--notebook-border)'}`,
                      ...(selectedId === conv.id ? { ringColor: 'var(--notebook-accent)' } : {}),
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {conv.title || 'Conversation sans titre'}
                        </p>
                        {conv.summary && (
                          <p className="text-[10px] leading-snug mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                            {conv.summary}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
                            {timeAgo(conv.started_at)}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>•</span>
                          <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
                            {conv.message_count} msg
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--notebook-border)' }}>
                      <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
                        {selectedId === conv.id ? 'Conversation ouverte' : 'Prête à être consultée'}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleSelect(conv.id); }}
                          className="rounded-md p-1.5 transition hover:bg-[var(--notebook-accent-hover)]"
                          style={{ color: 'var(--notebook-accent)' }}
                          aria-label={`Sélectionner ${conv.title || 'la conversation'}`}
                          title="Sélectionner"
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(conv.id, e)}
                          disabled={deleting === conv.id}
                          className="rounded-md p-1.5 transition hover:bg-[var(--color-error-subtle)] disabled:opacity-50"
                          style={{ color: 'var(--color-error)' }}
                          aria-label={`Supprimer ${conv.title || 'la conversation'}`}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Right — Conversation detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedId && messages.length > 0 ? (
            <>
              {/* Conversation header */}
              <div className="flex-shrink-0 px-6 py-4 border-b" style={{ borderColor: 'var(--notebook-border)', backgroundColor: 'var(--notebook-surface-elevated)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--notebook-accent-surface)' }}>
                    <MessageSquare className="w-4 h-4" style={{ color: 'var(--notebook-accent)' }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {conversations.find(c => c.id === selectedId)?.title || 'Conversation'}
                    </p>
                    <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-dimmed)' }}>
                      {formatDate(conversations.find(c => c.id === selectedId)?.started_at || '')} — {messages.length} messages
                    </p>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <MessageList messages={messages} loadingMessages={loadingMessages} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <History className="w-12 h-12" style={{ color: 'var(--text-dimmed)' }} />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                  {selectedId ? 'Chargement...' : 'Sélectionnez une conversation'}
                </p>
                <p className="text-xs max-w-xs" style={{ color: 'var(--text-dimmed)' }}>
                  Cliquez sur une conversation à gauche pour voir les messages échangés.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MessageList sub-component ───────────────────────────────────────────────

function formatMessageContent(content: string): React.ReactNode {
  // Split into paragraphs and render with proper spacing
  const paragraphs = content.split(/\n{2,}/);
  if (paragraphs.length <= 1) {
    // Single paragraph — still handle single newlines
    const lines = content.split('\n');
    if (lines.length <= 1) return content;
    return lines.map((line, i) => (
      <React.Fragment key={`${i}-${line.slice(0, 50)}`}>
        {line}
        {i < lines.length - 1 && <br />}
      </React.Fragment>
    ));
  }
  return paragraphs.map((para, i) => (
    <p key={`${i}-${para.slice(0, 50)}`} className={i > 0 ? 'mt-2' : ''}>
      {para.split('\n').map((line, j, arr) => (
        <React.Fragment key={j}>
          {line}
          {j < arr.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  ));
}

function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function shouldShowTimestamp(messages: ConversationMessage[], index: number): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].created_at).getTime();
  const curr = new Date(messages[index].created_at).getTime();
  // Show timestamp if more than 5 minutes between messages
  return (curr - prev) > 5 * 60 * 1000;
}

function MessageList({ messages, loadingMessages }: { messages: ConversationMessage[]; loadingMessages: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loadingMessages) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--text-dimmed)' }} />
      </div>
    );
  }

  let lastDateLabel = '';

  return (
    <div className="space-y-1">
      {messages.map((msg, index) => {
        const dateLabel = getDateLabel(msg.created_at);
        const showDateSeparator = dateLabel !== lastDateLabel;
        if (showDateSeparator) lastDateLabel = dateLabel;

        const isAssistant = msg.role === 'assistant';
        const showTime = shouldShowTimestamp(messages, index);
        const isConsecutiveSameRole = index > 0 && messages[index - 1].role === msg.role && !showTime;

        return (
          <React.Fragment key={msg.id}>
            {/* Date separator */}
            {showDateSeparator && (
              <div className="flex items-center gap-3 py-4">
                <div className="flex-1 h-px" style={{ backgroundColor: 'var(--notebook-border, var(--border-base))' }} />
                <span className="text-[10px] font-medium uppercase tracking-wider px-2" style={{ color: 'var(--text-dimmed)' }}>
                  {dateLabel}
                </span>
                <div className="flex-1 h-px" style={{ backgroundColor: 'var(--notebook-border, var(--border-base))' }} />
              </div>
            )}

            {/* Timestamp between message groups */}
            {showTime && !showDateSeparator && index > 0 && (
              <div className="flex justify-center py-2">
                <span className="text-[9px] font-mono px-2 py-0.5 rounded-md" style={{ color: 'var(--text-dimmed)', backgroundColor: 'var(--notebook-surface-muted)' }}>
                  {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}

            {/* Message bubble */}
            <div
              className={`flex gap-2.5 ${isAssistant ? 'flex-row' : 'flex-row-reverse'} ${isConsecutiveSameRole ? 'mt-0.5' : 'mt-3'}`}
            >
              {/* Avatar — only show on first message of a group */}
              {!isConsecutiveSameRole ? (
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center shadow-sm"
                  style={{
                    backgroundColor: isAssistant ? 'var(--notebook-accent-surface)' : 'var(--notebook-surface-muted)',
                    border: `1.5px solid ${isAssistant ? 'var(--notebook-accent)' : 'var(--notebook-border)'}`,
                  }}
                >
                  {isAssistant
                    ? <Cpu className="w-3 h-3" style={{ color: 'var(--notebook-accent)' }} />
                    : <User className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                  }
                </div>
              ) : (
                <div className="w-7 flex-shrink-0" /> // spacer for alignment
              )}

              {/* Content */}
              <div className={`flex flex-col gap-0.5 max-w-[75%] ${isAssistant ? 'items-start' : 'items-end'}`}>
                {/* Role label on first message of group */}
                {!isConsecutiveSameRole && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1 mb-0.5" style={{ color: 'var(--text-dimmed)' }}>
                    {isAssistant ? 'Leanna' : 'Vous'}
                  </span>
                )}

                {/* Bubble */}
                <div
                  className="px-4 py-2.5 text-[13px] leading-[1.6] whitespace-pre-wrap"
                  style={{
                    backgroundColor: isAssistant ? 'var(--notebook-surface)' : 'var(--notebook-accent-surface)',
                    border: `1px solid ${isAssistant ? 'var(--notebook-border)' : 'var(--notebook-accent)'}`,
                    color: isAssistant ? 'var(--text-primary)' : 'var(--notebook-accent)',
                    borderRadius: isAssistant
                      ? (isConsecutiveSameRole ? '12px 16px 16px 12px' : '4px 16px 16px 12px')
                      : (isConsecutiveSameRole ? '16px 12px 12px 16px' : '16px 4px 12px 16px'),
                  }}
                >
                  {formatMessageContent(msg.content)}
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
