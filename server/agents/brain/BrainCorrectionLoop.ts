import { randomUUID } from "crypto";
import type {
  BrainStage,
  StageVerification,
  BrainCorrectionAttempt,
  GoalUnderstanding,
} from "./types.js";
import type { AgentRole } from "../types.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("BrainCorrectionLoop");

export class BrainCorrectionLoop {
  private readonly maxAttempts: number;

  constructor(maxAttempts = 3) {
    this.maxAttempts = maxAttempts;
  }

  /**
   * Diagnostique l'échec et crée une tentative de correction ciblée
   */
  createCorrection(
    stage: BrainStage,
    verification: StageVerification,
    currentAttemptNumber: number,
    understanding: GoalUnderstanding
  ): BrainCorrectionAttempt | null {
    if (currentAttemptNumber > this.maxAttempts) {
      log.warn(`🛑 Budget de correction épuisé pour l'étape ${stage.id} (${currentAttemptNumber}/${this.maxAttempts})`);
      return null;
    }

    log.info(`🔧 Élaboration d'une correction autonome (tentative ${currentAttemptNumber}/${this.maxAttempts}) pour ${stage.id}`);

    const errorIssues = verification.issues.filter((i) => i.severity === "error" || i.severity === "critical");
    const diagnostic = errorIssues.map((i) => i.message).join("\n- ");
    const affectedFiles = errorIssues.map((i) => i.file).filter((f): f is string => Boolean(f));

    // Sélection de l'agent le plus adapté pour corriger
    let targetRole: AgentRole = "coder";
    if (diagnostic.includes("syntax") || diagnostic.includes("accolade")) {
      targetRole = "coder";
    } else if (diagnostic.includes("anomalie") || diagnostic.includes("visuel") || diagnostic.includes("débordement")) {
      targetRole = "coder"; // Le coder corrige le CSS/layout
    } else if (stage.agentRole === "tester") {
      targetRole = "debugger";
    }

    const correctiveInstructions = [
      `CORRECTION REQUISE suite à l'échec de vérification de l'étape : "${stage.title}".`,
      `OBJECTIF INITIAL : "${understanding.intent}"`,
      `DIAGNOSTIC DE L'ANOMALIE :`,
      `- ${diagnostic}`,
      affectedFiles.length > 0 ? `FICHIERS À CORRIGER : ${affectedFiles.join(", ")}` : "",
      `CONSIGNE : Répare directement les anomalies identifiées sans casser les fonctionnalités existantes.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      id: randomUUID(),
      attemptNumber: currentAttemptNumber,
      failedStageId: stage.id,
      targetRole,
      diagnostic,
      correctiveInstructions,
      filesToFix: affectedFiles.length > 0 ? affectedFiles : stage.files,
      resolved: false,
      timestamp: new Date().toISOString(),
    };
  }
}
