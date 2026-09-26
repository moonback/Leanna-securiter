import { z } from "zod";
import { Skill } from "./base.js";
import { telegramService } from "../telegram/TelegramService.js";

export const telegramSkill: Skill = {
  name: "telegram",
  // Permissions déclarées explicitement, appliquées au runtime par le ToolRegistry.
  // Par défaut réseau (envoi via l'API Telegram) ; les requêtes locales de statut
  // sont en lecture seule. Sans cette déclaration, l'inférence par nom classerait
  // à tort les outils d'envoi comme "read" (voir SkillAdapter.inferPermissions).
  permissions: ["network"],
  toolPermissions: {
    telegram_notify: ["network"],
    telegram_send_message: ["network"],
    telegram_send_photo: ["network"],
    telegram_send_document: ["network"],
    telegram_send_from_workspace: ["read", "network"],
    telegram_broadcast: ["network"],
    telegram_get_status: ["read"],
    telegram_list_users: ["read"],
    telegram_get_chat_info: ["network"],
  },
  declarations: [
    {
      name: "telegram_notify",
      description:
        "Envoyer une notification/alerte sur le chat Telegram par défaut. Utilise ceci pour prévenir l'utilisateur d'un événement important.",
      parameters: z.object({
        message: z.string().describe("Le contenu du message de notification à envoyer"),
      }),
    },
    {
      name: "telegram_send_message",
      description:
        "Envoie un message texte direct à un chat Telegram spécifique (ou au chat par défaut). Supporte Markdown pour le formatage.",
      parameters: z.object({
        message: z.string().describe("Le contenu du message à envoyer (supporte le Markdown)"),
        chatId: z
          .string()
          .optional()
          .describe("Optionnel : identifiant du chat destinataire. Si omis, utilise le chat par défaut."),
        parseMode: z
          .enum(["Markdown", "HTML", "none"])
          .optional()
          .default("Markdown")
          .describe("Format de rendu du message : Markdown (défaut), HTML, ou none pour texte brut."),
        disableNotification: z
          .boolean()
          .optional()
          .default(false)
          .describe("Si true, envoie le message sans faire vibrer/sonner le téléphone du destinataire."),
      }),
    },
    {
      name: "telegram_send_photo",
      description:
        "Envoie une photo (depuis une URL, un chemin local, ou un fichier du workspace) à un chat Telegram. Supporte une légende.",
      parameters: z.object({
        photo: z
          .string()
          .describe(
            "Source de l'image : URL HTTP(S), chemin de fichier local absolu, ou chemin relatif depuis la racine du workspace."
          ),
        chatId: z
          .string()
          .optional()
          .describe("Optionnel : identifiant du chat destinataire. Si omis, utilise le chat par défaut."),
        caption: z.string().optional().describe("Légende facultative à afficher sous la photo."),
        parseMode: z
          .enum(["Markdown", "HTML", "none"])
          .optional()
          .default("Markdown")
          .describe("Format de rendu de la légende."),
      }),
    },
    {
      name: "telegram_send_document",
      description:
        "Envoie un document/fichier (PDF, ZIP, TXT, code source...) depuis une URL, un chemin local ou le workspace. Max 50 Mo.",
      parameters: z.object({
        file: z
          .string()
          .describe(
            "Source du document : URL HTTP(S), chemin de fichier local absolu, ou chemin relatif depuis la racine du workspace."
          ),
        chatId: z
          .string()
          .optional()
          .describe("Optionnel : identifiant du chat destinataire. Si omis, utilise le chat par défaut."),
        caption: z.string().optional().describe("Légende facultative à afficher avec le document."),
        parseMode: z
          .enum(["Markdown", "HTML", "none"])
          .optional()
          .default("Markdown")
          .describe("Format de rendu de la légende."),
      }),
    },
    {
      name: "telegram_send_from_workspace",
      description:
        "Envoie un fichier directement depuis le workspace projet actif. Sécurisé : impossible de sortir de la racine projet. Auto-détecte images vs documents.",
      parameters: z.object({
        path: z
          .string()
          .describe("Chemin relatif du fichier dans le workspace (ex: 'src/main.ts', 'rapport.pdf', 'assets/logo.png')."),
        chatId: z
          .string()
          .optional()
          .describe("Optionnel : identifiant du chat destinataire. Si omis, utilise le chat par défaut."),
        caption: z.string().optional().describe("Légende facultative."),
        parseMode: z
          .enum(["Markdown", "HTML", "none"])
          .optional()
          .default("Markdown")
          .describe("Format de rendu de la légende."),
      }),
    },
    {
      name: "telegram_broadcast",
      description:
        "Diffuse un message à TOUS les utilisateurs autorisés de la whitelist Telegram. Utiliser avec parcimonie (notifications globales).",
      parameters: z.object({
        message: z.string().describe("Le message à diffuser à tous les utilisateurs autorisés."),
        parseMode: z
          .enum(["Markdown", "HTML", "none"])
          .optional()
          .default("Markdown")
          .describe("Format de rendu du message."),
        onlyNumericIds: z
          .boolean()
          .optional()
          .default(true)
          .describe("Si true, n'envoie qu'aux utilisateurs dont l'ID est numérique (recommandé pour éviter les échecs)."),
      }),
    },
    {
      name: "telegram_get_status",
      description:
        "Obtenir l'état complet du bot Telegram : démarrage ou non, token configuré, username du bot, nombre d'utilisateurs autorisés, Chat ID par défaut, erreurs récentes.",
      parameters: z.object({}),
    },
    {
      name: "telegram_list_users",
      description:
        "Retourne la liste complète des utilisateurs autorisés (whitelist) configurés dans les paramètres Telegram.",
      parameters: z.object({}),
    },
    {
      name: "telegram_get_chat_info",
      description:
        "Récupère les détails d'un chat Telegram : type (privé/groupe/supergroup/canal), titre, username, prénom/nom du contact.",
      parameters: z.object({
        chatId: z.string().describe("Identifiant du chat à interroger (numérique ou @username)."),
      }),
    },
  ],
  handleToolCall: async (name, args) => {
    const getDefaultChatId = (): string | undefined => {
      const cfg = telegramService.getConfig();
      return cfg.defaultChatId || cfg.allowedUsers.find((u) => /^\d+$/.test(u.trim()));
    };

    const buildOptions = (args: any): any => {
      const opts: any = {};
      if (args.parseMode && args.parseMode !== "none") opts.parse_mode = args.parseMode;
      if (args.disableNotification) opts.disable_notification = args.disableNotification;
      if (args.caption) opts.caption = args.caption;
      return opts;
    };

    // ─── telegram_notify ──────────────────────────────────────────────────────
    if (name === "telegram_notify") {
      const { message } = args as { message: string };
      if (!message || message.trim().length === 0) {
        return { success: false, error: "Le message ne peut pas être vide." };
      }
      const delivered = await telegramService.notify(message);
      return {
        success: delivered,
        delivered,
        detail: delivered
          ? "Notification envoyée avec succès sur Telegram."
          : "Le bot Telegram n'est pas actif ou aucun destinataire par défaut n'est configuré.",
      };
    }

    // ─── telegram_send_message ────────────────────────────────────────────────
    if (name === "telegram_send_message") {
      const { message, chatId, parseMode, disableNotification } = args as {
        message: string;
        chatId?: string;
        parseMode?: "Markdown" | "HTML" | "none";
        disableNotification?: boolean;
      };
      const target = chatId || getDefaultChatId();
      if (!target) {
        return {
          success: false,
          error:
            "Aucun chatId fourni et aucun chat par défaut configuré. Configurez Telegram dans les paramètres de Leanna.",
        };
      }
      if (!message || message.trim().length === 0) {
        return { success: false, error: "Le message ne peut pas être vide." };
      }
      const options: any = {};
      if (parseMode && parseMode !== "none") options.parse_mode = parseMode;
      if (disableNotification) options.disable_notification = disableNotification;
      return telegramService.sendMessage(target, message, options);
    }

    // ─── telegram_send_photo ──────────────────────────────────────────────────
    if (name === "telegram_send_photo") {
      const { photo, chatId, caption, parseMode } = args as {
        photo: string;
        chatId?: string;
        caption?: string;
        parseMode?: "Markdown" | "HTML" | "none";
      };
      const target = chatId || getDefaultChatId();
      if (!target) {
        return { success: false, error: "Aucun chatId fourni et aucun chat par défaut configuré." };
      }
      if (!photo || photo.trim().length === 0) {
        return { success: false, error: "La source de la photo est requise." };
      }
      const options: any = buildOptions({ caption, parseMode });
      return telegramService.sendPhoto(target, photo.trim(), options);
    }

    // ─── telegram_send_document ───────────────────────────────────────────────
    if (name === "telegram_send_document") {
      const { file, chatId, caption, parseMode } = args as {
        file: string;
        chatId?: string;
        caption?: string;
        parseMode?: "Markdown" | "HTML" | "none";
      };
      const target = chatId || getDefaultChatId();
      if (!target) {
        return { success: false, error: "Aucun chatId fourni et aucun chat par défaut configuré." };
      }
      if (!file || file.trim().length === 0) {
        return { success: false, error: "La source du document est requise." };
      }
      const options: any = buildOptions({ caption, parseMode });
      return telegramService.sendDocument(target, file.trim(), options);
    }

    // ─── telegram_send_from_workspace ─────────────────────────────────────────
    if (name === "telegram_send_from_workspace") {
      const { path, chatId, caption, parseMode } = args as {
        path: string;
        chatId?: string;
        caption?: string;
        parseMode?: "Markdown" | "HTML" | "none";
      };
      const target = chatId || getDefaultChatId();
      if (!target) {
        return { success: false, error: "Aucun chatId fourni et aucun chat par défaut configuré." };
      }
      if (!path || path.trim().length === 0) {
        return { success: false, error: "Le chemin du fichier dans le workspace est requis." };
      }
      const options: any = buildOptions({ caption, parseMode });
      return telegramService.sendFromWorkspace(target, path.trim(), options);
    }

    // ─── telegram_broadcast ───────────────────────────────────────────────────
    if (name === "telegram_broadcast") {
      const { message, parseMode, onlyNumericIds } = args as {
        message: string;
        parseMode?: "Markdown" | "HTML" | "none";
        onlyNumericIds?: boolean;
      };
      if (!message || message.trim().length === 0) {
        return { success: false, error: "Le message de diffusion ne peut pas être vide." };
      }
      const options: any = { onlyNumericIds };
      if (parseMode && parseMode !== "none") options.parse_mode = parseMode;
      const result = await telegramService.broadcast(message, options);
      return {
        success: result.success > 0,
        total: result.total,
        delivered: result.success,
        failed: result.failed,
        errors: result.errors,
        detail:
          result.success === result.total
            ? `✅ Broadcast réussi : ${result.success}/${result.total} messages livrés.`
            : `⚠️ Broadcast partiel : ${result.success}/${result.total} livrés, ${result.failed} échecs.`,
      };
    }

    // ─── telegram_get_status ──────────────────────────────────────────────────
    if (name === "telegram_get_status") {
      return telegramService.getStatus();
    }

    // ─── telegram_list_users ──────────────────────────────────────────────────
    if (name === "telegram_list_users") {
      const users = telegramService.getAllowedUsersList();
      return {
        success: true,
        total: users.length,
        allowedUsers: users,
        defaultChatId: telegramService.getConfig().defaultChatId,
      };
    }

    // ─── telegram_get_chat_info ───────────────────────────────────────────────
    if (name === "telegram_get_chat_info") {
      const { chatId } = args as { chatId: string };
      if (!chatId || chatId.trim().length === 0) {
        return { success: false, error: "Le chatId est requis." };
      }
      return telegramService.getChatInfo(chatId.trim());
    }

    throw new Error(`Outil inconnu dans telegramSkill: ${name}`);
  },
};
