/**
 * GeneratedDocsPanel — Affichage des documents générés
 * 
 * Ce panneau affiche la liste des documents précédemment générés
 * avec possibilité de les consulter ou supprimer.
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Sparkles, Trash2, FileText, HelpCircle, GraduationCap, Briefcase, Clock, List, Brain, Target, BookOpen, Lightbulb, Zap } from 'lucide-react';
import { useToast } from '../ui/Toast.js';

interface SourceItem {
  id: string;
  title: string;
  type: string;
}

interface GeneratedDoc {
  id: string;
  type: string;
  title: string;
  content: string;
  sourceIds: string[];
  createdAt: string;
}

interface Props {
  notebookId: string;
  sources: SourceItem[];
  onRefresh: () => void;
  onViewDoc?: (doc: { id: string; title: string; type: string; content: string; createdAt: string }) => void;
}

// Types de documents
const DOC_TYPES = [
  { key: 'full-report', label: 'Rapport complet', icon: FileText, color: 'var(--color-error)' },
  { key: 'summary', label: 'Résumé', icon: FileText, color: 'var(--accent-primary)' },
  { key: 'faq', label: 'FAQ', icon: HelpCircle, color: 'var(--color-accent-alt)' },
  { key: 'study-guide', label: 'Guide d\'étude', icon: GraduationCap, color: 'var(--color-success)' },
  { key: 'briefing', label: 'Briefing', icon: Briefcase, color: 'var(--color-warning)' },
  { key: 'timeline', label: 'Chronologie', icon: Clock, color: 'var(--color-error)' },
  { key: 'outline', label: 'Plan', icon: List, color: 'var(--accent-secondary)' },
  { key: 'mindmap', label: 'Carte mentale', icon: Brain, color: 'var(--color-error)' },
  { key: 'infographic', label: 'Infographie', icon: Lightbulb, color: 'var(--color-warning)' },
  { key: 'swot', label: 'Analyse SWOT', icon: Target, color: 'var(--color-info)' },
  { key: 'glossary', label: 'Glossaire', icon: BookOpen, color: 'var(--color-accent-alt)' },
  { key: 'roadmap', label: 'Roadmap', icon: Zap, color: 'var(--color-warning)' },
];

const REPORT_TYPES = [
  { key: 'report-business', label: 'Business Plan', icon: Briefcase, color: 'var(--color-warning)' },
  { key: 'report-market', label: 'Étude de marché', icon: Target, color: 'var(--color-info)' },
  { key: 'report-technical', label: 'Rapport technique', icon: FileText, color: 'var(--accent-primary)' },
  { key: 'report-competitive', label: 'Analyse concurrentielle', icon: Target, color: 'var(--color-accent-alt)' },
  { key: 'report-financial', label: 'Rapport financier', icon: FileText, color: 'var(--color-success)' },
  { key: 'report-marketing', label: 'Plan marketing', icon: Sparkles, color: 'var(--color-error)' },
  { key: 'report-product', label: 'Rapport produit', icon: List, color: 'var(--accent-secondary)' },
  { key: 'report-risk', label: 'Analyse des risques', icon: Target, color: 'var(--color-error)' },
  { key: 'report-executive', label: 'Synthèse exécutive', icon: Briefcase, color: 'var(--color-error)' },
  { key: 'report-project', label: 'Rapport de projet', icon: Clock, color: 'var(--color-accent-alt)' },
];

/**
 * Transition helpers pour les animations
 */
function useFluidTransition() {
  const reduceMotion = useReducedMotion();
  return {
    spring: reduceMotion
      ? { duration: 0.1, ease: 'easeOut' as const }
      : { type: 'spring' as const, bounce: 0, duration: 0.3 },
    fadeOnly: (offset: { x?: number; y?: number } = {}) =>
      reduceMotion
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
        : { initial: { opacity: 0, ...offset }, animate: { opacity: 1, x: 0, y: 0 }, exit: { opacity: 0, ...offset } },
  };
}

