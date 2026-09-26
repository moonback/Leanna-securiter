/**
 * selfRoot.ts — Source unique de vérité pour le répertoire racine du projet actif.
 *
 * Leanna est un IDE universel multi-projets : l'utilisateur choisit un projet
 * externe via la modal de sélection, l'IA travaille dessus, et peut en changer
 * à tout moment. Ce module centralise la résolution du root (SELF_ROOT) et
 * fournit les garde-fous de chemin utilisés par tous les skills et routes.
 *
 * NOUVEAU : Au démarrage sans projet sélectionné, SELF_ROOT est "" (vide).
 * Toutes les initialisations dépendantes du projet (ProjectMemory, Sandbox,
 * KnowledgeGraph) sont déclenchées uniquement après setSelfRoot().
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { isIgnoredForWrite } from "./leannaignore.js";

/**
 * Résout le dossier du module courant de façon robuste.
 * En ESM (dev via tsx), utilise import.meta.url.
 * En CJS bundlé (production esbuild), import.meta.url est vide → fallback sur
 * __dirname natif CJS ou process.cwd().
 */
function resolveModuleDir(): string {
  try {
    // @ts-ignore — import.meta peut être vide en sortie CJS
    const metaUrl = typeof import.meta !== "undefined" ? import.meta.url : "";
    if (metaUrl) {
      return path.dirname(fileURLToPath(metaUrl));
    }
  } catch { /* import.meta indisponible en CJS */ }
  // Fallback CJS : __dirname est défini par le bundle esbuild
  if (typeof __dirname !== "undefined") return __dirname;
  return process.cwd();
}

const __moduleDir = resolveModuleDir();

// ── Leanna app root (le dossier de Leanna lui-même, immuable) ─────────────────

/**
 * Résout le dossier de l'app Leanna (là où tourne server.ts).
 * Utilisé uniquement pour trouver les fichiers de config internes à Leanna
 * (ex : persistedProject.json). Ne doit PAS être utilisé comme workspace projet.
 */
function resolveLeannaAppRoot(): string {
  // Remonter de server/utils/ → root de l'app Leanna
  const fromModule = path.resolve(__moduleDir, "..", "..");
  const pkg = path.join(fromModule, "package.json");
  if (fs.existsSync(pkg)) return fromModule;
  return process.cwd();
}

const Leanna_APP_ROOT = resolveLeannaAppRoot();
export { Leanna_APP_ROOT };

// ── Persistance du projet sélectionné et Registre Multi-Workspace ────────────

/**
 * Fichier de config interne (dans le dossier Leanna) qui mémorise
 * le dernier projet sélectionné par l'utilisateur.
 */
function getPersistedProjectPath(): string {
  return path.join(Leanna_APP_ROOT, ".Leanna", "lastProject.json");
}

/**
 * Fichier de config interne qui mémorise la liste de tous les workspaces connus.
 */
function getPersistedWorkspacesPath(): string {
  return path.join(Leanna_APP_ROOT, ".Leanna", "workspaces.json");
}

export interface FtpWorkspaceConfig {
  host: string;
  port: number;
  user: string;
  remotePath: string;
  secure: boolean;
  /** Le mot de passe n'est jamais persisté — uniquement conservé en mémoire de session. */
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
  siteUrl?: string;
  lastOpened: string;
  createdAt: string;
  isGit: boolean;
  gitBranch?: string;
  /** Présent uniquement pour les workspaces créés par connexion FTP. */
  isFtp?: boolean;
  ftpConfig?: FtpWorkspaceConfig;
}

export interface WorkspaceValidationResult {
  valid: boolean;
  resolvedPath: string | null;
  error?: string;
  isGit: boolean;
  gitBranch?: string;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  suspiciousSymlinksCount: number;
}

interface PersistedProjectData {
  projectRoot: string;
  /** URL optionnelle du site associé au projet (docs, app déployée, etc.) */
  siteUrl?: string;
}

