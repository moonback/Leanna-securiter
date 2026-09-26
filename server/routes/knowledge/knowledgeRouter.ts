import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { knowledgeGraph, projectIndexer, projectMemory, understandingEngine, dependencyGraph, learningEngine, fileWatcher } from '../../knowledge/index.js';
import { SELF_ROOT } from '../../utils/selfRoot.js';
import { isSandboxActive, getSandboxRoot } from '../../utils/sandbox.js';
import { importModule } from '../../utils/ModuleLoader.js';

const router = Router();

/**
 * Vérifie qu'un chemin de fichier est bien à l'intérieur du workspace actif.
 * Empêche les attaques de type path traversal (../, etc.)
 * @param filePath - Chemin relatif du fichier
 * @returns true si le chemin est sécurisé, false sinon
 */
function isPathSecure(filePath: string): boolean {
  if (!filePath) return false;
  
  // Normaliser le chemin pour détecter les tentatives de traversée
  const normalized = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  
  // Interdire les chemins absolus et les tentatives de sortir du workspace
  if (path.isAbsolute(filePath) || normalized.startsWith('..') || filePath.includes('..\\') || filePath.includes('../')) {
    return false;
  }
  
  // Interdire l'accès au dossier .Leanna (données globales)
  if (normalized.includes('.Leanna') || normalized.includes('\\.Leanna\\')) {
    return false;
  }
  
  return true;
}

/**
 * Résout un chemin de fichier de manière sécurisée dans le workspace actif.
 * @param filePath - Chemin relatif du fichier
 * @returns Chemin absolu sécurisé ou null si invalide
 */
function resolveSecurePath(filePath: string): string | null {
  if (!isPathSecure(filePath)) {
    return null;
  }
  
  const root = isSandboxActive() ? getSandboxRoot() : SELF_ROOT;
  const resolved = path.resolve(root, filePath);
  
  // Vérifier que le chemin résolu est bien à l'intérieur du workspace
  if (!resolved.startsWith(root)) {
    return null;
  }
  
  return resolved;
}

