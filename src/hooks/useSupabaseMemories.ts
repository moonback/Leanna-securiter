import { useState, useEffect, useCallback } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../utils/supabaseClient.js';

interface Memory {
  id: string;
  content: string;
  created_at: string;
}

export function useSupabaseMemories() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSupabase(getSupabaseClient());
    } catch (e: any) {
      console.warn(e.message);
    }
  }, []);

  const fetchMemories = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('memories')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMemories(data || []);
    } catch (e: any) {
      setError(e.message);
      console.error("Erreur lors de la récupération des mémoires:", e);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const addMemory = useCallback(async (content: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase
        .from('memories')
        .insert([{ content }]);

      if (error) throw error;
      fetchMemories(); // Rafraîchir la liste
    } catch (e: any) {
      console.error("Erreur lors de l'ajout de la mémoire:", e);
    }
  }, [supabase, fetchMemories]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  return { memories, loading, error, refresh: fetchMemories, addMemory };
}
