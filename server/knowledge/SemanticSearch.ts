/**
 * SemanticSearch — Recherche sémantique dans le codebase
 *
 * Moteur de recherche intelligent pour le KnowledgeGraph :
 * - Recherche par nom d'entité, chemin de fichier, contenu textuel
 * - Scoring TF-IDF-like pour classer les résultats par pertinence
 * - Extraction de sections pertinentes par fichier (fenêtre de contexte)
 * - Génération de ContextBatch pour injection dans le LLM
 * - Estimation de qualité du contexte trouvé
 *
 * Architecture :
 *   SemanticSearch.searchAll(query)
 *     ├── searchByEntity() → via KnowledgeGraph.searchEntities()
 *     ├── searchByPath()   → via KnowledgeGraph.searchFiles()
 *     └── searchByContent() → TF-IDF sur contenu des fichiers
 *            ↓
 *   extractRelevantSections() → fenêtres de contexte
 *            ↓
 *   generateContextBatch() → ContextBatch pour LLM
 *            ↓
 *   estimateQuality() → metrics de confiance
 */

import { createLogger } from "../utils/logger.js";
import { knowledgeGraph } from "./KnowledgeGraph.js";
import { projectMemory } from "./ProjectMemory.js";
import fs from "fs";
import path from "path";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { isSandboxActive, getSandboxRoot } from "../utils/sandbox.js";
import type {
  RelevantFile,
  RelevantSection,
  CodeEntity,
  ContextBatch,
  ProjectFact,
} from "./types.js";

const log = createLogger("SemanticSearch");

// ─── Configuration ──────────────────────────────────────────────────────────

/** Fenêtre de contexte autour d'une ligne pertinente (nb lignes avant/après) */
const CONTEXT_WINDOW = 5;

/** Nombre maximum de fichiers retournés (Optimisation Leanna #2: RAG Sélectif) */
const MAX_RESULTS = 10;

/** Score minimum pour qu'un fichier soit considéré pertinent (augmenté pour RAG sélectif) */
const MIN_RELEVANCE_THRESHOLD = 0.15;

/** Poids des différents modes de recherche dans le score composite */
const WEIGHTS = {
  entity: 0.35,
  path: 0.25,
  content: 0.4,
} as const;

/** Taille maximale d'un fichier pour l'analyse de contenu (100 KB) */
const MAX_CONTENT_SIZE = 100_000;

// ─── Synonymes FR/EN pour expansion sémantique ──────────────────────────────

/**
 * Table de synonymes bidirectionnels FR/EN pour termes techniques courants.
 * Permet de trouver "authentification" quand on cherche "login" et vice versa.
 */
const SYNONYM_GROUPS: string[][] = [
  // Auth
  ["auth", "authentification", "authentication", "login", "connexion", "signin", "signup"],
  // Errors
  ["error", "erreur", "exception", "failure", "échec", "fail"],
  // Handler
  ["handler", "gestionnaire", "controller", "contrôleur", "middleware"],
  // User
  ["user", "utilisateur", "account", "compte", "profil", "profile"],
  // Data
  ["data", "données", "database", "db", "base de données", "store", "storage"],
  // Config
  ["config", "configuration", "settings", "paramètres", "options", "préférences"],
  // Test
  ["test", "spec", "assertion", "vérification", "validation"],
  // Route
  ["route", "endpoint", "api", "path", "chemin", "url"],
  // Component
  ["component", "composant", "widget", "element", "élément"],
  // Style
  ["style", "css", "theme", "thème", "design", "apparence"],
  // File
  ["file", "fichier", "document", "archive"],
  // Search
  ["search", "recherche", "find", "chercher", "query", "requête"],
  // Create
  ["create", "créer", "add", "ajouter", "new", "nouveau"],
  // Delete
  ["delete", "supprimer", "remove", "retirer", "effacer"],
  // Update
  ["update", "modifier", "edit", "éditer", "change", "changer", "patch"],
  // List
  ["list", "liste", "collection", "array", "tableau"],
  // Send
  ["send", "envoyer", "emit", "émettre", "dispatch", "publish"],
  // Receive
  ["receive", "recevoir", "listen", "écouter", "subscribe"],
  // Navigation
  ["navigation", "nav", "menu", "sidebar", "drawer"],
  // Permission
  ["permission", "autorisation", "authorization", "access", "accès", "role", "rôle"],
  // Cache
  ["cache", "mémoire", "memory", "buffer", "stockage"],
  // Import
  ["import", "require", "dependency", "dépendance"],
  // Response
  ["response", "réponse", "result", "résultat", "output", "sortie"],
  // Request
  ["request", "requête", "input", "entrée", "payload"],
];

