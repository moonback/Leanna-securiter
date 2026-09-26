import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Loader2, CheckCircle2, Database, Network, GitBranch,
  FileSearch, Sparkles,
} from 'lucide-react';

/**
 * IndexingOverlay — plein écran, fixe et bloquant, affiché pendant que le
 * projet nouvellement ouvert est indexé (ProjectIndexer → KnowledgeGraph →
 * DependencyGraph).
 *
 * Cycle de vie :
 *  1. `Leanna-workspace-changed` (avec un workspace non nul) → état "préparation".
 *     L'endpoint /api/self-root/change répond AVANT que l'indexation ne commence
 *     à streamer, donc on affiche immédiatement un état d'attente.
 *  2. `Leanna-knowledge-progress` (phase parse/incremental/relations/ast) →
 *     barre de progression + fichier courant.
 *  3. `Leanna-knowledge-progress` (phase 'done') → écran de succès bref, puis
 *     l'overlay se ferme.
 *
 * Payload de l'événement (voir server/utils/knowledgeBroadcaster.ts) :
 *   { phase, current, total, file?, cached?, totalEntities?, durationMs? }
 */

type Phase = 'preparing' | 'incremental' | 'parse' | 'ast' | 'relations' | 'done';

interface ProgressDetail {
  phase: Phase;
  current: number;
  total: number;
  file?: string;
  cached?: boolean;
  totalEntities?: number;
  durationMs?: number;
}

