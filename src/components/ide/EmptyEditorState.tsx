import React, {
  useState, useEffect, useMemo, useCallback, useRef,
} from 'react';
import {
  Plus, FolderOpen,
  Search, KeyRound, AlertCircle,
  BookOpen, Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useWorkspaceState } from '../../hooks/useWorkspaceState.js';
import { useLiveAPIContext } from '../../context/LiveAPIContext.js';
import { useProfile } from '../../context/UserProfileContext.js';
import { ShortcutsModal } from './ShortcutsModal.js';
import { SystemModal } from './SystemModal.js';
// @ts-ignore - Asset handled by bundler
import bgVideo from '../../../assets/video.mp4';

// ─── Types ───────────────────────────────────────────────────────────────

// ─── Constantes ──────────────────────────────────────────────────────────

const MOD = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  ? '⌘'
  : 'Ctrl';

const ENTRANCE_SPRING = { type: 'spring' as const, bounce: 0, duration: 0.4 };

// ─── Hook animation lettre par lettre ────────────────────────────────────

function useTypewriter(text: string, active: boolean) {
  const [displayed, setDisplayed] = useState(text);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!active) {
      setDisplayed(text);
      return;
    }

    // Démarre l'animation depuis zéro
    let index = 0;
    setDisplayed('');
    intervalRef.current = setInterval(() => {
      index += 1;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
      }
    }, 28);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, text]);

  const isTyping = active && displayed.length < text.length;
  return { displayed, isTyping };
}

// ─── Validation des fichiers récents ────────────────────────────────────

// ─── Sous‑composants (extraits et memoïsés) ────────────────────────────

const Kbd = React.memo(function Kbd({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'invert';
}) {
  if (tone === 'invert') {
    return (
      <span
        className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1.5 rounded text-xs font-mono font-semibold tracking-wide"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
          color: 'var(--primary)',
        }}
      >
        {children}
      </span>
    );
  }
  return (
    <kbd
      className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1.5 text-xs font-mono font-semibold tracking-wide"
      style={{
        color: 'var(--text-muted)',
        backgroundColor: 'var(--surface-soft)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
      }}
    >
      {children}
    </kbd>
  );
});

const CompactActionCard = React.memo(function CompactActionCard({
  icon: Icon,
  title,
  description,
  shortcut,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  title: string;
  description: string;
  shortcut?: string;
  onClick?: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="ai-interactive ai-compact-card group relative flex flex-col items-center gap-3 p-5 text-center rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        minHeight: '96px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      aria-describedby={`action-desc-${title.replace(/\s/g, '')}`}
      whileHover={{
        y: -4,
        scale: 1.02,
        boxShadow: '0 10px 26px color-mix(in srgb, var(--primary) 14%, transparent)',
        borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)',
      }}
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Hover glow effect */}
      <div
        className="absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100"
        style={{
          background: 'radial-gradient(circle at center, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 70%)',
          transition: 'opacity 0.3s ease',
        }}
      />

      <motion.div
        className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 relative"
        style={{
          backgroundColor: 'var(--surface-soft)',
          border: '1px solid color-mix(in srgb, var(--primary) 12%, transparent)',
        }}
        whileHover={{ scale: 1.1, rotate: 5 }}
        transition={{ duration: 0.2 }}
      >
        <Icon size={16} style={{ color: 'var(--primary)' }} />
        {/* Icon glow on hover */}
        <div
          className="absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100"
          style={{
            boxShadow: 'inset 0 0 10px color-mix(in srgb, var(--primary) 22%, transparent)',
            transition: 'opacity 0.3s ease',
          }}
        />
      </motion.div>

      <div className="flex flex-col items-center gap-1">
        <motion.div
          className="text-sm font-semibold leading-tight"
          style={{ color: 'var(--text)' }}
          whileHover={{ color: 'var(--primary)' }}
          transition={{ duration: 0.2 }}
        >
          {title}
        </motion.div>
        <div
          id={`action-desc-${title.replace(/\s/g, '')}`}
          className="text-xs leading-snug"
          style={{ color: 'var(--text-muted)' }}
        >
          {description}
        </div>
      </div>

      {shortcut && (
        <motion.div
          className="flex-shrink-0 mt-2"
          initial={{ opacity: 0, scale: 0.8 }}
          whileHover={{ scale: 1.05 }}
          transition={{ duration: 0.2 }}
        >
          <Kbd>{shortcut}</Kbd>
        </motion.div>
      )}
    </motion.button>
  );
});

