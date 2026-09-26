import { useCallback, useEffect, useMemo, useState, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
// Monaco Editor - lazy loaded to reduce initial bundle
// Pass the bundled monaco instance directly to avoid CDN loader (fixes CSP violations)
const MonacoEditor = lazy(() =>
  Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor'),
  ]).then(([monacoReact, monacoInstance]) => {
    monacoReact.loader.config({ monaco: monacoInstance });
    return { default: monacoReact.Editor };
  })
);
const DiffViewer = lazy(() => import('../components/ide/DiffViewer.js').then(m => ({ default: m.DiffViewer })));
// Panels - lazy loaded
const VisionPanel = lazy(() => import('../components/panels/VisionPanel.js').then(m => ({ default: m.VisionPanel })));
const GitHubPanel = lazy(() => import('../components/ide/GitHubPanel.js').then(m => ({ default: m.GitHubPanel })));
const DocumentsView = lazy(() => import('./DocumentsView.js'));
const NotebooksView = lazy(() => import('./NotebooksView.js'));
const RichDocumentViewerLazy = lazy(() => import('../components/ide/RichDocumentViewer.js').then(m => ({ default: m.RichDocumentViewer })));
import type { RichDocument } from '../components/ide/RichDocumentViewer.js';
import { IdeModal, type ModalMode } from '../components/ide/IdeModal.js';
import { ContextMenu, type ContextTarget, type ClipboardEntry } from '../components/ide/ContextMenu.js';
import { NotebookPickerModal } from '../components/ide/NotebookPickerModal.js';
import { CommandPalette } from '../components/ide/CommandPalette.js';
import { GlobalSearch } from '../components/ide/GlobalSearch.js';
import { StatusBar } from '../components/ide/StatusBar.js';
import { TelegramStatusModal } from '../components/ide/TelegramStatusModal.js';
import { ModelPickerModal } from '../components/ide/ModelPickerModal.js';
import { TokenDetailModal } from '../components/ide/TokenDetailModal.js';

import { EditorTabs } from '../components/ide/EditorTabs.js';
import { HistoryPanel } from '../components/ide/HistoryPanel.js';
import { AutomationPanel } from '../components/ide/AutomationPanel.js';
import { MemoryPanel } from '../components/ide/MemoryPanel.js';
import { FileExplorer } from '../components/ide/FileExplorerVirtualized.js';
import { UnifiedSidebar } from '../components/UnifiedSidebar.js';
import { useProfile } from '../context/UserProfileContext.js';
import { useFileSystem } from '../hooks/useFileSystem.js';
import { useIdeSettings } from '../hooks/useIdeSettings.js';
import { useEditorActions } from '../hooks/useEditorActions.js';
import { useLiveAPIContext } from '../context/LiveAPIContext.js';
import { useScreenShare } from '../context/ScreenShareContext.js';
import { useSandboxWatcher } from '../hooks/useSandboxWatcher.js';
import { ideApi } from '../services/ideApi.js';
import { AgentProgressBar } from '../components/ide/AgentProgressBar.js';
import { ChatPanel } from '../components/ide/ChatPanel.js';
import { LiveSkillsMonitor } from '../components/ide/LiveSkillsMonitor.js';
import { WorkflowPanel } from '../components/ide/WorkflowPanel.js';
import { McpPanel } from '../components/panels/McpPanel.js';
import { BrowserPanel, BROWSER_HOME_URL } from '../components/panels/BrowserPanel.js';
import { MarkdownPreview } from '../components/ide/MarkdownPreview.js';
import { ImagePreview } from '../components/ide/ImagePreview.js';
import { PdfPreview } from '../components/ide/PdfPreview.js';
import { EmptyEditorState } from '../components/ide/EmptyEditorState.js';
import { SelfEditBanner } from '../components/ide/SelfEditBanner.js';
import { SandboxWorkspace } from '../components/sandbox/SandboxWorkspace.js';
import { AgentPanel } from '../components/panels/AgentPanel.js';
import { AgentBuilderPanel } from '../components/panels/AgentBuilderPanel.js';
import { MarketplacePanel } from '../components/panels/MarketplacePanel.js';
import { SkillsDocModal } from '../components/skills-doc/SkillsDocModal.js';
import { initActivityStore, destroyActivityStore, syncActiveTasksFromServer } from '../stores/agentActivityStore.js';
import { MissionPanel } from '../components/panels/MissionPanel.js';
import { SystemHealthDashboard } from '../components/panels/SystemHealthDashboard.js';
import { PM2StatusPanel } from '../components/panels/PM2StatusPanel.js';
import { AgentFleetPanel } from '../components/panels/AgentFleetPanel.js';
import { AssistantLogsPanel } from '../components/panels/AssistantLogsPanel.js';
import { AgentActivityOverlay } from '../components/ide/AgentActivityOverlay.js';
import { TemplateSelectorModal } from '../components/templates/TemplateSelectorModal.js';
import TerminalPanel from '../components/panels/TerminalPanel.js';
import type { TerminalPanelHandle } from '../components/panels/TerminalPanel.js';
import { useToast } from '../components/ui/Toast.js';

// ─── Main Component ─────────────────────────────────────────────────────────

// Résolution du port serveur — cast nécessaire car ce tsconfig ne référence
// pas vite/client dans ses types globaux (pas de "types": ["vite/client"]).
const _importMeta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
const SERVER_PORT = Number(_importMeta.env?.VITE_SERVER_PORT) || 5000;

