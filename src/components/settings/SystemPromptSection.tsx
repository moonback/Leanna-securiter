import { useState } from 'react';
import { motion } from 'motion/react';
import { FileText, RotateCcw, Copy, Check } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { Section, Field, SectionDivider } from './SettingsPrimitives.js';

export function SystemPromptSection() {
  const { profile, setField } = useProfile();
  const [copied, setCopied] = useState(false);

  const charCount = profile.customSystemPrompt?.length ?? 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(profile.customSystemPrompt || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setField('customSystemPrompt', '');
  };

  return (
    <Section
      icon={FileText}
      title="Prompt Système"
      description="Personnalisez les instructions système de votre assistant"
    >
      <Field
        label="Instructions personnalisées"
        hint="Ce texte sera ajouté au prompt système de base. Utilisez-le pour définir le comportement, le ton, ou les connaissances spécifiques de l'assistant."
      >
        <div className="flex flex-col gap-2">
          <div className="relative">
            <textarea
              value={profile.customSystemPrompt || ''}
              onChange={e => setField('customSystemPrompt', e.target.value)}
              placeholder="Ex : Tu es un expert en architecture logicielle. Tu privilégies toujours les design patterns SOLID. Tu réponds avec des exemples de code concrets..."
              rows={10}
              className="w-full rounded-xl px-3 py-2.5 text-xs font-mono outline-none transition-all duration-150 resize-y min-h-[160px]"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-base)',
                color: 'var(--text-primary)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
                lineHeight: '1.6',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-subtle)';
                e.currentTarget.style.backgroundColor = 'var(--bg-base)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--border-base)';
                e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)';
                e.currentTarget.style.backgroundColor = 'var(--bg-input)';
              }}
            />
          </div>

          {/* Actions bar */}
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-mono"
              style={{ color: charCount > 0 ? 'var(--text-muted)' : 'var(--text-dimmed)' }}
            >
              {charCount} caractère{charCount !== 1 ? 's' : ''}
            </span>

            <div className="flex items-center gap-1.5">
              <motion.button
                type="button"
                onClick={handleCopy}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={!charCount}
                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-all disabled:opacity-30"
                style={{
                  borderColor: 'var(--border-base)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-secondary)',
                }}
              >
                {copied ? <Check className="h-3 w-3" style={{ color: 'var(--color-success)' }} /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copié' : 'Copier'}
              </motion.button>

              <motion.button
                type="button"
                onClick={handleClear}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={!charCount}
                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-all disabled:opacity-30"
                style={{
                  borderColor: 'var(--border-base)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-secondary)',
                }}
              >
                <RotateCcw className="h-3 w-3" />
                Effacer
              </motion.button>
            </div>
          </div>
        </div>
      </Field>

      <SectionDivider label="Informations" />

      <div
        className="rounded-xl border p-3"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--accent-primary) 4%, var(--bg-secondary))',
          borderColor: 'var(--border-base)',
        }}
      >
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          💡 Le prompt personnalisé est <strong>ajouté</strong> aux instructions de base de l'assistant.
          Il ne remplace pas le comportement par défaut mais le complète.
          Utilisez-le pour spécialiser l'IA sur un domaine, ajuster son ton, ou lui donner des consignes spécifiques à votre projet.
        </p>
      </div>
    </Section>
  );
}
