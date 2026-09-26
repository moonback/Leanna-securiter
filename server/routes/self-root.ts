import { Router, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { requestConfirmation } from '../utils/confirmationBridge.js';
import { broadcastKnowledgeProgress } from '../utils/knowledgeBroadcaster.js';

export function createSelfRootRouter(getWss: () => WebSocketServer | null): Router {
  const router = Router();

  // GET /api/self-root
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const { SELF_ROOT, hasProject } = await import('../utils/selfRoot.js');
      const { getSandboxRoot, getSandboxStatus } = await import('../utils/sandbox.js');
      const root = hasProject() ? SELF_ROOT : null;
      let sandbox: any = null;
      try {
        sandbox = getSandboxStatus();
      } catch {}
      res.json({
        root,
        rootPath: root,
        sandboxPath: sandbox?.path || (root ? `${root}/.Leanna/sandbox` : null),
        sandbox,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/self-root/status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      // SELF_ROOT est lu dynamiquement (peut avoir changé depuis le démarrage)
      const { SELF_ROOT, WORKSPACE_SITE_URL, hasProject } = await import('../utils/selfRoot.js');

      if (!hasProject()) {
        return res.json({
          rootPath: null,
          locked: false,
          noProject: true,
          siteUrl: '',
          gitBranch: '—',
          gitStatus: 'unknown',
          lastCommit: '—',
          lastCommitDate: '—',
          aheadBehind: { ahead: 0, behind: 0 },
        });
      }

      const { execSync } = await import('child_process');
      const execOpts = { cwd: SELF_ROOT, encoding: 'utf-8' as const, timeout: 5000 };
      let gitBranch = '—';
      let gitStatus: 'clean' | 'dirty' | 'unknown' = 'unknown';
      let lastCommit = '—';
      let lastCommitDate = '—';
      let ahead = 0;
      let behind = 0;

      // Utiliser le cache git_status s'il est disponible (évite un spawn)
      try {
        const { gitStatusCache } = await import('../skills/git.js');
        const cached = gitStatusCache.get(SELF_ROOT);
        if (cached && cached.branch) {
          gitBranch = cached.branch;
          gitStatus = (cached.files?.length ?? 0) === 0 ? 'clean' : 'dirty';
        } else {
          try { gitBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim(); } catch {}
          try {
            const statusOutput = execSync('git status --porcelain', execOpts).trim();
            gitStatus = statusOutput.length === 0 ? 'clean' : 'dirty';
          } catch {}
        }
      } catch {
        try { gitBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim(); } catch {}
        try {
          const statusOutput = execSync('git status --porcelain', execOpts).trim();
          gitStatus = statusOutput.length === 0 ? 'clean' : 'dirty';
        } catch {}
      }
      try {
        lastCommit = execSync('git log -1 --pretty=format:%s', execOpts).trim();
        lastCommitDate = execSync('git log -1 --pretty=format:%cr', execOpts).trim();
      } catch {}
      try {
        // Use execFileSync instead of execSync with template literal to prevent
        // shell injection if gitBranch ever contains shell metacharacters (audit L-2).
        const { execFileSync } = await import('child_process');
        const abOutput = execFileSync(
          'git',
          ['rev-list', '--left-right', '--count', `origin/${gitBranch}...HEAD`],
          execOpts
        ).trim();
        const parts = abOutput.split(/\s+/);
        if (parts.length === 2) { behind = parseInt(parts[0], 10) || 0; ahead = parseInt(parts[1], 10) || 0; }
      } catch {}
      return res.json({ rootPath: SELF_ROOT, locked: true, siteUrl: WORKSPACE_SITE_URL || '', gitBranch, gitStatus, lastCommit, lastCommitDate, aheadBehind: { ahead, behind } });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erreur interne' });
    }
  });

  // ── Multi-Workspace Endpoints ───────────────────────────────────────────────

  // GET /api/self-root/workspaces — Liste tous les dépôts enregistrés
  router.get('/workspaces', async (_req: Request, res: Response) => {
    try {
      const { listWorkspaces, SELF_ROOT, WORKSPACE_SITE_URL, hasProject } = await import('../utils/selfRoot.js');
      const workspaces = listWorkspaces();
      return res.json({
        workspaces,
        activeRoot: hasProject() ? SELF_ROOT : null,
        siteUrl: WORKSPACE_SITE_URL || '',
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erreur lors de la récupération des workspaces.' });
    }
  });

  // POST /api/self-root/workspaces/validate — Pré-valide un chemin avant ouverture
  router.post('/workspaces/validate', async (req: Request, res: Response) => {
    try {
      const Schema = z.object({
        path: z.string().min(1, 'Le chemin est requis.'),
      });
      const parsed = Schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ valid: false, error: parsed.error.errors[0]?.message ?? 'Chemin invalide.' });
      }
      const { validateWorkspacePath } = await import('../utils/selfRoot.js');
      const result = await validateWorkspacePath(parsed.data.path);
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ valid: false, error: e.message || 'Erreur de validation.' });
    }
  });

  // DELETE /api/self-root/workspaces/:id — Supprimer un workspace de l'historique (sans supprimer les fichiers sur disque)
  router.delete('/workspaces/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'ID du workspace requis.' });
      }
      const { removeWorkspace } = await import('../utils/selfRoot.js');
      const removed = removeWorkspace(id);
      return res.json({ success: removed, id });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erreur lors de la suppression du workspace.' });
    }
  });

  // PATCH /api/self-root/workspaces/:id — Mettre à jour le nom ou le siteUrl d'un workspace
  router.patch('/workspaces/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const Schema = z.object({
        name: z.string().min(1).optional(),
        siteUrl: z.string().url('URL invalide.').optional().or(z.literal('')),
      });
      const parsed = Schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Paramètres invalides.' });
      }
      const { updateWorkspaceMeta } = await import('../utils/selfRoot.js');
      const updated = updateWorkspaceMeta(id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: 'Workspace introuvable.' });
      }
      return res.json({ success: true, workspace: updated });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erreur lors de la mise à jour.' });
    }
  });

  // POST /api/self-root/change
  router.post('/change', async (req: Request, res: Response) => {
    try {
      const ChangeSchema = z.object({
        path: z.string().min(1, 'Le chemin est requis.'),
        userConfirmed: z.boolean().optional(),
        name: z.string().optional(),
        siteUrl: z.string().url('URL invalide.').optional().or(z.literal('')),
      });
      const parsed = ChangeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Paramètres invalides.' });
      }
      const { path: newPath, userConfirmed, siteUrl, name: customName } = parsed.data;

      // 1. Pré-validation stricte du chemin
      const { validateWorkspacePath } = await import('../utils/selfRoot.js');
      const validation = await validateWorkspacePath(newPath.trim());
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error || 'Chemin non valide ou inaccessible.' });
      }

      // Si la demande vient de l'UI Settings (confirmation locale déjà affichée),
      // on bypass la confirmation WS qui nécessite une session vocale active.
      let approved: boolean;
      if (userConfirmed === true) {
        console.log(`[SelfRoot] Changement pré-confirmé par l'UI : ${newPath.trim()}`);
        approved = true;
      } else {
        approved = await requestConfirmation(
          newPath.trim(), 'modify',
          (data) => {
            const wss = getWss();
            if (wss) {
              wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  try { client.send(JSON.stringify(data)); } catch {}
                }
              });
            }
          },
          `Changement du SELF_ROOT vers : ${newPath.trim()}`
        );
      }
      if (!approved) return res.status(403).json({ error: 'Changement refusé par l\'utilisateur.' });

      const { switchSandboxProject } = await import('../utils/sandbox.js');

      // La transition verrouille synchroniquement les écritures, recopie le
      // sandbox, redémarre le watcher, puis seulement publie l'état READY.
      const newRoot = await switchSandboxProject(newPath.trim());
      console.log(`[Sandbox] Sandbox READY pour le nouveau projet: ${newRoot}`);

      // Persister l'URL du site et nom si fournis
      const { setWorkspaceSiteUrl, addOrUpdateWorkspace } = await import('../utils/selfRoot.js');
      if (siteUrl !== undefined) {
        setWorkspaceSiteUrl(siteUrl);
      }
      addOrUpdateWorkspace(newRoot, siteUrl || undefined, customName);

      // 3. Recharger et réindexer le Knowledge System pour le nouveau projet
      try {
        const { knowledgeGraph } = await import('../knowledge/KnowledgeGraph.js');
        const { projectMemory } = await import('../knowledge/ProjectMemory.js');
        const { projectIndexer } = await import('../knowledge/ProjectIndexer.js');
        knowledgeGraph.load();
        projectMemory.load();
        projectIndexer.scanAll({
          onProgress: (p) => broadcastKnowledgeProgress(p.phase, p.current, p.total, { file: p.file }),
        }).then((stats: any) => {
          broadcastKnowledgeProgress('done', stats.totalFiles, stats.totalFiles, {
            totalEntities: stats.totalEntities,
            durationMs: stats.durationMs,
            cached: stats.cached ?? false,
          });
        }).catch(() => {});
        console.log(`[KnowledgeGraph] Rechargement pour: ${newRoot}`);
      } catch { /* silent */ }

      return res.json({ status: 'success', newRoot, siteUrl: siteUrl ?? '' });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // POST /api/self-root/clear — effacer le projet persisté (pour re-sélection)
  router.post('/clear', async (_req: Request, res: Response) => {
    try {
      const { resetSelfRoot } = await import('../utils/selfRoot.js');
      resetSelfRoot();
      // Désactiver le sandbox
      try {
        const { deactivateSandbox } = await import('../utils/sandbox.js');
        deactivateSandbox();
      } catch { /* silent */ }
      return res.json({ status: 'success' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/self-root/new — créer un projet vierge et l'activer
  router.post('/new', async (req: Request, res: Response) => {
    try {
      const NewProjectSchema = z.object({
        path: z.string().optional(),
        name: z.string().optional(),
        siteUrl: z.string().url('URL invalide.').optional().or(z.literal('')),
      }).refine(data => !!(data.path?.trim() || data.name?.trim()), {
        message: 'Un chemin ou un nom de projet est requis.',
      });
      const parsed = NewProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Paramètres invalides.' });
      }
      const { path: projectPath, name, siteUrl } = parsed.data;

      const fsModule = await import('fs');
      const pathModule = await import('path');
      const os = await import('os');

      // Déterminer le chemin final du nouveau projet
      let finalPath: string;
      if (projectPath?.trim()) {
        finalPath = pathModule.default.resolve(projectPath.trim());
      } else {
        // Si seulement un nom est fourni, créer dans le dossier Documents de l'utilisateur
        const docsDir = pathModule.default.join(os.default.homedir(), 'Documents', 'Leanna-Projects');
        finalPath = pathModule.default.join(docsDir, name!.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '_'));
      }

      // Créer le dossier s'il n'existe pas
      if (fsModule.default.existsSync(finalPath)) {
        // Le dossier existe déjà — on l'accepte si vide ou non
        console.log(`[SelfRoot/new] Dossier existant réutilisé: ${finalPath}`);
      } else {
        fsModule.default.mkdirSync(finalPath, { recursive: true });
        console.log(`[SelfRoot/new] Dossier créé: ${finalPath}`);
      }

      // Créer un fichier README.md minimal dans le projet vierge
      const readmePath = pathModule.default.join(finalPath, 'README.md');
      if (!fsModule.default.existsSync(readmePath)) {
        const projectName = pathModule.default.basename(finalPath);
        fsModule.default.writeFileSync(
          readmePath,
          `# ${projectName}\n\nProjet créé avec Leanna.\n`,
          'utf-8'
        );
      }

      // Activer le nouveau projet (même flux que /change)
      const { switchSandboxProject } = await import('../utils/sandbox.js');

      const newRoot = await switchSandboxProject(finalPath);
      console.log(`[Sandbox] Sandbox READY pour le nouveau projet: ${newRoot}`);

      // Persister l'URL du site si fournie
      if (siteUrl !== undefined) {
        const { setWorkspaceSiteUrl } = await import('../utils/selfRoot.js');
        setWorkspaceSiteUrl(siteUrl);
      }

      // Recharger le Knowledge System pour le nouveau projet (vide)
      try {
        const { knowledgeGraph } = await import('../knowledge/KnowledgeGraph.js');
        const { projectMemory } = await import('../knowledge/ProjectMemory.js');
        const { projectIndexer } = await import('../knowledge/ProjectIndexer.js');
        knowledgeGraph.load();
        projectMemory.load();
        projectIndexer.scanAll({
          onProgress: (p) => broadcastKnowledgeProgress(p.phase, p.current, p.total, { file: p.file }),
        }).then((stats: any) => {
          broadcastKnowledgeProgress('done', stats.totalFiles, stats.totalFiles, {
            totalEntities: stats.totalEntities,
            durationMs: stats.durationMs,
            cached: stats.cached ?? false,
          });
        }).catch(() => {});
      } catch { /* silent */ }

      return res.json({ status: 'success', newRoot, siteUrl: siteUrl ?? '' });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/self-root/scaffold — Scaffolde un projet React/Next/etc. avec logs
  // Utilise Server-Sent Events (SSE) pour streamer les logs en temps réel.
  // ─────────────────────────────────────────────────────────────────────────────
  router.post('/scaffold', async (req: Request, res: Response) => {
    type Framework = 'react-vite' | 'react-vite-js' | 'next' | 'react-router';
    interface FwConfig { bin: string; args: (n: string) => string[]; label: string; }

    const FRAMEWORKS: Record<Framework, FwConfig> = {
      'react-vite':    { bin: 'npm',  args: (n) => ['create', 'vite@latest', n, '--', '--template', 'react-ts'], label: 'React + Vite (TypeScript)' },
      'react-vite-js': { bin: 'npm',  args: (n) => ['create', 'vite@latest', n, '--', '--template', 'react'],    label: 'React + Vite (JavaScript)' },
      'next':          { bin: 'npx',  args: (n) => ['create-next-app@latest', n, '--typescript', '--eslint', '--tailwind', '--no-src-dir', '--app', '--import-alias', '@/*'], label: 'Next.js (TypeScript + App Router)' },
      'react-router':  { bin: 'npx',  args: (n) => ['create-react-router@latest', n, '--no-git-init'], label: 'React Router v7 (TypeScript)' },
    };

    const { spawn } = await import('child_process');
    const fsModule   = await import('fs');
    const pathModule = await import('path');
    const osModule   = await import('os');

    const {
      framework: rawFramework = 'react-vite',
      name: rawName,
      parent_path: rawParent,
    } = req.body as { framework?: string; name?: string; parent_path?: string };

    // ── Setup SSE ─────────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
      if (res.writableEnded) return;
      try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch { /* client gone */ }
    };
    const sendLog = (message: string, level: 'info' | 'warn' | 'error' = 'info') =>
      sendEvent('log', { level, message: message.trimEnd() });
    const finish = () => { try { if (!res.writableEnded) res.end(); } catch { /* ignore */ } };

    // ── Validation ────────────────────────────────────────────────────────────
    if (!rawName?.trim()) { sendEvent('error', { error: 'Le paramètre "name" est requis.' }); return finish(); }
    const projectName = rawName.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').toLowerCase();

    const framework = rawFramework.trim() as Framework;
    if (!FRAMEWORKS[framework]) {
      sendEvent('error', { error: `Framework inconnu: "${framework}". Valeurs: ${Object.keys(FRAMEWORKS).join(', ')}.` });
      return finish();
    }
    const fwConfig = FRAMEWORKS[framework];

    let parentDir: string;
    if (rawParent?.trim()) {
      parentDir = pathModule.default.resolve(rawParent.trim());
    } else {
      parentDir = pathModule.default.join(osModule.default.homedir(), 'Documents', 'Leanna-Projects');
    }

    const projectPath = pathModule.default.join(parentDir, projectName);

    if (fsModule.default.existsSync(projectPath)) {
      sendEvent('error', { error: `Le dossier "${projectName}" existe déjà dans ${parentDir}.` });
      return finish();
    }
    try {
      fsModule.default.mkdirSync(parentDir, { recursive: true });
    } catch (e: any) {
      sendEvent('error', { error: `Impossible de créer le dossier parent: ${e.message}` });
      return finish();
    }

    // ── Lancer le scaffolding ─────────────────────────────────────────────────
    const isWin = osModule.default.platform() === 'win32';
    const args  = fwConfig.args(projectName);

    sendLog(`🚀 Scaffolding "${projectName}" avec ${fwConfig.label}…`);
    sendLog(`📁 Destination: ${projectPath}`);
    sendLog(`⚙️  Commande: ${fwConfig.bin} ${args.join(' ')}`);
    sendLog(`─────────────────────────────────────────`);

    let child: import('child_process').ChildProcess;
    try {
      // Node.js 20+ gère automatiquement les .cmd sur Windows
      // Il suffit de spécifier l'extension dans le nom de la commande
      const spawnOptions: import('child_process').SpawnOptions = {
        cwd: parentDir,
        env: {
          ...process.env,
          CI: 'true',
          npm_config_yes: 'true',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        // Sur Windows, les .cmd nécessitent shell: true pour éviter EINVAL
        shell: isWin,
      };
      
      let command = fwConfig.bin;
      // Sur Windows, ajouter .cmd si c'est npm/npx et que l'extension n'est pas déjà présente
      if (isWin && !command.includes('.') && (command === 'npm' || command === 'npx')) {
        command += '.cmd';
      }
      
      child = spawn(command, args, spawnOptions);
    } catch (spawnErr: any) {
      sendLog(`❌ Impossible de lancer ${fwConfig.bin}: ${spawnErr.message}`, 'error');
      sendEvent('error', { error: spawnErr.message });
      return finish();
    }

    let stderrBuffer = '';
    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      lines.forEach(l => { if (l.trim()) sendLog(l, 'info'); });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf    += chunk.toString('utf-8');
      stderrBuffer += chunk.toString('utf-8');
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      lines.forEach(l => { if (l.trim()) sendLog(l, 'warn'); });
    });

    child.on('error', (err) => {
      sendLog(`❌ Erreur de lancement: ${err.message}`, 'error');
      sendEvent('error', { error: err.message });
      finish();
    });

    child.on('close', (code) => {
      (async () => {
        try {
          // Vider les buffers résiduels
          if (stdoutBuf.trim()) sendLog(stdoutBuf, 'info');
          if (stderrBuf.trim()) sendLog(stderrBuf, 'warn');
          sendLog(`─────────────────────────────────────────`);

          if (code !== 0 || !fsModule.default.existsSync(projectPath)) {
            const errMsg = `Scaffolding échoué (code: ${code ?? 'inconnu'}).`;
            sendLog(`❌ ${errMsg}`, 'error');
            if (stderrBuffer.trim()) sendLog(stderrBuffer.slice(-1500), 'error');
            sendEvent('error', { error: errMsg });
            return;
          }

          sendLog(`✅ Projet créé avec succès !`);
          sendLog(`🔌 Activation du workspace…`);

          try {
            const { switchSandboxProject } = await import('../utils/sandbox.js');

            const newRoot = await switchSandboxProject(projectPath);
            sendLog(`📦 Sandbox READY: ${newRoot}`);

            try {
              const { knowledgeGraph } = await import('../knowledge/KnowledgeGraph.js');
              const { projectMemory }  = await import('../knowledge/ProjectMemory.js');
              const { projectIndexer } = await import('../knowledge/ProjectIndexer.js');
              knowledgeGraph.load();
              projectMemory.load();
              projectIndexer.scanAll({
                onProgress: (p) => broadcastKnowledgeProgress(p.phase, p.current, p.total, { file: p.file }),
              }).then((stats: any) => {
                broadcastKnowledgeProgress('done', stats.totalFiles, stats.totalFiles, {
                  totalEntities: stats.totalEntities,
                  durationMs: stats.durationMs,
                  cached: stats.cached ?? false,
                });
              }).catch(() => {});
              sendLog(`🧠 Knowledge System rechargé.`);
            } catch { /* silent */ }

            sendLog(`🎉 Workspace basculé sur: ${newRoot}`);
            sendLog(`👉 Lancez maintenant : npm install && npm run dev`);
            sendEvent('done', { status: 'success', newRoot });
          } catch (activateErr: any) {
            sendLog(`⚠️  Scaffolding OK mais activation échouée: ${activateErr.message}`, 'warn');
            sendEvent('error', { error: activateErr.message });
          }
        } catch (outerErr: any) {
          console.error('[SelfRoot/scaffold] Erreur inattendue dans close handler:', outerErr);
          try { sendEvent('error', { error: outerErr?.message ?? String(outerErr) }); } catch { /* ignore */ }
        } finally {
          finish();
        }
      })().catch((e) => {
        console.error('[SelfRoot/scaffold] IIFE échoué:', e);
        finish();
      });
    });

    req.on('close', () => {
      if (res.writableEnded && !child.killed) {
        child.kill();
        console.log('[SelfRoot/scaffold] Client déconnecté — process tué.');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/self-root/clone — Clone un dépôt git distant et l'active comme workspace
  // Utilise Server-Sent Events (SSE) pour streamer la progression en temps réel.
  // Body: { url: string, targetDir?: string }
  // Events: { type: 'log', level, message } | { type: 'progress', phase, percent? }
  //       | { type: 'done', status: 'success', newRoot } | { type: 'error', error }
  // ─────────────────────────────────────────────────────────────────────────────
  router.post('/clone', async (req: Request, res: Response) => {
    const { spawn } = await import('child_process');
    const fsModule   = await import('fs');
    const pathModule = await import('path');
    const osModule   = await import('os');

    // ── Validation du body ────────────────────────────────────────────────────
    const CloneSchema = z.object({
      url:       z.string().min(1, 'L\'URL du dépôt est requise.'),
      targetDir: z.string().optional(),
    });
    const parsed = CloneSchema.safeParse(req.body);

    // ── Setup SSE ─────────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
      if (res.writableEnded) return;
      try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch { /* client gone */ }
    };
    const sendLog = (message: string, level: 'info' | 'warn' | 'error' = 'info') =>
      sendEvent('log', { level, message: message.trimEnd() });
    const finish = () => { try { if (!res.writableEnded) res.end(); } catch { /* ignore */ } };

    if (!parsed.success) {
      sendEvent('error', { error: parsed.error.errors[0]?.message ?? 'Paramètres invalides.' });
      return finish();
    }

    const { url: repoUrl, targetDir: rawTargetDir } = parsed.data;

    // Valider le format de l'URL (HTTPS ou SSH uniquement)
    if (!/^https?:\/\//i.test(repoUrl) && !/^git@/i.test(repoUrl)) {
      sendEvent('error', { error: 'Seules les URLs HTTPS et SSH (git@) sont autorisées.' });
      return finish();
    }

    // Dériver le nom du dépôt depuis l'URL
    const repoName = repoUrl.split('/').pop()?.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9_\-. ]/g, '_') || 'repo';

    // Dossier de destination
    let parentDir: string;
    if (rawTargetDir?.trim()) {
      parentDir = pathModule.default.resolve(rawTargetDir.trim());
    } else {
      parentDir = pathModule.default.join(osModule.default.homedir(), 'Documents', 'Leanna-Projects');
    }
    const clonePath = pathModule.default.join(parentDir, repoName);

    // Vérifier que la destination n'existe pas déjà
    if (fsModule.default.existsSync(clonePath)) {
      sendEvent('error', { error: `Le dossier de destination existe déjà: ${clonePath}`, clonePath });
      return finish();
    }

    // Créer le dossier parent si nécessaire
    try {
      fsModule.default.mkdirSync(parentDir, { recursive: true });
    } catch (e: any) {
      sendEvent('error', { error: `Impossible de créer le dossier parent: ${e.message}` });
      return finish();
    }

    sendLog(`🔗 Clonage de ${repoUrl}…`);
    sendLog(`📁 Destination: ${clonePath}`);
    sendLog(`⚙️  Commande: git clone ${repoUrl} ${clonePath}`);
    sendLog(`─────────────────────────────────────────`);

    const isWin = osModule.default.platform() === 'win32';

    let child: import('child_process').ChildProcess;
    try {
      // git est un binaire natif, pas besoin de shell même sur Windows
      // Node.js 21+ émet un avertissement si on combine shell:true avec args[]
      child = spawn('git', ['clone', '--progress', repoUrl, clonePath], {
        shell: false, // Pas besoin de shell pour git
        env: { ...process.env },
      });
    } catch (spawnErr: any) {
      sendLog(`❌ Impossible de lancer git: ${spawnErr.message}`, 'error');
      sendEvent('error', { error: spawnErr.message });
      return finish();
    }

    // git clone écrit sa progression sur stderr (comportement normal de git)
    let stderrBuf = '';
    let stdoutBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      lines.forEach(l => { if (l.trim()) sendLog(l, 'info'); });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrBuf += text;
      // Streamer chaque ligne de progression (git écrit "Receiving objects: X%...")
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      lines.forEach(l => {
        const trimmed = l.trim();
        if (!trimmed) return;
        // Distinguer les lignes de progression des vraies erreurs
        const isProgress = /^(Cloning|remote:|Receiving|Resolving|Counting|Compressing|Unpacking)/i.test(trimmed);
        sendLog(trimmed, isProgress ? 'info' : 'warn');
      });
    });

    child.on('error', (err) => {
      sendLog(`❌ Erreur git: ${err.message}`, 'error');
      sendEvent('error', { error: err.message });
      finish();
    });

    child.on('close', (code) => {
      (async () => {
        try {
          // Vider les buffers résiduels
          if (stdoutBuf.trim()) sendLog(stdoutBuf, 'info');
          if (stderrBuf.trim()) sendLog(stderrBuf, 'warn');
          sendLog(`─────────────────────────────────────────`);

          if (code !== 0 || !fsModule.default.existsSync(clonePath)) {
            const errMsg = `Clonage échoué (code: ${code ?? 'inconnu'}).`;
            sendLog(`❌ ${errMsg}`, 'error');
            // Nettoyer le dossier partiellement cloné
            try {
              if (fsModule.default.existsSync(clonePath)) {
                await fsModule.default.promises.rm(clonePath, { recursive: true, force: true });
              }
            } catch { /* silent */ }
            sendEvent('error', { error: errMsg });
            return;
          }

          sendLog(`✅ Clonage terminé avec succès !`);
          sendLog(`🔌 Activation du workspace…`);

          try {
            const { switchSandboxProject } = await import('../utils/sandbox.js');
            const newRoot = await switchSandboxProject(clonePath);
            sendLog(`📦 Sandbox READY: ${newRoot}`);

            const { addOrUpdateWorkspace } = await import('../utils/selfRoot.js');
            addOrUpdateWorkspace(newRoot, undefined, repoName);

            try {
              const { knowledgeGraph } = await import('../knowledge/KnowledgeGraph.js');
              const { projectMemory }  = await import('../knowledge/ProjectMemory.js');
              const { projectIndexer } = await import('../knowledge/ProjectIndexer.js');
              knowledgeGraph.load();
              projectMemory.load();
              projectIndexer.scanAll({
                onProgress: (p) => broadcastKnowledgeProgress(p.phase, p.current, p.total, { file: p.file }),
              }).then((stats: any) => {
                broadcastKnowledgeProgress('done', stats.totalFiles, stats.totalFiles, {
                  totalEntities: stats.totalEntities,
                  durationMs: stats.durationMs,
                  cached: stats.cached ?? false,
                });
              }).catch(() => {});
              sendLog(`🧠 Knowledge System rechargé.`);
            } catch { /* silent */ }

            sendLog(`🎉 Workspace basculé sur: ${newRoot}`);
            sendEvent('done', { status: 'success', newRoot, repoName });
          } catch (activateErr: any) {
            sendLog(`⚠️  Clone OK mais activation échouée: ${activateErr.message}`, 'warn');
            sendEvent('error', { error: activateErr.message });
          }
        } catch (outerErr: any) {
          console.error('[SelfRoot/clone] Erreur inattendue dans close handler:', outerErr);
          try { sendEvent('error', { error: outerErr?.message ?? String(outerErr) }); } catch { /* ignore */ }
        } finally {
          finish();
        }
      })().catch((e) => {
        console.error('[SelfRoot/clone] IIFE échoué:', e);
        finish();
      });
    });

    req.on('close', () => {
      if (!res.writableEnded && !child.killed) {
        child.kill();
        console.log('[SelfRoot/clone] Client déconnecté — git tué.');
      }
    });
  });

  // PATCH /api/self-root/site-url — mettre à jour uniquement l'URL du site
  router.patch('/site-url', async (req: Request, res: Response) => {
    try {
      const Schema = z.object({
        siteUrl: z.string().url('URL invalide.').or(z.literal('')),
      });
      const parsed = Schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'URL invalide.' });
      }
      const { setWorkspaceSiteUrl, hasProject } = await import('../utils/selfRoot.js');
      if (!hasProject()) {
        return res.status(400).json({ error: 'Aucun projet actif.' });
      }
      setWorkspaceSiteUrl(parsed.data.siteUrl);
      return res.json({ status: 'success', siteUrl: parsed.data.siteUrl });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
