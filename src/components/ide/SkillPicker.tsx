import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Zap, Globe, Database as DbIcon, Briefcase, Code2,
  Search, RefreshCw, X,
} from 'lucide-react';
import { useCustomSkills, type CustomSkill } from '../../hooks/useCustomSkills.js';

// ─── Category icon mapping ─────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  custom: Sparkles,
  automation: Zap,
  web: Globe,
  data: DbIcon,
  productivity: Briefcase,
};

function getCategoryIcon(cat: string) {
  return CATEGORY_ICONS[cat] ?? Sparkles;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface SkillPickerProps {
  /** Appelé quand un skill est choisi. Reçoit le skill sélectionné. */
  onSelect: (skill: CustomSkill) => void;
  disabled?: boolean;
}

const POPOVER_WIDTH = 300;
const POPOVER_MARGIN = 8;

/**
 * Bouton + popover permettant de choisir un skill custom à activer directement
 * depuis le ChatPanel. Le popover est rendu via un portail (document.body) pour
 * échapper à l'`overflow-hidden` du conteneur de saisie.
 */
export function SkillPicker({ onSelect, disabled = false }: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { skills, loading, error, reload } = useCustomSkills({ enabledOnly: true });

  // Positionne le popover au-dessus du bouton, aligné à droite
  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // aligné à droite du bouton, mais borné à l'écran
    let left = rect.right - POPOVER_WIDTH;
    left = Math.max(POPOVER_MARGIN, Math.min(left, window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN));
    const bottom = window.innerHeight - rect.top + POPOVER_MARGIN;
    setCoords({ left, bottom });
  }, []);

  // Recharger la liste + calculer la position à chaque ouverture
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) {
      reload();
      setQuery('');
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, reload]);

  // Repositionner sur scroll / resize tant que le popover est ouvert
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, updatePosition]);

  // Fermer au clic extérieur (bouton + popover)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fermer avec Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  }, [skills, query]);

  const handleSelect = useCallback((skill: CustomSkill) => {
    onSelect(skill);
    setOpen(false);
  }, [onSelect]);

  const activeCount = skills.length;

  return (
    <>
      {/* Bouton déclencheur */}
      <motion.button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.9 }}
        className="p-2 rounded-lg transition-all duration-150 disabled:opacity-30 focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 relative"
        style={{
          backgroundColor: open ? 'color-mix(in srgb, var(--accent-primary) 14%, transparent)' : 'transparent',
          color: open ? 'var(--accent-primary)' : 'var(--text-muted)',
        }}
        title="Choisir un skill custom"
        aria-label="Choisir un skill custom"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Sparkles size={16} />
        {/* Badge nombre de skills actifs */}
        {activeCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold font-mono leading-none"
            style={{
              backgroundColor: 'var(--accent-primary)',
              color: '#0a1628',
              boxShadow: '0 0 6px var(--accent-glow)',
            }}
          >
            {activeCount}
          </span>
        )}
      </motion.button>

      {/* Popover — rendu en portail pour échapper à overflow-hidden */}
      {createPortal(
        <AnimatePresence>
          {open && coords && (
            <motion.div
              ref={popoverRef}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              role="listbox"
              className="fixed rounded-xl overflow-hidden flex flex-col"
              style={{
                left: coords.left,
                bottom: coords.bottom,
                width: POPOVER_WIDTH,
                zIndex: 100000,
                backgroundColor: 'color-mix(in srgb, var(--bg-ctrl, var(--bg-panel)) 96%, transparent)',
                border: '1px solid var(--border-base)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04), 0 0 24px var(--accent-glow)',
                backdropFilter: 'blur(20px)',
              }}
            >
              {/* Header */}
              <div
                className="px-3 py-2 flex items-center gap-1.5"
                style={{
                  borderBottom: '1px solid var(--border-base)',
                  background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent-primary) 6%, var(--bg-ctrl, var(--bg-panel))), var(--bg-ctrl, var(--bg-panel)))',
                }}
              >
                <Sparkles size={11} style={{ color: 'var(--accent-secondary)' }} />
                <span
                  className="text-[10px] uppercase font-semibold tracking-widest flex-1"
                  style={{ color: 'var(--text-dimmed)' }}
                >
                  Skills custom
                </span>
                <button
                  type="button"
                  onClick={() => reload()}
                  className="p-1 rounded-md transition-colors hover:bg-white/10"
                  title="Rafraîchir"
                  aria-label="Rafraîchir la liste"
                >
                  <RefreshCw
                    size={11}
                    style={{ color: 'var(--text-dimmed)' }}
                    className={loading ? 'animate-spin' : undefined}
                  />
                </button>
              </div>

              {/* Recherche */}
              <div className="px-2.5 py-2" style={{ borderBottom: '1px solid var(--border-base)' }}>
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)' }}
                >
                  <Search size={12} style={{ color: 'var(--text-dimmed)' }} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Rechercher un skill…"
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-dimmed)]"
                    style={{ color: 'var(--text-primary)' }}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="p-0.5 rounded hover:bg-white/10 transition-colors"
                      aria-label="Effacer la recherche"
                    >
                      <X size={10} style={{ color: 'var(--text-dimmed)' }} />
                    </button>
                  )}
                </div>
              </div>

              {/* Liste */}
              <div className="max-h-[240px] overflow-y-auto custom-scrollbar">
                {loading && skills.length === 0 ? (
                  <div className="flex justify-center py-6">
                    <div
                      className="w-4 h-4 border-2 rounded-full animate-spin"
                      style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }}
                    />
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center gap-1.5 py-6 px-4 text-center">
                    <X size={16} style={{ color: 'var(--color-error)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--color-error)' }}>{error}</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
                    <Code2 size={18} className="opacity-30" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {skills.length === 0
                        ? 'Aucun skill custom activé. Créez-en dans les Réglages.'
                        : 'Aucun résultat pour cette recherche.'}
                    </span>
                  </div>
                ) : (
                  filtered.map(skill => {
                    const Icon = getCategoryIcon(skill.category);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        role="option"
                        onClick={() => handleSelect(skill)}
                        className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--accent-subtle)]"
                      >
                        <div
                          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{
                            backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
                            border: '1px solid var(--border-base)',
                          }}
                        >
                          <Icon size={12} style={{ color: 'var(--accent-primary)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium truncate font-mono" style={{ color: 'var(--text-primary)' }}>
                              {skill.name}
                            </span>
                            <span
                              className="text-[8px] uppercase px-1 py-px rounded font-semibold tracking-wide flex-shrink-0"
                              style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}
                            >
                              {skill.category}
                            </span>
                          </div>
                          {skill.description && (
                            <span className="text-[11px] block truncate mt-0.5" style={{ color: 'var(--text-dimmed)' }}>
                              {skill.description}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

export default SkillPicker;
