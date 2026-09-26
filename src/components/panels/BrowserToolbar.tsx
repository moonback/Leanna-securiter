import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
  Globe,
  Home,
  Loader2,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';
import type { RefObject } from 'react';

interface BrowserToolbarProps {
  pageTitle: string;
  assistantNavActive: boolean;
  currentUrl: string;
  inputValue: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onRefresh: () => void;
  onHome: () => void;
  onOpenExternal: () => void;
}

export function BrowserToolbar({
  pageTitle,
  assistantNavActive,
  currentUrl,
  inputValue,
  loading,
  canGoBack,
  canGoForward,
  onClose,
  inputRef,
  onInputChange,
  onInputKeyDown,
  onGoBack,
  onGoForward,
  onRefresh,
  onHome,
  onOpenExternal,
}: BrowserToolbarProps) {
  const secure = currentUrl.startsWith('https://');

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-base)' }}>
      <div className="flex items-center justify-between gap-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Globe size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={pageTitle || 'Navigateur'}>
            {pageTitle || 'Navigateur'}
          </span>
          {assistantNavActive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{
              backgroundColor: 'color-mix(in srgb, var(--color-accent-alt) 15%, transparent)',
              color: 'var(--color-accent-alt)',
              border: '1px solid color-mix(in srgb, var(--color-accent-alt) 30%, transparent)',
            }}>
              <Bot size={10} />
              Leanna
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-white/10 transition flex-shrink-0" title="Fermer le navigateur" aria-label="Fermer le navigateur">
          <X size={13} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton label="Page précédente" onClick={onGoBack} disabled={!canGoBack}><ArrowLeft size={13} /></ToolbarButton>
        <ToolbarButton label="Page suivante" onClick={onGoForward} disabled={!canGoForward}><ArrowRight size={13} /></ToolbarButton>
        <ToolbarButton label={loading ? 'Arrêter le chargement' : 'Actualiser'} onClick={onRefresh}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </ToolbarButton>
        <ToolbarButton label="Page d'accueil" onClick={onHome}><Home size={13} /></ToolbarButton>
        <ToolbarButton label="Ouvrir dans une nouvelle fenêtre" onClick={onOpenExternal}><ExternalLink size={13} /></ToolbarButton>

        <div className="flex flex-1 items-center gap-1 min-w-0 rounded-lg px-2 py-1" style={{
          backgroundColor: 'var(--bg-input, var(--bg-secondary))',
          border: `1px solid ${assistantNavActive ? 'rgba(139,92,246,0.5)' : 'var(--border-base)'}`,
          transition: 'border-color 0.2s',
        }}>
          {secure ? <Lock size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} aria-label="Connexion sécurisée" /> : <AlertTriangle size={11} style={{ color: 'var(--color-warning)', flexShrink: 0 }} aria-label="Connexion non sécurisée" />}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={event => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            className="flex-1 bg-transparent outline-none text-sm min-w-0"
            style={{ color: 'var(--text-primary)' }}
            placeholder="Entrez une URL ou une recherche…"
            aria-label="Barre d'adresse"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="p-1.5 rounded transition hover:bg-white/10 disabled:opacity-30" title={label} aria-label={label}>
      <span style={{ color: 'var(--text-muted)' }}>{children}</span>
    </button>
  );
}
