/**
 * sandbox.ts — Workspace sandbox isolé pour l'auto-modification.
 *
 * Le sandbox est une copie du code source dans `.Leanna/sandbox/` sur laquelle
 * l'assistant travaille sans provoquer de redémarrage du serveur principal.
 * Les modifications sont validées (tsc + tests) dans le sandbox AVANT d'être
 * synchronisées vers le repo principal.
 *
 * Avantages :
 * - Pas de redémarrage pendant le travail de l'IA
 * - Validation avant application (erreurs isolées)
 * - Rollback trivial (discard le sandbox)
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { SELF_ROOT, isWriteForbidden, isCriticalFile } from "./selfRoot.js";

const execFileAsync = promisify(execFile);

// ── Configuration ────────────────────────────────────────────────────────────

const SANDBOX_DIR_NAME = "sandbox";

/**
 * Retourne le chemin absolu de la racine du sandbox calculé dynamiquement
 * d'après le SELF_ROOT (projet actif courant).
 */
export function getSandboxRoot(): string {
  return path.join(SELF_ROOT, ".Leanna", SANDBOX_DIR_NAME);
}

/**
 * Retourne le chemin canonique (realpath) de la racine du sandbox.
 * À utiliser pour dériver un chemin relatif destiné à `assertSafeSandboxPath`,
 * afin que les deux emplois partagent exactement la même racine résolue.
 * @throws si la racine du sandbox est introuvable.
 */
export function getRealSandboxRoot(): string {
  return fs.realpathSync(getSandboxRoot());
}

// Dossiers/fichiers à exclure de la copie (trop volumineux ou inutiles dans le sandbox)
const EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "release",
  ".Leanna",
  ".Leanna-audit.log",
];

// ── State ────────────────────────────────────────────────────────────────────

export type SandboxState = "DISABLED" | "INITIALIZING" | "READY";
export type SandboxGuardCode = "SANDBOX_NOT_READY" | "SANDBOX_INVALID_PATH" | "SANDBOX_PATH_ESCAPE" | "SANDBOX_SYMLINK";

export class SandboxGuardError extends Error {
  constructor(
    public readonly code: SandboxGuardCode,
    message: string,
  ) {
    super(message);
    this.name = "SandboxGuardError";
  }
}

// Fail closed: seules les écritures lorsque le sandbox est READY sont autorisées.
// Pendant INITIALIZING, SELF_ROOT peut déjà pointer vers un nouveau projet alors
// que sa copie isolée est incomplète; aucune écriture ne doit alors être routée.
let sandboxState: SandboxState = "DISABLED";
let sandboxModifiedFiles = new Set<string>();
let lastSyncTimestamp: number | null = null;

function isSafeMainTarget(mainFile: string): boolean {
  const root = path.resolve(SELF_ROOT);
  const target = path.resolve(mainFile);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    } catch (error: any) {
      if (error?.code === "ENOENT") break;
      return false;
    }
  }
  return true;
}

function assertMainTargetAllowed(mainFile: string, relativePath: string): void {
  if (isWriteForbidden(mainFile)) {
    throw new SandboxGuardError("SANDBOX_PATH_ESCAPE", `Synchronisation refusée : cible protégée (${relativePath}).`);
  }
  if (isCriticalFile(mainFile)) {
    throw new SandboxGuardError("SANDBOX_PATH_ESCAPE", `Synchronisation refusée : fichier critique (${relativePath}). Utilisez une confirmation explicite.`);
  }
  if (!isSafeMainTarget(mainFile)) {
    throw new SandboxGuardError("SANDBOX_SYMLINK", `Synchronisation refusée : la cible principale est un lien symbolique ou sort du workspace (${relativePath}).`);
  }
}

// ── Mutex pour syncToMain (Audit §7) ─────────────────────────────────────────
// Empêche deux synchronisations simultanées vers le principal.
let syncLock: Promise<any> | null = null;

// ── Types erreurs structurées TSC ─────────────────────────────────────────────

export interface TscDiagnostic {
  file: string | null;
  line: number | null;
  column: number | null;
  code: string | null;
  severity: "error" | "warning" | "info";
  message: string;
  raw: string;
}

export interface SandboxValidationResult {
  valid: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: string | null;
  timedOut: boolean;
  rawOutput: string;
  diagnostics: TscDiagnostic[];
  globalDiagnostics: TscDiagnostic[];
  errorsByFile: Record<string, TscDiagnostic[]>;
  errorCount: number;
  warningCount: number;
}

