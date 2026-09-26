/**
 * ConfirmDialog — Generic reusable confirmation modal.
 * Replaces window.confirm for consistent theming in the application.
 *
 * Usage:
 *   const { confirm } = useConfirm();
 *   const result = await confirm({
 *     title: 'Delete file',
 *     message: 'Are you sure you want to delete this file?',
 *     confirmLabel: 'Delete',
 *     cancelLabel: 'Cancel',
 *   });
 *   if (result) { // action confirmed }
 */

import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger' | 'warning';
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue>({
  confirm: async () => false,
});

// ── Confirm Dialog Component ────────────────────────────────────────────────

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'default' | 'danger' | 'warning';
  resolve: (value: boolean) => void;
}

function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmDialogState>({
    open: false,
    title: 'Confirmer',
    message: '',
    confirmLabel: 'Confirmer',
    cancelLabel: 'Annuler',
    variant: 'default',
    resolve: () => {},
  });

  const confirm = useCallback(async (options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({
        open: true,
        title: options.title ?? 'Confirmer',
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Confirmer',
        cancelLabel: options.cancelLabel ?? 'Annuler',
        variant: options.variant ?? 'default',
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve(true);
    setState(prev => ({ ...prev, open: false }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve(false);
    setState(prev => ({ ...prev, open: false }));
  }, [state]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }, [handleCancel]);

  const getVariantStyles = useCallback(() => {
    switch (state.variant) {
      case 'danger':
        return {
          icon: <AlertTriangle size={20} style={{ color: 'var(--color-error)' }} />,
          confirmColor: 'var(--color-error)',
          confirmBg: 'color-mix(in srgb, var(--color-error) 15%, transparent)',
          confirmBorder: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={20} style={{ color: 'var(--color-warning)' }} />,
          confirmColor: 'var(--color-warning)',
          confirmBg: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
          confirmBorder: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
        };
      default:
        return {
          icon: <Check size={20} style={{ color: 'var(--accent-primary)' }} />,
          confirmColor: 'var(--accent-primary)',
          confirmBg: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
          confirmBorder: 'color-mix(in srgb, var(--accent-primary) 30%, transparent)',
        };
    }
  }, [state.variant]);

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}
      
      {/* Modal Overlay */}
      {state.open && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            zIndex: 'var(--z-modal)' as any,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(2px)',
          }}
          onClick={handleBackdrop}
        >
          <div
            className="w-full max-w-sm rounded-xl border p-5 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-panel)',
              borderColor: 'var(--border-base)',
              color: 'var(--text-primary)',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
          >
            {/* Header */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex-shrink-0">
                {getVariantStyles().icon}
              </div>
              <div>
                <h3
                  id="confirm-dialog-title"
                  className="text-sm font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {state.title}
                </h3>
              </div>
            </div>

            {/* Message */}
            <p
              id="confirm-dialog-message"
              className="mb-6 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              {state.message}
            </p>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancel}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--text-muted)',
                }}
              >
                {state.cancelLabel}
              </button>
              <button
                onClick={handleConfirm}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
                style={{
                  backgroundColor: getVariantStyles().confirmBg,
                  border: `1px solid ${getVariantStyles().confirmBorder}`,
                  color: getVariantStyles().confirmColor,
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useConfirm() {
  return useContext(ConfirmDialogContext);
}

// ── Exports ─────────────────────────────────────────────────────────────────

export { ConfirmDialogProvider };
export type { ConfirmOptions };
