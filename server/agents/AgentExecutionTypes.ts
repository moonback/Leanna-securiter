/**
 * AgentExecutionTypes — État partagé du cycle d'exécution d'une tâche agent
 *
 * `ToolExecutionState` est l'accumulateur mutable de la boucle d'outils
 * (`executeToolLoop`). Il est partagé entre l'`AgentExecutor` (qui le remplit)
 * et l'`AgentEvidenceEvaluator` (qui le lit pour produire les preuves), d'où
 * son extraction dans un module neutre évitant tout import circulaire.
 */
import type { AgentRepairLoop } from "./AgentRepairLoop.js";
import type { WorkspaceState } from "./WorkspaceState.js";

export interface ToolExecutionState {
  resultText: string;
  toolsExecuted: string[];
  filesRead: string[];
  filesModified: string[];
  errors: string[];
  observations: string[];
  /** Every successful or rejected write; completion gates all of these files. */
  touchedFiles: Set<string>;
  /** Bounded, progress-aware repair policies, isolated per file. */
  repairLoops: Map<string, AgentRepairLoop>;
  blockedFiles: Set<string>;
  /** Authoritative disk observations and hash-bound verification evidence. */
  workspace: WorkspaceState;
  fileSnapshots: Map<string, string>;
  /** Snapshots des fichiers au tour précédent pour le diff incrémental */
  previousFileSnapshots: Map<string, string>;
  /** Fichiers nouvellement lus ou modifiés dans ce tour */
  newlyTouchedFiles: Set<string>;
  /**
   * Nombre de tours consécutifs où l'agent a lu des fichiers sans en modifier aucun.
   * Réinitialisé à 0 dès qu'une écriture est confirmée.
   * Utilisé par le no-progress guard.
   */
  consecutiveReadOnlyTurns: number;
  /**
   * Vrai si la boucle a été interrompue par le no-progress guard.
   * Permet à collectEvidence de produire outcome="no_change" ou outcome="blocked".
   */
  noProgressAbort: boolean;
  /**
   * Erreurs de compilation/vérification préexistantes (détectées avant tout write).
   * Permet de distinguer une erreur introduite par l'agent d'une erreur préexistante.
   */
  preexistingErrors: string[];
}
