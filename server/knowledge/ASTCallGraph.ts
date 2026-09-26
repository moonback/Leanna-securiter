/**
 * ASTCallGraph — Graphe d'appels inter et intra fichiers
 *
 * Construit et interroge un graphe d'appels bidirectionnel à partir
 * des résultats AST produits par ASTParser.
 *
 * Structure :
 *   CallNode  : une fonction/méthode identifiée (id = "filePath#functionName")
 *   CallEdge  : une relation d'appel caller → callee avec metadata
 *
 * Capacités :
 *   - getCallers(fn, filePath)   → qui appelle cette fonction ?
 *   - getCallees(fn, filePath)   → que appelle cette fonction ?
 *   - getCallChain(fn, filePath) → chaîne d'appels complète (BFS, max depth)
 *   - resolveCallee(call, scope) → tente de résoudre l'appel vers un fichier
 *   - getStats()                 → métriques du graphe
 */

import path from "path";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { createLogger } from "../utils/logger.js";
import type { ASTFileResult, ASTCall } from "./types.js";

const log = createLogger("ASTCallGraph");

// ─── Types ────────────────────────────────────────────────────────────────────

/** Identifiant unique d'un nœud dans le graphe d'appels */
export type CallNodeId = string; // `${filePath}#${functionName}`

/** Un nœud du graphe d'appels = une fonction/méthode */
export interface CallNode {
  id: CallNodeId;
  functionName: string;
  className?: string;
  filePath: string;
  isMethod: boolean;
}

/** Une arête du graphe d'appels = un appel caller → callee */
export interface CallEdge {
  /** Nœud appelant */
  callerId: CallNodeId;
  /** Nœud appelé (peut être non résolu si extern ou inconnu) */
  calleeId: CallNodeId;
  /** Nom du callee tel qu'il apparaît dans le code */
  calleeName: string;
  /** Objet sur lequel l'appel est fait ("this", "fs", etc.) */
  calleeObject?: string;
  /** Ligne du fichier source */
  sourceLine: number;
  /** Résolu vers un fichier connu */
  isResolved: boolean;
  /** L'appel est dans un contexte await */
  isAwait: boolean;
  /** Appel de méthode chaîné */
  isChained: boolean;
}

/** Résultat d'une requête de chaîne d'appels */
export interface CallChain {
  root: CallNodeId;
  nodes: CallNode[];
  edges: CallEdge[];
  maxDepthReached: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASTCallGraph
// ═══════════════════════════════════════════════════════════════════════════════

export class ASTCallGraph {
  /** Tous les nœuds connus */
  private nodes = new Map<CallNodeId, CallNode>();
  /** Arêtes sortantes : caller → callees */
  private outEdges = new Map<CallNodeId, CallEdge[]>();
  /** Arêtes entrantes : callee → callers */
  private inEdges = new Map<CallNodeId, CallEdge[]>();
  /** Map nom de fonction → node IDs possibles (pour résolution) */
  private nameIndex = new Map<string, CallNodeId[]>();
  private lastRootSeen: string = "";

  private syncToCurrentWorkspace(): void {
    if (this.lastRootSeen === SELF_ROOT) return;
    this.lastRootSeen = SELF_ROOT;
    this.clear();
  }

  /**
   * Vide l'ensemble du graphe d'appels.
   */
  clear(): void {
    this.nodes.clear();
    this.outEdges.clear();
    this.inEdges.clear();
    this.nameIndex.clear();
  }

  // ─── Mise à jour du graphe ─────────────────────────────────────────────────

  /**
   * Intègre les résultats AST d'un fichier dans le graphe.
   * Appelé après chaque `ASTParser.parseFile()`.
   */
  updateFile(astResult: ASTFileResult, allAstResults: Map<string, ASTFileResult>): void {
    this.syncToCurrentWorkspace();
    if (astResult.usedFallback) return; // Données trop imprécises

    const filePath = astResult.filePath;

    // 1. Supprimer les anciens nœuds/arêtes de ce fichier
    this._removeFile(filePath);

    // 2. Enregistrer les nœuds (fonctions connues)
    for (const fn of astResult.functions) {
      const id = this._makeId(filePath, fn.name, fn.className);
      const node: CallNode = {
        id,
        functionName: fn.name,
        className: fn.className,
        filePath,
        isMethod: fn.isMethod,
      };
      this.nodes.set(id, node);

      // Indexer par nom court (pour résolution)
      const shortKey = fn.className ? `${fn.className}.${fn.name}` : fn.name;
      this._addToNameIndex(shortKey, id);
      this._addToNameIndex(fn.name, id);
    }

    // 3. Enregistrer les arêtes (appels)
    for (const call of astResult.calls) {
      const callerId = this._makeId(filePath, call.callerFunction, call.callerClass);

      // S'assurer que le caller est enregistré (au moins comme nœud fantôme)
      if (!this.nodes.has(callerId)) {
        this.nodes.set(callerId, {
          id: callerId,
          functionName: call.callerFunction,
          className: call.callerClass,
          filePath,
          isMethod: !!call.callerClass,
        });
      }

      // Tenter de résoudre le callee
      const resolved = this._resolveCallee(call, filePath, allAstResults);
      const calleeId = resolved ?? this._makeExternalId(call.callee, call.calleeObject);

      const edge: CallEdge = {
        callerId,
        calleeId,
        calleeName: call.callee,
        calleeObject: call.calleeObject,
        sourceLine: call.lineNumber,
        isResolved: !!resolved,
        isAwait: call.isAwait,
        isChained: call.isChained,
      };

      // Ajouter les arêtes sortantes et entrantes
      if (!this.outEdges.has(callerId)) this.outEdges.set(callerId, []);
      this.outEdges.get(callerId)!.push(edge);

      if (!this.inEdges.has(calleeId)) this.inEdges.set(calleeId, []);
      this.inEdges.get(calleeId)!.push(edge);
    }

    log.debug(
      `📊 ASTCallGraph: ${filePath} → ${astResult.functions.length} fonctions, ${astResult.calls.length} appels`
    );
  }

