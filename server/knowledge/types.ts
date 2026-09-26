/**
 * Types du Knowledge System — Compréhension avancée du projet
 *
 * Définit les structures de données pour :
 * - ProjectIndexer : scan des fichiers et extraction d'entités
 * - KnowledgeGraph : graphe permanent des connaissances du projet
 * - ProjectMemory : mémoire projet persistante
 * - SemanticSearch : recherche sémantique dans le codebase
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Types ProjectIndexer
// ═══════════════════════════════════════════════════════════════════════════════

/** Types d'entités de code que l'indexeur peut extraire */
export type CodeEntityType =
  | "class"
  | "function"
  | "interface"
  | "enum"
  | "type"
  | "constant"
  | "variable"
  | "component"
  | "method"
  | "import"
  | "export"
  | "route"           // API endpoint (GET /api/users)
  | "db_table"        // Database table reference
  | "env_var"         // Environment variable usage
  | "test"            // Test case (describe/it/test)
  | "symbol";         // Exported symbol (function call target)

/** Une entité de code extraite d'un fichier */
export interface CodeEntity {
  /** Nom de l'entité */
  name: string;
  /** Type d'entité */
  type: CodeEntityType;
  /** Chemin du fichier (relatif à la racine du projet) */
  filePath: string;
  /** Ligne de début (1-based) */
  lineStart: number;
  /** Ligne de fin (1-based, optionnel) */
  lineEnd?: number;
  /** Signature complète (premiers 200 chars) */
  signature?: string;
  /** Modificateurs : 'export', 'default', 'async', 'abstract', etc. */
  modifiers?: string[];
  /** Description JSDoc si trouvée */
  description?: string;
  /** Dépendances : imports externes ou chemins de fichiers */
  dependencies?: string[];
  /** Métadonnées supplémentaires (HTTP method, table name, env var value, etc.) */
  metadata?: Record<string, any>;
}

