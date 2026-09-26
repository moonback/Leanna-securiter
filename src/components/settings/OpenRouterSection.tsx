import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Globe, Zap, Check, AlertCircle, Search } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { Section, Field, SecretInput } from './SettingsPrimitives.js';
import type { AIProvider } from '../../context/UserProfileContext.js';

// ─── Tous les modèles gratuits OpenRouter ────────────────────────────────────
// Source : openrouter.ai/api/v1/models — vérifié le 03/08/2026

export const OPENROUTER_MODELS = [
  // ── Coding agents ─────────────────────────────────────────────────────────
  { id: 'openai/gpt-5.6-luna',                               name: 'GPT-5.6',               provider: 'Openai',      free: false, desc: 'MoE 72B-A7B, 128K contexte, excellent pour le code'},
  { id: 'z-ai/glm-5.3-flash',                                name: 'GLM 5.3 Flash',         provider: 'ZAI',         free: false, desc: 'Multimodal, efficace pour le code et les tâches agentiques, 1M ctx' },
  { id: 'deepseek/deepseek-v4-flash-0731',                   name: 'DeepSeek V4 Flash',     provider: 'DeepSeek',    free: false, desc: 'MoE 284B sparce, adapté code et raisonnement, GA release, 1.3M ctx' },
  { id: 'minimax/minimax-m3:free',                           name: 'MiniMax M3',            provider: 'MiniMax',     free: true,  desc: 'Multimodal, MSA sparse attention, rapide et économique, 1M ctx' },
  // { id: 'moonshotai/kimi-k3',                                name: 'Kimi K3',               provider: 'MoonshotIA',  free: false, desc: '118B-A8B coding agent — meilleur score code de Poolside, 262K ctx' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',            name: 'Nemotron 3 Ultra',       provider: 'NVIDIA',    free: true, desc: 'MoE 550B-A55B, 1M contexte, raisonnement & orchestration' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',            name: 'Nemotron 3 Super',       provider: 'NVIDIA',    free: true, desc: 'MoE 120B-A12B, 262K contexte, efficacité maximale' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',               name: 'Nemotron 3 Nano 30B',    provider: 'NVIDIA',    free: true, desc: 'MoE 30B-A3B, 256K contexte, très léger' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',name: 'Nemotron 3 Nano Omni',   provider: 'NVIDIA',    free: true, desc: 'Multimodal 30B-A3B avec raisonnement, 256K contexte' },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free',               name: 'Nemotron Nano 12B VL',   provider: 'NVIDIA',    free: true, desc: '12B vision-language, compréhension vidéo & raisonnement, 128K' },
  { id: 'nvidia/nemotron-nano-9b-v2:free',                   name: 'Nemotron Nano 9B',       provider: 'NVIDIA',    free: true, desc: '9B unifié LLM+raisonnement, 128K contexte' },
  { id: 'nvidia/nemotron-3.5-content-safety:free',           name: 'Nemotron 3.5 Safety',    provider: 'NVIDIA',    free: true, desc: '4B guardrail multimodal, modération de contenu, 128K' },
 // ── OpenAI open-weight ─────────────────────────────────────────────────────
  { id: 'openai/gpt-oss-20b:free',                           name: 'GPT-OSS 20B',            provider: 'OpenAI',    free: true, desc: '21B Apache 2.0, MoE, polyvalent, 131K contexte' },
  // ── Inclusion AI ───────────────────────────────────────────────────────────
  { id: 'inclusionai/ling-3.0-flash:free',                   name: 'Ling 3.0 Flash',         provider: 'InclusionAI', free: true, desc: 'MoE 124B-A5B, rapide et multilingue, 262K contexte' },
];

// ─── Modèles de génération d'images disponibles via OpenRouter ────────────────

export const OPENROUTER_IMAGE_MODELS = [
  { id: 'google/gemini-3.6-flash-image',       name: 'Gemini 2.5 Flash Image',    free: true,  desc: 'Google — génération d\'images rapide et gratuite' },
  { id: 'google/gemini-3.1-flash-image-preview',         name: 'Gemini 3.1 Flash Image Preview',      free: false, desc: 'Google — qualité supérieure, détails fins' },
  { id: 'bytedance-seed/seedream-4.5',         name: 'SeedReam 4.5',              free: true,  desc: 'ByteDance — haute qualité, rapide' },
  { id: 'black-forest-labs/flux-schnell',      name: 'FLUX Schnell',              free: true,  desc: 'Black Forest Labs — ultra-rapide, léger' },
  { id: 'black-forest-labs/flux-1.1-pro',      name: 'FLUX 1.1 Pro',              free: false, desc: 'Black Forest Labs — qualité pro' },
  { id: 'stabilityai/stable-diffusion-xl',     name: 'Stable Diffusion XL',       free: false, desc: 'Stability AI — SDXL, polyvalent' },
  { id: 'openai/dall-e-3',                     name: 'DALL·E 3',                  free: false, desc: 'OpenAI — compréhension textuelle avancée' },
];

