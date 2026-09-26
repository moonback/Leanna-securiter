const { app, BrowserWindow, systemPreferences, Notification, ipcMain, shell, dialog, desktopCapturer, nativeTheme, Tray, Menu } = require('electron');
nativeTheme.themeSource = 'dark';

const fs = require('fs');
const path = require('path');

const DEBUG = process.env.ELECTRON_DEBUG === '1';
const isPackaged = app.isPackaged;

function getWindowIcon() {
  const iconName = nativeTheme.shouldUseDarkColors ? 'icon-sombre.png' : 'icon-light.png';
  return path.join(__dirname, '../assets/images', iconName);
}

// --- Logging vers fichier, visible même sans terminal ---
const logPath = path.join(app.getPath('userData'), 'Leanna-debug.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(logPath, line + '\n'); } catch (_) {}
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT EXCEPTION:', err.stack || err.message);
  dialog.showErrorBox('Erreur Leanna ', String(err.stack || err));
});

process.on('unhandledRejection', (err) => {
  log('UNHANDLED REJECTION:', err && err.stack ? err.stack : String(err));
});

log('App starting. isPackaged =', isPackaged, 'appPath =', app.getAppPath());

function startBackendServer() {
  try {
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_APP_PATH = app.getAppPath();
    // Dossier persistant pour les fichiers de config (.env, .gemini-keys.json, etc.)
    const configDir = app.getPath('userData');
    process.env.Leanna_CONFIG_PATH = configDir;
    log('Config directory:', configDir);

    // Initialiser le fichier .env utilisateur dans userData à partir du template .env.example si absent.
    // Si le fichier existe déjà, on s'assure que les clés présentes dans .env.example
    // mais absentes du fichier utilisateur sont ajoutées (migration forward-only).
    const destEnv = path.join(configDir, '.env');
    const exampleEnv = path.join(app.getAppPath(), '.env.example');
    if (!fs.existsSync(destEnv) && fs.existsSync(exampleEnv)) {
      try {
        fs.copyFileSync(exampleEnv, destEnv);
        log('Initialized user .env from .env.example in userData');
      } catch (e) {
        log('Failed to initialize .env from .env.example:', e.message);
      }
    } else if (fs.existsSync(destEnv) && fs.existsSync(exampleEnv)) {
      // Migration : ajouter les clés manquantes sans écraser les valeurs existantes
      try {
        const existing = fs.readFileSync(destEnv, 'utf-8');
        const example = fs.readFileSync(exampleEnv, 'utf-8');
        // Extraire les noms de clés déjà présents dans le fichier utilisateur
        const existingKeys = new Set(
          existing.split('\n')
            .map(l => l.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1])
            .filter(Boolean)
        );
        // Collecter les lignes de .env.example dont la clé est absente
        const linesToAdd = example.split('\n').filter(line => {
          const key = line.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1];
          return key && !existingKeys.has(key);
        });
        if (linesToAdd.length > 0) {
          const appendContent = '\n# --- Added by auto-migration ---\n' + linesToAdd.join('\n') + '\n';
          fs.appendFileSync(destEnv, appendContent, 'utf-8');
          log('Migrated', linesToAdd.length, 'missing keys into user .env');
        }
      } catch (e) {
        log('Failed to migrate user .env:', e.message);
      }
    }

    const serverPath = path.join(app.getAppPath(), 'dist', 'server.cjs');
    log('Loading server from:', serverPath, 'exists:', fs.existsSync(serverPath));
    require(serverPath);
    log('Server module required successfully');
  } catch (err) {
    log('SERVER START FAILED:', err.stack || err.message);
    dialog.showErrorBox('Erreur démarrage serveur', String(err.stack || err));
  }
}

// ── Splash Screen ───────────────────────────────────────────────────────────

function createSplashWindow() {
  const splash = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: getWindowIcon(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splash.loadFile(path.join(__dirname, 'splash.html'));
  return splash;
}

// ── Main Window ─────────────────────────────────────────────────────────────

function createWindow(splash, splashMinEnd) {
  const win = new BrowserWindow({
    width: DEBUG ? 1600 : 1200,
    height: 900,
    show: false, // Caché jusqu'à ce que le contenu soit prêt
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
    },
    autoHideMenuBar: !DEBUG,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#09090b',
    icon: getWindowIcon(),
  });

  win.maximize();

  const port = process.env.VITE_SERVER_PORT || 4000;
  const startUrl = process.env.ELECTRON_START_URL || `http://127.0.0.1:${port}`;
  log('Loading URL:', startUrl);
  win.loadURL(startUrl);

  // Afficher la fenêtre principale une fois le contenu chargé
  win.webContents.on('did-finish-load', () => {
    // Compléter la barre de progression sur le splash
    if (splash && !splash.isDestroyed()) {
      splash.webContents.executeJavaScript('if (typeof window.markComplete === "function") window.markComplete();').catch(() => {});
    }

    // Attendre la fin du cycle splash (minimum 4.5 secondes)
    const remaining = Math.max(400, (splashMinEnd || 0) - Date.now());
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) {
        splash.close();
      }
      win.maximize();
      win.show();
      win.focus();
    }, remaining);
  });

  // Logger les messages de la console renderer dans le fichier de log
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
  });

  // Raccourci F12 ou Ctrl+Shift+I pour ouvrir/fermer les DevTools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Ouvrir les DevTools automatiquement en mode debug
  if (DEBUG) {
    win.webContents.openDevTools({ mode: 'right' });
    console.log('[Electron] Mode debug activé — DevTools ouverts');
  }

  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    log('FAILED TO LOAD:', errorCode, errorDescription);
    // Réessayer après 1.5s si le serveur n'est pas encore prêt
    if (errorCode === -102 || errorCode === -6 || errorCode === -105) {
      setTimeout(() => {
        log('Retrying load...');
        win.loadURL(startUrl);
      }, 1500);
    }
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    log('RENDER PROCESS GONE:', JSON.stringify(details));
  });

  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone');
    systemPreferences.askForMediaAccess('camera');
  }

  return win;
}

