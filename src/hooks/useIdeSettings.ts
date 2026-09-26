import { useState, useCallback, useEffect } from 'react';
import { type IdeSettings, DEFAULT_IDE_SETTINGS } from '../types/ide.js';

/**
 * Hook for managing IDE settings with persistence
 */
export function useIdeSettings(appTheme?: string) {
  const [settings, setSettings] = useState<IdeSettings>(() => loadSettings());

  // Load settings from localStorage
  function loadSettings(): IdeSettings {
    try {
      const stored = localStorage.getItem('Leanna_ide_settings');
      return stored ? { ...DEFAULT_IDE_SETTINGS, ...JSON.parse(stored) } : DEFAULT_IDE_SETTINGS;
    } catch {
      return DEFAULT_IDE_SETTINGS;
    }
  }

  // Save settings to localStorage
  function saveSettings(newSettings: IdeSettings): void {
    try {
      localStorage.setItem('Leanna_ide_settings', JSON.stringify(newSettings));
    } catch (e) {
      console.error('Failed to save IDE settings:', e);
    }
  }

  // Update a single setting
  const updateSetting = useCallback(<K extends keyof IdeSettings>(
    key: K,
    value: IdeSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [settings]);

  // Sync Monaco theme with app theme
  useEffect(() => {
    if (appTheme) {
      const isDarkVariant = ['dark', 'cyberpunk', 'high-contrast'].includes(appTheme);
      const monacoTheme: IdeSettings['theme'] = isDarkVariant ? 'vs-dark' : 'vs';
      if (settings.theme !== monacoTheme) {
        const newSettings = { ...settings, theme: monacoTheme };
        setSettings(newSettings);
        saveSettings(newSettings);
      }
    }
  }, [appTheme, settings]);

  return {
    settings,
    updateSetting,
  };
}
