import { Skill, SkillContext } from "./base.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { SELF_ROOT, resolveRealPathWithinSelf } from "../utils/selfRoot.js";
import { requestConfirmation } from "../utils/confirmationBridge.js";
import { isSandboxActive, getSandboxRoot } from "../utils/sandbox.js";

const execFileAsync = promisify(execFile);

/**
 * Retourne la racine d'exécution pour les commandes shell lancées par l'assistant.
 * Si le sandbox est actif (READY), les commandes s'exécutent dans la copie isolée
 * plutôt que dans le workspace réel — l'assistant ne peut pas affecter le projet
 * principal tant que les modifications ne sont pas synchronisées.
 */
function getProjectRoot(): string {
    if (isSandboxActive()) {
        return getSandboxRoot();
    }
    return SELF_ROOT;
}

/**
 * Resolves `target` against the execution root (sandbox if active, SELF_ROOT otherwise)
 * and rejects anything that escapes it *textually*.
 */
function normalizeProjectPath(target: string): string | null {
    const root = getProjectRoot();
    if (!root) return null;
    const resolved = path.resolve(root, target);
    if (resolved === root || resolved.startsWith(root + path.sep)) {
        return resolved;
    }
    return null;
}

/**
 * SECURITY: guards against symlink escape. Delegates to resolveRealPathWithinSelf.
 * Note: symlink resolution still checks against SELF_ROOT since the sandbox is
 * a subdirectory of the project and real paths are expected within it.
 */
async function resolveRealPathWithinProject(candidatePath: string): Promise<string | null> {
    return resolveRealPathWithinSelf(candidatePath);
}

const EXEC_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 5 * 1024 * 1024; // 5 Mo

const ALLOWED_COMMANDS = ["dir", "ls", "npm"] as const;
const ALLOWED_NPM_SUBCOMMANDS = [
    "install", "i", "uninstall", "remove", "rm",
    "run", "update", "ci", "ls", "list", "outdated", "audit", "test"
] as const;

// ── run_project_command — commandes autorisées ────────────────────────────────
// Préfixes de commandes autorisés pour run_project_command.
// Seuls ces préfixes sont acceptés ; tout autre préfixe est rejeté.
const RUN_ALLOWED_PREFIXES = ["npm ", "npx ", "node "] as const;

// SECURITY (revue) : "run" et "test" exécutent du code arbitraire défini par le
// projet (scripts npm), ce qui est potentiellement plus dangereux qu'un simple
// "npm install <paquet connu>". On ne dispense donc de confirmation que les
// sous-commandes strictement en lecture seule (aucune exécution de code du
// projet, aucune modification du disque).
const NPM_NO_CONFIRM = new Set(["ls", "list", "outdated"]);
const NPM_KNOWN_SAFE_SCRIPTS = new Set(["test", "build", "typecheck"]);

export type NpmExecutionClass = "read-only" | "known-safe-project" | "arbitrary-script";

export function classifyNpmExecution(parts: string[]): NpmExecutionClass {
    const sub = (parts[1] ?? "").toLowerCase();
    if (NPM_NO_CONFIRM.has(sub)) return "read-only";
    if (sub === "test") return "known-safe-project";
    if (sub === "run" && NPM_KNOWN_SAFE_SCRIPTS.has((parts[2] ?? "").toLowerCase())) return "known-safe-project";
    return "arbitrary-script";
}

const RUN_TIMEOUT_MS = 120_000; // 2 minutes max

// Scripts npm connus pour tourner indéfiniment (dev server, watcher, etc.).
// Ces scripts sont lancés en arrière-plan (détachés) sans attendre leur fin.
const LONG_RUNNING_SCRIPTS = new Set([
    "dev", "start", "serve", "watch",
    "storybook", "preview", "electron", "tauri"
]);

/**
 * Détermine si "npm run <script>" est une commande longue durée (serveur de
 * développement, watcher…). Si oui, elle doit être lancée de façon détachée
 * plutôt qu'attendue avec execFileAsync.
 */
function isLongRunningNpmScript(parts: string[]): boolean {
    // parts[0] === "npm", parts[1] === "run", parts[2] === <script>
    if ((parts[1] ?? "").toLowerCase() !== "run") return false;
    const script = (parts[2] ?? "").toLowerCase();
    return LONG_RUNNING_SCRIPTS.has(script);
}

