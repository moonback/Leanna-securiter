import { useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Palette, Check, Moon, Sun, Zap, BookOpen, Eye } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { Section, Field, ToggleSwitch } from './SettingsPrimitives.js';
import { ACCENTS } from './constants.js';

// Additional accent colors with labels
const EXTENDED_ACCENTS = [
  ...ACCENTS,
  { label: 'Indigo', value: 'var(--color-accent-alt)' },
  { label: 'Teal',   value: 'var(--color-info)' },
  { label: 'Orange', value: 'var(--color-warning)' },
];

export function AppearanceSection() {
  const { profile, setField } = useProfile();

  const applyAccent = useCallback((color: string) => {
    setField('accentColor', color);
    document.documentElement.style.setProperty('--accent-primary', color);
  }, [setField]);

  return (
    <Section
      icon={Palette}
      title="Apparence"
      description="Personnalisez le thème, la couleur d'accent et les éléments d'interface"
    >
      {/* Theme */}
      <Field label="Thème d'interface">
        <div role="radiogroup" aria-label="Thème" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {([
            { id: 'dark',          label: 'Sombre',        icon: Moon,     desc: 'Idéal pour la nuit' },
            { id: 'light',         label: 'Clair',         icon: Sun,      desc: 'Lumineux et épuré' },
            { id: 'cyberpunk',     label: 'Cyberpunk',     icon: Zap,      desc: 'Néon futuriste' },
            { id: 'sepia',         label: 'Lecture Sepia', icon: BookOpen, desc: 'Chaud & confortable' },
            { id: 'high-contrast', label: 'Haut Contraste',icon: Eye,      desc: 'Accessibilité optimale' },
          ] as const).map(t => {
            const isActive = profile.theme === t.id;
            return (
              <motion.button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  setField('theme', t.id);
                  document.documentElement.setAttribute('data-theme', t.id);
                }}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-200"
                style={{
                  backgroundColor: isActive ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                  border: `1.5px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-base)'}`,
                  boxShadow: isActive ? '0 2px 8px color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'none',
                }}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-lg flex-shrink-0"
                  style={{ backgroundColor: isActive ? 'var(--accent-primary)' : 'var(--bg-panel)' }}>
                  <t.icon className="h-3.5 w-3.5" style={{ color: isActive ? 'white' : 'var(--text-muted)' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate"
                    style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                    {t.label}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-dimmed)' }}>{t.desc}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </Field>

      {/* Accent color */}
      <Field label="Couleur d'accent" hint="Appliquée immédiatement à toute l'interface.">
        <div className="flex flex-wrap gap-2.5 items-center">
          {EXTENDED_ACCENTS.map(a => {
            const isActive = profile.accentColor === a.value;
            return (
              <div key={`${a.label}-${a.value}`} className="relative flex flex-col items-center gap-1">
                <motion.button
                  type="button"
                  onClick={() => applyAccent(a.value)}
                  whileHover={{ scale: 1.15, y: -2 }}
                  whileTap={{ scale: 0.9 }}
                  className="relative w-8 h-8 rounded-full flex-shrink-0 transition-all duration-200"
                  style={{
                    backgroundColor: a.value,
                    outline: isActive ? `3px solid ${a.value}` : 'none',
                    outlineOffset: 2.5,
                    boxShadow: isActive ? `0 4px 12px ${a.value}66` : `0 2px 6px ${a.value}33`,
                  }}
                  aria-label={`Accent ${a.label}`}
                  title={a.label}
                >
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <Check className="w-3.5 h-3.5 text-white drop-shadow-sm" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
                <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{a.label}</span>
              </div>
            );
          })}
        </div>
      </Field>

      {/* Floating Orb toggle */}
      <div className="pt-1" style={{ borderTop: '1px solid var(--border-base)' }}>
        <ToggleSwitch
          value={profile.floatingOrb}
          onChange={v => setField('floatingOrb', v)}
          label="Orb flottant"
          hint="Bouton déplaçable pour contrôler Leanna depuis n'importe quelle page"
        />
      </div>
    </Section>
  );
}
