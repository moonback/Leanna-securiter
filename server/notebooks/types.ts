/**
 * Notebooks Module — Types & Interfaces
 *
 * Concurrent de NotebookLM : collections de sources avec chat grounded,
 * résumés automatiques, génération de contenu dérivé et audio overview.
 */

// ─── Source (document ingéré dans un notebook) ───────────────────────────────

export type SourceType = 'pdf' | 'text' | 'markdown' | 'url' | 'audio' | 'youtube' | 'docx' | 'html' | 'image' | 'github-repo';

export interface SourceChunk {
  id: string;
  sourceId: string;
  content: string;
  /** Position (ordre) dans la source originale */
  index: number;
  /** Métadonnées du chunk (numéro de page, section, etc.) */
  metadata: {
    page?: number;
    section?: string;
    startChar: number;
    endChar: number;
  };
  /** Vecteur TF-IDF normalisé (pour recherche sémantique locale) */
  tfidfVector?: Map<string, number>;
}

export interface Source {
  id: string;
  notebookId: string;
  title: string;
  type: SourceType;
  /** URL ou chemin d'origine */
  origin: string;
  /** Texte brut extrait */
  rawText: string;
  /** HTML brut original (pour sources HTML uniquement) */
  rawHtml?: string;
  /** Résumé automatique généré */
  summary: string;
  /** Mots-clés extraits */
  keywords: string[];
  /** Chunks découpés pour RAG */
  chunks: SourceChunk[];
  /** Nombre de mots */
  wordCount: number;
  /** Langue détectée */
  language: string;
  /** Date d'ajout */
  addedAt: string;
  /** Taille du fichier original en octets */
  originalSize: number;
  /** Métadonnées spécifiques au type de source */
  metadata?: {
    /** Pour github-repo : informations sur le dépôt */
    githubRepo?: {
      owner: string;
      repo: string;
      defaultBranch: string;
      stars: number;
      forks: number;
      language: string;
      license?: string;
      topics?: string[];
      fileCount: number;
      /** Liste des fichiers ingérés */
      ingestedFiles?: Array<{
        path: string;
        size: number;
        type: 'file' | 'dir';
      }>;
    };
  };
}

// ─── Notebook ────────────────────────────────────────────────────────────────

export interface Notebook {
  id: string;
  /** Chemin absolu du workspace auquel appartient ce notebook. Undefined = global (rétrocompatibilité). */
  workspaceId?: string;
  title: string;
  description: string;
  /** Sources attachées */
  sources: Source[];
  /** Notes de l'utilisateur */
  notes: NotebookNote[];
  /** Documents générés (FAQ, guides, etc.) */
  generatedDocuments: GeneratedDocument[];
  /** Audio overviews générés */
  audioOverviews: AudioOverview[];
  /** Historique de chat */
  chatHistory: ChatMessage[];
  /** Threads de conversation */
  chatThreads?: ChatThread[];
  /** Date de création */
  createdAt: string;
  /** Dernière modification */
  updatedAt: string;
  /** Couleur/icône pour l'UI */
  color: string;
  icon: string;
}

// ─── Notes utilisateur ───────────────────────────────────────────────────────

export interface NotebookNote {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  /** Références aux sources (IDs de chunks cités) */
  sourceReferences: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

// ─── Chat grounded ───────────────────────────────────────────────────────────

export interface Citation {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  /** Extrait textuel cité */
  excerpt: string;
  /** Score de pertinence */
  relevance: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Citations (uniquement pour les messages assistant) */
  citations: Citation[];
  timestamp: string;
}

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

// ─── Documents générés ───────────────────────────────────────────────────────

export type GeneratedDocType = 'summary' | 'faq' | 'study-guide' | 'briefing' | 'timeline' | 'outline' | 'mindmap' | 'swot' | 'glossary' | 'infographic' | 'full-report' | 'report-business' | 'report-market' | 'report-technical' | 'report-competitive' | 'report-financial' | 'report-marketing' | 'report-product' | 'report-risk' | 'report-executive' | 'report-project' | 'roadmap' | 'visualization' | 'chart' | 'data-analysis' | 'comparative-analysis' | 'synthesis-report';

// ─── Suggestions de rapports ─────────────────────────────────────────────────

export interface ReportSuggestion {
  type: GeneratedDocType;
  title: string;
  description: string;
  /** Pourquoi ce rapport est pertinent pour ces sources */
  reason: string;
  /** Score de pertinence 0-100 */
  relevance: number;
  /** Sources recommandées pour ce rapport */
  recommendedSourceIds: string[];
}

export interface GeneratedDocument {
  id: string;
  notebookId: string;
  type: GeneratedDocType;
  title: string;
  content: string;
  /** Sources utilisées pour la génération */
  sourceIds: string[];
  createdAt: string;
  /** Contenu visuel structuré (pour les visualisations D3.js) */
  visualContent?: {
    /** Type de visualisation (bar, line, pie, scatter, network, etc.) */
    chartType: string;
    /** Données au format JSON compatible D3.js */
    data: any;
    /** Configuration de la visualisation */
    config?: {
      width?: number;
      height?: number;
      colors?: string[];
      labels?: Record<string, string>;
    };
    /** SVG généré (si la visualisation a été rendue côté serveur) */
    svg?: string;
  };
}

// ─── Audio Overview (podcast IA) ─────────────────────────────────────────────

export interface AudioOverview {
  id: string;
  notebookId: string;
  title: string;
  /** Script du podcast (dialogue entre 2 hôtes) */
  script: string;
  /** Durée estimée en secondes */
  estimatedDuration: number;
  /** Status de génération */
  status: 'generating' | 'ready' | 'error';
  createdAt: string;
}

// ─── Options de recherche RAG ────────────────────────────────────────────────

export interface RAGSearchOptions {
  /** Nombre maximum de chunks à retourner */
  maxChunks?: number;
  /** Score minimum de pertinence */
  minRelevance?: number;
  /** Filtrer par source IDs */
  sourceIds?: string[];
}

export interface RAGSearchResult {
  chunk: SourceChunk;
  source: Source;
  relevance: number;
}
