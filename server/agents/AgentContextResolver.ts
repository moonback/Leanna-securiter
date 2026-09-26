/**
 * AgentContextResolver — Résolution et lecture du contexte fichier d'une tâche
 *
 * Responsabilité unique : déterminer quels fichiers du dépôt fournir en contexte
 * à l'agent, puis lire leur contenu. La découverte de l'inventaire est réservée
 * aux agents autorisés à `list_project_files` et ne modifie jamais les fichiers.
 *
 * Le résolveur ne détient aucun handler de skills : il reçoit une fonction
 * `callTool` (déjà bornée par timeout) via son constructeur, ce qui garde
 * l'`AgentExecutor` propriétaire du `SkillHandler`.
 */
import type { AgentTask } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AgentContextResolver");

/** Appelle un outil du workspace (déjà borné par timeout). */
export type ToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<any>;

export class AgentContextResolver {
  constructor(private readonly callTool: ToolCaller) {}

  /**
   * Résout un contexte explicite, ou découvre une sélection bornée et stable du
   * dépôt pour les audits. La découverte est réservée aux agents autorisés à
   * lister le projet et ne modifie jamais les fichiers.
   */
  async resolveContextFiles(task: AgentTask, capabilities: string[]): Promise<string[]> {
    const mentionedFiles = this.extractMentionedFiles(task);
    const hardExplicitFiles: string[] = [...new Set(task.context.files)].filter(Boolean) as string[];

    // Si des fichiers explicites sont fournis par l'appelant (pas extraits), les utiliser directement
    if (hardExplicitFiles.length > 0 && !capabilities.includes("list_project_files")) {
      return hardExplicitFiles.slice(0, 10) as string[];
    }

    // Toujours découvrir l'inventaire pour résoudre les noms partiels/fuzzy
    if (!capabilities.includes("list_project_files")) {
      return hardExplicitFiles.slice(0, 10) as string[];
    }

    try {
      const inventory = await this.callTool("list_project_files", { path: ".", recursive: true });
      if (inventory?.status !== "success" || !Array.isArray(inventory.files)) {
        log.warn(`[${task.id.slice(0, 8)}] Découverte de contexte indisponible: ${inventory?.error ?? inventory?.message ?? "réponse invalide"}`);
        return hardExplicitFiles.slice(0, 10) as string[];
      }

      const allFiles: string[] = inventory.files;

      // Résoudre les fichiers mentionnés via fuzzy matching dans l'inventaire
      const resolvedMentioned = mentionedFiles
        .map((mentioned) => this.fuzzyResolveFile(mentioned, allFiles))
        .filter(Boolean) as string[];

      // Combiner : fichiers explicites + fichiers résolus + sélection structurante
      const priorityFiles = [...new Set([...hardExplicitFiles, ...resolvedMentioned])];

      if (priorityFiles.length >= 10) {
        const selected: string[] = priorityFiles.slice(0, 10);
        task.context.files = selected;
        log.info(`[${task.id.slice(0, 8)}] Contexte explicite résolu: ${selected.length} fichier(s)`);
        return selected;
      }

      const selectedFiles = this.selectProjectFiles(allFiles, task, resolvedMentioned);
      task.context.files = selectedFiles;
      task.context.metadata = {
        ...task.context.metadata,
        projectContextDiscovered: true,
        projectFileCount: inventory.count,
      };
      log.info(`[${task.id.slice(0, 8)}] Contexte projet découvert: ${selectedFiles.length}/${inventory.count} fichier(s) sélectionné(s)`);
      return selectedFiles as string[];
    } catch (error) {
      log.warn(`[${task.id.slice(0, 8)}] Échec de découverte du contexte: ${(error as Error).message}`);
      return hardExplicitFiles.slice(0, 10) as string[];
    }
  }

  /** Résout un nom de fichier partiel ou casé différemment dans l'inventaire. */
  fuzzyResolveFile(mentioned: string, allFiles: string[]): string | null {
    const normalized = mentioned.replace(/\\/g, "/").toLowerCase();
    // Exact match
    const exact = allFiles.find((file) => file.replace(/\\/g, "/") === mentioned);
    if (exact) return exact;
    // Case-insensitive suffix match
    const suffixMatch = allFiles.find((file) => {
      const fileLower = file.replace(/\\/g, "/").toLowerCase();
      return fileLower.endsWith("/" + normalized) || fileLower === normalized;
    });
    return suffixMatch ?? null;
  }

  /** Extrait les chemins de fichiers mentionnés dans le titre et la description de la tâche. */
  extractMentionedFiles(task: AgentTask): string[] {
    const text = `${task.title} ${task.description} ${task.context.instructions ?? ""}`;
    // Chercher des patterns de fichiers courants (avec extension)
    const filePattern = /(?:^|\s|["'`([\]])([a-zA-Z0-9_/\\.-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|vue|py|rs|go))\b/gi;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(text)) !== null) {
      const candidate = match[1].replace(/\\/g, "/");
      if (!candidate.startsWith(".") && !candidate.includes("node_modules")) {
        matches.push(candidate);
      }
    }
    return [...new Set(matches)];
  }

  /** Conserve les fichiers d'entrée utiles sans dépasser le budget de contexte. */
  selectProjectFiles(files: string[], _task: AgentTask, resolvedMentioned: string[] = []): string[] {
    const preferredFiles = [
      ...resolvedMentioned,
      "package.json",
      "tsconfig.json",
      "README.md",
      "server-bootstrap.ts",
      "server.ts",
      "server/agents/AgentExecutor.ts",
      "server/agents/AgentOrchestrator.ts",
      "server/skills/agents.ts",
    ];
    const preferredRank = new Map(preferredFiles.map((file, index) => [file.replace(/\\/g, "/"), index]));
    const normalizedFiles = [...new Set(files.map((file) => file.replace(/\\/g, "/")))]
      .filter((file) => !file.startsWith(".git/") && !file.startsWith(".Leanna/") && !file.includes("/node_modules/"));

    return normalizedFiles
      .sort((left, right) => {
        const leftRank = preferredRank.get(left) ?? preferredFiles.length + 999;
        const rightRank = preferredRank.get(right) ?? preferredFiles.length + 999;
        return leftRank - rightRank || left.localeCompare(right);
      })
      .slice(0, 10);
  }

  async readContextFiles(files: string[]): Promise<string[]> {
    const fileContents: string[] = [];
    for (const [index, file] of files.slice(0, 10).entries()) {
      try {
        // Le premier fichier est le fichier principal résolu par la tâche :
        // injecter son contenu complet évite que le modèle travaille sur une
        // simple fenêtre startLine/endLine ou sur les 50 premières lignes.
        const content = await this.callTool("read_project_file", {
          path: file,
          ...(index === 0 ? { full: true } : {}),
        });
        if (content && typeof content === "object" && content.content) {
          fileContents.push(`--- ${file} ---\n${content.content}`);
        }
      } catch (err) {
        log.debug(`Échec lecture: ${file} — ${(err as Error).message}`);
      }
    }
    log.debug(`Fichiers lus: ${fileContents.length}/${files.length}; principal=${files[0] ?? "aucun"}`);
    return fileContents;
  }
}
