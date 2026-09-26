import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Network, AlertTriangle, ZoomIn, ZoomOut, RotateCcw, Loader2, Shield } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttackNode {
  id: string;
  label: string;
  type: 'entry' | 'propagation' | 'sink' | 'safe';
  file?: string;
  line?: number;
  findings?: string[];
}

interface AttackEdge {
  from: string;
  to: string;
  type: 'call' | 'data_flow' | 'taint';
}

interface AttackGraph {
  nodes: AttackNode[];
  edges: AttackEdge[];
  totalEntryPoints: number;
  totalSinks: number;
  taintedPaths: number;
}

// ─── Mock graph data ───────────────────────────────────────────────────────────

const MOCK_GRAPH: AttackGraph = {
  totalEntryPoints: 12,
  totalSinks: 4,
  taintedPaths: 3,
  nodes: [
    { id: 'req_params', label: 'req.params.id', type: 'entry', file: 'server/routes/api.ts', line: 140 },
    { id: 'req_body', label: 'req.body.query', type: 'entry', file: 'server/routes/search.ts', line: 22 },
    { id: 'route_user', label: 'GET /user/:id', type: 'propagation', file: 'server/routes/api.ts', line: 140 },
    { id: 'route_search', label: 'POST /search', type: 'propagation', file: 'server/routes/search.ts', line: 20 },
    { id: 'db_query', label: 'db.query()', type: 'sink', file: 'server/routes/api.ts', line: 142, findings: ['f001'] },
    { id: 'db_raw', label: 'db.raw()', type: 'sink', file: 'server/routes/search.ts', line: 31, findings: ['f003'] },
    { id: 'safe_validator', label: 'validateId()', type: 'safe', file: 'server/utils/validate.ts', line: 8 },
    { id: 'safe_input', label: 'req.params.page', type: 'entry', file: 'server/routes/api.ts', line: 200 },
    { id: 'safe_query', label: 'db.query($1)', type: 'safe', file: 'server/routes/api.ts', line: 203 },
  ],
  edges: [
    { from: 'req_params', to: 'route_user', type: 'data_flow' },
    { from: 'route_user', to: 'db_query', type: 'taint' },
    { from: 'req_body', to: 'route_search', type: 'data_flow' },
    { from: 'route_search', to: 'db_raw', type: 'taint' },
    { from: 'safe_input', to: 'safe_validator', type: 'call' },
    { from: 'safe_validator', to: 'safe_query', type: 'call' },
  ],
};

// ─── Node color config ────────────────────────────────────────────────────────

const NODE_CONFIG = {
  entry: { color: '#3b82f6', bg: '#3b82f615', label: 'Point d\'entrée' },
  propagation: { color: '#f59e0b', bg: '#f59e0b15', label: 'Propagation' },
  sink: { color: '#ef4444', bg: '#ef444415', label: 'Sink (vulnérable)' },
  safe: { color: '#22c55e', bg: '#22c55e15', label: 'Chemin sécurisé' },
};

const EDGE_CONFIG = {
  call: { color: '#6b7280', dash: '' },
  data_flow: { color: '#3b82f6', dash: '4,3' },
  taint: { color: '#ef4444', dash: '' },
};

// ─── SVG Graph Component ───────────────────────────────────────────────────────

