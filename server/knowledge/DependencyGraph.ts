/**
 * DependencyGraph — Graphe orienté des dépendances entre fichiers
 *
 * Construit un graphe orienté complet à partir du KnowledgeGraph :
 * - Dépendances directes (fichier → fichiers qu'il importe)
 * - Dépendances inverses (fichier → fichiers qui l'importent)
 * - Chaînes d'impact (propagation transitive)
 * - Détection de cycles de dépendance
 * - Score de couplage entre fichiers
 *
 * Architecture :
 *   KnowledgeGraph ← ProjectIndexer
 *        ↓
 *   DependencyGraph — construit son graphe à partir des dépendances du KnowledgeGraph
 *        ↓
 *   ImpactAnalyzer — utilise DependencyGraph pour ses analyses
 *   PlanningEngine — utilise DependencyGraph pour ordonnancer les modifications
 *
 * Usage typique :
 *   const depGraph = new DependencyGraph(knowledgeGraph);
 *   const impact = depGraph.getImpactChain("server/agents/PromptBuilder.ts");
 *   // → ["server/agents/AgentExecutor.ts", "server/agents/AgentOrchestrator.ts"]
 *   const cycles = depGraph.detectCycles();
 *   // → [{ files: ["a.ts", "b.ts", "c.ts"], length: 3 }]
 */

import { createLogger } from "../utils/logger.js";
import { knowledgeGraph, KnowledgeGraph } from "./KnowledgeGraph.js";
import type { DependencyCycle } from "./types.js";

const log = createLogger("DependencyGraph");

// ═══════════════════════════════════════════════════════════════════════════════
// DependencyGraph
// ═══════════════════════════════════════════════════════════════════════════════

export class DependencyGraph {
  private kg: KnowledgeGraph;
  private impactCache: Map<string, { result: string[]; timestamp: number }> = new Map();
  private cycleCache: { result: DependencyCycle[]; timestamp: number } | null = null;

  /** Durée de validité du cache (30 secondes) */
  private static readonly CACHE_TTL = 30_000;

  private unsubscribeKg?: () => void;

  constructor(kg: KnowledgeGraph = knowledgeGraph) {
    this.kg = kg;
    this.unsubscribeKg = kg.onUpdate(() => this.invalidateCache());
  }

  // ─── Interface publique ───────────────────────────────────────────────────

  /**
   * Retourne la chaîne d'impact complète pour un fichier.
   * Si je modifie ce fichier, quels autres fichiers sont impactés ?
   * Impact = dépendants directs + dépendants indirects (transitif).
   */
  getImpactChain(filePath: string): string[] {
    const normalizedPath = this.normalizePath(filePath);

    // Vérifier le cache
    const cached = this.impactCache.get(normalizedPath);
    if (cached && Date.now() - cached.timestamp < DependencyGraph.CACHE_TTL) {
      return cached.result;
    }

    const visited = new Set<string>();
    const result = new Set<string>();

    this.traverseDependents(normalizedPath, visited, result);

    // Retirer le fichier lui-même des résultats
    result.delete(normalizedPath);

    const chain = Array.from(result);

    // Mettre en cache
    this.impactCache.set(normalizedPath, { result: chain, timestamp: Date.now() });

    return chain;
  }

  /**
   * Retourne les dépendances directes d'un fichier (ce qu'il importe).
   */
  getDirectDependencies(filePath: string): string[] {
    return this.kg.getDependencies(filePath);
  }

  /**
   * Retourne les dépendants directs d'un fichier (qui l'importe).
   */
  getDirectDependents(filePath: string): string[] {
    return this.kg.getDependents(filePath);
  }

  /**
   * Retourne la chaîne complète de dépendances (transitif).
   * Quels fichiers ce fichier importe-t-il indirectement ?
   */
  getDependencyChain(filePath: string): string[] {
    const visited = new Set<string>();
    const result = new Set<string>();
    this.traverseDependencies(filePath, visited, result);
    result.delete(filePath);
    return Array.from(result);
  }

  /**
   * Détecte tous les cycles de dépendances dans le projet.
   * Utilise DFS avec détection de back-edge.
   */
  detectCycles(): DependencyCycle[] {
    // Vérifier le cache
    if (this.cycleCache && Date.now() - this.cycleCache.timestamp < DependencyGraph.CACHE_TTL) {
      return this.cycleCache.result;
    }

    const cycles: DependencyCycle[] = [];
    const allFiles = this.kg.getAllFiles().map((f) => f.path);
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const pathStack: string[] = [];

    for (const file of allFiles) {
      if (!visited.has(file)) {
        this.detectCyclesDFS(file, visited, recStack, pathStack, cycles);
      }
    }

    // Dédupliquer les cycles (un même cycle peut être détecté plusieurs fois)
    const uniqueCycles = this.deduplicateCycles(cycles);

    this.cycleCache = { result: uniqueCycles, timestamp: Date.now() };

    return uniqueCycles;
  }

