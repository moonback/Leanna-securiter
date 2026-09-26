/**
 * GeneratedFileWriter — Extrait et écrit les fichiers générés par les agents
 *
 * Responsabilité unique : parser la sortie texte d'un agent et matérialiser
 * les fichiers identifiés sur le disque via le SkillHandler.
 *
 * Supporte 3 formats d'extraction (par ordre de priorité) :
 * 1. ```lang:path/to/file.ts\n...content...\n```
 * 2. ## Fichier: path/to/file.ts\n```lang\n...content...\n```
 * 3. JSON structuré { "files": [{ "path": "...", "content": "..." }] }
 */
import type { AgentTask } from "./types.js";
import { getAgentDefinitionOrThrow } from "./roles.js";
import { createLogger } from "../utils/logger.js";
import { checkBracketBalance, checkTypeScriptSyntax } from "../skills/verify.js";

const log = createLogger("FileWriter");

/** Handler externe pour écrire les fichiers */
type SkillHandler = (name: string, args: any) => Promise<any>;

export interface FileValidationError {
  path: string;
  error: string;
}

export interface WriteFromOutputResult {
  written: string[];
  errors: FileValidationError[];
}

export class GeneratedFileWriter {
  constructor(private skillHandler: SkillHandler | null) {}

  /** Met à jour le handler (si reconfiguré dynamiquement) */
  setSkillHandler(handler: SkillHandler): void {
    this.skillHandler = handler;
  }

  /**
   * Extrait les fichiers générés depuis la sortie de l'agent
   * et les écrit sur disque via write_project_file.
   *
   * @returns Résultat avec les fichiers écrits et les erreurs de validation
   */
  async writeFromAgentOutput(task: AgentTask, resultText: string): Promise<WriteFromOutputResult> {
    if (!this.skillHandler) return { written: [], errors: [] };

    const agent = getAgentDefinitionOrThrow(task.role);

    // Vérifier que l'agent a la capacité d'écrire des fichiers
    if (!agent.capabilities.includes("write_project_file")) {
      log.debug(`Agent "${agent.name}" est en lecture seule — pas d'écriture de fichiers`);
      return { written: [], errors: [] };
    }

    // Essayer chaque pattern dans l'ordre de fiabilité
    let result = await this.extractPattern1(agent.name, resultText);
    if (result.written.length === 0 && result.errors.length === 0) {
      result = await this.extractPattern2(agent.name, resultText);
    }
    if (result.written.length === 0 && result.errors.length === 0) {
      result = await this.extractPatternJson(agent.name, resultText);
    }

    if (result.written.length === 0 && result.errors.length === 0) {
      log.warn(
        `Aucun fichier extrait de la sortie de "${agent.name}" — pas de code formaté détecté. ` +
        `Extrait (300 premiers chars): ${resultText.slice(0, 300)}`
      );
    } else {
      log.info(`${result.written.length} fichier(s) écrit(s), ${result.errors.length} rejeté(s) par "${agent.name}"`);
    }

    return result;
  }

  // ─── Pattern 1: ```lang:chemin/fichier.ext ────────────────────────────────

  private async extractPattern1(agentName: string, text: string): Promise<WriteFromOutputResult> {
    const pattern = /```[\w]*:([^\n]+)\n([\s\S]*?)```/g;
    const written: string[] = [];
    const errors: FileValidationError[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2];
      if (!filePath || !content) continue;
      const error = await this.writeFile(agentName, filePath, content);
      if (error) errors.push({ path: filePath, error });
      else written.push(filePath);
    }

    return { written, errors };
  }

  // ─── Pattern 2: ## Fichier: chemin/fichier.ext ────────────────────────────

  private async extractPattern2(agentName: string, text: string): Promise<WriteFromOutputResult> {
    const pattern = /##?\s*(?:Fichier|File|Création|Output)\s*[:：]\s*`?([^\n`]+)`?\s*\n```[\w]*\n([\s\S]*?)```/gi;
    const written: string[] = [];
    const errors: FileValidationError[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2];
      if (!filePath || !content) continue;
      const error = await this.writeFile(agentName, filePath, content);
      if (error) errors.push({ path: filePath, error });
      else written.push(filePath);
    }

    return { written, errors };
  }

  // ─── Pattern 3: JSON structuré ────────────────────────────────────────────

  private async extractPatternJson(agentName: string, text: string): Promise<WriteFromOutputResult> {
    const written: string[] = [];
    const errors: FileValidationError[] = [];

    // Localiser la clé puis extraire son objet englobant sans regex gloutonne.
    const filesKeyIdx = text.indexOf('"files"');
    if (filesKeyIdx === -1) return { written, errors };

    const objectStart = text.lastIndexOf("{", filesKeyIdx);
    if (objectStart === -1) return { written, errors };

    const jsonText = this.extractBalancedJsonObject(text, objectStart);
    if (!jsonText) return { written, errors };

    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          if (f.path && f.content) {
            const error = await this.writeFile(agentName, f.path, f.content);
            if (error) errors.push({ path: f.path, error });
            else written.push(f.path);
          }
        }
      }
    } catch {
      // JSON invalide — on ignore silencieusement
    }

    return { written, errors };
  }

  /** Extrait un objet JSON équilibré en ignorant les accolades dans les chaînes. */
  private extractBalancedJsonObject(text: string, startIdx: number): string | null {
    if (text[startIdx] !== "{") return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(startIdx, i + 1);
      }
    }

    return null;
  }

  // ─── Helper interne ───────────────────────────────────────────────────────

  private async writeFile(agentName: string, path: string, content: string): Promise<string | null> {
    // ── Validation AVANT écriture ──
    if (!content.trim()) {
      return `contenu vide — écriture refusée`;
    }

    const isTsLike = /\.tsx?$/.test(path);
    if (isTsLike) {
      const bracketError = checkBracketBalance(content);
      const syntaxError = checkTypeScriptSyntax(content, path);
      if (syntaxError) {
        log.error(`[${agentName}] Validation échouée pour ${path}: ${syntaxError}`);
        return syntaxError;
      }
      if (bracketError) {
        log.warn(`[${agentName}] Précheck de crochets non bloquant pour ${path}: ${bracketError}`);
      }
    }

    try {
      log.debug(`[${agentName}] Écriture: ${path} (${content.length} chars)`);
      const writeResult = await this.skillHandler!("write_project_file", { path, content });
      if (!writeResult || writeResult.error || writeResult.status !== "success") {
        const message = writeResult?.error || writeResult?.message || "écriture non confirmée";
        log.error(`[${agentName}] Écriture refusée pour ${path}: ${message}`);
        return `écriture refusée: ${message}`;
      }

      const verification = await this.skillHandler!("verify_file", { path }).catch((err) => ({
        status: "failed",
        message: (err as Error).message,
      }));
      if (verification?.status !== "success" || verification?.ok === false || verification?.error) {
        const report = JSON.stringify(verification, null, 2).slice(0, 5000);
        const message = verification?.message || verification?.error || "post-validation échouée";
        log.error(`[${agentName}] Post-validation échouée pour ${path}: ${message}`);
        return `post-validation échouée: ${message}\nRapport verify_file:\n${report}`;
      }
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }
}
