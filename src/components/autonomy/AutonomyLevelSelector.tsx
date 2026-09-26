/**
 * AutonomyLevelSelector — sélecteur du niveau d'autonomie de l'IA.
 *
 * Contrôle unique et réutilisable (réglages « Garde-fous » et « Centre de
 * contrôle Autonomie »), pour que le niveau soit lisible ET modifiable partout
 * de la même façon.
 */

import { ChipGroup } from '../settings/SettingsPrimitives.js';
import type { AutonomyLevel } from '../../hooks/useSafeguardsConfig.js';

interface AutonomyLevelSelectorProps {
  value: AutonomyLevel;
  onChange: (level: AutonomyLevel) => void;
}

export const AUTONOMY_LEVEL_OPTIONS: { id: AutonomyLevel; label: string; desc: string }[] = [
  { id: 'manual', label: 'Manuel', desc: 'Valide chaque action' },
  { id: 'semi', label: 'Semi', desc: 'Agit, confirme le sensible' },
  { id: 'autonomous', label: 'Autonome', desc: 'Agit seule, garde-fous actifs' },
];

export function AutonomyLevelSelector({ value, onChange }: AutonomyLevelSelectorProps) {
  return (
    <ChipGroup<AutonomyLevel>
      value={value}
      onChange={onChange}
      options={AUTONOMY_LEVEL_OPTIONS}
      aria-label="Niveau d'autonomie de l'IA"
    />
  );
}