const QuickLink = React.memo(function QuickLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ai-interactive ai-quicklink flex items-center gap-1 px-2 py-1 rounded text-sm font-medium"
      style={{ color: 'var(--text-muted)' }}
    >
      {label}
    </button>
  );
});

// ─── Styles interactifs partagés ───────────────────────────────────────

function GlobalStyles() {
  return (
    <style>{`
      .ai-interactive {
        transition: all 150ms ease-out;
        outline: none;
      }
      .ai-interactive:active {
        transform: scale(0.985);
        transition-duration: 60ms;
      }
      .ai-interactive:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .ai-compact-card:hover {
        border-color: var(--primary);
        box-shadow: 0 6px 16px color-mix(in srgb, var(--primary) 12%, transparent);
        transform: translateY(-1px);
      }

      .ai-hero:hover {
        box-shadow: 0 10px 28px color-mix(in srgb, var(--primary) 16%, transparent);
        transform: translateY(-1px);
      }

      .ai-hero:active {
        transform: translateY(0);
      }

      .ai-quicklink:hover {
        color: var(--primary);
        background-color: var(--surface-soft);
      }

      .ai-status-dot {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      @keyframes blink-cursor {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .ai-interactive:active { transform: none; }
        .ai-status-dot { animation: none; }
      }
    `}</style>
  );
}

// ─── Hook personnalisé pour les fichiers récents ───────────────────────

function useGitInfo() {
  return null; // À remplacer par une vraie implémentation
}

// ─── Hook de piège de focus (pour les modales) ─────────────────────────

function useFocusTrap(isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusable = document.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);
}

// ─── Composant principal ────────────────────────────────────────────────

interface EmptyEditorStateProps {
  onOpenFile: (path: string) => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onShowSettings: (section?: string) => void;
  onOpenSearch?: () => void;
  onOpenChat?: () => void;
  onOpenNotebooks?: () => void;
}

