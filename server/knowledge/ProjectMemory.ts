/**
 * ProjectMemory — Mémoire projet persistante
 *
 * Stocke les connaissances accumulées sur le projet :
 * - Architecture (structure, modules, dépendances)
 * - Conventions (nommage, patterns, styles)
 * - Décisions (choix techniques, raisons)
 * - Bugs connus (problèmes récurrents, workarounds)
 * - Patterns (solutions réutilisables)
 * - API (interfaces, endpoints, signatures)
 *
 * La mémoire est persistée dans .project-memory.json et mise à jour
 * automatiquement après chaque mission ou découverte importante.
 *
 * Architecture :
 *   KnowledgeGraph → ProjectMemory (extraction automatique de faits)
 *   Mission/Reflection → ProjectMemory (leçons apprises)
 *   SemanticSearch ← ProjectMemory (contexte enrichi)
 *   UnderstandingEngine ← ProjectMemory (score de compréhension)
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { createLogger } from "../utils/logger.js";
import { knowledgeGraph } from "./KnowledgeGraph.js";
import type {
  ProjectFact,
  ProjectKnowledgeCategory,
  ProjectContext,
} from "./types.js";

const log = createLogger("ProjectMemory");

/** 
 * Chemin du fichier de persistance calculé dynamiquement depuis SELF_ROOT.
 * Stocke les données localement dans le projet actif pour isoler chaque projet.
 */
function getStorePath(): string {
  return path.join(SELF_ROOT, ".project-memory.json");
}

/** Seuil absolu — déclenche élagage si dépassé */
const MAX_FACTS = 500;

/** Seuil d'élagage : remettre ~20% sous le maximum pour éviter de triturer en boucle */
const TARGET_FACTS_AFTER_PRUNE = 400;

/** Âge maximal d'un fait peu utilisé (90 j) avant d'être candidat à l'élagage */
const STALE_FACT_MS = 90 * 24 * 60 * 60 * 1000;

/** Confiance seuil en dessous de laquelle les faits auto-générés sont d'abord élagués */
const LOW_CONFIDENCE = 0.55;

/** Tags indiquant un fait auto-généré (faible valeur sémantique si jamais utilisé) */
const AUTO_GEN_TAGS = new Set(["learning-auto", "auto-todo", "autoextract", "auto-extract"]);

// ─── Index inversé (Fix #2) ──────────────────────────────────────────────────

/**
 * Stop-words FR + EN filtrés lors de la tokenisation.
 * Limités aux mots très fréquents pour ne pas sur-filtrer les termes techniques.
 */
const STOP_WORDS = new Set([
  // FR
  "le","la","les","de","du","des","un","une","en","et","ou","est","il",
  "ce","qui","que","par","sur","au","aux","son","sa","ses","se","ne",
  // EN
  "the","a","an","is","in","of","to","for","with","at","from","this","that",
  "are","was","has","have","it","its","be","as","by","or","not","on","if",
]);

/** Saturation BM25 — k1 */
const BM25_K1 = 1.5;

// ═══════════════════════════════════════════════════════════════════════════════
// ProjectMemory
// ═══════════════════════════════════════════════════════════════════════════════

export class ProjectMemory {
  private facts: Map<string, ProjectFact> = new Map();
  private dirty: boolean = false;
  private lastRootSeen: string = "";

  // ─── Index inversé ──────────────────────────────────────────────────────
  /** token → Map(factId → tf normalisé) */
  private _invertedIndex: Map<string, Map<string, number>> = new Map();
  /** Nombre de faits contenant chaque token (pour IDF) */
  private _docFreq: Map<string, number> = new Map();
  /** true = l'index doit être reconstruit avant la prochaine recherche */
  private _indexDirty: boolean = true;

  constructor() {
    this.load();
    // Purger les faits bruyants hérités des anciennes versions
    this.purgeNoisyFacts();
    if (this.facts.size > MAX_FACTS) {
      this.prune("startup");
    } else {
      this.gcStaleEntries("startup");
    }
  }

  private syncToCurrentWorkspace(): void {
    if (this.lastRootSeen === SELF_ROOT) return;

    this.lastRootSeen = SELF_ROOT;
    this.facts.clear();
    this.dirty = false;
    this._indexDirty = true;

    if (SELF_ROOT) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    try {
      const storePath = getStorePath();
      if (fs.existsSync(storePath)) {
        const raw = fs.readFileSync(storePath, "utf-8");
        const parsed: ProjectFact[] = JSON.parse(raw);
        this.facts = new Map(parsed.map((f) => [f.id, f]));
        log.info(`📂 Mémoire chargée: ${this.facts.size} faits`);
      } else {
        log.info("📂 Aucune mémoire existante — état vide initialisé");
      }
    } catch (err) {
      log.warn(`⚠️ Échec chargement mémoire: ${(err as Error).message} — état vide`);
      this.facts = new Map();
    }
  }

  // ─── Persistance ──────────────────────────────────────────────────────────

  /**
   * Charge la mémoire depuis le disque.
   */
  load(): void {
    this.syncToCurrentWorkspace();
    this.loadFromDisk();
  }

