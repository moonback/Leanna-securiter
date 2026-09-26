/**
 * AgentEvidenceEvaluator — Évaluation des preuves d'exécution et de l'outcome
 *
 * Responsabilité unique : transformer l'état d'exécution accumulé
 * (`ToolExecutionState`) et le résultat textuel du modèle en preuves
 * observables (`collectEvidence`) puis en verdict de complétude
 * (`getIncompleteReason`).
 *
 * Un texte non exceptionnel ne suffit jamais : `completed` nécessite des preuves
 * observables collectées par l'exécuteur, pas seulement déclarées par le modèle.
 */
import type { AgentTask } from "./types.js";
import type { ToolExecutionState } from "./AgentExecutionTypes.js";
import { ResultParser } from "./ResultParser.js";
import { roleCanWriteFiles } from "./roles.js";

export class AgentEvidenceEvaluator {
  constructor(private readonly resultParser: ResultParser = new ResultParser()) {}

  /** Construit les preuves à partir des appels réellement effectués par l'exécuteur. */
  collectEvidence(
    task: AgentTask,
    fileContents: string[],
    writeResult: { written: string[]; errors: { path: string; error: string }[] },
    resultText: string,
    toolExecution: ToolExecutionState
  ) {
    const filesRead = [...new Set([
      ...fileContents
        .map((content) => content.match(/^--- (.+) ---/m)?.[1])
        .filter((path): path is string => Boolean(path)),
      ...toolExecution.filesRead,
    ])];
    const toolsExecuted = [...new Set([
      "agent_execute",
      ...(task.context.metadata?.projectContextDiscovered === true ? ["list_project_files"] : []),
      ...(filesRead.length > 0 ? ["read_project_file"] : []),
      ...toolExecution.toolsExecuted,
      ...(writeResult.written.length > 0 ? ["write_project_file/modify_project_file/patch_project_file puis verify_file"] : []),
    ])];
    const findings = this.extractFindings(resultText);
    const completion = toolExecution.workspace.completionReport(writeResult.written);
    // Contrat de succès par TYPE de tâche (et non par liste de rôles figée) :
    //   - Un rôle sans capacité d'écriture (reviewer, security, researcher, vision)
    //     ne peut JAMAIS être write-required : son succès est analytique/preuves.
    //   - Un rôle capable d'écriture ne l'est que si la tâche demande réellement
    //     une modification (isAnalysisOnlyTask == false).
    // Corrige le faux FAILED d'agents read-only (proofreader en relecture, etc.).
    const writeRequired = roleCanWriteFiles(task.role) && !this.isAnalysisOnlyTask(task);
    const readEvidenceRequired = ["researcher", "planner", "reviewer", "security"].includes(task.role);
    const planningOnly = this.isPlanningOnly(resultText);
    const declaredFailure = this.resultParser.detectFailure(resultText);

    // ── Détection d'erreur préexistante (P1) ────────────────────────────────
    // Une erreur est considérée préexistante si :
    // (a) elle a été détectée avant tout write (enregistrée dans preexistingErrors), OU
    // (b) le no-progress guard a été déclenché ET la sortie mentionne un module/import manquant, OU
    // (c) l'agent a lui-même déclaré un "## Blocage partiel" dans sa réponse finale
    //
    // IMPORTANT : une erreur préexistante n'est pertinente QUE pour les tâches write-required.
    // Pour une tâche d'analyse/lecture, voir une erreur de compilation est normal et attendu
    // (l'agent lit le fichier, voit l'erreur, la signale dans son rapport — c'est un succès).
    const compileErrorPattern = /(?:cannot find module|module not found|error ts\d{3,4}:?|ts\d{4,}:)/i;
    const agentDeclaredPartialBlock = /##\s*blocage\s*partiel/i.test(resultText);
    const hasPreexistingError = writeRequired && (
      toolExecution.preexistingErrors.length > 0 ||
      agentDeclaredPartialBlock ||
      (toolExecution.noProgressAbort && compileErrorPattern.test(
        toolExecution.observations.join("\n") + " " + resultText
      ))
    );

    // ── Détermination de l'outcome ───────────────────────────────────────────
    // Logique de classification :
    //   1. Agent a modifié des fichiers avec validations OK → success ou partial
    //   2. Agent bloqué par une erreur préexistante → blocked
    //   3. Agent write-required, 0 modification, no-progress abort → no_change
    //   4. Agent write-required, 0 modification, pas de no-progress (tâche analyse?) → géré par errors
    //   5. Erreur outil/exception → failed (géré par le catch dans execute())
    let outcome: import("./types.js").TaskOutcome;
    let blockReason: string | undefined;

    if (writeResult.written.length > 0 && writeResult.errors.length === 0) {
      outcome = "success";
    } else if (writeResult.written.length > 0 && writeResult.errors.length > 0) {
      outcome = "partial";
    } else if (hasPreexistingError) {
      outcome = "blocked";
      // Extraire la cause depuis la section ## Blocage partiel si disponible
      const blockSection = resultText.match(/##\s*blocage\s*partiel\s*\n([\s\S]*?)(?=\n##|$)/i)?.[1]?.trim();
      blockReason = blockSection?.slice(0, 300) ??
        toolExecution.preexistingErrors[0] ??
        toolExecution.observations.find(o => compileErrorPattern.test(o))?.slice(0, 200) ??
        "Erreur de compilation préexistante détectée";
    } else if (writeRequired && writeResult.written.length === 0 && toolExecution.noProgressAbort) {
      outcome = "no_change";
    } else if (writeRequired && writeResult.written.length === 0) {
      outcome = "no_change";
    } else {
      // Tâche analytique sans écriture requise (researcher, planner, etc.)
      outcome = findings.length > 0 || filesRead.length > 0 ? "success" : "no_change";
    }

    const errors = [
      ...writeResult.errors.map((error) => `${error.path}: ${error.error}`),
      ...completion.errors,
      ...(declaredFailure ? [`Le rapport final déclare un échec : ${declaredFailure}`] : []),
      ...(planningOnly ? ["La sortie décrit un plan sans résultat d'exécution."] : []),
      // no_change pour une tâche write-required → erreur (empêche le faux succès)
      ...(writeRequired && writeResult.written.length === 0 && outcome !== "blocked"
        ? [toolExecution.noProgressAbort
            ? `Agent interrompu après ${toolExecution.consecutiveReadOnlyTurns} tours sans modification (${toolExecution.filesRead.length} fichier(s) lu(s), 0 modifié).`
            : "Aucun fichier confirmé par write_project_file, modify_project_file ou patch_project_file puis verify_file."
          ]
        : []),
      // blocked : avertissement non-bloquant — la tâche n'est pas un succès mais le problème est externe
      ...(outcome === "blocked" ? [`Bloqué par erreur préexistante : ${blockReason ?? "inconnue"}`] : []),
      ...(readEvidenceRequired && filesRead.length === 0 ? ["Aucun fichier lu : audit impossible à vérifier."] : []),
      ...(readEvidenceRequired && findings.length === 0 ? ["Aucun constat concret fourni."] : []),
    ];

    return {
      filesRead,
      filesModified: writeResult.written,
      toolsExecuted,
      commandsExecuted: [],
      findings,
      workspaceCompletion: completion,
      outcome,
      blockReason,
      verification: {
        passed: errors.length === 0,
        checks: [
          "agent_execute exécuté",
          ...(filesRead.length > 0 ? [`${filesRead.length} fichier(s) lu(s)`] : []),
          ...(writeResult.written.length > 0 ? [`${writeResult.written.length} fichier(s) écrit(s) et vérifié(s)`] : []),
        ],
        errors,
      },
    };
  }

  getIncompleteReason(
    task: AgentTask,
    resultText: string,
    evidence: ReturnType<AgentEvidenceEvaluator["collectEvidence"]>
  ): string | null {
    if (evidence.verification.passed) return null;
    const firstError = evidence.verification.errors[0] ?? "preuves d'exécution insuffisantes";
    return `Tâche "${task.title}" incomplète : ${firstError} Sortie: ${resultText.slice(0, 180).replace(/\s+/g, " ")}`;
  }

  /** Extrait des constats opérationnels, pas les sections de planification. */
  extractFindings(resultText: string): string[] {
    const section = resultText.match(
      /##\s*(?:Résultats vérifiés|Findings|Constats|Détails|Details|Synthèse|Synthese|Propositions?|Recommandations?|Analyse|Audit)\s*\n([\s\S]*?)(?=\n##|$)/i
    )?.[1] ?? "";
    const findings = section
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)]|#{1,4})\s*/, "").trim())
      .filter((line) => line.length >= 12)
      .filter((line) => !/^(?:je vais|je dois|il faut|je commencerai|i will|i need to)/i.test(line))
      .slice(0, 20);

