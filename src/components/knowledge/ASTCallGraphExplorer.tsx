import React, { useState, useEffect, useCallback } from 'react';
import {
  GitFork,
  Search,
  ArrowRight,
  ArrowDownRight,
  Layers,
  FileCode,
  Zap,
  Code2,
  RefreshCw,
  CornerDownRight,
  Sparkles,
  Filter,
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';

interface ASTStats {
  totalNodes: number;
  totalEdges: number;
  resolvedEdges: number;
  crossFileEdges: number;
}

interface FunctionItem {
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  signature?: string;
  modifiers?: string[];
  type: string;
}

interface CallEdge {
  callerId: string;
  calleeId: string;
  calleeName: string;
  calleeObject?: string;
  sourceLine: number;
  isResolved: boolean;
  isAwait: boolean;
  isChained: boolean;
}

interface CallChainNode {
  id: string;
  functionName: string;
  className?: string;
  filePath: string;
  isMethod: boolean;
}

interface CallChainResult {
  root: string;
  nodes: CallChainNode[];
  edges: CallEdge[];
  maxDepthReached: boolean;
}

export function ASTCallGraphExplorer() {
  const { error: toastError, success: toastSuccess } = useToast();
  const [stats, setStats] = useState<ASTStats | null>(null);
  const [astReady, setAstReady] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Search & Selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [selectedFn, setSelectedFn] = useState<FunctionItem | null>(null);

  // Inspector state
  const [inspectLoading, setInspectLoading] = useState(false);
  const [callers, setCallers] = useState<CallEdge[]>([]);
  const [callees, setCallees] = useState<CallEdge[]>([]);
  const [chain, setChain] = useState<CallChainResult | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'hierarchy' | 'chain' | 'source'>('hierarchy');

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/ast/stats');
      if (res.ok) {
        const json = await res.json();
        setStats(json.stats);
        setAstReady(json.astReady);
      }
    } catch {
      // Ignorer si non disponible
    }
  }, []);

  const searchFunctions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (fileFilter) params.set('file', fileFilter);
      params.set('limit', '40');

      const res = await fetch(`/api/knowledge/ast/functions?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setFunctions(json.functions || []);
        if (!selectedFn && json.functions?.length > 0) {
          inspectFunction(json.functions[0]);
        }
      }
    } catch {
      toastError?.('Erreur lors de la recherche des fonctions AST');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, fileFilter, toastError]);

  const inspectFunction = async (fn: FunctionItem) => {
    setSelectedFn(fn);
    setInspectLoading(true);
    try {
      const fnParams = new URLSearchParams({
        fn: fn.name,
        file: fn.filePath,
      });

      const [callersRes, calleesRes, chainRes] = await Promise.all([
        fetch(`/api/knowledge/ast/callers?${fnParams.toString()}`),
        fetch(`/api/knowledge/ast/callees?${fnParams.toString()}`),
        fetch(`/api/knowledge/ast/chain?${fnParams.toString()}&depth=3`),
      ]);

      if (callersRes.ok) {
        const cJson = await callersRes.json();
        setCallers(cJson.callers || []);
      }
      if (calleesRes.ok) {
        const ceJson = await calleesRes.json();
        setCallees(ceJson.callees || []);
      }
      if (chainRes.ok) {
        const chJson = await chainRes.json();
        setChain(chJson.chain || null);
      }
    } catch {
      toastError?.("Erreur lors de l'inspection de la fonction");
    } finally {
      setInspectLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    searchFunctions();
  }, [fetchStats, searchFunctions]);

  const handleReindex = async () => {
    try {
      const res = await fetch('/api/knowledge/reindex', { method: 'POST' });
      if (res.ok) {
        toastSuccess?.('Re-scan AST terminé');
        await fetchStats();
        await searchFunctions();
      }
    } catch {
      toastError?.('Échec de la ré-indexation AST');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & KPI Summary */}
      <div
        className="p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
      >
        <div className="space-y-1 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <GitFork className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                Arbre AST & Call-Graph Inter-Fonctions
                {astReady ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Tree-sitter WASM Actif
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Mode Fallback Regex
                  </span>
                )}
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Cartographie fine de l'arborescence syntaxique, signatures typées, chaînes d'appels et dépendances intra-classe
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 z-10">
          <button
            onClick={() => { fetchStats(); searchFunctions(); }}
            className="p-2.5 rounded-xl border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleReindex}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-lg shadow-cyan-500/10 active:scale-95"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
          >
            <Zap className="w-3.5 h-3.5" />
            Re-scanner l'AST
          </button>
        </div>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Fonctions Détectées</span>
          <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            {stats?.totalNodes.toLocaleString() ?? '—'}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Méthodes, closures & arrows</p>
        </div>

        <div className="p-4 rounded-2xl border space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">Appels Indexés</span>
          <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            {stats?.totalEdges.toLocaleString() ?? '—'}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Appels directs & chaînés</p>
        </div>

        <div className="p-4 rounded-2xl border space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Appels Résolus</span>
          <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            {stats?.resolvedEdges.toLocaleString() ?? '—'}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Liens de symboles précis</p>
        </div>

        <div className="p-4 rounded-2xl border space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">Relations Cross-File</span>
          <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            {stats?.crossFileEdges.toLocaleString() ?? '—'}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Dépendances inter-modules</p>
        </div>
      </div>

      {/* Main Grid: Explorer + Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Function Search & List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Search className="w-4 h-4 text-cyan-400" />
                Explorateur de Symboles AST
              </h3>
              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {functions.length} résultat{functions.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* Filters */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-muted" />
                <input
                  type="text"
                  placeholder="Rechercher fonction, méthode, composant..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl text-xs border bg-black/20 focus:outline-none focus:border-cyan-500/50"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="relative">
                <Filter className="w-3.5 h-3.5 absolute left-3 top-3 text-muted" />
                <input
                  type="text"
                  placeholder="Filtrer par fichier (ex: server/knowledge)..."
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl text-xs border bg-black/20 focus:outline-none focus:border-cyan-500/50"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* List */}
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
              {loading ? (
                <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-cyan-400" />
                  <p className="text-xs">Chargement des symboles AST...</p>
                </div>
              ) : functions.length === 0 ? (
                <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  <Code2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Aucune fonction trouvée</p>
                </div>
              ) : (
                functions.map((fn, idx) => {
                  const isSelected = selectedFn?.name === fn.name && selectedFn?.filePath === fn.filePath;
                  return (
                    <button
                      key={`${fn.filePath}-${fn.name}-${idx}`}
                      onClick={() => inspectFunction(fn)}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-start justify-between gap-2 ${
                        isSelected
                          ? 'border-cyan-500/50 bg-cyan-500/10 shadow-sm'
                          : 'hover:border-white/20 hover:bg-white/5 border-transparent'
                      }`}
                      style={{ backgroundColor: isSelected ? undefined : 'var(--bg-base)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold truncate text-cyan-300">
                            {fn.name}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] uppercase font-mono bg-white/5 text-muted">
                            {fn.type}
                          </span>
                          {fn.modifiers?.includes('async') && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-500/20 text-purple-300">
                              async
                            </span>
                          )}
                          {fn.modifiers?.includes('arrow') && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/20 text-blue-300">
                              arrow
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] font-mono truncate text-muted mt-1">
                          {fn.filePath}:{fn.lineStart}{fn.lineEnd ? `-${fn.lineEnd}` : ''}
                        </p>
                      </div>

                      <ArrowRight className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${isSelected ? 'translate-x-1 text-cyan-400' : 'text-muted opacity-40'}`} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Function Details, Call Hierarchy & Chain Flow */}
        <div className="lg:col-span-7 space-y-4">
          {selectedFn ? (
            <div className="p-5 rounded-2xl border space-y-5" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              {/* Header Details */}
              <div className="border-b pb-4 space-y-2" style={{ borderColor: 'var(--border-base)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-mono font-black text-cyan-400">
                        {selectedFn.name}
                      </h3>
                      {selectedFn.modifiers?.map((mod, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-xs font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                          {mod}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs font-mono flex items-center gap-1.5 text-muted mt-1">
                      <FileCode className="w-3.5 h-3.5" />
                      <span>{selectedFn.filePath}</span>
                      <span>• Ligne {selectedFn.lineStart}{selectedFn.lineEnd ? ` à ${selectedFn.lineEnd}` : ''}</span>
                    </p>
                  </div>
                </div>

                {/* Signature Box */}
                {selectedFn.signature && (
                  <div className="p-3 rounded-xl bg-black/40 border font-mono text-xs text-emerald-300 overflow-x-auto" style={{ borderColor: 'var(--border-base)' }}>
                    <code>{selectedFn.signature}</code>
                  </div>
                )}
              </div>

              {/* Sub Navigation */}
              <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border-base)' }}>
                <button
                  onClick={() => setActiveSubTab('hierarchy')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeSubTab === 'hierarchy' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-muted hover:text-white'
                  }`}
                >
                  Hiérarchie d'Appels ({callers.length} in / {callees.length} out)
                </button>
                <button
                  onClick={() => setActiveSubTab('chain')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeSubTab === 'chain' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-muted hover:text-white'
                  }`}
                >
                  Flux de Chaîne BFS ({chain?.nodes.length ?? 0} nœuds)
                </button>
              </div>

              {/* Inspector Content */}
              {inspectLoading ? (
                <div className="py-12 text-center text-muted">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-400" />
                  <p className="text-xs">Extraction du graphe d'appels AST...</p>
                </div>
              ) : activeSubTab === 'hierarchy' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Callers */}
                  <div className="p-3.5 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                        <CornerDownRight className="w-3.5 h-3.5" />
                        Appelants Entrants ({callers.length})
                      </span>
                    </div>

                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                      {callers.length === 0 ? (
                        <p className="text-xs text-muted py-3 text-center">Aucun appelant direct trouvé</p>
                      ) : (
                        callers.map((c, i) => (
                          <div key={i} className="p-2.5 rounded-lg border bg-black/20 space-y-1" style={{ borderColor: 'var(--border-base)' }}>
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-purple-300">
                                {c.callerId}
                              </span>
                              {c.isAwait && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300">
                                  await
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-muted">
                              Ligne {c.sourceLine} {c.isResolved ? '• ✅ Résolu' : '• ⚠️ Externe'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Callees */}
                  <div className="p-3.5 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <ArrowDownRight className="w-3.5 h-3.5" />
                        Fonctions Appelées ({callees.length})
                      </span>
                    </div>

                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                      {callees.length === 0 ? (
                        <p className="text-xs text-muted py-3 text-center">Aucun appel sortant détecté</p>
                      ) : (
                        callees.map((c, i) => (
                          <div key={i} className="p-2.5 rounded-lg border bg-black/20 space-y-1" style={{ borderColor: 'var(--border-base)' }}>
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-emerald-300">
                                {c.calleeObject ? `${c.calleeObject}.${c.calleeName}()` : `${c.calleeName}()`}
                              </span>
                              {c.isAwait && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300">
                                  await
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-muted">
                              Ligne {c.sourceLine} {c.calleeObject === 'this' ? '• Intra-Classe' : c.isResolved ? '• ✅ Résolu' : ''}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* BFS Call Chain Flow */
                <div className="p-4 rounded-xl border space-y-4" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5" />
                      Arborescence d'Exécution Récursive
                    </span>
                    {chain?.maxDepthReached && (
                      <span className="text-[10px] text-amber-400">Profondeur max (3) atteinte</span>
                    )}
                  </div>

                  {chain && chain.nodes.length > 0 ? (
                    <div className="space-y-2">
                      {chain.nodes.map((node, i) => (
                        <div
                          key={node.id}
                          className={`p-3 rounded-xl border font-mono text-xs flex items-center justify-between gap-3 ${
                            i === 0 ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200' : 'bg-black/20 border-white/5 text-muted'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center text-[10px] text-muted">
                              {i + 1}
                            </span>
                            <span className="font-bold">{node.functionName}()</span>
                            {node.className && (
                              <span className="text-muted text-[11px]">in {node.className}</span>
                            )}
                          </div>
                          <span className="text-[11px] opacity-70 truncate max-w-[200px]">{node.filePath}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted text-center py-6">Aucune chaîne d'appels détectée</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center rounded-2xl border" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Sélectionnez une fonction</h4>
              <p className="text-xs">Choisissez un symbole dans la liste de gauche pour inspecter son graphe d'appels et sa signature AST.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
