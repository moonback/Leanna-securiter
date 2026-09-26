import React, { useEffect, useRef, useCallback, useState, memo, forwardRef, useImperativeHandle } from 'react';
import { X, Terminal, Maximize, Minimize, Plus, ChevronDown, ChevronLeft, ChevronRight, Search, Trash2, Pencil, Copy, Check, AlertCircle, Server, Command, Folder, Box } from 'lucide-react';
import { useTerminal } from '../../hooks/useTerminal.js';
import { motion, AnimatePresence } from 'motion/react';
import { ideApi } from '../../services/ideApi.js';
import { sandboxApi } from '../../services/sandboxApi.js';

type ExecutionMode = 'workspace' | 'sandbox';

interface TerminalPanelProps {
  onClose: () => void;
  isDocked?: boolean;
  onToggleDock?: () => void;
  onOpenBrowser?: (url: string) => void;
  showExplorer?: boolean;
  devServerPort?: number;
  initialCwd?: string;
}

// Référence pour contrôler le terminal depuis l'extérieur
export interface TerminalPanelHandle {
  executeCommand: (command: string) => void;
  clearTerminal: () => void;
  addTab: () => void;
  closeTab: (tabId?: string) => void;
  focus: () => void;
  getActiveTabId: () => string | null;
  getTabs: () => TerminalTab[];
}

// Types pour les onglets
export interface TerminalTab {
  id: string;
  title: string;
  shell: string;
  cwd: string;
}

// Commande favorite
interface FavoriteCommand {
  id: string;
  name: string;
  command: string;
  description: string;
  createdAt: number;
  usageCount: number;
}

// Options de shell
const SHELL_OPTIONS = [
  { value: 'PowerShell', label: 'PowerShell', command: 'pwsh.exe' },
  { value: 'cmd', label: 'CMD', command: 'cmd.exe' },
  { value: 'Git Bash', label: 'Git Bash', command: 'C:\\Program Files\\Git\\bin\\bash.exe' },
];

// Commandes par défaut
const DEFAULT_COMMANDS = [
  { name: 'npm run dev', command: 'npm run dev', description: 'Démarrer le serveur de développement' },
  { name: 'npm install', command: 'npm install', description: 'Installer les dépendances' },
  { name: 'npm run build', command: 'npm run build', description: 'Builder le projet' },
  { name: 'npm test', command: 'npm test', description: 'Exécuter les tests' },
  { name: 'git status', command: 'git status', description: 'Voir le statut Git' },
  { name: 'git pull', command: 'git pull', description: 'Mettre à jour depuis remote' },
  { name: 'clear', command: 'clear', description: 'Effacer le terminal' },
  { name: 'ls', command: 'ls', description: 'Lister les fichiers' },
  { name: 'pwd', command: 'pwd', description: 'Afficher le répertoire courant' },
  { name: 'cd ..', command: 'cd ..', description: 'Remonter d\'un répertoire' },
];

