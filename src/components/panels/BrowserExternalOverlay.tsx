import { ExternalLink } from 'lucide-react';

interface BrowserExternalOverlayProps {
  onDismiss: () => void;
}

export function BrowserExternalOverlay({ onDismiss }: BrowserExternalOverlayProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ backgroundColor: 'var(--bg-panel)', zIndex: 'var(--z-sidepanel)' as any }}>
      <div className="flex flex-col items-center gap-4 p-6 rounded-lg" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)', maxWidth: '400px' }}>
        <ExternalLink size={64} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', opacity: 0.8 }} aria-hidden="true" />
        <h2 className="text-lg font-semibold" style={{ color: 'var(--accent-primary)' }}>
          Page ouverte dans une nouvelle fenêtre
        </h2>
        <p className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          Cette page a été ouverte dans votre navigateur par défaut.<br />
          Elle se rechargera automatiquement ici dès que vous fermez la fenêtre externe.
        </p>
        <button type="button" onClick={onDismiss} className="px-4 py-2 rounded-lg text-sm font-medium" style={{
          backgroundColor: 'var(--accent-primary)',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          transition: 'opacity 0.2s',
        }}>
          Fermer le message
        </button>
      </div>
    </div>
  );
}