/** Un fichier indexé dans le projet */
export interface FileNode {
  /** Chemin relatif depuis la racine du projet */
  path: string;
  /** Nom du fichier */
  name: string;
  /** Extension */
  extension: string;
  /** Taille en octets */
  size: number;
  /** Nombre de lignes */
  lines: number;
  /** Date de dernière modification */
  lastModified: string;
  /** Entités de code contenues dans ce fichier */
  entities: CodeEntity[];
  /** Imports du fichier (chemins résolus) */
  imports: string[];
  /** Exports du fichier (noms exportés) */
  exports: string[];
  /** Langage détecté */
  language: "typescript" | "javascript" | "json" | "markdown" | "css" | "html" | "other";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types KnowledgeGraph
// ═══════════════════════════════════════════════════════════════════════════════

/** Types de relations sémantiques entre entités */
export type EntityRelationType =
  | "extends"       // Classe hérite d'une autre
  | "implements"    // Classe implémente une interface
  | "uses"          // Fonction/méthode appelle une autre entité
  | "tests"         // Fichier test vérifie un fichier source
  | "configures"    // Fichier config affecte un module
  | "composes"      // Composant utilise un autre composant
  | "depends_on"    // Dépendance import (file-level)
  | "calls"         // Fonction appelle une autre fonction
  | "serves"        // Fichier sert une route API
  | "reads_env"     // Fichier lit une variable d'environnement
  | "writes_table"  // Code écrit dans une table DB
  | "reads_table"   // Code lit depuis une table DB
  | "tested_by";    // Entité est testée par un fichier de test

/** Une relation sémantique entre deux entités du graphe */
export interface EntityRelation {
  /** Entité source (qui hérite, utilise, teste...) */
  source: {
    name: string;
    filePath: string;
    type: CodeEntityType;
  };
  /** Entité cible (qui est héritée, utilisée, testée...) */
  target: {
    name: string;
    filePath: string;
    type: CodeEntityType;
  };
  /** Type de relation */
  relationType: EntityRelationType;
  /** Confiance dans cette relation (0-1) */
  confidence: number;
  /** Ligne dans le fichier source où la relation est déclarée */
  sourceLine?: number;
}

/** État global du KnowledgeGraph */
export interface KnowledgeGraphState {
  /** Racine du projet */
  projectRoot: string;
  /** Tous les fichiers indexés, indexés par chemin relatif */
  files: Record<string, FileNode>;
  /** Index des entités : nom → liste d'entités (une même classe peut être définie et importée) */
  entities: Record<string, CodeEntity[]>;
  /** Dépendances entre fichiers : fichier → [fichiers dont il dépend] */
  dependencies: Record<string, string[]>;
  /** Dépendances inverses : fichier → [fichiers qui en dépendent] */
  dependents: Record<string, string[]>;
  /** Relations sémantiques entre entités */
  relations: EntityRelation[];
  /** Date du dernier indexage */
  lastIndexed: string;
  /** Statistiques */
  stats: KnowledgeStats;
}

/** Statistiques du KnowledgeGraph */
export interface KnowledgeStats {
  totalFiles: number;
  totalLines: number;
  totalEntities: number;
  totalExports: number;
  totalImports: number;
  averageFileSize: number;
  filesByExtension: Record<string, number>;
  entitiesByType: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types DependencyGraph
// ═══════════════════════════════════════════════════════════════════════════════

/** Un cycle de dépendance détecté */
export interface DependencyCycle {
  /** Les fichiers impliqués dans le cycle (ordre du cycle) */
  files: string[];
  /** Taille du cycle */
  length: number;
}

/** Rapport d'impact d'une modification */
export interface ImpactReport {
  /** Fichier modifié */
  filePath: string;
  /** Fichiers directement impactés (dépendants directs) */
  directImpacts: string[];
  /** Fichiers indirectement impactés (dépendants des dépendants) */
  indirectImpacts: string[];
  /** Score de risque (0-100) */
  riskScore: number;
  /** Nombre total de fichiers impactés */
  totalImpacted: number;
  /** Cycles potentiellement cassés */
  affectedCycles: DependencyCycle[];
  /** Modules critiques impactés */
  criticalModulesAffected: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types ProjectMemory
// ═══════════════════════════════════════════════════════════════════════════════

/** Catégories de connaissances projet */
export type ProjectKnowledgeCategory =
  | "architecture"
  | "convention"
  | "pattern"
  | "decision"
  | "known-bug"
  | "api"
  | "module"
  | "workflow"
  | "security"
  | "stack"
  | "refactoring"
  | "todo";

/** Un fait de connaissance projet */
export interface ProjectFact {
  id: string;
  content: string;
  category: ProjectKnowledgeCategory;
  tags: string[];
  /** Source : fichier qui a inspiré ce fait */
  sourceFile?: string;
  /** Date de création */
  createdAt: string;
  /** Date de dernière mise à jour */
  updatedAt: string;
  /** Confiance (0-1) */
  confidence: number;
  /** Nombre de fois que ce fait a été utilisé */
  usageCount: number;
  /** Métadonnées contextuelles (agent, tâche, etc.) */
  metadata?: Record<string, any>;
  /**
   * Fait structurel = stable dans le temps (cycles de dépendances, décisions, conventions).
   * Protège ce fait contre l'élagage agressif du GC même s'il est peu utilisé.
   */
  isStructural?: boolean;
}


/** Résultat de contexte pour une tâche */
export interface ProjectContext {
  facts: ProjectFact[];
  architectureSummary: string;
  relevantFiles: string[];
  conventions: string[];
  decisions: string[];
  knownBugs: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types SemanticSearch
// ═══════════════════════════════════════════════════════════════════════════════

/** Résultat de recherche sémantique */
export interface RelevantFile {
  /** Chemin du fichier */
  filePath: string;
  /** Score de pertinence (0-1) */
  relevance: number;
  /** Raison de la pertinence */
  reason: string;
  /** Sections extraites les plus pertinentes */
  relevantSections: RelevantSection[];
}

/** Section pertinente extraite d'un fichier */
export interface RelevantSection {
  /** Ligne de début */
  lineStart: number;
  /** Ligne de fin */
  lineEnd: number;
  /** Contenu extrait */
  content: string;
  /** Score de pertinence de cette section */
  relevance: number;
}

/** Contexte complet pour le raisonnement */
export interface ContextBatch {
  /** Question originale */
  query: string;
  /** Fichiers pertinents trouvés */
  files: RelevantFile[];
  /** Fait mémoire pertinents */
  facts: ProjectFact[];
  /** Fichier d'entrée principal (si spécifié) */
  primaryFile?: string;
  /** Informations sur la qualité du contexte */
  quality: {
    /** Nombre total de fichiers trouvés */
    totalFiles: number;
    /** Score de confiance moyen */
    averageConfidence: number;
    /** Si assez de contexte a été trouvé */
    sufficient: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types ReasoningPipeline
// ═══════════════════════════════════════════════════════════════════════════════

/** Étapes du pipeline de raisonnement */
export type ReasoningStep =
  | "understanding"
  | "search"
  | "context"
  | "reasoning"
  | "self_critique"
  | "final";

/** Résultat d'une étape du pipeline */
export interface StepResult {
  step: ReasoningStep;
  input: string;
  output: string;
  durationMs: number;
  confidence: number;
}

/** Contexte d'exécution du pipeline */
export interface PipelineContext {
  /** Mode de raisonnement */
  mode: "fast" | "balanced" | "deep";
  /** Tâche ou question utilisateur */
  task: string;
  /** Fichiers déjà lus (contexte existant) */
  existingContext: string[];
  /** Actions déjà effectuées */
  history: string[];
}

/** Résultat final du pipeline */
export interface ReasoningResult {
  /** Réponse finale */
  answer: string;
  /** Résultats de chaque étape */
  steps: StepResult[];
  /** Confiance globale */
  confidence: number;
  /** Durée totale */
  totalDurationMs: number;
  /** Suggestions d'actions suivantes */
  suggestions: string[];
  /** Si une vérification est recommandée */
  requiresVerification: boolean;
  /** Métriques tokens */
  tokensUsed: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types UnderstandingEngine
// ═══════════════════════════════════════════════════════════════════════════════

/** Score de compréhension */
export interface UnderstandingScore {
  /** Score de contexte trouvé (0-100) */
  contextFound: number;
  /** Score de relations entre fichiers (0-100) */
  relations: number;
  /** Score de confiance globale (0-100) */
  confidence: number;
  /** Niveau de risque estimé */
  risk: "low" | "medium" | "high";
  /** Actions manquantes */
  missingActions: string[];
  /** Fichiers non lus qui pourraient être pertinents */
  unreadFiles: string[];
  /** Vérifications recommandées */
  recommendedChecks: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types LearningEngine
// ═══════════════════════════════════════════════════════════════════════════════

/** Leçon apprise après une mission */
export interface Lesson {
  /** Type de leçon */
  type: "error_pattern" | "success_pattern" | "optimization" | "decision";
  /** Description de la leçon */
  description: string;
  /** Action recommandée pour le futur */
  recommendation: string;
  /** Fichier concerné */
  filePath?: string;
  /** Mission concernée */
  missionId: string;
  /** Timestamp */
  timestamp: string;
  /** Score d'importance (0-1) */
  importance: number;
}

/** Résultat d'apprentissage d'une mission */
export interface LearningResult {
  /** Leçons extraites */
  lessons: Lesson[];
  /** Améliorations appliquées */
  improvementsApplied: string[];
  /** Propositions à valider par une politique ou un humain avant application. */
  candidateImprovements?: Array<{
    id: string;
    kind: string;
    label: string;
    rationale: string;
    autoApplicable: boolean;
  }>;
  /** Fichiers modifiés pendant l'apprentissage */
  filesModified: string[];
  /** Résumé */
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Schemas Zod
// ═══════════════════════════════════════════════════════════════════════════════

export const codeEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["class", "function", "interface", "enum", "type", "constant", "variable", "component", "method", "import", "export", "route", "db_table", "env_var", "test", "symbol"]),
  filePath: z.string().min(1),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().positive().optional(),
  signature: z.string().optional(),
  modifiers: z.array(z.string()).optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  /** Métadonnées supplémentaires (HTTP method pour routes, table name pour DB, etc.) */
  metadata: z.record(z.any()).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Types AST (Tree-sitter) — non persistés, reconstruits au démarrage
// ═══════════════════════════════════════════════════════════════════════════════

/** Paramètre typé extrait de l'AST */
export interface ASTParam {
  /** Nom du paramètre */
  name: string;
  /** Type TypeScript si présent (ex: "string", "Options | null") */
  type?: string;
  /** Paramètre optionnel (? ou avec valeur par défaut) */
  optional: boolean;
}

/** Fonction ou méthode extraite par l'AST */
export interface ASTFunction {
  /** Nom de la fonction/méthode */
  name: string;
  /** Chemin du fichier (relatif) */
  filePath: string;
  /** Ligne de début (1-based) */
  lineStart: number;
  /** Ligne de fin (1-based) */
  lineEnd: number;
  /** Paramètres avec types */
  params: ASTParam[];
  /** Type de retour TypeScript si annoté */
  returnType?: string;
  /** Fonction async */
  isAsync: boolean;
  /** Exportée du module */
  isExported: boolean;
  /** Méthode d'une classe */
  isMethod: boolean;
  /** Nom de la classe parente (si méthode) */
  className?: string;
  /** Fonction fléchée assignée à une variable */
  isArrow: boolean;
}

/** Classe extraite par l'AST */
export interface ASTClass {
  /** Nom de la classe */
  name: string;
  /** Chemin du fichier */
  filePath: string;
  /** Ligne de début */
  lineStart: number;
  /** Ligne de fin */
  lineEnd: number;
  /** Classe parente (extends) */
  superClass?: string;
  /** Interfaces implémentées */
  interfaces: string[];
  /** Méthodes membres */
  methods: ASTFunction[];
  /** Exportée */
  isExported: boolean;
}

/** Appel de fonction extrait par l'AST */
export interface ASTCall {
  /** Nom de la fonction appelante (contexte englobant) */
  callerFunction: string;
  /** Nom de la classe appelante (si méthode) */
  callerClass?: string;
  /** Nom de la fonction/méthode appelée */
  callee: string;
  /** Objet sur lequel elle est appelée (ex: "this", "kg", "fs") */
  calleeObject?: string;
  /** Ligne dans le fichier source */
  lineNumber: number;
  /** Appelé avec await */
  isAwait: boolean;
  /** Appel de méthode enchaîné (ex: a.b().c()) */
  isChained: boolean;
}

/** Résultat AST complet d'un fichier */
export interface ASTFileResult {
  /** Langage analysé */
  language: "typescript" | "javascript" | "tsx" | "jsx";
  /** Chemin du fichier */
  filePath: string;
  /** Fonctions et méthodes extraites */
  functions: ASTFunction[];
  /** Classes extraites */
  classes: ASTClass[];
  /** Appels de fonctions détectés */
  calls: ASTCall[];
  /** Temps de parsing (ms) */
  parseTimeMs: number;
  /**
   * true si Tree-sitter était indisponible et les résultats proviennent
   * du fallback regex (moins précis).
   */
  usedFallback: boolean;
}

export const knowledgeGraphSchema = z.object({
  projectRoot: z.string(),
  files: z.record(z.any()),
  entities: z.record(z.array(codeEntitySchema)),
  dependencies: z.record(z.array(z.string())),
  dependents: z.record(z.array(z.string())),
  relations: z.array(z.any()).default([]),
  lastIndexed: z.string(),
  stats: z.object({
    totalFiles: z.number(),
    totalLines: z.number(),
    totalEntities: z.number(),
    totalExports: z.number(),
    totalImports: z.number(),
    averageFileSize: z.number(),
    filesByExtension: z.record(z.number()),
    entitiesByType: z.record(z.number()),
  }),
});
