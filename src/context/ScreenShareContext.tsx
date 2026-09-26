import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
}

interface ScreenShareState {
  isSharing: boolean;
  screenShareEnabled: boolean;
  sources: ScreenSource[];
  showPicker: boolean;
  error: string | null;
  frameCount: number;
}

interface ScreenShareContextValue extends ScreenShareState {
  startScreenShare: () => void;
  stopScreenShare: () => void;
  toggleScreenShare: () => void;
  selectSource: (sourceId: string) => void;
  openSourcePicker: () => void;
}

const ScreenShareContext = createContext<ScreenShareContextValue | null>(null);

export function useScreenShare() {
  const ctx = useContext(ScreenShareContext);
  if (!ctx) throw new Error('useScreenShare must be used within ScreenShareProvider');
  return ctx;
}

interface ScreenShareProviderProps {
  children: React.ReactNode;
  onFrame: (base64: string) => void;
  connected: boolean;
  onScreenShareChange?: (active: boolean) => void;
}

/**
 * Provider qui gère le stream de partage d'écran de manière persistante.
 * Le stream survit aux changements de page car il vit dans le Layout.
 */
export function ScreenShareProvider({ children, onFrame, connected, onScreenShareChange }: ScreenShareProviderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isSharing, setIsSharing] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);

  // Refs for callbacks that need latest values
  const connectedRef = useRef(connected);
  const onFrameRef = useRef(onFrame);
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  const stopSharing = useCallback(() => {
    console.log('[ScreenShare] Stopping capture');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsSharing(false);
    setScreenShareEnabled(false);
    setFrameCount(0);
    setSources([]);
    setShowPicker(false);
    setError(null);
  }, []);

  const captureAndSendFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const { videoWidth, videoHeight } = videoRef.current;
    if (videoWidth === 0 || videoHeight === 0) return;

    const canvas = canvasRef.current;
    const scale = Math.min(1, 1280 / videoWidth);
    canvas.width = videoWidth * scale;
    canvas.height = videoHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

    if (connectedRef.current) {
      onFrameRef.current(dataUrl);
      setFrameCount(c => c + 1);
    }
  }, []);

  const startCaptureWithSource = useCallback(async (sourceId: string) => {
    setError(null);
    setShowPicker(false);
    console.log('[ScreenShare] Starting capture with source:', sourceId);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore — propriétés spécifiques Electron/Chromium
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
          },
        },
      });

      streamRef.current = stream;

      // Créer les éléments video/canvas si besoin
      if (!videoRef.current) {
        videoRef.current = document.createElement('video');
        videoRef.current.autoplay = true;
        videoRef.current.muted = true;
      }
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }

      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        console.log('[ScreenShare] Video metadata loaded, starting frame capture');
        setTimeout(captureAndSendFrame, 500);
        intervalRef.current = setInterval(captureAndSendFrame, 2000);
      };

      setIsSharing(true);
      setScreenShareEnabled(true);

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        console.log('[ScreenShare] Track ended by user');
        stopSharing();
      });
    } catch (err: any) {
      console.error('[ScreenShare] Capture error:', err);
      setError(`Erreur: ${err.message || 'Impossible de démarrer le partage'}`);
      stopSharing();
    }
  }, [captureAndSendFrame, stopSharing]);

  const fetchSources = useCallback(async () => {
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.getScreenSources) {
        setError('Partage d\'écran disponible uniquement dans l\'app Electron');
        return;
      }
      console.log('[ScreenShare] Fetching screen sources...');
      const srcs: ScreenSource[] = await electronAPI.getScreenSources();
      console.log(`[ScreenShare] Found ${srcs.length} sources:`, srcs.map(s => s.name));
      if (srcs.length === 0) {
        setError('Aucune source d\'écran trouvée');
        return;
      }
      // Toujours démarrer directement avec le premier écran (comportement "comme la caméra")
      const screens = srcs.filter(s => s.id.startsWith('screen:'));
      const target = screens[0] || srcs[0];
      console.log('[ScreenShare] Auto-selecting source:', target.name);
      await startCaptureWithSource(target.id);
    } catch (err) {
      console.error('[ScreenShare] Failed to get sources:', err);
      setError('Erreur lors de la récupération des sources d\'écran');
    }
  }, [startCaptureWithSource]);

  const startScreenShare = useCallback(() => {
    if (!isSharing) {
      setScreenShareEnabled(true);
      fetchSources();
    }
  }, [isSharing, fetchSources]);

  const toggleScreenShare = useCallback(() => {
    if (isSharing) {
      stopSharing();
    } else {
      startScreenShare();
    }
  }, [isSharing, startScreenShare, stopSharing]);

  const selectSource = useCallback((sourceId: string) => {
    // Si on partage déjà, arrêter le stream en cours avant de changer
    if (streamRef.current) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setShowPicker(false);
    startCaptureWithSource(sourceId);
  }, [startCaptureWithSource]);

  const openSourcePicker = useCallback(async () => {
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.getScreenSources) return;
      const srcs: ScreenSource[] = await electronAPI.getScreenSources();
      if (srcs.length === 0) return;
      setSources(srcs);
      setShowPicker(true);
    } catch (err) {
      console.error('[ScreenShare] Failed to get sources for picker:', err);
    }
  }, []);

  // Notify parent when screen share state changes (only on actual transitions)
  const prevSharingRef = useRef(isSharing);
  const onScreenShareChangeRef = useRef(onScreenShareChange);
  useEffect(() => { onScreenShareChangeRef.current = onScreenShareChange; }, [onScreenShareChange]);

  useEffect(() => {
    if (prevSharingRef.current !== isSharing) {
      prevSharingRef.current = isSharing;
      onScreenShareChangeRef.current?.(isSharing);
    }
  }, [isSharing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const value: ScreenShareContextValue = {
    isSharing,
    screenShareEnabled,
    sources,
    showPicker,
    error,
    frameCount,
    startScreenShare,
    stopScreenShare: stopSharing,
    toggleScreenShare,
    selectSource,
    openSourcePicker,
  };

  return (
    <ScreenShareContext.Provider value={value}>
      {children}
    </ScreenShareContext.Provider>
  );
}