/** Index rapide : mot → liste de synonymes */
const _synonymIndex: Map<string, Set<string>> = new Map();

// Construire l'index au chargement du module
for (const group of SYNONYM_GROUPS) {
  const groupSet = new Set(group);
  for (const word of group) {
    const existing = _synonymIndex.get(word.toLowerCase());
    if (existing) {
      for (const s of groupSet) existing.add(s.toLowerCase());
    } else {
      _synonymIndex.set(word.toLowerCase(), new Set(group.map(w => w.toLowerCase())));
    }
  }
}

/**
 * Expanse une query en ajoutant les synonymes des termes reconnus.
 * Ex: "gestion erreurs API" → "gestion erreurs error exception handler API route endpoint"
 */
function expandQueryWithSynonyms(query: string): string {
  const words = query.toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter(w => w.length > 2);
  const expanded = new Set(words);

  for (const word of words) {
    const synonyms = _synonymIndex.get(word);
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }

  return Array.from(expanded).join(" ");
}

/** Minimum doc frequency pour un terme avant qu'il ne soit considéré comme stop-word corpus-wide */
const MIN_DOC_FREQ_RATIO = 0.005; // terme présent dans < 0.5% des fichiers -> signal faible / bruit
const MAX_DOC_FREQ_RATIO = 0.7;   // terme présent dans > 70% des fichiers -> trop commun, poids réduit

// ─── Index inversé TF-IDF ────────────────────────────────────────────────────

interface InvertedIndex {
  version: number;
  builtForActiveRoot: string;
  builtForFilesCount: number;
  builtAtMs: number;
  /** term → Map(filePath → termFrequency within the doc, préalablement normalisée) */
  postings: Map<string, Map<string, number>>;
  /** filePath → Map(term → tf) — vue par document du même index */
  docIndex: Map<string, Map<string, number>>;
  /** filePath → taille (nb tokens) du document */
  docLengths: Map<string, number>;
  /** filePath → contenu tokenizé mis en cache pour accélérer les sections/extracts */
  docContentCache: Map<string, { content: string; size: number; mtimeMs: number }>;
}

let _indexVersion = 0;
let _inverted: InvertedIndex | null = null;

const _kgIndexListener = (() => {
  let installed = false;
  return function ensureInstalled(kg: typeof knowledgeGraph) {
    if (installed) return;
    installed = true;
    try {
      (kg as any).onUpdate?.(() => { _indexVersion++; });
    } catch { /* ignore */ }
  };
})();

