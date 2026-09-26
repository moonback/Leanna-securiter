/**
 * Réconciliation des compteurs de démarrage.
 *
 * Le système compte des populations DIFFÉRENTES sous le même mot « agent » /
 * « outil ». Ce module rend ces distinctions explicites au démarrage, au lieu
 * de les laisser implicites (ce qui donnait l'impression d'une incohérence
 * entre 15 / 7 / 204~212 / 33).
 *
 * Il signale aussi deux asymétries réelles :
 *   1. capabilities déclarées sur un rôle mais absentes du ToolRegistry
 *      (« visible dans le mapping mais non exécutable ») ;
 *   2. rôles de délégation qui ne sont PAS des plugins runtime
 *      (« agent enregistré mais non activé comme plugin runtime »).
 *
 * Purement observationnel : aucune mutation d'état, aucun effet de bord.
 */

import type { AgentRuntime } from "./AgentRuntime.js";
import { listAgentDefinitions } from "../agents/roles.js";
import { resolveToolAttribution } from "../agents/toolAgentMapper.js";
import { defaultAgents } from "./agents/index.js";

export interface ReconciliationReport {
  delegationAgents: number;
  runtimeAgents: number;
  executableTools: number;
  mappedCapabilities: number;
  /** Capabilities déclarées par un rôle mais introuvables dans le ToolRegistry. */
  orphanCapabilities: string[];
  /** Rôles de délégation sans plugin runtime correspondant. */
  delegationOnlyRoles: string[];
  /**
   * Outils exécutables réellement sans attribution après TOUTES les couches
   * (explicite → capability → catégorie). Ceux-là seuls retombent sur `system`.
   */
  unmappedExecutableTools: number;
  /** Outils attribués via l'heuristique de catégorie (probable, pas certain). */
  categoryAttributedTools: number;
  /** Outils attribués via une capability de rôle. */
  capabilityAttributedTools: number;
  /** Outils attribués explicitement (ToolRegistry / socle sensible). */
  explicitlyAttributedTools: number;
}

/**
 * Construit et logge le rapport de réconciliation à partir du runtime démarré.
 * Doit être appelée après `runtime.start()` ET après le chargement des custom
 * skills (sinon le total d'outils exécutables est sous-évalué).
 */
export function reconcileAndLogCounts(runtime: AgentRuntime): ReconciliationReport {
  // (A) Flotte de délégation : rôles définis dans roles.ts (statiques + dynamiques).
  const delegationDefs = listAgentDefinitions();
  const delegationRoleNames = new Set(delegationDefs.map((d) => d.role));

  // (B) Flotte runtime : plugins enregistrés dans AgentRuntime.
  const runtimeAgentIds = new Set(defaultAgents.map((a) => a.metadata.id));

  // (C) Outils réellement exécutables : source de vérité = ToolRegistry.
  const executableToolNames = new Set(
    runtime.tools.getDeclarations().map((d) => d.name)
  );

  // (D) Capabilities distinctes déclarées par tous les rôles (= base du mapping UI).
  const mappedCapabilities = new Set<string>();
  for (const def of delegationDefs) {
    for (const cap of def.capabilities) mappedCapabilities.add(cap);
  }

  // Asymétrie 1 : capability déclarée mais aucun outil exécutable ne matche.
  const orphanCapabilities = [...mappedCapabilities]
    .filter((cap) => !executableToolNames.has(cap))
    .sort();

  // Asymétrie 2 : rôle de délégation sans plugin runtime homonyme.
  const delegationOnlyRoles = [...delegationRoleNames]
    .filter((role) => !runtimeAgentIds.has(role))
    .sort();

  // Asymétrie 3 : attribution réelle des outils exécutables.
  // On interroge la MÊME cascade que le renderer (resolveToolAttribution) :
  //   explicit → capability → category → unattributed.
  // Seul `unattributed` retombe sur `system` : c'est le vrai chiffre honnête,
  // et non plus « tout ce qui n'est pas une capability ».
  let explicitlyAttributedTools = 0;
  let capabilityAttributedTools = 0;
  let categoryAttributedTools = 0;
  let unmappedExecutableTools = 0;
  for (const tool of executableToolNames) {
    switch (resolveToolAttribution(tool).source) {
      case "explicit": explicitlyAttributedTools++; break;
      case "capability": capabilityAttributedTools++; break;
      case "category": categoryAttributedTools++; break;
      default: unmappedExecutableTools++; break;
    }
  }

  const report: ReconciliationReport = {
    delegationAgents: delegationDefs.length,
    runtimeAgents: runtime.listAgents().length,
    executableTools: runtime.tools.size,
    mappedCapabilities: mappedCapabilities.size,
    orphanCapabilities,
    delegationOnlyRoles,
    unmappedExecutableTools,
    categoryAttributedTools,
    capabilityAttributedTools,
    explicitlyAttributedTools,
  };

  // ── Log lisible : les 4 populations, explicitement nommées ──────────────────
  console.log(
    "[Reconcile] Populations distinctes au démarrage :\n" +
    `  • Agents de délégation (roles.ts)      : ${report.delegationAgents}\n` +
    `  • Agents runtime (AgentRuntime plugins) : ${report.runtimeAgents}\n` +
    `  • Outils exécutables (ToolRegistry)     : ${report.executableTools}\n` +
    `  • Capabilities mappées UI (roles.ts)    : ${report.mappedCapabilities}`
  );

  // ── Attribution réelle des outils (cascade explicit → capability → category) ─
  console.log(
    "[Reconcile] Attribution des outils exécutables :\n" +
    `  • Explicite (ToolRegistry / socle sensible) : ${report.explicitlyAttributedTools}\n` +
    `  • Capability de rôle (roles.ts)             : ${report.capabilityAttributedTools}\n` +
    `  • Catégorie sémantique (heuristique)        : ${report.categoryAttributedTools}\n` +
    `  • Non attribué → rôle « system »            : ${report.unmappedExecutableTools}`
  );

  if (report.orphanCapabilities.length > 0) {
    console.warn(
      `[Reconcile] ⚠️ ${report.orphanCapabilities.length} capability(ies) déclarée(s) mais NON exécutable(s) ` +
      `(visible mapping, absente du ToolRegistry) : ${report.orphanCapabilities.join(", ")}`
    );
  }

  if (report.delegationOnlyRoles.length > 0) {
    console.warn(
      `[Reconcile] ⚠️ ${report.delegationOnlyRoles.length} rôle(s) de délégation SANS plugin runtime ` +
      `(exécutables via orchestrateur, pas via AgentRuntime.submit) : ${report.delegationOnlyRoles.join(", ")}`
    );
  }

  if (report.categoryAttributedTools > 0) {
    console.log(
      `[Reconcile] ℹ️ ${report.categoryAttributedTools} outil(s) attribué(s) par catégorie sémantique ` +
      `→ ENSEMBLE d'agents (affiché « Plusieurs agents », jamais un propriétaire unique). ` +
      `Précisable via une attribution explicite (ToolRegistry) au besoin.`
    );
  }

  if (report.unmappedExecutableTools > 0) {
    console.warn(
      `[Reconcile] ⚠️ ${report.unmappedExecutableTools} outil(s) exécutable(s) réellement sans attribution ` +
      `(ni explicite, ni capability, ni catégorie) — affichés comme « Exécution système » (rôle "system") côté renderer.`
    );
  }

  return report;
}
