/**
 * Notebooks Module — Point d'entrée
 *
 * Concurrent de NotebookLM : collections de sources avec
 * chat grounded, résumés, génération de contenu et audio overview.
 */

export { notebookManager } from "./NotebookManager.js";
export { sourceIngester } from "./SourceIngester.js";
export { embeddingStore } from "./EmbeddingStore.js";
export { ragEngine } from "./RAGEngine.js";
export { groundedChat } from "./GroundedChat.js";
export { contentGenerator } from "./ContentGenerator.js";
export { backupService } from "./BackupService.js";
export { sourceProcessingQueue } from "./ProcessingQueue.js";
export { chatResponseCache, ragSearchCache } from "./ResponseCache.js";
export type * from "./types.js";
