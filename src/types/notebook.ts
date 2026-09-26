/**
 * Types centralisés pour le système de Notebooks
 */

// ─── Sources ─────────────────────────────────────────────────────────────────

export interface SourceItem {
  id: string;
  title: string;
  type: SourceType;
  origin: string;
  summary: string;
  keywords: string[];
  wordCount: number;
  language: string;
  addedAt: string;
  chunksCount: number;
}

export type SourceType = 'pdf' | 'text' | 'markdown' | 'url' | 'html' | 'youtube' | 'audio' | 'docx';

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface Citation {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  excerpt: string;
  relevance: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  timestamp: string;
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

// ─── Generated Documents ─────────────────────────────────────────────────────

export interface GeneratedDoc {
  id: string;
  type: string;
  title: string;
  content: string;
  createdAt: string;
}

// ─── Audio Overviews ─────────────────────────────────────────────────────────

export interface AudioOverview {
  id: string;
  title: string;
  script: string;
  audioUrl?: string;
  duration?: number;
  status: 'pending' | 'generating' | 'ready' | 'error';
  createdAt: string;
}

// ─── Notebook ────────────────────────────────────────────────────────────────

export interface NotebookData {
  id: string;
  title: string;
  description: string;
  sources: SourceItem[];
  notes: NoteItem[];
  generatedDocuments: GeneratedDoc[];
  audioOverviews: AudioOverview[];
  chatHistory: ChatMessage[];
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookSummary {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  sourcesCount: number;
  notesCount: number;
  createdAt: string;
  updatedAt: string;
}
