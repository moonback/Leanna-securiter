import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Hash, TrendingUp, ArrowUp, ArrowDown, Clock, Sparkles, AlertTriangle, Gauge, Zap } from 'lucide-react';
import { useLiveAPIContext } from '../context/LiveAPIContext.js';
import { useProfile } from '../context/UserProfileContext.js';
import { useToast } from '../components/ui/Toast.js';
import type { TokenUsage } from '../hooks/useLiveAPI.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'à l\'instant';
  if (seconds < 60) return `il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `il y a ${minutes}min`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Compteur de tokens affiché dans la ControlBar.
 * Au clic, affiche un détail des dernières requêtes + optimisations.
 *
 * Motion notes (Apple "Designing Fluid Interfaces" translated to web):
 * - The dropdown is a floating material anchored to the badge that opens it
 *   (transform-origin: bottom center), so it visibly grows from its source
 *   and collapses back into it — same path in, same path out.
 * - It opens/closes on a critically-damped spring (no bounce): this is a
 *   menu appearing, not something thrown by a gesture, so overshoot would
 *   read as noise rather than physicality.
 * - `prefers-reduced-motion` swaps the spring for a plain opacity cross-fade.
 */
export function TokenCounter() {
  const { tokenUsage } = useLiveAPIContext();
  const { profile, setField, save } = useProfile();
  const [open, setOpen] = useState(false);
  const [optimization, setOptimization] = useState<OptimizationData | null>(null);
  const [loadingOpt, setLoadingOpt] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const { error: toastError } = useToast();

  // Fermer au clic extérieur
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Fermer avec Échap — l'utilisateur garde le contrôle au clavier
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Charger les stats d'optimisation quand on ouvre le dropdown
  const loadOptimization = useCallback(async () => {
    setLoadingOpt(true);
    try {
      const res = await fetch('/api/tokens/optimization');
      const data = await res.json();
      if (data.status === 'success') {
        setOptimization(data.optimization);
      }
    } catch (e) {
      toastError('Impossible de charger les stats d\'optimisation');
      console.error('Erreur lors du chargement des stats d\'optimisation:', e);
    } finally {
      setLoadingOpt(false);
    }
  }, [toastError]);

  useEffect(() => {
    if (open) loadOptimization();
  }, [open, loadOptimization]);

  const { totalTokens, totalPromptTokens, totalCompletionTokens, history } = tokenUsage;
  const lastUsage = history.length > 0 ? history[history.length - 1] : null;

  // Déclencher l'animation au changement de totalTokens
  useEffect(() => {
    if (totalTokens > 0) {
      setAnimate(true);
      const timer = setTimeout(() => setAnimate(false), 300);
      return () => clearTimeout(timer);
    }
  }, [totalTokens]);

  // Spring "matériau" : la surface translucide grandit ET se voile en même
  // temps, plutôt qu'un simple fondu — elle doit se sentir arriver comme un
  // vrai objet, pas comme une opacité qui change.
  const panelMotionProps = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15, ease: 'easeOut' as const },
      }
    : {
        initial: { opacity: 0, scale: 0.92, filter: 'blur(6px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, scale: 0.94, filter: 'blur(4px)' },
        transition: { type: 'spring' as const, damping: 1, duration: 0.32 },
      };

  return (
    <div ref={ref} className="relative">
      {/* Badge principal */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`px-2.5 py-1.5 rounded-xl text-sm font-semibold tracking-wide select-none flex items-center gap-1.5 cursor-pointer transition-all duration-200 active:scale-95 ${animate ? 'scale-110 shadow-orange-200' : 'hover:scale-105'}`}
        style={{
          background: totalTokens > 0
            ? 'linear-gradient(135deg, rgba(251,146,60,0.08), rgba(251,146,60,0.15))'
            : 'linear-gradient(135deg, rgba(0,0,0,0.03), rgba(0,0,0,0.06))',
          color: totalTokens > 0 ? 'var(--color-warning)' : 'rgba(0,0,0,0.45)',
          border: `1px solid ${totalTokens > 0 ? 'rgba(251,146,60,0.2)' : 'rgba(0,0,0,0.06)'}`,
          boxShadow: totalTokens > 0 ? '0 2px 8px rgba(251,146,60,0.08)' : 'none',
        }}
        title={`Jetons utilisés : ${totalTokens.toLocaleString()}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Hash className="w-3 h-3" />
        <span className="font-bold tabular-nums">{formatNumber(totalTokens)}</span>
        {lastUsage && (
          <span className="text-xs opacity-60">
            (+{formatNumber(lastUsage.totalTokens)})
          </span>
        )}
      </button>

      {/* Dropdown détail */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-72 rounded-2xl overflow-hidden z-50"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.92))',
              border: '1px solid rgba(255,255,255,0.6)',
              backdropFilter: 'blur(24px)',
              boxShadow: '0 25px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
              transformOrigin: 'bottom center', // grandit depuis le badge qui l'a ouvert
            }}
            {...panelMotionProps}
            role="dialog"
            aria-label="Détail de l'utilisation des tokens"
          >
            {/* Header résumé */}
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest text-gray-400">Tokens session</p>
                  <p className="text-lg font-black text-gray-800 tabular-nums leading-tight">
                    {totalTokens.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Stats prompt / completion */}
              <div className="grid grid-cols-2 gap-2">
                <div className="px-3 py-2 rounded-xl bg-blue-50/60">
                  <div className="flex items-center gap-1 text-blue-600 mb-0.5">
                    <ArrowUp className="w-3 h-3" />
                    <span className="text-xs font-bold uppercase tracking-wider">Prompt</span>
                  </div>
                  <p className="text-sm font-bold text-blue-800 tabular-nums">
                    {formatNumber(totalPromptTokens)}
                  </p>
                </div>
                <div className="px-3 py-2 rounded-xl bg-emerald-50/60">
                  <div className="flex items-center gap-1 text-emerald-600 mb-0.5">
                    <ArrowDown className="w-3 h-3" />
                    <span className="text-xs font-bold uppercase tracking-wider">Réponse</span>
                  </div>
                  <p className="text-sm font-bold text-emerald-800 tabular-nums">
                    {formatNumber(totalCompletionTokens)}
                  </p>
                </div>
              </div>
            </div>

            {/* Historique des dernières requêtes */}
            {history.length > 0 && (
              <div className="px-4 pt-2 pb-3 border-t border-gray-100/80">
                <p className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Dernières requêtes ({history.length})
                </p>
                <div className="max-h-36 overflow-y-auto space-y-1 scrollbar-thin pr-1">
                  {[...history].reverse().slice(0, 20).map((usage, i) => (
                    <TokenUsageRow key={i} usage={usage} />
                  ))}
                </div>
              </div>
            )}

            {/* Aucune donnée */}
            {history.length === 0 && (
              <div className="px-4 pb-4 text-center">
                <p className="text-xs text-gray-400">Aucune requête enregistrée</p>
                <p className="text-sm text-gray-300 mt-0.5">Les tokens apparaîtront après la première interaction</p>
              </div>
            )}

            {/* Section Optimisation */}
            <div className="px-4 pt-2 pb-3 border-t border-gray-100/80">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <p className="text-sm font-bold uppercase tracking-widest text-gray-400">Optimisation</p>
              </div>

              {loadingOpt && (
                <p className="text-xs text-gray-400 animate-pulse">Analyse en cours...</p>
              )}

              {optimization && !loadingOpt && (
                <div className="space-y-2">
                  {/* Jauge d'utilisation du contexte */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500 flex items-center gap-1">
                        <Gauge className="w-3 h-3" /> Contexte de base
                      </span>
                      <span className="font-bold text-gray-700 tabular-nums">
                        {formatNumber(optimization.totalBaseTokens)} / {formatNumber(optimization.modelBudget.maxTotal)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          background: optimization.totalBaseTokens / optimization.modelBudget.maxTotal > 0.7
                            ? 'linear-gradient(90deg, var(--color-warning), var(--color-error))'
                            : 'linear-gradient(90deg, var(--color-success), var(--accent-secondary))',
                        }}
                        initial={false}
                        animate={{
                          width: `${Math.min(100, (optimization.totalBaseTokens / optimization.modelBudget.maxTotal) * 100)}%`,
                        }}
                        transition={
                          prefersReducedMotion
                            ? { duration: 0.15 }
                            : { type: 'spring', damping: 1, duration: 0.5 }
                        }
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-400">
                      <span>Prompt: {formatNumber(optimization.systemPromptTokens)}</span>
                      <span>Mémoire: {formatNumber(optimization.memoryTokens)}</span>
                      <span>Dispo: {formatNumber(optimization.availableForConversation)}</span>
                    </div>

                    {/* Économies affichées si mode compact actif */}
                    {optimization.compactEnabled && optimization.savedTokens && optimization.savedTokens > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 text-xs text-emerald-700 bg-emerald-50/80 px-2 py-1 rounded-md">
                        <Zap className="w-2.5 h-2.5" />
                        <span className="font-semibold">−{formatNumber(optimization.savedTokens)} tokens économisés (compact)</span>
                      </div>
                    )}
                  </div>

                  {/* Suggestions */}
                  {optimization.suggestions.length > 0 && (
                    <div className="space-y-1">
                      {optimization.suggestions.map((s, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-1.5 text-sm text-amber-700 bg-amber-50/60 px-2 py-1.5 rounded-lg"
                        >
                          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {optimization.suggestions.length === 0 && (
                    <div className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50/60 px-2 py-1.5 rounded-lg">
                      <Sparkles className="w-3 h-3" />
                      <span>Utilisation optimale des tokens</span>
                    </div>
                  )}

                  {/* Toggle mode compact */}
                  <button
                    type="button"
                    onClick={() => {
                      setField('compactPrompt', !profile.compactPrompt);
                      setTimeout(() => { save(); loadOptimization(); }, 100);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer mt-1 active:scale-[0.98] ${
                      profile.compactPrompt
                        ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                        : 'bg-gray-50/80 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />
                      Mode compact (−40% tokens prompt)
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold uppercase ${
                      profile.compactPrompt ? 'bg-emerald-200 text-emerald-900' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {profile.compactPrompt ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Row d'historique ────────────────────────────────────────────────────────

function TokenUsageRow({ usage }: { usage: TokenUsage }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50/80 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-blue-600 font-medium tabular-nums">
            ↑{formatNumber(usage.promptTokens)}
          </span>
          <span className="text-emerald-600 font-medium tabular-nums">
            ↓{formatNumber(usage.completionTokens)}
          </span>
          <span className="text-gray-800 font-bold tabular-nums">
            Σ{formatNumber(usage.totalTokens)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
        <Clock className="w-2.5 h-2.5" />
        {timeAgo(usage.timestamp)}
      </div>
    </div>
  );
}