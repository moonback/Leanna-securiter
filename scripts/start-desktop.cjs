const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env.local first, then .env
const envLocalPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const port = process.env.VITE_SERVER_PORT || 4000;
const isDebug = process.env.ELECTRON_DEBUG === '1' || process.argv.includes('--debug');

console.log(`[Desktop Runner] Waiting for http://127.0.0.1:${port}...`);

try {
  // Wait for the dev server (Express is explicitly bound to IPv4).
  execSync(`npx wait-on http://127.0.0.1:${port}`, { stdio: 'inherit' });

  // Run electron
  console.log(`[Desktop Runner] Starting Electron...`);
  const electronCmd = isDebug 
    ? 'npx cross-env ELECTRON_DEBUG=1 electron --inspect=5858 electron/main.cjs'
    : 'npx electron electron/main.cjs';

  execSync(electronCmd, { stdio: 'inherit' });
  // Electron s'est fermé proprement (code 0). Fin normale du runner.
  console.log('[Desktop Runner] Electron fermé proprement.');
} catch (error) {
  // Distinguer un ARRÊT VOLONTAIRE (fermeture Electron via before-quit, ou
  // SIGTERM/SIGINT envoyé par `concurrently --kill-others` quand l'autre
  // process s'arrête) d'une VRAIE erreur d'exécution. Un arrêt propre ne doit
  // pas être transformé en échec CI/dev (Bug #9).
  const signal = error && error.signal;                 // ex: 'SIGTERM', 'SIGINT'
  const status = error && typeof error.status === 'number' ? error.status : null;
  const isIntentionalShutdown =
    signal === 'SIGTERM' ||
    signal === 'SIGINT' ||
    status === 0 ||
    // Windows : une fermeture via kill/CTRL peut remonter 130 (SIGINT) ou 143 (SIGTERM).
    status === 130 ||
    status === 143;

  if (isIntentionalShutdown) {
    console.log(`[Desktop Runner] Arrêt volontaire détecté (${signal || 'code ' + status}). Sortie propre.`);
    process.exit(0);
  }

  console.error('[Desktop Runner] Error:', error.message);
  process.exit(status && status !== 0 ? status : 1);
}
