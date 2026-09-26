/**
 * NotebookChat — Chat Q&A groundé sur les sources du notebook
 *
 * Interface de conversation avec citations, streaming SSE, suggestions,
 * deep dive, rendu markdown, et UX amélioré.
 */

import { useEffect, useState, useCallback, useRef, useMemo, type JSX } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Send, Loader2, Lightbulb, BookOpen, Trash2, Quote, Telescope, Download,
  MessageCircle, ArrowDown, GitCompare, Zap, StickyNote, Volume2, Square,
  Copy, Check, RefreshCw, Pencil, StopCircle, ThumbsUp, ThumbsDown,
  Filter, X, MessageSquarePlus, ChevronDown, FolderOpen, Folder, FileDown,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';
import { MermaidDiagram } from './MermaidDiagram.js';

interface Citation {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  excerpt: string;
  relevance: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  timestamp: string;
}

interface Props {
  notebookId: string;
  hasSources: boolean;
  sources?: { id: string; title: string }[];
  onRefresh?: () => void;
}

interface SandboxFolder {
  path: string;
  name: string;
  depth: number;
}

interface QueuedChatRequest {
  id: string;
  question: string;
  sourceIds?: string[];
  personality?: string;
  threadId?: string;
}

// Critically damped default — graceful settle, no overshoot. Used for
// anything not triggered by a physical gesture (menus, message entrance,
// panel reveals).
const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.3 };
// Slight bounce, reserved for momentum-flavoured moments (a message that
// just "arrived", a floating action button appearing).
const SPRING_MOMENTUM = { type: 'spring' as const, bounce: 0.2, duration: 0.3 };

/** Rich markdown rendering for chat messages */
function renderMessageContent(content: string): JSX.Element {
  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0]?.trim().toLowerCase() || '';
          const code = (lang ? lines.slice(1) : lines).join('\n').trim();

          // Render Mermaid diagrams
          if (lang === 'mermaid') {
            return <MermaidDiagram key={i} code={code} id={`chat-${i}`} />;
          }

          return (
            <div key={i} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--notebook-border)' }}>
              {/* Code block header with language tag */}
              {lang && (
                <div
                  className="flex items-center justify-between px-3 py-1.5"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-base)' }}
                >
                  <span className="text-smfont-mono font-medium uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                    {lang}
                  </span>
                </div>
              )}
              <pre
                className="px-4 py-3 text-smoverflow-x-auto font-mono leading-relaxed"
                style={{ backgroundColor: 'var(--bg-base)', margin: 0 }}
              >
                <code style={{ color: 'var(--text-secondary)' }}>{code}</code>
              </pre>
            </div>
          );
        }

        // Process block-level markdown
        const lines = part.split('\n');
        const blocks: JSX.Element[] = [];
        let blockIdx = 0;
        let inBlockquote = false;
        let blockquoteLines: string[] = [];
        let inTable = false;
        let tableRows: string[] = [];

        const flushBlockquote = () => {
          if (blockquoteLines.length > 0) {
            blocks.push(
              <blockquote
                key={`bq-${blockIdx++}`}
                className="pl-3 py-1.5 my-1 rounded-r-lg"
                style={{
                  borderLeft: '3px solid var(--accent-primary)',
                  backgroundColor: 'var(--accent-subtle)',
                }}
              >
                {blockquoteLines.map((line, j) => (
                  <p key={j} className="text-smleading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {renderInlineMarkdown(line)}
                  </p>
                ))}
              </blockquote>
            );
            blockquoteLines = [];
          }
          inBlockquote = false;
        };

        const flushTable = () => {
          if (tableRows.length > 0) {
            const headerRow = tableRows[0].split('|').filter(c => c.trim());
            const dataRows = tableRows.slice(2).map(row => row.split('|').filter(c => c.trim()));

            blocks.push(
              <div key={`tbl-${blockIdx++}`} className="overflow-x-auto my-2 rounded-lg" style={{ border: '1px solid var(--border-base)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      {headerRow.map((cell, ci) => (
                        <th key={ci} className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-base)' }}>
                          {cell.trim()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, ri) => (
                      <tr key={ri} style={{ borderBottom: ri < dataRows.length - 1 ? '1px solid var(--border-base)' : 'none' }}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                            {renderInlineMarkdown(cell.trim())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            tableRows = [];
          }
          inTable = false;
        };

        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];

          // Table detection
          if (line.includes('|') && line.trim().startsWith('|')) {
            if (!inTable) {
              flushBlockquote();
              inTable = true;
            }
            tableRows.push(line);
            continue;
          } else if (inTable) {
            flushTable();
          }

          // Blockquote
          if (line.startsWith('>')) {
            if (!inBlockquote) {
              inBlockquote = true;
            }
            blockquoteLines.push(line.replace(/^>\s?/, ''));
            continue;
          } else if (inBlockquote) {
            flushBlockquote();
          }

          // Empty line
          if (!line.trim()) {
            blocks.push(<div key={`sp-${blockIdx++}`} className="h-2" />);
            continue;
          }

          // Horizontal rule
          if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
            blocks.push(
              <hr key={`hr-${blockIdx++}`} className="my-3 border-none" style={{ height: '1px', backgroundColor: 'var(--border-base)' }} />
            );
            continue;
          }

          // Headers
          if (line.startsWith('#### ')) {
            blocks.push(
              <h4 key={`h4-${blockIdx++}`} className="text-smfont-bold mt-3 mb-1" style={{ color: 'var(--text-primary)' }}>
                {renderInlineMarkdown(line.slice(5))}
              </h4>
            );
            continue;
          }
          if (line.startsWith('### ')) {
            blocks.push(
              <h3 key={`h3-${blockIdx++}`} className="text-smfont-bold mt-3 mb-1" style={{ color: 'var(--text-primary)' }}>
                {renderInlineMarkdown(line.slice(4))}
              </h3>
            );
            continue;
          }
          if (line.startsWith('## ')) {
            blocks.push(
              <h2 key={`h2-${blockIdx++}`} className="text-sm font-bold mt-4 mb-1.5" style={{ color: 'var(--text-primary)' }}>
                {renderInlineMarkdown(line.slice(3))}
              </h2>
            );
            continue;
          }
          if (line.startsWith('# ')) {
            blocks.push(
              <h1 key={`h1-${blockIdx++}`} className="text-sm font-bold mt-4 mb-1.5" style={{ color: 'var(--text-primary)' }}>
                {renderInlineMarkdown(line.slice(2))}
              </h1>
            );
            continue;
          }

          // Unordered lists
          if (line.match(/^[\-\*]\s/)) {
            blocks.push(
              <div key={`ul-${blockIdx++}`} className="flex gap-2.5 pl-2 my-0.5">
                <span
                  className="mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: 'var(--accent-primary)', opacity: 0.7 }}
                />
                <span className="text-smleading-relaxed flex-1" style={{ color: 'var(--text-secondary)' }}>
                  {renderInlineMarkdown(line.slice(2))}
                </span>
              </div>
            );
            continue;
          }

          // Ordered lists
          if (line.match(/^\d+\.\s/)) {
            const num = line.match(/^(\d+)\./)?.[1];
            blocks.push(
              <div key={`ol-${blockIdx++}`} className="flex gap-2.5 pl-2 my-0.5">
                <span
                  className="text-smfont-bold min-w-[16px] mt-[2px] flex-shrink-0 text-center rounded"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {num}
                </span>
                <span className="text-smleading-relaxed flex-1" style={{ color: 'var(--text-secondary)' }}>
                  {renderInlineMarkdown(line.replace(/^\d+\.\s/, ''))}
                </span>
              </div>
            );
            continue;
          }

          // Regular paragraph
          blocks.push(
            <p key={`p-${blockIdx++}`} className="text-smleading-[1.7]" style={{ color: 'var(--text-secondary)' }}>
              {renderInlineMarkdown(line)}
            </p>
          );
        }

        // Flush remaining
        if (inBlockquote) flushBlockquote();
        if (inTable) flushTable();

        return <div key={i}>{blocks}</div>;
      })}
    </div>
  );
}

