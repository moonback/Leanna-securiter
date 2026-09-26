import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers, Database, Clock, HardDrive, Cloud, ArrowUpRight,
  Search, Plus, Trash2, RefreshCw, Tag, CheckCircle2,
  AlertCircle, Sparkles, Filter, X
} from 'lucide-react';
import { Section, Field } from './SettingsPrimitives.js';

export type HierarchicalTier = 'session' | 'project' | 'longterm';

export interface HierarchicalMemoryItem {
  id: string;
  tier: HierarchicalTier;
  content: string;
  category?: string;
  tags: string[];
  confidence?: number;
  createdAt: string | number;
  updatedAt: string | number;
  ttl?: number;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface HierarchicalStats {
  session: { count: number; capacity: number; status: 'active' | 'empty' };
  project: { count: number; status: 'active' | 'empty' };
  longterm: { count: number; status: 'connected' | 'disconnected' | 'empty'; error?: string };
  total: number;
}

const TIER_COLORS: Record<HierarchicalTier, { bg: string; border: string; text: string; label: string; icon: React.FC<any> }> = {
  session: {
    bg: 'color-mix(in srgb, #06b6d4 12%, transparent)',
    border: 'color-mix(in srgb, #06b6d4 35%, transparent)',
    text: '#06b6d4',
    label: 'Court-terme (Session)',
    icon: Clock,
  },
  project: {
    bg: 'color-mix(in srgb, #8b5cf6 12%, transparent)',
    border: 'color-mix(in srgb, #8b5cf6 35%, transparent)',
    text: '#a78bfa',
    label: 'Moyen-terme (Projet)',
    icon: HardDrive,
  },
  longterm: {
    bg: 'color-mix(in srgb, #10b981 12%, transparent)',
    border: 'color-mix(in srgb, #10b981 35%, transparent)',
    text: '#34d399',
    label: 'Long-terme (Supabase)',
    icon: Cloud,
  },
};

export function HierarchicalMemorySection() {
  const [stats, setStats] = useState<HierarchicalStats | null>(null);
  const [items, setItems] = useState<HierarchicalMemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<'all' | HierarchicalTier>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal / Formulaire d'ajout
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTier, setAddTier] = useState<HierarchicalTier>('session');
  const [addContent, setAddContent] = useState('');
  const [addCategory, setAddCategory] = useState('convention');
  const [addTags, setAddTags] = useState('');
  const [addConfidence, setAddConfidence] = useState(0.85);
  const [submitting, setSubmitting] = useState(false);

  const isLongtermConnected = stats?.longterm.status === 'connected' || stats?.longterm.status === 'empty' || (stats?.longterm.count ?? 0) > 0;

