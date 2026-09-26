/**
 * AgentTaskRunner — Contrat unique du moteur d'exécution d'une tâche agent.
 *
 * Ce petit module neutre définit l'interface partagée par les deux moteurs :
 *   - `AgentExecutor`        (legacy — scraping de tool_calls dans le texte)
 *   - `AgentRuntimeExecutor` (runtime agentique — boucle plan→act→verify→recover)
 *
 * Tous les consommateurs (TaskScheduler, AutonomousLoop, AutonomousAgent,
 * AgentRegistry, AgentOrchestrator) dépendent de CETTE interface, jamais d'une
 * implémentation concrète. C'est ce qui permet de basculer l'ensemble des
 * chemins d'exécution vers le runtime agentique sans réécrire les appelants.
 */
import type { AgentTask } from "./types.js";

/**
 * INVARIANTS DE CONTRAT (`AgentTaskRunner`)
 *
 * Les deux implémentations (`AgentExecutor` legacy et `AgentRuntimeExecutor`
 * agentique) DOIVENT satisfaire ces invariants comportementaux, sans quoi elles
 * divergeraient silencieusement. Ils sont vérifiés par la suite commune
 * `AgentTaskRunnerContract.test.ts`, exécutée contre les deux moteurs.
 *
 *  1. STATUT À JOUR      — après `execute()`, `task.status` est terminal
 *                          (`completed` | `failed` | `cancelled`), jamais
 *                          laissé à `pending`/`running`.
 *  2. RÉSULTAT COHÉRENT  — `task.result` est toujours défini, avec `success`
 *                          cohérent avec `status` et un `outcome` renseigné.
 *  3. ERREURS NORMALISÉES — un échec produit `success:false`, `outcome:"failed"`
 *                          et un `error` non vide ; aucune exception ne fuit
 *                          hors de `execute()`.
 *  4. ANNULATION         — une tâche annulée n'est jamais rapportée `completed`.
 *  5. EXÉCUTION D'OUTILS  — les outils passent par un point unique contrôlé
 *                          (skillHandler / ToolRegistry) ; pas de bash arbitraire.
 *  6. filesModified FIABLE — `result.filesModified` ne liste que des fichiers
 *                          réellement écrits (jamais un fichier fantôme).
 *  7. AUCUNE ÉCRITURE NON COMPTABILISÉE — toute écriture réussie est reflétée
 *                          dans `filesModified` (transactionnel).
 *  8. BUDGET RESPECTÉ    — l'exécution reste bornée (pas de boucle infinie) ;
 *                          les limites d'appels/temps sont honorées.
 *  9. VÉRIFICATION OBSERVABLE — le succès est étayé par des preuves
 *                          (`result.evidence`/vérification), pas seulement par
 *                          la narration du modèle.
 * 10. RÉSULTAT DÉTERMINISTE — à entrées identiques (modèle déterministe),
 *                          `status` et `outcome` sont reproductibles.
 */
export interface AgentTaskRunner {
  /**
   * Exécute une tâche de bout en bout. Écrit `task.status` / `task.result`
   * in-place (contrat historique respecté par les deux moteurs).
   *
   * Voir les INVARIANTS DE CONTRAT ci-dessus.
   */
  execute(task: AgentTask): Promise<void>;

  /**
   * Exécute un outil/skill ponctuel hors du cycle de tâche (ex: `verify_file`
   * relancé par la boucle autonome). Optionnel : un moteur qui ne l'expose pas
   * force simplement l'appelant à un repli.
   */
  runTool?(name: string, args: Record<string, unknown>): Promise<unknown>;
}