/** Render inline markdown: **bold**, *italic*, `code`, [links](url) */
function renderInlineMarkdown(text: string): (string | JSX.Element)[] {
  const tokens: (string | JSX.Element)[] = [];
  // Regex to match inline elements
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    // Push text before this match
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      tokens.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // *italic*
      tokens.push(
        <em key={`i-${keyIdx++}`} className="italic" style={{ color: 'var(--text-secondary)' }}>
          {match[4]}
        </em>
      );
    } else if (match[5]) {
      // `inline code`
      tokens.push(
        <code
          key={`c-${keyIdx++}`}
          className="px-1.5 py-0.5 rounded text-smfont-mono"
          style={{ backgroundColor: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-base)' }}
        >
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      // [text](url)
      tokens.push(
        <a
          key={`a-${keyIdx++}`}
          href={match[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--accent-primary)' }}
        >
          {match[8]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens.length > 0 ? tokens : [text];
}

export function NotebookChat({ notebookId, hasSources, sources = [], onRefresh }: Props) {
  const { error: toastError, success: toastSuccess } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  
  // Clé pour persister l'état de génération dans localStorage (partagé entre onglets)
  const generationStateKey = `notebook-chat-generation-${notebookId}`;
  
  // Fonction pour charger l'état de génération depuis localStorage
  const loadGenerationState = useCallback(() => {
    try {
      const saved = localStorage.getItem(generationStateKey);
      if (saved) {
        const state = JSON.parse(saved);
        // Ignorer les états trop anciens (plus de 5 minutes)
        if (state.timestamp && Date.now() - state.timestamp < 5 * 60 * 1000) {
          return state;
        }
      }
    } catch (e) {
      console.warn('[NotebookChat] Erreur chargement état génération:', e);
    }
    return { loading: false, streamingText: '', deepDiveProgress: '' };
  }, [generationStateKey]);
  
  // Fonction pour sauvegarder l'état de génération dans localStorage
  const saveGenerationState = useCallback((loading: boolean, streamingText: string, deepDiveProgress: string) => {
    try {
      localStorage.setItem(generationStateKey, JSON.stringify({ loading, streamingText, deepDiveProgress, timestamp: Date.now() }));
      // Déclencher un événement pour notifier les autres onglets
      window.dispatchEvent(new StorageEvent('storage', {
        key: generationStateKey,
        newValue: JSON.stringify({ loading, streamingText, deepDiveProgress, timestamp: Date.now() }),
        storageArea: localStorage,
      }));
    } catch (e) {
      console.warn('[NotebookChat] Erreur sauvegarde état génération:', e);
    }
  }, [generationStateKey]);
  
  // Initialiser les états avec les valeurs persistées
  const [loading, setLoading] = useState(() => loadGenerationState().loading);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [followUpOffset, setFollowUpOffset] = useState(0);
  const [streamingText, setStreamingText] = useState(() => loadGenerationState().streamingText);
  const [deepDiveProgress, setDeepDiveProgress] = useState(() => loadGenerationState().deepDiveProgress);
  const [showCitations, setShowCitations] = useState<string | null>(null);
  const [hoveredCitation, setHoveredCitation] = useState<{ citation: Citation; fullContent: string; x: number; y: number } | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({});
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [showSourceFilter, setShowSourceFilter] = useState(false);
  const [personality, setPersonality] = useState<string>('default');
  const [showPersonalityMenu, setShowPersonalityMenu] = useState(false);
  const [threads, setThreads] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showThreadList, setShowThreadList] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  // ─── Folder Picker (save as MD) ───────────────────────────────────────────
  const [folderPickerMsg, setFolderPickerMsg] = useState<ChatMessage | null>(null);
  const [sandboxFolders, setSandboxFolders] = useState<SandboxFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [customFolderName, setCustomFolderName] = useState('');
  const [savingMd, setSavingMd] = useState(false);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chunkCache = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // FIFO queue for chat generations. Only one request streams at a time.
  const requestQueueRef = useRef<QueuedChatRequest[]>([]);
  const processingQueueRef = useRef(false);
  const [queuedCount, setQueuedCount] = useState(0);

  // Persister l'état de génération dans localStorage
  useEffect(() => {
    saveGenerationState(loading, streamingText, deepDiveProgress);
  }, [loading, streamingText, deepDiveProgress, saveGenerationState]);
  
  // Nettoyer localStorage quand la génération est terminée
  useEffect(() => {
    if (!loading && !streamingText && !deepDiveProgress) {
      try {
        localStorage.removeItem(generationStateKey);
      } catch (e) {
        console.warn('[NotebookChat] Erreur suppression état génération:', e);
      }
    }
  }, [loading, streamingText, deepDiveProgress, generationStateKey]);
  
  // Écouter les changements de localStorage pour synchroniser avec les autres onglets
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === generationStateKey && e.newValue) {
        try {
          const state = JSON.parse(e.newValue);
          // Vérifier que l'état n'est pas trop ancien
          if (state.timestamp && Date.now() - state.timestamp < 5 * 60 * 1000) {
            setLoading(state.loading || false);
            setStreamingText(state.streamingText || '');
            setDeepDiveProgress(state.deepDiveProgress || '');
          }
        } catch (err) {
          console.warn('[NotebookChat] Erreur parsing storage event:', err);
        }
      } else if (e.key === generationStateKey && !e.newValue) {
        // L'état a été supprimé (génération terminée dans un autre onglet)
        setLoading(false);
        setStreamingText('');
        setDeepDiveProgress('');
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [generationStateKey]);
  
  // Charger la liste des threads (une seule fois)
  useEffect(() => {
    (async () => {
      try {
        const threadsRes = await fetch(`/api/notebooks/${notebookId}/chat/threads`);
        if (threadsRes.ok) {
          const data = await threadsRes.json();
          setThreads(data.threads || []);
        }
      } catch { /* ignore */ }
    })();
  }, [notebookId]);

  // Charger l'historique du thread actif (ou conversation principale si null)
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      try {
        const threadParam = activeThreadId ? `?threadId=${activeThreadId}` : '';
        const res = await fetch(`/api/notebooks/${notebookId}/chat/history${threadParam}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setMessages(data.messages || []);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoadingHistory(false);
    })();

    return () => { cancelled = true; };
  }, [notebookId, activeThreadId]);

  // Charger les suggestions une seule fois au montage
  const suggestionsLoadedRef = useRef(false);
  useEffect(() => {
    if (!hasSources || suggestionsLoadedRef.current) return;
    suggestionsLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/chat/suggestions`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } catch { /* ignore */ }
    })();
  }, [notebookId, hasSources]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Detect scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollBtn(!atBottom && messages.length > 3);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ─── TTS — Text-to-Speech (via serveur TTS avancé) ──────────────────────

  const ttsAudioCtxRef = useRef<AudioContext | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsNextStartRef = useRef<number>(0);

  const getTTSAudioContext = useCallback(() => {
    if (!ttsAudioCtxRef.current || ttsAudioCtxRef.current.state === 'closed') {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ttsAudioCtxRef.current = new AC({ sampleRate: 24000 });
    }
    return ttsAudioCtxRef.current;
  }, []);

  const playTTSChunk = useCallback((base64Audio: string) => {
    const audioCtx = getTTSAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    try {
      const binaryStr = atob(base64Audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;
      const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      const startTime = Math.max(now, ttsNextStartRef.current);
      source.start(startTime);
      ttsNextStartRef.current = startTime + audioBuffer.duration;
    } catch (e) {
      console.error('[NotebookChat TTS] Erreur lecture audio:', e);
    }
  }, [getTTSAudioContext]);

  const stopTTS = useCallback(() => {
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (ttsAudioCtxRef.current && ttsAudioCtxRef.current.state !== 'closed') {
      ttsAudioCtxRef.current.close().catch((err) => {
        console.debug('[NotebookChat] TTS AudioContext close failed:', err);
      });
      ttsAudioCtxRef.current = null;
    }
    ttsNextStartRef.current = 0;
    setSpeakingMsgId(null);
  }, []);

  const handleTTS = useCallback(async (msgId: string, content: string) => {
    // Toggle off if already playing this message
    if (speakingMsgId === msgId) {
      stopTTS();
      return;
    }

    // Stop any ongoing TTS
    stopTTS();

    setSpeakingMsgId(msgId);
    ttsNextStartRef.current = 0;

    const controller = new AbortController();
    ttsAbortRef.current = controller;

    try {
      // Utiliser le streaming SSE pour les textes longs, requête simple sinon
      if (content.length > 500) {
        const res = await fetch('/api/tts/speak-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content, voice: 'ff_siwis' }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`TTS stream error: ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No stream body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const event of events) {
            if (!event.trim()) continue;
            const lines = event.split('\n');
            let eventType = '';
            let data = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) eventType = line.slice(7);
              if (line.startsWith('data: ')) data = line.slice(6);
            }
            if (eventType === 'chunk') {
              const parsed = JSON.parse(data);
              if (parsed.audio) playTTSChunk(parsed.audio);
            }
          }
        }
      } else {
        const res = await fetch('/api/tts/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content, voice: 'ff_siwis' }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`TTS error: ${res.status}`);
        const data = await res.json();
        if (data.audio) playTTSChunk(data.audio);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('[NotebookChat TTS] Erreur:', e.message);
      }
    } finally {
      // Attendre la fin de la lecture audio avant de réinitialiser l'état
      const ctx = ttsAudioCtxRef.current;
      if (ctx && ctx.state !== 'closed' && ttsNextStartRef.current > ctx.currentTime) {
        const remainingMs = (ttsNextStartRef.current - ctx.currentTime) * 1000;
        setTimeout(() => {
          setSpeakingMsgId((current) => current === msgId ? null : current);
        }, remainingMs + 100);
      } else {
        setSpeakingMsgId((current) => current === msgId ? null : current);
      }
      ttsAbortRef.current = null;
    }
  }, [speakingMsgId, stopTTS, playTTSChunk]);

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      if (ttsAbortRef.current) ttsAbortRef.current.abort();
      if (ttsAudioCtxRef.current && ttsAudioCtxRef.current.state !== 'closed') {
        ttsAudioCtxRef.current.close().catch((err) => {
          console.debug('[NotebookChat] TTS AudioContext close failed (cleanup):', err);
        });
      }
    };
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showContextMenu && !target.closest?.('.context-menu-container')) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContextMenu]);


  // ─── Copy to Clipboard ────────────────────────────────────────────────────

  const handleCopy = useCallback(async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    }
  }, []);

  // ─── Save Message as Markdown ─────────────────────────────────────────────

  const openFolderPicker = useCallback(async (msg: ChatMessage) => {
    setFolderPickerMsg(msg);
    setSelectedFolder('');
    setCustomFolderName('');
    try {
      const res = await fetch('/api/notebooks/sandbox/folders');
      if (res.ok) {
        const data = await res.json();
        setSandboxFolders(data.folders || []);
      }
    } catch { /* ignore */ }
  }, []);

  const handleSaveAsMarkdown = useCallback(async () => {
    if (!folderPickerMsg) return;
    setSavingMd(true);
    try {
      // Le dossier final : soit le custom saisi, soit la sélection
      const folder = customFolderName.trim()
        ? customFolderName.trim()
        : selectedFolder;

      const res = await fetch(`/api/notebooks/${notebookId}/chat/save-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: folderPickerMsg.id, folder: folder || undefined }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      
      // Import ideApi dynamiquement pour éviter les dépendances circulaires
      const { ideApi } = await import('../../services/ideApi.js');
      
      // Invalider le cache de l'arborescence pour forcer le rafraîchissement
      ideApi.invalidateCache();
      
      // Déclencher l'événement standard pour rafraîchir l'arborescence du sandbox
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
      
      toastSuccess(`✓ Sauvegardé : ${data.filePath}`);
      setFolderPickerMsg(null);
    } catch (e: any) {
      toastError(`Erreur : ${e.message}`);
    } finally {
      setSavingMd(false);
    }
  }, [folderPickerMsg, notebookId, selectedFolder, customFolderName, toastError, toastSuccess]);

  // ─── Edit User Message (start/cancel only — submit defined after handleSend) ─

  const handleEditStart = useCallback((msgId: string, content: string) => {
    setEditingMsgId(msgId);
    setEditingContent(content);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingMsgId(null);
    setEditingContent('');
  }, []);

  // ─── Stop Streaming ───────────────────────────────────────────────────────

  const handleStopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (streamingText) {
      // Save the partial response as a message
      setMessages(prev => [...prev, {
        id: `partial-${Date.now()}`,
        role: 'assistant',
        content: streamingText + '\n\n*(réponse interrompue)*',
        citations: [],
        timestamp: new Date().toISOString(),
      }]);
      setStreamingText('');
    }
    setDeepDiveProgress('');
  }, [streamingText]);

  // ─── Feedback (thumbs up/down) ────────────────────────────────────────────

  const handleFeedback = useCallback(async (msgId: string, type: 'up' | 'down') => {
    // Toggle: if same feedback, remove it
    const current = feedbackMap[msgId];
    const newType = current === type ? undefined : type;

    setFeedbackMap(prev => {
      const next = { ...prev };
      if (newType) next[msgId] = newType;
      else delete next[msgId];
      return next;
    });

    // Send to backend (fire & forget)
    try {
      await fetch(`/api/notebooks/${notebookId}/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId, feedback: newType || null }),
      });
    } catch { /* silent */ }
  }, [feedbackMap, notebookId]);

  // ─── Source Filter ────────────────────────────────────────────────────────

  const toggleSourceFilter = useCallback((sourceId: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  }, []);

  const clearSourceFilter = useCallback(() => {
    setSelectedSources([]);
    setShowSourceFilter(false);
  }, []);

  // ─── Thread Management ────────────────────────────────────────────────────

  const handleNewThread = useCallback(async () => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Conversation ${threads.length + 1}` }),
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(prev => [data.thread, ...prev]);
        setActiveThreadId(data.thread.id);
        setMessages([]);
        setFollowUps([]);
      }
    } catch { /* ignore */ }
  }, [notebookId, threads.length]);

  const handleSwitchThread = useCallback((threadId: string | null) => {
    if (threadId === activeThreadId) {
      setShowThreadList(false);
      return;
    }
    setActiveThreadId(threadId);
    setShowThreadList(false);
    setFollowUps([]);
    setStreamingText('');
  }, [activeThreadId]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    try {
      await fetch(`/api/notebooks/${notebookId}/chat/threads/${threadId}`, { method: 'DELETE' });
      setThreads(prev => prev.filter(t => t.id !== threadId));
      if (activeThreadId === threadId) {
        const remaining = threads.filter(t => t.id !== threadId);
        if (remaining.length > 0) {
          setActiveThreadId(remaining[0].id);
        } else {
          setActiveThreadId(null);
          setMessages([]);
        }
      }
    } catch { /* ignore */ }
  }, [notebookId, activeThreadId, threads]);

  // ─── Slash Commands ───────────────────────────────────────────────────────

  const slashCommands = useMemo(() => [
    { cmd: '/résume', desc: 'Résumer les sources', prompt: 'Résume les sources principales de ce notebook' },
    { cmd: '/compare', desc: 'Comparer les sources', prompt: 'Compare les sources entre elles en identifiant les points communs et divergences' },
    { cmd: '/quiz', desc: 'Générer un quiz', prompt: 'Génère un quiz de 10 questions avec réponses basé sur les sources' },
    { cmd: '/insights', desc: 'Extraire les insights', prompt: 'Extrais les insights et conclusions clés des sources' },
    { cmd: '/glossaire', desc: 'Créer un glossaire', prompt: 'Crée un glossaire des termes importants trouvés dans les sources' },
    { cmd: '/plan', desc: 'Plan de révision', prompt: 'Crée un plan de révision structuré basé sur les sources' },
  ], []);

  const contextSuggestions = useMemo(() => [
    { label: "Suggère moi des améliorations", prompt: "Suggère moi des améliorations pour ce contenu" },
    { label: "Résumé complet", prompt: "Fais un résumé complet de toutes les sources" },
    { label: "Points clés", prompt: "Quels sont les points clés à retenir de ces sources?" },
    { label: "Actions recommandées", prompt: "Quelles actions ou décisions recommandes-tu basé sur ce contenu?" },
    { label: "Analyse complète", prompt: "Fais une analyse complète et détaillée du contenu" },
    { label: "Lacunes et opportunités", prompt: "Quelles sont les lacunes, faiblesses ou opportunités dans ces sources?" },
  ], []);

  const showSlashMenu = input.startsWith('/') && !input.includes(' ');
  const filteredSlashCommands = showSlashMenu
    ? slashCommands.filter(c => c.cmd.startsWith(input.toLowerCase()))
    : [];

  // ─── Personalities / Tone ─────────────────────────────────────────────────

  const personalities = useMemo(() => [
    { id: 'default', label: 'Standard', emoji: '🤖', desc: 'Réponses équilibrées et claires' },
    { id: 'academic', label: 'Académique', emoji: '🎓', desc: 'Ton formel, citations, rigueur scientifique' },
    { id: 'simple', label: 'Vulgarisateur', emoji: '💡', desc: 'Explications simples, analogies, accessible' },
    { id: 'concise', label: 'Concis', emoji: '⚡', desc: 'Réponses courtes et directes, bullet points' },
    { id: 'detailed', label: 'Détaillé', emoji: '📖', desc: 'Analyses approfondies, exemples multiples' },
    { id: 'creative', label: 'Créatif', emoji: '🎨', desc: 'Ton engageant, métaphores, storytelling' },
  ], []);

  const currentPersonality = personalities.find(p => p.id === personality) || personalities[0];

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  // ─── Streaming Send / FIFO queue ───────────────────────────────────────────

  const processChatQueue = useCallback(async () => {
    // Prevent two queue workers from running at the same time.
    if (processingQueueRef.current) return;

    processingQueueRef.current = true;
    setLoading(true);

    try {
      while (requestQueueRef.current.length > 0) {
        const request = requestQueueRef.current.shift()!;
        setQueuedCount(requestQueueRef.current.length);
        setStreamingText('');

        try {
          abortRef.current = new AbortController();

          const res = await fetch(`/api/notebooks/${notebookId}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: request.question,
              sourceIds: request.sourceIds,
              personality: request.personality,
              threadId: request.threadId,
            }),
            signal: abortRef.current.signal,
          });

          if (!res.ok) {
            const d = await res.json().catch(() => ({ error: 'Erreur' }));
            throw new Error(d.error || `HTTP ${res.status}`);
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error('Pas de body stream');

          const decoder = new TextDecoder();
          let buffer = '';
          let accumulated = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;

              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);

                if (parsed.text) {
                  accumulated += parsed.text;
                  setStreamingText(accumulated);
                } else if (parsed.message) {
                  setStreamingText('');
                  setMessages(prev => [...prev, parsed.message]);

                  if (!document.hidden) {
                    toastSuccess('✓ Réponse générée avec succès');
                  }
                } else if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (e: unknown) {
                if (e instanceof Error && !e.message.includes('JSON')) {
                  throw e;
                }
              }
            }
          }
        } catch (e: unknown) {
          if (e instanceof DOMException && e.name === 'AbortError') {
            // Stop only the current request. Pending requests remain in the FIFO queue.
            continue;
          }

          const message = e instanceof Error ? e.message : 'Erreur inconnue';
          toastError(message);
          setStreamingText('');
          setMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `❌ Erreur: ${message}`,
            citations: [],
            timestamp: new Date().toISOString(),
          }]);
        } finally {
          abortRef.current = null;
          setStreamingText('');
        }
      }
    } finally {
      processingQueueRef.current = false;
      setQueuedCount(requestQueueRef.current.length);
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [notebookId, toastError, toastSuccess]);

  const handleSend = useCallback((question?: string) => {
    const q = (question ?? input).trim();
    if (!q) return;

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const request: QueuedChatRequest = {
      id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: q,
      sourceIds: selectedSources.length > 0 ? [...selectedSources] : undefined,
      personality: personality !== 'default' ? personality : undefined,
      threadId: activeThreadId || undefined,
    };

    const tempUserMsg: ChatMessage = {
      id: `temp-${request.id}`,
      role: 'user',
      content: q,
      citations: [],
      timestamp: new Date().toISOString(),
    };

    // Add the user message immediately, then process requests strictly FIFO.
    setMessages(prev => [...prev, tempUserMsg]);
    requestQueueRef.current.push(request);
    setQueuedCount(requestQueueRef.current.length);

    // Do not await here: this keeps UI interactions responsive while the queue runs.
    void processChatQueue();
  }, [input, selectedSources, personality, activeThreadId, processChatQueue]);

  // ─── Retry / Regenerate (must be after handleSend) ─────────────────────────

  const handleRetry = useCallback(async (msgId: string) => {
    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex < 1) return;

    const userMsg = messages[msgIndex - 1];
    if (userMsg.role !== 'user') return;

    // Remove the assistant answer and resend the question
    setMessages(prev => prev.filter((_, i) => i !== msgIndex));
    setTimeout(() => handleSend(userMsg.content), 50);
  }, [messages, handleSend]);

  // ─── Edit Submit (must be after handleSend) ────────────────────────────────

  const handleEditSubmit = useCallback((msgId: string) => {
    const newContent = editingContent.trim();
    if (!newContent) return;

    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex < 0) return;

    // Remove this message and all subsequent messages, then resend
    setMessages(prev => prev.slice(0, msgIndex));
    setEditingMsgId(null);
    setEditingContent('');
    setTimeout(() => handleSend(newContent), 50);
  }, [editingContent, messages, handleSend]);

  // ─── Deep Dive ─────────────────────────────────────────────────────────────

  const handleDeepDive = useCallback(async (question?: string) => {
    const q = (question || input).trim();
    if (!q || loading) return;

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    setStreamingText('');
    setDeepDiveProgress('');

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: `🔬 [Deep Dive] ${q}`,
      citations: [],
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat/deep-dive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Pas de body stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.stage) {
                setDeepDiveProgress(parsed.content || parsed.stage);
              } else if (parsed.message) {
                setDeepDiveProgress('');
                setMessages(prev => [...prev, parsed.message]);
                
                // Notification de fin de génération
                if (!document.hidden) {
                  toastSuccess('✓ Deep Dive terminé avec succès');
                }
                // Follow-ups ne se mettent plus à jour automatiquement
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e: any) {
              if (e.message && !e.message.includes('JSON')) throw e;
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toastError(e.message);
      }
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ Erreur Deep Dive: ${e.message}`,
        citations: [],
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      setDeepDiveProgress('');
      inputRef.current?.focus();
    }
  }, [input, loading, notebookId, toastError, toastSuccess]);

  const handleClear = useCallback(async () => {
    try {
      await fetch(`/api/notebooks/${notebookId}/chat/history`, { method: 'DELETE' });
      setMessages([]);
      setFollowUps([]);
    } catch { /* ignore */ }
  }, [notebookId]);

  // ─── Compare Sources ───────────────────────────────────────────────────────

  const handleCompare = useCallback(async () => {
    if (loading || sources.length < 2) return;

    setLoading(true);
    setStreamingText('');

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: `🔄 Comparer les sources : ${sources.map(s => `"${s.title}"`).join(", ")}`,
      citations: [],
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds: sources.map(s => s.id) }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Pas de body stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) continue;
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;
                setStreamingText(accumulated);
              } else if (parsed.message) {
                setStreamingText('');
                setMessages(prev => [...prev, parsed.message]);
                
                // Notification de fin de génération
                if (!document.hidden) {
                  toastSuccess('✓ Comparaison terminée avec succès');
                }
                // Follow-ups ne se mettent plus à jour automatiquement
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toastError(e.message);
      }
      setStreamingText('');
    } finally {
      setLoading(false);
      setStreamingText('');
    }
  }, [loading, notebookId, sources, toastError, toastSuccess]);

  // ─── Extract Insights ──────────────────────────────────────────────────────

  const handleInsights = useCallback(async () => {
    if (loading) return;

    setLoading(true);
    setStreamingText('');

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: '💡 Extraction d\'insights — analyse approfondie des sources',
      citations: [],
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Pas de body stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) continue;
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;
                setStreamingText(accumulated);
              } else if (parsed.message) {
                setStreamingText('');
                setMessages(prev => [...prev, parsed.message]);
                
                // Notification de fin de génération
                if (!document.hidden) {
                  toastSuccess('✓ Extraction d\'insights terminée avec succès');
                }
                // Follow-ups ne se mettent plus à jour automatiquement
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toastError(e.message);
      }
      setStreamingText('');
    } finally {
      setLoading(false);
      setStreamingText('');
    }
  }, [loading, notebookId, toastError, toastSuccess]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ─── Citation Hover ─────────────────────────────────────────────────────────

  const handleCitationHover = useCallback(async (citation: Citation, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    const cached = chunkCache.current.get(citation.chunkId);
    if (cached) {
      setHoveredCitation({ citation, fullContent: cached, x: rect.left, y: rect.top });
      return;
    }

    setHoveredCitation({ citation, fullContent: citation.excerpt, x: rect.left, y: rect.top });

    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat/chunk/${citation.chunkId}`);
      if (res.ok) {
        const data = await res.json();
        const content = data.chunk?.content || citation.excerpt;
        chunkCache.current.set(citation.chunkId, content);
        setHoveredCitation(prev =>
          prev?.citation.chunkId === citation.chunkId
            ? { ...prev, fullContent: content }
            : prev
        );
      }
    } catch { /* ignore */ }
  }, [notebookId]);

  const handleCitationLeave = useCallback(() => {
    setHoveredCitation(null);
  }, []);

  // ─── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat/export?format=markdown`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'chat-export.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toastError(e.message);
    }
  }, [notebookId, toastError]);

  // ─── Save message to notes ─────────────────────────────────────────────────

  const handleSaveToNote = useCallback(async (msg: ChatMessage) => {
    // Trouver la question utilisateur correspondante (message précédent)
    const msgIndex = messages.findIndex(m => m.id === msg.id);
    const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
    const title = userMsg?.role === 'user'
      ? userMsg.content.slice(0, 80).replace(/[\n\r]/g, ' ')
      : `Note du chat — ${new Date(msg.timestamp).toLocaleDateString('fr')}`;

    try {
      const res = await fetch(`/api/notebooks/${notebookId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: msg.content,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      toastSuccess('Sauvegardé dans les notes');
      onRefresh?.();
    } catch (e: any) {
      toastError(`Erreur : ${e.message}`);
    }
  }, [messages, notebookId, onRefresh, toastError, toastSuccess]);

  // ─── Empty state: no sources ───────────────────────────────────────────────

  if (!hasSources) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-8">
        <div className="notebook-empty-state-icon">
          <BookOpen className="w-6 h-6" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
            Ajoutez des sources pour commencer
          </p>
          <p className="text-sm max-w-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Importez des documents dans le panneau Sources, puis posez des questions ici.
            L'IA répondra en citant les passages pertinents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Thread bar */}
      <div
        className="mx-auto flex w-full max-w-4xl flex-shrink-0 items-center gap-2 px-5 py-4 lg:px-8"
        style={{ borderColor: 'transparent', backgroundColor: 'transparent' }}
      >
        {/* Thread selector */}
        <div className="relative flex-1 min-w-0">
          <button
            onClick={() => setShowThreadList(!showThreadList)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-smfont-medium transition-all hover:bg-white/5 max-w-[250px]"
            style={{ color: 'var(--text-primary)' }}
          >
            <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
            <span className="truncate">
              {threads.find(t => t.id === activeThreadId)?.title || 'Conversation principale'}
            </span>
            <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
          </button>

          {/* Thread dropdown */}
          <AnimatePresence>
            {showThreadList && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
                style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)', transformOrigin: 'top left' }}
                className="absolute top-full left-0 mt-1 z-40 w-72 rounded-xl overflow-hidden shadow-xl"
              >
                <div className="max-h-60 overflow-y-auto custom-scrollbar">
                  {/* Main conversation option */}
                  <div
                    className={`flex items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--accent-subtle)] cursor-pointer border-b ${activeThreadId === null ? 'bg-[var(--accent-subtle)]' : ''}`}
                    style={{ borderColor: 'var(--border-base)' }}
                    onClick={() => handleSwitchThread(null)}
                  >
                    <MessageCircle className="w-3 h-3 flex-shrink-0" style={{ color: activeThreadId === null ? 'var(--accent-primary)' : 'var(--text-dimmed)' }} />
                    <span
                      className="flex-1 text-smfont-medium"
                      style={{ color: activeThreadId === null ? 'var(--accent-primary)' : 'var(--text-primary)' }}
                    >
                      Conversation principale
                    </span>
                  </div>

                  {/* Thread list */}
                  {threads.length === 0 ? (
                    <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      Pas de conversations supplémentaires.
                    </p>
                  ) : (
                    threads.map(thread => (
                      <div
                        key={thread.id}
                        className={`group flex items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--accent-subtle)] cursor-pointer ${thread.id === activeThreadId ? 'bg-[var(--accent-subtle)]' : ''}`}
                        onClick={() => handleSwitchThread(thread.id)}
                      >
                        <MessageCircle className="w-3 h-3 flex-shrink-0" style={{ color: thread.id === activeThreadId ? 'var(--accent-primary)' : 'var(--text-dimmed)' }} />
                        <span
                          className="flex-1 text-smfont-medium truncate"
                          style={{ color: thread.id === activeThreadId ? 'var(--accent-primary)' : 'var(--text-primary)' }}
                        >
                          {thread.title}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteThread(thread.id); }}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                          style={{ color: 'var(--text-dimmed)' }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Token counter (estimated) */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-smfont-medium"
          style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)', color: 'var(--text-dimmed)' }}
          title="Estimation des tokens utilisés dans cette conversation"
        >
          <span style={{ color: messages.length > 40 ? 'var(--color-error)' : messages.length > 20 ? 'var(--color-warning)' : 'var(--text-dimmed)' }}>
            ~{Math.round(messages.reduce((acc, m) => acc + m.content.length / 4, 0)).toLocaleString()}
          </span>
          <span>tokens</span>
        </div>

        {/* New thread button */}
        <button
          onClick={handleNewThread}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-smfont-medium transition-all hover:bg-[var(--accent-subtle)] active:scale-95"
          style={{ color: 'var(--accent-primary)', border: '1px solid var(--border-base)' }}
          title="Nouvelle conversation"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Nouveau</span>
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto custom-scrollbar px-5 py-6 lg:px-8"
      >
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent-primary)' }} />
          </div>
        ) : messages.length === 0 ? (
          /* Welcome state */
          <div className="flex flex-col items-center justify-center py-16 gap-6 max-w-lg mx-auto">
            <div className="notebook-empty-state-icon" style={{ width: 64, height: 64 }}>
              <MessageCircle className="w-7 h-7" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-medium notebook-heading" style={{ color: 'var(--text-primary)' }}>
                Interrogez vos sources
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Posez une question et l'IA répondra en citant les passages pertinents de vos documents.
              </p>
            </div>

            {/* Suggestions — 2 visibles + bouton pour en voir d'autres */}
            {suggestions.length > 0 && (
              <div className="w-full mt-4 space-y-3">
                <p className="text-smfont-medium flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <Lightbulb className="w-3.5 h-3.5" />
                  Suggestions
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestions.slice(suggestionOffset, suggestionOffset + 2).map((s, i) => (
                    <button
                      key={`${suggestionOffset}-${i}`}
                      onClick={() => handleSend(s)}
                      className="notebook-chip text-left px-3 py-2.5 rounded-full text-sm leading-snug transition-all hover:scale-[1.02] hover:shadow-sm"
                      style={{
                        whiteSpace: 'normal',
                        textAlign: 'left',
                        backgroundColor: 'var(--notebook-chat-ai)',
                        border: '1px solid var(--notebook-border)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span className="line-clamp-2">{s}</span>
                    </button>
                  ))}
                </div>
                {suggestions.length > 2 && (
                  <button
                    onClick={() => setSuggestionOffset((prev) => (prev + 2) >= suggestions.length ? 0 : prev + 2)}
                    className="flex items-center gap-1.5 text-smfont-medium px-3 py-1.5 rounded-full transition-colors hover:opacity-80"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Autres suggestions
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
                className={`mx-auto mb-6 flex w-full max-w-4xl ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className="notebook-chat-message"
                  data-role={msg.role}
                  style={{
                    backgroundColor: msg.role === 'user' ? 'var(--notebook-chat-user)' : 'var(--notebook-chat-ai)',
                    color: 'var(--text-primary)',
                    border: msg.role === 'assistant' ? '1px solid var(--notebook-border)' : '1px solid transparent',
                    maxWidth: msg.role === 'user' ? '75%' : '100%',
                  }}
                >
                  {/* Message content — with edit mode for user messages */}
                  {msg.role === 'user' && editingMsgId === msg.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full px-3 py-2 rounded-full text-sm outline-none resize-none"
                        style={{ backgroundColor: 'var(--notebook-surface-muted)', border: '1px solid var(--notebook-border)', color: 'var(--text-primary)' }}
                        rows={3}
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditSubmit(msg.id)}
                          disabled={!editingContent.trim()}
                          className="px-3 py-1.5 rounded-full text-smfont-medium transition-colors disabled:opacity-40"
                          style={{ backgroundColor: 'var(--notebook-accent)', color: 'var(--text-primary)' }}
                        >
                          Renvoyer
                        </button>
                        <button
                          onClick={handleEditCancel}
                          className="px-3 py-1.5 rounded-full text-smfont-medium notebook-chip"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : msg.role === 'assistant' ? (
                    renderMessageContent(msg.content)
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {/* Actions bar */}
                  {editingMsgId !== msg.id && (
    <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-1">
      <p className="text-sm opacity-40">
        {new Date(msg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </p>

      {/* Separator dot */}
      <span className="text-sm opacity-20" aria-hidden="true">•</span>

      {msg.role === 'assistant' && (
        <>
          {/* Copy */}
          <button
            type="button"
            onClick={() => handleCopy(msg.id, msg.content)}
            className={`flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 ${
              copiedMsgId === msg.id
                ? 'opacity-100 bg-[var(--color-success)]/10'
                : 'opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]'
            }`}
            style={{ color: copiedMsgId === msg.id ? 'var(--color-success)' : undefined }}
            title="Copier la réponse"
            aria-label={copiedMsgId === msg.id ? "Copié" : "Copier la réponse"}
          >
            {copiedMsgId === msg.id ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span className="text-xs">{copiedMsgId === msg.id ? 'Copié' : 'Copier'}</span>
          </button>

          {/* Retry */}
          <button
            type="button"
            onClick={() => handleRetry(msg.id)}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Régénérer la réponse"
            aria-label="Régénérer la réponse"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="text-xs">Retry</span>
          </button>

          {/* TTS */}
          <button
            type="button"
            onClick={() => handleTTS(msg.id, msg.content)}
            className={`flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 ${
              speakingMsgId === msg.id
                ? 'opacity-100 bg-[var(--accent-primary)]/10'
                : 'opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]'
            }`}
            style={{ color: speakingMsgId === msg.id ? 'var(--accent-primary)' : undefined }}
            title={speakingMsgId === msg.id ? 'Arrêter la lecture' : 'Lire à voix haute (TTS IA)'}
            aria-label={speakingMsgId === msg.id ? "Arrêter la lecture" : "Lire à voix haute"}
          >
            {speakingMsgId === msg.id ? (
              <>
                <Square className="w-3.5 h-3.5" />
                <span className="flex items-center gap-1">
                  <div className="flex gap-[2px]">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <span
                        key={i}
                        className="w-[2px] h-2 bg-current rounded-full"
                        style={{ animationDelay: `${i * 0.15}s` }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </span>
                <span className="text-xs">Stop</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                <span className="text-xs">Écouter</span>
              </>
            )}
          </button>

          {/* Save to notes */}
          <button
            type="button"
            onClick={() => handleSaveToNote(msg)}
            className="flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]"
            title="Sauvegarder dans les notes"
            aria-label="Sauvegarder dans les notes"
          >
            <StickyNote className="w-3.5 h-3.5" />
            <span className="text-xs">Note</span>
          </button>

          {/* Save as Markdown */}
          <button
            type="button"
            onClick={() => openFolderPicker(msg)}
            className="flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]"
            title="Enregistrer ce message en fichier Markdown (.md)"
            aria-label="Enregistrer en Markdown"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="text-xs">MD</span>
          </button>

          {/* Separator */}
          <span className="text-sm opacity-20" aria-hidden="true">•</span>

          {/* Feedback thumbs */}
          <div className="flex gap-0.5">
            <button
              type="button"
              onClick={() => handleFeedback(msg.id, 'up')}
              className={`p-1.5 rounded-md transition-all duration-200 ${
                feedbackMap[msg.id] === 'up'
                  ? 'opacity-100 bg-[var(--color-success)]/10'
                  : 'opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]'
              }`}
              style={{ color: feedbackMap[msg.id] === 'up' ? 'var(--color-success)' : undefined }}
              title="Bonne réponse"
              aria-label="Bonne réponse"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleFeedback(msg.id, 'down')}
              className={`p-1.5 rounded-md transition-all duration-200 ${
                feedbackMap[msg.id] === 'down'
                  ? 'opacity-100 bg-[var(--color-error)]/10'
                  : 'opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]'
              }`}
              style={{ color: feedbackMap[msg.id] === 'down' ? 'var(--color-error)' : undefined }}
              title="Mauvaise réponse"
              aria-label="Mauvaise réponse"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      {msg.role === 'user' && (
        <>
          <button
            type="button"
            onClick={() => handleEditStart(msg.id, msg.content)}
            className="flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]"
            title="Modifier et renvoyer"
            aria-label="Modifier le message"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span className="text-xs">Modifier</span>
          </button>

          {/* Save user message as Markdown */}
          <button
            type="button"
            onClick={() => openFolderPicker(msg)}
            className="flex items-center gap-1.5 text-sm transition-all duration-200 rounded-md px-2 py-1 opacity-60 hover:opacity-100 hover:bg-[var(--notebook-hover)]"
            title="Enregistrer ce message en fichier Markdown (.md)"
            aria-label="Enregistrer en Markdown"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="text-xs">MD</span>
          </button>
        </>
      )}
    </div>
  )}

                  {/* Citations */}
                  {msg.citations.length > 0 && (
  <div className="mt-3 pt-2.5 border-t" style={{ borderColor: 'var(--notebook-border)' }}>
    <button
      type="button"
      onClick={() => setShowCitations(showCitations === msg.id ? null : msg.id)}
      className="flex items-center gap-1.5 text-sm font-medium transition-all duration-200 rounded-md px-2 py-1.5 opacity-70 hover:opacity-100 hover:bg-[var(--notebook-hover)]"
      aria-expanded={showCitations === msg.id}
      aria-controls={`citations-${msg.id}`}
      aria-label={`${msg.citations.length} citation${msg.citations.length > 1 ? 's' : ''} disponibles`}
    >
      <Quote className="w-4 h-4" />
      <span>
        {msg.citations.length} citation{msg.citations.length > 1 ? 's' : ''}
      </span>
      <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showCitations === msg.id ? 'rotate-180' : ''}`} />
    </button>

    <AnimatePresence>
      {showCitations === msg.id && (
        <motion.div
          id={`citations-${msg.id}`}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          {/* Conteneur scrollable avec hauteur max */}
          <div
            className="mt-3 space-y-3 max-h-96 overflow-y-auto custom-scrollbar"
            onMouseLeave={() => {
              // Ne pas fermer le tooltip si on quitte juste pour scroller
              const relatedTarget = document.querySelector(`#citations-${msg.id} :hover`);
              if (!relatedTarget) setHoveredCitation(null);
            }}
          >
            {msg.citations.map((cit, i) => (
              <div
                key={cit.chunkId || i}
                className="p-3 rounded-lg transition-all duration-200 hover:shadow-sm hover:ring-1 hover:ring-[var(--accent-primary)]/30"
                style={{
                  backgroundColor: 'var(--bg-base)',
                  color: 'var(--text-muted)',
                }}
              >
                {/* Header avec titre + pertinence */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-medium text-[var(--text-primary)] truncate">
                    {cit.sourceTitle}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{
                      backgroundColor: 'var(--accent-subtle)',
                      color: 'var(--accent-primary)',
                    }}
                  >
                    {(cit.relevance * 100).toFixed(0)}% pertinent
                  </span>
                </div>

                {/* Extrait avec affichage complet au clic */}
                <p className="text-sm opacity-80 leading-relaxed line-clamp-3 cursor-pointer">
                  {cit.excerpt}
                </p>

                {/* Bouton pour voir le détail */}
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const cached = chunkCache.current.get(cit.chunkId);
                    if (cached) {
                      setHoveredCitation({
                        citation: cit,
                        fullContent: cached,
                        x: e.clientX,
                        y: e.clientY,
                      });
                      return;
                    }

                    setHoveredCitation({
                      citation: cit,
                      fullContent: cit.excerpt,
                      x: e.clientX,
                      y: e.clientY,
                    });

                    try {
                      const res = await fetch(`/api/notebooks/${notebookId}/chat/chunk/${cit.chunkId}`);
                      if (res.ok) {
                        const data = await res.json();
                        const content = data.chunk?.content || cit.excerpt;
                        chunkCache.current.set(cit.chunkId, content);
                        setHoveredCitation({
                          citation: cit,
                          fullContent: content,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }
                    } catch { /* ignore */ }
                  }}
                  className="text-xs opacity-60 hover:opacity-100 transition-opacity mt-1 flex items-center gap-1"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  Voir le détail <ExternalLink className="w-3 h-3" />
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
            ))}

            {/* Streaming text */}
            {streamingText && (
              <motion.div
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
                className="flex justify-start max-w-4xl mx-auto"
              >
                <div
                  className="notebook-chat-message w-full"
                  data-role="assistant"
                  style={{ border: '1px solid var(--notebook-border)' }}
                >
                  {renderMessageContent(streamingText)}
                  <span className="inline-block w-1.5 h-4 ml-0.5 animate-pulse rounded-sm" style={{ backgroundColor: 'var(--notebook-accent)' }} />
                </div>
              </motion.div>
            )}

            {/* Stop streaming button */}
            {loading && (streamingText || deepDiveProgress) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex justify-center"
              >
                <button
                  onClick={handleStopStreaming}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-smfont-medium transition-all hover:scale-105 active:scale-95"
                  style={{
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border-base)',
                    color: 'var(--text-secondary)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  <StopCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} />
                  Arrêter la génération
                </button>
              </motion.div>
            )}

            {/* Deep dive progress */}
            {deepDiveProgress && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs"
                  style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }}
                >
                  <Telescope className="w-4 h-4 animate-pulse" />
                  <span className="font-medium">{deepDiveProgress}</span>
                </div>
              </motion.div>
            )}

            {/* Loading indicator */}
            {loading && !streamingText && !deepDiveProgress && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start max-w-4xl mx-auto"
              >
                <div
                  className="notebook-chat-message"
                  data-role="assistant"
                  style={{ border: '1px solid var(--notebook-border)', padding: '16px 20px' }}
                >
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--notebook-accent)', animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--notebook-accent)', animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--notebook-accent)', animationDelay: '300ms' }} />
                  </div>
                </div>
              </motion.div>
            )}

            {/* Follow-ups */}
            {followUps.length > 0 && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-3 pt-4 max-w-4xl mx-auto"
              >
                <p className="text-smfont-medium flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <Lightbulb className="w-3.5 h-3.5" />
                  Questions de suivi
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {followUps.slice(followUpOffset, followUpOffset + 2).map((q, i) => (
                    <button
                      key={`${followUpOffset}-${i}`}
                      onClick={() => handleSend(q)}
                      className="notebook-chip text-left px-3 py-2.5 rounded-full text-sm leading-snug transition-all hover:scale-[1.02] hover:shadow-sm"
                      style={{
                        whiteSpace: 'normal',
                        textAlign: 'left',
                        backgroundColor: 'var(--notebook-chat-ai)',
                        border: '1px solid var(--notebook-border)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span className="line-clamp-2">{q}</span>
                    </button>
                  ))}
                </div>
                {followUps.length > 2 && (
                  <button
                    onClick={() => setFollowUpOffset((prev) => (prev + 2) >= followUps.length ? 0 : prev + 2)}
                    className="flex items-center gap-1.5 text-smfont-medium px-3 py-1.5 rounded-full transition-colors hover:opacity-80"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Autres suggestions
                  </button>
                )}
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}

        {/* Scroll to bottom button */}
        <AnimatePresence>
          {showScrollBtn && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_MOMENTUM}
              whileTap={{ scale: 0.88 }}
              onClick={scrollToBottom}
              className="fixed bottom-28 right-8 p-2.5 rounded-full shadow-lg z-30 hover:opacity-90 transition-opacity duration-150"
              style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
            >
              <ArrowDown className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Citation hover tooltip */}
      <AnimatePresence>
        {hoveredCitation && (
          <motion.div
            initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-50 max-w-md p-4 rounded-xl shadow-2xl pointer-events-none"
            style={{
              left: Math.min(hoveredCitation.x, window.innerWidth - 420),
              top: Math.max(hoveredCitation.y - 200, 8),
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-focus)',
              color: 'var(--text-primary)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Quote className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-smfont-semibold truncate">{hoveredCitation.citation.sourceTitle}</span>
              <span
                className="text-smpx-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}
              >
                {(hoveredCitation.citation.relevance * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-smleading-relaxed whitespace-pre-wrap max-h-44 overflow-y-auto custom-scrollbar" style={{ color: 'var(--text-muted)' }}>
              {hoveredCitation.fullContent}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area — refined professional design */}
      <div
        className="flex-shrink-0 px-5 pb-5 pt-3 lg:px-8"
        style={{ borderColor: 'transparent', backgroundColor: 'transparent' }}
      >
        {/* Source filter bar */}
        {showSourceFilter && sources.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mb-2 overflow-hidden"
          >
            <div
              className="flex items-center gap-2 p-2.5 rounded-xl flex-wrap"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)' }}
            >
              <span className="text-smfont-semibold flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                Sources actives :
              </span>
              {sources.map(s => (
                <button
                  key={s.id}
                  onClick={() => toggleSourceFilter(s.id)}
                  className={`px-2.5 py-1 rounded-full text-smfont-medium transition-all active:scale-95 ${
                    selectedSources.includes(s.id) || selectedSources.length === 0
                      ? 'ring-1 ring-[var(--accent-primary)]'
                      : 'opacity-40'
                  }`}
                  style={{
                    backgroundColor: selectedSources.includes(s.id) ? 'var(--accent-subtle)' : 'var(--bg-panel)',
                    color: selectedSources.includes(s.id) ? 'var(--accent-primary)' : 'var(--text-muted)',
                    border: '1px solid var(--border-base)',
                  }}
                >
                  {s.title.length > 25 ? s.title.slice(0, 25) + '…' : s.title}
                </button>
              ))}
              {selectedSources.length > 0 && (
                <button
                  onClick={clearSourceFilter}
                  className="px-2 py-1 rounded-full text-smfont-medium transition-all hover:bg-red-500/10"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3 h-3 inline mr-0.5" />
                  Reset
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* Slash command menu */}
        <AnimatePresence>
          {showSlashMenu && filteredSlashCommands.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mb-2 rounded-xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            >
              {filteredSlashCommands.map((cmd) => (
                <button
                  key={cmd.cmd}
                  onClick={() => { setInput(''); handleSend(cmd.prompt); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--accent-subtle)]"
                >
                  <code className="text-smfont-mono font-semibold" style={{ color: 'var(--accent-primary)' }}>
                    {cmd.cmd}
                  </code>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {cmd.desc}
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main input container */}
        <div
          className="relative mx-auto flex max-w-4xl items-end gap-0 rounded-xl transition-shadow duration-200 focus-within:ring-2"
          style={{
            backgroundColor: 'var(--notebook-surface)',
            border: '1px solid var(--notebook-border)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            ['--tw-ring-color' as any]: 'var(--accent-primary)',
          }}
        >
          {/* Left actions — filter */}
          <div className="flex items-center gap-0.5 pl-2 py-2 flex-shrink-0">
            {sources.length > 1 && (
              <button
                onClick={() => setShowSourceFilter(!showSourceFilter)}
                className={`p-2 rounded-lg transition-all active:scale-90 ${showSourceFilter || selectedSources.length > 0 ? '' : 'opacity-50 hover:opacity-100'}`}
                style={{ color: selectedSources.length > 0 ? 'var(--accent-primary)' : 'var(--text-dimmed)' }}
                title="Filtrer les sources"
              >
                <Filter className="w-4 h-4" />
                {selectedSources.length > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-smfont-bold flex items-center justify-center"
                    style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                  >
                    {selectedSources.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={'Posez une question sur vos sources... (/ pour les commandes)'}
            rows={1}
            className="flex-1 bg-transparent px-4 py-4 text-sm leading-6 outline-none resize-none placeholder:text-[var(--text-dimmed)]"
            style={{
              color: 'var(--text-primary)',
              minHeight: '58px',
              maxHeight: '120px',
            }}
          />

          {/* Right action buttons */}
          <div className="relative flex items-center gap-1 px-2 py-2 flex-shrink-0 context-menu-container">
            <motion.button
              onClick={() => handleDeepDive()}
              disabled={!input.trim() || loading}
              whileTap={input.trim() && !loading ? { scale: 0.88 } : undefined}
              transition={{ duration: 0.1 }}
              className="p-2 rounded-lg disabled:opacity-25 hover:bg-[var(--accent-subtle)] transition-colors duration-150"
              style={{ color: 'var(--accent-primary)' }}
              title="Deep Dive — exploration approfondie"
            >
              <Telescope className="w-4 h-4" />
            </motion.button>

            <motion.button
              onClick={handleInsights}
              disabled={loading}
              whileTap={!loading ? { scale: 0.88 } : undefined}
              transition={{ duration: 0.1 }}
              className="p-2 rounded-lg disabled:opacity-25 hover:bg-amber-500/10 transition-colors duration-150"
              style={{ color: 'var(--color-warning)' }}
              title="Extraire les insights clés"
            >
              <Zap className="w-4 h-4" />
            </motion.button>

            {sources.length >= 2 && (
              <motion.button
                onClick={handleCompare}
                disabled={loading}
                whileTap={!loading ? { scale: 0.88 } : undefined}
                transition={{ duration: 0.1 }}
                className="p-2 rounded-lg disabled:opacity-25 hover:bg-violet-500/10 transition-colors duration-150"
                style={{ color: 'var(--color-accent-alt)' }}
                title="Comparer les sources"
              >
                <GitCompare className="w-4 h-4" />
              </motion.button>
            )}

            {/* Context Menu Button */}
            <motion.button
              onClick={() => setShowContextMenu(!showContextMenu)}
              disabled={loading}
              whileTap={!loading ? { scale: 0.88 } : undefined}
              transition={{ duration: 0.1 }}
              className="p-2 rounded-lg disabled:opacity-25 hover:bg-[var(--accent-subtle)] transition-colors duration-150"
              style={{ color: 'var(--accent-primary)' }}
              title="Demandes avec contexte complet"
            >
              <Lightbulb className="w-4 h-4" />
            </motion.button>

            {/* Context Menu Dropdown */}
            <AnimatePresence>
              {showContextMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute bottom-full right-0 mb-1 z-50 w-60 rounded-xl overflow-hidden shadow-xl"
                  style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
                >
                  <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-base)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                      Demandes avec contexte complet
                    </p>
                  </div>
                  {contextSuggestions.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => { setInput(''); handleSend(s.prompt); setShowContextMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--accent-subtle)]"
                    >
                      <Lightbulb className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{s.label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Separator */}
            <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-base)' }} />

            {/* Send button */}
            <motion.button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              whileTap={input.trim() && !loading ? { scale: 0.88 } : undefined}
              transition={{ duration: 0.1 }}
              className="p-2.5 rounded-full disabled:opacity-30 transition-colors duration-150"
              style={{
                backgroundColor: input.trim() && !loading ? 'var(--notebook-accent)' : 'var(--notebook-surface-muted)',
                color: input.trim() && !loading ? 'var(--text-primary)' : 'var(--text-dimmed)',
              }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </motion.button>
          </div>
        </div>

        {/* Bottom bar — hints + personality + secondary actions */}
        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-2">
            <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              Entrée pour envoyer • / commandes
              {queuedCount > 0 && (
                <span style={{ color: 'var(--accent-primary)' }}>
                  {' '}• {queuedCount} en attente
                </span>
              )}
              {selectedSources.length > 0 && (
                <span style={{ color: 'var(--accent-primary)' }}> • {selectedSources.length} source{selectedSources.length > 1 ? 's' : ''}</span>
              )}
            </p>

            {/* Personality selector */}
            <div className="relative">
              <button
                onClick={() => setShowPersonalityMenu(!showPersonalityMenu)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-smfont-medium transition-all hover:bg-[var(--accent-subtle)]"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
              >
                <span>{currentPersonality.emoji}</span>
                <span>{currentPersonality.label}</span>
              </button>

              <AnimatePresence>
                {showPersonalityMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
                    className="absolute bottom-full left-0 mb-1 z-40 w-56 rounded-xl overflow-hidden shadow-xl"
                    style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)', transformOrigin: 'bottom left' }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-base)' }}>
                      <p className="text-smfont-semibold" style={{ color: 'var(--text-dimmed)' }}>Ton de l'assistant</p>
                    </div>
                    {personalities.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setPersonality(p.id); setShowPersonalityMenu(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--accent-subtle)] ${personality === p.id ? 'bg-[var(--accent-subtle)]' : ''}`}
                      >
                        <span className="text-sm">{p.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-smfont-medium" style={{ color: personality === p.id ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {p.label}
                          </p>
                          <p className="text-smtruncate" style={{ color: 'var(--text-dimmed)' }}>{p.desc}</p>
                        </div>
                        {personality === p.id && (
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--accent-primary)' }} />
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <>
                <button
                  onClick={handleExport}
                  className="p-1.5 rounded-md transition-all hover:bg-[var(--accent-subtle)] active:scale-90"
                  style={{ color: 'var(--text-muted)' }}
                  title="Exporter en Markdown"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleClear}
                  className="p-1.5 rounded-md transition-all hover:bg-red-500/10 active:scale-90"
                  style={{ color: 'var(--text-muted)' }}
                  title="Effacer l'historique"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Folder Picker Modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {folderPickerMsg && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(4px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setFolderPickerMsg(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.92, y: prefersReducedMotion ? 0 : 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.92, y: prefersReducedMotion ? 0 : 16 }}
              transition={prefersReducedMotion ? { duration: 0.1 } : SPRING_UI}
              className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-base)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                    <FileDown className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Enregistrer en Markdown
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Choisir le dossier de destination dans la sandbox
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setFolderPickerMsg(null)}
                  className="p-1.5 rounded-lg opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Folder list */}
              <div className="px-4 py-3 max-h-56 overflow-y-auto custom-scrollbar">
                {sandboxFolders.length === 0 ? (
                  <p className="text-smtext-center py-4" style={{ color: 'var(--text-dimmed)' }}>
                    Chargement des dossiers…
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {sandboxFolders.map(f => (
                      <button
                        key={f.path}
                        onClick={() => { setSelectedFolder(f.path); setCustomFolderName(''); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-full text-left transition-all text-sm${
                          selectedFolder === f.path && !customFolderName
                            ? 'ring-1 ring-[var(--accent-primary)]'
                            : 'hover:bg-[var(--accent-subtle)]'
                        }`}
                        style={{
                          backgroundColor: selectedFolder === f.path && !customFolderName
                            ? 'var(--accent-subtle)'
                            : 'transparent',
                          color: 'var(--text-primary)',
                          paddingLeft: `${12 + f.depth * 16}px`,
                        }}
                      >
                        {selectedFolder === f.path && !customFolderName
                          ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                          : <Folder className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
                        }
                        <span className="truncate">{f.name || '/ (racine sandbox)'}</span>
                        {selectedFolder === f.path && !customFolderName && (
                          <Check className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Custom folder input */}
              <div className="px-4 pb-3">
                <p className="text-smmb-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
                  Ou saisir un chemin personnalisé
                </p>
                <input
                  type="text"
                  value={customFolderName}
                  onChange={e => { setCustomFolderName(e.target.value); setSelectedFolder(''); }}
                  placeholder="ex: docs/notes"
                  className="w-full px-3 py-2 rounded-full text-smoutline-none transition-all"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    border: '1px solid var(--border-base)',
                    color: 'var(--text-primary)',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border-base)')}
                />
              </div>

              {/* Destination preview */}
              {(selectedFolder !== '' || customFolderName.trim()) && (
                <div className="mx-4 mb-3 px-3 py-2 rounded-full text-xs" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
                  <span className="font-medium">Destination : </span>
                  <span className="font-mono">
                    {customFolderName.trim() || selectedFolder || '/'}/
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 px-4 pb-4">
                <button
                  onClick={() => setFolderPickerMsg(null)}
                  className="px-4 py-2 rounded-full text-smfont-medium transition-all hover:opacity-80"
                  style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)' }}
                >
                  Annuler
                </button>
                <button
                  onClick={handleSaveAsMarkdown}
                  disabled={savingMd || (selectedFolder === '' && !customFolderName.trim())}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-smfont-medium transition-all disabled:opacity-40 hover:opacity-90 active:scale-95"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                >
                  {savingMd ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  {savingMd ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}