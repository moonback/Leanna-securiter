import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Bot,
  Play,
  Square,
  Shield,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { Section, Field, TextInput, SecretInput, ToggleSwitch, SectionDivider } from './SettingsPrimitives.js';

interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

interface TelegramStatus {
  isRunning: boolean;
  isConfigured: boolean;
  botInfo: TelegramBotInfo | null;
  allowedUsersCount: number;
  autoStart: boolean;
  notificationsEnabled: boolean;
  defaultChatId?: string;
  lastError: string | null;
}

export function TelegramSection() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [newUserInput, setNewUserInput] = useState('');
  const [autoStart, setAutoStart] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [defaultChatId, setDefaultChatId] = useState('');

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const fetchStatusAndConfig = useCallback(async () => {
    try {
      const [resStatus, resConfig] = await Promise.all([
        fetch('/api/telegram/status'),
        fetch('/api/telegram/config'),
      ]);

      if (resStatus.ok) {
        const dataStatus = await resStatus.json();
        if (dataStatus.status === 'success') {
          setStatus(dataStatus.data);
          setAutoStart(dataStatus.data.autoStart);
          setNotificationsEnabled(dataStatus.data.notificationsEnabled);
          setDefaultChatId(dataStatus.data.defaultChatId || '');
        }
      }

      if (resConfig.ok) {
        const dataConfig = await resConfig.json();
        if (dataConfig.status === 'success') {
          setHasToken(dataConfig.config.hasToken);
          setAllowedUsers(dataConfig.config.allowedUsers || []);
          if (!dataConfig.config.hasToken) {
            setTokenInput('');
          }
        }
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erreur lors du chargement de la configuration Telegram.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatusAndConfig();
    const handleStatusChanged = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setStatus(customEvent.detail);
      } else {
        fetchStatusAndConfig();
      }
    };
    window.addEventListener('Leanna-telegram-status-changed', handleStatusChanged);
    return () => {
      window.removeEventListener('Leanna-telegram-status-changed', handleStatusChanged);
    };
  }, [fetchStatusAndConfig]);

  const handleSaveConfig = async (override?: {
    token?: string;
    users?: string[];
    auto?: boolean;
    notify?: boolean;
    chatId?: string;
  }) => {
    setActionLoading(true);
    setFeedback(null);

    const payload: Record<string, any> = {
      allowedUsers: override?.users !== undefined ? override.users : allowedUsers,
      autoStart: override?.auto !== undefined ? override.auto : autoStart,
      notificationsEnabled: override?.notify !== undefined ? override.notify : notificationsEnabled,
      defaultChatId: override?.chatId !== undefined ? override.chatId : defaultChatId,
    };

    const tokenToSave = override?.token !== undefined ? override.token : tokenInput;
    if (tokenToSave && !tokenToSave.includes('••••')) {
      payload.botToken = tokenToSave.trim();
    }

    try {
      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setFeedback({ type: 'success', message: 'Paramètres Telegram enregistrés ✓' });
        setStatus(data.data);
        window.dispatchEvent(new CustomEvent('Leanna-telegram-status-changed', { detail: data.data }));
        if (payload.botToken) {
          setHasToken(true);
          setTokenInput('');
        }
        fetchStatusAndConfig();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Erreur lors de la sauvegarde.' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartBot = async () => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/telegram/start', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        setStatus(data.data);
        window.dispatchEvent(new CustomEvent('Leanna-telegram-status-changed', { detail: data.data }));
        setFeedback({ type: 'success', message: `Bot démarré avec succès ! (@${data.data?.botInfo?.username})` });
      } else {
        setFeedback({ type: 'error', message: data.error || 'Impossible de démarrer le bot.' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopBot = async () => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/telegram/stop', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        setStatus(data.data);
        window.dispatchEvent(new CustomEvent('Leanna-telegram-status-changed', { detail: data.data }));
        setFeedback({ type: 'success', message: 'Bot arrêté.' });
      } else {
        setFeedback({ type: 'error', message: data.error || 'Impossible d\'arrêter le bot.' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleTestMessage = async () => {
    setTestSending(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: defaultChatId || undefined }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setFeedback({ type: 'success', message: 'Message de test envoyé sur votre Telegram ! 🎉' });
      } else {
        setFeedback({ type: 'error', message: data.error || 'Échec de l\'envoi du test.' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Erreur réseau.' });
    } finally {
      setTestSending(false);
    }
  };

  const handleAddUser = () => {
    const trimmed = newUserInput.trim().replace(/^@/, '');
    if (!trimmed) return;
    if (allowedUsers.includes(trimmed)) {
      setFeedback({ type: 'error', message: 'Cet utilisateur est déjà dans la liste blanche.' });
      return;
    }
    const updated = [...allowedUsers, trimmed];
    setAllowedUsers(updated);
    setNewUserInput('');
    handleSaveConfig({ users: updated });
  };

  const handleRemoveUser = (userToRemove: string) => {
    const updated = allowedUsers.filter((u) => u !== userToRemove);
    setAllowedUsers(updated);
    handleSaveConfig({ users: updated });
  };

  if (loading) {
    return (
      <Section icon={Send} title="Bot Telegram" description="Chargement de l'intégration Telegram...">
        <div className="flex items-center justify-center py-10">
          <RefreshCw className="h-6 w-6 animate-spin text-muted" />
        </div>
      </Section>
    );
  }

  const isRunning = status?.isRunning ?? false;
  const badgeText = isRunning ? 'Connecté' : hasToken ? 'Arrêté' : 'Non configuré';

  return (
    <Section
      icon={Send}
      title="Bot Telegram"
      description="Contrôlez Leanna depuis votre smartphone : chat IA, exécution de tâches agents et notifications."
      badge={badgeText}
    >
      {/* Feedback Alert */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2.5 rounded-xl border p-3 text-xs ${
              feedback.type === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            )}
            <span className="flex-1">{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="ml-auto text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live Status Card */}
      <div
        className="relative overflow-hidden rounded-xl border p-4"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: isRunning ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-base)',
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                isRunning ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-muted'
              }`}
            >
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">
                  {status?.botInfo ? status.botInfo.firstName : 'Bot Telegram Leanna'}
                </span>
                {status?.botInfo?.username && (
                  <span className="rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-mono text-blue-400">
                    @{status.botInfo.username}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {isRunning
                  ? '🟢 En écoute active (Long Polling) — Prêt à recevoir vos messages'
                  : hasToken
                  ? '🟡 Bot arrêté — Cliquez sur Démarrer pour activer la liaison'
                  : '⚪ Aucun bot Telegram n\'est configuré pour le moment'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isRunning ? (
              <button
                onClick={handleStartBot}
                disabled={actionLoading || !hasToken}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Démarrer le Bot
              </button>
            ) : (
              <button
                onClick={handleStopBot}
                disabled={actionLoading}
                className="flex items-center gap-1.5 rounded-lg bg-red-600/80 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-50"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Arrêter le Bot
              </button>
            )}

            {isRunning && (
              <button
                onClick={handleTestMessage}
                disabled={testSending}
                className="flex items-center gap-1.5 rounded-lg border border-border-base bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {testSending ? 'Envoi...' : 'Tester'}
              </button>
            )}
          </div>
        </div>

        {status?.lastError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Dernière erreur : {status.lastError}</span>
          </div>
        )}
      </div>

      <SectionDivider label="CONFIGURATION DU BOT" />

      {/* Token Field */}
      <Field
        label="Token API Telegram"
        hint="Obtenu auprès de @BotFather lors de la création de votre bot."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <SecretInput
              value={tokenInput}
              onChange={(val) => setTokenInput(val)}
              placeholder={hasToken ? '••••••••••••••••••••••••••••••••••••••' : 'ex: 123456789:ABCdefGhIJKlmNoPQRstuVWXyz'}
            />
          </div>
          <button
            onClick={() => handleSaveConfig()}
            disabled={actionLoading || !tokenInput.trim()}
            className="rounded-lg bg-accent-primary px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            Sauvegarder le Token
          </button>
        </div>
      </Field>

      {/* Options */}
      <ToggleSwitch
        label="Démarrage automatique"
        hint="Lance automatiquement le bot en arrière-plan dès le démarrage de Leanna OS."
        value={autoStart}
        onChange={(checked) => {
          setAutoStart(checked);
          handleSaveConfig({ auto: checked });
        }}
      />

      <ToggleSwitch
        label="Notifications des Agents"
        hint="Recevez un message sur Telegram lorsque vos agents autonomes terminent ou échouent une tâche."
        value={notificationsEnabled}
        onChange={(checked) => {
          setNotificationsEnabled(checked);
          handleSaveConfig({ notify: checked });
        }}
      />

      <Field
        label="Chat ID par défaut"
        hint="L'identifiant numérique de votre conversation (ex: 123456789) pour recevoir les notifications et alertes."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <TextInput
              value={defaultChatId}
              onChange={(val) => setDefaultChatId(val)}
              placeholder="ex: 123456789"
            />
          </div>
          <button
            onClick={() => handleSaveConfig({ chatId: defaultChatId })}
            disabled={actionLoading}
            className="rounded-lg border border-border-base bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10"
          >
            Appliquer
          </button>
        </div>
      </Field>

      <SectionDivider label="SÉCURITÉ & LISTE BLANCHE" />

      {/* Security Whitelist Field */}
      <Field
        label="Utilisateurs autorisés"
        hint="Seuls les utilisateurs listés ici peuvent envoyer des commandes ou discuter avec Leanna. Entrez votre ID numérique ou votre nom d'utilisateur."
      >
        <div className="flex flex-col gap-3">
          {/* Add user form */}
          <div className="flex gap-2">
            <div className="flex-1">
              <TextInput
                value={newUserInput}
                onChange={(val) => setNewUserInput(val)}
                placeholder="ID Telegram (ex: 123456789) ou username sans @"
              />
            </div>
            <button
              onClick={handleAddUser}
              disabled={!newUserInput.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </button>
          </div>

          {/* User Tags */}
          <div className="flex flex-wrap gap-2">
            {allowedUsers.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
                <Shield className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Aucun utilisateur n'est autorisé. Lorsque vous écrirez au bot pour la première fois, il vous donnera votre ID pour l'ajouter ici.
                </span>
              </div>
            ) : (
              allowedUsers.map((user) => (
                <span
                  key={user}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-base bg-white/5 px-2.5 py-1 text-xs font-mono text-white"
                >
                  <Shield className="h-3 w-3 text-emerald-400" />
                  {user}
                  <button
                    onClick={() => handleRemoveUser(user)}
                    className="ml-1 text-muted hover:text-red-400"
                    title="Supprimer l'accès"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </Field>

      {/* Setup Guide Accordion */}
      <div className="mt-4 rounded-xl border border-border-base bg-white/[0.02]">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex w-full items-center justify-between p-3.5 text-left text-xs font-semibold text-white transition hover:bg-white/5"
        >
          <div className="flex items-center gap-2 text-accent-primary">
            <HelpCircle className="h-4 w-4" />
            <span>Guide pas à pas : Configurer votre bot Telegram en 2 minutes</span>
          </div>
          {showGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        <AnimatePresence>
          {showGuide && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border-base p-4 text-xs text-muted"
            >
              <ol className="flex flex-col gap-3 list-decimal pl-4">
                <li>
                  <strong className="text-white">Créer le bot sur Telegram :</strong> Ouvrez Telegram et cherchez le compte officiel{' '}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-accent-primary hover:underline"
                  >
                    @BotFather <ExternalLink className="h-3 w-3" />
                  </a>
                  . Envoyez la commande <code className="rounded bg-white/10 px-1 py-0.5 text-white">/newbot</code>, choisissez un nom et un pseudo pour votre bot.
                </li>
                <li>
                  <strong className="text-white">Copier le Token :</strong> @BotFather vous répond avec un token d'API du type{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-white">123456789:ABCdef...</code>. Collez-le dans le champ ci-dessus et cliquez sur <em>Sauvegarder le Token</em>.
                </li>
                <li>
                  <strong className="text-white">Démarrer le Bot :</strong> Cliquez sur le bouton vert <em>Démarrer le Bot</em> ci-dessus. Le statut passe à <em>Connecté</em>.
                </li>
                <li>
                  <strong className="text-white">Trouver votre ID Telegram :</strong> Contactez le bot{' '}
                  <a
                    href="https://t.me/userinfobot"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-accent-primary hover:underline"
                  >
                    @userinfobot <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  sur Telegram pour connaître votre identifiant numérique unique (Id: 123456789). Ajoutez-le dans la liste blanche ci-dessus.
                </li>
                <li>
                  <strong className="text-white">Parler à votre bot :</strong> Ouvrez votre nouveau bot sur Telegram et appuyez sur{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-white">/start</code>. Vous pouvez maintenant lui poser des questions, lancer des missions d'agents (<code className="rounded bg-white/10 px-1 py-0.5 text-white">/agent</code>) ou exécuter des commandes (<code className="rounded bg-white/10 px-1 py-0.5 text-white">/cmd</code>) !
                </li>
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Section>
  );
}
