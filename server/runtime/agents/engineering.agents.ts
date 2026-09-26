/**
 * Plugins runtime des 8 rôles d'ingénierie.
 *
 * Historiquement, seuls les 7 rôles de rédaction étaient des `AgentPlugin`
 * enregistrés dans `AgentRuntime`. Les 8 rôles d'ingénierie (coder, refactor,
 * debugger, reviewer, tester, security, architect, vision) n'existaient que
 * comme définitions de délégation (`roles.ts`) et n'étaient donc pas
 * exécutables via `AgentRuntime.submit()` — d'où le warning « 8 rôles de
 * délégation SANS plugin runtime ».
 *
 * Ces plugins comblent l'écart SANS dupliquer la logique : leur `execute`
 * délègue à la MÊME boucle agentique plan→act→verify que l'orchestrateur, via
 * le pont `runViaAgentic`. Un seul concept d'exécution, deux points d'entrée
 * (orchestrateur ET AgentRuntime.submit).
 *
 * Les métadonnées (nom, description, capabilities, concurrence, timeout) sont
 * dérivées de la définition de délégation canonique (`roles.ts`), de sorte
 * qu'il n'existe qu'une seule source de vérité pour « ce qu'est un coder ».
 */

import type { AgentPlugin } from "../AgentRuntime.js";
import type { AgentMetadata } from "../types.js";
import { getAgentDefinition } from "../../agents/roles.js";
import { runViaAgentic } from "./agenticBridge.js";

/** Rôles d'ingénierie à exposer comme plugins runtime. */
const ENGINEERING_ROLES = [
  "coder",
  "refactor",
  "debugger",
  "reviewer",
  "tester",
  "security",
  "architect",
  "vision",
] as const;

/**
 * Construit un `AgentPlugin` pour un rôle d'ingénierie à partir de sa
 * définition de délégation canonique. L'exécution est déléguée à la boucle
 * agentique partagée.
 */
function buildEngineeringPlugin(role: string): AgentPlugin {
  const def = getAgentDefinition(role);
  if (!def) {
    // Ne devrait jamais arriver : ENGINEERING_ROLES ⊆ STATIC_AGENT_REGISTRY.
    throw new Error(`[engineering.agents] Rôle d'ingénierie inconnu: "${role}"`);
  }

  const metadata: AgentMetadata = {
    id: def.role,
    name: def.name,
    description: def.description,
    capabilities: [...def.capabilities],
    maxConcurrency: def.maxConcurrency,
    timeoutMs: def.defaultTimeoutMs,
  };

  return {
    metadata,
    execute: (context) => runViaAgentic(def.role, context),
  };
}

/** Les 8 plugins d'ingénierie, prêts à être enregistrés dans AgentRuntime. */
export const engineeringAgents: AgentPlugin[] = ENGINEERING_ROLES.map(buildEngineeringPlugin);
