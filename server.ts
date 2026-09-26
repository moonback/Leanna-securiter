import express from "express";
import path from "path";
import { createRateLimitBundle, applyGlobalRateLimits, applyStaticAndCompression, type RateLimitDeps, } from "./server/config/rateLimits.js";
import { setupGracefulShutdown } from "./server/lifecycle.js";
// vite est importé dynamiquement en dev uniquement (voir plus bas)
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import { agentOrchestrator } from "./server/agents/index.js";
import { mcpBridge } from "./server/mcp/index.js";
import { type ProfileConfig } from "./server/prompts/systemInstruction.js";
import { loadScheduledTasks, stopAllScheduledTasks } from "./server/skills/automation.js";
import { loadWorkflows, stopAllWorkflowTimers } from "./server/skills/workflow.js";
import fs from "fs";
import { authenticateRequest, authenticateToken, ensureApiToken } from "./server/security.js";
import { SELF_ROOT, Leanna_APP_ROOT, initSelfRoot, hasProject } from "./server/utils/selfRoot.js";
import { isSandboxActive, getSandboxRoot } from "./server/utils/sandbox.js";

import { knowledgeGraph, projectIndexer, projectMemory } from "./server/knowledge/index.js";

import { loadGeminiKeys, createGeminiClient } from "./server/utils/geminiKeyPool.js";
import { encrypt } from "./server/utils/crypto.js";
import { setTextGenerationProfile, generateText } from "./server/utils/textGeneration.js";

// Routeurs modulaires
import healthRouter from "./server/routes/health.js";
import { knowledgeRouter, memoryRouter, impactRouter, understandingRouter } from "./server/routes/knowledge/index.js";

// Sprint 1 — routeurs extraits de server.ts
import { createAgentBuilderRouter } from "./server/routes/agent-builder.js";
import { createAgentRegistrationRouter } from "./server/routes/agent-registration.js";
import { createCustomAgentsRouter } from "./server/routes/custom-agents-router.js";
import { createGeminiKeysRouter } from "./server/routes/gemini-keys.js";
import { createSandboxRouter, createVerifyExitCodeRouter } from "./server/routes/sandbox.js";
import { createCheckpointRouter } from "./server/routes/checkpoint.js";
import ideRouter from "./server/routes/ide.js";
import { createBrowserRouter } from "./server/routes/browser.js";
import { attachLiveWebSocket } from "./server/live/LiveSocketHandler.js";
import { createExportRouter } from "./server/routes/export.js";

import { createGithubRouter } from "./server/routes/github.js";
import { createAgentsRouter } from "./server/routes/agents.js";
import workflowsRouter from "./server/routes/workflows.js";
import { createCustomSkillsRouter } from "./server/routes/custom-skills.js";
import { createAuditRouter } from "./server/routes/audit.js";
import { createProfileRouter, createTokensRouter } from "./server/routes/profile.js";
import { createOpenRouterRouter } from "./server/routes/openrouter.js";
import { createTokensOptimizationRouter } from "./server/routes/tokens-optimization.js";
import { createSummarizeContextRouter } from "./server/routes/summarize-context.js";
import { createWorkspaceRouter } from "./server/routes/workspace.js";
import { createMissionsRouter } from "./server/routes/missions.js";
import { createSelfRootRouter } from "./server/routes/self-root.js";
import { createFtpRouter } from "./server/routes/ftp.js";
import safeguardsRouter from "./server/routes/safeguards.js";
import pm2Router from "./server/routes/pm2.js";
import { initSandboxWatchWSS } from "./server/routes/sandbox-watch.js";
import { createUploadDocumentRouter } from "./server/routes/upload-document.js";
import { createDocumentsRouter } from "./server/routes/documents.js";
import { createSkillsRouter } from "./server/routes/skills.js";
import mcpRouter from "./server/routes/mcp.js";
import { createTerminalRouter, setupTerminalWebSocket } from "./server/routes/terminal.js";
import memoriesRouter from "./server/routes/memories.js";
import hierarchicalMemoryRouter from "./server/routes/hierarchicalMemory.js";
import conversationsRouter from "./server/routes/conversations.js";
import listsRouter from "./server/routes/lists.js";
import automationRouter from "./server/routes/automation.js";
import { createNotebooksRouter } from "./server/routes/notebooks/index.js";
import { createTTSRouter } from "./server/routes/tts.js";
import { notebookManager, embeddingStore } from "./server/notebooks/index.js";
import { backupService } from "./server/notebooks/BackupService.js";
import { sourceProcessingQueue } from "./server/notebooks/ProcessingQueue.js";
import { chatResponseCache, ragSearchCache } from "./server/notebooks/ResponseCache.js";
import { sourceIngester } from "./server/notebooks/SourceIngester.js";

// Charger les clés Gemini
loadGeminiKeys().catch(e => console.error('[GeminiKeyPool] Erreur au chargement initial:', e));

// ─── Notebooks Infrastructure ─────────────────────────────────────────────────

// Démarrer le service de backup automatique des notebooks
backupService.start();

// Configurer le handler de la queue de processing des sources
sourceProcessingQueue.setHandler(async (task, onProgress) => {
  const { notebookId, fileName, mimeType, buffer } = task.payload;
  onProgress(10);

  const source = await sourceIngester.ingestFromBuffer(
    Buffer.from(buffer),
    fileName,
    mimeType,
    notebookId
  );
  onProgress(70);

  notebookManager.addSource(notebookId, source);
  onProgress(90);

  // Invalider le cache pour ce notebook (nouvelles sources = réponses périmées)
  chatResponseCache.invalidateNotebook(notebookId);
  ragSearchCache.invalidateNotebook(notebookId);
  onProgress(100);

  return {
    sourceId: source.id,
    title: source.title,
    chunksCount: source.chunks.length,
    wordCount: source.wordCount,
  };
});

