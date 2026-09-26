import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { isSandboxActive, getSandboxRoot, getRealSandboxRoot, markFileModified, assertSafeSandboxPath, SandboxGuardError } from '../utils/sandbox.js';
import { resolveWorkspacePath, getDefaultWorkspaceRoot, isExcludedWorkspaceEntry } from '../security.js';
import { appendAuditEvent } from '../audit.js';

const router = Router();

async function countFilesRecursively(directory: string): Promise<number> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (isExcludedWorkspaceEntry(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      count += await countFilesRecursively(path.join(directory, entry.name));
    } else if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

// GET /api/ide/file-count
router.get('/file-count', async (req: Request, res: Response) => {
  try {
    const root = getWorkspaceRoot(req);
    if (!root) return res.status(200).json({ count: 0 });

    res.json({ count: await countFilesRecursively(root) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ide/tree
router.get('/tree', async (req: Request, res: Response) => {
  try {
    const root = getWorkspaceRoot(req);
    if (!root) return res.status(200).json({ path: '', entries: [] });

    // Pagination parameters
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page) : 1;
    const pageSize = typeof req.query.pageSize === 'string' ? parseInt(req.query.pageSize) : 0;

    // Target directory to list
    const targetDir = requestedPath 
      ? path.resolve(root, requestedPath.replace(/\\/g, '/'))
      : root;

    // Validate target directory is within workspace
    const relativeTarget = path.relative(root, targetDir);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      return res.status(403).json({ error: 'Chemin hors du workspace.' });
    }

    // Check if directory exists
    if (!fs.existsSync(targetDir)) {
      return res.status(404).json({ error: 'Répertoire introuvable.' });
    }

    const stat = await fs.promises.stat(targetDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Le chemin spécifié n\'est pas un répertoire.' });
    }

    // Read entries at this directory level only
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    
    // Filter excluded directories and sensitive files
    const filteredEntries = entries.filter(entry =>
      !isExcludedWorkspaceEntry(entry.name)
    );

    // Sort: directories first, then alphabetical
    const sortedEntries = filteredEntries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    // Pagination logic
    let resultEntries = sortedEntries;
    let pagination: any = null;

    if (pageSize > 0 && page >= 1) {
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      resultEntries = sortedEntries.slice(startIndex, endIndex);

      pagination = {
        page,
        pageSize,
        total: sortedEntries.length,
        totalPages: Math.ceil(sortedEntries.length / pageSize),
        hasMore: endIndex < sortedEntries.length
      };
    } else {
      // For backward compatibility: if no pagination requested, limit to prevent memory issues
      // Default safe limit for large directories
      const SAFE_LIMIT = 10000;
      if (sortedEntries.length > SAFE_LIMIT) {
        resultEntries = sortedEntries.slice(0, SAFE_LIMIT);
        pagination = {
          page: 1,
          pageSize: SAFE_LIMIT,
          total: sortedEntries.length,
          totalPages: Math.ceil(sortedEntries.length / SAFE_LIMIT),
          hasMore: true,
          warning: 'Limite de sécurité appliquée. Utilisez les paramètres de pagination pour accéder à tous les résultats.'
        };
      }
    }

    // Build response entries
    const responseEntries = resultEntries.map(entry => {
      const entryPath = path.join(targetDir, entry.name);
      const entryRel = path.relative(root, entryPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        return { 
          name: entry.name, 
          path: entryRel === '' ? '.' : entryRel, 
          type: 'directory' as const,
          children: [] // Empty children for paginated mode - clients should request subdirectories separately
        };
      }
      return { 
        name: entry.name, 
        path: entryRel === '' ? '.' : entryRel, 
        type: 'file' as const 
      };
    });

    const response: any = {
      path: targetDir,
      entries: responseEntries
    };

    if (pagination) {
      response.pagination = pagination;
    }

    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ide/tree-workspace — Returns the real workspace tree with server-side pagination (ignores sandbox)
router.get('/tree-workspace', async (req: Request, res: Response) => {
  try {
    const root = getDefaultWorkspaceRoot();
    if (!root) return res.status(200).json({ path: '', entries: [] });

    // Pagination parameters
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
    const page = typeof req.query.page === 'string' && !isNaN(parseInt(req.query.page))
      ? parseInt(req.query.page)
      : 1;
    const pageSize = typeof req.query.pageSize === 'string' && !isNaN(parseInt(req.query.pageSize))
      ? parseInt(req.query.pageSize)
      : 0;

    // Target directory to list
    const targetDir = requestedPath
      ? path.resolve(root, requestedPath.replace(/\\/g, '/'))
      : root;

    // Validate target directory is within workspace
    const relativeTarget = path.relative(root, targetDir);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      return res.status(403).json({ error: 'Chemin hors du workspace.' });
    }

    // Check if directory exists
    if (!fs.existsSync(targetDir)) {
      return res.status(404).json({ error: 'Répertoire introuvable.' });
    }

    const stat = await fs.promises.stat(targetDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Le chemin spécifié n\'est pas un répertoire.' });
    }

    // Read entries at this directory level only
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    
    // Filter excluded directories and sensitive files
    const filteredEntries = entries.filter(entry =>
      !isExcludedWorkspaceEntry(entry.name)
    );

    // Sort: directories first, then alphabetical
    const sortedEntries = filteredEntries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    // Pagination logic
    let resultEntries = sortedEntries;
    let pagination: any = null;

    if (pageSize > 0 && page >= 1) {
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      resultEntries = sortedEntries.slice(startIndex, endIndex);

      pagination = {
        page,
        pageSize,
        total: sortedEntries.length,
        totalPages: Math.ceil(sortedEntries.length / pageSize),
        hasMore: endIndex < sortedEntries.length
      };
    } else {
      // For backward compatibility: if no pagination requested, limit to prevent memory issues
      const SAFE_LIMIT = 10000;
      if (sortedEntries.length > SAFE_LIMIT) {
        resultEntries = sortedEntries.slice(0, SAFE_LIMIT);
        pagination = {
          page: 1,
          pageSize: SAFE_LIMIT,
          total: sortedEntries.length,
          totalPages: Math.ceil(sortedEntries.length / SAFE_LIMIT),
          hasMore: true,
          warning: 'Limite de sécurité appliquée. Utilisez les paramètres de pagination pour accéder à tous les résultats.'
        };
      }
    }

    // Build response entries
    const responseEntries = resultEntries.map(entry => {
      const entryPath = path.join(targetDir, entry.name);
      const entryRel = path.relative(root, entryPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: entryRel === '' ? '.' : entryRel,
          type: 'directory' as const,
          children: [] // Empty children for paginated mode - clients should request subdirectories separately
        };
      }
      return {
        name: entry.name,
        path: entryRel === '' ? '.' : entryRel,
        type: 'file' as const
      };
    });

    const response: any = {
      path: targetDir,
      entries: responseEntries
    };

    if (pagination) {
      response.pagination = pagination;
    }

    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ide/file
router.get('/file', async (req: Request, res: Response) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!requestedPath) return res.status(400).json({ error: 'Le chemin du fichier est requis.' });

  const resolved = resolveRequestedPath(req, requestedPath);
  if (!resolved || !resolved.ok) {
    const errorResult = resolved as { status: number; error: string };
    return res.status(errorResult.status || 403).json({ error: errorResult.error || 'Chemin hors du workspace.' });
  }
  const absolutePath = resolved.absolutePath;

  try {
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) return res.status(404).json({ error: 'Fichier introuvable.' });
  } catch {
    return res.status(404).json({ error: 'Fichier introuvable.' });
  }

  res.json({ path: requestedPath, content: await fs.promises.readFile(absolutePath, 'utf-8') });
});

// GET /api/ide/file-raw — Servir un fichier binaire brut (images, etc.)
router.get('/file-raw', async (req: Request, res: Response) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!requestedPath) return res.status(400).json({ error: 'Le chemin du fichier est requis.' });

  const resolved = resolveRequestedPath(req, requestedPath);
  if (!resolved || !resolved.ok) {
    const errorResult = resolved as { status: number; error: string };
    return res.status(errorResult.status || 403).json({ error: errorResult.error || 'Chemin hors du workspace.' });
  }
  const absolutePath = resolved.absolutePath;

  try {
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) return res.status(404).json({ error: 'Fichier introuvable.' });
  } catch {
    return res.status(404).json({ error: 'Fichier introuvable.' });
  }

  // Déterminer le Content-Type selon l'extension
  const ext = requestedPath.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const buffer = await fs.promises.readFile(absolutePath);
  res.send(buffer);
});

