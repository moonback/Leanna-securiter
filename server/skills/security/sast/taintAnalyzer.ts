/**
 * taintAnalyzer — Analyseur de propagation de flux de données (Taint Analysis)
 * 
 * S'appuie sur le graphe d'appels ASTCallGraph pour suivre le flux :
 * Source non fiable (req.body, req.query, input) → Variables / Fonctions → Sink dangereux (query, exec, innerHTML...)
 */

import { analyzeFileTaint as runEngineTaintAnalysis } from '../../../security/scanners/TaintAnalyzer.js';
import { astCallGraph, type CallNode } from '../../../knowledge/ASTCallGraph.js';
import type { Finding } from '../../../security/findings/Finding.js';

export interface InterproceduralTaintTrace {
  finding: Finding;
  callChain?: CallNode[];
  isInterprocedural: boolean;
}

export async function analyzeFileTaint(content: string, filePath: string): Promise<Finding[]> {
  const findings = await runEngineTaintAnalysis(filePath, content);
  return findings;
}

/**
 * Enrichit les findings de taint avec les informations d'appel inter-procédural
 * fournies par ASTCallGraph.
 */
export function enrichWithCallGraph(findings: Finding[], filePath: string): InterproceduralTaintTrace[] {
  return findings.map((finding) => {
    let callChainNodes: CallNode[] = [];
    let isInterprocedural = false;

    try {
      // Trouver la fonction englobante
      const line = finding.location?.startLine ?? 1;
      const callers = astCallGraph.getCallers('handler', filePath);
      if (callers && callers.length > 0) {
        callChainNodes = callers;
        isInterprocedural = true;
      }
    } catch {
      // Best effort si le graphe n'a pas encore indexé ce fichier
    }

    return {
      finding,
      callChain: callChainNodes,
      isInterprocedural,
    };
  });
}
