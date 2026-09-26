import React, { useEffect, useRef } from 'react';

interface RenameInputProps {
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

/**
 * Input inline pour le renommage dans l'explorateur.
 * Double-clic sur un fichier/dossier → affiche ce composant à la place du label.
 */
export function RenameInput({ initialValue, onConfirm, onCancel }: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Sélectionne le nom sans l'extension pour faciliter l'édition
    const dotIdx = initialValue.lastIndexOf('.');
    el.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length);
  }, [initialValue]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = inputRef.current?.value.trim();
      if (val && val !== initialValue) onConfirm(val);
      else onCancel();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      defaultValue={initialValue}
      onKeyDown={handleKey}
      onBlur={() => {
        const val = inputRef.current?.value.trim();
        if (val && val !== initialValue) onConfirm(val);
        else onCancel();
      }}
      onClick={e => e.stopPropagation()}
      className="w-full rounded border px-1 py-0.5 text-sm outline-none"
      style={{
        backgroundColor: 'var(--bg-input, rgba(255,255,255,0.08))',
        borderColor: 'var(--accent-primary)',
        color: 'var(--text-primary)',
      }}
    />
  );
}
