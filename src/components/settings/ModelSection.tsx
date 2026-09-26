import { motion } from 'motion/react';
import { SlidersHorizontal, Zap, Scale, Lightbulb } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { Section, Field, SectionDivider } from './SettingsPrimitives.js';

interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  hint: string;
  lowLabel?: string;
  highLabel?: string;
}

function Slider({ value, onChange, min, max, step, label, hint, lowLabel, highLabel }: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => onChange(parseFloat(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, var(--accent-primary) ${percent}%, var(--bg-secondary) ${percent}%)`,
            }}
          />
          <motion.span
            key={value}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            className="min-w-[3.2rem] rounded-lg px-2 py-0.5 text-center text-xs font-mono font-bold"
            style={{
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent-primary)',
              border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)',
            }}
          >
            {value.toFixed(2)}
          </motion.span>
        </div>
        {(lowLabel || highLabel) && (
          <div className="flex justify-between px-0.5">
            {lowLabel && <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{lowLabel}</span>}
            {highLabel && <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{highLabel}</span>}
          </div>
        )}
      </div>
    </Field>
  );
}

const PRESETS = [
  { label: 'Précis',     icon: Zap,       temp: 0.3,  topP: 0.80, color: 'var(--color-success)', desc: 'Factuel & fiable' },
  { label: 'Équilibré',  icon: Scale,     temp: 0.9,  topP: 0.95, color: 'var(--color-info)', desc: 'Polyvalent' },
  { label: 'Créatif',    icon: Lightbulb, temp: 1.4,  topP: 1.00, color: 'var(--color-accent-alt)', desc: 'Imaginatif' },
];

export function ModelSection() {
  const { profile, setField } = useProfile();

  return (
    <Section
      icon={SlidersHorizontal}
      title="Hyperparamètres du modèle"
      description="Contrôlez la créativité et la cohérence des réponses de l'IA"
    >
      <Slider
        label="Temperature"
        hint="Valeur basse = réponses prévisibles. Valeur haute = plus créatif et varié."
        value={profile.temperature}
        onChange={v => setField('temperature', v)}
        min={0} max={2} step={0.05}
        lowLabel="Prévisible (0)"
        highLabel="Créatif (2)"
      />
      <Slider
        label="Top P (nucleus sampling)"
        hint="Cumule les tokens les plus probables. 0.95 = bon équilibre diversité/cohérence."
        value={profile.topP}
        onChange={v => setField('topP', v)}
        min={0} max={1} step={0.05}
        lowLabel="Focalisé (0)"
        highLabel="Diversifié (1)"
      />

      <SectionDivider label="Presets rapides" />

      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map(preset => {
          const Icon = preset.icon;
          const isActive =
            Math.abs(profile.temperature - preset.temp) < 0.01 &&
            Math.abs(profile.topP - preset.topP) < 0.01;
          return (
            <motion.button
              key={preset.label}
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                setField('temperature', preset.temp);
                setField('topP', preset.topP);
              }}
              className="flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-semibold transition-all duration-200"
              style={{
                backgroundColor: isActive
                  ? `${preset.color}20`
                  : 'var(--bg-secondary)',
                border: `1.5px solid ${isActive ? preset.color : 'var(--border-base)'}`,
                color: isActive ? preset.color : 'var(--text-muted)',
                boxShadow: isActive ? `0 4px 12px ${preset.color}30` : 'none',
              }}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{ backgroundColor: isActive ? `${preset.color}25` : 'var(--bg-panel)' }}>
                <Icon className="h-3.5 w-3.5" style={{ color: isActive ? preset.color : 'var(--text-muted)' }} />
              </div>
              <span>{preset.label}</span>
              <span className="text-xs font-normal opacity-70">{preset.desc}</span>
            </motion.button>
          );
        })}
      </div>
    </Section>
  );
}
