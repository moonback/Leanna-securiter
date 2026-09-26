/**
 * AutomationPanel — Wrapper du AutomationView pour affichage inline dans l'IDE.
 * Prend toute la largeur et hauteur disponibles.
 * Le bouton fermer est en overlay sur le header du AutomationView.
 */
import { lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip.js';

const AutomationView = lazy(() => import('../../views/AutomationView.js'));

interface AutomationPanelProps {
  onClose: () => void;
}

export function AutomationPanel({ onClose }: AutomationPanelProps) {
  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Bouton fermer en overlay */}
      <Tooltip
        content="Fermer"
        as="button"
        onClick={onClose}
        className="absolute top-3 right-4 z-10 flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ctrl-hover)] border"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <X className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
      </Tooltip>

      {/* AutomationView prend tout l'espace */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full w-full">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement…</span>
          </div>
        }>
          <AutomationView />
        </Suspense>
      </div>
    </div>
  );
}
