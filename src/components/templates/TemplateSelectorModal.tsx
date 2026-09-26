/**
 * TemplateSelectorModal.tsx — Interactive Template Library UI with live variables editor and Markdown preview.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, Sparkles, Copy, Download, FileText, Layout, Check,
  Rocket, Cpu, ClipboardList, Code2, Calendar, Edit3, Eye
} from 'lucide-react';
import { DOCUMENT_TEMPLATES, DocumentTemplate } from '../../config/documentTemplates.js';
import {
  extractVariables,
  renderTemplate,
  getDefaultVariableValues
} from '../../utils/templateVariables.js';
import { useToast } from '../ui/Toast.js';
import { useProfile } from '../../context/UserProfileContext.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate?: (renderedContent: string, template: DocumentTemplate) => void;
  onInsertToIde?: (filename: string, content: string) => void;
  onCreateNote?: (title: string, content: string) => void;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Rocket,
  Cpu,
  ClipboardList,
  Code2,
  Calendar,
  FileText,
  Layout,
};

export function TemplateSelectorModal({
  isOpen,
  onClose,
  onSelectTemplate,
  onInsertToIde,
  onCreateNote,
}: Props) {
  const { success } = useToast();
  const { profile } = useProfile();

  const [selectedCategory, setSelectedCategory] = useState<string>('Tout');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState<string>(DOCUMENT_TEMPLATES[0].id);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'variables' | 'preview'>('variables');

  // Default values for variables based on profile
  const defaultVarValues = useMemo(() => {
    return getDefaultVariableValues(profile.userName || 'Mayss', 'Leanna');
  }, [profile.userName]);

  const [variableValues, setVariableValues] = useState<Record<string, string>>(defaultVarValues);

  // Active template object
  const activeTemplate = useMemo(() => {
    return DOCUMENT_TEMPLATES.find(t => t.id === activeTemplateId) || DOCUMENT_TEMPLATES[0];
  }, [activeTemplateId]);

  // Variables extracted from active template
  const activeVariables = useMemo(() => {
    return extractVariables(activeTemplate.content);
  }, [activeTemplate]);

  // Real-time rendered content
  const renderedContent = useMemo(() => {
    return renderTemplate(activeTemplate.content, variableValues);
  }, [activeTemplate, variableValues]);

  // Filter templates by category and search query
  const filteredTemplates = useMemo(() => {
    return DOCUMENT_TEMPLATES.filter(template => {
      const matchCat = selectedCategory === 'Tout' || template.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        template.title.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.tags.some(t => t.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [selectedCategory, searchQuery]);

  const handleVariableChange = (key: string, value: string) => {
    setVariableValues(prev => ({ ...prev, [key]: value }));
  };

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(renderedContent);
    setCopied(true);
    success('Contenu copié dans le presse-papier !');
    setTimeout(() => setCopied(false), 2000);
  }, [renderedContent, success]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([renderedContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeTemplate.suggestedFilename || 'document-template.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    success(`Fichier ${activeTemplate.suggestedFilename} téléchargé.`);
  }, [renderedContent, activeTemplate, success]);

  const handleApply = useCallback(() => {
    if (onSelectTemplate) {
      onSelectTemplate(renderedContent, activeTemplate);
    }
    if (onInsertToIde) {
      onInsertToIde(activeTemplate.suggestedFilename, renderedContent);
    } else if (onCreateNote) {
      onCreateNote(activeTemplate.title, renderedContent);
    }
    onClose();
  }, [renderedContent, activeTemplate, onSelectTemplate, onInsertToIde, onCreateNote, onClose]);

  if (!isOpen) return null;

  const categories = ['Tout', 'Produit', 'Architecture', 'Ingénierie', 'Management'];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-5xl h-[85vh] max-h-[800px] flex flex-col rounded-2xl overflow-hidden shadow-2xl border"
          style={{
            backgroundColor: 'var(--bg-panel)',
            borderColor: 'var(--border-base)',
            color: 'var(--text-primary)',
          }}
        >
          {/* ═══ HEADER ═══ */}
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-base)' }}>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent-primary)]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Bibliothèque de Templates & Modèles</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Sélectionnez un modèle, personnalisez les variables dynamiques et insérez-le directement.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ═══ BODY LAYOUT ═══ */}
          <div className="flex-1 flex overflow-hidden">
            {/* LEFT SIDE: Template List & Search */}
            <div className="w-1/3 min-w-[300px] border-r flex flex-col p-4 gap-3" style={{ borderColor: 'var(--border-base)' }}>
              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Rechercher un modèle..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border bg-black/20 outline-none focus:border-[var(--accent-primary)] transition-colors"
                  style={{ borderColor: 'var(--border-base)' }}
                />
              </div>

              {/* Category pills */}
              <div className="flex flex-wrap gap-1.5 pb-1">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                      selectedCategory === cat
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'bg-white/5 hover:bg-white/10 text-[var(--text-muted)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Template list cards */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {filteredTemplates.map(template => {
                  const IconComp = ICON_MAP[template.iconName] || FileText;
                  const isActive = template.id === activeTemplateId;
                  return (
                    <button
                      key={template.id}
                      onClick={() => setActiveTemplateId(template.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex flex-col gap-1.5 ${
                        isActive
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)]/40 shadow-sm'
                          : 'border-[var(--border-base)] bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <IconComp className="w-4 h-4 text-[var(--accent-primary)]" />
                          <span className="text-xs font-semibold text-[var(--text-primary)]">{template.title}</span>
                        </div>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-[var(--text-muted)] font-mono">
                          {template.badge}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                        {template.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* RIGHT SIDE: Variables Form & Live Preview */}
            <div className="flex-1 flex flex-col bg-black/10 overflow-hidden">
              {/* Tabs header */}
              <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-base)' }}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('variables')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeTab === 'variables'
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Variables dynamiques ({activeVariables.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeTab === 'preview'
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Aperçu Markdown
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 border text-[var(--text-primary)] transition-all"
                    style={{ borderColor: 'var(--border-base)' }}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 border text-[var(--text-primary)] transition-all"
                    style={{ borderColor: 'var(--border-base)' }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    .MD
                  </button>
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                {activeTab === 'variables' ? (
                  <div className="space-y-4 max-w-xl">
                    <div className="p-3 rounded-xl bg-[var(--accent-subtle)] border border-[var(--accent-primary)]/30 text-xs text-[var(--text-secondary)]">
                      Modifiez les valeurs ci-dessous. Elles seront automatiquement substituées dans le modèle en temps réel.
                    </div>
                    {activeVariables.map(vKey => (
                      <div key={vKey} className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold capitalize text-[var(--text-primary)] flex items-center gap-1">
                          <span className="font-mono text-[var(--accent-primary)]">{`{${vKey}}`}</span>
                        </label>
                        <input
                          type="text"
                          value={variableValues[vKey] || ''}
                          onChange={e => handleVariableChange(vKey, e.target.value)}
                          placeholder={`Entrez la valeur pour ${vKey}`}
                          className="w-full px-3 py-2 text-xs rounded-xl border bg-black/20 outline-none focus:border-[var(--accent-primary)] transition-colors"
                          style={{ borderColor: 'var(--border-base)' }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="prose prose-invert max-w-none text-xs font-mono whitespace-pre-wrap leading-relaxed p-4 rounded-xl border bg-black/40" style={{ borderColor: 'var(--border-base)' }}>
                    {renderedContent}
                  </div>
                )}
              </div>

              {/* FOOTER ACTIONS */}
              <div className="p-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-base)' }}>
                <span className="text-xs text-[var(--text-muted)] font-mono">
                  {activeTemplate.suggestedFilename}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:bg-white/5 transition-all"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleApply}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-md active:scale-95"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    <Sparkles className="w-4 h-4" />
                    {onInsertToIde ? 'Insérer dans l\'Éditeur IDE' : onCreateNote ? 'Créer la Note' : 'Appliquer le Modèle'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
