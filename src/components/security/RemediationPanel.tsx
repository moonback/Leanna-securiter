/**
 * RemediationPanel.tsx
 * Patch proposal: unified diff view + CWE reference links + OWASP guidance.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wrench, ExternalLink, CheckCircle2, ChevronRight, Copy, CheckCheck } from 'lucide-react';

export interface PatchDiff {
  filename: string;
  hunks: Array<{
    header: string;
    lines: Array<{ type: 'add' | 'remove' | 'context'; content: string }>;
  }>;
}

export interface Reference {
  label: string;
  url: string;
  type: 'cwe' | 'owasp' | 'nvd' | 'github' | 'docs';
}

interface RemediationPanelProps {
  title?: string;
  description: string;
  patch?: PatchDiff;
  references?: Reference[];
  effort?: 'low' | 'medium' | 'high';
}

const EFFORT_CONFIG = {
  low:    { label: '< 30 min',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  medium: { label: '1–2h',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  high:   { label: '> 4h',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const REF_COLORS: Record<Reference['type'], string> = {
  cwe:    '#a855f7',
  owasp:  '#f97316',
  nvd:    '#3b82f6',
  github: '#e2e8f0',
  docs:   '#6b7280',
};

export function RemediationPanel({ title, description, patch, references, effort }: RemediationPanelProps) {
  const [tab, setTab] = useState<'guide' | 'patch'>('guide');
  const [copied, setCopied] = useState(false);

  const patchText = patch
    ? patch.hunks.flatMap((h) => [h.header, ...h.lines.map((l) => {
        const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
        return prefix + l.content;
      })]).join('\n')
    : '';

  const handleCopyPatch = () => {
    navigator.clipboard.writeText(patchText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const effortCfg = effort ? EFFORT_CONFIG[effort] : null;

  return (
    <div style={{
      background: 'rgba(13,17,23,0.85)',
      border: '1px solid rgba(34,197,94,0.2)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: 'rgba(34,197,94,0.06)',
        borderBottom: '1px solid rgba(34,197,94,0.15)',
      }}>
        <Wrench size={15} color="#22c55e" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#86efac' }}>
          {title ?? 'Remédiation recommandée'}
        </span>
        {effortCfg && (
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)',
            background: effortCfg.bg, color: effortCfg.color, fontWeight: 600,
            fontFamily: 'var(--font-mono)', marginLeft: 'auto',
          }}>
            ⏱ {effortCfg.label}
          </span>
        )}
      </div>

      {/* ── Tabs (only if patch provided) ── */}
      {patch && (
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
          {(['guide', 'patch'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', fontSize: 12, fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t ? '#22c55e' : '#6b7280',
                borderBottom: tab === t ? '2px solid #22c55e' : '2px solid transparent',
                transition: 'color 0.15s',
              }}
            >
              {t === 'guide' ? '📖 Guide' : '🔧 Diff'}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: 16 }}>
        <AnimatePresence mode="wait">
          {/* ── Guide tab ── */}
          {tab === 'guide' && (
            <motion.div key="guide"
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
                {description}
              </p>

              {/* Checklist style steps if description has numbered list */}
              {references && references.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 2 }}>
                    RÉFÉRENCES
                  </div>
                  {references.map((ref, i) => (
                    <a
                      key={i}
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        textDecoration: 'none', color: REF_COLORS[ref.type],
                        fontSize: 12, fontWeight: 500, transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    >
                      <span style={{
                        fontSize: 10, padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                        background: REF_COLORS[ref.type] + '20',
                        fontFamily: 'var(--font-mono)', fontWeight: 700,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                      }}>
                        {ref.type}
                      </span>
                      <span style={{ flex: 1 }}>{ref.label}</span>
                      <ExternalLink size={11} style={{ opacity: 0.5 }} />
                    </a>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Patch/diff tab ── */}
          {tab === 'patch' && patch && (
            <motion.div key="patch"
              initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#60a5fa' }}>
                  {patch.filename}
                </span>
                <button
                  onClick={handleCopyPatch}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 'var(--radius-sm)', padding: '4px 10px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, color: '#94a3b8', fontSize: 11 }}>
                  {copied ? <CheckCheck size={12} color="#22c55e" /> : <Copy size={12} />}
                  {copied ? 'Copié' : 'Copier le patch'}
                </button>
              </div>

              <div style={{
                background: '#0d1117', borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(255,255,255,0.06)',
                fontFamily: 'var(--font-mono)', fontSize: 12.5,
                overflow: 'auto', maxHeight: 320,
              }}>
                {patch.hunks.map((hunk, hi) => (
                  <div key={hi}>
                    <div style={{ padding: '4px 12px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontSize: 11 }}>
                      {hunk.header}
                    </div>
                    {hunk.lines.map((line, li) => (
                      <div
                        key={li}
                        style={{
                          padding: '1px 12px', lineHeight: 1.65,
                          background:
                            line.type === 'add'    ? 'rgba(34,197,94,0.1)' :
                            line.type === 'remove' ? 'rgba(239,68,68,0.1)' : 'transparent',
                          color:
                            line.type === 'add'    ? '#86efac' :
                            line.type === 'remove' ? '#fca5a5' : '#94a3b8',
                          borderLeft:
                            line.type === 'add'    ? '3px solid #22c55e' :
                            line.type === 'remove' ? '3px solid #ef4444' : '3px solid transparent',
                          whiteSpace: 'pre',
                        }}
                      >
                        <span style={{ color: 'inherit', opacity: 0.6, userSelect: 'none', marginRight: 8 }}>
                          {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                        </span>
                        {line.content}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
