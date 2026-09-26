/**
 * AIConnectionBanner — Bannière d'état de connexion IA.
 * Affiche un état clair quand l'IA est déconnectée avec action de connexion.
 * Affiche un résumé compact quand connectée.
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wifi, WifiOff, Loader2, BrainCircuit,
  Zap, AlertTriangle,
} from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge.js';

interface AIConnectionBannerProps {
  connected: boolean;
  connecting?: boolean;
  working?: boolean;
  muted?: boolean;
  aiName?: string;
  onConnect: () => void;
  onDisconnect?: () => void;
  onSettings?: () => void;
  /** Compact mode for sidebar */
  compact?: boolean;
}

export function AIConnectionBanner({
  connected,
  connecting = false,
  working = false,
  muted = false,
  aiName = 'Leanna',
  onConnect,
  onDisconnect,
  onSettings,
  compact = false,
}: AIConnectionBannerProps) {
  if (compact) {
    return (
      <div className="px-2 py-1.5">
        {connected ? (
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--status-running-bg)' }}
          >
            <StatusBadge status={working ? 'running' : 'connected'} dotOnly pulse={working} />
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
              {working ? 'En cours…' : muted ? 'Muet' : 'Prêt'}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-all ai-disconnected-banner"
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
          >
            <WifiOff size={12} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              Connecter
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {!connected ? (
        <motion.div
          key="disconnected"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="ai-disconnected-banner mx-3 my-2"
        >
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
              style={{ backgroundColor: 'var(--bg-input)' }}
            >
              <WifiOff size={18} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <h4
                className="text-sm font-semibold mb-0.5"
                style={{ color: 'var(--text-primary)' }}
              >
                {aiName} est hors ligne
              </h4>
              <p className="text-xs leading-relaxed mb-2.5" style={{ color: 'var(--text-muted)' }}>
                Connectez l'assistant pour accéder au chat vocal, à l'édition de code assistée et aux agents automatiques.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onConnect}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: 'var(--accent-primary)',
                    color: 'whitefff',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
                >
                  <Zap size={11} />
                  Connecter
                </button>
                {onSettings && (
                  <button
                    type="button"
                    onClick={onSettings}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    Réglages
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="connected"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="ai-connected-indicator mx-3 my-2 px-3 py-2"
        >
          <div className="flex items-center gap-2.5">
            <BrainCircuit size={14} style={{ color: 'var(--accent-primary)' }} />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {aiName}
              </span>
              <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>
                {working ? 'travaille…' : muted ? 'muet' : 'prêt'}
              </span>
            </div>
            <StatusBadge
              status={working ? 'running' : muted ? 'paused' : 'connected'}
              dotOnly
              pulse={working}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
