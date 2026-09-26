import {
  useState, useCallback, useEffect, useRef, useMemo, useTransition,
} from 'react';
import {
  TrendingUp, ArrowUp, ArrowDown, Zap, Loader2, AlertTriangle,
  Gauge, Sparkles, Clock, Hash, Brain, AlertCircle, MessageSquare, X,
} from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';
import { formatExactTokenCount, formatTokenCount } from '../../utils/tokenFormatting.js';
import { Modal } from '../ui/Modal.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface OptimizationData {
  systemPromptTokens: number;
  memoryTokens: number;
  totalBaseTokens: number;
  availableForConversation: number;
  suggestions: string[];
  modelBudget: { maxTotal: number };
  compactEnabled?: boolean;
  savedTokens?: number;
}

interface TokenDetailModalProps {
  onClose: () => void;
  /** Rendu en panneau latéral docké (sans le chrome Modal). */
  docked?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const timeAgo = (date: Date): string => {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "à l'instant";
  if (seconds < 60) return `il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  return `il y a ${Math.floor(minutes / 60)}h`;
};

// ── Component ──────────────────────────────────────────────────────────────

export function TokenDetailModal({ onClose, docked = false }: TokenDetailModalProps) {
  const { tokenUsage, promptContext } = useLiveAPIContext();
  const { profile, setField, save } = useProfile();

  const [optimization, setOptimization] = useState<OptimizationData | null>(null);
  const [loadingOpt, setLoadingOpt] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const abortControllerRef = useRef<AbortController | null>(null);

  const { totalTokens, totalPromptTokens, totalCompletionTokens, history } = tokenUsage;

  const formatted = useMemo(() => ({
    total:       formatTokenCount(totalTokens),
    totalExact:  formatExactTokenCount(totalTokens),
    prompt:      formatTokenCount(totalPromptTokens),
    completion:  formatTokenCount(totalCompletionTokens),
  }), [totalTokens, totalPromptTokens, totalCompletionTokens]);

  const loadOptimization = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoadingOpt(true); setOptError(null);
    try {
      const res = await fetch('/api/tokens/optimization', { signal: controller.signal });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === 'success') setOptimization(data.optimization);
      else throw new Error(data.message || 'Erreur inconnue');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setOptError("Impossible de charger les données d'optimisation");
    } finally {
      if (abortControllerRef.current === controller) setLoadingOpt(false);
    }
  }, []);

  useEffect(() => {
    loadOptimization();
    return () => { abortControllerRef.current?.abort(); };
  }, [loadOptimization]);

  const handleToggleCompact = useCallback(async () => {
    const newValue = !profile.compactPrompt;
    setField('compactPrompt', newValue);
    try {
      await save();
      startTransition(() => { loadOptimization(); });
    } catch {
      setField('compactPrompt', profile.compactPrompt);
    }
  }, [profile.compactPrompt, setField, save, loadOptimization]);

  const headerContent = (
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 16%, transparent)' }}
          >
            <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Détails du Système</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contexte &amp; tokens • {history.length} requêtes</p>
          </div>
        </div>
  );

  const bodyContent = (
        <div className="space-y-5">

          {/* ── Contexte du Prompt ── */}
          <section className="rounded-3xl p-4 space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-base)' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4" style={{ color: promptContext.level === 'critical' ? 'var(--color-error)' : promptContext.level === 'warn' ? 'var(--color-warning)' : 'var(--color-success)' }} aria-hidden />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Contexte du Prompt</span>
              </div>
              <div className="flex items-center gap-1.5">
                {promptContext.level !== 'ok' && (promptContext.level === 'critical'
                  ? <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} aria-hidden />
                  : <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} aria-hidden />)}
                <span className="text-sm font-bold tabular-nums" style={{ color: promptContext.level === 'critical' ? 'var(--color-error)' : promptContext.level === 'warn' ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  {promptContext.percent}%
                </span>
              </div>
            </div>
            <div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 78%, transparent)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, promptContext.percent)}%`,
                    background: promptContext.level === 'critical'
                      ? 'var(--color-error)'
                      : promptContext.level === 'warn'
                        ? 'var(--color-warning)'
                        : 'linear-gradient(90deg, var(--color-success), var(--accent-secondary))',
                  }}
                  role="progressbar"
                  aria-valuenow={Math.min(100, promptContext.percent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Utilisation du contexte"
                />
              </div>
              <div className="flex justify-between mt-1 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                <span>{formatTokenCount(promptContext.currentSize)} utilisés</span>
                <span>{formatTokenCount(promptContext.maxSize)} max</span>
              </div>
            </div>
            {promptContext.turns > 0 && (
              <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                <MessageSquare className="w-3 h-3" aria-hidden />
                <span>{promptContext.turns} tour{promptContext.turns > 1 ? 's' : ''} dans le contexte</span>
              </div>
            )}
            {promptContext.suggestion ? (
              <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: 'var(--color-warning)', backgroundColor: 'var(--color-warning-subtle)' }}>
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
                <span className="text-sm">{promptContext.suggestion}</span>
              </div>
            ) : promptContext.level === 'ok' && promptContext.currentSize > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: 'var(--color-success)', backgroundColor: 'var(--color-success-subtle)' }}>
                <Sparkles className="w-3 h-3" aria-hidden />
                <span className="text-sm">Contexte en bonne santé</span>
              </div>
            ) : null}
          </section>

          {/* ── Total tokens ── */}
          <div className="text-center">
            <div className="flex items-center gap-2 justify-center mb-2">
              <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} aria-hidden />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Utilisation des Tokens</span>
            </div>
            <p className="text-3xl font-black tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatted.total}</p>
            <p className="text-sm font-mono" style={{ color: 'var(--text-dimmed)' }} title="Valeur exacte">{formatted.totalExact} exact</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>tokens utilisés cette session</p>
          </div>

          {/* ── Prompt vs Completion ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl p-4 border" style={{ backgroundColor: 'var(--color-info-subtle)', borderColor: 'color-mix(in srgb, var(--color-info) 16%, transparent)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <ArrowUp className="w-3.5 h-3.5" style={{ color: 'var(--color-info)' }} aria-hidden />
                <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--color-info)' }}>Prompt</span>
              </div>
              <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatted.prompt}</p>
            </div>
            <div className="rounded-3xl p-4 border" style={{ backgroundColor: 'var(--color-success-subtle)', borderColor: 'color-mix(in srgb, var(--color-success) 16%, transparent)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <ArrowDown className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} aria-hidden />
                <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--color-success)' }}>Réponse</span>
              </div>
              <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatted.completion}</p>
            </div>
          </div>

          {/* ── Optimisation ── */}
          {optimization && (
            <section className="rounded-3xl p-4 space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-base)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Gauge className="w-4 h-4" style={{ color: 'var(--color-info)' }} aria-hidden />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Contexte</span>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
                  <span>Base: {formatTokenCount(optimization.totalBaseTokens)}</span>
                  <span>Max: {formatTokenCount(optimization.modelBudget.maxTotal)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 78%, transparent)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (optimization.totalBaseTokens / optimization.modelBudget.maxTotal) * 100)}%`,
                      background: optimization.totalBaseTokens / optimization.modelBudget.maxTotal > 0.7
                        ? 'linear-gradient(90deg, var(--color-warning), var(--color-error))'
                        : 'linear-gradient(90deg, var(--color-success), var(--accent-secondary))',
                    }}
                    role="progressbar"
                    aria-valuenow={Math.min(100, (optimization.totalBaseTokens / optimization.modelBudget.maxTotal) * 100)}
                    aria-valuemin={0} aria-valuemax={100}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                  <span>Prompt sys: {formatTokenCount(optimization.systemPromptTokens)}</span>
                  <span>Mémoire: {formatTokenCount(optimization.memoryTokens)}</span>
                  <span>Dispo: {formatTokenCount(optimization.availableForConversation)}</span>
                </div>
              </div>
              {optimization.compactEnabled && optimization.savedTokens && optimization.savedTokens > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: 'var(--color-success)', backgroundColor: 'var(--color-success-subtle)' }}>
                  <Zap className="w-3 h-3" aria-hidden />
                  <span className="text-sm font-semibold">−{formatTokenCount(optimization.savedTokens)} économisés (mode compact)</span>
                </div>
              )}
              {optimization.suggestions.length > 0 && (
                <div className="space-y-1 mt-2">
                  {optimization.suggestions.map((s, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: 'var(--color-warning)', backgroundColor: 'var(--color-warning-subtle)' }}>
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
                      <span className="text-sm">{s}</span>
                    </div>
                  ))}
                </div>
              )}
              {optimization.suggestions.length === 0 && !optimization.compactEnabled && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: 'var(--color-success)', backgroundColor: 'var(--color-success-subtle)' }}>
                  <Sparkles className="w-3 h-3" aria-hidden />
                  <span className="text-sm">Utilisation optimale</span>
                </div>
              )}
            </section>
          )}

          {loadingOpt && (
            <div className="flex items-center justify-center py-3" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
              <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>Chargement des données...</span>
            </div>
          )}
          {optError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ color: 'var(--color-error)', backgroundColor: 'var(--color-error-subtle)' }}>
              <AlertTriangle className="w-4 h-4" aria-hidden />
              <span>{optError}</span>
            </div>
          )}

          {/* ── Toggle compact ── */}
          <button
            type="button"
            onClick={handleToggleCompact}
            disabled={isPending}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-3xl text-xs font-medium transition-all ${isPending ? 'opacity-60 cursor-wait' : 'hover:shadow-sm'}`}
            style={{
              border: profile.compactPrompt
                ? '1px solid color-mix(in srgb, var(--color-success) 24%, transparent)'
                : '1px solid var(--border-base)',
              backgroundColor: profile.compactPrompt
                ? 'var(--color-success-subtle)'
                : 'rgba(255,255,255,0.03)',
              color: profile.compactPrompt ? 'var(--color-success)' : 'var(--text-secondary)',
            }}
            aria-pressed={profile.compactPrompt}
          >
            <span className="flex items-center gap-2">
              <Zap className="w-4 h-4" aria-hidden />
              Mode compact (−40% tokens prompt)
            </span>
            <span
              className="px-2 py-0.5 rounded text-xs font-bold uppercase"
              style={{
                backgroundColor: profile.compactPrompt
                  ? 'var(--color-success-subtle)'
                  : 'rgba(255,255,255,0.08)',
                color: profile.compactPrompt ? 'var(--color-success)' : 'var(--text-muted)',
              }}
            >
              {profile.compactPrompt ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* ── Historique ── */}
          {history.length > 0 ? (
            <div>
              <p className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Dernières requêtes ({history.length})
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                {[...history].reverse().slice(0, 25).map((usage, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-input) 80%, transparent)' }}>
                    <div className="flex-1 flex items-center gap-2 text-xs tabular-nums">
                      <span className="font-medium" style={{ color: 'var(--color-info)' }}>↑{formatTokenCount(usage.promptTokens)}</span>
                      <span className="font-medium" style={{ color: 'var(--color-success)' }}>↓{formatTokenCount(usage.completionTokens)}</span>
                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Σ{formatTokenCount(usage.totalTokens)}</span>
                    </div>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      <Clock className="w-2.5 h-2.5" aria-hidden />
                      {timeAgo(usage.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <Hash className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: 'var(--text-muted)' }} aria-hidden />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucune requête enregistrée</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-dimmed)' }}>Les tokens apparaîtront après la première interaction</p>
            </div>
          )}
        </div>
  );

  // ── Rendu docké (panneau latéral, sans chrome Modal) ────────────────────────
  if (docked) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-base)' }}
        >
          {headerContent}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Fermer"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 py-3">
          {bodyContent}
        </div>
      </div>
    );
  }

  return (
    // Modal handles focus-trap, scroll-lock, Escape, backdrop — no manual useEffect needed
    <Modal open onClose={onClose} size="lg" tone="default">
      <Modal.Header>
        {headerContent}
      </Modal.Header>

      <Modal.Body>
        {bodyContent}
      </Modal.Body>
    </Modal>
  );
}