  // Charger les stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/hierarchical/stats');
      const data = await res.json();
      if (data.success && data.stats) {
        setStats(data.stats);
      }
    } catch (e: any) {
      console.error('Erreur chargement stats mémoire:', e);
    }
  }, []);

  // Charger les éléments (via search ou list)
  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      if (searchQuery.trim()) {
        const url = `/api/memory/hierarchical/search?query=${encodeURIComponent(searchQuery)}&tier=${selectedTier}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
          setItems(data.results || []);
        }
      } else {
        if (selectedTier === 'all') {
          // Charger session, project, longterm combinés
          const [sessRes, projRes, longRes] = await Promise.all([
            fetch('/api/memory/hierarchical/list?tier=session&limit=25').then(r => r.json()),
            fetch('/api/memory/hierarchical/list?tier=project&limit=25').then(r => r.json()),
            fetch('/api/memory/hierarchical/list?tier=longterm&limit=25').then(r => r.json()),
          ]);
          const combined = [
            ...(sessRes.items || []),
            ...(projRes.items || []),
            ...(longRes.items || []),
          ];
          setItems(combined);
        } else {
          const res = await fetch(`/api/memory/hierarchical/list?tier=${selectedTier}&limit=50`);
          const data = await res.json();
          if (data.success) {
            setItems(data.items || []);
          }
        }
      }
    } catch (e: any) {
      console.error('Erreur chargement éléments mémoire:', e);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedTier]);

  useEffect(() => {
    fetchStats();
    fetchItems();
  }, [fetchStats, fetchItems]);

  // Ajouter une mémoire
  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addContent.trim()) return;

    setSubmitting(true);
    setActionMessage(null);
    try {
      const tagsArray = addTags.split(',').map(t => t.trim()).filter(Boolean);
      const res = await fetch('/api/memory/hierarchical/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: addTier,
          content: addContent.trim(),
          category: addTier === 'project' ? addCategory : undefined,
          tags: tagsArray,
          confidence: addConfidence,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Mémoire ajoutée au palier '${TIER_COLORS[addTier].label}'.` });
        setShowAddModal(false);
        setAddContent('');
        setAddTags('');
        fetchStats();
        fetchItems();
      } else {
        setActionMessage({ type: 'error', text: data.error || "Erreur lors de l'ajout" });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Erreur réseau' });
    } finally {
      setSubmitting(false);
    }
  };

  // Promouvoir une mémoire
  const handlePromote = async (id: string, fromTier: 'session' | 'project', toTier: 'project' | 'longterm') => {
    setActionMessage(null);
    try {
      const res = await fetch('/api/memory/hierarchical/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          fromTier,
          toTier,
          removeSource: false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({
          type: 'success',
          text: `Mémoire promue de '${TIER_COLORS[fromTier].label}' vers '${TIER_COLORS[toTier].label}'.`,
        });
        fetchStats();
        fetchItems();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Erreur de promotion' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Erreur réseau' });
    }
  };

  // Supprimer une entrée
  const handleDelete = async (tier: HierarchicalTier, id: string) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cette mémoire ?')) return;
    try {
      const res = await fetch(`/api/memory/hierarchical/${tier}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: 'Entrée supprimée avec succès.' });
        fetchStats();
        fetchItems();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Erreur suppression' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Erreur réseau' });
    }
  };

  // Nettoyer un palier
  const handleClearTier = async (tier: HierarchicalTier) => {
    const tierName = TIER_COLORS[tier].label;
    if (!window.confirm(`Voulez-vous vraiment vider toutes les mémoires de '${tierName}' ? Cette action est irréversible.`)) return;

    try {
      const res = await fetch(`/api/memory/hierarchical/${tier}/clear`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Palier '${tierName}' vidé avec succès.` });
        fetchStats();
        fetchItems();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Erreur de nettoyage' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Erreur réseau' });
    }
  };

  // Date format helper
  const formatDate = (val: string | number) => {
    try {
      const d = typeof val === 'number' ? new Date(val) : new Date(val);
      return d.toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(val);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Notification Feedback ────────────────────────────────────────── */}
      <AnimatePresence>
        {actionMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-xl px-4 py-3 text-xs font-medium"
            style={{
              backgroundColor: actionMessage.type === 'success'
                ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                : 'color-mix(in srgb, var(--color-error) 12%, transparent)',
              border: `1px solid ${actionMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-error)'}`,
              color: actionMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            <div className="flex items-center gap-2">
              {actionMessage.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <span>{actionMessage.text}</span>
            </div>
            <button
              onClick={() => setActionMessage(null)}
              className="p-1 hover:opacity-80 transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 3 Paliers Synthétiques (Cartes Métriques) ────────────────────── */}
      <Section
        icon={Layers}
        title="Architecture de Mémoire Hiérarchique"
        description="Vue globale des 3 paliers cognitifs unifiés : Session (RAM), Projet (.project-memory.json) et Long-terme (Supabase)."
        badge={stats ? `${stats.total} mémoires actives` : undefined}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Card Court-terme (Session) */}
          <div
            className="rounded-2xl border p-4 flex flex-col justify-between relative overflow-hidden transition-all duration-200 hover:scale-[1.01]"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: TIER_COLORS.session.border,
            }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ backgroundColor: TIER_COLORS.session.bg }}
                >
                  <Clock className="h-4 w-4" style={{ color: TIER_COLORS.session.text }} />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                    Court-terme
                  </h3>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-dimmed)' }}>
                    RAM Volatile (Session)
                  </span>
                </div>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-mono font-bold"
                style={{ backgroundColor: TIER_COLORS.session.bg, color: TIER_COLORS.session.text }}
              >
                {stats?.session.count ?? 0}
              </span>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Éphémère et ultra-rapide. Retient les faits récents, le scratchpad et le contexte de conversation avec éviction LRU et TTL.
            </p>

            <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
                Capacité : {stats?.session.capacity ?? 500} max
              </span>
              <button
                type="button"
                onClick={() => handleClearTier('session')}
                className="text-[10px] font-semibold text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" /> Vider
              </button>
            </div>
          </div>

          {/* Card Moyen-terme (Projet) */}
          <div
            className="rounded-2xl border p-4 flex flex-col justify-between relative overflow-hidden transition-all duration-200 hover:scale-[1.01]"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: TIER_COLORS.project.border,
            }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ backgroundColor: TIER_COLORS.project.bg }}
                >
                  <HardDrive className="h-4 w-4" style={{ color: TIER_COLORS.project.text }} />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                    Moyen-terme
                  </h3>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-dimmed)' }}>
                    .project-memory.json
                  </span>
                </div>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-mono font-bold"
                style={{ backgroundColor: TIER_COLORS.project.bg, color: TIER_COLORS.project.text }}
              >
                {stats?.project.count ?? 0} faits
              </span>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Persisté dans le repo local. Architecture, conventions de style, décisions techniques et patterns avec recherche BM25.
            </p>

            <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
                Index BM25 actif
              </span>
              <button
                type="button"
                onClick={() => handleClearTier('project')}
                className="text-[10px] font-semibold text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" /> Vider
              </button>
            </div>
          </div>

          {/* Card Long-terme (Supabase) */}
          <div
            className="rounded-2xl border p-4 flex flex-col justify-between relative overflow-hidden transition-all duration-200 hover:scale-[1.01]"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: TIER_COLORS.longterm.border,
            }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ backgroundColor: TIER_COLORS.longterm.bg }}
                >
                  <Cloud className="h-4 w-4" style={{ color: TIER_COLORS.longterm.text }} />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                    Long-terme
                  </h3>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-dimmed)' }}>
                    Supabase + Embeddings
                  </span>
                </div>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-mono font-bold"
                style={{
                  backgroundColor: isLongtermConnected ? TIER_COLORS.longterm.bg : 'color-mix(in srgb, var(--color-error) 12%, transparent)',
                  color: isLongtermConnected ? TIER_COLORS.longterm.text : 'var(--color-error)',
                }}
              >
                {stats?.longterm.count ?? 0}
              </span>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Stockage cloud pérenne. Préférences utilisateur, profils et connaissances durables vectorisées (Gemini embedding 768d).
            </p>

            <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[10px] font-mono" style={{ color: isLongtermConnected ? 'var(--color-success)' : 'var(--text-muted)' }}>
                {isLongtermConnected ? '● Connecté (Cloud)' : '○ Non configuré'}
              </span>
              {isLongtermConnected && (
                <button
                  type="button"
                  onClick={() => handleClearTier('longterm')}
                  className="text-[10px] font-semibold text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Vider
                </button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Exploration & Recherche Multi-tiers ───────────────────────────── */}
      <Section
        icon={Database}
        title="Explorateur Multi-Paliers"
        description="Recherchez et gérez les connaissances à travers tous les niveaux de mémoire."
      >
        <div className="flex flex-col gap-4">
          {/* Barre de recherche et contrôles */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
              <input
                type="text"
                placeholder="Rechercher par mot-clé, concept ou convention…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl pl-9 pr-8 py-2 text-xs font-medium outline-none transition-all duration-200"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--text-primary)',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Bouton Nouvel Ajout & Rafraîchir */}
            <div className="flex items-center gap-2">
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => { fetchStats(); fetchItems(); }}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--text-muted)',
                }}
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Actualiser
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white transition-all shadow-sm"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une mémoire
              </motion.button>
            </div>
          </div>

          {/* Filtres par Palier */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedTier('all')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                selectedTier === 'all' ? 'border shadow-sm' : 'opacity-70 hover:opacity-100'
              }`}
              style={{
                backgroundColor: selectedTier === 'all' ? 'var(--accent-subtle)' : 'transparent',
                borderColor: selectedTier === 'all' ? 'var(--accent-primary)' : 'transparent',
                color: selectedTier === 'all' ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              Tous les paliers ({items.length})
            </button>

            {(['session', 'project', 'longterm'] as HierarchicalTier[]).map((tier) => {
              const cfg = TIER_COLORS[tier];
              const isSelected = selectedTier === tier;
              const Icon = cfg.icon;
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setSelectedTier(tier)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected ? 'border shadow-sm' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: isSelected ? cfg.bg : 'transparent',
                    borderColor: isSelected ? cfg.border : 'transparent',
                    color: isSelected ? cfg.text : 'var(--text-muted)',
                  }}
                >
                  <Icon className="h-3 w-3" />
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {/* Liste des Entrées */}
          <div className="flex flex-col gap-2.5 mt-1">
            {loading && (
              <div className="flex justify-center items-center py-8 text-xs text-muted">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                Recherche dans la mémoire hiérarchique…
              </div>
            )}

            {!loading && items.length === 0 && (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)' }}
              >
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--accent-primary)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Aucune mémoire trouvée
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {searchQuery ? "Aucun résultat ne correspond à votre requête." : "Ce palier ne contient aucune entrée pour le moment."}
                </p>
              </div>
            )}

            {!loading && items.map((item) => {
              const cfg = TIER_COLORS[item.tier];
              const Icon = cfg.icon;

              return (
                <motion.div
                  key={`${item.tier}_${item.id}`}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="rounded-2xl border p-4 flex flex-col gap-2.5 transition-all duration-200"
                  style={{
                    backgroundColor: 'var(--bg-panel)',
                    borderColor: 'var(--border-base)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ backgroundColor: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
                      >
                        <Icon className="h-2.5 w-2.5" />
                        {item.tier}
                      </span>

                      {item.category && (
                        <span
                          className="rounded-md px-2 py-0.5 text-[10px] font-mono font-medium"
                          style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}
                        >
                          {item.category}
                        </span>
                      )}

                      {item.confidence && (
                        <span className="text-[10px] font-mono text-emerald-400">
                          {Math.round(item.confidence * 100)}% conf
                        </span>
                      )}
                    </div>

                    {/* Actions de Promotion & Suppression */}
                    <div className="flex items-center gap-1.5">
                      {item.tier === 'session' && (
                        <>
                          <button
                            type="button"
                            title="Promouvoir vers Projet (Moyen-terme)"
                            onClick={() => handlePromote(item.id, 'session', 'project')}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all hover:scale-105"
                            style={{
                              backgroundColor: TIER_COLORS.project.bg,
                              color: TIER_COLORS.project.text,
                              border: `1px solid ${TIER_COLORS.project.border}`,
                            }}
                          >
                            <ArrowUpRight className="h-3 w-3" />
                            ➔ Projet
                          </button>

                          {isLongtermConnected && (
                            <button
                              type="button"
                              title="Promouvoir vers Supabase (Long-terme)"
                              onClick={() => handlePromote(item.id, 'session', 'longterm')}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all hover:scale-105"
                              style={{
                                backgroundColor: TIER_COLORS.longterm.bg,
                                color: TIER_COLORS.longterm.text,
                                border: `1px solid ${TIER_COLORS.longterm.border}`,
                              }}
                            >
                              <ArrowUpRight className="h-3 w-3" />
                              ➔ Supabase
                            </button>
                          )}
                        </>
                      )}

                      {item.tier === 'project' && isLongtermConnected && (
                        <button
                          type="button"
                          title="Promouvoir vers Supabase (Long-terme)"
                          onClick={() => handlePromote(item.id, 'project', 'longterm')}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all hover:scale-105"
                          style={{
                            backgroundColor: TIER_COLORS.longterm.bg,
                            color: TIER_COLORS.longterm.text,
                            border: `1px solid ${TIER_COLORS.longterm.border}`,
                          }}
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          ➔ Supabase
                        </button>
                      )}

                      <button
                        type="button"
                        title="Supprimer cette mémoire"
                        onClick={() => handleDelete(item.tier, item.id)}
                        className="p-1 rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Contenu textuel */}
                  <p className="text-xs font-normal leading-relaxed break-words" style={{ color: 'var(--text-primary)' }}>
                    {item.content}
                  </p>

                  {/* Tags et Timestamps */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap gap-1 items-center">
                      {item.tags.map((t) => (
                        <span
                          key={t}
                          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono"
                          style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-dimmed)' }}
                        >
                          <Tag className="h-2.5 w-2.5 opacity-60" />
                          {t}
                        </span>
                      ))}
                    </div>

                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
                      {formatDate(item.updatedAt || item.createdAt)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* ── Modal d'Ajout de Mémoire ─────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-lg rounded-2xl border p-5 shadow-2xl relative"
              style={{
                backgroundColor: 'var(--bg-panel)',
                borderColor: 'var(--border-base)',
              }}
            >
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-base)' }}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                    <Plus className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                    Ajouter une Mémoire
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="p-1 text-muted hover:text-primary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleAddMemory} className="mt-4 flex flex-col gap-4">
                {/* Choix du Tier */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Palier de destination
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['session', 'project', 'longterm'] as HierarchicalTier[]).map((tier) => {
                      const cfg = TIER_COLORS[tier];
                      const isSelected = addTier === tier;
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => setAddTier(tier)}
                          className={`flex flex-col items-center justify-center gap-1 p-2 rounded-xl border text-xs font-semibold transition-all ${
                            isSelected ? 'scale-[1.02] shadow-sm' : 'opacity-60 hover:opacity-100'
                          }`}
                          style={{
                            backgroundColor: isSelected ? cfg.bg : 'var(--bg-input)',
                            borderColor: isSelected ? cfg.border : 'var(--border-base)',
                            color: isSelected ? cfg.text : 'var(--text-muted)',
                          }}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="text-[11px] capitalize">{tier}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Contenu */}
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    Contenu de la mémoire *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Décrivez l'information de manière claire et autoportante…"
                    value={addContent}
                    onChange={(e) => setAddContent(e.target.value)}
                    className="w-full rounded-xl p-3 text-xs outline-none transition-all duration-200"
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-base)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                {/* Catégorie (si projet) */}
                {addTier === 'project' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                      Catégorie
                    </label>
                    <select
                      value={addCategory}
                      onChange={(e) => setAddCategory(e.target.value)}
                      className="w-full rounded-xl p-2 text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-base)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="convention">Convention de code</option>
                      <option value="architecture">Architecture & modules</option>
                      <option value="decision">Décision technique</option>
                      <option value="known-bug">Bug connu & workaround</option>
                      <option value="pattern">Pattern récurrent</option>
                    </select>
                  </div>
                )}

                {/* Tags */}
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    Tags (séparés par des virgules)
                  </label>
                  <input
                    type="text"
                    placeholder="ex: routing, state, preferences, auth"
                    value={addTags}
                    onChange={(e) => setAddTags(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-base)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                {/* Boutons d'action */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-base)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !addContent.trim()}
                    className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    {submitting ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
