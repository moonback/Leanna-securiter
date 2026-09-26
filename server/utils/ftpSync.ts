/**
 * ftpSync.ts — Utilitaire de synchronisation FTP ↔ workspace local.
 *
 * Stratégie "miroir local" :
 *   - Les fichiers FTP sont téléchargés dans un dossier local dédié
 *     (~/.Leanna/ftp-workspaces/<host>/<sanitized-path>/).
 *   - L'IA travaille sur ce dossier local comme n'importe quel workspace.
 *   - Un "push" resynchronise les modifications locales vers le serveur FTP.
 *
 * Lib : basic-ftp (pas de deps transversales, API async propre).
 */

import * as ftp from "basic-ftp";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FtpConfig {
  host: string;
  port: number;
  user: string;
  /** Mot de passe en clair — stocké uniquement en mémoire, jamais persisté sur disque. */
  password: string;
  remotePath: string;
  secure: boolean;
}

export type ProgressCallback = (info: {
  type: "log";
  level: "info" | "warn" | "error";
  message: string;
}) => void;

// ── Dossiers/fichiers à ignorer lors du téléchargement ───────────────────────
// Inclut les dossiers système cPanel/WHM courants, les caches serveur, etc.
// L'utilisateur peut fournir un chemin précis (ex: /public_html) pour éviter
// de descendre depuis la racine FTP.
const SKIP_PATTERNS = [
  /^\.cpanel$/i,
  /^\.cphorde$/i,
  /^\.fantastico_data$/i,
  /^\.htpasswds$/i,
  /^\.trash$/i,
  /^\.cache$/i,
  /^\.config$/i,
  /^\.local$/i,
  /^\.pki$/i,
  /^\.ssh$/i,
  /^\.gnupg$/i,
  /^\.spamassassin$/i,
  /^\.softaculous$/i,
  /^\.cl\.selector$/i,
  /^logs?$/i,
  /^tmp$/i,
  /^temp$/i,
  /^etc$/i,
  /^var$/i,
  /^proc$/i,
  /^sys$/i,
  /^run$/i,
];

function shouldSkip(name: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(name));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Transforme une config FTP en chemin local sûr (sans mot de passe, sans chars spéciaux).
 * Ex: ftp.example.com:21/var/www → ~/.Leanna/ftp-workspaces/ftp.example.com_21/var_www
 */
export function ftpLocalMirrorPath(config: FtpConfig): string {
  const sanitizeSegment = (s: string) =>
    s.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");

  const hostPart = sanitizeSegment(`${config.host}_${config.port}`);
  const remoteSegments = config.remotePath
    .split("/")
    .filter(Boolean)
    .map(sanitizeSegment);

  const base = path.join(os.homedir(), ".Leanna", "ftp-workspaces", hostPart);
  return remoteSegments.length > 0
    ? path.join(base, ...remoteSegments)
    : base;
}

/** Crée un client FTP connecté et authentifié. Lance une exception en cas d'échec. */
async function createClient(config: FtpConfig): Promise<ftp.Client> {
  const client = new ftp.Client(30_000); // timeout 30s
  client.ftp.verbose = false;

  await client.access({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    secure: config.secure,
    secureOptions: config.secure ? { rejectUnauthorized: false } : undefined,
  });

  return client;
}

// ── Téléchargement récursif manuel ───────────────────────────────────────────

/**
 * Télécharge récursivement un répertoire FTP distant vers un dossier local.
 *
 * Contrairement à `client.downloadToDir()` (qui casse sur les dossiers parents
 * manquants et ne filtre pas les dossiers système), cette implémentation :
 *   - crée chaque dossier parent AVANT d'écrire les fichiers
 *   - ignore les dossiers/fichiers système via SKIP_PATTERNS
 *   - gère les erreurs par fichier sans interrompre tout le téléchargement
 *   - rapporte la progression via callback
 */
async function downloadDirRecursive(
  client: ftp.Client,
  remotePath: string,
  localDir: string,
  log: (msg: string, level?: "info" | "warn" | "error") => void,
  stats: { files: number; skipped: number; errors: number }
): Promise<void> {
  // Créer le dossier local s'il n'existe pas
  await fs.promises.mkdir(localDir, { recursive: true });

  let entries: ftp.FileInfo[];
  try {
    await client.cd(remotePath);
    entries = await client.list();
  } catch (err: any) {
    log(`  ⚠️  Impossible de lister ${remotePath} : ${err.message}`, "warn");
    stats.errors++;
    return;
  }

  for (const entry of entries) {
    // Ignorer les entrées spéciales (. et ..)
    if (entry.name === "." || entry.name === "..") continue;

    // Ignorer les dossiers/fichiers système
    if (shouldSkip(entry.name)) {
      log(`  ⏭  Ignoré (système) : ${entry.name}`, "warn");
      stats.skipped++;
      continue;
    }

    const remoteEntryPath = remotePath.replace(/\/$/, "") + "/" + entry.name;
    const localEntryPath = path.join(localDir, entry.name);

    if (entry.type === ftp.FileType.Directory) {
      // Descente récursive
      await downloadDirRecursive(client, remoteEntryPath, localEntryPath, log, stats);
      // Remonter au parent après la récursion
      try {
        await client.cd(remotePath);
      } catch {
        // Si le cd échoue, on retente via le chemin absolu
        try { await client.cd(remotePath); } catch { /* skip */ }
      }
    } else if (entry.type === ftp.FileType.File) {
      // Créer le dossier parent local si nécessaire (sécurité supplémentaire)
      await fs.promises.mkdir(path.dirname(localEntryPath), { recursive: true });

      try {
        await client.downloadTo(localEntryPath, remoteEntryPath);
        log(`  ↓ ${entry.name} (${formatBytes(entry.size ?? 0)})`);
        stats.files++;
      } catch (err: any) {
        log(`  ❌ Erreur sur ${entry.name} : ${err.message}`, "error");
        stats.errors++;
        // Supprimer le fichier partiellement écrit
        try { await fs.promises.unlink(localEntryPath); } catch { /* ignore */ }
      }
    }
    // Les liens symboliques (FileType.SymbolicLink) sont ignorés silencieusement
  }
}