  /**
   * Calcule le score de couplage entre deux fichiers (0-100).
   * Plus le score est élevé, plus ils sont fortement couplés.
   */
  getCouplingScore(fileA: string, fileB: string): number {
    const depsA = this.getDirectDependencies(fileA);
    const depsB = this.getDirectDependencies(fileB);
    const depentsA = this.getDirectDependents(fileA);
    const depentsB = this.getDirectDependents(fileB);

    let score = 0;

    // 1. Dépendance directe (A → B ou B → A) : 40 points
    if (depsA.includes(fileB) || depsB.includes(fileA)) {
      score += 40;
    }

    // 2. Dépendants communs (partagent les mêmes "clients") : 20 points
    const commonDependents = depentsA.filter((d) => depentsB.includes(d));
    score += Math.min(commonDependents.length * 5, 20);

    // 3. Dépendances communes (importent les mêmes modules) : 20 points
    const commonDeps = depsA.filter((d) => depsB.includes(d));
    score += Math.min(commonDeps.length * 5, 20);

    // 4. Même module (même répertoire) : 20 points
    const dirA = this.extractModule(fileA);
    const dirB = this.extractModule(fileB);
    if (dirA === dirB) {
      score += 20;
    }

    return Math.min(score, 100);
  }

  /**
   * Trouve le chemin de dépendance entre deux fichiers (BFS).
   * Retourne null si aucun chemin n'existe.
   */
  findDependencyPath(from: string, to: string): string[] | null {
    const normalizedFrom = this.normalizePath(from);
    const normalizedTo = this.normalizePath(to);

    if (normalizedFrom === normalizedTo) return [normalizedFrom];

    // BFS
    const queue: { path: string[]; file: string }[] = [
      { path: [normalizedFrom], file: normalizedFrom },
    ];
    const visited = new Set<string>([normalizedFrom]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      const dependents = this.getDirectDependents(current.file);
      for (const dep of dependents) {
        if (dep === normalizedTo) {
          return [...current.path, dep];
        }
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push({ path: [...current.path, dep], file: dep });
        }
      }
    }