// POST /api/ide/file (save)
router.post('/file', async (req: Request, res: Response) => {
  const { path: requestedPath, content } = req.body as { path?: string; content?: string };
  if (!requestedPath) return res.status(400).json({ error: 'Le chemin du fichier est requis.' });

  const resolved = resolveRequestedWritePath(requestedPath);
  if (!resolved || !resolved.ok) {
    const errorResult = resolved as { status: number; error: string };
    return res.status(errorResult.status || 403).json({ error: errorResult.error || 'Chemin hors du workspace.' });
  }
  const absolutePath = resolved.absolutePath;

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, content || '', 'utf-8');
  
  // Track modified files in sandbox mode
  if (isSandboxActive()) {
    markFileModified(requestedPath);
  }
  await appendAuditEvent({ action: 'write_file', target: requestedPath, details: 'updated via IDE', actor: 'user' });
  res.json({ status: 'success', path: requestedPath, sandbox: isSandboxActive() });
});

// POST /api/ide/create-file
router.post('/create-file', async (req: Request, res: Response) => {
  const { path: requestedPath } = req.body as { path?: string };
  if (!requestedPath) return res.status(400).json({ error: 'Le chemin du fichier est requis.' });

  const resolved = resolveRequestedWritePath(requestedPath);
  if (!resolved || !resolved.ok) {
    const errorResult = resolved as { status: number; error: string };
    return res.status(errorResult.status || 403).json({ error: errorResult.error || 'Chemin hors du workspace.' });
  }
  const absolutePath = resolved.absolutePath;

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, '', 'utf-8');
  markFileModified(requestedPath);
  await appendAuditEvent({ action: 'create_file', target: requestedPath, details: 'created via IDE', actor: 'user' });
  res.json({ status: 'success', path: requestedPath });
});

