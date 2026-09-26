/**
 * ResultParser — Stub de compatibilité
 * 
 * Extrait le résumé, les suggestions et normalise la sortie des agents.
 * Ce fichier existe uniquement pour que AgentExecutor.ts continue à fonctionner.
 */

export class ResultParser {
  /**
   * Normalise le résultat brut de reasoning_think en texte exploitable.
   */
  normalizeResult(thinkResult: any): string {
    if (!thinkResult) return "";
    if (typeof thinkResult === "string") return thinkResult;
    // reasoning_think retourne { thought, answer, reasoning }
    return thinkResult.answer || thinkResult.reasoning || thinkResult.thought || JSON.stringify(thinkResult);
  }

  /**
   * Extrait un résumé court de la sortie de l'agent.
   */
  extractSummary(text: string): string {
    // Chercher ## Résumé
    const summaryMatch = text.match(/## Résumé\n([\s\S]*?)(?=\n##|$)/);
    if (summaryMatch) {
      return summaryMatch[1].trim().slice(0, 500);
    }
    // Fallback: premiers paragraphes non vides
    const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    return lines.slice(0, 3).join(" ").slice(0, 500);
  }

  /**
   * Extrait les suggestions/recommandations de la sortie.
   */
  extractSuggestions(text: string): string[] | undefined {
    const sugMatch = text.match(/## Recommandations([\s\S]*?)(?=\n##|$)/);
    if (!sugMatch) return undefined;

    const lines = sugMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter(Boolean);

    return lines.length > 0 ? lines : undefined;
  }

  /**
   * Détecte une déclaration d'échec irréfutable dans le rapport final du modèle.
   *
   * Règle stricte : on ne refuse QUE si l'agent déclare explicitement
   * "Vérification : FAIL" (dans la section preuves) ou un titre ## Échec / ## FAIL.
   * Un texte honnête comme "aucune modification n'a pu être appliquée dans ce tour"
   * ou "tâche incomplète" n'est PAS considéré comme un marqueur d'échec — cela sera
   * géré par writeRequired dans collectEvidence sans dupliquer le message d'erreur.
   */
  detectFailure(text: string): string | null {
    // 1. Marqueur dans la section Preuves d'exécution : "Vérification : FAIL"
    const strictFail = text.match(
      /[-•]\s*vérification\s*:\s*(?:FAIL|ÉCHEC|ECHEC)\b/i
    );
    if (strictFail) return "Le rapport final déclare explicitement une vérification en échec.";

    // 2. Titre de section d'échec irréfutable (## Échec / ## FAIL / ## Blocage)
    //    Ne pas capturer ## Incomplet, ## Tâche incomplète, ## Résultats vérifiés, etc.
    const failHeader = text.match(
      /(?:^|\n)\s*##\s+(?:Échec|Echec|FAIL)\b/i
    );
    if (failHeader) return failHeader[0].trim().replace(/^#+\s*/, "").slice(0, 200);

    return null;
  }
}
