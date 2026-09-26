/**
 * useSidebarExpanded — Hook pour gérer l'état étendu/compact de la sidebar.
 * Persiste la préférence dans localStorage.
 */

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'Leanna_sidebar_expanded';

export function useSidebarExpanded(defaultExpanded = false) {
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? JSON.parse(stored) : defaultExpanded;
    } catch {
      return defaultExpanded;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
  }, [expanded]);

  const toggle = useCallback(() => setExpanded((v: boolean) => !v), []);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);

  return { expanded, toggle, expand, collapse, setExpanded };
}
