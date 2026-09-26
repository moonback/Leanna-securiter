/**
 * NotesCanvas — Vue spatiale des notes (type Obsidian Canvas)
 *
 * Espace 2D pour positionner librement les notes, les relier,
 * zoomer/dézoomer, et drag & drop.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Pin, Move, Link2 } from 'lucide-react';

interface NoteItem {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  notes: NoteItem[];
  onSelectNote?: (noteId: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}j`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return 'now';
}

export function NotesCanvas({ notes, onSelectNote }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Initialize positions in a grid layout
  useEffect(() => {
    const cols = Math.max(2, Math.ceil(Math.sqrt(notes.length)));
    const newPos: Record<string, { x: number; y: number }> = {};
    let needsInit = false;

    notes.forEach((note, i) => {
      if (!positions[note.id]) {
        needsInit = true;
        const col = i % cols;
        const row = Math.floor(i / cols);
        newPos[note.id] = { x: col * 270 + 30, y: row * 180 + 30 };
      } else {
        newPos[note.id] = positions[note.id];
      }
    });

    if (needsInit) setPositions(newPos);
  }, [notes.length]);

  // ─── Backlinks detection ──────────────────────────────────────────────────

  const connections = useMemo(() => {
    const links: { from: string; to: string }[] = [];
    notes.forEach(note => {
      notes.forEach(other => {
        if (note.id === other.id) return;
        if (other.title.length < 3) return;
        if (note.content.toLowerCase().includes(other.title.toLowerCase())) {
          if (!links.some(l => (l.from === note.id && l.to === other.id) || (l.from === other.id && l.to === note.id))) {
            links.push({ from: note.id, to: other.id });
          }
        }
      });
    });
    return links;
  }, [notes]);

  // ─── Mouse handlers (window-level for reliable drag) ───────────────────────

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (dragId) {
        const dx = (e.clientX - dragStartRef.current.x) / zoom;
        const dy = (e.clientY - dragStartRef.current.y) / zoom;
        setPositions(prev => ({
          ...prev,
          [dragId]: {
            x: dragStartRef.current.nodeX + dx,
            y: dragStartRef.current.nodeY + dy,
          },
        }));
      } else if (isPanning) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan({
          x: panStartRef.current.panX + dx,
          y: panStartRef.current.panY + dy,
        });
      }
    };

    const handleUp = () => {
      setDragId(null);
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragId, isPanning, zoom]);

  const startDrag = useCallback((e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const pos = positions[noteId] || { x: 0, y: 0 };
    dragStartRef.current = { x: e.clientX, y: e.clientY, nodeX: pos.x, nodeY: pos.y };
    setDragId(noteId);
  }, [positions]);

  const startPan = useCallback((e: React.MouseEvent) => {
    // Only pan if clicking on the background
    if ((e.target as HTMLElement).closest('[data-note-card]')) return;
    e.preventDefault();
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
  }, [pan]);

  // ─── Zoom ─────────────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom(prev => Math.max(0.3, Math.min(2.5, prev + delta)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden select-none"
      style={{ backgroundColor: 'var(--bg-base)', cursor: isPanning ? 'grabbing' : 'grab' }}
      onMouseDown={startPan}
    >
      {/* Grid pattern background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle, var(--text-primary) 1px, transparent 1px)`,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x % (20 * zoom)}px ${pan.y % (20 * zoom)}px`,
        }}
      />

      {/* Toolbar */}
      <div
        className="absolute top-3 right-3 z-30 flex items-center gap-1 px-2.5 py-2 rounded-full shadow-lg backdrop-blur-sm"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-panel) 90%, transparent)', border: '1px solid var(--border-base)' }}
      >
        <button
          onClick={() => setZoom(prev => Math.min(2.5, prev + 0.2))}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-mono min-w-[36px] text-center" style={{ color: 'var(--text-dimmed)' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(prev => Math.max(0.3, prev - 0.2))}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-base)' }} />
        <button
          onClick={resetView}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Info bar */}
      <div
        className="absolute bottom-3 left-3 z-30 px-3 py-1.5 rounded-full text-xs backdrop-blur-sm"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-panel) 90%, transparent)', border: '1px solid var(--border-base)', color: 'var(--text-dimmed)' }}
      >
        {notes.length} notes • {connections.length} lien{connections.length !== 1 ? 's' : ''} • Glissez les cartes • Molette = zoom
      </div>

      {/* Transformed layer */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          inset: 0,
        }}
      >
        {/* Connection lines */}
        <svg className="absolute inset-0 pointer-events-none" style={{ width: '4000px', height: '4000px', overflow: 'visible' }}>
          {connections.map(({ from, to }, i) => {
            const fromPos = positions[from];
            const toPos = positions[to];
            if (!fromPos || !toPos) return null;

            const x1 = fromPos.x + 120;
            const y1 = fromPos.y + 45;
            const x2 = toPos.x + 120;
            const y2 = toPos.y + 45;
            const mx = (x1 + x2) / 2;

            return (
              <g key={i}>
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--accent-primary)"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                  opacity={0.35}
                />
                {/* Dot at connection point */}
                <circle cx={x1} cy={y1} r="3" fill="var(--accent-primary)" opacity={0.5} />
                <circle cx={x2} cy={y2} r="3" fill="var(--accent-primary)" opacity={0.5} />
              </g>
            );
          })}
        </svg>

        {/* Note cards */}
        {notes.map(note => {
          const pos = positions[note.id] || { x: 0, y: 0 };
          const isConnected = connections.some(c => c.from === note.id || c.to === note.id);
          const isDragging = dragId === note.id;

          return (
            <div
              key={note.id}
              data-note-card="true"
              className="absolute"
              style={{
                left: pos.x,
                top: pos.y,
                width: 240,
                zIndex: isDragging ? 50 : 10,
                transition: isDragging ? 'none' : 'box-shadow 0.2s',
              }}
            >
              <div
                className={`p-3.5 rounded-xl border transition-shadow ${isDragging ? 'shadow-2xl ring-2 ring-[var(--accent-primary)]' : 'shadow-sm hover:shadow-md'}`}
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderColor: isConnected ? 'var(--accent-primary)' : 'var(--border-base)',
                  borderWidth: isConnected ? '1.5px' : '1px',
                  cursor: isDragging ? 'grabbing' : 'default',
                }}
              >
                {/* Drag bar */}
                <div
                  className="flex items-center gap-1.5 mb-2 pb-2 cursor-grab active:cursor-grabbing"
                  style={{ borderBottom: '1px solid var(--border-base)' }}
                  onMouseDown={(e) => startDrag(e, note.id)}
                >
                  <Move className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    {note.pinned && <Pin className="w-2.5 h-2.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />}
                    <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {note.title}
                    </span>
                  </div>
                  {isConnected && (
                    <Link2 className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                  )}
                </div>

                {/* Content preview — clickable */}
                <div
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => onSelectNote?.(note.id)}
                >
                  <p className="text-xs line-clamp-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {note.content || 'Note vide — cliquez pour éditer'}
                  </p>
                </div>

                {/* Meta */}
                <div className="flex items-center gap-2 mt-2 pt-1.5" style={{ borderTop: '1px solid var(--border-base)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                    {timeAgo(note.updatedAt)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                    {note.content.length} car.
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