    return null;
  }

  /**
   * Identifie les modules critiques du projet.
   * Un module critique est un fichier dont beaucoup d'autres dépendent.
   */
  getCriticalModules(threshold: number = 10): { filePath: string; dependentsCount: number }[] {
    const allFiles = this.kg.getAllFiles();
    const critical: { filePath: string; dependentsCount: number }[] = [];

    for (const file of allFiles) {
      const dependents = this.getDirectDependents(file.path);
      if (dependents.length >= threshold) {
        critical.push({
          filePath: file.path,
          dependentsCount: dependents.length,
        });
      }
    }

    return critical.sort((a, b) => b.dependentsCount - a.dependentsCount);
  }

  /**
   * Calcule un score de risque de modification pour un fichier.
   * Basé sur le nombre de dépendants, le nombre de cycles, et le couplage moyen.
   */
  getModificationRisk(filePath: string): {
    risk: "low" | "medium" | "high" | "critical";
    score: number;
    factors: string[];
  } {
    const normalizedPath = this.normalizePath(filePath);
    const factors: string[] = [];
    let score = 0;

    // Facteur 1 : Nombre de dépendants directs
    const directDeps = this.getDirectDependents(normalizedPath).length;
    if (directDeps === 0) {
      // Aucun dépendant — risque faible
    } else if (directDeps <= 3) {
      score += 10;
      factors.push(`${directDeps} dépendant(s) direct(s)`);
    } else if (directDeps <= 10) {
      score += 25;
      factors.push(`${directDeps} dépendants directs`);
    } else {
      score += 40;
      factors.push(`${directDeps} dépendants directs — module très partagé`);
    }

    // Facteur 2 : Impact transitif
    const impactChain = this.getImpactChain(normalizedPath);
    if (impactChain.length > 0) {
      if (impactChain.length <= 5) {
        score += 5;
      } else if (impactChain.length <= 20) {
        score += 15;
        factors.push(`impact transitif sur ${impactChain.length} fichiers`);
      } else {
        score += 25;
        factors.push(`large impact transitif sur ${impactChain.length} fichiers`);
      }
    }

    // Facteur 3 : Cycles
    const cycles = this.detectCycles();
    const inCycle = cycles.filter((c) => c.files.includes(normalizedPath));
    if (inCycle.length > 0) {
      score += 20;
      factors.push(`impliqué dans ${inCycle.length} cycle(s) de dépendance`);
    }

    // Facteur 4 : Couplage moyen avec ses dépendants
    const dependents = this.getDirectDependents(normalizedPath);
    if (dependents.length > 0) {
      let totalCoupling = 0;
      for (const dep of dependents) {
        totalCoupling += this.getCouplingScore(normalizedPath, dep);
      }
      const avgCoupling = totalCoupling / dependents.length;
      if (avgCoupling > 60) {
        score += 15;
        factors.push(`couplage moyen élevé (${avgCoupling.toFixed(0)}%)`);
      }
    }

    // Déterminer le niveau de risque
    let risk: "low" | "medium" | "high" | "critical";
    if (score >= 80) risk = "critical";
    else if (score >= 50) risk = "high";
    else if (score >= 20) risk = "medium";
    else risk = "low";

    return { risk, score, factors };
  }

  /**
   * Retourne un rapport textuel compact pour injection dans le contexte LLM.
   */
  toContextSummary(): string {
    const allFiles = this.kg.getAllFiles();
    const cycles = this.detectCycles();
    const critical = this.getCriticalModules(5);

    const lines: string[] = [];
    lines.push(`🔗 GRAPHE DE DÉPENDANCES`);
    lines.push(`   Fichiers: ${allFiles.length}`);

    if (cycles.length > 0) {
      lines.push(`   ⚠️ Cycles détectés: ${cycles.length}`);
      for (const cycle of cycles.slice(0, 3)) {
        lines.push(`      Cycle: ${cycle.files.slice(0, 4).join(" → ")}${cycle.files.length > 4 ? ` → ... (${cycle.length})` : ""}`);
      }
    } else {
      lines.push(`   ✅ Aucun cycle de dépendance`);
    }

    if (critical.length > 0) {
      lines.push(`   ⭐ Modules critiques:`);
      for (const c of critical.slice(0, 5)) {
        lines.push(`      ${c.filePath} (${c.dependentsCount} dépendants)`);
      }
    }

    return lines.join("\n");
  }

  // ─── Parcours DFS pour impact ────────────────────────────────────────────

  private traverseDependents(
    filePath: string,
    visited: Set<string>,
    result: Set<string>
  ): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    result.add(filePath);

    const dependents = this.getDirectDependents(filePath);
    for (const dep of dependents) {
      this.traverseDependents(dep, visited, result);
    }
  }

  private traverseDependencies(
    filePath: string,
    visited: Set<string>,
    result: Set<string>
  ): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    result.add(filePath);

    const deps = this.getDirectDependencies(filePath);
    for (const dep of deps) {
      this.traverseDependencies(dep, visited, result);
    }
  }

  // ─── Détection de cycles (DFS avec back-edge) ────────────────────────────

  private detectCyclesDFS(
    file: string,
    visited: Set<string>,
    recStack: Set<string>,
    pathStack: string[],
    cycles: DependencyCycle[]
  ): void {
    visited.add(file);
    recStack.add(file);
    pathStack.push(file);

    const dependents = this.getDirectDependents(file);
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        this.detectCyclesDFS(dep, visited, recStack, pathStack, cycles);
      } else if (recStack.has(dep)) {
        // Cycle trouvé : extraire le cycle du pathStack
        const cycleStart = pathStack.indexOf(dep);
        const cycleFiles = pathStack.slice(cycleStart);
        cycles.push({
          files: [...cycleFiles],
          length: cycleFiles.length,
        });
      }
    }

    pathStack.pop();
    recStack.delete(file);
  }

  /**
   * Déduplique les cycles : un même cycle peut être détecté à partir
   * de différents points d'entrée. On normalise les cycles pour les comparer.
   */
  private deduplicateCycles(cycles: DependencyCycle[]): DependencyCycle[] {
    const seen = new Set<string>();
    const unique: DependencyCycle[] = [];

    for (const cycle of cycles) {
      // Normaliser : prendre la rotation minimale
      const normalized = this.normalizeCycle(cycle.files);
      const key = normalized.join("→");

      if (!seen.has(key)) {
        seen.add(key);
        unique.push({ files: normalized, length: normalized.length });
      }
    }

    return unique;
  }

  /**
   * Normalise un cycle : rotation pour que le plus petit élément (selon le tri lexical)
   * soit en première position, pour une comparaison fiable.
   */
  private normalizeCycle(files: string[]): string[] {
    if (files.length === 0) return files;

    // Trouver l'index du plus petit élément
    let minIndex = 0;
    for (let i = 1; i < files.length; i++) {
      if (files[i] < files[minIndex]) {
        minIndex = i;
      }
    }

    // Rotation
    return [...files.slice(minIndex), ...files.slice(0, minIndex)];
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Normalise un chemin de fichier.
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
  }

  /**
   * Extrait le module (répertoire parent) d'un fichier.
   */
  private extractModule(filePath: string): string {
    const normalized = this.normalizePath(filePath);
    const parts = normalized.split("/");
    if (parts.length <= 1) return ".";
    return parts.slice(0, -1).join("/");
  }

/**
   * Invalide le cache (appelé quand le KnowledgeGraph est mis à jour).
   */
  invalidateCache(): void {
    this.impactCache.clear();
    this.cycleCache = null;
    log.debug("Cache du DependencyGraph invalidé");
  }

  destroy(): void {
    if (this.unsubscribeKg) {
      this.unsubscribeKg();
      this.unsubscribeKg = undefined;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du DependencyGraph */
export const dependencyGraph = new DependencyGraph();