// POST /api/ide/create-directory
router.post('/create-directory', async (req: Request, res: Response) => {
  const { path: requestedPath } = req.body as { path?: string };
  if (!requestedPath) return res.status(400).json({ error: 'Le chemin du dossier est requis.' });

  const resolved = resolveRequestedWritePath(requestedPath);
  if (!resolved || !resolved.ok) {
    const errorResult = resolved as { status: number; error: string };
    return res.status(errorResult.status || 403).json({ error: errorResult.error || 'Chemin hors du workspace.' });
  }
  const absolutePath = resolved.absolutePath;

  await fs.promises.mkdir(absolutePath, { recursive: true });
  await appendAuditEvent({ action: 'create_directory', target: requestedPath, details: 'created via IDE', actor: 'user' });
  res.json({ status: 'success', path: requestedPath });
});

// POST /api/ide/rename (move/rename)
router.post('/rename', async (req: Request, res: Response) => {
  const { oldPath, newPath } = req.body as { oldPath?: string; newPath?: string };
  if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath et newPath sont requis.' });

  const resolvedOld = resolveRequestedWritePath(oldPath);
  const resolvedNew = resolveRequestedWritePath(newPath);
  if (!resolvedOld || !resolvedOld.ok) return res.status(403).json({ error: 'Chemin source hors du workspace.' });
  if (!resolvedNew || !resolvedNew.ok) return res.status(403).json({ error: 'Chemin destination hors du workspace.' });

  if (!fs.existsSync(resolvedOld.absolutePath)) return res.status(404).json({ error: 'Source introuvable.' });
  if (fs.existsSync(resolvedNew.absolutePath))  return res.status(409).json({ error: 'Un fichier existe déjà à la destination.' });

  // Create parent dirs of destination if needed
  await fs.promises.mkdir(path.dirname(resolvedNew.absolutePath), { recursive: true });
  await fs.promises.rename(resolvedOld.absolutePath, resolvedNew.absolutePath);
  markFileModified(oldPath);
  markFileModified(newPath);
  await appendAuditEvent({ action: 'rename', target: oldPath, details: `→ ${newPath}`, actor: 'user' });
  res.json({ status: 'success', oldPath, newPath });
});