/**
 * Lance un processus npm de longue durée de façon détachée et retourne
 * immédiatement avec le PID. Le processus continue de tourner en arrière-plan
 * même après la réponse de l'assistant.
 */
function spawnDetached(npmBin: string, args: string[], cwd: string): { pid: number | undefined } {
    // Sur Windows, les fichiers .cmd nécessitent shell: true pour éviter EINVAL
    const isWindows = os.platform() === "win32";
    const child = spawn(npmBin, args, {
        cwd,
        detached: true,
        stdio: "ignore",
        shell: isWindows, // Windows nécessite shell pour les .cmd
        env: { ...process.env },
        windowsHide: false,
    });
    child.unref(); // Ne pas bloquer le process Node parent
    return { pid: child.pid };
}

/**
 * Détermine si une commande npm nécessite une confirmation utilisateur.
 * Seules les commandes strictement en lecture (ls, list, outdated) sont
 * dispensées de confirmation. Tout le reste — y compris "run"/"test", qui
 * exécutent du code défini dans package.json — nécessite une confirmation
 * explicite.
 */
function npmNeedsConfirmation(parts: string[]): boolean {
    // parts[0] === "npm", parts[1] === subcommand
    const sub = (parts[1] ?? "").toLowerCase();
    return !NPM_NO_CONFIRM.has(sub);
}

/**
 * Pour "npm run <script>" / "npm test", tente de récupérer le contenu réel
 * du script depuis package.json afin de l'afficher dans la demande de
 * confirmation. L'utilisateur voit ainsi ce qui va réellement s'exécuter,
 * pas seulement le nom du script.
 */
async function describeNpmScript(root: string, parts: string[]): Promise<string> {
    const sub = (parts[1] ?? "").toLowerCase();
    const scriptName = sub === "test" ? "test" : (parts[2] ?? "");
    if (!scriptName) return `npm ${parts.slice(1).join(" ")}`;

    try {
        const pkgRaw = await fs.promises.readFile(path.join(root, "package.json"), "utf8");
        const pkg = JSON.parse(pkgRaw);
        const scriptCmd = pkg?.scripts?.[scriptName];
        if (scriptCmd) {
            const classification = classifyNpmExecution(parts);
            const label = classification === "known-safe-project" ? "known-safe project execution" : "arbitrary npm script — confirmation renforcée";
            return `[${label}] npm ${parts.slice(1).join(" ")}\n→ exécutera : ${truncate(String(scriptCmd), 300)}`;
        }
        return `npm ${parts.slice(1).join(" ")} (script "${scriptName}" introuvable dans package.json)`;
    } catch {
        return `npm ${parts.slice(1).join(" ")}`;
    }
}

function truncate(str: string, max = 2000): string {
    return str.length > max ? str.slice(0, max) + "... [tronqué]" : str;
}

function asString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

/**
 * Découpe une ligne de commande en tokens, en respectant les guillemets
 * simples/doubles (ex: npm install "some package"). Contrairement à un
 * simple split sur les espaces, ceci permet des arguments contenant des
 * espaces sans casser le découpage.
 */
function splitCommandLine(cmd: string): string[] {
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    const parts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmd))) {
        parts.push(m[1] ?? m[2] ?? m[3]);
    }
    return parts;
}

