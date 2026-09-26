import * as fs from "fs";
import * as path from "path";
import type { ToolPermission } from "../runtime/types.js";
import { SIDE_EFFECT_PERMISSIONS } from "../runtime/DryRun.js";

// ═══════════════════════════════════════════════════════════════════════════════
// AutonomyPolicy — Curseur d'autonomie (suggest / ask / auto) + .leannaignore
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Curseur d'autonomie appliqué avant chaque action de mission.
 *
 * Trois niveaux :
 *   - "suggest" : l'agent ne fait AUCUNE action à effet de bord (écriture, exec,
 *                 réseau). Ces actions sont refusées ; seules les lectures passent.
 *   - "ask"     : les actions à effet de bord demandent une approbation humaine.
 *                 Les lectures passent librement.
 *   - "auto"    : l'agent agit seul, sauf sur les cibles listées dans .leannaignore.
 *
 * `.leannaignore` (à la racine du workspace) protège des fichiers/dossiers :
 * toute action à effet de bord ciblant un chemin ignoré demande une approbation
 * (même en mode "auto"), et est refusée en mode "suggest".
 */

export type AutonomyMode = "suggest" | "ask" | "auto";

export type AutonomyDecision = "allow" | "ask" | "deny";

export interface AutonomyVerdict {
  decision: AutonomyDecision;
  /** Raison lisible, propagée dans les événements et les logs. */
  reason: string;
  /** Vrai si l'action a un effet de bord (write/exec/network). */
  sideEffect: boolean;
  /** Chemins protégés par .leannaignore détectés dans les arguments. */
  ignoredPaths: string[];
}

/** Champs d'arguments couramment porteurs de chemins de fichiers. */
const PATH_ARG_KEYS = ["path", "filePath", "file", "target", "oldPath", "newPath", "dir", "directory"];

export class AutonomyPolicy {
  private mode: AutonomyMode;
  private permissions: Map<string, ToolPermission[]> = new Map();
  private ignorePatterns: string[] = [];
  private workspaceRoot: string;

  constructor(params: { mode?: AutonomyMode; workspaceRoot: string }) {
    this.mode = params.mode ?? "ask";
    this.workspaceRoot = params.workspaceRoot;
    this.loadIgnoreFile();
  }

  getMode(): AutonomyMode {
    return this.mode;
  }

  setMode(mode: AutonomyMode): void {
    this.mode = mode;
  }

  /** Enregistre les permissions par outil (name → permissions). */
  setToolPermissions(entries: Array<{ name: string; permissions?: ToolPermission[] }>): void {
    this.permissions.clear();
    for (const entry of entries) {
      if (entry?.name) this.permissions.set(entry.name, entry.permissions ?? []);
    }
  }

  /** Recharge .leannaignore depuis le disque. */
  reloadIgnore(): void {
    this.loadIgnoreFile();
  }

  /**
   * Décide si une action peut s'exécuter, demande une approbation, ou est refusée.
   */
  decide(skillName: string, args: Record<string, unknown>): AutonomyVerdict {
    const sideEffect = this.hasSideEffect(skillName);
    const ignoredPaths = this.matchIgnored(args);

    // Les lectures sont toujours autorisées, quel que soit le mode.
    if (!sideEffect) {
      return { decision: "allow", reason: "Action en lecture seule.", sideEffect: false, ignoredPaths: [] };
    }

    // Cible protégée par .leannaignore.
    if (ignoredPaths.length > 0) {
      if (this.mode === "suggest") {
        return {
          decision: "deny",
          reason: `Cible protégée par .leannaignore (${ignoredPaths.join(", ")}) — refusée en mode suggest.`,
          sideEffect: true,
          ignoredPaths,
        };
      }
      return {
        decision: "ask",
        reason: `Cible protégée par .leannaignore (${ignoredPaths.join(", ")}) — approbation requise.`,
        sideEffect: true,
        ignoredPaths,
      };
    }

    // Action à effet de bord, cible non protégée : dépend du mode.
    switch (this.mode) {
      case "suggest":
        return {
          decision: "deny",
          reason: "Mode suggest : les actions à effet de bord ne sont pas exécutées.",
          sideEffect: true,
          ignoredPaths: [],
        };
      case "ask":
        return {
          decision: "ask",
          reason: "Mode ask : approbation humaine requise avant une action à effet de bord.",
          sideEffect: true,
          ignoredPaths: [],
        };
      case "auto":
      default:
        return {
          decision: "allow",
          reason: "Mode auto : action autorisée.",
          sideEffect: true,
          ignoredPaths: [],
        };
    }
  }