interface PhaseMeta {
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

const PHASE_META: Record<Phase, PhaseMeta> = {
  preparing: {
    label: 'Préparation du workspace',
    hint: 'Chargement du graphe de connaissances…',
    icon: Database,
  },
  incremental: {
    label: 'Mise à jour incrémentale',
    hint: 'Analyse des fichiers modifiés…',
    icon: FileSearch,
  },
  parse: {
    label: 'Indexation du projet',
    hint: 'Analyse des fichiers et extraction des entités…',
    icon: FileSearch,
  },
  ast: {
    label: 'Analyse syntaxique (AST)',
    hint: 'Construction du graphe d’appels…',
    icon: Network,
  },
  relations: {
    label: 'Extraction des relations',
    hint: 'Construction du graphe de dépendances…',
    icon: GitBranch,
  },
  done: {
    label: 'Indexation terminée',
    hint: 'Le projet est prêt.',
    icon: CheckCircle2,
  },
};

/** Ordre logique des phases pour la barre d'étapes. */
const STEP_ORDER: Phase[] = ['parse', 'ast', 'relations', 'done'];

const OVERLAY_FADE = { duration: 0.2 };
const CARD_SPRING = { type: 'spring' as const, bounce: 0, duration: 0.35 };

function truncateMiddle(str: string, max = 52): string {
  if (str.length <= max) return str;
  const half = Math.floor((max - 1) / 2);
  return `${str.slice(0, half)}…${str.slice(str.length - half)}`;
}

export function IndexingOverlay() {
  const shouldReduceMotion = useReducedMotion();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState<ProgressDetail>({
    phase: 'preparing',
    current: 0,
    total: 0,
  });

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Filet de sécurité : si aucun événement de progression n'arrive après
  // l'ouverture du workspace (ex. projet vide), on ferme automatiquement.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
  }, []);

  const armIdleGuard = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    // Si aucun événement de progression ni "done" en 12 s, on referme.
    idleTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, 12000);
  }, []);

  // ── Déclenchement : ouverture d'un nouveau workspace ────────────────────────
  useEffect(() => {
    const onWorkspaceChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { workspace?: string | null } | undefined;
      // workspace === null → fermeture/désactivation : ne pas afficher.
      if (!detail || detail.workspace == null) return;

      clearTimers();
      setProgress({ phase: 'preparing', current: 0, total: 0 });
      setVisible(true);
      armIdleGuard();
    };

    window.addEventListener('Leanna-workspace-changed', onWorkspaceChanged as EventListener);
    return () => {
      window.removeEventListener('Leanna-workspace-changed', onWorkspaceChanged as EventListener);
    };
  }, [clearTimers, armIdleGuard]);

  // ── Progression de l'indexation ─────────────────────────────────────────────
  useEffect(() => {
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail as Partial<ProgressDetail> | undefined;
      if (!d || !d.phase) return;

      // Un événement de progression arrive → on est bien dans un cycle d'indexation.
      setVisible(true);

      if (d.phase === 'done') {
        clearTimers();
        setProgress({
          phase: 'done',
          current: d.current ?? 0,
          total: d.total ?? d.current ?? 0,
          totalEntities: d.totalEntities,
          durationMs: d.durationMs,
          cached: d.cached,
        });
        // Laisser le succès visible brièvement, puis fermer.
        closeTimerRef.current = setTimeout(() => {
          setVisible(false);
          closeTimerRef.current = null;
        }, d.cached ? 900 : 1600);
        return;
      }

      // Phase active : réarmer le filet de sécurité et mettre à jour l'état.
      armIdleGuard();
      setProgress({
        phase: d.phase,
        current: d.current ?? 0,
        total: d.total ?? 0,
        file: d.file,
      });
    };

    window.addEventListener('Leanna-knowledge-progress', onProgress as EventListener);
    return () => {
      window.removeEventListener('Leanna-knowledge-progress', onProgress as EventListener);
    };
  }, [clearTimers, armIdleGuard]);

  // Nettoyage des timers au démontage.
  useEffect(() => () => clearTimers(), [clearTimers]);

  if (!visible) return null;

  const meta = PHASE_META[progress.phase] ?? PHASE_META.preparing;
  const Icon = meta.icon;

  const isDone = progress.phase === 'done';
  const isPreparing = progress.phase === 'preparing';
  const hasTotal = progress.total > 0;
  const pct = hasTotal
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : null;

  // Étape courante pour la mini-timeline (preparing/incremental → assimilés à parse).
  const currentStepIndex = (() => {
    if (isDone) return STEP_ORDER.length - 1;
    if (progress.phase === 'relations') return STEP_ORDER.indexOf('relations');
    if (progress.phase === 'ast') return STEP_ORDER.indexOf('ast');
    return STEP_ORDER.indexOf('parse');
  })();

  const cardMotionProps = shouldReduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { scale: 0.96, y: 12 }, animate: { scale: 1, y: 0 }, exit: { scale: 0.96, y: 12 } };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={OVERLAY_FADE}
        className="fixed inset-0 z-[100000] flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(14px)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="indexing-overlay-title"
        aria-busy={!isDone}
      >
        <motion.div
          {...cardMotionProps}
          transition={CARD_SPRING}
          className="w-[calc(100%-32px)] max-w-md rounded-2xl p-6 shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-base)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          }}
        >
          {/* Icône d'état */}
          <div className="flex items-center gap-3 mb-5">
            <div
              className="relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: isDone
                  ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                  : 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
                border: `1px solid ${isDone
                  ? 'color-mix(in srgb, var(--color-success) 34%, transparent)'
                  : 'color-mix(in srgb, var(--accent-secondary) 30%, transparent)'}`,
              }}
            >
              {isDone ? (
                <CheckCircle2 className="w-6 h-6" style={{ color: 'var(--color-success)' }} />
              ) : (
                <Icon className="w-6 h-6" style={{ color: 'var(--accent-secondary)' }} />
              )}
              {!isDone && (
                <span className="absolute -bottom-1 -right-1">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.16em] mb-0.5"
                style={{ color: 'var(--accent-primary)' }}
              >
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Knowledge System
                </span>
              </p>
              <h2
                id="indexing-overlay-title"
                className="text-base font-bold tracking-tight truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {meta.label}
              </h2>
            </div>
          </div>

          {/* Barre de progression */}
          <div className="mb-4">
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: isDone
                    ? 'var(--color-success)'
                    : 'linear-gradient(90deg, var(--accent-secondary), var(--accent-primary))',
                }}
                initial={false}
                animate={{
                  width: isDone ? '100%' : pct !== null ? `${pct}%` : '35%',
                }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                // Barre indéterminée (pulse) quand aucun total n'est connu.
                {...(!isDone && pct === null && !shouldReduceMotion
                  ? { animate: { opacity: [0.5, 1, 0.5], width: '35%' }, transition: { repeat: Infinity, duration: 1.4 } }
                  : {})}
              />
            </div>

            <div className="flex items-center justify-between mt-2">
              <p className="text-xs truncate pr-2" style={{ color: 'var(--text-muted)' }}>
                {meta.hint}
              </p>
              {pct !== null && !isDone && (
                <span
                  className="text-xs font-semibold font-mono flex-shrink-0"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {pct}%
                </span>
              )}
            </div>
          </div>

          {/* Compteur de fichiers + fichier courant */}
          {!isDone && (
            <div
              className="rounded-xl border p-3 mb-4 min-h-[52px]"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-base)' }}
            >
              {hasTotal && (
                <p className="text-[11px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {progress.current} / {progress.total} fichiers
                </p>
              )}
              <p
                className="text-[11px] font-mono truncate"
                style={{ color: 'var(--text-dimmed)' }}
                title={progress.file}
              >
                {progress.file
                  ? truncateMiddle(progress.file)
                  : isPreparing
                    ? 'Initialisation…'
                    : '\u00A0'}
              </p>
            </div>
          )}

          {/* Résumé de fin */}
          {isDone && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border p-3 mb-4 text-xs"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-success) 8%, var(--bg-secondary))',
                borderColor: 'color-mix(in srgb, var(--color-success) 30%, var(--border-base))',
                color: 'var(--text-secondary)',
              }}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {progress.total || progress.current} fichiers indexés
                </span>
                {typeof progress.totalEntities === 'number' && (
                  <span>{progress.totalEntities} entités</span>
                )}
                {typeof progress.durationMs === 'number' && (
                  <span>{(progress.durationMs / 1000).toFixed(1)}s</span>
                )}
                {progress.cached && (
                  <span style={{ color: 'var(--accent-primary)' }}>· cache réutilisé</span>
                )}
              </div>
            </motion.div>
          )}

          {/* Mini-timeline des étapes */}
          <div className="flex items-center gap-1.5">
            {STEP_ORDER.map((step, i) => {
              const reached = i <= currentStepIndex;
              const active = i === currentStepIndex && !isDone;
              return (
                <div key={step} className="flex-1">
                  <div
                    className="h-1 rounded-full transition-colors"
                    style={{
                      backgroundColor: reached
                        ? (isDone ? 'var(--color-success)' : 'var(--accent-primary)')
                        : 'var(--border-base)',
                      opacity: active ? 0.7 : 1,
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Note : bloquant, pas de bouton de fermeture pendant l'indexation */}
          <p
            className="text-[10px] text-center mt-4"
            style={{ color: 'var(--text-dimmed)' }}
          >
            {isDone
              ? 'Ouverture du projet…'
              : 'Merci de patienter — cette étape ne prend généralement que quelques secondes.'}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