  /**
   * Supprime tous les nœuds/arêtes d'un fichier supprimé.
   */
  removeFile(filePath: string): void {
    this.syncToCurrentWorkspace();
    this._removeFile(filePath);
    log.debug(`🗑️ ASTCallGraph: nœuds de ${filePath} supprimés`);
  }

  // ─── Requêtes ──────────────────────────────────────────────────────────────

  /**
   * Retourne les appelants d'une fonction (qui l'appelle ?).
   * @param functionName Nom de la fonction
   * @param filePath Chemin du fichier (pour désambiguïser)
   * @param className Classe parente si méthode
   */
  getCallers(
    functionName: string,
    filePath: string,
    className?: string
  ): CallEdge[] {
    this.syncToCurrentWorkspace();
    const id = this._makeId(filePath, functionName, className);
    return this.inEdges.get(id) ?? [];
  }

  /**
   * Retourne les callées d'une fonction (qu'est-ce qu'elle appelle ?).
   */
  getCallees(
    functionName: string,
    filePath: string,
    className?: string
  ): CallEdge[] {
    this.syncToCurrentWorkspace();
    const id = this._makeId(filePath, functionName, className);
    return this.outEdges.get(id) ?? [];
  }

  /**
   * Retourne toutes les arêtes sortantes d'un fichier
   * (call-graph complet du fichier).
   */
  getFileCallGraph(filePath: string): { nodes: CallNode[]; edges: CallEdge[] } {
    this.syncToCurrentWorkspace();
    const fileNodes: CallNode[] = [];
    const fileEdges: CallEdge[] = [];

    for (const [, node] of this.nodes) {
      if (node.filePath === filePath) fileNodes.push(node);
    }

    for (const nodeId of fileNodes.map(n => n.id)) {
      fileEdges.push(...(this.outEdges.get(nodeId) ?? []));
    }

    return { nodes: fileNodes, edges: fileEdges };
  }

  /**
   * BFS depuis une fonction donnée (callees récursifs).
   * @param maxDepth Profondeur maximale (défaut: 5)
   */
  getCallChain(
    functionName: string,
    filePath: string,
    className?: string,
    maxDepth = 5
  ): CallChain {
    this.syncToCurrentWorkspace();
    const rootId = this._makeId(filePath, functionName, className);
    const visitedNodes = new Map<CallNodeId, CallNode>();
    const visitedEdges: CallEdge[] = [];
    const queue: Array<{ id: CallNodeId; depth: number }> = [{ id: rootId, depth: 0 }];
    let maxDepthReached = false;

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visitedNodes.has(id)) continue;

      const node = this.nodes.get(id);
      if (node) visitedNodes.set(id, node);

      if (depth >= maxDepth) {
        maxDepthReached = true;
        continue;
      }

      for (const edge of this.outEdges.get(id) ?? []) {
        visitedEdges.push(edge);
        if (!visitedNodes.has(edge.calleeId)) {
          queue.push({ id: edge.calleeId, depth: depth + 1 });
        }
      }
    }