/**
 * Parse une ligne de sortie tsc au format :
 *   path/to/file.ts(12,34): error TS1234: message d'erreur
 *   path/to/file.ts(12,34): warning TS1234: message d'avertissement
 *   error TS1234: message global (sans fichier)
 */
export function parseTscOutput(raw: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  const lines = raw.split(/\r?\n/);

  const tscLineRegex = /^(?<file>[^(]+)?(?:\((?<line>\d+)(?:,(?<col>\d+))?\))?:\s*(?<severity>error|warning|info)\s+(?<code>TS\d+):\s*(?<msg>.*)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = trimmed.match(tscLineRegex);
    if (!m || !m.groups) {
      // Ligne qui ne correspond pas au format standard : on l'ignore
      // sauf si c'est la première ligne et qu'elle ressemble à un message global
      continue;
    }

    const { file, line: lineNo, col, severity, code, msg } = m.groups;
    const normalizedFile = file ? file.replace(/\\/g, "/") : null;
    diagnostics.push({
      file: normalizedFile,
      line: lineNo ? parseInt(lineNo, 10) : null,
      column: col ? parseInt(col, 10) : null,
      code: code || null,
      severity: (severity.toLowerCase() === "warning" ? "warning" : severity.toLowerCase() === "info" ? "info" : "error"),
      message: msg || trimmed,
      raw: line,
    });
  }

  return diagnostics;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Indique si le sandbox est entièrement initialisé et peut recevoir des écritures.
 */
export function isSandboxActive(): boolean {
  return sandboxState === "READY";
}

/**
 * Retourne l'état explicite du cycle de vie du sandbox.
 */
export function getSandboxState(): SandboxState {
  return sandboxState;
}

/**
 * Autorité unique des écritures workspace.
 *
 * Seuls des chemins relatifs au sandbox READY sont acceptés. Le chemin est
 * canonisé puis chaque maillon existant est inspecté avec lstat : un symlink
 * est refusé pour empêcher une sortie du sandbox vers le dépôt principal ou
 * le système de fichiers.
 *
 * @throws SandboxGuardError si l'opération ne doit pas écrire.
 */
export function assertSandboxReady(requestedPath: string): string {
  return assertSafeSandboxPath(requestedPath);
}

/**
 * Autorité unique de validation d'un chemin sandbox (lecture ou écriture).
 *
 * Cette fonction centralise les trois vérifications de sécurité :
 *   1. résout le chemin absolu à partir de la racine réelle du sandbox ;
 *   2. vérifie qu'il reste strictement sous cette racine (pas d'échappement) ;
 *   3. remonte la chaîne des parents existants et rejette tout lien symbolique
 *      rencontré sur le trajet — pas seulement la cible finale.
 *
 * Elle exige également que le sandbox soit à l'état READY et refuse les chemins
 * absolus. Toute résolution passe par `getSandboxRoot()` au moment de l'appel :
 * la racine n'est lue qu'une seule fois ici, éliminant la fenêtre de confusion
 * où `getSandboxRoot()` pourrait changer entre une résolution et sa revalidation.
 *
 * @param requestedPath Chemin relatif au sandbox.
 * @returns Le chemin absolu canonique validé.
 * @throws SandboxGuardError si l'opération ne doit pas être autorisée.
 */
export function assertSafeSandboxPath(requestedPath: string): string {
  if (sandboxState !== "READY") {
    throw new SandboxGuardError(
      "SANDBOX_NOT_READY",
      `Écriture refusée : sandbox ${sandboxState}. Réessayez lorsque le sandbox est READY.`,
    );
  }

  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new SandboxGuardError("SANDBOX_INVALID_PATH", "Écriture refusée : chemin sandbox requis.");
  }

  const target = requestedPath.trim();
  // path.resolve peut accepter des chemins absolus Windows ou POSIX. Les
  // interdire avant la résolution garantit que seul un chemin logique relatif
  // au sandbox est admis, y compris pour les chemins drive-relative `C:foo`.
  if (
    path.isAbsolute(target)
    || path.win32.isAbsolute(target)
    || path.posix.isAbsolute(target)
    || /^[a-zA-Z]:/.test(target)
    || target.startsWith("\\\\")
  ) {
    throw new SandboxGuardError("SANDBOX_INVALID_PATH", "Écriture refusée : les chemins absolus sont interdits dans le sandbox.");
  }

  const sandboxRoot = path.resolve(getSandboxRoot());
  let sandboxRootStats: fs.Stats;
  try {
    sandboxRootStats = fs.lstatSync(sandboxRoot);
  } catch {
    throw new SandboxGuardError("SANDBOX_NOT_READY", "Écriture refusée : la racine du sandbox est introuvable.");
  }
  if (sandboxRootStats.isSymbolicLink()) {
    throw new SandboxGuardError("SANDBOX_SYMLINK", "Écriture refusée : la racine du sandbox ne peut pas être un lien symbolique.");
  }

  const realSandboxRoot = fs.realpathSync(sandboxRoot);
  const candidate = path.resolve(realSandboxRoot, target);
  const relative = path.relative(realSandboxRoot, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new SandboxGuardError("SANDBOX_PATH_ESCAPE", "Écriture refusée : le chemin sort du sandbox.");
  }

  // Refuser tout lien symbolique déjà présent sur le trajet. Les segments qui
  // n'existent pas encore seront créés sous le dernier parent sûr.
  let current = realSandboxRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new SandboxGuardError("SANDBOX_SYMLINK", "Écriture refusée : les liens symboliques sont interdits dans le sandbox.");
      }
    } catch (error: any) {
      if (error instanceof SandboxGuardError) throw error;
      if (error?.code === "ENOENT") break;
      throw new SandboxGuardError("SANDBOX_INVALID_PATH", `Écriture refusée : chemin sandbox inaccessible (${error?.message ?? "erreur inconnue"}).`);
    }
  }

  return candidate;
}

