import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FolderOpen, Upload, ShieldAlert, Loader2,
  FolderInput, Globe, X, Plus, Trash2, GitBranch,
  CheckCircle2, AlertCircle, ShieldCheck, ArrowRight, Clock,
  Github, Terminal, FolderDown, Server, RefreshCw, Send, Settings,
  MessageSquare,
} from 'lucide-react';
import { ideApi } from '../services/ideApi.js';
import { useToast } from '../components/ui/Toast.js';

/** Clé sessionStorage pour le mode "sans projet" (réinitialisée à chaque fermeture du navigateur) */
const NO_WORKSPACE_KEY = 'Leanna-no-workspace-mode';

interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  siteUrl?: string;
  lastOpened: string;
  createdAt: string;
  isGit: boolean;
  gitBranch?: string;
}

function getElectronAPI(): { selectFolder: () => Promise<string | null> } | null {
  const w = window as any;
  return w.electronAPI?.selectFolder ? w.electronAPI : null;
}

const MODAL_SPRING = { type: 'spring' as const, bounce: 0, duration: 0.35 };
const OVERLAY_FADE = { duration: 0.2 };
const INLINE_BANNER_TRANSITION = { duration: 0.15 };

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function StartupProjectModal() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeTab, setActiveTab] = useState<'recent' | 'open' | 'new' | 'clone' | 'ftp'>('recent');

  // Onglet "Ouvrir"
  const [inputPath, setInputPath] = useState('');
  const [inputSiteUrl, setInputSiteUrl] = useState('');
  const [siteUrlError, setSiteUrlError] = useState<string | null>(null);
  const [showSiteUrl, setShowSiteUrl] = useState(false);
  const [pathValidation, setPathValidation] = useState<{
    valid?: boolean;
    error?: string;
    isGit?: boolean;
    gitBranch?: string;
  } | null>(null);
  const [validatingPath, setValidatingPath] = useState(false);

  // Onglet "Clone"
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneTargetDir, setCloneTargetDir] = useState('');
  const [cloneUrlError, setCloneUrlError] = useState<string | null>(null);
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'cloning' | 'done' | 'error'>('idle');
  const [cloneLogs, setCloneLogs] = useState<Array<{ level: string; message: string }>>([]);
  const cloneLogsEndRef = useRef<HTMLDivElement>(null);
  const cloneAbortRef   = useRef<(() => void) | null>(null);
  const returningFromSettingsRef = useRef(false);

  // Onglet "FTP"
  const [ftpHost, setFtpHost] = useState('');
  const [ftpPort, setFtpPort] = useState('21');
  const [ftpUser, setFtpUser] = useState('');
  const [ftpPassword, setFtpPassword] = useState('');
  const [ftpRemotePath, setFtpRemotePath] = useState('/');
  const [ftpSecure, setFtpSecure] = useState(false);
  const [ftpStatus, setFtpStatus] = useState<'idle' | 'testing' | 'downloading' | 'done' | 'error'>('idle');
  const [ftpTestResult, setFtpTestResult] = useState<{ ok: boolean; info?: string; error?: string } | null>(null);
  const [ftpLogs, setFtpLogs] = useState<Array<{ level: string; message: string }>>([]);
  const ftpLogsEndRef = useRef<HTMLDivElement>(null);
  const ftpAbortRef   = useRef<(() => void) | null>(null);

  interface SavedFtpServer {
    id: string; name: string; host: string; port: number;
    user: string; remotePath: string; secure: boolean;
    lastConnected: string; localMirrorPath?: string;
  }
  const [savedFtpServers, setSavedFtpServers] = useState<SavedFtpServer[]>([]);

  const fetchFtpServers = useCallback(async () => {
    try {
      const res = await fetch('/api/ftp/servers');
      if (res.ok) {
        const data = await res.json();
        setSavedFtpServers(data.servers ?? []);
      }
    } catch { /* silent */ }
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { error: toastError } = useToast();

  const shouldReduceMotion = useReducedMotion();

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/self-root/workspaces');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data.workspaces || []);
        if (data.activeRoot) {
          setCurrentPath(data.activeRoot);
          if (data.siteUrl) setInputSiteUrl(data.siteUrl);
        } else {
          setCurrentPath(null);
        }
        return data;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const checkProjectStatus = useCallback(async () => {
    setLoading(true);
    try {
      const wsData = await fetchWorkspaces();
      if (!wsData?.activeRoot) {
        // Si l'utilisateur a choisi "sans projet" pour cette session, ne pas rouvrir la modale
        if (sessionStorage.getItem(NO_WORKSPACE_KEY) === '1') {
          setIsOpen(false);
          return;
        }
        setIsOpen(true);
        if ((wsData?.workspaces?.length ?? 0) > 0) {
          setActiveTab('recent');
        } else {
          setActiveTab('open');
        }
      }
    } catch {
      setIsOpen(true);
      toastError('Impossible de vérifier le statut du projet');
    } finally {
      setLoading(false);
    }
  }, [fetchWorkspaces, toastError]);

  useEffect(() => {
    checkProjectStatus();
  }, [checkProjectStatus]);

  useEffect(() => {
    if (pathname !== '/settings' && returningFromSettingsRef.current) {
      returningFromSettingsRef.current = false;
      setIsOpen(true);
    }
  }, [pathname]);

  // Écouteur global pour ouvrir le switcher depuis n'importe où dans l'application
  useEffect(() => {
    const handleOpenModal = async () => {
      // Attendre un peu pour que le workspace soit fermé côté serveur
      await new Promise(resolve => setTimeout(resolve, 100));
      await fetchWorkspaces();
      setIsOpen(true);
      setError(null);
    };
    // Le launcher (choix IDE/Notebook) peut activer le mode "sans projet" :
    // dans ce cas, fermer la modale de sélection de workspace si elle est ouverte.
    const handleNoWorkspaceMode = () => {
      setIsOpen(false);
    };
    window.addEventListener('Leanna-open-workspace-switcher', handleOpenModal);
    window.addEventListener('Leanna-no-workspace-mode', handleNoWorkspaceMode);
    return () => {
      window.removeEventListener('Leanna-open-workspace-switcher', handleOpenModal);
      window.removeEventListener('Leanna-no-workspace-mode', handleNoWorkspaceMode);
    };
  }, [fetchWorkspaces]);

  // Validation de chemin en direct
  useEffect(() => {
    if (!inputPath.trim()) {
      setPathValidation(null);
      return;
    }
    const timer = setTimeout(async () => {
      setValidatingPath(true);
      try {
        const res = await fetch('/api/self-root/workspaces/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: inputPath.trim() }),
        });
        const data = await res.json();
        setPathValidation(data);
      } catch {
        setPathValidation({ valid: false, error: 'Impossible de valider le chemin' });
      } finally {
        setValidatingPath(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputPath]);

  const activate = useCallback(async (newRoot: string) => {
    // Quitter le mode "sans projet" si l'utilisateur ouvre finalement un projet
    console.log('[StartupProjectModal] Activating new workspace:', newRoot);
    sessionStorage.removeItem(NO_WORKSPACE_KEY);
    ideApi.invalidateCache();
    console.log('[StartupProjectModal] Dispatching workspace-changed event');
    window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
    window.dispatchEvent(new CustomEvent('Leanna-workspace-changed', { detail: { workspace: newRoot } }));
    setCurrentPath(newRoot);
    setIsOpen(false);
  }, []);

  // Auto-scroll des logs de clone vers le bas
  useEffect(() => {
    if (cloneStatus === 'cloning') {
      cloneLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cloneLogs, cloneStatus]);

  // Auto-scroll des logs FTP vers le bas
  useEffect(() => {
    if (ftpStatus === 'downloading') {
      ftpLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ftpLogs, ftpStatus]);

  // Validation de l'URL de clone (format uniquement, côté client)
  const validateCloneUrl = (url: string): string | null => {
    if (!url.trim()) return null;
    if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) {
      return 'URL invalide — ex: https://github.com/user/repo ou git@github.com:user/repo.git';
    }
    return null;
  };

  const handleClone = useCallback(async () => {
    const urlErr = validateCloneUrl(cloneUrl);
    if (urlErr) { setCloneUrlError(urlErr); return; }
    if (!cloneUrl.trim()) { setCloneUrlError('L\'URL du dépôt est requise.'); return; }

    setCloneUrlError(null);
    setCloneStatus('cloning');
    setCloneLogs([]);

    const body: Record<string, string> = { url: cloneUrl.trim() };
    if (cloneTargetDir.trim()) body.targetDir = cloneTargetDir.trim();

    let aborted = false;
    const controller = new AbortController();
    cloneAbortRef.current = () => { aborted = true; controller.abort(); };

    try {
      const res = await fetch('/api/self-root/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => 'Erreur réseau');
        setCloneStatus('error');
        setCloneLogs(prev => [...prev, { level: 'error', message: txt }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done || aborted) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const dataLine = part.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(5).trim());
            if (event.type === 'log') {
              setCloneLogs(prev => [...prev, { level: event.level ?? 'info', message: event.message ?? '' }]);
            } else if (event.type === 'done') {
              setCloneStatus('done');
              await activate(event.newRoot);
              await fetchWorkspaces();
            } else if (event.type === 'error') {
              setCloneStatus('error');
              setCloneLogs(prev => [...prev, { level: 'error', message: event.error ?? 'Erreur inconnue' }]);
            }
          } catch { /* ligne SSE malformée */ }
        }
      }
    } catch (err: any) {
      if (!aborted) {
        setCloneStatus('error');
        setCloneLogs(prev => [...prev, { level: 'error', message: err.message || 'Erreur réseau' }]);
      }
    } finally {
      cloneAbortRef.current = null;
    }
  }, [cloneUrl, cloneTargetDir, activate, fetchWorkspaces]);

  const handleCancelClone = () => {
    cloneAbortRef.current?.();
    setCloneStatus('idle');
    setCloneLogs([]);
  };

  // ── FTP handlers ────────────────────────────────────────────────────────────

  const ftpConfig = useCallback(() => ({
    host: ftpHost.trim(),
    port: parseInt(ftpPort, 10) || 21,
    user: ftpUser.trim(),
    password: ftpPassword,
    remotePath: ftpRemotePath.trim() || '/',
    secure: ftpSecure,
  }), [ftpHost, ftpPort, ftpUser, ftpPassword, ftpRemotePath, ftpSecure]);

  const handleFtpTest = useCallback(async () => {
    setFtpTestResult(null);
    setFtpStatus('testing');
    try {
      const res = await fetch('/api/ftp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ftpConfig()),
      });
      const data = await res.json();
      setFtpTestResult(data.ok
        ? { ok: true, info: data.serverInfo }
        : { ok: false, error: data.error });
      if (data.ok) await fetchFtpServers();
    } catch (err: any) {
      setFtpTestResult({ ok: false, error: err.message || 'Erreur réseau' });
    } finally {
      setFtpStatus('idle');
    }
  }, [ftpConfig, fetchFtpServers]);

  const handleFtpDownload = useCallback(async () => {
    setFtpStatus('downloading');
    setFtpLogs([]);
    setFtpTestResult(null);

    let aborted = false;
    const controller = new AbortController();
    ftpAbortRef.current = () => { aborted = true; controller.abort(); };

    try {
      const res = await fetch('/api/ftp/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ftpConfig()),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => 'Erreur réseau');
        setFtpStatus('error');
        setFtpLogs(prev => [...prev, { level: 'error', message: txt }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done || aborted) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const dataLine = part.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(5).trim());
            if (event.type === 'log') {
              setFtpLogs(prev => [...prev, { level: event.level ?? 'info', message: event.message ?? '' }]);
            } else if (event.type === 'done') {
              setFtpStatus('done');
              await activate(event.newRoot);
              await fetchWorkspaces();
              await fetchFtpServers();
            } else if (event.type === 'error') {
              setFtpStatus('error');
              setFtpLogs(prev => [...prev, { level: 'error', message: event.error ?? 'Erreur inconnue' }]);
            }
          } catch { /* SSE malformée */ }
        }
      }
    } catch (err: any) {
      if (!aborted) {
        setFtpStatus('error');
        setFtpLogs(prev => [...prev, { level: 'error', message: err.message || 'Erreur réseau' }]);
      }
    }
  }, [ftpConfig, activate, fetchWorkspaces]);

  const handleCancelFtp = () => {
    ftpAbortRef.current?.();
    setFtpStatus('idle');
    setFtpLogs([]);
  };

  const handleBrowse = async () => {
    const electronAPI = getElectronAPI();
    if (electronAPI) {
      const selected = await electronAPI.selectFolder();
      if (selected) { setInputPath(selected); setError(null); }
    } else {
      try {
        // @ts-ignore Web Directory Picker
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        if (handle?.name) { setInputPath(handle.name); setError(null); }
      } catch { /* cancelled */ }
    }
  };

  const handleCreateEmptyWorkspace = useCallback(async () => {
    const electronAPI = getElectronAPI();
    let selectedPath: string | null = null;

    if (electronAPI) {
      selectedPath = await electronAPI.selectFolder();
    } else {
      try {
        // @ts-ignore Web Directory Picker
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        selectedPath = handle?.name ?? null;
      } catch { /* cancelled */ }
    }

    if (selectedPath) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/self-root/change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: selectedPath, userConfirmed: true, siteUrl: '' }),
        });
        const data = await res.json();
        if (data.status === 'success') await activate(data.newRoot);
        else setError(data.error || 'Erreur lors de la création du workspace');
      } catch (e: any) {
        setError(e.message || 'Erreur réseau');
      } finally {
        setLoading(false);
      }
    }
  }, [activate, setLoading, setError]);

  const handleOpenProject = useCallback(async (targetPath?: string, siteUrl?: string) => {
    const pathToOpen = (targetPath || inputPath).trim();
    if (!pathToOpen) return;

    const urlTrimmed = (siteUrl !== undefined ? siteUrl : inputSiteUrl).trim();
    if (urlTrimmed) {
      try { new URL(urlTrimmed); setSiteUrlError(null); }
      catch { setSiteUrlError("URL invalide — ex: https://mon-site.com"); return; }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/self-root/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToOpen, userConfirmed: true, siteUrl: urlTrimmed }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        await activate(data.newRoot);
      } else {
        setError(data.error || 'Erreur lors du changement de répertoire');
      }
    } catch (e: any) {
      setError(e.message || 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, [inputPath, inputSiteUrl, activate]);

  const handleDeleteWorkspace = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/self-root/workspaces/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setWorkspaces(prev => prev.filter(w => w.id !== id));
      }
    } catch {
      /* ignore */
    }
  };

  const handleClose = () => {
    if (currentPath) {
      setIsOpen(false);
    } else if (sessionStorage.getItem(NO_WORKSPACE_KEY) === '1') {
      // Déjà en mode sans projet — fermer simplement la modale
      setIsOpen(false);
    } else {
      window.close();
    }
  };

  /** Continuer sans projet — mode web / questions générales uniquement */
  const handleNoWorkspace = useCallback(() => {
    sessionStorage.setItem(NO_WORKSPACE_KEY, '1');
    window.dispatchEvent(new CustomEvent('Leanna-no-workspace-mode'));
    setIsOpen(false);
  }, []);

  const handleOpenSettings = () => {
    returningFromSettingsRef.current = true;
    setIsOpen(false);
    navigate('/settings');
  };

  const canBrowse = !!getElectronAPI() || typeof (window as any).showDirectoryPicker === 'function';

  if (!isOpen) return null;

  const cardMotionProps = shouldReduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { scale: 0.95, y: 15 }, animate: { scale: 1, y: 0 }, exit: { scale: 0.95, y: 15 } };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={OVERLAY_FADE}
        className="fixed inset-0 z-[99999] flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <motion.div
          {...cardMotionProps}
          transition={MODAL_SPRING}
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-modal-title"
          className="w-[calc(100%-24px)] max-w-7xl h-[min(780px,calc(100vh-32px))] rounded-2xl p-4 sm:p-6 shadow-2xl overflow-hidden flex flex-col"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-base)',
            boxShadow: '0 24px 80px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-5 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent)',
                }}
              >
                <FolderOpen className="w-5 h-5" style={{ color: 'var(--accent-secondary)' }} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: 'var(--accent-primary)' }}>
                  Workspace manager
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id="workspace-modal-title" className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    Choisir un workspace
                  </h2>
                  <span
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                      color: 'var(--color-success)',
                    }}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    Périmètre sécurisé
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Sélectionnez un dépôt, connectez un serveur ou ouvrez un dossier externe.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                type="button"
                onClick={handleOpenSettings}
                whileHover={shouldReduceMotion ? undefined : { opacity: 0.7 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}
                className="flex items-center justify-center w-8 h-8 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}
                title="Ouvrir les paramètres"
                aria-label="Ouvrir les paramètres"
              >
                <Settings className="w-4 h-4" />
              </motion.button>
              <motion.button
                type="button"
                onClick={handleClose}
                whileHover={shouldReduceMotion ? undefined : { opacity: 0.7 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}
                className="flex items-center justify-center w-8 h-8 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}
                title={currentPath ? "Fermer" : "Quitter"}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 items-center gap-1 p-1 rounded-xl mb-5 flex-shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
            <button
              type="button"
              onClick={() => setActiveTab('recent')}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'recent' ? 'shadow-sm' : 'opacity-70 hover:opacity-100 '
              }`}
              style={{
                backgroundColor: activeTab === 'recent' ? 'var(--bg-panel)' : 'transparent',
                color: activeTab === 'recent' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              Dépôts récents ({workspaces.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('open')}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'open' ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
              }`}
              style={{
                backgroundColor: activeTab === 'open' ? 'var(--bg-panel)' : 'transparent',
                color: activeTab === 'open' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              Ouvrir local
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('clone'); setCloneStatus('idle'); setCloneLogs([]); setCloneUrlError(null); }}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                activeTab === 'clone' ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
              }`}
              style={{
                backgroundColor: activeTab === 'clone' ? 'var(--bg-panel)' : 'transparent',
                color: activeTab === 'clone' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              <Github className="w-3 h-3" />
              Cloner
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('ftp'); setFtpStatus('idle'); setFtpLogs([]); setFtpTestResult(null); fetchFtpServers(); }}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                activeTab === 'ftp' ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
              }`}
              style={{
                backgroundColor: activeTab === 'ftp' ? 'var(--bg-panel)' : 'transparent',
                color: activeTab === 'ftp' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              <Server className="w-3 h-3" />
              FTP
            </button>
          </div>

          {/* ── Tab Content ── */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {activeTab === 'recent' && (
              <div className="space-y-2">
                {workspaces.length === 0 ? (
                  <div className="text-center py-8 rounded-xl border border-dashed" style={{ borderColor: 'var(--border-base)' }}>
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Aucun workspace enregistré pour le moment.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('open')}
                      className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                      style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                    >
                      Ouvrir un dossier externe
                    </button>
                  </div>
                ) : (
                  workspaces.map((ws) => {
                    const isActive = currentPath && ws.path.toLowerCase() === currentPath.toLowerCase();
                    return (
                      <motion.div
                        key={ws.id}
                        onClick={() => handleOpenProject(ws.path, ws.siteUrl)}
                        whileHover={shouldReduceMotion ? undefined : { x: 2 }}
                        className="group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer"
                        style={{
                          backgroundColor: isActive
                            ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary))'
                            : 'var(--bg-secondary)',
                          borderColor: isActive ? 'var(--accent-primary)' : 'var(--border-base)',
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: isActive
                                ? 'color-mix(in srgb, var(--accent-primary) 20%, transparent)'
                                : 'var(--bg-input)',
                              color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                            }}
                          >
                            <FolderOpen className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                                {ws.name}
                              </span>
                              {isActive && (
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.2 rounded"
                                  style={{
                                    backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                                    color: 'var(--color-success)',
                                  }}
                                >
                                  Actif
                                </span>
                              )}
                              {ws.isGit && (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded"
                                  style={{
                                    backgroundColor: 'var(--bg-panel)',
                                    border: '1px solid var(--border-base)',
                                    color: 'var(--text-secondary)',
                                  }}
                                >
                                  <GitBranch className="w-2.5 h-2.5" />
                                  {ws.gitBranch || 'git'}
                                </span>
                              )}
                              {ws.name?.startsWith('FTP:') && (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded"
                                  style={{
                                    backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
                                    border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)',
                                    color: 'var(--accent-primary)',
                                  }}
                                >
                                  <Server className="w-2.5 h-2.5" />
                                  FTP
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-dimmed)' }}>
                              {ws.path}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pl-2 flex-shrink-0">
                          <span className="text-[10px] flex items-center gap-1 opacity-60 hidden sm:flex" style={{ color: 'var(--text-muted)' }}>
                            <Clock className="w-3 h-3" />
                            {formatDate(ws.lastOpened)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteWorkspace(e, ws.id)}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/50 hover:text-red-400 transition-all"
                            style={{ color: 'var(--text-muted)' }}
                            title="Retirer de l'historique"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <div className="p-1.5 rounded-lg text-primary opacity-60 group-hover:opacity-100 hover:text-green-400 group-hover:translate-x-0.5 transition-all">
                            <ArrowRight className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'open' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Chemin du dossier externe
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <FolderOpen
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                        style={{ color: 'var(--text-dimmed)' }}
                      />
                      <input
                        type="text"
                        value={inputPath}
                        onChange={(e) => {
                          setInputPath(e.target.value);
                          setError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleOpenProject();
                        }}
                        placeholder="C:\Users\...\mon-projet"
                        className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          borderColor: pathValidation?.valid === false ? 'var(--color-error)' : 'var(--border-base)',
                          color: 'var(--text-primary)',
                          outline: 'none',
                        }}
                        autoFocus
                        spellCheck={false}
                      />
                    </div>
                    {canBrowse && (
                      <motion.button
                        type="button"
                        onClick={handleBrowse}
                        whileHover={shouldReduceMotion ? undefined : { opacity: 0.8 }}
                        whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold flex-shrink-0"
                        style={{
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-base)',
                          color: 'var(--accent-primary)',
                        }}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Parcourir
                      </motion.button>
                    )}
                  </div>

                  {/* Validation status pill */}
                  <AnimatePresence>
                    {validatingPath && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Vérification de la sécurité du chemin…</span>
                      </div>
                    )}
                    {pathValidation && !validatingPath && (
                      <motion.div
                        initial={{ opacity: 0, y: -2 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex items-center gap-2 mt-2 p-2 rounded-lg text-xs font-medium ${
                          pathValidation.valid ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                        }`}
                      >
                        {pathValidation.valid ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>
                              Dépôt valide
                              {pathValidation.isGit && ` • Branche Git: ${pathValidation.gitBranch || 'défaut'}`}
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{pathValidation.error || 'Chemin non autorisé ou inexistant'}</span>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* URL Optionnelle */}
                <div>
                  <AnimatePresence>
                    {showSiteUrl ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={INLINE_BANNER_TRANSITION}
                      >
                        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                          URL du site associé <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>(optionnel)</span>
                        </label>
                        <div className="relative">
                          <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-dimmed)' }} />
                          <input
                            type="url"
                            value={inputSiteUrl}
                            onChange={(e) => {
                              setInputSiteUrl(e.target.value);
                              setSiteUrlError(null);
                            }}
                            placeholder="https://mon-site.com"
                            className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                            style={{
                              backgroundColor: 'var(--bg-input)',
                              borderColor: siteUrlError ? 'var(--color-error)' : 'var(--border-base)',
                              color: 'var(--text-primary)',
                              outline: 'none',
                            }}
                            spellCheck={false}
                          />
                        </div>
                        {siteUrlError && <p className="mt-1 text-xs text-red-400">{siteUrlError}</p>}
                      </motion.div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowSiteUrl(true)}
                        className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        + Associer une URL de site ou documentation
                      </button>
                    )}
                  </AnimatePresence>
                </div>

                {/* Créer un nouveau workspace vide */}
                {canBrowse && (
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
                    <button
                      type="button"
                      onClick={handleCreateEmptyWorkspace}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Créer un nouveau workspace vide
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'clone' && (
              <div className="space-y-3">
                {/* URL input */}
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    URL du dépôt Git
                  </label>
                  <div className="relative">
                    <Github
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                      style={{ color: 'var(--text-dimmed)' }}
                    />
                    <input
                      type="url"
                      value={cloneUrl}
                      onChange={(e) => { setCloneUrl(e.target.value); setCloneUrlError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && cloneStatus === 'idle') handleClone(); }}
                      placeholder="https://github.com/user/repository"
                      disabled={cloneStatus === 'cloning'}
                      className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        borderColor: cloneUrlError ? 'var(--color-error)' : 'var(--border-base)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                      autoFocus
                      spellCheck={false}
                    />
                  </div>
                  {cloneUrlError && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {cloneUrlError}
                    </p>
                  )}
                </div>

                {/* Dossier de destination optionnel */}
                {cloneStatus === 'idle' && (
                  <div>
                    <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                      Dossier de destination{' '}
                      <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
                        (optionnel — défaut: ~/Documents/Leanna-Projects)
                      </span>
                    </label>
                    <div className="relative">
                      <FolderDown
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                        style={{ color: 'var(--text-dimmed)' }}
                      />
                      <input
                        type="text"
                        value={cloneTargetDir}
                        onChange={(e) => setCloneTargetDir(e.target.value)}
                        placeholder="C:\Users\...\mes-projets"
                        className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          borderColor: 'var(--border-base)',
                          color: 'var(--text-primary)',
                          outline: 'none',
                        }}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                )}

                {/* Terminal de logs SSE */}
                {(cloneStatus === 'cloning' || cloneLogs.length > 0) && (
                  <div
                    className="rounded-xl border overflow-hidden"
                    style={{ borderColor: 'var(--border-base)', backgroundColor: '#0d0d0d' }}
                  >
                    {/* Barre de titre terminal */}
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 border-b"
                      style={{ borderColor: 'var(--border-base)', backgroundColor: '#111' }}
                    >
                      <Terminal className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        git clone
                      </span>
                      {cloneStatus === 'cloning' && (
                        <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: 'var(--accent-primary)' }} />
                      )}
                      {cloneStatus === 'done' && (
                        <CheckCircle2 className="w-3 h-3 ml-auto text-emerald-400" />
                      )}
                      {cloneStatus === 'error' && (
                        <AlertCircle className="w-3 h-3 ml-auto text-red-400" />
                      )}
                    </div>
                    {/* Logs scrollables */}
                    <div className="max-h-48 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px] leading-relaxed">
                      {cloneLogs.map((log, i) => (
                        <div
                          key={i}
                          className={
                            log.level === 'error' ? 'text-red-400' :
                            log.level === 'warn'  ? 'text-yellow-400/80' :
                            'text-green-300/80'
                          }
                        >
                          {log.message}
                        </div>
                      ))}
                      <div ref={cloneLogsEndRef} />
                    </div>
                  </div>
                )}

                {/* État vide — invitation */}
                {cloneStatus === 'idle' && cloneLogs.length === 0 && (
                  <div
                    className="rounded-xl border border-dashed flex items-center gap-3 p-3"
                    style={{ borderColor: 'var(--border-base)' }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)' }}
                    >
                      <Github className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Entrez l'URL d'un dépôt GitHub, GitLab ou autre et cliquez sur <strong style={{ color: 'var(--text-secondary)' }}>Cloner</strong>.
                      Le dépôt sera téléchargé puis chargé automatiquement comme workspace.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── FTP Tab ── */}
            {activeTab === 'ftp' && (
              <div className="space-y-4">

                {/* ── Saved FTP servers ── */}
                {savedFtpServers.length > 0 && ftpStatus === 'idle' && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Serveurs enregistrés
                    </p>
                    {savedFtpServers.map(srv => (
                      <div
                        key={srv.id}
                        className="group flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all cursor-pointer hover:border-[var(--accent-primary)]"
                        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-base)' }}
                        onClick={() => {
                          setFtpHost(srv.host);
                          setFtpPort(String(srv.port));
                          setFtpUser(srv.user);
                          setFtpRemotePath(srv.remotePath);
                          setFtpSecure(srv.secure);
                          setFtpPassword('');
                          setFtpTestResult(null);
                        }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--accent-primary)' }}>
                            <Server className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{srv.name}</p>
                            <p className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                              {srv.user}@{srv.host}:{srv.port}{srv.remotePath !== '/' ? srv.remotePath : ''}
                              {srv.secure ? ' · FTPS' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[10px] opacity-50 hidden sm:block" style={{ color: 'var(--text-muted)' }}>
                            {new Date(srv.lastConnected).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await fetch(`/api/ftp/servers/${srv.id}`, { method: 'DELETE' });
                              await fetchFtpServers();
                            }}
                            className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                            style={{ color: 'var(--text-muted)' }}
                            title="Supprimer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <ArrowRight className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" style={{ color: 'var(--accent-primary)' }} />
                        </div>
                      </div>
                    ))}
                    <div className="border-t pt-2" style={{ borderColor: 'var(--border-base)' }} />
                  </div>
                )}

                {/* Connection form — hidden while downloading */}
                {ftpStatus !== 'downloading' && ftpStatus !== 'done' && (
                  <>
                    {/* Host + Port */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Hôte FTP</label>
                        <input
                          type="text"
                          value={ftpHost}
                          onChange={e => setFtpHost(e.target.value)}
                          placeholder="ftp.example.com"
                          className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                          style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)', outline: 'none' }}
                          spellCheck={false}
                        />
                      </div>
                      <div style={{ width: '72px' }}>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Port</label>
                        <input
                          type="number"
                          value={ftpPort}
                          onChange={e => setFtpPort(e.target.value)}
                          min={1} max={65535}
                          className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                          style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                      </div>
                    </div>

                    {/* User + Password */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Utilisateur</label>
                        <input
                          type="text"
                          value={ftpUser}
                          onChange={e => setFtpUser(e.target.value)}
                          placeholder="anonymous"
                          className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                          style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)', outline: 'none' }}
                          autoComplete="username"
                          spellCheck={false}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Mot de passe</label>
                        <input
                          type="password"
                          value={ftpPassword}
                          onChange={e => setFtpPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                          style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)', outline: 'none' }}
                          autoComplete="current-password"
                        />
                      </div>
                    </div>

                    {/* Remote path */}
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Chemin distant</label>
                      <input
                        type="text"
                        value={ftpRemotePath}
                        onChange={e => setFtpRemotePath(e.target.value)}
                        placeholder="/var/www/mon-projet"
                        className="w-full rounded-lg border px-2.5 py-1.5 text-xs font-mono focus:ring-1 focus:ring-[var(--accent-primary)]"
                        style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)', outline: 'none' }}
                        spellCheck={false}
                      />
                    </div>

                    {/* FTPS toggle */}
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div
                        onClick={() => setFtpSecure(v => !v)}
                        className={`w-8 h-4 rounded-full transition-colors relative ${ftpSecure ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-panel)]'}`}
                        style={{ border: '1px solid var(--border-base)' }}
                      >
                        <span
                          className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform"
                          style={{ left: ftpSecure ? '14px' : '2px' }}
                        />
                      </div>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>FTPS (connexion sécurisée)</span>
                    </label>

                    {/* Test result badge */}
                    <AnimatePresence>
                      {ftpStatus === 'testing' && (
                        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Test de connexion…
                        </div>
                      )}
                      {ftpTestResult && ftpStatus === 'idle' && (
                        <motion.div
                          initial={{ opacity: 0, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`flex items-center gap-2 p-2 rounded-lg text-xs font-medium ${
                            ftpTestResult.ok
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : 'text-red-400 bg-red-500/10'
                          }`}
                        >
                          {ftpTestResult.ok
                            ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                            : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                          <span>
                            {ftpTestResult.ok
                              ? `Connexion réussie — ${ftpTestResult.info}`
                              : ftpTestResult.error}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Info notice */}
                    <div className="flex items-start gap-2 p-2.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                      <Server className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-60" />
                      <p>
                        Les fichiers FTP seront copiés dans un dossier miroir local. Vous pourrez ensuite
                        pousser les modifications vers le serveur via le panneau FTP dans l'IDE.
                      </p>
                    </div>
                  </>
                )}

                {/* Download log terminal */}
                {(ftpStatus === 'downloading' || ftpStatus === 'error' || ftpStatus === 'done') && (
                  <div
                    className="rounded-xl p-3 font-mono text-[11px] overflow-y-auto space-y-0.5"
                    style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)', maxHeight: '220px' }}
                  >
                    {ftpLogs.map((log, i) => (
                      <div
                        key={i}
                        style={{
                          color: log.level === 'error' ? 'var(--color-error)'
                            : log.level === 'warn' ? '#f59e0b'
                            : 'var(--text-secondary)',
                        }}
                      >
                        {log.message}
                      </div>
                    ))}
                    {ftpStatus === 'downloading' && (
                      <div className="flex items-center gap-1.5 pt-1" style={{ color: 'var(--text-muted)' }}>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Téléchargement en cours…</span>
                      </div>
                    )}
                    <div ref={ftpLogsEndRef} />
                  </div>
                )}

                {ftpStatus === 'error' && (
                  <button
                    type="button"
                    onClick={() => { setFtpStatus('idle'); setFtpLogs([]); }}
                    className="text-xs underline"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ← Modifier les paramètres
                  </button>
                )}
              </div>
            )}

            {/* Message d'erreur global */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20"
                >
                  <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer Action */}
          <div className="flex items-center justify-between gap-3 pt-4 mt-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-dimmed)' }}>
              {currentPath ? `Actif: ${currentPath.split(/[\\/]/).pop()}` : 'Aucun projet sélectionné'}
            </span>

            <div className="flex items-center gap-2">
              {/* Continuer sans projet — visible uniquement quand aucun projet n'est actif */}
              {!currentPath && (
                <motion.button
                  type="button"
                  onClick={handleNoWorkspace}
                  whileHover={shouldReduceMotion ? undefined : { opacity: 0.8 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-base)',
                    color: 'var(--text-muted)',
                  }}
                  title="Utiliser Leanna sans projet (web & questions générales)"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Continuer sans projet
                </motion.button>
              )}
              {currentPath && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                >
                  Fermer
                </button>
              )}
              {activeTab === 'open' && (
                <motion.button
                  type="button"
                  onClick={() => handleOpenProject()}
                  disabled={loading || !inputPath.trim() || pathValidation?.valid === false}
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-all shadow-md"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />}
                  Ouvrir et verrouiller
                </motion.button>
              )}
              {activeTab === 'clone' && cloneStatus === 'idle' && (
                <motion.button
                  type="button"
                  onClick={handleClone}
                  disabled={!cloneUrl.trim()}
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-all shadow-md"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                >
                  <Github className="w-3.5 h-3.5" />
                  Cloner et ouvrir
                </motion.button>
              )}
              {activeTab === 'clone' && cloneStatus === 'cloning' && (
                <motion.button
                  type="button"
                  onClick={handleCancelClone}
                  whileHover={shouldReduceMotion ? undefined : { opacity: 0.8 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                >
                  <X className="w-3.5 h-3.5" />
                  Annuler
                </motion.button>
              )}
              {activeTab === 'clone' && cloneStatus === 'error' && (
                <motion.button
                  type="button"
                  onClick={() => { setCloneStatus('idle'); setCloneLogs([]); }}
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}
                >
                  <Github className="w-3.5 h-3.5" />
                  Réessayer
                </motion.button>
              )}

              {/* ── FTP footer buttons ── */}
              {activeTab === 'ftp' && ftpStatus === 'idle' && (
                <>
                  <motion.button
                    type="button"
                    onClick={handleFtpTest}
                    disabled={!ftpHost.trim() || !ftpUser.trim()}
                    whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 transition-all"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tester
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={handleFtpDownload}
                    disabled={!ftpHost.trim() || !ftpUser.trim()}
                    whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-all shadow-md"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Connecter et ouvrir
                  </motion.button>
                </>
              )}
              {activeTab === 'ftp' && ftpStatus === 'downloading' && (
                <motion.button
                  type="button"
                  onClick={handleCancelFtp}
                  whileHover={shouldReduceMotion ? undefined : { opacity: 0.8 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}
                >
                  <X className="w-3.5 h-3.5" />
                  Annuler
                </motion.button>
              )}
              {activeTab === 'ftp' && ftpStatus === 'error' && (
                <motion.button
                  type="button"
                  onClick={() => { setFtpStatus('idle'); setFtpLogs([]); }}
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}
                >
                  <Server className="w-3.5 h-3.5" />
                  Réessayer
                </motion.button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}