// POST /api/ide/copy
router.post('/copy', async (req: Request, res: Response) => {
  const { srcPath, destPath } = req.body as { srcPath?: string; destPath?: string };
  if (!srcPath || !destPath) return res.status(400).json({ error: 'srcPath et destPath sont requis.' });

  const resolvedSrc = resolveRequestedWritePath(srcPath);
  const resolvedDest = resolveRequestedWritePath(destPath);
  if (!resolvedSrc || !resolvedSrc.ok) return res.status(403).json({ error: 'Chemin source hors du workspace.' });
  if (!resolvedDest || !resolvedDest.ok) return res.status(403).json({ error: 'Chemin destination hors du workspace.' });

  if (!fs.existsSync(resolvedSrc.absolutePath)) return res.status(404).json({ error: 'Source introuvable.' });

  // Generate a unique destination path if it already exists
  let finalDest = resolvedDest.absolutePath;
  if (fs.existsSync(finalDest)) {
    const ext = path.extname(finalDest);
    const base = finalDest.slice(0, finalDest.length - ext.length);
    let i = 1;
    while (fs.existsSync(`${base}_copy${i > 1 ? i : ''}${ext}`)) i++;
    finalDest = `${base}_copy${i > 1 ? i : ''}${ext}`;
  }

  // Revalider la destination finale via l'autorité unique. Le chemin relatif
  // est dérivé de la racine RÉELLE (realpath) du sandbox, la même que celle
  // utilisée par assertSafeSandboxPath, afin d'éliminer toute fenêtre où
  // getSandboxRoot() pourrait diverger entre la résolution et la revalidation.
  let realSandboxRoot: string;
  try {
    realSandboxRoot = getRealSandboxRoot();
  } catch (error: any) {
    return res.status(503).json({ error: 'Racine du sandbox introuvable.' });
  }
  const finalDestRelative = path.relative(realSandboxRoot, finalDest);
  try {
    finalDest = assertSafeSandboxPath(finalDestRelative);
  } catch (error: any) {
    return res.status(error?.code === 'SANDBOX_NOT_READY' ? 503 : 403).json({ error: error?.message ?? 'Destination hors sandbox.' });
  }

  await fs.promises.mkdir(path.dirname(finalDest), { recursive: true });

  // Recursive copy helper: les liens symboliques sont explicitement refusés
  // afin qu'une copie ne puisse jamais suivre une cible hors sandbox.
  const copyRecursive = async (src: string, dest: string) => {
    const stat = await fs.promises.lstat(src);
    if (stat.isSymbolicLink()) throw new Error('Copie refusée : lien symbolique détecté dans le sandbox.');
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      const entries = await fs.promises.readdir(src);
      for (const entry of entries) {
        await copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      await fs.promises.copyFile(src, dest);
    }
  };

  await copyRecursive(resolvedSrc.absolutePath, finalDest);
  const finalRelative = path.relative(realSandboxRoot, finalDest).replace(/\\/g, '/');
  markFileModified(finalRelative);
  await appendAuditEvent({ action: 'copy', target: srcPath, details: `→ ${destPath}`, actor: 'user' });
  res.json({ status: 'success', srcPath, destPath: finalRelative });
});

