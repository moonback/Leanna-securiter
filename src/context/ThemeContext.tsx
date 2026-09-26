/**
 * ThemeContext — thin compatibility shim.
 * Theme is now owned by UserProfileContext.
 * This file re-exports a useTheme hook that reads/writes through UserProfileContext
 * so legacy consumers (ThemeToggle, etc.) keep working without changes.
 */
import { useProfile } from './UserProfileContext.js';

export type Theme = 'dark' | 'light' | 'cyberpunk' | 'sepia' | 'high-contrast';

export function useTheme() {
  const { profile, setField } = useProfile();
  return {
    theme: profile.theme as Theme,
    setTheme: (newTheme: Theme) => {
      setField('theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
    },
    toggleTheme: () => {
      const themes: Theme[] = ['dark', 'light', 'cyberpunk', 'sepia', 'high-contrast'];
      const currentIndex = themes.indexOf(profile.theme as Theme);
      const next = themes[(currentIndex + 1) % themes.length];
      setField('theme', next);
      document.documentElement.setAttribute('data-theme', next);
    },
  };
}

// No-op provider kept so old import paths don't break
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import React from 'react';
