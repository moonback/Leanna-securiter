/**
 * Types du Document Knowledge System
 *
 * Système de gestion de connaissances orienté DOCUMENTS (pas code).
 * Gère : extraction, indexation, mémoire, recherche sémantique,
 * relations inter-documents, et génération de contexte.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Types de Documents
// ═══════════════════════════════════════════════════════════════════════════════

/** Types de documents supportés */
export type DocumentType =
  | "pdf"
  | "docx"
  | "txt"
  | "markdown"
  | "html"
  | "image"
  | "spreadsheet"
  | "presentation"
  | "email"
  | "note"
  | "url"
  | "other";

/** Statut de traitement d'un document */
export type ProcessingStatus =
  | "pending"
  | "extracting"
  | "analyzing"
  | "indexed"
  | "error";

/** Un document indexé dans le système */
export interface KnowledgeDocument {
  /** Identifiant unique */
  id: string;
  /** Nom du fichier ou titre */
  title: string;
  /** Chemin ou URL source */
  source: string;
  /** Type de document */
  type: DocumentType;
  /** Type MIME original */
  mimeType: string;
  /** Taille en octets du fichier original */
  fileSize: number;
  /** Texte brut extrait */
  extractedText: string;
  /** Résumé généré par l'IA */
  summary: string;
  /** Sections structurées extraites */
  sections: DocumentSection[];
  /** Entités/concepts extraits */
  entities: DocumentEntity[];
  /** Mots-clés extraits */
  keywords: string[];
  /** Tags manuels ou auto-générés */
  tags: string[];
  /** Langue détectée */
  language: "fr" | "en" | "other";
  /** Métadonnées du fichier (auteur, date création, etc.) */
  metadata: DocumentMetadata;
  /** Statut de traitement */
  status: ProcessingStatus;
  /** Date d'ajout au système */
  addedAt: string;
  /** Date de dernière mise à jour */
  updatedAt: string;
  /** Nombre d'accès/consultations */
  accessCount: number;
  /** Collection/dossier logique */
  collection?: string;
}

/** Section structurée d'un document */
export interface DocumentSection {
  /** Identifiant unique de la section */
  id: string;
  /** Titre de la section (si trouvé) */
  title?: string;
  /** Contenu textuel */
  content: string;
  /** Niveau hiérarchique (1 = titre principal, 2 = sous-titre, etc.) */
  level: number;
  /** Position dans le document (offset caractères) */
  startOffset: number;
  /** Fin de la section */
  endOffset: number;
  /** Page (pour PDF) */
  page?: number;
}

/** Entité/concept extrait d'un document */
export interface DocumentEntity {
  /** Nom de l'entité */
  name: string;
  /** Type d'entité */
  type: EntityType;
  /** Contexte d'apparition (phrase ou paragraphe) */
  context: string;
  /** Nombre d'occurrences dans le document */
  occurrences: number;
  /** Score d'importance (0-1) */
  importance: number;
  /** Document source */
  documentId: string;
}

/** Types d'entités extraites des documents */
export type EntityType =
  | "person"
  | "organization"
  | "location"
  | "date"
  | "concept"
  | "definition"
  | "acronym"
  | "reference"
  | "url"
  | "email"
  | "phone"
  | "amount"
  | "technology"
  | "methodology"
  | "term"
  | "custom";