// ── System Tray ─────────────────────────────────────────────────────────────

let tray = null;

function createTray(win) {
  const iconPath = path.join(__dirname, '../assets/images/icon-sombre.png');
  tray = new Tray(iconPath);
  tray.setToolTip('Leanna');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Afficher',
      click: () => {
        win.show();
        win.focus();
      },
    },
    {
      label: 'Masquer',
      click: () => {
        win.hide();
      },
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-clic sur l'icône tray → afficher/masquer la fenêtre
  tray.on('double-click', () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  const splash = createSplashWindow();
  const splashMinEnd = Date.now() + 5000; // splash visible au moins 5 secondes

  // Démarrer le serveur backend en mode packagé
  if (isPackaged) {
    startBackendServer();
  }

  const win = createWindow(splash, splashMinEnd);

  // Créer le tray une fois la fenêtre prête
  createTray(win);

  // Intercepter la fermeture : réduire dans le tray plutôt que quitter
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'Leanna',
          body: 'Leanna tourne en arrière-plan. Double-cliquez sur l\'icône pour rouvrir.',
        }).show();
      }
    }
  });

  // --- IPC Handlers (inchangé) ---

  ipcMain.handle('electron/folder-contents', async function (_event, folderPath) {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    return entries.map(function (entry) {
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(folderPath, entry.name),
      };
    });
  });

  ipcMain.handle('electron/create-file', async function (_event, folderPath, fileName) {
    const targetPath = path.join(folderPath, fileName);
    await fs.promises.writeFile(targetPath, '', { flag: 'wx' });
    return targetPath;
  });

  ipcMain.handle('electron/create-folder', async function (_event, folderPath, folderName) {
    const targetPath = path.join(folderPath, folderName);
    await fs.promises.mkdir(targetPath, { recursive: false });
    return targetPath;
  });

  ipcMain.handle('electron/delete-path', async function (_event, targetPath) {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle('electron/open-path', async function (_event, targetPath) {
    await shell.openPath(targetPath);
    return true;
  });

  ipcMain.handle('electron/open-external', async function (_event, url) {
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('electron/get-project-root', async function () {
    // IDE : retourne toujours le dossier de l'app elle-même
    return process.env.ELECTRON_APP_PATH || app.getAppPath();
  });

  ipcMain.handle('electron/select-folder', async function () {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choisir le workspace',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('electron/quit', function () {
    app.isQuitting = true;
    app.quit();
  });

  // ── Git Clone ────────────────────────────────────────────────────────────────
  // Clone un dépôt GitHub (ou tout dépôt git) dans un dossier local,
  // puis retourne le chemin du dossier cloné pour activation comme workspace.
  ipcMain.handle('electron/git-clone', async function (_event, repoUrl, targetDir) {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const os = require('os');

    const execFileAsync = promisify(execFile);

    // Sanitize: s'assurer que repoUrl est une string et commence par https://
    if (typeof repoUrl !== 'string' || !repoUrl.trim()) {
      return { success: false, error: 'URL de dépôt invalide.' };
    }
    const url = repoUrl.trim();
    if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) {
      return { success: false, error: 'Seules les URLs HTTPS et SSH (git@) sont autorisées.' };
    }

    // Dériver le nom du dépôt depuis l'URL (ex: https://github.com/user/my-repo.git → my-repo)
    const repoName = url.split('/').pop()?.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9_\-. ]/g, '_') || 'repo';

    // Dossier de destination : soit fourni par l'utilisateur, soit ~/Documents/Leanna-Projects/<repo>
    let clonePath;
    if (targetDir && typeof targetDir === 'string' && targetDir.trim()) {
      clonePath = path.resolve(targetDir.trim(), repoName);
    } else {
      clonePath = path.join(os.homedir(), 'Documents', 'Leanna-Projects', repoName);
    }

    // S'assurer que le dossier parent existe
    try {
      await fs.promises.mkdir(path.dirname(clonePath), { recursive: true });
    } catch (mkErr) {
      return { success: false, error: `Impossible de créer le dossier parent: ${mkErr.message}` };
    }

    // Vérifier que le dossier de destination n'existe pas déjà
    if (fs.existsSync(clonePath)) {
      return { success: false, error: `Le dossier de destination existe déjà: ${clonePath}`, clonePath };
    }

    try {
      await execFileAsync('git', ['clone', '--progress', url, clonePath], {
        timeout: 300000, // 5 minutes max
        windowsHide: true,
      });
      log(`[git-clone] Clone réussi: ${url} → ${clonePath}`);
      return { success: true, path: clonePath, repoName };
    } catch (err) {
      // execFile rejette avec l'objet Error qui contient stderr dans err.stderr
      const errMsg = (err.stderr || err.message || String(err)).trim();
      log(`[git-clone] Erreur: ${errMsg}`);
      // Nettoyer le dossier partiellement cloné si présent
      try { if (fs.existsSync(clonePath)) await fs.promises.rm(clonePath, { recursive: true, force: true }); } catch (_) {}
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle('electron/get-screen-sources', async function () {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map(function (source) {
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
      };
    });
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(null, 0);
    } else {
      win.show();
      win.focus();
    }
  });

  if (Notification.isSupported()) {
    new Notification({ title: 'Leanna ', body: 'Système local connecté et prêt.' }).show();
  }
});

