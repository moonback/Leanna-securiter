import { useState, useCallback, useEffect, useRef } from 'react';

// Types pour les messages du terminal
export interface TerminalMessage {
  type: 'output' | 'error' | 'close';
  data?: string;
  code?: number;
}

interface TerminalSize {
  cols: number;
  rows: number;
}

// Détecter si on est dans Electron
const isElectron = (): boolean => {
  return typeof window !== 'undefined' && 
         window.process && 
         window.process.type === 'renderer';
};

// Résolution du port serveur
const getServerPort = (): number => {
  // En mode Electron, le port est généralement passé via VITE_SERVER_PORT
  // ou on utilise 5000 par défaut
  if (typeof window !== 'undefined') {
    // En dev avec Vite, utiliser import.meta.env
    if (import.meta.env && (import.meta.env as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SERVER_PORT) {
      const envPort = Number((import.meta.env as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SERVER_PORT);
      if (envPort) return envPort;
    }
    
    // En production Electron, essayer de récupérer depuis window
    if (isElectron()) {
      // Le port peut être stocké dans window.process.env ou on utilise 5000
      if (window.process?.env?.VITE_SERVER_PORT) {
        return Number(window.process.env.VITE_SERVER_PORT);
      }
      return 5000;
    }
    
    // Dans un navigateur normal, utiliser window.location.port
    if (window.location.port) {
      return Number(window.location.port);
    }
    
    // Fallback : 5000 (port par défaut du serveur backend)
    return 5000;
  }
  return 5000;
};

// URL base pour le serveur WebSocket
// Le token n'est plus transmis via l'URL pour éviter les fuites dans les logs
export function getTerminalWebSocketUrl(): string {
  const port = getServerPort();
  
  // En mode Electron, si le protocole est file:, on force localhost
  // car le serveur backend tourne localement
  let host: string;
  let protocol: string;
  
  if (typeof window !== 'undefined') {
    if (window.location.protocol === 'file:') {
      // Mode Electron packaged - le serveur tourne sur localhost
      host = '127.0.0.1';
      protocol = 'ws:';
    } else {
      host = window.location.hostname || '127.0.0.1';
      protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    }
  } else {
    host = '127.0.0.1';
    protocol = 'ws:';
  }
  
  // Plus de token dans l'URL - sera transmis via cookie ou en-tête
  return `${protocol}//${host}:${port}/terminal`;
}

export interface TerminalState {
  isConnected: boolean;
  output: string;
  error: string | null;
  isConnecting: boolean;
}

export interface TerminalActions {
  sendInput: (input: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  clear: () => void;
  reconnect: () => void;
}

export function useTerminal(initialCols = 80, initialRows = 24): [TerminalState, TerminalActions] {
  const [isConnected, setIsConnected] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef<TerminalSize>({ cols: initialCols, rows: initialRows });
  const bufferRef = useRef<string>('');
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = 5;
  const welcomeShownRef = useRef<boolean>(false);

  // Obtenir le token d'authentification
  const getAuthToken = useCallback((): string | null => {
    return localStorage.getItem('Leanna_api_token');
  }, []);

  // Ajouter du texte à la sortie
  const appendOutput = useCallback((text: string) => {
    setOutput((prev) => prev + text);
    bufferRef.current += text;
  }, []);

  // Gérer la connexion WebSocket
  const connect = useCallback(() => {
    const token = getAuthToken();
    const wsUrl = getTerminalWebSocketUrl();
    
    try {
      // Note: WebSocket API ne supporte pas les en-têtes personnalisés directement.
      // Le token est envoyé via le protocole Sec-WebSocket-Protocol comme workaround.
      // Le serveur lit d'abord le cookie Leanna_token, puis ce protocol en fallback.
      const protocols = token ? ['token', token] : undefined;
      const ws = new WebSocket(wsUrl, protocols);
      wsRef.current = ws;
      setIsConnecting(true);
      setError(null);

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        
        // Envoyer la taille initiale
        ws.send(JSON.stringify({
          type: 'resize',
          data: { cols: sizeRef.current.cols, rows: sizeRef.current.rows },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: TerminalMessage = JSON.parse(event.data);
          
          switch (message.type) {
            case 'output':
              // Filtrer les messages de bienvenue dupliqués
              const messageText = message.data || '';
              if (messageText.includes('=== Leanna Terminal ===') || messageText.includes('Leanna Terminal')) {
                if (!welcomeShownRef.current) {
                  welcomeShownRef.current = true;
                  appendOutput(messageText);
                }
              } else {
                appendOutput(messageText);
              }
              break;
            case 'error':
              setError(message.data || 'Terminal error');
              appendOutput(`\x1b[31m${message.data || 'Error'}\x1b[0m\n`);
              break;
            case 'close':
              appendOutput(`\nTerminal closed (code: ${message.code})\n`);
              setIsConnected(false);
              welcomeShownRef.current = false; // Réinitialiser pour reconnexion
              break;
          }
        } catch (err) {
          // Si le message n'est pas du JSON, on l'affiche directement
          appendOutput(event.data as string);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        welcomeShownRef.current = false; // Réinitialiser pour reconnexion
        wsRef.current = null;
        
        // Ne pas reconnecter automatiquement si c'est une fermeture intentionnelle (code 1000)
        // ou si on a atteint le nombre max de tentatives
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          // Attendre avec un délai exponentiel (backoff)
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 5000);
          setTimeout(() => {
            reconnect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError('Impossible de se connecter au serveur terminal. Vérifiez que le backend est démarré.');
        }
      };

      ws.onerror = (err) => {
        setIsConnecting(false);
        let errorMessage = 'Unknown error';
        
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (err && typeof err === 'object' && 'message' in err) {
          errorMessage = String((err as any).message);
        } else if (err && typeof err === 'object' && 'type' in err) {
          // Pour les Event objects (comme ErrorEvent)
          errorMessage = `Connection error: ${(err as any).type || 'Unknown'}`;
        } else {
          errorMessage = String(err);
        }
        
        // Message plus clair pour l'utilisateur
        const serverPort = getServerPort();
        const userMessage = `Le serveur backend n'est pas accessible sur le port ${serverPort}. Vérifiez que le serveur est bien démarré.`;
        setError('WebSocket error: ' + errorMessage);
        appendOutput(`\x1b[31m${userMessage}\x1b[0m\n`);
      };
    } catch (err) {
      setIsConnecting(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError('Failed to create WebSocket: ' + errorMessage);
    }
  }, [getAuthToken, appendOutput]);

  // Envoyer une entrée au terminal
  const sendInput = useCallback((input: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'input',
          data: input,
        }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError('Failed to send input: ' + errorMessage);
      }
    }
  }, []);

  // Redimensionner le terminal
  const resize = useCallback((cols: number, rows: number) => {
    sizeRef.current = { cols, rows };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          data: { cols, rows },
        }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError('Failed to send resize: ' + errorMessage);
      }
    }
  }, []);

  // Fermer la connexion
  const close = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'close' }));
        wsRef.current.close();
      } catch (err) {
        // Ignorer les erreurs lors de la fermeture
      }
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    welcomeShownRef.current = false; // Réinitialiser pour la prochaine connexion
  }, []);

  // Effacer la sortie
  const clear = useCallback(() => {
    setOutput('');
    bufferRef.current = '';
  }, []);

  // Reconnexion
  const reconnect = useCallback(() => {
    close();
    welcomeShownRef.current = false; // Réinitialiser pour la nouvelle connexion
    // Attendre un court délai avant de reconnecter
    setTimeout(() => {
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        connect();
      } else {
        setError('Max reconnection attempts reached');
      }
    }, 1000);
  }, [close, connect]);

  // Connexion automatique au montage
  useEffect(() => {
    // En mode Electron packaged, attendre un peu pour laisser le serveur démarrer
    const isElectronEnv = typeof window !== 'undefined' && window.process && window.process.type === 'renderer';
    const initialDelay = isElectronEnv ? 2000 : 0; // Attendre 2s en Electron
    
    const timer = setTimeout(() => {
      connect();
    }, initialDelay);
    
    return () => {
      clearTimeout(timer);
      close();
    };
  }, [connect, close]);

  // Gérer le redimensionnement de la fenêtre
  useEffect(() => {
    const handleResize = () => {
      // Pour l'instant, on ne fait rien automatiquement
      // Le composant TerminalPanel devra appeler resize explicitement
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const state: TerminalState = {
    isConnected,
    output,
    error,
    isConnecting,
  };

  const actions: TerminalActions = {
    sendInput,
    resize,
    close,
    clear,
    reconnect,
  };

  return [state, actions];
}

export default useTerminal;
