import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Check, X, Clock } from 'lucide-react';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';

interface ConfirmRequest {
  requestId: string;
  filePath: string;
  operation: 'write' | 'modify' | 'patch' | 'delete' | 'rename';
  reason?: string;
  timeoutMs: number;
}

const OPERATION_LABELS: Record<string, string> = {
  write: 'Écriture',
  modify: 'Modification',
  patch: 'Patch',
  delete: 'Suppression',
  rename: 'Renommage',
};

interface Props {
  sendMessage: (data: any) => void;
}

/**
 * CriticalEditConfirm — Modale de confirmation quand l'IA veut modifier un fichier critique.
 * Écoute l'event WebSocket 'Leanna-confirm-critical-edit' et affiche une modale.
 */
export function CriticalEditConfirm({ sendMessage }: Props) {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    function handleConfirmEvent(e: CustomEvent<ConfirmRequest>) {
      setPending(e.detail);
      setTimeLeft(Math.ceil(e.detail.timeoutMs / 1000));
    }
    window.addEventListener('Leanna-confirm-critical-edit', handleConfirmEvent as EventListener);
    return () => window.removeEventListener('Leanna-confirm-critical-edit', handleConfirmEvent as EventListener);
  }, []);

  const respond = useCallback((approved: boolean) => {
    if (!pending) return;
    sendMessage({ type: 'confirm-response', requestId: pending.requestId, approved });
    setPending(null);
  }, [pending, sendMessage]);

  // Countdown timer — auto-refuse on timeout
  useEffect(() => {
    if (!pending || timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { respond(false); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pending, timeLeft, respond]);

  const totalSeconds = pending ? Math.ceil(pending.timeoutMs / 1000) : 1;
  const progressPct = Math.round((timeLeft / totalSeconds) * 100);
  const urgentColor = timeLeft <= 10 ? 'var(--color-error)' : 'var(--accent-primary)';

  return (
    <Modal
      open={pending !== null}
      onClose={() => respond(false)}
      size="sm"
      tone="warning"
      layer="critical"
      disableBackdropClick
    >
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--color-warning-subtle)' }}
          >
            <ShieldAlert className="w-5 h-5" style={{ color: 'var(--color-warning)' }} />
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Fichier critique
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              L'IA demande à modifier un fichier protégé
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        {pending && (
          <div className="space-y-4">
            {/* Details */}
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Opération</span>
                  <span
                    className="text-xs font-semibold rounded-lg px-2 py-0.5"
                    style={{
                      backgroundColor: 'var(--color-warning-subtle)',
                      color: 'var(--color-warning)',
                    }}
                  >
                    {OPERATION_LABELS[pending.operation] || pending.operation}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Fichier</span>
                  <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {pending.filePath}
                  </span>
                </div>
                {pending.reason && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Détail</span>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{pending.reason}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Countdown timer */}
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: urgentColor }} />
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: urgentColor }}
                  initial={{ width: '100%' }}
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 1, ease: 'linear' }}
                />
              </div>
              <span
                className="text-sm font-mono min-w-[2.5rem] text-right"
                style={{ color: urgentColor }}
              >
                {timeLeft}s
              </span>
            </div>

            <p className="text-xs text-center" style={{ color: 'var(--text-dimmed)' }}>
              Sans réponse, la modification sera automatiquement refusée après timeout.
            </p>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={() => respond(false)}>
          <X className="w-3.5 h-3.5" />
          Refuser
        </Button>
        <Button
          size="sm"
          onClick={() => respond(true)}
          style={{ backgroundColor: 'var(--color-warning)', color: 'white' } as React.CSSProperties}
        >
          <Check className="w-3.5 h-3.5" />
          Autoriser
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
