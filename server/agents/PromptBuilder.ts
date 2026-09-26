/**
 * PromptBuilder — Stub de compatibilité
 * 
 * Le vrai builder est maintenant dans server/runtime/prompts/SystemPromptBuilder.ts
 * Ce fichier existe uniquement pour que AgentExecutor.ts continue à fonctionner.
 */

import type { AgentDefinition, AgentTask } from "./types.js";

export class PromptBuilder {
  build(agent: AgentDefinition, task: AgentTask, fileContents: string[]): string {
    const parts: string[] = [
      agent.systemPrompt,
      "",
      `# Tâche : ${task.title}`,
      "",
      task.description,
    ];

    if (task.context.instructions) {
      parts.push("", "## Instructions supplémentaires", task.context.instructions);
    }

    if (fileContents.length > 0) {
      parts.push(
        "",
        "## Fichiers de contexte (instantané initial)",
        ...fileContents,
        "",
        "Les fichiers ci-dessus sont un instantané initial du workspace actif (environnement sandbox isolé .Leanna/sandbox). Utilise-les immédiatement. Après une écriture, l'exécuteur fournira un bloc « Fichiers en mémoire » : ce dernier est le seul état autoritaire et remplace tout contenu initial du même chemin."
      );
    }

    if (task.context.previousResults?.length) {
      parts.push("", "## Résultats précédents");
      for (const prev of task.context.previousResults) {
        parts.push(`- ${prev.success ? "✓" : "✗"} ${prev.summary}`);
      }
    }

    const allowedToolsList = (agent.capabilities && agent.capabilities.length > 0)
      ? agent.capabilities.join(", ")
      : "list_project_files, read_project_file, read_file_outline, search_in_files, write_project_file, modify_project_file, patch_project_file, verify_file";

    parts.push(
      "",
      "## Contrat d'exécution obligatoire",
      "Exécute le travail avant de répondre : une intention telle que « Je vais… », « Je dois… » ou un plan seul n'est jamais un résultat.",
      "Pour toute action sur un fichier, émet d'abord uniquement un JSON valide au format {\"tool_calls\":[{\"name\":\"nom_outil\",\"parameters\":{...}}]}; les pseudo-appels JavaScript et les blocs Markdown ne sont pas exécutés. Après chaque observation, poursuis avec le prochain tool_calls jusqu'à l'écriture et la vérification, puis rends le rapport final.",
      "RÈGLE D'ISOLATION SANDBOX & ÉCRITURE OBLIGATOIRE : Toutes tes modifications sont strictement isolées dans la sandbox (.Leanna/sandbox) et ne touchent jamais directement le workspace réel. Si ta tâche implique une modification ou refactorisation de code (rôles coder, refactor, debugger, writer, formatter), tu DOIS appeler modify_project_file, patch_project_file ou write_project_file dès que tu as repéré les fichiers cibles (Tour 1 ou 2 maximum) pour appliquer les changements dans la sandbox. Ne conclus jamais par un compte-rendu textuel sans avoir écrit les modifications.",
      "ERREURS PRÉEXISTANTES : Si une erreur de compilation ou d'import (ex: module introuvable, TS2307, cannot find module) existait AVANT ton intervention, ne te laisse pas bloquer par elle. Applique quand même les modifications qui relèvent de ta tâche. Signale l'erreur préexistante dans une section ## Blocage partiel avec la cause exacte (ex: \"../data introuvable — hors périmètre de cette tâche\"), mais continue le travail sur les parties modifiables. Une erreur préexistante hors périmètre ne justifie JAMAIS 0 modification.",
      "MÉMOIRE PROJET : knowledge_memory_add est strictement optionnel et secondaire ; ne l'utilise JAMAIS si cela retarde l'écriture du code.",
      "Termine impérativement par :",
      "## Résultats vérifiés",
      "- Constats ou changements réellement obtenus, avec fichiers concernés.",
      "## Preuves d'exécution",
      "- Fichiers lus : ...",
      "- Fichiers modifiés : ...",
      "- Outils/commandes exécutés : ...",
      "- Vérification : PASS ou FAIL, avec le résultat observé.",
      `Les seuls appels structurés autorisés pour ton rôle sont : ${allowedToolsList}. Ne demande jamais bash, shell, find, ls ou /workspace.`,
      "Pour déléguer à un autre agent, écris un bloc textuel ## DÉLÉGATION dans ta réponse. N'émets JAMAIS {\"tool_calls\":[{\"name\":\"agent_delegate\"...}]} ni agent_orchestrate — ces outils ne sont pas disponibles ici.",
      "Sans preuve concrète, déclare explicitement la tâche incomplète et explique le blocage."
    );

    return parts.join("\n");
  }
}
