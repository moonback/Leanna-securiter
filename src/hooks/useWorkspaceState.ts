import { useState, useCallback, useEffect } from 'react';

export interface WorkspaceData {
  path: string;
  exists: boolean;
  selfReferential: boolean;
}

/**
 * Hook simplifié pour l'IDE .
 * Le workspace est verrouillé sur le propre code source de Leanna.
 * Plus de changement de workspace possible.
 */
export function useWorkspaceState() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('Leanna_api_token');
      const res = await fetch('/api/workspace', {
        headers: token ? { 'x-Leanna-token': token } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      setWorkspace({
        path: data.workspace,
        exists: data.exists,
        selfReferential: data.selfReferential ?? true,
      });
    } catch {
      setError('Impossible de récupérer le workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchWorkspace(); }, [fetchWorkspace]);

  return {
    workspace,
    loading,
    error,
    refresh: fetchWorkspace,
  };
}
