import { Skill, SkillContext, validateArgs, SkillResult, createSuccessResult, createErrorResult } from "./base.js";
import { z } from "zod";
import {
  createWorkflow, executeWorkflow, deleteWorkflow, toggleWorkflow,
  listWorkflows, getWorkflow,
  createWorkflowSchema, runWorkflowSchema, deleteWorkflowSchema, toggleWorkflowSchema
} from "./workflow.js";

import {
  handleNavigate, handleClick, handleType, handleExtract,
  handleMusicSearch, handleSearch, handleSnapshot, handleInspect, handleClose,
  handleDoubleClick, handleRightClick, handleHover, handlePressKeys, handleScroll, handleWaitFor,
  handleScreenshot, handleAnalyzeScreenshot,
  handleDownloadFile,
  handleSaveSession, handleRestoreSession, handleListSessions, handleDeleteSession
} from "./automationBrowser.js";

import {
  ScheduledTaskDefinition,
  getScheduledTasksSnapshot, getScheduledTask, loadScheduledTasks,
  pauseScheduledTask, resumeScheduledTask, runScheduledTaskNow,
  cancelScheduledTask, stopAllScheduledTasks, setSchedulerSkillHandler,
  handleScheduleTask, handleListScheduledTasks, handleCancelScheduledTask
} from "./automationScheduler.js";

// Re-exports publics pour garantir la compatibilité avec server.ts et les tests
export type { ScheduledTaskDefinition };
export {
  getScheduledTasksSnapshot, getScheduledTask, loadScheduledTasks,
  pauseScheduledTask, resumeScheduledTask, runScheduledTaskNow,
  cancelScheduledTask, stopAllScheduledTasks
};
export { getWorkflowsSnapshot, loadWorkflows as loadWorkflowsFromDb } from "./workflow.js";

const selectorSchema = z.string().min(1, "Sélecteur requis").trim();

