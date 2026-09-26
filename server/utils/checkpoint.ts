/**
 * checkpoint.ts — Système de checkpoints (DÉSACTIVÉ)
 *
 * Git est entièrement désactivé. Toutes les fonctions retournent
 * immédiatement sans exécuter de commandes git.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { SELF_ROOT } from "./selfRoot.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 2 * 1024 * 1024;

// Conservé pour compatibilité API — no-op
export function setCheckpointProfileGetter(_getter: () => any) {}

/**
 * Crée un commit checkpoint — DÉSACTIVÉ, retourne toujours null.
 */
export async function createCheckpoint(_reason: string): Promise<string | null> {
  return null;
}

/**
 * Rollback vers un commit — DÉSACTIVÉ, retourne toujours false.
 */
export async function rollbackToCheckpoint(_commitHash: string): Promise<boolean> {
  return false;
}

/**
 * Liste les checkpoints — DÉSACTIVÉ, retourne toujours [].
 */
export async function listCheckpoints(_count = 10): Promise<Array<{ hash: string; date: string; message: string }>> {
  return [];
}

/**
 * Valide le code après modifications (tsc --noEmit).
 * Retourne { valid: true } ou { valid: false, errors: string }.
 */
export async function validateBuild(): Promise<{ valid: boolean; errors?: string }> {
  // Sur Node.js 20+, execFile trouve automatiquement npx.cmd sur Windows
  // sans avoir besoin de shell:true (qui génère un avertissement de dépréciation)
  const isWin = process.platform === 'win32';
  const npxBin = isWin ? 'npx.cmd' : 'npx';
  
  try {
    await execFileAsync(npxBin, ["tsc", "--noEmit"], {
      cwd: SELF_ROOT,
      timeout: 60_000,
      maxBuffer: MAX_BUFFER,
      // Pas de shell: true - Node.js 20+ gère .cmd directement
      env: { ...process.env },
    });
    return { valid: true };
  } catch (e: any) {
    const output = (e.stdout || "") + "\n" + (e.stderr || "");
    if (e.code === "ENOENT" || (e.message && e.message.includes("ENOENT"))) {
      return { valid: false, errors: "npx introuvable dans le PATH." };
    }
    return { valid: false, errors: output.trim() };
  }
}