export function OpenRouterSection() {
  const { profile, setField } = useProfile();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredModels = OPENROUTER_MODELS.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/openrouter/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: profile.openrouterApiKey,
          model: profile.openrouterModel,
        }),
      });
      const data = await res.json();
      setTestResult(data.status === 'success' ? 'success' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section icon={Globe} title="Multi-Modèle (OpenRouter)" description="Sélectionnez votre provider et modèle pour les requêtes texte/chat">
      {/* Provider Toggle */}
      <Field label="Provider de texte actif" hint="Gemini = Live voice + texte. OpenRouter = accès à 300+ modèles pour le texte.">
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: 'gemini' as AIProvider, label: '🔮 Gemini', desc: 'Google AI (Live voice)' },
            { id: 'openrouter' as AIProvider, label: '🌐 OpenRouter', desc: '300+ modèles' },
          ]).map(p => {
            const active = profile.textProvider === p.id;
            return (
              <motion.button
                key={p.id}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setField('textProvider', p.id)}
                className="flex flex-col items-center p-3 rounded-xl text-xs font-semibold transition-all duration-200"
                style={{
                  backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                  border: `1.5px solid ${active ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
                  boxShadow: active ? '0 2px 8px color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'none',
                }}
              >
                <span className="text-base mb-1">{p.label}</span>
                <span className="text-xs opacity-70 font-normal">{p.desc}</span>
              </motion.button>
            );
          })}
        </div>
      </Field>

      {/* OpenRouter Config */}
      <AnimatePresence>
        {profile.textProvider === 'openrouter' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden flex flex-col gap-4"
          >
            {/* API Key */}
            <Field label="Clé API OpenRouter" hint="Obtenez votre clé sur openrouter.ai/keys — les modèles gratuits fonctionnent sans crédit.">
              <div className="flex gap-2">
                <div className="flex-1">
                  <SecretInput
                    value={profile.openrouterApiKey}
                    onChange={v => setField('openrouterApiKey', v)}
                    placeholder="sk-or-v1-..."
                  />
                </div>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={testConnection}
                  disabled={testing || !profile.openrouterApiKey}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: testResult === 'success' ? 'var(--color-success)' : testResult === 'error' ? 'var(--color-error)' : 'var(--accent-primary)' }}
                >
                  {testing ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8 }} className="h-3 w-3 rounded-full border-2 border-white border-t-transparent" />
                  ) : testResult === 'success' ? (
                    <><Check size={12} /> OK</>
                  ) : testResult === 'error' ? (
                    <><AlertCircle size={12} /> Erreur</>
                  ) : (
                    'Tester'
                  )}
                </motion.button>
              </div>
            </Field>

            {/* Model Selector */}
            <Field label="Modèle" hint="Les modèles gratuits sont marqués ⚡. Les modèles payants nécessitent des crédits OpenRouter.">
              {/* Search */}
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un modèle..."
                  className="w-full rounded-lg pl-8 pr-3 py-2 text-xs outline-none transition-all duration-200"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Model Grid */}
              <div className="grid grid-cols-1 gap-1.5 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
                {filteredModels.map(model => {
                  const active = profile.openrouterModel === model.id;
                  return (
                    <motion.button
                      key={model.id}
                      type="button"
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setField('openrouterModel', model.id)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200"
                      style={{
                        backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                        border: `1.5px solid ${active ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                        boxShadow: active ? '0 0 0 2px color-mix(in srgb, var(--accent-primary) 10%, transparent)' : 'none',
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold truncate" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {model.name}
                          </span>
                          {model.free && (
                            <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}>
                              <Zap size={8} /> GRATUIT
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{model.provider}</span>
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>•</span>
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{model.desc}</span>
                        </div>
                      </div>
                      {active && (
                        <Check size={14} style={{ color: 'var(--accent-primary)' }} />
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </Field>

            {/* Custom Model ID */}
            <Field label="Ou entrez un ID de modèle personnalisé" hint="Consultez openrouter.ai/models pour la liste complète.">
              <input
                type="text"
                value={profile.openrouterModel}
                onChange={e => setField('openrouterModel', e.target.value)}
                placeholder="ex: anthropic/claude-sonnet-4"
                className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none transition-all duration-200"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
              />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info */}
      <div className="mt-2 rounded-xl p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent)' }}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          💡 <strong>Note :</strong> La voix Live utilise toujours Gemini. Le provider texte contrôle les requêtes de chat écrites et l'analyse de code.
        </p>
      </div>

      {/* Image Model for Infographics */}
      <Field label="🖼️ Modèle d'infographie" hint="Modèle OpenRouter utilisé pour la génération d'images/infographies dans les notebooks.">
        <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
          {OPENROUTER_IMAGE_MODELS.map(model => {
            const active = profile.openrouterImageModel === model.id;
            return (
              <motion.button
                key={model.id}
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setField('openrouterImageModel', model.id)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200"
                style={{
                  backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                  border: `1.5px solid ${active ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                  boxShadow: active ? '0 0 0 2px color-mix(in srgb, var(--accent-primary) 10%, transparent)' : 'none',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold truncate" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                      {model.name}
                    </span>
                    {model.free && (
                      <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}>
                        <Zap size={8} /> GRATUIT
                      </span>
                    )}
                  </div>
                  <span className="text-xs mt-0.5 block" style={{ color: 'var(--text-dimmed)' }}>{model.desc}</span>
                </div>
                {active && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
              </motion.button>
            );
          })}
        </div>
        <input
          type="text"
          value={profile.openrouterImageModel}
          onChange={e => setField('openrouterImageModel', e.target.value)}
          placeholder="ex: google/gemini-3.6-flash-image"
          className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-mono outline-none transition-all duration-200"
          style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
        />
      </Field>
    </Section>
  );
}
