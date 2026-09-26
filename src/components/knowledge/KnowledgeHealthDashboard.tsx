import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  FileCode,
  Layers,
  Database,
  GitBranch,
  GitFork,
  Zap,
  Folder,
  HardDrive,
} from 'lucide-react';
import { useToast } from '../ui/Toast.js';
import { ASTCallGraphExplorer } from './ASTCallGraphExplorer.js';

interface HealthData {
  status: string;
  timestamp: string;
  health: {
    overall: 'healthy' | 'warning' | 'degraded';
    isInitialized: boolean;
    lastIndexed?: string;
    warnings: string[];
  };
  knowledgeGraph: {
    totalFiles: number;
    totalEntities: number;
    totalLines: number;
    totalExports: number;
    totalImports: number;
    averageFileSize: number;
  };
  dependencyGraph: {
    cycleCount: number;
    cycles: string[][];
  };
  projectMemory: {
    totalFacts: number;
    structuralFacts: number;
    categoryBreakdown: Record<string, number>;
    maxFacts: number;
  };
  workspace: {
    selfRoot: string;
    activeWorkspace: string;
    sandboxActive: boolean;
  };
}

interface DocumentsData {
  extractor: { extracted: number; watching: boolean };
  documentCount: number;
  documents: {
    id: string;
    fileName: string;
    mimeType: string;
    summary: string;
    keywords: string[];
    tags: string[];
    uploadedAt: string;
    textLength: number;
  }[];
}

