/**
 * GeneratePanel — Génération de contenu dérivé (FAQ, résumé, guide, etc.)
 *
 * Fonctionnalités :
 * - Génération en streaming (contenu affiché en temps réel)
 * - Sélection des sources spécifiques
 * - Instructions personnalisées (prompt custom)
 * - Export Markdown
 * - Régénération
 * - Rendu Mermaid pour les diagrammes
 */

import { useState, useCallback, useRef, useEffect, JSX } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Sparkles, FileText, HelpCircle, GraduationCap, Briefcase, Clock, List,
  Loader2, Copy, CheckCircle2, Download, RefreshCw,
  Filter, PenLine, Brain, Target, BookOpen, FolderInput,
  FileBarChart, Lightbulb, Zap, X, ArrowRight, ArrowLeft, Presentation,
} from 'lucide-react';
import { Tooltip } from '../ui/Tooltip.js';
import { SlidePreviewModal } from './SlidePreviewModal.js';
import { useToast } from '../ui/Toast.js';
import { useProfile } from '../../context/UserProfileContext.js';
import { MermaidDiagram } from './MermaidDiagram.js';
// Styles premium NotebookLM
import '../../styles/notebooklm.css';

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

// Type pour les tâches dans la file d'attente
interface QueuedGeneration {
  id: string;
  type: string;
  sourceIds?: string[];
  customInstructions?: string;
  title: string;
  progress: number; // 0-100
  status: 'pending' | 'generating' | 'completed' | 'error';
  createdAt: number;
}

interface Props {
  notebookId: string;
  sources: SourceItem[];
  onRefresh: () => void;
  /** When true, renders full layout with doc viewer (for center panel) */
  fullView?: boolean;
  /** Close the full view */
  onClose?: () => void;
  /** Open a specific doc in the main center panel */
  onViewDoc?: (doc: { id: string; title: string; type: string; content: string; createdAt: string }) => void;
  /** Initial document to display when opening in fullView */
  initialDoc?: { id: string; title: string; type: string; content: string; createdAt: string } | null;
}

const DOC_TYPES = [
  { key: 'full-report', label: 'Rapport complet', icon: FileBarChart, desc: 'Rapport pro : résumé exécutif, analyse, recommandations', color: 'var(--color-error)' },
  { key: 'summary', label: 'Résumé', icon: FileText, desc: 'Synthèse structurée des sources', color: 'var(--accent-primary)' },
  { key: 'faq', label: 'FAQ', icon: HelpCircle, desc: '15-20 questions/réponses', color: 'var(--color-accent-alt)' },
  { key: 'study-guide', label: 'Guide d\'étude', icon: GraduationCap, desc: 'Concepts, quiz, résumé', color: 'var(--color-success)' },
  { key: 'briefing', label: 'Briefing', icon: Briefcase, desc: 'Document exécutif concis', color: 'var(--color-warning)' },
  { key: 'timeline', label: 'Chronologie', icon: Clock, desc: 'Événements et jalons', color: 'var(--color-error)' },
  { key: 'outline', label: 'Plan', icon: List, desc: 'Structure hiérarchique', color: 'var(--accent-secondary)' },
  { key: 'mindmap', label: 'Carte mentale', icon: Brain, desc: 'Mindmap visuelle Mermaid', color: 'var(--color-error)' },
  { key: 'infographic', label: 'Infographie', icon: Lightbulb, desc: 'Visuel professionnel généré par IA', color: 'var(--color-warning)' },
  { key: 'swot', label: 'Analyse SWOT', icon: Target, desc: 'Forces, Faiblesses, Opportunités, Menaces', color: 'var(--color-info)' },
  { key: 'glossary', label: 'Glossaire', icon: BookOpen, desc: 'Termes techniques définis', color: 'var(--color-accent-alt)' },
  { key: 'roadmap', label: 'Roadmap', icon: Zap, desc: 'Roadmap projet auto-générée (business plan, étude de marché)', color: 'var(--color-warning)' },
];

/** Types de RAPPORTS disponibles dans le modal */
const REPORT_TYPES = [
  { key: 'report-business', label: 'Business Plan', icon: Briefcase, desc: 'Vision, modèle économique, stratégie et projections', color: 'var(--color-warning)' },
  { key: 'report-market', label: 'Étude de marché', icon: Target, desc: 'Taille du marché, segments, tendances, concurrence', color: 'var(--color-info)' },
  { key: 'report-technical', label: 'Rapport technique', icon: FileBarChart, desc: 'Architecture, choix techniques, spécifications', color: 'var(--accent-primary)' },
  { key: 'report-competitive', label: 'Analyse concurrentielle', icon: Target, desc: 'Positionnement, forces/faiblesses des concurrents', color: 'var(--color-accent-alt)' },
  { key: 'report-financial', label: 'Rapport financier', icon: FileBarChart, desc: 'Projections, coûts, rentabilité, KPIs', color: 'var(--color-success)' },
  { key: 'report-marketing', label: 'Plan marketing', icon: Sparkles, desc: 'Stratégie d\'acquisition, canaux, messaging', color: 'var(--color-error)' },
  { key: 'report-product', label: 'Rapport produit', icon: List, desc: 'Roadmap, fonctionnalités, priorisation, UX', color: 'var(--accent-secondary)' },
  { key: 'report-risk', label: 'Analyse des risques', icon: Target, desc: 'Risques identifiés, probabilité, mitigation', color: 'var(--color-error)' },
  { key: 'report-executive', label: 'Synthèse exécutive', icon: Briefcase, desc: 'Résumé décisionnel pour dirigeants', color: 'var(--color-error)' },
  { key: 'report-project', label: 'Rapport de projet', icon: Clock, desc: 'Avancement, livrables, jalons, blocages', color: 'var(--color-accent-alt)' },
];

// ============================================
// 🎨 RENDU PREMIUM - Style NotebookLM
// ============================================

/** Thèmes disponibles pour le code */
const CODE_THEMES: Record<string, { bg: string; text: string; border: string }> = {
  default: { bg: 'var(--bg-base)', text: 'var(--text-primary)', border: 'var(--border-base)' },
};

/**
 * Rendu premium du contenu généré
 * Supports: markdown complet + blocs de code enrichis + images + liens + tableaux
 */