export const EmptyEditorState = React.memo(function EmptyEditorState({
  onOpenFile: _onOpenFile,
  onCreateFile,
  onCreateFolder: _onCreateFolder,
  onShowSettings,
  onOpenSearch,
  onOpenChat,
  onOpenNotebooks,
}: EmptyEditorStateProps) {
  const ws = useWorkspaceState();
  const { connected, isBusy, connect, clearTranscript, clearActivity } = useLiveAPIContext();
  const { profile } = useProfile();
  const prefersReducedMotion = useReducedMotion();

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [ctaHovered, setCtaHovered] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<'configured' | 'invalid' | 'unconfigured' | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch('/api/tokens'), fetch('/api/gemini-keys')])
      .then(async ([tokensResponse, keysResponse]) => [
        await tokensResponse.json(),
        await keysResponse.json(),
      ])
      .then(([tokensData, keysData]) => {
        if (!cancelled && tokensData.status === 'success' && keysData.status === 'success') {
          const geminiToken = tokensData.tokens?.find((token: { key: string; valid: boolean | null }) => token.key === 'GEMINI_API_KEY');
          const hasActivePoolKey = keysData.keys?.some((key: { disabled: boolean }) => !key.disabled);
          setGeminiStatus(
            geminiToken?.valid === false
              ? 'invalid'
              : geminiToken?.configured === true || hasActivePoolKey === true
                ? 'configured'
                : 'unconfigured',
          );
        }
      })
      .catch(() => {
        if (!cancelled) setGeminiStatus(null);
      });
    return () => { cancelled = true; };
  }, []);

  const ctaText = connected
    ? 'Session vocale et texte en cours'
    : 'Parlez, écrivez ou demandez quelque chose à votre assistant IA';
  const { displayed: ctaDisplayed, isTyping: ctaIsTyping } = useTypewriter(ctaText, ctaHovered);

  const gitInfo = useGitInfo();

  // Piège de focus pour les modales
  useFocusTrap(showShortcuts || showSystem);

  const aiName = profile.aiName || 'Leanna';
  const userName = profile.userName || 'Utilisateur';

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return 'Bonne nuit';
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }, []);

  // Props d'entrée avec spring ou fondu selon la motion réduite
  const makeEntranceProps = useCallback(
    (delay = 0) =>
      prefersReducedMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { duration: 0.15, delay },
          }
        : {
            initial: { opacity: 0, y: 10 },
            animate: { opacity: 1, y: 0 },
            transition: { ...ENTRANCE_SPRING, delay },
          },
    [prefersReducedMotion]
  );

  // Démarrage d'une session vierge avec Leanna et ouverture du chat
  const handleConnect = useCallback(() => {
    if (!connected) {
      clearTranscript();
      clearActivity();
      connect([], 'full');
    }
    onOpenChat?.();
  }, [connected, connect, onOpenChat, clearTranscript, clearActivity]);

  // Raccourcis clavier (stabilisés)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onCreateFile();
      }
      if (e.key === ',') {
        e.preventDefault();
        onShowSettings();
      }
      if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleConnect();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCreateFile, onShowSettings, handleConnect]);

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto relative"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <GlobalStyles />

      {/* ── Vidéo de fond ── */}
      <video
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        src={bgVideo}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        style={{ zIndex: 0 }}
      />
      {/* Voile pour garder le contenu lisible par-dessus la vidéo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundColor: 'var(--bg)',
          opacity: 0.4,
          zIndex: 0,
        }}
      />

      {/* ── Fond subtil : dégradé bleu très léger en haut seulement ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, var(--primary) 0%, var(--primary) 12%, transparent 30%)',
          opacity: 0.03,
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 100% 100% at 50% 0%, var(--primary) 0%, transparent 40%)',
          opacity: 0.05,
        }}
      />

      {/* ── Contenu ── */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[1000px]">
          {/* ── NIVEAU 1 : Header avec salutation premium ── */}
          <motion.div 
            className="mb-2 flex items-baseline gap-4"
            {...makeEntranceProps(0)}
          >
            <div className="flex flex-col gap-0">
              <span 
                className="text-sm font-normal"
                style={{ color: 'var(--text-secondary)' }}
              >
                {greeting}
              </span>
              <h1
                className="text-4xl sm:text-5xl font-semibold tracking-[-0.02em] leading-tight"
                style={{ color: 'var(--text)' }}
              >
                {userName}
              </h1>
            </div>

            {/* ── NIVEAU 1 : Statut Leanna discret ── */}
            <div className="flex-1" />
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <span 
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 ai-status-dot"
                style={{
                  backgroundColor: connected ? 'var(--color-success, var(--primary))' : 'var(--text-muted)',
                  boxShadow: connected ? '0 0 6px var(--color-success, var(--primary))' : undefined,
                }}
              />
              <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                {aiName}
              </span>
              <span>
                {connected ? 'Prête' : isBusy ? 'Connexion...' : 'En attente'}
              </span>
            </div>
          </motion.div>

          {/* ── NIVEAU 2 : Sous-titre principal ── */}
          <motion.div 
            className="mb-8"
            {...makeEntranceProps(0.04)}
          >
            <h2 
              className="text-lg sm:text-xl font-normal"
              style={{ color: 'var(--text-secondary)' }}
            >
              Que souhaitez-vous faire aujourd'hui ?
            </h2>
          </motion.div>

          {/* ── NIVEAU 3 : CTA principal - Plus grand et centré avec identité IA ── */}
          <motion.button
            type="button"
            onClick={handleConnect}
            onMouseEnter={() => setCtaHovered(true)}
            onMouseLeave={() => setCtaHovered(false)}
            className="ai-interactive ai-hero group w-full mx-auto flex items-center gap-4 p-6 mb-5 text-left rounded-[22px]"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid color-mix(in srgb, var(--accent-secondary) 55%, transparent)',
              height: '112px',
              minHeight: '112px',
              maxWidth: '600px',
              boxShadow: '0 8px 24px color-mix(in srgb, var(--primary) 14%, transparent)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            {...makeEntranceProps(0.08)}
            aria-label={connected ? 'Ouvrir le chat' : `Démarrer avec ${aiName}`}
            whileHover={{
              scale: 1.02,
              boxShadow: '0 14px 36px color-mix(in srgb, var(--primary) 20%, transparent)',
              borderColor: 'var(--accent-hover)',
            }}
            whileTap={{ scale: 0.98 }}
          >
            {/* Gradient background overlay for depth */}
            <div
              className="absolute inset-0 rounded-[20px] pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 6%, transparent) 0%, color-mix(in srgb, var(--accent-secondary) 4%, transparent) 100%)',
              }}
            />

            <div
              className="w-12 h-12 flex items-center justify-center rounded-xl flex-shrink-0 relative"
              style={{
                backgroundColor: 'var(--surface-soft)',
                border: '1px solid color-mix(in srgb, var(--primary) 18%, transparent)',
              }}
            >
              {/* Animated icon container */}
              <motion.div
                animate={{ rotate: [0, 10, -5, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles size={20} style={{ color: 'var(--primary)' }} />
              </motion.div>
              {/* Subtle glow effect */}
              <div
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  boxShadow: 'inset 0 0 12px color-mix(in srgb, var(--primary) 12%, transparent)',
                }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <motion.div
                className="text-[17px] font-bold leading-tight"
                style={{ color: 'var(--text)' }}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1, duration: 0.3 }}
              >
                {connected ? 'Ouvrir le chat' : `Démarrer avec ${aiName}`}
              </motion.div>
              <motion.div
                className="text-sm mt-1 leading-snug"
                style={{ color: 'var(--text-muted)' }}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
              >
                {ctaDisplayed}
                {ctaIsTyping && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: '1px',
                      height: '0.9em',
                      backgroundColor: 'var(--text-muted)',
                      marginLeft: '1px',
                      verticalAlign: 'text-bottom',
                      animation: 'blink-cursor 0.6s step-end infinite',
                    }}
                  />
                )}
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 500, damping: 25 }}
            >
              <Kbd>{MOD}+L</Kbd>
            </motion.div>
          </motion.button>

          {/* ── NIVEAU 4 : Actions secondaires compactes ── */}
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5"
            {...makeEntranceProps(0.12)}
          >
            <CompactActionCard
              icon={Plus}
              title="Nouveau fichier"
              description="Ctrl+N"
              onClick={onCreateFile}
            />
            <CompactActionCard
              icon={Search}
              title="Rechercher"
              description="Ctrl+P"
              onClick={onOpenSearch}
            />
            <CompactActionCard
              icon={BookOpen}
              title="Notebooks"
              description="Sources et résumés"
              onClick={onOpenNotebooks}
            />
          </motion.div>

          {/* ── NIVEAU 5 : Barre d'info bas ── */}
          <motion.div
            className="flex items-center justify-between mt-8 pt-6"
            style={{ borderTop: '1px solid var(--border)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: prefersReducedMotion ? 0.15 : 0.4 }}
          >
            {/* Workspace info */}
            <div className="flex items-center gap-1.5 text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
              {ws.workspace ? (
                <>
                  <FolderOpen size={11} />
                  {ws.workspace.path.split(/[/\\]/).pop()}
                </>
              ) : (
                <span>Aucun espace de travail ouvert</span>
              )}
            </div>

            {/* Quick links */}
            <div className="flex items-center gap-1">
              {geminiStatus !== 'configured' && (
                <>
                  <button
                    type="button"
                    onClick={() => onShowSettings('tokens-settings')}
                    className="ai-interactive flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium"
                    style={{
                      color: geminiStatus === 'invalid' ? 'var(--color-error)' : 'var(--text-muted)',
                      backgroundColor: 'var(--surface-soft)',
                      border: '1px solid var(--border)',
                    }}
                    title={geminiStatus === 'invalid'
                      ? 'API key not valid. Please pass a valid API key.'
                      : 'Configurer la clé API Gemini'}
                  >
                    {geminiStatus === 'invalid' ? <AlertCircle size={13} /> : <KeyRound size={13} />}
                    <span>
                      Gemini: {geminiStatus === null ? 'Vérification…'
                        : geminiStatus === 'invalid' ? 'Clé invalide' : 'Non configurée'}
                    </span>
                  </button>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                </>
              )}
              <QuickLink label="Raccourcis" onClick={() => setShowShortcuts(true)} />
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <QuickLink label="Système" onClick={() => setShowSystem(true)} />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Modales */}
      <AnimatePresence>
        {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
        {showSystem && (
          <SystemModal
            onClose={() => setShowSystem(false)}
            connected={connected}
            profile={profile}
            gitInfo={gitInfo}
            workspace={ws.workspace}
          />
        )}
      </AnimatePresence>
    </div>
  );
});
