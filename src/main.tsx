/// <reference types="vite/client" />

import React, { StrictMode, useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfileProvider } from './context/UserProfileContext.js';
import { ToastProvider } from './components/ui/Toast.js';
import { ConfirmDialogProvider } from './components/ui/ConfirmDialog.js';
import { patchConsole } from './utils/logger.js';
import { cleanupGlobalResources, installBeforeUnloadCleanup } from './utils/cleanup.js';
import { LiveAPIContext } from './context/LiveAPIContext.js';
import { ScreenShareProvider, useScreenShare } from './context/ScreenShareContext.js';
import { useLiveAPI } from './hooks/useLiveAPI.js';
import { FloatingOrb } from './components/FloatingOrb.js';
import { CriticalEditConfirm } from './components/CriticalEditConfirm.js';
import { StartupProjectModal } from './components/StartupProjectModal.js';
import { IndexingOverlay } from './components/IndexingOverlay.js';
import { LauncherModal } from './components/LauncherModal.js';
import { useProfile } from './context/UserProfileContext.js';
import { useAgentEventStream } from './hooks/useAgentEventStream.js';
import { Loader2 } from 'lucide-react';
import { UnifiedSidebar } from './components/UnifiedSidebar.js';
const MemoriesView = lazy(() => import('./views/MemoriesView.js'));
const SettingsView = lazy(() => import('./views/SettingsView.js'));
const ListsView = lazy(() => import('./views/ListsView.js'));
const IdeView = lazy(() => import('./views/IdeView.js'));
const AutomationView = lazy(() => import('./views/AutomationView.js'));
const HistoryView = lazy(() => import('./views/HistoryView.js'));
const GitHubView = lazy(() => import('./views/GitHubView.js'));
const DocumentsView = lazy(() => import('./views/DocumentsView.js'));
const NotebooksView = lazy(() => import('./views/NotebooksView.js'));
const ObservabilityView = lazy(() => import('./views/ObservabilityView.js'));
const AutonomyView = lazy(() => import('./views/AutonomyView.js'));
// ── Security Console Views (Phase 1 refonte) ───────────────────────────────
const ScanView = lazy(() => import('./views/ScanView.js'));
const FindingsView = lazy(() => import('./views/FindingsView.js'));
const FindingDetailView = lazy(() => import('./views/FindingDetailView.js'));
const AttackSurfaceView = lazy(() => import('./views/AttackSurfaceView.js'));
const ReportView = lazy(() => import('./views/ReportView.js'));
const RulesView = lazy(() => import('./views/RulesView.js'));
import './index.css';

const configuredApiToken = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_Leanna_API_TOKEN?.trim();
if (configuredApiToken) {
  localStorage.setItem('Leanna_api_token', configuredApiToken);
}

