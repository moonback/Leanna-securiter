import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileIcon } from './FileIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import {
  Search, X, CaseSensitive, Regex, ChevronRight,
  ChevronDown, Loader2,
} from 'lucide-react';

// ── Auth helpers ───────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  preview: string;
}

interface SearchResultGroup {
  file: string;
  matches: SearchMatch[];
  expanded: boolean;
}

interface GlobalSearchProps {
  onOpenFile: (path: string, line?: number, column?: number) => void;
  onClose: () => void;
}

// ── Highlight matched text ─────────────────────────────────────────────────

function HighlightedLine({ text, query, caseSensitive }: {
  text: string;
  query: string;
  caseSensitive: boolean;
}) {
  if (!query) return <span>{text}</span>;

  const flags = caseSensitive ? 'g' : 'gi';
  try {
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const parts: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(
        <mark
          key={match.index}
          style={{ backgroundColor: 'rgba(255,200,0,0.3)', color: 'inherit', borderRadius: 2 }}
        >
          {match[0]}
        </mark>
      );
      last = re.lastIndex;
      if (!re.global) break;
    }

    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
  } catch {
    return <span>{text}</span>;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export function GlobalSearch({ onOpenFile, onClose }: GlobalSearchProps) {
  const [query, setQuery]                 = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex]           = useState(false);
  const [loading, setLoading]             = useState(false);
  const [groups, setGroups]               = useState<SearchResultGroup[]>([]);
  const [totalMatches, setTotalMatches]   = useState(0);
  const [error, setError]                 = useState<string | null>(null);

  const inputRef   = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Search ─────────────────────────────────────────────────────────────────

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setGroups([]);
      setTotalMatches(0);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ide/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ query: q, caseSensitive, regex: useRegex }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const results: SearchMatch[] = data.results ?? [];

      // Group by file
      const byFile = new Map<string, SearchMatch[]>();
      for (const r of results) {
        if (!byFile.has(r.file)) byFile.set(r.file, []);
        byFile.get(r.file)!.push(r);
      }

      setGroups(
        [...byFile.entries()].map(([file, matches]) => ({
          file,
          matches,
          expanded: true,
        }))
      );
      setTotalMatches(results.length);
    } catch (e: any) {
      setError(e.message || 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [caseSensitive, useRegex]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, caseSensitive, useRegex, runSearch]);

  // Toggle group expand
  const toggleGroup = useCallback((file: string) => {
    setGroups(prev => prev.map(g => g.file === file ? { ...g, expanded: !g.expanded } : g));
  }, []);

  // Keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <div
      className="flex h-full flex-col"
      style={{ color: 'var(--text-primary)' }}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--border-base)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Recherche
        </span>
        <button onClick={onClose} className="rounded p-1 hover:bg-white/10">
          <X size={13} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Search input + options */}
      <div className="p-2 space-y-1.5">
        <div
          className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          {loading
            ? <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            : <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher dans les fichiers..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="rounded p-0.5 hover:bg-white/10">
              <X size={11} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}

          {/* Options */}
          <div className="flex items-center gap-0.5 border-l pl-1.5" style={{ borderColor: 'var(--border-base)' }}>
            <Tooltip
              content="Respecter la casse"
              as="button"
              onClick={() => setCaseSensitive(v => !v)}
              className={`rounded p-1 text-xs transition ${caseSensitive ? 'bg-[var(--accent-primary)]/30' : 'hover:bg-white/10'}`}
              style={{ color: caseSensitive ? 'var(--accent-primary)' : 'var(--text-muted)' }}
            >
              <CaseSensitive size={12} />
            </Tooltip>
            <Tooltip
              content="Expression régulière"
              as="button"
              onClick={() => setUseRegex(v => !v)}
              className={`rounded p-1 text-xs transition ${useRegex ? 'bg-[var(--accent-primary)]/30' : 'hover:bg-white/10'}`}
              style={{ color: useRegex ? 'var(--accent-primary)' : 'var(--text-muted)' }}
            >
              <Regex size={12} />
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Results summary */}
      {query && !loading && (
        <div className="px-3 pb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {error
            ? <span className="text-red-400">{error}</span>
            : `${totalMatches} résultat${totalMatches !== 1 ? 's' : ''} dans ${groups.length} fichier${groups.length !== 1 ? 's' : ''}`
          }
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {groups.map(group => (
          <div key={group.file}>
            {/* File header */}
            <button
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-white/10"
              onClick={() => toggleGroup(group.file)}
            >
              {group.expanded
                ? <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                : <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              }
              <FileIcon filePath={group.file} size={13} />
              <span className="flex-1 truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                {group.file.split('/').pop()}
              </span>
              <span
                className="rounded-full px-1.5 py-0.5 text-sm"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}
              >
                {group.matches.length}
              </span>
            </button>

            {/* Matches */}
            {group.expanded && group.matches.map((match, mi) => (
              <button
                key={mi}
                className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-white/10"
                style={{ paddingLeft: '28px' }}
                onClick={() => onOpenFile(match.file, match.line, match.column)}
              >
                <span
                  className="mt-0.5 shrink-0 w-7 text-right text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {match.line}
                </span>
                <span className="truncate font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                  <HighlightedLine
                    text={match.preview.trimStart()}
                    query={query}
                    caseSensitive={caseSensitive}
                  />
                </span>
              </button>
            ))}
          </div>
        ))}

        {/* Empty state */}
        {!loading && query && groups.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Search size={24} className="mb-2 opacity-30" />
            Aucun résultat pour «{query}»
          </div>
        )}

        {!query && (
          <div className="flex flex-col items-center justify-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Search size={24} className="mb-2 opacity-20" />
            Entrez un terme pour chercher
          </div>
        )}
      </div>
    </div>
  );
}
