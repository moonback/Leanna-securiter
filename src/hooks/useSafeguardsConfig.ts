/**
 * useSafeguardsConfig — lecture/écriture de la configuration des garde-fous et
 * du niveau d'autonomie (`/api/safeguards/config`).
 *
 * Extrait pour être partagé entre `SafeguardsSection` (réglages détaillés) et le
 * « Centre de contrôle Autonomie » (vue consolidée), qui doivent refléter et
 * modifier le même état sans dupliquer la logique de fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type AutonomyLevel = 'manual' | 'semi' | 'autonomous';

export interface SafeguardsConfig {
  autoCheckpoint: boolean;
  postEditValidation: boolean;
  criticalFileConfirm: boolean;
  autoRestart: boolean;
  criticalFiles: string[];
  autonomyLevel?: AutonomyLevel;
}

export const DEFAULT_SAFEGUARDS_CONFIG: SafeguardsConfig = {
  autoCheckpoint: true,
  postEditValidation: true,
  criticalFileConfirm: true,
  autoRestart: true,
  criticalFiles: ['server.ts', 'server/security.ts', '.env', '.env.local', 'package.json'],
  autonomyLevel: 'manual',
};

interface UseSafeguardsConfigResult {
  config: SafeguardsConfig;
  loading: boolean;
  saving: boolean;
  /** Applique et persiste une mise à jour partielle de la configuration. */
  update: (patch: Partial<SafeguardsConfig>) => Promise<void>;
  reload: () => Promise<void>;
}

export function useSafeguardsConfig(): UseSafeguardsConfigResult {
  const [config, setConfig] = useState<SafeguardsConfig>(DEFAULT_SAFEGUARDS_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const hasFetched = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/safeguards/config');
      if (res.ok) {
        const data = await res.json();
        if (data.config) setConfig(data.config);
      }
    } catch {
      /* garde les valeurs par défaut */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void reload();
  }, [reload]);

  const update = useCallback(async (patch: Partial<SafeguardsConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...patch };
      // Persistance en tâche de fond ; l'UI reste réactive (optimiste).
      setSaving(true);
      fetch('/api/safeguards/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .catch(() => { /* silencieux — l'état local reste la source d'affichage */ })
        .finally(() => setSaving(false));
      return next;
    });
  }, []);

  return { config, loading, saving, update, reload };
}