  // ─── Interne ────────────────────────────────────────────────────────────────

  /**
   * Un outil a un effet de bord si l'une de ses permissions est dans
   * SIDE_EFFECT_PERMISSIONS. Un outil sans permissions déclarées est traité
   * prudemment comme ayant un effet de bord potentiel.
   */
  private hasSideEffect(skillName: string): boolean {
    const perms = this.permissions.get(skillName);
    if (perms === undefined) return true; // outil inconnu → prudence
    if (perms.length === 0) return true; // permissions non déclarées → prudence
    return perms.some((p) => (SIDE_EFFECT_PERMISSIONS as readonly string[]).includes(p));
  }

  /** Extrait les chemins des arguments et retourne ceux qui matchent .leannaignore. */
  private matchIgnored(args: Record<string, unknown>): string[] {
    if (this.ignorePatterns.length === 0) return [];
    const candidates = this.extractPaths(args);
    const matched: string[] = [];
    for (const candidate of candidates) {
      if (this.isIgnored(candidate)) matched.push(candidate);
    }
    return matched;
  }

  private extractPaths(args: Record<string, unknown>): string[] {
    if (!args || typeof args !== "object") return [];
    const paths: string[] = [];
    for (const key of PATH_ARG_KEYS) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) paths.push(value.trim());
    }
    return paths;
  }

  /** Normalise un chemin en relatif POSIX par rapport à la racine du workspace. */
  private toRelativePosix(candidate: string): string {
    const abs = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(this.workspaceRoot, candidate);
    const rel = path.relative(this.workspaceRoot, abs);
    return rel.split(path.sep).join("/");
  }

  private isIgnored(candidate: string): boolean {
    const rel = this.toRelativePosix(candidate);
    // Un chemin hors du workspace est considéré comme sensible.
    if (rel.startsWith("..")) return true;
    return this.ignorePatterns.some((pattern) => this.matchPattern(pattern, rel));
  }

  /**
   * Matching de motif inspiré de .gitignore, volontairement simple :
   *   - motif se terminant par "/" → dossier (matche le préfixe)
   *   - "*" matche tout sauf "/"
   *   - "**" matche tout, y compris "/"
   *   - un motif sans "/" matche à n'importe quel niveau (nom de fichier/dossier)
   */
  private matchPattern(pattern: string, relPath: string): boolean {
    let p = pattern.trim();
    if (!p || p.startsWith("#")) return false;

    // Dossier : "dist/" protège dist/ et tout son contenu.
    const dirOnly = p.endsWith("/");
    if (dirOnly) p = p.slice(0, -1);

    const anyLevel = !p.includes("/");
    const regex = this.globToRegExp(p, anyLevel);

    if (dirOnly) {
      // Matche le dossier lui-même ou tout ce qu'il contient.
      return regex.test(relPath) || new RegExp(regex.source.replace(/\$$/, "(/|$)")).test(relPath);
    }
    // Fichier/glob : matche exactement, ou comme préfixe de dossier.
    return regex.test(relPath) || new RegExp(regex.source.replace(/\$$/, "/")).test(relPath + "/");
  }

  private globToRegExp(glob: string, anyLevel: boolean): RegExp {
    // Échapper les caractères regex, sauf * que l'on traite ensuite.
    let re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    re = re.replace(/\*\*/g, "\u0000"); // marqueur temporaire pour **
    re = re.replace(/\*/g, "[^/]*");
    re = re.replace(/\u0000/g, ".*");
    const prefix = anyLevel ? "(^|.*/)" : "^";
    return new RegExp(`${prefix}${re}$`);
  }

  private loadIgnoreFile(): void {
    this.ignorePatterns = [];
    try {
      const file = path.join(this.workspaceRoot, ".leannaignore");
      if (!fs.existsSync(file)) return;
      const content = fs.readFileSync(file, "utf8");
      this.ignorePatterns = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      console.log(`[AutonomyPolicy] ✓ .leannaignore chargé (${this.ignorePatterns.length} motif(s)).`);
    } catch (err) {
      console.warn(`[AutonomyPolicy] ⚠️ Lecture .leannaignore échouée: ${(err as Error).message}`);
    }
  }
}
