import { useState, useCallback, useEffect, useRef } from 'react';
import { buildAuditSteps, isSystemAuditRequest, type AuditStep, type AuditReport } from '../utils/audit.js';
import type { ScheduledTaskViewModel } from '../components/panels/ScheduledTasksPanel.js';
import type { WorkflowViewModel } from '../components/panels/WorkflowsPanel.js';

import { useAudio } from './useAudio.js';
import { useWebSocket } from './useWebSocket.js';
import { useToken, type TokenUsage, type TokenUsageSession, type PromptContextState, type ContextAlertLevel } from './useToken.js';
import { useTranscript, type TranscriptRole, type TranscriptEntry, type ContextSource } from './useTranscript.js';
import { useActivity, type ActivityStep, type ModifiedFile, type ReasoningState, type ReasoningStep } from './useActivity.js';
import { useProfile } from '../context/UserProfileContext.js';

// Re-export types to keep existing component imports functional
export type ConnectionStatus = 'idle' | 'connecting' | 'connected';
export type LogType = 'system' | 'action' | 'error' | 'info';

/**
 * Seuil au-delà duquel une mesure de latence voix est considérée aberrante /
 * issue d'un timestamp de départ périmé. Sert à la fois à réarmer le tracking
 * (handleAudioData) et à rejeter la mesure (recordLatency), pour éviter le bug
 * historique du 81276ms mesuré depuis une utterance obsolète.
 */
const LATENCY_MAX_MS = 30_000;

export interface LogEntry {
  id: string;
  type: LogType;
  msg: string;
  timestamp: Date;
}

export type { TranscriptRole, TranscriptEntry, ContextSource, ActivityStep, ModifiedFile, TokenUsage, TokenUsageSession, ReasoningState, ReasoningStep, PromptContextState, ContextAlertLevel };

