import { Bot, type InputFile } from "grammy";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { Leanna_APP_ROOT, SELF_ROOT, hasProject, setSelfRoot, listWorkspaces } from "../utils/selfRoot.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { generateText, getActiveProvider } from "../utils/textGeneration.js";
import { buildSystemInstruction } from "../prompts/systemInstruction.js";
import { agentOrchestrator } from "../agents/index.js";
import type {
  TelegramConfig,
  TelegramStatus,
  TelegramBotInfo,
  TelegramChatInfo,
  TelegramSendResult,
  TelegramBroadcastResult,
} from "./types.js";

const execAsync = promisify(exec);

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export class TelegramService {
  private bot: Bot | null = null;
  private isRunning: boolean = false;
  private lastError: string | null = null;
  private botInfo: TelegramBotInfo | null = null;
  private config: TelegramConfig;
  private conversationHistory: Map<number, ChatMessage[]> = new Map();

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Chemin du fichier de persistance de la config Telegram
   */
  private getConfigPath(): string {
    return path.join(Leanna_APP_ROOT, ".Leanna-telegram.json");
  }

  /**
   * Charge la configuration depuis le fichier local et l'environnement
   */
  private loadConfig(): TelegramConfig {
    const envTokenRaw = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
    const envToken = envTokenRaw.startsWith("gcm:") ? decrypt(envTokenRaw) : envTokenRaw;
    const validEnvToken = envToken.startsWith("gcm:") ? "" : envToken;

    const defaultConfig: TelegramConfig = {
      botToken: validEnvToken,
      allowedUsers: [],
      autoStart: false,
      notificationsEnabled: true,
      defaultChatId: "",
    };

    try {
      const p = this.getConfigPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, "utf-8"));
        let token = "";
        if (data.botToken) {
          const dec = decrypt(data.botToken);
          // Si le déchiffrement échoue (ex: master key régénérée), ignorer la valeur corrompue
          if (!dec.startsWith("gcm:")) {
            token = dec;
          }
        }
        if (!token) {
          token = defaultConfig.botToken || "";
        }

        return {
          ...defaultConfig,
          ...data,
          botToken: token,
          allowedUsers: Array.isArray(data.allowedUsers) ? data.allowedUsers : [],
        };
      }
    } catch (e) {
      console.warn("[Telegram] Erreur lors du chargement de la config :", (e as Error).message);
    }

    return defaultConfig;
  }

  /**
   * Sauvegarde la configuration avec token chiffré
   */
  public saveConfig(newConfig: Partial<TelegramConfig>): void {
    const merged: TelegramConfig = {
      ...this.config,
      ...newConfig,
    };

    this.config = merged;

    try {
      const p = this.getConfigPath();
      const payloadToSave = {
        ...merged,
        botToken: merged.botToken ? encrypt(merged.botToken) : "",
      };
      fs.writeFileSync(p, JSON.stringify(payloadToSave, null, 2), "utf-8");
      console.log("[Telegram] Configuration sauvegardée.");
    } catch (e) {
      console.error("[Telegram] Erreur lors de la sauvegarde de la config :", e);
      throw e;
    }
  }

  public getConfig(): TelegramConfig {
    return { ...this.config };
  }

  public getStatus(): TelegramStatus {
    return {
      isRunning: this.isRunning,
      isConfigured: !!this.config.botToken && this.config.botToken.trim().length > 0,
      botInfo: this.botInfo,
      allowedUsersCount: this.config.allowedUsers.length,
      autoStart: this.config.autoStart,
      notificationsEnabled: this.config.notificationsEnabled,
      defaultChatId: this.config.defaultChatId,
      lastError: this.lastError,
    };
  }

  /**
   * Démarre le bot Telegram en mode polling
   */
  public async start(): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning) {
      return { success: true };
    }

    let token = this.config.botToken?.trim() || "";
    if (token.startsWith("gcm:")) {
      token = "";
    }
    if (!token && process.env.TELEGRAM_BOT_TOKEN) {
      const fallback = process.env.TELEGRAM_BOT_TOKEN.trim();
      token = fallback.startsWith("gcm:") ? decrypt(fallback) : fallback;
      if (token.startsWith("gcm:")) token = "";
    }
    if (!token) {
      this.lastError = "Aucun token API Telegram valide configuré.";
      return { success: false, error: this.lastError };
    }

    try {
      this.bot = new Bot(token);

      // Récupérer les infos officielles du bot
      const me = await this.bot.api.getMe();
      this.botInfo = {
        id: me.id,
        username: me.username || "",
        firstName: me.first_name,
      };

      // Gestionnaire d'erreurs
      this.bot.catch((err) => {
        const errorMsg = err.error instanceof Error ? err.error.message : String(err.error);
        console.error(`[Telegram] Erreur de session :`, errorMsg);
        this.lastError = errorMsg;
      });

      // ─── Middleware de Sécurité : Whitelist ───────────────────────────────
      this.bot.use(async (ctx, next) => {
        const senderId = ctx.from?.id ? String(ctx.from.id) : "";
        const senderUsername = ctx.from?.username ? ctx.from.username.toLowerCase() : "";

        // Enregistrer automatiquement le defaultChatId si aucun n'est défini et qu'un message arrive
        if (!this.config.defaultChatId && senderId) {
          this.config.defaultChatId = senderId;
        }

        const allowedList = this.config.allowedUsers.map((u) => u.trim().toLowerCase().replace(/^@/, ""));

        // Cas 1 : Aucune liste blanche définie
        if (allowedList.length === 0) {
          await ctx.reply(
            `🔒 *Leanna OS — Configuration de Sécurité Requise*\n\n` +
            `Votre identifiant Telegram est : \`${senderId}\` ${senderUsername ? `(@${senderUsername})` : ""}\n\n` +
            `Pour sécuriser votre machine contre tout accès non autorisé, ` +
            `veuillez ajouter cet ID dans les **Paramètres Telegram** de l'application Leanna.`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        // Cas 2 : Vérifier si l'utilisateur est autorisé
        const isAuthorized =
          (senderId && allowedList.includes(senderId)) ||
          (senderUsername && allowedList.includes(senderUsername));

        if (!isAuthorized) {
          await ctx.reply(
            `⛔ *Accès Refusé*\n\n` +
            `Votre identifiant (\`${senderId}\`) n'est pas autorisé à interagir avec cette instance de Leanna.\n` +
            `Contactez l'administrateur ou ajoutez cet ID dans les paramètres.`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        return next();
      });

      // ─── Commandes ─────────────────────────────────────────────────────────

      // /start
      this.bot.command("start", async (ctx) => {
        await ctx.reply(
          `👋 *Bonjour ${ctx.from?.first_name || ""} !*\n` +
          `Je suis connectée à votre instance de **Leanna OS**.\n\n` +
          `📌 *Commandes rapides :*\n` +
          `• \`/help\` — Guide et liste des commandes\n` +
          `• \`/status\` — État du système et projet actif\n` +
          `• \`/agent <mission>\` — Lancer une mission autonome\n` +
          `• \`/tasks [statut]\` — Lister les tâches agents\n` +
          `• \`/task <id>\` — Détail d'une tâche\n` +
          `• \`/cancel <id>\` — Annuler une tâche\n` +
          `• \`/cmd <commande>\` — Exécuter dans le terminal\n` +
          `• \`/ls [dossier]\` — Lister un dossier du projet\n` +
          `• \`/read <chemin>\` — Lire un fichier du projet\n` +
          `• \`/project [chemin]\` — Voir ou changer le projet actif\n` +
          `• \`/clear\` — Réinitialiser la mémoire du chat\n\n` +
          `💬 Vous pouvez aussi m'envoyer un message directement pour échanger !`,
          { parse_mode: "Markdown" }
        );
      });

      // /help
      this.bot.command("help", async (ctx) => {
        await ctx.reply(
          `📖 *Guide d'utilisation Leanna OS via Telegram*\n\n` +
          `*1. Chat IA*\n` +
          `Envoyez simplement vos questions, idées ou instructions. Je réponds avec le contexte de votre projet actif.\n\n` +
          `*2. Agents Autonomes*\n` +
          `Tapez \`/agent Développer une fonction de calcul de TVA\` pour déléguer la mission à la flotte d'agents.\n\n` +
          `Vous pouvez suivre l'avancement avec \`/tasks\` (liste) et \`/task <id>\` (détail d'une tâche, avec résumé et fichiers modifiés), et arrêter une tâche en cours avec \`/cancel <id>\`.\n\n` +
          `*3. Commandes Système*\n` +
          `Tapez \`/cmd npm test\` ou \`/cmd git status\` pour exécuter une commande dans la racine du projet.\n\n` +
          `*4. Explorer le projet*\n` +
          `• \`/project\` pour voir le projet actif et la liste des workspaces, ou \`/project <chemin>\` pour en changer.\n` +
          `• \`/ls\` ou \`/ls src\` pour lister les fichiers d'un dossier.\n` +
          `• \`/read package.json\` pour afficher le contenu d'un fichier (les gros fichiers sont envoyés en pièce jointe).\n\n` +
          `*5. Statut & Mémoire*\n` +
          `• \`/status\` pour voir le projet actif et la santé du système.\n` +
          `• \`/clear\` pour effacer l'historique du chat Telegram.`,
          { parse_mode: "Markdown" }
        );
      });

      // /status
      this.bot.command("status", async (ctx) => {
        const project = hasProject() ? SELF_ROOT : "Aucun projet actif";
        const provider = getActiveProvider();
        const mem = process.memoryUsage();
        const memMb = Math.round(mem.rss / 1024 / 1024);

        await ctx.reply(
          `🖥️ *État de Leanna OS*\n\n` +
          `📁 *Projet actif :* \`${project}\`\n` +
          `🧠 *Moteur IA :* \`${provider}\`\n` +
          `💾 *Mémoire RSS :* \`${memMb} Mo\`\n` +
          `🤖 *Bot connecté :* \`@${this.botInfo?.username}\`\n` +
          `🔔 *Notifications :* \`${this.config.notificationsEnabled ? "Activées" : "Désactivées"}\`\n` +
          `⏱️ *Uptime :* \`${Math.round(process.uptime() / 60)} minutes\``,
          { parse_mode: "Markdown" }
        );
      });

      // /clear
      this.bot.command("clear", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (chatId) {
          this.conversationHistory.delete(chatId);
        }
        await ctx.reply("🧹 Historique de conversation Telegram effacé.");
      });

      // /cmd
      this.bot.command("cmd", async (ctx) => {
        const commandText = ctx.match?.trim();
        if (!commandText) {
          await ctx.reply(
            "Usage : `/cmd <votre commande>`\nExemple : `/cmd git status`\n\n" +
            "_Seules des commandes simples sont autorisées : pas d'enchaînement (`&&`, `;`), de pipe (`|`), de redirection (`>`) ni de substitution (`$(…)`)._",
            { parse_mode: "Markdown" }
          );
          return;
        }

        // ─── Filtre de sécurité ────────────────────────────────────────────
        // Une liste noire ne peut jamais être exhaustive. On refuse donc d'abord
        // toute méta-syntaxe shell qui permet d'enchaîner/piper/rediriger des
        // commandes (le vecteur de contournement le plus courant : `cmd1 && cmd2`,
        // `curl … | sh`, `$(…)`, redirections), puis quelques motifs franchement
        // destructeurs. C'est de la défense en profondeur, pas une garantie :
        // /cmd reste réservé à des commandes simples dans la racine projet.
        const rejection = this.assessCommandSafety(commandText);
        if (rejection) {
          await this.replySafe(ctx, `⚠️ Commande rejetée par mesure de sécurité : ${rejection}`);
          return;
        }

        const cwd = hasProject() ? SELF_ROOT : process.cwd();
        await ctx.reply(`⚡ Exécution de : \`${commandText}\`...`, { parse_mode: "Markdown" });

        try {
          const { stdout, stderr } = await execAsync(commandText, {
            cwd,
            timeout: 30000,
            maxBuffer: 1024 * 512,
          });

          const output = (stdout || stderr || "Commande terminée sans sortie.").trim();
          await this.sendLongMessage(ctx.chat.id, `📋 *Résultat :*\n\`\`\`\n${output}\n\`\`\``, { parse_mode: "Markdown" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.replySafe(ctx, `❌ *Erreur d'exécution :*\n\`\`\`\n${message}\n\`\`\``, { parse_mode: "Markdown" });
        }
      });

      // /agent
      this.bot.command("agent", async (ctx) => {
        const taskDescription = ctx.match?.trim();
        if (!taskDescription) {
          await ctx.reply("Usage : `/agent <description de la tâche>`\nExemple : `/agent analyse les dépendances`", { parse_mode: "Markdown" });
          return;
        }

        const chatId = ctx.chat.id;
        await this.replySafe(
          ctx,
          `🚀 *Mission agent acceptée !*\nMission : _"${this.escapeMarkdown(taskDescription)}"_\nJe passe par le cerveau de Leanna (compréhension de l'objectif + planification dynamique) et je vous notifie dès que c'est terminé.`,
          { parse_mode: "Markdown" }
        );

        // On passe par le "cerveau" (GoalUnderstandingEngine + DynamicPlanner) comme
        // le fait la route web /brain/execute et le skill agents — au lieu de forcer
        // le rôle "coder". brainExecute() exécute la mission complète jusqu'au bout,
        // donc on la lance en arrière-plan et on notifie à la fin (le handler de
        // commande Telegram ne doit pas bloquer le temps d'une mission entière).
        agentOrchestrator
          .brainExecute({ goal: taskDescription, mode: "auto" })
          .then(async (result) => {
            const header = result.success
              ? `✅ *Mission terminée*`
              : `⚠️ *Mission terminée avec des réserves*`;
            let msg =
              `${header}\n` +
              `*Objectif :* ${this.escapeMarkdown(taskDescription)}\n` +
              `*Domaine :* \`${result.understanding.domain}\`\n` +
              `*Étapes :* ${result.stages.length} — *Durée :* ${Math.round(result.totalDurationMs / 1000)}s\n`;
            if (result.summary) msg += `\n*Résumé :*\n${result.summary}\n`;
            if (result.filesModified?.length) {
              msg +=
                `\n*Fichiers modifiés :*\n` +
                result.filesModified.map((f: string) => `• \`${f}\``).join("\n") +
                `\n`;
            }
            if (result.deliverables?.length) {
              msg += `\n*Livrables :*\n${result.deliverables.map((d: string) => `• ${d}`).join("\n")}\n`;
            }
            await this.sendLongMessage(chatId, msg, { parse_mode: "Markdown" });
          })
          .catch(async (e) => {
            await this.sendLongMessage(
              chatId,
              `❌ Erreur lors de l'exécution de la mission : ${(e as Error).message}`
            );
          });
      });

      // /tasks — Liste les tâches agents (optionnellement filtrées par statut)
      this.bot.command("tasks", async (ctx) => {
        const statusFilter = ctx.match?.trim().toLowerCase();
        const validStatuses = ["pending", "running", "completed", "incomplete", "failed", "cancelled"];

        const filters: { status?: any; limit: number } = { limit: 15 };
        if (statusFilter) {
          if (!validStatuses.includes(statusFilter)) {
            await ctx.reply(
              `Statut inconnu : \`${statusFilter}\`\n` +
              `Valeurs possibles : ${validStatuses.map((s) => `\`${s}\``).join(", ")}`,
              { parse_mode: "Markdown" }
            );
            return;
          }
          filters.status = statusFilter;
        }

        const tasks = agentOrchestrator.listTasks(filters);

        if (tasks.length === 0) {
          await ctx.reply(
            statusFilter
              ? `📭 Aucune tâche avec le statut \`${statusFilter}\`.`
              : "📭 Aucune tâche agent enregistrée pour le moment.",
            { parse_mode: "Markdown" }
          );
          return;
        }

        const statusEmoji: Record<string, string> = {
          pending: "⏳",
          running: "🔄",
          completed: "✅",
          incomplete: "⚠️",
          failed: "❌",
          cancelled: "🚫",
        };

        const lines = tasks.map((t) => {
          const emoji = statusEmoji[t.status] || "•";
          return `${emoji} \`${t.id.slice(0, 8)}\` — *${t.role}* — ${t.title}`;
        });

        await this.sendLongMessage(
          ctx.chat.id,
          `📋 *Tâches agents${statusFilter ? ` (${statusFilter})` : ""}* — ${tasks.length} résultat(s)\n\n` +
          lines.join("\n") +
          `\n\n_Astuce : \`/task <id>\` pour le détail d'une tâche._`,
          { parse_mode: "Markdown" }
        );
      });

      // /task <id> — Détail d'une tâche agent
      this.bot.command("task", async (ctx) => {
        const taskIdInput = ctx.match?.trim();
        if (!taskIdInput) {
          await ctx.reply("Usage : `/task <id>`\nExemple : `/task a1b2c3d4`", { parse_mode: "Markdown" });
          return;
        }

        // Correspondance exacte, ou par préfixe court (8 premiers caractères)
        let task = agentOrchestrator.getTask(taskIdInput);
        if (!task) {
          const match = agentOrchestrator
            .listTasks()
            .find((t) => t.id.startsWith(taskIdInput));
          task = match ?? undefined;
        }

        if (!task) {
          await ctx.reply(`🔍 Aucune tâche trouvée pour l'identifiant \`${taskIdInput}\`.`, { parse_mode: "Markdown" });
          return;
        }

        const statusEmoji: Record<string, string> = {
          pending: "⏳",
          running: "🔄",
          completed: "✅",
          incomplete: "⚠️",
          failed: "❌",
          cancelled: "🚫",
        };

        let msg =
          `${statusEmoji[task.status] || "•"} *Tâche* \`${task.id}\`\n\n` +
          `*Titre :* ${task.title}\n` +
          `*Rôle :* \`${task.role}\`\n` +
          `*Statut :* \`${task.status}\`\n` +
          `*Priorité :* \`${task.priority}\`\n` +
          `*Créée :* \`${task.createdAt}\`\n`;

        if (task.startedAt) msg += `*Démarrée :* \`${task.startedAt}\`\n`;
        if (task.completedAt) msg += `*Terminée :* \`${task.completedAt}\`\n`;

        msg += `\n*Description :*\n${task.description}\n`;

        if (task.result) {
          const r = task.result;
          msg += `\n─────────────\n*Résultat :* ${r.success ? "✅ succès" : "❌ échec"} (\`${r.outcome}\`)\n`;
          if (r.blockReason) msg += `*Cause du blocage :* \`${r.blockReason}\`\n`;
          if (r.summary) msg += `*Résumé :* ${r.summary}\n`;
          if (typeof r.durationMs === "number") msg += `*Durée :* \`${Math.round(r.durationMs / 1000)}s\`\n`;
          if (r.filesModified?.length) {
            msg += `*Fichiers modifiés :*\n${r.filesModified.map((f) => `• \`${f}\``).join("\n")}\n`;
          }
          if (r.error) msg += `*Erreur :* \`${r.error}\`\n`;
        }

        await this.sendLongMessage(ctx.chat.id, msg, { parse_mode: "Markdown" });
      });

      // /read <chemin> — Lit un fichier du projet actif et renvoie son contenu
      this.bot.command("read", async (ctx) => {
        const relPath = ctx.match?.trim();
        if (!relPath) {
          await ctx.reply("Usage : `/read <chemin>`\nExemple : `/read package.json`", { parse_mode: "Markdown" });
          return;
        }

        const rootDir = hasProject() ? SELF_ROOT : process.cwd();
        const resolved = this.resolveInsideRoot(rootDir, relPath);
        if (!resolved) {
          await ctx.reply("⛔ Chemin refusé : l'accès en dehors du projet n'est pas autorisé.");
          return;
        }

        try {
          const stat = await fs.promises.stat(resolved);
          if (stat.isDirectory()) {
            await ctx.reply(`📁 \`${relPath}\` est un dossier. Utilisez \`/ls ${relPath}\` pour le lister.`, { parse_mode: "Markdown" });
            return;
          }

          const maxBytes = 64 * 1024; // 64 Ko
          if (stat.size > maxBytes) {
            await ctx.reply(
              `📦 Fichier trop volumineux pour l'affichage (\`${Math.round(stat.size / 1024)} Ko\`). ` +
              `Envoi en pièce jointe...`,
              { parse_mode: "Markdown" }
            );
            await this.sendFromWorkspace(String(ctx.chat.id), relPath, {});
            return;
          }

          const content = await fs.promises.readFile(resolved, "utf-8");
          const ext = path.extname(resolved).replace(".", "") || "";
          const body = content.trim() || "(fichier vide)";
          await this.sendLongMessage(
            ctx.chat.id,
            `📄 *${relPath}*\n\`\`\`${ext}\n${body}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.replySafe(ctx, `❌ Impossible de lire \`${relPath}\` : ${message}`, { parse_mode: "Markdown" });
        }
      });

      // /ls [dossier] — Liste le contenu d'un dossier du projet actif
      this.bot.command("ls", async (ctx) => {
        const relPath = ctx.match?.trim() || ".";
        const rootDir = hasProject() ? SELF_ROOT : process.cwd();
        const resolved = this.resolveInsideRoot(rootDir, relPath);
        if (!resolved) {
          await ctx.reply("⛔ Chemin refusé : l'accès en dehors du projet n'est pas autorisé.");
          return;
        }

        try {
          const stat = await fs.promises.stat(resolved);
          if (!stat.isDirectory()) {
            await ctx.reply(`📄 \`${relPath}\` est un fichier. Utilisez \`/read ${relPath}\` pour le lire.`, { parse_mode: "Markdown" });
            return;
          }

          const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
          if (entries.length === 0) {
            await ctx.reply(`📂 \`${relPath}\` est vide.`, { parse_mode: "Markdown" });
            return;
          }

          const sorted = entries
            .filter((e) => !e.name.startsWith(".") || relPath !== ".")
            .sort((a, b) => {
              // Dossiers d'abord, puis alphabétique
              if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
              return a.name.localeCompare(b.name);
            });

          const MAX_ENTRIES = 100;
          const shown = sorted.slice(0, MAX_ENTRIES);
          const lines = shown.map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`));

          let footer = "";
          if (sorted.length > MAX_ENTRIES) {
            footer = `\n\n_… et ${sorted.length - MAX_ENTRIES} autre(s) élément(s)._`;
          }

          await this.sendLongMessage(
            ctx.chat.id,
            `📂 *${relPath}* — ${sorted.length} élément(s)\n\n${lines.join("\n")}${footer}`,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.replySafe(ctx, `❌ Impossible de lister \`${relPath}\` : ${message}`, { parse_mode: "Markdown" });
        }
      });

      // /cancel <id> — Annule une tâche agent
      this.bot.command("cancel", async (ctx) => {
        const taskIdInput = ctx.match?.trim();
        if (!taskIdInput) {
          await ctx.reply("Usage : `/cancel <id>`\nExemple : `/cancel a1b2c3d4`", { parse_mode: "Markdown" });
          return;
        }

        // Correspondance exacte, ou par préfixe court (comme /task)
        let task = agentOrchestrator.getTask(taskIdInput);
        if (!task) {
          const match = agentOrchestrator.listTasks().find((t) => t.id.startsWith(taskIdInput));
          task = match ?? undefined;
        }

        if (!task) {
          await ctx.reply(`🔍 Aucune tâche trouvée pour l'identifiant \`${taskIdInput}\`.`, { parse_mode: "Markdown" });
          return;
        }

        // Statuts terminaux : rien à annuler
        const terminalStatuses = ["completed", "failed", "cancelled", "incomplete"];
        if (terminalStatuses.includes(task.status)) {
          await ctx.reply(
            `ℹ️ La tâche \`${task.id.slice(0, 8)}\` est déjà terminée (\`${task.status}\`) — rien à annuler.`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        const cancelled = agentOrchestrator.cancelTask(task.id);
        if (cancelled) {
          await ctx.reply(
            `🚫 *Tâche annulée*\n\`${task.id.slice(0, 8)}\` — ${task.title}`,
            { parse_mode: "Markdown" }
          );
        } else {
          await ctx.reply(
            `⚠️ Impossible d'annuler la tâche \`${task.id.slice(0, 8)}\` (statut actuel : \`${task.status}\`).`,
            { parse_mode: "Markdown" }
          );
        }
      });

      // /project [chemin] — Affiche ou change le projet actif
      this.bot.command("project", async (ctx) => {
        const target = ctx.match?.trim();

        // Sans argument : afficher le projet actif + les workspaces connus
        if (!target) {
          const current = hasProject() ? SELF_ROOT : null;
          const workspaces = listWorkspaces();

          let msg = current
            ? `📁 *Projet actif :*\n\`${current}\`\n`
            : `📭 *Aucun projet actif actuellement.*\n`;

          if (workspaces.length > 0) {
            const lines = workspaces.slice(0, 15).map((w) => {
              const isActive = current && path.resolve(w.path) === path.resolve(current);
              const marker = isActive ? "✅ " : "• ";
              return `${marker}*${w.name}*\n   \`${w.path}\``;
            });
            msg +=
              `\n*Workspaces connus :*\n${lines.join("\n")}\n\n` +
              `_Pour changer : \`/project <chemin complet>\`_`;
          } else {
            msg += `\n_Pour définir un projet : \`/project <chemin complet>\`_`;
          }

          await this.sendLongMessage(ctx.chat.id, msg, { parse_mode: "Markdown" });
          return;
        }

        // Avec argument : changer de projet actif
        try {
          const newRoot = setSelfRoot(target);
          await this.replySafe(
            ctx,
            `✅ *Projet actif changé*\n\`${newRoot}\``,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.replySafe(ctx, `❌ Impossible de changer de projet : ${message}`, { parse_mode: "Markdown" });
        }
      });

      // Messages vocaux
      this.bot.on("message:voice", async (ctx) => {
        await ctx.reply(
          `🎙️ *Message vocal reçu*\n` +
          `Durée : ${ctx.message.voice.duration}s.\n` +
          `_Note : La transcription vocale directe Telegram est prête pour vos échanges._`,
          { parse_mode: "Markdown" }
        );
      });

      // Gestion des messages texte généraux (Chat avec Leanna)
      this.bot.on("message:text", async (ctx) => {
        const userText = ctx.message.text.trim();
        if (userText.startsWith("/")) return; // Ne pas traiter les commandes ici

        const chatId = ctx.chat.id;
        let history = this.conversationHistory.get(chatId) || [];

        // Maintenir un historique de 12 tours max
        if (history.length > 12) {
          history = history.slice(history.length - 12);
        }

        // Afficher l'action de frappe (typing)
        await ctx.replyWithChatAction("typing");

        try {
          const sysPrompt = buildSystemInstruction({
            language: "fr",
            responseStyle: "concise",
            workspace: hasProject() ? SELF_ROOT : undefined,
          });

          // Formater l'historique conversationnel pour le prompt
          let contextHistory = "";
          if (history.length > 0) {
            contextHistory = "\n\n[Historique de la conversation Telegram]\n" +
              history.map((m) => `${m.role === "user" ? "Utilisateur" : "Leanna"}: ${m.text}`).join("\n");
          }

          const fullPrompt = `${contextHistory}\n\nUtilisateur: ${userText}\n\nRéponds de façon utile, claire et concise.`;

          const result = await generateText({
            prompt: fullPrompt,
            systemPrompt: sysPrompt,
            temperature: 0.7,
            maxTokens: 2048,
          });

          const replyText = result.text.trim() || "Je n'ai pas pu formuler de réponse.";

          // Enregistrer dans l'historique
          history.push({ role: "user", text: userText });
          history.push({ role: "model", text: replyText });
          this.conversationHistory.set(chatId, history);

          await this.sendLongMessage(chatId, replyText);
        } catch (err) {
          console.error("[Telegram] Erreur lors de la réponse IA :", err);
          await this.replySafe(ctx, `⚠️ Désolé, une erreur est survenue lors de la génération de ma réponse : ${(err as Error).message}`);
        }
      });

      // Démarrage effectif du long polling
      this.bot.start({
        onStart: (botInfo) => {
          this.isRunning = true;
          this.lastError = null;
          console.log(`[Telegram] ✅ Bot @${botInfo.username} démarré avec succès (mode Polling).`);
        },
      }).catch((err) => {
        this.isRunning = false;
        const msg = err instanceof Error ? err.message : String(err);
        this.lastError = msg;
        console.error("[Telegram] ❌ Échec du démarrage du polling :", msg);
      });

      this.isRunning = true;
      this.lastError = null;
      return { success: true };
    } catch (e) {
      this.isRunning = false;
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      console.error("[Telegram] Erreur start() :", msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Arrête proprement le bot
   */
  public async stop(): Promise<void> {
    if (!this.isRunning || !this.bot) return;

    try {
      await this.bot.stop();
      this.isRunning = false;
      console.log("[Telegram] 🛑 Bot arrêté proprement.");
    } catch (e) {
      console.warn("[Telegram] Erreur lors de l'arrêt :", (e as Error).message);
    } finally {
      this.bot = null;
      this.isRunning = false;
    }
  }

  /**
   * Résout un chemin relatif à l'intérieur d'un répertoire racine, en empêchant
   * toute évasion hors de la racine (protection contre le path traversal `../`).
   * Retourne le chemin absolu résolu, ou `null` si le chemin sort de la racine.
   */
  /**
   * Évalue si une commande /cmd est acceptable. Retourne `null` si elle est
   * autorisée, sinon une courte raison de refus.
   *
   * Stratégie : refuser toute méta-syntaxe shell qui permet de composer/masquer
   * des commandes (chaînage, pipe, substitution, redirection), puis quelques
   * motifs explicitement destructeurs. C'est volontairement conservateur.
   */
  private assessCommandSafety(command: string): string | null {
    // 1. Méta-caractères shell qui permettent d'échapper à la commande simple.
    //    Ex: `git status && rm -rf .`, `curl x | sh`, `cat $(…)`, `echo > .env`.
    const shellMetaChars = /(\|\||&&|[;|`]|\$\(|\$\{|>>|>|<|\n|\r)/;
    if (shellMetaChars.test(command)) {
      return "les enchaînements, pipes, redirections et substitutions shell ne sont pas autorisés.";
    }

    // 2. Motifs explicitement dangereux (dans n'importe quelle forme).
    const dangerous: Array<{ re: RegExp; why: string }> = [
      { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\b.*-f|-f\b.*-r)/i, why: "suppression récursive forcée (rm -rf)." },
      { re: /\brm\s+-[a-z]*r/i, why: "suppression récursive (rm -r)." },
      { re: /\b(rmdir|rd)\s+\/s/i, why: "suppression récursive de dossier." },
      { re: /\bdel\s+\/[sq]/i, why: "suppression en masse (del /s /q)." },
      { re: /\bformat\s+[a-z]:/i, why: "formatage de disque." },
      { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: "arrêt/redémarrage du système." },
      { re: /\b(mkfs|dd)\b/i, why: "écriture disque bas niveau." },
      { re: /:\(\)\s*\{/,  why: "fork bomb suspectée." },
      { re: /\b(curl|wget|iwr|invoke-webrequest)\b/i, why: "téléchargement réseau (risque de curl | sh)." },
      { re: /(^|[\\\/\s])\.env(\.|\b)/i, why: "accès à un fichier de secrets (.env)." },
      { re: /\b(id_rsa|id_ed25519|\.pem|credentials|secrets?)\b/i, why: "accès à des identifiants/clés." },
      { re: /\bchmod\s+-R\b/i, why: "modification récursive de permissions." },
    ];

    for (const { re, why } of dangerous) {
      if (re.test(command)) return why;
    }

    return null;
  }

  private resolveInsideRoot(rootDir: string, relPath: string): string | null {
    const normalizedRoot = path.resolve(rootDir);
    const resolved = path.resolve(normalizedRoot, relPath);
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;
    if (resolved !== normalizedRoot && !resolved.startsWith(rootWithSep)) {
      return null;
    }
    return resolved;
  }

  /**
   * Découpe et envoie les messages trop longs (> 4000 caractères)
   */
  /**
   * Échappe les caractères spéciaux du Markdown "legacy" de Telegram (`_ * \` [`)
   * pour un texte utilisateur interpolé dans un message formaté, afin d'éviter
   * qu'un titre/description contenant `_`, `*` ou `` ` `` ne casse le rendu.
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*`\[])/g, "\\$1");
  }

  /**
   * Wrapper autour de ctx.reply qui, en cas d'échec de parsing Markdown/HTML,
   * renvoie le même texte en clair. Filet de sécurité pour les réponses directes
   * qui injectent du texte utilisateur (missions, erreurs, chemins…).
   */
  private async replySafe(
    ctx: any,
    text: string,
    options?: { parse_mode?: "Markdown" | "HTML"; disable_notification?: boolean }
  ): Promise<void> {
    try {
      await ctx.reply(text, options);
    } catch {
      const fallback = options?.disable_notification ? { disable_notification: true } : undefined;
      await ctx.reply(text, fallback);
    }
  }

  /**
   * Applique le réglage global `notificationsEnabled`. Lorsqu'il est désactivé,
   * on force `disable_notification: true` : le message est bien livré (il a été
   * demandé explicitement), mais sans faire sonner/vibrer le téléphone. Un
   * appelant qui a déjà demandé un envoi silencieux le reste.
   */
  private applyNotificationPreference<T extends { disable_notification?: boolean }>(
    options?: T
  ): T {
    const merged = { ...(options || {}) } as T;
    if (!this.config.notificationsEnabled) {
      merged.disable_notification = true;
    }
    return merged;
  }

  /** Longueur maximale d'un morceau de message Telegram (limite réelle : 4096). */
  private static readonly MAX_CHUNK = 3900;

  /**
   * Découpe un texte en morceaux <= MAX_CHUNK, en préférant couper sur un saut
   * de ligne proche de la fin du morceau pour ne pas casser un paragraphe.
   * Source unique de vérité pour sendLongMessage et sendLongMessageWithReturn.
   */
  private splitMessage(text: string): string[] {
    const MAX_CHUNK = TelegramService.MAX_CHUNK;
    if (text.length <= MAX_CHUNK) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      let chunkSize = Math.min(MAX_CHUNK, remaining.length);
      if (chunkSize < remaining.length) {
        const lastNewline = remaining.lastIndexOf("\n", chunkSize);
        if (lastNewline > MAX_CHUNK * 0.7) {
          chunkSize = lastNewline + 1;
        }
      }
      chunks.push(remaining.slice(0, chunkSize));
      remaining = remaining.slice(chunkSize);
    }
    return chunks;
  }

  public async sendLongMessage(
    chatId: number | string,
    text: string,
    options?: { parse_mode?: "Markdown" | "HTML"; disable_notification?: boolean }
  ): Promise<void> {
    if (!this.bot) {
      throw new Error("Bot Telegram non initialisé.");
    }

    const fallbackOptions = options?.disable_notification
      ? { disable_notification: true }
      : undefined;

    for (const chunk of this.splitMessage(text)) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, options as any);
      } catch {
        // En cas d'erreur de parsing Markdown, renvoyer le morceau en texte brut
        await this.bot.api.sendMessage(chatId, chunk, fallbackOptions as any);
      }
    }
  }

  /**
   * Envoie une notification vers le(s) utilisateur(s) configuré(s)
   */
  public async notify(message: string): Promise<boolean> {
    if (!this.isRunning || !this.bot) return false;
    if (!this.config.notificationsEnabled) return false;

    let targetChatId = this.config.defaultChatId;

    // Si pas de defaultChatId, chercher dans les allowedUsers un ID numérique
    if (!targetChatId) {
      targetChatId = this.config.allowedUsers.find((u) => /^\d+$/.test(u.trim()));
    }

    if (!targetChatId) {
      return false;
    }

    try {
      await this.sendLongMessage(targetChatId, `🔔 *Notification Leanna OS*\n\n${message}`, {
        parse_mode: "Markdown",
      });
      return true;
    } catch (e) {
      console.warn("[Telegram] Notification non délivrée :", (e as Error).message);
      return false;
    }
  }

  /**
   * Envoie un message texte direct à un chat spécifique (pour usage API et skill)
   */
  public async sendMessage(
    chatId: string | number,
    text: string,
    options?: {
      parse_mode?: "Markdown" | "HTML";
      disable_notification?: boolean;
      reply_to_message_id?: number;
    }
  ): Promise<TelegramSendResult> {
    if (!this.isRunning || !this.bot) {
      return { success: false, chatId: String(chatId), error: "Bot Telegram non démarré ou non initialisé." };
    }

    if (!text || text.trim().length === 0) {
      return { success: false, chatId: String(chatId), error: "Le texte du message est vide." };
    }

    // Respecter le réglage "notifications". On ne bloque PAS l'envoi (ce serait un
    // faux "success" trompeur pour un message adressé explicitement), mais quand
    // les notifications sont désactivées on force un envoi silencieux.
    const effectiveOptions = this.applyNotificationPreference(options);

    try {
      const sent = await this.sendLongMessageWithReturn(chatId, text, effectiveOptions);
      return {
        success: true,
        chatId: String(chatId),
        messageId: sent?.message_id,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[Telegram] sendMessage échoué vers ${chatId}:`, errMsg);
      return { success: false, chatId: String(chatId), error: errMsg };
    }
  }

  /**
   * Version interne de sendLongMessage qui retourne le Message pour récupérer message_id
   */
  private async sendLongMessageWithReturn(
    chatId: number | string,
    text: string,
    options?: { parse_mode?: "Markdown" | "HTML"; disable_notification?: boolean; reply_to_message_id?: number }
  ): Promise<any> {
    if (!this.bot) throw new Error("Bot Telegram non initialisé.");

    const fallbackOptions = { disable_notification: options?.disable_notification };

    let lastMsg: any = null;
    for (const chunk of this.splitMessage(text)) {
      try {
        lastMsg = await this.bot.api.sendMessage(chatId, chunk, options as any);
      } catch {
        lastMsg = await this.bot.api.sendMessage(chatId, chunk, fallbackOptions as any);
      }
    }
    return lastMsg;
  }

  /**
   * Envoie une photo à un chat spécifique (URL ou chemin de fichier local)
   */
  public async sendPhoto(
    chatId: string | number,
    photoSource: string,
    options?: {
      caption?: string;
      parse_mode?: "Markdown" | "HTML";
      disable_notification?: boolean;
    }
  ): Promise<TelegramSendResult> {
    if (!this.isRunning || !this.bot) {
      return { success: false, chatId: String(chatId), error: "Bot Telegram non démarré ou non initialisé." };
    }

    try {
      let input: string | InputFile;
      if (photoSource.startsWith("http://") || photoSource.startsWith("https://")) {
        input = photoSource;
      } else if (fs.existsSync(photoSource)) {
        input = fs.createReadStream(photoSource) as unknown as InputFile;
      } else if (hasProject() && fs.existsSync(path.join(SELF_ROOT, photoSource))) {
        input = fs.createReadStream(path.join(SELF_ROOT, photoSource)) as unknown as InputFile;
      } else {
        return { success: false, chatId: String(chatId), error: "Source de la photo introuvable (URL invalide ou fichier inexistant)." };
      }

      const effectiveOptions = this.applyNotificationPreference(options);
      const result = await this.bot.api.sendPhoto(chatId, input as any, effectiveOptions as any);
      return {
        success: true,
        chatId: String(chatId),
        messageId: result?.message_id,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { success: false, chatId: String(chatId), error: errMsg };
    }
  }

  /**
   * Envoie un document/fichier à un chat spécifique (URL ou chemin de fichier local)
   */
  public async sendDocument(
    chatId: string | number,
    docSource: string,
    options?: {
      caption?: string;
      parse_mode?: "Markdown" | "HTML";
      disable_notification?: boolean;
    }
  ): Promise<TelegramSendResult> {
    if (!this.isRunning || !this.bot) {
      return { success: false, chatId: String(chatId), error: "Bot Telegram non démarré ou non initialisé." };
    }

    try {
      let input: string | InputFile;
      let resolvedPath = "";

      if (docSource.startsWith("http://") || docSource.startsWith("https://")) {
        input = docSource;
      } else {
        if (fs.existsSync(docSource)) {
          resolvedPath = docSource;
        } else if (hasProject() && fs.existsSync(path.join(SELF_ROOT, docSource))) {
          resolvedPath = path.join(SELF_ROOT, docSource);
        } else {
          return { success: false, chatId: String(chatId), error: "Document introuvable (URL invalide ou fichier inexistant)." };
        }
        const stats = fs.statSync(resolvedPath);
        if (stats.size > 50 * 1024 * 1024) {
          return { success: false, chatId: String(chatId), error: "Fichier trop volumineux (max 50 Mo pour les documents Telegram)." };
        }
        input = fs.createReadStream(resolvedPath) as unknown as InputFile;
      }

      const result = await this.bot.api.sendDocument(chatId, input as any, options as any);
      return {
        success: true,
        chatId: String(chatId),
        messageId: result?.message_id,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { success: false, chatId: String(chatId), error: errMsg };
    }
  }

  /**
   * Envoie un message à tous les utilisateurs autorisés (broadcast)
   */
  public async broadcast(
    message: string,
    options?: {
      parse_mode?: "Markdown" | "HTML";
      disable_notification?: boolean;
      onlyNumericIds?: boolean;
    }
  ): Promise<TelegramBroadcastResult> {
    const result: TelegramBroadcastResult = {
      total: 0,
      success: 0,
      failed: 0,
      errors: [],
    };

    const recipients = this.config.allowedUsers.filter((u) => {
      if (options?.onlyNumericIds) {
        return /^\d+$/.test(u.trim());
      }
      return u.trim().length > 0;
    });

    if (this.config.defaultChatId && !recipients.includes(this.config.defaultChatId)) {
      recipients.push(this.config.defaultChatId);
    }

    result.total = recipients.length;

    if (!this.isRunning || !this.bot || result.total === 0) {
      return result;
    }

    const effectiveOptions = this.applyNotificationPreference(options);

    for (const recipient of recipients) {
      try {
        await this.sendLongMessage(recipient.trim(), message, effectiveOptions);
        result.success++;
      } catch (e) {
        result.failed++;
        result.errors.push({
          chatId: recipient.trim(),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    console.log(`[Telegram] Broadcast terminé : ${result.success}/${result.total} livrés.`);
    return result;
  }

  /**
   * Récupère la liste des utilisateurs autorisés
   */
  public getAllowedUsersList(): string[] {
    return [...this.config.allowedUsers];
  }

  /**
   * Récupère les informations détaillées sur un chat Telegram
   */
  public async getChatInfo(chatId: string | number): Promise<TelegramChatInfo & { ok: boolean; error?: string }> {
    if (!this.isRunning || !this.bot) {
      return { ok: false, chatId: String(chatId), error: "Bot Telegram non démarré ou non initialisé." };
    }

    try {
      const chat = await this.bot.api.getChat(chatId);
      return {
        ok: true,
        chatId: String(chat.id),
        type: chat.type,
        title: (chat as any).title,
        username: (chat as any).username,
        firstName: (chat as any).first_name,
        lastName: (chat as any).last_name,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { ok: false, chatId: String(chatId), error: errMsg };
    }
  }

  /**
   * Envoie un fichier depuis le workspace racine (alias pratique pour les skills)
   */
  public async sendFromWorkspace(
    chatId: string | number,
    relativePath: string,
    options?: {
      caption?: string;
      parse_mode?: "Markdown" | "HTML";
      disable_notification?: boolean;
    }
  ): Promise<TelegramSendResult> {
    if (!hasProject()) {
      return { success: false, chatId: String(chatId), error: "Aucun projet actif dans le workspace." };
    }

    // Même vérification anti-path-traversal que resolveInsideRoot() : on compare
    // avec un séparateur de fin pour éviter qu'un dossier voisin (ex: "projet-privé"
    // vs racine "projet") ne passe le simple startsWith(root).
    const resolved = this.resolveInsideRoot(SELF_ROOT, relativePath);
    if (!resolved) {
      return { success: false, chatId: String(chatId), error: "Tentative d'accès en dehors du workspace refusée (sécurité)." };
    }

    const ext = path.extname(resolved).toLowerCase();
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

    if (imageExts.includes(ext)) {
      return this.sendPhoto(chatId, resolved, options);
    }
    return this.sendDocument(chatId, resolved, options);
  }
}

export const telegramService = new TelegramService();