    return {
      root: rootId,
      nodes: [...visitedNodes.values()],
      edges: visitedEdges,
      maxDepthReached,
    };
  }

  /**
   * Retourne toutes les fonctions d'un fichier qui appellent une fonction
   * d'un autre fichier (dépendances inter-fichiers au niveau fonction).
   */
  getCrossFileCallEdges(filePath: string): CallEdge[] {
    this.syncToCurrentWorkspace();
    const fileNodes = [...this.nodes.values()].filter(n => n.filePath === filePath);
    const edges: CallEdge[] = [];

    for (const node of fileNodes) {
      for (const edge of this.outEdges.get(node.id) ?? []) {
        const calleeNode = this.nodes.get(edge.calleeId);
        if (calleeNode && calleeNode.filePath !== filePath) {
          edges.push(edge);
        } else if (!calleeNode && edge.isResolved) {
          edges.push(edge);
        }
      }
    }

    return edges;
  }

  /** Statistiques du graphe */
  getStats(): {
    totalNodes: number;
    totalEdges: number;
    resolvedEdges: number;
    crossFileEdges: number;
  } {
    this.syncToCurrentWorkspace();
    let totalEdges = 0;
    let resolvedEdges = 0;

    for (const edges of this.outEdges.values()) {
      totalEdges += edges.length;
      resolvedEdges += edges.filter(e => e.isResolved).length;
    }

    // Cross-file = arêtes où caller et callee sont dans des fichiers différents
    let crossFileEdges = 0;
    for (const [callerId, edges] of this.outEdges) {
      const callerNode = this.nodes.get(callerId);
      for (const edge of edges) {
        const calleeNode = this.nodes.get(edge.calleeId);
        if (callerNode && calleeNode && callerNode.filePath !== calleeNode.filePath) {
          crossFileEdges++;
        }
      }
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges,
      resolvedEdges,
      crossFileEdges,
    };
  }

  // ─── Résolution des callees ────────────────────────────────────────────────

  /**
   * Tente de résoudre un appel vers un nœud connu du graphe.
   * Stratégies (par ordre de confiance) :
   *  1. Appel de méthode "this.foo()" → cherche dans la même classe
   *  2. Appel de méthode "obj.foo()" → cherche via l'import de obj
   *  3. Appel direct "foo()" → cherche dans le même fichier, puis dans les imports
   */
  private _resolveCallee(
    call: ASTCall,
    callerFile: string,
    _allAstResults: Map<string, ASTFileResult>
  ): CallNodeId | null {
    const { callee, calleeObject, callerClass } = call;

    // 1. Appel "this.method()" → même classe
    if (calleeObject === "this" && callerClass) {
      const id = this._makeId(callerFile, callee, callerClass);
      if (this.nodes.has(id)) return id;
    }

    // 2. Appel direct dans le même fichier
    const localId = this._makeId(callerFile, callee);
    if (this.nodes.has(localId)) return localId;

    // 3. Chercher par nom dans l'index global
    const candidates = this.nameIndex.get(callee) ?? [];
    if (candidates.length === 1) return candidates[0];

    // 4. Si calleeObject est un objet connu (instance de classe)
    if (calleeObject && calleeObject !== "this") {
      // Chercher "ClassName.method" où ClassName matche calleeObject
      const classMethodId = this.nameIndex.get(`${calleeObject}.${callee}`)?.[0];
      if (classMethodId) return classMethodId;
    }

    return null;
  }

  // ─── Helpers privés ────────────────────────────────────────────────────────

  private _makeId(filePath: string, functionName: string, className?: string): CallNodeId {
    const baseName = path.basename(filePath, path.extname(filePath));
    const qualifier = className ? `${className}.${functionName}` : functionName;
    return `${baseName}#${qualifier}`;
  }

  private _makeExternalId(callee: string, obj?: string): CallNodeId {
    return `(external)#${obj ? `${obj}.${callee}` : callee}`;
  }

  private _addToNameIndex(name: string, id: CallNodeId): void {
    if (!this.nameIndex.has(name)) this.nameIndex.set(name, []);
    const list = this.nameIndex.get(name)!;
    if (!list.includes(id)) list.push(id);
  }

  private _removeFile(filePath: string): void {
    // Supprimer les nœuds du fichier
    const idsToRemove = new Set<CallNodeId>();
    for (const [id, node] of this.nodes) {
      if (node.filePath === filePath) {
        idsToRemove.add(id);
        this.nodes.delete(id);
        this.outEdges.delete(id);
        this.inEdges.delete(id);
      }
    }

    // Nettoyer les arêtes entrantes qui pointaient vers ces nœuds
    for (const [id, edges] of this.inEdges) {
      const filtered = edges.filter(e => !idsToRemove.has(e.callerId));
      if (filtered.length === 0) this.inEdges.delete(id);
      else this.inEdges.set(id, filtered);
    }
    for (const [id, edges] of this.outEdges) {
      const filtered = edges.filter(e => !idsToRemove.has(e.calleeId));
      if (filtered.length === 0) this.outEdges.delete(id);
      else this.outEdges.set(id, filtered);
    }

    // Nettoyer l'index des noms
    for (const [name, ids] of this.nameIndex) {
      const filtered = ids.filter(id => !idsToRemove.has(id));
      if (filtered.length === 0) this.nameIndex.delete(name);
      else this.nameIndex.set(name, filtered);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Instance singleton partagée du graphe d'appels AST */
export const astCallGraph = new ASTCallGraph();
