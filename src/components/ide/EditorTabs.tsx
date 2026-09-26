import React, { memo } from 'react';
import { motion } from 'motion/react';
import { X, Save, Map, WrapText, AlignJustify, Eye, Code, Sparkles, Globe } from 'lucide-react';
import { FileIcon } from './FileIcon.js';
import { fileName } from '../../utils/fileUtils.js';
import type { OpenFile } from '../../types/ide.js';

// Helper to extract hostname from URL for display
function getHostnameDisplay(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type EditorTabsProps = {
  openFiles: OpenFile[];
  activePath: string | null;
  showMinimap: boolean;
  wordWrap: boolean;
  activeFileDirty: boolean;
  markdownPreview: boolean;
  htmlPreview: boolean;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  onFormat: () => void;
  onToggleMinimap: () => void;
  onToggleWordWrap: () => void;
  onToggleMarkdownPreview: () => void;
  onToggleHtmlPreview: () => void;
  onOpenTemplates?: () => void;
};

export function EditorTabs({
  openFiles,
  activePath,
  showMinimap,
  wordWrap,
  activeFileDirty,
  markdownPreview,
  htmlPreview,
  onSelectTab,
  onCloseTab,
  onSave,
  onFormat,
  onToggleMinimap,
  onToggleWordWrap,
  onToggleMarkdownPreview,
  onToggleHtmlPreview,
  onOpenTemplates,
}: EditorTabsProps) {
  if (openFiles.length === 0) return null;

  const isMarkdownFile = activePath?.toLowerCase().endsWith('.md') ?? false;
  const isHtmlFile = activePath?.toLowerCase().endsWith('.html') ?? false;

  return (
    <div 
      className="flex items-center justify-between border-b select-none" 
      style={{ 
        height: '35px', 
        borderColor: 'var(--border-base)', 
        backgroundColor: 'var(--bg-sidebar)' 
      }}
    >
      {/* Scrollable Tabs List */}
      <div className="flex flex-1 h-full overflow-x-auto overflow-y-hidden custom-scrollbar">
        {openFiles.map((file) => {
          const isActive = activePath === file.path;
          const isBrowserTab = file.type === 'browser';
          const displayName = isBrowserTab && file.browserUrl 
            ? getHostnameDisplay(file.browserUrl) 
            : fileName(file.path);
          const tabTitle = isBrowserTab && file.browserUrl 
            ? file.browserUrl 
            : file.path;
          
          return (
            <div
              key={file.path}
              className="group flex items-center gap-2 h-full px-4 text-sm cursor-pointer relative border-r transition-all duration-150"
              style={{
                borderColor: 'var(--border-base)',
                backgroundColor: isActive ? 'var(--bg-base)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                minWidth: '130px',
                maxWidth: '180px',
              }}
              onClick={() => onSelectTab(file.path)}
              title={tabTitle}
            >
              {/* Top active tab indicator line — animated slide */}
              {isActive && (
                <motion.div
                  layoutId="active-tab-indicator"
                  className="absolute top-0 left-0 right-0 h-0.5" 
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}

              {/* File Icon */}
              <div className="flex-shrink-0 opacity-80 group-hover:opacity-100">
                {isBrowserTab ? (
                  <Globe size={13} style={{ color: 'var(--accent-primary)' }} />
                ) : (
                  <FileIcon filePath={file.path} />
                )}
              </div>

              {/* Filename */}
              <span className="flex-1 truncate font-medium">
                {displayName}
              </span>

              {/* Status / Close indicators */}
              <div className="flex items-center justify-center w-4 h-4 relative">
                {file.dirty ? (
                  // Show dot if dirty
                  <div 
                    className="w-1.5 h-1.5 rounded-full transition-opacity group-hover:opacity-0" 
                    style={{ backgroundColor: 'var(--accent-primary)' }} 
                  />
                ) : null}

                {/* Close Button: shows on hover, or replaces dot on hover */}
                <button
                  className={`absolute inset-0 flex items-center justify-center rounded p-0.5 hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(file.path);
                  }}
                  title="Fermer (Ctrl+W)"
                >
                  <X size={10.5} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor Actions bar on the right */}
      <div className="flex items-center gap-0.5 px-2 h-full border-l" style={{ borderColor: 'var(--border-base)' }}>
        {/* Markdown preview toggle — visible only for .md files */}
        {isMarkdownFile && (
          <button
            onClick={onToggleMarkdownPreview}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 transition"
            title={markdownPreview ? 'Voir le texte brut (Ctrl+Shift+M)' : 'Voir la prévisualisation Markdown (Ctrl+Shift+M)'}
          >
            {markdownPreview
              ? <Code size={13} style={{ color: 'var(--accent-primary)' }} />
              : <Eye size={13} style={{ color: 'var(--text-muted)' }} />
            }
          </button>
        )}

        {/* HTML preview toggle — visible only for .html files */}
        {isHtmlFile && (
          <button
            onClick={onToggleHtmlPreview}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 transition"
            title={htmlPreview ? 'Fermer la prévisualisation HTML' : 'Prévisualiser le HTML dans le navigateur intégré'}
          >
            <Globe size={13} style={{ color: htmlPreview ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
          </button>
        )}

        <button
          onClick={onToggleMinimap}
          className={`w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 transition`}
          title="Basculer la minimap"
        >
          <Map size={13} style={{ color: showMinimap ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
        </button>

        <button
          onClick={onToggleWordWrap}
          className={`w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 transition`}
          title="Basculer le retour à la ligne automatique (Alt+Z)"
        >
          <WrapText size={13} style={{ color: wordWrap ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
        </button>

        <button
          onClick={onFormat}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 transition"
          title="Formater le document (Shift+Alt+F)"
        >
          <AlignJustify size={13} style={{ color: 'var(--text-muted)' }} />
        </button>

        {onOpenTemplates && (
          <button
            onClick={onOpenTemplates}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 transition"
            title="Bibliothèque de Templates & Modèles"
          >
            <Sparkles size={13} style={{ color: 'var(--accent-primary)' }} />
          </button>
        )}

        <button
          onClick={onSave}
          disabled={!activeFileDirty}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 disabled:opacity-30 transition"
          title="Enregistrer le fichier (Ctrl+S)"
        >
          <Save size={13} style={{ color: activeFileDirty ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
        </button>
      </div>
          </div>
        );
      };