// POST /api/ide/search
router.post('/search', async (req: Request, res: Response) => {
  const { query, caseSensitive, regex, filePattern } = req.body as {
    query?: string;
    caseSensitive?: boolean;
    regex?: boolean;
    filePattern?: string;
  };

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query string is required' });
  }

  try {
    const results: Array<{ file: string; line: number; column: number; preview: string }> = [];
    const root = getWorkspaceRoot(req);

    const searchDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (isExcludedWorkspaceEntry(entry.name) || ['.next', '.vscode'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.isFile()) {
          // Skip binary files, images, etc.
          const ext = path.extname(entry.name).toLowerCase();
          if (['.exe', '.dll', '.so', '.dylib', '.jpg', '.jpeg', '.png', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
            continue;
          }

          // Apply file pattern filter if specified
          if (filePattern && !entry.name.includes(filePattern)) {
            continue;
          }

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
              const line = lines[lineNum];
              let searchText = line;
              let searchQuery = query;

              if (!caseSensitive) {
                searchText = line.toLowerCase();
                searchQuery = query.toLowerCase();
              }

              let matches: RegExpMatchArray[] = [];

              if (regex) {
                try {
                  const flags = caseSensitive ? 'g' : 'gi';
                  const regexObj = new RegExp(query, flags);
                  let match;
                  while ((match = regexObj.exec(line)) !== null) {
                    matches.push(match);
                    if (!regexObj.global) break;
                  }
                } catch {
                  // Invalid regex, fallback to text search
                  const index = searchText.indexOf(searchQuery);
                  if (index !== -1) {
                    matches.push([searchQuery] as any);
                    matches[matches.length - 1].index = index;
                  }
                }
              } else {
                let startIndex = 0;
                let index;
                while ((index = searchText.indexOf(searchQuery, startIndex)) !== -1) {
                  matches.push([searchQuery] as any);
                  matches[matches.length - 1].index = index;
                  startIndex = index + searchQuery.length;
                }
              }

              for (const match of matches) {
                results.push({
                  file: relPath,
                  line: lineNum + 1,
                  column: (match.index ?? 0) + 1,
                  preview: line,
                });

                // Limit results to prevent overwhelming
                if (results.length >= 1000) {
                  return res.json({ results: results.slice(0, 1000), truncated: true });
                }
              }
            }
          } catch {
            // Skip files that can't be read as UTF-8
            continue;
          }
        }
      }
    };

    searchDir(root);
    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ide/file
router.delete('/file', async (req: Request, res: Response) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!requestedPath) return res.status(400).json({ error: 'Le chemin du fichier est requis.' });

  const resolved = resolveRequestedWritePath(requestedPath);
  if (!resolved || !resolved.ok) {
    const errorResult = resolved as { status: number; error: string };
    return res.status(errorResult.status || 403).json({ error: errorResult.error || 'Chemin hors du workspace.' });
  }
  const absolutePath = resolved.absolutePath;

  try {
    const stat = await fs.promises.stat(absolutePath);
    if (stat.isDirectory()) {
      await fs.promises.rm(absolutePath, { recursive: true });
    } else {
      await fs.promises.unlink(absolutePath);
    }
    markFileModified(requestedPath);
    await appendAuditEvent({ action: 'delete', target: requestedPath, details: 'deleted via IDE', actor: 'user' });
    res.json({ status: 'success', path: requestedPath });
  } catch {
    return res.status(404).json({ error: 'Fichier introuvable.' });
  }
});

// Helper functions
function getWorkspaceRoot(req: Request): string {
  if (isSandboxActive()) {
    return getSandboxRoot();
  }
  return getDefaultWorkspaceRoot();
}

function resolveRequestedWritePath(requestedPath: string): { ok: boolean; absolutePath: string; status?: number; error?: string } {
  try {
    return { ok: true, absolutePath: assertSafeSandboxPath(requestedPath) };
  } catch (error: any) {
    const guardError = error as SandboxGuardError;
    return {
      ok: false,
      absolutePath: "",
      status: guardError?.code === "SANDBOX_NOT_READY" ? 503 : 403,
      error: guardError?.message ?? "Écriture hors sandbox refusée.",
    };
  }
}

function resolveRequestedPath(_req: Request, requestedPath: string): { ok: boolean; absolutePath: string; status?: number; error?: string } | null {
  const root = getWorkspaceRoot(_req);
  const result = resolveWorkspacePath(requestedPath, root);
  if (!result.ok) {
    return { ok: false, absolutePath: '', status: result.status, error: result.error };
  }
  return result;
}

export default router;