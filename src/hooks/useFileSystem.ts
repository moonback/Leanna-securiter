import { useState, useCallback, useEffect } from 'react';
import { ideApi, type TreeEntry } from '../services/ideApi.js';
import { type OpenFile } from '../types/ide.js';
import { getLanguage } from '../utils/fileUtils.js';

export type DiffInfo = {
  status: 'added' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
};

/**
 * Hook for managing file system operations and state
 */
export function useFileSystem() {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [workspaceTree, setWorkspaceTree] = useState<TreeEntry[]>([]);
  const [diffPaths, setDiffPaths] = useState<Map<string, DiffInfo>>(new Map());
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));
  const [loading, setLoading] = useState(false);
  const [currentDir, setCurrentDir] = useState<string>('.');

  // Load tree on mount
  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await ideApi.loadTree();
      setTree(entries);
    } catch (error) {
      console.error('Erreur lors du chargement de l\'arborescence:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load workspace tree (real files, hors sandbox)
  const loadWorkspaceTree = useCallback(async () => {
    try {
      const entries = await ideApi.loadWorkspaceTree();
      setWorkspaceTree(entries);
    } catch {
      // silent — workspace tree is supplementary
    }
  }, []);

  // Load diff status from sandbox API
  const loadDiff = useCallback(async (force = true) => {
    try {
      const { sandboxApi } = await import('../services/sandboxApi.js');
      const data = await sandboxApi.getDiff(force);
      if (data.status === 'success' && Array.isArray((data as any).diff)) {
        const map = new Map<string, DiffInfo>();
        for (const item of (data as any).diff) {
          map.set(item.path, {
            status: item.status,
            additions: item.additions ?? 0,
            deletions: item.deletions ?? 0,
          });
        }
        setDiffPaths(map);
      }
    } catch {
      // silent
    }
  }, []);

  // Deduplicate open files whenever the list changes
  useEffect(() => {
    const uniqueFiles = Array.from(new Map(openFiles.map(f => [f.path, f])).values());
    if (uniqueFiles.length !== openFiles.length) {
      setOpenFiles(uniqueFiles);
      // If activePath was for a duplicate file, keep it
      if (activePath && !uniqueFiles.find(f => f.path === activePath)) {
        setActivePath(uniqueFiles.length > 0 ? uniqueFiles[uniqueFiles.length - 1].path : null);
      }
    }
  }, [openFiles, activePath]);

  useEffect(() => {
    loadTree();
    loadWorkspaceTree();
    loadDiff(true);
  }, [loadTree, loadWorkspaceTree, loadDiff]);

  // Reload tree and diffs when sandbox state changes
  useEffect(() => {
    const handleSandboxChange = () => {
      loadTree();
      loadWorkspaceTree();
      loadDiff(true);
    };
    window.addEventListener('Leanna-sandbox-changed', handleSandboxChange);
    return () => window.removeEventListener('Leanna-sandbox-changed', handleSandboxChange);
  }, [loadTree, loadWorkspaceTree, loadDiff]);

  // ── Temps réel : recharger les fichiers ouverts et les diffs quand modifiés dans le sandbox ──
  useEffect(() => {
    const handleFileChanged = (e: Event) => {
      loadDiff(true);
      const detail = (e as CustomEvent).detail;
      if (!detail?.path) return;
      const changedPath = detail.path as string;
      // Si le fichier modifié est ouvert, le recharger depuis le disque
      const openFile = openFiles.find(f => f.path === changedPath || f.path.endsWith(changedPath));
      if (openFile && !openFile.path.startsWith('__browser__:')) {
        (async () => {
          try {
            const content = await ideApi.readFile(openFile.path);
            setOpenFiles(prev => prev.map(f =>
              f.path === openFile.path ? { ...f, content, dirty: false } : f
            ));
          } catch { /* silent */ }
        })();
      }
    };

    const handleFileDeleted = (e: Event) => {
      loadDiff(true);
      const detail = (e as CustomEvent).detail;
      if (!detail?.path) return;
      const deletedPath = detail.path as string;
      // Fermer l'onglet si le fichier supprimé est ouvert
      const openFile = openFiles.find(f => f.path === deletedPath || f.path.endsWith(deletedPath));
      if (openFile) {
        setOpenFiles(prev => prev.filter(f => f.path !== openFile.path));
        if (activePath === openFile.path) {
          const remaining = openFiles.filter(f => f.path !== openFile.path);
          setActivePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
        }
      }
    };

    window.addEventListener('Leanna-sandbox-file-changed', handleFileChanged);
    window.addEventListener('Leanna-sandbox-file-deleted', handleFileDeleted);
    return () => {
      window.removeEventListener('Leanna-sandbox-file-changed', handleFileChanged);
      window.removeEventListener('Leanna-sandbox-file-deleted', handleFileDeleted);
    };
  }, [openFiles, activePath]);
  // Open a file
  const openFile = useCallback(async (filePath: string) => {
    const existingFile = openFiles.find((f) => f.path === filePath);
    if (existingFile) {
      setActivePath(filePath);
      return;
    }

    // Check if this is a browser tab (prefixed with __browser__:)
    const browserPrefix = '__browser__:';
    if (filePath.startsWith(browserPrefix)) {
      const url = filePath.slice(browserPrefix.length);
      const newFile: OpenFile = {
        path: filePath,
        content: '',
        dirty: false,
        language: '',
        type: 'browser',
        browserUrl: url,
      };
      setOpenFiles((prev) => [...prev.filter((f) => f.path !== filePath), newFile]);
      setActivePath(filePath);
      return;
    }

    // Fichiers binaires (images) : on les ouvre sans lire le contenu texte
    const isBinary = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|pdf)$/i.test(filePath);

    try {
      const content = isBinary ? '' : await ideApi.readFile(filePath);
      const newFile: OpenFile = {
        path: filePath,
        content,
        dirty: false,
        language: getLanguage(filePath),
        type: 'file',
      };
      // Ensure no duplicates by filtering out any existing entry with the same path first
      setOpenFiles((prev) => [...prev.filter((f) => f.path !== filePath), newFile]);
      setActivePath(filePath);
    } catch (error) {
      console.error('Erreur lors de l\'ouverture du fichier:', error);
    }
  }, [openFiles]);

  // Save active file
  const saveFile = useCallback(async (filePath: string, content: string) => {
    // Don't try to save browser tabs
    if (filePath.startsWith('__browser__:')) {
      return;
    }
    try {
      await ideApi.saveFile(filePath, content);
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, content, dirty: false } : f))
      );
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
    }
  }, []);

  // Update file content (mark as dirty)
  const updateFileContent = useCallback((filePath: string, content: string) => {
    // Don't try to update browser tabs
    if (filePath.startsWith('__browser__:')) {
      return;
    }
    setOpenFiles((prev) =>
      prev.map((file) =>
        file.path === filePath ? { ...file, content, dirty: file.content !== content } : file
      )
    );
  }, []);

  // Reload file from disk (used when assistant modifies it) — returns new content
  const reloadFile = useCallback(async (filePath: string): Promise<string | null> => {
    // Don't try to reload browser tabs
    if (filePath.startsWith('__browser__:')) {
      return null;
    }
    try {
      const content = await ideApi.readFile(filePath);
      setOpenFiles((prev) =>
        prev.map((file) =>
          file.path === filePath ? { ...file, content, dirty: false } : file
        )
      );
      setActivePath(filePath);
      return content;
    } catch (error) {
      console.error('Erreur lors du rechargement du fichier:', error);
      return null;
    }
  }, []);

  // Force-reload: close the tab then reopen it fresh from disk
  const forceReloadFile = useCallback(async (filePath: string): Promise<void> => {
    // Don't try to reload browser tabs
    if (filePath.startsWith('__browser__:')) {
      return;
    }
    try {
      const content = await ideApi.readFile(filePath);
      // Atomically replace the file entry so Monaco gets a brand-new value prop
      setOpenFiles((prev) => {
        const exists = prev.some((f) => f.path === filePath);
        if (!exists) return prev;
        return prev.map((f) =>
          f.path === filePath
            ? { ...f, content, dirty: false, _reloadKey: Date.now() } as any
            : f
        );
      });
      setActivePath(filePath);
    } catch (error) {
      console.error('Erreur lors du rechargement forcé:', error);
    }
  }, []);

  // Close a tab
  const closeTab = useCallback((filePath: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    if (activePath === filePath) {
      const remainingFiles = openFiles.filter((f) => f.path !== filePath);
      setActivePath(remainingFiles.length > 0 ? remainingFiles[remainingFiles.length - 1].path : null);
    }
  }, [openFiles, activePath]);

  // Create file
  const createFile = useCallback(async (dirPath: string, fileName: string) => {
    const fullPath = dirPath === '.' ? fileName : `${dirPath}/${fileName}`;
    try {
      await ideApi.createFile(fullPath);
      await loadTree();
      await openFile(fullPath);
    } catch (error) {
      console.error('Erreur lors de la création du fichier:', error);
    }
  }, [loadTree, openFile]);

  // Create folder
  const createFolder = useCallback(async (dirPath: string, folderName: string) => {
    const fullPath = dirPath === '.' ? folderName : `${dirPath}/${folderName}`;
    try {
      await ideApi.createDirectory(fullPath);
      await loadTree();
      setExpandedDirs((prev) => new Set([...prev, fullPath]));
    } catch (error) {
      console.error('Erreur lors de la création du dossier:', error);
    }
  }, [loadTree]);

  // Rename entry
  const renameEntry = useCallback(async (oldPath: string, newName: string) => {
    const pathParts = oldPath.split('/');
    pathParts[pathParts.length - 1] = newName;
    const newPath = pathParts.join('/');

    if (oldPath === newPath) return;

    try {
      await ideApi.rename(oldPath, newPath);
      setOpenFiles((prev) => prev.map((f) => (f.path === oldPath ? { ...f, path: newPath } : f)));
      if (activePath === oldPath) {
        setActivePath(newPath);
      }
      await loadTree();
    } catch (error) {
      console.error('Erreur lors du renommage:', error);
    }
  }, [activePath, loadTree]);

  // Delete entry
  const deleteEntry = useCallback(async (entryPath: string) => {
    try {
      await ideApi.deleteEntry(entryPath);
      setOpenFiles((prev) => prev.filter((f) => f.path !== entryPath));
      if (activePath === entryPath) {
        const remainingFiles = openFiles.filter((f) => f.path !== entryPath);
        setActivePath(remainingFiles.length > 0 ? remainingFiles[remainingFiles.length - 1].path : null);
      }
      await loadTree();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
    }
  }, [activePath, openFiles, loadTree]);

  // Toggle directory expansion
  const toggleDirectory = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const loadDirectory = useCallback(async (dirPath: string) => {
    try {
      const entries = await ideApi.loadTree(true, dirPath);
      setTree((currentTree) => replaceDirectoryChildren(currentTree, dirPath, entries));
    } catch (error) {
      console.error('Erreur lors du chargement du dossier:', error);
    }
  }, []);

  const loadWorkspaceDirectory = useCallback(async (dirPath: string) => {
    try {
      const entries = await ideApi.loadWorkspaceTree(true, dirPath);
      setWorkspaceTree((currentTree) => replaceDirectoryChildren(currentTree, dirPath, entries));
    } catch (error) {
      console.error('Erreur lors du chargement du dossier workspace:', error);
    }
  }, []);

  // Duplicate a file/folder (creates a copy with _copy suffix)
  const duplicateEntry = useCallback(async (srcPath: string) => {
    const name = srcPath.split('/').pop() ?? srcPath;
    const ext  = name.includes('.') && !name.startsWith('.') ? `.${name.split('.').pop()}` : '';
    const base = ext ? name.slice(0, name.length - ext.length) : name;
    const dir  = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '.';
    const destPath = dir === '.' ? `${base}_copy${ext}` : `${dir}/${base}_copy${ext}`;
    try {
      await ideApi.copyEntry(srcPath, destPath);
      await loadTree();
    } catch (error) {
      console.error('Erreur lors de la duplication:', error);
    }
  }, [loadTree]);

  // Move a file/folder into a target directory (drag & drop)
  const moveEntry = useCallback(async (srcPath: string, destDir: string) => {
    const name = srcPath.split('/').pop() ?? srcPath;
    const destPath = destDir === '.' ? name : `${destDir}/${name}`;
    if (destPath === srcPath) return;
    try {
      await ideApi.moveEntry(srcPath, destPath);
      setOpenFiles((prev) => prev.map((f) => f.path === srcPath ? { ...f, path: destPath } : f));
      if (activePath === srcPath) setActivePath(destPath);
      await loadTree();
    } catch (error) {
      console.error('Erreur lors du déplacement:', error);
    }
  }, [activePath, loadTree]);

  // Paste (copy or move) clipboard entry into a target directory
  const pasteEntry = useCallback(async (
    srcPath: string,
    srcName: string,
    op: 'cut' | 'copy',
    destDir: string
  ) => {
    const destPath = destDir === '.' ? srcName : `${destDir}/${srcName}`;
    try {
      if (op === 'copy') {
        await ideApi.copyEntry(srcPath, destPath);
      } else {
        await ideApi.moveEntry(srcPath, destPath);
        setOpenFiles((prev) => prev.map((f) => f.path === srcPath ? { ...f, path: destPath } : f));
        if (activePath === srcPath) setActivePath(destPath);
      }
      await loadTree();
    } catch (error) {
      console.error('Erreur lors du collage:', error);
    }
  }, [activePath, loadTree]);

  return {
    // State
    tree,
    workspaceTree,
    diffPaths,
    openFiles,
    activePath,
    expandedDirs,
    loading,
    currentDir,
    
    // Setters
    setActivePath,
    setCurrentDir,
    setTree,
    setWorkspaceTree,
    
    // Actions
    loadTree,
    loadWorkspaceTree,
    loadDiff,
    openFile,
    saveFile,
    updateFileContent,
    reloadFile,
    forceReloadFile,
    closeTab,
    createFile,
    createFolder,
    renameEntry,
    deleteEntry,
    toggleDirectory,
    loadDirectory,
    loadWorkspaceDirectory,
    duplicateEntry,
    moveEntry,
    pasteEntry,
  };
}

function replaceDirectoryChildren(tree: TreeEntry[], directoryPath: string, children: TreeEntry[]): TreeEntry[] {
  if (directoryPath === '.' || directoryPath === '') return children;

  return tree.map((entry) => {
    if (entry.path === directoryPath && entry.type === 'directory') {
      return { ...entry, children };
    }
    if (entry.type === 'directory' && entry.children) {
      return { ...entry, children: replaceDirectoryChildren(entry.children, directoryPath, children) };
    }
    return entry;
  });
}
