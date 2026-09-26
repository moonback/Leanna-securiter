import { createContext, useContext } from 'react';
import type { useLiveAPI } from '../hooks/useLiveAPI.js';

// Re-export the return type of the hook as the context shape
export type LiveAPIContextValue = ReturnType<typeof useLiveAPI>;

export const LiveAPIContext = createContext<LiveAPIContextValue | null>(null);

export function useLiveAPIContext(): LiveAPIContextValue {
  const ctx = useContext(LiveAPIContext);
  if (!ctx) throw new Error('useLiveAPIContext must be used inside LiveAPIProvider');
  return ctx;
}
