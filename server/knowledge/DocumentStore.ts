/**
 * DocumentStore — Stockage persistant des documents analysés
 *
 * Persiste les résumés, textes extraits et métadonnées des documents uploadés
 * dans .Leanna/documents.json pour permettre le croisement inter-documents.
 *
 * Fonctionnalités :
 *   • Stockage persistant (JSON sur disque)
 *   • Recherche par mots-clés dans les résumés et textes
 *   • Score de similarité textuelle entre documents
 *   • Gestion automatique de la taille (max 50 documents, rotation FIFO)
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../utils/logger.js";
import { SELF_ROOT } from "../utils/selfRoot.js";

const log = createLogger("DocumentStore");

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface StoredDocument {
  /** Identifiant unique */
  id: string;
  /** Nom du fichier original */
  fileName: string;
  /** Type MIME */
  mimeType: string;
  /** Résumé généré par l'IA */
  summary: string;
  /** Texte extrait (tronqué à 30k caractères) */
  extractedText: string;
  /** Mots-clés extraits automatiquement du résumé */
  keywords: string[];
  /** Date d'upload */
  uploadedAt: string;
  /** Taille originale du texte extrait */
  originalTextLength: number;
  /** Tags manuels ajoutés par l'utilisateur ou l'IA */
  tags: string[];
}

export interface DocumentLink {
  /** ID du premier document */
  docA: string;
  /** ID du second document */
  docB: string;
  /** Type de lien détecté */
  linkType: "thematic" | "complementary" | "contradictory" | "sequential" | "reference";
  /** Description du lien */
  description: string;
  /** Score de confiance (0-1) */
  confidence: number;
  /** Date de création du lien */
  createdAt: string;
}

export interface DocumentStoreData {
  version: number;
  documents: StoredDocument[];
  links: DocumentLink[];
  lastUpdated: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_DOCUMENTS = 50;
const MAX_EXTRACTED_TEXT = 30_000;
const STORE_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════════
// DocumentStore
// ═══════════════════════════════════════════════════════════════════════════════

export class DocumentStore {
  private data: DocumentStoreData;
  private filePath: string;
  private linksDetected: boolean = false;

