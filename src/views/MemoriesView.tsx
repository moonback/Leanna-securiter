import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BrainCircuit, Search, Trash2, RefreshCw } from 'lucide-react';
import { useToast } from '../components/ui/Toast.js';
import { ViewHeader } from '../components/ui/ViewHeader.js';

interface Memory { id: string; content: string; created_at: string; }

function timeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (days > 0)  return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (hours > 0) return `Il y a ${hours}h`;
  if (mins > 0)  return `Il y a ${mins}m`;
  return 'À l\'instant';
}

export default function MemoriesView() {
  const { success, error: toastError } = useToast();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/memories')
      .then(r => r.json())
      .then(d => setMemories(d.memories || []))
      .catch(() => toastError('Impossible de charger les souvenirs'))
      .finally(() => setLoading(false));
  }, [toastError]);

  useEffect(() => { load(); }, [load]);

  const filtered = memories.filter(m =>
    query.length === 0 || m.content.toLowerCase().includes(query.toLowerCase())
  );

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setMemories(prev => prev.filter(m => m.id !== id));
      success('Souvenir supprimé');
    } catch {
      toastError('Impossible de supprimer le souvenir');
    } finally {
      setDeleting(null);
    }
  }, [success, toastError]);

  return (
    <div
      className="h-full flex flex-col"
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      {/* Header */}
      <ViewHeader
        icon={BrainCircuit}
        title="Mémoire"
        badge="Mémoire active"
        description="Les informations importantes retenues par Leanna"
        actions={
          <>
            <span className="hidden text-[10px] sm:inline" style={{ color: 'var(--text-muted)' }}>{memories.length} {memories.length === 1 ? 'entrée' : 'entrées'}</span>
            <button
              type="button"
              onClick={load}
              className="rounded-lg p-2 transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Rafraîchir les souvenirs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      {/* Search */}
      <div className="px-8 py-4 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher des souvenirs..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
            }}
            onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border-focus)'; }}
            onBlur={e  => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border-base)';  }}
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <BrainCircuit className="w-8 h-8 animate-pulse" style={{ color: 'var(--text-dimmed)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement des souvenirs...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <BrainCircuit className="w-12 h-12" style={{ color: 'var(--text-dimmed)' }} />
            <p className="text-base font-medium" style={{ color: 'var(--text-muted)' }}>
              {query ? 'Aucune correspondance trouvée' : 'Aucun souvenir pour le moment'}
            </p>
            <p className="text-sm text-center max-w-xs" style={{ color: 'var(--text-dimmed)' }}>
              {query
                ? 'Essayez un autre terme de recherche.'
                : 'Parlez à Leanna — il se souviendra automatiquement des informations importantes vous concernant.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <AnimatePresence initial={false}>
              {filtered.map((memory, i) => (
                <motion.div
                  key={memory.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{    opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18, delay: i < 12 ? i * 0.03 : 0 }}
                  className="group relative p-4 rounded-2xl flex flex-col gap-2"
                  style={{
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border-base)',
                  }}
                >
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    {memory.content}
                  </p>
                  <div className="flex items-center justify-between mt-auto pt-1">
                    <span className="t-caption text-xs text-dimmed">{timeAgo(memory.created_at)}</span>
                    <motion.button
                      type="button"
                      onClick={() => handleDelete(memory.id)}
                      disabled={deleting === memory.id}
                      whileTap={{ scale: 0.9 }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all"
                      style={{ color: 'var(--color-error)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(239,68,68,0.1)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
                      aria-label="Supprimer le souvenir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
