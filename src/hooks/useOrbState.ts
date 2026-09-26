import { useState, useEffect } from 'react';
import { useLiveAPIContext } from '../context/LiveAPIContext.js';

export type OrbStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'busy' | 'online';

export interface OrbState {
  /** Raw connection status from the Live API */
  connectionStatus: 'idle' | 'connecting' | 'connected';
  isConnected: boolean;
  isConnecting: boolean;
  /** Derived high-level orb status */
  status: OrbStatus;
  /** Audio levels 0–1 */
  inputLevel: number;
  outputLevel: number;
  amp: number;
  isSpeaking: boolean;
  isListening: boolean;
  isBusy: boolean;
  /** Semantic accent colour for the current state */
  accentColor: string;
  /** Human-readable status label (FR) */
  statusLabel: string;
  /** Toggle connection on/off */
  toggleConnection: () => void;
  /** Microphone muted state */
  muted: boolean;
  /** Wake/unmute function */
  wake: () => void;
}

/**
 * Centralizes all orb state logic (connection, audio levels, accent, label).
 * Shared between the floating mini-orb and the large hub orb so both render
 * identically without duplicating the amplitude polling loop.
 */
export function useOrbState(): OrbState {
  const {
    status, connect, disconnect,
    getInputAmplitude, getOutputAmplitude, isBusy,
    muted, wake,
  } = useLiveAPIContext();

  const [levels, setLevels] = useState({ input: 0, output: 0 });

  useEffect(() => {
    if (status !== 'connected') {
      setLevels({ input: 0, output: 0 });
      return;
    }
    let active = true;
    const tick = () => {
      if (!active) return;
      setLevels({
        input: getInputAmplitude ? getInputAmplitude() : 0,
        output: getOutputAmplitude ? getOutputAmplitude() : 0,
      });
      requestAnimationFrame(tick);
    };
    const frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [status, getInputAmplitude, getOutputAmplitude]);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  const inputLevel = Math.min(1, Math.max(0, Number.isFinite(levels.input) ? levels.input : 0));
  const outputLevel = Math.min(1, Math.max(0, Number.isFinite(levels.output) ? levels.output : 0));
  const isSpeaking = isConnected && outputLevel > 0.035;
  const isListening = isConnected && !isSpeaking && inputLevel > 0.025;
  const amp = Math.max(inputLevel, outputLevel);

  const accentColor = isBusy
    ? 'var(--orb-busy, #fbbf24)'
    : isSpeaking
    ? 'var(--orb-speaking, #a78bfa)'
    : isConnected
    ? 'var(--orb-online, #0ea5e9)'
    : 'var(--orb-idle, #0ea5e9)';

  const status_: OrbStatus = isBusy
    ? 'busy'
    : isSpeaking
    ? 'speaking'
    : isListening
    ? 'listening'
    : isConnected
    ? 'online'
    : isConnecting
    ? 'connecting'
    : 'idle';

  const statusLabel = isBusy
    ? 'TRAITEMENT'
    : isSpeaking
    ? 'RÉPOND'
    : isListening
    ? 'ÉCOUTE'
    : isConnected
    ? 'EN LIGNE'
    : isConnecting
    ? 'CONNEXION...'
    : 'PRÊT';

  const toggleConnection = () => {
    if (isConnected) disconnect();
    else if (!isConnecting) {
      const savedMode = (typeof localStorage !== 'undefined' 
        ? localStorage.getItem('Leanna_mode') as 'full' | 'ask' 
        : null) || 'full';
      connect([], savedMode);
    }
  };

  return {
    connectionStatus: status,
    isConnected,
    isConnecting,
    status: status_,
    inputLevel,
    outputLevel,
    amp,
    isSpeaking,
    isListening,
    isBusy,
    accentColor,
    statusLabel,
    toggleConnection,
    muted,
    wake,
  };
}
