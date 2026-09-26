import { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Zap, Check, BrainCircuit, X } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { OPENROUTER_MODELS } from '../settings/OpenRouterSection.js';
import type { AIProvider } from '../../context/UserProfileContext.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';

interface ModelPickerModalProps {
  onClose: () => void;
  /** Rendu en panneau latéral docké (sans le chrome Modal). */
  docked?: boolean;
}

export const ModelPickerModal = memo(function ModelPickerModal({ onClose, docked = false }: ModelPickerModalProps) {
  const { profile, setField, save } = useProfile();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(profile.textProvider);
  const [selectedModel, setSelectedModel] = useState(profile.openrouterModel);

  const filteredModels = OPENROUTER_MODELS.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleConfirm = useCallback(() => {
    setField('textProvider', selectedProvider);
    if (selectedProvider === 'openrouter') {
      setField('openrouterModel', selectedModel);
    }
    save();
    onClose();
  }, [selectedProvider, selectedModel, setField, save, onClose]);

  const currentModelName = selectedProvider === 'openrouter'
    ? (OPENROUTER_MODELS.find(m => m.id === selectedModel)?.name || selectedModel.split('/').pop())
    : 'Gemini Live';

  const headerContent = (
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' }}
          >
            <BrainCircuit className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Changer de modèle
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Actuel : {currentModelName}
            </p>
          </div>
        </div>
  );

  const bodyContent = (
        <>
        {/* Provider Toggle */}
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'gemini' as AIProvider, label: '🔮 Gemini', desc: 'Google AI (Live voice)' },
              { id: 'openrouter' as AIProvider, label: '🌐 OpenRouter', desc: 'Modèles gratuits' },
            ]).map(p => {
              const active = selectedProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProvider(p.id)}
                  className="flex flex-col items-center p-3 rounded-xl text-xs font-semibold transition-all duration-200"
                  style={{
                    backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                    border: `1.5px solid ${active ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                    color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
                    boxShadow: active ? '0 2px 8px color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'none',
                  }}
                >
                  <span className="text-base mb-0.5">{p.label}</span>
                  <span className="text-xs opacity-70 font-normal">{p.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model content — AnimatePresence inside Modal.Body */}
        <AnimatePresence mode="wait">
          {selectedProvider === 'openrouter' && (
            <motion.div
              key="openrouter"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-col gap-2"
            >
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un modèle..."
                  className="w-full rounded-lg pl-8 pr-3 py-2 text-xs outline-none transition-all duration-200"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                  autoFocus
                  aria-label="Rechercher un modèle"
                />
              </div>

              {/* Models list */}
              <div className="overflow-y-auto max-h-52 space-y-1 pr-1 custom-scrollbar">
                {filteredModels.map(model => {
                  const active = selectedModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setSelectedModel(model.id)}
                      className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-left transition-all duration-150"
                      style={{
                        backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                        border: `1.5px solid ${active ? 'var(--accent-primary)' : 'transparent'}`,
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold truncate" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {model.name}
                          </span>
                          {model.free && (
                            <span
                              className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}
                            >
                              <Zap size={8} /> GRATUIT
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{model.provider}</span>
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>·</span>
                          <span className="text-xs truncate" style={{ color: 'var(--text-dimmed)' }}>{model.desc}</span>
                        </div>
                      </div>
                      {active && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                    </button>
                  );
                })}
                {filteredModels.length === 0 && (
                  <div className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    Aucun modèle trouvé
                  </div>
                )}
              </div>

              {/* Custom ID */}
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Ou ID personnalisé :
                </label>
                <input
                  type="text"
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  placeholder="ex: anthropic/claude-sonnet-4"
                  className="w-full rounded-lg px-3 py-1.5 text-sm font-mono outline-none transition-all duration-200"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                  aria-label="ID de modèle personnalisé"
                />
              </div>
            </motion.div>
          )}

          {selectedProvider === 'gemini' && (
            <motion.div key="gemini" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
                <div className="text-2xl mb-2">🔮</div>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Gemini 2.0 Flash (Live)</p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  Supporte la voix en temps réel, le texte et l'analyse de code.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </>
  );

  const footerHint = (
        <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
          💡 La voix Live utilise toujours Gemini.
        </p>
  );

  const footerActions = (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="primary" size="sm" onClick={handleConfirm}>Appliquer</Button>
        </div>
  );

  // ── Rendu docké (panneau latéral, sans chrome Modal) ────────────────────────
  if (docked) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-base)' }}
        >
          {headerContent}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Fermer"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 py-3">
          {bodyContent}
        </div>

        <div
          className="flex flex-col gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border-base)' }}
        >
          {footerHint}
          {footerActions}
        </div>
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} size="md" tone="default">
      <Modal.Header>
        {headerContent}
      </Modal.Header>

      <Modal.Body>
        {bodyContent}
      </Modal.Body>

      <Modal.Footer align="between">
        {footerHint}
        {footerActions}
      </Modal.Footer>
    </Modal>
  );
});