// ─── Gestionnaires d'erreurs globaux (Audit §1) ──────────────────────────────
process.on('unhandledRejection', (reason, _promise) => {
  console.error('[FATAL] Promesse non gérée:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Exception non rattrapée:', error);
  // Laisser le processus mourir après un court délai pour flusher les logs
  setTimeout(() => process.exit(1), 1000);
});

import { setKnowledgeBroadcaster, broadcastKnowledgeProgress } from "./server/utils/knowledgeBroadcaster.js";

// ─── Séquence de démarrage async ──────────────────────────────────────────────
// IMPORTANT: loadWorkflows() DOIT être awaité avant ensureAuditWorkflow().
// Sans await, listWorkflows() retourne [] et ensureAuditWorkflow() crée un
// doublon en BDD à chaque redémarrage → timers multipliés côté serveur.
(async () => {
  try {
    // 0. Résoudre SELF_ROOT depuis la persistance (avant TOUT le reste)
    // Si aucun projet n'a été persisté, SELF_ROOT reste "" et les inits
    // projet-dépendantes sont sautées jusqu'à la sélection d'un projet.
    initSelfRoot();

    // 1. Tâches planifiées (indépendant)
    await loadScheduledTasks();

    // 2. Workflows depuis la BDD
    await loadWorkflows();

    // 3. Seulement après le chargement complet, vérifier/créer l'audit workflow
    const { ensureAuditWorkflow } = await import("./server/workflows/audit-workflow.js");
    await ensureAuditWorkflow();

    // 4. Restauration des tâches agents depuis Supabase (recovery crash)
    const { agentOrchestrator: orch, agentPersistence } = await import("./server/agents/index.js");
    if (agentPersistence.isAvailable) {
      orch.restoreFromPersistence().then(({ tasks, orchestrations }: any) => {
        if (tasks > 0 || orchestrations > 0) {
          console.log(`[AgentPersistence] ✅ Restauré: ${tasks} tâche(s), ${orchestrations} orchestration(s)`);
        }
      }).catch((e: Error) => {
        console.warn(`[AgentPersistence] Restauration échouée (non bloquant): ${e.message}`);
      });
    }

    // 5. Indexation du Knowledge Graph — seulement si un projet est actif
    if (hasProject()) {
      projectIndexer.scanAll({
        onProgress: (p) => broadcastKnowledgeProgress(p.phase, p.current, p.total, { file: p.file }),
      }).then((stats: any) => {
        broadcastKnowledgeProgress('done', stats.totalFiles, stats.totalFiles, {
          totalEntities: stats.totalEntities,
          durationMs: stats.durationMs,
          cached: stats.cached ?? false,
        });
        if (stats.cached) {
          console.log(`[KnowledgeGraph] ⚡ Projet inchangé: ${stats.totalFiles} fichiers, ${stats.totalEntities} entités (chargé depuis le cache en ${stats.durationMs}ms)`);
        } else {
          console.log(`[KnowledgeGraph] ✅ Projet indexé: ${stats.totalFiles} fichiers, ${stats.totalEntities} entités (${(stats.durationMs / 1000).toFixed(1)}s)`);
        }
        // 5b. Activer l'indexation incrémentale via FileWatcher
        projectIndexer.startWatching();

        // 6. Extraction automatique des documents du workspace
        import("./server/knowledge/WorkspaceIndexer.js").then(({ workspaceIndexer }) => {
          workspaceIndexer.extractAll().then((docStats: any) => {
            console.log(`[WorkspaceIndexer] ✅ ${docStats.totalExtracted} document(s) extrait(s), ${docStats.totalWords} mots, ${docStats.totalSections} sections (${(docStats.durationMs / 1000).toFixed(1)}s)`);
            // 6b. Activer l'extraction incrémentale
            workspaceIndexer.startWatching();
          }).catch((e: any) => {
            console.error('[WorkspaceIndexer] ❌ Erreur extraction:', e.message);
          });
        });
      }).catch((e: any) => {
        console.error('[KnowledgeGraph] ❌ Erreur indexation:', e.message);
      });
    } else {
      console.log('[KnowledgeGraph] ⏸️ Aucun projet actif — indexation différée.');
    }
  } catch (e) {
    console.error('[Startup] Erreur séquence de démarrage:', e);
  }
})();


// ── Workspace helpers ─────────────────────────────────────────────────────────

/**
 * Reads the .env file and updates (or adds) a single key=value pair.
 * Preserves all existing comments and other keys.
 */
function updateEnvFile(key: string, value: string): void {
  const configBase = process.env.Leanna_CONFIG_PATH || process.env.ELECTRON_APP_PATH || process.cwd();
  const envPath = path.join(configBase, ".env");
  const envLocalPath = path.join(configBase, ".env.local");
  // Prefer .env.local if it exists, else fall back to .env
  const targetPath = fs.existsSync(envLocalPath) ? envLocalPath : envPath;

  const SENSITIVE_ENV_KEYS = [
    'Leanna_API_TOKEN',
    'GEMINI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN'
  ];

  const fileValue = SENSITIVE_ENV_KEYS.includes(key) ? encrypt(value) : value;

  let content = "";
  try {
    content = fs.readFileSync(targetPath, "utf-8");
  } catch { /* file might not exist yet */ }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^(${escapedKey}\\s*=.*)$`, "m");
  const newLine = `${key}="${fileValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  if (regex.test(content)) {
    content = content.replace(regex, newLine);
  } else {
    content = content.trimEnd() + `\n${newLine}\n`;
  }

  fs.writeFileSync(targetPath, content, "utf-8");
  // Hot-reload the env variable in the current process
  process.env[key] = value;
}