function GraphSVG({ graph, selectedNode, onSelectNode }: {
  graph: AttackGraph;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const W = 800;
  const H = 480;
  const NODE_W = 160;
  const NODE_H = 44;

  // Simple layout: columns by type
  const typeOrder = ['entry', 'propagation', 'sink', 'safe'];
  const colNodes: Record<string, AttackNode[]> = { entry: [], propagation: [], sink: [], safe: [] };
  graph.nodes.forEach(n => colNodes[n.type]?.push(n));

  const positions: Record<string, { x: number; y: number }> = {};
  typeOrder.forEach((type, colIdx) => {
    const nodes = colNodes[type];
    const x = 80 + colIdx * ((W - 160) / (typeOrder.length - 1));
    nodes.forEach((n, rowIdx) => {
      const totalH = nodes.length * (NODE_H + 20) - 20;
      const startY = (H - totalH) / 2;
      positions[n.id] = { x, y: startY + rowIdx * (NODE_H + 20) };
    });
  });

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: 'monospace' }}>
      <defs>
        <marker id="arrow-taint" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
        </marker>
        <marker id="arrow-flow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#3b82f6" />
        </marker>
        <marker id="arrow-call" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#6b7280" />
        </marker>
      </defs>

      {/* Edges */}
      {graph.edges.map((edge, i) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) return null;
        const cfg = EDGE_CONFIG[edge.type];
        const x1 = from.x + NODE_W / 2;
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x - NODE_W / 2;
        const y2 = to.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;

        return (
          <g key={i}>
            <path
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={cfg.color}
              strokeWidth={edge.type === 'taint' ? 2 : 1.5}
              strokeDasharray={cfg.dash}
              markerEnd={`url(#arrow-${edge.type === 'taint' ? 'taint' : edge.type === 'data_flow' ? 'flow' : 'call'})`}
              opacity={0.7}
            />
          </g>
        );
      })}

      {/* Nodes */}
      {graph.nodes.map(node => {
        const pos = positions[node.id];
        if (!pos) return null;
        const cfg = NODE_CONFIG[node.type];
        const isSelected = selectedNode === node.id;
        const x = pos.x - NODE_W / 2;
        const y = pos.y;

        return (
          <g key={node.id} onClick={() => onSelectNode(isSelected ? null : node.id)} style={{ cursor: 'pointer' }}>
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              ry={8}
              fill={cfg.bg}
              stroke={isSelected ? cfg.color : `${cfg.color}66`}
              strokeWidth={isSelected ? 2 : 1}
              style={{ filter: isSelected ? `drop-shadow(0 0 6px ${cfg.color}66)` : undefined }}
            />
            {node.findings && node.findings.length > 0 && (
              <circle cx={x + NODE_W - 8} cy={y + 8} r={5} fill="#ef4444" />
            )}
            <text x={x + 8} y={y + 16} fill={cfg.color} fontSize={10} fontWeight={600}>
              {node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label}
            </text>
            {node.file && (
              <text x={x + 8} y={y + 30} fill={cfg.color} fontSize={8.5} opacity={0.7}>
                {node.file.split('/').pop()}:{node.line}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function AttackSurfaceView() {
  const [graph, setGraph] = useState<AttackGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    fetch('/api/security/attack-surface')
      .then(r => r.ok ? r.json() : null)
      .then(data => setGraph(data?.graph ?? MOCK_GRAPH))
      .catch(() => setGraph(MOCK_GRAPH))
      .finally(() => setLoading(false));
  }, []);

  const selectedNodeData = graph?.nodes.find(n => n.id === selectedNode);

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f630 0%, #7c3aed30 100%)', border: '1px solid #3b82f640' }}
          >
            <Network size={18} style={{ color: '#3b82f6' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Surface d'attaque
            </h1>
            {graph && (
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {graph.totalEntryPoints} points d'entrée · {graph.totalSinks} sinks · {graph.taintedPaths} chemins taintés
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 2))} className="p-2 rounded-lg border transition-all" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="p-2 rounded-lg border transition-all" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>
            <ZoomOut size={14} />
          </button>
          <button onClick={() => setZoom(1)} className="p-2 rounded-lg border transition-all" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div
        className="flex items-center gap-5 px-6 py-2 border-b flex-shrink-0 flex-wrap"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        {Object.entries(NODE_CONFIG).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg.color }} />
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{cfg.label}</span>
          </div>
        ))}
        <div className="w-px h-4" style={{ backgroundColor: 'var(--border-base)' }} />
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#ef4444" strokeWidth="2" /></svg>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Flux taint</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,3" /></svg>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Data flow</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#6b7280" strokeWidth="1.5" /></svg>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Appel</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Graph */}
        <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center gap-3">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement du graphe d'attaque…</span>
            </div>
          ) : graph ? (
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                width: '100%',
                height: '100%',
                transition: 'transform 0.2s ease',
              }}
            >
              <GraphSVG graph={graph} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun graphe disponible. Lancez un scan SAST d'abord.</p>
            </div>
          )}
        </div>

        {/* Node detail panel */}
        {selectedNodeData && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l flex flex-col overflow-hidden flex-shrink-0"
            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Nœud sélectionné</span>
              <button onClick={() => setSelectedNode(null)} className="text-xs" style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              <div>
                <div
                  className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded mb-2"
                  style={{
                    backgroundColor: NODE_CONFIG[selectedNodeData.type].bg,
                    color: NODE_CONFIG[selectedNodeData.type].color,
                  }}
                >
                  {NODE_CONFIG[selectedNodeData.type].label}
                </div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{selectedNodeData.label}</p>
                {selectedNodeData.file && (
                  <p className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
                    {selectedNodeData.file}:{selectedNodeData.line}
                  </p>
                )}
              </div>

              {selectedNodeData.findings && selectedNodeData.findings.length > 0 && (
                <div className="rounded-lg border p-3" style={{ borderColor: '#ef444440', backgroundColor: '#ef444410' }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={11} style={{ color: '#ef4444' }} />
                    <span className="text-[11px] font-semibold" style={{ color: '#ef4444' }}>Vulnérabilités associées</span>
                  </div>
                  {selectedNodeData.findings.map(fid => (
                    <p key={fid} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{fid}</p>
                  ))}
                </div>
              )}

              {selectedNodeData.type === 'safe' && (
                <div className="rounded-lg border p-3" style={{ borderColor: '#22c55e40', backgroundColor: '#22c55e10' }}>
                  <div className="flex items-center gap-1.5">
                    <Shield size={11} style={{ color: '#22c55e' }} />
                    <span className="text-[11px] font-semibold" style={{ color: '#22c55e' }}>Chemin sécurisé</span>
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    Ce nœud applique une validation ou utilise une API sécurisée.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