function renderGeneratedContent(content: string): JSX.Element {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="notebooklm-prose max-w-none space-y-5">
      {parts.map((part, i) => {
        // --- BLOC DE CODE ---
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0]?.trim().toLowerCase() || '';
          const codeContent = (lang ? lines.slice(1) : lines).join('\n').trim();
          const theme = CODE_THEMES.default;

          // Mermaid
          if (lang === 'mermaid') {
            return (
              <div key={i} className="notebooklm-mermaid my-6">
                <MermaidDiagram code={codeContent} id={`gen-mermaid-${i}`} />
              </div>
            );
          }

          // Blocs de code premium
          return (
            <div
              key={i}
              className="notebooklm-code rounded-xl overflow-hidden shadow-sm border group/code relative"
              style={{ borderColor: theme.border, backgroundColor: theme.bg }}
            >
              {lang && (
                <div
                  className="flex items-center gap-2 px-4 py-2.5 border-b"
                  style={{
                    borderColor: theme.border,
                    backgroundColor: `color-mix(in srgb, ${theme.bg} 95%, black)`,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  />
                  <span className="text-xs font-medium text-[var(--text-dimmed)]">
                    {lang}
                  </span>
                </div>
              )}

              <pre
                className={`p-4 overflow-x-auto font-mono text-sm leading-relaxed ${
                  lang ? '' : 'rounded-xl'
                }`}
                style={{ color: theme.text }}
              >
                <code>{codeContent}</code>
              </pre>

              <button
                onClick={() => navigator.clipboard.writeText(codeContent)}
                className="absolute top-2 right-2 p-2 rounded-lg opacity-0 group-hover/code:opacity-100 transition-opacity hover:bg-white/10"
                style={{ color: 'var(--text-muted)' }}
                title="Copier"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }

        // --- CONTENU TEXTUEL ---
        const lines = part.split('\n');
        return (
          <div key={i} className="space-y-4">
            {lines.map((line, j) => {
              if (!line.trim()) return <div key={j} className="h-2" />;

              // ========== IMAGES ==========
              const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
              if (imgMatch) {
                return (
                  <figure key={j} className="notebooklm-figure my-6">
                    <div
                      className="rounded-2xl overflow-hidden border shadow-lg"
                      style={{
                        borderColor: 'var(--border-base)',
                        backgroundColor: 'var(--bg-base)',
                      }}
                    >
                      <img
                        src={imgMatch[2]}
                        alt={imgMatch[1] || 'Image'}
                        className="w-full h-auto"
                        style={{ maxHeight: '700px', objectFit: 'contain' }}
                      />
                    </div>
                    {imgMatch[1] && (
                      <figcaption
                        className="mt-3 text-center text-xs"
                        style={{ color: 'var(--text-dimmed)' }}
                      >
                        {imgMatch[1]}
                      </figcaption>
                    )}
                  </figure>
                );
              }

              // ========== TITRES ==========
              if (line.startsWith('# '))
                return (
                  <h1 key={j} className="notebooklm-h1 text-3xl md:text-4xl font-bold mt-8 mb-4">
                    {renderInlineMarkdown(line.slice(2).trim())}
                  </h1>
                );
              if (line.startsWith('## '))
                return (
                  <h2 key={j} className="notebooklm-h2 text-2xl md:text-3xl font-bold mt-7 mb-3">
                    {renderInlineMarkdown(line.slice(3).trim())}
                  </h2>
                );
              if (line.startsWith('### '))
                return (
                  <h3 key={j} className="notebooklm-h3 text-xl md:text-2xl font-semibold mt-6 mb-2">
                    {renderInlineMarkdown(line.slice(4).trim())}
                  </h3>
                );
              if (line.startsWith('#### '))
                return (
                  <h4 key={j} className="notebooklm-h4 text-lg md:text-xl font-semibold mt-5 mb-2">
                    {renderInlineMarkdown(line.slice(5).trim())}
                  </h4>
                );
              if (line.startsWith('##### '))
                return (
                  <h5 key={j} className="notebooklm-h5 text-base font-medium mt-4 mb-1.5">
                    {renderInlineMarkdown(line.slice(6).trim())}
                  </h5>
                );
              if (line.startsWith('###### '))
                return (
                  <h6 key={j} className="notebooklm-h6 text-sm font-medium mt-3 mb-1 opacity-80">
                    {renderInlineMarkdown(line.slice(7).trim())}
                  </h6>
                );

              // ========== SÉPARATEURS ==========
              if (line.match(/^---+$/) || line.match(/^___+$/) || line.match(/^\*\*\*+$/))
                return (
                  <hr
                    key={j}
                    className="my-6 border-0 h-px"
                    style={{
                      background: 'linear-gradient(to right, transparent, var(--border-base), transparent)',
                    }}
                  />
                );

              // ========== CITATIONS ==========
              if (line.startsWith('> '))
                return (
                  <blockquote
                    key={j}
                    className="notebooklm-blockquote pl-5 pr-4 py-3 rounded-xl my-4"
                    style={{
                      borderLeft: '3px solid var(--accent-primary)',
                      backgroundColor: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)',
                    }}
                  >
                    <p className="text-sm italic leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {renderInlineMarkdown(line.slice(2).trim())}
                    </p>
                  </blockquote>
                );

              // ========== LISTES À PUCES ==========
              if (line.match(/^[\-\*\+]\s/)) {
                const bullet = line.match(/^([\-\*\+])\s/)![1];
                return (
                  <div key={j} className="flex gap-3 py-1.5 notebooklm-list-item">
                    <span
                      className="mt-1.5 flex-shrink-0"
                      style={{ color: 'var(--accent-primary)', opacity: 0.7 }}
                    >
                      {bullet === '*' ? '•' : bullet === '+' ? '›' : '○'}
                    </span>
                    <div className="text-sm leading-relaxed flex-1">
                      {renderInlineMarkdown(line.slice(2).trim())}
                    </div>
                  </div>
                );
              }

              // ========== LISTES NUMÉROTÉES ==========
              if (line.match(/^\d+\.\s/)) {
                const numMatch = line.match(/^(\d+)\.\s(.*)$/);
                if (numMatch)
                  return (
                    <div key={j} className="flex gap-3 py-1.5 notebooklm-list-item">
                      <span
                        className="mt-1.5 flex-shrink-0 w-6 text-right font-semibold"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        {numMatch[1]}.
                      </span>
                      <div className="text-sm leading-relaxed flex-1">
                        {renderInlineMarkdown(numMatch[2])}
                      </div>
                    </div>
                  );
              }

              // ========== LISTES DE TÂCHES ==========
              const taskMatch = line.match(/^[\-\*]\s\[([xX\s])\]\s(.*)$/);
              if (taskMatch)
                return (
                  <div key={j} className="flex items-start gap-3 py-1.5 notebooklm-task">
                    <input
                      type="checkbox"
                      checked={taskMatch[1].toLowerCase() === 'x'}
                      readOnly
                      className="mt-1.5 w-4 h-4 rounded border-2 accent-[var(--accent-primary)]"
                    />
                    <span className="text-sm leading-relaxed pt-0.5">
                      {renderInlineMarkdown(taskMatch[2])}
                    </span>
                  </div>
                );

              // ========== LIENS STANDALONE ==========
              const bareLinkMatch = line.match(/^https?:\/\/[^\s]+$/);
              if (bareLinkMatch)
                return (
                  <p key={j} className="text-sm">
                    <a
                      href={line}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="notebooklm-link inline-flex items-center gap-1 font-medium"
                    >
                      {line}
                      <span className="opacity-50">↗</span>
                    </a>
                  </p>
                );

              // ========== PARAGRAPHES ==========
              return (
                <p key={j} className="text-sm leading-7 notebooklm-paragraph">
                  {renderInlineMarkdown(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Render infographic content — affiche l'image PNG directement */
function renderInfographicContent(content: string): JSX.Element {
  let imageSrc = '';
  let prompt = '';
  let model = '';
  let filePath = '';
  let sizeKB = 0;

  try {
    const data = JSON.parse(content);
    if (data.type === 'infographic-image') {
      imageSrc = `data:${data.mediaType};base64,${data.imageBase64}`;
      prompt = data.prompt || '';
      model = data.model || '';
      filePath = data.filePath || '';
      sizeKB = data.sizeKB || 0;
    }
  } catch {
    const imgMatch = content.match(/!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/);
    if (imgMatch) imageSrc = imgMatch[1];
  }

  if (!imageSrc) {
    return (
      <div
        className="flex flex-col items-center gap-4 p-8 rounded-2xl"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px dashed var(--border-base)',
        }}
      >
        <Lightbulb className="w-8 h-8 opacity-50" style={{ color: 'var(--color-warning)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Aucune image trouvée
        </p>
      </div>
    );
  }

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageSrc;
    link.download = filePath ? filePath.split('/').pop()! : `infographie-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="notebooklm-infographic space-y-6">
      <div
        className="rounded-3xl overflow-hidden shadow-2xl border"
        style={{
          borderColor: 'var(--border-base)',
          backgroundColor: 'var(--bg-base)',
        }}
      >
        <img
          src={imageSrc}
          alt="Infographie générée"
          className="w-full h-auto"
          style={{ maxHeight: '850px', objectFit: 'contain' }}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleDownload}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-md active:scale-[0.98]"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
            color: 'var(--color-warning)',
            border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
          }}
        >
          <Download className="w-4 h-4" />
          Télécharger PNG
        </button>

        {filePath && (
          <span
            className="text-xs px-3 py-1.5 rounded-xl"
            style={{
              backgroundColor: 'var(--bg-base)',
              color: 'var(--text-dimmed)',
            }}
          >
            📁 {filePath.split('/').pop()}
          </span>
        )}
        {sizeKB > 0 && (
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{
              backgroundColor: 'var(--bg-panel)',
              color: 'var(--text-dimmed)',
            }}
          >
            {sizeKB} KB
          </span>
        )}
      </div>

      {(prompt || model) && (
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{
            borderColor: 'var(--border-base)',
            backgroundColor: 'var(--bg-panel)',
          }}
        >
          {model && (
            <p className="text-sm flex items-center gap-2">
              <Brain
                className="w-4 h-4"
                style={{ color: 'var(--accent-primary)', opacity: 0.7 }}
              />
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Modèle:
              </span>
              <span style={{ color: 'var(--text-dimmed)' }}> {model}</span>
            </p>
          )}
          {prompt && (
            <p className="text-sm">
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Prompt:
              </span>
              <span
                className="ml-2 leading-relaxed"
                style={{ color: 'var(--text-dimmed)' }}
              >
                {prompt.slice(0, 250)}
                {prompt.length > 250 ? '...' : ''}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Rendu du markdown INLINE (gras, italique, code, liens, barré)
 * Optimisé avec parsing récursif
 */
function renderInlineMarkdown(text: string): JSX.Element {
  const parseMarkdown = (text: string, depth = 0): (string | JSX.Element)[] => {
    if (depth > 10) return [text];

    const result: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let hasMatch = false;

    const patterns: Array<{
      regex: RegExp;
      render: (content: string, fullMatch: string) => JSX.Element;
    }> = [
      {
        regex: /`([^`]+)`/g,
        render: (content) => (
          <code
            key={`${content}-code-${depth}`}
            className="notebooklm-inline-code px-1.5 py-0.5 rounded text-sm font-mono"
            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--accent-primary)' }}
          >
            {content}
          </code>
        ),
      },
      {
        regex: /\[([^\]]+)\]\(([^)]+)\)/g,
        render: (content, fullMatch) => {
          const matchResult = fullMatch.match(/\[([^\]]+)\]\(([^)]+)\)/);
          const linkText = matchResult ? matchResult[1] : content;
          const url = matchResult ? matchResult[2] : content;
          return (
            <a
              key={`${url}-link-${depth}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="notebooklm-link inline-flex items-center gap-1 font-medium"
              style={{ color: 'var(--accent-primary)' }}
            >
              {parseMarkdown(linkText, depth + 1)}
              <span className="opacity-50">↗</span>
            </a>
          );
        },
      },
      {
        regex: /\*\*([^*]+)\*\*/g,
        render: (content) => (
          <strong key={`${content}-bold-${depth}`} className="font-bold">
            {parseMarkdown(content, depth + 1)}
          </strong>
        ),
      },
      {
        regex: /\*([^*]+)\*/g,
        render: (content) => (
          <em key={`${content}-italic-${depth}`} className="italic opacity-80">
            {parseMarkdown(content, depth + 1)}
          </em>
        ),
      },
      {
        regex: /~~([^~]+)~~/g,
        render: (content) => (
          <s key={`${content}-strike-${depth}`} className="line-through opacity-50">
            {parseMarkdown(content, depth + 1)}
          </s>
        ),
      },
    ];

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        hasMatch = true;
        if (match.index > lastIndex) {
          result.push(text.slice(lastIndex, match.index));
        }
        result.push(pattern.render(match[1], match[0]));
        lastIndex = match.index + match[0].length;
      }
    }

    if (hasMatch) {
      if (lastIndex < text.length) {
        result.push(...parseMarkdown(text.slice(lastIndex), depth + 1));
      }
      return result;
    }

    return [text];
  };

  return <>{parseMarkdown(text)}</>;
}

// Ancienne fonction conservée pour compatibilité (à supprimer plus tard)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _renderBoldItalic(text: string): (string | JSX.Element)[] {
  return [renderInlineMarkdown(text)];
}

/** Détecte prefers-reduced-transparency pour durcir les scrims de modal */
function useReducedTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-transparency: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export function GeneratePanel({ notebookId, sources, onRefresh: _onRefresh, fullView = false, onClose, onViewDoc: _onViewDoc, initialDoc }: Props) {
  const { success, error: toastError } = useToast();
  const { profile } = useProfile();
  const [_generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);
  const [copied, setCopied] = useState(false);
  
  // File d'attente des générations
  const [generationQueue, setGenerationQueue] = useState<QueuedGeneration[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  
  // Générations parallèles - max 3 simultanées
  const MAX_PARALLEL_GENERATIONS = 3;
  const [activeGenerationIds, setActiveGenerationIds] = useState<Set<string>>(new Set());
  const [streamingTexts, setStreamingTexts] = useState<Record<string, string>>({});
  const [generationProgresses, setGenerationProgresses] = useState<Record<string, number>>({});

  // Source selection
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [showSourceFilter, setShowSourceFilter] = useState(false);

  // Custom instructions
  const [customInstructions, setCustomInstructions] = useState('');
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

  // Suggestions
  const [suggestions, setSuggestions] = useState<{ type: string; title: string; description: string; reason: string; relevance: number; recommendedSourceIds: string[] }[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Modal rapport complet
  const [showReportModal, setShowReportModal] = useState(false);
  const [modalSelectedType, setModalSelectedType] = useState<string | null>(null);
  const reportModalTriggerRef = useRef<HTMLButtonElement>(null);

  // Modal infographie
  const [showInfographicModal, setShowInfographicModal] = useState(false);
  const infographicModalTriggerRef = useRef<HTMLButtonElement>(null);

  // Modal slides Reveal.js
  const [showSlideModal, setShowSlideModal] = useState(false);
  // Types qui ne sont pas compatibles avec la génération de slides
  const SLIDE_EXCLUDED_TYPES = new Set(['infographic', 'mindmap']);
  const [infraOrientation, setInfraOrientation] = useState<'portrait' | 'landscape' | 'square'>('portrait');
  const [infraStyle, setInfraStyle] = useState<string>('auto');
  const [infraDetail, setInfraDetail] = useState<'low' | 'medium' | 'high'>('medium');
  const [infraLang, setInfraLang] = useState<string>('fr');
  const [infraDescription, setInfraDescription] = useState('');

  const contentRef = useRef<HTMLDivElement>(null);
  
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

  // Motion : spring critically-damped par défaut, fondu court si l'utilisateur
  // a demandé moins de mouvement. Aucun overshoot sur les modals — elles ne
  // portent aucune vélocité de geste à restituer.
  const reduceMotion = useReducedMotion();
  const modalSpring = reduceMotion
    ? { duration: 0.1, ease: 'easeOut' as const }
    : { type: 'spring' as const, bounce: 0, duration: 0.3 };
  const scrimSpring = { duration: 0.1 };
  const reducedTransparency = useReducedTransparency();
  const scrimStyle = reducedTransparency
    ? { backgroundColor: 'rgba(0,0,0,0.92)' }
    : { backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' };

  // Fermeture au clavier (Escape) + restitution du focus au déclencheur —
  // wayfinding : on doit toujours pouvoir sortir, et le focus doit revenir
  // là où l'utilisateur l'avait laissé.
  useEffect(() => {
    if (!showReportModal && !showInfographicModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showReportModal) {
        setShowReportModal(false);
        reportModalTriggerRef.current?.focus();
      }
      if (showInfographicModal) {
        setShowInfographicModal(false);
        infographicModalTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showReportModal, showInfographicModal]);

  // Charger les docs générés
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/generated`);
        if (res.ok) {
          const data = await res.json();
          setGeneratedDocs(data.documents || []);
        }
      } catch { /* ignore */ }
    })();
  }, [notebookId]);

  // Set initial doc when opened in fullView
  useEffect(() => {
    if (initialDoc && fullView) {
      setSelectedDoc(initialDoc as any);
    }
  }, [initialDoc, fullView]);

  // Auto-scroll pendant le streaming
  useEffect(() => {
    // Scroll si un des streams a du contenu
    const hasStreaming = Object.values(streamingTexts).some(text => text);
    if (hasStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [streamingTexts]);

  // Charger les suggestions de rapports - UNIQUEMENT au premier clic ou quand des sources sont ajoutées
  const loadSuggestions = useCallback(async () => {
    if (sources.length === 0) return;
    setLoadingSuggestions(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/report-suggestions`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      }
    } catch { /* ignore */ }
    finally { setLoadingSuggestions(false); }
  }, [notebookId, sources.length]);

  // Cache pour savoir si les suggestions ont déjà été chargées
  const hasLoadedSuggestionsRef = useRef(false);
  
  // Refresh UNIQUEMENT quand des NOUVELLES sources sont ajoutées (pas au premier rendu)
  const prevSourcesCountRef = useRef(sources.length);
  useEffect(() => {
    const currentCount = sources.length;
    
    // Si on passe de 0 à >0 sources, charger les suggestions (premier ajout)
    if (currentCount > 0 && prevSourcesCountRef.current === 0 && !hasLoadedSuggestionsRef.current) {
      prevSourcesCountRef.current = currentCount;
      hasLoadedSuggestionsRef.current = true;
      loadSuggestions();
    }
    // Si le nombre de sources augmente (nouvelle source ajoutée)
    else if (currentCount > prevSourcesCountRef.current && currentCount > 0) {
      prevSourcesCountRef.current = currentCount;
      loadSuggestions();
    }
    // Mettre à jour le compteur même si pas de chargement
    else if (currentCount !== prevSourcesCountRef.current) {
      prevSourcesCountRef.current = currentCount;
    }
  }, [sources.length, loadSuggestions]);

  // Ouvrir le modal "Rapport complet"
  const openReportModal = useCallback(() => {
    setShowReportModal(true);
    setModalSelectedType(null);
    // Charger les suggestions UNIQUEMENT au premier clic si ce n'est pas déjà fait
    if (!hasLoadedSuggestionsRef.current && sources.length > 0) {
      hasLoadedSuggestionsRef.current = true;
      loadSuggestions();
    }
  }, [loadSuggestions, sources.length]);

  // Lancer la génération depuis le modal
  const handleModalGenerate = useCallback((type: string) => {
    setShowReportModal(false);
    // Petite tempo pour laisser le modal se fermer
    setTimeout(() => {
      // On re-dispatch vers handleGenerate via le state
      setModalSelectedType(type);
    }, 100);
  }, []);

  // ─── File d'attente et progression ────────────────────────────────────
  
  // Ajouter une génération à la file d'attente
  const addToQueue = useCallback((type: string, extraInstructions?: string) => {
    const newTask: QueuedGeneration = {
      id: `gen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
      customInstructions: [customInstructions.trim(), extraInstructions?.trim()].filter(Boolean).join('\n') || undefined,
      title: getDocTypeLabel(type),
      progress: 0,
      status: 'pending',
      createdAt: Date.now(),
    };
    
    setGenerationQueue(prev => [...prev, newTask]);
    return newTask.id;
  }, [selectedSourceIds, customInstructions, getDocTypeLabel]);
  
  // Exécuter une tâche de génération individuelle
  const executeTask = useCallback(async (task: QueuedGeneration) => {
    // Ajouter à la liste des générations actives
    setActiveGenerationIds(prev => new Set(prev).add(task.id));
    setStreamingTexts(prev => ({ ...prev, [task.id]: '' }));
    setGenerationProgresses(prev => ({ ...prev, [task.id]: 1 })); // démarre à 1% pour confirmer le début
    
    // Progression basée sur le temps en fallback : avance régulièrement vers 90%
    // même si les chunks SSE arrivent groupés ou rarement.
    const startTime = Date.now();
    const ESTIMATED_MS = 30_000; // estimation 30s pour un doc moyen
    let timerId: ReturnType<typeof setInterval> | undefined;
    timerId = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const timeProgress = Math.min(90, Math.round((elapsed / ESTIMATED_MS) * 100));
      setGenerationProgresses(prev => {
        const current = prev[task.id] ?? 0;
        // N'avance que si le timer est en avance sur les chunks
        if (timeProgress > current) {
          setGenerationQueue(q => q.map(t =>
            t.id === task.id ? { ...t, progress: timeProgress } : t
          ));
          return { ...prev, [task.id]: timeProgress };
        }
        return prev;
      });
    }, 500);
    
    // Mettre à jour le statut de la tâche
    setGenerationQueue(prev => prev.map(t => 
      t.id === task.id ? { ...t, status: 'generating', progress: 1 } : t
    ));
    
    // Réinitialiser le document sélectionné si on génère un nouveau
    if (selectedDoc) setSelectedDoc(null);
    
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: task.type,
          sourceIds: task.sourceIds,
          customInstructions: task.customInstructions,
          imageModel: profile.openrouterImageModel || undefined,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Pas de body stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      // Estimation cible : ~12 000 caractères pour un document moyen.
      // On plafonne à 95 % pour que le passage à 100 % soit déclenché
      // uniquement par l'événement "document" final du serveur.
      const ESTIMATED_TOTAL_CHARS = 12_000;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) continue;
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;

                // Progression linéaire bornée à 95 % jusqu'à réception du doc final
                const progress = Math.min(95, Math.round((accumulated.length / ESTIMATED_TOTAL_CHARS) * 100));
                setGenerationProgresses(prev => ({ ...prev, [task.id]: progress }));
                setGenerationQueue(prev => prev.map(t =>
                  t.id === task.id ? { ...t, progress } : t
                ));
                setStreamingTexts(prev => ({ ...prev, [task.id]: accumulated }));
              } else if (parsed.document) {
                setGenerationProgresses(prev => ({ ...prev, [task.id]: 100 }));
                setGenerationQueue(prev => prev.map(t => 
                  t.id === task.id ? { ...t, progress: 100, status: 'completed' } : t
                ));
                setStreamingTexts(prev => ({ ...prev, [task.id]: '' }));
                setGeneratedDocs(prev => [parsed.document, ...prev]);
                setSelectedDoc(parsed.document);
                success(`"${parsed.document.title}" généré`);
              } else if (parsed.error) {
                setGenerationQueue(prev => prev.map(t => 
                  t.id === task.id ? { ...t, status: 'error', progress: 0 } : t
                ));
                throw new Error(parsed.error);
              }
            } catch (e: any) {
              if (e.message && !e.message.includes('JSON')) throw e;
            }
          }
        }
      }
    } catch (e: any) {
      setGenerationQueue(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: 'error', progress: 0 } : t
      ));
      toastError(e.message);
      setStreamingTexts(prev => ({ ...prev, [task.id]: '' }));
    } finally {
      // Arrêter le timer de progression
      clearInterval(timerId);
      // Retirer de la liste des générations actives
      setActiveGenerationIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(task.id);
        return newSet;
      });
      setGenerationProgresses(prev => ({ ...prev, [task.id]: 0 }));
      setStreamingTexts(prev => ({ ...prev, [task.id]: '' }));
      
      // Retirer la tâche terminée de la file après un petit délai
      setTimeout(() => {
        setGenerationQueue(prev => prev.filter(t => t.id !== task.id));
      }, 1000);
    }
  }, [notebookId, profile.openrouterImageModel, success, toastError]);
  
  // Traitement de la file d'attente - gérer jusqu'à MAX_PARALLEL_GENERATIONS tâches simultanées
  useEffect(() => {
    if (sources.length === 0 || generationQueue.length === 0) return;
    
    // Trouver toutes les tâches en attente qui ne sont pas encore démarrées
    const pendingTasks = generationQueue.filter(
      t => t.status === 'pending' && !activeGenerationIds.has(t.id)
    );
    
    // Combien de slots disponibles pour de nouvelles générations
    const availableSlots = MAX_PARALLEL_GENERATIONS - activeGenerationIds.size;
    
    // Démarrer de nouvelles tâches si des slots sont disponibles
    if (pendingTasks.length > 0 && availableSlots > 0) {
      const tasksToStart = pendingTasks.slice(0, availableSlots);
      tasksToStart.forEach(task => {
        executeTask(task);
      });
    }
  }, [generationQueue, activeGenerationIds, sources.length, executeTask]);

  // ─── Génération en streaming ────────────────────────────────────────────

  const handleGenerate = useCallback((type: string, extraInstructions?: string) => {
    if (sources.length === 0) {
      toastError('Ajoutez des sources d\'abord.');
      return;
    }
    
    // Ajouter à la file d'attente au lieu de démarrer immédiatement
    addToQueue(type, extraInstructions);
  }, [sources.length, toastError, addToQueue]);

  // Lancer la génération d'infographie depuis le modal
  const handleInfographicGenerate = useCallback(() => {
    setShowInfographicModal(false);

    const orientationMap: Record<string, string> = {
      portrait: '9:16', landscape: '16:9', square: '1:1',
    };
    const styleLabels: Record<string, string> = {
      auto: 'Sélection automatique du style visuel',
      kawaii: 'Style Kawaii : mignon, coloré, personnages arrondis, pastels',
      clay: 'Style Pâte à modeler : textures 3D, reliefs doux, ombres douces',
      sketch: 'Style Croquis : traits au crayon, hachuré, noir et blanc avec touches de couleur',
      anime: 'Style Anime : illustration japonaise, couleurs vives, détails nets',
      editorial: 'Style Éditorial : magazine haut de gamme, typographie soignée, minimaliste',
      educational: 'Style Éducatif : schémas clairs, icônes simples, annotations, pédagogique',
      bento: 'Style Grille Bento : mise en page en blocs carrés/rectangulaires bien organisés',
      bricks: 'Style Briques : sections empilées, couleurs franches, séparations nettes',
      scientific: 'Style Scientifique : graphiques, données, précision, palette sobre',
      professional: 'Style Professionnel : corporate, élégant, couleurs business (bleu, gris, blanc)',
    };
    const detailLabels: Record<string, string> = {
      low: 'Niveau de détail : minimal, très synthétique, 3-4 éléments max',
      medium: 'Niveau de détail : modéré, 5-7 sections avec quelques données clés',
      high: 'Niveau de détail : élevé, très dense, beaucoup de données et sous-sections',
    };

    const instructions = [
      `Orientation : ${orientationMap[infraOrientation]} (${infraOrientation})`,
      `Langue du texte dans l'infographie : ${infraLang === 'fr' ? 'Français' : infraLang === 'en' ? 'Anglais' : infraLang === 'es' ? 'Espagnol' : infraLang === 'ar' ? 'Arabe' : infraLang === 'de' ? 'Allemand' : infraLang}`,
      styleLabels[infraStyle],
      detailLabels[infraDetail],
      infraDescription.trim() ? `Description utilisateur : ${infraDescription.trim()}` : '',
    ].filter(Boolean).join('\n');

    setTimeout(() => {
      handleGenerate('infographic', instructions);
    }, 100);
  }, [infraOrientation, infraStyle, infraDetail, infraLang, infraDescription, handleGenerate]);

  // ─── Régénérer ──────────────────────────────────────────────────────────

  // Trigger generation from modal selection
  useEffect(() => {
    if (modalSelectedType) {
      handleGenerate(modalSelectedType);
      setModalSelectedType(null);
    }
  }, [modalSelectedType, handleGenerate]);

  const handleRegenerate = useCallback(async () => {
    if (!selectedDoc) return;
    // Supprimer l'ancien document
    try {
      await fetch(`/api/notebooks/${notebookId}/generated/${selectedDoc.id}`, { method: 'DELETE' });
      setGeneratedDocs(prev => prev.filter(d => d.id !== selectedDoc.id));
    } catch { /* ignore */ }
    setSelectedDoc(null);
    // Relancer la génération
    handleGenerate(selectedDoc.type);
  }, [selectedDoc, notebookId, handleGenerate]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const _handleDelete = useCallback(async (docId: string) => {
    try {
      await fetch(`/api/notebooks/${notebookId}/generated/${docId}`, { method: 'DELETE' });
      setGeneratedDocs(prev => prev.filter(d => d.id !== docId));
      if (selectedDoc?.id === docId) setSelectedDoc(null);
      success('Document supprimé');
    } catch {
      toastError('Erreur');
    }
  }, [notebookId, selectedDoc, success, toastError]);

  const handleCopy = useCallback(async (content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleExportMd = useCallback((doc: GeneratedDoc) => {
    const blob = new Blob([doc.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.replace(/[^a-zA-Z0-9àáâãäéèêëïîôùûüÿç\s-]/g, '')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleImportToWorkspace = useCallback(async (doc: GeneratedDoc) => {
    const filename = doc.title
      .replace(/[^a-zA-Z0-9àáâãäéèêëïîôùûüÿç\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    const filePath = `docs/generated/${filename}.md`;

    try {
      const token = localStorage.getItem('Leanna_api_token');
      const res = await fetch('/api/ide/file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-Leanna-token': token } : {}),
        },
        body: JSON.stringify({ path: filePath, content: doc.content }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      success(`Importé dans le workspace : ${filePath}`);
    } catch (e: any) {
      toastError(`Erreur import : ${e.message}`);
    }
  }, [success, toastError]);

  const toggleSourceSelection = useCallback((sourceId: string) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId) ? prev.filter(id => id !== sourceId) : [...prev, sourceId]
    );
  }, []);

  return (
    <div className={`h-full ${fullView ? 'flex flex-col' : 'flex flex-col'}`}>
      {/* Controls panel — hidden in fullView (doc viewer only) */}
      {!fullView && (
      <div
        className="flex-1 overflow-y-auto custom-scrollbar p-4 lg:p-5 space-y-4"
        style={{ backgroundColor: 'var(--notebook-studio-bg)' }}
      >
        {/* Quick config bar */}
        <div className="flex items-center gap-2">
          {/* Source filter toggle */}
          {sources.length > 1 && (
            <button
              onClick={() => setShowSourceFilter(!showSourceFilter)}
              className="notebook-chip"
              style={showSourceFilter || selectedSourceIds.length > 0 ? { borderColor: 'var(--notebook-accent)', color: 'var(--notebook-accent)', background: 'var(--notebook-accent-surface)' } : {}}
            >
              <Filter className="w-3 h-3" />
              {selectedSourceIds.length > 0 ? `${selectedSourceIds.length} src` : 'Sources'}
            </button>
          )}

          {/* Custom prompt toggle */}
          <button
            onClick={() => setShowCustomPrompt(!showCustomPrompt)}
            className="notebook-chip"
            style={showCustomPrompt || customInstructions.trim() ? { borderColor: 'var(--color-warning)', color: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)' } : {}}
          >
            <PenLine className="w-3 h-3" />
            Prompt
            {customInstructions.trim() && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
          </button>

          {/* Source count */}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {sources.length} source{sources.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Barre de progression et file d'attente - TOUJOURS VISIBLE */}
        <div
          className="p-3 rounded-xl border"
          style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
        >
          {/* Barre de progression pour la génération en cours */}
          {activeGenerationIds.size > 0 ? (
            <div className="notebooklm-prose max-w-none space-y-5">
              {[...activeGenerationIds].map(taskId => {
                const task = generationQueue.find(t => t.id === taskId);
                if (!task) return null;
                
                const color = getDocTypeColor(task.type);
                const docType = DOC_TYPES.find(t => t.key === task.type) || REPORT_TYPES.find(t => t.key === task.type);
                const Icon = docType?.icon || Sparkles;
                const progress = generationProgresses[taskId] || 0;
                
                return (
                  <div key={taskId} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" 
                         style={{ backgroundColor: `${color}15` }}>
                      <Icon className="w-3 h-3" style={{ color: color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {getDocTypeLabel(task.type)}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: color }}
                            initial={{ width: '0%' }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="text-xs font-medium" style={{ color: color }}>
                          {progress}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Sparkles className="w-3 h-3" />
              <span>Prêt à générer</span>
              {generationQueue.length > 0 && (
                <span className="ml-1">({generationQueue.filter(t => t.status === 'pending').length} en attente)</span>
              )}
            </div>
          )}

          {/* File d'attente */}
          {generationQueue.length > 0 && (
            <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: 'var(--border-base)' }}>
              <button
                onClick={() => setShowQueue(!showQueue)}
                className="flex items-center justify-between w-full text-left"
              >
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                  File d'attente ({generationQueue.filter(t => t.status === 'pending').length})
                </span>
                <motion.span
                  animate={{ rotate: showQueue ? 180 : 0 }}
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  ▼
                </motion.span>
              </button>
              
              <AnimatePresence>
                {showQueue && generationQueue.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={modalSpring}
                    className="overflow-hidden space-y-1.5 pt-2"
                  >
                    {generationQueue.map((task, index) => {
                      const docType = DOC_TYPES.find(t => t.key === task.type) || REPORT_TYPES.find(t => t.key === task.type);
                      const Icon = docType?.icon || Sparkles;
                      const color = getDocTypeColor(task.type);
                      
                      return (
                        <motion.div
                          key={task.id}
                          layout
                          className={`p-2 rounded-lg border transition-all ${
                            task.status === 'generating' ? 'ring-1' : ''
                          }`}
                          style={{
                            borderColor: 'var(--border-base)',
                            backgroundColor: task.status === 'generating' ? `${color}08` : 'var(--bg-base)',
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                                 style={{ backgroundColor: `${color}15` }}>
                              {task.status === 'generating' ? (
                                <Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color }} />
                              ) : task.status === 'completed' ? (
                                <CheckCircle2 className="w-2.5 h-2.5" style={{ color }} />
                              ) : task.status === 'error' ? (
                                <X className="w-2.5 h-2.5" style={{ color: 'var(--color-error)' }} />
                              ) : (
                                <Icon className="w-2.5 h-2.5" style={{ color }} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                {index === 0 && task.status === 'pending' ? 'Suivant:' : ''} {task.title}
                              </p>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                                  Position: {index + 1}
                                </span>
                                {task.status === 'generating' && task.progress > 0 && (
                                  <>
                                    <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                                      •
                                    </span>
                                    <span className="text-xs font-medium" style={{ color: color }}>
                                      {task.progress}%
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            {task.status === 'error' && (
                              <button
                                onClick={() => {
                                  // Re essayez cette tâche
                                  setGenerationQueue(prev => prev.map(t => 
                                    t.id === task.id ? { ...t, status: 'pending', progress: 0 } : t
                                  ));
                                }}
                                className="p-1 rounded hover:bg-white/5 transition-colors"
                                title="Réessayer"
                              >
                                <RefreshCw className="w-2.5 h-2.5" style={{ color: 'var(--color-warning)' }} />
                              </button>
                            )}
                            {index > 0 && task.status === 'pending' && (
                              <button
                                onClick={() => {
                                  // Annuler cette tâche
                                  setGenerationQueue(prev => prev.filter(t => t.id !== task.id));
                                }}
                                className="p-1 rounded hover:bg-white/5 transition-colors"
                                title="Annuler"
                              >
                                <X className="w-2.5 h-2.5" style={{ color: 'var(--color-error)' }} />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Source filter dropdown */}
        <AnimatePresence>
          {showSourceFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={modalSpring}
              className="overflow-hidden"
            >
              <div
                className="p-2.5 rounded-xl space-y-1"
                style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
              >
                {sources.map(src => (
                  <label
                    key={src.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-full cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.length === 0 || selectedSourceIds.includes(src.id)}
                      onChange={() => toggleSourceSelection(src.id)}
                      className="w-3 h-3 rounded accent-[var(--accent-primary)]"
                    />
                    <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{src.title}</span>
                  </label>
                ))}
                {selectedSourceIds.length > 0 && (
                  <button
                    onClick={() => setSelectedSourceIds([])}
                    className="text-xs px-2 py-1 w-full text-left hover:underline"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    Réinitialiser (toutes)
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom instructions dropdown */}
        <AnimatePresence>
          {showCustomPrompt && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={modalSpring}
              className="overflow-hidden"
            >
              <textarea
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                placeholder="Ex: Ton formel, focus technique, ajoute des exemples..."
                rows={2}
                className="w-full px-3 py-2.5 rounded-full text-xs outline-none resize-none transition-all focus:ring-1 focus:ring-[var(--color-warning)]"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--text-primary)',
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

{/* Generate buttons — redesigned grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
              Générer
            </p>
            {activeGenerationIds.size > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>
                <Loader2 className="w-3 h-3 animate-spin" />
                {activeGenerationIds.size > 1 ? `${activeGenerationIds.size} en cours...` : 'En cours...'}
              </span>
            )}
          </div>

          {/* Bouton principal — Rapport complet (ouvre le modal) — Plus compact */}
          <button
            ref={reportModalTriggerRef}
            onClick={openReportModal}
            disabled={sources.length === 0}
            className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border transition-all disabled:opacity-40 active:scale-[0.98] hover:shadow-sm"
            style={{
              borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
            }}
            title="Choisir un type de rapport • Suggestions IA incluses"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)' }}
            >
              <FileBarChart className="w-4 h-4" style={{ color: 'var(--color-error)' }} />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                Rapport complet
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Types avancés
              </p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-error)' }} />
          </button>

          {/* Types rapides — 3 par ligne — Design compact et moderne */}
          <div className="grid grid-cols-3 gap-1">
            {DOC_TYPES.filter(t => t.key !== 'full-report').map(({ key, label, icon: Icon, desc, color }) => {
              const isActive = [...activeGenerationIds].some(taskId => {
                const task = generationQueue.find(t => t.id === taskId);
                return task && task.type === key;
              });
              return (
                <motion.button
                  key={key}
                  ref={key === 'infographic' ? infographicModalTriggerRef : undefined}
                  onClick={() => key === 'infographic' ? setShowInfographicModal(true) : handleGenerate(key)}
                  disabled={sources.length === 0}
                  whileHover={sources.length > 0 ? { y: -1, scale: 1.01 } : {}}
                  whileTap={sources.length > 0 ? { scale: 0.98 } : {}}
                  transition={reduceMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 400, damping: 25 }}
                  className={`group relative w-full flex flex-col items-center gap-1 p-1.5 rounded-lg text-center disabled:opacity-40 transition-all duration-200 ${
                    isActive ? 'ring-1' : 'hover:bg-white/5'
                  }`}
                  style={{
                    border: '1px solid',
                    borderColor: isActive ? color : 'var(--notebook-border)',
                    backgroundColor: isActive ? `${color}08` : 'var(--notebook-card-bg)',
                  }}
                  title={desc}
                >
                  {/* Icon — Plus grande et centrée */}
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                    style={{ backgroundColor: `${color}10`, border: `1px solid ${color}20` }}
                  >
                    {isActive ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color }} />
                    ) : (
                      <Icon className="w-4 h-4" style={{ color }} />
                    )}
                  </div>

                  {/* Label — Plus petit et centré */}
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {label}
                  </span>

                  {/* Active indicator — Bordure subtile */}
                  {isActive && (
                    <motion.div
                      layoutId="activeGenType"
                      className="absolute inset-0 rounded-lg pointer-events-none"
                      style={{ border: `1.5px solid ${color}`, opacity: 0.6 }}
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Source count info */}
        {sources.length === 0 && (
          <p className="text-xs text-center py-2 px-3 rounded-lg" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-dimmed)' }}>
            Ajoutez des sources pour activer la génération
          </p>
        )}
      </div>
      )}

      {/* Document viewer — shown in fullView mode */}
      {fullView && (
      <div ref={contentRef} className="flex-1 overflow-y-auto custom-scrollbar p-5 lg:p-8 notebooklm-viewer" style={{ borderColor: 'var(--notebook-border)' }}>
        {/* Streaming view */}
        {Object.keys(streamingTexts).length > 0 && !selectedDoc && (
          <div className="space-y-5 max-w-3xl">
            <div className="flex items-center gap-2 pb-3 border-b" style={{ borderColor: 'var(--border-base)' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {activeGenerationIds.size > 1 ? `${activeGenerationIds.size} générations en cours...` : 'Génération en cours...'}
              </span>
              <span className="text-xs ml-auto" style={{ color: 'var(--text-dimmed)' }}>
                {Object.values(streamingTexts).reduce((sum, text) => sum + text.length, 0)} caractères
              </span>
            </div>
            {activeGenerationIds.size === 1 ? (
              (() => {
                const taskId = [...activeGenerationIds][0];
                const task = generationQueue.find(t => t.id === taskId);
                const streamingText = streamingTexts[taskId] || '';
                if (!task) return null;
                return task.type === 'infographic' && streamingText.includes('data:image/') 
                  ? renderInfographicContent(streamingText)
                  : renderGeneratedContent(streamingText);
              })()
            ) : (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Plusieurs générations en cours. Voir la file d'attente pour les détails.
              </div>
            )}
            <span className="inline-block w-2 h-4 animate-pulse rounded-sm" style={{ backgroundColor: 'var(--accent-primary)' }} />
          </div>
        )}

        {/* Selected document view */}
        {selectedDoc && Object.keys(streamingTexts).length === 0 ? (
          <div className={`space-y-5 ${selectedDoc.type === 'mindmap' ? 'max-w-none' : 'max-w-6xl mx-auto'}`}>
            {/* Document header — sticky */}
            <div className="flex items-start gap-3 pb-6 border-b sticky top-0 z-10 pt-2 notebooklm-doc-header" style={{ borderColor: 'var(--notebook-border)', backgroundColor: 'var(--notebook-canvas, var(--bg-base))', backdropFilter: 'blur(12px)' }}>
              {onClose && (
                <Tooltip content="Retour" as="button" onClick={onClose} className="notebook-icon-button flex-shrink-0 mt-0.5">
                  <ArrowLeft className="h-4 w-4" />
                </Tooltip>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {(() => {
                    const docType = DOC_TYPES.find(t => t.key === selectedDoc.type) || REPORT_TYPES.find(t => t.key === selectedDoc.type);
                    const docColor = docType?.color || 'var(--text-muted)';
                    return (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${docColor} 15%, transparent)`,
                          color: docColor,
                        }}
                      >
                        {docType?.label || selectedDoc.type}
                      </span>
                    );
                  })()}
                  <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                    {new Date(selectedDoc.createdAt).toLocaleString('fr-FR')}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                    • {selectedDoc.content.length} chars
                  </span>
                </div>
                <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  {selectedDoc.title}
                </h2>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleImportToWorkspace(selectedDoc)}
                  className="p-2 rounded-lg border transition-all hover:bg-white/5 active:scale-95"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--accent-primary)' }}
                  title="Importer dans le workspace"
                >
                  <FolderInput className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={sources.length === 0}
                  className="p-2 rounded-lg border transition-all hover:bg-white/5 active:scale-95 disabled:opacity-30"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  title="Régénérer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleExportMd(selectedDoc)}
                  className="p-2 rounded-lg border transition-all hover:bg-white/5 active:scale-95"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  title="Exporter en Markdown"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleCopy(selectedDoc.content)}
                  className="p-2 rounded-lg border transition-all hover:bg-white/5 active:scale-95"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  title="Copier"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {!SLIDE_EXCLUDED_TYPES.has(selectedDoc.type) && (
                  <button
                    onClick={() => setShowSlideModal(true)}
                    className="p-2 rounded-lg border transition-all hover:bg-white/5 active:scale-95"
                    style={{ borderColor: 'color-mix(in srgb, var(--accent-primary) 25%, transparent)', color: 'var(--accent-primary)' }}
                    title="Générer une présentation Reveal.js"
                  >
                    <Presentation className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Document content */}
            {selectedDoc.type === 'infographic' ? (
              renderInfographicContent(selectedDoc.content)
            ) : (
              renderGeneratedContent(selectedDoc.content)
            )}
          </div>
        ) : Object.keys(streamingTexts).length === 0 && (
          /* Empty state — professional landing */
          <div className="h-full flex flex-col items-center justify-center gap-6 px-8">
            <div className="relative">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--accent-subtle)' }}
              >
                <Sparkles className="w-8 h-8" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center shadow-md"
                style={{ backgroundColor: 'var(--bg-panel)', border: '2px solid var(--accent-primary)' }}
              >
                <span className="text-xs font-bold" style={{ color: 'var(--accent-primary)' }}>AI</span>
              </div>
            </div>

            <div className="text-center space-y-2 max-w-sm">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                Génération intelligente
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Transformez vos sources en documents structurés. Résumés, FAQ, guides d'étude, chronologies et plus encore.
              </p>
            </div>

            {/* Feature highlights */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              {[
                { emoji: '⚡', label: 'Streaming', sub: 'Temps réel' },
                { emoji: '🎯', label: 'Sources', sub: 'Ciblé' },
                { emoji: '📝', label: 'Custom', sub: 'Instructions' },
              ].map(f => (
                <div
                  key={f.label}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
                >
                  <span className="text-base">{f.emoji}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{f.label}</span>
                  <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{f.sub}</span>
                </div>
              ))}
            </div>

            {sources.length === 0 && (
              <p
                className="text-xs px-4 py-2 rounded-full"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', color: 'var(--color-warning)', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}
              >
                ⚠️ Ajoutez des sources dans l'onglet Sources pour commencer
              </p>
            )}
          </div>
        )}
      </div>
      )}

      {/* ═══ MODAL RAPPORT COMPLET ═══ */}
      <AnimatePresence>
        {showReportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={scrimSpring}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={scrimStyle}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowReportModal(false); reportModalTriggerRef.current?.focus(); } }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0, y: 10 }}
              animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0, y: 10 }}
              transition={modalSpring}
              className="w-full max-w-7xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
            >
              {/* Modal header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)' }}
                >
                  <FileBarChart className="w-5 h-5" style={{ color: 'var(--color-error)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    Générer un rapport
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Choisissez un type ou suivez les suggestions basées sur vos {sources.length} source{sources.length > 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => { setShowReportModal(false); reportModalTriggerRef.current?.focus(); }}
                  className="p-2 rounded-lg transition-all hover:bg-white/5 active:scale-95"
                  style={{ color: 'var(--text-muted)' }}
                  autoFocus
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal content — scrollable */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">

                {/* Suggestions IA */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
                    <h3 className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                      Suggestions pour vos sources
                    </h3>
                    {loadingSuggestions && <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--color-warning)' }} />}
                    {!loadingSuggestions && suggestions.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', color: 'var(--color-warning)' }}>
                        {suggestions.length} suggestions
                      </span>
                    )}
                    {!loadingSuggestions && (
                      <button
                        onClick={loadSuggestions}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all hover:bg-white/5 active:scale-95"
                        style={{ border: '1px solid var(--border-base)', color: 'var(--color-warning)' }}
                        title="Demander de nouvelles suggestions"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {suggestions.length > 0 ? 'Rafraîchir' : 'Obtenir des suggestions'}
                      </button>
                    )}
                  </div>

                  {loadingSuggestions && (
                    <div className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)' }}>
                      <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-warning)' }} />
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Analyse de vos sources en cours…</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>L'IA identifie les rapports les plus pertinents</p>
                      </div>
                    </div>
                  )}

                  {!loadingSuggestions && suggestions.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {suggestions.map((suggestion, idx) => {
                        const docType = REPORT_TYPES.find(t => t.key === suggestion.type) || DOC_TYPES.find(t => t.key === suggestion.type);
                        const SugIcon = docType?.icon || Sparkles;
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              if (suggestion.recommendedSourceIds?.length > 0) {
                                setSelectedSourceIds(suggestion.recommendedSourceIds);
                              }
                              handleModalGenerate(suggestion.type);
                            }}
                            className="w-full flex items-start gap-3 p-3.5 rounded-xl border transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] text-left group"
                            style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
                          >
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `color-mix(in srgb, ${docType?.color || 'var(--text-muted)'} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${docType?.color || 'var(--text-muted)'} 25%, transparent)` }}
                            >
                              <SugIcon className="w-4 h-4" style={{ color: docType?.color || 'var(--text-muted)' }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                  {suggestion.title}
                                </p>
                                {(() => {
                                  const docColor = docType?.color || 'var(--text-muted)';
                                  return (
                                    <span
                                      className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                                      style={{ backgroundColor: `color-mix(in srgb, ${docColor} 15%, transparent)`, color: docColor }}
                                    >
                                      {suggestion.relevance}% pertinent
                                    </span>
                                  );
                                })()}
                              </div>
                              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                {suggestion.reason}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1">
                              <span className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>Générer</span>
                              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!loadingSuggestions && suggestions.length === 0 && (
                    <p className="text-xs py-3 text-center" style={{ color: 'var(--text-dimmed)' }}>
                      Cliquez sur "Obtenir des suggestions" pour que l'IA analyse vos sources.
                    </p>
                  )}
                </div>

                {/* Séparateur */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-base)' }} />
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                    ou choisir un type de rapport
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-base)' }} />
                </div>

                {/* Grille de tous les types */}
                <div className="grid grid-cols-2 gap-2">
                  {REPORT_TYPES.map(({ key, label, icon: Icon, desc, color }) => (
                    <button
                      key={key}
                      onClick={() => handleModalGenerate(key)}
                      className="flex items-start gap-3 p-3 rounded-xl border transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] text-left group"
                      style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: `${color}12`, border: `1px solid ${color}25` }}
                      >
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {label}
                        </p>
                        <p className="text-xs mt-0.5 leading-tight" style={{ color: 'var(--text-dimmed)' }}>
                          {desc}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-between px-6 py-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}>
                <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                  {sources.length} source{sources.length > 1 ? 's' : ''} disponible{sources.length > 1 ? 's' : ''} • Le rapport sera généré en streaming
                </p>
                <button
                  onClick={() => { setShowReportModal(false); reportModalTriggerRef.current?.focus(); }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:bg-white/5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Annuler
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MODAL INFOGRAPHIE ═══ */}
      <AnimatePresence>
        {showInfographicModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={scrimSpring}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={scrimStyle}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowInfographicModal(false); infographicModalTriggerRef.current?.focus(); } }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0, y: 10 }}
              animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0, y: 10 }}
              transition={modalSpring}
              className="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-base)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)' }}>
                    <Lightbulb className="w-4.5 h-4.5" style={{ color: 'var(--color-warning)' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Créer une infographie</h3>
                    <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>Générée par IA à partir de vos sources</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowInfographicModal(false); infographicModalTriggerRef.current?.focus(); }}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  autoFocus
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5 max-h-[65vh] overflow-y-auto custom-scrollbar">

                {/* Orientation */}
                <div className="notebooklm-prose max-w-none space-y-5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>Choisissez une orientation</p>
                  <div className="flex gap-2">
                    {([
                      { key: 'portrait' as const, label: 'Portrait', icon: '📱' },
                      { key: 'landscape' as const, label: 'Paysage', icon: '🖥️' },
                      { key: 'square' as const, label: 'Carré', icon: '⬜' },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setInfraOrientation(opt.key)}
                        className="flex-1 flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-xs font-medium transition-all"
                        style={{
                          backgroundColor: infraOrientation === opt.key ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)' : 'var(--bg-base)',
                          color: infraOrientation === opt.key ? 'var(--color-warning)' : 'var(--text-muted)',
                          border: `1.5px solid ${infraOrientation === opt.key ? 'var(--color-warning)' : 'var(--border-base)'}`,
                        }}
                      >
                        <span className="text-lg">{opt.icon}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Langue */}
                <div className="notebooklm-prose max-w-none space-y-5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>Langue</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {([
                      { key: 'fr', label: 'Français', flag: '🇫🇷' },
                      { key: 'en', label: 'English', flag: '🇬🇧' },
                      { key: 'es', label: 'Español', flag: '🇪🇸' },
                      { key: 'de', label: 'Deutsch', flag: '🇩🇪' },
                      { key: 'ar', label: 'العربية', flag: '🇸🇦' },
                      { key: 'pt', label: 'Português', flag: '🇧🇷' },
                      { key: 'it', label: 'Italiano', flag: '🇮🇹' },
                      { key: 'zh', label: '中文', flag: '🇨🇳' },
                      { key: 'ja', label: '日本語', flag: '🇯🇵' },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setInfraLang(opt.key)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all"
                        style={{
                          backgroundColor: infraLang === opt.key ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)' : 'var(--bg-base)',
                          color: infraLang === opt.key ? 'var(--color-warning)' : 'var(--text-muted)',
                          border: `1px solid ${infraLang === opt.key ? 'var(--color-warning)' : 'var(--border-base)'}`,
                        }}
                      >
                        <span>{opt.flag}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style visuel */}
                <div className="notebooklm-prose max-w-none space-y-5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>Choisissez un style visuel</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { key: 'auto', label: 'Sélection auto', emoji: '✨' },
                      { key: 'kawaii', label: 'Kawaii', emoji: '🌸' },
                      { key: 'clay', label: 'Pâte à modeler', emoji: '🎨' },
                      { key: 'sketch', label: 'Croquis', emoji: '✏️' },
                      { key: 'anime', label: 'Anime', emoji: '🎌' },
                      { key: 'editorial', label: 'Éditorial', emoji: '📰' },
                      { key: 'educational', label: 'Éducatif', emoji: '📚' },
                      { key: 'bento', label: 'Grille Bento', emoji: '🍱' },
                      { key: 'bricks', label: 'Briques', emoji: '🧱' },
                      { key: 'scientific', label: 'Scientifique', emoji: '🔬' },
                      { key: 'professional', label: 'Professionnel', emoji: '💼' },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setInfraStyle(opt.key)}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-full text-xs font-medium transition-all"
                        style={{
                          backgroundColor: infraStyle === opt.key ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)' : 'var(--bg-base)',
                          color: infraStyle === opt.key ? 'var(--color-warning)' : 'var(--text-muted)',
                          border: `1px solid ${infraStyle === opt.key ? 'var(--color-warning)' : 'var(--border-base)'}`,
                        }}
                      >
                        <span>{opt.emoji}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Niveau de détail */}
                <div className="notebooklm-prose max-w-none space-y-5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>Niveau de détail</p>
                  <div className="flex gap-2">
                    {([
                      { key: 'low' as const, label: 'Minimal', desc: '3-4 éléments' },
                      { key: 'medium' as const, label: 'Modéré', desc: '5-7 sections' },
                      { key: 'high' as const, label: 'Dense', desc: 'Très détaillé' },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setInfraDetail(opt.key)}
                        className="flex-1 flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-full text-xs font-medium transition-all"
                        style={{
                          backgroundColor: infraDetail === opt.key ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)' : 'var(--bg-base)',
                          color: infraDetail === opt.key ? 'var(--color-warning)' : 'var(--text-muted)',
                          border: `1.5px solid ${infraDetail === opt.key ? 'var(--color-warning)' : 'var(--border-base)'}`,
                        }}
                      >
                        <span className="font-semibold">{opt.label}</span>
                        <span className="text-xs opacity-60">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sources */}
                {sources.length > 1 && (
                  <div className="notebooklm-prose max-w-none space-y-5">
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                      Sources ({selectedSourceIds.length || sources.length}/{sources.length})
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      {selectedSourceIds.length === 0 ? 'Toutes les sources seront utilisées' : `${selectedSourceIds.length} source(s) sélectionnée(s)`}
                    </p>
                  </div>
                )}

                {/* Description personnalisée */}
                <div className="notebooklm-prose max-w-none space-y-5">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-dimmed)' }}>
                    Décrivez l'infographie que vous souhaitez créer
                  </p>
                  <textarea
                    value={infraDescription}
                    onChange={(e) => setInfraDescription(e.target.value)}
                    placeholder="Ex: Une infographie sur les tendances du marché avec des statistiques clés, un comparatif visuel des acteurs principaux..."
                    className="w-full px-3 py-2.5 rounded-full text-xs resize-none leading-relaxed"
                    style={{
                      backgroundColor: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-base)',
                    }}
                    rows={3}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-base)' }}>
                <button
                  onClick={() => { setShowInfographicModal(false); infographicModalTriggerRef.current?.focus(); }}
                  className="px-4 py-2 rounded-full text-xs font-medium transition-all hover:bg-white/5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Annuler
                </button>
                <button
                  onClick={handleInfographicGenerate}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-all active:scale-95 shadow-sm"
                  style={{ backgroundColor: 'var(--color-warning)', color: 'white' }}
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  Générer l'infographie
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MODAL SLIDES REVEAL.JS ═══ */}
      {showSlideModal && selectedDoc && (
        <SlidePreviewModal
          open={showSlideModal}
          onClose={() => setShowSlideModal(false)}
          notebookId={notebookId}
          doc={selectedDoc}
        />
      )}
    </div>
  );
}