    if (findings.length > 0) return findings;

    // Si aucune section spécifique n'a matché, extraire les lignes informatives du résultat
    return resultText
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)]|#{1,4})\s*/, "").trim())
      .filter((line) => line.length >= 15)
      .filter((line) => !/^(?:je vais|je dois|il faut|je commencerai|i will|i need to)/i.test(line))
      .filter((line) => !line.startsWith("{") && !line.startsWith("<|tool_call>"))
      .slice(0, 20);
  }

  /**
   * Extrait les opérations knowledge_memory_add des observations d'outils.
   * Retourne un tableau d'opérations réussies avec leur fact_id et détails.
   */
  extractMemoryOperations(observations: string[]): Array<{
    tool: string;
    fact_id: string;
    message: string;
    timestamp: string;
  }> {
    const operations: Array<{ tool: string; fact_id: string; message: string; timestamp: string }> = [];

    // Pattern plus robuste qui gère les variations d'espaces et d'ordre des clés
    const memoryAddPattern = /- knowledge_memory_add: succès — \{[^}]*"status"\s*:\s*"success"[^}]*"fact_id"\s*:\s*"([^"]+)"[^}]*"message"\s*:\s*"([^"]+)"[^}]*\}/g;

    for (const obs of observations) {
      let match: RegExpExecArray | null;
      while ((match = memoryAddPattern.exec(obs)) !== null) {
        operations.push({
          tool: "knowledge_memory_add",
          fact_id: match[1],
          message: match[2],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return operations;
  }

  /**
   * Détecte si une tâche est purement analytique/lecture/rédactionnelle et ne requiert donc pas d'écriture de fichier de code.
   * Utilisé pour assouplir le vérificateur writeRequired.
   */
  isAnalysisOnlyTask(task: AgentTask): boolean {
    const text = `${task.title} ${task.description} ${task.context.instructions ?? ""}`.toLowerCase();
    // Si le titre/description mentionne explicitement une modification/écriture de code ou contenu
    const writingSignal = /\b(?:modifier|écriture|écrire|amélio|refactor|implément|créer|créa|ajust|corriger|correct|optimis|rédig|fix|update|write|patch|modify|create|improve|write_project_file|apply_patch|patch_project_file|modify_project_file)\b/i;
    if (writingSignal.test(text)) return false;
    // Mots-clés indiquant une tâche d'analyse pure, relecture, proposition, synthèse,
    // rapport, recommandation, audit, vérification, critique, traduction/évaluation.
    const analysisSignal = /\b(?:analys|inspect|audit|review|revue|relecture|relire|relis|check|vérif|verif|read|lire|analyser|examin|rapport|report|résumé|resume|summary|synth|checkpoint\s+git|identifier|propos|proposition|suggestion|recommand|conseil|avis|critique|évalu|evalu|classif)\b/i;
    return analysisSignal.test(text);
  }

  isPlanningOnly(resultText: string): boolean {
    const prose = resultText.replace(/^\s*#{1,6}.*$/gm, "").trim();
    // Si le texte contient un appel d'outil (JSON ou format provider), ce n'est pas un plan seul
    if (/\{"tool_calls"\s*:|<\|tool_call>|```[\w]*:[^\n]+\n/i.test(resultText)) return false;
    const planningSignal = /\b(?:je vais|je dois|je commencerai|il faut|je vais commencer|i will|i need to|i should)\b/i;
    const executionSignal = /\b(?:corrig(?:é|ée|és|ées)?|modifi(?:é|ée|és|ées)?|cré(?:é|ée|és|ées)?|écrit|exécut(?:é|ée|és|ées)?|vérifi(?:é|ée|és|ées)?|lu|analys(?:é|ée|és|ées)?|identifi(?:é|ée|és|ées)?|trouv(?:é|ée|és|ées)?|fixed|modified|created|wrote|ran|verified|read|reviewed)\b/i;
    return planningSignal.test(prose) && !executionSignal.test(prose);
  }
}