app.on('window-all-closed', function () {
  // Ne pas quitter si on réduit dans le tray
  if (app.isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Le serveur Express est chargé dans le même process (require(serverPath)).
// On utilise process.__LeannaShutdown (exposé par server.ts) pour déclencher
// l'arrêt propre des timers, sessions Gemini et WebSocket avant de quitter.
// Cela évite les MaxListenersExceededWarning et sessions zombies après
// plusieurs redémarrages en développement.

let isShuttingDown = false;

app.on('before-quit', function (event) {
  if (isShuttingDown) return; // Éviter les appels multiples
  isShuttingDown = true;

  const shutdown = process.__LeannaShutdown;

  // Mode packagé : le serveur tourne dans le même process → graceful shutdown
  if (typeof shutdown === 'function') {
    event.preventDefault();
    log('[Lifecycle] before-quit : déclenchement du graceful shutdown...');

    shutdown('before-quit').then(function () {
      log('[Lifecycle] Shutdown complet, fermeture Electron.');
    }).catch(function (err) {
      log('[Lifecycle] Erreur shutdown:', err && err.message ? err.message : String(err));
    }).finally(function () {
      killChildProcesses();
      app.exit(0);
    });

    // Sécurité : forcer la fermeture après 5s si le shutdown n'aboutit pas
    setTimeout(function () {
      log('[Lifecycle] Timeout shutdown (5s), forçage fermeture.');
      killChildProcesses();
      app.exit(0);
    }, 5000);

  } else {
    // Mode dev : le serveur est un process séparé lancé par concurrently.
    // On tue le process qui écoute sur le port du serveur avant de quitter.
    log('[Lifecycle] before-quit (dev) : arrêt du serveur dev sur le port...');
    killDevServer();
    // Pas de preventDefault() — Electron peut se fermer immédiatement
  }
});

// Tue le serveur dev (process séparé lancé par concurrently en mode dev).
// Cherche le PID qui écoute sur le port du serveur et le termine.
function killDevServer() {
  const port = process.env.VITE_SERVER_PORT || '4000';
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      // netstat donne le PID pour le port donné
      const output = execSync(
        'netstat -ano | findstr :' + port + ' | findstr LISTENING',
        { encoding: 'utf-8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      // Extraire le dernier token (PID) de la première ligne
      const firstLine = output.split('\n')[0];
      const pid = firstLine && firstLine.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && parseInt(pid) !== process.pid) {
        log('[Lifecycle] Arrêt serveur dev PID:', pid, 'port:', port);
        execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore', windowsHide: true });
      }
    } else {
      // Linux/macOS : lsof
      const output = execSync(
        'lsof -ti tcp:' + port,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      output.split('\n').forEach(function (pid) {
        pid = pid.trim();
        if (pid && /^\d+$/.test(pid) && parseInt(pid) !== process.pid) {
          log('[Lifecycle] Arrêt serveur dev PID:', pid, 'port:', port);
          try { process.kill(parseInt(pid), 'SIGTERM'); } catch (_) {}
        }
      });
    }
  } catch (_) {
    // Pas de process sur ce port, ou commande indisponible — on continue
  }
}

// Sur Windows, app.exit() ne tue pas toujours les child processes (MCP, etc.)
// On utilise taskkill pour nettoyer l'arbre de processus.
function killChildProcesses() {
  if (process.platform !== 'win32') return;
  try {
    const { execSync } = require('child_process');
    const pid = process.pid;
    log('[Lifecycle] Nettoyage processus enfants (PID parent:', pid, ')...');
    // /T = kill process tree, /F = force
    execSync('taskkill /PID ' + pid + ' /T /F', {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (_) {
    // Erreur attendue : taskkill échoue quand le process est déjà en train de mourir
  }
}