export default function IdeView() {
  const { profile } = useProfile();
  const { activity, clearActivity, connected, disconnect, connect, muted, toggleMute, isBusy, reasoning, sendVideoFrame, sendRawMessage, sendEditorContext } = useLiveAPIContext();
  const { isSharing: screenShareEnabled, toggleScreenShare } = useScreenShare();
  const navigate = useNavigate();
  const { info: toastInfo } = useToast();

  // Settings navigation handler
  const openSettings = useCallback(
    (section?: string) => navigate(section ? `/settings?section=${section}` : '/settings'),
    [navigate],
  );

  // Initialize the global activity store (listens to events even when panel is closed)
  useEffect(() => {
    initActivityStore();
    return () => destroyActivityStore();
  }, []);

  // Re-sync active agent tasks from the server whenever the WebSocket reconnects.
  // Without this, the store (and all agent UI) would show 0 active agents after
  // a disconnect/reconnect even though tasks are still running server-side.
  useEffect(() => {
    const handleReconnected = () => { syncActiveTasksFromServer(); };
    window.addEventListener('Leanna-session-reconnected', handleReconnected);
    return () => window.removeEventListener('Leanna-session-reconnected', handleReconnected);
  }, []);

  // Check if assistant is currently working
  const assistantWorking = activity.some(step => step.status === 'running') || isBusy;

  // Vision & Mode state
    const [visionEnabled, setVisionEnabled] = useState(false);
    const [mode, setMode] = useState<'full' | 'ask'>(() => 'full');
    const [pendingReconnectMode, setPendingReconnectMode] = useState<'full' | 'ask' | null>(null);

    // Initialize mode from localStorage on mount
    useEffect(() => {
      const stored = localStorage.getItem('Leanna_mode') as 'full' | 'ask' | null;
      if (stored && stored !== ('vie' as any)) setMode(stored);
    }, []);

    // Persist mode to localStorage
    useEffect(() => {
      localStorage.setItem('Leanna_mode', mode);
    }, [mode]);

    // Reconnect after mode change: wait until status is idle then reconnect
    useEffect(() => {
    if (!pendingReconnectMode || connected) return undefined;
    const timer = setTimeout(() => {
      connect([], pendingReconnectMode);
      setPendingReconnectMode(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [pendingReconnectMode, connected, connect]);

  // Custom hooks for logic separation
  const fileSystem = useFileSystem();
  const { settings: ideSettings, updateSetting } = useIdeSettings(profile.theme);
  const { editorRef, monacoRef, editorPathRef, formatDocument, navigateToPosition, applySettingsToEditor } = useEditorActions();

  // ── Sandbox Watcher — dispatcher les événements de fichiers en temps réel ──
  // Ce hook maintient une connexion WebSocket vers /sandbox-watch et dispatche
  // des CustomEvents globaux pour que useFileSystem puisse réagir (fermer onglets
  // de fichiers supprimés, recharger fichiers modifiés, actualiser l'arbre).
  useSandboxWatcher({
    enabled: true,
    onFileChanged: useCallback((relativePath: string) => {
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-file-changed', { detail: { path: relativePath } }));
      // Également rafraîchir l'arbre pour refléter les changements
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
    }, []),
    onTreeChanged: useCallback(() => {
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
    }, []),
    onFileDeleted: useCallback((relativePath: string) => {
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-file-deleted', { detail: { path: relativePath } }));
      window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
    }, []),
  });

  // UI State
  const [showExplorer, setShowExplorer] = useState(true);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState<'files' | 'commands' | null>(null);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | undefined>(undefined);
  const [showSkillsMonitor, setShowSkillsMonitor] = useState(false);
  const [showChat, setShowChat] = useState(true); // Ouvert par défaut au démarrage
  const [chatDocked, setChatDocked] = useState(false);
  const [chatWidth, setChatWidth] = useState(400); // Largeur du ChatPanel
  const [pendingChatMessage, setPendingChatMessage] = useState<{ text: string; displayText?: string } | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const [showAgentBuilder, setShowAgentBuilder] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showSkillsDoc, setShowSkillsDoc] = useState(false);
  const [showFleet, setShowFleet] = useState(false);
  const [showAssistantLogs, setShowAssistantLogs] = useState(false);
  const [showMissions, setShowMissions] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTokenDetail, setShowTokenDetail] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showNotebooks, setShowNotebooks] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [sandboxView, setSandboxView] = useState<'controls' | 'diff'>('controls');
  const [selectedSandboxDiffFile, setSelectedSandboxDiffFile] = useState<string | null>(null);
  const toggleSandbox = useCallback(() => {
    setShowSandbox((visible) => {
      if (!visible) {
        setSandboxView('controls');
        setSelectedSandboxDiffFile(null);
      }
      return !visible;
    });
  }, []);
  const openSandboxDiff = useCallback((initialFile: string | null = null) => {
    setSelectedSandboxDiffFile(initialFile);
    setSandboxView('diff');
    setShowSandbox(true);
  }, []);
  const closeSandbox = useCallback(() => {
    setShowSandbox(false);
    setSandboxView('controls');
    setSelectedSandboxDiffFile(null);
  }, []);
  const [showSystemHealth, setShowSystemHealth] = useState(false);
  const [showPM2, setShowPM2] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalDocked, setTerminalDocked] = useState(true); // Par défaut docké en bas
  const terminalRef = useRef<TerminalPanelHandle | null>(null);
  const [selfEditingFile, setSelfEditingFile] = useState<string | null>(null);
  const [richDocument, setRichDocument] = useState<RichDocument | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);

  // Auto-close assistant-dependent panels when assistant is disconnected
  useEffect(() => {
    if (!connected) {
      setShowChat(false);
      setChatDocked(false);
      setShowAgents(false);
      setShowFleet(false);
      setShowSkillsMonitor(false);
    }
  }, [connected]);

  // Markdown preview toggle — per-file, reset to false for non-md files
  const [markdownPreview, setMarkdownPreview] = useState(false);

  // Reset markdown preview when switching to a non-markdown file
  useEffect(() => {
    if (!fileSystem.activePath?.toLowerCase().endsWith('.md')) {
      setMarkdownPreview(false);
    }
  }, [fileSystem.activePath]);

  // HTML preview toggle — per-file, reset to false when switching away from .html
  const [htmlPreview, setHtmlPreview] = useState(false);

  useEffect(() => {
    if (!fileSystem.activePath?.toLowerCase().endsWith('.html')) {
      setHtmlPreview(false);
    }
  }, [fileSystem.activePath]);

  // Per-file reload keys
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const [modalState, setModalState] = useState<ModalMode | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    target: ContextTarget;
    x: number;
    y: number;
  } | null>(null);
  const [clipboardEntry, setClipboardEntry] = useState<ClipboardEntry | null>(null);
  const [notebookPicker, setNotebookPicker] = useState<{ filePath: string; fileName: string } | null>(null);

  // ── File operations helpers ────────────────────────────────────────────────

  const openFileAt = useCallback(async (filePath: string, line?: number, column?: number) => {
    // Fermer le sandbox et les autres vues plein-écran pour afficher l'éditeur
    setShowSandbox(false);
    setShowKnowledge(false);
    setShowNotebooks(false);
    setShowHistory(false);
    setShowAutomation(false);
    setShowMemory(false);
    setRichDocument(null);

    // Toujours fermer showBrowser quand on ouvre un fichier/onglet
    setShowBrowser(false);

    if (/\.rich\.json$/i.test(filePath)) {
      try {
        const parsed = JSON.parse(await ideApi.readFile(filePath));
        if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.blocks)) {
          setRichDocument(parsed as RichDocument);
          return;
        }
      } catch {
        // Fallback to the regular editor for invalid or unreadable rich JSON.
      }
    }

    await fileSystem.openFile(filePath);
    if (typeof line === 'number') {
      navigateToPosition(line, column);
    }
  }, [fileSystem, navigateToPosition]);

  // Ouverture d'une URL dans un nouvel onglet navigateur
  const openUrlInNewTab = useCallback((url: string) => {
    const browserPath = `__browser__:${url}`;
    openFileAt(browserPath);
  }, [openFileAt]);

  // Notification quand une URL est ouverte dans une fenêtre externe
  const handleBrowserExternalOpen = useCallback(() => {
    toastInfo('La page a été ouverte dans une nouvelle fenêtre');
  }, [toastInfo]);

  // ── Handle AI-triggered file open ──────────────────────────────────────────

  useEffect(() => {
    const pending = sessionStorage.getItem('Leanna-ide-pending-file');
    if (pending) {
      sessionStorage.removeItem('Leanna-ide-pending-file');
      try {
        const { path, line, column } = JSON.parse(pending);
        if (typeof path === 'string') {
          setTimeout(() => openFileAt(path, line, column), 200);
        }
      } catch { /* ignore malformed data */ }
    }

    const handleOpenFile = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail.path !== 'string') return;
      openFileAt(detail.path, detail.line, detail.column);
    };

    const handleFileChanged = async (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail.path !== 'string') return;
      const filePath: string = detail.path;
      // Show self-edit banner when the IA modifies an open file
      setSelfEditingFile(filePath);
      setTimeout(() => setSelfEditingFile(null), 5000);
      const isOpen = fileSystem.openFiles.some(f => f.path === filePath);
      if (isOpen) {
        await fileSystem.forceReloadFile(filePath);
        setReloadKeys(prev => ({ ...prev, [filePath]: (prev[filePath] ?? 0) + 1 }));
      } else {
        openFileAt(filePath);
      }
    };

    const handleWorkspaceChanged = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const workspace = detail?.workspace;
      
      console.log('[IdeView] Workspace changed:', workspace);
      
      // Fermer tous les onglets et tous les panneaux plein-écran
      fileSystem.openFiles.forEach(f => fileSystem.closeTab(f.path));
      setShowKnowledge(false);
      setShowNotebooks(false);
      setShowHistory(false);
      setShowAutomation(false);
      setShowMemory(false);
      setShowSandbox(false);
      setShowGitHub(false);
      setRichDocument(null);
      
      if (workspace === null || workspace === undefined) {
        // Pas de workspace - vider l'arbre
        console.log('[IdeView] No workspace - clearing tree');
        fileSystem.setTree([]);
        fileSystem.setWorkspaceTree([]);
      } else {
        // Nouveau workspace - recharger l'arbre
        console.log('[IdeView] New workspace - reloading tree');
        fileSystem.loadTree();
        fileSystem.loadWorkspaceTree();
      }
      
      console.log('[IdeView] All tabs closed and tree updated');
    };

    const handleNoWorkspace = () => {
      console.log('[IdeView] No workspace mode - closing all tabs and clearing tree');
      fileSystem.openFiles.forEach(f => fileSystem.closeTab(f.path));
      setShowKnowledge(false);
      setShowNotebooks(false);
      setShowHistory(false);
      setShowAutomation(false);
      setShowMemory(false);
      setShowSandbox(false);
      setShowGitHub(false);
      setRichDocument(null);
      // Vider l'arbre des fichiers en passant un tableau vide
      fileSystem.setTree([]);
      fileSystem.setWorkspaceTree([]);
      fileSystem.setCurrentDir('.');
      console.log('[IdeView] Tree cleared for no-workspace mode');
    };

    window.addEventListener('Leanna-ide-open-file', handleOpenFile);
    window.addEventListener('Leanna-ide-file-changed', handleFileChanged);
    window.addEventListener('Leanna-workspace-changed', handleWorkspaceChanged);
    window.addEventListener('Leanna-no-workspace-mode', handleNoWorkspace);
    return () => {
      window.removeEventListener('Leanna-ide-open-file', handleOpenFile);
      window.removeEventListener('Leanna-ide-file-changed', handleFileChanged);
      window.removeEventListener('Leanna-workspace-changed', handleWorkspaceChanged);
      window.removeEventListener('Leanna-no-workspace-mode', handleNoWorkspace);
    };
  }, [openFileAt, fileSystem]);

  // ── Open Sandbox Diff from StatusBar click ─────────────────────────────────
  useEffect(() => {
    const handleOpenSandboxDiff = () => openSandboxDiff();
    window.addEventListener('Leanna-open-sandbox-diff', handleOpenSandboxDiff);
    return () => window.removeEventListener('Leanna-open-sandbox-diff', handleOpenSandboxDiff);
  }, [openSandboxDiff]);

  // ── Actions navigateur pilotées par Leanna via Leanna-ide-action ───────────
  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;

      if (detail.type === 'open-browser') {
        setShowBrowser(true);
      }
      if (detail.type === 'close-browser') {
        setShowBrowser(false);
        setBrowserUrl(undefined);
      }
      if (detail.type === 'browser-navigate' && typeof detail.url === 'string') {
        setShowBrowser(true);
        setBrowserUrl(detail.url);
      }
      // browser-scroll, browser-back, browser-forward, browser-reload, browser-read-request
      // sont dispatché directement comme CustomEvents dédiés par useLiveAPI / BrowserPanel
    };
    window.addEventListener('Leanna-ide-action', handle as EventListener);
    return () => window.removeEventListener('Leanna-ide-action', handle as EventListener);
  }, []);

  // ── Documents riches pilotés par Leanna via Leanna-open-rich-document ──────
  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.document) return;
      setRichDocument(detail.document);
      // Fermer les autres panneaux principaux pour donner de la place
      setShowBrowser(false);
      setShowKnowledge(false);
      setShowNotebooks(false);
    };
    window.addEventListener('Leanna-open-rich-document', handle as EventListener);
    return () => window.removeEventListener('Leanna-open-rich-document', handle as EventListener);
  }, []);

  // Open Agents panel only on explicit user action (button click, overlay)
  useEffect(() => {
    const handleOpenAgents = () => setShowAgents(true);
    window.addEventListener('Leanna-open-agents-panel', handleOpenAgents);

    return () => {
      window.removeEventListener('Leanna-open-agents-panel', handleOpenAgents);
    };
  }, []);

  const saveActiveFile = useCallback(async () => {
    if (!fileSystem.activePath) return;
    const activeFile = fileSystem.openFiles.find(f => f.path === fileSystem.activePath);
    if (!activeFile?.dirty) return;
    await formatDocument();
    const currentContent = editorRef.current?.getValue() || activeFile.content;
    await fileSystem.saveFile(fileSystem.activePath, currentContent);
  }, [fileSystem, formatDocument, editorRef]);

  const closeTabWithConfirm = useCallback((filePath: string) => {
    const file = fileSystem.openFiles.find(f => f.path === filePath);
    if (file?.dirty) {
      setModalState({ type: 'confirm-delete', filePath, isDir: false });
      return;
    }
    fileSystem.closeTab(filePath);
  }, [fileSystem]);

  const queueMessageToAI = useCallback(async (message: string, displayText?: string) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    // ── Injection automatique du contexte éditeur ──────────────────────────
    // Avant d'envoyer le message, on informe l'assistant du fichier ouvert,
    // de la sélection active et de la position du curseur. Cela permet à Gemini
    // de répondre avec précision sans que l'utilisateur ait à redécrire le contexte.
    if (connected) {
      const editor = editorRef.current;
      let selection: string | null = null;
      if (editor) {
        try {
          const sel = editor.getSelection();
          const model = editor.getModel();
          if (sel && model && !sel.isEmpty()) {
            selection = model.getValueInRange(sel).slice(0, 2000) || null;
          }
        } catch { /* ignore si l'éditeur n'est pas prêt */ }
      }
      const activeFile = fileSystem.openFiles.find(f => f.path === fileSystem.activePath);
      
      // Récupérer les erreurs TypeScript (async, non-bloquant)
      let tsErrors: Array<{ file: string; line: number; column: number; message: string }> = [];
      try {
        const res = await fetch('/api/sandbox/validate', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data.diagnostics && Array.isArray(data.diagnostics)) {
            // Ne garder que les erreurs (pas les warnings) et limiter à 20 pour éviter surcharge
            tsErrors = data.diagnostics
              .filter((d: any) => d.severity === 'error' && d.file && d.line)
              .slice(0, 20)
              .map((d: any) => ({
                file: d.file,
                line: d.line,
                column: d.col ?? 1,
                message: d.msg ?? 'Erreur TypeScript'
              }));
          }
        }
      } catch (err) {
        // Silent fail - ne pas bloquer l'envoi du message si validation échoue
        console.warn('[IdeView] Impossible de récupérer les erreurs TypeScript:', err);
      }

      sendEditorContext({
        openFile: fileSystem.activePath ?? null,
        language: activeFile?.language ?? null,
        selection,
        cursorLine: cursorPosition?.line ?? null,
        cursorColumn: cursorPosition?.column ?? null,
        openFiles: fileSystem.openFiles.map(f => f.path),
        tsErrors: tsErrors.length > 0 ? tsErrors : undefined,
      });
    }

    setPendingChatMessage({ text: trimmedMessage, displayText });
    setShowSkillsMonitor(false);
    setShowChat(true);
  }, [connected, sendEditorContext, fileSystem.activePath, fileSystem.openFiles, editorRef, cursorPosition]);

  // ── Context menu actions ───────────────────────────────────────────────────

  const handleContextAction = useCallback(async (actionId: string, target: ContextTarget) => {
    switch (actionId) {
      case 'open':
        if (target.kind === 'file') fileSystem.openFile(target.path);
        break;
      case 'open-in-browser':
        if (target.kind === 'file') {
          const previewUrl = `http://localhost:${SERVER_PORT}/workspace-preview/${encodeURIComponent(target.path)}`;
          setShowBrowser(true);
          setBrowserUrl(previewUrl);
        }
        break;
      case 'send-to-ai':
        if (target.kind === 'file') {
          queueMessageToAI(
            `[Fichier sélectionné] ${target.path}`,
            `📄 ${target.name}`
          );
        }
        break;
      case 'import-to-notebook':
        if (target.kind === 'file') {
          setNotebookPicker({ filePath: target.path, fileName: target.name });
        }
        break;
      case 'new-file':
        setModalState({ type: 'create-file', dir: target.path });
        break;
      case 'new-folder':
        setModalState({ type: 'create-folder', dir: target.path });
        break;
      case 'rename':
        setModalState({ type: 'rename', oldPath: target.path, oldName: target.name });
        break;
      case 'duplicate':
        fileSystem.duplicateEntry(target.path);
        break;
      case 'cut':
        setClipboardEntry({ path: target.path, name: target.name, op: 'cut' });
        break;
      case 'copy':
        setClipboardEntry({ path: target.path, name: target.name, op: 'copy' });
        break;
      case 'paste':
        if (clipboardEntry && target.kind === 'folder') {
          fileSystem.pasteEntry(clipboardEntry.path, clipboardEntry.name, clipboardEntry.op, target.path);
          if (clipboardEntry.op === 'cut') setClipboardEntry(null);
        }
        break;
      case 'copy-path':
        navigator.clipboard?.writeText(target.path);
        break;
      case 'delete':
        setModalState({ type: 'confirm-delete', filePath: target.path, isDir: target.kind === 'folder' });
        break;
      case 'view-diff':
        if (target.kind === 'file' && target.path === fileSystem.activePath) {
          setShowDiffViewer(true);
        }
        break;
    }
  }, [fileSystem, clipboardEntry, queueMessageToAI]);

  // ── Modal actions ──────────────────────────────────────────────────────────

  const handleModalConfirm = useCallback((value?: string) => {
    if (!modalState) return;
    switch (modalState.type) {
      case 'create-file':
        if (value) fileSystem.createFile(modalState.dir, value);
        break;
      case 'create-folder':
        if (value) fileSystem.createFolder(modalState.dir, value);
        break;
      case 'rename':
        if (value) fileSystem.renameEntry(modalState.oldPath, value);
        break;
      case 'confirm-delete':
        fileSystem.deleteEntry(modalState.filePath);
        break;
    }
    setModalState(null);
  }, [modalState, fileSystem]);

  // ── Event handlers ─────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && fileSystem.activePath) {
        e.preventDefault();
        saveActiveFile();
      }
      if (e.shiftKey && e.altKey && e.key === 'F' && fileSystem.activePath) {
        e.preventDefault();
        formatDocument();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        setShowCommandPalette('files');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setShowCommandPalette('commands');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowGlobalSearch(true);
      }
      // ── Self-IDE shortcuts ────────────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        // Créer un checkpoint
        fetch('/api/checkpoint/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'checkpoint manuel (Ctrl+Shift+K)' }) }).catch((err) => {
          console.error('[IdeView] Failed to create checkpoint:', err);
        });
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        // Lancer la validation build
        fetch('/api/safeguards/validate', { method: 'POST' }).catch((err) => {
          console.error('[IdeView] Failed to validate safeguards:', err);
        });
      }
      // Markdown preview toggle (Ctrl+Shift+M) — only when a .md file is active
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        if (fileSystem.activePath?.toLowerCase().endsWith('.md')) {
          e.preventDefault();
          setMarkdownPreview(v => !v);
        }
      }
      // Terminal toggle (Ctrl+`)
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setShowTerminal(v => !v);
      }
      // Browser/Preview toggle (Ctrl+Shift+B)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        setShowBrowser(v => !v);
        if (!showBrowser) {
          // Ouvrir la preview du fichier actif si disponible
          if (fileSystem.activePath) {
            setBrowserUrl(`http://localhost:${SERVER_PORT}/workspace-preview/${encodeURIComponent(fileSystem.activePath)}`);
          }
        } else {
          setBrowserUrl(undefined);
        }
      }
      // Terminal quick commands (Ctrl+1 to Ctrl+0)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        const commandMap: Record<string, string> = {
          '1': 'npm run dev',
          '2': 'npm install',
          '3': 'npm run build',
          '4': 'npm test',
          '5': 'git status',
          '6': 'git pull',
          '7': 'clear',
          '8': 'ls',
          '9': 'pwd',
          '0': 'cd ..',
        };
        const command = commandMap[e.key];
        if (command && showTerminal && terminalRef.current) {
          e.preventDefault();
          terminalRef.current.executeCommand(command);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveFile, formatDocument, fileSystem.activePath, showTerminal, showBrowser]);

  // Prevent data loss
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (fileSystem.openFiles.some(f => f.dirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [fileSystem.openFiles]);

  // ── Editor handlers ────────────────────────────────────────────────────────

  const sendSelectionToAI = useCallback((editor: any) => {
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || selection.isEmpty()) return;

    const selectedText = model.getValueInRange(selection).trim();
    if (!selectedText) return;

    queueMessageToAI(selectedText);
  }, [queueMessageToAI]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!fileSystem.activePath || value === undefined) return;
    fileSystem.updateFileContent(fileSystem.activePath, value);
  }, [fileSystem]);

  const handleEditorMount = useCallback((editor: any, monacoInstance: any) => {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;
    editorPathRef.current = fileSystem.activePath;
    applySettingsToEditor(editor, ideSettings);
    monacoInstance.editor.setTheme(ideSettings.theme);

    const updateCursor = () => {
      const pos = editor.getPosition();
      setCursorPosition(pos ? { line: pos.lineNumber, column: pos.column } : null);
    };
    editor.onDidChangeCursorPosition(updateCursor);
    updateCursor();

    editor.addAction({
      id: 'Leanna-send-selection-to-ai',
      label: "Envoyer à l'IA",
      keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter],
      precondition: 'editorHasSelection',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: sendSelectionToAI,
    });
  }, [fileSystem.activePath, ideSettings, applySettingsToEditor, sendSelectionToAI]);

  // Apply settings changes imperatively
  useEffect(() => {
    applySettingsToEditor(editorRef.current, ideSettings);
  }, [ideSettings, applySettingsToEditor]);

  // Keep editorPathRef in sync with active file
  useEffect(() => {
    editorPathRef.current = fileSystem.activePath;
  }, [fileSystem.activePath, editorPathRef]);

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(ideSettings.theme);
    }
  }, [ideSettings.theme]);

  // Monaco options (initial render only)
  const monacoOptions = useMemo(() => ({
    fontSize: ideSettings.fontSize,
    wordWrap: ideSettings.wordWrap ? 'on' as const : 'off' as const,
    tabSize: ideSettings.tabSize,
    insertSpaces: true,
    minimap: { enabled: ideSettings.showMinimap },
    renderWhitespace: ideSettings.showWhitespace ? 'all' as const : 'none' as const,
    stickyScroll: { enabled: ideSettings.stickyScroll },
    bracketPairColorization: { enabled: ideSettings.bracketPairs },
    guides: { bracketPairs: ideSettings.bracketPairs, indentation: true },
    lineNumbers: 'on' as const,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on' as const,
    multiCursorModifier: 'alt' as const,
    selectionHighlight: true,
    occurrencesHighlight: 'singleFile' as const,
    folding: true,
    showFoldingControls: 'mouseover' as const,
  }), []);

  // ── Active file ────────────────────────────────────────────────────────────

  const activeFile = useMemo(
    () => fileSystem.openFiles.find(f => f.path === fileSystem.activePath),
    [fileSystem.openFiles, fileSystem.activePath]
  );

  // ── Track recent files in localStorage ─────────────────────────────────────
  useEffect(() => {
    if (!fileSystem.activePath) return;
    const active = fileSystem.openFiles.find(f => f.path === fileSystem.activePath);
    if (!active) return;
    try {
      const STORAGE_KEY = 'Leanna_recent_files';
      const stored = localStorage.getItem(STORAGE_KEY);
      const recent: { path: string; language: string; openedAt: number }[] = stored ? JSON.parse(stored) : [];
      const filtered = recent.filter(r => r.path !== active.path);
      filtered.unshift({ path: active.path, language: active.language || '', openedAt: Date.now() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, 10)));
    } catch { /* silent */ }
  }, [fileSystem.activePath, fileSystem.openFiles]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="Leanna-ide-shell flex h-full" style={{ backgroundColor: 'var(--ide-shell-bg)', color: 'var(--text-primary)', width: showChat && chatDocked ? `calc(100% - ${chatWidth}px)` : '100%', transition: 'width 0.3s cubic-bezier(0.22, 1, 0.36, 1)' }}>

      {/* Sidebar Unifiée */}
      <UnifiedSidebar
        context="ide"
        showExplorer={showExplorer}
        showGlobalSearch={showGlobalSearch}
        showRunMenu={showRunMenu}
        showSandbox={showSandbox}
        showGitHub={showGitHub}
        showWorkflow={showWorkflow}
        showSkillsMonitor={showSkillsMonitor}
        showChat={showChat}
        showAgents={showAgents}
        showAgentBuilder={showAgentBuilder}
        showMarketplace={showMarketplace}
        showSkillsDoc={showSkillsDoc}
        showFleet={showFleet}
        showMissions={showMissions}
        showKnowledge={showKnowledge}
        showNotebooks={showNotebooks}
        showSystemHealth={showSystemHealth}
        showPM2={showPM2}
        showMcp={showMcp}
        showBrowser={showBrowser}
        assistantConnected={connected}
        assistantWorking={assistantWorking}
        assistantMuted={muted}
        visionEnabled={visionEnabled}
        screenShareEnabled={screenShareEnabled}
        mode={mode}
        onToggleExplorer={() => setShowExplorer(v => !v)}
        onToggleSearch={() => setShowGlobalSearch(v => !v)}
        onToggleRunMenu={() => setShowRunMenu(v => !v)}
        onToggleSandbox={toggleSandbox}
        onToggleGitHub={() => setShowGitHub(v => !v)}
        onToggleWorkflow={() => setShowWorkflow(v => !v)}
        onToggleSkillsMonitor={() => setShowSkillsMonitor(v => !v)}
        onToggleChat={() => setShowChat(v => !v)}
        onToggleAgents={() => setShowAgents(v => !v)}
        onToggleAgentBuilder={() => setShowAgentBuilder(v => !v)}
        onToggleMarketplace={() => setShowMarketplace(v => !v)}
        onToggleSkillsDoc={() => setShowSkillsDoc(v => !v)}
        onToggleFleet={() => setShowFleet(v => !v)}
        onToggleMissions={() => setShowMissions(v => !v)}
        onToggleKnowledge={() => {
          setShowKnowledge(v => !v);
          if (!showKnowledge) { setShowHistory(false); setShowAutomation(false); setShowNotebooks(false); setShowMemory(false); }
        }}
        onToggleNotebooks={() => {
          setShowNotebooks(v => {
            if (!v) {
              // Ouverture des notebooks → fermer l'explorer automatiquement
              setShowExplorer(false);
              setShowHistory(false); setShowAutomation(false); setShowKnowledge(false); setShowMemory(false);
            } else {
              // Fermeture des notebooks → réouvrir l'explorer
              setShowExplorer(true);
            }
            return !v;
          });
        }}
        onToggleSystemHealth={() => setShowSystemHealth(v => !v)}
        onTogglePM2={() => setShowPM2(v => !v)}
        onToggleMcp={() => setShowMcp(v => !v)}
        onToggleBrowser={() => openUrlInNewTab(BROWSER_HOME_URL)}
        onToggleVision={() => setVisionEnabled(v => !v)}
        onToggleScreenShare={toggleScreenShare}
        onToggleMode={() => {
          const next = mode === 'full' ? 'ask' : 'full';
          setMode(next);
          if (connected) {
            setPendingReconnectMode(next);
            disconnect();
          }
        }}
        onDisconnectAssistant={disconnect}
        onConnectAssistant={() => {
          connect([], mode);
          setShowChat(true); // Ouvrir le ChatPanel après connexion
        }}
        onMuteToggle={toggleMute}
        showHistory={showHistory}
        onToggleHistory={() => {
          setShowHistory(v => !v);
          if (!showHistory) { setShowAutomation(false); setShowKnowledge(false); setShowNotebooks(false); setShowMemory(false); }
        }}
        showAutomation={showAutomation}
        onToggleAutomation={() => {
          setShowAutomation(v => !v);
          if (!showAutomation) { setShowHistory(false); setShowKnowledge(false); setShowNotebooks(false); setShowMemory(false); }
        }}
        showMemory={showMemory}
        onToggleMemory={() => {
          setShowMemory(v => !v);
          if (!showMemory) { setShowHistory(false); setShowAutomation(false); setShowKnowledge(false); setShowNotebooks(false); }
        }}
        showTerminal={showTerminal}
        onToggleTerminal={() => setShowTerminal(v => !v)}
      />

      {/* File Explorer */}
      {showExplorer && (
        <FileExplorer
          tree={fileSystem.tree}
          workspaceTree={fileSystem.workspaceTree}
          diffPaths={fileSystem.diffPaths}
          expandedDirs={fileSystem.expandedDirs}
          loading={fileSystem.loading}
          currentDir={fileSystem.currentDir}
          onOpenFile={openFileAt}
          onOpenFileDiff={(path) => openSandboxDiff(path)}
          onToggleDirectory={fileSystem.toggleDirectory}
          onLoadDirectory={fileSystem.loadDirectory}
          onLoadWorkspaceDirectory={fileSystem.loadWorkspaceDirectory}
          onContextMenu={(e, entry) => {
            e.preventDefault();
            setContextMenu({
              target: { kind: entry.type === 'file' ? 'file' : 'folder', path: entry.path, name: entry.name },
              x: e.clientX,
              y: e.clientY,
            });
          }}
          onCreateFile={() => setModalState({ type: 'create-file', dir: fileSystem.currentDir })}
          onRefresh={() => { fileSystem.loadTree(); fileSystem.loadWorkspaceTree(); fileSystem.loadDiff(); }}
          onNavigate={fileSystem.setCurrentDir}
          onMoveEntry={fileSystem.moveEntry}
        />
      )}

      {/* Editor Area */}
      <div className="Leanna-ide-workspace flex flex-1 flex-col min-w-0 min-h-0 relative">
        {/* Tab Bar — masqué quand un panneau plein-écran est actif */}
        {!showSandbox && !showHistory && !showAutomation && !showMemory && !showKnowledge && !showNotebooks && !(showBrowser && !fileSystem.activePath) && (
          <EditorTabs
            openFiles={fileSystem.openFiles}
            activePath={fileSystem.activePath}
            showMinimap={ideSettings.showMinimap}
            wordWrap={ideSettings.wordWrap}
            activeFileDirty={activeFile?.dirty || false}
            markdownPreview={markdownPreview}
            htmlPreview={htmlPreview}
            onSelectTab={openFileAt}
            onCloseTab={closeTabWithConfirm}
            onSave={saveActiveFile}
            onFormat={formatDocument}
            onToggleMinimap={() => updateSetting('showMinimap', !ideSettings.showMinimap)}
            onToggleWordWrap={() => updateSetting('wordWrap', !ideSettings.wordWrap)}
            onToggleMarkdownPreview={() => setMarkdownPreview(v => !v)}
            onToggleHtmlPreview={() => setHtmlPreview(v => !v)}
            onOpenTemplates={() => setShowTemplateModal(true)}
          />
        )}

        {/* Self-Edit Banner — visible when IA modifies the currently open file */}
        <SelfEditBanner
          editingFile={selfEditingFile}
          onRollback={async () => {
            try {
              const res = await fetch('/api/checkpoint/list');
              const data = await res.json();
              if (data.checkpoints?.[0]) {
                await fetch('/api/checkpoint/rollback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ hash: data.checkpoints[0].hash }),
                });
                fileSystem.loadTree();
                if (fileSystem.activePath) {
                  await fileSystem.forceReloadFile(fileSystem.activePath);
                  setReloadKeys(prev => ({ ...prev, [fileSystem.activePath!]: (prev[fileSystem.activePath!] ?? 0) + 1 }));
                }
              }
            } catch { /* silent */ }
            setSelfEditingFile(null);
          }}
          onAccept={() => setSelfEditingFile(null)}
        />

        {/* Global Progress Bar */}
        {(fileSystem.loading || assistantWorking) && (
          <div
            className="ide-splash-progress absolute top-[35px] left-0 right-0 z-50"
            role="progressbar"
            aria-label={fileSystem.loading ? 'Chargement de l’espace de travail' : 'Leanna travaille'}
            aria-valuetext={fileSystem.loading && assistantWorking ? 'Chargement et traitement en cours' : undefined}
            data-loading={fileSystem.loading || undefined}
            data-assistant-working={assistantWorking || undefined}
          >
            <span className="sr-only" aria-live="polite">
              {fileSystem.loading ? 'Chargement de l’espace de travail en cours.' : 'Leanna traite votre demande.'}
            </span>
            <div className="ide-splash-progress__track" aria-hidden="true">
              <div className="ide-splash-progress__aura" />
              <div className="ide-splash-progress__fill">
                <span className="ide-splash-progress__glint" />
              </div>
              <div className="ide-splash-progress__scan" />
            </div>
          </div>
        )}

        {/* Main Editor + Panels Layout */}
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex flex-1 min-h-0">
                    {/* Monaco Editor / Settings Panel */}
                    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
                      {/* BrowserPanel persistant — toujours monté, caché via CSS pour éviter de détruire la webview */}
                      <div
                        style={{ display: showBrowser ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
                        aria-hidden={!showBrowser}
                      >
                        <BrowserPanel
                          url={browserUrl}
                          onClose={() => { setShowBrowser(false); setBrowserUrl(undefined); }}
                          onOpenInNewTab={openUrlInNewTab}
                          onOpenExternal={handleBrowserExternalOpen}
                          fullWidth
                        />
                      </div>
                      {showBrowser ? null : showSandbox ? (
                        <SandboxWorkspace
                          view={sandboxView}
                          selectedFile={selectedSandboxDiffFile}
                          onClose={closeSandbox}
                          onOpenDiff={openSandboxDiff}
                          onCloseDiff={() => {
                            setSandboxView('controls');
                            setSelectedSandboxDiffFile(null);
                          }}
                        />
                      ) : showKnowledge ? (
                        <Suspense fallback={<div className="flex flex-1 items-center justify-center"><div className="text-sm" style={{color: 'var(--text-muted)'}}>Chargement du dashboard…</div></div>}>
                          <DocumentsView />
                        </Suspense>
                      ) : showNotebooks ? (
                        <Suspense fallback={<div className="flex flex-1 items-center justify-center"><div className="text-sm" style={{color: 'var(--text-muted)'}}>Chargement des notebooks…</div></div>}>
                          <NotebooksView onClose={() => { setShowNotebooks(false); setShowExplorer(true); }} />
                        </Suspense>
                      ) : richDocument ? (
                        <Suspense fallback={<div className="flex flex-1 items-center justify-center"><div className="text-sm" style={{color: 'var(--text-muted)'}}>Chargement du document…</div></div>}>
                          <RichDocumentViewerLazy
                            document={richDocument}
                            onClose={() => setRichDocument(null)}
                            onSaveToWorkspace={(path) => {
                              sendRawMessage({
                                type: 'save-rich-document',
                                document: richDocument,
                                path,
                              });
                            }}
                          />
                        </Suspense>
                      ) : showHistory ? (
                        <HistoryPanel onClose={() => setShowHistory(false)} />
                      ) : showAutomation ? (
                        <AutomationPanel onClose={() => setShowAutomation(false)} />
                      ) : showMemory ? (
                        <MemoryPanel onClose={() => setShowMemory(false)} />
                      ) : showGitHub ? (
                        <Suspense fallback={<div className="flex flex-1 items-center justify-center"><div className="text-sm" style={{color: 'var(--text-muted)'}}>Chargement GitHub…</div></div>}>
                          <GitHubPanel onClose={() => setShowGitHub(false)} fullWidth />
                        </Suspense>
                      ) : activeFile ? (
                                              // Onglet navigateur
                                              activeFile.type === 'browser' && activeFile.browserUrl ? (
                                                <BrowserPanel
                                                  url={activeFile.browserUrl}
                                                  onClose={() => fileSystem.closeTab(activeFile.path)}
                                                  onOpenInNewTab={openUrlInNewTab}
                                                  onOpenExternal={handleBrowserExternalOpen}
                                                  fullWidth
                                                />
                                              ) : markdownPreview && activeFile.language === 'markdown' ? (
                                                <MarkdownPreview content={activeFile.content} />
                                              ) : htmlPreview && activeFile.language === 'html' ? (
                                                <BrowserPanel
                                                  url={`http://localhost:${SERVER_PORT}/workspace-preview/${encodeURIComponent(activeFile.path)}`}
                                                  onClose={() => setHtmlPreview(false)}
                                                  onOpenInNewTab={openUrlInNewTab}
                                                  onOpenExternal={handleBrowserExternalOpen}
                                                  fullWidth
                                                />
                                              ) : /\.(pdf)$/i.test(activeFile.path) ? (
                                                <PdfPreview filePath={activeFile.path} />
                                              ) : /\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i.test(activeFile.path) ? (
                                                <ImagePreview filePath={activeFile.path} />
                                              ) : (
                                                <Suspense fallback={<div className="flex flex-1 items-center justify-center"><div className="text-sm" style={{color: 'var(--text-muted)'}}>Chargement de l'éditeur…</div></div>}>
                                                  <MonacoEditor
                                                    key={`${activeFile.path}-${reloadKeys[activeFile.path] ?? 0}`}
                                                    value={activeFile.content}
                                                    language={activeFile.language}
                                                    theme={ideSettings.theme}
                                                    onChange={handleEditorChange}
                                                    onMount={handleEditorMount}
                                                    options={monacoOptions}
                                                    keepCurrentModel={true}
                                                  />
                                                </Suspense>
                                              )
                      ) : (
                        <EmptyEditorState
                                                  onOpenFile={openFileAt}
                                                  onCreateFile={() => setModalState({ type: 'create-file', dir: fileSystem.currentDir })}
                                                  onCreateFolder={() => setModalState({ type: 'create-folder', dir: fileSystem.currentDir })}
                                                  onShowSettings={openSettings}
                                                  onOpenSearch={() => setShowGlobalSearch(true)}
                                                  onOpenChat={() => {
                                                    setChatDocked(true);
                                                    setShowChat(true);
                                                  }}
                                                  onOpenNotebooks={() => {
                                                    setShowNotebooks(true);
                                                    setShowExplorer(false);
                                                  }}
                                                />
                      )}
                    </div>

            {/* Global Search Panel */}
            {showGlobalSearch && (
              <div
                className="border-l"
                style={{ width: '320px', borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
              >
                <GlobalSearch onOpenFile={openFileAt} onClose={() => setShowGlobalSearch(false)} />
              </div>
            )}

            {/* Workflow Panel */}
            {showWorkflow && (
              <WorkflowPanel onClose={() => setShowWorkflow(false)} />
            )}

            {/* MCP Panel */}
                        {showMcp && (
                          <div className="border-l flex flex-col min-h-0" style={{ width: 320, borderColor: 'var(--border-base)' }}>
                            <McpPanel />
                          </div>
                        )}

                        {/* Browser Panel — rendu en zone principale (plein écran) */}

                        {/* System Health Dashboard */}
                        {showSystemHealth && (
                          <SystemHealthDashboard onClose={() => setShowSystemHealth(false)} />
                        )}

                        {/* PM2 Status Panel */}
                        {showPM2 && (
                          <PM2StatusPanel onClose={() => setShowPM2(false)} />
                        )}

                        {/* Vision Panel */}
                        {visionEnabled && (
                          <div
                            className="border-l flex flex-col min-h-0"
                            style={{ width: '260px', minWidth: '260px', borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                          >
                            <Suspense fallback={<div className="flex flex-1 items-center justify-center"><div className="text-sm" style={{color: 'var(--text-muted)'}}>Chargement de la vision…</div></div>}>
                              <VisionPanel connected={connected} onFrame={sendVideoFrame} />
                            </Suspense>
                          </div>
                        )}

            {/* Live Skills Monitor */}
            {showSkillsMonitor && connected && (
              <div
                className="border-l flex flex-col min-h-0 overflow-hidden"
                style={{ width: '280px', minWidth: '280px', borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
              >
                <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: '60%' }}>
                  <LiveSkillsMonitor />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden" />
              </div>
            )}

            {/* Chat/Agent Panel — moved to overlay below */}

            {/* Agents Panel — now rendered as modal overlay below */}

            {/* Agent Fleet Panel — rendered as modal overlay below */}

            {/* Missions Panel */}
            {showMissions && (
              <div
                className="border-l flex flex-col min-h-0"
                style={{ width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <MissionPanel inline onClose={() => setShowMissions(false)} />
              </div>
            )}

            {/* Agents Panel — docké comme le panneau Missions */}
            {showAgents && (
              <div
                className="border-l flex flex-col min-h-0"
                style={{ width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <AgentPanel docked onClose={() => setShowAgents(false)} />
              </div>
            )}

            {/* Agent Fleet Panel — docké comme le panneau Missions */}
            {showFleet && (
              <div
                className="border-l flex flex-col min-h-0"
                style={{ width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <AgentFleetPanel docked onClose={() => setShowFleet(false)} />
              </div>
            )}

            {/* Bot Telegram — docké comme le panneau Missions */}
            {showTelegram && (
              <div
                className="border-l flex flex-col min-h-0"
                style={{ width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <TelegramStatusModal docked status={null} onClose={() => setShowTelegram(false)} />
              </div>
            )}

            {/* Sélecteur de modèle IA — docké comme le panneau Missions */}
            {showModelPicker && (
              <div
                className="border-l flex flex-col min-h-0"
                style={{ width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <ModelPickerModal docked onClose={() => setShowModelPicker(false)} />
              </div>
            )}

            {/* Détails Tokens & Contexte — docké comme le panneau Missions */}
            {showTokenDetail && (
              <div
                className="border-l flex flex-col min-h-0"
                style={{ width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <TokenDetailModal docked onClose={() => setShowTokenDetail(false)} />
              </div>
            )}
          </div>
        </div>

        {/* Agent Progress Bar */}
        <AgentProgressBar steps={activity} connected={connected} onClear={clearActivity} reasoning={reasoning} />

        {/* Status Bar */}
        <StatusBar
          filePath={fileSystem.activePath}
          language={activeFile?.language}
          line={cursorPosition?.line}
          column={cursorPosition?.column}
          dirty={activeFile?.dirty}
          assistantBusy={assistantWorking}
          onToggleSandbox={toggleSandbox}
          onToggleMcp={() => setShowMcp(v => !v)}
          onToggleAgents={() => setShowAgents(v => !v)}
          onToggleFleet={() => setShowFleet(v => !v)}
          onToggleLogs={() => setShowAssistantLogs(v => !v)}
          onToggleGitHub={() => setShowGitHub(v => !v)}
          onToggleMissions={() => setShowMissions(v => !v)}
          onToggleTelegram={() => setShowTelegram(v => !v)}
          onToggleModelPicker={() => setShowModelPicker(v => !v)}
          onToggleTokenDetail={() => setShowTokenDetail(v => !v)}
        />
      </div>

      {/* Modals and Overlays */}
      {modalState && (
        <IdeModal mode={modalState} onConfirm={handleModalConfirm} onCancel={() => setModalState(null)} />
      )}

      {notebookPicker && (
        <NotebookPickerModal
          filePath={notebookPicker.filePath}
          fileName={notebookPicker.fileName}
          onClose={() => setNotebookPicker(null)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          target={contextMenu.target}
          x={contextMenu.x}
          y={contextMenu.y}
          activeFilePath={fileSystem.activePath}
          clipboardEntry={clipboardEntry}
          assistantConnected={connected}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showDiffViewer && activeFile && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-50 flex items-center justify-center"
              style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-muted)' }}
            >
              Chargement de la comparaison...
            </div>
          }
        >
          <DiffViewer
            filePath={activeFile.path}
            currentContent={activeFile.content}
            theme={ideSettings.theme}
            onClose={() => setShowDiffViewer(false)}
          />
        </Suspense>
      )}

      {showCommandPalette && (
        <CommandPalette
          mode={showCommandPalette}
          openFiles={fileSystem.openFiles}
          onOpenFile={fileSystem.openFile}
          onClose={() => setShowCommandPalette(null)}
          onSave={saveActiveFile}
          onFormat={formatDocument}
          onToggleMinimap={() => updateSetting('showMinimap', !ideSettings.showMinimap)}
          onToggleWordWrap={() => updateSetting('wordWrap', !ideSettings.wordWrap)}
          onToggleSettings={openSettings}
          onShowDiff={() => setShowDiffViewer(true)}
        />
      )}

      {/* Agent/Mission Activity Overlay — always visible when working */}
      <AgentActivityOverlay
        onOpenAgents={() => setShowAgents(true)}
        onOpenMissions={() => setShowMissions(true)}
        isChatOpen={showChat}
      />

      {/* Chat Panel — floating overlay above everything */}
      {showChat && !showSkillsMonitor && (
        <ChatPanel
          pendingMessage={pendingChatMessage}
          onPendingMessageConsumed={() => setPendingChatMessage(null)}
          onDockedChange={setChatDocked}
          onWidthChange={setChatWidth}
          initialDocked={chatDocked}
          onClose={() => setShowChat(false)}
        />
      )}

      {/* Assistant Logs — modal overlay */}
      {showAssistantLogs && (
        <AssistantLogsPanel onClose={() => setShowAssistantLogs(false)} />
      )}

      {/* Agent Builder Panel — modal overlay */}
      {showAgentBuilder && (
        <AgentBuilderPanel inline onClose={() => setShowAgentBuilder(false)} />
      )}

      {/* Marketplace Panel — modal overlay */}
      {showMarketplace && (
        <MarketplacePanel onClose={() => setShowMarketplace(false)} />
      )}

      {/* Skills Documentation Modal */}
      <SkillsDocModal
        isOpen={showSkillsDoc}
        onClose={() => setShowSkillsDoc(false)}
      />



      {/* Terminal Panel — floating overlay */}
      {showTerminal && (
        <TerminalPanel
          ref={terminalRef}
          onClose={() => setShowTerminal(false)}
          isDocked={terminalDocked}
          onToggleDock={() => setTerminalDocked(v => !v)}
          onOpenBrowser={(url: string) => {
            setShowBrowser(true);
            setBrowserUrl(url);
          }}
          showExplorer={showExplorer}
          devServerPort={ideSettings.devServerPort}
          initialCwd={fileSystem.activePath ? fileSystem.activePath.replace(/[\\/][^\\/]+$/, '') : ''}
        />
      )}

      {/* Template Selector Modal */}
      <TemplateSelectorModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onInsertToIde={async (filename, content) => {
          try {
            await fileSystem.saveFile(filename, content);
            await fileSystem.openFile(filename);
            await fileSystem.loadTree();
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}

