/**
 * start-electron-only.cjs
 *
 * Lance Electron après avoir attendu que le serveur backend soit prêt.
 * À utiliser via PM2 : PM2 gère le serveur (dist/server.cjs),
 * ce script démarre ensuite la fenêtre Electron.
 *
 * PM2 relancera ce script si Electron se ferme complètement (isQuitting=true).
 * Si l'utilisateur clique juste sur la croix, la fenêtre se cache dans le tray
 * et Electron reste vivant → PM2 ne redémarre rien.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Charger les variables d'environnement
const envLocalPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
}
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const port = process.env.VITE_SERVER_PORT || 4000;
const isDebug = process.env.ELECTRON_DEBUG === '1' || process.argv.includes('--debug');
const maxWaitMs = 60_000; // attendre le serveur jusqu'à 60 secondes

console.log(`[Electron Launcher] En attente du serveur sur http://127.0.0.1:${port}...`);

// ── Attente active du serveur ────────────────────────────────────────────────
function waitForServer(url, timeoutMs) {
  const http = require('http');
  const start = Date.now();

  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (res) => {
        res.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Serveur non disponible après ${timeoutMs / 1000}s`));
          return;
        }
        setTimeout(attempt, 500);
      });
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(attempt, 500);
      });
    }
    attempt();
  });
}

// ── Lancement d'Electron ─────────────────────────────────────────────────────
async function main() {
  try {
    await waitForServer(`http://127.0.0.1:${port}`, maxWaitMs);
    console.log(`[Electron Launcher] Serveur prêt. Démarrage d'Electron...`);

    // Résoudre le binaire electron local au projet
    const electronBin = require('electron');

    const args = [path.join(__dirname, '../electron/main.cjs')];
    if (isDebug) {
      args.unshift('--inspect=5858');
      process.env.ELECTRON_DEBUG = '1';
    }

    // DISPLAY nécessaire sur Linux (X11 / Wayland)
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      process.env.DISPLAY = ':0';
    }

    console.log(`[Electron Launcher] Commande : electron ${args.join(' ')}`);

    execFileSync(electronBin, args, {
      stdio: 'inherit',
      env: process.env,
      windowsHide: false, // laisser la fenêtre apparaître sur Windows
    });

    console.log('[Electron Launcher] Electron fermé proprement (isQuitting=true).');
    process.exit(0);
  } catch (err) {
    console.error('[Electron Launcher] Erreur :', err.message);
    process.exit(1);
  }
}

main();