// ── API publique ───────────────────────────────────────────────────────────────

/**
 * Teste la connexion FTP : connexion + authentification + accès au chemin distant.
 * Retourne { ok: true } ou { ok: false, error: string }.
 */
export async function testFtpConnection(
  config: FtpConfig
): Promise<{ ok: boolean; error?: string; serverInfo?: string }> {
  const client = new ftp.Client(8_000);
  client.ftp.verbose = false;

  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      secure: config.secure,
      secureOptions: config.secure ? { rejectUnauthorized: false } : undefined,
    });

    const remotePath = config.remotePath || "/";
    await client.cd(remotePath);
    const list = await client.list();
    const visibleEntries = list.filter((e) => !shouldSkip(e.name));

    return {
      ok: true,
      serverInfo: `${visibleEntries.length} entrée(s) visible(s) dans ${remotePath}`,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    client.close();
  }
}

/**
 * Télécharge récursivement le répertoire FTP distant vers le miroir local.
 * Utilise un téléchargement fichier par fichier (pas downloadToDir) pour :
 *   - créer les dossiers parents avant chaque fichier
 *   - filtrer les dossiers système (cPanel, .ssh, logs…)
 *   - continuer malgré les erreurs sur des fichiers individuels
 *
 * @returns Chemin absolu du dossier local créé.
 */
export async function downloadFtpWorkspace(
  config: FtpConfig,
  onProgress?: ProgressCallback
): Promise<string> {
  const localDir = ftpLocalMirrorPath(config);
  const log = (
    message: string,
    level: "info" | "warn" | "error" = "info"
  ) => onProgress?.({ type: "log", level, message });

  log(`📡 Connexion à ${config.host}:${config.port}…`);

  const client = await createClient(config);

  try {
    const remotePath = config.remotePath || "/";
    log(`📂 Chemin distant : ${remotePath}`);

    await fs.promises.mkdir(localDir, { recursive: true });
    log(`📁 Miroir local : ${localDir}`);
    log("⬇️  Téléchargement en cours…");

    const stats = { files: 0, skipped: 0, errors: 0 };
    await downloadDirRecursive(client, remotePath, localDir, log, stats);

    log(
      `✅ Téléchargement terminé — ${stats.files} fichier(s)` +
      (stats.skipped > 0 ? `, ${stats.skipped} dossier(s) système ignoré(s)` : "") +
      (stats.errors > 0 ? `, ${stats.errors} erreur(s)` : "")
    );

    return localDir;
  } finally {
    client.close();
  }
}

/**
 * Pousse les fichiers locaux modifiés vers le serveur FTP.
 * Compare uniquement les fichiers passés dans `filePaths` (chemins relatifs
 * au dossier local), ou TOUS les fichiers si `filePaths` est vide.
 *
 * @returns Nombre de fichiers envoyés.
 */
export async function pushFtpChanges(
  config: FtpConfig,
  localRoot: string,
  filePaths: string[],
  onProgress?: ProgressCallback
): Promise<number> {
  const log = (
    message: string,
    level: "info" | "warn" | "error" = "info"
  ) => onProgress?.({ type: "log", level, message });

  log(`📡 Connexion à ${config.host}:${config.port} pour le push…`);

  const client = await createClient(config);
  let uploaded = 0;

  try {
    const remotePath = config.remotePath || "/";

    if (filePaths.length === 0) {
      log("⬆️  Push complet du workspace…");
      client.trackProgress((info) => {
        if (info.name) log(`  ↑ ${info.name} (${formatBytes(info.bytes)})`);
      });
      await client.uploadFromDir(localRoot, remotePath);
      client.trackProgress();
      uploaded = await countFiles(localRoot);
    } else {
      log(`⬆️  Push de ${filePaths.length} fichier(s) modifié(s)…`);
      for (const relPath of filePaths) {
        const localFile = path.join(localRoot, relPath);
        if (!fs.existsSync(localFile)) {
          log(`  ⚠️  Fichier introuvable localement : ${relPath}`, "warn");
          continue;
        }
        const remoteFile =
          remotePath.replace(/\/$/, "") + "/" + relPath.replace(/\\/g, "/");
        const remoteDir = remoteFile.substring(0, remoteFile.lastIndexOf("/"));

        try {
          await client.ensureDir(remoteDir);
          await client.cd(remotePath);
        } catch {
          await client.cd(remotePath);
        }

        await client.uploadFrom(localFile, remoteFile);
        log(`  ↑ ${relPath}`);
        uploaded++;
      }
    }

    log(`✅ Push terminé — ${uploaded} fichier(s) envoyé(s).`);
    return uploaded;
  } finally {
    client.close();
  }
}

/**
 * Liste le contenu d'un répertoire FTP distant (non-récursif).
 */
export async function listFtpDirectory(
  config: FtpConfig,
  remotePath?: string
): Promise<ftp.FileInfo[]> {
  const client = await createClient(config);
  try {
    const targetPath = remotePath || config.remotePath || "/";
    await client.cd(targetPath);
    return await client.list();
  } finally {
    client.close();
  }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}
