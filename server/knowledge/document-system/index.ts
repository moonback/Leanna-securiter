/**
 * Document Knowledge System — Point d'entrée
 *
 * Système de gestion de connaissances orienté DOCUMENTS.
 * Remplace le paradigme code-centric par une approche documentaire :
 *
 *   ContentExtractor → extraction de contenu (PDF, TXT, MD, HTML, URL)
 *   DocumentMemory    → stockage persistant (documents, faits, relations)
 *   DocumentSearchEngine → recherche sémantique (BM25, full-text)
 *   DocumentAnalyzer  → analyse intelligente (résumés, faits, relations)
 *
 * Usage :
 *   import { documentAnalyzer, documentMemory, documentSearchEngine } from "./document-system.js";
 *   
 *   // Ingérer un document
 *   const doc = await documentAnalyzer.ingestFromBuffer(buffer, "rapport.pdf", "application/pdf");
 *   
 *   // Rechercher
 *   const results = documentSearchEngine.search("budget 2024");
 *   
 *   // Construire un contexte pour le LLM
 *   const ctx = documentSearchEngine.buildContext("Quel est le budget prévu ?");
 */

// Types
export type {
  DocumentType,
  ProcessingStatus,
  KnowledgeDocument,
  DocumentSection,
  DocumentEntity,
  EntityType,
  DocumentMetadata,
  DocumentRelationType,
  DocumentRelation,
  MemoryCategory,
  MemoryFact,
  SearchResult,
  SearchOptions,
  DocumentContext,
  ExtractionResult,
  ExtractionOptions,
  DocumentKnowledgeStore,
  DocumentKnowledgeStats,
} from "./types.js";

// ContentExtractor
export { ContentExtractor, contentExtractor } from "./ContentExtractor.js";

// DocumentMemory
export { DocumentMemory, documentMemory } from "./DocumentMemory.js";

// DocumentSearchEngine
export { DocumentSearchEngine, documentSearchEngine } from "./DocumentSearchEngine.js";

// DocumentAnalyzer
export { DocumentAnalyzer, documentAnalyzer } from "./DocumentAnalyzer.js";
