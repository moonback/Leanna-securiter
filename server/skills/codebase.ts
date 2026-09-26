import { Skill } from "./base.js";
import fs from "fs";
import { normalizeProjectPath } from "./codebaseHelpers.js";

import {
  handleGenerateCodebaseMarkdown,
  handleListProjectFiles,
  handleReadProjectFile,
  handleReadFileOutline,
  handleSearchInFiles,
  handleAnalyzeProjectFile,
  handleGetWorkspaceInfo
} from "./codebaseReader.js";

import {
  handleWriteProjectFile,
  handleModifyProjectFile,
  handlePatchProjectFile,
  handleApplyPatch,
  handleRenameProjectFile,
  handleDeleteProjectFile,
  handleDeleteProjectFolder,
  handleCreateProjectDirectory
} from "./codebaseWriter.js";

export const codebaseSkill: Skill = {
  name: "codebase",
  // Permissions déclarées explicitement, appliquées au runtime par le ToolRegistry.
  // Par défaut lecture ; les outils modifiant le workspace requièrent "write".
  permissions: ["read"],
  toolPermissions: {
    generate_codebase_markdown: ["read", "write"],
    open_ide: ["read"],
    open_project_file: ["read"],
    list_project_files: ["read"],
    read_project_file: ["read"],
    read_file_outline: ["read"],
    search_in_files: ["read"],
    analyze_project_file: ["read"],
    get_workspace_info: ["read"],
    write_project_file: ["write"],
    modify_project_file: ["write"],
    apply_patch: ["write"],
    patch_project_file: ["write"],
    rename_project_file: ["write"],
    delete_project_file: ["write"],
    delete_project_folder: ["write"],
    create_project_directory: ["write"],
  },
  declarations: [
    {
      name: "generate_codebase_markdown",
      description: "Generates or updates the codebase.md file with the project structure and code excerpts. Optionally analyzes it via OpenRouter.",
      parameters: {
        type: "OBJECT",
        properties: {
          includePreview: { type: "BOOLEAN", description: "Include code excerpts in codebase.md. Default true." },
          analyzeWithOpenRouter: { type: "BOOLEAN", description: "Analyze with OpenRouter Free model. Default true." },
        },
      },
    },
    {
      name: "open_ide",
      description: "Opens the IDE interface in the application. Call this before file operations when the IDE is not yet visible.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "open_project_file",
      description: "Opens a file in the IDE and positions the cursor at a specific line. Use this to show a file visually after editing it.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative path from project root (e.g. src/App.tsx)." },
          line: { type: "NUMBER", description: "Line number to jump to (optional, 1-based)." },
          column: { type: "NUMBER", description: "Column number (optional, 1-based)." },
        },
        required: ["path"],
      },
    },
    {
      name: "list_project_files",
      description: "Lists files and folders in a project directory. Use this to explore the structure before reading or editing files.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative directory path to list (e.g. src/components). Use '.' for root." },
          recursive: { type: "BOOLEAN", description: "Recursively list all subdirectories. Default false." },
          extensions: { type: "STRING", description: "Comma-separated extensions to filter (e.g. 'ts,tsx'). Optional." },
          includeStats: { type: "BOOLEAN", description: "Include file modification date and creation date. Default false." },
        },
      },
    },
    {
      name: "read_project_file",
      description: "Reads a file from the project workspace. For large files, use startLine/endLine to read only the relevant section, OR set full=true to force reading the entire file with line numbers. Use read_file_outline first to identify which lines to read.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative path from project root (e.g. src/App.tsx)." },
          startLine: { type: "NUMBER", description: "First line to read (1-based). Use this for large files to avoid reading everything." },
          endLine: { type: "NUMBER", description: "Last line to read (1-based). Recommended: read ±20 lines around the area to modify." },
          full: { type: "BOOLEAN", description: "Si true, retourne le fichier complet avec numéros de ligne. Indispensable avant modify_project_file ou patch_project_file sur un fichier volumineux." },
        },
        required: ["path"],
      },
    },
    {
      name: "read_file_outline",
      description: "Returns the structure of a file: exports, functions, classes, interfaces, and their line numbers. Use this BEFORE read_project_file to identify which section to read. Much cheaper in tokens than reading the full file.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative path from project root (e.g. src/App.tsx)." },
        },
        required: ["path"],
      },
    },
    {
      name: "search_in_files",
      description: "Searches for text or a pattern across project files. Returns matching files with line number, column, and optional context. Use to find where a function, class or variable is used. By default, the query is treated as literal text. Set regex:true for regex mode. Set replaceWith to preview what a replacement would look like.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Text or regex pattern to search for. Treated as literal text by default." },
          path: { type: "STRING", description: "Directory or file to search in (optional, defaults to project root)." },
          extensions: { type: "STRING", description: "Comma-separated file extensions to filter (e.g. 'ts,tsx,js'). Optional." },
          caseSensitive: { type: "BOOLEAN", description: "Case-sensitive search. Default false." },
          regex: { type: "BOOLEAN", description: "If true, treat query as a regular expression. Default false (literal text search)." },
          maxResults: { type: "NUMBER", description: "Maximum number of results (max 100). Default 20." },
          contextLines: { type: "NUMBER", description: "Number of lines of context to show before and after each match (0–10). Default 0." },
          replaceWith: { type: "STRING", description: "If provided, shows a preview of what each matching line would look like after replacing query with this string." },
        },
        required: ["query"],
      },
    },
    {
      name: "analyze_project_file",
      description: "Analyzes a file and returns metadata (line count, size, extension) and a content preview.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative path from project root (e.g. src/App.tsx)." },
        },
        required: ["path"],
      },
    },
    {
      name: "write_project_file",
      description: "Crée un nouveau fichier ou écrase un fichier existant avec le contenu fourni. Utilise append:true pour ajouter du contenu à la fin sans écraser.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif depuis la racine du projet (ex: src/newFile.ts, docs/README.md)." },
          content: { type: "STRING", description: "Contenu complet du fichier à écrire." },
          append: { type: "BOOLEAN", description: "Si true, ajoute le contenu à la fin du fichier existant au lieu de l'écraser. Pratique pour ajouter des lignes à un fichier log, config ou markdown." },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "modify_project_file",
      description: "Modifie un fichier existant par remplacement de texte exact. Deux modes: 1) searchText exact (copié depuis read_project_file), 2) startMarker/endMarker (le backend extrait le bloc entre les deux marqueurs).",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif du fichier à modifier." },
          searchText: { type: "STRING", description: "Texte exact à trouver et remplacer (espaces et indentation doivent correspondre). Si absent, utiliser startMarker/endMarker." },
          replaceText: { type: "STRING", description: "Nouveau texte pour remplacer searchText. Vide '' pour supprimer." },
          replaceAll: { type: "BOOLEAN", description: "Si true, remplace toutes les occurrences. Par défaut false (première occurrence)." },
          startMarker: { type: "STRING", description: "Alternative à searchText: première ligne/texte qui COMMENCE le bloc à remplacer." },
          endMarker: { type: "STRING", description: "Alternative à searchText: dernière ligne/texte qui TERMINE le bloc à remplacer." },
        },
        required: ["path", "replaceText"],
      },
    },
    {
      name: "apply_patch",
      description: "Applique un diff unifié (format git diff) sur un fichier. Le contexte des hunks doit correspondre exactement au contenu courant du fichier.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif du fichier cible." },
          patch: { type: "STRING", description: "Diff unifié complet avec lignes ---/+++/@@." },
        },
        required: ["path", "patch"],
      },
    },
    {
      name: "patch_project_file",
      description: "Patche un fichier via des opérations par ligne (replace, insert, delete). Les opérations sont réordonnées et appliquées de bas en haut pour garder les numéros de ligne stables. Les plages ne doivent PAS se chevaucher.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative path of the file to modify." },
          operations: {
            type: "ARRAY",
            description: "Array of patch operations to apply in order. Each operation has: type ('replace'|'insert'|'delete'), startLine (1-based), endLine (for replace/delete), content (for replace/insert).",
            items: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING", description: "'replace' (replace lines startLine-endLine), 'insert' (insert after startLine), 'delete' (delete lines startLine-endLine)." },
                startLine: { type: "NUMBER", description: "Starting line number (1-based)." },
                endLine: { type: "NUMBER", description: "Ending line number (1-based, inclusive). Required for replace and delete." },
                content: { type: "STRING", description: "New content (for replace: replaces the lines; for insert: inserted after startLine). Each line separated by \\n." },
              },
              required: ["type", "startLine"],
            },
          },
        },
        required: ["path", "operations"],
      },
    },
    {
      name: "rename_project_file",
      description: "Renomme ou DÉPLACE un fichier ou dossier. Pour déplacer un fichier dans un autre dossier, spécifie le nouveau chemin complet dans newPath. Exemple: oldPath='utils.ts', newPath='src/helpers/utils.ts' déplace le fichier dans src/helpers/.",
      parameters: {
        type: "OBJECT",
        properties: {
          oldPath: { type: "STRING", description: "Chemin relatif actuel du fichier ou dossier." },
          newPath: { type: "STRING", description: "Nouveau chemin relatif (peut inclure un changement de dossier pour déplacer le fichier). Les dossiers parents sont créés automatiquement." },
        },
        required: ["oldPath", "newPath"],
      },
    },
    {
      name: "delete_project_file",
      description: "Deletes a file from the project workspace.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Relative path of the file to delete." },
        },
        required: ["path"],
      },
    },
    {
      name: "delete_project_folder",
      description: "Supprime un dossier et tout son contenu (récursivement) du workspace. Utiliser pour supprimer un dossier entier avec tous ses fichiers et sous-dossiers. Une confirmation est demandée si le dossier n'est pas vide. Les dossiers protégés (.git, node_modules, .Leanna, electron) ne peuvent pas être supprimés.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif du dossier à supprimer (ex: src/old-feature, dist/legacy)." },
        },
        required: ["path"],
      },
    },
    {
      name: "create_project_directory",
      description: "Crée un dossier dans le workspace (crée automatiquement tous les dossiers parents si nécessaire). Utiliser AVANT de déplacer des fichiers vers un nouveau dossier, ou pour organiser la structure du projet.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif du dossier à créer (ex: src/components/ui, tests/unit)." },
        },
        required: ["path"],
      },
    },
    {
      name: "get_workspace_info",
      description: "Gets info about the current workspace: absolute path, status, detected config files (package.json, tsconfig, etc).",
      parameters: { type: "OBJECT", properties: {} },
    },
  ],

  handleToolCall: async (name, args, context?: any) => {
    const toolContext = context || {};

    switch (name) {
      case "generate_codebase_markdown":
        return await handleGenerateCodebaseMarkdown(args);

      case "open_ide":
        toolContext.emitIdeAction?.({ type: "open-ide" });
        return { status: "success", action: "open-ide", message: "IDE ouvert." };

      case "open_project_file": {
        const requestedPath = String(args.path || "").trim();
        if (!requestedPath) return { error: "Le chemin de fichier est requis." };
        const normalized = normalizeProjectPath(requestedPath);
        if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };
        if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };
        const stats = await fs.promises.stat(normalized);
        if (!stats.isFile()) return { error: "Le chemin doit pointer vers un fichier." };
        const line = typeof args.line === "number" ? args.line : undefined;
        const column = typeof args.column === "number" ? args.column : undefined;
        toolContext.emitIdeAction?.({ type: "open-file", path: requestedPath, line, column });
        const raw = await fs.promises.readFile(normalized, "utf-8");
        const contentPreview = raw.length > 4000 ? raw.slice(0, 4000) + "\n... [tronque]" : raw;
        return { status: "success", action: "open-file", path: requestedPath, line, column, contentPreview, sizeBytes: stats.size };
      }

      case "list_project_files":
        return await handleListProjectFiles(args);

      case "read_project_file":
        return await handleReadProjectFile(args);

      case "read_file_outline":
        return await handleReadFileOutline(args);

      case "search_in_files":
        return await handleSearchInFiles(args);

      case "analyze_project_file":
        return await handleAnalyzeProjectFile(args, toolContext);

      case "write_project_file":
        return await handleWriteProjectFile(args, toolContext);

      case "modify_project_file":
        return await handleModifyProjectFile(args, toolContext);

      case "apply_patch":
        return await handleApplyPatch(args, toolContext);

      case "patch_project_file":
        return await handlePatchProjectFile(args, toolContext);

      case "rename_project_file":
        return await handleRenameProjectFile(args, toolContext);

      case "delete_project_file":
        return await handleDeleteProjectFile(args, toolContext);

      case "delete_project_folder":
        return await handleDeleteProjectFolder(args, toolContext);

      case "create_project_directory":
        return await handleCreateProjectDirectory(args);

      case "get_workspace_info":
        return await handleGetWorkspaceInfo();

      default:
        return { error: `Outil inconnu: ${name}` };
    }
  },
};

export { buildAnalysisPrompt } from "./codebaseHelpers.js";
