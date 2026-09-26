import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Box, RefreshCw, Upload, Trash2, Loader2, CheckCircle2,
  XCircle, Power, Lock, ShieldCheck, ShieldOff,
  GitCompareArrows, FileCode2,
  ChevronDown, RotateCcw, X, FolderOpen, Clock, Sparkles,
} from 'lucide-react';
import { useSandboxWatcher } from '../../hooks/useSandboxWatcher.js';

interface SandboxStatus {
  active: boolean;
  path: string;
  modifiedFiles: string[];
  modifiedCount: number;
  lastSync: string | null;
  exists: boolean;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

interface SandboxPanelProps {
  onOpenDiff: (initialFile: string | null) => void;
}

/**
 * SandboxPanel — Panneau de contrôle du workspace sandbox.
 *
 * Refonte : disposition en sections claires (état → actions → détails),
 * hiérarchie visuelle marquée, primitives cohérentes (SectionCard, StatChip,
 * ActionRow, PrimaryAction) et mouvement critically-damped aligné sur le reste
 * de l'app. Uniquement des design tokens — aucune couleur en dur.
 */
export function SandboxPanel({ onOpenDiff }: SandboxPanelProps) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [securityCode, setSecurityCode] = useState('');
  const [showResetCodeInput, setShowResetCodeInput] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const codeInputRef = useRef<HTMLInputElement>(null);
  const resetCodeRef = useRef<HTMLInputElement>(null);
  const hasFetched = useRef(false);
  const [showModifiedFiles, setShowModifiedFiles] = useState(false);
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  // Progression de la réinitialisation du sandbox (0 → 100).
  const [resetProgress, setResetProgress] = useState(0);
  const resetProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Motion : spring critically-damped par défaut, fondu court si l'utilisateur
  // a demandé moins de mouvement — même convention que NotebookDetail /
  // GeneratePanel, pour une texture de mouvement cohérente dans toute l'app.
  const reduceMotion = useReducedMotion();
  const spring = reduceMotion
    ? { duration: 0.15, ease: 'easeOut' as const }
    : { type: 'spring' as const, bounce: 0, duration: 0.3 };
  const hoverSpring = reduceMotion
    ? { duration: 0.1 }
    : { type: 'spring' as const, stiffness: 400, damping: 25 };

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sandbox/status', { headers: authHeaders() });
      const data = await res.json();
      if (data.status === 'success') setStatus(data.sandbox);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (showCodeInput && codeInputRef.current) {
      codeInputRef.current.focus();
      return;
    }
    if (showResetCodeInput && resetCodeRef.current) {
      resetCodeRef.current.focus();
    }
  }, [showCodeInput, showResetCodeInput]);

  useSandboxWatcher({
    enabled: status?.active ?? false,
    onFileChanged: useCallback((_rp: string) => {
      fetchStatus();
    }, [fetchStatus]),
    onTreeChanged: useCallback(() => {
      fetchStatus();
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
    }, [fetchStatus]),
    onFileDeleted: useCallback((_rp: string) => {
      fetchStatus();
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
    }, [fetchStatus]),
  });

  const doAction = useCallback(async (action: string, method = 'POST', body?: object) => {
    setBusy(action);
    setFeedback(null);

    // Barre de progression uniquement pour la réinitialisation, qui peut être
    // longue (copie fraîche du code source). La route ne streame pas
    // d'avancement : on simule une montée fluide jusqu'à ~90% puis on complète
    // à 100% une fois la réponse reçue.
    const isReset = action === 'reset';
    const stopResetTimer = () => {
      if (resetProgressTimerRef.current) {
        clearInterval(resetProgressTimerRef.current);
        resetProgressTimerRef.current = null;
      }
    };
    if (isReset) {
      setResetProgress(8);
      stopResetTimer();
      resetProgressTimerRef.current = setInterval(() => {
        setResetProgress(prev => (prev >= 90 ? prev : prev + Math.max(1, Math.round((90 - prev) * 0.12))));
      }, 120);
    }

    try {
      const headers: Record<string, string> = {
        ...authHeaders(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      };
      const res = await fetch(`/api/sandbox/${action}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await res.json();
      if (data.status === 'success') {
        if (isReset) {
          stopResetTimer();
          setResetProgress(100);
        }
        setFeedback({ type: 'success', msg: actionMessages[action] || 'OK' });
        window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
        setShowCodeInput(false);
        setSecurityCode('');
        if (isReset) {
          setShowResetCodeInput(false);
          setResetCode('');
        }
      } else if (data.status === 'validation_failed') {
        setFeedback({ type: 'error', msg: 'Synchronisation refusée' });
      } else {
        setFeedback({ type: 'error', msg: data.error || 'Erreur' });
      }
      await fetchStatus();
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Erreur réseau' });
    } finally {
      setBusy(null);
      if (isReset) {
        stopResetTimer();
        // Laisse la barre atteindre 100% visuellement avant de disparaître.
        setTimeout(() => setResetProgress(0), 500);
      }
    }
  }, [fetchStatus]);

  const handleDeactivate = useCallback(() => {
    if (!showCodeInput) {
      setShowCodeInput(true);
      setSecurityCode('');
      setShowResetCodeInput(false);
      setFeedback(null);
      return;
    }
    if (securityCode.length !== 6) {
      setFeedback({ type: 'error', msg: '6 chiffres requis' });
      return;
    }
    doAction('deactivate', 'POST', { code: securityCode });
  }, [showCodeInput, securityCode, doAction]);

  const handleReset = useCallback(() => {
    if (!showResetCodeInput) {
      setShowResetCodeInput(true);
      setResetCode('');
      setShowCodeInput(false);
      setFeedback(null);
      return;
    }
    if (resetCode.length !== 6) {
      setFeedback({ type: 'error', msg: '6 chiffres requis' });
      return;
    }
    doAction('reset', 'POST', { code: resetCode });
  }, [showResetCodeInput, resetCode, doAction]);

  const actionMessages: Record<string, string> = {
    init: 'Sandbox initialisé',
    activate: 'Sandbox activé',
    deactivate: 'Sandbox désactivé',
    sync: 'Synchronisation réussie',
    discard: 'Modifications abandonnées',
    reset: 'Sandbox réinitialisé',
  };

  // Feedback : auto-dismiss après 4s, mais l'utilisateur garde la main pour
  // le fermer plus tôt (agence) — surtout utile s'il veut relire une erreur.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  // Nettoyage du timer de progression de reset au démontage.
  useEffect(() => {
    return () => {
      if (resetProgressTimerRef.current) clearInterval(resetProgressTimerRef.current);
    };
  }, []);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center gap-2 py-16" style={{ color: 'var(--text-dimmed)' }}>
        <Loader2 size={15} className="animate-spin" />
        <span className="text-xs">Chargement du sandbox…</span>
      </div>
    );
  }

  const isActive = status?.active ?? false;
  const modCount = status?.modifiedCount ?? 0;

  // État sémantique dérivé — pilote la couleur d'accent de la carte hero.
  const stateColor = isActive ? 'var(--color-success)' : status?.exists ? 'var(--text-muted)' : 'var(--accent-primary)';
  const stateLabel = isActive ? 'Actif' : status?.exists ? 'Inactif' : 'Non initialisé';

  return (
    <motion.div
      className="flex flex-col gap-3.5 p-4 sm:gap-4"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      {/* ═══════════════════════════════════════════════════════
          HERO — État du sandbox
          ═══════════════════════════════════════════════════════ */}
      <motion.section
        className="relative overflow-hidden rounded-2xl border"
        style={{
          borderColor: isActive
            ? 'color-mix(in srgb, var(--color-success) 30%, transparent)'
            : 'var(--border-base)',
          backgroundColor: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow-sm)',
          transition: 'border-color 0.3s ease',
        }}
        layout
      >
        {/* Halo d'accent en fond, discret */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full blur-3xl"
          style={{ backgroundColor: `color-mix(in srgb, ${stateColor} 14%, transparent)`, opacity: 0.7 }}
        />

        <div className="relative flex items-start gap-3 p-4">
          <motion.div
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              backgroundColor: `color-mix(in srgb, ${stateColor} 15%, transparent)`,
              color: stateColor,
              boxShadow: isActive ? `0 0 0 1px color-mix(in srgb, ${stateColor} 25%, transparent)` : 'none',
            }}
            animate={isActive && !reduceMotion ? { scale: [1, 1.04, 1] } : {}}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Box size={18} strokeWidth={2} />
          </motion.div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Sandbox
              </h3>
              <StatePill color={stateColor} label={stateLabel} active={isActive} />
            </div>

            {/* Compteur de modifications — fade doux sur changement de valeur */}
            <div className="mt-1 min-h-4 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p
                  key={modCount}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={spring}
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {isActive
                    ? (modCount
                      ? `${modCount} modification${modCount > 1 ? 's' : ''} en attente`
                      : 'Aucune modification en attente')
                    : status?.exists
                      ? 'Prêt à être activé'
                      : 'Créez un espace isolé pour vos écritures'}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchStatus}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 hover:bg-[var(--bg-hover)] active:scale-95"
            title="Rafraîchir l'état du sandbox"
            aria-label="Rafraîchir l'état du sandbox"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Chemin + dernière sync — bande d'info en pied de carte */}
        {(status?.path || status?.lastSync) && (
          <div
            className="relative flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5"
            style={{ borderTop: '1px solid var(--border-base)', backgroundColor: 'var(--bg-input)' }}
          >
            {status?.path && (
              <span className="flex min-w-0 items-center gap-1.5" title={status.path}>
                <FolderOpen size={11} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />
                <span className="truncate font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {status.path}
                </span>
              </span>
            )}
            {status?.lastSync && (
              <span className="flex items-center gap-1.5">
                <Clock size={11} style={{ color: 'var(--text-dimmed)' }} />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {new Date(status.lastSync).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                </span>
              </span>
            )}
          </div>
        )}
      </motion.section>

      {/* ═══════════════════════════════════════════════════════
          ACTION PRINCIPALE — dépend de l'état
          ═══════════════════════════════════════════════════════ */}
      {!status?.exists && (
        <PrimaryAction
          icon={<Box size={16} />}
          label="Initialiser le sandbox"
          hint="Copie le code source dans un espace isolé"
          color="var(--accent-primary)"
          busy={busy === 'init'}
          onClick={() => doAction('init')}
          spring={hoverSpring}
        />
      )}

      {status?.exists && !isActive && (
        <PrimaryAction
          icon={<Power size={16} />}
          label="Activer le sandbox"
          hint="Isole les écritures dans le sandbox"
          color="var(--color-success)"
          busy={busy === 'activate'}
          onClick={() => doAction('activate')}
          spring={hoverSpring}
        />
      )}

      {isActive && modCount > 0 && (
        <PrimaryAction
          icon={<GitCompareArrows size={16} />}
          label="Examiner les modifications"
          hint="Comparer, accepter ou rejeter fichier par fichier"
          color="var(--color-info)"
          badge={modCount}
          busy={false}
          onClick={() => onOpenDiff(null)}
          spring={hoverSpring}
        />
      )}

      {isActive && modCount === 0 && (
        <div
          className="flex items-center gap-2.5 rounded-xl border px-3.5 py-3"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-input)' }}
        >
          <Sparkles size={15} style={{ color: 'var(--color-success)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Sandbox propre — toutes les modifications sont synchronisées.
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          FICHIERS MODIFIÉS
          ═══════════════════════════════════════════════════════ */}
      {isActive && status && status.modifiedFiles.length > 0 && (
        <SectionCard
          title="Fichiers modifiés"
          count={status.modifiedFiles.length}
          countColor="var(--color-info)"
          open={showModifiedFiles}
          onToggle={() => setShowModifiedFiles(v => !v)}
          spring={spring}
        >
          <div className="custom-scrollbar max-h-52 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
            {status.modifiedFiles.map(f => (
              <button
                key={f}
                onClick={() => onOpenDiff(f)}
                className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all hover:bg-[var(--bg-hover)]"
              >
                <FileCode2 size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <span
                  className="flex-1 truncate font-mono text-xs transition-colors group-hover:text-[var(--text-primary)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {f}
                </span>
                <GitCompareArrows
                  size={11}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: 'var(--text-dimmed)' }}
                />
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          ACTIONS AVANCÉES
          ═══════════════════════════════════════════════════════ */}
      {status?.exists && (
        <SectionCard
          title="Actions avancées"
          open={showAdvancedActions}
          onToggle={() => setShowAdvancedActions(v => !v)}
          spring={spring}
        >
          <div className="flex flex-col gap-0.5 p-1.5">
            {isActive && modCount > 0 && (
              <ActionRow
                icon={<Upload size={13} />}
                label="Synchroniser tout"
                color="var(--color-success)"
                onClick={() => doAction('sync')}
                busy={busy === 'sync'}
                tooltip="Appliquer toutes les modifications au repo principal"
                transition={hoverSpring}
              />
            )}
            {isActive && modCount > 0 && (
              <ActionRow
                icon={<Trash2 size={13} />}
                label="Tout rejeter"
                color="var(--color-error)"
                onClick={() => doAction('discard')}
                busy={busy === 'discard'}
                tooltip="Supprimer toutes les modifications et réinitialiser le sandbox"
                transition={hoverSpring}
              />
            )}
            {isActive && (
              <ActionRow
                icon={<Lock size={13} />}
                label="Désactiver"
                color="var(--color-warning)"
                onClick={handleDeactivate}
                busy={busy === 'deactivate'}
                tooltip="Entrez un code à 6 chiffres pour désactiver le sandbox"
                transition={hoverSpring}
              />
            )}
            <ActionRow
              icon={<RotateCcw size={13} />}
              label="Réinitialiser le sandbox"
              color="var(--color-warning)"
              onClick={handleReset}
              busy={busy === 'reset'}
              tooltip="Écraser le sandbox avec une copie fraîche du code source (code requis)"
              transition={hoverSpring}
            />

            {/* Champs de code sécurité — déactivation / réinitialisation */}
            <AnimatePresence>
              {showCodeInput && isActive && (
                <CodeInputRow
                  key="deactivate-code"
                  inputRef={codeInputRef}
                  value={securityCode}
                  onChange={v => setSecurityCode(v)}
                  onConfirm={handleDeactivate}
                  onCancel={() => { setShowCodeInput(false); setSecurityCode(''); }}
                  label="Confirmer la désactivation"
                  icon={<ShieldOff size={12} />}
                  spring={spring}
                />
              )}
              {showResetCodeInput && status?.exists && (
                <CodeInputRow
                  key="reset-code"
                  inputRef={resetCodeRef}
                  value={resetCode}
                  onChange={v => setResetCode(v)}
                  onConfirm={handleReset}
                  onCancel={() => { setShowResetCodeInput(false); setResetCode(''); }}
                  label="Confirmer la réinitialisation"
                  icon={<RotateCcw size={12} />}
                  spring={spring}
                />
              )}
            </AnimatePresence>

            {/* Barre de progression de la réinitialisation */}
            <AnimatePresence>
              {busy === 'reset' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className="space-y-1.5 overflow-hidden px-2.5 pt-2"
                >
                  <div className="flex items-center justify-between text-[11px] font-medium">
                    <span className="flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
                      <Loader2 size={11} className="animate-spin" />
                      {resetProgress >= 100 ? 'Réinitialisation terminée' : 'Réinitialisation en cours…'}
                    </span>
                    <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {Math.round(resetProgress)}%
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                    role="progressbar"
                    aria-valuenow={Math.round(resetProgress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Progression de la réinitialisation du sandbox"
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: 'var(--color-warning)' }}
                      animate={{ width: `${resetProgress}%` }}
                      transition={reduceMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 120, damping: 20 }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </SectionCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          FEEDBACK
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={spring}
            className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium"
            style={{
              backgroundColor: feedback.type === 'success'
                ? 'color-mix(in srgb, var(--color-success) 8%, transparent)'
                : 'color-mix(in srgb, var(--color-error) 8%, transparent)',
              borderColor: feedback.type === 'success'
                ? 'var(--border-success-subtle)'
                : 'var(--border-error-subtle)',
              color: feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            <span className="flex-1">{feedback.msg}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="rounded p-0.5 transition-colors hover:bg-[var(--bg-hover)] active:scale-90"
              aria-label="Fermer"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── StatePill — pastille d'état à côté du titre ──────────────────────────────

function StatePill({ color, label, active }: { color: string; label: string; active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {active ? <ShieldCheck size={10} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </span>
  );
}

// ── PrimaryAction — grand bouton d'action contextuel ─────────────────────────

function PrimaryAction({ icon, label, hint, color, badge, busy, onClick, spring }: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  color: string;
  badge?: number;
  busy: boolean;
  onClick: () => void;
  spring: { type: 'spring'; stiffness: number; damping: number } | { duration: number };
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      whileTap={{ scale: 0.985 }}
      whileHover={{ y: -1 }}
      transition={spring}
      className="group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
      }}
    >
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-105"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color }}>{label}</span>
          {badge !== undefined && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)`, color }}
            >
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>
      </div>
    </motion.button>
  );
}

// ── SectionCard — carte repliable avec en-tête ───────────────────────────────

function SectionCard({ title, count, countColor, open, onToggle, spring, children }: {
  title: string;
  count?: number;
  countColor?: string;
  open: boolean;
  onToggle: () => void;
  spring: { type: 'spring'; bounce: number; duration: number } | { duration: number; ease: 'easeOut' };
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span className="flex items-center gap-2">
          {count !== undefined && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
              style={{
                color: countColor ?? 'var(--text-muted)',
                backgroundColor: `color-mix(in srgb, ${countColor ?? 'var(--text-muted)'} 14%, transparent)`,
              }}
            >
              {count}
            </span>
          )}
          <ChevronDown
            size={14}
            style={{ color: 'var(--text-dimmed)', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .18s ease' }}
          />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
            style={{ borderTop: '1px solid var(--border-base)' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── CodeInputRow — saisie du code de sécurité à 6 chiffres ───────────────────

function CodeInputRow({ inputRef, value, onChange, onConfirm, onCancel, label, icon, spring }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  label: string;
  icon: React.ReactNode;
  spring: { type: 'spring'; bounce: number; duration: number } | { duration: number; ease: 'easeOut' };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
      className="overflow-hidden"
    >
      <div
        className="mt-1 space-y-2 rounded-lg border p-2.5"
        style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-warning-subtle)' }}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-warning)' }}>
          {icon}
          {label}
        </span>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="• • • • • •"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm();
              if (e.key === 'Escape') onCancel();
            }}
            className="flex-1 rounded-md bg-transparent px-2 py-1.5 text-center font-mono text-sm tracking-[0.3em] outline-none"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border-base)' }}
          />
          <button
            onClick={onConfirm}
            disabled={value.length !== 6}
            className="rounded-md px-3 py-1.5 text-xs font-bold transition-opacity disabled:opacity-30"
            style={{ color: 'var(--color-warning)', backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)' }}
          >
            OK
          </button>
          <button
            onClick={onCancel}
            className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-dimmed)' }}
            aria-label="Annuler"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── ActionRow — bouton compact avec icône, libellé, tooltip ──────────────────

function ActionRow({ icon, label, color, onClick, busy, tooltip, transition }: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  busy: boolean;
  tooltip: string;
  transition: { type: 'spring'; stiffness: number; damping: number } | { duration: number };
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      whileTap={{ scale: 0.97 }}
      whileHover={{ x: 2 }}
      transition={transition}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
      title={tooltip}
    >
      <div
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-transform duration-150 group-hover:scale-110"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : icon}
      </div>
      <span className="text-xs font-medium transition-colors group-hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
    </motion.button>
  );
}