function generateWorkspaceId(targetPath: string): string {
  const normalized = path.resolve(targetPath).toLowerCase().replace(/\\/g, "/");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  const cleanName = path.basename(targetPath).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return `${cleanName || "workspace"}_${Math.abs(hash).toString(36)}`;
}

export function loadWorkspaces(): WorkspaceEntry[] {
  try {
    const configPath = getPersistedWorkspacesPath();
    if (!fs.existsSync(configPath)) return [];
    const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (Array.isArray(data)) {
      return data.filter(
        (item): item is WorkspaceEntry =>
          Boolean(item && typeof item.path === "string" && typeof item.id === "string")
      );
    }
  } catch (e) {
    if (process.env.LOG_LEVEL === "debug") {
      console.debug("[SelfRoot] loadWorkspaces ignoré:", (e as Error).message);
    }
  }
  return [];
}

export function saveWorkspaces(workspaces: WorkspaceEntry[]): void {
  try {
    const configPath = getPersistedWorkspacesPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(workspaces, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[SelfRoot] Impossible de sauvegarder les workspaces:", e.message);
  }
}

export function listWorkspaces(): WorkspaceEntry[] {
  const workspaces = loadWorkspaces();
  // Trier par date de dernier accès décroissante
  return workspaces.sort(
    (a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime()
  );
}

export function addOrUpdateWorkspace(
  projectPath: string,
  siteUrl?: string,
  customName?: string
): WorkspaceEntry {
  const resolved = path.resolve(projectPath);
  const workspaces = loadWorkspaces();
  const existingIndex = workspaces.findIndex(
    (w) => path.resolve(w.path).toLowerCase() === resolved.toLowerCase()
  );

  const isGit = fs.existsSync(path.join(resolved, ".git"));
  let gitBranch: string | undefined;
  if (isGit) {
    try {
      const headPath = path.join(resolved, ".git", "HEAD");
      if (fs.existsSync(headPath)) {
        const headContent = fs.readFileSync(headPath, "utf-8").trim();
        if (headContent.startsWith("ref: refs/heads/")) {
          gitBranch = headContent.replace("ref: refs/heads/", "").trim();
        } else {
          gitBranch = headContent.substring(0, 7);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const now = new Date().toISOString();
  let entry: WorkspaceEntry;

  if (existingIndex >= 0) {
    const existing = workspaces[existingIndex];
    entry = {
      ...existing,
      path: resolved,
      name: customName?.trim() || existing.name || path.basename(resolved) || "Workspace",
      siteUrl: siteUrl !== undefined ? (siteUrl.trim() || undefined) : existing.siteUrl,
      lastOpened: now,
      isGit,
      gitBranch: gitBranch || existing.gitBranch,
    };
    workspaces[existingIndex] = entry;
  } else {
    entry = {
      id: generateWorkspaceId(resolved),
      name: customName?.trim() || path.basename(resolved) || "Workspace",
      path: resolved,
      siteUrl: siteUrl?.trim() || undefined,
      lastOpened: now,
      createdAt: now,
      isGit,
      gitBranch,
    };
    workspaces.unshift(entry);
  }

  saveWorkspaces(workspaces);
  return entry;
}

export function removeWorkspace(idOrPath: string): boolean {
  const workspaces = loadWorkspaces();
  const target = idOrPath.trim().toLowerCase();
  const filtered = workspaces.filter(
    (w) => w.id.toLowerCase() !== target && path.resolve(w.path).toLowerCase() !== path.resolve(idOrPath).toLowerCase()
  );
  if (filtered.length !== workspaces.length) {
    saveWorkspaces(filtered);
    return true;
  }
  return false;
}

export function updateWorkspaceMeta(
  idOrPath: string,
  updates: { name?: string; siteUrl?: string }
): WorkspaceEntry | null {
  const workspaces = loadWorkspaces();
  const target = idOrPath.trim().toLowerCase();
  const idx = workspaces.findIndex(
    (w) => w.id.toLowerCase() === target || path.resolve(w.path).toLowerCase() === path.resolve(idOrPath).toLowerCase()
  );
  if (idx < 0) return null;

  const current = workspaces[idx];
  const updated: WorkspaceEntry = {
    ...current,
    name: updates.name?.trim() ? updates.name.trim() : current.name,
    siteUrl: updates.siteUrl !== undefined ? (updates.siteUrl.trim() || undefined) : current.siteUrl,
  };
  workspaces[idx] = updated;
  saveWorkspaces(workspaces);

  // Si c'est le workspace actif, mettre à jour WORKSPACE_SITE_URL
  if (path.resolve(current.path).toLowerCase() === path.resolve(SELF_ROOT).toLowerCase()) {
    if (updates.siteUrl !== undefined) {
      WORKSPACE_SITE_URL = updates.siteUrl.trim();
    }
  }

  return updated;
}

/**
 * Valide un chemin de workspace candidat avant ouverture.
 * Empêche d'ouvrir des répertoires systèmes dangereux ou des chemins invalides.
 */
export async function validateWorkspacePath(candidatePath: string): Promise<WorkspaceValidationResult> {
  if (!candidatePath || !candidatePath.trim()) {
    return {
      valid: false,
      resolvedPath: null,
      error: "Le chemin du dossier est requis.",
      isGit: false,
      hasPackageJson: false,
      hasTsConfig: false,
      suspiciousSymlinksCount: 0,
    };
  }

  const resolved = path.resolve(candidatePath.trim());

  // 1. Interdire les racines de disques ou répertoires système critiques
  const isRootOrSystem = isProhibitedSystemPath(resolved);
  if (isRootOrSystem) {
    return {
      valid: false,
      resolvedPath: resolved,
      error: `Ouverture refusée : '${resolved}' est un répertoire système ou une racine de disque protégé.`,
      isGit: false,
      hasPackageJson: false,
      hasTsConfig: false,
      suspiciousSymlinksCount: 0,
    };
  }

  // 2. Vérifier existence et type dossier
  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      resolvedPath: resolved,
      error: `Le chemin spécifié n'existe pas : ${resolved}`,
      isGit: false,
      hasPackageJson: false,
      hasTsConfig: false,
      suspiciousSymlinksCount: 0,
    };
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return {
        valid: false,
        resolvedPath: resolved,
        error: `Le chemin spécifié n'est pas un dossier : ${resolved}`,
        isGit: false,
        hasPackageJson: false,
        hasTsConfig: false,
        suspiciousSymlinksCount: 0,
      };
    }
  } catch (e: any) {
    return {
      valid: false,
      resolvedPath: resolved,
      error: `Impossible d'accéder au dossier : ${e.message}`,
      isGit: false,
      hasPackageJson: false,
      hasTsConfig: false,
      suspiciousSymlinksCount: 0,
    };
  }

  // 3. Inspecter git, package.json, tsconfig.json
  const isGit = fs.existsSync(path.join(resolved, ".git"));
  let gitBranch: string | undefined;
  if (isGit) {
    try {
      const headPath = path.join(resolved, ".git", "HEAD");
      if (fs.existsSync(headPath)) {
        const headContent = fs.readFileSync(headPath, "utf-8").trim();
        if (headContent.startsWith("ref: refs/heads/")) {
          gitBranch = headContent.replace("ref: refs/heads/", "").trim();
        } else {
          gitBranch = headContent.substring(0, 7);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const hasPackageJson = fs.existsSync(path.join(resolved, "package.json"));
  const hasTsConfig = fs.existsSync(path.join(resolved, "tsconfig.json"));

  return {
    valid: true,
    resolvedPath: resolved,
    isGit,
    gitBranch,
    hasPackageJson,
    hasTsConfig,
    suspiciousSymlinksCount: 0,
  };
}

/**
 * Détecte si un chemin cible une racine de système ou un répertoire critique interdit.
 */
function isProhibitedSystemPath(resolved: string): boolean {
  const norm = resolved.replace(/\\/g, "/").toLowerCase();
  // Racines Windows ou POSIX: C:/, D:/, /
  if (/^[a-z]:\/?$/i.test(norm) || norm === "/") {
    return true;
  }
  // Répertoires Windows sensibles
  const prohibitedPrefixes = [
    "c:/windows",
    "c:/program files",
    "c:/program files (x86)",
    "c:/programdata",
    "/etc",
    "/sys",
    "/proc",
    "/root",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
  ];
  return prohibitedPrefixes.some(
    (prefix) => norm === prefix || norm.startsWith(prefix + "/")
  );
}

function loadPersistedProject(): PersistedProjectData | null {
  try {
    const configPath = getPersistedProjectPath();
    if (!fs.existsSync(configPath)) return null;
    const data = JSON.parse(fs.readFileSync(configPath, "utf-8")) as PersistedProjectData;
    if (data?.projectRoot && typeof data.projectRoot === "string") {
      const resolved = path.resolve(data.projectRoot);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return { projectRoot: resolved, siteUrl: data.siteUrl || undefined };
      }
    }
  } catch (e) {
    // Mode dégradé : fichier absent ou corrompu → aucun projet restauré
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug("[SelfRoot] loadPersistedProject ignoré:", (e as Error).message);
    }
  }
  return null;
}

function persistProject(projectRoot: string, siteUrl?: string): void {
  try {
    const configPath = getPersistedProjectPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const data: PersistedProjectData = { projectRoot };
    if (siteUrl) data.siteUrl = siteUrl;
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[SelfRoot] Impossible de persister le projet:", e.message);
  }
}

function clearPersistedProject(): void {
  try {
    const configPath = getPersistedProjectPath();
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch (e) {
    console.warn("[SelfRoot] clearPersistedProject ignoré:", (e as Error).message);
  }
}

// ── SELF_ROOT ─────────────────────────────────────────────────────────────────

/**
 * Racine du workspace projet actif.
 * "" (chaîne vide) = aucun projet sélectionné (état initial).
 * Peut être changée dynamiquement via setSelfRoot().
 */
export let SELF_ROOT: string = "";

/**
 * URL optionnelle du site associé au projet actif (docs, app déployée…).
 * "" = aucune URL configurée.
 */
export let WORKSPACE_SITE_URL: string = "";

/**
 * Retourne true si un projet est actuellement actif.
 */
export function hasProject(): boolean {
  return SELF_ROOT !== "";
}

/**
 * Initialise SELF_ROOT (et WORKSPACE_SITE_URL) depuis le projet persisté.
 * À appeler UNE SEULE FOIS au démarrage du serveur.
 * Si aucun projet n'est persisté, SELF_ROOT reste "" et
 * le serveur démarre en mode "aucun projet".
 */
export function initSelfRoot(): void {
  // Override explicite (tests/CI uniquement)
  if (process.env.Leanna_SELF_ROOT_OVERRIDE?.trim()) {
    const override = process.env.Leanna_SELF_ROOT_OVERRIDE.trim();
    if (fs.existsSync(override) && fs.statSync(override).isDirectory()) {
      SELF_ROOT = path.resolve(override);
      addOrUpdateWorkspace(SELF_ROOT, WORKSPACE_SITE_URL || undefined);
      console.log(`[SelfRoot] Override actif: ${SELF_ROOT}`);
      return;
    }
  }

  // Toujours démarrer sans projet actif : l'utilisateur doit choisir un workspace
  // via le sélecteur Multi-Workspace à chaque démarrage.
  // La liste des workspaces récents (workspaces.json) est conservée pour la sélection rapide.
  SELF_ROOT = "";
  WORKSPACE_SITE_URL = "";
  console.log("[SelfRoot] Démarrage sans projet — sélecteur Multi-Workspace requis.");
}

/**
 * Change la racine du workspace à chaud.
 * Valide que le chemin existe et contient du code source.
 * siteUrl est optionnel — s'il est undefined, la valeur existante est conservée.
 * Enregistre le workspace dans le registre multi-workspace.
 * Retourne le nouveau chemin ou lève une erreur.
 */
export function setSelfRoot(newPath: string, siteUrl?: string, customName?: string): string {
  const resolved = path.resolve(newPath);
  if (isProhibitedSystemPath(resolved)) {
    throw new Error(`Chemin interdit (racine ou répertoire système) : ${resolved}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Le chemin n'existe pas: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Le chemin n'est pas un dossier: ${resolved}`);
  }
  SELF_ROOT = resolved;
  // siteUrl explicitement passé (même "") remplace l'ancienne valeur
  if (siteUrl !== undefined) {
    WORKSPACE_SITE_URL = siteUrl.trim();
  }
  persistProject(resolved, WORKSPACE_SITE_URL || undefined);
  // Enregistrer ou mettre à jour dans le registre multi-workspaces
  addOrUpdateWorkspace(resolved, WORKSPACE_SITE_URL || undefined, customName);
  console.log(`[SelfRoot] Leanna root verrouillé: ${SELF_ROOT}`);
  if (WORKSPACE_SITE_URL) {
    console.log(`[SelfRoot] URL site persistée: ${WORKSPACE_SITE_URL}`);
  }
  return SELF_ROOT;
}

/**
 * Met à jour uniquement l'URL du site sans changer le projet actif.
 */
export function setWorkspaceSiteUrl(url: string): void {
  WORKSPACE_SITE_URL = url.trim();
  if (SELF_ROOT) {
    persistProject(SELF_ROOT, WORKSPACE_SITE_URL || undefined);
    addOrUpdateWorkspace(SELF_ROOT, WORKSPACE_SITE_URL || undefined);
  }
  console.log(`[SelfRoot] URL site mise à jour: ${WORKSPACE_SITE_URL || "(effacée)"}`);
}

/**
 * Réinitialise le workspace : remet SELF_ROOT et WORKSPACE_SITE_URL à "" en mémoire
 * et supprime le fichier de persistance lastProject.json.
 * Note : les entrées dans workspaces.json sont conservées pour permettre la re-sélection rapide.
 */
export function resetSelfRoot(): void {
  SELF_ROOT = "";
  WORKSPACE_SITE_URL = "";
  clearPersistedProject();
  console.log('[SelfRoot] Workspace réinitialisé — aucun projet actif.');
}

// ── Fichiers protégés ────────────────────────────────────────────────────────

/**
 * Fichiers/patterns dont l'écriture ou la suppression nécessitent une
 * confirmation explicite de l'utilisateur (pas d'auto-apply silencieux).
 */
export const CRITICAL_FILES: readonly string[] = [
  "server.ts",
  "server/security.ts",
  "server/utils/selfRoot.ts",
  "electron/main.cjs",
  "electron/preload.cjs",
  ".env",
  ".env.local",
  ".gemini-keys.json",
];

/**
 * Fichiers/dossiers totalement interdits en écriture/suppression,
 * même avec confirmation utilisateur.
 */
export const FORBIDDEN_WRITE_TARGETS: readonly string[] = [
  ".git/config",
  ".git/HEAD",
  "node_modules",
];

// ── Validation de chemin ─────────────────────────────────────────────────────

/**
 * Résout un chemin relatif par rapport au SELF_ROOT et vérifie qu'il
 * ne sort pas du périmètre. Retourne le chemin absolu normalisé ou null.
 * Retourne null si aucun projet n'est actif.
 */
export function normalizeSelfPath(target: string): string | null {
  if (!SELF_ROOT) return null;
  const resolved = path.resolve(SELF_ROOT, target);
  if (resolved === SELF_ROOT || resolved.startsWith(SELF_ROOT + path.sep)) {
    return resolved;
  }
  return null;
}

/**
 * Vérifie qu'un chemin absolu résolu (après normalisation) ne cible pas
 * un fichier interdit en écriture. Deux sources d'interdiction :
 *   1. FORBIDDEN_WRITE_TARGETS — cibles durcies en dur.
 *   2. `.leannaignore` — liste d'exclusion définie par l'utilisateur à la
 *      racine du projet (dossiers/motifs que l'agent ne peut pas modifier).
 * Retourne true (interdit) si aucun projet actif.
 */
export function isWriteForbidden(absolutePath: string): boolean {
  if (!SELF_ROOT) return true;
  const relative = path.relative(SELF_ROOT, absolutePath).replace(/\\/g, "/");

  // 1. Cibles interdites en dur (jamais modifiables).
  const hardForbidden = FORBIDDEN_WRITE_TARGETS.some(
    (pattern) => relative === pattern || relative.startsWith(pattern + "/")
  );
  if (hardForbidden) return true;

  // 2. Liste d'exclusion utilisateur (.leannaignore à la racine du projet).
  //    Les dossiers/motifs listés sont interdits en écriture à l'agent.
  return isIgnoredForWrite(SELF_ROOT, absolutePath);
}

/**
 * Vérifie si un fichier est critique (nécessite confirmation).
 */
export function isCriticalFile(absolutePath: string): boolean {
  if (!SELF_ROOT) return true;
  const relative = path.relative(SELF_ROOT, absolutePath).replace(/\\/g, "/");
  return CRITICAL_FILES.some(
    (pattern) => relative === pattern || relative.startsWith(pattern + "/")
  );
}

/**
 * SECURITY: Résout les symlinks et vérifie que le chemin réel reste
 * dans le SELF_ROOT. Protège contre les symlink escape attacks.
 */
export async function resolveRealPathWithinSelf(candidatePath: string): Promise<string | null> {
  if (!SELF_ROOT) return null;
  try {
    const [realCandidate, realRoot] = await Promise.all([
      fs.promises.realpath(candidatePath),
      fs.promises.realpath(SELF_ROOT),
    ]);
    if (realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep)) {
      return realCandidate;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Symlink audit ─────────────────────────────────────────────────────────────

/**
 * Scanne les répertoires source pour détecter des symlinks potentiellement
 * dangereuses qui pourraient permettre de sortir du SELF_ROOT.
 * Ne bloque pas le démarrage — log un avertissement.
 * Ne fait rien si aucun projet n'est actif.
 */
export async function auditSymlinks(): Promise<string[]> {
  if (!SELF_ROOT) return [];
  const suspicious: string[] = [];
  const dirsToScan = ['src', 'server', 'electron'];

  for (const dir of dirsToScan) {
    const fullDir = path.join(SELF_ROOT, dir);
    try {
      await scanForSymlinks(fullDir, suspicious);
    } catch { /* dir might not exist */ }
  }

  if (suspicious.length > 0) {
    console.warn(`[SelfRoot] ⚠️ ${suspicious.length} symlink(s) suspecte(s) détectée(s):`);
    for (const s of suspicious) {
      console.warn(`  → ${s}`);
    }
  }

  return suspicious;
}

async function scanForSymlinks(dir: string, results: string[], depth = 0): Promise<void> {
  if (depth > 5) return;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          const realPath = await fs.promises.realpath(fullPath);
          if (!realPath.startsWith(SELF_ROOT)) {
            results.push(`${path.relative(SELF_ROOT, fullPath)} → ${realPath} [HORS PÉRIMÈTRE]`);
          }
        } catch {
          results.push(`${path.relative(SELF_ROOT, fullPath)} → [CASSÉ/INACCESSIBLE]`);
        }
      } else if (entry.isDirectory()) {
        await scanForSymlinks(fullPath, results, depth + 1);
      }
    }
  } catch { /* permission denied or similar */ }
}

// ── FTP Server Registry ───────────────────────────────────────────────────────
//
// Persiste la liste des serveurs FTP connus dans .Leanna/ftp-servers.json.
// Le mot de passe n'est JAMAIS persisté — l'utilisateur le resaisit à chaque
// connexion. Seules les métadonnées de connexion (hôte, port, user, chemin,
// secure) sont sauvegardées.

export interface FtpServerEntry {
  /** Identifiant unique dérivé de host+port+user+path */
  id: string;
  host: string;
  port: number;
  user: string;
  remotePath: string;
  secure: boolean;
  /** Nom d'affichage libre (ex: "Mon site o2switch") */
  name: string;
  lastConnected: string;
  createdAt: string;
  /** Chemin du miroir local (si déjà téléchargé) */
  localMirrorPath?: string;
}

function getFtpServersPath(): string {
  return path.join(Leanna_APP_ROOT, ".Leanna", "ftp-servers.json");
}

function generateFtpServerId(host: string, port: number, user: string, remotePath: string): string {
  const raw = `${host.toLowerCase()}:${port}:${user.toLowerCase()}:${remotePath}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  const slug = host.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20);
  return `${slug}_${Math.abs(hash).toString(36)}`;
}

export function loadFtpServers(): FtpServerEntry[] {
  try {
    const p = getFtpServersPath();
    if (!fs.existsSync(p)) return [];
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (Array.isArray(data)) {
      return data.filter(
        (item): item is FtpServerEntry =>
          Boolean(item && typeof item.host === "string" && typeof item.id === "string")
      );
    }
  } catch (e) {
    if (process.env.LOG_LEVEL === "debug") {
      console.debug("[SelfRoot] loadFtpServers ignoré:", (e as Error).message);
    }
  }
  return [];
}

function saveFtpServersList(servers: FtpServerEntry[]): void {
  try {
    const p = getFtpServersPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(servers, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[SelfRoot] Impossible de sauvegarder les serveurs FTP:", e.message);
  }
}

/**
 * Ajoute ou met à jour un serveur FTP dans le registre persisté.
 * Appelé automatiquement après une connexion réussie.
 */
export function saveFtpServer(
  host: string,
  port: number,
  user: string,
  remotePath: string,
  secure: boolean,
  options?: { name?: string; localMirrorPath?: string }
): FtpServerEntry {
  const servers = loadFtpServers();
  const id = generateFtpServerId(host, port, user, remotePath);
  const now = new Date().toISOString();

  const existingIdx = servers.findIndex((s) => s.id === id);
  const displayName =
    options?.name?.trim() ||
    (existingIdx >= 0 ? servers[existingIdx].name : undefined) ||
    `${host}${remotePath !== "/" ? remotePath : ""}`;

  const entry: FtpServerEntry = {
    id,
    host,
    port,
    user,
    remotePath,
    secure,
    name: displayName,
    lastConnected: now,
    createdAt: existingIdx >= 0 ? servers[existingIdx].createdAt : now,
    localMirrorPath: options?.localMirrorPath ?? (existingIdx >= 0 ? servers[existingIdx].localMirrorPath : undefined),
  };

  if (existingIdx >= 0) {
    servers[existingIdx] = entry;
  } else {
    servers.unshift(entry);
  }

  saveFtpServersList(servers);
  return entry;
}

/**
 * Supprime un serveur FTP du registre (ne supprime pas le miroir local).
 */
export function removeFtpServer(id: string): boolean {
  const servers = loadFtpServers();
  const filtered = servers.filter((s) => s.id !== id);
  if (filtered.length !== servers.length) {
    saveFtpServersList(filtered);
    return true;
  }
  return false;
}

/**
 * Retourne la liste des serveurs FTP triés par date de dernière connexion.
 */
export function listFtpServers(): FtpServerEntry[] {
  return loadFtpServers().sort(
    (a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime()
  );
}

/**
 * Met à jour le nom d'affichage d'un serveur FTP.
 */
export function renameFtpServer(id: string, name: string): FtpServerEntry | null {
  const servers = loadFtpServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  servers[idx] = { ...servers[idx], name: name.trim() || servers[idx].name };
  saveFtpServersList(servers);
  return servers[idx];
}