export function useLiveAPI() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [auditSteps, setAuditSteps] = useState<AuditStep[]>(buildAuditSteps());
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskViewModel[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowViewModel[]>([]);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);

  // ── Configuration résumé automatique ───────────────────────────────────────
  const [autoSummarizeEnabled, setAutoSummarizeEnabled] = useState(true);
  const [autoSummarizeThreshold, setAutoSummarizeThreshold] = useState(50);
  const [autoSummarizeKeepTurns, setAutoSummarizeKeepTurns] = useState(8);

  // ── Logger ─────────────────────────────────────────────────────────────────
  const addLog = useCallback((msg: string, type: LogType = 'system') => {
    setLogs(prev => {
      const entry: LogEntry = {
        id: Date.now().toString() + Math.random(),
        type,
        msg,
        timestamp: new Date(),
      };
      const next = [...prev, entry];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });
  }, []);

  // ── Sub-hooks ──────────────────────────────────────────────────────────────
  const {
    transcript,
    addTranscript,
    clearTranscript,
  } = useTranscript();

  const {
    tokenUsage,
    promptContext,
    addTokenUsage,
    updatePromptContext,
    clearTokenUsage,
  } = useToken();

  const {
      activity,
      isBusy,
      reasoning,
      setIsBusy,
      setReasoning,
      startActivity,
      completeActivity,
      clearActivity,
      resetActivityState,
    } = useActivity();

  // Ref to track isBusy without creating stale closures in audio callbacks
  const isBusyRef = useRef(false);
  const pendingSourcesRef = useRef<ContextSource[]>([]);
  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  // ── Latency monitoring ─────────────────────────────────────────────────────
  // Timestamp du premier chunk audio envoyé (début d'utterance détecté par VAD)
  const utteranceStartRef = useRef<number | null>(null);
  // Indique si on est en attente du premier chunk audio de la réponse
  const waitingFirstResponseChunkRef = useRef(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const latencyHistoryRef = useRef<number[]>([]);

  const recordLatency = useCallback((ms: number) => {
    // Validation : rejeter les latences manifestement incorrectes ou négatives.
    // Un départ périmé est désormais réarmé en amont (handleAudioData), donc ce
    // rejet ne devrait quasiment plus se déclencher.
    if (ms < 0 || ms > LATENCY_MAX_MS) {
      console.warn(`[VoiceLatency] Latence anormale rejetée: ${ms}ms (timestamp périmé ou négatif)`);
      return;
    }
    
    setLastLatencyMs(ms);
    latencyHistoryRef.current = [...latencyHistoryRef.current.slice(-19), ms];
    console.debug(`[VoiceLatency] ${ms}ms`);
  }, []);

  const getLatencyStats = useCallback(() => {
    const history = latencyHistoryRef.current;
    if (history.length === 0) return null;
    const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
    const min = Math.min(...history);
    const max = Math.max(...history);
    return { avg, min, max, samples: history.length, last: history[history.length - 1] };
  }, []);

  // ── Barge-in : envoi audio continu, interruption gérée côté serveur ────────
  // Gemini Live supporte nativement le barge-in — envoyer de l'audio pendant
  // que le modèle parle interrompt la génération. On ne bloque donc plus
  // l'envoi pendant isBusy, sauf pendant l'exécution d'outils (tool calls)
  // où Gemini n'écoute pas et où l'audio serait ignoré de toute façon.
  // On mesure également la latence entre le début d'utterance et le premier chunk.
  const handleAudioData = useCallback((pcm16: ArrayBuffer) => {
    // Bloquer uniquement pendant l'exécution d'outils côté serveur
    if (isBusyRef.current) return;

    // Mesure de latence : détecter le début d'utterance.
    // Cas normal : aucune utterance en cours → armer le timestamp.
    // Garde-fou anti-timestamp-périmé : si on attend une réponse depuis trop
    // longtemps (aucun chunk n'est jamais arrivé — VAD faux positif, audio
    // ignoré pendant un tool call, réponse filtrée), l'ancien timestamp est
    // périmé. On le ré-arme sur l'utterance COURANTE plutôt que de mesurer un
    // jour plus tard depuis un départ obsolète (cause du 81276ms).
    const now = performance.now();
    const stale =
      waitingFirstResponseChunkRef.current &&
      utteranceStartRef.current !== null &&
      now - utteranceStartRef.current > LATENCY_MAX_MS;
    if ((utteranceStartRef.current === null && !waitingFirstResponseChunkRef.current) || stale) {
      utteranceStartRef.current = now;
      waitingFirstResponseChunkRef.current = true;
    }

    sendAudioData(pcm16);
  }, []);

    const { profile } = useProfile();

    const {
      muted,
      toggleMute,
      wake,
      playAudioChunk,
      handleInterrupt,
      initAudio,
      cleanupAudio,
      getInputAmplitude,
      getOutputAmplitude,
    } = useAudio({ 
      onAudioData: handleAudioData,
      autoMuteEnabled: profile.autoMuteEnabled,
      autoMuteTimeout: profile.autoMuteTimeout,
      vadEnabled: profile.vadEnabled,
      vadThreshold: profile.vadThreshold,
      vadSilenceDuration: profile.vadSilenceDuration,
    });

  // Define onMessage handler for WS events
  const handleWebSocketMessage = useCallback((msg: any) => {
    if (msg.tool_used) {
      let args: Record<string, unknown> = {};
      try { args = typeof msg.info === 'string' ? JSON.parse(msg.info) : (msg.info ?? {}); } catch { /* trace sans arguments structurés */ }
      const path = [args.path, args.file, args.filePath, args.newPath, args.command]
        .find(value => typeof value === 'string' && value.trim()) as string | undefined;
      if (path) {
        const lineStart = args.lineStart ?? args.startLine;
        const lineEnd = args.lineEnd ?? args.endLine ?? lineStart;
        pendingSourcesRef.current.push({
          id: `${Date.now()}-${pendingSourcesRef.current.length}`,
          path,
          tool: msg.tool_used,
          lines: lineStart !== undefined ? `L${lineStart}${lineEnd !== lineStart ? `-L${lineEnd}` : ''}` : undefined,
        });
      }
    }
    if (msg.interrupted) {
      // Réinitialiser le tracking de latence si l'assistant est interrompu
      utteranceStartRef.current = null;
      waitingFirstResponseChunkRef.current = false;
      handleInterrupt();
      addLog('Interrupted', 'system');
    }
    if (typeof msg.audio === 'string') {
      // Les annonces TTS des outils arrivent en JSON base64, contrairement à l'audio Live binaire.
      playAudioChunk(msg.audio);
    }
    if (msg.type === 'ide-action' && msg.action) {
      const a = msg.action;
      window.dispatchEvent(new CustomEvent('Leanna-ide-action', { detail: a }));
      switch (a.type) {
        case 'browser-scroll':
          window.dispatchEvent(new CustomEvent('Leanna-browser-scroll', { detail: a }));
          break;
        case 'browser-back':
        case 'browser-forward':
        case 'browser-reload':
          window.dispatchEvent(new CustomEvent('Leanna-browser-control', { detail: a }));
          break;
        case 'browser-read-request':
          if (a.requestId) {
            window.dispatchEvent(new CustomEvent('Leanna-browser-read-request', {
              detail: { requestId: a.requestId, selector: a.selector ?? null },
            }));
          }
          break;
        case 'browser-click':
          window.dispatchEvent(new CustomEvent('Leanna-browser-click', { detail: a }));
          break;
        case 'browser-type':
          window.dispatchEvent(new CustomEvent('Leanna-browser-type', { detail: a }));
          break;
        case 'browser-snapshot':
          window.dispatchEvent(new CustomEvent('Leanna-browser-snapshot', { detail: a }));
          break;
        case 'browser-inspect':
          window.dispatchEvent(new CustomEvent('Leanna-browser-inspect', { detail: a }));
          break;
        case 'browser-get-links':
          window.dispatchEvent(new CustomEvent('Leanna-browser-get-links', { detail: a }));
          break;
        case 'browser-mouse-move':
          window.dispatchEvent(new CustomEvent('Leanna-browser-mouse-move', { detail: a }));
          break;
        // Sprint 1 — J1 : Accessibilité
        case 'browser-accessibility-snapshot':
          window.dispatchEvent(new CustomEvent('Leanna-browser-accessibility-snapshot', { detail: a }));
          break;
        case 'browser-click-by-role':
          window.dispatchEvent(new CustomEvent('Leanna-browser-click-by-role', { detail: a }));
          break;
        case 'browser-type-by-label':
          window.dispatchEvent(new CustomEvent('Leanna-browser-type-by-label', { detail: a }));
          break;
        // Sprint 1 — J2 : Robustesse
        case 'browser-wait-for':
          window.dispatchEvent(new CustomEvent('Leanna-browser-wait-for', { detail: a }));
          break;
        // Sprint 1 — J3 : Actions primitives
        case 'browser-get-element-text':
          window.dispatchEvent(new CustomEvent('Leanna-browser-get-element-text', { detail: a }));
          break;
        case 'browser-get-element-attribute':
          window.dispatchEvent(new CustomEvent('Leanna-browser-get-element-attribute', { detail: a }));
          break;
        case 'browser-fill-form':
          window.dispatchEvent(new CustomEvent('Leanna-browser-fill-form', { detail: a }));
          break;
        case 'browser-select-option':
          window.dispatchEvent(new CustomEvent('Leanna-browser-select-option', { detail: a }));
          break;
        case 'open-rich-document':
          window.dispatchEvent(new CustomEvent('Leanna-open-rich-document', { detail: a }));
          break;
      }
    }
    if (msg.type === 'save-rich-document-result') {
      window.dispatchEvent(new CustomEvent('Leanna-save-rich-document-result', { detail: msg }));
    }
    if (msg.type === 'browser-read-request' && msg.requestId) {
      window.dispatchEvent(new CustomEvent('Leanna-browser-read-request', {
        detail: { requestId: msg.requestId, selector: msg.selector ?? null },
      }));
    }
    // ── Confirmation interactive (fichiers critiques) ──────────────────
    if (msg.type === 'confirm-critical-edit' && msg.requestId) {
      window.dispatchEvent(new CustomEvent('Leanna-confirm-critical-edit', { detail: msg }));
    }
    if (msg.tool_start) {
      // Auto-open IDE when a codebase tool is used
      const IDE_TOOLS = ['list_project_files', 'read_project_file', 'write_project_file',
        'modify_project_file', 'search_in_files', 'open_project_file', 'open_ide',
        'create_project_directory', 'rename_project_file', 'delete_project_file', 'delete_project_folder',
        'analyze_project_file', 'get_workspace_info', 'generate_codebase_markdown'];
      if (IDE_TOOLS.includes(msg.tool_start)) {
        window.dispatchEvent(new CustomEvent('Leanna-ide-action', { detail: { type: 'open-ide' } }));
      }
      startActivity(msg.tool_start, msg.args);
      // Dispatch for AgentPanel real-time tool tracking
      window.dispatchEvent(new CustomEvent('Leanna-tool-start', { detail: { tool: msg.tool_start, args: msg.args } }));
    }
    if (msg.tool_used) {
      addLog(`${msg.tool_used} — ${msg.info}`, 'action');
      completeActivity(msg.tool_used);
      // Dispatch for AgentPanel real-time tool tracking
      window.dispatchEvent(new CustomEvent('Leanna-tool-done', {
        detail: { tool: msg.tool_used, info: msg.info, result: msg.result },
      }));
      if (msg.tool_used === 'security_audit' && msg.result) {
        window.dispatchEvent(new CustomEvent('Leanna-security-audit-report', {
          detail: msg.result,
        }));
      }
    }
    if (msg.error) {
      addLog(msg.error, 'error');
    }
    // ── Retry tool call notification ─────────────────────────────────────────
    if (msg.tool_retry) {
      addLog(`⟳ ${msg.tool_retry} — tentative ${msg.attempt}/${msg.maxRetries} (retry dans ${msg.retryIn}ms)`, 'info');
    }
    // ── Rate limiting audio ───────────────────────────────────────────────────
    if (msg.type === 'audio_rate_limited') {
      addLog(`⚠️ Débit audio limité (violation #${msg.violations}, max ${msg.limitKBs} KB/s) — certains chunks ignorés`, 'error');
    }
    if (msg.busy !== undefined) {
      setIsBusy(!!msg.busy);
    }
    if (msg.reasoning) {
      setReasoning(prev => {
        const incoming = msg.reasoning as Partial<ReasoningState>;
        const startsNewReasoning = incoming.active === true && !prev.active;
        const nextChunk = typeof incoming.chunk === 'string' ? incoming.chunk : '';
        return {
          ...prev,
          ...incoming,
          ...(startsNewReasoning ? { streamText: '' } : {}),
          ...(nextChunk ? { streamText: startsNewReasoning ? nextChunk : `${prev.streamText ?? ''}${nextChunk}` } : {}),
        };
      });
      if (msg.reasoning.active) {
        addLog(`🧠 Raisonnement activé: ${msg.reasoning.strategyLabel || msg.reasoning.strategy}`, 'info');
      }
    }
    if (msg.type === 'agent_event') {
      const emoji = msg.event === 'task_started' ? '🤖'
        : msg.event === 'task_completed' ? '✅'
        : msg.event === 'task_failed' ? '❌'
        : '⏳';
      const duration = msg.durationMs ? ` (${(msg.durationMs / 1000).toFixed(1)}s)` : '';
      addLog(`${emoji} Agent ${msg.agentName}: ${msg.detail || msg.title}${duration}`,
        msg.event === 'task_failed' ? 'error' : 'action');
      // Dispatch pour composants qui écoutent les événements agents
      window.dispatchEvent(new CustomEvent('Leanna-agent-event', { detail: msg }));
    }
    if (msg.type === 'build-status') {
      window.dispatchEvent(new CustomEvent('Leanna-build-status', { detail: msg }));
    }
    if (msg.type === 'knowledge_progress') {
      window.dispatchEvent(new CustomEvent('Leanna-knowledge-progress', { detail: msg }));
    }
    if (msg.type === 'mission_event') {
      const emoji = msg.event === 'mission_started' ? '🎯'
        : msg.event === 'mission_completed' ? '🏆'
        : msg.event === 'action_completed' ? '⚡'
        : msg.event === 'goal_started' ? '📋'
        : msg.event === 'goal_escalated' ? '⚠️'
        : '🔄';
      addLog(`${emoji} Mission: ${msg.title || msg.goalTitle || msg.skill || msg.event}`,
        msg.event.includes('fail') || msg.event.includes('escalat') ? 'error' : 'action');
      // Dispatch pour composants qui écoutent les événements missions
      window.dispatchEvent(new CustomEvent('Leanna-mission-event', { detail: msg }));
    }
    if (msg.text) {
      // ⚠️ NE PAS réinitialiser la latence ici - le texte arrive AVANT l'audio (50-100ms)
      // La latence est mesurée uniquement sur le premier chunk audio (voir msg.audio ci-dessus)
      const sources = pendingSourcesRef.current;
      pendingSourcesRef.current = [];
      addTranscript('assistant', msg.text, sources);
    }
    if (msg.user_text) {
      addTranscript('user', msg.user_text);
    }
    if (msg.token_usage) {
      addTokenUsage(msg.token_usage);
    }
    if (msg.context_size) {
      updatePromptContext(msg.context_size);
    }
    if (msg.context_alert) {
      updatePromptContext(msg.context_alert);
    }
    // ── Redémarrage automatique après dépassement de tokens (context_overflow) ──
    if (msg.type === 'session_restart' && msg.reason === 'context_overflow') {
      const summary = msg.summary || '';
      const messagesSummarized = msg.messagesSummarized || 0;
      const method = msg.summaryMethod || 'unknown';

      addLog(`🔄 Contexte dépassé — redémarrage avec résumé (${messagesSummarized} messages, méthode: ${method})`, 'system');

      // Remplacer le transcript par le résumé + indication de redémarrage
      if (summary) {
        // Validation défensive : s'assurer que summary est bien une string
        const summaryText = typeof summary === 'string' 
          ? summary 
          : (typeof summary === 'object' ? JSON.stringify(summary, null, 2) : String(summary));
        
        window.dispatchEvent(new CustomEvent('Leanna-summarize-context', {
          detail: {
            summary: `[Redémarrage automatique — ${messagesSummarized} messages de la conversation précédente résumés]\n\n${summaryText}`,
            summarizedTurns: messagesSummarized,
            retained: [], // On ne garde rien de l'ancien transcript, tout est dans le résumé
          },
        }));
      }

      // Reset les compteurs de tokens (la nouvelle session repart à zéro)
      clearTokenUsage();
    }
  }, [
    playAudioChunk,
    handleInterrupt,
    startActivity,
    completeActivity,
    addLog,
    setIsBusy,
    setReasoning,
    addTranscript,
    addTokenUsage,
    updatePromptContext,
    clearTokenUsage,
    recordLatency,
  ]);

  const handleAudioChunk = useCallback((pcm16: ArrayBuffer) => {
    if (waitingFirstResponseChunkRef.current && utteranceStartRef.current !== null) {
      const now = performance.now();
      const elapsed = Math.round(now - utteranceStartRef.current);
      // Toujours réinitialiser le tracking, même si la mesure est écartée : un
      // timestamp de départ périmé (utterance sans réponse, audio ignoré pendant
      // un tool call, réponse filtrée) ne doit jamais contaminer la mesure de la
      // PROCHAINE utterance. C'était la cause du 81276ms observé.
      waitingFirstResponseChunkRef.current = false;
      utteranceStartRef.current = null;
      // recordLatency filtre déjà les valeurs aberrantes ; on n'enregistre que
      // les mesures fraîches et plausibles.
      recordLatency(elapsed);
    }
    playAudioChunk(pcm16);
  }, [playAudioChunk, recordLatency]);

  const {
    status,
    connected,
    connecting,
    connect: connectWebSocket,
    disconnect: disconnectWebSocket,
    sendAudioData,
    sendVideoFrame,
    sendTextMessage: sendWSMessage,
    sendRawMessage,
  } = useWebSocket({
    onMessage: handleWebSocketMessage,
    onAudioChunk: handleAudioChunk,
    onLog: addLog,
  });

  const connect = useCallback((activeSkills: string[] = [], mode: 'full' | 'ask' = 'full') => {
    connectWebSocket(activeSkills, mode, initAudio, () => {
      cleanupAudio();
      clearTokenUsage();
      resetActivityState();
    });
  }, [connectWebSocket, initAudio, cleanupAudio, clearTokenUsage, resetActivityState]);

  const disconnect = useCallback(() => {
    disconnectWebSocket(true);
    cleanupAudio();
    clearTokenUsage();
    resetActivityState();
  }, [disconnectWebSocket, cleanupAudio, clearTokenUsage, resetActivityState]);

  const sendTextMessage = useCallback((text: string, displayText = text) => {
    sendWSMessage(text);
    addTranscript('user', displayText);
  }, [sendWSMessage, addTranscript]);

  // ── Injection de contexte éditeur ──────────────────────────────────────────
  // Envoie le contexte de l'éditeur (fichier actif, sélection, position curseur)
  // au serveur pour enrichir les requêtes vocales. Appelé par IdeView juste avant
  // ou après l'envoi d'un message vocal, sans bloquer le flux audio.
  const sendEditorContext = useCallback((ctx: {
    openFile?: string | null;
    language?: string | null;
    selection?: string | null;
    cursorLine?: number | null;
    cursorColumn?: number | null;
    openFiles?: string[];
    tsErrors?: Array<{ file: string; line: number; column: number; message: string }>;
  }) => {
    // Ne rien envoyer si tout est vide
    if (!ctx.openFile && !ctx.selection && (!ctx.openFiles || ctx.openFiles.length === 0) && (!ctx.tsErrors || ctx.tsErrors.length === 0)) return;
    sendRawMessage({ type: 'voice_context', ...ctx });
  }, [sendRawMessage]);

  // ── Résumé automatique du contexte ─────────────────────────────────────────
  const summarizeContext = useCallback(async (keepTurns: number = 8) => {
    if (transcript.length <= keepTurns) {
      return { summary: '', retainedTurns: transcript.length, summarizedTurns: 0, method: 'local' as const, tokensSaved: 0 };
    }

    const payload = {
      transcript: transcript.map(e => ({ role: e.role, text: e.text })),
      keepTurns,
    };

    try {
      const res = await fetch('/api/tokens/summarize-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error || 'Summarize failed');

      const { summary, retainedTurns, summarizedTurns, method, tokensSaved } = data;

      // Dispatch pour useTranscript: remplacer le transcript par résumé + tours conservés
      window.dispatchEvent(new CustomEvent('Leanna-summarize-context', {
        detail: {
          summary,
          summarizedTurns,
          retained: transcript.slice(-retainedTurns),
        },
      }));

      // Mettre à jour le contexte prompt pour refléter la réduction
      updatePromptContext({
        currentSize: Math.round(promptContext.currentSize * 0.3),
        percent: Math.round(promptContext.percent * 0.3),
      });

      addLog(`Contexte résumé : ${summarizedTurns} messages condensés (${tokensSaved} tokens économisés)`, 'action');

      return { summary, retainedTurns, summarizedTurns, method, tokensSaved };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[SummarizeContext] Failed:', msg);
      addLog(`Échec du résumé du contexte : ${msg}`, 'error');
      return { summary: '', retainedTurns: transcript.length, summarizedTurns: 0, method: 'local' as const, tokensSaved: 0 };
    }
  }, [transcript, promptContext, addLog, updatePromptContext]);

  // ── Déclenchement automatique du résumé ─────────────────────────────────────
  useEffect(() => {
    if (!autoSummarizeEnabled) return;
    if (promptContext.percent < autoSummarizeThreshold) return;

    const triggerSummarize = async () => {
      addLog(`[AutoSummarize] Déclenchement automatique (${transcript.length} tours, seuil: ${autoSummarizeThreshold}, garder: ${autoSummarizeKeepTurns})`, 'info');
      const result = await summarizeContext(autoSummarizeKeepTurns);
      addLog(`[AutoSummarize] Résultat: ${result.summarizedTurns} tours résumés, ${result.tokensSaved} tokens économisés, méthode: ${result.method}`, 'action');
    };

    // Debounce de 500ms pour éviter les déclenchements multiples
    const timer = setTimeout(triggerSummarize, 500);
    return () => clearTimeout(timer);
  }, [promptContext.percent, autoSummarizeEnabled, autoSummarizeThreshold, autoSummarizeKeepTurns, isBusy, summarizeContext, addLog]);
  const refreshScheduledTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/scheduled-tasks');
      const data = await res.json();
      if (Array.isArray(data?.tasks)) {
        setScheduledTasks(data.tasks);
      }
    } catch (error) {
      console.error('Failed to refresh scheduled tasks', error);
    }
  }, []);

  const refreshWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows');
      const data = await res.json();
      if (Array.isArray(data?.workflows)) {
        setWorkflows(data.workflows);
      }
    } catch (error) {
      console.error('Failed to refresh workflows', error);
    }
  }, []);

  const startAuditFlow = useCallback(async (text: string) => {
    if (!isSystemAuditRequest(text)) return;

    // Reset state
    const steps = buildAuditSteps();
    setAuditSteps(steps);
    setAuditReport(null);

    const update = (id: string, patch: Partial<AuditStep>) =>
      setAuditSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

    const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

    try {
      update('os', { status: 'running', detail: 'Lecture de la plateforme…' });
      await delay(400);

      const res = await fetch('/api/audit');
      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Audit] HTTP error:', res.status, errorText);
        throw new Error(`Audit API error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      if (data.status !== 'ok') throw new Error(data.error || 'Audit API error');
      const report: AuditReport = data.report;

      update('os', {
        status: 'done',
        detail: `${report.platform} ${report.arch} — kernel ${report.release}`,
        value: report.platform,
        timestamp: Date.now(),
      });

      update('resources', { status: 'running', detail: 'Lecture CPU et mémoire…' });
      await delay(400);

      const usedGB  = ((report.totalMemoryMB - report.freeMemoryMB) / 1024).toFixed(1);
      const totalGB = (report.totalMemoryMB / 1024).toFixed(1);

      update('resources', {
        status: 'done',
        detail: `${report.cpus} cœurs · RAM ${usedGB}/${totalGB} Go · uptime ${report.uptimeHours}h`,
        value: `${report.cpus} CPU`,
        timestamp: Date.now(),
      });

      update('services', { status: 'running', detail: 'Vérification des clés API…' });
      await delay(400);

      // Services de base toujours vérifiés + services optionnels (Telegram, MCP)
      // uniquement s'ils sont réellement configurés, pour ne pas compter comme
      // "en panne" des intégrations que l'utilisateur n'a jamais activées.
      const baseChecks = [report.geminiOk, report.supabaseOk, report.openrouterOk];
      const optionalChecks: boolean[] = [];
      const detailParts = [
        `Gemini ${report.geminiOk ? '✓' : '✗'}`,
        `Supabase ${report.supabaseOk ? '✓' : '✗'}`,
        `OpenRouter ${report.openrouterOk ? '✓' : '✗'}`,
      ];
      if (report.telegramConfigured) {
        optionalChecks.push(report.telegramOk);
        detailParts.push(`Telegram ${report.telegramOk ? '✓' : '✗'}`);
      }
      if (report.mcpTotal > 0) {
        optionalChecks.push(report.mcpOk);
        detailParts.push(`MCP ${report.mcpConnected}/${report.mcpTotal}`);
      }
      const allChecks = [...baseChecks, ...optionalChecks];
      const svcOk  = allChecks.filter(Boolean).length;
      const svcTotal = allChecks.length;
      const svcBad = svcTotal - svcOk;
      update('services', {
        status: svcBad > 0 ? 'error' : 'done',
        detail: detailParts.join(' · '),
        value: `${svcOk}/${svcTotal}`,
        timestamp: Date.now(),
      });

      update('skills', { status: 'running', detail: 'Inventaire des modules…' });
      await delay(400);

      update('skills', {
        status: 'done',
        detail: report.activeSkills.join(', '),
        value: `${report.activeSkills.length} actifs`,
        timestamp: Date.now(),
      });

      update('summary', { status: 'running', detail: 'Calcul du score de santé…' });
      await delay(500);

      const score = Math.round(
        (svcOk / svcTotal) * 50 +
        Math.max(0, 50 - ((report.totalMemoryMB - report.freeMemoryMB) / report.totalMemoryMB) * 100 * 0.3)
      );
      update('summary', {
        status: 'done',
        detail: `Score de santé : ${score}/100${svcBad > 0 ? ` · ${svcBad} service(s) manquant(s)` : ' · Tous systèmes opérationnels'}`,
        value: `${score}/100`,
        timestamp: Date.now(),
      });

      setAuditReport(report);

    } catch (err: any) {
      console.error('[Audit] Failed:', err);
      setAuditSteps(prev =>
        prev.map(s => s.status === 'pending' || s.status === 'running'
          ? { ...s, status: 'error', detail: err.message || 'Erreur inattendue' }
          : s
        )
      );
    }
  }, []);

  return {
      status, connected, connecting,
      connect, disconnect,
      muted, toggleMute,
      wake,
      logs, transcript, clearTranscript,
      auditSteps,
      auditReport,
      scheduledTasks,
      refreshScheduledTasks,
      workflows,
      refreshWorkflows,
      startAuditFlow,
      getInputAmplitude, getOutputAmplitude,
      sendVideoFrame, sendTextMessage, sendRawMessage, sendEditorContext,
      activity, clearActivity,
      isBusy,
      reasoning,
      tokenUsage,
      promptContext,
      summarizeContext,
      // ── Monitoring latence vocale ────────────────────────────────────────
      lastLatencyMs,
      getLatencyStats,
      // ── Contrôle résumé automatique ─────────────────────────────────────
      autoSummarizeEnabled,
      autoSummarizeThreshold,
      autoSummarizeKeepTurns,
      enableAutoSummarize: () => setAutoSummarizeEnabled(true),
      disableAutoSummarize: () => setAutoSummarizeEnabled(false),
      setAutoSummarizeThreshold,
      setAutoSummarizeKeepTurns,
    };
}