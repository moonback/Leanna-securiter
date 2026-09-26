import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { File, Folder, AtSign } from 'lucide-react';
import type { MentionSuggestion } from '../../hooks/useFileMention.js';

interface MentionDropdownProps {
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: MentionSuggestion) => void;
  onHover: (index: number) => void;
  query: string;
}

/**
 * Dropdown autocomplete pour les mentions @fichier/@dossier dans le chat.
 * Aligné sur le langage visuel du ChatPanel (glassmorphism, accent cyan, glow).
 */
export function MentionDropdown({ suggestions, selectedIndex, onSelect, onHover, query }: MentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view (+1 to skip the header row)
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex + 1] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  return (
    <motion.div
      ref={listRef}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden z-50 max-h-[220px] overflow-y-auto custom-scrollbar"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg-ctrl) 92%, transparent)',
        border: '1px solid var(--border-base)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04), 0 0 24px var(--accent-glow)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-3 py-2 text-[10px] uppercase font-semibold tracking-widest flex items-center gap-1.5"
        style={{
          color: 'var(--text-dimmed)',
          borderBottom: '1px solid var(--border-base)',
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent-primary) 6%, var(--bg-ctrl)), var(--bg-ctrl))',
        }}
      >
        <AtSign size={10} style={{ color: 'var(--accent-primary)' }} />
        Fichiers &amp; Dossiers
      </div>

      {suggestions.map((item, index) => {
        const active = index === selectedIndex;
        const isDir = item.type === 'directory';
        return (
          <button
            key={item.path}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onHover(index)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors relative"
            style={{ backgroundColor: active ? 'var(--accent-subtle)' : 'transparent' }}
          >
            {/* Active accent bar */}
            {active && (
              <span
                className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full"
                style={{ backgroundColor: 'var(--accent-primary)', boxShadow: '0 0 8px var(--accent-glow)' }}
              />
            )}
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                backgroundColor: isDir
                  ? 'color-mix(in srgb, var(--color-warning) 14%, transparent)'
                  : active
                    ? 'color-mix(in srgb, var(--accent-primary) 20%, transparent)'
                    : 'var(--bg-input)',
                border: `1px solid ${isDir ? 'var(--border-warning-subtle)' : 'var(--border-base)'}`,
              }}
            >
              {isDir
                ? <Folder size={12} style={{ color: 'var(--color-warning)' }} />
                : <File size={12} style={{ color: active ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium block truncate" style={{ color: 'var(--text-primary)' }}>
                <HighlightMatch text={item.name} query={query} />
              </span>
              <span className="text-[11px] block truncate font-mono" style={{ color: 'var(--text-dimmed)' }}>
                {item.path}
              </span>
            </div>
            <span
              className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0"
              style={{
                backgroundColor: isDir
                  ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                  : 'var(--accent-subtle)',
                color: isDir ? 'var(--color-warning)' : 'var(--accent-primary)',
              }}
            >
              {isDir ? 'dossier' : 'fichier'}
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}

/** Highlight the matching portion of a name */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