// GET /api/knowledge/status
router.get('/status', (_req: Request, res: Response) => {
  try {
    const kgStats = knowledgeGraph.getStats();
    res.json({
      status: 'success',
      knowledgeGraph: {
        indexedFiles: kgStats.totalFiles,
        totalEntities: kgStats.totalEntities,
        totalLines: kgStats.totalLines,
        totalExports: kgStats.totalExports,
        totalImports: kgStats.totalImports,
        lastIndexed: knowledgeGraph.getLastIndexed(),
        filesByExtension: kgStats.filesByExtension,
        entitiesByType: kgStats.entitiesByType,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/health
router.get('/health', (_req: Request, res: Response) => {
  try {
    const healthScan = understandingEngine.scanKnowledgeHealth();
    const kgStats = knowledgeGraph.getStats();
    const allFacts = projectMemory.getAllFacts();
    const cycles = dependencyGraph.detectCycles();
    const sandboxActive = isSandboxActive();
    const activeWorkspace = sandboxActive ? getSandboxRoot() : SELF_ROOT;

    const categoryBreakdown: Record<string, number> = {};
    let structuralCount = 0;

    for (const fact of allFacts) {
      categoryBreakdown[fact.category] = (categoryBreakdown[fact.category] || 0) + 1;
      if (fact.isStructural) structuralCount++;
    }

    const overallStatus =
      healthScan.warnings.length === 0
        ? 'healthy'
        : healthScan.warnings.some((w) => w.includes('non initialisé') || w.includes('indisponible'))
        ? 'degraded'
        : 'warning';

    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      health: {
        overall: overallStatus,
        isInitialized: knowledgeGraph.isInitialized(),
        lastIndexed: knowledgeGraph.getLastIndexed(),
        warnings: healthScan.warnings,
      },
      knowledgeGraph: {
        totalFiles: kgStats.totalFiles,
        totalEntities: kgStats.totalEntities,
        totalLines: kgStats.totalLines,
        totalExports: kgStats.totalExports,
        totalImports: kgStats.totalImports,
        averageFileSize: kgStats.averageFileSize,
      },
      dependencyGraph: {
        cycleCount: cycles.length,
        cycles: cycles.slice(0, 5),
      },
      projectMemory: {
        totalFacts: allFacts.length,
        structuralFacts: structuralCount,
        categoryBreakdown,
        maxFacts: 500,
      },
      workspace: {
        selfRoot: SELF_ROOT,
        activeWorkspace,
        sandboxActive,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/dashboard
router.get('/dashboard', (_req: Request, res: Response) => {
  try {
    // 1. KnowledgeGraph stats
    const kgStats = knowledgeGraph.getStats();
    const allFiles = knowledgeGraph.getAllFiles();
    const lastIndexed = knowledgeGraph.getLastIndexed();
    const allRelations = knowledgeGraph.getRelations();
    const relationsByType: Record<string, number> = {};
    for (const relation of allRelations) {
      relationsByType[relation.relationType] = (relationsByType[relation.relationType] || 0) + 1;
    }
    const structuralEntities = {
      routes: kgStats.entitiesByType.route || 0,
      databaseTables: kgStats.entitiesByType.db_table || 0,
      environmentVariables: kgStats.entitiesByType.env_var || 0,
      tests: kgStats.entitiesByType.test || 0,
      symbols: kgStats.entitiesByType.symbol || 0,
    };

    // 2. DependencyGraph : cycles + fichiers les plus couplés
    const cycles = dependencyGraph.detectCycles();
    const couplingRanking = allFiles
      .map((f) => {
        const deps = knowledgeGraph.getDependencies(f.path).length;
        const dependents = knowledgeGraph.getDependents(f.path).length;
        return {
          path: f.path,
          dependencies: deps,
          dependents,
          totalEdges: deps + dependents,
        };
      })
      .sort((a, b) => b.totalEdges - a.totalEdges)
      .slice(0, 15);

    // Top fichiers les plus impactés (le plus grand nombre de dependents)
    const topImpacted = allFiles
      .map((f) => ({
        path: f.path,
        impacted: knowledgeGraph.getDependents(f.path).length,
      }))
      .sort((a, b) => b.impacted - a.impacted)
      .slice(0, 10)
      .filter((x) => x.impacted > 0);

    // 3. ProjectMemory : catégories, tags, top utilisés
    const allFacts = projectMemory.getAllFacts();
    const factByCategory: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const topUsedFacts = [...allFacts]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    for (const fact of allFacts) {
      factByCategory[fact.category] = (factByCategory[fact.category] || 0) + 1;
      for (const tag of fact.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    // Factes récents (10 derniers par updatedAt DESC)
    const recentFacts = [...allFacts]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, 10);

    // 4. UnderstandingEngine : health scan
    const health = understandingEngine.scanKnowledgeHealth();

    // 5. LearningEngine : patterns history
    const patterns = learningEngine.getPatternsHistory(5);

    // 6. Stats de top fichiers par taille/lignes
    const topLargest = [...allFiles]
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10)
      .map((f) => ({
        path: f.path,
        lines: f.lines,
        size: f.size,
        entities: f.entities.length,
      }));

    const topEntityDense = [...allFiles]
      .sort((a, b) => b.entities.length - a.entities.length)
      .slice(0, 10)
      .map((f) => ({
        path: f.path,
        entities: f.entities.length,
        lines: f.lines,
      }));

    // 7. Sandbox status
    const sandboxActive = isSandboxActive();
    const workspaceUsed = sandboxActive ? getSandboxRoot() : SELF_ROOT;

    res.json({
      status: 'success',
      generatedAt: new Date().toISOString(),
      workspace: {
        selfRoot: SELF_ROOT,
        activeWorkspace: workspaceUsed,
        sandboxActive,
      },
      graph: {
        lastIndexed,
        totalFiles: kgStats.totalFiles,
        totalLines: kgStats.totalLines,
        totalEntities: kgStats.totalEntities,
        totalExports: kgStats.totalExports,
        totalImports: kgStats.totalImports,
        averageFileSize: kgStats.averageFileSize,
        filesByExtension: kgStats.filesByExtension,
        entitiesByType: kgStats.entitiesByType,
        structuralEntities,
        relations: {
          total: allRelations.length,
          byType: relationsByType,
        },
        topLargest,
        topEntityDense,
        topImpacted,
        couplingRanking,
        cycleCount: cycles.length,
        cycles: cycles.slice(0, 10),
      },
      memory: {
        totalFacts: allFacts.length,
        factByCategory,
        topTags,
        topUsedFacts,
        recentFacts,
      },
      health,
      patterns,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/reindex
router.post('/reindex', async (_req: Request, res: Response) => {
  try {
    const { broadcastKnowledgeProgress } = await import('../../utils/knowledgeBroadcaster.js');
    const root = isSandboxActive() ? getSandboxRoot() : SELF_ROOT;

    const stats = await projectIndexer.scanAll({
      force: true,
      onProgress: (p) => broadcastKnowledgeProgress(p.phase, p.current, p.total, { file: p.file }),
    });

    const { workspaceIndexer } = await import('../../knowledge/WorkspaceIndexer.js');
    const documentStats = root ? await workspaceIndexer.extractAll() : { totalFiles: 0, totalExtracted: 0, totalSections: 0, totalWords: 0, skipped: 0, errors: 0, durationMs: 0 };

    const { getDocumentStore } = await import('../../knowledge/DocumentStore.js');
    const store = root ? getDocumentStore(root) : getDocumentStore();
    const linksDetected = store.detectAllLinks();

    broadcastKnowledgeProgress('done', stats.totalFiles, stats.totalFiles, {
      totalEntities: stats.totalEntities,
      durationMs: stats.durationMs,
      cached: false,
      documents: documentStats.totalExtracted,
      linksDetected,
    });

    await projectIndexer.buildASTIndex();
    res.json({
      status: 'success',
      stats: {
        totalFiles: stats.totalFiles,
        totalEntities: stats.totalEntities,
        durationMs: stats.durationMs,
      },
      documents: {
        totalFiles: documentStats.totalFiles,
        totalExtracted: documentStats.totalExtracted,
        totalSections: documentStats.totalSections,
        totalWords: documentStats.totalWords,
        linksDetected,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/search
router.get('/search', (req: Request, res: Response): void => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Le paramètre "q" est requis.' });
      return;
    }
    const results = knowledgeGraph.searchEntities(query);
    res.json({ status: 'success', results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/relations — Relations sémantiques entre entités
router.get('/relations', (req: Request, res: Response) => {
  try {
    const entity = typeof req.query.entity === 'string' ? req.query.entity.trim() : '';
    const file = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';

    let relations = knowledgeGraph.getRelations();

    if (entity) {
      relations = relations.filter(r => r.source.name === entity || r.target.name === entity);
    }
    if (file) {
      relations = relations.filter(r => r.source.filePath.includes(file) || r.target.filePath.includes(file));
    }
    if (type) {
      relations = relations.filter(r => r.relationType === type);
    }

    res.json({
      status: 'success',
      count: relations.length,
      relations: relations.slice(0, 100),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/memory/purge — Purge les faits bruyants
router.post('/memory/purge', (_req: Request, res: Response) => {
  try {
    const removed = projectMemory.purgeNoisyFacts();
    res.json({
      status: 'success',
      removed,
      remaining: projectMemory.size,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/watcher — Statut du FileWatcher
router.get('/watcher', (_req: Request, res: Response) => {
  try {
    const stats = fileWatcher.getStats();
    res.json({ status: 'success', watcher: stats });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/documents — Documents extraits du workspace
router.get('/documents', async (_req: Request, res: Response) => {
  try {
    const { getDocumentStore } = await import('../../knowledge/DocumentStore.js');
    const { workspaceIndexer } = await import('../../knowledge/WorkspaceIndexer.js');
    const root = isSandboxActive() ? getSandboxRoot() : SELF_ROOT;
    const store = getDocumentStore(root);
    const docs = store.getAllDocuments();
    const extractorStats = workspaceIndexer.getStats();

    res.json({
      status: 'success',
      extractor: extractorStats,
      documentCount: docs.length,
      documents: docs.map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        summary: d.summary.slice(0, 300),
        keywords: d.keywords,
        tags: d.tags,
        uploadedAt: d.uploadedAt,
        textLength: d.extractedText.length,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/documents/reextract — Force une ré-extraction complète
router.post('/documents/reextract', async (_req: Request, res: Response) => {
  try {
    const { workspaceIndexer } = await import('../../knowledge/WorkspaceIndexer.js');
    const { getDocumentStore } = await import('../../knowledge/DocumentStore.js');
    
    const stats = await workspaceIndexer.extractAll();
    
    // Détecter les liens entre documents après extraction
    const store = getDocumentStore();
    const linksCount = store.detectAllLinks();
    
    res.json({ 
      status: 'success', 
      stats, 
      linksDetected: linksCount 
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/knowledge/documents/detect-links — Détecte les liens entre documents existants
router.post('/documents/detect-links', async (req: Request, res: Response) => {
  try {
    const { getDocumentStore } = await import('../../knowledge/DocumentStore.js');
    const store = getDocumentStore();
    const minSimilarity = typeof req.body?.minSimilarity === 'number' ? req.body.minSimilarity : 0.2;
    
    const linksCount = store.detectAllLinks(minSimilarity);
    
    res.json({ 
      status: 'success', 
      linksDetected: linksCount,
      totalLinks: store.getAllLinks().length
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/documents/search — Recherche dans les documents
router.get('/documents/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Le paramètre "q" est requis.' });
      return;
    }
    const root = isSandboxActive() ? getSandboxRoot() : SELF_ROOT;
    const { getDocumentStore } = await importModule<{ getDocumentStore: any }>('../knowledge/DocumentStore.js');
    const store = getDocumentStore(root);
    const results = store.searchDocuments(query, 20);
    res.json({
      status: 'success',
      count: results.length,
      results: results.map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        summary: d.summary.slice(0, 300),
        relevance: d.relevance,
        keywords: d.keywords,
        tags: d.tags,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Endpoints AST & Call-Graph (Tree-sitter)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/knowledge/ast/stats — Statistiques globales du Call-Graph AST
router.get('/ast/stats', async (_req: Request, res: Response) => {
  try {
    const { astCallGraph, astParser } = await import('../../knowledge/index.js');
    let cgStats = astCallGraph.getStats();
    if (cgStats.totalNodes === 0 && knowledgeGraph.isInitialized()) {
      await projectIndexer.buildASTIndex();
      cgStats = astCallGraph.getStats();
    }
    res.json({
      status: 'success',
      astReady: astParser.isReady,
      stats: {
        totalNodes: cgStats.totalNodes,
        totalEdges: cgStats.totalEdges,
        resolvedEdges: cgStats.resolvedEdges,
        crossFileEdges: cgStats.crossFileEdges,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/ast/file — Détails AST complets d'un fichier (fonctions, classes, appels)
router.get('/ast/file', async (req: Request, res: Response): Promise<void> => {
  try {
    const filePath = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    if (!filePath) {
      res.status(400).json({ error: 'Le paramètre "file" est requis.' });
      return;
    }
    const { astCallGraph, astParser } = await import('../../knowledge/index.js');
    let astData = knowledgeGraph.getASTResult(filePath);
    if (!astData) {
      const root = isSandboxActive() ? getSandboxRoot() : SELF_ROOT;
      const absPath = path.join(root, filePath);
      const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : null;
      if (content) {
        const ext = path.extname(filePath);
        await astParser.init();
        astData = await astParser.parseFile(content, filePath, ext);
        if (!astData.usedFallback) {
          knowledgeGraph.setASTResult(filePath, astData);
        }
      }
    }
    const fileGraph = astCallGraph.getFileCallGraph(filePath);

    res.json({
      status: 'success',
      filePath,
      hasAST: !!astData && !astData.usedFallback,
      ast: astData || null,
      callGraph: fileGraph,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/ast/callers — Qui appelle cette fonction ?
router.get('/ast/callers', async (req: Request, res: Response): Promise<void> => {
  try {
    const fn = typeof req.query.fn === 'string' ? req.query.fn.trim() : '';
    const file = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const className = typeof req.query.class === 'string' ? req.query.class.trim() : undefined;

    if (!fn) {
      res.status(400).json({ error: 'Le paramètre "fn" est requis.' });
      return;
    }
    const callers = await knowledgeGraph.getFunctionCallers(fn, file, className);
    res.json({
      status: 'success',
      functionName: fn,
      filePath: file,
      className,
      count: callers.length,
      callers,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/ast/callees — Que appelle cette fonction ?
router.get('/ast/callees', async (req: Request, res: Response): Promise<void> => {
  try {
    const fn = typeof req.query.fn === 'string' ? req.query.fn.trim() : '';
    const file = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const className = typeof req.query.class === 'string' ? req.query.class.trim() : undefined;

    if (!fn) {
      res.status(400).json({ error: 'Le paramètre "fn" est requis.' });
      return;
    }
    const callees = await knowledgeGraph.getFunctionCallees(fn, file, className);
    res.json({
      status: 'success',
      functionName: fn,
      filePath: file,
      className,
      count: callees.length,
      callees,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/ast/chain — Chaîne d'appels récursive (BFS)
router.get('/ast/chain', async (req: Request, res: Response): Promise<void> => {
  try {
    const fn = typeof req.query.fn === 'string' ? req.query.fn.trim() : '';
    const file = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const className = typeof req.query.class === 'string' ? req.query.class.trim() : undefined;
    const depth = typeof req.query.depth === 'string' ? parseInt(req.query.depth, 10) : 4;

    if (!fn) {
      res.status(400).json({ error: 'Le paramètre "fn" est requis.' });
      return;
    }
    const { astCallGraph } = await import('../../knowledge/index.js');
    const chain = astCallGraph.getCallChain(fn, file, className, depth);
    res.json({
      status: 'success',
      chain,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/knowledge/ast/functions — Recherche et liste de fonctions extraites par AST
router.get('/ast/functions', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const fileFilter = typeof req.query.file === 'string' ? req.query.file.trim().toLowerCase() : '';
    const limit = typeof req.query.limit === 'string' ? Math.min(100, parseInt(req.query.limit, 10)) : 50;

    const allFiles = knowledgeGraph.getAllFiles();
    const results: Array<{
      name: string;
      filePath: string;
      lineStart: number;
      lineEnd?: number;
      signature?: string;
      modifiers?: string[];
      type: string;
    }> = [];

    for (const f of allFiles) {
      if (fileFilter && !f.path.toLowerCase().includes(fileFilter)) continue;
      for (const ent of f.entities) {
        if (!['function', 'method', 'component'].includes(ent.type)) continue;
        if (query && !ent.name.toLowerCase().includes(query) && !f.path.toLowerCase().includes(query)) continue;
        results.push({
          name: ent.name,
          filePath: f.path,
          lineStart: ent.lineStart,
          lineEnd: ent.lineEnd,
          signature: ent.signature,
          modifiers: ent.modifiers,
          type: ent.type,
        });
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    res.json({
      status: 'success',
      count: results.length,
      functions: results,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
