/**
 * SecurityGraph — Graphe de sécurité unifié (Phase 5, section 17 du plan)
 *
 * Fusionne trois sources déjà pilotées par les données :
 *   - Findings              (FindingManager)
 *   - Attack Surface Graph  (SecurityOrchestrator.getAttackSurface)
 *   - Threat Model          (ThreatModelEngine)
 *
 * en UN graphe interrogeable que Leanna peut parcourir pour raisonner :
 *
 *     entrypoint ──exposes──▶ surfaceNode
 *     surfaceNode ──hosts──▶ asset
 *     finding ──locatedOn──▶ surfaceNode / entrypoint
 *     threat ──evidencedBy──▶ finding
 *     threat ──targets──▶ asset / entrypoint
 *
 * Le graphe est un produit dérivé (aucune persistance, aucune exécution) : il
 * se reconstruit à la demande à partir de l'état courant.
 */

import type { Finding } from '../findings/Finding.js';
import type { AttackSurfaceGraph } from '../orchestrator/SecurityOrchestrator.js';
import type { ThreatModel } from '../threat/ThreatModelEngine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityNodeType =
  | 'finding'
  | 'asset'
  | 'entrypoint'
  | 'threat'
  | 'surface';

export type SecurityEdgeType =
  | 'exposes'      // entrypoint → surface
  | 'hosts'        // surface → asset
  | 'locatedOn'    // finding → surface/entrypoint
  | 'evidencedBy'  // threat → finding
  | 'targets'      // threat → asset/entrypoint
  | 'flowsTo';     // surface → surface (edges de la surface d'attaque)

export interface SecurityGraphNode {
  id: string;
  type: SecurityNodeType;
  label: string;
  /** Score de risque 0..100 quand applicable. */
  riskScore: number;
  /** Attributs bruts spécifiques au type (severity, verb, stride, etc.). */
  attributes: Record<string, unknown>;
}

export interface SecurityGraphEdge {
  id: string;
  type: SecurityEdgeType;
  source: string;
  target: string;
}

// ---------------------------------------------------------------------------
// Graphe
// ---------------------------------------------------------------------------

const SEV_RISK: Record<Finding['severity'], number> = {
  critical: 100, high: 75, medium: 45, low: 20, info: 5,
};

export class SecurityGraph {
  private readonly nodes = new Map<string, SecurityGraphNode>();
  private readonly edges: SecurityGraphEdge[] = [];
  private readonly adjacency = new Map<string, Set<string>>();

  // --- Construction --------------------------------------------------------

