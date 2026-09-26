import React from 'react';
import { useScreenShare } from '../context/ScreenShareContext.js';

/**
 * Composant d'affichage du partage d'écran.
 * Le stream est géré par ScreenShareProvider (persistant entre les pages).
 * Ce composant affiche l'état + le sélecteur de source.
 */
export function ScreenShareCapture() {
  const {
    isSharing,
    sources,
    showPicker,
    error,
    frameCount,
    selectSource,
    openSourcePicker,
  } = useScreenShare();

  return (
    <div
      className="relative rounded-xl overflow-hidden aspect-video flex items-center justify-center"
      style={{ border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-secondary)' }}
    >
      {/* Sélecteur de source */}
      {showPicker && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 p-3 overflow-y-auto bg-black/80 backdrop-blur-sm">
          <p className="text-xs font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
            Choisir la source à partager
          </p>
          <div className="grid grid-cols-2 gap-2">
            {sources.map(src => (
              <button
                key={src.id}
                onClick={() => selectSource(src.id)}
                className="flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors hover:border-purple-500/60"
                style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
              >
                <img
                  src={src.thumbnail}
                  alt={src.name}
                  className="w-full rounded object-cover aspect-video"
                />
                <span className="text-sm truncate w-full text-center" style={{ color: 'var(--text-muted)' }}>
                  {src.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Badge ÉCRAN LIVE */}
      {isSharing && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm text-purple-400 text-sm font-bold px-2 py-1 rounded-full border border-purple-500/30">
          <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" />
          ÉCRAN
        </div>
      )}

      {/* Compteur de frames */}
      {isSharing && frameCount > 0 && (
        <div className="absolute top-2 right-2 bg-black/40 backdrop-blur-sm text-green-400 text-sm font-mono px-2 py-1 rounded-full">
          {frameCount} frames
        </div>
      )}

      {/* Statut actif + bouton changer */}
      {isSharing && !showPicker && (
        <div className="flex flex-col items-center justify-center gap-2 p-4">
          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
            <div className="w-4 h-4 bg-purple-500 rounded-full animate-pulse" />
          </div>
          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            Partage d'écran actif
          </p>
          <button
            onClick={openSourcePicker}
            className="text-xs px-3 py-1 rounded-lg border transition-colors hover:border-purple-500/60"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
          >
            Changer de source
          </button>
        </div>
      )}

      {/* Message d'erreur */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-xs text-red-400 text-center px-4">{error}</p>
        </div>
      )}

      {/* Placeholder quand inactif */}
      {!isSharing && !error && !showPicker && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-xs text-center px-4" style={{ color: 'var(--text-muted)' }}>
            Chargement...
          </p>
        </div>
      )}
    </div>
  );
}
