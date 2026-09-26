import * as fs from "fs";
import * as path from "path";
import type {
  BrainStage,
  StageVerification,
  VerificationIssue,
  GoalUnderstanding,
} from "./types.js";
import { checkBracketBalance } from "../../skills/verify.js";
import { getProjectRoot } from "../../skills/codebaseHelpers.js";
import { WorkspaceState, type VerificationRecord } from "../WorkspaceState.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("BrainVerifier");

/** Exécute un outil isolé (contrat aligné sur `AgentTaskRunner.runTool`). */
export type BrainToolRunner = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export class BrainVerifier {
  /**
   * Runner d'outils optionnel. S'il est fourni, la vérification d'étape passe
   * par la MÊME discipline que le runtime agentique : `verify_file` produit un
   * `VerificationRecord` hashé, enregistré dans un `WorkspaceState`, et l'étape
   * ne passe que si chaque fichier modifié est `verified` avec un hash courant
   * concordant. Sans runner, on retombe sur les contrôles superficiels
   * (équilibre de crochets + heuristiques de rôle) — compatibilité ascendante.
   */
  constructor(private readonly runTool?: BrainToolRunner) {}

  /**
   * Vérifie le résultat d'une étape individuelle du Brain
   */
  async verifyStage(
    stage: BrainStage,
    _understanding: GoalUnderstanding,
    filesModified: string[]
  ): Promise<StageVerification> {
    log.info(`🔍 Vérification de l'étape ${stage.id} (Agent: ${stage.agentRole})`);

    const issues: VerificationIssue[] = [];
    let syntaxCheckOk = true;
    let testsOk = true;
    let visualCheckOk = true;
    let semanticCheckOk = true;

    // 1. Vérification du code (syntaxe, équilibre)
    const codeCheck = this.verifyModifiedFiles(filesModified);
    if (!codeCheck.ok) {
      syntaxCheckOk = false;
      issues.push(...codeCheck.issues);
    }

    // 1bis. Vérification HASHÉE des fichiers modifiés (si un runner est injecté).
    // Aligne le Brain sur la discipline WorkspaceState du runtime agentique :
    // une étape qui a écrit des fichiers ne passe que si chacun est vérifié avec
    // un hash concordant. On ne vérifie que les fichiers réellement écrits par
    // cette étape (intersection avec stage.result.filesModified quand dispo).
    if (this.runTool && filesModified.length > 0) {
      const stageFiles: string[] = Array.isArray(stage.result?.filesModified) && stage.result!.filesModified!.length > 0
        ? stage.result!.filesModified!.filter((f) => filesModified.includes(f))
        : filesModified;
      const hashCheck = await this.verifyModifiedFilesHashed(stageFiles);
      if (!hashCheck.ok) {
        syntaxCheckOk = false;
        issues.push(...hashCheck.issues);
      }
    }

    // 2. Vérification spécifique par rôle
    if (stage.agentRole === "coder" || stage.agentRole === "refactor" || stage.agentRole === "debugger") {
      if (filesModified.length === 0 && stage.result?.filesModified?.length === 0) {
        issues.push({
          severity: "warning",
          message: `L'agent ${stage.agentRole} s'est achevé sans modifier de fichier.`,
        });
      }
    }

    if (stage.agentRole === "vision") {
      // Pour l'agent vision, vérifier que le responsive ou le layout a bien été inspecté
      const output = stage.result?.details ?? stage.result?.summary ?? "";
      if (/invalide|erreur visuelle|débordement|overflow|cassé/i.test(output)) {
        visualCheckOk = false;
        issues.push({
          severity: "error",
          message: "L'agent vision a signalé une anomalie de mise en page ou un débordement visuel.",
        });
      }
    }

    // 3. Vérification des erreurs explicites de l'agent
    if (stage.result && !stage.result.success) {
      semanticCheckOk = false;
      issues.push({
        severity: "error",
        message: stage.result.error || "L'agent a retourné un statut d'échec.",
      });
    }

    const hasErrors = issues.some((i) => i.severity === "error" || i.severity === "critical");
    const passed = !hasErrors;

    const summary = passed
      ? `✅ Étape ${stage.id} (${stage.agentRole}) vérifiée avec succès.`
      : `❌ Vérification échouée pour l'étape ${stage.id} (${stage.agentRole}) : ${issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ")}`;

    return {
      stageId: stage.id,
      role: stage.agentRole,
      passed,
      syntaxCheckOk,
      testsOk,
      visualCheckOk,
      semanticCheckOk,
      issues,
      summary,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Vérifie l'intégrité syntaxique des fichiers modifiés
   */
  private verifyModifiedFiles(files: string[]): { ok: boolean; issues: VerificationIssue[] } {
    const issues: VerificationIssue[] = [];
    const root = getProjectRoot();

    for (const file of files) {
      try {
        const fullPath = path.isAbsolute(file) ? file : path.join(root, file);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, "utf-8");

        // Contrôle de l'équilibre des balises / accolades
        const balanceErr = checkBracketBalance(content);
        if (balanceErr) {
          issues.push({
            severity: "error",
            file,
            message: `Erreur syntaxique d'équilibrage dans ${file} : ${balanceErr}`,
            rule: "syntax_bracket_balance",
          });
        }
      } catch (err: any) {
        issues.push({
          severity: "warning",
          file,
          message: `Impossible de relire le fichier pour vérification: ${err.message}`,
        });
      }
    }

    return {
      ok: !issues.some((i) => i.severity === "error"),
      issues,
    };
  }

  /**
   * Vérification hashée via `verify_file` + `WorkspaceState` (chemin injecté).
   * Chaîne : reread(hash) → verify_file → VerificationRecord → recordVerification
   * → l'étape ne passe que si le fichier est `verified` avec hash concordant.
   */
  private async verifyModifiedFilesHashed(
    files: string[]
  ): Promise<{ ok: boolean; issues: VerificationIssue[] }> {
    const issues: VerificationIssue[] = [];
    const runTool = this.runTool!;
    const root = getProjectRoot();

    const workspace = new WorkspaceState(async (p: string) => {
      const full = path.isAbsolute(p) ? p : path.join(root, p);
      return fs.readFileSync(full, "utf-8");
    });

    for (const file of [...new Set(files)]) {
      try {
        // 1. Relecture + hash de l'état courant sur disque.
        await workspace.reread(file, "read");

        // 2. Vérification hashée par l'outil.
        const res = (await runTool("verify_file", { path: file })) as
          | { verificationRecord?: unknown } | undefined;
        const record = this.asVerificationRecord(res?.verificationRecord);

        if (!record) {
          workspace.markError(file, "verify_file n'a pas retourné de preuve hashée.");
          issues.push({
            severity: "error",
            file,
            message: `Vérification hashée impossible pour ${file} (aucun VerificationRecord).`,
            rule: "hash_verification_missing",
          });
          continue;
        }

        // 3. Enregistrement de la preuve et contrôle du hash.
        workspace.recordVerification(file, record);
        const state = workspace.get(file);
        const verified = state?.status === "verified" && state.verifiedHash === state.contentHash;

        if (!verified) {
          issues.push({
            severity: "error",
            file,
            message:
              `Vérification hashée non concluante pour ${file} ` +
              `(status ${state?.status ?? "absent"}; ${record.allIssues.slice(0, 2).map((i) => i.message).join("; ")}).`,
            rule: "hash_verification_failed",
          });
        }
      } catch (err) {
        issues.push({
          severity: "warning",
          file,
          message: `Vérification hashée en erreur pour ${file}: ${(err as Error).message}`,
        });
      }
    }

    return { ok: !issues.some((i) => i.severity === "error"), issues };
  }

  /** Type guard : un objet est-il un VerificationRecord structuré et hashé ? */
  private asVerificationRecord(value: unknown): VerificationRecord | null {
    if (!value || typeof value !== "object") return null;
    const r = value as Partial<VerificationRecord>;
    if (
      typeof r.contentHash === "string" &&
      typeof r.hashBefore === "string" &&
      typeof r.hashAfter === "string" &&
      typeof r.ok === "boolean" &&
      ["success", "failed", "stale"].includes(r.status ?? "")
    ) {
      return r as VerificationRecord;
    }
    return null;
  }
}
