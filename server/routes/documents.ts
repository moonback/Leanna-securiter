/**
 * Routes API — Document Knowledge System
 *
 * Endpoints pour gérer les documents, faits, relations et recherche.
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import type { ProfileConfig } from "../prompts/systemInstruction.js";
import {
  documentAnalyzer,
  documentMemory,
  documentSearchEngine,
} from "../knowledge/document-system/index.js";

// Configuration multer pour uploads en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(pdf|txt|md|html|docx|png|jpg|jpeg|webp)$/i;
    if (file.originalname.match(allowed) || file.mimetype.startsWith("text/") || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error(`Type non supporté: ${file.mimetype}`));
    }
  },
});

export function createDocumentsRouter(_getProfile: () => ProfileConfig): Router {
  const router = Router();

  // POST /api/documents/upload
  router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) { res.status(400).json({ error: "Aucun fichier fourni." }); return; }
      const { collection, tags } = req.body;
      const parsedTags = tags ? (typeof tags === "string" ? tags.split(",").map((t: string) => t.trim()) : tags) : [];

      const document = await documentAnalyzer.ingestFromBuffer(
        req.file.buffer, req.file.originalname, req.file.mimetype,
        { collection, tags: parsedTags }
      );
      res.json({
        status: "success",
        document: {
          id: document.id, title: document.title, type: document.type,
          summary: document.summary, keywords: document.keywords,
          wordCount: document.metadata.wordCount,
          sections: document.sections.length,
          entities: document.entities.length, language: document.language,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/documents/ingest-url
  router.post("/ingest-url", async (req: Request, res: Response) => {
    try {
      const { url, collection, tags } = req.body;
      if (!url) { res.status(400).json({ error: "URL requise." }); return; }
      const document = await documentAnalyzer.ingestFromURL(url, { collection, tags });
      res.json({
        status: "success",
        document: {
          id: document.id, title: document.title, type: document.type,
          summary: document.summary, keywords: document.keywords,
          wordCount: document.metadata.wordCount, language: document.language,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents
  router.get("/", (req: Request, res: Response) => {
    try {
      const { collection, type, tag } = req.query;
      let documents = documentMemory.getAllDocuments();
      if (collection && typeof collection === "string") documents = documents.filter((d) => d.collection === collection);
      if (type && typeof type === "string") documents = documents.filter((d) => d.type === type);
      if (tag && typeof tag === "string") documents = documents.filter((d) => d.tags.includes(tag));

      const light = documents.map((d) => ({
        id: d.id, title: d.title, type: d.type, source: d.source,
        summary: d.summary, keywords: d.keywords, tags: d.tags,
        collection: d.collection, language: d.language,
        wordCount: d.metadata.wordCount, addedAt: d.addedAt, accessCount: d.accessCount,
      }));
      res.json({ status: "success", count: light.length, documents: light });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/documents/list — Alias POST pour le DocumentPanel sidebar
  router.post("/list", (req: Request, res: Response) => {
    try {
      const { include_summaries, include_links } = req.body || {};
      let documents = documentMemory.getAllDocuments();

      const mapped = documents.map((d) => ({
        id: d.id, fileName: d.title || d.source, mimeType: d.type,
        uploadedAt: d.addedAt, keywords: d.keywords, tags: d.tags,
        summary: include_summaries ? d.summary : undefined,
        textLength: d.metadata?.wordCount ?? 0,
      }));

      const links = include_links ? documentMemory.getAllRelations() : [];

      res.json({ status: "success", documents: mapped, links });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents/stats
  router.get("/stats", (_req: Request, res: Response) => {
    try {
      res.json({ status: "success", stats: documentMemory.getStats() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents/search?q=
  router.get("/search", (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) { res.status(400).json({ error: 'Paramètre "q" requis.' }); return; }
      const maxResults = parseInt(req.query.max as string) || 20;
      const collection = typeof req.query.collection === "string" ? req.query.collection : undefined;
      const type = typeof req.query.type === "string" ? req.query.type : undefined;

      const results = documentSearchEngine.search(q, {
        maxResults,
        collections: collection ? [collection] : undefined,
        documentTypes: type ? [type as any] : undefined,
      });
      res.json({ status: "success", query: q, count: results.length, results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/documents/context
  router.post("/context", (req: Request, res: Response) => {
    try {
      const { query, maxResults } = req.body;
      if (!query) { res.status(400).json({ error: "Query requise." }); return; }
      const context = documentSearchEngine.buildContext(query, { maxResults });
      res.json({ status: "success", context });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents/collections
  router.get("/collections", (_req: Request, res: Response) => {
    try {
      const collections = documentMemory.getCollections();
      const withCounts = collections.map((name) => ({
        name, documentCount: documentMemory.getDocumentsByCollection(name).length,
      }));
      res.json({ status: "success", collections: withCounts });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/documents/collections
  router.post("/collections", (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name) { res.status(400).json({ error: "Nom requis." }); return; }
      documentMemory.addCollection(name);
      res.json({ status: "success", message: `Collection "${name}" créée.` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents/facts/list
  router.get("/facts/list", (req: Request, res: Response) => {
    try {
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const docId = typeof req.query.documentId === "string" ? req.query.documentId : undefined;
      let facts = documentMemory.getAllFacts();
      if (category) facts = facts.filter((f) => f.category === category);
      if (docId) facts = facts.filter((f) => f.sourceDocuments.includes(docId));
      res.json({ status: "success", count: facts.length, facts });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/documents/facts
  router.post("/facts", (req: Request, res: Response) => {
    try {
      const { content, category, tags, sourceDocuments, importance, relatedConcepts } = req.body;
      if (!content || !category) { res.status(400).json({ error: "content et category requis." }); return; }
      const fact = documentMemory.addFact({
        content, category, tags: tags || [], sourceDocuments: sourceDocuments || [],
        confidence: 0.9, importance: importance || 0.7, relatedConcepts: relatedConcepts || [], verified: true,
      });
      res.json({ status: "success", fact });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/documents/facts/:id
  router.delete("/facts/:id", (req: Request, res: Response) => {
    try {
      const success = documentMemory.removeFact(req.params.id);
      if (!success) { res.status(404).json({ error: "Fait introuvable." }); return; }
      res.json({ status: "success", message: "Fait supprimé." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents/relations/list
  router.get("/relations/list", async (req: Request, res: Response) => {
    try {
      const docId = typeof req.query.documentId === "string" ? req.query.documentId : undefined;
      
      // Récupérer les relations de DocumentMemory (documents uploadés)
      const memoryRelations = docId 
        ? documentMemory.getRelationsForDocument(docId) 
        : documentMemory.getAllRelations();
      
      // Récupérer les liens de DocumentStore (documents workspace)
      let storeLinks: any[] = [];
      try {
        const { getDocumentStore } = await import('../knowledge/DocumentStore');
        const store = getDocumentStore();
        const links = docId ? store.getLinksForDocument(docId) : store.getAllLinks();
        
        // Convertir DocumentLink en format DocumentRelation pour uniformité
        storeLinks = links.map((link: any) => ({
          id: `link_${link.docA}_${link.docB}`,
          sourceId: link.docA,
          targetId: link.docB,
          type: link.linkType,
          description: link.description || '',
          confidence: link.confidence || 0.7,
          evidence: undefined,
          createdAt: link.createdAt || new Date().toISOString(),
          autoDetected: true,
        }));
      } catch (e) {
        // Si DocumentStore n'est pas disponible, ignorer
        // console.debug('DocumentStore non disponible pour les relations:', e);
      }
      
      // Fusionner les relations des deux sources
      const allRelations = [...memoryRelations, ...storeLinks];
      
      res.json({ 
        status: "success", 
        count: allRelations.length, 
        relations: allRelations 
      });
    } catch (e: any) { 
      res.status(500).json({ error: e.message }); 
    }
  });

  // POST /api/documents/relations
  router.post("/relations", (req: Request, res: Response) => {
    try {
      const { sourceId, targetId, type, description, confidence } = req.body;
      if (!sourceId || !targetId || !type) { res.status(400).json({ error: "sourceId, targetId et type requis." }); return; }
      const relation = documentMemory.addRelation({
        sourceId, targetId, type, description: description || "",
        confidence: confidence || 0.8, autoDetected: false,
      });
      res.json({ status: "success", relation });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/documents/:id
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const doc = documentMemory.getDocument(req.params.id);
      if (!doc) { res.status(404).json({ error: "Document introuvable." }); return; }
      res.json({ status: "success", document: doc });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/documents/:id
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const success = documentMemory.removeDocument(req.params.id);
      if (!success) { res.status(404).json({ error: "Document introuvable." }); return; }
      res.json({ status: "success", message: "Document supprimé." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/documents/:id
  router.patch("/:id", (req: Request, res: Response) => {
    try {
      const { title, tags, collection } = req.body;
      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = title;
      if (tags !== undefined) updates.tags = tags;
      if (collection !== undefined) updates.collection = collection;
      const success = documentMemory.updateDocument(req.params.id, updates);
      if (!success) { res.status(404).json({ error: "Document introuvable." }); return; }
      res.json({ status: "success", message: "Document mis à jour." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/documents/synthesis
  router.post("/synthesis", (req: Request, res: Response) => {
    try {
      const { documentIds } = req.body;
      if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
        res.status(400).json({ error: "documentIds (array) requis." }); return;
      }
      const synthesis = documentAnalyzer.buildMultiDocumentSynthesis(documentIds);
      res.json({ status: "success", synthesis });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