/**
 * Retourne le chemin relatif canonique d'une cible validée par le SandboxGuard.
 */
function getCanonicalSandboxRelativePath(requestedPath: string): string {
  return path.relative(fs.realpathSync(getSandboxRoot()), assertSandboxReady(requestedPath)).replace(/\\/g, "/");
}

/**
 * Verrouille immédiatement les écritures agent avant un changement de projet.
 * Cette fonction est synchrone afin qu'aucune tâche asynchrone ne puisse écrire
 * entre la sélection du projet et le début de la copie du sandbox.
 */
export function beginSandboxInitialization(): void {
  sandboxState = "INITIALIZING";
  console.log("[Sandbox] Initialisation — écritures agent bloquées jusqu'à l'état READY.");
}

/**
 * Retourne la liste des fichiers modifiés dans le sandbox (chemins relatifs).
 */
export function getSandboxModifiedFiles(): string[] {
  return [...sandboxModifiedFiles];
}

/**
 * Initialise le sandbox : copie les fichiers source depuis le repo principal.
 * Le sandbox reste verrouillé jusqu'à activateSandbox(), appelé après le
 * démarrage du watcher par le flux de sélection du projet.
 */
export async function initSandbox(): Promise<{ created: boolean; path: string; fileCount: number }> {
  if (!SELF_ROOT) {
    throw new Error("Impossible d'initialiser le sandbox : aucun projet n'est sélectionné.");
  }
  if (sandboxState !== "INITIALIZING") {
    beginSandboxInitialization();
  }

  const sandboxBase = getSandboxRoot();
  const existed = fs.existsSync(sandboxBase);

  if (!existed) {
    await fs.promises.mkdir(sandboxBase, { recursive: true });
  }

  const copied = await syncDirectory(SELF_ROOT, sandboxBase);

  sandboxModifiedFiles.clear();
  lastSyncTimestamp = Date.now();

  console.log(`[Sandbox] ${existed ? 'Rafraîchi' : 'Initialisé'}: ${copied} fichiers copiés → ${sandboxBase}`);
  return { created: !existed, path: sandboxBase, fileCount: copied };
}

/**
 * Résout un chemin relatif dans le sandbox (pour les opérations d'écriture).
 * Retourne null si le chemin sort du sandbox.
 */
export function resolveSandboxPath(target: string): string | null {
  const sandboxBase = getSandboxRoot();
  const resolved = path.resolve(sandboxBase, target);
  if (resolved === sandboxBase || resolved.startsWith(sandboxBase + path.sep)) {
    return resolved;
  }
  return null;
}

/**
 * Marque un fichier comme modifié dans le sandbox.
 */
export function markFileModified(relativePath: string): void {
  const canonicalPath = getCanonicalSandboxRelativePath(relativePath);
  const sandboxPath = assertSandboxReady(canonicalPath);
  const mainPath = path.join(SELF_ROOT, canonicalPath);

  let differs = true;
  try {
    const sandboxExists = fs.existsSync(sandboxPath);
    const mainExists = fs.existsSync(mainPath);
    if (sandboxExists === mainExists && sandboxExists) {
      const sandboxStat = fs.lstatSync(sandboxPath);
      const mainStat = fs.lstatSync(mainPath);
      if (sandboxStat.isFile() && mainStat.isFile() && sandboxStat.size === mainStat.size) {
        differs = !fs.readFileSync(sandboxPath).equals(fs.readFileSync(mainPath));
      } else if (sandboxStat.isDirectory() && mainStat.isDirectory()) {
        differs = false;
      }
    } else if (!sandboxExists && !mainExists) {
      differs = false;
    }
  } catch {
    // Conserver le marquage en cas d'erreur de lecture : la synchronisation
    // doit rester prudente et ne pas perdre une modification potentielle.
    differs = true;
  }

  if (differs) {
    sandboxModifiedFiles.add(canonicalPath);
  } else {
    sandboxModifiedFiles.delete(canonicalPath);
  }
}