// Gemini client — uses key pool for rotation on 429 errors
function getGeminiAI(): GoogleGenAI {
  const client = createGeminiClient();
  if (!client) {
    throw new Error("Aucune clé Gemini API disponible. Configurez vos clés dans les paramètres.");
  }
  return client;
}
// ─── Initialisation Unifiée : SkillManagerV2 + Runtime ────────────────
// Utilisation de bootstrapRuntimeSync pour une initialisation centralisée.
// Toutes les skills sont enregistrées une seule fois dans le ToolRegistry.
// Compatible avec CommonJS (pas de top-level await).
import { bootstrapRuntimeSync } from "./server/runtime/bootstrap.js";
import { Observability } from "./server/runtime/Observability.js";

// Importer toutes les skills pour l'initialisation
import { automationSkill } from "./server/skills/automation.js";
import { browserSkill } from "./server/skills/browser.js";
import { codebaseSkill } from "./server/skills/codebase.js";
import { githubSkill } from "./server/skills/github.js";
import { guidelinesSkill } from "./server/skills/guidelines.js";
import { historySkill } from "./server/skills/history.js";
import { knowledgeSkill } from "./server/skills/knowledge.js";
import { listSkill } from "./server/skills/list.js";
import { memorySkill } from "./server/skills/memory.js";
import { reasoningSkill } from "./server/skills/reasoning.js";
import { systemSkill } from "./server/skills/system.js";
import { timeSkill } from "./server/skills/time.js";
import { verifySkill } from "./server/skills/verify.js";
import { securityAuditSkill } from "./server/skills/securityAudit.js";
import { weatherSkill } from "./server/skills/weather.js";
import { projectSkill } from "./server/skills/project.js";
import { agentsSkill } from "./server/skills/agents.js";
import { missionSkill } from "./server/skills/mission.js";
import { aiStudioDirectivesSkill } from "./server/skills/aiStudioDirectives.js";
import { documentLinkerSkill } from "./server/skills/documentLinker.js";
import { documentKnowledgeSkill } from "./server/skills/documentKnowledge.js";
import { richDocumentSkill } from "./server/skills/richDocument.js";
import { graphifySkill } from "./server/skills/graphify.js";
import { hierarchicalMemorySkill } from "./server/skills/hierarchicalMemory.js";
import { telegramSkill } from "./server/skills/telegram.js";
import { telegramService } from "./server/telegram/TelegramService.js";
import { createTelegramRouter } from "./server/routes/telegram.js";
import { createSmartSkills } from "./server/autonomy/SmartSkills.js";
import { LeannaCore } from "./server/autonomy/LeannaCore.js";
import { AutonomyPersistence } from "./server/autonomy/AutonomyPersistence.js";
import { RedisEventBridge } from "./server/runtime/RedisEventBridge.js";

