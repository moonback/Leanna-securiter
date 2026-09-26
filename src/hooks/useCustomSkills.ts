import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CustomSkillParam {
  name: string;
  type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ARRAY';
  description: string;
  required: boolean;
}

export interface CustomSkill {
  id: string;
  name: string;
  description: string;
  parameters: CustomSkillParam[];
  instruction: string;
  category: string;
  enabled: boolean;
  icon: string;
  created_at: string;
  updated_at: string;
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function listCustomSkills(): Promise<CustomSkill[]> {
  const res = await fetch('/api/custom-skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.skills ?? []) as CustomSkill[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Charge les skills custom (stockés en BDD) pour affichage/sélection dans le chat.
 * Par défaut ne retourne que les skills activés (enabled === true).
 */
export function useCustomSkills(options: { enabledOnly?: boolean } = {}) {
  const { enabledOnly = true } = options;
  const [skills, setSkills] = useState<CustomSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const all = await listCustomSkills();
      setSkills(enabledOnly ? all.filter(s => s.enabled) : all);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [enabledOnly]);

  useEffect(() => { reload(); }, [reload]);

  return { skills, loading, error, reload };
}
