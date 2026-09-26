
/**
 * SourcesSummaryCard — Encart de résumé global des sources
 *
 * Affiche un résumé IA combinant toutes les sources du notebook.
 * Se met à jour automatiquement lorsqu'une nouvelle source est ajoutée.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  FileText,
  AlertCircle,
} from 'lucide-react';

import { safeMarkdownParse } from '../../utils/sanitizeMarkdownHtml.js';

interface Props {
  notebookId: string;
  sourcesCount: number;

  /** Utilisé comme signal de rafraîchissement — change quand les sources changent */
  sourcesHash: string;
}

export function SourcesSummaryCard({
  notebookId,
  sourcesCount,
  sourcesHash,
}: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const lastHashRef = useRef<string>('');

  const fetchSummary = useCallback(
    async (forceRefresh = false) => {
      if (sourcesCount === 0) {
        setSummary(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        if (forceRefresh) {
          const deleteRes = await fetch(
            `/api/notebooks/${notebookId}/sources-summary`,
            { method: 'DELETE' },
          );

          if (!deleteRes.ok) {
            throw new Error('Impossible de régénérer le résumé');
          }
        }

        const res = await fetch(
          `/api/notebooks/${notebookId}/sources-summary`,
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({
            error: 'Erreur inconnue',
          }));

          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const data = await res.json();

        setSummary(data.summary);
        lastHashRef.current = sourcesHash;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Une erreur est survenue lors de la génération du résumé';

        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [notebookId, sourcesCount, sourcesHash],
  );

  useEffect(() => {
    if (sourcesCount === 0) {
      setSummary(null);
      return;
    }

    if (lastHashRef.current !== sourcesHash) {
      fetchSummary(lastHashRef.current !== '');
    }
  }, [sourcesHash, sourcesCount, fetchSummary]);

  if (sourcesCount === 0) {
    return null;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.25,
        ease: 'easeOut',
      }}
      className="group relative overflow-hidden rounded-2xl border"
      style={{
        background:
          'linear-gradient(145deg, color-mix(in srgb, var(--bg-panel) 94%, var(--accent-primary) 6%), var(--bg-panel))',
        borderColor:
          'color-mix(in srgb, var(--accent-primary) 16%, transparent)',
        boxShadow:
          '0 8px 30px color-mix(in srgb, var(--accent-primary) 5%, transparent)',
      }}
    >
      {/* Accent lumineux supérieur */}
      <div
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--accent-primary), transparent)',
        }}
      />

      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((value) => !value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((value) => !value);
          }
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.025] cursor-pointer"
        aria-expanded={!collapsed}
      >
        {/* Icône */}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{
            background:
              'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
            border:
              '1px solid color-mix(in srgb, var(--accent-primary) 16%, transparent)',
          }}
        >
          <Sparkles
            className="h-3.5 w-3.5"
            style={{ color: 'var(--accent-primary)' }}
          />
        </div>

        {/* Titre */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[12px] font-semibold tracking-wide"
              style={{ color: 'var(--text-primary)' }}
            >
              Résumé IA
            </span>

            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                color: 'var(--text-muted)',
                background:
                  'color-mix(in srgb, var(--text-primary) 6%, transparent)',
              }}
            >
              {sourcesCount} source{sourcesCount > 1 ? 's' : ''}
            </span>
          </div>

          <p
            className="mt-0.5 truncate text-[10px]"
            style={{ color: 'var(--text-dimmed)' }}
          >
            Synthèse automatique de votre documentation
          </p>
        </div>

        {/* Actions */}
        <div
          className="flex shrink-0 items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {loading && (
            <div
              className="mr-1 flex items-center gap-1.5 rounded-full px-2 py-1"
              style={{
                background:
                  'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
              }}
            >
              <Loader2
                className="h-3 w-3 animate-spin"
                style={{ color: 'var(--accent-primary)' }}
              />
              <span
                className="text-[10px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Mise à jour
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => fetchSummary(true)}
            disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:bg-white/[0.07] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
            title="Régénérer le résumé"
            aria-label="Régénérer le résumé"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              style={{ color: 'var(--text-dimmed)' }}
            />
          </button>

          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{
              color: 'var(--text-dimmed)',
              background:
                'color-mix(in srgb, var(--text-primary) 4%, transparent)',
            }}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </div>
        </div>
      </div>

      {/* Contenu */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: {
                duration: 0.22,
                ease: 'easeOut',
              },
              opacity: {
                duration: 0.15,
              },
            }}
            className="overflow-hidden"
          >
            <div
              className="mx-4 border-t"
              style={{
                borderColor:
                  'color-mix(in srgb, var(--text-primary) 6%, transparent)',
              }}
            />

            <div className="px-4 pb-4 pt-3">
              {/* Génération initiale */}
              {loading && !summary && (
                <div
                  className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-xl"
                  style={{
                    background:
                      'color-mix(in srgb, var(--accent-primary) 4%, transparent)',
                  }}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      background:
                        'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
                    }}
                  >
                    <Sparkles
                      className="h-3.5 w-3.5 animate-pulse"
                      style={{ color: 'var(--accent-primary)' }}
                    />
                  </div>

                  <div className="text-center">
                    <p
                      className="text-[11px] font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Génération du résumé
                    </p>
                    <p
                      className="mt-0.5 text-[10px]"
                      style={{ color: 'var(--text-dimmed)' }}
                    >
                      Analyse de vos {sourcesCount} sources...
                    </p>
                  </div>
                </div>
              )}

              {/* Erreur */}
              {error && (
                <div
                  className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-error) 7%, transparent)',
                    border:
                      '1px solid color-mix(in srgb, var(--color-error) 12%, transparent)',
                  }}
                >
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    style={{ color: 'var(--color-error)' }}
                  />

                  <div className="min-w-0">
                    <p
                      className="text-[10px] font-medium"
                      style={{ color: 'var(--color-error)' }}
                    >
                      Impossible de générer le résumé
                    </p>
                    <p
                      className="mt-0.5 text-[10px] leading-relaxed"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {error}
                    </p>
                  </div>
                </div>
              )}

              {/* Résumé */}
              {summary && (
                <div
                  className="
                    sources-summary-content
                    text-[12px]
                    leading-[1.75]
                  "
                  style={{
                    color: 'var(--text-secondary)',
                  }}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML sanitized with safeMarkdownParse
                  dangerouslySetInnerHTML={{
                    __html: safeMarkdownParse(summary),
                  }}
                />
              )}

              {/* État de mise à jour */}
              {loading && summary && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-3 flex items-center justify-center gap-1.5 border-t pt-2.5"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--text-primary) 5%, transparent)',
                  }}
                >
                  <Loader2
                    className="h-2.5 w-2.5 animate-spin"
                    style={{ color: 'var(--accent-primary)' }}
                  />

                  <span
                    className="text-[10px]"
                    style={{ color: 'var(--text-dimmed)' }}
                  >
                    Actualisation du résumé...
                  </span>
                </motion.div>
              )}

              {/* Footer */}
              {!loading && summary && !error && (
                <div
                  className="mt-3 flex items-center gap-1.5 border-t pt-2.5"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--text-primary) 5%, transparent)',
                  }}
                >
                  <FileText
                    className="h-2.5 w-2.5"
                    style={{ color: 'var(--text-dimmed)' }}
                  />

                  <span
                    className="text-[9px]"
                    style={{ color: 'var(--text-dimmed)' }}
                  >
                    Résumé basé sur {sourcesCount} source
                    {sourcesCount > 1 ? 's' : ''}
                  </span>

                  <span
                    className="ml-auto text-[9px]"
                    style={{ color: 'var(--text-dimmed)' }}
                  >
                    IA
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Styles du Markdown */}
      <style>{`
        .sources-summary-content p {
          margin: 0 0 0.65rem;
        }

        .sources-summary-content p:last-child {
          margin-bottom: 0;
        }

        .sources-summary-content h1,
        .sources-summary-content h2,
        .sources-summary-content h3,
        .sources-summary-content h4 {
          margin: 1rem 0 0.45rem;
          font-weight: 600;
          line-height: 1.35;
          color: var(--text-primary);
        }

        .sources-summary-content h1 {
          font-size: 0.9rem;
        }

        .sources-summary-content h2 {
          font-size: 0.82rem;
        }

        .sources-summary-content h3,
        .sources-summary-content h4 {
          font-size: 0.76rem;
        }

        .sources-summary-content h1:first-child,
        .sources-summary-content h2:first-child,
        .sources-summary-content h3:first-child {
          margin-top: 0;
        }

        .sources-summary-content ul,
        .sources-summary-content ol {
          margin: 0.4rem 0 0.75rem;
          padding-left: 1.2rem;
        }

        .sources-summary-content li {
          margin: 0.25rem 0;
          padding-left: 0.15rem;
        }

        .sources-summary-content strong {
          color: var(--text-primary);
          font-weight: 600;
        }

        .sources-summary-content em {
          color: var(--text-muted);
        }

        .sources-summary-content blockquote {
          margin: 0.7rem 0;
          padding: 0.55rem 0.75rem;
          border-left: 2px solid var(--accent-primary);
          border-radius: 0 0.5rem 0.5rem 0;
          background: color-mix(
            in srgb,
            var(--accent-primary) 5%,
            transparent
          );
          color: var(--text-muted);
        }

        .sources-summary-content code {
          padding: 0.12rem 0.3rem;
          border-radius: 0.3rem;
          background: color-mix(
            in srgb,
            var(--text-primary) 7%,
            transparent
          );
          font-family: var(--font-mono, monospace);
          font-size: 0.9em;
        }

        .sources-summary-content pre {
          margin: 0.7rem 0;
          padding: 0.75rem;
          overflow-x: auto;
          border-radius: 0.65rem;
          background: color-mix(
            in srgb,
            var(--bg-primary) 70%,
            var(--bg-panel) 30%
          );
        }

        .sources-summary-content pre code {
          padding: 0;
          background: transparent;
        }

        .sources-summary-content a {
          color: var(--accent-primary);
          text-decoration: none;
        }

        .sources-summary-content a:hover {
          text-decoration: underline;
        }

        .sources-summary-content hr {
          margin: 0.9rem 0;
          border: 0;
          border-top: 1px solid color-mix(
            in srgb,
            var(--text-primary) 7%,
            transparent
          );
        }

        .sources-summary-content table {
          width: 100%;
          margin: 0.75rem 0;
          border-collapse: collapse;
          font-size: 0.92em;
        }

        .sources-summary-content th,
        .sources-summary-content td {
          padding: 0.45rem 0.55rem;
          text-align: left;
          border-bottom: 1px solid color-mix(
            in srgb,
            var(--text-primary) 7%,
            transparent
          );
        }

        .sources-summary-content th {
          color: var(--text-primary);
          font-weight: 600;
        }
      `}</style>
    </motion.section>
  );
}