const { runtime, skillManager } = bootstrapRuntimeSync({
  skills: [
    automationSkill, browserSkill, codebaseSkill, githubSkill,
    guidelinesSkill, historySkill, knowledgeSkill, listSkill,
    memorySkill, hierarchicalMemorySkill, reasoningSkill, systemSkill, timeSkill,
    verifySkill, securityAuditSkill, weatherSkill, projectSkill, agentsSkill,
    missionSkill, aiStudioDirectivesSkill, documentLinkerSkill,
    documentKnowledgeSkill, richDocumentSkill, graphifySkill, telegramSkill,
    createSmartSkills((name: string, args: any) => skillManager.handleToolCall(name, args)),
  ],
  onReady: async (r, sm) => {
    // Charger les custom skills après l'initialisation de base
    await sm.loadCustomSkills();
    const customSkillsReloadInterval = Number(process.env.LEANNA_CUSTOM_SKILLS_RELOAD_INTERVAL_MS ?? 30_000);
    sm.startCustomSkillsHotReload(Number.isFinite(customSkillsReloadInterval) ? customSkillsReloadInterval : 30_000);
    
    // Initialiser le Mission System (doit être fait après que les outils soient enregistrés)
    try {
      const missionModule = await import("./server/mission/index.js");
      const { Executor, MissionStore, AutonomyPolicy } = missionModule;
      const { initMissionSystem, setDryRunReportProvider } = await import("./server/skills/mission.js");
      const executor = new Executor();
      executor.setSkillHandler((name: string, args: any, opts?: { dryRun?: boolean }) =>
        sm.handleToolCall(name, args, undefined, opts));

      // Brancher le LLM sur les missions : décomposition, réflexion,
      // génération d'arguments et validation des critères de succès.
      const llmText = async (prompt: string): Promise<string> => {
        const { text } = await generateText({ prompt, temperature: 0.3 });
        return text;
      };
      executor.setLLMDecompose(llmText);
      executor.setLLMReflect(llmText);
      executor.setLLMArgGen(llmText);
      executor.setLLMVerify(llmText);

      // Fournir les schémas d'outils (name/description/parameters) pour permettre
      // la génération d'arguments valides au moment de l'exécution.
      const declarations = sm.getToolDeclarations();
      executor.setToolSchemas(
        declarations.map((d: any) => ({
          name: d.name,
          description: d.description,
          parameters: d.parameters,
        }))
      );

      const skillNames = declarations.map((d: any) => d.name);

      // Persistance des missions (Supabase). No-op si non configuré.
      const missionStore = new MissionStore();
      executor.setStore(missionStore);

      // Curseur d'autonomie (suggest/ask/auto) + .leannaignore.
      const rawMode = (process.env.LEANNA_AUTONOMY_MODE || "ask").toLowerCase();
      const autonomyMode = (["suggest", "ask", "auto"].includes(rawMode) ? rawMode : "ask") as
        | "suggest"
        | "ask"
        | "auto";
      const autonomyPolicy = new AutonomyPolicy({ mode: autonomyMode, workspaceRoot: SELF_ROOT });
      // Fournir les permissions par outil (pour classer lecture vs effet de bord).
      autonomyPolicy.setToolPermissions(
        r.tools.getDefinitions().map((def: any) => ({
          name: def.declaration?.name ?? def.name,
          permissions: def.permissions,
        }))
      );
      executor.setAutonomyPolicy(autonomyPolicy);
      console.log(`[Bootstrap] ✓ Curseur d'autonomie: mode "${autonomyMode}".`);

      initMissionSystem(executor, skillNames);
      // Exposer le rapport dry-run (effets simulés) au skill mission.
      setDryRunReportProvider(() => r.tools.getDryRun().getReport());
      // Stocker le missionExecutor dans le skillManager
      (sm as any)._missionExecutor = executor;
      console.log(`[Bootstrap] ✓ Mission System initialisé.`);

      // Reprendre les missions interrompues (crash/redémarrage) en arrière-plan.
      executor
        .resumePending(skillNames)
        .then((n) => { if (n > 0) console.log(`[Bootstrap] ♻️ ${n} mission(s) reprise(s).`); })
        .catch((e) => console.warn(`[Bootstrap] ⚠️ Reprise des missions échouée:`, e));
    } catch (error) {
      console.warn(`[Bootstrap] ⚠️ Erreur initialisation Mission System:`, error);
    }
    
    console.log(`[Bootstrap] ✅ Initialisation complète: ${r.tools.size} outils, ${r.listAgents().length} agents`);

    // Réconciliation des compteurs : rend explicites les 4 populations distinctes
    // (délégation / runtime / outils exécutables / capabilities mappées) et
    // signale les asymétries (capabilities orphelines, rôles sans plugin runtime,
    // outils non attribués à un agent dans l'UI). Purement observationnel.
    try {
      const { reconcileAndLogCounts } = await import("./server/runtime/reconcileCounts.js");
      reconcileAndLogCounts(r);
    } catch (error) {
      console.warn(`[Bootstrap] ⚠️ Réconciliation des compteurs échouée:`, error);
    }
  },
});

// Alias pour compatibilité avec le code existant
const runtimeV2 = runtime;
const observability = new Observability();
observability.attach(runtime.events);
// Optional Redis Streams bridge: makes the in-process EventBus multi-process
// durable across instances. No-op (bus stays in-process) when Redis is absent.
const eventBridge = new RedisEventBridge(runtime.events);
void eventBridge.start();
// Durable task store enabling checkpoint/resume of autonomy tasks after a crash.
// Degrades silently to in-memory only when Supabase is not configured.
const autonomyPersistence = new AutonomyPersistence();
const leannaCore = new LeannaCore(runtimeV2, {
  persistence: autonomyPersistence,
  executive: {
    // The Mission Executor is initialized asynchronously by bootstrapRuntimeSync.
    // Resolve it at execution time so early events escalate safely instead of
    // bypassing the existing plan/permission/dry-run/approval pipeline.
    executeMission: async ({ goal }) => {
      const executor = skillManager.missionExecutor;
      if (!executor) {
        return { success: false, escalate: true, summary: "Mission system is not initialized yet." };
      }
      const mission = await executor.startMission({
        title: `Autonomy: ${goal.description}`,
        description: goal.description,
        priority: goal.priority,
        availableSkills: skillManager.getToolDeclarations().map((tool: any) => tool.name),
        budget: goal.budget,
        dryRun: runtimeV2.tools.getDryRun().isEnabled(),
      });
      const completed = await executor.waitForMission(mission.id);
      const success = completed?.status === "completed";
      return {
        success,
        escalate: !completed || completed.status === "blocked",
        summary: completed?.toContextSummary?.() ?? "Mission did not produce a terminal result.",
      };
    },
  },
  onTask: async (task) => {
    // Autonomous tasks remain observable and use existing runtime memory; no tool
    // or mission action bypasses PermissionPolicy, DryRun or AutonomyPolicy.
    await runtimeV2.memory.set("session", `autonomy:task:${task.id}`, {
      type: task.type, sourceEventId: task.sourceEventId, metadata: task.metadata,
    }, { ttl: 24 * 60 * 60 * 1000, tags: ["autonomy", task.type] });
  },
});
leannaCore.start();

// Connecter l'AgentOrchestrator au nouveau skillManager (compatible avec l'ancien)
// L'ancien SkillManager faisait cela dans son constructeur, maintenant on le fait explicitement
agentOrchestrator.setSkillHandler((name: string, args: any) => skillManager.handleToolCall(name, args));

// Connecter le Workflow Engine
import { setWorkflowSkillHandler } from "./server/skills/workflow.js";
setWorkflowSkillHandler((name: string, args: any) => skillManager.handleToolCall(name, args));

console.log(`[Server] ✓ AgentOrchestrator et Workflow Engine connectés au nouveau SkillManagerV2.`);


