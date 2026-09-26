/**
 * AttackSurfaceGraph.tsx
 * D3-style interactive attack surface visualization using SVG.
 * Shows service nodes with vuln counts, tainted edges, and exposure index.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Network, ZoomIn, ZoomOut, RotateCcw, Info } from 'lucide-react';

export interface SurfaceNode {
  id: string;
  label: string;
  type: 'entrypoint' | 'service' | 'database' | 'storage' | 'external';
  riskScore: number; // 0-100
  vulnCount: number;
  x?: number;
  y?: number;
}

export interface SurfaceEdge {
  source: string;
  target: string;
  protocol?: string;
  tainted?: boolean;
}

export interface SurfaceGraph {
  nodes: SurfaceNode[];
  edges: SurfaceEdge[];
  summary: {
    totalEntrypoints: number;
    criticalPaths: number;
    exposureIndex: number;
  };
}

interface AttackSurfaceGraphProps {
  graph: SurfaceGraph;
  onNodeClick?: (nodeId: string) => void;
}

const NODE_TYPE_CONFIG: Record<SurfaceNode['type'], { color: string; icon: string; shape: 'circle' | 'rect' | 'diamond' }> = {
  entrypoint: { color: '#3b82f6', icon: '⬤', shape: 'circle' },
  service:    { color: '#6366f1', icon: '◆', shape: 'circle' },
  database:   { color: '#f59e0b', icon: '⬤', shape: 'rect' },
  storage:    { color: '#22c55e', icon: '⬤', shape: 'rect' },
  external:   { color: '#a855f7', icon: '⬤', shape: 'circle' },
};

// Fixed layout positions (normalized 0-1)
const LAYOUT_POSITIONS: Record<string, { x: number; y: number }> = {
  'ep-api-routes':       { x: 0.08, y: 0.35 },
  'ep-websocket':        { x: 0.08, y: 0.65 },
  'srv-orchestrator':    { x: 0.38, y: 0.50 },
  'srv-agent-runtime':   { x: 0.62, y: 0.50 },
  'db-sqlite-local':     { x: 0.85, y: 0.30 },
  'ext-llm-providers':   { x: 0.85, y: 0.70 },
  'fs-workspace-sandbox':{ x: 0.85, y: 0.50 },
};

export function AttackSurfaceGraph({ graph, onNodeClick }: AttackSurfaceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 700, h: 360 });

  // Observe container width
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 100) setDims({ w, h: Math.round(w * 0.52) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = dims;
  const PAD = 64;

  const resolvedNodes = graph.nodes.map((n) => {
    const pos = LAYOUT_POSITIONS[n.id] ?? { x: 0.5, y: 0.5 };
    return {
      ...n,
      cx: PAD + pos.x * (w - PAD * 2),
      cy: PAD + pos.y * (h - PAD * 2),
    };
  });

  const nodeMap = new Map(resolvedNodes.map((n) => [n.id, n]));

  const getRiskColor = (risk: number) => {
    if (risk >= 75) return '#dc2626';
    if (risk >= 55) return '#ea580c';
    if (risk >= 35) return '#d97706';
    return '#22c55e';
  };

  const handleZoomIn  = () => setScale((s) => Math.min(s + 0.2, 2.5));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.2, 0.4));
  const handleReset   = () => setScale(1);

  const { exposureIndex } = graph.summary;
  const exposureColor = exposureIndex >= 70 ? '#dc2626' : exposureIndex >= 45 ? '#d97706' : '#22c55e';

  const selectedNode = selected ? nodeMap.get(selected) : null;

  return (
    <div style={{
      background: 'rgba(13,17,23,0.9)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <Network size={15} color="#6366f1" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#c7d2fe' }}>Attack Surface</span>

        {/* Stats */}
        <span style={{ fontSize: 11, color: '#6b7280' }}>
          {graph.summary.totalEntrypoints} entrypoints · {graph.summary.criticalPaths} tainted paths
        </span>

        {/* Exposure index */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Exposure</span>
          <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${exposureIndex}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              style={{ height: '100%', background: exposureColor, borderRadius: 99 }}
            />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: exposureColor, fontFamily: 'var(--font-mono)' }}>
            {exposureIndex}
          </span>
        </div>

        {/* Zoom controls */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {[
            { icon: ZoomIn, fn: handleZoomIn },
            { icon: ZoomOut, fn: handleZoomOut },
            { icon: RotateCcw, fn: handleReset },
          ].map(({ icon: Icon, fn }, i) => (
            <button key={i} onClick={fn} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 'var(--radius-sm)', padding: 5, cursor: 'pointer', color: '#6b7280',
              display: 'flex', alignItems: 'center',
            }}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      {/* ── SVG canvas ── */}
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%"
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ display: 'block' }}
        >
          <defs>
            {/* Arrow markers */}
            <marker id="arrow-taint" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="#dc2626" />
            </marker>
            <marker id="arrow-safe" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="#475569" />
            </marker>
            {/* Glow filters */}
            <filter id="glow-red">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-blue">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <g transform={`translate(${w / 2} ${h / 2}) scale(${scale}) translate(${-w / 2} ${-h / 2})`}>
            {/* ── Edges ── */}
            {graph.edges.map((edge, i) => {
              const src = nodeMap.get(edge.source);
              const tgt = nodeMap.get(edge.target);
              if (!src || !tgt) return null;
              const tainted = edge.tainted;
              return (
                <g key={i}>
                  <line
                    x1={src.cx} y1={src.cy}
                    x2={tgt.cx} y2={tgt.cy}
                    stroke={tainted ? '#dc2626' : '#334155'}
                    strokeWidth={tainted ? 1.8 : 1.2}
                    strokeDasharray={tainted ? undefined : '5,4'}
                    markerEnd={tainted ? 'url(#arrow-taint)' : 'url(#arrow-safe)'}
                    opacity={tainted ? 0.75 : 0.4}
                    filter={tainted ? 'url(#glow-red)' : undefined}
                  />
                  {edge.protocol && (
                    <text
                      x={(src.cx + tgt.cx) / 2}
                      y={(src.cy + tgt.cy) / 2 - 8}
                      textAnchor="middle"
                      style={{ fontSize: 9, fill: '#475569', fontFamily: 'var(--font-mono)' }}
                    >
                      {edge.protocol}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ── Nodes ── */}
            {resolvedNodes.map((node) => {
              const cfg = NODE_TYPE_CONFIG[node.type];
              const isHovered = hovered === node.id;
              const isSelected = selected === node.id;
              const hasVulns = node.vulnCount > 0;
              const riskColor = getRiskColor(node.riskScore);
              const R = 28 + Math.min(node.riskScore / 10, 8);

              return (
                <g key={node.id}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => { setSelected(isSelected ? null : node.id); onNodeClick?.(node.id); }}
                >
                  {/* Outer risk ring */}
                  <circle
                    cx={node.cx} cy={node.cy}
                    r={R + 6}
                    fill="none"
                    stroke={riskColor}
                    strokeWidth={isHovered || isSelected ? 2 : 1}
                    opacity={isHovered || isSelected ? 0.6 : 0.2}
                    strokeDasharray={isSelected ? undefined : '4,3'}
                    filter={hasVulns ? 'url(#glow-red)' : undefined}
                  />
                  {/* Main node */}
                  <circle
                    cx={node.cx} cy={node.cy} r={R}
                    fill={cfg.color + '22'}
                    stroke={isSelected ? cfg.color : (isHovered ? cfg.color + 'aa' : cfg.color + '55')}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                  />
                  {/* Icon / type indicator */}
                  <text x={node.cx} y={node.cy - 4} textAnchor="middle"
                    style={{ fontSize: 16, fill: cfg.color, userSelect: 'none' }}>
                    {node.type === 'entrypoint' ? '🔵' :
                     node.type === 'database'   ? '🗄️' :
                     node.type === 'storage'    ? '📁' :
                     node.type === 'external'   ? '🌐' : '⚙️'}
                  </text>
                  {/* Vuln count badge */}
                  {hasVulns && (
                    <g>
                      <circle cx={node.cx + R - 2} cy={node.cy - R + 2} r={10}
                        fill="#dc2626" stroke="#0d1117" strokeWidth={2} />
                      <text x={node.cx + R - 2} y={node.cy - R + 6}
                        textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: '#fff', userSelect: 'none' }}>
                        {node.vulnCount}
                      </text>
                    </g>
                  )}
                  {/* Label */}
                  <text x={node.cx} y={node.cy + R + 16} textAnchor="middle"
                    style={{ fontSize: 10.5, fill: isHovered ? '#e2e8f0' : '#94a3b8', fontWeight: 600, userSelect: 'none' }}>
                    {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
                  </text>
                  <text x={node.cx} y={node.cy + R + 28} textAnchor="middle"
                    style={{ fontSize: 9.5, fill: riskColor, fontFamily: 'var(--font-mono)', userSelect: 'none' }}>
                    risk {node.riskScore}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* ── Selected node detail panel ── */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              key={selectedNode.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              style={{
                position: 'absolute', bottom: 12, right: 12,
                background: 'rgba(13,17,23,0.95)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 16px', minWidth: 220, maxWidth: 280,
                backdropFilter: 'blur(12px)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: NODE_TYPE_CONFIG[selectedNode.type].color, marginBottom: 6 }}>
                {selectedNode.label}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Type: <span style={{ color: '#94a3b8' }}>{selectedNode.type}</span></span>
                <span>Risk score: <span style={{ color: getRiskColor(selectedNode.riskScore), fontWeight: 700 }}>{selectedNode.riskScore}/100</span></span>
                <span>Vulnérabilités: <span style={{ color: selectedNode.vulnCount > 0 ? '#f87171' : '#4ade80', fontWeight: 600 }}>{selectedNode.vulnCount}</span></span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Legend ── */}
      <div style={{
        display: 'flex', gap: 16, padding: '8px 16px', flexWrap: 'wrap',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.01)',
      }}>
        {Object.entries(NODE_TYPE_CONFIG).map(([type, cfg]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: cfg.color }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color + '60', border: `1.5px solid ${cfg.color}` }} />
            {type}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#dc2626' }}>
          <div style={{ width: 16, height: 1.5, background: '#dc2626', borderRadius: 1 }} />
          tainted path
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#475569' }}>
          <div style={{ width: 16, height: 1, background: '#475569', borderRadius: 1, borderTop: '1px dashed #475569' }} />
          safe path
        </div>
      </div>
    </div>
  );
}