export function GeneratedDocsPanel({ notebookId, sources, onRefresh, onViewDoc }: Props) {
  const { success, error: toastError } = useToast();
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const { spring, fadeOnly } = useFluidTransition();

  // Charger les documents générés
  const loadGeneratedDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/generated`);
      if (res.ok) {
        const data = await res.json();
        setGeneratedDocs(data.documents || []);
      }
    } catch {
      toastError('Erreur lors du chargement de l\'historique');
    } finally {
      setLoading(false);
    }
  }, [notebookId, toastError]);

  useEffect(() => {
    loadGeneratedDocs();
  }, [loadGeneratedDocs]);

  // Fonction utilitaire pour obtenir le label d'un type de document
  const getDocTypeLabel = useCallback((typeKey: string) => {
    const docType = DOC_TYPES.find(t => t.key === typeKey) || REPORT_TYPES.find(t => t.key === typeKey);
    return docType?.label || typeKey;
  }, []);

  // Fonction utilitaire pour obtenir la couleur d'un type de document
  const getDocTypeColor = useCallback((typeKey: string) => {
    const docType = DOC_TYPES.find(t => t.key === typeKey) || REPORT_TYPES.find(t => t.key === typeKey);
    return docType?.color || 'var(--text-muted)';
  }, []);

  // Fonction utilitaire pour obtenir l'icône d'un type de document
  const getDocTypeIcon = useCallback((typeKey: string) => {
    const docType = DOC_TYPES.find(t => t.key === typeKey) || REPORT_TYPES.find(t => t.key === typeKey);
    return docType?.icon || Sparkles;
  }, []);

  // Supprimer un document
  const handleDelete = useCallback(async (docId: string) => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/generated/${docId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setGeneratedDocs(prev => prev.filter(d => d.id !== docId));
        success('Document supprimé');
        onRefresh();
      } else {
        throw new Error('Erreur lors de la suppression');
      }
    } catch {
      toastError('Erreur lors de la suppression du document');
    }
  }, [notebookId, onRefresh, success, toastError]);

  // Filtrer les documents par type
  const getSourceTitles = useCallback((sourceIds: string[]) => {
    return sourceIds
      .map(id => sources.find(s => s.id === id)?.title)
      .filter(Boolean)
      .join(', ');
  }, [sources]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Sparkles className="w-4 h-4 animate-pulse" />
          <span>Chargement de l'historique...</span>
        </div>
      </div>
    );
  }

  if (generatedDocs.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--bg-base)' }}>
          <Sparkles className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Aucun document généré pour le moment
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>
          Les documents générés s'afficheront ici
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header avec compteur */}
      <div className="flex items-center justify-between border-b px-4 py-3 flex-shrink-0" style={{ borderColor: 'var(--notebook-border)' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
            Historique des générations
          </h3>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
          {generatedDocs.length}
        </span>
      </div>

      {/* Liste des documents */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key="history-list"
            {...fadeOnly({})}
            transition={spring}
            className="space-y-2"
          >
            {generatedDocs
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(doc => {
                const docType = DOC_TYPES.find(t => t.key === doc.type) || REPORT_TYPES.find(t => t.key === doc.type);
                const DocIcon = docType?.icon || Sparkles;
                const color = docType?.color || 'var(--text-muted)';
                const label = docType?.label || doc.type;
                
                return (
                  <motion.div
                    key={doc.id}
                    layout
                    onClick={() => {
                      setSelectedDoc(doc);
                      if (onViewDoc) {
                        onViewDoc({
                          id: doc.id,
                          title: doc.title,
                          type: doc.type,
                          content: doc.content,
                          createdAt: doc.createdAt
                        });
                      }
                    }}
                    className="group cursor-pointer p-3 rounded-xl border transition-all hover:shadow-sm"
                    style={{
                      borderColor: selectedDoc?.id === doc.id ? color : 'var(--notebook-border)',
                      backgroundColor: selectedDoc?.id === doc.id ? `${color}08` : 'var(--notebook-card-bg)',
                    }}
                    whileHover={{ scale: 1.01 }}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icône */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${color}15` }}
                      >
                        <DocIcon className="w-4 h-4" style={{ color }} />
                      </div>
                      
                      {/* Contenu */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                            {doc.title}
                          </p>
                          {doc.sourceIds.length > 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${color}15`, color }}>
                              {doc.sourceIds.length}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium" style={{ color }}>
                            {label}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>•</span>
                          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                            {new Date(doc.createdAt).toLocaleDateString('fr-FR', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </span>
                          {doc.sourceIds.length > 0 && (
                            <>
                              <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>•</span>
                              <span className="text-xs truncate" style={{ color: 'var(--text-dimmed)' }}>
                                {getSourceTitles(doc.sourceIds)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(doc.id);
                          }}
                          className="p-1.5 opacity-0 group-hover:opacity-100 rounded hover:bg-red-500/10 transition-all"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Affichage du document sélectionné (optionnel - si on veut voir le contenu) */}
      {selectedDoc && onViewDoc === undefined && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="flex-1 overflow-y-auto p-4 border-t"
          style={{ borderColor: 'var(--notebook-border)' }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedDoc(null)}
                className="text-xs px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                ← Retour
              </button>
              <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {selectedDoc.title}
              </h4>
            </div>
            <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
              {selectedDoc.content.slice(0, 2000)}
              {selectedDoc.content.length > 2000 && '...'}
            </pre>
          </div>
        </motion.div>
      )}
    </div>
  );
}