  private addNode(node: SecurityGraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
      this.adjacency.set(node.id, new Set());
    }
  }

  private addEdge(type: SecurityEdgeType, source: string, target: string): void {
    // N'ajoute une arête que si les deux extrémités existent.
    if (!this.nodes.has(source) || !this.nodes.has(target)) return;
    const id = `${type}:${source}->${target}`;
    if (this.edges.some((e) => e.id === id)) return;
    this.edges.push({ id, type, source, target });
    this.adjacency.get(source)!.add(target);
    this.adjacency.get(target)!.add(source);
  }

  /**
   * Fusionne les trois sources dans le graphe. Idempotent par construction.
   */
  static build(inputs: {
    findings: Finding[];
    attackSurface: AttackSurfaceGraph;
    threatModel: ThreatModel;
  }): SecurityGraph {
    const g = new SecurityGraph();
    const { findings, attackSurface, threatModel } = inputs;

    // 1. Nœuds de surface d'attaque + flux.
    for (const n of attackSurface.nodes) {
      g.addNode({
        id: n.id,
        type: 'surface',
        label: n.label,
        riskScore: n.riskScore,
        attributes: { surfaceType: n.type, vulnCount: n.vulnCount },
      });
    }
    for (const e of attackSurface.edges) {
      g.addEdge('flowsTo', e.source, e.target);
    }

    // 2. Points d'entrée (threat model) + exposition vers la surface API/WS.
    for (const ep of threatModel.entryPoints) {
      g.addNode({
        id: ep.id,
        type: 'entrypoint',
        label: `${ep.verb} ${ep.route}`,
        riskScore: ep.parameterized ? 40 : 25,
        attributes: { verb: ep.verb, route: ep.route, sourceFile: ep.sourceFile, parameterized: ep.parameterized },
      });
      // Rattache les points d'entrée HTTP à la surface API (ou WS).
      const surfaceId = ep.kind === 'websocket' ? 'ep-websocket' : 'ep-api-routes';
      g.addEdge('exposes', ep.id, surfaceId);
    }

    // 3. Actifs + relation hosts (surface → asset) heuristique.
    for (const a of threatModel.assets) {
      g.addNode({
        id: a.id,
        type: 'asset',
        label: a.label,
        riskScore: a.sensitivity === 'critical' ? 90 : a.sensitivity === 'high' ? 70 : a.sensitivity === 'medium' ? 45 : 20,
        attributes: { kind: a.kind, sensitivity: a.sensitivity },
      });
    }
    // Liens hosts plausibles selon la topologie connue.
    g.addEdge('hosts', 'db-sqlite-local', 'asset-db');
    g.addEdge('hosts', 'fs-workspace-sandbox', 'asset-fs');
    g.addEdge('hosts', 'fs-workspace-sandbox', 'asset-workspace');
    g.addEdge('hosts', 'srv-agent-runtime', 'asset-runtime');
    g.addEdge('hosts', 'ext-llm-providers', 'asset-secrets');

    // 4. Findings + localisation sur la surface.
    for (const f of findings) {
      g.addNode({
        id: `finding:${f.id}`,
        type: 'finding',
        label: f.title,
        riskScore: SEV_RISK[f.severity] ?? 5,
        attributes: { scanner: f.scanner, severity: f.severity, ruleId: f.ruleId, cwe: f.cwe, filePath: f.location?.filePath },
      });
      const surfaceId = SecurityGraph.surfaceForFinding(f);
      g.addEdge('locatedOn', `finding:${f.id}`, surfaceId);
    }

    // 5. Menaces + preuves (findings) + cibles (assets/entrypoints).
    for (const t of threatModel.threats) {
      g.addNode({
        id: t.id,
        type: 'threat',
        label: t.title,
        riskScore: SEV_RISK[t.severity] ?? 5,
        attributes: {
          stride: t.stride,
          severity: t.severity,
          mitre: t.mitre?.id ?? null,
          mitreTactic: t.mitre?.tactic ?? null,
        },
      });
      for (const fid of t.evidenceFindingIds) {
        g.addEdge('evidencedBy', t.id, `finding:${fid}`);
      }
      for (const targetId of t.affects) {
        g.addEdge('targets', t.id, targetId);
      }
    }

    return g;
  }

  /** Reproduit le routage finding → nœud de surface (aligné sur l'orchestrateur). */
  private static surfaceForFinding(f: Finding): string {
    const rule = f.ruleId.toUpperCase();
    const file = f.location?.filePath?.toLowerCase() ?? '';
    if (f.scanner === 'sca' || f.scanner === 'secrets') return 'ext-llm-providers';
    if (f.scanner === 'iac') return 'fs-workspace-sandbox';
    if (f.scanner === 'dast') return 'ep-api-routes';
    if (rule.includes('SQL') || rule.includes('CWE-89') || rule.includes('CWE-943')) return 'db-sqlite-local';
    if (file.includes('websocket') || file.includes('/ws')) return 'ep-websocket';
    if (file.includes('route') || file.includes('/api/') || file.includes('server')) return 'ep-api-routes';
    if (file.includes('agent') || file.includes('runtime')) return 'srv-agent-runtime';
    return 'srv-orchestrator';
  }

  // --- Requêtes ------------------------------------------------------------

  getNode(id: string): SecurityGraphNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(type?: SecurityNodeType): SecurityGraphNode[] {
    const all = [...this.nodes.values()];
    return type ? all.filter((n) => n.type === type) : all;
  }

  getEdges(type?: SecurityEdgeType): SecurityGraphEdge[] {
    return type ? this.edges.filter((e) => e.type === type) : [...this.edges];
  }

  /** Voisins directs (non orientés) d'un nœud. */
  neighbors(id: string): SecurityGraphNode[] {
    const ids = this.adjacency.get(id);
    if (!ids) return [];
    return [...ids].map((nid) => this.nodes.get(nid)!).filter(Boolean);
  }

  /**
   * Nœuds les plus risqués, triés par riskScore décroissant.
   */
  topRiskNodes(limit = 10, type?: SecurityNodeType): SecurityGraphNode[] {
    return this.getNodes(type)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, limit);
  }

  /**
   * Chemins d'exposition : depuis chaque point d'entrée, remonte les arêtes
   * jusqu'aux actifs atteignables, en ne conservant que ceux passant par un
   * nœud porteur d'un finding (chemins « chauds »).
   */
  criticalExposurePaths(maxDepth = 5): Array<{ path: string[]; risk: number }> {
    const entryPoints = this.getNodes('entrypoint');
    const results: Array<{ path: string[]; risk: number }> = [];

    const hasFindingNeighbor = (nodeId: string): boolean =>
      this.neighbors(nodeId).some((n) => n.type === 'finding');

    for (const ep of entryPoints) {
      // BFS borné vers les actifs.
      const queue: Array<{ id: string; path: string[] }> = [{ id: ep.id, path: [ep.id] }];
      const seen = new Set<string>([ep.id]);
      while (queue.length > 0) {
        const { id, path } = queue.shift()!;
        if (path.length > maxDepth) continue;
        const node = this.nodes.get(id);
        if (node?.type === 'asset') {
          const touchesFinding = path.some((p) => hasFindingNeighbor(p));
          if (touchesFinding) {
            const risk = Math.max(...path.map((p) => this.nodes.get(p)?.riskScore ?? 0));
            results.push({ path, risk });
          }
          continue;
        }
        for (const nb of this.adjacency.get(id) ?? []) {
          if (seen.has(nb)) continue;
          const nbNode = this.nodes.get(nb);
          // On ne traverse que surface/entrypoint/asset (pas les findings/threats).
          if (nbNode && (nbNode.type === 'surface' || nbNode.type === 'asset' || nbNode.type === 'entrypoint')) {
            seen.add(nb);
            queue.push({ id: nb, path: [...path, nb] });
          }
        }
      }
    }

    return results.sort((a, b) => b.risk - a.risk);
  }

  /** Sérialisation simple pour transport / affichage. */
  toJSON(): {
    nodes: SecurityGraphNode[];
    edges: SecurityGraphEdge[];
    summary: { nodeCount: number; edgeCount: number; byType: Record<SecurityNodeType, number> };
  } {
    const byType = { finding: 0, asset: 0, entrypoint: 0, threat: 0, surface: 0 } as Record<SecurityNodeType, number>;
    for (const n of this.nodes.values()) byType[n.type]++;
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
      summary: { nodeCount: this.nodes.size, edgeCount: this.edges.length, byType },
    };
  }
}
