/**
 * Breadcrumb — Fil d'Ariane pour la navigation de fichiers.
 * Affiche le chemin du fichier actif avec navigation cliquable.
 */

import React, { useMemo } from 'react';
import { ChevronRight, FolderOpen, FileText } from 'lucide-react';

interface BreadcrumbProps {
  /** Chemin du fichier actif */
  filePath: string | null;
  /** Handler au clic sur un segment */
  onNavigate?: (path: string) => void;
  /** Afficher le statut de sauvegarde */
  dirty?: boolean;
}

export function Breadcrumb({ filePath, onNavigate, dirty }: BreadcrumbProps) {
  const segments = useMemo(() => {
    if (!filePath) return [];
    return filePath.split(/[/\\]/).filter(Boolean);
  }, [filePath]);

  if (!filePath || segments.length === 0) {
    return (
      <div className="breadcrumb px-3 py-1.5">
        <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
          Aucun fichier ouvert
        </span>
      </div>
    );
  }

  const fileName = segments[segments.length - 1];
  const pathSegments = segments.slice(Math.max(0, segments.length - 4), -1);

  return (
    <nav className="breadcrumb px-3 py-1.5" aria-label="Fil d'Ariane">
      {/* Folder icon */}
      <FolderOpen size={11} style={{ color: 'var(--text-dimmed)' }} className="flex-shrink-0" />

      {/* Intermediate path segments */}
      {pathSegments.map((segment, i) => {
        const fullPath = segments.slice(0, segments.indexOf(segment) + 1).join('/');
        return (
          <React.Fragment key={i}>
            <ChevronRight size={9} className="breadcrumb-separator flex-shrink-0" />
            <button
              type="button"
              className="breadcrumb-item"
              onClick={() => onNavigate?.(fullPath)}
              title={fullPath}
            >
              {segment}
            </button>
          </React.Fragment>
        );
      })}

      {/* Current file */}
      <ChevronRight size={9} className="breadcrumb-separator flex-shrink-0" />
      <span className="breadcrumb-current inline-flex items-center gap-1.5">
        <FileText size={10} className="flex-shrink-0" />
        {fileName}
        {dirty && (
          <span
            className="w-[5px] h-[5px] rounded-full flex-shrink-0"
            style={{ backgroundColor: 'var(--color-warning)' }}
            title="Modifications non sauvegardées"
          />
        )}
      </span>
    </nav>
  );
}
