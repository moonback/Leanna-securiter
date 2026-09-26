/**
 * DocumentMemory — Mémoire persistante des documents et faits extraits
 *
 * Gère le cycle de vie complet des documents dans le système de connaissance :
 *   • Stockage persistant (JSON sur disque)
 *   • CRUD documents, faits, relations
 *   • Index inversé pour recherche rapide (BM25-like)
 *   • Gestion des collections
 *   • Statistiques et métriques
 *   • Auto-pruning (rotation si > MAX_DOCUMENTS)
 *
 * Persisté dans : .Leanna/DocumentKnowledge.json
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createLogger } from "../../utils/logger.js";
import { SELF_ROOT } from "../../utils/selfRoot.js";
import type {
  KnowledgeDocument,
  DocumentRelation,
  MemoryFact,
  DocumentKnowledgeStore,
  DocumentKnowledgeStats,
  MemoryCategory,
} from "./types.js";

const log = createLogger("DocumentMemory");

// ═══════════════════════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════════════════════

const STORE_VERSION = 1;
const MAX_DOCUMENTS = 200;
const MAX_FACTS = 1000;
const STORE_FILE = "DocumentKnowledge.json";

function getStorePath(): string {
  return path.join(SELF_ROOT, ".Leanna", STORE_FILE);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stop-words pour l'index inversé
// ═══════════════════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  // FR
  "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "à", "au", "aux",
  "ce", "ces", "est", "sont", "pour", "par", "sur", "dans", "qui", "que", "avec",
  "pas", "plus", "très", "tout", "tous", "être", "avoir", "faire", "comme", "mais",
  "ou", "son", "sa", "ses", "leur", "leurs", "nous", "vous", "ils", "elles",
  // EN
  "the", "a", "an", "is", "are", "was", "were", "of", "in", "to", "and", "for",
  "on", "with", "at", "by", "from", "or", "not", "this", "that", "it", "its",
  "has", "have", "had", "be", "been", "will", "would", "can", "could", "do",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// DocumentMemory
// ═══════════════════════════════════════════════════════════════════════════════

export class DocumentMemory {
  private store: DocumentKnowledgeStore;

  /** Index inversé : mot → Set<documentId | factId> */
  private invertedIndex: Map<string, Set<string>> = new Map();

  constructor() {
    this.store = this.load();
    this.rebuildIndex();
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private load(): DocumentKnowledgeStore {
    const storePath = getStorePath();
    try {
      if (fs.existsSync(storePath)) {
        const raw = fs.readFileSync(storePath, "utf-8");
        const parsed = JSON.parse(raw) as DocumentKnowledgeStore;
        if (parsed.version === STORE_VERSION) {
          log.info(`Store chargé: ${parsed.documents.length} documents, ${parsed.facts.length} faits`);
          return parsed;
        }
        log.warn("Version incompatible, réinitialisation du store.");
      }
    } catch (e: any) {
      log.warn("Erreur lecture store:", e.message);
    }
    return this.createEmptyStore();
  }

  private createEmptyStore(): DocumentKnowledgeStore {
    return {
      version: STORE_VERSION,
      documents: [],
      relations: [],
      facts: [],
      collections: [],
      stats: this.computeStats([], [], []),
      lastUpdated: new Date().toISOString(),
    };
  }

  save(): void {
    try {
      const storePath = getStorePath();
      const dir = path.dirname(storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.store.stats = this.computeStats(this.store.documents, this.store.facts, this.store.relations);
      this.store.lastUpdated = new Date().toISOString();
      fs.writeFileSync(storePath, JSON.stringify(this.store, null, 2), "utf-8");
    } catch (e: any) {
      log.error("Erreur écriture store:", e.message);
    }
  }

  private markDirty(): void {
    // Auto-save différé (debounce simple)
    if ((this as any)._saveTimeout) clearTimeout((this as any)._saveTimeout);
    (this as any)._saveTimeout = setTimeout(() => this.save(), 2000);
  }

  // ─── Index inversé ────────────────────────────────────────────────────────

  private rebuildIndex(): void {
    this.invertedIndex.clear();
    for (const doc of this.store.documents) {
      this.indexDocument(doc);
    }
    for (const fact of this.store.facts) {
      this.indexFact(fact);
    }
    log.info(`Index reconstruit: ${this.invertedIndex.size} termes`);
  }

  private indexDocument(doc: KnowledgeDocument): void {
    const text = `${doc.title} ${doc.summary} ${doc.keywords.join(" ")} ${doc.tags.join(" ")}`;
    const tokens = this.tokenize(text);
    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(doc.id);
    }
  }

  private indexFact(fact: MemoryFact): void {
    const text = `${fact.content} ${fact.tags.join(" ")} ${fact.relatedConcepts.join(" ")}`;
    const tokens = this.tokenize(text);
    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(fact.id);
    }
  }

  private removeFromIndex(id: string): void {
    for (const [, ids] of this.invertedIndex) {
      ids.delete(id);
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  // ─── CRUD Documents ───────────────────────────────────────────────────────

  /**
   * Ajoute un document au store. Retourne le document avec son ID.
   */
  addDocument(doc: Omit<KnowledgeDocument, "id" | "addedAt" | "updatedAt" | "accessCount" | "status">
    & { status?: KnowledgeDocument["status"] }
  ): KnowledgeDocument {
    const id = `doc_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const stored: KnowledgeDocument = {
      ...doc,
      id,
      status: doc.status || "indexed",
      addedAt: now,
      updatedAt: now,
      accessCount: 0,
    };

    this.store.documents.push(stored);
    this.indexDocument(stored);

    // Rotation si trop de documents
    while (this.store.documents.length > MAX_DOCUMENTS) {
      const removed = this.store.documents.shift()!;
      this.removeFromIndex(removed.id);
      // Supprimer relations associées
      this.store.relations = this.store.relations.filter(
        (r) => r.sourceId !== removed.id && r.targetId !== removed.id
      );
      log.info(`Document supprimé (rotation): ${removed.title}`);
    }

    // Ajouter la collection si nouvelle
    if (doc.collection && !this.store.collections.includes(doc.collection)) {
      this.store.collections.push(doc.collection);
    }

    this.markDirty();
    log.info(`Document ajouté: "${stored.title}" (${id})`);
    return stored;
  }

  /**
   * Récupère un document par ID.
   */
  getDocument(id: string): KnowledgeDocument | undefined {
    const doc = this.store.documents.find((d) => d.id === id);
    if (doc) {
      doc.accessCount++;
      doc.updatedAt = new Date().toISOString();
    }
    return doc;
  }

  /**
   * Récupère tous les documents.
   */
  getAllDocuments(): KnowledgeDocument[] {
    return [...this.store.documents];
  }

  /**
   * Récupère les documents d'une collection.
   */
  getDocumentsByCollection(collection: string): KnowledgeDocument[] {
    return this.store.documents.filter((d) => d.collection === collection);
  }

  /**
   * Met à jour un document.
   */
  updateDocument(id: string, updates: Partial<KnowledgeDocument>): boolean {
    const idx = this.store.documents.findIndex((d) => d.id === id);
    if (idx === -1) return false;

    this.removeFromIndex(id);
    this.store.documents[idx] = {
      ...this.store.documents[idx],
      ...updates,
      id, // Garder l'ID original
      updatedAt: new Date().toISOString(),
    };
    this.indexDocument(this.store.documents[idx]);
    this.markDirty();
    return true;
  }

  /**
   * Supprime un document par ID.
   */
  removeDocument(id: string): boolean {
    const idx = this.store.documents.findIndex((d) => d.id === id);
    if (idx === -1) return false;

    this.store.documents.splice(idx, 1);
    this.removeFromIndex(id);

    // Supprimer les relations et faits associés
    this.store.relations = this.store.relations.filter(
      (r) => r.sourceId !== id && r.targetId !== id
    );
    this.store.facts = this.store.facts.filter(
      (f) => !f.sourceDocuments.includes(id) || f.sourceDocuments.length > 1
    );
    // Retirer le doc des sourceDocuments des faits restants
    for (const fact of this.store.facts) {
      fact.sourceDocuments = fact.sourceDocuments.filter((d) => d !== id);
    }

    this.markDirty();
    return true;
  }

  // ─── CRUD Faits ───────────────────────────────────────────────────────────

  /**
   * Ajoute un fait à la mémoire.
   */
  addFact(fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt" | "accessCount">): MemoryFact {
    const id = `fact_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const stored: MemoryFact = {
      ...fact,
      id,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };

    this.store.facts.push(stored);
    this.indexFact(stored);

    // Pruning si trop de faits
    while (this.store.facts.length > MAX_FACTS) {
      // Supprimer le fait le moins important et le moins consulté
      const sorted = [...this.store.facts]
        .filter((f) => !f.verified) // Ne pas supprimer les faits vérifiés
        .sort((a, b) => {
          const scoreA = a.importance * 0.5 + (a.accessCount / 100) * 0.3 + a.confidence * 0.2;
          const scoreB = b.importance * 0.5 + (b.accessCount / 100) * 0.3 + b.confidence * 0.2;
          return scoreA - scoreB;
        });

      if (sorted.length > 0) {
        const toRemove = sorted[0];
        this.store.facts = this.store.facts.filter((f) => f.id !== toRemove.id);
        this.removeFromIndex(toRemove.id);
      } else {
        break;
      }
    }

    this.markDirty();
    log.info(`Fait ajouté: "${stored.content.slice(0, 60)}..." (${id})`);
    return stored;
  }

  /**
   * Récupère un fait par ID.
   */
  getFact(id: string): MemoryFact | undefined {
    const fact = this.store.facts.find((f) => f.id === id);
    if (fact) {
      fact.accessCount++;
    }
    return fact;
  }

  /**
   * Récupère tous les faits.
   */
  getAllFacts(): MemoryFact[] {
    return [...this.store.facts];
  }

  /**
   * Récupère les faits par catégorie.
   */
  getFactsByCategory(category: MemoryCategory): MemoryFact[] {
    return this.store.facts.filter((f) => f.category === category);
  }

  /**
   * Récupère les faits liés à un document.
   */
  getFactsForDocument(documentId: string): MemoryFact[] {
    return this.store.facts.filter((f) => f.sourceDocuments.includes(documentId));
  }

  /**
   * Met à jour un fait.
   */
  updateFact(id: string, updates: Partial<MemoryFact>): boolean {
    const idx = this.store.facts.findIndex((f) => f.id === id);
    if (idx === -1) return false;

    this.removeFromIndex(id);
    this.store.facts[idx] = {
      ...this.store.facts[idx],
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.indexFact(this.store.facts[idx]);
    this.markDirty();
    return true;
  }

  /**
   * Supprime un fait.
   */
  removeFact(id: string): boolean {
    const idx = this.store.facts.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    this.store.facts.splice(idx, 1);
    this.removeFromIndex(id);
    this.markDirty();
    return true;
  }

  // ─── CRUD Relations ───────────────────────────────────────────────────────

  /**
   * Ajoute une relation entre deux documents.
   */
  addRelation(relation: Omit<DocumentRelation, "id" | "createdAt">): DocumentRelation {
    // Vérifier que les documents existent
    const source = this.getDocument(relation.sourceId);
    const target = this.getDocument(relation.targetId);
    if (!source || !target) {
      throw new Error(`Documents introuvables pour la relation: ${relation.sourceId} → ${relation.targetId}`);
    }

    // Vérifier les doublons
    const exists = this.store.relations.some(
      (r) =>
        r.sourceId === relation.sourceId &&
        r.targetId === relation.targetId &&
        r.type === relation.type
    );
    if (exists) {
      return this.store.relations.find(
        (r) => r.sourceId === relation.sourceId && r.targetId === relation.targetId && r.type === relation.type
      )!;
    }

    const id = `rel_${randomUUID().slice(0, 8)}`;
    const stored: DocumentRelation = {
      ...relation,
      id,
      createdAt: new Date().toISOString(),
    };

    this.store.relations.push(stored);
    this.markDirty();
    log.info(`Relation ajoutée: ${source.title} → ${target.title} (${relation.type})`);
    return stored;
  }

  /**
   * Récupère les relations d'un document.
   */
  getRelationsForDocument(documentId: string): DocumentRelation[] {
    return this.store.relations.filter(
      (r) => r.sourceId === documentId || r.targetId === documentId
    );
  }

  /**
   * Récupère toutes les relations.
   */
  getAllRelations(): DocumentRelation[] {
    return [...this.store.relations];
  }

  /**
   * Supprime une relation.
   */
  removeRelation(id: string): boolean {
    const idx = this.store.relations.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.store.relations.splice(idx, 1);
    this.markDirty();
    return true;
  }

  // ─── Recherche via index inversé ──────────────────────────────────────────

  /**
   * Recherche rapide via l'index inversé.
   * Retourne les IDs de documents et faits qui matchent.
   */
  searchByIndex(query: string): { documentIds: string[]; factIds: string[] } {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return { documentIds: [], factIds: [] };

    // Compter les matches par ID
    const scores = new Map<string, number>();
    for (const token of tokens) {
      const ids = this.invertedIndex.get(token);
      if (ids) {
        for (const id of ids) {
          scores.set(id, (scores.get(id) || 0) + 1);
        }
      }
    }

    // Séparer documents et faits, trier par score
    const documentIds: string[] = [];
    const factIds: string[] = [];

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id] of sorted) {
      if (id.startsWith("doc_")) documentIds.push(id);
      else if (id.startsWith("fact_")) factIds.push(id);
    }

    return { documentIds, factIds };
  }

  // ─── Collections ──────────────────────────────────────────────────────────

  getCollections(): string[] {
    return [...this.store.collections];
  }

  addCollection(name: string): void {
    if (!this.store.collections.includes(name)) {
      this.store.collections.push(name);
      this.markDirty();
    }
  }

  removeCollection(name: string): void {
    this.store.collections = this.store.collections.filter((c) => c !== name);
    // Retirer la collection des documents
    for (const doc of this.store.documents) {
      if (doc.collection === name) {
        doc.collection = undefined;
      }
    }
    this.markDirty();
  }

  // ─── Statistiques ─────────────────────────────────────────────────────────

  getStats(): DocumentKnowledgeStats {
    return this.computeStats(this.store.documents, this.store.facts, this.store.relations);
  }

  private computeStats(
    documents: KnowledgeDocument[],
    facts: MemoryFact[],
    relations: DocumentRelation[]
  ): DocumentKnowledgeStats {
    const documentsByType: Record<string, number> = {};
    const factsByCategory: Record<string, number> = {};
    const relationsByType: Record<string, number> = {};
    let totalWords = 0;
    let totalSections = 0;
    let totalEntities = 0;

    for (const doc of documents) {
      documentsByType[doc.type] = (documentsByType[doc.type] || 0) + 1;
      totalWords += doc.metadata.wordCount || 0;
      totalSections += doc.sections.length;
      totalEntities += doc.entities.length;
    }

    for (const fact of facts) {
      factsByCategory[fact.category] = (factsByCategory[fact.category] || 0) + 1;
    }

    for (const rel of relations) {
      relationsByType[rel.type] = (relationsByType[rel.type] || 0) + 1;
    }

    return {
      totalDocuments: documents.length,
      totalFacts: facts.length,
      totalRelations: relations.length,
      totalWords,
      totalSections,
      totalEntities,
      documentsByType,
      factsByCategory,
      relationsByType,
      averageDocumentSize: documents.length > 0
        ? Math.round(documents.reduce((sum, d) => sum + d.fileSize, 0) / documents.length)
        : 0,
      lastActivity: this.store?.lastUpdated || new Date().toISOString(),
    };
  }

  /** Nombre total de documents */
  get documentCount(): number {
    return this.store.documents.length;
  }

  /** Nombre total de faits */
  get factCount(): number {
    return this.store.facts.length;
  }

  /** Nombre total de relations */
  get relationCount(): number {
    return this.store.relations.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

export const documentMemory = new DocumentMemory();