// ── Registre des lectures de page browser en attente ─────────────────────────
// browser_read_content insère une promesse ici ; POST /api/browser/content-result
// la résout quand le BrowserPanel a exécuté le JS dans la webview.
const browserReadPending = new Map<string, {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ── Registre des actions browser en attente (click, type, snapshot, inspect) ─
// Réutilise le même pattern que browserReadPending mais pour les interactions
// qui nécessitent un retour structuré vers le skill. POST /api/browser/action-result
const browserActionPending = new Map<string, {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ── Security: Ensure API token is always configured ──
const apiToken = ensureApiToken();

function getDefaultWorkspaceRoot(): string {
  return SELF_ROOT;
}

// In-memory profile store (persisted to a local JSON file in production)
function getProfilePath(): string {
  // Le profil est toujours dans le dossier de l'app Leanna, pas le projet actif
  return path.join(Leanna_APP_ROOT, ".Leanna-profile.json");
}

function loadProfile(): ProfileConfig {
  try {
    const profilePath = getProfilePath();
    if (fs.existsSync(profilePath)) {
      return JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function saveProfile(profile: ProfileConfig): void {
  try { 
    const profilePath = getProfilePath();
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2)); 
  }
  catch (e) { console.error("[Profile] Failed to save:", e); }
}

let currentProfile: ProfileConfig = loadProfile();
setTextGenerationProfile(currentProfile);

// ── File watcher : recharger le profil quand le fichier est modifié à la main ──
try {
  const profilePath = getProfilePath();
  fs.watchFile(profilePath, { interval: 2000 }, () => {
    try {
      const reloaded = loadProfile();
      currentProfile = reloaded;
      setTextGenerationProfile(currentProfile);
      console.log(`[Profile] ♻️ Rechargé depuis le disque (keys: ${Object.keys(reloaded).join(', ')})`);
    } catch (e) {
      console.warn(`[Profile] Erreur lors du rechargement:`, (e as Error).message);
    }
  });
} catch { /* non bloquant */ }

// Wire checkpoint git guard avec le profil courant
import("./server/utils/checkpoint.js").then(({ setCheckpointProfileGetter }) => {
  setCheckpointProfileGetter(() => currentProfile);
}).catch(() => {});

/**
 * Retourne la racine de l'application Electron packagée, ou le CWD en dev.
 * En production (app packagée), main.cjs définit ELECTRON_APP_PATH = app.getAppPath()
 * AVANT d'appeler require(server.cjs). Cela permet de résoudre dist/ et node_modules/
 * correctement depuis l'ASAR, peu importe le CWD du process.
 */
function getElectronAppRoot(): string {
  return process.env.ELECTRON_APP_PATH?.trim() || process.cwd();
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.VITE_SERVER_PORT) || 4000;

  // --- Rate limiters, middlewares, fichiers statiques — extraits dans server/config/rateLimits.ts ---
  const isDev = process.env.NODE_ENV !== 'production';
  const rateLimitDeps: RateLimitDeps = {
    isDev,
    getDefaultWorkspaceRoot,
    getElectronAppRoot,
  };
  const rateBundle = createRateLimitBundle(rateLimitDeps);
  applyGlobalRateLimits(app, rateBundle, rateLimitDeps);

  // ── Content Security Policy (CSP) ─────────────────────────────────────────
  // Sépare dev/prod pour éliminer unsafe-eval en production
  const { getCSPForEnvironment } = await import("./server/config/csp.js");
  app.use((_req, res, next) => {
    const csp = getCSPForEnvironment(isDev);
    res.setHeader('Content-Security-Policy', csp);
    // Headers de sécurité additionnels
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Dynamic workspace: returns sandbox root when sandbox mode is active,
  // otherwise returns the main repo root. This affects the file explorer,
  // file read/write API routes, terminal cwd, and search.
  function getWorkspaceRoot(): string {
    if (isSandboxActive()) {
      return getSandboxRoot();
    }
    return getDefaultWorkspaceRoot();
  }

  applyStaticAndCompression(app, { ...rateLimitDeps, getWorkspaceRoot });

  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const authResult = authenticateRequest(req, { apiToken });
    if (!authResult.ok) {
      res.status(authResult.status || 401).json({ error: authResult.error || 'Unauthorized' });
      return;
    }
    if (apiToken) {
      res.cookie('Leanna_token', apiToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // Serveur local HTTP (127.0.0.1) — secure:true bloquerait le cookie sous Electron
        path: '/'
      });
    }
    next();
  }

  // API Routes — désormais modularisées dans server/routes/*
  app.use("/api", healthRouter);

  // BUGFIX (sécurité critique) : jusqu'ici `requireAuth` n'était appliqué qu'à
  // une poignée de routes /api/ide/* et /api/upload-document. Toutes les

  // autres routes (gestion des clés Gemini, tokens, workspace, git, github,
  // workflows, mémoires, conversations...) étaient accessibles sans aucune
  // authentification même lorsque Leanna_API_TOKEN est configuré, en
  // contradiction avec API_DOCS.md. On applique désormais l'authentification
  // à toutes les routes /api/* (sauf /api/health, déjà traitée ci-dessus).
  app.use("/api", requireAuth);

  // ── Routeurs modulaires (refactorisation priorité #1) ────────────────────
  // Montés APRÈS requireAuth mais AVANT les routes inline legacy.
  // Express matche en ordre d'enregistrement : ces routeurs gagnent.
  // IMPORTANT : chaque routeur est monté sur SON préfixe dédié.
  //   - Routeurs dont les routes internes incluent déjà le nom (/profile, /workspace...) restent sur "/api"
  //   - Routeurs dont les routes internes sont génériques (/status, /, /config...) requièrent "/api/<prefix>"
  app.use("/api/audit", createAuditRouter(skillManager, mcpBridge));
  app.use("/api/pm2", pm2Router);
  app.use("/api/automation", automationRouter);
  app.use("/api/workflows", workflowsRouter);
  app.use("/api/custom-skills", createCustomSkillsRouter(skillManager));
  const githubRouter = createGithubRouter(skillManager);
  app.use("/api/git", githubRouter);
  app.use("/api/github", githubRouter);
  app.use("/api/agents", createAgentsRouter(skillManager));

  // ─── Routes Runtime V2 (nouveau système, coexistence) ────────────────────
  const { createAgentsRouterV2 } = await import("./server/runtime/routes/agents.js");
  const { createMetricsRouter } = await import("./server/runtime/routes/metrics.js");
  app.use("/api/v2/agents", createAgentsRouterV2(runtimeV2));
  app.use("/api/v2/metrics", createMetricsRouter(runtimeV2, leannaCore));

  // ─── Observability & Telemetry (OpenTelemetry + Cost Dashboard) ──────────
  const observabilityRouter = (await import("./server/routes/observability.js")).default;
  app.use("/api/observability", observabilityRouter);

  app.use("/api", createProfileRouter(() => currentProfile, (p) => { currentProfile = p; setTextGenerationProfile(p); }, saveProfile, getWorkspaceRoot, updateEnvFile));
  app.use("/api", createTokensRouter(updateEnvFile, async () => { await loadGeminiKeys(); }));
  app.use("/api/openrouter", createOpenRouterRouter(() => currentProfile));
  app.use("/api/tokens", createTokensOptimizationRouter(() => currentProfile, getWorkspaceRoot));
  app.use("/api/tokens", createSummarizeContextRouter());
  app.use("/api", createWorkspaceRouter(getWorkspaceRoot));
  app.use("/api", createMissionsRouter(
    () => skillManager.missionExecutor,
    (name: string, args: any) => skillManager.handleToolCall(name, args),
  ));
  app.use("/api/self-root", createSelfRootRouter(() => wss));
  app.use("/api/ftp", createFtpRouter());
  app.use("/api/safeguards", safeguardsRouter);

  app.use("/api/upload-document", createUploadDocumentRouter(() => currentProfile));
  app.use("/api/documents", createDocumentsRouter(() => currentProfile));
  app.use("/api/skills", createSkillsRouter(skillManager, runtime));
  app.use("/api/mcp", mcpRouter);
  
  // ── Tools Registry (diagnostic unifié) ───────────────────────────────────
  const { createToolsRegistryRouter } = await import("./server/routes/tools-registry.js");
  app.use("/api/tools", createToolsRegistryRouter(runtimeV2, skillManager, mcpBridge));
  app.use("/api/memories", memoriesRouter);
  app.use("/api/memory/hierarchical", hierarchicalMemoryRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/lists", listsRouter);
  app.use("/api/terminal", createTerminalRouter({ apiToken }));
  app.use("/api/knowledge", knowledgeRouter);
  app.use("/api/knowledge", memoryRouter);
  app.use("/api/knowledge", impactRouter);
  app.use("/api/knowledge", understandingRouter);

  app.use("/api/notebooks/:id/chat", rateBundle.notebookChatLimiter);
  app.use("/api/notebooks/:id/embeddings/reindex", rateBundle.notebookEmbeddingLimiter);
  app.use("/api/notebooks/:id/sources/upload", rateBundle.notebookEmbeddingLimiter);

  app.use("/api/notebooks", createNotebooksRouter());
  app.use("/api/tts", createTTSRouter());

  // ── Sprint 1 — routeurs extraits ──────────────────────────────────────────
  app.use("/api/agent-builder", createAgentBuilderRouter());
  app.use("/api/agent-registration", createAgentRegistrationRouter());
  app.use("/api/custom-agents", createCustomAgentsRouter());

  // ── Marketplace d'agents et de skills ────────────────────────────────────
  const { createMarketplaceRouter } = await import("./server/routes/marketplace.js");
  app.use("/api/marketplace", createMarketplaceRouter());
  app.use("/api/gemini-keys", createGeminiKeysRouter());
  app.use("/api/sandbox", createSandboxRouter());
  app.use("/api/checkpoint", createCheckpointRouter());
  app.use("/api/ide", ideRouter);
  app.use("/api/browser", createBrowserRouter(browserReadPending, browserActionPending));
  app.use("/api/export", createExportRouter());
  app.use("/api", createVerifyExitCodeRouter());
  app.use("/api/telegram", createTelegramRouter());

  // ── Fin routeurs extraits Sprint 1 ──────────────────────────────────────



  // ── Global error handler — DOIT être enregistré APRÈS les routes mais
  //     AVANT les middlewares statiques (Vite, dist).                             
  //     Permet d'avoir une stacktrace détaillée en console sur les 500.         
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const status = err.status || err.statusCode || 500;
    const msg = err.message || String(err);
    console.error(`[HTTP ${status}] ${msg}`);
    if (err.stack) console.error(err.stack);
    res.status(status).json({
      error: status === 500 ? "Erreur interne du serveur." : msg,
      ...(process.env.NODE_ENV !== "production" ? { details: msg, stack: err.stack?.split("\n").slice(0, 6) } : {}),
    });
  });

  // HTTP server
  // BUGFIX : écouter sur 0.0.0.0 exposait le serveur (et donc le terminal
  // shell, les outils fichiers/git/system, les clés API) à tout le réseau
  // local par défaut. On se limite désormais à la boucle locale, sauf si
  // l'utilisateur exporte explicitement Leanna_LISTEN_HOST (ex: pour un accès
  // LAN volontaire, à combiner impérativement avec Leanna_API_TOKEN).
  const listenHost = process.env.Leanna_LISTEN_HOST?.trim() || "127.0.0.1";
  
  // Note: apiToken is now always guaranteed to exist via ensureApiToken()
  console.log("[Security] ✓ API authentication is enabled and required for all requests");
  
  if (listenHost === "0.0.0.0") {
    console.warn(
      "\n[Security] ⚠️  WARNING: Server is listening on 0.0.0.0 (all interfaces).\n" +
      "          Ensure your firewall is properly configured and the API token is kept secure.\n" +
      "          For local-only access, use Leanna_LISTEN_HOST=127.0.0.1 instead.\n"
    );
  }

  // ── Sandbox — activé SEULEMENT si un projet est sélectionné ──────────────
  // Sans projet actif, le sandbox est inutilisable (pas de SELF_ROOT).
  // Il sera initialisé automatiquement lors du setSelfRoot() côté /api/self-root/change.
  if (hasProject()) {
    try {
      const sandboxModule = await import("./server/utils/sandbox.js");
      const sandboxWatcherModule = await import("./server/utils/sandboxWatcher.js");
      const sandboxRoot = sandboxModule.getSandboxRoot();
      if (fs.existsSync(sandboxRoot)) {
        sandboxWatcherModule.startWatching();
        sandboxModule.activateSandbox();
        console.log("[Sandbox] Mode sandbox READY (dossier existant) + watcher démarré.");
      } else {
        await sandboxModule.initSandbox();
        sandboxWatcherModule.startWatching();
        sandboxModule.activateSandbox();
        console.log("[Sandbox] Mode sandbox initialisé et READY par défaut + watcher démarré.");
      }
    } catch (e: any) {
      console.error("[Sandbox] Erreur lors de l'activation par défaut:", e.message);
      if (e.stack) console.error(e.stack);
    }
  } else {
    console.log("[Sandbox] ⏸️ Aucun projet actif — sandbox différé à la sélection d'un projet.");
  }

  const server = app.listen(PORT, listenHost, () => {
    console.log(`Server running on http://${listenHost}:${PORT}`);
  });

  // Gestion explicite des erreurs d'écoute TCP (port occupé, droits insuffisants, etc.)
  // Plutôt qu'un stacktrace illisible "Error: listen EADDRINUSE :::4000", on donne
  // un diagnostic ACTIONNABLE à l'utilisateur.
  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[PORT] ❌ Le port ${PORT} est déjà utilisé par un autre processus.\n` +
        `     → Cause fréquente : un ancien "npm run dev" est toujours en cours (tuez-le),\n` +
        `        ou bien vous avez lancé "vite dev" À LA MAIN (interdit — ce projet intègre\n` +
        `        Vite DANS server.ts : utilisez UNIQUEMENT "npm run dev").\n` +
        `     → Sous Windows : exécutez  netstat -ano | findstr :${PORT}  puis taskkill /PID <id> /F\n` +
        `     → Ou bien exportez VITE_SERVER_PORT=<autre_port> dans .env pour changer.\n`
      );
      process.exit(1);
    }
    if (err.code === "EACCES") {
      console.error(
        `[PORT] ❌ Droits insuffisants pour écouter sur ${listenHost}:${PORT}.\n` +
        `     → Sous Linux/Mac : utilisez VITE_SERVER_PORT >= 1024 ou lancez avec sudo.\n`
      );
      process.exit(1);
    }
    console.error("[SERVER] Erreur au démarrage :", err.message);
    process.exit(1);
  });

  // Vite middleware for development (import dynamique pour éviter le crash en production)
  // NOTE: Le serveur HTTP est créé AVANT Vite pour pouvoir passer `server` à
  // hmr.server — cela attache le WebSocket HMR au même port (4000) au lieu
  // d'un port secondaire, évitant les erreurs « WebSocket connection failed ».
  // IMPORTANT : server.proxy est explicitement écrasé à {} en mode middleware.
  //   Sans ça, vite.config.ts définit un proxy "/api → localhost:<PORT>" qui,
  //   en mode middleware, recevrait les requêtes /api non matéchées par Express
  //   et renverrait une requête à lui-même → BOUCLE TCP infinie → ENOBUFS.
  let vite: any = null;
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
        proxy: {},
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // En production, dist/ est à la racine de l'app (getElectronAppRoot()/dist/).
    // Utiliser process.cwd() serait non fiable dans le paquet Electron (CWD variable).
    const distPath = path.join(getElectronAppRoot(), 'dist');
    console.log('[Server] Mode production — dist path:', distPath);
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // WebSocket server for Live API
  const wss = new WebSocketServer({ noServer: true });

  // Register knowledge progress broadcaster so the startup IIFE and routes can send scan events
  setKnowledgeBroadcaster((msg: object) => {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { /* ignore */ }
      }
    }
  });

  // WebSocket server for Sandbox file watching (real-time)
  const sandboxWss = initSandboxWatchWSS();

  // WebSocket server for Terminal (PTY-like)
  const terminalWss = new WebSocketServer({ noServer: true });
  setupTerminalWebSocket(terminalWss, apiToken);

  // WebSocket server dédié pour la timeline d'autonomie (lecture seule, aucun
  // session Gemini — contrairement à /live). Diffuse uniquement les événements
  // autonomy:* déjà émis par le runtime.
  const autonomyWss = new WebSocketServer({ noServer: true });
  autonomyWss.on('connection', (clientWs: WebSocket) => {
    // Snapshot initial de l'état pour un client qui rejoint en cours de route.
    try {
      clientWs.send(JSON.stringify({
        type: 'autonomy_snapshot',
        timestamp: new Date().toISOString(),
        state: leannaCore.getState(),
        tasks: leannaCore.getTasks().slice(0, 50),
      }));
    } catch { /* ignore */ }
  });

  // ── Agent Orchestrator: broadcaster d'événements vers les clients WebSocket ──
  agentOrchestrator.setEventBroadcaster((event: any) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { /* ignore */ }
      }
    }

    // Notification Telegram si activée
    if (event?.event === "task_completed" || event?.event === "task_failed") {
      const statusIcon = event.event === "task_completed" ? "✅" : "❌";
      telegramService.notify(
        `Agent *${event.agentName || event.role || "système"}* : Tâche ${statusIcon}\n` +
        `• *Titre :* ${event.title || "Tâche"}\n` +
        (event.detail ? `• *Détail :* ${event.detail}\n` : "")
      ).catch(() => {});
    }
  });

  // ── Mission System: broadcaster d'événements missions vers les clients WebSocket ──
  // registerDynSkills est asynchrone, on utilise un intervalle pour connecter dès que prêt
  const missionBroadcasterInterval = setInterval(() => {
    if (skillManager.missionExecutor) {
      clearInterval(missionBroadcasterInterval);
      skillManager.missionExecutor.setEventEmitter((event: string, data: any) => {
        const payload = JSON.stringify({ type: 'mission_event', event, ...data, timestamp: new Date().toISOString() });
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            try { client.send(payload); } catch { /* ignore */ }
          }
        }
      });
      console.log(`[Server] ✓ Mission System broadcaster connecté au WebSocket.`);
    }
  }, 500);

  // ── Autonomy: broadcaster d'événements autonomy:* vers /autonomy ──
  // Timeline temps réel de l'état/tâches autonomes sur un canal dédié en lecture
  // seule (message typé + timestamp ISO), sans impacter les sessions Gemini Live.
  leannaCore.setBroadcaster((message) => {
    const payload = JSON.stringify(message);
    for (const client of autonomyWss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { /* ignore */ }
      }
    }
  });
  console.log(`[Server] ✓ Autonomy broadcaster connecté au WebSocket dédié (/autonomy).`);

  // ── Lifecycle: suivi des sessions Gemini actives ─────────────────────────
  // Permet à gracefulShutdown() de fermer toutes les sessions ouvertes
  // lors d'un hot-reload ou d'une fermeture Electron propre.
  const activeGeminiSessions = new Set<any>();

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const pathname = url.pathname;

    // Sécurité : on exige le même jeton que pour les routes /api (passé en
    // cookie uniquement, plus de fallback par query string pour éviter
    // l'exposition du token dans les logs).
    if (pathname === '/live' || pathname === '/sandbox-watch' || pathname === '/autonomy') {
      const cookieHeader = request.headers.cookie || '';
      const cookies: Record<string, string> = {};
      cookieHeader.split(';').forEach(c => {
        const parts = c.split('=');
        if (parts.length >= 2) {
          cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('='));
        }
      });

      const token = cookies['Leanna_token'];
      const authResult = authenticateToken(token, apiToken);
      if (!authResult.ok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    if (pathname === '/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/sandbox-watch') {
      sandboxWss.handleUpgrade(request, socket, head, (ws) => {
        sandboxWss.emit('connection', ws, request);
      });
    } else if (pathname === '/terminal') {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit('connection', ws, request);
      });
    } else if (pathname === '/autonomy') {
      autonomyWss.handleUpgrade(request, socket, head, (ws) => {
        autonomyWss.emit('connection', ws, request);
      });
    } else {
      // In dev, Vite's own upgrade listener (registered via hmr.server)
      // handles the HMR WebSocket — just return and let it process.
      // In production, no other WS paths are expected so destroy.
      if (!vite) {
        socket.destroy();
      }
    }
  });

  // ── WebSocket Gemini Live + Sandbox Watcher ─────────────────────────────
  // Toute la logique WebSocket est extraite dans server/live/LiveSocketHandler.ts
  // (Sprint 1 — découpage de server.ts).
  attachLiveWebSocket(wss, sandboxWss, {
    skillManager,
    getCurrentProfile: () => currentProfile,
    getWorkspaceRoot,
    createGeminiAI: getGeminiAI,
    activeGeminiSessions,
    browserReadPending,
    browserActionPending,
  });

  // ── Graceful shutdown — extrait dans server/lifecycle.ts ────────────────
  setupGracefulShutdown({
    server,
    wss,
    runtimeV2,
    autonomyCore: leannaCore,
    eventBridge,
    observability,
    activeGeminiSessions,
    projectMemory,
    knowledgeGraph,
    mcpBridge,
    notebookManager,
    embeddingStore,
    stopAllWorkflowTimers,
    stopAllScheduledTasks,
    stopCustomSkillsHotReload: () => skillManager.stopCustomSkillsHotReload(),
    stopTelegramBot: () => telegramService.stop(),
  });

  // ── Démarrage automatique du bot Telegram si configuré ──
  const tgStatus = telegramService.getStatus();
  if (tgStatus.autoStart && tgStatus.isConfigured) {
    telegramService.start().catch((err) => {
      console.warn("[Telegram] Erreur démarrage automatique :", err.message);
    });
  }
}

startServer();