/**
 * Synchronise les fichiers modifiés du sandbox vers le repo principal.
 * Crée un checkpoint dans le principal avant d'appliquer.
 * Comportement transactionnel : sauvegarde les originaux avant écriture,
 * et annule (rollback) toutes les modifications si une seule copie échoue.
 * Retourne la liste des fichiers copiés.
 */
export async function syncToMain(): Promise<{ synced: string[]; checkpointHash: string | null; rolledBack: boolean; error?: string }> {
  // Mutex : empêcher deux synchronisations concurrentes (Audit §7)
  if (syncLock) {
    return {
      synced: [],
      checkpointHash: null,
      rolledBack: false,
      error: "Synchronisation déjà en cours — opération ignorée.",
    };
  }

  let resolve: () => void;
  syncLock = new Promise<void>((r) => { resolve = r; });

  try {
    return await syncToMainInternal();
  } finally {
    syncLock = null;
    resolve!();
  }
}

async function syncToMainInternal(): Promise<{ synced: string[]; checkpointHash: string | null; rolledBack: boolean; error?: string }> {
  if (!isSandboxActive()) {
    return {
      synced: [],
      checkpointHash: null,
      rolledBack: false,
      error: `Sandbox non prêt (${sandboxState}) : synchronisation vers le principal refusée.`,
    };
  }
  if (sandboxModifiedFiles.size === 0) {
    return { synced: [], checkpointHash: null, rolledBack: false };
  }

  let checkpointHash: string | null = null;
  let modifiedList: string[];
  try {
    // Ne jamais faire confiance au set seul : chaque entrée est revalidée par
    // le SandboxGuard avant qu'une synchronisation puisse toucher le principal.
    modifiedList = [...sandboxModifiedFiles].map(getCanonicalSandboxRelativePath);
  } catch (error: any) {
    return {
      synced: [],
      checkpointHash: null,
      rolledBack: false,
      error: error?.message ?? "Chemin sandbox invalide.",
    };
  }

  try {
    const { createCheckpoint } = await import("./checkpoint.js");
    checkpointHash = await createCheckpoint(`avant sync sandbox (${sandboxModifiedFiles.size} fichiers)`);
  } catch (e) { console.warn("[Sandbox] Création du checkpoint échouée (non bloquant):", (e as Error).message); }

  const applied: string[] = [];
  const originals = new Map<string, { existed: boolean; content?: Buffer; deleted?: boolean }>();

  try {
    for (const relPath of modifiedList) {
      const sandboxFile = assertSandboxReady(relPath);
      const mainFile = path.join(SELF_ROOT, relPath);
      assertMainTargetAllowed(mainFile, relPath);

      const mainExisted = fs.existsSync(mainFile);
      const sandboxExisted = fs.existsSync(sandboxFile);

      if (mainExisted) {
        const mainStat = await fs.promises.lstat(mainFile);
        if (mainStat.isDirectory()) {
          originals.set(relPath, { existed: true, deleted: true }); // directory — can't buffer it
        } else {
          const content = await fs.promises.readFile(mainFile);
          originals.set(relPath, { existed: true, content });
        }
      } else {
        originals.set(relPath, { existed: false });
      }

      if (!sandboxExisted) {
        if (mainExisted) {
          const mainStat = await fs.promises.lstat(mainFile);
          if (mainStat.isDirectory()) {
            await fs.promises.rm(mainFile, { recursive: true, force: true });
          } else {
            await fs.promises.unlink(mainFile);
          }
          applied.push(`[DEL] ${relPath}`);
        }
      } else {
        await fs.promises.mkdir(path.dirname(mainFile), { recursive: true });
        await fs.promises.copyFile(sandboxFile, mainFile);
        applied.push(relPath);
      }
    }

    sandboxModifiedFiles.clear();
    lastSyncTimestamp = Date.now();
    // git_status vise le dépôt principal, jamais le sandbox : toute synchronisation
    // réussie invalide son cache immédiatement.
    try {
      const { gitStatusCache } = await import("../skills/git.js");
      gitStatusCache.invalidate(SELF_ROOT);
    } catch (error) {
      console.warn("[Sandbox] Invalidation du cache Git ignorée:", (error as Error).message);
    }

    console.log(`[Sandbox] Sync → principal: ${applied.length} fichier(s) appliqué(s)`);
    return { synced: applied, checkpointHash, rolledBack: false };
  } catch (e: any) {
    console.error(`[Sandbox] Échec sync après ${applied.length} fichier(s) — rollback en cours:`, e.message);

    const rollbackErrors: string[] = [];
    for (const relPath of modifiedList) {
      const orig = originals.get(relPath);
      if (!orig) continue;
      const mainFile = path.join(SELF_ROOT, relPath);
      try {
        if (orig.existed && orig.content) {
          await fs.promises.mkdir(path.dirname(mainFile), { recursive: true });
          await fs.promises.writeFile(mainFile, orig.content);
        } else if (!orig.existed && fs.existsSync(mainFile)) {
          const mainStat = await fs.promises.lstat(mainFile);
          if (mainStat.isDirectory()) {
            await fs.promises.rm(mainFile, { recursive: true, force: true });
          } else {
            await fs.promises.unlink(mainFile);
          }
        }
      } catch (rbErr: any) {
        rollbackErrors.push(`${relPath}: ${rbErr.message}`);
      }
    }

    const errorMsg = rollbackErrors.length > 0
      ? `Échec sync: ${e.message}. Rollback partiel: ${rollbackErrors.join("; ")}`
      : `Échec sync: ${e.message}. Rollback effectué avec succès.`;

    return {
      synced: [],
      checkpointHash,
      rolledBack: true,
      error: errorMsg,
    };
  }
}