  constructor(projectRoot?: string) {
    const root = projectRoot || process.cwd();
    const LeannaDir = path.join(root, ".Leanna");
    this.filePath = path.join(LeannaDir, "documents.json");

    // Créer le répertoire .Leanna si nécessaire
    if (!fs.existsSync(LeannaDir)) {
      fs.mkdirSync(LeannaDir, { recursive: true });
    }

    this.data = this.load();
    
    // Vérifier si des liens existent déjà
    this.linksDetected = this.data.links.length > 0;
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private load(): DocumentStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as DocumentStoreData;
        if (parsed.version === STORE_VERSION) {
          return parsed;
        }
        log.warn("Version du store incompatible, réinitialisation.");
      }
    } catch (e: any) {
      log.warn("Erreur lecture documents.json, réinitialisation:", e.message);
    }
    return { version: STORE_VERSION, documents: [], links: [], lastUpdated: new Date().toISOString() };
  }

  public save(): void {
    try {
      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e: any) {
      log.error("Erreur écriture documents.json:", e.message);
    }
  }

  // ─── CRUD Documents ───────────────────────────────────────────────────────

  /**
   * Ajoute un document au store. Retourne l'ID généré.
   */
  public addDocument(doc: Omit<StoredDocument, "id" | "keywords">): string {
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const keywords = this.extractKeywords(doc.summary);

    const stored: StoredDocument = {
      ...doc,
      id,
      keywords,
      extractedText: doc.extractedText.slice(0, MAX_EXTRACTED_TEXT),
    };

    this.data.documents.push(stored);

    // Détecter automatiquement des liens avec les documents existants
    this.detectAndAddLinksForDocument(id);

    // Rotation FIFO si trop de documents
    while (this.data.documents.length > MAX_DOCUMENTS) {
      const removed = this.data.documents.shift();
      if (removed) {
        // Supprimer les liens associés
        this.data.links = this.data.links.filter(
          (l) => l.docA !== removed.id && l.docB !== removed.id
        );
      }
    }

    this.save();
    log.info(`Document ajouté: ${doc.fileName} (id: ${id})`);
    return id;
  }

  /**
   * Récupère un document par ID.
   */
  public getDocument(id: string): StoredDocument | undefined {
    return this.data.documents.find((d) => d.id === id);
  }

  /**
   * Récupère tous les documents.
   */
  public getAllDocuments(): StoredDocument[] {
    return [...this.data.documents];
  }

  /**
   * Supprime un document par ID.
   */
  public removeDocument(id: string): boolean {
    const idx = this.data.documents.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this.data.documents.splice(idx, 1);
    this.data.links = this.data.links.filter((l) => l.docA !== id && l.docB !== id);
    this.save();
    return true;
  }

  /**
   * Recherche dans les documents par mots-clés (résumé + texte extrait).
   */
  public searchDocuments(query: string, maxResults = 10): (StoredDocument & { relevance: number })[] {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    if (terms.length === 0) return [];

    const scored = this.data.documents.map((doc) => {
      const searchText = `${doc.fileName} ${doc.summary} ${doc.keywords.join(" ")} ${doc.tags.join(" ")}`.toLowerCase();
      const matchCount = terms.filter((term) => searchText.includes(term)).length;
      const relevance = matchCount / terms.length;
      return { ...doc, relevance };
    });

    return scored
      .filter((d) => d.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);
  }

  // ─── Liens inter-documents ────────────────────────────────────────────────

  /**
   * Ajoute un lien entre deux documents.
   */
  public addLink(link: Omit<DocumentLink, "createdAt">): void {
    // Vérifier que les deux documents existent
    const docA = this.getDocument(link.docA);
    const docB = this.getDocument(link.docB);
    if (!docA || !docB) {
      log.warn(`Impossible de créer un lien: document introuvable (${link.docA} / ${link.docB})`);
      return;
    }

    // Éviter les doublons
    const exists = this.data.links.some(
      (l) =>
        (l.docA === link.docA && l.docB === link.docB) ||
        (l.docA === link.docB && l.docB === link.docA)
    );
    if (exists) return;

    this.data.links.push({
      ...link,
      createdAt: new Date().toISOString(),
    });
    this.save();
  }

  /**
   * Récupère tous les liens d'un document.
   */
  public getLinksForDocument(docId: string): (DocumentLink & { linkedDoc: StoredDocument })[] {
    return this.data.links
      .filter((l) => l.docA === docId || l.docB === docId)
      .map((l) => {
        const linkedId = l.docA === docId ? l.docB : l.docA;
        const linkedDoc = this.getDocument(linkedId);
        return linkedDoc ? { ...l, linkedDoc } : null;
      })
      .filter(Boolean) as (DocumentLink & { linkedDoc: StoredDocument })[];
  }

  /**
   * Récupère tous les liens.
   */
  public getAllLinks(): DocumentLink[] {
    // Détecter les liens automatiquement si ce n'est pas déjà fait
    // et qu'il y a des documents sans liens
    if (!this.linksDetected && this.data.documents.length > 1) {
      this.detectAllLinks();
      this.linksDetected = true;
    }
    return [...this.data.links];
  }

  /**
   * Détecte automatiquement des liens entre un document et les documents existants
   * basé sur la similarité des mots-clés.
   */
  private detectAndAddLinksForDocument(newDocId: string, minSimilarity = 0.2): void {
    const newDoc = this.getDocument(newDocId);
    if (!newDoc) return;

    const existingDocs = this.data.documents.filter((d) => d.id !== newDocId);
    const newLinks: Omit<DocumentLink, "createdAt">[] = [];
    
    for (const existingDoc of existingDocs) {
      // Calculer la similarité basée sur les mots-clés communs
      const commonKeywords = newDoc.keywords.filter((k) => existingDoc.keywords.includes(k));
      const keywordSimilarity = commonKeywords.length / Math.max(newDoc.keywords.length, 1);

      if (keywordSimilarity > minSimilarity) {
        // Éviter les doublons
        const linkExists = this.data.links.some(
          (l) =>
            (l.docA === newDocId && l.docB === existingDoc.id) ||
            (l.docA === existingDoc.id && l.docB === newDocId)
        );

        if (!linkExists) {
          const linkType: DocumentLink["linkType"] = keywordSimilarity > 0.6 ? "thematic" : "complementary";
          newLinks.push({
            docA: newDocId,
            docB: existingDoc.id,
            linkType,
            description: `Mots-clés communs: ${commonKeywords.slice(0, 5).join(", ")}`,
            confidence: Math.min(keywordSimilarity, 0.9),
          });
        }
      }
    }
    
    // Ajouter tous les nouveaux liens en une seule fois
    if (newLinks.length > 0) {
      for (const link of newLinks) {
        // Ajouter directement sans sauvegarder à chaque fois
        const docA = this.getDocument(link.docA);
        const docB = this.getDocument(link.docB);
        if (docA && docB) {
          // Éviter les doublons une dernière fois
          const exists = this.data.links.some(
            (l) =>
              (l.docA === link.docA && l.docB === link.docB) ||
              (l.docA === link.docB && l.docB === link.docA)
          );
          if (!exists) {
            this.data.links.push({
              ...link,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
      this.save();
    }
  }

  // ─── Analyse de similarité ────────────────────────────────────────────────

  /**
   * Calcule un score de similarité textuelle entre deux documents
   * basé sur les mots-clés communs et le vocabulaire partagé.
   */
  public computeSimilarity(docIdA: string, docIdB: string): number {
    const docA = this.getDocument(docIdA);
    const docB = this.getDocument(docIdB);
    if (!docA || !docB) return 0;

    const wordsA = new Set(this.tokenize(docA.summary + " " + docA.extractedText.slice(0, 5000)));
    const wordsB = new Set(this.tokenize(docB.summary + " " + docB.extractedText.slice(0, 5000)));

    // Jaccard similarity
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Trouve les documents les plus similaires à un document donné.
   */
  public findSimilarDocuments(docId: string, minSimilarity = 0.05, maxResults = 5): { doc: StoredDocument; similarity: number }[] {
    const results: { doc: StoredDocument; similarity: number }[] = [];

    for (const doc of this.data.documents) {
      if (doc.id === docId) continue;
      const similarity = this.computeSimilarity(docId, doc.id);
      if (similarity >= minSimilarity) {
        results.push({ doc, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);
  }

  /**
   * Prépare un contexte textuel pour le LLM à partir de N documents.
   * Utilisé pour l'analyse inter-documents.
   */
  public buildCrossDocumentContext(docIds: string[], maxCharsPerDoc = 8000): string {
    const sections: string[] = [];

    for (const id of docIds) {
      const doc = this.getDocument(id);
      if (!doc) continue;

      const text = doc.extractedText.length > 0
        ? doc.extractedText.slice(0, maxCharsPerDoc)
        : doc.summary;

      sections.push([
        `═══ Document: "${doc.fileName}" (${doc.mimeType}) ═══`,
        `Uploadé: ${doc.uploadedAt}`,
        `Mots-clés: ${doc.keywords.join(", ")}`,
        ``,
        `── Résumé ──`,
        doc.summary,
        ``,
        `── Contenu (extrait) ──`,
        text,
      ].join("\n"));
    }

    return sections.join("\n\n" + "─".repeat(60) + "\n\n");
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  public getStats(): { documentCount: number; linkCount: number; totalTextSize: number; lastUpdated: string } {
    return {
      documentCount: this.data.documents.length,
      linkCount: this.data.links.length,
      totalTextSize: this.data.documents.reduce((sum, d) => sum + d.extractedText.length, 0),
      lastUpdated: this.data.lastUpdated,
    };
  }

  /**
   * Détecte des liens entre tous les documents existants.
   * À appeler après le chargement initial ou une ré-extraction complète.
   */
  public detectAllLinks(minSimilarity = 0.2): number {
    const docIds = this.data.documents.map((d) => d.id);
    
    // Vider les liens existants pour recalculer proprement
    this.data.links = [];

    for (const docId of docIds) {
      this.detectAndAddLinksForDocument(docId, minSimilarity);
    }

    log.info(`🔗 Liens détectés entre ${docIds.length} documents`);
    return this.data.links.length;
  }

  // ─── Utilitaires privés ───────────────────────────────────────────────────

  /**
   * Extrait des mots-clés significatifs d'un texte.
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "à", "au", "aux",
      "ce", "ces", "est", "sont", "pour", "par", "sur", "dans", "qui", "que", "avec",
      "pas", "plus", "très", "tout", "tous", "être", "avoir", "faire", "comme", "mais",
      "the", "a", "an", "is", "are", "was", "were", "of", "in", "to", "and", "for",
      "on", "with", "at", "by", "from", "or", "not", "this", "that", "it", "its",
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-zàâäéèêëïîôùûüÿçœæ\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    // Compter les fréquences
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    // Top 15 mots les plus fréquents
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word]) => word);
  }

  /**
   * Tokenize un texte en mots significatifs (pour la similarité).
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

const documentStoreCache = new Map<string, DocumentStore>();

export function getDocumentStore(projectRoot?: string): DocumentStore {
  const resolvedRoot = projectRoot ? path.resolve(projectRoot) : (SELF_ROOT || process.cwd());
  const normalizedRoot = path.resolve(resolvedRoot);

  if (!documentStoreCache.has(normalizedRoot)) {
    documentStoreCache.set(normalizedRoot, new DocumentStore(normalizedRoot));
  }

  return documentStoreCache.get(normalizedRoot)!;
}

export const documentStore = getDocumentStore();