export const automationSkill: Skill = {
  name: "automation",
  // Permissions déclarées explicitement, appliquées au runtime par le ToolRegistry.
  // La plupart des outils pilotent un vrai navigateur (effet de bord réseau),
  // écrivent des fichiers/sessions, ou planifient/exécutent des tâches. Sans
  // cette déclaration, l'inférence par nom classait à tort click/type/download/
  // schedule/toggle… comme "read" (voir SkillAdapter.inferPermissions), ce qui
  // les faisait échapper au dry-run et à l'AutonomyPolicy.
  permissions: ["network"],
  toolPermissions: {
    // Pilotage du navigateur (contenu externe non fiable, effet de bord réseau).
    automation_navigate: ["network"],
    automation_click: ["network"],
    automation_type: ["network"],
    automation_extract: ["network"],
    automation_music_search: ["network"],
    automation_search: ["network"],
    automation_snapshot: ["network"],
    automation_inspect: ["network"],
    automation_close: ["network"],
    automation_screenshot: ["network"],
    automation_analyze_screenshot: ["network"],
    automation_double_click: ["network"],
    automation_right_click: ["network"],
    automation_hover: ["network"],
    automation_press_keys: ["network"],
    automation_scroll: ["network"],
    automation_wait_for: ["network"],
    // Téléchargement : réseau + écriture disque (sandbox).
    automation_download_file: ["network", "write"],
    // Sessions persistées (cookies/localStorage) sur disque.
    automation_save_session: ["write"],
    automation_restore_session: ["read"],
    automation_list_sessions: ["read"],
    automation_delete_session: ["write"],
    // Tâches planifiées : exécution périodique en arrière-plan.
    automation_schedule_task: ["exec"],
    automation_list_scheduled_tasks: ["read"],
    automation_cancel_scheduled_task: ["exec"],
    // Workflows (chaînes d'actions).
    workflow_create: ["write"],
    workflow_run: ["exec"],
    workflow_list: ["read"],
    workflow_delete: ["write"],
    workflow_toggle: ["write"],
  },
  declarations: [
    {
      name: "automation_navigate",
      description: "Ouvre le navigateur et navigue vers une URL. Retourne le titre et le texte de la page.",
      parameters: z.object({
        url: z.string().url("URL invalide").trim()
      }),
      examples: [
        {
          args: { url: "https://example.com" },
          description: "Navigation vers un site web standard"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_click",
      description: "Clique sur un élément de la page actuelle (sélecteur CSS) et attend un peu.",
      parameters: z.object({
        selector: selectorSchema
      }),
      examples: [
        {
          args: { selector: "button.submit" },
          description: "Clique sur un bouton de soumission"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_type",
      description: "Saisit du texte dans un champ de formulaire de la page actuelle.",
      parameters: z.object({
        selector: selectorSchema,
        text: z.string().min(1, "Texte requis"),
        pressEnter: z.boolean().optional().default(false)
      }),
      examples: [
        {
          args: { selector: "#search-input", text: "test query", pressEnter: true },
          description: "Tape une requête et appuie sur Entrée"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_extract",
      description: "Extrait le contenu texte de la page actuelle, ou d'un sélecteur spécifique.",
      parameters: z.object({
        selector: z.string().trim().optional().default('body')
      }),
      examples: [
        {
          args: { selector: "h1" },
          description: "Extrait le titre principal de la page"
        }
      ],
      category: "browser"
    },
    {
      name: "automation_music_search",
      description: "Recherche d'informations sur un artiste/album/chanson via recherche web avec focus sur la musique.",
      parameters: z.object({
        query: z.string().min(1, "Requête requise").trim()
      }),
      examples: [
        {
          args: { query: "Daft Punk" },
          description: "Recherche d'informations sur Daft Punk"
        }
      ],
      category: "search"
    },
    {
      name: "automation_search",
      description: "Effectue une recherche web générale (DuckDuckGo) et retourne les premiers résultats.",
      parameters: z.object({
        query: z.string().min(1, "Requête requise").trim()
      }),
      examples: [
        {
          args: { query: "latest AI news 2024" },
          description: "Recherche d'actualités sur l'IA"
        }
      ],
      category: "search"
    },
    {
      name: "automation_snapshot",
      description: "Retourne un instantané HTML compact des éléments interactifs de la page actuelle (inputs, boutons, selects) avec leurs sélecteurs CSS utilisables. À utiliser AVANT automation_type ou automation_click sur un nouveau site pour obtenir les vrais sélecteurs.",
      parameters: z.object({}),
      examples: [
        {
          args: {},
          description: "Capture un instantané de la page actuelle"
        }
      ],
      category: "browser"
    },
    {
      name: "automation_inspect",
      description: "Inspecte la page actuelle pour lister les éléments cliquables (boutons, liens) et les champs de formulaire disponibles.",
      parameters: z.object({
        type: z.enum(['buttons', 'inputs', 'links', 'all']).optional().default('all')
      }),
      examples: [
        {
          args: { type: 'buttons' },
          description: "Liste tous les boutons cliquables de la page"
        }
      ],
      category: "browser"
    },
    {
      name: "automation_close",
      description: "Ferme le navigateur automatisé.",
      parameters: z.object({}),
      examples: [
        {
          args: {},
          description: "Ferme le navigateur"
        }
      ],
      category: "browser",
      mutating: true
    },
    // ─── Perception Visuelle (Section 2.1) ─────────────────────────────────────
    {
      name: "automation_screenshot",
      description: "Capture une capture d'écran de la page actuelle. Permet l'analyse visuelle des interfaces complexes.",
      parameters: z.object({
        fullPage: z.boolean().optional().default(true).describe("Capturer toute la page (true) ou seulement la zone visible (false)"),
        type: z.enum(['png', 'jpeg']).optional().default('png').describe("Format de l'image"),
        quality: z.number().min(0).max(100).optional().default(90).describe("Qualité de l'image (0-100)")
      }),
      examples: [
        {
          args: { fullPage: true, type: 'png', quality: 90 },
          description: "Capture complète de la page en PNG haute qualité"
        },
        {
          args: { fullPage: false },
          description: "Capture seulement la zone visible"
        }
      ],
      category: "browser",
      outputDescription: "Retourne la capture d'écran en base64 avec métadonnées (type MIME, taille)"
    },
    {
      name: "automation_analyze_screenshot",
      description: "Analyse visuelle d'une capture d'écran ou d'une image. Utilise un modèle multimodal pour décrire le contenu visuel.",
      parameters: z.object({
        imageBase64: z.string().describe("Image encodée en base64 à analyser"),
        prompt: z.string().optional().default("Décris en détail le contenu visuel de cette image, y compris le texte visible, les éléments d'interface, les couleurs dominantes et l'organisation spatiale.").describe("Prompt personnalisé pour l'analyse")
      }),
      examples: [
        {
          args: { imageBase64: "base64_data_here", prompt: "Quels boutons sont visibles sur cette interface?" },
          description: "Analyse ciblée sur les éléments interactifs"
        }
      ],
      category: "browser",
      outputDescription: "Retourne une description textuelle du contenu visuel"
    },
    // ─── Téléchargement de fichiers (Section 2.2) ────────────────────────────────
    {
      name: "automation_download_file",
      description: "Télécharge un fichier depuis une URL et retourne son contenu. Peut sauvegarder dans la sandbox.",
      parameters: z.object({
        url: z.string().url("URL invalide").describe("URL du fichier à télécharger"),
        saveToSandbox: z.boolean().optional().default(false).describe("Sauvegarder le fichier dans la sandbox (downloads/)")
      }),
      examples: [
        {
          args: { url: "https://example.com/data.csv" },
          description: "Télécharge un fichier CSV"
        },
        {
          args: { url: "https://example.com/report.pdf", saveToSandbox: true },
          description: "Télécharge et sauvegarde un PDF dans la sandbox"
        }
      ],
      category: "browser",
      outputDescription: "Retourne le contenu du fichier (base64 pour les binaires, texte pour HTML), type MIME, taille, et chemin si sauvegardé"
    },
    // ─── Persistance des Sessions (Section 2.3) ────────────────────────────────
    {
      name: "automation_save_session",
      description: "Sauvegarde la session actuelle (cookies, localStorage) pour persistance. Permet de maintenir la connexion sur des sites authentifiés.",
      parameters: z.object({
        name: z.string().min(1).describe("Nom unique de la session à sauvegarder")
      }),
      examples: [
        {
          args: { name: "github_session" },
          description: "Sauvegarde la session GitHub authentifiée"
        }
      ],
      category: "browser",
      outputDescription: "Retourne le nom de la session, le chemin du fichier, et le nombre de cookies/localStorage sauvegardés"
    },
    {
      name: "automation_restore_session",
      description: "Restaure une session sauvegardée (cookies, authentification).",
      parameters: z.object({
        name: z.string().min(1).describe("Nom de la session à restaurer")
      }),
      examples: [
        {
          args: { name: "github_session" },
          description: "Restaure la session GitHub sauvegardée"
        }
      ],
      category: "browser",
      mutating: true,
      outputDescription: "Retourne l'URL restaurée et le nombre de cookies restaurés"
    },
    {
      name: "automation_list_sessions",
      description: "Liste toutes les sessions sauvegardées.",
      parameters: z.object({}),
      examples: [
        {
          args: {},
          description: "Affiche toutes les sessions disponibles"
        }
      ],
      category: "browser",
      outputDescription: "Retourne la liste des sessions avec leurs métadonnées (nom, URL, date, nombre de cookies)"
    },
    {
      name: "automation_delete_session",
      description: "Supprime une session sauvegardée.",
      parameters: z.object({
        name: z.string().min(1).describe("Nom de la session à supprimer")
      }),
      examples: [
        {
          args: { name: "old_session" },
          description: "Supprime une session obsolète"
        }
      ],
      category: "browser",
      mutating: true,
      outputDescription: "Retourne une confirmation de suppression"
    },
    {
      name: "automation_double_click",
      description: "Effectue un double-clic gauche humain sur un élément (hover avant, trajectoire souris, délais randomisés).",
      parameters: z.object({
        selector: selectorSchema
      }),
      examples: [
        {
          args: { selector: ".edit-button" },
          description: "Double-clique sur un bouton d'édition"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_right_click",
      description: "Effectue un clic droit humain sur un élément pour ouvrir le menu contextuel (hover avant + souris).",
      parameters: z.object({
        selector: selectorSchema
      }),
      examples: [
        {
          args: { selector: ".file-item" },
          description: "Ouvre le menu contextuel d'un fichier"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_hover",
      description: "Survole (hover) un élément avec une trajectoire de souris humaine. Idéal pour menus/dropdowns/infobulles.",
      parameters: z.object({
        selector: selectorSchema,
        hoverMs: z.number().int().positive().optional()
      }),
      examples: [
        {
          args: { selector: ".dropdown-menu", hoverMs: 1000 },
          description: "Survole un menu déroulant pendant 1 seconde"
        }
      ],
      category: "browser"
    },
    {
      name: "automation_press_keys",
      description: "Envoie une séquence de touches au clavier (Enter, ArrowDown, Escape, Tab, Ctrl+A, etc.) avec délais humains.",
      parameters: z.object({
        keys: z.array(z.string()).min(1, "Au moins une touche requise"),
        pressEnter: z.boolean().optional().default(false)
      }),
      examples: [
        {
          args: { keys: ['Tab', 'Tab', 'Enter'], pressEnter: false },
          description: "Navigation tab-tab-enter"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_scroll",
      description: "Défilement humain de la page (par paquets de pixels avec pauses, simule molette).",
      parameters: z.object({
        direction: z.enum(['up', 'down']).optional().default('down'),
        pixels: z.number().int().positive().optional()
      }),
      examples: [
        {
          args: { direction: 'down', pixels: 500 },
          description: "Fait défiler la page vers le bas de 500 pixels"
        }
      ],
      category: "browser",
      mutating: true
    },
    {
      name: "automation_wait_for",
      description: "Attend qu'un élément CSS apparaisse ou qu'un texte soit présent sur la page. Idéal après navigation/clic.",
      parameters: z.object({
        selector: z.string().trim().optional(),
        text: z.string().min(1).optional(),
        timeoutMs: z.number().int().positive().optional()
      }).refine(a => a.selector || a.text, {
        message: "selector ou text est requis"
      }),
      examples: [
        {
          args: { selector: ".loading-spinner", timeoutMs: 5000 },
          description: "Attend la disparition d'un indicateur de chargement (max 5s)"
        }
      ],
      category: "browser"
    },
    {
      name: "automation_schedule_task",
      description: "Planifie une tâche d'automatisation en arrière-plan et l'exécute périodiquement.",
      parameters: z.object({
        name: z.string().min(1, "Nom requis").trim(),
        description: z.string().optional().default('Tâche planifiée'),
        actionName: z.string().min(1, "Action requise"),
        args: z.record(z.unknown()).optional().default({}),
        intervalSeconds: z.number().int().positive().optional(),
        intervalMinutes: z.number().int().positive().optional(),
        intervalHours: z.number().int().positive().optional(),
        interval: z.string().trim().optional()
      }).refine(args => args.intervalSeconds || args.intervalMinutes || args.intervalHours || args.interval, {
        message: "Un intervalle est requis"
      }),
      examples: [
        {
          args: {
            name: "daily-report",
            description: "Génère un rapport quotidien",
            actionName: "automation_navigate",
            args: { url: "https://internal.company.com/report" },
            intervalHours: 24
          },
          description: "Planifie une navigation quotidienne vers un rapport"
        }
      ],
      category: "scheduling",
      mutating: true
    },
    {
      name: "automation_list_scheduled_tasks",
      description: "Liste les tâches d'automatisation planifiées actuellement actives.",
      parameters: z.object({}),
      examples: [
        {
          args: {},
          description: "Liste toutes les tâches planifiées"
        }
      ],
      category: "scheduling"
    },
    {
      name: "automation_cancel_scheduled_task",
      description: "Annule une tâche planifiée précédemment enregistrée.",
      parameters: z.object({
        taskId: z.string().min(1, "ID requis")
      }),
      examples: [
        {
          args: { taskId: "task_123abc" },
          description: "Annule la tâche avec l'ID spécifié"
        }
      ],
      category: "scheduling",
      mutating: true
    },
    // ── Workflow (chaînes d'actions) ───────────────────────────────────────
    {
      name: "workflow_create",
      description: "Crée un workflow (chaîne d'actions/pipeline). Enchaîne plusieurs skills séquentiellement avec passage de résultats entre étapes via des templates ({{prev.result}}, {{steps.ID.result}}). Peut être planifié avec un intervalle.",
      parameters: z.object({
        name: z.string().min(1, "Nom requis").trim(),
        description: z.string().optional().default('Workflow sans description'),
        steps: z.array(z.object({
          id: z.string().min(1, "ID requis"),
          action: z.string().min(1, "Action requise"),
          args: z.record(z.unknown()).optional().default({}),
          label: z.string().optional(),
          condition: z.string().optional(),
          onError: z.enum(['stop', 'skip', 'retry']).optional().default('stop'),
          maxRetries: z.number().int().min(0).optional().default(2)
        })).min(1, "Au moins une étape requise"),
        schedule: z.string().optional().default('')
      }),
      examples: [
        {
          args: {
            name: "daily-scrape-and-report",
            description: "Scrape un site et génère un rapport quotidien",
            steps: [
              {
                id: "step1",
                action: "automation_navigate",
                args: { url: "https://example.com/data" },
                label: "Navigation vers la source de données"
              },
              {
                id: "step2",
                action: "automation_extract",
                args: { selector: ".data-table" },
                label: "Extraction des données"
              },
              {
                id: "step3",
                action: "memory_store",
                args: { key: "scraped-data", value: "{{step2.result}}" },
                label: "Sauvegarde des données en mémoire"
              }
            ],
            schedule: "24h"
          },
          description: "Workflow de scraping quotidien"
        }
      ],
      category: "workflow"
    },
    {
      name: "workflow_run",
      description: "Exécute immédiatement un workflow existant et retourne les résultats de chaque étape.",
      parameters: z.object({
        workflowId: z.string().min(1, "ID requis")
      }),
      examples: [
        {
          args: { workflowId: "wf_123abc" },
          description: "Exécute le workflow spécifié"
        }
      ],
      category: "workflow"
    },
    {
      name: "workflow_list",
      description: "Liste tous les workflows enregistrés avec leur statut et historique d'exécution.",
      parameters: z.object({}),
      examples: [
        {
          args: {},
          description: "Liste tous les workflows disponibles"
        }
      ],
      category: "workflow"
    },
    {
      name: "workflow_delete",
      description: "Supprime un workflow et annule sa planification éventuelle.",
      parameters: z.object({
        workflowId: z.string().min(1, "ID requis")
      }),
      examples: [
        {
          args: { workflowId: "wf_123abc" },
          description: "Supprime le workflow spécifié"
        }
      ],
      category: "workflow",
      mutating: true
    },
    {
      name: "workflow_toggle",
      description: "Active ou désactive un workflow planifié.",
      parameters: z.object({
        workflowId: z.string().min(1, "ID requis"),
        enabled: z.boolean()
      }),
      examples: [
        {
          args: { workflowId: "wf_123abc", enabled: false },
          description: "Désactive le workflow spécifié"
        }
      ],
      category: "workflow",
      mutating: true
    }
  ],
  inputSchemas: {
    "automation_navigate": z.object({
      url: z.string().url("URL invalide").trim()
    }),
    "automation_click": z.object({
      selector: selectorSchema
    }),
    "automation_type": z.object({
      selector: selectorSchema,
      text: z.string().min(1, "Texte requis"),
      pressEnter: z.boolean().optional().default(false)
    }),
    "automation_extract": z.object({
      selector: z.string().trim().optional().default('body')
    }),
    "automation_music_search": z.object({
      query: z.string().min(1, "Requête requise").trim()
    }),
    "automation_search": z.object({
      query: z.string().min(1, "Requête requise").trim()
    }),
    "automation_snapshot": z.object({}),
    "automation_inspect": z.object({
      type: z.enum(['buttons', 'inputs', 'links', 'all']).optional().default('all')
    }),
    "automation_close": z.object({}),
    // Perception Visuelle
    "automation_screenshot": z.object({
      fullPage: z.boolean().optional().default(true),
      type: z.enum(['png', 'jpeg']).optional().default('png'),
      quality: z.number().min(0).max(100).optional().default(90)
    }),
    "automation_analyze_screenshot": z.object({
      imageBase64: z.string(),
      prompt: z.string().optional()
    }),
    // Téléchargement de fichiers
    "automation_download_file": z.object({
      url: z.string().url(),
      saveToSandbox: z.boolean().optional().default(false)
    }),
    // Persistance des Sessions
    "automation_save_session": z.object({
      name: z.string().min(1)
    }),
    "automation_restore_session": z.object({
      name: z.string().min(1)
    }),
    "automation_list_sessions": z.object({}),
    "automation_delete_session": z.object({
      name: z.string().min(1)
    }),
    "automation_double_click": z.object({
      selector: selectorSchema
    }),
    "automation_right_click": z.object({
      selector: selectorSchema
    }),
    "automation_hover": z.object({
      selector: selectorSchema,
      hoverMs: z.number().int().positive().optional()
    }),
    "automation_press_keys": z.object({
      keys: z.array(z.string()).min(1, "Au moins une touche requise"),
      pressEnter: z.boolean().optional().default(false)
    }),
    "automation_scroll": z.object({
      direction: z.enum(['up', 'down']).optional().default('down'),
      pixels: z.number().int().positive().optional()
    }),
    "automation_wait_for": z.object({
      selector: z.string().trim().optional(),
      text: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive().optional()
    }).refine(a => a.selector || a.text, {
      message: "selector ou text est requis"
    }),
    "automation_schedule_task": z.object({
      name: z.string().min(1, "Nom requis").trim(),
      description: z.string().optional().default('Tâche planifiée'),
      actionName: z.string().min(1, "Action requise"),
      args: z.record(z.unknown()).optional().default({}),
      intervalSeconds: z.number().int().positive().optional(),
      intervalMinutes: z.number().int().positive().optional(),
      intervalHours: z.number().int().positive().optional(),
      interval: z.string().trim().optional()
    }).refine(args => args.intervalSeconds || args.intervalMinutes || args.intervalHours || args.interval, {
      message: "Un intervalle est requis"
    }),
    "automation_list_scheduled_tasks": z.object({}),
    "automation_cancel_scheduled_task": z.object({
      taskId: z.string().min(1, "ID requis")
    }),
    // Workflow schemas
    "workflow_create": createWorkflowSchema,
    "workflow_run": runWorkflowSchema,
    "workflow_list": z.object({}),
    "workflow_delete": deleteWorkflowSchema,
    "workflow_toggle": toggleWorkflowSchema
  },
  handleToolCall: async (name, args, _context: SkillContext = {}): Promise<SkillResult> => {
    const startTime = Date.now();
    
    try {
      if (name === "automation_navigate") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_navigate"], args, name);
        const result = await handleNavigate(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_extract", "automation_snapshot", "automation_inspect"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_click") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_click"], args, name);
        const result = await handleClick(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_type", "automation_extract", "automation_wait_for"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_type") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_type"], args, name);
        const result = await handleType(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_press_keys", "automation_scroll", "automation_wait_for"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_extract") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_extract"], args, name);
        const result = await handleExtract(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["memory_store", "workflow_create", "reasoning_think"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_music_search") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_music_search"], args, name);
        const result = await handleMusicSearch(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["memory_store", "reasoning_summarize"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_search") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_search"], args, name);
        const result = await handleSearch(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_extract", "reasoning_think", "memory_store"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_snapshot") {
        validateArgs(automationSkill.inputSchemas!["automation_snapshot"], args, name);
        const result = await handleSnapshot();
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_type", "automation_click", "automation_wait_for"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_inspect") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_inspect"], args, name);
        const result = await handleInspect(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_click", "automation_type", "automation_hover"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_close") {
        validateArgs(automationSkill.inputSchemas!["automation_close"], args, name);
        const result = await handleClose();
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          [] // Aucune action suivante suggérée après fermeture
        );
      }

      // Perception Visuelle (Section 2.1)
      if (name === "automation_screenshot") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_screenshot"], args, name);
        const result = await handleScreenshot(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_analyze_screenshot", "automation_extract"] // Analyse ou extraction suivante
        );
      }

      if (name === "automation_analyze_screenshot") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_analyze_screenshot"], args, name);
        const result = await handleAnalyzeScreenshot(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_screenshot"] // Peut vouloir recapturer
        );
      }

      // Téléchargement de fichiers (Section 2.2)
      if (name === "automation_download_file") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_download_file"], args, name);
        const result = await handleDownloadFile(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          [] // Pas de suggestion notebook : l'agent n'a plus accès aux notebooks
        );
      }

      // Persistance des Sessions (Section 2.3)
      if (name === "automation_save_session") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_save_session"], args, name);
        const result = await handleSaveSession(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_close"] // Peut vouloir fermer après sauvegarde
        );
      }

      if (name === "automation_restore_session") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_restore_session"], args, name);
        const result = await handleRestoreSession(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_navigate", "automation_extract"] // Peut vouloir naviguer ou extraire après restauration
        );
      }

      if (name === "automation_list_sessions") {
        validateArgs(automationSkill.inputSchemas!["automation_list_sessions"], args, name);
        const result = await handleListSessions();
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_restore_session", "automation_delete_session"]
        );
      }

      if (name === "automation_delete_session") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_delete_session"], args, name);
        const result = await handleDeleteSession(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_list_sessions"]
        );
      }

      if (name === "automation_double_click") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_double_click"], args, name);
        const result = await handleDoubleClick(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_type", "automation_extract"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_right_click") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_right_click"], args, name);
        const result = await handleRightClick(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_hover", "automation_press_keys"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_hover") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_hover"], args, name);
        const result = await handleHover(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_click", "automation_right_click"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_press_keys") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_press_keys"], args, name);
        const result = await handlePressKeys(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_type", "automation_wait_for"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_scroll") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_scroll"], args, name);
        const result = await handleScroll(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_wait_for", "automation_extract"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_wait_for") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_wait_for"], args, name);
        const result = await handleWaitFor(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_type", "automation_click", "automation_extract"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_schedule_task") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_schedule_task"], args, name);
        const result = await handleScheduleTask(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_list_scheduled_tasks", "workflow_create"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_list_scheduled_tasks") {
        validateArgs(automationSkill.inputSchemas!["automation_list_scheduled_tasks"], args, name);
        const result = await handleListScheduledTasks();
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_schedule_task", "automation_cancel_scheduled_task"] // Actions suivantes suggérées
        );
      }

      if (name === "automation_cancel_scheduled_task") {
        const validated = validateArgs(automationSkill.inputSchemas!["automation_cancel_scheduled_task"], args, name);
        const result = await handleCancelScheduledTask(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          result,
          name,
          "automation",
          durationMs,
          ["automation_list_scheduled_tasks"] // Actions suivantes suggérées
        );
      }

      // ── Workflow handlers ──────────────────────────────────────────────
      if (name === "workflow_create") {
        const validated = validateArgs(automationSkill.inputSchemas!["workflow_create"], args, name);
        const workflow = await createWorkflow(validated);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          {
            status: "success",
            workflowId: workflow.id,
            name: workflow.name,
            stepsCount: workflow.steps.length,
            scheduled: workflow.schedule || null
          },
          name,
          "automation",
          durationMs,
          ["workflow_run", "workflow_list", "workflow_toggle"] // Actions suivantes suggérées
        );
      }

      if (name === "workflow_run") {
        const validated = validateArgs(automationSkill.inputSchemas!["workflow_run"], args, name);
        const wf = getWorkflow(validated.workflowId);
        if (!wf) {
          return createErrorResult(
            `Workflow ${validated.workflowId} introuvable.`,
            "WORKFLOW_NOT_FOUND",
            name,
            "automation",
            true, // recoverable
            [
              "Vérifiez que l'ID du workflow est correct",
              "Listez les workflows disponibles avec workflow_list",
              "Créez un nouveau workflow avec workflow_create"
            ],
            1000 // retryAfterMs
          );
        }
        const result = await executeWorkflow(wf);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          {
            status: "success",
            result
          },
          name,
          "automation",
          durationMs,
          ["workflow_list", "workflow_toggle"] // Actions suivantes suggérées
        );
      }

      if (name === "workflow_list") {
        validateArgs(automationSkill.inputSchemas!["workflow_list"], args, name);
        const allWorkflows = listWorkflows();
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          {
            status: "success",
            count: allWorkflows.length,
            workflows: allWorkflows.map(wf => ({
              id: wf.id,
              name: wf.name,
              description: wf.description,
              stepsCount: wf.steps.length,
              schedule: wf.schedule || null,
              enabled: wf.enabled,
              lastRunAt: wf.lastRunAt ? new Date(wf.lastRunAt).toISOString() : null,
              lastRunStatus: wf.lastRunStatus || null
            }))
          },
          name,
          "automation",
          durationMs,
          ["workflow_run", "workflow_create"] // Actions suivantes suggérées
        );
      }

      if (name === "workflow_delete") {
        const validated = validateArgs(automationSkill.inputSchemas!["workflow_delete"], args, name);
        const deleted = await deleteWorkflow(validated.workflowId);
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          {
            status: deleted ? "success" : "not_found",
            message: deleted 
              ? `Workflow ${validated.workflowId} supprimé.` 
              : `Workflow ${validated.workflowId} introuvable.`
          },
          name,
          "automation",
          durationMs,
          ["workflow_list", "workflow_create"] // Actions suivantes suggérées
        );
      }

      if (name === "workflow_toggle") {
        const validated = validateArgs(automationSkill.inputSchemas!["workflow_toggle"], args, name);
        const updated = await toggleWorkflow(validated.workflowId, validated.enabled);
        if (!updated) {
          return createErrorResult(
            `Workflow ${validated.workflowId} introuvable.`,
            "WORKFLOW_NOT_FOUND",
            name,
            "automation",
            true, // recoverable
            [
              "Vérifiez que l'ID du workflow est correct",
              "Listez les workflows disponibles avec workflow_list"
            ],
            1000 // retryAfterMs
          );
        }
        const durationMs = Date.now() - startTime;
        return createSuccessResult(
          {
            status: "success",
            enabled: updated.enabled,
            message: `Workflow "${updated.name}" ${updated.enabled ? "activé" : "désactivé"}`
          },
          name,
          "automation",
          durationMs,
          ["workflow_list", "workflow_run"] // Actions suivantes suggérées
        );
      }

      return createErrorResult(
        `Outil inconnu: ${name}`,
        "TOOL_NOT_FOUND",
        name,
        "automation",
        false,
        [
          "Utilisez request_tools pour charger des catégories d'outils supplémentaires",
          "Consultez la liste des outils disponibles",
          "Vérifiez l'orthographe du nom de l'outil"
        ]
      );
    } catch (error: any) {
      console.error(`[Automation] Erreur dans ${name}:`, error);
      return createErrorResult(
        error.message || "Erreur d'automatisation inconnue",
        error.code || "EXECUTION_ERROR",
        name,
        "automation",
        error.recoverable !== false,
        error.suggestions || [
          "Vérifiez les paramètres fournis",
          "Assurez-vous que les prérequis sont remplis (navigateur ouvert, etc.)",
          "Consultez les logs pour plus de détails"
        ],
        error.retryAfterMs
      );
    }
  }
};

// Enregistrement du skill handler pour le planificateur de tâches
setSchedulerSkillHandler((name, args) => automationSkill.handleToolCall(name, args, {}));