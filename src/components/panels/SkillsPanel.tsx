import React from 'react';
import { motion } from 'motion/react';
import {
  Blocks, Clock, CloudRain, Github, Globe, Database,
  Monitor, Code, List, Brain, Zap,
} from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { Toggle } from '../ui/Toggle.js';

const iconMap: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  Clock, CloudRain, Github, Globe, Database,
  Monitor, Blocks, Code, List, Brain,
};

interface Skill {
  id: string;
  name: string;
  icon: string;
  status: string;
}

interface SkillsPanelProps {
  skills: Skill[];
  enabledSkills: Record<string, boolean>;
  onToggle: (id: string) => void;
}

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  const isConfigured = status === 'active' || status === 'authenticated';

  const label = !isConfigured ? 'Auth requise' : enabled ? 'Actif' : 'Inactif';
  const color = !isConfigured
    ? 'var(--color-warning, var(--color-warning))'
    : enabled
      ? 'var(--color-success, var(--color-success))'
      : 'var(--text-dimmed)';

  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

export const SkillsPanel = React.memo(function SkillsPanel({ skills, enabledSkills, onToggle }: SkillsPanelProps) {
  const activeCount = skills.filter(s =>
    (s.status === 'active' || s.status === 'authenticated') && enabledSkills[s.id] !== false
  ).length;

  return (
    <Panel
      title="Skills"
      icon={<Zap className="w-4 h-4" />}
      actions={
        <span
          className="text-xs font-mono px-2 py-0.5 rounded-full"
          style={{
            color: 'var(--color-success, var(--color-success))',
            backgroundColor: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.25)',
          }}
        >
          {activeCount}/{skills.length} actifs
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {skills.map((skill, i) => {
          const Icon = iconMap[skill.icon] || Blocks;
          const isConfigured = skill.status === 'active' || skill.status === 'authenticated';
          const isEnabled = isConfigured && enabledSkills[skill.id] !== false;

          return (
            <motion.div
              key={skill.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
              className="group flex flex-col items-center gap-2 px-3 py-3 rounded-xl transition-all duration-150"
              style={{
                backgroundColor: isEnabled ? 'var(--bg-secondary)' : 'transparent',
                border: `1px solid ${isEnabled ? 'var(--border-strong)' : 'var(--border-base)'}`,
              }}
            >
              {/* Icon */}
              <div
                className="p-2 rounded-lg flex-shrink-0 transition-colors duration-150"
                style={{
                  backgroundColor: isEnabled ? 'var(--accent-subtle, rgba(14,165,233,0.1))' : 'var(--bg-secondary)',
                  color: isEnabled ? 'var(--accent-primary)' : 'var(--text-muted)',
                }}
              >
                <Icon className="w-4 h-4" />
              </div>

              {/* Name */}
              <span
                className="text-xs font-medium text-center truncate w-full"
                style={{ color: isEnabled ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                {skill.name}
              </span>

              {/* Toggle or configure */}
              {isConfigured ? (
                <Toggle
                  checked={isEnabled}
                  onChange={() => onToggle(skill.id)}
                  aria-label={`Toggle ${skill.name}`}
                />
              ) : (
                <span
                  className="text-sm font-medium px-2 py-1 rounded-lg"
                  style={{
                    color: 'var(--text-dimmed)',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-base)',
                  }}
                >
                  Configurer
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
});
