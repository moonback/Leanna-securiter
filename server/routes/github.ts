import { Router, Request, Response } from 'express';
import type { SkillManagerV2 } from '../runtime/compat/SkillManagerV2.js';
import { SELF_ROOT } from '../utils/selfRoot.js';

// Type compatible avec l'ancien SkillManager pour une migration progressive
type SkillManager = SkillManagerV2;

export function createGithubRouter(skillManager: SkillManager): Router {
  const router = Router();

  async function execGit(args: string[], timeout = 10000) {
    const { execFile: execFileCb } = await import('child_process');
    const { promisify: promisifyUtil } = await import('util');
    const execFileP = promisifyUtil(execFileCb);
    return execFileP('git', args, {
      cwd: SELF_ROOT,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 1024 * 1024,
    });
  }

  const workspaceGitPaths = ['.', ':(exclude).Leanna', ':(exclude).Leanna/**'];

  // GET /api/github/repos
  router.get('/repos', async (req: Request, res: Response) => {
    try {
      const { username, sort, limit, visibility } = req.query as {
        username?: string;
        sort?: string;
        limit?: string;
        visibility?: string;
      };
      const result = await skillManager.handleToolCall('list_github_repos', {
        username: username || undefined,
        sort: sort || 'updated',
        limit: limit ? parseInt(limit, 10) : 50,
        visibility: visibility || undefined,
      });
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/user
  router.get('/user', async (req: Request, res: Response) => {
    try {
      const { username } = req.query as { username?: string };
      const result = await skillManager.handleToolCall('get_github_user', { username });
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/repo-info
  router.get('/repo-info', async (req: Request, res: Response) => {
    try {
      const { owner, repo } = req.query as { owner?: string; repo?: string };
      if (!owner || !repo) return res.status(400).json({ error: 'owner et repo sont requis.' });
      const result = await skillManager.handleToolCall('get_github_repo', { owner, repo });
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/issues
  router.get('/issues', async (req: Request, res: Response) => {
    try {
      const { owner, repo, state } = req.query as { owner?: string; repo?: string; state?: string };
      if (!owner || !repo) return res.status(400).json({ error: 'owner et repo sont requis.' });
      const result = await skillManager.handleToolCall('list_github_issues', { owner, repo, state: state || 'open' });
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/pulls
  router.get('/pulls', async (req: Request, res: Response) => {
    try {
      const { owner, repo, state } = req.query as { owner?: string; repo?: string; state?: string };
      if (!owner || !repo) return res.status(400).json({ error: 'owner et repo sont requis.' });
      const result = await skillManager.handleToolCall('list_github_pull_requests', { owner, repo, state: state || 'open' });
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/notifications
  router.get('/notifications', async (_req: Request, res: Response) => {
    try {
      const result = await skillManager.handleToolCall('get_github_notifications', {});
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/search
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const { query } = req.query as { query?: string };
      if (!query) return res.status(400).json({ error: 'query est requis.' });
      const result = await skillManager.handleToolCall('search_github_repos', { query });
      if (result?.error) return res.status(200).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/github/current-repo
  router.get('/current-repo', async (_req: Request, res: Response) => {
    try {
      const { execFile: execFileCb } = await import('child_process');
      const { promisify: promisifyUtil } = await import('util');
      const execFileP = promisifyUtil(execFileCb);

      const { stdout } = await execFileP('git', ['remote', 'get-url', 'origin'], {
        cwd: SELF_ROOT,
        timeout: 5000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      const remoteUrl = stdout.trim();
      let owner = '';
      let repo = '';
      const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (httpsMatch) {
        owner = httpsMatch[1];
        repo = httpsMatch[2].replace(/\.git$/, '');
      }

      if (!owner || !repo) {
        return res.json({ status: 'no_github', remoteUrl });
      }
      res.json({ status: 'success', owner, repo, full_name: `${owner}/${repo}`, remoteUrl });
    } catch (e: any) {
      res.json({ status: 'no_repo', error: e.stderr?.trim() || e.message });
    }
  });

  // POST /api/github/clone (désactivé — utilisez le sélecteur de projet pour importer un projet local)
  router.post('/clone', (_req: Request, res: Response) => {
    res.status(403).json({
      error: 'Le clonage direct de repos GitHub est désactivé. Clonez le repo localement puis importez-le via le sélecteur de projet.',
    });
  });

  // POST /api/github/ingest-repository
  // Ingestion complète d'un dépôt GitHub public dans un notebook
  router.post('/ingest-repository', async (req: Request, res: Response) => {
    try {
      const { owner, repo, notebook_id, branch, max_files, file_extensions } = req.body as {
        owner?: string;
        repo?: string;
        notebook_id?: string;
        branch?: string;
        max_files?: number;
        file_extensions?: string[];
      };

      if (!owner || !repo || !notebook_id) {
        return res.status(400).json({ 
          error: 'Les paramètres owner, repo et notebook_id sont requis.' 
        });
      }

      console.log(`[GitHub] Ingestion repo API: ${owner}/${repo} vers notebook ${notebook_id}`);

      // Chemin UTILISATEUR uniquement. L'agent n'a plus accès aux notebooks, donc
      // l'ingestion n'est plus exposée comme outil (skillManager). On appelle
      // directement les modules notebooks côté serveur.
      try {
        const { sourceIngester, notebookManager } = await import('../notebooks/index.js');

        const options: any = {
          maxFiles: Math.min(max_files || 100, 200),
          fileExtensions: file_extensions || ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.hpp', '.md', '.txt', '.json', '.yaml', '.yml'],
          branch: branch || undefined,
        };

        const source = await sourceIngester.ingestFromGitHubRepository(owner, repo, notebook_id, options);

        const updatedNb = notebookManager.addSource(notebook_id, source);
        if (!updatedNb) {
          return res.status(404).json({ status: 'error', error: `Notebook ${notebook_id} introuvable.` });
        }

        console.log(`[GitHub] ingestion repo OK: ${owner}/${repo}`);
        res.json({
          status: 'success',
          source: {
            id: source.id,
            title: source.title,
            type: source.type,
            origin: source.origin,
            wordCount: source.wordCount,
            fileCount: source.metadata?.githubRepo?.fileCount || 0,
            chunks: source.chunks.length,
            summary: source.summary,
            keywords: source.keywords,
          },
          notebook_id,
          repository: `${owner}/${repo}`,
        });
      } catch (ingestErr: any) {
        console.warn(`[GitHub] ingestion repo échec: ${ingestErr.message}`);
        return res.status(200).json({ status: 'error', error: `Échec de l'ingestion: ${ingestErr.message}` });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Erreur serveur lors de l\'ingestion du dépôt GitHub.' });
    }
  });

  // GET /api/github/repo-files
  // Lister les fichiers d'un dépôt GitHub
  router.get('/repo-files', async (req: Request, res: Response) => {
    try {
      const { owner, repo, ref, max_files, file_extensions } = req.query as {
        owner?: string;
        repo?: string;
        ref?: string;
        max_files?: string;
        file_extensions?: string;
      };

      if (!owner || !repo) {
        return res.status(400).json({ 
          error: 'Les paramètres owner et repo sont requis.' 
        });
      }

      const result = await skillManager.handleToolCall('list_github_repo_files', {
        owner,
        repo,
        ref: ref || undefined,
        max_files: max_files ? Number(max_files) : 100,
        file_extensions: file_extensions ? JSON.parse(file_extensions) : undefined,
      });

      if (result?.error) {
        console.warn(`[GitHub] list repo files échec: ${result.error}`);
        return res.status(200).json({ status: 'error', error: result.error });
      }

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ 
        error: e.message || 'Erreur serveur lors de la récupération des fichiers.' 
      });
    }
  });

  // GET /api/github/status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const [{ stdout: statusOut }, { stdout: branchOut }] = await Promise.all([
        execGit(['status', '--porcelain=v1', '--', ...workspaceGitPaths]),
        execGit(['branch', '--show-current']),
      ]);
      const files = statusOut.split('\n').filter(Boolean).map(line => ({
        index: line.slice(0, 1),
        worktree: line.slice(1, 2),
        path: line.slice(3),
      }));
      res.json({ branch: branchOut.trim(), files, clean: files.length === 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.stderr?.trim() || e.message || 'Impossible de lire le statut Git.' });
    }
  });

  // POST /api/github/commit
  router.post('/commit', async (req: Request, res: Response) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return res.status(400).json({ error: 'Le message de commit est requis.' });
      if (message.length > 200) return res.status(400).json({ error: 'Le message de commit ne doit pas dépasser 200 caractères.' });

      const { stdout: statusOut } = await execGit(['status', '--porcelain=v1', '--', ...workspaceGitPaths]);
      if (!statusOut.trim()) return res.status(400).json({ error: 'Aucune modification à committer.' });
      await execGit(['add', '--all', '--', ...workspaceGitPaths]);
      const { stdout } = await execGit(['commit', '-m', message]);
      res.json({ success: true, output: stdout.trim() });
    } catch (e: any) {
      res.status(500).json({ error: e.stderr?.trim() || e.message || 'Impossible de créer le commit.' });
    }
  });

  // POST /api/github/push
  router.post('/push', async (_req: Request, res: Response) => {
    try {
      const { stdout } = await execGit(['push'], 30000);
      res.json({ success: true, output: stdout.trim() || 'Push terminé.' });
    } catch (e: any) {
      res.status(500).json({ error: e.stderr?.trim() || e.message || 'Impossible de pousser vers GitHub.' });
    }
  });

  // GET /api/github/commits
  router.get('/commits', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const { execFile: execFileCb } = await import('child_process');
      const { promisify: promisifyUtil } = await import('util');
      const execFileP = promisifyUtil(execFileCb);

      const separator = '---COMMIT_SEP---';
      const format = `%H${separator}%h${separator}%an${separator}%ae${separator}%at${separator}%s`;
      const { stdout } = await execFileP('git', [
        'log', `--max-count=${limit}`, `--pretty=format:${format}`,
      ], {
        cwd: SELF_ROOT,
        timeout: 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      const lines = stdout.trim().split('\n').filter(Boolean);
      const commits = lines.map(line => {
        const [hash, shortHash, author, email, timestamp, ...msgParts] = line.split(separator);
        return {
          hash,
          shortHash,
          author,
          email,
          date: new Date(Number(timestamp) * 1000).toISOString(),
          message: msgParts.join(separator),
        };
      });

      res.json({ commits });
    } catch (e: any) {
      res.status(500).json({ error: e.stderr?.trim() || e.message || 'Impossible de récupérer les commits.' });
    }
  });

  // GET /api/github/commits/:hash
  router.get('/commits/:hash', async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;
      if (!hash || !/^[a-f0-9]+$/i.test(hash)) {
        return res.status(400).json({ error: 'Hash invalide.' });
      }

      const { execFile: execFileCb } = await import('child_process');
      const { promisify: promisifyUtil } = await import('util');
      const execFileP = promisifyUtil(execFileCb);

      const { stdout: infoOut } = await execFileP('git', [
        'show', '--no-patch', '--pretty=format:%H%n%an%n%ae%n%at%n%B', hash,
      ], {
        cwd: SELF_ROOT,
        timeout: 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      const lines = infoOut.split('\n');
      const commitHash = lines[0];
      const author = lines[1];
      const email = lines[2];
      const timestamp = lines[3];
      const message = lines.slice(4).join('\n').trim();

      const { stdout: filesOut } = await execFileP('git', [
        'diff-tree', '--no-commit-id', '-r', '--name-status', hash,
      ], {
        cwd: SELF_ROOT,
        timeout: 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      const files = filesOut.trim().split('\n').filter(Boolean).map(line => {
        const [status, ...pathParts] = line.split('\t');
        return { status: status.charAt(0), path: pathParts.join('\t') };
      });

      res.json({
        hash: commitHash,
        author,
        email,
        date: new Date(Number(timestamp) * 1000).toISOString(),
        message,
        files,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.stderr?.trim() || e.message || 'Impossible de récupérer le détail du commit.' });
    }
  });

  return router;
}