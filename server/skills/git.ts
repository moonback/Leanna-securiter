import { Skill } from "./base.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { SELF_ROOT, hasProject } from "../utils/selfRoot.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 5 * 1024 * 1024;

function getProjectRoot(): string {
  if (!hasProject() || !SELF_ROOT.trim()) {
    const message = "Aucun projet actif. Sélectionnez un projet avant d'exécuter une commande Git.";
    console.warn(`[Git] Commande refusée: ${message}`);
    throw new Error(message);
  }
  return SELF_ROOT;
}

function truncate(str: string, max = 4000): string {
  return str.length > max ? str.slice(0, max) + "... [tronqué]" : str;
}

// ─── Cache GitStatus Singleton (Optimisation Leanna #3) ────────────────────────

interface CachedStatusEntry {
  value: any;
  timestamp: number;
}

interface GitStatusCacheStats {
  hits: number;
  misses: number;
  lastHit: number;
  lastMiss: number;
  invalidations: number;
}

class GitStatusCacheSingleton {
  private entries: Map<string, CachedStatusEntry> = new Map();
  private inFlight: Map<string, Promise<any>> = new Map();
  private stats: GitStatusCacheStats = {
    hits: 0,
    misses: 0,
    lastHit: 0,
    lastMiss: 0,
    invalidations: 0,
  };

  /** Cache de 30 s; les écritures Git invalident ce cache immédiatement. */
  readonly TTL_MS: number = 30_000;

  private getKey(workspace: string): string {
    return workspace || SELF_ROOT;
  }

  get(workspace?: string): any | null {
    const key = this.getKey(workspace || "");
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.timestamp;
    if (age >= this.TTL_MS) {
      this.entries.delete(key);
      return null;
    }
    this.stats.hits++;
    this.stats.lastHit = Date.now();
    return entry.value;
  }

  set(workspace: string, value: any): void {
    const key = this.getKey(workspace);
    this.entries.set(key, { value, timestamp: Date.now() });
  }

  getOrSetInFlight(workspace: string, factory: () => Promise<any>): Promise<any> {
    const key = this.getKey(workspace);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = factory().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  invalidate(workspace?: string): void {
    if (workspace) {
      this.entries.delete(this.getKey(workspace));
    } else {
      this.entries.clear();
    }
    this.stats.invalidations++;
  }

  getStats(): GitStatusCacheStats & { size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.entries.size,
      hitRate: total === 0 ? 0 : Math.round((this.stats.hits / total) * 100),
    };
  }

  recordMiss(): void {
    this.stats.misses++;
    this.stats.lastMiss = Date.now();
  }

  getAgeMs(workspace?: string): number | null {
    const entry = this.entries.get(this.getKey(workspace || ""));
    return entry ? Date.now() - entry.timestamp : null;
  }
}

export const gitStatusCache = new GitStatusCacheSingleton();

/** @deprecated Utiliser gitStatusCache.invalidate() maintenant */
export function invalidateGitStatusCache(workspace?: string) {
  gitStatusCache.invalidate(workspace);
}