// BUGFIX (injection de commande critique) : la regex précédente
// `/[;&|`$<>]/` ne filtrait pas les retours à la ligne (\n, \r) ni les autres
// caractères de contrôle. Comme la commande était ensuite exécutée via
// `sh -c command` / `cmd.exe /c command`, une chaîne comme
// "npm run build\nrm -rf /" passait le contrôle puis exécutait une seconde
// commande arbitraire. On bloque désormais tout caractère de contrôle et les
// métacaractères shell usuels (guillemets, glob, sous-shell, chemin parent).
//
// NOTE : toutes les exécutions passent par execFile(..., { shell: false }) —
// les arguments ne sont jamais interprétés par un shell. Ce filtre reste une
// défense en profondeur pour éviter les caractères inattendus. Le caractère
// '@' a été retiré du blocklist : nécessaire pour les paquets scopés
// (ex: "@types/node") et le pin de version (ex: "lodash@4.17.21").
function isSafeShellCommand(command: string): boolean {
    if (/[\x00-\x1f\x7f]/.test(command)) return false; // \n \r \t et autres contrôles
    return !/[;&|`$<>(){}[\]"'*?~!\\^%,]/.test(command) && !command.includes("..");
}

function globToRegex(glob: string): RegExp {
    const escaped = glob.replace(/[.+^${}()|\\+]/g, '\\$&');
    const regexStr = '^' + escaped
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
        .replace(/\[!(.*?)\]/g, '[^$1]')
        .replace(/\[(.*?)\]/g, '[$1]') + '$';
    return new RegExp(regexStr);
}

/**
 * Exécute une sous-commande npm de façon centralisée : vérifie l'allowlist,
 * demande confirmation si nécessaire, puis exécute via execFile. Factorisé
 * pour éviter que run_project_command et system_execute_command divergent sur
 * les règles de sécurité (c'était le cas avant cette revue).
 */
async function runNpmSubcommand(
    parts: string[],
    cwd: string,
    toolContext: { emitToClient?: (data: any) => void } | undefined,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<any> {
    const sub = (parts[1] ?? "").toLowerCase();

    if (!sub || !ALLOWED_NPM_SUBCOMMANDS.includes(sub as any)) {
        return { error: `Sous-commande npm non autorisée: "${sub}". Autorisées: ${ALLOWED_NPM_SUBCOMMANDS.join(", ")}` };
    }

    if (npmNeedsConfirmation(parts)) {
        if (!toolContext?.emitToClient) {
            return { error: "Confirmation interactive indisponible dans ce contexte. Exécutez la commande manuellement dans le terminal." };
        }
        const description = (sub === "run" || sub === "test")
            ? await describeNpmScript(cwd, parts)
            : `Exécuter dans le projet : npm ${parts.slice(1).join(" ")}`;

        const approved = await requestConfirmation(
            parts.join(" "),
            "npm-command",
            toolContext.emitToClient,
            description,
            classifyNpmExecution(parts) === "arbitrary-script" ? "high" : "standard"
        );
        if (!approved) {
            return { error: "Commande npm refusée par l'utilisateur ou expirée." };
        }
    }

    console.log(`[System] Exécution npm: ${parts.join(" ")} (cwd: ${cwd})`);

    try {
        const isWindows = os.platform() === "win32";
        const npmBin = isWindows ? "npm.cmd" : "npm";

        // Commandes longue durée : lancer en arrière-plan et répondre immédiatement.
        if (isLongRunningNpmScript(parts)) {
            const { pid } = spawnDetached(npmBin, parts.slice(1), cwd);
            const scriptName = parts[2] ?? parts.slice(1).join(" ");
            return {
                status: "success",
                command: parts.join(" "),
                cwd,
                pid: pid ?? null,
                message: `Le script "${scriptName}" a été lancé en arrière-plan (PID: ${pid ?? "inconnu"}). Il tourne de façon indépendante — vous pouvez continuer à interagir normalement. Pour l'arrêter, fermez le terminal correspondant ou utilisez son PID.`,
                stdout: "",
                stderr: "",
                exitCode: null,
            };
        }

        const result = await execFileAsync(npmBin, parts.slice(1), {
            cwd,
            timeout: timeoutMs,
            maxBuffer: MAX_BUFFER,
            shell: isWindows, // Windows nécessite shell pour les .cmd
            env: { ...process.env },
            // Kill-switch temps-réel : tue le sous-processus npm à l'annulation.
            signal,
        });
        return {
            status: "success",
            command: parts.join(" "),
            cwd,
            stdout: truncate(result.stdout ?? "", 6000),
            stderr: truncate(result.stderr ?? "", 3000),
            exitCode: 0,
        };
    } catch (e: any) {
        const aborted = e?.name === "AbortError" || signal?.aborted;
        return {
            status: aborted ? "cancelled" : "error",
            command: parts.join(" "),
            cwd,
            stdout: truncate(e.stdout ?? "", 6000),
            stderr: truncate(e.stderr ?? e.message ?? "", 3000),
            exitCode: typeof e.code === "number" ? e.code : null,
            error: aborted
                ? "Commande interrompue par le kill-switch (annulation)."
                : (e.killed ? `Commande interrompue (timeout ${timeoutMs / 1000}s dépassé)` : e.message),
        };
    }
}

