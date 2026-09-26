/**
 * LeannaIgnoreModal — Éditeur de la liste d'exclusion .leannaignore.
 *
 * Dossiers et motifs de fichiers que l'agent ne peut jamais modifier
 * (écriture, création, suppression, renommage). Ouvert depuis le header de
 * l'explorateur de fichiers. Persisté à la racine du projet actif via
 * /api/safeguards/ignore.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Ban, FolderLock, Save, ShieldOff } from 'lucide-react';
import { Modal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';

interface IgnoreRulePreview {
  pattern: string;
  negated: boolean;
}

interface LeannaIgnoreModalProps {
  open: boolean;
  onClose: () => void;
}

const PLACEHOLDER = `# Ex :
secrets/
config/*.prod.json
docs/**
!docs/CONTRIBUTING.md`;

export function LeannaIgnoreModal({ open, onClose }: LeannaIgnoreModalProps) {
  const { success, error } = useToast();

  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [rules, setRules] = useState<IgnoreRulePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noProject, setNoProject] = useState(false);

  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!open) {
      loadedOnce.current = false;
      return;
    }
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void fetchIgnore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchIgnore = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/safeguards/ignore');
      if (res.status === 409) {
        setNoProject(true);
        return;
      }
      if (res.ok) {
        setNoProject(false);
        const data = await res.json();
        setContent(data.content ?? '');
        setSaved(data.content ?? '');
        if (Array.isArray(data.rules)) setRules(data.rules);
      }
    } catch {
      /* réseau indisponible — on laisse l'éditeur vide */
    } finally {
      setLoading(false);
    }
  };

  const saveIgnore = async () => {
    if (noProject) return;
    setSaving(true);
    try {
      const res = await fetch('/api/safeguards/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.status === 409) {
        setNoProject(true);
        return;
      }
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      if (Array.isArray(data.rules)) setRules(data.rules);
      setSaved(content);
      success('Liste d\'exclusion enregistrée.');
    } catch {
      error('Échec de l\'enregistrement de la liste.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = content !== saved;

  return (
    <Modal open={open} onClose={onClose} size="lg" tone="warning" hideClose={false} title={undefined}>
      <Modal.Header>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' }}>
          <ShieldOff className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Chemins interdits à l'agent
          </h2>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            .leannaignore — dossiers et fichiers protégés en écriture
          </p>
        </div>
      </Modal.Header>

      <Modal.Body>
        {noProject ? (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-muted)',
            }}
          >
            <FolderLock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
            Sélectionnez d'abord un projet (workspace) pour définir sa liste d'exclusion.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Un chemin par ligne, relatif à la racine du projet. Format proche de{' '}
              <span className="font-mono">.gitignore</span> :{' '}
              <span className="font-mono">*</span> (un segment),{' '}
              <span className="font-mono">**</span> (récursif),{' '}
              <span className="font-mono">!</span> pour ré-autoriser une exception. Un dossier
              bloque tout son contenu.
            </p>

            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              rows={12}
              disabled={loading}
              placeholder={PLACEHOLDER}
              className="w-full rounded-xl px-3 py-2 text-xs font-mono outline-none transition-all duration-150 resize-y custom-scrollbar"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-base)',
                color: 'var(--text-primary)',
                minHeight: '14rem',
                opacity: loading ? 0.6 : 1,
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-subtle)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--border-base)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />

            {rules.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Règles interprétées ({rules.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {rules.map((r, i) => (
                    <span
                      key={`${r.pattern}-${i}`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-mono"
                      style={{
                        backgroundColor: r.negated
                          ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                          : 'color-mix(in srgb, var(--color-error) 10%, transparent)',
                        border: `1px solid ${r.negated
                          ? 'color-mix(in srgb, var(--color-success) 25%, transparent)'
                          : 'color-mix(in srgb, var(--color-error) 25%, transparent)'}`,
                        color: r.negated ? 'var(--color-success)' : 'var(--color-error)',
                      }}
                      title={r.negated ? 'Exception (ré-autorisé)' : 'Interdit en écriture'}
                    >
                      {r.negated ? <FolderLock className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                      {r.negated ? `!${r.pattern}` : r.pattern}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer align="between">
        <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
          {!noProject && dirty ? 'Modifications non enregistrées' : '\u00A0'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition-colors"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
            }}
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={saveIgnore}
            disabled={noProject || saving || !dirty}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-50"
            style={{
              backgroundColor: 'var(--accent-subtle)',
              border: '1px solid var(--accent-primary)',
              color: 'var(--accent-primary)',
            }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