export function KnowledgeHealthDashboard() {
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<HealthData | null>(null);
  const [docsData, setDocsData] = useState<DocumentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'ast' | 'memory' | 'documents' | 'dependencies'>('overview');

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, docsRes] = await Promise.all([
        fetch('/api/knowledge/health'),
        fetch('/api/knowledge/documents'),
      ]);
      if (!healthRes.ok) throw new Error('Erreur HTTP ' + healthRes.status);
      const json = await healthRes.json();
      if (json.status === 'success') {
        setData(json);
      } else {
        throw new Error(json.error || 'Statut invalide');
      }
      if (docsRes.ok) {
        const docsJson = await docsRes.json();
        if (docsJson.status === 'success') {
          setDocsData(docsJson);
        }
      }
    } catch (err: any) {
      toastError('Impossible de charger le statut du Knowledge System');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/knowledge/reindex', { method: 'POST' });
      if (!res.ok) throw new Error('Échec réindexation');
      const json = await res.json();
      success(`Projet réindexé avec succès : ${json.stats?.totalFiles ?? 0} fichiers en ${(json.stats?.durationMs / 1000).toFixed(1)}s`);
      await fetchHealth();
    } catch (err: any) {
      toastError('Erreur lors de la réindexation du projet');
    } finally {
      setReindexing(false);
    }
  };

  const handleReextract = async () => {
    setReextracting(true);
    try {
      const res = await fetch('/api/knowledge/documents/reextract', { method: 'POST' });
      if (!res.ok) throw new Error('Échec ré-extraction');
      const json = await res.json();
      success(`Documents ré-extraits : ${json.stats?.totalExtracted ?? 0} documents, ${json.stats?.totalWords ?? 0} mots`);
      await fetchHealth();
    } catch (err: any) {
      toastError('Erreur lors de la ré-extraction des documents');
    } finally {
      setReextracting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-3" style={{ color: 'var(--text-muted)' }}>
        <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <p className="text-sm font-medium">Analyse de la santé du Knowledge System...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center rounded-2xl border" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-500" />
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Données de santé indisponibles</p>
        <button
          onClick={fetchHealth}
          className="mt-4 px-4 py-2 text-xs font-semibold rounded-xl transition-all"
          style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  const { health, knowledgeGraph: kg, dependencyGraph: dg, projectMemory: pm, workspace } = data;

  const getStatusBadge = () => {
    switch (health.overall) {
      case 'healthy':
        return (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <CheckCircle2 className="w-3.5 h-3.5" />
            Système Optimal
          </div>
        );
      case 'warning':
        return (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <AlertTriangle className="w-3.5 h-3.5" />
            Avertissements Détectés
          </div>
        );
      case 'degraded':
      default:
        return (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
            <XCircle className="w-3.5 h-3.5" />
            Système Dégradé
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Status */}
      <div
        className="p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
      >
        <div className="space-y-1.5 z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Knowledge System Health Monitor
            </h2>
            {getStatusBadge()}
          </div>
          <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <Folder className="w-3.5 h-3.5 opacity-70" />
            <span>Workspace : <code className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--bg-base)' }}>{workspace.activeWorkspace}</code></span>
            {workspace.sandboxActive && (
              <span 
                className="px-2 py-0.5 rounded text-sm font-semibold"
                style={{
                  backgroundColor: 'rgba(0, 194, 255, 0.2)',
                  color: 'rgba(0, 194, 255, 0.7)',
                  border: '1px solid rgba(0, 194, 255, 0.3)',
                }}
              >
                Sandbox Actif
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 z-10">
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="p-2.5 rounded-xl border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
            title="Rafraîchir les métriques"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-lg shadow-cyan-500/10 active:scale-95 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
          >
            <Zap className={`w-3.5 h-3.5 ${reindexing ? 'animate-bounce' : ''}`} />
            {reindexing ? 'Réindexation...' : 'Réindexer le projet'}
          </button>
        </div>
      </div>

      {/* Warnings Panel if any */}
      {health.warnings.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Diagnostiques et Avertissements Système ({health.warnings.length})</span>
          </div>
          <ul className="space-y-1 pl-6 list-disc text-xs text-amber-200/80">
            {health.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: KnowledgeGraph */}
        <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Codebase Indexé
            </span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <FileCode className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
              {kg.totalFiles} <span className="text-xs font-normal text-muted">fichiers</span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {kg.totalEntities.toLocaleString()} entités • {kg.totalLines.toLocaleString()} lignes
            </p>
          </div>
          <div className="pt-2 border-t text-xs flex justify-between" style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
            <span>Exports : {kg.totalExports}</span>
            <span>Imports : {kg.totalImports}</span>
          </div>
        </div>

        {/* Card 2: ProjectMemory */}
        <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Project Memory
            </span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black flex items-baseline gap-2" style={{ color: 'var(--text-primary)' }}>
              {pm.totalFacts}
              <span className="text-xs font-normal text-muted">/ {pm.maxFacts} faits</span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              <span className="text-emerald-400 font-semibold">{pm.structuralFacts}</span> faits structurels protégés
            </p>
          </div>
          {/* Progress bar */}
          <div className="space-y-1 pt-1">
            <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-cyan-500 to-blue-500"
                style={{ width: `${Math.min(100, (pm.totalFacts / pm.maxFacts) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Card 3: Dependency Graph */}
        <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Graphe Dépendances
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <GitBranch className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              {dg.cycleCount === 0 ? (
                <span className="text-emerald-400">0 Cycles</span>
              ) : (
                <span className="text-amber-400">{dg.cycleCount} Cycles</span>
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {dg.cycleCount === 0 ? 'Aucune dépendance circulaire' : 'Implications sur la maintenabilité'}
            </p>
          </div>
          <div className="pt-2 border-t text-xs flex justify-between" style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
            <span>Statut : {dg.cycleCount === 0 ? 'Sain' : 'Attention'}</span>
            <span>DFS Inspector : Actif</span>
          </div>
        </div>

        {/* Card 4: Documents Extraits */}
        <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Documents Extraits
            </span>
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <FileCode className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
              {docsData?.documentCount ?? 0} <span className="text-xs font-normal text-muted">documents</span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {docsData?.extractor?.watching ? (
                <span className="text-emerald-400">⚡ Extraction temps réel active</span>
              ) : (
                <span className="text-amber-400">En attente d'activation</span>
              )}
            </p>
          </div>
          <div className="pt-2 border-t text-xs flex justify-between" style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
            <span>Auto-scan : {docsData?.extractor?.watching ? 'ON' : 'OFF'}</span>
            <button
              onClick={handleReextract}
              disabled={reextracting}
              className="text-cyan-400 hover:underline font-medium"
            >
              {reextracting ? '...' : 'Ré-extraire'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="space-y-4">
        {/* Tabs Navigation */}
        <div className="flex items-center gap-2 border-b pb-2 overflow-x-auto" style={{ borderColor: 'var(--border-base)' }}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-muted hover:text-white hover:bg-white/5'
            }`}
          >
            Vue d'Ensemble
          </button>
          <button
            onClick={() => setActiveTab('ast')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'ast'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-500/10'
            }`}
          >
            <GitFork className="w-3.5 h-3.5" />
            AST & Call-Graph
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'memory'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-muted hover:text-white hover:bg-white/5'
            }`}
          >
            Project Memory ({pm.totalFacts})
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'documents'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-muted hover:text-white hover:bg-white/5'
            }`}
          >
            Documents ({docsData?.documentCount ?? 0})
          </button>
          {dg.cycleCount > 0 && (
            <button
              onClick={() => setActiveTab('dependencies')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'dependencies'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-amber-400/80 hover:bg-amber-500/10'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Cycles ({dg.cycleCount})
            </button>
          )}
        </div>

        {/* Tab: AST Call-Graph Explorer */}
        {activeTab === 'ast' && (
          <div className="pt-2">
            <ASTCallGraphExplorer />
          </div>
        )}

        {/* Tab 1: Overview Details */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <HardDrive className="w-4 h-4" style={{ color: '#00c2ff' }} />
                Détails de Persistance Disque
              </h3>
              <div className="space-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <div className="flex justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
                  <span>Fichier de Graphe (local au projet) :</span>
                  <code className="font-mono text-emerald-400">.project-knowledge.json</code>
                </div>
                <div className="flex justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
                  <span>Mémoire Métier (local au projet) :</span>
                  <code className="font-mono text-purple-400">.project-memory.json</code>
                </div>
                <div className="flex justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
                  <span>Statut Auto-Indexation :</span>
                  <span className="text-emerald-400 font-semibold">Protégé contre doublons</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Layers className="w-4 h-4 text-cyan-400" />
                Répartition des Faits en Mémoire
              </h3>
              <div className="space-y-2">
                {Object.entries(pm.categoryBreakdown).length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucune catégorie enregistrée.</p>
                ) : (
                  Object.entries(pm.categoryBreakdown).map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between text-xs">
                      <span className="capitalize" style={{ color: 'var(--text-muted)' }}>{cat}</span>
                      <span className="font-semibold px-2 py-0.5 rounded-full text-sm" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                        {count} fait{count > 1 ? 's' : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Memory Details */}
        {activeTab === 'memory' && (
          <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400">
                Structure & Protection de la Mémoire
              </h3>
              <span className="text-xs text-muted">
                Max : {pm.maxFacts} faits (Élagage automatique au-delà)
              </span>
            </div>
            <p className="text-xs text-muted">
              Les faits avec le badge <span className="text-emerald-400 font-semibold">isStructural</span> sont automatiquement immunisés contre l'élagage GC même s'ils sont peu consultés.
            </p>
          </div>
        )}

        {/* Tab 3: Documents extraits */}
        {activeTab === 'documents' && (
          <div className="p-4 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <FileCode className="w-4 h-4 text-cyan-400" />
                Documents Extraits Automatiquement du Workspace
              </h3>
              <button
                onClick={handleReextract}
                disabled={reextracting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}
              >
                <RefreshCw className={`w-3 h-3 ${reextracting ? 'animate-spin' : ''}`} />
                {reextracting ? 'Extraction...' : 'Ré-extraire tout'}
              </button>
            </div>

            {docsData && docsData.documents.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {docsData.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 rounded-xl border transition-colors hover:border-cyan-500/30"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-base)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                            {doc.fileName}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded text-xs font-mono flex-shrink-0"
                            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                          >
                            {doc.mimeType.split('/')[1] || doc.mimeType}
                          </span>
                        </div>
                        <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                          {doc.summary}
                        </p>
                      </div>
                      <span className="text-xs flex-shrink-0 font-mono" style={{ color: 'var(--text-dimmed)' }}>
                        {(doc.textLength / 1000).toFixed(1)}k
                      </span>
                    </div>
                    {doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {doc.tags.slice(0, 5).map((tag, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-xs"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileCode className="w-10 h-10 mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Aucun document extrait. Cliquez sur "Ré-extraire tout" ou attendez le prochain scan automatique.
                </p>
              </div>
            )}

            <div className="pt-3 border-t text-sm flex items-center gap-4" style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
              <span>
                Formats supportés : <code>.md</code> <code>.txt</code> <code>.rst</code> <code>.adoc</code> <code>.tex</code> <code>.yaml</code> <code>.csv</code>
              </span>
              <span className="ml-auto">
                {docsData?.extractor?.watching ? '🟢 Surveillance active' : '🔴 Surveillance inactive'}
              </span>
            </div>
          </div>
        )}

        {/* Tab 4: Cycles */}
        {activeTab === 'dependencies' && dg.cycleCount > 0 && (
          <div className="p-4 rounded-2xl border space-y-3 bg-amber-500/5 border-amber-500/20">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Cycles de Dépendances Circulaires Détectés
            </h3>
            <div className="space-y-2">
              {dg.cycles.map((cycle, i) => (
                <div key={i} className="p-3 rounded-xl bg-black/30 border border-amber-500/20 font-mono text-xs text-amber-200">
                  {cycle.join(' ➔ ')}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