/** Métadonnées d'un document */
export interface DocumentMetadata {
  /** Auteur */
  author?: string;
  /** Date de création du document */
  createdDate?: string;
  /** Date de modification */
  modifiedDate?: string;
  /** Nombre de pages (PDF) */
  pageCount?: number;
  /** Nombre de mots */
  wordCount?: number;
  /** Nombre de caractères */
  charCount?: number;
  /** Version du document */
  version?: string;
  /** Sujet/catégorie */
  subject?: string;
  /** Métadonnées custom */
  custom?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Relations Inter-Documents
// ═══════════════════════════════════════════════════════════════════════════════

/** Types de relations entre documents */
export type DocumentRelationType =
  | "references"        // Doc A cite/référence Doc B
  | "extends"           // Doc A étend/complète Doc B
  | "contradicts"       // Doc A contredit Doc B
  | "summarizes"        // Doc A résume Doc B
  | "updates"           // Doc A met à jour Doc B
  | "related"           // Relation thématique
  | "sequential"        // Doc A précède Doc B (chapitres, versions)
  | "depends_on"        // Doc A nécessite Doc B pour être compris
  | "derived_from"      // Doc A est dérivé de Doc B
  | "similar";          // Similitude de contenu

/** Relation entre deux documents */
export interface DocumentRelation {
  /** ID unique de la relation */
  id: string;
  /** Document source */
  sourceId: string;
  /** Document cible */
  targetId: string;
  /** Type de relation */
  type: DocumentRelationType;
  /** Description de la relation */
  description: string;
  /** Score de confiance (0-1) */
  confidence: number;
  /** Preuve textuelle (extrait justifiant la relation) */
  evidence?: string;
  /** Date de création */
  createdAt: string;
  /** Créé automatiquement ou manuellement */
  autoDetected: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Mémoire Documentaire
// ═══════════════════════════════════════════════════════════════════════════════

/** Catégories de faits documentaires */
export type MemoryCategory =
  | "definition"        // Définition d'un terme/concept
  | "fact"              // Fait factuel extrait
  | "insight"           // Insight/conclusion tirée
  | "procedure"         // Procédure/méthode décrite
  | "decision"          // Décision documentée
  | "reference"         // Référence bibliographique
  | "quote"             // Citation importante
  | "summary"           // Résumé d'un ensemble
  | "question"          // Question ouverte identifiée
  | "contradiction"     // Contradiction détectée
  | "timeline"          // Événement daté
  | "relationship";     // Relation entre concepts

/** Un fait/connaissance extrait et mémorisé */
export interface MemoryFact {
  /** ID unique */
  id: string;
  /** Contenu du fait */
  content: string;
  /** Catégorie */
  category: MemoryCategory;
  /** Tags associés */
  tags: string[];
  /** Documents sources (IDs) */
  sourceDocuments: string[];
  /** Extrait source (preuve) */
  sourceExcerpt?: string;
  /** Confiance (0-1) */
  confidence: number;
  /** Importance (0-1) */
  importance: number;
  /** Date de création */
  createdAt: string;
  /** Date de mise à jour */
  updatedAt: string;
  /** Nombre d'accès */
  accessCount: number;
  /** Concepts liés */
  relatedConcepts: string[];
  /** Fait vérifié/validé par l'utilisateur */
  verified: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Recherche
// ═══════════════════════════════════════════════════════════════════════════════

/** Résultat de recherche documentaire */
export interface SearchResult {
  /** Type de résultat */
  resultType: "document" | "section" | "fact" | "entity";
  /** ID de l'élément trouvé */
  id: string;
  /** Titre/nom */
  title: string;
  /** Extrait pertinent (snippet) */
  snippet: string;
  /** Score de pertinence (0-1) */
  relevance: number;
  /** Document parent (si section/entité) */
  documentId?: string;
  /** Document parent titre */
  documentTitle?: string;
  /** Highlights (positions des termes trouvés dans le snippet) */
  highlights: { start: number; end: number }[];
}

/** Options de recherche */
export interface SearchOptions {
  /** Nombre max de résultats */
  maxResults?: number;
  /** Filtrer par type de document */
  documentTypes?: DocumentType[];
  /** Filtrer par collection */
  collections?: string[];
  /** Filtrer par tags */
  tags?: string[];
  /** Filtrer par catégorie de fait */
  factCategories?: MemoryCategory[];
  /** Rechercher dans le texte complet ou seulement résumés */
  searchMode?: "full" | "summary" | "keywords";
  /** Langue de recherche */
  language?: "fr" | "en" | "all";
  /** Date minimum */
  dateFrom?: string;
  /** Date maximum */
  dateTo?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Extraction
// ═══════════════════════════════════════════════════════════════════════════════

/** Résultat d'extraction d'un document */
export interface ExtractionResult {
  /** Succès de l'extraction */
  success: boolean;
  /** Texte extrait */
  text: string;
  /** Sections détectées */
  sections: DocumentSection[];
  /** Métadonnées extraites */
  metadata: DocumentMetadata;
  /** Entités détectées (pre-analyse) */
  entities: DocumentEntity[];
  /** Langue détectée */
  language: "fr" | "en" | "other";
  /** Erreur éventuelle */
  error?: string;
  /** Durée d'extraction en ms */
  durationMs: number;
}

/** Options d'extraction */
export interface ExtractionOptions {
  /** Extraire les entités (plus lent) */
  extractEntities?: boolean;
  /** Nombre max de caractères à extraire */
  maxChars?: number;
  /** Détecter les sections/titres */
  detectSections?: boolean;
  /** Pages spécifiques (PDF) */
  pages?: number[];
  /** OCR sur les images (si disponible) */
  useOCR?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Contexte & Synthèse
// ═══════════════════════════════════════════════════════════════════════════════

/** Contexte documentaire pour le LLM */
export interface DocumentContext {
  /** Requête originale */
  query: string;
  /** Documents pertinents trouvés */
  documents: {
    id: string;
    title: string;
    summary: string;
    relevantSections: string[];
    relevance: number;
  }[];
  /** Faits pertinents de la mémoire */
  facts: MemoryFact[];
  /** Relations entre les documents trouvés */
  relations: DocumentRelation[];
  /** Qualité du contexte */
  quality: {
    totalDocuments: number;
    totalFacts: number;
    averageRelevance: number;
    sufficient: boolean;
  };
  /** Prompt formaté pour injection LLM */
  formattedPrompt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types Persistence
// ═══════════════════════════════════════════════════════════════════════════════

/** Structure de données persistée sur disque */
export interface DocumentKnowledgeStore {
  version: number;
  documents: KnowledgeDocument[];
  relations: DocumentRelation[];
  facts: MemoryFact[];
  collections: string[];
  stats: DocumentKnowledgeStats;
  lastUpdated: string;
}

/** Statistiques du système */
export interface DocumentKnowledgeStats {
  totalDocuments: number;
  totalFacts: number;
  totalRelations: number;
  totalWords: number;
  totalSections: number;
  totalEntities: number;
  documentsByType: Record<string, number>;
  factsByCategory: Record<string, number>;
  relationsByType: Record<string, number>;
  averageDocumentSize: number;
  lastActivity: string;
}
