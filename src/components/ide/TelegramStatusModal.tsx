import { useState, useCallback, useEffect, memo } from 'react';
import { motion } from 'motion/react';
import {
  Send, Play, Square, RefreshCw, X, ExternalLink,
  AlertTriangle, CheckCircle2, Settings, Shield, Bell, Radio, LoaderCircle,
  Copy, Users, MessageSquare, Image as ImageIcon, FileText, Zap, Wifi, WifiOff,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

export interface TelegramStatus {
  isRunning: boolean;
  isConfigured: boolean;
  botInfo: TelegramBotInfo | null;
  allowedUsersCount: number;
  autoStart: boolean;
  notificationsEnabled: boolean;
  defaultChatId?: string;
  lastError: string | null;
}

interface TelegramStatusModalProps {
  status: TelegramStatus | null;
  onClose: () => void;
  onStatusChange?: (newStatus: TelegramStatus) => void;
  /** Rendu en panneau latéral docké (sans le chrome Modal). */
  docked?: boolean;
}

export const TelegramStatusModal = memo(function TelegramStatusModal({
  status: initialStatus,
  onClose,
  onStatusChange,
  docked = false,
}: TelegramStatusModalProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TelegramStatus | null>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => { if (initialStatus) setStatus(initialStatus); }, [initialStatus]);

  const fetchStatus = useCallback(async () => {
    setLoading(true); setFeedback(null);
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') { setStatus(data.data); onStatusChange?.(data.data); }
      }
    } catch { setFeedback({ type: 'error', message: 'Impossible de joindre le serveur.' }); }
    finally { setLoading(false); }
  }, [onStatusChange]);

  // Récupère le statut réel à l'ouverture (sinon, sans statut initial, le panneau
  // affiche « Non configuré » par défaut jusqu'à un rafraîchissement manuel).
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Reste synchronisé avec les changements de statut émis ailleurs (StatusBar, etc.).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setStatus(detail);
    };
    window.addEventListener('Leanna-telegram-status-changed', handler);
    return () => window.removeEventListener('Leanna-telegram-status-changed', handler);
  }, []);

  const handleStartBot = async () => {
    setActionLoading(true); setFeedback(null);
    try {
      const res = await fetch('/api/telegram/start', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        setStatus(data.data); onStatusChange?.(data.data);
        window.dispatchEvent(new CustomEvent('Leanna-telegram-status-changed', { detail: data.data }));
        setFeedback({ type: 'success', message: `Bot démarré ! (@${data.data?.botInfo?.username || 'bot'})` });
      } else {
        if (data.data) { setStatus(data.data); onStatusChange?.(data.data); }
        setFeedback({ type: 'error', message: data.error || 'Impossible de démarrer le bot.' });
      }
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' }); }
    finally { setActionLoading(false); }
  };

  const handleStopBot = async () => {
    setActionLoading(true); setFeedback(null);
    try {
      const res = await fetch('/api/telegram/stop', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        setStatus(data.data); onStatusChange?.(data.data);
        window.dispatchEvent(new CustomEvent('Leanna-telegram-status-changed', { detail: data.data }));
        setFeedback({ type: 'success', message: 'Bot arrêté avec succès.' });
      } else { setFeedback({ type: 'error', message: data.error || "Impossible d'arrêter le bot." }); }
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' }); }
    finally { setActionLoading(false); }
  };

  const handleSendTest = async () => {
    setTestLoading(true); setFeedback(null);
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.status === 'success') setFeedback({ type: 'success', message: 'Message de test envoyé sur Telegram ! 🎉' });
      else setFeedback({ type: 'error', message: data.error || "Échec de l'envoi du test." });
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' }); }
    finally { setTestLoading(false); }
  };

  const handleGoToSettings = () => { onClose(); navigate('/settings?section=telegram-settings'); };

  const [copied, setCopied] = useState<string | null>(null);
  const copyToClipboard = useCallback((value: string, key: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(prev => (prev === key ? null : prev)), 1500);
    }).catch(() => { /* clipboard indisponible — ignorer */ });
  }, []);

  const isRunning    = status?.isRunning ?? false;
  const isConfigured = status?.isConfigured ?? false;
  const botInfo      = status?.botInfo;
  const lastError    = status?.lastError;

  // Derive tone from status
  const tone = lastError ? 'danger' : 'default';

  const headerContent = (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: isRunning ? 'var(--color-success-subtle)' : 'var(--bg-secondary)', color: isRunning ? 'var(--color-success)' : 'var(--text-muted)' }}
          >
            <Send size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bot Telegram</h3>
              {isRunning ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold badge-success">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-success)' }} />
                  En ligne
                </span>
              ) : lastError ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold badge-error">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-error)' }} />
                  Erreur
                </span>
              ) : isConfigured ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}>
                  Arrêté
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold badge-warning">
                  Non configuré
                </span>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contrôle à distance &amp; notifications</p>
          </div>
        </div>
  );

  const refreshButton = (
        <button
          type="button"
          onClick={fetchStatus}
          disabled={loading}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Actualiser le statut"
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--ctrl-hover)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
  );

  const bodyContent = (
        <div className="space-y-4 text-xs">
          {/* Feedback alert */}
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className={`p-3 rounded-xl flex items-start gap-2.5 border ${feedback.type === 'success' ? 'badge-success' : 'badge-error'}`}
              role="alert"
            >
              {feedback.type === 'success'
                ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
              <span className="leading-relaxed">{feedback.message}</span>
            </motion.div>
          )}

          {/* Last error banner */}
          {lastError && !feedback && (
            <div className="p-3 rounded-xl flex items-start gap-2.5 badge-error border" role="alert">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold block">Erreur détectée :</span>
                <span className="font-mono text-xs break-all leading-normal opacity-90">{lastError}</span>
              </div>
            </div>
          )}

          {status === null && loading ? (
            // Chargement initial : éviter d'afficher « Non configuré » à tort.
            <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--text-muted)' }}>
              <LoaderCircle size={16} className="animate-spin" />
              <span className="text-xs">Chargement du statut…</span>
            </div>
          ) : !isConfigured ? (
            <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)' }}>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Aucun token API de bot Telegram n'est configuré. Pour activer le contrôle à distance et les notifications :
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                <li>Créez un bot avec <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>@BotFather</span> sur Telegram</li>
                <li>Copiez le token API fourni</li>
                <li>Collez-le dans la section Paramètres → Bot Telegram</li>
              </ol>
              <Button variant="primary" fullWidth size="sm" onClick={handleGoToSettings} iconLeft={<Settings size={14} />}>
                Configurer le bot dans les Paramètres
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Bot info card */}
              <div className="p-3.5 rounded-xl border space-y-2.5" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)' }}>
                {botInfo ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{botInfo.firstName}</div>
                      <a href={`https://t.me/${botInfo.username}`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-mono transition-opacity hover:opacity-80"
                        style={{ color: 'var(--accent-primary)' }}>
                        @{botInfo.username} <ExternalLink size={10} />
                      </a>
                    </div>
                    <span className="text-xs font-mono opacity-50">ID: {botInfo.id}</span>
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Bot configuré (en attente de démarrage pour obtenir les détails du compte)
                  </div>
                )}
                <div className="pt-2 border-t grid grid-cols-2 gap-2 text-xs" style={{ borderColor: 'var(--border-base)' }}>
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Shield size={12} className="opacity-70" />
                    <span>{status?.allowedUsersCount || 0} utilisateur(s) autorisé(s)</span>
                  </div>
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Radio size={12} className="opacity-70" /> <span>Mode Polling</span>
                  </div>
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Bell size={12} className="opacity-70" />
                    <span>Notifs : {status?.notificationsEnabled ? 'Activées' : 'Désactivées'}</span>
                  </div>
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: status?.autoStart ? 'var(--color-success)' : 'var(--text-muted)' }} />
                    <span>Auto-start : {status?.autoStart ? 'Oui' : 'Non'}</span>
                  </div>
                </div>
              </div>

              {/* Start / Stop + Test */}
              <div className="flex gap-2">
                {isRunning ? (
                  <Button
                    variant="danger-ghost"
                    fullWidth size="sm"
                    loading={actionLoading}
                    onClick={handleStopBot}
                    iconLeft={<Square size={14} fill="currentColor" />}
                  >
                    Arrêter le bot Telegram
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    fullWidth size="sm"
                    loading={actionLoading}
                    onClick={handleStartBot}
                    iconLeft={<Play size={14} fill="currentColor" />}
                    style={{ backgroundColor: 'var(--color-success)', borderColor: 'transparent' } as React.CSSProperties}
                  >
                    Démarrer le bot Telegram
                  </Button>
                )}
                {isRunning && (
                  <Button
                    variant="secondary" size="sm"
                    loading={testLoading}
                    onClick={handleSendTest}
                    iconLeft={<Send size={13} />}
                    aria-label="Envoyer un message de test sur Telegram"
                  >
                    Tester
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
  );

  const footerContent = (
        <button
          type="button"
          onClick={handleGoToSettings}
          className="flex items-center gap-1.5 text-xs hover:underline transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <Settings size={13} /> <span>Paramètres complets</span>
        </button>
  );

  // ── Rendu docké (panneau latéral, sans chrome Modal) ────────────────────────
  if (docked) {
    return (
      <TelegramDockedPanel
        status={status}
        loading={loading}
        actionLoading={actionLoading}
        testLoading={testLoading}
        feedback={feedback}
        copied={copied}
        onRefresh={fetchStatus}
        onClose={onClose}
        onStart={handleStartBot}
        onStop={handleStopBot}
        onTest={handleSendTest}
        onGoToSettings={handleGoToSettings}
        onCopy={copyToClipboard}
      />
    );
  }

  return (
    <Modal open onClose={onClose} size="sm" tone={tone}>
      <Modal.Header>
        {headerContent}
        {refreshButton}
      </Modal.Header>

      <Modal.Body>
        {bodyContent}
      </Modal.Body>

      <Modal.Footer align="between">
        {footerContent}
        <Button variant="ghost" size="sm" onClick={onClose}>Fermer</Button>
      </Modal.Footer>
    </Modal>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Panneau docké — version enrichie et professionnelle
// ═══════════════════════════════════════════════════════════════════════════════

interface TelegramDockedPanelProps {
  status: TelegramStatus | null;
  loading: boolean;
  actionLoading: boolean;
  testLoading: boolean;
  feedback: { type: 'success' | 'error'; message: string } | null;
  copied: string | null;
  onRefresh: () => void;
  onClose: () => void;
  onStart: () => void;
  onStop: () => void;
  onTest: () => void;
  onGoToSettings: () => void;
  onCopy: (value: string, key: string) => void;
}

function TelegramDockedPanel({
  status, loading, actionLoading, testLoading, feedback, copied,
  onRefresh, onClose, onStart, onStop, onTest, onGoToSettings, onCopy,
}: TelegramDockedPanelProps) {
  const isRunning = status?.isRunning ?? false;
  const isConfigured = status?.isConfigured ?? false;
  const botInfo = status?.botInfo;
  const lastError = status?.lastError;

  const stateColor = isRunning
    ? 'var(--color-success)'
    : lastError
    ? 'var(--color-error)'
    : isConfigured
    ? 'var(--text-muted)'
    : 'var(--color-warning)';
  const stateLabel = isRunning
    ? 'En ligne'
    : lastError
    ? 'Erreur'
    : isConfigured
    ? 'Arrêté'
    : 'Non configuré';

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-panel)' }}>
      {/* ── En-tête ── */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-base)' }}
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: isRunning ? 'var(--color-success-subtle)' : 'var(--bg-secondary)', color: stateColor }}
        >
          <Send size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>Bot Telegram</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Contrôle à distance &amp; notifications</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-white/10"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Actualiser le statut"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-white/10"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Fermer"
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Corps défilant ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 py-3 space-y-3 text-xs">
        {/* Feedback */}
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className={`p-2.5 rounded-xl flex items-start gap-2 border ${feedback.type === 'success' ? 'badge-success' : 'badge-error'}`}
            role="alert"
          >
            {feedback.type === 'success'
              ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
            <span className="leading-relaxed">{feedback.message}</span>
          </motion.div>
        )}

        {status === null && loading ? (
          <div className="flex items-center justify-center py-10 gap-2" style={{ color: 'var(--text-muted)' }}>
            <LoaderCircle size={16} className="animate-spin" />
            <span>Chargement du statut…</span>
          </div>
        ) : !isConfigured ? (
          <NotConfiguredBlock onGoToSettings={onGoToSettings} />
        ) : (
          <>
            {/* Hero statut connexion */}
            <div
              className="rounded-2xl p-4 flex flex-col items-center text-center gap-2"
              style={{
                background: isRunning
                  ? 'linear-gradient(160deg, color-mix(in srgb, var(--color-success) 14%, transparent), transparent)'
                  : 'var(--bg-input)',
                border: `1px solid ${isRunning ? 'color-mix(in srgb, var(--color-success) 30%, transparent)' : 'var(--border-base)'}`,
              }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'color-mix(in srgb, ' + stateColor + ' 14%, transparent)', color: stateColor }}
              >
                {isRunning ? <Wifi size={22} /> : <WifiOff size={22} />}
              </div>
              <div className="flex items-center gap-1.5">
                {isRunning && <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: stateColor }} />}
                <span className="text-sm font-bold" style={{ color: stateColor }}>{stateLabel}</span>
              </div>
              {botInfo ? (
                <a
                  href={`https://t.me/${botInfo.username}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  @{botInfo.username} <ExternalLink size={10} />
                </a>
              ) : (
                <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                  Démarrez le bot pour récupérer ses infos
                </span>
              )}
            </div>

            {/* Identité du bot */}
            {botInfo && (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-base)' }}>
                <SectionTitle icon={<Shield size={11} />} label="Identité" />
                <div className="px-3 py-2 space-y-2">
                  <InfoRow label="Nom" value={botInfo.firstName} />
                  <InfoRow
                    label="Identifiant"
                    value={`ID: ${botInfo.id}`}
                    mono
                    onCopy={() => onCopy(String(botInfo.id), 'id')}
                    copied={copied === 'id'}
                  />
                  <InfoRow
                    label="Handle"
                    value={`@${botInfo.username}`}
                    mono
                    onCopy={() => onCopy(`@${botInfo.username}`, 'handle')}
                    copied={copied === 'handle'}
                  />
                </div>
              </div>
            )}

            {/* Configuration */}
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-base)' }}>
              <SectionTitle icon={<Settings size={11} />} label="Configuration" />
              <div className="grid grid-cols-2 gap-px" style={{ backgroundColor: 'var(--border-base)' }}>
                <StatTile
                  icon={<Users size={13} />}
                  value={String(status?.allowedUsersCount ?? 0)}
                  label="Utilisateurs autorisés"
                />
                <StatTile
                  icon={<Radio size={13} />}
                  value="Polling"
                  label="Mode de connexion"
                />
                <StatTile
                  icon={<Bell size={13} />}
                  value={status?.notificationsEnabled ? 'Activées' : 'Désactivées'}
                  label="Notifications"
                  tone={status?.notificationsEnabled ? 'success' : 'muted'}
                />
                <StatTile
                  icon={<Zap size={13} />}
                  value={status?.autoStart ? 'Oui' : 'Non'}
                  label="Démarrage auto"
                  tone={status?.autoStart ? 'success' : 'muted'}
                />
              </div>
              {status?.defaultChatId ? (
                <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
                  <InfoRow
                    label="Chat par défaut"
                    value={status.defaultChatId}
                    mono
                    onCopy={() => onCopy(status.defaultChatId!, 'chat')}
                    copied={copied === 'chat'}
                  />
                </div>
              ) : (
                <div className="px-3 py-2 border-t text-xs" style={{ borderColor: 'var(--border-base)', color: 'var(--text-dimmed)' }}>
                  Aucun chat par défaut configuré
                </div>
              )}
            </div>

            {/* Capacités */}
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-base)' }}>
              <SectionTitle icon={<Zap size={11} />} label="Capacités" />
              <div className="px-3 py-2.5 flex flex-wrap gap-1.5">
                <Capability icon={<MessageSquare size={11} />} label="Messages" />
                <Capability icon={<ImageIcon size={11} />} label="Photos" />
                <Capability icon={<FileText size={11} />} label="Documents" />
                <Capability icon={<Radio size={11} />} label="Diffusion" />
              </div>
            </div>

            {/* Erreur éventuelle */}
            {lastError && !feedback && (
              <div className="p-2.5 rounded-xl flex items-start gap-2 badge-error border" role="alert">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <div className="space-y-0.5 min-w-0">
                  <span className="font-semibold block">Dernière erreur</span>
                  <span className="font-mono text-xs break-all leading-normal opacity-90">{lastError}</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {isRunning ? (
                <Button variant="danger-ghost" fullWidth size="sm" loading={actionLoading} onClick={onStop} iconLeft={<Square size={14} fill="currentColor" />}>
                  Arrêter
                </Button>
              ) : (
                <Button
                  variant="primary" fullWidth size="sm" loading={actionLoading} onClick={onStart}
                  iconLeft={<Play size={14} fill="currentColor" />}
                  style={{ backgroundColor: 'var(--color-success)', borderColor: 'transparent' } as React.CSSProperties}
                >
                  Démarrer
                </Button>
              )}
              {isRunning && (
                <Button variant="secondary" size="sm" loading={testLoading} onClick={onTest} iconLeft={<Send size={13} />} aria-label="Envoyer un message de test">
                  Tester
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Pied : lien paramètres ── */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border-base)' }}>
        <button
          type="button"
          onClick={onGoToSettings}
          className="flex items-center gap-1.5 text-xs hover:underline transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <Settings size={13} /> <span>Paramètres complets</span>
        </button>
      </div>
    </div>
  );
}

// ── Sous-composants du panneau docké ─────────────────────────────────────────

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
      style={{ color: 'var(--text-dimmed)', backgroundColor: 'color-mix(in srgb, var(--bg-input) 60%, transparent)' }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function InfoRow({
  label, value, mono, onCopy, copied,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`text-xs truncate ${mono ? 'font-mono' : 'font-medium'}`}
          style={{ color: 'var(--text-primary)' }}
          title={value}
        >
          {value}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/10 flex-shrink-0"
            style={{ color: copied ? 'var(--color-success)' : 'var(--text-dimmed)' }}
            aria-label={`Copier ${label}`}
          >
            {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
          </button>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon, value, label, tone = 'default',
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone?: 'default' | 'success' | 'muted';
}) {
  const color = tone === 'success' ? 'var(--color-success)' : tone === 'muted' ? 'var(--text-muted)' : 'var(--text-primary)';
  return (
    <div className="px-3 py-2.5 flex flex-col gap-0.5" style={{ backgroundColor: 'var(--bg-panel)' }}>
      <div className="flex items-center gap-1.5" style={{ color: 'var(--text-dimmed)' }}>
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function Capability({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}
    >
      {icon}
      {label}
    </span>
  );
}

function NotConfiguredBlock({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)' }}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-warning-subtle)', color: 'var(--color-warning)' }}>
          <AlertTriangle size={15} />
        </div>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bot non configuré</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        Aucun token API Telegram n'est configuré. Pour activer le contrôle à distance et les notifications :
      </p>
      <ol className="list-decimal list-inside space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <li>Créez un bot avec <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>@BotFather</span></li>
        <li>Copiez le token API fourni</li>
        <li>Collez-le dans Paramètres → Bot Telegram</li>
      </ol>
      <Button variant="primary" fullWidth size="sm" onClick={onGoToSettings} iconLeft={<Settings size={14} />}>
        Configurer le bot
      </Button>
    </div>
  );
}