function getFileStatSafe(absPath: string): { size: number; mtimeMs: number } | null {
  try {
    const s = fs.statSync(absPath);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/** Construit / rafraîchit paresseusement l'index inversé pour la racine active. */
function ensureInvertedIndex(
  self: SemanticSearch,
  files: Array<{ path: string; name: string }>
): InvertedIndex | null {
  const activeRoot = self.getActiveProjectRoot();
  const kgFilesCount = files.length;

  // Invalidation si: version KG incrémentée OU racine différente OU nb fichiers a varié
  if (
    _inverted &&
    (_inverted.version !== _indexVersion ||
      _inverted.builtForActiveRoot !== activeRoot ||
      _inverted.builtForFilesCount !== kgFilesCount)
  ) {
    _inverted = null;
  }

  if (_inverted) return _inverted;

  const postings = new Map<string, Map<string, number>>();
  const docIndex = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();
  const contentCache = new Map<string, { content: string; size: number; mtimeMs: number }>();

  let filesIndexed = 0;
  for (const file of files) {
    const absPath = path.join(activeRoot, file.path);
    const stat = getFileStatSafe(absPath);
    if (!stat || stat.size > MAX_CONTENT_SIZE) continue;

    let content: string;
    try { content = fs.readFileSync(absPath, "utf-8"); } catch { continue; }
    const lower = content.toLowerCase();
    const tokens = self.tokenize(lower);
    if (tokens.length === 0) continue;

    const tfMap = new Map<string, number>();
    for (const t of tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);
    // Normalisation TF (log + length norm)
    const len = tokens.length;
    for (const [t, rawCount] of tfMap) {
      const tfNorm = Math.log(1 + rawCount) / Math.log(1 + len);
      tfMap.set(t, tfNorm);
      let p = postings.get(t);
      if (!p) { p = new Map<string, number>(); postings.set(t, p); }
      p.set(file.path, tfNorm);
    }
    docIndex.set(file.path, tfMap);
    docLengths.set(file.path, len);
    contentCache.set(file.path, { content, size: stat.size, mtimeMs: stat.mtimeMs });
    filesIndexed++;
  }

  _inverted = {
    version: _indexVersion,
    builtForActiveRoot: activeRoot,
    builtForFilesCount: kgFilesCount,
    builtAtMs: Date.now(),
    postings,
    docIndex,
    docLengths,
    docContentCache: contentCache,
  };
  log.debug(`🔎 Index inversé construit: ${filesIndexed}/${kgFilesCount} fichiers, ${postings.size} termes`);
  return _inverted;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SemanticSearch
// ═══════════════════════════════════════════════════════════════════════════════

export class SemanticSearch {
  private customProjectRoot?: string;

  constructor(projectRoot?: string) {
    this.customProjectRoot = projectRoot;
    try { _kgIndexListener(knowledgeGraph); } catch { /* ignore */ }
  }

  /**
   * Retourne la racine du workspace ACTIF : sandbox si le mode est activé,
   * sinon la racine configurée (SELF_ROOT par défaut).
   */
  getActiveProjectRoot(): string {
    if (isSandboxActive()) {
      return getSandboxRoot();
    }
    return this.customProjectRoot || SELF_ROOT;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recherche par nom d'entité
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Recherche des fichiers par nom d'entité (classe, fonction, interface, etc.).
   * Utilise l'index d'entités du KnowledgeGraph.
   */
  searchByEntity(query: string): RelevantFile[] {
    const _lowerQuery = query.toLowerCase();
    const entities = knowledgeGraph.searchEntities(query);
    const fileMap = new Map<string, { entities: CodeEntity[]; score: number }>();

    for (const entity of entities) {
      const existing = fileMap.get(entity.filePath);
      const score = this.computeEntityMatchScore(entity, _lowerQuery);

      if (existing) {
        existing.entities.push(entity);
        existing.score = Math.max(existing.score, score);
      } else {
        fileMap.set(entity.filePath, { entities: [entity], score });
      }
    }

    // Trier par score décroissant
    const sorted = Array.from(fileMap.entries())
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, MAX_RESULTS);

    return sorted
      .filter(([, data]) => data.score >= MIN_RELEVANCE_THRESHOLD)
      .map(([filePath, data]) => ({
        filePath,
        relevance: data.score,
        reason: this.buildEntityReason(data.entities, _lowerQuery),
        relevantSections: [], // Sections extraites plus tard
      }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recherche par chemin de fichier
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Recherche des fichiers par chemin ou nom de fichier.
   * Utilise la recherche de fichiers du KnowledgeGraph.
   */
  searchByPath(query: string): RelevantFile[] {
    const _lowerQuery = query.toLowerCase();
    const files = knowledgeGraph.searchFiles(query);

    const results: RelevantFile[] = files
      .map((file) => {
        const score = this.computePathMatchScore(file.path, file.name, _lowerQuery);
        return {
          filePath: file.path,
          relevance: score,
          reason: this.buildPathReason(file.path, _lowerQuery),
          relevantSections: [],
        };
      })
      .filter((r) => r.relevance >= MIN_RELEVANCE_THRESHOLD)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_RESULTS);

    return results;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recherche par contenu textuel (TF-IDF-like)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Recherche des fichiers par contenu textuel avec scoring TF-IDF-like.
   * Utilise un index inversé persistant en mémoire, invalidé automatiquement
   * lorsque KnowledgeGraph émet une mise à jour ou que le nb de fichiers change.
   */
  searchByContent(query: string): RelevantFile[] {
    const _lowerQuery = query.toLowerCase();
    const queryTokens = this.tokenize(_lowerQuery);
    if (queryTokens.length === 0) return [];

    const files = knowledgeGraph.getAllFiles();
    const index = ensureInvertedIndex(this, files);

    type Scored = { filePath: string; score: number; content: string };
    const scoredMap = new Map</*filePath*/string, { scoreTerms: number; matched: number; totalQueryTerms: number; bestExactHit: boolean; bestPhraseHit: boolean }>();

    // Si l'index n'a pas pu être construit (corpus vide), fallback sur l'algo linéaire
    if (!index || index.postings.size === 0) {
      const results: Scored[] = [];
      for (const file of files) {
        const content = this.readFileContent(file.path);
        if (!content) continue;
        const tokens = this.tokenize(content.toLowerCase());
        const score = this.computeContentScore(queryTokens, tokens, content, _lowerQuery);
        if (score >= MIN_RELEVANCE_THRESHOLD) results.push({ filePath: file.path, score, content });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, MAX_RESULTS).map((r) => ({
        filePath: r.filePath,
        relevance: r.score,
        reason: this.buildContentReason(r.filePath, _lowerQuery, r.content),
        relevantSections: this.extractRelevantSectionsFromContent(r.content, _lowerQuery),
      }));
    }

    // ── Phase I : récupération des candidats via index inversé ──────────
    const totalDocs = Math.max(1, index.docIndex.size);
    const querySet = new Map<string, number>();
    for (const t of queryTokens) querySet.set(t, (querySet.get(t) || 0) + 1);

    const candidates = new Set<string>();
    const tokenDf = new Map<string, number>();
    for (const [qTok] of querySet) {
      const p = index.postings.get(qTok);
      if (!p) continue;
      tokenDf.set(qTok, p.size);
      for (const f of p.keys()) candidates.add(f);
    }

    // Si trop peu de candidats via overlap token, élargir aux N fichiers les plus "courts"
    // (recherche moins coûteuse) pour garantir un minimum de résultats.
    if (candidates.size < MAX_RESULTS * 2) {
      let i = 0;
      for (const [filePath, _length] of Array.from(index.docLengths.entries()).sort((a, b) => a[1] - b[1])) {
        if (i >= 200) break;
        candidates.add(filePath);
        i++;
      }
    }

    const exactPhrase = _lowerQuery.trim().length >= 4;

    // ── Phase II : scoring des candidats (seulement ceux récupérés) ──
    for (const filePath of candidates) {
      const docTfs = index.docIndex.get(filePath)!;
      const docLen = index.docLengths.get(filePath) || 0;
      if (!docTfs || docLen === 0) continue;

      let scoreTerms = 0;
      let matched = 0;
      for (const [qTok] of querySet) {
        const tf = docTfs.get(qTok);
        if (tf === undefined) continue;
        const df = tokenDf.get(qTok) ?? 1;
        const dfRatio = df / totalDocs;
        // Lissage IDF + bornes pour ignorer les termes trop rares / trop communs
        const idf = dfRatio < MIN_DOC_FREQ_RATIO
          ? 0.1
          : dfRatio > MAX_DOC_FREQ_RATIO
            ? 0.1 + Math.log(1 / MAX_DOC_FREQ_RATIO)
            : Math.log(1 + totalDocs / df);
        scoreTerms += tf * idf;
        matched++;
      }

      // Bonus correspondance exacte (phrase entière) — accéléré via cache contenu
      let exactHit = false, phraseHit = false;
      let cachedContent = index.docContentCache.get(filePath)?.content;
      if (cachedContent) {
        if (exactPhrase && cachedContent.toLowerCase().includes(_lowerQuery)) { phraseHit = true; exactHit = true; }
      } else {
        const content = this.readFileContent(filePath);
        if (content) {
          if (exactPhrase && content.toLowerCase().includes(_lowerQuery)) { phraseHit = true; exactHit = true; }
          cachedContent = content;
        }
      }

      // Normalisation par longueur de requête + pondération
      const queryNorm = Math.max(1, querySet.size);
      const coverage = matched / queryNorm;
      let composite = (scoreTerms / queryNorm) + coverage * 0.3;
      if (exactHit) composite += 0.5;
      else if (phraseHit) composite += 0.25;
      composite = Math.min(composite, 1.0);

      if (composite >= MIN_RELEVANCE_THRESHOLD) {
        const content = cachedContent || this.readFileContent(filePath) || "";
        scoredMap.set(filePath, { scoreTerms: composite, matched, totalQueryTerms: queryNorm, bestExactHit: exactHit, bestPhraseHit: phraseHit });
        if (!_scoredContentPerQueryMap) _scoredContentPerQueryMap = new Map();
        _scoredContentPerQueryMap.set(filePath, content);
      }
    }

    // Phase III : tri final + limiter à MAX_RESULTS
    const sorted = Array.from(scoredMap.entries())
      .sort((a, b) => b[1].scoreTerms - a[1].scoreTerms)
      .slice(0, MAX_RESULTS);

    const out: RelevantFile[] = [];
    for (const [filePath, meta] of sorted) {
      const content = (_scoredContentPerQueryMap?.get(filePath)) || index.docContentCache.get(filePath)?.content || this.readFileContent(filePath) || "";
      out.push({
        filePath,
        relevance: meta.scoreTerms,
        reason: this.buildContentReason(filePath, _lowerQuery, content),
        relevantSections: this.extractRelevantSectionsFromContent(content, _lowerQuery),
      });
    }
    if (_scoredContentPerQueryMap) { _scoredContentPerQueryMap.clear(); _scoredContentPerQueryMap = undefined; }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recherche combinée
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Recherche combinée : entité + chemin + contenu.
   * Fusionne et déduplique les résultats avec un score composite.
   */
  searchAll(query: string): RelevantFile[] {
    log.info(`🔍 Recherche: "${query}"`);

    // Expansion de la query avec des synonymes FR/EN
    const expandedQuery = expandQueryWithSynonyms(query);
    const useExpanded = expandedQuery !== query.toLowerCase();
    if (useExpanded) {
      log.debug(`🔄 Query expansée: "${query}" → "${expandedQuery.slice(0, 100)}…"`);
    }

    // Recherche avec la query originale (prioritaire)
    const entityResults = this.searchByEntity(query);
    const pathResults = this.searchByPath(query);
    const contentResults = this.searchByContent(query);

    // Recherche additionnelle avec la query expansée (boost les résultats)
    let expandedContentResults: RelevantFile[] = [];
    if (useExpanded) {
      expandedContentResults = this.searchByContent(expandedQuery);
    }

    // Fusionner les résultats
    const mergedMap = new Map<string, {
      relevance: number;
      reasons: string[];
      sections: RelevantSection[];
    }>();

    // Helper pour ajouter un résultat
    const addResult = (result: RelevantFile, weight: number) => {
      const existing = mergedMap.get(result.filePath);
      const weightedRelevance = result.relevance * weight;

      if (existing) {
        existing.relevance = Math.max(existing.relevance, weightedRelevance);
        if (result.reason) existing.reasons.push(result.reason);
        // Fusionner les sections (déduplication par ligne)
        for (const section of result.relevantSections) {
          const isDuplicate = existing.sections.some(
            (s) => s.lineStart === section.lineStart && s.lineEnd === section.lineEnd
          );
          if (!isDuplicate) {
            existing.sections.push(section);
          }
        }
      } else {
        mergedMap.set(result.filePath, {
          relevance: weightedRelevance,
          reasons: result.reason ? [result.reason] : [],
          sections: [...result.relevantSections],
        });
      }
    };

    // Ajouter avec poids
    for (const r of entityResults) addResult(r, WEIGHTS.entity);
    for (const r of pathResults) addResult(r, WEIGHTS.path);
    for (const r of contentResults) addResult(r, WEIGHTS.content);

    // Ajouter les résultats de la query expansée avec un poids réduit (50%)
    if (expandedContentResults.length > 0) {
      for (const r of expandedContentResults) addResult(r, WEIGHTS.content * 0.5);
    }

    // Trier par score décroissant
    const merged = Array.from(mergedMap.entries())
      .map(([filePath, data]) => ({
        filePath,
        relevance: Math.min(data.relevance, 1), // Normaliser à [0, 1]
        reason: data.reasons.join(" | "),
        relevantSections: data.sections,
      }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_RESULTS);

    log.info(`✅ ${merged.length} résultat(s) trouvé(s) pour "${query}"`);
    return merged;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Extraction de sections pertinentes
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Extrait les sections pertinentes d'un fichier pour une requête.
   * Retourne des fenêtres de contexte autour des lignes correspondantes.
   */
  extractRelevantSections(filePath: string, query: string): RelevantSection[] {
    const content = this.readFileContent(filePath);
    if (!content) return [];

    return this.extractRelevantSectionsFromContent(content, query.toLowerCase());
  }

  /**
   * Extrait les sections pertinentes d'un contenu textuel.
   * Détecte les lignes correspondantes et crée des fenêtres de contexte.
   */
  extractRelevantSectionsFromContent(
    content: string,
    _lowerQuery: string
  ): RelevantSection[] {
    const lines = content.split(/\r?\n/);
    const queryTokens = this.tokenize(_lowerQuery);
    const sections: RelevantSection[] = [];
    const processedLines = new Set<number>();

    // Analyser chaque ligne
    const lineScores: { lineIndex: number; score: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      const score = this.computeLineRelevance(lineLower, queryTokens, _lowerQuery);
      if (score > 0) {
        lineScores.push({ lineIndex: i, score });
      }
    }

    // Trier par score et garder les meilleures lignes
    const topLines = lineScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // Max 10 sections

    // Créer des fenêtres de contexte autour des lignes pertinentes
    for (const { lineIndex, score } of topLines) {
      if (processedLines.has(lineIndex)) continue;

      // Calculer la fenêtre de contexte
      const start = Math.max(0, lineIndex - CONTEXT_WINDOW);
      const end = Math.min(lines.length - 1, lineIndex + CONTEXT_WINDOW);

      // Vérifier que la fenêtre ne chevauche pas une section existante
      let overlap = false;
      for (const section of sections) {
        if (start <= section.lineEnd && end >= section.lineStart) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      // Marquer les lignes comme traitées
      for (let j = start; j <= end; j++) {
        processedLines.add(j);
      }

      // Extraire le contenu de la fenêtre
      const sectionLines = lines.slice(start, end + 1);
      const sectionContent = sectionLines.join("\n");

      sections.push({
        lineStart: start + 1, // 1-based
        lineEnd: end + 1,
        content: sectionContent,
        relevance: score,
      });
    }

    // Trier par position dans le fichier
    sections.sort((a, b) => a.lineStart - b.lineStart);

    return sections;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Génération de ContextBatch pour LLM
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Génère un ContextBatch complet pour une requête donnée.
   * Combine les résultats de recherche avec les faits mémoire pertinents.
   */
  generateContextBatch(query: string, primaryFile?: string): ContextBatch {
    log.info(`📦 Génération ContextBatch pour: "${query}"`);

    // 1. Rechercher les fichiers pertinents
    const files = this.searchAll(query);

    // 2. Enrichir avec les sections pertinentes (si pas déjà faites)
    for (const file of files) {
      if (file.relevantSections.length === 0) {
        file.relevantSections = this.extractRelevantSections(file.filePath, query);
      }
    }

    // 3. Récupérer les faits mémoire pertinents
    const facts = projectMemory.searchFacts(query, 10);

    // 4. Estimer la qualité du contexte
    const quality = this.estimateQuality(files, facts);

    const batch: ContextBatch = {
      query,
      files,
      facts,
      primaryFile,
      quality,
    };

    log.info(`✅ ContextBatch généré: ${files.length} fichiers, ${facts.length} faits, suffisant: ${quality.sufficient}`);
    return batch;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Estimation de qualité du contexte
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Estime la qualité du contexte trouvé pour une requête.
   * Évalue si le contexte est suffisant pour répondre à la question.
   */
  estimateQuality(
    files: RelevantFile[],
    facts: ProjectFact[]
  ): { totalFiles: number; averageConfidence: number; sufficient: boolean } {
    const totalFiles = files.length;

    // Calculer la confiance moyenne
    let totalConfidence = 0;
    for (const file of files) {
      totalConfidence += file.relevance;
    }
    // Ajouter la confiance des faits (max 1 par fait)
    for (const fact of facts) {
      totalConfidence += fact.confidence * 0.5; // Poids moindre pour les faits
    }

    const averageConfidence = totalFiles + facts.length > 0
      ? Math.min(totalConfidence / (totalFiles + facts.length * 0.5), 1)
      : 0;

    // Déterminer si le contexte est suffisant
    const sufficient = totalFiles >= 1 && averageConfidence >= 0.3;

    return {
      totalFiles,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      sufficient,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Méthodes privées — Scoring
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Calcule le score de correspondance entre une entité et la requête.
   */
  private computeEntityMatchScore(entity: CodeEntity, _lowerQuery: string): number {
    let score = 0;
    const nameLower = entity.name.toLowerCase();

    // Correspondance exacte
    if (nameLower === _lowerQuery) {
      score = 1.0;
    }
    // Correspondance partielle (le nom contient la requête)
    else if (nameLower.includes(_lowerQuery)) {
      score = 0.8;
    }
    // La requête contient le nom
    else if (_lowerQuery.includes(nameLower)) {
      score = 0.6;
    }
    // Correspondance de mots individuels
    else {
      const queryWords = _lowerQuery.split(/[\s_-]+/);
      const nameWords = nameLower.split(/[\s_-]+/);
      const matchCount = queryWords.filter((w) => nameWords.includes(w)).length;
      if (matchCount > 0) {
        score = 0.3 + (matchCount / queryWords.length) * 0.4;
      }
    }

    // Bonus pour les types spécifiques
    if (entity.type === "class" || entity.type === "interface") {
      score += 0.1;
    }
    if (entity.type === "function" || entity.type === "method") {
      score += 0.05;
    }

    return Math.min(score, 1);
  }

  /**
   * Calcule le score de correspondance entre le chemin/nom du fichier et la requête.
   */
  private computePathMatchScore(filePath: string, fileName: string, _lowerQuery: string): number {
    let score = 0;
    const pathLower = filePath.toLowerCase();
    const nameLower = fileName.toLowerCase();

    // Correspondance exacte du nom de fichier
    if (nameLower === _lowerQuery) {
      score = 1.0;
    }
    // Le nom de fichier contient la requête
    else if (nameLower.includes(_lowerQuery)) {
      score = 0.8;
    }
    // Le chemin contient la requête
    else if (pathLower.includes(_lowerQuery)) {
      score = 0.6;
    }
    // Correspondance de mots dans le chemin
    else {
      const queryWords = _lowerQuery.split(/[\s/\\_.-]+/);
      const pathWords = pathLower.split(/[/\\_.-]+/);
      const matchCount = queryWords.filter((w) => pathWords.includes(w)).length;
      if (matchCount > 0) {
        score = 0.2 + (matchCount / queryWords.length) * 0.5;
      }
    }

    return Math.min(score, 1);
  }

  /**
   * Calcule le score de contenu TF-IDF-like entre une requête et un fichier.
   */
  private computeContentScore(
    queryTokens: string[],
    fileTokens: string[],
    content: string,
    _lowerQuery: string
  ): number {
    if (fileTokens.length === 0 || queryTokens.length === 0) return 0;

    let score = 0;

    // 1. Présence de la requête exacte dans le contenu
    if (content.toLowerCase().includes(_lowerQuery)) {
      score += 0.5;
    }

    // 2. TF-IDF-like scoring
    for (const term of queryTokens) {
      const tf = this.computeTF(term, fileTokens);
      score += tf;
    }

    // 3. Normaliser par la longueur de la requête
    score = score / queryTokens.length;

    // 4. Bonus pour les fichiers avec beaucoup de correspondances
    const uniqueMatches = queryTokens.filter((t) => fileTokens.includes(t)).length;
    const coverage = uniqueMatches / queryTokens.length;
    score += coverage * 0.3;

    return Math.min(score, 1);
  }

  /**
   * Calcule la pertinence d'une ligne individuelle par rapport à la requête.
   */
  private computeLineRelevance(
    lineLower: string,
    queryTokens: string[],
    _lowerQuery: string
  ): number {
    let score = 0;

    // Correspondance exacte de la requête dans la ligne
    if (lineLower.includes(_lowerQuery)) {
      score += 0.8;
    }

    // Compter les tokens de la requête présents dans la ligne
    const matchingTokens = queryTokens.filter((t) => lineLower.includes(t));
    if (matchingTokens.length > 0) {
      score += (matchingTokens.length / queryTokens.length) * 0.4;
    }

    // Bonus pour les lignes de code (signatures, définitions)
    if (/^(export|import|const|let|var|function|class|interface|type)\s/.test(lineLower.trim())) {
      score += 0.2;
    }

    // Bonus pour les commentaires contenant la requête
    if (/\/\/|#|<!--|\/\*/.test(lineLower) && lineLower.includes(_lowerQuery)) {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Méthodes privées — TF-IDF Helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Tokenize un texte en mots clés.
   * Sépare sur les non-alphanumériques, filtre les mots vides courts.
   */
  tokenize(text: string): string[] {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
      "been", "being", "have", "has", "had", "do", "does", "did", "will",
      "would", "could", "should", "may", "might", "shall", "can", "need",
      "this", "that", "these", "those", "it", "its", "they", "them", "their",
      "le", "la", "les", "de", "du", "des", "un", "une", "et", "ou", "mais",
      "dans", "sur", "avec", "pour", "par", "est", "sont", "ce", "cet",
    ]);

    return text
      .replace(/[^a-z0-9_äöüéèêëàâùûôîï]/gi, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !stopWords.has(t.toLowerCase()));
  }

  /**
   * Calcule la Term Frequency (TF) d'un terme dans un ensemble de tokens.
   */
  private computeTF(term: string, tokens: string[]): number {
    if (tokens.length === 0) return 0;
    const count = tokens.filter((t) => t === term).length;
    return Math.log(1 + count) / Math.log(1 + tokens.length);
  }

  /**
   * Calcule l'Inverse Document Frequency (IDF) d'un terme dans le corpus.
   */
  // NOTE: computeIDF kept for future TF-IDF scoring implementation
  public computeIDF(term: string, allTokens: string[][]): number {
    const totalDocs = allTokens.length;
    if (totalDocs === 0) return 0;

    const docsWithTerm = allTokens.filter((tokens) => tokens.includes(term)).length;
    if (docsWithTerm === 0) return 0;

    return Math.log(totalDocs / docsWithTerm);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Méthodes privées — Reasons builders
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Construit une explication textuelle pour un résultat par entité.
   */
  private buildEntityReason(entities: CodeEntity[], _lowerQuery: string): string {
    const types = new Set(entities.map((e) => e.type));
    const names = entities.map((e) => e.name).slice(0, 3);
    const typeList = Array.from(types).join(", ");
    const nameList = names.join(", ");
    return `Contient ${typeList}: ${nameList}`;
  }

  /**
   * Construit une explication textuelle pour un résultat par chemin.
   */
  private buildPathReason(filePath: string, _lowerQuery: string): string {
    return `Chemin correspondant: "${filePath}"`;
  }

  /**
   * Construit une explication textuelle pour un résultat par contenu.
   */
  private buildContentReason(_filePath: string, _lowerQuery: string, content: string): string {
    // Trouver des lignes pertinentes pour la raison
    const lines = content.split(/\r?\n/);
    const matchingLines = lines.filter((l) => l.toLowerCase().includes(_lowerQuery));
    const excerpt = matchingLines
      .slice(0, 2)
      .map((l) => l.trim().slice(0, 80))
      .join("; ");
    return excerpt ? `Contient: "${excerpt}"` : `Correspondance textuelle`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Méthodes privées — File I/O
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lit le contenu d'un fichier depuis le disque.
   * Retourne null si le fichier est trop volumineux ou illisible.
   */
  private readFileContent(relativePath: string): string | null {
    const absolutePath = path.join(this.getActiveProjectRoot(), relativePath);

    try {
      // Vérifier l'existence et la taille
      if (!fs.existsSync(absolutePath)) return null;
      const stats = fs.statSync(absolutePath);
      if (stats.size > MAX_CONTENT_SIZE) return null;

      return fs.readFileSync(absolutePath, "utf-8");
    } catch {
      return null;
    }
  }
}

// Stockage temporaire pendant une seule requête (searchByContent)
let _scoredContentPerQueryMap: Map<string, string> | undefined = undefined;

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du SemanticSearch */
export const semanticSearch = new SemanticSearch();