// ── Global fetch interceptor: auto-inject auth token + dedup + CIRCUIT BREAKER
{
  const _originalFetch = window.fetch;

  interface InflightEntry {
    promise: Promise<Response>;
  }
  const inflight = new Map<string, InflightEntry>();

  // ── Circuit breaker global ─────────────────────────────────────────────
  // Empêche l'explosion TCP (ENOBUFS / ECONNREFUSED) quand le backend est down :
  // après 12 échecs réseau consécutifs, on bloque TOUS les fetch API pendant
  // 8 secondes (retourne une Response 503 immédiate sans toucher au réseau).
  const CB = {
    failures: 0,
    openUntil: 0,
    THRESHOLD: 12,
    BLOCK_MS: 8000,
    recordFailure() {
      CB.failures += 1;
      if (CB.failures >= CB.THRESHOLD) CB.openUntil = Date.now() + CB.BLOCK_MS;
    },
    recordSuccess() { CB.failures = Math.max(0, CB.failures - 1); },
    isOpen(): boolean {
      if (Date.now() < CB.openUntil) return true;
      if (CB.failures >= CB.THRESHOLD) {
        // reset le compteur à la réouverture pour ne pas re-bloquer instantanément
        CB.failures = 0;
      }
      return false;
    },
  };

  function isNetworkError(err: any): boolean {
    if (!err) return false;
    const m = String(err?.message || err?.name || err || '');
    return /Failed to fetch|ENOBUFS|ECONNREFUSED|ECONNRESET|ETIMEDOUT|NetworkError|Load failed/i.test(m);
  }

  function serviceUnavailable(msg: string): Response {
    const body = JSON.stringify({
      error: 'Service indisponible',
      details: msg,
      hint: 'Redémarrez le backend avec "npm run dev" (depuis la racine).',
    });
    return new Response(body, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json', 'X-Leanna-CB': '1' },
    });
  }

  function dedupKeyFor(input: RequestInfo | URL, init?: RequestInit): string | null {
    if (init && init.method && init.method !== 'GET') return null;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method =
      (init?.method as string | undefined) ||
      (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET');
    if (method !== 'GET') return null;
    const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
    if (!isApi) return null;
    return url;
  }

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isApi = rawUrl.startsWith('/api/') || rawUrl.startsWith(window.location.origin + '/api/');

    // --- Circuit breaker : si ouvert, retour immédiat sans socket TCP ---
    if (isApi && CB.isOpen()) {
      return Promise.resolve(
        serviceUnavailable(
          'Trop d\'échecs consécutifs vers le backend — pause 8s pour éviter ENOBUFS.'
        )
      );
    }

    let resolvedInit = init;
    if (isApi) {
      const token = localStorage.getItem('Leanna_api_token') || configuredApiToken;
      if (token) {
        const headers = new Headers(init?.headers);
        if (!headers.has('x-Leanna-token')) {
          headers.set('x-Leanna-token', token);
        }
        resolvedInit = { ...init, headers };
      }
    }

    const key = dedupKeyFor(input, resolvedInit);
    if (key) {
      const existing = inflight.get(key);
      if (existing) {
        return existing.promise.then((r) => r.clone());
      }
      const promise = _originalFetch
        .call(window, input, resolvedInit)
        .then((res) => {
          if (res.ok || (res.status >= 400 && res.status < 500)) CB.recordSuccess();
          else CB.recordFailure();
          // Clone immédiatement pour que les appels dédupliqués puissent lire le body
          return res.clone();
        })
        .catch((err) => {
          if (isNetworkError(err)) CB.recordFailure();
          throw err;
        })
        .finally(() => { inflight.delete(key); });
      inflight.set(key, { promise });
      // Retourner un clone distinct pour cet appel aussi
      return promise.then((r) => r.clone());
    }

    return _originalFetch.call(window, input, resolvedInit).catch((err) => {
      if (isApi && isNetworkError(err)) CB.recordFailure();
      throw err;
    });
  };
}

// ── Apply saved profile before first paint (no flash) ──────────────────────
const PROFILE_KEY = 'Leanna_user_profile';
try {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (raw) {
    const p = JSON.parse(raw);
    if (p.theme)       document.documentElement.setAttribute('data-theme', p.theme);
    if (p.accentColor) document.documentElement.style.setProperty('--accent-primary', p.accentColor);
  } else {
    document.documentElement.setAttribute('data-theme', 'cyberpunk');
  }
} catch { document.documentElement.setAttribute('data-theme', 'cyberpunk'); }

// ── Sync profile to server on startup ──────────────────────────────────────
// This ensures the WS session always uses the latest saved identity/voice.
try {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (raw) {
    const p = JSON.parse(raw);
    const _token = localStorage.getItem('Leanna_api_token') || configuredApiToken;
    fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(_token ? { 'x-Leanna-token': _token } : {}),
      },
      body: JSON.stringify({
        aiName:               p.aiName               || 'Leanna',
        aiVoice:              p.aiVoice              || 'Aoede',
        userName:             p.userName             || '',
        userRole:             p.userRole             || '',
        language:             p.language             || 'fr',
        responseStyle:        p.responseStyle        || 'balanced',
        reasoningEnabled:     p.reasoningEnabled     ?? true,
      }),
    }).catch(() => { /* server may not be up yet — silently ignore */ });
  }
} catch { /* ignore parse errors */ }

// ── Load Tool-Agent Mapping on startup (Spécialisation des compétences) ─────────
// Charge le mapping dynamique outil → agent depuis le backend
// Cela permet au frontend de connaître quel agent utilise quel outil
(async () => {
  try {
    const _token = localStorage.getItem('Leanna_api_token') || configuredApiToken;
    const response = await fetch('/api/agents/tool-mapping/primary', {
      headers: _token ? { 'x-Leanna-token': _token } : {},
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.mapping) {
        // Injecter le mapping dans window pour qu'il soit accessible partout
        (window as any).LeannaToolAgentMapping = data.mapping;
        console.log(`[main.tsx] Mapping outil→agent chargé: ${data.totalTools} outils mappés`);
      }
    }
  } catch (error) {
    // Le backend n'est peut-être pas encore prêt, on réessayera plus tard
    console.warn('[main.tsx] Impossible de charger le mapping outil→agent au démarrage:', error);
  }
})();

function IdeNavigationBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Cooldown: ignore auto open-ide events for 1s after user-initiated navigation
    let ignoreUntil = 0;

    const handleNavClick = () => { ignoreUntil = Date.now() + 1000; };
    // Listen to user-initiated navigation (popstate or link clicks)
    window.addEventListener('Leanna-user-nav', handleNavClick);

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;

      if (detail.type === 'open-ide') {
        // Auto-open IDE only from secondary pages (not orb home or ide)
        // Also skip if user just navigated away (cooldown)
        if (Date.now() < ignoreUntil) return;
        if (location.pathname !== '/' && location.pathname !== '/ide') {
          navigate('/ide');
        }
      }

      if (detail.type === 'open-file') {
        // Explicit file open: always navigate to IDE
        if (location.pathname !== '/ide') {
          navigate('/ide');
        }
        if (typeof detail.path === 'string') {
          sessionStorage.setItem('Leanna-ide-pending-file', JSON.stringify({
            path: detail.path,
            line: detail.line,
            column: detail.column,
          }));
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('Leanna-ide-open-file', {
              detail: { path: detail.path, line: detail.line, column: detail.column },
            }));
          }, 300);
        }
      }

      // File was modified on disk by the assistant — reload it in the editor
      if (detail.type === 'file-changed' && typeof detail.path === 'string') {
        if (location.pathname !== '/' && location.pathname !== '/ide') {
          navigate('/ide');
        }
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('Leanna-ide-file-changed', {
            detail: { path: detail.path },
          }));
        }, 300);
      }
    };

    window.addEventListener('Leanna-ide-action', handleAction as EventListener);
    return () => {
      window.removeEventListener('Leanna-ide-action', handleAction as EventListener);
      window.removeEventListener('Leanna-user-nav', handleNavClick);
    };
  }, [navigate, location.pathname]);

  return null;
}

// ── Layout ──────────────────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('Leanna_api_token') || configuredApiToken || '';
    setToken(stored);
    setReady(true);
  }, []);

  const isAuthenticated = useMemo(() => {
    if (!configuredApiToken) return true;
    return token === configuredApiToken;
  }, [token]);

  if (!ready) return null;
  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div className="w-full max-w-sm rounded-2xl border p-6" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
        <h1 className="text-lg font-semibold">Accès protégé</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Saisissez le token d’accès pour continuer.</p>
        <input
          type="password"
          value={token}
          onChange={e => {
            const next = e.target.value;
            setToken(next);
            localStorage.setItem('Leanna_api_token', next);
          }}
          className="mt-4 w-full rounded-xl border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
          placeholder="Token"
        />
      </div>
    </div>
  );
}

/**
 * Petit indicateur fixe affiché en bas à gauche quand le screen share est actif.
 * Visible sur toutes les pages.
 */
