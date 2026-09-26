import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Section } from './SettingsPrimitives.js';

interface TokenInfo {
  key: string; label: string; configured: boolean; valid: boolean | null; preview: string;
}

interface GeminiKeyInfo {
  index: number; label: string; preview: string; disabled: boolean;
}

export function TokensSection() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Gemini Key Pool state
  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyInfo[]>([]);
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [addingKey, setAddingKey] = useState(false);

  React.useEffect(() => { fetchTokens(); fetchGeminiKeys(); }, []);

  const fetchTokens = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tokens');
      const data = await res.json();
      if (data.status === 'success') setTokens(data.tokens);
    } catch { setTokens([]); }
    finally { setLoading(false); }
  };

  const fetchGeminiKeys = async () => {
    try {
      const res = await fetch('/api/gemini-keys');
      const data = await res.json();
      if (data.status === 'success') setGeminiKeys(data.keys);
    } catch { setGeminiKeys([]); }
  };

  const handleSave = async (key: string) => {
    setSaving(true); setFeedback(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: editValue }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setFeedback({ type: 'success', message: `${key} mis à jour` });
        setEditingKey(null); setEditValue(''); fetchTokens(); fetchGeminiKeys();
      } else { setFeedback({ type: 'error', message: data.error || 'Erreur' }); }
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur réseau' }); }
    finally { setSaving(false); }
  };

  const handleAddGeminiKey = async () => {
    if (!newKeyValue.trim()) return;
    setAddingKey(true); setFeedback(null);
    try {
      const res = await fetch('/api/gemini-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKeyValue.trim(), label: newKeyLabel.trim() || undefined }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setGeminiKeys(data.keys);
        setNewKeyValue(''); setNewKeyLabel(''); setShowAddKey(false);
        setFeedback({ type: 'success', message: 'Clé Gemini ajoutée au pool' });
      } else {
        setFeedback({ type: 'error', message: data.error || 'Erreur' });
      }
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur réseau' }); }
    finally { setAddingKey(false); }
  };

  const handleRemoveGeminiKey = async (index: number) => {
    try {
      const res = await fetch(`/api/gemini-keys/${index}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        setGeminiKeys(data.keys);
        setFeedback({ type: 'success', message: 'Clé supprimée du pool' });
      }
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur' }); }
  };

  const handleToggleGeminiKey = async (index: number) => {
    try {
      const res = await fetch(`/api/gemini-keys/${index}/toggle`, { method: 'PATCH' });
      const data = await res.json();
      if (data.status === 'success') setGeminiKeys(data.keys);
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Erreur' }); }
  };

  if (loading) {
    return (
      <Section icon={Key} title="Tokens & Clés API" description="Gérez vos clés d'API pour les services connectés">
        <div className="flex items-center justify-center py-6">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
            className="h-4 w-4 rounded-full border-2"
            style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      </Section>
    );
  }

  return (
    <Section icon={Key} title="Tokens & Clés API" description="Gérez vos clés d'API pour les services connectés">
      {/* ─── Gemini Key Pool ─── */}
      <div className="mb-4 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Pool de clés Gemini
            </span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Rotation automatique en cas de rate-limit (429)
            </p>
          </div>
          <motion.button type="button" onClick={() => setShowAddKey(!showAddKey)}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--accent-primary)' }}>
            <Plus size={10} /> Ajouter
          </motion.button>
        </div>

        {/* Add key form */}
        <AnimatePresence>
          {showAddKey && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="flex flex-col gap-2 mt-2 mb-3 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)' }}>
                <input type="text" value={newKeyLabel} onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder="Label (ex: Compte perso, Compte pro…)" 
                  className="rounded-lg px-2.5 py-1.5 text-sm outline-none"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
                <input type="password" value={newKeyValue} onChange={e => setNewKeyValue(e.target.value)}
                  placeholder="Clé API Gemini (AIza…)" autoFocus
                  className="rounded-lg px-2.5 py-1.5 text-sm font-mono outline-none"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
                <div className="flex gap-2">
                  <motion.button type="button" onClick={handleAddGeminiKey} disabled={addingKey || !newKeyValue.trim()}
                    whileTap={{ scale: 0.95 }}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-primary)' }}>
                    {addingKey ? '…' : 'Ajouter au pool'}
                  </motion.button>
                  <button type="button" onClick={() => { setShowAddKey(false); setNewKeyValue(''); setNewKeyLabel(''); }}
                    className="rounded-lg px-2.5 py-1.5 text-sm font-medium"
                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}>
                    Annuler
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Key list */}
        {geminiKeys.length === 0 ? (
          <p className="text-sm py-2" style={{ color: 'var(--text-dimmed)' }}>
            Aucune clé dans le pool. La clé de l'environnement (.env) sera utilisée par défaut.
          </p>
        ) : (
          <div className="space-y-1.5">
            {geminiKeys.map((gk) => (
              <div key={gk.index} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                style={{ 
                  backgroundColor: gk.disabled ? 'color-mix(in srgb, var(--bg-primary) 50%, transparent)' : 'var(--bg-primary)', 
                  border: '1px solid var(--border-base)',
                  opacity: gk.disabled ? 0.6 : 1,
                }}>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium block truncate" style={{ color: 'var(--text-primary)' }}>
                    {gk.label}
                  </span>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                    {gk.preview}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => handleToggleGeminiKey(gk.index)}
                    title={gk.disabled ? 'Activer' : 'Désactiver'}
                    className="p-1 rounded transition-colors hover:bg-[color-mix(in_srgb,var(--text-muted)_10%,transparent)]">
                    {gk.disabled 
                      ? <ToggleLeft size={14} style={{ color: 'var(--text-muted)' }} />
                      : <ToggleRight size={14} style={{ color: 'var(--color-success)' }} />
                    }
                  </button>
                  <button type="button" onClick={() => handleRemoveGeminiKey(gk.index)}
                    title="Supprimer"
                    className="p-1 rounded transition-colors hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]">
                    <Trash2 size={12} style={{ color: 'var(--color-error)' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Other Tokens ─── */}
      <div className="grid grid-cols-2 gap-3 pr-1">
        {tokens.map(token => (
          <div key={token.key} className="rounded-xl p-3"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{token.label}</span>
              <span className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: !token.configured ? 'color-mix(in srgb, var(--color-error) 12%, transparent)'
                    : token.valid === true ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                    : token.valid === false ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                    : 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
                  color: !token.configured ? 'var(--color-error)'
                    : token.valid === true ? 'var(--color-success)'
                    : token.valid === false ? 'var(--color-warning)' : 'var(--text-muted)',
                }}>
                {!token.configured ? 'Non configuré' : token.valid === true ? '✓ Valide' : token.valid === false ? '✗ Invalide' : 'Vérification…'}
              </span>
            </div>
            {token.configured && editingKey !== token.key && (
              <p className="text-sm font-mono mb-2" style={{ color: 'var(--text-dimmed)' }}>{token.preview}</p>
            )}
            {editingKey === token.key ? (
              <div className="flex gap-2 mt-2">
                <input type="password" value={editValue} onChange={e => setEditValue(e.target.value)}
                  placeholder="Nouvelle valeur…" autoFocus
                  className="flex-1 rounded-lg px-2.5 py-1.5 text-sm outline-none"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
                <motion.button type="button" onClick={() => handleSave(token.key)} disabled={saving || !editValue.trim()}
                  whileTap={{ scale: 0.95 }}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent-primary)' }}>
                  {saving ? '…' : 'Enregistrer'}
                </motion.button>
                <button type="button" onClick={() => { setEditingKey(null); setEditValue(''); }}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-medium"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}>
                  Annuler
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => { setEditingKey(token.key); setEditValue(''); }}
                className="mt-1 text-sm font-medium transition-colors hover:underline"
                style={{ color: 'var(--accent-primary)' }}>
                {token.configured ? 'Modifier' : 'Configurer'}
              </button>
            )}
          </div>
        ))}
        <AnimatePresence>
          {feedback && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="col-span-2 rounded-lg px-3 py-2 text-xs font-medium"
              style={{
                backgroundColor: feedback.type === 'success' ? 'color-mix(in srgb, var(--color-success) 10%, transparent)' : 'color-mix(in srgb, var(--color-error) 10%, transparent)',
                color: feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                border: `1px solid ${feedback.type === 'success' ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : 'color-mix(in srgb, var(--color-error) 25%, transparent)'}`,
              }}>
              {feedback.type === 'success' ? '✓' : '✗'} {feedback.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Section>
  );
}
