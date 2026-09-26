/**
 * serverRestart.ts — Superviseur de redémarrage contrôlé.
 *
 * Quand l'IA modifie un fichier qui impacte le runtime serveur,
 * ce module notifie les clients connectés et déclenche un restart graceful.
 *
 * En mode développement (tsx), le HMR gère le reload automatiquement.
 * En production (Electron), ce module peut envoyer un signal au process parent.
 */

import path from "path";
import { SELF_ROOT } from "./selfRoot.js";

const SERVER_CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"]);
const SERVER_DIRS = ["server/", "electron/"];
const DATA_FILE_SUFFIXES = [".json", ".db", ".log", ".sqlite", ".sqlite3"];
const DATA_FILE_BASENAMES = new Set([
  ".project-knowledge.json",
  ".project-memory.json",
]);
const DATA_DIR_PREFIXES = [".Leanna/", "node_modules/"];

function isRunnableServerCode(relative: string): boolean {
  const normalized = relative.replace(/\\/g, "/");
  if (normalized === "server.ts") return true;
  const inServerDir = SERVER_DIRS.some(d => normalized.startsWith(d));
  if (!inServerDir) return false;
  const ext = path.extname(normalized).toLowerCase();
  return SERVER_CODE_EXTS.has(ext);
}

/**
 * Détermine si la modification d'un fichier nécessite un redémarrage serveur.
 */
export function requiresRestart(filePath: string): boolean {
  const relative = path.relative(SELF_ROOT, path.resolve(SELF_ROOT, filePath)).replace(/\\/g, '/');

  if (DATA_DIR_PREFIXES.some(p => relative.startsWith(p))) return false;

  const ext = path.extname(relative).toLowerCase();
  const base = path.basename(relative);

  if (relative.startsWith("server/knowledge/") && DATA_FILE_BASENAMES.has(base)) return false;
  if (DATA_FILE_SUFFIXES.includes(ext) && !SERVER_CODE_EXTS.has(ext)) return false;

  return isRunnableServerCode(relative);
}

// ── Notification clients ────────────────────────────────────────────────────

type NotifyFn = (data: any) => void;
const subscribers = new Set<NotifyFn>();

/**
 * Enregistre une fonction de notification (un client WebSocket).
 */
export function subscribeToRestart(notify: NotifyFn): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

/**
 * Notifie tous les clients qu'un restart est en cours.
 */
function notifyClients(filePath: string, status: 'pending' | 'restarting' | 'restarted') {
  const payload = {
    type: 'server-restart',
    filePath,
    status,
    timestamp: Date.now(),
  };
  for (const notify of subscribers) {
    try { notify(payload); } catch { /* ignore dead connections */ }
  }
}

// ── Restart logic ───────────────────────────────────────────────────────────

let restartPending = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Appelé après qu'un fichier serveur a été modifié.
 * Debounce 2s pour grouper les modifications rapides.
 */
export function triggerRestartIfNeeded(filePath: string): boolean {
  if (!requiresRestart(filePath)) return false;

  console.log(`[Restart] Fichier serveur modifié: ${filePath} — redémarrage planifié`);
  notifyClients(filePath, 'pending');

  // Debounce : attendre 2s sans nouvelle modification avant de restart
  if (restartTimer) clearTimeout(restartTimer);
  restartPending = true;

  restartTimer = setTimeout(() => {
    performRestart(filePath);
  }, 2000);

  return true;
}

/**
 * Exécute le redémarrage effectif.
 */
function performRestart(triggerFile: string) {
  restartPending = false;
  restartTimer = null;

  notifyClients(triggerFile, 'restarting');
  console.log(`[Restart] Redémarrage en cours...`);

  // Mode développement : on ne peut pas vraiment se restart soi-même.
  // Le fichier watch de tsx/nodemon s'en charge.
  // On envoie juste un signal SIGHUP si supporté, sinon on log.
  if (process.env.NODE_ENV === 'production' || process.env.ELECTRON_APP_PATH) {
    // En production Electron : envoyer un signal au process parent
    // pour qu'il relance le child (le main.cjs Electron supervise)
    try {
      if (process.send) {
        // Si lancé en child_process (fork), notifier le parent
        process.send({ type: 'restart-request', trigger: triggerFile });
        console.log(`[Restart] Signal envoyé au process parent.`);
      } else {
        // Graceful exit — le superviseur externe (systemd, pm2, Electron) relancera
        console.log(`[Restart] Arrêt graceful (exit 75) pour relance par superviseur externe.`);
        setTimeout(() => process.exit(75), 500); // Code 75 = convention "restart needed"
      }
    } catch (e) {
      console.error(`[Restart] Échec du signal de restart:`, e);
    }
  } else {
    // Mode dev : tsx --watch gère le reload, on notifie simplement
    console.log(`[Restart] Mode dev — le HMR/watcher gère le reload automatiquement.`);
    // Simuler un "restarted" après un court délai pour l'UI
    setTimeout(() => {
      notifyClients(triggerFile, 'restarted');
    }, 1000);
  }
}

/**
 * Retourne l'état actuel du superviseur.
 */
export function getRestartStatus(): { pending: boolean } {
  return { pending: restartPending };
}
