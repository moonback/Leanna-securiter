/**
 * TaintFlowViz.tsx
 * Mermaid-rendered taint flow diagram: source → propagation → sink.
 * Shows the full data-flow path that led to a vulnerability.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitMerge, Loader2, AlertTriangle } from 'lucide-react';

export interface TaintNode {
  id: string;
  label: string;
  type: 'source' | 'propagation' | 'sanitizer' | 'sink';
  file?: string;
  line?: number;
}

export interface TaintEdge {
  from: string;
  to: string;
  label?: string;
  tainted: boolean;
}

export interface TaintFlow {
  nodes: TaintNode[];
  edges: TaintEdge[];
  sinkType?: string; // e.g. 'SQL', 'XSS', 'SSRF'
}

interface TaintFlowVizProps {
  flow: TaintFlow;
  title?: string;
}

const NODE_STYLE: Record<TaintNode['type'], string> = {
  source:      'fill:#1d4ed8,stroke:#3b82f6,color:#e0f2fe',
  propagation: 'fill:#1c1c2e,stroke:#6366f1,color:#c7d2fe',
  sanitizer:   'fill:#14532d,stroke:#22c55e,color:#bbf7d0',
  sink:        'fill:#7f1d1d,stroke:#dc2626,color:#fecaca',
};

function buildMermaid(flow: TaintFlow): string {
  const nodeLines = flow.nodes.map((n) => {
    const safeLabel = n.label.replace(/"/g, "'");
    const file = n.file ? `\\n${n.file}${n.line ? ':' + n.line : ''}` : '';
    if (n.type === 'source')      return `  ${n.id}["🔵 ${safeLabel}${file}"]`;
    if (n.type === 'sink')        return `  ${n.id}[["🔴 ${safeLabel}${file}"]]`;
    if (n.type === 'sanitizer')   return `  ${n.id}{"🟢 ${safeLabel}"}`;
    return `  ${n.id}("${safeLabel}${file}")`;
  });

  const edgeLines = flow.edges.map((e) => {
    const label = e.label ? `|"${e.label}"|` : '';
    const arrow = e.tainted ? '-->>' : '-->';
    return `  ${e.from} ${arrow}${label} ${e.to}`;
  });

  const styleLines = flow.nodes.map((n) => {
    const style = NODE_STYLE[n.type];
    return `  style ${n.id} ${style}`;
  });

  return [
    'flowchart LR',
    ...nodeLines,
    ...edgeLines,
    ...styleLines,
  ].join('\n');
}

export function TaintFlowViz({ flow, title }: TaintFlowVizProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    setStatus('loading');

    import('mermaid').then(({ default: mermaid }) => {
      if (cancelled) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          background: '#0d1117',
          primaryColor: '#1d4ed8',
          edgeLabelBackground: '#1e293b',
          lineColor: '#475569',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '12px',
        },
        flowchart: { curve: 'basis', padding: 20 },
        securityLevel: 'loose',
      });

      const definition = buildMermaid(flow);
      const id = `taint-${Date.now()}`;

      mermaid.render(id, definition).then(({ svg }) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;

        // Make SVG responsive
        const svgEl = containerRef.current.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = 'auto';
          svgEl.style.maxWidth = '100%';
        }
        setStatus('ready');
      }).catch((err) => {
        if (!cancelled) { setStatus('error'); setErrorMsg(String(err)); }
      });
    }).catch(() => {
      if (!cancelled) { setStatus('error'); setErrorMsg('Mermaid not available'); }
    });

    return () => { cancelled = true; };
  }, [flow]);

  const sinkCount = flow.nodes.filter((n) => n.type === 'sink').length;
  const srcCount  = flow.nodes.filter((n) => n.type === 'source').length;

  return (
    <div style={{
      background: 'rgba(13,17,23,0.85)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <GitMerge size={15} color="#6366f1" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#c7d2fe' }}>
          {title ?? 'Taint Flow'}
        </span>
        {flow.sinkType && (
          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(220,38,38,0.15)', color: '#f87171',
            fontFamily: 'var(--font-mono)', fontWeight: 700, marginLeft: 4 }}>
            {flow.sinkType}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Pill color="#3b82f6" label={`${srcCount} source${srcCount > 1 ? 's' : ''}`} />
          <Pill color="#dc2626" label={`${sinkCount} sink${sinkCount > 1 ? 's' : ''}`} />
        </div>
      </div>

      {/* Diagram */}
      <div style={{ padding: '16px', minHeight: 120 }}>
        <AnimatePresence mode="wait">
          {status === 'loading' && (
            <motion.div key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
              <Loader2 size={18} color="#6366f1" style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, color: '#6b7280' }}>Génération du diagramme…</span>
            </motion.div>
          )}
          {status === 'error' && (
            <motion.div key="error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, color: '#f87171' }}>
              <AlertTriangle size={16} />
              <span style={{ fontSize: 12 }}>{errorMsg || 'Erreur de rendu'}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={containerRef} style={{ display: status === 'ready' ? 'block' : 'none' }} />
      </div>
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)',
      background: color + '20', color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
      {label}
    </span>
  );
}
