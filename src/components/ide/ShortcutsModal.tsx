import React from 'react';
import { Keyboard } from 'lucide-react';
import { Modal } from '../ui/Modal.js';

interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { category: 'Général', items: [
    { label: 'Palette de commandes', key: 'Ctrl+Shift+P' },
    { label: 'Ouvrir un fichier', key: 'Ctrl+P' },
    { label: 'Sauvegarder', key: 'Ctrl+S' },
    { label: "Fermer l'onglet", key: 'Ctrl+W' },
  ]},
  { category: 'Éditeur', items: [
    { label: 'Recherche dans le fichier', key: 'Ctrl+F' },
    { label: 'Recherche globale', key: 'Ctrl+Shift+F' },
    { label: 'Formater le document', key: 'Shift+Alt+F' },
    { label: 'Aller à la ligne', key: 'Ctrl+G' },
  ]},
  { category: 'Panneaux', items: [
    { label: 'Explorateur', key: 'Ctrl+Shift+E' },
    { label: 'Contrôle de source', key: 'Ctrl+Shift+G' },
  ]},
  { category: 'Self-IDE (Auto-modification)', items: [
    { label: 'Créer un checkpoint', key: 'Ctrl+Shift+K' },
    { label: 'Lancer la validation (tsc)', key: 'Ctrl+Shift+B' },
    { label: 'Voir les checkpoints', key: 'Ctrl+Shift+H' },
    { label: 'Rollback dernier checkpoint', key: 'Ctrl+Shift+Z' },
  ]},
];

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <Modal open onClose={onClose} size="md" tone="default">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-subtle)' }}
          >
            <Keyboard className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Raccourcis clavier</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Commandes rapides de l'éditeur</p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-4">
          {SHORTCUTS.map(({ category, items }) => (
            <div key={category}>
              <p
                className="text-sm font-bold uppercase tracking-wider mb-2"
                style={{ color: 'var(--text-dimmed)' }}
              >
                {category}
              </p>
              <div className="space-y-1">
                {items.map(({ label, key }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                  >
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{label}</span>
                    <kbd
                      className="px-2 py-0.5 rounded text-sm font-mono font-medium"
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-base)',
                      }}
                    >
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal.Body>
    </Modal>
  );
}