  /**
   * Persiste la mémoire sur le disque si des modifications ont été faites.
   * Utilise une écriture atomique (tmp + rename) pour éviter EBUSY sur Windows.
   */
  save(): void {
    this.syncToCurrentWorkspace();
    if (!this.dirty) return;
    try {
      const storePath = getStorePath();
      const dir = path.dirname(storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const facts = Array.from(this.facts.values());
      const tmpPath = storePath + `.tmp_${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(facts, null, 2), "utf-8");
      fs.renameSync(tmpPath, storePath);
      this.dirty = false;
      log.info(`💾 Mémoire sauvegardée: ${facts.length} faits`);
    } catch (err) {
      log.error(`❌ Échec sauvegarde mémoire: ${(err as Error).message}`);
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Ajoute un nouveau fait en mémoire.
   * Retourne l'ID du fait créé.
   * 
   * Applique un filtre de qualité : rejette les faits trop vagues ou bruyants.
   */
  addFact(fact: Omit<ProjectFact, "id" | "createdAt" | "updatedAt" | "usageCount">): string {
    this.syncToCurrentWorkspace();
    // ─── Filtre qualité (v2) ─────────────────────────────────────────────
    if (this.isLowQualityFact(fact)) {
      log.debug(`🚫 Fait rejeté (qualité insuffisante): ${fact.content.slice(0, 80)}`);
      return ""; // ID vide = rejeté
    }

    // ─── Déduplication par similarité ────────────────────────────────────
    if (this.isDuplicateFact(fact.content, fact.category)) {
      log.debug(`🔁 Fait rejeté (doublon détecté): ${fact.content.slice(0, 80)}`);
      return ""; // ID vide = déjà existant
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const newFact: ProjectFact = {
      id,
      content: fact.content,
      category: fact.category,
      tags: [...new Set(fact.tags || [])],
      sourceFile: fact.sourceFile,
      createdAt: now,
      updatedAt: now,
      confidence: fact.confidence ?? 0.5,
      usageCount: 0,
      isStructural: fact.isStructural,
    };

    this.facts.set(id, newFact);
    this.dirty = true;
    this._indexDirty = true;

    // Sauvegarde automatique si le nombre de faits dépasse le seuil
    if (this.facts.size > MAX_FACTS) {
      this.prune("addFact");
    }

    log.debug(`➕ Fait ajouté: [${fact.category}] ${fact.content.slice(0, 80)}`);
    return id;
  }

  /**
   * Vérifie si un fait est de qualité insuffisante pour être stocké.
   * Critères de rejet :
   *   - Trop court (< 20 chars)
   *   - Contient des patterns bruyants connus (keyword-saliency, hot-module éphémère)
   *   - Ne contient aucune info actionnable (pas de nom de fichier, pas de verbe d'action)
   */
  private isLowQualityFact(fact: Omit<ProjectFact, "id" | "createdAt" | "updatedAt" | "usageCount">): boolean {
    const content = fact.content.trim();
    
    // Trop court
    if (content.length < 20) return true;
    
    // Patterns bruyants connus
    const NOISE_PATTERNS = [
      /vocabulaire saillant pour requête/i,
      /correspondance\(×\d+\)/i,
      /textuelle\(×\d+\)/i,
      /patterns sémantiques dominants/i,
      /concentre \d+ fichiers pertinents pour la requête/i,
    ];
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(content)) return true;
    }
    
    // Tags indiquant du bruit auto-généré
    const noisyTags = new Set(["keyword-saliency", "hot-module"]);
    if (fact.tags?.some(t => noisyTags.has(t))) return true;
    
    return false;
  }

  /**
   * Vérifie si un fait similaire existe déjà (déduplication).
   * Compare les 80 premiers caractères normalisés avec les faits de même catégorie.
   */
  private isDuplicateFact(content: string, category: string): boolean {
    const normalized = content.toLowerCase().trim().slice(0, 80);
    for (const fact of this.facts.values()) {
      if (fact.category !== category) continue;
      const existingNorm = fact.content.toLowerCase().trim().slice(0, 80);
      // Correspondance exacte ou inclusion significative
      if (existingNorm === normalized) return true;
      if (existingNorm.includes(normalized) || normalized.includes(existingNorm)) return true;
    }
    return false;
  }

  /**
   * Récupère un fait par son ID.
   */
  getFact(id: string): ProjectFact | undefined {
    this.syncToCurrentWorkspace();
    const fact = this.facts.get(id);
    if (fact) {
      // Incrémenter le compteur d'usage
      fact.usageCount++;
      this.dirty = true;
    }
    return fact;
  }

  /**
   * Met à jour un fait existant.
   */
  updateFact(id: string, updates: Partial<Omit<ProjectFact, "id" | "createdAt">>): boolean {
    this.syncToCurrentWorkspace();
    const fact = this.facts.get(id);
    if (!fact) return false;

    if (updates.content !== undefined) fact.content = updates.content;
    if (updates.category !== undefined) fact.category = updates.category;
    if (updates.tags !== undefined) fact.tags = [...new Set(updates.tags)];
    if (updates.sourceFile !== undefined) fact.sourceFile = updates.sourceFile;
    if (updates.confidence !== undefined) fact.confidence = updates.confidence;
    if (updates.isStructural !== undefined) fact.isStructural = updates.isStructural;
    fact.updatedAt = new Date().toISOString();

    this.dirty = true;
    this._indexDirty = true;
    log.debug(`🔄 Fait mis à jour: ${id}`);
    return true;
  }

  /**
   * Supprime un fait par son ID.
   */
  deleteFact(id: string): boolean {
    this.syncToCurrentWorkspace();
    const existed = this.facts.delete(id);
    if (existed) {
      this.dirty = true;
      this._indexDirty = true;
      log.debug(`🗑️ Fait supprimé: ${id}`);
    }
    return existed;
  }

  /**
   * Récupère tous les faits, optionnellement filtrés par catégorie.
   */
  getAllFacts(category?: ProjectKnowledgeCategory): ProjectFact[] {
    this.syncToCurrentWorkspace();
    const all = Array.from(this.facts.values());
    if (category) {
      return all.filter((f) => f.category === category);
    }
    return all;
  }

  /**
   * Recherche des faits par contenu textuel via index inversé BM25-like.
   *
   * Remplace l'ancien scan O(n) naïf par une recherche indexée :
   *  - Tokenisation FR+EN normalisée (stop-words filtrés)
   *  - TF avec saturation BM25 (k1=1.5) pour éviter le bourrage de tokens
   *  - IDF approximé (log ratio) pour pénaliser les tokens omniprésents
   *  - Bonus : confiance × log1p(1 + usageCount)
   *  - Expansion de synonymes FR/EN pour rappel amélioré
   *
   * Cas spécial : query vide → retourne tous les faits triés par importance.
   */
  searchFacts(query: string, maxResults: number = 10): ProjectFact[] {
    this.syncToCurrentWorkspace();
    // Cas spécial : query vide (ex: UnderstandingEngine.searchFacts("", 9999))
    if (!query || !query.trim()) {
      return Array.from(this.facts.values())
        .sort((a, b) =>
          (b.confidence * (1 + b.usageCount)) - (a.confidence * (1 + a.usageCount))
        )
        .slice(0, maxResults);
    }

    // Construire l'index si nécessaire
    if (this._indexDirty) {
      this._buildInvertedIndex();
    }

    // Tokeniser la query ET ajouter les synonymes
    const queryTokens = this._tokenize(query);
    const expandedTokens = this._expandWithSynonyms(queryTokens);
    
    if (expandedTokens.length === 0) {
      // Fallback si tous les tokens sont des stop-words
      return this._fallbackSubstringSearch(query, maxResults);
    }

    const totalFacts = this.facts.size;
    const scores = new Map<string, number>(); // factId → score

    // Tokens originaux ont un poids de 1.0, synonymes ajoutés ont un poids de 0.5
    const originalSet = new Set(queryTokens);

    for (const token of expandedTokens) {
      const postings = this._invertedIndex.get(token);
      if (!postings) continue;

      const df = this._docFreq.get(token) ?? postings.size;
      const idf = Math.log((totalFacts - df + 0.5) / (df + 0.5) + 1);
      const synonymWeight = originalSet.has(token) ? 1.0 : 0.5;

      for (const [factId, tf] of postings) {
        const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1);
        const base = tfNorm * idf * synonymWeight;
        scores.set(factId, (scores.get(factId) ?? 0) + base);
      }
    }

    // Bonus de catégorie : si un token de la query matche exactement la catégorie
    for (const token of queryTokens) {
      for (const [factId, fact] of this.facts) {
        if (fact.category === token || fact.category.includes(token)) {
          scores.set(factId, (scores.get(factId) ?? 0) + 0.5);
        }
      }
    }

    // Multiplicateur confiance + usage
    const results: { fact: ProjectFact; score: number }[] = [];
    for (const [factId, baseScore] of scores) {
      const fact = this.facts.get(factId);
      if (!fact) continue;
      const boost = fact.confidence * Math.log1p(1 + fact.usageCount);
      results.push({ fact, score: baseScore * (1 + boost * 0.3) });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults).map((r) => r.fact);
  }

  // ─── Index inversé — méthodes privées ────────────────────────────────────

  /** Table de synonymes FR/EN pour expansion de query */
  private static readonly SYNONYM_GROUPS: string[][] = [
    ["auth", "authentification", "authentication", "login", "connexion"],
    ["error", "erreur", "exception", "failure", "échec"],
    ["handler", "gestionnaire", "controller", "contrôleur", "middleware"],
    ["user", "utilisateur", "account", "compte"],
    ["config", "configuration", "settings", "paramètres"],
    ["test", "spec", "assertion", "vérification"],
    ["route", "endpoint", "api", "chemin"],
    ["component", "composant", "widget"],
    ["search", "recherche", "find", "chercher", "requête"],
    ["create", "créer", "add", "ajouter"],
    ["delete", "supprimer", "remove", "retirer"],
    ["update", "modifier", "edit", "éditer", "change"],
    ["permission", "autorisation", "authorization", "access", "accès"],
    ["cache", "mémoire", "memory", "buffer"],
    ["response", "réponse", "result", "résultat"],
    ["request", "requête", "input", "entrée"],
    ["file", "fichier", "document"],
    ["navigation", "nav", "menu", "sidebar"],
    ["style", "css", "theme", "thème", "design"],
    ["data", "données", "database", "store"],
  ];

  private static _synonymIndex: Map<string, Set<string>> | null = null;

  private static getSynonymIndex(): Map<string, Set<string>> {
    if (!ProjectMemory._synonymIndex) {
      ProjectMemory._synonymIndex = new Map();
      for (const group of ProjectMemory.SYNONYM_GROUPS) {
        const groupSet = new Set(group.map(w => w.toLowerCase()));
        for (const word of group) {
          const key = word.toLowerCase();
          const existing = ProjectMemory._synonymIndex.get(key);
          if (existing) {
            for (const s of groupSet) existing.add(s);
          } else {
            ProjectMemory._synonymIndex.set(key, new Set(groupSet));
          }
        }
      }
    }
    return ProjectMemory._synonymIndex;
  }

  /**
   * Expanse une liste de tokens avec leurs synonymes.
   * Retourne un tableau contenant les tokens originaux + les synonymes.
   */
  private _expandWithSynonyms(tokens: string[]): string[] {
    const expanded = new Set(tokens);
    const index = ProjectMemory.getSynonymIndex();
    
    for (const token of tokens) {
      const synonyms = index.get(token);
      if (synonyms) {
        for (const syn of synonyms) {
          if (!STOP_WORDS.has(syn)) {
            expanded.add(syn);
          }
        }
      }
    }
    
    return Array.from(expanded);
  }

  /**
   * Tokenise un texte en mots normalisés, sans stop-words.
   * Supporte les caractères FR (àâéèêëîïôùûüçæœ) et EN.
   */
  private _tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9àâéèêëîïôùûüçæœ]+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  }

  /**
   * Construit l'index inversé à partir de tous les faits.
   * Complexité : O(n × avg_tokens_per_fact) — typiquement <5ms pour 500 faits.
   */
  private _buildInvertedIndex(): void {
    const startMs = Date.now();
    this._invertedIndex = new Map();
    this._docFreq = new Map();

    for (const [factId, fact] of this.facts) {
      // Indexer : contenu (poids ×3) + tags (poids ×2) + sourceFile (poids ×1)
      const text = [
        fact.content, fact.content, fact.content,   // ×3
        ...fact.tags, ...fact.tags,                 // ×2
        fact.sourceFile ?? "",                     // ×1
      ].join(" ");

      const tokens = this._tokenize(text);
      const termFreq = new Map<string, number>();

      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }

      const totalTokens = tokens.length || 1;
      for (const [token, count] of termFreq) {
        // TF normalisé par longueur du document
        const tf = count / totalTokens;

        if (!this._invertedIndex.has(token)) {
          this._invertedIndex.set(token, new Map());
        }
        this._invertedIndex.get(token)!.set(factId, tf);

        this._docFreq.set(token, (this._docFreq.get(token) ?? 0) + 1);
      }
    }

    this._indexDirty = false;
    log.debug(`🔍 Index inversé reconstruit: ${this._invertedIndex.size} tokens, ${this.facts.size} faits (${Date.now() - startMs}ms)`);
  }

  /**
   * Fallback substring search quand tous les tokens de la query sont des stop-words.
   */
  private _fallbackSubstringSearch(query: string, maxResults: number): ProjectFact[] {
    const lower = query.toLowerCase();
    return Array.from(this.facts.values())
      .filter((f) => f.content.toLowerCase().includes(lower))
      .sort((a, b) => (b.confidence * (1 + b.usageCount)) - (a.confidence * (1 + a.usageCount)))
      .slice(0, maxResults);
  }

  // ─── Extraction automatique depuis KnowledgeGraph ─────────────────────────

  /**
   * Extrait automatiquement des faits **actionnables** depuis le KnowledgeGraph.
   *
   * Extractions incluses (haute valeur sémantique) :
   *   • Cycles de dépendances détectés → category:known-bug
   *   • Fichiers très volumineux (>500 lignes) → category:refactoring
   *   • Fichiers .ts sans fichier .test.ts correspondant → category:todo
   *   • Commentaires // DECISION: et // CONVENTION: → category:decision/convention
   *
   * Extractions SUPPRIMÉES (redondantes / bruit sémantique) :
   *   ✗ "Module: X — N fichiers"           (déjà dans KnowledgeGraph.stats)
   *   ✗ "Export récurrent: X dans N fichiers" (jamais interrogé utilement)
   *   ✗ "Couplage élevé: X dépend de N fichiers" (confidence 0.5, redondant avec DependencyGraph)
   */
  autoExtractFromKnowledgeGraph(): string[] {
    const state = knowledgeGraph.getState();
    if (!state || !state.files) {
      log.warn("⚠️ KnowledgeGraph non disponible pour l'extraction");
      return [];
    }

    const extractedIds: string[] = [];
    const files = Object.values(state.files) as any[];

    // ── 1. Cycles de dépendances ─────────────────────────────────────────
    // Détection DFS simple : trouver les cycles dans le graphe de dépendances
    try {
      const deps = state.dependencies as Record<string, string[]>;
      const visited = new Set<string>();
      const inStack = new Set<string>();

      const detectCycle = (node: string, stack: string[]): string[] | null => {
        if (inStack.has(node)) {
          const cycleStart = stack.indexOf(node);
          return stack.slice(cycleStart).concat(node);
        }
        if (visited.has(node)) return null;
        visited.add(node);
        inStack.add(node);
        stack.push(node);
        for (const dep of (deps[node] ?? [])) {
          // Résoudre le chemin de l'import vers un fichier connu
          const resolved = Object.keys(deps).find(f =>
            f === dep || f.endsWith(`/${path.basename(dep)}`) || f.startsWith(dep)
          );
          if (!resolved) continue;
          const cycle = detectCycle(resolved, stack);
          if (cycle) {
            inStack.delete(node);
            stack.pop();
            return cycle;
          }
        }
        inStack.delete(node);
        stack.pop();
        return null;
      };

      // Limiter la détection aux 200 premiers fichiers pour rester rapide
      const sampleFiles = Object.keys(deps).slice(0, 200);
      const reportedCycles = new Set<string>();

      for (const file of sampleFiles) {
        const cycle = detectCycle(file, []);
        if (cycle && cycle.length >= 2) {
          const signature = [...cycle].sort().join(" → ");
          if (reportedCycles.has(signature)) continue;
          reportedCycles.add(signature);

          const cycleStr = cycle.join(" → ");
          const existing = this.findFactByContent(`Cycle de dépendance: ${cycleStr.slice(0, 60)}`);
          if (!existing) {
            const id = this.addFact({
              content: `Cycle de dépendance détecté: ${cycleStr}`,
              category: "known-bug",
              tags: ["cycle", "dépendance", "architecture"],
              sourceFile: cycle[0],
              confidence: 0.85,
              isStructural: true,
            });
            extractedIds.push(id);
          }
        }
      }
    } catch (err) {
      log.debug(`⚠️ Détection cycles ignorée: ${(err as Error).message}`);
    }

    // ── 2. Fichiers très volumineux (candidats au refactoring) ────────────
    const LARGE_FILE_THRESHOLD = 500; // lignes
    for (const file of files) {
      if ((file.lines ?? 0) > LARGE_FILE_THRESHOLD) {
        const existing = this.findFactByContent(`Fichier très volumineux: ${file.path}`);
        if (!existing) {
          const id = this.addFact({
            content: `Fichier très volumineux: ${file.path} (${file.lines} lignes) — candidat au refactoring`,
            category: "refactoring",
            tags: ["volumineux", "refactoring", file.path],
            sourceFile: file.path,
            confidence: 0.75,
            isStructural: false,
          });
          extractedIds.push(id);
        }
      }
    }

    // ── 3. Fichiers .ts sans tests correspondants ─────────────────────────
    const allPaths = new Set(files.map((f: any) => f.path as string));
    const MAX_MISSING_TESTS = 20; // limiter le bruit
    let missingTestCount = 0;

    for (const file of files) {
      if (missingTestCount >= MAX_MISSING_TESTS) break;
      const p: string = file.path ?? "";
      // Cibler seulement les fichiers .ts non-test non-types dans src/ ou server/
      if (!/\.(ts|tsx)$/.test(p)) continue;
      if (/\.(test|spec|d)\.(ts|tsx)$/.test(p)) continue;
      if (/types?\.ts$/.test(p)) continue;
      if (!/^(src|server)\//.test(p)) continue;

      // Chercher un fichier test correspondant
      const base = p.replace(/\.(ts|tsx)$/, "");
      const hasTest = allPaths.has(`${base}.test.ts`)
        || allPaths.has(`${base}.spec.ts`)
        || allPaths.has(`${base}.test.tsx`);

      if (!hasTest) {
        const existing = this.findFactByContent(`Fichier sans tests: ${p}`);
        if (!existing) {
          const id = this.addFact({
            content: `Fichier sans tests: ${p} — aucun fichier *.test.ts correspondant`,
            category: "todo",
            tags: ["tests", "qualité", p],
            sourceFile: p,
            confidence: 0.65,
            isStructural: false,
          });
          extractedIds.push(id);
          missingTestCount++;
        }
      }
    }

    // ── 4. Décisions et conventions via commentaires annotés ──────────────
    // Lecture directe des fichiers (le KG ne stocke pas le contenu brut)
    const ROOT = state.projectRoot as string;
    for (const file of files) {
      const p: string = file.path ?? "";
      if (!/\.(ts|tsx|js|jsx)$/.test(p)) continue;
      try {
        const absPath = path.join(ROOT, p);
        if (!fs.existsSync(absPath)) continue;
        const content: string = fs.readFileSync(absPath, "utf-8");

        for (const match of content.matchAll(/\/\/\s*DECISION:\s*(.*)/gi)) {
          const text = match[1].trim();
          if (!text) continue;
          const key = `Décision (${p}): ${text.slice(0, 60)}`;
          if (!this.findFactByContent(key)) {
            extractedIds.push(this.addFact({
              content: `Décision (${p}): ${text}`,
              category: "decision",
              tags: ["decision", "comment", p],
              sourceFile: p,
              confidence: 0.70,
              isStructural: true,
            }));
          }
        }

        for (const match of content.matchAll(/\/\/\s*CONVENTION:\s*(.*)/gi)) {
          const text = match[1].trim();
          if (!text) continue;
          const key = `Convention (${p}): ${text.slice(0, 60)}`;
          if (!this.findFactByContent(key)) {
            extractedIds.push(this.addFact({
              content: `Convention (${p}): ${text}`,
              category: "convention",
              tags: ["convention", "comment", p],
              sourceFile: p,
              confidence: 0.70,
              isStructural: true,
            }));
          }
        }
      } catch {
        // Ignorer les erreurs de lecture
      }
    }

    if (extractedIds.length > 0) {
      log.info(`🧠 Auto-extraction: ${extractedIds.length} nouveau(x) fait(s) actionnables depuis KnowledgeGraph`);
      this.save();
    }

    return extractedIds;
  }

  // ─── Contexte pour LLM ────────────────────────────────────────────────────

  /**
   * Génère un contexte projet complet pour une tâche donnée.
   * Rassemble les faits pertinents, l'architecture, les conventions, etc.
   */
  getProjectContext(task: string, relevantFiles: string[] = []): ProjectContext {
    // Rechercher les faits pertinents pour la tâche
    const facts = this.searchFacts(task, 15);

    // Filtrer par catégories
    const architectureFacts = facts.filter((f) => f.category === "architecture");
    const conventionFacts = facts.filter((f) => f.category === "convention");
    const decisionFacts = facts.filter((f) => f.category === "decision");
    const bugFacts = facts.filter((f) => f.category === "known-bug");

    // Générer un résumé d'architecture
    const architectureSummary = this.buildArchitectureSummary(architectureFacts);

    return {
      facts,
      architectureSummary,
      relevantFiles,
      conventions: conventionFacts.map((f) => f.content),
      decisions: decisionFacts.map((f) => f.content),
      knownBugs: bugFacts.map((f) => f.content),
    };
  }

  /**
   * Génère un résumé compact de la mémoire pour injection dans le contexte LLM.
   * Optimisé pour consommer peu de tokens.
   */
  toContextSummary(maxFacts: number = 10): string {
    const lines: string[] = [];
    lines.push("📚 MÉMOIRE PROJET");
    lines.push(`   Total: ${this.facts.size} faits`);

    // Compter par catégorie
    const categoryCount = new Map<ProjectKnowledgeCategory, number>();
    for (const fact of this.facts.values()) {
      categoryCount.set(fact.category, (categoryCount.get(fact.category) || 0) + 1);
    }
    const categorySummary = Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `${cat}:${count}`)
      .join(", ");
    lines.push(`   Catégories: ${categorySummary}`);

    // Faits les plus importants (par confiance × usage)
    const topFacts = Array.from(this.facts.values())
      .sort((a, b) => (b.confidence * (1 + b.usageCount)) - (a.confidence * (1 + a.usageCount)))
      .slice(0, maxFacts);

    if (topFacts.length > 0) {
      lines.push("   Faits clés:");
      for (const fact of topFacts) {
        const content = fact.content.length > 100
          ? fact.content.slice(0, 100) + "..."
          : fact.content;
        lines.push(`     [${fact.category}] ${content} (confiance: ${(fact.confidence * 100).toFixed(0)}%)`);
      }
    }

    return lines.join("\n");
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────

  private importanceScore(fact: ProjectFact, now: number): number {
    const updated = new Date(fact.updatedAt).getTime() || now;
    const ageHours = Math.max(1, (now - updated) / 3_600_000);
    const recency = 1 / Math.log2(1 + ageHours); // decay lisse
    const usage = Math.log1p(fact.usageCount); // usageCount non linéaire
    const confBoost = Math.max(0, (fact.confidence - 0.3) / 0.7); // 0.3 → 0, 1.0 → 1
    return confBoost * 100 + usage * 40 + recency * 60;
  }

  private isAutoGen(fact: ProjectFact): boolean {
    for (const t of fact.tags) if (AUTO_GEN_TAGS.has(t)) return true;
    return false;
  }

  /**
   * Ramasse-miettes : supprime immédiatement les entrées manifestement obsolètes
   * (très vieilles + jamais utilisées + basse confiance).
   */
  gcStaleEntries(_reason: "startup" | "periodic" = "periodic"): number {
    const now = Date.now();
    let removed = 0;
    for (const fact of Array.from(this.facts.values())) {
      // Les faits structurels (décisions, cycles détectés) sont protégés de l'élagage automatique
      if (fact.isStructural) continue;
      const age = now - (new Date(fact.createdAt).getTime() || now);
      if (
        age > STALE_FACT_MS &&
        fact.usageCount === 0 &&
        fact.confidence < LOW_CONFIDENCE &&
        this.isAutoGen(fact)
      ) {
        this.facts.delete(fact.id);
        removed++;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      this._indexDirty = true;
      log.info(`🧹 GC ProjectMemory: ${removed} faits obsolètes retirés`);
    }
    return removed;
  }

  /**
   * Élagage mémoire : ramène le nombre de faits sous TARGET_FACTS_AFTER_PRUNE
   * pour éviter une saturation progressive.
   *
   * Ordre de priorité d'éviction (du premier évincé au dernier) :
   *   1. Faits auto-générés jamais utilisés ET confiance < LOW_CONFIDENCE
   *   2. Faits quelconques classés par score d'importance (confidence + usage + recency)
   */
  prune(reason: "addFact" | "startup" | "manual" = "addFact"): void {
    if (this.facts.size <= MAX_FACTS && reason !== "manual") return;

    const now = Date.now();
    const all = Array.from(this.facts.values());

    const priority1: string[] = [];
    const rest: ProjectFact[] = [];
    for (const f of all) {
      // Protéger les faits structurels contre l'élagage
      if (f.isStructural) { rest.push(f); continue; }
      const age = now - (new Date(f.createdAt).getTime() || now);
      if (this.isAutoGen(f) && f.usageCount === 0 && f.confidence < LOW_CONFIDENCE && age > STALE_FACT_MS / 2) {
        priority1.push(f.id);
      } else {
        rest.push(f);
      }
    }

    const targetCount = Math.min(TARGET_FACTS_AFTER_PRUNE, MAX_FACTS);
    let remainingToRemove = Math.max(0, this.facts.size - targetCount);

    let removed = 0;
    for (const id of priority1) {
      if (remainingToRemove <= 0) break;
      if (this.facts.delete(id)) { removed++; remainingToRemove--; }
    }

    if (remainingToRemove > 0 && rest.length > 0) {
      rest.sort((a, b) => this.importanceScore(a, now) - this.importanceScore(b, now));
      for (let i = 0; i < remainingToRemove && i < rest.length; i++) {
        if (this.facts.delete(rest[i].id)) removed++;
      }
    }

    if (removed > 0) {
      this.dirty = true;
      this._indexDirty = true;
      log.info(`✂️ Élagage mémoire (${reason}): ${removed} faits retirés, ${this.facts.size} restants`);
    }
  }

  /**
   * Réinitialise complètement la mémoire.
   */
  clear(): void {
    this.facts.clear();
    this.dirty = true;
    log.info("🧹 Mémoire réinitialisée");
  }

  /**
   * Purge les faits bruyants hérités des anciennes versions (v1 auto-enrich).
   * Supprime les faits de type "keyword-saliency", "hot-module" éphémères,
   * et tout fait correspondant aux patterns bruyants connus.
   * 
   * Retourne le nombre de faits supprimés.
   */
  purgeNoisyFacts(): number {
    const NOISE_PATTERNS = [
      /vocabulaire saillant pour requête/i,
      /correspondance\(×\d+\)/i,
      /textuelle\(×\d+\)/i,
      /patterns sémantiques dominants/i,
      /concentre \d+ fichiers pertinents pour la requête/i,
    ];
    const NOISY_TAGS = new Set(["keyword-saliency", "hot-module"]);

    let removed = 0;
    for (const [id, fact] of Array.from(this.facts.entries())) {
      let isNoisy = false;
      
      // Vérifier les tags bruyants
      if (fact.tags.some(t => NOISY_TAGS.has(t))) {
        isNoisy = true;
      }
      
      // Vérifier les patterns bruyants dans le contenu
      if (!isNoisy) {
        for (const pattern of NOISE_PATTERNS) {
          if (pattern.test(fact.content)) {
            isNoisy = true;
            break;
          }
        }
      }
      
      if (isNoisy) {
        this.facts.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.dirty = true;
      this._indexDirty = true;
      log.info(`🧹 Purge bruit: ${removed} fait(s) bruyant(s) supprimé(s), ${this.facts.size} restants`);
      this.save();
    }

    return removed;
  }

  /**
   * Retourne le nombre de faits en mémoire.
   */
  get size(): number {
    return this.facts.size;
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  /**
   * Cherche un fait existant par son contenu (correspondance exacte partielle).
   */
  private findFactByContent(content: string): ProjectFact | undefined {
    const normalized = content.toLowerCase().trim();
    for (const fact of this.facts.values()) {
      if (fact.content.toLowerCase().includes(normalized)) {
        return fact;
      }
    }
    return undefined;
  }

  /**
   * Construit un résumé d'architecture à partir des faits d'architecture.
   */
  private buildArchitectureSummary(architectureFacts: ProjectFact[]): string {
    if (architectureFacts.length === 0) {
      return "Aucune information d'architecture disponible.";
    }

    const lines: string[] = ["Architecture du projet:"];
    for (const fact of architectureFacts) {
      lines.push(`- ${fact.content}`);
    }
    return lines.join("\n");
  }

  // ─── Capture automatique de connaissances (Section 3.2) ──────────────────────

  /**
   * Extrait et enregistre automatiquement les décisions d'architecture
   * à partir de commentaires de code ou de documents.
   * Pattern détectés : TODO, FIXME, NOTE, DECISION, ARCHITECTURE, etc.
   */
  captureArchitectureDecision(content: string, sourceFile?: string): string[] {
    const decisions: string[] = [];
    const patterns = [
      // Patterns de décision d'architecture
      /(?:DECISION|DECISIONS|ARCHITECTURE|ARCHITECTURAL\s*DECISION):\s*(.+?)(?:\n\n|\n\*|$)/gi,
      /TODO:\s*(.+?)(?:\n\n|\n\*|$)/gi,
      /FIXME:\s*(.+?)(?:\n\n|\n\*|$)/gi,
      /NOTE:\s*(.+?)(?:\n\n|\n\*|$)/gi,
      /IMPORTANT:\s*(.+?)(?:\n\n|\n\*|$)/gi,
      /RATIONALE:\s*(.+?)(?:\n\n|\n\*|$)/gi,
      /WHY:\s*(.+?)(?:\n\n|\n\*|$)/gi,
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Extraire le contenu après le label
          const colonIndex = match.indexOf(':');
          if (colonIndex > -1) {
            const decisionText = match.slice(colonIndex + 1).trim();
            if (decisionText && decisionText.length > 10) {
              const factId = this.addFact({
                content: `Décision d'architecture: ${decisionText}`,
                category: "decision",
                tags: ["architecture", "auto-captured", sourceFile ? `file:${sourceFile}` : ""],
                sourceFile,
                confidence: 0.7,
                isStructural: false,
              });
              if (factId) decisions.push(factId);
            }
          }
        }
      }
    }

    if (decisions.length > 0) {
      log.info(`🏗️  ${decisions.length} décision(s) d'architecture capturée(s) depuis ${sourceFile || 'contenu'}`);
    }

    return decisions;
  }

  /**
   * Extrait et enregistre automatiquement les conventions de code
   * à partir de l'analyse de fichiers source.
   */
  captureCodeConventions(content: string, sourceFile?: string, language?: string): string[] {
    const conventions: string[] = [];
    const languageHint = language || (sourceFile ? sourceFile.split('.').pop() || 'unknown' : 'unknown');

    // Patterns de conventions par langage
    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /interface\s+(\w+)/g,           // Détection d'interfaces
        /type\s+(\w+)\s*=/g,           // Détection de types
        /export\s+(const|function|class)\s+(\w+)/g, // Export naming
        /@\w+\s+([^\n]+)/g,            // Decorators
      ],
      javascript: [
        /function\s+(\w+)/g,
        /const\s+(\w+)\s*=/g,
        /class\s+(\w+)/g,
      ],
      python: [
        /def\s+(\w+)/g,
        /class\s+(\w+)/g,
        /import\s+(\w+)/g,
      ],
    };

    const langPatterns = patterns[languageHint] || patterns.javascript;

    for (const pattern of langPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          const conventionText = match.trim();
          if (conventionText && conventionText.length > 5) {
            const factId = this.addFact({
              content: `Convention de code (${languageHint}): ${conventionText}`,
              category: "convention",
              tags: ["code-convention", "auto-captured", languageHint, sourceFile ? `file:${sourceFile}` : ""],
              sourceFile,
              confidence: 0.6,
              isStructural: false,
            });
            if (factId) conventions.push(factId);
          }
        }
      }
    }

    // Capturer les patterns de nommage (camelCase, PascalCase, snake_case)
    const namingPatterns = [
      /([A-Z][a-z0-9]+)+/g,  // PascalCase
      /([a-z0-9]+([A-Z][a-z0-9]+)*)/g,  // camelCase
      /([a-z]+(_[a-z]+)+)/g,  // snake_case
    ];

    for (const pattern of namingPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 3) {
        // Plus de 3 occurrences = pattern récurrent
        const factId = this.addFact({
          content: `Pattern de nommage détecté: ${pattern.source} (occurrences: ${matches.length})`,
          category: "pattern",
          tags: ["naming-pattern", "auto-captured", languageHint],
          sourceFile,
          confidence: 0.5,
          isStructural: false,
        });
        if (factId) conventions.push(factId);
      }
    }

    if (conventions.length > 0) {
      log.info(`📝 ${conventions.length} convention(s) de code capturée(s) depuis ${sourceFile || 'contenu'}`);
    }

    return conventions;
  }

  /**
   * Analyse un extrait de code ou un document et capture automatiquement
   * les connaissances pertinentes pour le projet.
   * Cela inclut : décisions, conventions, patterns, API, modules.
   */
  captureFromContent(
    content: string,
    options: {
      sourceFile?: string;
      language?: string;
      autoPersist?: boolean;
    } = {}
  ): { capturedFacts: string[]; decisionCount: number; conventionCount: number } {
    const {
      sourceFile,
      language,
      autoPersist = true,
    } = options;

    const capturedFacts: string[] = [];
    let decisionCount = 0;
    let conventionCount = 0;

    // 1. Capturer les décisions d'architecture
    const decisions = this.captureArchitectureDecision(content, sourceFile);
    decisionCount = decisions.length;
    capturedFacts.push(...decisions);

    // 2. Capturer les conventions de code
    const conventions = this.captureCodeConventions(content, sourceFile, language);
    conventionCount = conventions.length;
    capturedFacts.push(...conventions);

    // 3. Capturer les dépendances/modules importants
    const dependencyPatterns = [
      /import\s+["']([^"']+)["']/g,           // Imports
      /require\(["']([^"']+)["']\)/g,       // Requires
      /from\s+["']([^"']+)["']/g,          // From imports
    ];

    for (const pattern of dependencyPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          const depMatch = match.match(/["']([^"']+)["']/);
          if (depMatch && depMatch[1]) {
            const dependency = depMatch[1];
            // Ignorer les dépendances node_modules standard
            if (!dependency.startsWith('.') && !dependency.includes('/')) {
              const factId = this.addFact({
                content: `Dépendance: ${dependency}`,
                category: "module",
                tags: ["dependency", "auto-captured", language || "", sourceFile ? `file:${sourceFile}` : ""],
                sourceFile,
                confidence: 0.8,
                isStructural: true,
              });
              if (factId) capturedFacts.push(factId);
            }
          }
        }
      }
    }

    // 4. Sauvegarder si autoPersist et qu'il y a eu des captures
    if (autoPersist && capturedFacts.length > 0) {
      this.save();
    }

    return {
      capturedFacts,
      decisionCount,
      conventionCount,
    };
  }

  /**
   * Hook appelé après une analyse de code ou une action significative
   * pour capturer automatiquement les connaissances du projet.
   */
  async autoCaptureFromAnalysis(
    content: string,
    options: {
      sourceFile?: string;
      language?: string;
      analysisType?: 'code' | 'document' | 'interface' | 'architecture';
    } = {}
  ): Promise<{ captured: number; decisions: number; conventions: number }> {
    const { sourceFile, language, analysisType = 'code' } = options;

    const result = this.captureFromContent(content, {
      sourceFile,
      language,
      autoPersist: true,
    });

    log.info(`🤖 Capture automatique depuis ${analysisType}: ${result.capturedFacts.length} faits`);

    return {
      captured: result.capturedFacts.length,
      decisions: result.decisionCount,
      conventions: result.conventionCount,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du ProjectMemory */
export const projectMemory = new ProjectMemory();
