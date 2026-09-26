import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Code2, BookOpen, ArrowRight, Sparkles } from 'lucide-react';

/**
 * LauncherModal — écran de choix affiché au démarrage (après le splash).
 *
 * Laisse l'utilisateur choisir entre :
 *   - Ouvrir l'IDE       → navigue vers /ide
 *   - Ouvrir un Notebook → navigue vers /notebooks
 *
 * Le choix est mémorisé pour la session (sessionStorage) afin de ne pas
 * réafficher l'écran à chaque navigation ou rechargement de route interne.
 */

/** Clé sessionStorage : le launcher a déjà été traité pour cette session. */
const LAUNCHER_DONE_KEY = 'Leanna-launcher-done';
/** Clé partagée avec StartupProjectModal — mode "sans projet" (pas de sélection de workspace). */
const NO_WORKSPACE_KEY = 'Leanna-no-workspace-mode';

const OVERLAY_FADE = { duration: 0.2 };
const CARD_SPRING = { type: 'spring' as const, bounce: 0, duration: 0.35 };

export function LauncherModal() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // N'afficher qu'une seule fois par session, et uniquement au tout début
    // (route racine ou /ide, qui est la cible du redirect par défaut).
    if (sessionStorage.getItem(LAUNCHER_DONE_KEY) === '1') {
      setIsOpen(false);
      return;
    }
    if (pathname === '/' || pathname === '/ide') {
      setIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Permet de rouvrir le launcher à la demande depuis n'importe où
  // (ex: bouton "retour au sélecteur" dans la vue Notebooks).
  useEffect(() => {
    const handleReopen = () => setIsOpen(true);
    window.addEventListener('Leanna-open-launcher', handleReopen);
    return () => window.removeEventListener('Leanna-open-launcher', handleReopen);
  }, []);

  const choose = useCallback(
    (target: '/ide' | '/notebooks') => {
      sessionStorage.setItem(LAUNCHER_DONE_KEY, '1');

      if (target === '/notebooks') {
        // Les notebooks n'ont pas besoin d'un workspace : activer le mode
        // "sans projet" pour empêcher StartupProjectModal de s'ouvrir par-dessus,
        // et aller directement à la vue Notebooks.
        sessionStorage.setItem(NO_WORKSPACE_KEY, '1');
        window.dispatchEvent(new CustomEvent('Leanna-no-workspace-mode'));
        setIsOpen(false);
        navigate('/notebooks');
        return;
      }

      // Pour l'IDE : ouvrir le sélecteur de workspace (StartupProjectModal).
      // On lève le mode "sans projet" et on demande explicitement l'ouverture
      // du sélecteur, même si un workspace est déjà actif.
      sessionStorage.removeItem(NO_WORKSPACE_KEY);
      setIsOpen(false);
      navigate('/ide');
      window.dispatchEvent(new CustomEvent('Leanna-open-workspace-switcher'));
    },
    [navigate],
  );

  if (!isOpen) return null;

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
        className="fixed inset-0 z-[100000] flex items-center justify-center p-3"
        style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <motion.div
          {...cardMotionProps}
          transition={CARD_SPRING}
          role="dialog"
          aria-modal="true"
          aria-labelledby="launcher-title"
          className="w-[calc(100%-24px)] max-w-5xl rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-base)',
            boxShadow: '0 24px 80px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent)',
              }}
            >
              <Sparkles className="w-5 h-5" style={{ color: 'var(--accent-secondary)' }} />
            </div>
            <div>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1"
                style={{ color: 'var(--accent-primary)' }}
              >
                Bienvenue
              </p>
              <h2
                id="launcher-title"
                className="text-lg font-bold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Que souhaitez-vous ouvrir ?
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Choisissez votre espace de travail pour commencer.
              </p>
            </div>
          </div>

          {/* Choix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LauncherCard
              icon={<Code2 className="w-5 h-5" />}
              title="Ouvrir l'IDE"
              description="Éditeur de code, terminal, agents et outils de développement."
              onClick={() => choose('/ide')}
              reduceMotion={!!shouldReduceMotion}
            />
            <LauncherCard
              icon={<BookOpen className="w-5 h-5" />}
              title="Ouvrir un Notebook"
              description="Sources, notes, chat documentaire et génération de contenu."
              onClick={() => choose('/notebooks')}
              reduceMotion={!!shouldReduceMotion}
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function LauncherCard({
  icon,
  title,
  description,
  onClick,
  reduceMotion,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  reduceMotion: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
      className="group flex flex-col items-start gap-3 p-5 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-base)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-primary)';
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary))';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-base)';
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-secondary)';
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
          color: 'var(--accent-secondary)',
          border: '1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent)',
        }}
      >
        {icon}
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          <ArrowRight
            className="w-4 h-4 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0"
            style={{ color: 'var(--accent-primary)' }}
          />
        </div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      </div>
    </motion.button>
  );
}