function ScreenShareIndicator() {
  const { isSharing, frameCount, stopScreenShare, openSourcePicker } = useScreenShare();

  if (!isSharing) return null;

  return (
    <div
      className="fixed bottom-5 left-5 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl backdrop-blur-2xl shadow-2xl group transition-all"
      style={{
        background: 'linear-gradient(135deg, rgba(239, 246, 255, 0.92) 0%, rgba(219, 234, 254, 0.88) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        boxShadow: '0 0 20px rgba(59, 130, 246, 0.08), 0 8px 32px rgba(59, 130, 246, 0.12)',
      }}
    >
      {/* Pulsing dot */}
      <div className="relative flex items-center justify-center">
        <div className="absolute w-3.5 h-3.5 bg-blue-400/30 rounded-full animate-ping" />
        <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
      </div>

      {/* Label */}
      <span className="text-[12px] font-medium tracking-wide text-blue-900">
        Écran partagé
      </span>

      {/* Frame counter */}
      <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-600">
        {frameCount}
      </span>

      {/* Separator */}
      <div className="w-px h-4 bg-blue-200" />

      {/* Switch source button */}
      <button
        onClick={openSourcePicker}
        className="text-[11px] text-blue-600 hover:text-blue-800 transition-colors px-2 py-1 rounded-lg hover:bg-blue-100"
        title="Changer de source"
      >
        ⇄ Source
      </button>

      {/* Stop button */}
      <button
        onClick={stopScreenShare}
        className="text-[11px] text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
        title="Arrêter le partage"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Overlay flottant pour sélectionner la source de screen share.
 * Visible sur toutes les pages quand le sélecteur est ouvert.
 */
function ScreenShareSourcePicker() {
  const { showPicker, sources, selectSource } = useScreenShare();

  if (!showPicker || sources.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-2xl p-4 shadow-2xl"
        style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
      >
        <p className="text-sm font-semibold mb-3 text-center" style={{ color: 'var(--text-primary)' }}>
          Choisir la source à partager
        </p>
        <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
          {sources.map(src => (
            <button
              key={src.id}
              onClick={() => selectSource(src.id)}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all hover:border-purple-500/60 hover:scale-[1.02]"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <img
                src={src.thumbnail}
                alt={src.name}
                className="w-full rounded-lg object-cover aspect-video"
              />
              <span className="text-[11px] truncate w-full text-center" style={{ color: 'var(--text-muted)' }}>
                {src.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

function LoadingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Chargement…</span>
      </div>
    </div>
  );
}

function FloatingOrbWrapper() {
  const { pathname } = useLocation();
  // Hide on IDE / code viewer views — the ChatPanel replaces it there
  if (pathname === '/code-viewer' || pathname === '/ide') return null;
  return <FloatingOrb />;
}
function NavSidebar() {
  const { pathname } = useLocation();
  const isIde = pathname === '/code-viewer' || pathname === '/ide';
  const isSettings = pathname === '/settings';

  // Don't show on IDE (it has its own UnifiedSidebar in context='ide')
  // Don't show on Settings (SettingsView has its own left nav)
  if (isIde || isSettings) return null;
  return <UnifiedSidebar context="global" />;
}

// ── Animated route transitions (Phase 3.5) ─────────────────────────────────
function AnimatedRoutes() {
  const location = useLocation();

  // The IDE and Hub manage their own full-height layout; a fade is enough.
  const pageMotion = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.18, ease: 'easeOut' as const },
  };

  const wrap = (node: React.ReactNode) => (
    <motion.div className="h-full" {...pageMotion}>
      <Suspense fallback={<LoadingFallback />}>{node}</Suspense>
    </motion.div>
  );

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* ── Security Console (primary routes) ─────────────────────────── */}
        <Route path="/"              element={<Navigate to="/scan" replace />} />
        <Route path="/scan"          element={wrap(<ScanView />)} />
        <Route path="/findings"      element={wrap(<FindingsView />)} />
        <Route path="/findings/:id"  element={wrap(<FindingDetailView />)} />
        <Route path="/surface"       element={wrap(<AttackSurfaceView />)} />
        <Route path="/report"        element={wrap(<ReportView />)} />
        <Route path="/rules"         element={wrap(<RulesView />)} />
        {/* ── Legacy / secondary routes (conservés) ─────────────────────── */}
        <Route path="/code-viewer"   element={wrap(<IdeView />)} />
        <Route path="/ide"           element={<Navigate to="/code-viewer" replace />} />
        <Route path="/memories"      element={wrap(<MemoriesView />)} />
        <Route path="/history"       element={wrap(<HistoryView />)} />
        <Route path="/settings"      element={wrap(<SettingsView />)} />
        <Route path="/lists"         element={wrap(<ListsView />)} />
        <Route path="/github"        element={wrap(<GitHubView />)} />
        <Route path="/automation"    element={wrap(<AutomationView />)} />
        <Route path="/documents"     element={wrap(<DocumentsView />)} />
        <Route path="/notebooks"     element={wrap(<NotebooksView />)} />
        <Route path="/observability" element={wrap(<ObservabilityView />)} />
        <Route path="/autonomy"      element={wrap(<AutonomyView />)} />
      </Routes>
    </AnimatePresence>
  );
}

function Layout() {
  const liveAPI = useLiveAPI();
  const { profile } = useProfile();
  useAgentEventStream();

  // ── Cleanup global resources on unmount ─────────────────────────────────
  useEffect(() => {
    // Install beforeunload cleanup (only once)
    const removeBeforeUnload = installBeforeUnloadCleanup();
    
    return () => {
      // Cleanup when component unmounts
      cleanupGlobalResources();
      removeBeforeUnload();
    };
  }, []);

  // Reconnect the live session when settings that affect tool declarations are saved
  // (e.g. reasoningEnabled, agents). The session is rebuilt with fresh tool declarations.
  useEffect(() => {
    const handleSettingsSaved = () => {
      if (liveAPI.connected) {
        liveAPI.disconnect();
        // Small delay to let the WS close cleanly before reopening
        setTimeout(() => liveAPI.connect([], 'full'), 300);
      }
    };
    window.addEventListener('Leanna-settings-saved', handleSettingsSaved);
    return () => window.removeEventListener('Leanna-settings-saved', handleSettingsSaved);
  }, [liveAPI.connected, liveAPI.disconnect, liveAPI.connect]);

  const handleScreenShareChange = useCallback((active: boolean) => {
    // Notify AI about screen share state changes
    if (liveAPI.connected) {
      if (active) {
        liveAPI.sendTextMessage('[screen-share:start] L\'utilisateur partage son écran. Les prochaines images sont des captures d\'écran.');
      } else {
        liveAPI.sendTextMessage('[screen-share:stop] Le partage d\'écran est terminé.');
      }
    }
  }, [liveAPI.connected, liveAPI.sendTextMessage]);

  return (
    <LiveAPIContext.Provider value={liveAPI}>
      <ScreenShareProvider
        onFrame={liveAPI.sendVideoFrame}
        connected={liveAPI.connected}
        onScreenShareChange={handleScreenShareChange}
      >
        <div className="app-layout">
          <a className="skip-navigation-link" href="#main-content">Passer la navigation</a>
          <NavSidebar />
          <main id="main-content" className="app-content" tabIndex={-1}>
            <IdeNavigationBridge />
            <AnimatedRoutes />
          </main>
        </div>
        {/* Indicateur persistant de screen share (visible sur toutes les pages) */}
        <ScreenShareIndicator />
        <ScreenShareSourcePicker />
        {/* Orb flottant déplaçable — visible uniquement hors de l'IDE (le chat panel le remplace) */}
        {profile.floatingOrb !== false && <FloatingOrbWrapper />}
        {/* Modale de confirmation pour les fichiers critiques */}
        <CriticalEditConfirm sendMessage={liveAPI.sendRawMessage} />
        {/* Modale de sélection du projet au démarrage */}
        <StartupProjectModal />
        {/* Overlay d'indexation — visible pendant le scan du projet nouvellement ouvert */}
        <IndexingOverlay />
        {/* Écran de choix IDE / Notebook affiché après le splash */}
        <LauncherModal />
      </ScreenShareProvider>
    </LiveAPIContext.Provider>
  );
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RootErrorBoundary] Uncaught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center p-6" style={{ backgroundColor: '#0a1628', color: '#f0f4ff', fontFamily: 'sans-serif' }}>
          <div className="max-w-md w-full rounded-2xl border p-6 text-center" style={{ backgroundColor: '#0e2a47', borderColor: 'rgba(0, 194, 255, 0.3)' }}>
            <h1 className="text-xl font-bold mb-2" style={{ color: '#00c2ff' }}>Une erreur est survenue</h1>
            <p className="text-sm mb-4" style={{ color: '#b0c8e0' }}>
              {this.state.error?.message || 'Erreur d’initialisation de l’application.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: '#00c2ff', color: '#0a1628' }}
            >
              Recharger l’application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Patch console in production to suppress console.log/debug noise
patchConsole();

// ── Silence les rejets « Canceled » de Monaco ───────────────────────────────
// Monaco annule ses tâches différées (layout, workers, coloration) quand un
// éditeur est démonté — par exemple à la fermeture du DiffViewer. Chaque
// annulation rejette une promesse `CancellationError` (name/message = "Canceled")
// que personne ne catch, ce qui produit un « Uncaught (in promise) Canceled »
// bruyant en console. Ce sont des annulations attendues, pas des erreurs :
// on les absorbe silencieusement sans masquer les vrais rejets.
window.addEventListener('unhandledrejection', (event) => {
  const reason: any = event.reason;
  const name = reason?.name ?? '';
  const message = String(reason?.message ?? reason ?? '');
  if (name === 'Canceled' || message === 'Canceled' || message === 'Cancelled') {
    event.preventDefault();
  }
});

// Vite peut réévaluer ce module pendant un HMR sans perdre le conteneur DOM.
// Conserver la racine évite un second createRoot et le démontage de Monaco.
type AppWindow = Window & { __leannaReactRoot?: ReturnType<typeof createRoot> };
const appWindow = window as AppWindow;
const appRoot = appWindow.__leannaReactRoot ?? (appWindow.__leannaReactRoot = createRoot(document.getElementById('root')!));

appRoot.render(
  <StrictMode>
    <RootErrorBoundary>
      <UserProfileProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <BrowserRouter>
              <AuthGate>
                <Layout />
              </AuthGate>
            </BrowserRouter>
          </ConfirmDialogProvider>
        </ToastProvider>
      </UserProfileProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