/**
 * Abandonne toutes les modifications du sandbox (discard).
 * Rafraîchit le sandbox depuis le repo principal.
 */
export async function discardSandbox(): Promise<void> {
  if (!SELF_ROOT) {
    throw new Error("Aucun projet sélectionné. Impossible d'abandonner le sandbox.");
  }
  beginSandboxInitialization();
  const { stopWatching, startWatching } = await import("./sandboxWatcher.js");
  stopWatching();

  sandboxModifiedFiles.clear();
  const sandboxBase = getSandboxRoot();
  // Re-sync depuis le principal
  if (fs.existsSync(sandboxBase)) {
    await emptyDirectory(sandboxBase);
  }
  await initSandbox();
  startWatching();
  activateSandbox();
  console.log("[Sandbox] Modifications abandonnées, sandbox rafraîchi.");
}

/**
 * Accepte un fichier individuel du sandbox → l'applique au repo principal.
 * Retire le fichier de la liste des modifications en attente.
 */
export async function acceptFile(relPath: string): Promise<{ applied: boolean }> {
  let normalized: string;
  let sandboxFile: string;
  try {
    normalized = getCanonicalSandboxRelativePath(relPath);
    if (!sandboxModifiedFiles.has(normalized)) {
      return { applied: false };
    }
    sandboxFile = assertSandboxReady(normalized);
  } catch (e: any) {
    console.warn(`[Sandbox] Acceptation refusée pour ${relPath}:`, e.message);
    return { applied: false };
  }

  const mainFile = path.join(SELF_ROOT, normalized);
  try {
    assertMainTargetAllowed(mainFile, normalized);
  } catch (error: any) {
    console.warn(`[Sandbox] Acceptation refusée pour ${normalized}:`, error.message);
    return { applied: false };
  }

  try {
    if (!fs.existsSync(sandboxFile)) {
      // Deleted in sandbox → delete in main (file or directory)
      if (fs.existsSync(mainFile)) {
        const stat = await fs.promises.lstat(mainFile);
        if (stat.isDirectory()) {
          await fs.promises.rm(mainFile, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(mainFile);
        }
      }
    } else {
      // Copy sandbox → main
      await fs.promises.mkdir(path.dirname(mainFile), { recursive: true });
      await fs.promises.copyFile(sandboxFile, mainFile);
    }
    sandboxModifiedFiles.delete(normalized);
    try {
      const { gitStatusCache } = await import("../skills/git.js");
      gitStatusCache.invalidate(SELF_ROOT);
    } catch (error) {
      console.warn("[Sandbox] Invalidation du cache Git ignorée:", (error as Error).message);
    }
    console.log(`[Sandbox] Fichier accepté: ${normalized}`);
    return { applied: true };
  } catch (e: any) {
    console.error(`[Sandbox] Erreur acceptFile ${normalized}:`, e.message);
    return { applied: false };
  }
}

/**
 * Rejette un fichier individuel du sandbox → restaure la version originale dans le sandbox.
 * Retire le fichier de la liste des modifications en attente.
 */
export async function rejectFile(relPath: string): Promise<{ reverted: boolean }> {
  let normalized: string;
  let sandboxFile: string;
  try {
    normalized = getCanonicalSandboxRelativePath(relPath);
    if (!sandboxModifiedFiles.has(normalized)) {
      return { reverted: false };
    }
    sandboxFile = assertSandboxReady(normalized);
  } catch (e: any) {
    console.warn(`[Sandbox] Rejet refusé pour ${relPath}:`, e.message);
    return { reverted: false };
  }

  const mainFile = path.join(SELF_ROOT, normalized);

  try {
    if (fs.existsSync(mainFile)) {
      const mainStat = await fs.promises.lstat(mainFile);
      if (mainStat.isDirectory()) {
        // Restore directory from main → sandbox (re-sync subtree)
        await fs.promises.mkdir(sandboxFile, { recursive: true });
        await syncDirectory(mainFile, sandboxFile);
      } else {
        // Restore original file from main → sandbox
        await fs.promises.mkdir(path.dirname(sandboxFile), { recursive: true });
        await fs.promises.copyFile(mainFile, sandboxFile);
      }
    } else {
      // File/dir was added in sandbox but doesn't exist in main → remove from sandbox
      if (fs.existsSync(sandboxFile)) {
        const sbStat = await fs.promises.lstat(sandboxFile);
        if (sbStat.isDirectory()) {
          await fs.promises.rm(sandboxFile, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(sandboxFile);
        }
      }
    }
    sandboxModifiedFiles.delete(normalized);
    console.log(`[Sandbox] Fichier rejeté: ${normalized}`);
    return { reverted: true };
  } catch (e: any) {
    console.error(`[Sandbox] Erreur rejectFile ${normalized}:`, e.message);
    return { reverted: false };
  }
}

/**
 * Valide le build dans le sandbox (tsc --noEmit).
 * Retourne un résultat structuré avec diagnostics par fichier, erreurs structurées
 * et sortie brute complète (sans troncature).
 */
export async function validateSandbox(): Promise<SandboxValidationResult> {
  let rawOutput = "";
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let signal: string | null = null;
  let timedOut = false;
  let valid = false;

  try {
    const sandboxBase = getSandboxRoot();
    // Copier tsconfig et package.json dans le sandbox si absents
    for (const f of ["tsconfig.json", "package.json"]) {
      const src = path.join(SELF_ROOT, f);
      const dst = path.join(sandboxBase, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        await fs.promises.copyFile(src, dst);
      }
    }

    // Lancer tsc depuis la racine du projet principal avec un tsconfig projetant
    // sur le sandbox. Cela garantit que l'on utilise toujours les node_modules du
    // projet principal (pas ceux potentiellement présents dans le sandbox) et
    // Sur Node.js 20+, execFile trouve automatiquement npx.cmd sur Windows
    // sans avoir besoin de shell:true (qui génère un avertissement de dépréciation)
    const isWin = process.platform === "win32";
    const npxBin = isWin ? "npx.cmd" : "npx";
    const result = await execFileAsync(npxBin, ["tsc", "--noEmit", "--project", sandboxBase], {
      cwd: SELF_ROOT,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      // Pas de shell: true - Node.js 20+ gère .cmd directement
    });
    stdout = result.stdout || "";
    stderr = result.stderr || "";
    rawOutput = [stdout, stderr].filter(Boolean).join("\n");
    exitCode = 0;
    valid = true;
  } catch (e: any) {
    // tsc exit code != 0 : conserver séparément stdout, stderr et le code réel.
    stdout = typeof e.stdout === "string" ? e.stdout : "";
    stderr = typeof e.stderr === "string" ? e.stderr : "";
    exitCode = typeof e.code === "number" ? e.code : 1;
    signal = typeof e.signal === "string" ? e.signal : null;
    timedOut = e.code === "ETIMEDOUT" || e.killed === true && e.code === "ETIMEDOUT";
    const msg = (!stdout.trim() && !stderr.trim() && e.message) ? `tsc error: ${e.message}` : "";
    if (msg) stderr = msg;
    rawOutput = [stdout, stderr].filter(Boolean).join("\n");
    valid = false;
  }

  const rawDiagnostics = parseTscOutput(rawOutput);
  const sandboxBase = getSandboxRoot();

  // Normalise un chemin de fichier issu de tsc (absolu ou relatif) en chemin
  // relatif au sandbox, avec des slashes forward, pour correspondre aux clés
  // utilisées par l'UI (ex. "src/components/Foo.tsx").
  function normalizeDiagFile(filePath: string | null): string | null {
    if (!filePath) return null;
    // Résoudre le chemin absolu à partir de SELF_ROOT (cwd de tsc)
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(SELF_ROOT, filePath);
    const absNorm = abs.replace(/\\/g, "/");
    const sandboxNorm = sandboxBase.replace(/\\/g, "/");
    // Si le chemin est dans le sandbox, rendre relatif au sandbox
    if (absNorm.startsWith(sandboxNorm + "/")) {
      return absNorm.slice(sandboxNorm.length + 1);
    }
    // Sinon laisser le chemin normalisé tel quel (erreurs hors sandbox)
    return absNorm;
  }

  // Re-mapper les chemins de fichiers pour qu'ils soient relatifs au sandbox
  const diagnostics: TscDiagnostic[] = rawDiagnostics.map(d => ({
    ...d,
    file: normalizeDiagFile(d.file),
  }));

  const errorsByFile: Record<string, TscDiagnostic[]> = {};
  const globalDiagnostics: TscDiagnostic[] = [];

  for (const d of diagnostics) {
    if (!d.file) {
      globalDiagnostics.push(d);
      continue;
    }
    if (!errorsByFile[d.file]) errorsByFile[d.file] = [];
    errorsByFile[d.file].push(d);
  }

  const errorCount = diagnostics.filter(d => d.severity === "error").length;
  const warningCount = diagnostics.filter(d => d.severity === "warning").length;

  return {
    valid,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    signal,
    timedOut,
    rawOutput: rawOutput.trim(),
    diagnostics,
    globalDiagnostics,
    errorsByFile,
    errorCount,
    warningCount,
  };
}

/**
 * Réinitialise le sandbox : supprime le contenu actuel et recopie une copie fraîche
 * depuis le code source principal. Équivalent à initSandbox() mais force la recréation.
 */
export async function resetSandbox(): Promise<{ created: boolean; path: string; filesCopied: number }> {
  if (!SELF_ROOT) {
    throw new Error("Aucun projet sélectionné. Impossible de réinitialiser le sandbox.");
  }
  beginSandboxInitialization();
  const { stopWatching, startWatching } = await import("./sandboxWatcher.js");
  stopWatching();

  const sandboxBase = getSandboxRoot();
  // Supprimer le contenu existant
  if (fs.existsSync(sandboxBase)) {
    await emptyDirectory(sandboxBase);
  } else {
    await fs.promises.mkdir(sandboxBase, { recursive: true });
  }

  // Recréer le sandbox frais (même logique que initSandbox)
  const copied = await syncDirectory(SELF_ROOT, sandboxBase);

  sandboxModifiedFiles.clear();
  lastSyncTimestamp = Date.now();
  startWatching();
  activateSandbox();

  console.log(`[Sandbox] Réinitialisé: ${copied} fichiers copiés → ${sandboxBase}`);
  return { created: true, path: sandboxBase, filesCopied: copied };
}

function countLineDiff(original: string, modified: string): { additions: number; deletions: number } {
  const oldLines = original.split(/\r?\n/);
  const newLines = modified.split(/\r?\n/);
  const m = oldLines.length;
  const n = newLines.length;

  // Pour les très gros fichiers, approximation rapide pour éviter l'explosion mémoire/CPU
  if (m * n > 2000000) {
    return {
      additions: Math.max(0, n - m),
      deletions: Math.max(0, m - n),
    };
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs = dp[m][n];
  return {
    additions: n - lcs,
    deletions: m - lcs,
  };
}

/**
 * Retourne le diff (fichiers modifiés) entre le sandbox et le principal avec les stats de lignes.
 */
export async function getSandboxDiff(): Promise<Array<{ path: string; status: 'added' | 'modified' | 'deleted'; additions: number; deletions: number }>> {
  const diffs: Array<{ path: string; status: 'added' | 'modified' | 'deleted'; additions: number; deletions: number }> = [];

  for (const relPath of sandboxModifiedFiles) {
    let canonicalPath: string;
    let sandboxFile: string;
    try {
      canonicalPath = getCanonicalSandboxRelativePath(relPath);
      sandboxFile = assertSandboxReady(canonicalPath);
    } catch {
      // Une entrée corrompue ne doit ni exposer de chemin ni influencer le diff.
      continue;
    }
    const mainFile = path.join(SELF_ROOT, canonicalPath);

    const existsInSandbox = fs.existsSync(sandboxFile);
    const existsInMain = fs.existsSync(mainFile);

    try {
      if (existsInSandbox && !existsInMain) {
        const content = fs.readFileSync(sandboxFile, 'utf-8');
        const lineCount = content.split(/\r?\n/).length;
        diffs.push({ path: canonicalPath, status: 'added', additions: lineCount, deletions: 0 });
      } else if (!existsInSandbox && existsInMain) {
        const content = fs.readFileSync(mainFile, 'utf-8');
        const lineCount = content.split(/\r?\n/).length;
        diffs.push({ path: canonicalPath, status: 'deleted', additions: 0, deletions: lineCount });
      } else if (existsInSandbox && existsInMain) {
        const mainContent = fs.readFileSync(mainFile, 'utf-8');
        const sandboxContent = fs.readFileSync(sandboxFile, 'utf-8');
        const { additions, deletions } = countLineDiff(mainContent, sandboxContent);
        diffs.push({ path: canonicalPath, status: 'modified', additions, deletions });
      }
    } catch {
      // Si erreur de lecture (ex: binaire), on met quand même l'entrée
      if (existsInSandbox && !existsInMain) {
        diffs.push({ path: canonicalPath, status: 'added', additions: 0, deletions: 0 });
      } else if (!existsInSandbox && existsInMain) {
        diffs.push({ path: canonicalPath, status: 'deleted', additions: 0, deletions: 0 });
      } else if (existsInSandbox && existsInMain) {
        diffs.push({ path: canonicalPath, status: 'modified', additions: 0, deletions: 0 });
      }
    }
  }

  return diffs;
}

/**
 * Retourne l'état complet du sandbox.
 */
export function getSandboxStatus() {
  const sandboxBase = getSandboxRoot();
  return {
    state: sandboxState,
    active: isSandboxActive(),
    writable: isSandboxActive(),
    path: sandboxBase,
    modifiedFiles: [...sandboxModifiedFiles],
    modifiedCount: sandboxModifiedFiles.size,
    lastSync: lastSyncTimestamp ? new Date(lastSyncTimestamp).toISOString() : null,
    exists: fs.existsSync(sandboxBase),
  };
}

/**
 * Désactive le sandbox et bloque les écritures agent. Le dépôt principal n'est
 * jamais utilisé comme fallback d'écriture par les skills.
 */
export function deactivateSandbox(): void {
  sandboxState = "DISABLED";
  console.log("[Sandbox] Désactivé — écritures agent bloquées.");
}

/**
 * Publie un sandbox complètement initialisé comme destination d'écriture.
 */
export function activateSandbox(): void {
  if (!SELF_ROOT || !fs.existsSync(getSandboxRoot())) {
    throw new Error("Impossible d'activer le sandbox : la copie isolée est absente.");
  }
  sandboxState = "READY";
  console.log("[Sandbox] READY — les écritures agent sont isolées dans le sandbox.");
}

/**
 * Change de projet sans jamais exposer SELF_ROOT comme destination d'écriture.
 * READY n'est publié qu'après la copie complète et le redémarrage du watcher.
 */
export async function switchSandboxProject(projectPath: string): Promise<string> {
  beginSandboxInitialization();
  const { stopWatching, startWatching } = await import("./sandboxWatcher.js");
  stopWatching();

  const { setSelfRoot } = await import("./selfRoot.js");
  const newRoot = setSelfRoot(projectPath);
  await initSandbox();
  startWatching();
  activateSandbox();
  return newRoot;
}

// ── Helpers internes ─────────────────────────────────────────────────────────

/**
 * Supprime le contenu d'un dossier sans supprimer le dossier racine lui-même.
 * Évite les verrous Windows sur le descripteur de dossier parent.
 */
async function emptyDirectory(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) return;
  const entries = await fs.promises.readdir(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      await fs.promises.rm(fullPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (e: any) {
      console.warn(`[Sandbox] Avertissement suppression ${fullPath}:`, e.message);
    }
  }
}

/**
 * Copie récursivement un dossier source vers une destination,
 * en excluant les patterns définis.
 */
async function syncDirectory(src: string, dst: string, relativeTo?: string): Promise<number> {
  const base = relativeTo || src;
  let count = 0;

  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = path.relative(base, path.join(src, entry.name)).replace(/\\/g, "/");

    // Vérifier les exclusions
    if (EXCLUDE_PATTERNS.some(p => relPath === p || relPath.startsWith(p + "/"))) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      await fs.promises.mkdir(dstPath, { recursive: true });
      count += await syncDirectory(srcPath, dstPath, base);
    } else if (entry.isFile()) {
      await fs.promises.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.promises.copyFile(srcPath, dstPath);
      count++;
    }
  }

  return count;
}
