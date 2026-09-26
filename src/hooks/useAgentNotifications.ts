/**
 * useAgentNotifications — Hook pour les notifications automatiques de fin de tâche
 *
 * Écoute les événements agents via WebSocket (système push) et affiche
 * des notifications natives du navigateur pour les tâches terminées.
 */
import { useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentEvent {
  type: 'agent_event';
  event: 'task_started' | 'task_progress' | 'task_completed' | 'task_failed';
  taskId: string;
  role: string;
  title: string;
  agentName: string;
  detail?: string;
  timestamp: string;
  summary?: string;
  durationMs?: number;
}

interface NotificationOptions {
  /** Activer les notifications pour task_completed (par défaut: true) */
  notifyOnComplete?: boolean;
  /** Activer les notifications pour task_failed (par défaut: true) */
  notifyOnFailed?: boolean;
  /** Activer les notifications pour task_started (par défaut: false) */
  notifyOnStart?: boolean;
  /** Callback appelé à chaque événement de tâche */
  onTaskEvent?: (event: AgentEvent) => void;
  /** Filtre par rôle d'agent (si fourni, ne notifie que ces rôles) */
  roleFilter?: string[];
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const EMOJI_BY_EVENT: Record<string, string> = {
  task_started: '🚀',
  task_completed: '✅',
  task_failed: '❌',
  task_progress: '⏳',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Hook Principal
// ═══════════════════════════════════════════════════════════════════════════════

export function useAgentNotifications(options: NotificationOptions = {}) {
  const {
    notifyOnComplete = true,
    notifyOnFailed = true,
    notifyOnStart = false,
    onTaskEvent,
    roleFilter,
  } = options;

  const permissionRef = useRef<NotificationPermission>('default');

  // ── Demander la permission de notification au chargement ─────────────────────
  useEffect(() => {
    if ('Notification' in window) {
      permissionRef.current = Notification.permission;
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          permissionRef.current = permission;
        });
      }
    }
  }, []);

  // ── Afficher une notification native ─────────────────────────────────────────
  const showNotification = useCallback((event: AgentEvent) => {
    if (!('Notification' in window) || permissionRef.current !== 'granted') {
      return;
    }

    const emoji = EMOJI_BY_EVENT[event.event] ?? '🤖';
    const duration = event.durationMs ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : '';
    const title = `${emoji} ${event.agentName}`;
    const body = `${event.title}${duration}`;

    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico', // Adapter selon votre favicon
      tag: event.taskId, // Évite les doublons pour la même tâche
      requireInteraction: event.event === 'task_failed', // Nécessite interaction si échec
      silent: event.event === 'task_started', // Discret pour les démarrages
    });

    // Auto-fermeture après 5s (sauf pour les échecs qui nécessitent interaction)
    if (event.event !== 'task_failed') {
      setTimeout(() => notification.close(), 5000);
    }

    // Click sur la notification → focus sur la fenêtre
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, []);

  // ── Écouter les événements WebSocket via CustomEvent ─────────────────────────
  useEffect(() => {
    const handleAgentEvent = (e: Event) => {
      const event = (e as CustomEvent<AgentEvent>).detail;

      // Vérifier que c'est bien un événement agent
      if (!event || event.type !== 'agent_event') return;

      // Ignorer les messages de bus (format "bus:...")
      if (event.detail?.startsWith('bus:')) return;

      // Appliquer le filtre de rôle si configuré
      if (roleFilter && roleFilter.length > 0 && !roleFilter.includes(event.role)) {
        return;
      }

      // Callback utilisateur (si fourni)
      if (onTaskEvent) {
        onTaskEvent(event);
      }

      // Décider si on notifie selon l'événement
      const shouldNotify =
        (event.event === 'task_completed' && notifyOnComplete) ||
        (event.event === 'task_failed' && notifyOnFailed) ||
        (event.event === 'task_started' && notifyOnStart);

      if (shouldNotify) {
        showNotification(event);
      }
    };

    window.addEventListener('Leanna-agent-event', handleAgentEvent);
    return () => {
      window.removeEventListener('Leanna-agent-event', handleAgentEvent);
    };
  }, [
    notifyOnComplete,
    notifyOnFailed,
    notifyOnStart,
    onTaskEvent,
    roleFilter,
    showNotification,
  ]);

  return {
    /** Permission actuelle pour les notifications */
    permission: permissionRef.current,
    /** Demander explicitement la permission */
    requestPermission: useCallback(() => {
      if ('Notification' in window) {
        return Notification.requestPermission().then(permission => {
          permissionRef.current = permission;
          return permission;
        });
      }
      return Promise.resolve('denied' as NotificationPermission);
    }, []),
  };
}
