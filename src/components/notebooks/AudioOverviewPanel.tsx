/**
 * AudioOverviewPanel — Génération et lecture de podcasts IA
 *
 * Fonctionnalités :
 * - Génération de script conversationnel (Alex & Sam)
 * - Lecture TTS avec voix distinctes (streaming SSE)
 * - Sélection des sources à inclure
 * - Personnalisation du ton et instructions custom
 * - Téléchargement en .md, suppression, régénération
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic, Play, Loader2, Clock, Users, Radio, Pause, Square,
  Trash2, RefreshCw, Volume2, Settings2, FileText, CheckSquare
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';

interface AudioOverview {
  id: string;
  title: string;
  script: string;
  estimatedDuration: number;
  status: 'generating' | 'ready' | 'error';
  createdAt: string;
}

interface Source {
  id: string;
  title: string;
}

interface Props {
  notebookId: string;
  overviews: AudioOverview[];
  sources: Source[];
  onRefresh: () => void;
  fullView?: boolean;
  onClose?: () => void;
  onViewDoc?: (doc: { id: string; title: string; type: string; content: string; createdAt: string }) => void;
}

type Tone = 'casual' | 'academic' | 'humorous' | 'professional';

export function AudioOverviewPanel({ notebookId, overviews, sources, onRefresh, fullView = false, onClose, onViewDoc }: Props) {
  const { success, error: toastError } = useToast();
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedOverview, setSelectedOverview] = useState<AudioOverview | null>(null);
  const [duration, setDuration] = useState<'short' | 'medium' | 'long'>('medium');

  // Options avancées
  const [showOptions, setShowOptions] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [tone, setTone] = useState<Tone>('casual');
  const [customInstructions, setCustomInstructions] = useState('');

  // TTS Playback
  const [playing, setPlaying] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [ttsProgress, setTtsProgress] = useState(0);
  const [ttsTotalLines, setTtsTotalLines] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<{ audio: string; index: number }[]>([]);
  const playingRef = useRef(false);
  const nextStartTimeRef = useRef(0);

  // Initialiser la sélection de sources avec toutes les sources
  useEffect(() => {
    if (selectedSourceIds.length === 0 && sources.length > 0) {
      setSelectedSourceIds(sources.map(s => s.id));
    }
  }, [sources]);

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const selectAllSources = () => setSelectedSourceIds(sources.map(s => s.id));
  const deselectAllSources = () => setSelectedSourceIds([]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/audio-overview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration,
          sourceIds: selectedSourceIds.length < sources.length ? selectedSourceIds : undefined,
          tone: tone !== 'casual' ? tone : undefined,
          customInstructions: customInstructions.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.overview.status === 'ready') {
        success('Audio Overview généré !');
        setSelectedOverview(data.overview);
      } else {
        toastError('Erreur lors de la génération');
      }
      onRefresh();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setGenerating(false);
    }
  }, [notebookId, duration, selectedSourceIds, sources.length, tone, customInstructions, success, toastError, onRefresh]);

  const handleSaveToSandbox = useCallback(async () => {
    if (!selectedOverview) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/notebooks/${notebookId}/audio-overviews/${selectedOverview.id}/export?save=sandbox`
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      success(`Script audio sauvegardé dans la sandbox : ${data.filePath}`);
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setDownloading(false);
    }
  }, [notebookId, selectedOverview, success, toastError]);

  const handleDelete = useCallback(async (overviewId: string) => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/audio-overviews/${overviewId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      success('Audio overview supprimé');
      if (selectedOverview?.id === overviewId) {
        setSelectedOverview(null);
      }
      onRefresh();
    } catch (e: any) {
      toastError(e.message);
    }
  }, [notebookId, selectedOverview, success, toastError, onRefresh]);

  const handleRegenerate = useCallback(async () => {
    if (!selectedOverview) return;
    try {
      await fetch(`/api/notebooks/${notebookId}/audio-overviews/${selectedOverview.id}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('[AudioOverviewPanel] Failed to delete overview:', err);
    }
    setSelectedOverview(null);
    handleGenerate();
  }, [notebookId, selectedOverview, handleGenerate]);

  // ─── TTS Playback ──────────────────────────────────────────────────────────

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AC({ sampleRate: 24000 });
    }
    return audioCtxRef.current;
  }, []);

  const playAudioChunk = useCallback((base64Audio: string) => {
    const audioCtx = getAudioContext();
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
      source.playbackRate.value = playbackSpeed;
      source.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      const startTime = Math.max(now, nextStartTimeRef.current);
      source.start(startTime);
      nextStartTimeRef.current = startTime + (audioBuffer.duration / playbackSpeed);
    } catch (err) {
      console.error('[TTS] Erreur lecture audio:', err);
    }
  }, [getAudioContext, playbackSpeed]);

  const handlePlayTTS = useCallback(async () => {
    if (!selectedOverview) return;

    setTtsLoading(true);
    setPlaying(true);
    playingRef.current = true;
    setCurrentLineIndex(0);
    setTtsProgress(0);
    nextStartTimeRef.current = 0;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch(
        `/api/notebooks/${notebookId}/audio-overviews/${selectedOverview.id}/tts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Pas de stream");

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!playingRef.current) break;

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

          if (eventType === 'start') {
            const parsed = JSON.parse(data);
            setTtsTotalLines(parsed.total);
            setTtsLoading(false);
          } else if (eventType === 'chunk') {
            const parsed = JSON.parse(data);
            setCurrentLineIndex(parsed.index);
            setTtsProgress(prev => prev + 1);
            playAudioChunk(parsed.audio);
          } else if (eventType === 'done') {
            // Fini
          } else if (eventType === 'error') {
            const parsed = JSON.parse(data);
            toastError(parsed.error);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toastError(`Erreur TTS: ${e.message}`);
      }
    } finally {
      setTtsLoading(false);
      setPlaying(false);
      playingRef.current = false;
      abortControllerRef.current = null;
    }
  }, [notebookId, selectedOverview, playAudioChunk, toastError]);

  const handleStopTTS = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setCurrentLineIndex(-1);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Stop tout l'audio en cours
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch((err) => {
        console.debug('[AudioOverviewPanel] AudioContext close failed:', err);
      });
      audioCtxRef.current = null;
    }
    nextStartTimeRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (audioCtxRef.current) audioCtxRef.current.close().catch((err) => {
        console.debug('[AudioOverviewPanel] AudioContext close failed (cleanup):', err);
      });
    };
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownloadScript = useCallback(() => {
    if (!selectedOverview) return;
    const blob = new Blob([`# ${selectedOverview.title}\n\n${selectedOverview.script}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedOverview.title.replace(/[^a-zA-Z0-9]/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    success('Script téléchargé');
  }, [selectedOverview, success]);

  const cycleSpeed = useCallback(() => {
    setPlaybackSpeed(prev => {
      if (prev === 1) return 1.25;
      if (prev === 1.25) return 1.5;
      if (prev === 1.5) return 1.75;
      if (prev === 1.75) return 2;
      return 1;
    });
  }, []);

  return (
    <div className={`h-full ${fullView ? 'flex flex-col lg:flex-row' : 'flex flex-col'}`}>
      {/* Left: Generator + list */}
      <div
        className={`${fullView ? 'w-full lg:w-80 flex-shrink-0 border-b lg:border-b-0 lg:border-r' : 'flex-1'} overflow-y-auto custom-scrollbar p-5 space-y-5`}
        style={{ borderColor: 'var(--notebook-border)', backgroundColor: 'var(--notebook-studio-bg)' }}
      >
        {/* Generator card */}
        <div
          className="p-5 rounded-2xl border space-y-4"
          style={{ backgroundColor: 'var(--notebook-card-bg)', borderColor: 'var(--notebook-border)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="notebook-empty-state-icon" style={{ width: 36, height: 36 }}>
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Audio Overview
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Podcast IA conversationnel
              </p>
            </div>
          </div>

          {/* Duration selector */}
          <div className="space-y-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>Durée cible</p>
            <div className="flex gap-2">
              {([
                { key: 'short' as const, label: '~5 min', icon: '⚡' },
                { key: 'medium' as const, label: '~10 min', icon: '📻' },
                { key: 'long' as const, label: '~15 min', icon: '🎙️' },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setDuration(opt.key)}
                  className="flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    backgroundColor: duration === opt.key ? 'var(--accent-subtle)' : 'var(--bg-base)',
                    color: duration === opt.key ? 'var(--accent-primary)' : 'var(--text-muted)',
                    border: `1.5px solid ${duration === opt.key ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                  }}
                >
                  <span className="text-sm">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Options toggle */}
          <button
            onClick={() => setShowOptions(!showOptions)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium transition-all"
            style={{
              backgroundColor: showOptions ? 'var(--accent-subtle)' : 'var(--bg-base)',
              color: showOptions ? 'var(--accent-primary)' : 'var(--text-muted)',
              border: `1px solid ${showOptions ? 'var(--accent-primary)' : 'var(--border-base)'}`,
            }}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Options avancées
          </button>

          {/* Advanced options */}
          <AnimatePresence>
            {showOptions && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {/* Tone selector */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>Ton</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { key: 'casual' as Tone, label: '😊 Décontracté' },
                      { key: 'academic' as Tone, label: '🎓 Académique' },
                      { key: 'humorous' as Tone, label: '😄 Humoristique' },
                      { key: 'professional' as Tone, label: '💼 Professionnel' },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setTone(opt.key)}
                        className="px-2 py-1.5 rounded-full text-xs font-medium transition-all"
                        style={{
                          backgroundColor: tone === opt.key ? 'var(--accent-subtle)' : 'var(--bg-base)',
                          color: tone === opt.key ? 'var(--accent-primary)' : 'var(--text-muted)',
                          border: `1px solid ${tone === opt.key ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Source selector */}
                {sources.length > 1 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                        Sources ({selectedSourceIds.length}/{sources.length})
                      </p>
                      <button
                        onClick={selectedSourceIds.length === sources.length ? deselectAllSources : selectAllSources}
                        className="text-xs font-medium"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        {selectedSourceIds.length === sources.length ? 'Aucune' : 'Toutes'}
                      </button>
                    </div>
                    <div className="max-h-28 overflow-y-auto custom-scrollbar space-y-1">
                      {sources.map(src => (
                        <button
                          key={src.id}
                          onClick={() => toggleSource(src.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-full text-left text-xs transition-all"
                          style={{
                            backgroundColor: selectedSourceIds.includes(src.id) ? 'var(--accent-subtle)' : 'transparent',
                            color: selectedSourceIds.includes(src.id) ? 'var(--accent-primary)' : 'var(--text-muted)',
                          }}
                        >
                          <CheckSquare
                            className="w-3 h-3 flex-shrink-0"
                            style={{
                              opacity: selectedSourceIds.includes(src.id) ? 1 : 0.3,
                            }}
                          />
                          <span className="truncate">{src.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom instructions */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                    Instructions personnalisées
                  </p>
                  <textarea
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="Ex: Insiste sur les aspects pratiques, ajoute des exemples concrets..."
                    className="w-full px-3 py-2 rounded-full text-xs resize-none leading-relaxed"
                    style={{
                      backgroundColor: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-base)',
                    }}
                    rows={2}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={handleGenerate}
            disabled={generating || selectedSourceIds.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-50 shadow-sm"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <Radio className="w-4 h-4" />
                Générer le podcast
              </>
            )}
          </button>
        </div>

        {/* Previous overviews */}
        {overviews.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
              Podcasts ({overviews.length})
            </p>
            <AnimatePresence initial={false}>
              {overviews.map(ov => (
                <motion.div
                  key={ov.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative group"
                >
                  <button
                    onClick={() => { setSelectedOverview(ov); if (onViewDoc && !fullView) onViewDoc({ id: ov.id, title: ov.title, type: 'audio-overview', content: ov.script, createdAt: ov.createdAt }); }}
                    className={`w-full p-3.5 rounded-xl border text-left transition-all hover:shadow-sm ${selectedOverview?.id === ov.id ? 'ring-1 ring-[var(--accent-primary)]' : ''}`}
                    style={{ borderColor: selectedOverview?.id === ov.id ? 'var(--accent-primary)' : 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: 'var(--accent-subtle)' }}
                      >
                        <Play className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {ov.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-dimmed)' }}>
                            <Clock className="w-2.5 h-2.5" />
                            {formatDuration(ov.estimatedDuration)}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ov.status === 'ready' ? 'bg-green-500/10 text-green-400' : ov.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                            {ov.status === 'ready' ? '● Prêt' : ov.status === 'error' ? '● Erreur' : '● En cours'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(ov.id); }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10"
                    style={{ color: 'var(--color-error)' }}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Script viewer — shown in fullView mode when overview is selected */}
      {fullView && selectedOverview && (
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 lg:p-7" style={{ borderColor: 'var(--notebook-border)' }}>
        {selectedOverview ? (
          <div className="space-y-5 max-w-2xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 pb-4 border-b" style={{ borderColor: 'var(--border-base)' }}>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--accent-subtle)' }}
              >
                <Users className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {selectedOverview.title}
                </h2>
                <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-dimmed)' }}>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(selectedOverview.estimatedDuration)}
                  </span>
                  <span>•</span>
                  <span>{new Date(selectedOverview.createdAt).toLocaleDateString('fr-FR')}</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Play TTS */}
                {playing ? (
                  <button
                    onClick={handleStopTTS}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all active:scale-95"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: 'var(--color-error)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                    title="Arrêter la lecture"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handlePlayTTS}
                    disabled={ttsLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all hover:shadow-sm active:scale-95 disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--color-success)20',
                      color: 'var(--color-success)',
                      border: '1px solid var(--color-success)40',
                    }}
                    title="Écouter le podcast (TTS)"
                  >
                    {ttsLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                    Écouter
                  </button>
                )}
                {/* Save to Sandbox */}
                <button
                  onClick={handleSaveToSandbox}
                  disabled={downloading}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-full text-xs font-semibold transition-all hover:shadow-sm active:scale-95 disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--color-warning)10',
                    color: 'var(--color-warning)',
                    border: '1px solid var(--color-warning)40',
                  }}
                  title="Enregistrer dans la sandbox"
                >
                  {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                </button>
                {/* Regenerate */}
                <button
                  onClick={handleRegenerate}
                  disabled={generating}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-full text-xs font-semibold transition-all hover:shadow-sm active:scale-95 disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-base)',
                  }}
                  title="Régénérer"
                >
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </button>
                {/* Delete */}
                <button
                  onClick={() => handleDelete(selectedOverview.id)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-full text-xs font-semibold transition-all hover:shadow-sm active:scale-95"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--color-error)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                  }}
                  title="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* TTS Progress bar — Enhanced player */}
            {playing && ttsTotalLines > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-2 px-4 py-3 rounded-xl"
                style={{ backgroundColor: 'var(--color-success)08', border: '1px solid var(--color-success)25' }}
              >
                {/* Top row: waveform + progress */}
                <div className="flex items-center gap-3">
                  {/* Mini waveform animation */}
                  <div className="flex items-center gap-[2px] h-5 flex-shrink-0">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <motion.div
                        key={i}
                        className="w-[3px] rounded-full"
                        style={{ backgroundColor: 'var(--color-success)' }}
                        animate={{
                          height: ['8px', '16px', '10px', '18px', '8px'],
                        }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          delay: i * 0.15,
                          ease: 'easeInOut',
                        }}
                      />
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div className="flex-1">
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'linear-gradient(90deg, var(--color-success), var(--color-success))' }}
                        animate={{ width: `${(ttsProgress / ttsTotalLines) * 100}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                    </div>
                  </div>

                  {/* Progress count */}
                  <span className="text-xs font-semibold flex-shrink-0 tabular-nums" style={{ color: 'var(--color-success)' }}>
                    {ttsProgress}/{ttsTotalLines}
                  </span>
                </div>

                {/* Bottom row: controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Stop button */}
                    <button
                      onClick={handleStopTTS}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95"
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        color: 'var(--color-error)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                      }}
                    >
                      <Square className="w-3 h-3" />
                      Arrêter
                    </button>

                    {/* Speed button */}
                    <button
                      onClick={cycleSpeed}
                      className="px-2.5 py-1.5 rounded-full text-xs font-bold transition-all hover:bg-white/5 active:scale-95"
                      style={{ color: 'var(--color-success)', border: '1px solid var(--color-success)30' }}
                      title="Changer la vitesse"
                    >
                      {playbackSpeed}×
                    </button>
                  </div>

                  {/* Estimated remaining */}
                  <span className="text-xs font-medium" style={{ color: 'var(--text-dimmed)' }}>
                    {ttsTotalLines - ttsProgress > 0 
                      ? `~${Math.ceil((ttsTotalLines - ttsProgress) * 3)}s restants`
                      : 'Terminé'
                    }
                  </span>
                </div>
              </motion.div>
            )}

            {/* Controls bar (when not playing) */}
            {!playing && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={cycleSpeed}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all hover:bg-white/5 active:scale-95"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  title="Vitesse de lecture"
                >
                  ⚡ {playbackSpeed}×
                </button>
                <button
                  onClick={handleDownloadScript}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all hover:bg-white/5 active:scale-95"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  title="Télécharger le script"
                >
                  📥 Script .md
                </button>
                <span className="text-xs ml-auto font-medium" style={{ color: 'var(--text-dimmed)' }}>
                  ~{Math.ceil(selectedOverview.script.split('\n').filter((l: string) => l.trim()).length * 3 / playbackSpeed)}s à {playbackSpeed}×
                </span>
              </div>
            )}

            {/* Script as chat bubbles */}
            <div className="space-y-4">
              {selectedOverview.script.split('\n').map((line, i) => {
                const isAlex = line.trim().startsWith('Alex:') || line.trim().startsWith('Alex :');
                const isSam = line.trim().startsWith('Sam:') || line.trim().startsWith('Sam :');

                if (isAlex || isSam) {
                  const speaker = isAlex ? 'Alex' : 'Sam';
                  const text = line.replace(/^(Alex|Sam)\s*:\s*/i, '');
                  const isCurrentLine = playing && currentLineIndex === i;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className={`flex gap-3 ${isSam ? 'flex-row-reverse' : ''}`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm ${isCurrentLine ? 'animate-pulse' : ''}`}
                        style={{
                          backgroundColor: isAlex ? 'var(--accent-primary)20' : 'var(--color-success)20',
                          color: isAlex ? 'var(--accent-primary)' : 'var(--color-success)',
                          border: `1.5px solid ${isCurrentLine ? (isAlex ? 'var(--accent-primary)' : 'var(--color-success)') : (isAlex ? 'var(--accent-primary)40' : 'var(--color-success)40')}`,
                        }}
                      >
                        {speaker[0]}
                      </div>
                      <div className="max-w-[80%]">
                        <p className="text-xs font-semibold mb-1 px-1" style={{ color: isAlex ? 'var(--accent-primary)' : 'var(--color-success)' }}>
                          {speaker}
                        </p>
                        <div
                          className={`p-3.5 rounded-2xl text-xs leading-relaxed ${isAlex ? 'rounded-tl-md' : 'rounded-tr-md'} transition-all`}
                          style={{
                            backgroundColor: isCurrentLine ? (isAlex ? 'var(--accent-primary)10' : 'var(--color-success)10') : 'var(--bg-panel)',
                            border: `1px solid ${isCurrentLine ? (isAlex ? 'var(--accent-primary)40' : 'var(--color-success)40') : 'var(--border-base)'}`,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {text}
                        </div>
                      </div>
                    </motion.div>
                  );
                }

                if (!line.trim()) return null;
                return (
                  <p key={i} className="text-xs italic text-center py-2 px-4 rounded-lg"
                    style={{ color: 'var(--text-dimmed)', backgroundColor: 'var(--bg-base)' }}>
                    {line}
                  </p>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      )}
    </div>
  );
}
