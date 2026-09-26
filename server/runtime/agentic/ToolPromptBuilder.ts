/**
 * ToolPromptBuilder — Donne RÉELLEMENT ses outils à l'agent.
 *
 * L'ancien exécuteur envoyait un prompt libre et *devinait* les appels d'outils
 * dans le texte de sortie. Ici, on construit un prompt qui expose explicitement
 * au modèle la liste des outils qu'il a le droit d'appeler — dérivée des
 * `capabilities` déclarées de l'agent et filtrée sur ce que le `ToolRegistry`
 * connaît réellement. C'est le pont manquant entre « capacité déclarée » et
 * « outil exécutable ».
 */

import type { ToolRegistry } from "../ToolRegistry.js";
import type { ToolDeclaration } from "../types.js";
import type { AgentBudget, BudgetUsage, Observation } from "./types.js";

/** Sérialise une déclaration d'outil pour le modèle, de façon compacte. */
function renderTool(decl: ToolDeclaration): string {
  const params = decl.parameters && Object.keys(decl.parameters).length > 0
    ? JSON.stringify(decl.parameters)
    : "{}";
  return `- ${decl.name}: ${decl.description}\n  params: ${params}`;
}

/**
 * Résout les outils réellement disponibles pour un agent.
 * Intersection entre les capabilities déclarées et le registre.
 * Si aucune capability n'est déclarée, l'agent n'obtient AUCUN outil (fail-safe).
 */
export function resolveAgentTools(
  capabilities: readonly string[],
  registry: ToolRegistry
): ToolDeclaration[] {
  const resolved: ToolDeclaration[] = [];
  for (const name of capabilities) {
    const def = registry.getDefinition(name);
    if (def) resolved.push(def.declaration);
  }
  return resolved;
}

/** Bloc « outils disponibles » injecté dans le prompt système. */
export function buildToolSection(tools: ToolDeclaration[]): string {
  if (tools.length === 0) {
    return "OUTILS DISPONIBLES : aucun. Tu ne peux produire qu'une réponse finale textuelle.";
  }
  return [
    "OUTILS DISPONIBLES (tu peux les appeler) :",
    tools.map(renderTool).join("\n"),
    "",
    "PROTOCOLE D'APPEL D'OUTIL — impératif :",
    "- Pour agir, réponds UNIQUEMENT avec un objet JSON strict :",
    '  {"tool_calls": [{"name": "<outil>", "parameters": { ... }}]}',
    "- Tu peux enchaîner plusieurs appels dans le même tableau tool_calls.",
    "- N'invente jamais un outil hors de la liste ci-dessus.",
    "- Quand la tâche est terminée et vérifiée, ne renvoie AUCUN tool_calls :",
    "  produis une réponse finale en texte (résumé, détails, livrables).",
  ].join("\n");
}

/**
 * Résumé compact du budget restant + phase courante, pour que le modèle
 * s'auto-régule et respecte la règle d'arrêt (pas 80 % d'exploration).
 * Les quotas affichés sont ABSOLUS par phase (source de vérité).
 */
export function buildBudgetSection(budget: AgentBudget, usage: BudgetUsage, phase?: string): string {
  const cost = budget.maxCost === Infinity ? "∞" : String(budget.maxCost);
  const lines = [
    "BUDGET DE MISSION (quotas absolus par phase, réserves étanches) :",
    phase ? `- phase courante: ${phase.toUpperCase()}` : "",
    `- itérations: ${usage.iterations}/${budget.maxIterations}`,
    `- total outils: ${usage.toolCalls}/${budget.maxToolCalls}`,
    `  · exploration: ${usage.readCalls}/${budget.maxRead}`,
    `  · écriture (réservé): ${usage.writeCalls}/${budget.maxWrite}`,
    `  · vérification (réservé): ${usage.verifyCalls}/${budget.maxVerify}`,
    `  · récupération (réservé): ${usage.recoveryCalls}/${budget.maxRecovery}`,
    `- fichiers lus: ${usage.filesRead}/${budget.maxFilesRead} | modifiés: ${usage.filesModified}`,
    `- coût estimé: ${Math.round(usage.cost)}/${cost}`,
    "",
    "RÈGLE D'ARRÊT : les appels d'écriture et de vérification sont RÉSERVÉS et ne peuvent",
    "pas être consommés par l'exploration. Dès le quota d'exploration atteint, PASSE À",
    "L'ACTION (écriture), puis VÉRIFIE (verify_file / verify_typecheck).",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Rend l'historique des observations sous une forme dense mais informative,
 * en bornant la taille pour ne pas exploser le contexte.
 */
export function buildObservationHistory(
  observations: readonly Observation[],
  maxChars: number
): string {
  if (observations.length === 0) return "";
  const parts: string[] = [];
  // On parcourt du plus récent au plus ancien puis on inverse, pour privilégier
  // les tours récents quand on atteint la borne.
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    const toolLines = obs.toolOutcomes.map((o) => {
      const status = o.success ? "OK" : `ERREUR: ${o.error ?? "inconnue"}`;
      const preview = previewResult(o.result);
      return `  • ${o.invocation.name}(${JSON.stringify(o.invocation.parameters)}) → ${status}${preview ? ` | ${preview}` : ""}`;
    });
    const block = [
      `— Tour ${obs.iteration} —`,
      obs.reasoning ? `raisonnement: ${truncate(obs.reasoning, 800)}` : "",
      toolLines.length ? `actions:\n${toolLines.join("\n")}` : "(aucune action)",
    ]
      .filter(Boolean)
      .join("\n");
    parts.unshift(block);
    if (parts.join("\n\n").length > maxChars) break;
  }
  return `HISTORIQUE DES TOURS PRÉCÉDENTS :\n${truncate(parts.join("\n\n"), maxChars)}`;
}

function previewResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  let text: string;
  try {
    text = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    text = String(result);
  }
  return truncate(text, 500);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [tronqué ${text.length - max} car.]`;
}
