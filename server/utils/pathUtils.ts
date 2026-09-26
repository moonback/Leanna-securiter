/**
 * pathUtils.ts — Module centralisé pour la résolution et validation des chemins.
 *
 * Regroupe les utilitaires de chemin éparpillés dans selfRoot.ts,
 * codebaseHelpers.ts, security.ts et sandbox.ts (Audit §3).
 *
 * Ce module ré-exporte les fonctions existantes depuis leur source canonique
 * pour unifier les imports et éviter la duplication.
 */

import path from "path";
import fs from "fs";

// ── Ré-exports canoniques ─────────────────────────────────────────────────────

export {
  SELF_ROOT,
  hasProject,
  normalizeSelfPath,
  isWriteForbidden,
  isCriticalFile,
  resolveRealPathWithinSelf,
  listWorkspaces,
  validateWorkspacePath,
  type WorkspaceEntry,
  type WorkspaceValidationResult,
} from "./selfRoot.js";

export {
  resolveWorkspacePath,
  getDefaultWorkspaceRoot,
} from "../security.js";

export {
  LEANNAIGNORE_FILENAME,
  isIgnoredForWrite,
  loadIgnoreRules,
  parseIgnoreContent,
  compileIgnorePattern,
  getIgnoreFilePath,
  clearIgnoreCache,
  type IgnoreRule,
} from "./leannaignore.js";

export {
  isSandboxActive,
  getSandboxRoot,
  assertSandboxReady,
  resolveSandboxPath,
} from "./sandbox.js";

export {
  normalizeProjectPath,
  getProjectRoot,
  resolveWritePath,
  resolveSandboxWriteTarget,
} from "../skills/codebaseHelpers.js";

// ── Utilitaires additionnels ─────────────────────────────────────────────────

/**
 * Vérifie si un chemin tente de remonter au-delà du root via `..`.
 * Retourne true si le chemin est potentiellement dangereux.
 */
export function isPathEscape(target: string, root: string): boolean {
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * Vérifie qu'un chemin est purement relatif (pas absolu, pas Windows drive,
 * pas UNC). Utilisable comme pré-validation avant toute résolution.
 */
export function isStrictlyRelative(target: string): boolean {
  if (!target || !target.trim()) return false;
  const t = target.trim();
  return (
    !path.isAbsolute(t) &&
    !path.win32.isAbsolute(t) &&
    !path.posix.isAbsolute(t) &&
    !/^[a-zA-Z]:/.test(t) &&
    !t.startsWith("\\\\")
  );
}

/**
 * Normalise un chemin pour le cross-platform (forward slashes).
 */
export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}
