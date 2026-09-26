import { motion } from 'motion/react';
import { Cpu, Volume2, Wand2 } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { Section, Field, TextInput } from './SettingsPrimitives.js';
import { VOICES } from './constants.js';

export function AiSection() {
  const { profile, setField } = useProfile();

  return (
    <Section
      icon={Cpu}
      title="Identité de l'IA"
      description="Personnalisez le nom et la voix de votre assistant"
    >
      <Field label="Nom de l'IA" hint="Comment l'assistant se présente dans chaque réponse.">
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <Wand2 className="h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
          </div>
          <TextInput
            value={profile.aiName}
            onChange={v => setField('aiName', v)}
            placeholder="Ex : Leanna"
            style={{ paddingLeft: '2rem' }}
          />
        </div>
      </Field>

      <Field label="Voix" hint="Voix utilisée pour la synthèse vocale Gemini Live.">
        <div className="grid grid-cols-3 gap-2 pr-1 sm:grid-cols-5">
          {VOICES.map(v => {
            const isActive = profile.aiVoice === v.id;
            return (
              <motion.button
                key={v.id}
                type="button"
                onClick={() => setField('aiVoice', v.id)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                className="flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-semibold transition-all duration-200"
                style={{
                  backgroundColor: isActive ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                  border: `1.5px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                  boxShadow: isActive ? '0 4px 12px color-mix(in srgb, var(--accent-primary) 20%, transparent)' : 'none',
                }}
              >
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200"
                  style={{ backgroundColor: isActive ? 'var(--accent-primary)' : 'var(--bg-panel)' }}
                >
                  <Volume2 className="w-3.5 h-3.5" style={{ color: isActive ? 'white' : 'var(--accent-primary)' }} />
                </div>
                <span className="text-sm font-semibold">{v.label}</span>
                <span className="text-xs font-normal text-center leading-tight opacity-70">{v.desc}</span>
              </motion.button>
            );
          })}
        </div>
      </Field>
    </Section>
  );
}
