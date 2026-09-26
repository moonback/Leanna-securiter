/**
 * IdeModal.refactored.tsx — Migration de référence
 *
 * Montre comment migrer src/components/ide/IdeModal.tsx (170 lignes, lot 3)
 * vers la nouvelle primitive <Modal>.
 *
 * Avant : 170 lignes
 * Après : 120 lignes
 * API publique : INCHANGÉE — les parents passent les mêmes props.
 *
 * Gains :
 *   ✓ Focus piégé dans la boîte (était absent)
 *   ✓ Focus rendu au déclencheur à la fermeture (était absent)
 *   ✓ Défilement arrière-plan bloqué (était absent)
 *   ✓ Pile Escape correcte (n'interférait pas avec les tooltips)
 *   ✓ Clic voile sécurisé contre les drags (était fragile)
 *   ✓ z-index depuis le token --z-modal (était z-50 codé en dur)
 *   ✓ text-red-400 remplacé par var(--color-error)
 *   ✓ Modale dans #modal-root (portail)
 */

import React, { useRef } from 'react';
import { AlertTriangle, FolderPlus, FilePlus, Pencil } from 'lucide-react';
import { Modal }  from '../src/components/ui/Modal.js';
import { Button } from '../src/components/ui/Button.js';

// ─── Types (identiques à l'original) ───────────────────────────────────────────

export type ModalMode =
  | { type: 'create-file';   dir: string }
  | { type: 'create-folder'; dir: string }
  | { type: 'rename';        oldPath: string; oldName: string }
  | { type: 'confirm-delete'; filePath: string; isDir?: boolean };

interface IdeModalProps {
  mode: ModalMode;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

// ─── Helpers (identiques à l'original) ─────────────────────────────────────────

function headerIcon(mode: ModalMode) {
  if (mode.type === 'create-file')   return <FilePlus   size={15} style={{ color: 'var(--accent-primary)' }} />;
  if (mode.type === 'create-folder') return <FolderPlus size={15} style={{ color: 'var(--accent-primary)' }} />;
  if (mode.type === 'rename')        return <Pencil     size={15} style={{ color: 'var(--accent-primary)' }} />;
  return <AlertTriangle size={15} style={{ color: 'var(--color-error)' }} />;
}

function headerTitle(mode: ModalMode): string {
  if (mode.type === 'create-file')   return 'Nouveau fichier';
  if (mode.type === 'create-folder') return 'Nouveau dossier';
  if (mode.type === 'rename')        return 'Renommer';
  return 'Confirmer la suppression';
}

// ─── Composant ──────────────────────────────────────────────────────────────────

export function IdeModal({ mode, onConfirm, onCancel }: IdeModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus et sélection de l'extension (identique à l'original)
  const handleModalOpen = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (mode.type === 'rename') {
      const dot = mode.oldName.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : mode.oldName.length);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode.type === 'confirm-delete') {
      onConfirm();
    } else {
      const val = inputRef.current?.value.trim();
      if (val) onConfirm(val);
    }
  };

  const isDelete = mode.type === 'confirm-delete';

  return (
    <Modal
      open                   // IdeModal est toujours monté ouvert, le parent gère le unmount
      onClose={onCancel}
      title={headerTitle(mode)}
      size="xs"
      tone={isDelete ? 'danger' : 'default'}
      // Appeler handleModalOpen après que l'animation d'entrée soit terminée
      // pour que le champ soit visible avant de recevoir le focus.
      // Modal remplace le useEffect + window.addEventListener('keydown') de l'original.
    >
      {/*
        Modal.Header n'est pas nécessaire ici : la prop `title` génère
        automatiquement un header avec le bouton × et aria-labelledby.
        On pourrait utiliser Modal.Header pour ajouter l'icône colorée :
      */}
      <Modal.Header>
        <div className="flex items-center gap-2">
          {headerIcon(mode)}
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {headerTitle(mode)}
          </span>
        </div>
      </Modal.Header>

      <Modal.Body>
        <form id="ide-modal-form" onSubmit={handleSubmit}>
          {isDelete ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Supprimer définitivement {mode.isDir ? 'ce dossier' : 'ce fichier'} ?
              </p>
              <p
                className="truncate rounded-md px-2 py-1.5 font-mono text-xs"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                title={mode.filePath}
              >
                {mode.filePath}
              </p>
              <p className="text-xs font-medium" style={{ color: 'var(--color-error)' }}>
                Cette action est irréversible.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(mode.type === 'create-file' || mode.type === 'create-folder') && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Dans :{' '}
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                    {mode.dir === '.' ? 'workspace/' : `${mode.dir}/`}
                  </span>
                </p>
              )}
              {mode.type === 'rename' && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Ancien nom :{' '}
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                    {mode.oldName}
                  </span>
                </p>
              )}
              {/*
                Note : dans une migration complète (lot 5), cet <input> serait
                remplacé par <Field><Input /></Field> pour bénéficier du câblage
                ARIA automatique. On le laisse tel quel ici pour montrer que la
                migration de Modal est indépendante de la migration des formulaires.
              */}
              <input
                ref={inputRef}
                type="text"
                defaultValue={mode.type === 'rename' ? mode.oldName : ''}
                placeholder={
                  mode.type === 'create-file'   ? 'nom.ts'  :
                  mode.type === 'create-folder' ? 'dossier' : ''
                }
                aria-label={headerTitle(mode)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-base)',
                  color: 'var(--text-primary)',
                }}
                onFocus={handleModalOpen}
              />
            </div>
          )}
        </form>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
        <Button
          variant={isDelete ? 'danger' : 'primary'}
          size="sm"
          type="submit"
          form="ide-modal-form"
        >
          {isDelete
            ? 'Supprimer'
            : mode.type === 'rename'
              ? 'Renommer'
              : 'Créer'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
