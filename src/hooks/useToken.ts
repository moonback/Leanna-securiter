import { useState, useCallback } from 'react';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: Date;
}

export interface TokenUsageSession {
  history: TokenUsage[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export type ContextAlertLevel = 'ok' | 'warn' | 'critical';

export interface PromptContextState {
  currentSize: number;
  maxSize: number;
  percent: number;
  level: ContextAlertLevel;
  turns: number;
  suggestion?: string;
  updatedAt: Date;
}

const INITIAL_TOKEN_USAGE: TokenUsageSession = {
  history: [],
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
};

const INITIAL_PROMPT_CONTEXT: PromptContextState = {
  currentSize: 0,
  maxSize: 1_000_000,
  percent: 0,
  level: 'ok',
  turns: 0,
  updatedAt: new Date(),
};

export function useToken() {
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSession>(INITIAL_TOKEN_USAGE);
  const [promptContext, setPromptContext] = useState<PromptContextState>(INITIAL_PROMPT_CONTEXT);

  const addTokenUsage = useCallback((rawUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    session?: {
      session_total?: number;
      context_window?: number;
      context_percent?: number;
      turns?: number;
      alert_level?: '' | 'warn' | 'critical';
    };
  }) => {
    const usage: TokenUsage = {
      promptTokens: rawUsage.promptTokens ?? 0,
      completionTokens: rawUsage.completionTokens ?? 0,
      totalTokens: rawUsage.totalTokens ?? 0,
      timestamp: new Date(),
    };
    setTokenUsage(prev => ({
      history: [...prev.history.slice(-99), usage],
      totalPromptTokens: prev.totalPromptTokens + usage.promptTokens,
      totalCompletionTokens: prev.totalCompletionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
    }));

    const session = rawUsage.session;
    if (session?.session_total != null && session.context_window) {
      const percent = session.context_percent ?? Math.round((session.session_total / session.context_window) * 100);
      const level = session.alert_level === 'critical' ? 'critical'
        : session.alert_level === 'warn' ? 'warn'
        : percent >= 85 ? 'critical' : percent >= 60 ? 'warn' : 'ok';
      setPromptContext({
        currentSize: session.session_total,
        maxSize: session.context_window,
        percent,
        level,
        turns: session.turns ?? 0,
        updatedAt: new Date(),
      });
    }
  }, []);

  const updatePromptContext = useCallback((raw: {
    currentSize?: number;
    maxSize?: number;
    percent?: number;
    level?: ContextAlertLevel;
    turns?: number;
    suggestion?: string;
    used_tokens?: number;
    max_tokens?: number;
  }) => {
    const currentSize = raw.currentSize ?? raw.used_tokens ?? 0;
    const maxSize = raw.maxSize ?? raw.max_tokens ?? INITIAL_PROMPT_CONTEXT.maxSize;
    const percent = raw.percent ?? (maxSize > 0 ? Math.round((currentSize / maxSize) * 100) : 0);
    const level = raw.level ?? (percent >= 85 ? 'critical' : percent >= 60 ? 'warn' : 'ok');

    setPromptContext(prev => ({
      currentSize,
      maxSize,
      percent,
      level,
      turns: raw.turns ?? prev.turns,
      suggestion: raw.suggestion ?? prev.suggestion,
      updatedAt: new Date(),
    }));
  }, []);

  const clearTokenUsage = useCallback(() => {
    setTokenUsage(INITIAL_TOKEN_USAGE);
    setPromptContext(INITIAL_PROMPT_CONTEXT);
  }, []);

  return {
    tokenUsage,
    promptContext,
    addTokenUsage,
    updatePromptContext,
    clearTokenUsage,
  };
}
