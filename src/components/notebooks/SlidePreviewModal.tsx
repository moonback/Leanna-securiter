/**
 * SlidePreviewModal — Générer et prévisualiser une présentation Reveal.js
 * à partir d'un document Markdown généré dans le notebook.
 *
 * Fonctionnalités :
 * - Sélection du thème (9 thèmes dont Leanna custom)
 * - Sélection de la transition et du ratio
 * - Aperçu live dans un iframe
 * - Téléchargement HTML + ouverture dans un nouvel onglet
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Presentation, Download, ExternalLink,
  Loader2, Monitor, Maximize2, ChevronRight,
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GeneratedDoc {
  id: string;
  type: string;
  title: string;
  content: string;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  notebookId: string;
  doc: GeneratedDoc;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const THEMES = [
  { key: 'Leanna',  label: 'Leanna',  emoji: '🤖', desc: 'Dark bleu/violet custom' },
  { key: 'black',   label: 'Black',   emoji: '⬛', desc: 'Sombre minimaliste' },
  { key: 'white',   label: 'White',   emoji: '⬜', desc: 'Clair et épuré' },
  { key: 'moon',    label: 'Moon',    emoji: '🌙', desc: 'Sombre doux, bleuté' },
  { key: 'league',  label: 'League',  emoji: '🏛️', desc: 'Classique, serif élégant' },
  { key: 'sky',     label: 'Sky',     emoji: '☁️', desc: 'Clair, bleu ciel' },
  { key: 'beige',   label: 'Beige',   emoji: '🟤', desc: 'Naturel, tons chauds' },
  { key: 'serif',   label: 'Serif',   emoji: '📰', desc: 'Typographie classique' },
  { key: 'simple',  label: 'Simple',  emoji: '🔘', desc: 'Sobre et universel' },
] as const;

type ThemeKey = typeof THEMES[number]['key'];

const TRANSITIONS = [
  { key: 'slide',   label: 'Glissement' },
  { key: 'fade',    label: 'Fondu' },
  { key: 'zoom',    label: 'Zoom' },
  { key: 'convex',  label: 'Convexe' },
  { key: 'concave', label: 'Concave' },
  { key: 'none',    label: 'Aucune' },
] as const;

type TransitionKey = typeof TRANSITIONS[number]['key'];

const RATIOS = [
  { key: '16:9', label: '16:9', desc: 'Widescreen' },
  { key: '4:3',  label: '4:3',  desc: 'Standard' },
] as const;

type RatioKey = typeof RATIOS[number]['key'];

const DENSITIES = [
  {
    key: 'compact',
    label: 'Résumé',
    emoji: '⚡',
    desc: '3 pts / slide',
    hint: 'Plus de slides, texte court',
  },
  {
    key: 'normal',
    label: 'Équilibré',
    emoji: '⚖️',
    desc: '4 pts / slide',
    hint: 'Recommandé — découpe auto',
  },
  {
    key: 'detailed',
    label: 'Détaillé',
    emoji: '📋',
    desc: '5 pts / slide',
    hint: 'Contenu complet, plus de slides',
  },
] as const;

type DensityKey = typeof DENSITIES[number]['key'];

// ─── Component ────────────────────────────────────────────────────────────────

export function SlidePreviewModal({ open, onClose, notebookId, doc }: Props) {
  const { error: toastError } = useToast();

  // Options
  const [theme, setTheme]           = useState<ThemeKey>('Leanna');
  const [transition, setTransition] = useState<TransitionKey>('slide');
  const [ratio, setRatio]           = useState<RatioKey>('16:9');
  const [density, setDensity]       = useState<DensityKey>('normal');

  // Generation state
  const [loading, setLoading]       = useState(false);
  const [htmlBlob, setHtmlBlob]     = useState<string | null>(null);
  const [slidesCount, setSlidesCount] = useState<number>(0);
  const [blobUrl, setBlobUrl]       = useState<string | null>(null);

  // Preview panel
  const [showPreview, setShowPreview] = useState(false);
  const prevBlobRef = useRef<string | null>(null);

  // Clean up blob URLs on unmount / change
  useEffect(() => {
    return () => {
      if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
    };
  }, []);

  // Reset when modal opens with a new doc
  useEffect(() => {
    if (open) {
      setHtmlBlob(null);
      setBlobUrl(null);
      setShowPreview(false);
      setSlidesCount(0);
    }
  }, [open, doc.id]);

  // Generate or regenerate presentation
  const handleGenerate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/generated/${doc.id}/slides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, transition, ratio, density }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const html: string = data.html;
      const count: number = data.slidesCount ?? 0;

      // Revoke previous blob URL before creating new one
      if (prevBlobRef.current) {
        URL.revokeObjectURL(prevBlobRef.current);
      }
      const newBlobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      prevBlobRef.current = newBlobUrl;

      setHtmlBlob(html);
      setBlobUrl(newBlobUrl);
      setSlidesCount(count);
      setShowPreview(true);
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setLoading(false);
    }
  }, [notebookId, doc.id, theme, transition, ratio, density, toastError]);

  // Download as .html file
  const handleDownload = useCallback(() => {
    if (!htmlBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([htmlBlob], { type: 'text/html' }));
    a.download = `${doc.title.replace(/[^a-zA-Z0-9\s-]/g, '').trim()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // No revoke — the element is clicked synchronously
  }, [htmlBlob, doc.title]);

  // Open in new tab
  const handleOpenTab = useCallback(() => {
    if (!blobUrl) return;
    window.open(blobUrl, '_blank');
  }, [blobUrl]);

  const accentColor = 'var(--accent-primary)';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="w-full rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
            style={{
              backgroundColor: 'var(--bg-panel)',
              borderColor: 'var(--border-base)',
              maxWidth: showPreview ? '92vw' : '540px',
              maxHeight: '90vh',
              transition: 'max-width 0.3s ease',
            }}
          >
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div
              className="flex items-center gap-3 px-6 py-4 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-base)' }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}30` }}
              >
                <Presentation className="w-4.5 h-4.5" style={{ color: accentColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                  Présentation Reveal.js
                </h3>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-dimmed)' }}>
                  {doc.title}
                  {slidesCount > 0 && (
                    <span
                      className="ml-2 px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
                    >
                      {slidesCount} slides
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors flex-shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Body ───────────────────────────────────────────────────── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* Options sidebar */}
              <div
                className="flex-shrink-0 overflow-y-auto custom-scrollbar"
                style={{
                  width: showPreview ? '280px' : '100%',
                  borderRight: showPreview ? '1px solid var(--border-base)' : 'none',
                  padding: '20px 24px',
                }}
              >
                <div className="space-y-5">

                  {/* Theme selector */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                      Thème
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {THEMES.map(t => (
                        <button
                          key={t.key}
                          onClick={() => setTheme(t.key)}
                          title={t.desc}
                          className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-full text-xs font-medium transition-all"
                          style={{
                            backgroundColor: theme === t.key ? `${accentColor}12` : 'var(--bg-base)',
                            color: theme === t.key ? accentColor : 'var(--text-muted)',
                            border: `1.5px solid ${theme === t.key ? accentColor : 'var(--border-base)'}`,
                          }}
                        >
                          <span className="text-base leading-none">{t.emoji}</span>
                          <span className="font-semibold">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Transition selector */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                      Transition
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {TRANSITIONS.map(t => (
                        <button
                          key={t.key}
                          onClick={() => setTransition(t.key)}
                          className="px-2 py-2 rounded-full text-xs font-medium transition-all text-center"
                          style={{
                            backgroundColor: transition === t.key ? `${accentColor}12` : 'var(--bg-base)',
                            color: transition === t.key ? accentColor : 'var(--text-muted)',
                            border: `1.5px solid ${transition === t.key ? accentColor : 'var(--border-base)'}`,
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ratio selector */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                      Format
                    </p>
                    <div className="flex gap-2">
                      {RATIOS.map(r => (
                        <button
                          key={r.key}
                          onClick={() => setRatio(r.key)}
                          className="flex-1 flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-full text-xs font-medium transition-all"
                          style={{
                            backgroundColor: ratio === r.key ? `${accentColor}12` : 'var(--bg-base)',
                            color: ratio === r.key ? accentColor : 'var(--text-muted)',
                            border: `1.5px solid ${ratio === r.key ? accentColor : 'var(--border-base)'}`,
                          }}
                        >
                          <Monitor className="w-3.5 h-3.5 mb-0.5" />
                          <span className="font-bold">{r.label}</span>
                          <span className="text-xs opacity-60">{r.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Density selector */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                      Densité du contenu
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {DENSITIES.map(d => (
                        <button
                          key={d.key}
                          onClick={() => setDensity(d.key)}
                          title={d.hint}
                          className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-full text-xs font-medium transition-all"
                          style={{
                            backgroundColor: density === d.key ? `${accentColor}12` : 'var(--bg-base)',
                            color: density === d.key ? accentColor : 'var(--text-muted)',
                            border: `1.5px solid ${density === d.key ? accentColor : 'var(--border-base)'}`,
                          }}
                        >
                          <span className="text-base leading-none">{d.emoji}</span>
                          <span className="font-semibold">{d.label}</span>
                          <span className="text-xs opacity-60 text-center leading-tight">{d.desc}</span>
                        </button>
                      ))}
                    </div>
                    {density === 'compact' && (
                      <p className="text-xs px-2 py-1.5 rounded-full" style={{ backgroundColor: `${accentColor}10`, color: accentColor, border: `1px solid ${accentColor}25` }}>
                        💡 Le contenu est découpé en plusieurs slides — rien n&apos;est masqué ni supprimé.
                      </p>
                    )}
                  </div>

                  {/* Note about excluded types */}
                  {(doc.type === 'infographic' || doc.type === 'mindmap') && (
                    <p
                      className="text-xs px-3 py-2 rounded-full leading-relaxed"
                      style={{ backgroundColor: 'var(--color-warning)10', color: 'var(--color-warning)', border: '1px solid var(--color-warning)30' }}
                    >
                      ⚠️ Ce type de document peut produire des slides limitées. Les types Résumé, FAQ, Rapport donnent de meilleurs résultats.
                    </p>
                  )}

                </div>
              </div>

              {/* Preview panel */}
              <AnimatePresence>
                {showPreview && blobUrl && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: '100%' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="flex-1 flex flex-col min-w-0 overflow-hidden"
                    style={{ minHeight: '420px' }}
                  >
                    {/* Preview toolbar */}
                    <div
                      className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
                      style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
                    >
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                        APERÇU
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleOpenTab}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all hover:bg-white/5 active:scale-95"
                          style={{ border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}
                          title="Ouvrir en plein écran dans un nouvel onglet"
                        >
                          <Maximize2 className="w-3 h-3" />
                          Plein écran
                        </button>
                      </div>
                    </div>

                    {/* iFrame */}
                    <div className="flex-1 relative bg-black">
                      <iframe
                        key={blobUrl}
                        src={blobUrl}
                        className="absolute inset-0 w-full h-full border-0"
                        title="Aperçu présentation Reveal.js"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <div
              className="flex items-center justify-between gap-3 px-6 py-4 border-t flex-shrink-0"
              style={{ borderColor: 'var(--border-base)' }}
            >
              {/* Left — secondary actions (visible once generated) */}
              <div className="flex items-center gap-2">
                {htmlBlob && (
                  <>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all hover:bg-white/5 active:scale-95"
                      style={{ border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}
                      title="Télécharger le fichier HTML"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Télécharger HTML
                    </button>
                    <button
                      onClick={handleOpenTab}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all hover:bg-white/5 active:scale-95"
                      style={{ border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}
                      title="Ouvrir dans un nouvel onglet"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Ouvrir
                    </button>
                  </>
                )}
              </div>

              {/* Right — cancel + generate */}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-full text-xs font-medium transition-all hover:bg-white/5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Fermer
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: accentColor, color: 'white' }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Génération…
                    </>
                  ) : htmlBlob ? (
                    <>
                      <Presentation className="w-3.5 h-3.5" />
                      Régénérer
                      <ChevronRight className="w-3 h-3 opacity-70" />
                    </>
                  ) : (
                    <>
                      <Presentation className="w-3.5 h-3.5" />
                      Générer les slides
                      <ChevronRight className="w-3 h-3 opacity-70" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