// Charger les commandes favorites depuis localStorage
const loadFavoriteCommands = (): FavoriteCommand[] => {
  try {
    const saved = localStorage.getItem('terminal_favorite_commands');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Sauvegarder les commandes favorites dans localStorage
const saveFavoriteCommands = (commands: FavoriteCommand[]) => {
  try {
    localStorage.setItem('terminal_favorite_commands', JSON.stringify(commands));
  } catch {
    // Ignorer les erreurs de sauvegarde
  }
};

// Formattage des couleurs ANSI avec le thème de l'app
function formatAnsiText(text: string): React.ReactNode {
  // Mapping des couleurs ANSI aux couleurs de l'app
  const ansiColors: Record<string, string> = {
    // Couleurs standard
    '0': 'var(--text-primary)',      // Noir -> texte primaire
    '1': 'var(--color-error)',        // Rouge
    '2': 'var(--color-success)',      // Vert
    '3': 'var(--color-warning)',      // Jaune
    '4': 'var(--color-info)',         // Bleu
    '5': 'var(--color-accent-alt)',   // Magenta
    '6': 'var(--color-info)',         // Cyan
    '7': 'var(--text-primary)',       // Blanc
    // Couleurs claires
    '8': 'var(--text-muted)',          // Noir clair
    '9': 'var(--color-error)',        // Rouge clair
    '10': 'var(--color-success)',      // Vert clair
    '11': 'var(--color-warning)',      // Jaune clair
    '12': 'var(--color-info)',         // Bleu clair
    '13': 'var(--color-accent-alt)',   // Magenta clair
    '14': 'var(--color-success)',      // Cyan clair
    '15': 'var(--text-primary)',       // Blanc clair
    // Couleurs 256 (extension)
    '30': 'var(--text-primary)',
    '31': 'var(--color-error)',
    '32': 'var(--color-success)',
    '33': 'var(--color-warning)',
    '34': 'var(--color-info)',
    '35': 'var(--color-accent-alt)',
    '36': 'var(--color-info)',
    '37': 'var(--text-primary)',
    '90': 'var(--text-muted)',
    '91': 'var(--color-error)',
    '92': 'var(--color-success)',
    '93': 'var(--color-warning)',
    '94': 'var(--color-info)',
    '95': 'var(--color-accent-alt)',
    '96': 'var(--color-info)',
  };

  const styles: Record<string, React.CSSProperties> = {
    '0': {}, // Reset
    '1': { fontWeight: '600' }, // Bold
    '2': { fontWeight: '300' }, // Dim
    '3': { fontStyle: 'italic' }, // Italic
    '4': { textDecoration: 'underline' }, // Underline
    '5': { textDecoration: 'line-through' }, // Blink (simulé)
    '7': { backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }, // Inverse
    '8': { visibility: 'hidden' }, // Hidden
  };

  const parts = text.split(/(\x1b\[[0-9;]*m)/);
  let currentStyle: React.CSSProperties = {};
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part?.startsWith('\x1b[') && part.endsWith('m')) {
      const code = part.slice(2, -1);
      const codes = code.split(';');
      for (const c of codes) {
        if (c === '0') {
          currentStyle = {};
        } else if (ansiColors[c]) {
          currentStyle.color = ansiColors[c];
        } else if (styles[c]) {
          currentStyle = { ...currentStyle, ...styles[c] };
        }
      }
    } else if (part) {
      elements.push(Object.keys(currentStyle).length > 0 ?
        <span key={i} style={currentStyle}>{part}</span> : part);
    }
  }
  return <>{elements}</>;
}

// Composant pour la barre de recherche
interface SearchBarProps {
  onSearch: (query: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  matchCount: number;
  currentMatch: number;
}

const SearchBar: React.FC<SearchBarProps> = memo(({ onSearch, onClose, onNext, onPrev, matchCount, currentMatch }) => {
  const [query, setQuery] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSearch(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (matchCount > 0) {
        onNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onNext();
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      backgroundColor: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-base)',
      borderTop: '1px solid var(--border-base)',
    }}>
      <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Rechercher dans le terminal..."
        autoFocus
        style={{
          flex: 1,
          border: 'none',
          background: 'transparent',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
      {matchCount > 0 && (
        <span style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}>
          {currentMatch + 1}/{matchCount}
        </span>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        <button
          onClick={onPrev}
          disabled={currentMatch <= 0}
          title="Précédent (Flèche haut)"
          style={{
            padding: 'var(--space-1)',
            border: 'none',
            background: 'transparent',
            color: currentMatch <= 0 ? 'var(--text-dimmed)' : 'var(--text-muted)',
            cursor: currentMatch <= 0 ? 'not-allowed' : 'pointer',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => {
            if (currentMatch > 0) {
              (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
            }
          }}
          onMouseLeave={e => {
            if (currentMatch > 0) {
              (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
            }
          }}
        >
          <ChevronLeft size={12} />
        </button>
        <button
          onClick={onNext}
          disabled={currentMatch >= matchCount - 1}
          title="Suivant (Flèche bas)"
          style={{
            padding: 'var(--space-1)',
            border: 'none',
            background: 'transparent',
            color: currentMatch >= matchCount - 1 ? 'var(--text-dimmed)' : 'var(--text-muted)',
            cursor: currentMatch >= matchCount - 1 ? 'not-allowed' : 'pointer',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => {
            if (currentMatch < matchCount - 1) {
              (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
            }
          }}
          onMouseLeave={e => {
            if (currentMatch < matchCount - 1) {
              (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
            }
          }}
        >
          <ChevronRight size={12} />
        </button>
      </div>
      <button
        onClick={onClose}
        title="Fermer (Échap)"
        style={{
          padding: 'var(--space-1)',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
        }}
        onMouseEnter={e => {
          (e.target as HTMLButtonElement).style.color = 'var(--color-error)';
          (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-error-subtle)';
        }}
        onMouseLeave={e => {
          (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
          (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
});

// Composant pour un onglet individuel
interface TerminalTabPanelProps {
  tab: TerminalTab;
  isActive: boolean;
  onSendInput: (input: string) => void;
  onClear: () => void;
  onRename: (newTitle: string) => void;
  cwd: string;
  onRegisterRef?: (tabId: string, ref: { executeCommand: (cmd: string) => void; clear: () => void; focus: () => void } | null) => void;
  onOpenBrowser?: (url: string) => void;
  devServerPort?: number;
}

const TerminalTabPanel: React.FC<TerminalTabPanelProps> = memo(({ tab, isActive, onSendInput, onClear, onRename, cwd, onRegisterRef, onOpenBrowser, devServerPort }) => {
  const [state, actions] = useTerminal(120, 40);
  const { isConnected, output, error, isConnecting } = state;
  const { sendInput, close: closeConnection, clear: clearTerminal } = actions;

  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.title);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Détecter le port du serveur dev à partir du package.json
  const detectDevPort = useCallback(async (): Promise<number> => {
    if (!cwd) return devServerPort ?? 5173;
    
    try {
      const packageJsonPath = `${cwd}/package.json`;
      const content = await ideApi.readFile(packageJsonPath);
      const pkg = JSON.parse(content);
      
      // Vérifier les scripts pour un port personnalisé
      const devScript = pkg.scripts?.dev || pkg.scripts?.['npm run dev'] || pkg.scripts?.start || '';
      
      // Extraire le port de la commande (ex: "vite dev --port 5173" ou "next dev -p 3000")
      const portMatch = devScript.match(/--port\s+(\d+)|-p\s+(\d+)/);
      if (portMatch) {
        return Number(portMatch[1] || portMatch[2]);
      }
      
      // Ports par défaut selon le framework
      if (devScript.includes('vite') || devScript.includes('vite-dev-server')) {
        return 5173;
      }
      if (devScript.includes('next') || devScript.includes('next dev')) {
        return 3000;
      }
      if (devScript.includes('react-scripts') || devScript.includes('start')) {
        return 3000;
      }
      
      return devServerPort ?? 5173;
    } catch {
      // Si package.json n'existe pas ou ne peut pas être lu, utiliser le port par défaut
      return devServerPort ?? 5173;
    }
  }, [cwd, devServerPort]);

  // Ouvrir le navigateur avec le port détecté
  const openDevServerBrowser = useCallback(async (command: string) => {
    const trimmed = command.trim().toLowerCase();
    const serverCommands = ['npm run dev', 'npm start', 'npm run serve', 'npm run preview'];
    if (serverCommands.some(cmd => trimmed.includes(cmd)) && onOpenBrowser) {
      const port = await detectDevPort();
      setTimeout(() => onOpenBrowser(`http://localhost:${port}`), 2000);
    }
  }, [onOpenBrowser, detectDevPort]);

  // Exposer les méthodes pour ce tab
  const executeCommandRef = useCallback((command: string) => {
    if (isConnected && isActive) {
      const trimmed = command.trim();
      if (trimmed) {
        sendInput(trimmed);
        onSendInput(trimmed);
        // Détecter et ouvrir le navigateur pour les commandes serveur
        openDevServerBrowser(trimmed);
      }
    }
  }, [isConnected, isActive, sendInput, onSendInput, openDevServerBrowser]);

  const clearRef = useCallback(() => {
    clearTerminal();
    setNotification({ type: 'success', message: 'Terminal effacé' });
    onClear();
  }, [clearTerminal, onClear]);

  const focusRef = useCallback(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  // S'enregistrer auprès du parent
  useEffect(() => {
    if (onRegisterRef) {
      const ref = { executeCommand: executeCommandRef, clear: clearRef, focus: focusRef };
      onRegisterRef(tab.id, ref);
      return () => onRegisterRef(tab.id, null);
    }
    return undefined;
  }, [tab.id, onRegisterRef, executeCommandRef, clearRef, focusRef]);

  // Fermer la connexion quand l'onglet devient inactif
  useEffect(() => {
    if (!isActive) {
      closeConnection();
    }
  }, [isActive, closeConnection]);

  // Envoyer cd vers le bon répertoire quand le terminal se connecte
  const cdSentRef = useRef(false);
  
  // Réinitialiser cdSentRef quand cwd change
  useEffect(() => {
    cdSentRef.current = false;
  }, [cwd]);
  
  useEffect(() => {
    if (isConnected && isActive && cwd && !cdSentRef.current) {
      cdSentRef.current = true;
      // Utiliser cd avec le chemin absolu
      const escapedCwd = cwd.replace(/\\/g, '/');
      setTimeout(() => {
        sendInput(`cd "${escapedCwd}"`);
      }, 500); // Petit délai pour laisser le temps au terminal de s'initialiser
    }
  }, [isConnected, isActive, cwd, sendInput]);

  useEffect(() => {
    if (isActive && isConnected && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive, isConnected]);

  useEffect(() => {
    if (isActive) {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [output, isActive]);

  // Gérer les notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [notification]);

  const handleSendInput = useCallback((input: string) => {
    if (isConnected && isActive) {
      const trimmed = input.trim();
      if (trimmed) {
        sendInput(trimmed);
        onSendInput(trimmed);
        setHistory(prev => [...prev, trimmed]);
        setHistoryIndex(-1);
        // Détecter et ouvrir le navigateur pour les commandes serveur
        openDevServerBrowser(trimmed);
      }
    }
  }, [isConnected, isActive, sendInput, onSendInput, openDevServerBrowser]);

  const handleClearTerminal = useCallback(() => {
    clearTerminal();
    setNotification({ type: 'success', message: 'Terminal effacé' });
    onClear();
  }, [clearTerminal, onClear]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const command = inputValue.trim();
      if (command && isConnected) {
        setHistory(prev => [...prev, command]);
        setHistoryIndex(-1);
        handleSendInput(command);
        setInputValue('');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setInputValue(history[newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > -1) {
        const newIndex = Math.max(historyIndex - 1, -1);
        setHistoryIndex(newIndex);
        setInputValue(newIndex === -1 ? '' : history[newIndex]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      handleClearTerminal();
    } else if (e.key === 'c' && e.ctrlKey) {
      // Copier la sélection
      navigator.clipboard.writeText(window.getSelection()?.toString() || '');
    } else if (e.key === 'v' && e.ctrlKey) {
      // Coller
      navigator.clipboard.readText().then(text => {
        setInputValue(prev => prev + text);
      });
    }
  }, [inputValue, isConnected, handleSendInput, history, historyIndex, handleClearTerminal]);

  const handleRename = useCallback(() => {
    setIsRenaming(true);
    setRenameValue(tab.title);
  }, [tab.title]);

  const handleRenameSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim()) {
      onRename(renameValue.trim());
      setIsRenaming(false);
    }
  }, [renameValue, onRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsRenaming(false);
      setRenameValue(tab.title);
    }
  }, [tab.title]);

  // Copier le texte sélectionné
  const handleCopy = useCallback(() => {
    const selection = window.getSelection()?.toString();
    if (selection) {
      navigator.clipboard.writeText(selection);
      setNotification({ type: 'success', message: 'Copié dans le presse-papier' });
    }
  }, []);

  const lines = output.split('\n').filter(line => line !== '');

  if (!isActive) return null;

  return (
    <div
      ref={containerRef}
      data-tab-id={tab.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--bg-base)',
        overflow: 'hidden',
      }}
      onCopy={e => {
        const selection = window.getSelection()?.toString();
        if (selection) {
          e.clipboardData.setData('text/plain', selection);
          e.preventDefault();
        }
      }}
    >
      {/* Barre d'info - CWD */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-base)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        overflow: 'hidden',
        width: '100%',
      }}>
        <Server size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tab.shell} - {cwd || '~'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {isConnected ? (
            <span style={{ color: 'var(--color-success)', fontSize: '8px' }}>● Connected</span>
          ) : isConnecting ? (
            <span style={{ color: 'var(--color-warning)', fontSize: '8px' }}>○ Connecting...</span>
          ) : (
            <span style={{ color: 'var(--color-error)', fontSize: '8px' }}>● Disconnected</span>
          )}
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} style={{ display: 'flex', gap: 'var(--space-1)' }}>
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                autoFocus
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  border: '1px solid var(--border-focus)',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                title="Valider"
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-success)',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                onClick={() => { setIsRenaming(false); setRenameValue(tab.title); }}
                title="Annuler"
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-error)',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <X size={12} />
              </button>
            </form>
          ) : (
            <>
              <button
                onClick={handleRename}
                title="Renommer"
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                }}
                onMouseEnter={e => {
                  (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={e => {
                  (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
                  (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={handleCopy}
                title="Copier la sélection (Ctrl+C)"
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={e => {
                  (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={e => {
                  (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
                  (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
              >
                <Copy size={12} />
              </button>
              <button
                onClick={handleClearTerminal}
                title="Effacer (Ctrl+L)"
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={e => {
                  (e.target as HTMLButtonElement).style.color = 'var(--color-warning)';
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-warning-subtle)';
                }}
                onMouseLeave={e => {
                  (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
                  (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </span>
      </div>

      {/* Zone de sortie du terminal */}
      <div
        style={{
          flex: 1,
          width: '100%',
          overflowY: 'auto',
          padding: 'var(--space-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          lineHeight: 'var(--leading-normal)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--text-primary)',
          userSelect: 'text',
          textAlign: 'left',
          backgroundColor: 'var(--bg-panel)',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {output === '' && !isConnecting && !isConnected ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}>
            {isConnecting ? 'Connexion au terminal...' : 'Terminal prêt. Tapez une commande et appuyez sur Entrée.'}
          </div>
        ) : (
          lines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 100)}`} style={{ minHeight: '1.5em', textAlign: 'left' }}>
              {formatAnsiText(line.trimEnd())}
            </div>
          ))
        )}
        {error && (
          <div style={{
            color: 'var(--color-error)',
            marginTop: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'var(--color-error-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-mono)',
            borderLeft: '3px solid var(--color-error)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}>
            <AlertCircle size={14} />
            <span>Erreur: {error}</span>
          </div>
        )}
        <div ref={outputEndRef} />
      </div>

      {/* Barre de notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: notification.type === 'success' ? 'var(--color-success-subtle)' :
                               notification.type === 'error' ? 'var(--color-error-subtle)' : 'var(--color-info-subtle)',
              color: notification.type === 'success' ? 'var(--color-success)' :
                     notification.type === 'error' ? 'var(--color-error)' : 'var(--color-info)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              borderTop: '1px solid var(--border-base)',
            }}
          >
            {notification.type === 'success' && <Check size={12} />}
            {notification.type === 'error' && <AlertCircle size={12} />}
            {notification.type === 'info' && <Command size={12} />}
            <span>{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barre d'entrée */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: 'var(--space-2) var(--space-3)',
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-base)',
        gap: 'var(--space-2)',
        width: '100%',
      }}>
        <span style={{
          color: 'var(--accent-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          {tab.title}
        </span>
        <span style={{
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          whiteSpace: 'nowrap',
        }}>
          {cwd || '~'}
        </span>
        <span style={{
          color: isConnected ? 'var(--color-success)' : isConnecting ? 'var(--color-warning)' : 'var(--color-error)',
          fontSize: 'var(--text-sm)',
        }}>
          {isConnected ? '✓' : isConnecting ? '⏳' : '✗'}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          disabled={!isConnected || isConnecting}
          placeholder={!isConnected ? 'Connexion...' : 'Tapez une commande...'}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
            outline: 'none',
            caretColor: 'var(--accent-primary)',
          }}
        />
        {inputValue && (
          <button
            onClick={() => { setInputValue(''); setHistoryIndex(-1); }}
            title="Effacer l'entrée"
            style={{
              padding: 'var(--space-1)',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => {
              (e.target as HTMLButtonElement).style.color = 'var(--color-error)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-error-subtle)';
            }}
            onMouseLeave={e => {
              (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

// Composant principal
const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(({ onClose, isDocked, onOpenBrowser, showExplorer, devServerPort, initialCwd }, ref) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: '1', title: 'Terminal 1', shell: 'PowerShell', cwd: initialCwd ?? '' }]);
  const [activeTabId, setActiveTabId] = useState<string>('1');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShellSelector, setShowShellSelector] = useState(false);
  const [showExecutionModeSelector, setShowExecutionModeSelector] = useState(false);
  const [favoriteCommands, setFavoriteCommands] = useState<FavoriteCommand[]>(loadFavoriteCommands());
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [showSearch, setShowSearch] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('workspace');
  const [sandboxPath, setSandboxPath] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const tabPanelRefs = useRef<Map<string, { executeCommand: (cmd: string) => void; clear: () => void; focus: () => void }>>(new Map());

  // Sauvegarder les commandes favorites quand elles changent
  useEffect(() => {
    saveFavoriteCommands(favoriteCommands);
  }, [favoriteCommands]);

  // Récupérer le chemin du sandbox
  useEffect(() => {
    const fetchSandboxPath = async () => {
      try {
        const status = await sandboxApi.getStatus(true);
        if (status.sandbox?.active && (status.sandbox?.path || status.sandbox?.root)) {
          setSandboxPath(status.sandbox.path || status.sandbox.root || null);
        } else {
          setSandboxPath(null);
        }
      } catch {
        setSandboxPath(null);
      }
    };
    fetchSandboxPath();

    // Rafraîchir quand le sandbox change
    const handleSandboxChange = () => {
      fetchSandboxPath();
    };
    window.addEventListener('Leanna-sandbox-changed', handleSandboxChange);
    window.addEventListener('Leanna-sandbox-file-changed', handleSandboxChange);
    
    return () => {
      window.removeEventListener('Leanna-sandbox-changed', handleSandboxChange);
      window.removeEventListener('Leanna-sandbox-file-changed', handleSandboxChange);
    };
  }, []);

  // Gérer le scroll horizontal des onglets avec la molette
  useEffect(() => {
    const tabContainer = tabContainerRef.current;
    if (!tabContainer) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        tabContainer.scrollLeft += e.deltaX;
      }
    };

    tabContainer.addEventListener('wheel', handleWheel, { passive: false });
    return () => tabContainer.removeEventListener('wheel', handleWheel);
  }, []);

  // Obtenir le cwd actuel selon le mode d'exécution
  const getCurrentCwd = useCallback((): string => {
    if (executionMode === 'sandbox' && sandboxPath) {
      return sandboxPath;
    }
    return initialCwd ?? '';
  }, [executionMode, sandboxPath, initialCwd]);

  const addTab = useCallback(() => {
    const newId = String(Date.now());
    const cwd = getCurrentCwd();
    setTabs(prev => [...prev, { id: newId, title: `Terminal ${prev.length + 1}`, shell: 'PowerShell', cwd }]);
    setActiveTabId(newId);
  }, [tabs.length, getCurrentCwd]);

  const closeTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (tabs.length <= 1) return;
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0]?.id || '1');
    }
  }, [tabs, activeTabId]);

  // Changer le mode d'exécution et mettre à jour le cwd des onglets
  const handleExecutionModeChange = useCallback((mode: ExecutionMode) => {
    setExecutionMode(mode);
    setShowExecutionModeSelector(false);
    
    // Mettre à jour le cwd de tous les onglets
    const newCwd = mode === 'sandbox' && sandboxPath ? sandboxPath : initialCwd ?? '';
    setTabs(prev => prev.map(tab => ({ ...tab, cwd: newCwd })));
  }, [sandboxPath, initialCwd]);

  // Exposer les méthodes publiques via la ref
  useImperativeHandle(ref, () => ({
    executeCommand: (command: string) => {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        const tabRef = tabPanelRefs.current.get(activeTab.id);
        if (tabRef) {
          tabRef.executeCommand(command);
        }
      }
    },
    clearTerminal: () => {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        const tabRef = tabPanelRefs.current.get(activeTab.id);
        if (tabRef) {
          tabRef.clear();
        }
      }
    },
    addTab,
    closeTab: (tabId?: string) => {
      if (tabId) {
        closeTab(tabId);
      } else if (tabs.length > 1) {
        closeTab(activeTabId);
      }
    },
    focus: () => {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        const tabRef = tabPanelRefs.current.get(activeTab.id);
        if (tabRef) {
          tabRef.focus();
        }
      }
    },
    getActiveTabId: () => activeTabId,
    getTabs: () => tabs,
  }), [tabs, activeTabId, addTab, closeTab]);

  const toggleFullscreen = useCallback(() => setIsFullscreen(prev => !prev), []);
  const toggleMinimize = useCallback(() => setIsMinimized(prev => !prev), []);

  const handleShellChange = useCallback((shell: string) => {
    setTabs(prev => prev.map(tab =>
      activeTabId === tab.id ? { ...tab, shell } : tab
    ));
    setShowShellSelector(false);
  }, [activeTabId]);

  const getActiveTab = useCallback(() => {
    return tabs.find(tab => tab.id === activeTabId);
  }, [tabs, activeTabId]);

  const updateTabCwd = useCallback((tabId: string, cwd: string) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, cwd } : tab
    ));
  }, []);

  const renameTab = useCallback((tabId: string, newTitle: string) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, title: newTitle } : tab
    ));
  }, []);

  // Gérer l'enregistrement des refs des tabs
  const handleRegisterRef = useCallback((tabId: string, ref: { executeCommand: (cmd: string) => void; clear: () => void; focus: () => void } | null) => {
    if (ref) {
      tabPanelRefs.current.set(tabId, ref);
    } else {
      tabPanelRefs.current.delete(tabId);
    }
  }, []);

  const handleCommandSent = useCallback((command: string) => {
    // La détection du port et l'ouverture du navigateur est gérée dans TerminalTabPanel
    // qui a accès au cwd du projet

    // Ajouter à l'historique des commandes favorites
    setFavoriteCommands(prev => {
      const existingIndex = prev.findIndex(c => c.command === command);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          usageCount: updated[existingIndex].usageCount + 1,
          createdAt: Date.now(),
        };
        return updated.sort((a, b) => b.usageCount - a.usageCount || b.createdAt - a.createdAt);
      } else {
        const newCommand: FavoriteCommand = {
          id: String(Date.now()),
          name: command.split(' ')[0] || command,
          command,
          description: '',
          createdAt: Date.now(),
          usageCount: 1,
        };
        return [newCommand, ...prev].slice(0, 20); // Garder max 20 commandes
      }
    });
  }, []);

  const removeFromFavorites = useCallback((id: string) => {
    setFavoriteCommands(prev => prev.filter(c => c.id !== id));
  }, []);

  // Navigation entre onglets avec Ctrl+Tab et Ctrl+Shift+Tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ne pas traiter les raccourcis si le conteneur n'existe pas ou n'est pas visible
      const container = containerRef.current;
      if (!container || !container.offsetParent) return;
      
      // Ne pas interférer si l'utilisateur tape dans un champ éditable (Monaco, input, textarea)
      const activeElement = document.activeElement;
      const isInEditable = activeElement?.hasAttribute?.('contenteditable') ||
                          activeElement?.tagName === 'INPUT' ||
                          activeElement?.tagName === 'TEXTAREA';
      if (isInEditable) return;
      
      // Ctrl+T - Nouveau onglet
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        addTab();
      }
      // Ctrl+W - Fermer onglet
      if (e.ctrlKey && e.key === 'w' && tabs.length > 1) {
        e.preventDefault();
        closeTab(activeTabId);
      }
      // Ctrl+Tab - Onglet suivant
      if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTabId(tabs[nextIndex].id);
      }
      // Ctrl+Shift+Tab - Onglet précédent
      if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        setActiveTabId(tabs[prevIndex].id);
      }
      // Ctrl+F - Rechercher dans le terminal
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
      // Échap - Fermer la recherche (toujours autorisé si la recherche est ouverte)
      if (e.key === 'Escape' && showSearch) {
        e.preventDefault();
        setShowSearch(false);
        setSearchMatches([]);
        setCurrentMatchIndex(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addTab, closeTab, tabs, activeTabId, showSearch]);

  // Recherche dans le terminal
  const handleSearch = useCallback((query: string) => {
    if (query === '') {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  }, []);

  const handleNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex(prev => (prev + 1) % searchMatches.length);
  }, [searchMatches]);

  const handlePrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex(prev => (prev - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches]);

  const activeTab = getActiveTab();

  return (
    <motion.div
      className="terminal-panel"
      ref={containerRef}
      style={{
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-base)',
        borderRadius: isFullscreen ? '0' : isMinimized ? 'var(--radius-md) var(--radius-md) 0 0' : isDocked ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        height: isMinimized ? 'auto' : isFullscreen ? '100vh' : isDocked ? '40vh' : '60vh',
        width: isFullscreen ? '100vw' : isMinimized ? (showExplorer ? 'calc(100vw - 316px)' : 'calc(100vw - 56px)') : isDocked ? (showExplorer ? 'calc(100vw - 316px)' : 'calc(100vw - 56px)') : '70vw',
        minHeight: isMinimized ? '0' : isDocked ? '200px' : '400px',
        maxHeight: isMinimized ? '40px' : isFullscreen ? 'none' : isDocked ? '70vh' : '80vh',
        position: 'fixed',
        top: isFullscreen ? 0 : isMinimized ? undefined : isDocked ? undefined : '50%',
        right: isFullscreen ? 0 : isMinimized ? '0' : isDocked ? '0' : undefined,
        left: isFullscreen ? 0 : isMinimized ? (showExplorer ? '316px' : '56px') : isDocked ? (showExplorer ? '316px' : '56px') : '50%',
        bottom: isFullscreen ? 0 : isMinimized ? '0' : isDocked ? '0' : undefined,
        zIndex: 'var(--z-terminal)' as any,
        boxShadow: isFullscreen ? 'none' : isMinimized ? '0 4px 12px rgba(0, 0, 0, 0.3)' : isDocked ? '0 -4px 20px rgba(0, 0, 0, 0.3)' : '0 4px 20px rgba(0, 0, 0, 0.3)',
        transform: isMinimized ? 'none' : isDocked ? 'none' : 'translate(-50%, -50%)',
        resize: isDocked ? 'vertical' : 'none',
        overflow: 'hidden',
        maxWidth: isFullscreen ? '100vw' : '100%',
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
    >

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-3)',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-base)',
          borderTopLeftRadius: isFullscreen ? 0 : isMinimized ? 'var(--radius-md)' : 'var(--radius-lg)',
          borderTopRightRadius: isFullscreen ? 0 : isMinimized ? 'var(--radius-md)' : 'var(--radius-lg)',
          gap: 'var(--space-2)',
          cursor: isMinimized ? 'pointer' : 'default',
          width: '100%',
        }}
        onClick={isMinimized ? toggleMinimize : undefined}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Terminal size={16} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>
            Terminal{isMinimized ? ' (minimisé)' : sandboxPath ? ` (${executionMode === 'sandbox' ? 'Sandbox' : 'Workspace'})` : ''}
          </span>
        </div>

        {/* Barre d'onglets - avec scroll horizontal */}
        <div
          ref={tabContainerRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--scroll-thumb) transparent',
            padding: 'var(--space-1) 0',
          }}
        >
          {tabs.map((tab, index) => (
            <motion.div
              key={tab.id}
              onClick={() => !isMinimized && setActiveTabId(tab.id)}
              onDoubleClick={() => !isMinimized && renameTab(tab.id, `Terminal ${index + 1}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-1) var(--space-3)',
                border: 'none',
                background: activeTabId === tab.id ? 'var(--bg-hover)' : 'transparent',
                color: activeTabId === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: isMinimized ? 'default' : 'pointer',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)',
                minWidth: 0,
                opacity: isMinimized ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
              whileHover={!isMinimized ? { background: 'var(--bg-hover)' } : {}}
              whileTap={!isMinimized ? { scale: 0.95 } : {}}
              role="button"
              tabIndex={isMinimized ? -1 : 0}
              onKeyDown={e => {
                if (!isMinimized && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setActiveTabId(tab.id);
                }
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</span>
              <button
                onClick={(e) => closeTab(tab.id, e)}
                title="Fermer l'onglet (Ctrl+W)"
                aria-label="Close tab"
                disabled={tabs.length <= 1}
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: tabs.length <= 1 ? 'var(--text-dimmed)' : 'var(--text-muted)',
                  cursor: tabs.length <= 1 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-xs)',
                }}
                onMouseEnter={e => {
                  if (tabs.length > 1) {
                    (e.target as HTMLButtonElement).style.color = 'var(--color-danger)';
                    (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-error-subtle)';
                  }
                }}
                onMouseLeave={e => {
                  if (tabs.length > 1) {
                    (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
                    (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                  }
                }}
              >
                <X size={12} />
              </button>
            </motion.div>
          ))}
          <button
            onClick={() => !isMinimized && addTab()}
            title="Nouvel onglet (Ctrl+T)"
            style={{
              padding: 'var(--space-1) var(--space-2)',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: isMinimized ? 'default' : 'pointer',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isMinimized ? 0.5 : 1,
              fontSize: 'var(--text-sm)',
            }}
            onMouseEnter={e => {
              if (!isMinimized) {
                (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
                (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={e => {
              if (!isMinimized) {
                (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
                (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
              }
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          {/* Sélecteur de shell */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => !isMinimized && setShowShellSelector(!showShellSelector)}
              title="Changer de shell"
              style={{
                padding: 'var(--space-1)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: isMinimized ? 'default' : 'pointer',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isMinimized ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              }}
            >
              <Terminal size={14} />
              <ChevronDown size={10} />
            </button>
            <AnimatePresence>
              {showShellSelector && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    zIndex: 'var(--z-dropdown)' as any,
                    minWidth: '160px',
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border-base)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    padding: 'var(--space-1)',
                  }}
                >
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {SHELL_OPTIONS.map((shell, i) => {
                      const activeShell = activeTab?.shell || 'PowerShell';
                      const isActive = activeShell === shell.value;
                      return (
                        <button
                          key={i}
                          onClick={() => handleShellChange(shell.value)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            padding: 'var(--space-2) var(--space-3)',
                            border: 'none',
                            background: isActive ? 'var(--bg-hover)' : 'transparent',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-sm)',
                            textAlign: 'left',
                          }}
                          onMouseEnter={e => {
                            if (!isActive) {
                              (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
                            }
                          }}
                          onMouseLeave={e => {
                            if (!isActive) {
                              (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                            }
                          }}
                          title={shell.label}
                        >
                          <span>{shell.label}</span>
                          {isActive && (
                            <span style={{ marginLeft: 'auto', color: 'var(--color-success)' }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sélecteur de mode d'exécution (Workspace/Sandbox) */}
          {sandboxPath && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => !isMinimized && setShowExecutionModeSelector(!showExecutionModeSelector)}
                title={`Mode d'exécution: ${executionMode === 'workspace' ? 'Workspace réel' : 'Sandbox'}`}
                style={{
                  padding: 'var(--space-1)',
                  border: 'none',
                  background: 'transparent',
                  color: executionMode === 'workspace' ? 'var(--text-muted)' : 'var(--color-success)',
                  cursor: isMinimized ? 'default' : 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isMinimized ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
                }}
                onMouseLeave={e => {
                  if (!isMinimized) (e.target as HTMLButtonElement).style.color = executionMode === 'workspace' ? 'var(--text-muted)' : 'var(--color-success)';
                }}
              >
                {executionMode === 'workspace' ? <Folder size={14} /> : <Box size={14} />}
                <ChevronDown size={10} />
              </button>
              <AnimatePresence>
                {showExecutionModeSelector && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      zIndex: 'var(--z-dropdown)' as any,
                      minWidth: '160px',
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-base)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-lg)',
                      padding: 'var(--space-1)',
                    }}
                  >
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {[
                        { value: 'workspace' as ExecutionMode, label: 'Workspace réel', icon: <Folder size={14} /> },
                        { value: 'sandbox' as ExecutionMode, label: 'Sandbox', icon: <Box size={14} /> },
                      ].map((mode, i) => {
                        const isActive = executionMode === mode.value;
                        return (
                          <button
                            key={i}
                            onClick={() => handleExecutionModeChange(mode.value)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-2)',
                              padding: 'var(--space-2) var(--space-3)',
                              border: 'none',
                              background: isActive ? 'var(--bg-hover)' : 'transparent',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 'var(--text-sm)',
                              textAlign: 'left',
                            }}
                            onMouseEnter={e => {
                              if (!isActive) {
                                (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)';
                              }
                            }}
                            onMouseLeave={e => {
                              if (!isActive) {
                                (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                              }
                            }}
                            title={mode.label}
                          >
                            {mode.icon}
                            <span>{mode.label}</span>
                            {isActive && (
                              <span style={{ marginLeft: 'auto', color: 'var(--color-success)' }}>✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Bouton commandes */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => !isMinimized && setShowCommandPalette(!showCommandPalette)}
              title="Commandes favorites"
              style={{
                padding: 'var(--space-1)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: isMinimized ? 'default' : 'pointer',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isMinimized ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--accent-primary)';
              }}
              onMouseLeave={e => {
                if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              }}
            >
              <Command size={14} />
            </button>
            <AnimatePresence>
              {showCommandPalette && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    zIndex: 'var(--z-dropdown)' as any,
                    minWidth: '280px',
                    maxWidth: '400px',
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border-base)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    padding: 'var(--space-2)',
                  }}
                >
                  {/* Section Favorites */}
                  {favoriteCommands.length > 0 && (
                    <>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 var(--space-1) var(--space-2)',
                        borderBottom: '1px solid var(--border-base)',
                        marginBottom: 'var(--space-2)',
                      }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                          Commandes favorites
                        </span>
                      </div>
                      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {favoriteCommands.slice(0, 5).map((cmd) => (
                          <button
                            key={cmd.id}
                            onClick={() => {
                              const tabRef = tabPanelRefs.current.get(activeTabId);
                              if (tabRef) {
                                tabRef.executeCommand(cmd.command);
                              }
                              setShowCommandPalette(false);
                            }}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-2)',
                              padding: 'var(--space-2)',
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 'var(--text-sm)',
                              textAlign: 'left',
                            }}
                            onMouseEnter={e => (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)'}
                            onMouseLeave={e => (e.target as HTMLButtonElement).style.backgroundColor = 'transparent'}
                          >
                            <code style={{ fontSize: 'var(--text-sm)', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                              {cmd.command}
                            </code>
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromFavorites(cmd.id);
                              }}
                              title="Retirer des favoris"
                              style={{
                                padding: 'var(--space-1)',
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                marginLeft: 'auto',
                              }}
                              onMouseEnter={e2 => (e2.target as HTMLDivElement).style.color = 'var(--color-error)'}
                              onMouseLeave={e2 => (e2.target as HTMLDivElement).style.color = 'var(--text-muted)'}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  removeFromFavorites(cmd.id);
                                }
                              }}
                            >
                              <X size={12} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Section Toutes les commandes */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 var(--space-1) var(--space-2)',
                    borderBottom: '1px solid var(--border-base)',
                    margin: favoriteCommands.length > 0 ? 'var(--space-2) 0' : '',
                  }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                      Commandes rapides
                    </span>
                  </div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {DEFAULT_COMMANDS.slice(0, 8).map((cmd, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          const tabRef = tabPanelRefs.current.get(activeTabId);
                          if (tabRef) {
                            tabRef.executeCommand(cmd.command);
                          }
                          setShowCommandPalette(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-2)',
                          padding: 'var(--space-2)',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-sm)',
                          textAlign: 'left',
                        }}
                        onMouseEnter={e => (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)'}
                        onMouseLeave={e => (e.target as HTMLButtonElement).style.backgroundColor = 'transparent'}
                      >
                        <code style={{ fontSize: 'var(--text-sm)', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                          {cmd.command}
                        </code>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          {cmd.description}
                        </span>
                      </button>
                    ))}
                  </div>

                  {favoriteCommands.length === 0 && (
                    <div style={{
                      padding: 'var(--space-3)',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-sm)',
                    }}>
                      <p>Aucune commande favorite</p>
                      <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                        Les commandes que vous utilisez fréquemment apparaîtront ici
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Bouton de recherche */}
          <button
            onClick={() => !isMinimized && setShowSearch(!showSearch)}
            title="Rechercher (Ctrl+F)"
            style={{
              padding: 'var(--space-1)',
              border: 'none',
              background: showSearch ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text-muted)',
              cursor: isMinimized ? 'default' : 'pointer',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isMinimized ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--accent-primary)';
            }}
            onMouseLeave={e => {
              if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
            }}
          >
            <Search size={14} />
          </button>

          <button
            onClick={toggleMinimize}
            title={isMinimized ? 'Restaurer' : 'Minimiser'}
            style={{
              padding: 'var(--space-1)',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => (e.target as HTMLButtonElement).style.color = 'var(--text-primary)'}
            onMouseLeave={e => (e.target as HTMLButtonElement).style.color = 'var(--text-muted)'}
          >
            {isMinimized ? <Maximize size={14} /> : <Minimize size={14} />}
          </button>

          {!isMinimized && (
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
              style={{
                padding: 'var(--space-1)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                opacity: isMinimized ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                if (!isMinimized) (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              }}
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          )}

          <button
            onClick={onClose}
            title="Fermer"
            style={{
              padding: 'var(--space-1)',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => {
              (e.target as HTMLButtonElement).style.color = 'var(--color-error)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-error-subtle)';
            }}
            onMouseLeave={e => {
              (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
              (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Barre de recherche */}
      {showSearch && !isMinimized && (
        <SearchBar
          onSearch={handleSearch}
          onClose={() => setShowSearch(false)}
          onNext={handleNextMatch}
          onPrev={handlePrevMatch}
          matchCount={searchMatches.length}
          currentMatch={currentMatchIndex}
        />
      )}

      {/* Contenu des onglets - caché quand minimisé mais garde les connexions actives */}
      {!isMinimized && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', width: '100%' }}>
          {tabs.map(tab => (
            <TerminalTabPanel
              key={tab.id}
              tab={tab}
              isActive={activeTabId === tab.id}
              onSendInput={handleCommandSent}
              onClear={() => updateTabCwd(tab.id, '')}
              onRename={(newTitle) => renameTab(tab.id, newTitle)}
              cwd={tab.cwd}
              onRegisterRef={handleRegisterRef}
              onOpenBrowser={onOpenBrowser}
              devServerPort={devServerPort}
            />
          ))}
        </div>
      )}

      {isFullscreen && (
        <button
          onClick={toggleFullscreen}
          style={{
            position: 'fixed',
            top: 'var(--space-4)',
            right: 'var(--space-4)',
            padding: 'var(--space-2)',
            border: 'none',
            background: 'var(--bg-panel)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-md)',
            zIndex: 'var(--z-float)' as any,
            boxShadow: 'var(--shadow-lg)',
          }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover)'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.backgroundColor = 'var(--bg-panel)'; }}
        >
          <Minimize size={20} />
        </button>
      )}
    </motion.div>
  );
});

TerminalPanel.displayName = 'TerminalPanel';

export default memo(TerminalPanel);
export type { TerminalPanelProps };
export { DEFAULT_COMMANDS };