async function git(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const workDir = getProjectRoot();
  const mainCmd = args[0]?.toLowerCase();
  if (mainCmd && !["status", "branch", "log", "diff", "show"].includes(mainCmd)) {
    gitStatusCache.invalidate(workDir);
  }

  console.log(`[Git] Exécution: git ${args.join(" ")} (cwd: ${workDir})`);
  const startTime = Date.now();
  try {
    const result = await execFileAsync("git", args, {
      cwd: workDir,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const elapsed = Date.now() - startTime;
    console.log(`[Git] OK: git ${args[0]} [${elapsed}ms]`);
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[Git] ÉCHEC: git ${args.join(" ")} [${elapsed}ms]`, error.stderr?.trim() || error.message);
    throw error;
  }
}

export const gitSkill: Skill = {
  name: "git",
  declarations: [
    {
      name: "git_status",
      description: "Obtenir le statut Git du workspace (fichiers modifiés, staged, untracked).",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "git_diff",
      description: "Voir le diff des modifications en cours (unstaged) ou staged.",
      parameters: {
        type: "OBJECT",
        properties: {
          staged: { type: "BOOLEAN", description: "Si true, montre le diff des fichiers staged uniquement." },
          file: { type: "STRING", description: "Chemin optionnel pour limiter le diff à un fichier spécifique." },
        },
      },
    },
    {
      name: "git_stage",
      description: "Ajouter des fichiers au staging (git add).",
      parameters: {
        type: "OBJECT",
        properties: {
          files: { type: "ARRAY", items: { type: "STRING" }, description: "Liste des fichiers à stager. Utiliser ['.'] pour tout ajouter." },
        },
        required: ["files"],
      },
    },
    {
      name: "git_unstage",
      description: "Retirer des fichiers du staging (git reset HEAD).",
      parameters: {
        type: "OBJECT",
        properties: {
          files: { type: "ARRAY", items: { type: "STRING" }, description: "Liste des fichiers à unstager." },
        },
        required: ["files"],
      },
    },
    {
      name: "git_commit",
      description: "Créer un commit avec les fichiers staged.",
      parameters: {
        type: "OBJECT",
        properties: {
          message: { type: "STRING", description: "Le message du commit." },
        },
        required: ["message"],
      },
    },
    {
      name: "git_push",
      description: "Pousser les commits locaux vers le remote.",
      parameters: {
        type: "OBJECT",
        properties: {
          remote: { type: "STRING", description: "Le nom du remote (défaut: origin)." },
          branch: { type: "STRING", description: "La branche à pousser (défaut: branche courante)." },
        },
      },
    },
    {
      name: "git_pull",
      description: "Récupérer et intégrer les modifications du remote.",
      parameters: {
        type: "OBJECT",
        properties: {
          remote: { type: "STRING", description: "Le nom du remote (défaut: origin)." },
          branch: { type: "STRING", description: "La branche à tirer (défaut: branche courante)." },
        },
      },
    },
    {
      name: "git_branches",
      description: "Lister les branches locales et identifier la branche courante.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "git_switch_branch",
      description: "Changer de branche.",
      parameters: {
        type: "OBJECT",
        properties: {
          branch: { type: "STRING", description: "Nom de la branche cible." },
          create: { type: "BOOLEAN", description: "Si true, crée la branche si elle n'existe pas." },
        },
        required: ["branch"],
      },
    },
    {
      name: "git_log",
      description: "Afficher l'historique des commits récents.",
      parameters: {
        type: "OBJECT",
        properties: {
          count: { type: "NUMBER", description: "Nombre de commits à afficher (défaut: 10)." },
        },
      },
    },
  ],

  handleToolCall: async (name, args: Record<string, any>) => {
    console.log(`[Git] Appel outil: ${name}`, JSON.stringify(args).slice(0, 300));
    const startTime = Date.now();
    try {
      switch (name) {
        // ─── Status (avec singleton cache + dedup in-flight) ────────────
        case "git_status": {
          const workDir = getProjectRoot();
          const cached = gitStatusCache.get(workDir);
          if (cached !== null) {
            const age = gitStatusCache.getAgeMs(workDir);
            const stats = gitStatusCache.getStats();
            console.log(`[Git] HIT statut en cache (âge: ${age}ms, hit-rate: ${stats.hitRate}%)`);
            return cached;
          }
          gitStatusCache.recordMiss();

          return gitStatusCache.getOrSetInFlight(workDir, async () => {
            console.log(`[Git] MISS — récupération statut workspace: ${workDir}`);
            const t0 = Date.now();

            // Un seul appel combiné : --branch + --porcelain=v2 donne branche + fichiers
            const { stdout: v2Output } = await git(["status", "--branch", "--porcelain=v2"]);
            const lines = v2Output.split("\n").filter(Boolean);

            // Extraire la branche depuis les headers v2 (# branch.head <name>)
            let branch = "";
            const branchHeader = lines.find((l) => l.startsWith("# branch.head "));
            if (branchHeader) branch = branchHeader.slice("# branch.head ".length).trim();

            // Parser les entrées de fichiers (lignes commençant par 1, 2, u, ?)
            const files: { indexStatus: string; workTreeStatus: string; path: string }[] = [];
            for (const line of lines) {
              if (line.startsWith("# ")) continue; // header lines
              if (line.startsWith("1 ") || line.startsWith("2 ")) {
                // Changed entries: "1 XY ..." or "2 XY ..." — statuts en position [2] et [3]
                const indexStatus = line[2];
                const workTreeStatus = line[3];
                // Le chemin est le dernier champ (après les colonnes séparées par espaces)
                const parts = line.split(" ");
                const filePath = line.startsWith("2 ")
                  ? parts[parts.length - 1].split("\t").pop() || parts[parts.length - 1]
                  : parts[parts.length - 1];
                files.push({ indexStatus, workTreeStatus, path: filePath });
              } else if (line.startsWith("u ")) {
                // Unmerged entries
                const indexStatus = line[2];
                const workTreeStatus = line[3];
                const parts = line.split(" ");
                files.push({ indexStatus, workTreeStatus, path: parts[parts.length - 1] });
              } else if (line.startsWith("? ")) {
                // Untracked: "? <path>"
                files.push({ indexStatus: "?", workTreeStatus: "?", path: line.slice(2) });
              }
            }

            const staged = files.filter((f) => f.indexStatus !== "." && f.indexStatus !== "?").length;
            const modified = files.filter((f) => f.workTreeStatus !== "." && f.indexStatus !== "?").length;
            const untracked = files.filter((f) => f.indexStatus === "?").length;
            const summary = `${staged} staged, ${modified} modified, ${untracked} untracked`;
            const elapsed = Date.now() - t0;
            console.log(`[Git] git_status OK: branche=${branch}, ${summary} [${elapsed}ms, 1 appel git]`);

            const result = {
              status: "success",
              branch,
              files,
              summary,
              cache_stats: gitStatusCache.getStats(),
            };

            gitStatusCache.set(workDir, result);
            return result;
          });
        }

        // ─── Diff ───────────────────────────────────────────────────────
        case "git_diff": {
          const target = args.file || '(tout)';
          const mode = args.staged ? 'staged' : 'unstaged';
          console.log(`[Git] Récupération diff: ${target} (mode: ${mode})`);

          const diffArgs = ["diff"];
          if (args.staged) diffArgs.push("--cached");
          if (args.file) diffArgs.push("--", args.file);
          diffArgs.push("--stat");
          const { stdout: stat } = await git(diffArgs);

          const fullDiffArgs = ["diff"];
          if (args.staged) fullDiffArgs.push("--cached");
          if (args.file) fullDiffArgs.push("--", args.file);
          const { stdout: diff } = await git(fullDiffArgs);

          const lineCount = diff.split("\n").length;
          console.log(`[Git] git_diff OK: ${lineCount} lignes de diff pour ${target} [${Date.now() - startTime}ms]`);
          return {
            status: "success",
            stat: truncate(stat),
            diff: truncate(diff, 8000),
          };
        }

        // ─── Stage ──────────────────────────────────────────────────────
        case "git_stage": {
          const files: string[] = args.files || ["."];
          console.log(`[Git] Staging: ${files.length} fichier(s) → ${files.join(", ")}`);
          await git(["add", ...files]);
          console.log(`[Git] git_stage OK: ${files.length} fichier(s) ajouté(s) [${Date.now() - startTime}ms]`);
          return { status: "success", message: `${files.length} fichier(s) ajouté(s) au staging.` };
        }

        // ─── Unstage ────────────────────────────────────────────────────
        case "git_unstage": {
          const files: string[] = args.files || [];
          if (!files.length) {
            console.warn(`[Git] git_unstage: aucun fichier spécifié`);
            return { error: "Aucun fichier spécifié." };
          }
          console.log(`[Git] Unstaging: ${files.length} fichier(s) → ${files.join(", ")}`);
          await git(["reset", "HEAD", "--", ...files]);
          console.log(`[Git] git_unstage OK: ${files.length} fichier(s) retiré(s) [${Date.now() - startTime}ms]`);
          return { status: "success", message: `${files.length} fichier(s) retiré(s) du staging.` };
        }

        // ─── Commit ─────────────────────────────────────────────────────
        case "git_commit": {
          const message = args.message?.trim();
          if (!message) {
            console.warn(`[Git] git_commit: message vide`);
            return { error: "Le message du commit est requis." };
          }
          console.log(`[Git] Commit: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);
          const { stdout } = await git(["commit", "-m", message]);
          console.log(`[Git] git_commit OK: ${stdout.split("\n")[0]} [${Date.now() - startTime}ms]`);
          return { status: "success", output: truncate(stdout) };
        }

        // ─── Push ───────────────────────────────────────────────────────
        case "git_push": {
          const remote = args.remote || "origin";
          const pushArgs = ["push", remote];
          if (args.branch) pushArgs.push(args.branch);
          else pushArgs.push("--set-upstream", remote, "HEAD");
          console.log(`[Git] Push: git push ${pushArgs.slice(1).join(" ")}`);
          const { stdout, stderr } = await git(pushArgs);
          const output = (stdout + "\n" + stderr).trim();
          console.log(`[Git] git_push OK: ${output.split("\n")[0]} [${Date.now() - startTime}ms]`);
          return { status: "success", output: truncate(output) };
        }

        // ─── Pull ───────────────────────────────────────────────────────
        case "git_pull": {
          const remote = args.remote || "origin";
          const pullArgs = ["pull", remote];
          if (args.branch) pullArgs.push(args.branch);
          console.log(`[Git] Pull: git pull ${pullArgs.slice(1).join(" ")}`);
          const { stdout, stderr } = await git(pullArgs);
          const output = (stdout + "\n" + stderr).trim();
          console.log(`[Git] git_pull OK: ${output.split("\n")[0]} [${Date.now() - startTime}ms]`);
          return { status: "success", output: truncate(output) };
        }

        // ─── Branches ───────────────────────────────────────────────────
        case "git_branches": {
          console.log(`[Git] Liste des branches`);
          const { stdout } = await git(["branch", "-a", "--format=%(refname:short) %(HEAD)"]);
          const branches = stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const parts = line.trim().split(" ");
              const isCurrent = parts[parts.length - 1] === "*";
              const name = isCurrent ? parts.slice(0, -1).join(" ") : parts.join(" ");
              return { name: name.trim(), current: isCurrent };
            });

          const current = branches.find((b) => b.current)?.name || "";
          console.log(`[Git] git_branches OK: ${branches.length} branches, courante="${current}" [${Date.now() - startTime}ms]`);
          return { status: "success", branches, current };
        }

        // ─── Switch Branch ──────────────────────────────────────────────
        case "git_switch_branch": {
          const branch = args.branch?.trim();
          if (!branch) {
            console.warn(`[Git] git_switch_branch: nom de branche manquant`);
            return { error: "Le nom de la branche est requis." };
          }
          const action = args.create ? "Création + switch" : "Switch";
          console.log(`[Git] ${action} vers branche: "${branch}"`);
          const switchArgs = args.create ? ["checkout", "-b", branch] : ["checkout", branch];
          const { stdout, stderr } = await git(switchArgs);
          const output = (stdout + "\n" + stderr).trim();
          console.log(`[Git] git_switch_branch OK: ${output.split("\n")[0]} [${Date.now() - startTime}ms]`);
          return { status: "success", output: truncate(output), branch };
        }

        // ─── Log ────────────────────────────────────────────────────────
        case "git_log": {
          const count = Math.min(args.count || 10, 50);
          console.log(`[Git] Historique: ${count} derniers commits`);
          const { stdout } = await git([
            "log",
            `--max-count=${count}`,
            "--format=%H|%h|%an|%ae|%ar|%s",
          ]);
          const commits = stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [hash, shortHash, author, email, date, ...msgParts] = line.split("|");
              return { hash, shortHash, author, email, date, message: msgParts.join("|") };
            });
          console.log(`[Git] git_log OK: ${commits.length} commits retournés [${Date.now() - startTime}ms]`);
          if (commits.length > 0) {
            console.log(`[Git]   Dernier: ${commits[0].shortHash} "${commits[0].message}" par ${commits[0].author} (${commits[0].date})`);
          }
          return { status: "success", commits };
        }

        default:
          console.warn(`[Git] Outil inconnu appelé: ${name}`);
          return { error: `Outil git inconnu: ${name}` };
      }
    } catch (error: any) {
      const stderr = error.stderr?.trim() || "";
      const msg = error.message || String(error);
      console.error(`[Git] Exception dans ${name}: ${stderr || msg} [${Date.now() - startTime}ms]`);
      return { error: `Erreur git: ${stderr || msg}` };
    }
  },
};