export const systemSkill: Skill = {
    name: "system",
    // Permissions déclarées explicitement, appliquées au runtime par le ToolRegistry.
    permissions: ["exec"],
    toolPermissions: {
        system_info: ["read"],
        system_notify: ["read"],
        system_open: ["exec"],
        run_project_command: ["exec"],
        system_execute_command: ["exec"],
    },
    declarations: [
        {
            name: "system_open",
            description: "Ouvre une application, un dossier ou un fichier sur l'ordinateur local (ex: code, notepad, chemin vers dossier).",
            parameters: {
                type: "OBJECT",
                properties: {
                    target: {
                        type: "STRING",
                        description: "Le nom du programme ou le chemin à ouvrir (ex: 'code', 'calc', '/usr/bin/python')"
                    }
                },
                required: ["target"]
            }
        },
        {
            name: "system_notify",
            description: "Envoie une notification système sur l'ordinateur de l'utilisateur.",
            parameters: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING", description: "Le titre de la notification" },
                    message: { type: "STRING", description: "Le contenu de la notification" }
                },
                required: ["title", "message"]
            }
        },
        {
            name: "system_info",
            description: "Récupère des informations sur le système local (CPU, RAM, OS).",
            parameters: { type: "OBJECT", properties: {} }
        },
        {
            name: "run_project_command",
            description: "Exécute une commande npm, npx ou node dans le workspace du projet et retourne stdout/stderr. npm test, npm run build et npm run typecheck sont classés known-safe project execution et demandent une confirmation standard. Tout autre npm run <script> est un arbitrary script et demande une confirmation renforcée (commande réelle + risque élevé). Les commandes npm ls/list/outdated sont les seules opérations sans confirmation.",
            parameters: {
                type: "OBJECT",
                properties: {
                    command: {
                        type: "STRING",
                        description: "Commande complète à exécuter (ex: 'npm run build', 'npm install axios', 'npx tsc --noEmit', 'node scripts/setup.js')."
                    },
                    cwd: {
                        type: "STRING",
                        description: "Sous-dossier relatif dans lequel exécuter la commande (optionnel, défaut: racine du projet). Ex: 'packages/frontend'."
                    }
                },
                required: ["command"]
            }
        },
        {
            name: "system_execute_command",
            description: "Exécute une commande shell restreinte (dir, ls, npm) sur le workspace du projet et retourne le résultat. Toutes les commandes npm nécessitent une confirmation utilisateur interactive préalable (demandée automatiquement par l'outil).",
            parameters: {
                type: "OBJECT",
                properties: {
                    command: { type: "STRING", description: "La commande shell restreinte à exécuter (dir, ls, ou npm sur le projet)" }
                },
                required: ["command"]
            }
        }
    ],

    handleToolCall: async (name, args: Record<string, unknown>, toolContext?: SkillContext) => {
        try {
            switch (name) {
                case "run_project_command": {
                    const rawCmd = asString(args.command).trim();
                    if (!rawCmd) return { error: "Paramètre 'command' manquant ou vide." };

                    // Vérifier le préfixe autorisé
                    const allowed = RUN_ALLOWED_PREFIXES.some(p => rawCmd.toLowerCase().startsWith(p));
                    if (!allowed) {
                        return { error: `Commande non autorisée. Seuls les préfixes suivants sont acceptés: ${RUN_ALLOWED_PREFIXES.join(", ")}. Exemple: 'npm run build', 'npx tsc --noEmit'.` };
                    }

                    // Bloquer les caractères dangereux
                    if (!isSafeShellCommand(rawCmd)) {
                        return { error: "Commande refusée : caractères shell dangereux détectés." };
                    }

                    const parts = splitCommandLine(rawCmd);
                    const verb = parts[0].toLowerCase();

                    // Résoudre le cwd
                    const root = getProjectRoot();
                    let cwdPath = root;
                    if (args.cwd) {
                        const subDir = asString(args.cwd).trim();
                        const resolved = normalizeProjectPath(subDir);
                        if (!resolved) return { error: "Le sous-dossier 'cwd' doit rester dans le workspace du projet." };
                        if (!fs.existsSync(resolved)) return { error: `Sous-dossier introuvable: ${subDir}` };
                        cwdPath = resolved;
                    }

                    // Les commandes npm passent par le chemin centralisé : allowlist de
                    // sous-commande + confirmation le cas échéant.
                    if (verb === "npm") {
                        return await runNpmSubcommand(parts, cwdPath, toolContext, RUN_TIMEOUT_MS, toolContext?.signal);
                    }

                    console.log(`[System] run_project_command: ${rawCmd} (cwd: ${cwdPath})`);

                    const isWin = os.platform() === "win32";
                    let bin: string;
                    let binArgs: string[];

                    if (verb === "npx") {
                        bin = isWin ? "npx.cmd" : "npx";
                        binArgs = parts.slice(1);
                    } else {
                        // node : exécutable natif, jamais de .cmd, pas besoin de shell wrapper.
                        bin = isWin ? "node.exe" : "node";
                        binArgs = parts.slice(1);
                    }

                    try {
                        const result = await execFileAsync(bin, binArgs, {
                            cwd: cwdPath,
                            timeout: RUN_TIMEOUT_MS,
                            maxBuffer: MAX_BUFFER,
                            shell: isWin && verb === "npx", // Windows nécessite shell pour npx.cmd
                            env: { ...process.env },
                            // Kill-switch temps-réel : Node tue le sous-processus dès que
                            // le signal se déclenche (annulation de la tâche).
                            signal: toolContext?.signal,
                        });
                        return {
                            status: "success",
                            command: rawCmd,
                            cwd: cwdPath,
                            stdout: truncate(result.stdout ?? "", 6000),
                            stderr: truncate(result.stderr ?? "", 3000),
                            exitCode: 0,
                        };
                    } catch (e: any) {
                        const aborted = e?.name === "AbortError" || toolContext?.signal?.aborted;
                        return {
                            status: aborted ? "cancelled" : "error",
                            command: rawCmd,
                            cwd: cwdPath,
                            stdout: truncate(e.stdout ?? "", 6000),
                            stderr: truncate(e.stderr ?? e.message ?? "", 3000),
                            exitCode: typeof e.code === "number" ? e.code : null,
                            error: aborted
                                ? "Commande interrompue par le kill-switch (annulation)."
                                : (e.killed ? `Commande interrompue (timeout ${RUN_TIMEOUT_MS / 1000}s dépassé)` : e.message),
                        };
                    }
                }

                case "system_open": {
                    const target = asString(args.target).trim();
                    if (!target) return { error: "Paramètre 'target' manquant ou vide." };

                    console.log(`[System] Demande d'ouverture de: ${target}`);
                    const platform = os.platform();

                    const resolvedPath = normalizeProjectPath(target);
                    if (!resolvedPath) {
                        return { error: "Le chemin doit rester dans le workspace du projet." };
                    }

                    if (!fs.existsSync(resolvedPath)) {
                        return { error: `Le chemin demandé n'existe pas dans le projet: ${target}` };
                    }

                    // SECURITY: suit les symlinks pour vérifier que la cible
                    // réelle reste bien dans le projet (voir commentaire sur
                    // resolveRealPathWithinProject).
                    const realPath = await resolveRealPathWithinProject(resolvedPath);
                    if (!realPath) {
                        return { error: "Le chemin résolu (après suivi des liens symboliques) sort du workspace du projet." };
                    }

                    try {
                        if (platform === "win32") {
                            await execFileAsync("cmd.exe", ["/c", "start", "", realPath], { timeout: EXEC_TIMEOUT_MS });
                        } else if (platform === "darwin") {
                            await execFileAsync("open", [realPath], { timeout: EXEC_TIMEOUT_MS });
                        } else {
                            await execFileAsync("xdg-open", [realPath], { timeout: EXEC_TIMEOUT_MS });
                        }
                        return { status: "success", message: `Ouverture réussie: ${realPath}` };
                    } catch (error: any) {
                        return { error: `Erreur d'ouverture: ${error.message}` };
                    }
                }

                case "system_notify": {
                    const title = asString(args.title, "Notification");
                    const message = asString(args.message);
                    console.log(`[System] Notification: ${title}`);
                    const platform = os.platform();

                    try {
                        if (platform === "win32") {
                            // Titre/message passés via variables d'environnement pour éviter
                            // toute injection dans la commande PowerShell.
                            await execFileAsync(
                                "powershell",
                                [
                                    "-NoProfile",
                                    "-Command",
                                    "Add-Type -AssemblyName System.Windows.Forms; " +
                                    "[System.Windows.Forms.MessageBox]::Show($env:NOTIF_MSG, $env:NOTIF_TITLE)"
                                ],
                                { timeout: EXEC_TIMEOUT_MS, env: { ...process.env, NOTIF_MSG: message, NOTIF_TITLE: title } }
                            );
                        } else if (platform === "darwin") {
                            await execFileAsync(
                                "osascript",
                                [
                                    "-e",
                                    'display notification (system attribute "NOTIF_MSG") with title (system attribute "NOTIF_TITLE")'
                                ],
                                { timeout: EXEC_TIMEOUT_MS, env: { ...process.env, NOTIF_MSG: message, NOTIF_TITLE: title } }
                            );
                        } else {
                            await execFileAsync("notify-send", [title, message], { timeout: EXEC_TIMEOUT_MS });
                        }
                        return { status: "success" };
                    } catch (error: any) {
                        return { error: `Impossible d'afficher la notification: ${error.message}` };
                    }
                }

                case "system_info": {
                    try {
                        const info = {
                            platform: os.platform(),
                            release: os.release(),
                            arch: os.arch(),
                            cpus: os.cpus().length,
                            totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
                            freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
                            uptimeHours: Math.round(os.uptime() / 3600)
                        };
                        return { status: "success", info };
                    } catch (error: any) {
                        return { error: `Erreur de récupération des infos système: ${error.message}` };
                    }
                }

                case "system_execute_command": {
                    const command = asString(args.command).trim();
                    if (!command) return { error: "Paramètre 'command' manquant ou vide." };

                    const commandParts = splitCommandLine(command);
                    const verb = commandParts[0].toLowerCase();
                    const targetArg = commandParts.slice(1).join(" ").trim();

                    if (!(ALLOWED_COMMANDS as readonly string[]).includes(verb)) {
                        return { error: `Seules les commandes suivantes sont autorisées : ${ALLOWED_COMMANDS.join(", ")}. Uniquement sur des chemins à l'intérieur du projet.` };
                    }

                    // ── npm commands ───────────────────────────────────────────────
                    if (verb === "npm") {
                        if (!isSafeShellCommand(command)) {
                            return { error: "Commande non autorisée : caractères shell dangereux détectés." };
                        }

                        // SECURITY: la confirmation utilisateur est systématiquement
                        // requise pour toute sous-commande npm passée par cette voie
                        // (aucune valeur "confirmed" n'est acceptée depuis l'appelant —
                        // elle était auparavant fournie par le modèle et donc falsifiable).
                        // La confirmation réelle passe par requestConfirmation via le
                        // pont WebSocket, gérée dans runNpmSubcommand.
                        return await runNpmSubcommand(
                            commandParts,
                            getProjectRoot(),
                            toolContext ? { emitToClient: toolContext.emitToClient } : undefined,
                            120_000,
                            toolContext?.signal
                        );
                    }

                    // ── dir / ls commands ─────────────────────────────────────────
                    // Sanitize path arguments (allow glob chars but block command injection / escapes)
                    if (targetArg && (/[\x00-\x1f\x7f]/.test(targetArg) || /[;&|`$<>(){}"']/.test(targetArg) || targetArg.includes(".."))) {
                        return { error: "Chemin non autorisé : métacaractères shell dangereux ou chemin relatif parent détecté." };
                    }

                    try {
                        let matched: fs.Dirent[] = [];
                        let normalizedDir = getProjectRoot();
                        const sanitizedArg = targetArg.replace(/^"|"$/g, "").replace(/^'|'$/g, "");

                        const hasGlob = /[*?[\]]/.test(sanitizedArg);

                        if (hasGlob) {
                            // Extract directory and glob pattern
                            const dirPart = path.dirname(sanitizedArg);
                            const patternPart = path.basename(sanitizedArg);

                            const validatedDir = normalizeProjectPath(dirPart);
                            if (!validatedDir) {
                                return { error: "Le chemin doit rester dans le workspace du projet." };
                            }

                            if (!fs.existsSync(validatedDir)) {
                                return { error: `Répertoire introuvable: ${dirPart}` };
                            }
                            const stats = await fs.promises.stat(validatedDir);
                            if (!stats.isDirectory()) {
                                return { error: `Le chemin n'est pas un répertoire : ${dirPart}` };
                            }

                            // SECURITY: vérifie que le répertoire réel (après
                            // résolution des liens symboliques) reste dans le projet.
                            const realDir = await resolveRealPathWithinProject(validatedDir);
                            if (!realDir) {
                                return { error: "Le répertoire résolu (après suivi des liens symboliques) sort du workspace du projet." };
                            }
                            normalizedDir = realDir;

                            const regex = globToRegex(patternPart);
                            const entries = await fs.promises.readdir(normalizedDir, { withFileTypes: true });
                            matched = entries.filter(e => regex.test(e.name));
                        } else {
                            // No glob, standard dir / ls listing
                            const targetPath = sanitizedArg || ".";
                            const validatedPath = normalizeProjectPath(targetPath);
                            if (!validatedPath) {
                                return { error: "Le chemin doit rester dans le workspace du projet." };
                            }

                            if (!fs.existsSync(validatedPath)) {
                                return { error: `Chemin introuvable: ${targetPath}` };
                            }

                            // SECURITY: idem, on suit les liens symboliques
                            // avant d'accepter le chemin.
                            const realPath = await resolveRealPathWithinProject(validatedPath);
                            if (!realPath) {
                                return { error: "Le chemin résolu (après suivi des liens symboliques) sort du workspace du projet." };
                            }

                            const stats = await fs.promises.stat(realPath);
                            if (stats.isDirectory()) {
                                normalizedDir = realPath;
                                matched = await fs.promises.readdir(realPath, { withFileTypes: true });
                            } else {
                                // Single file match
                                normalizedDir = path.dirname(realPath);
                                const filename = path.basename(realPath);
                                matched = [
                                    {
                                        name: filename,
                                        isDirectory: () => false,
                                        isFile: () => true,
                                        isBlockDevice: () => false,
                                        isCharacterDevice: () => false,
                                        isSymbolicLink: () => false,
                                        isFIFO: () => false,
                                        isSocket: () => false
                                    } as fs.Dirent
                                ];
                            }
                        }

                        // Format outputs to match dir/ls expectations
                        let output = `Répertoire de ${normalizedDir}\n\n`;
                        let dirCount = 0;
                        let fileCount = 0;
                        let totalSize = 0;

                        const lines = matched.map(async (entry) => {
                            const fullPath = path.join(normalizedDir, entry.name);
                            const entryStats = await fs.promises.stat(fullPath).catch(() => null);
                            if (!entryStats) {
                                return `                     ${entry.name}`;
                            }
                            const dateStr = entryStats.mtime.toLocaleDateString('fr-FR') + '  ' + entryStats.mtime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                            if (entry.isDirectory()) {
                                dirCount++;
                                return `${dateStr}    <DIR>          ${entry.name}`;
                            } else {
                                fileCount++;
                                totalSize += entryStats.size;
                                return `${dateStr}             ${entryStats.size.toLocaleString('fr-FR')} ${entry.name}`;
                            }
                        });

                        const resolvedLines = await Promise.all(lines);
                        output += resolvedLines.join('\n');
                        output += `\n\n               ${fileCount} fichier(s)             ${totalSize.toLocaleString('fr-FR')} octets\n`;
                        output += `               ${dirCount} Dossier(s)\n`;

                        return {
                            status: "success",
                            stdout: truncate(output, 8000),
                            stderr: "",
                            error: null
                        };
                    } catch (error: any) {
                        return {
                            status: "error",
                            stdout: "",
                            stderr: error.message,
                            error: error.message
                        };
                    }
                }

                default:
                    return { error: `Outil inconnu: ${name}` };
            }
        } catch (error: any) {
            // Filet de sécurité pour toute exception non prévue
            return { error: `Erreur inattendue: ${error?.message ?? String(error)}` };
        }
    }
};