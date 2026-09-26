import { useState, useCallback, useEffect, useRef } from 'react';
import { useChatPersistence } from './useChatPersistence.js';

export type TranscriptRole = 'user' | 'assistant';

export interface ContextSource {
  id: string;
  path: string;
  tool: string;
  lines?: string;
  excluded?: boolean;
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  text: string;
  timestamp: Date;
  sources?: ContextSource[];
}

export function useTranscript() {
  const { restored, hasRestoredTranscript, loadTranscript, saveTranscript, clearPersistedTranscript } = useChatPersistence();
  const didRestoreRef = useRef(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    const restoredTranscript = loadTranscript();
    if (restoredTranscript.length > 0) {
      setTranscript(restoredTranscript);
    }
  }, [loadTranscript]);

  useEffect(() => {
    if (!restored) return;
    if (transcript.length === 0) {
      clearPersistedTranscript();
      return;
    }
    saveTranscript(transcript);
  }, [restored, transcript, saveTranscript, clearPersistedTranscript]);

  const addTranscript = useCallback((role: TranscriptRole, text: string, sources?: ContextSource[]) => {
    setTranscript(prev => {
      if (prev.length > 0 && prev[prev.length - 1].role === role) {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), {
          ...last,
          text: last.text + text,
          sources: sources?.length ? [...(last.sources ?? []), ...sources] : last.sources,
        }];
      }
      const entry: TranscriptEntry = {
        id: Date.now().toString() + Math.random(),
        role,
        text,
        timestamp: new Date(),
        sources,
      };
      const next = [...prev, entry];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  // ── Listener: résumé automatique du contexte ─────────────────────────────
  // Quand useLiveAPI déclenche 'Leanna-summarize-context', on remplace le
  // transcript par le résumé + les tours conservés.
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { summary, summarizedTurns, retained } = e.detail as {
        summary: string;
        summarizedTurns: number;
        retained: TranscriptEntry[];
      };
      
      // Validation défensive : s'assurer que summary est bien une string
      const summaryText = typeof summary === 'string' 
        ? summary 
        : (typeof summary === 'object' ? JSON.stringify(summary) : String(summary));
      
      const summaryEntry: TranscriptEntry = {
        id: Date.now().toString() + Math.random(),
        role: 'assistant',
        text: `[Résumé automatique du contexte — ${summarizedTurns} messages condensés]\n${summaryText}`,
        timestamp: new Date(),
      };
      console.log(
        `[useTranscript] Résumé appliqué: summarizedTurns=${summarizedTurns}, ` +
        `retainedCount=${retained.length}, summaryLength=${summaryText.length}, ` +
        `summaryType=${typeof summary}`,
      );
      setTranscript([summaryEntry, ...retained]);
    };
    window.addEventListener('Leanna-summarize-context', handler as EventListener);
    return () => window.removeEventListener('Leanna-summarize-context', handler as EventListener);
  }, []);

  return {
    transcript,
    addTranscript,
    clearTranscript,
    transcriptRestored: hasRestoredTranscript,
  };
}
