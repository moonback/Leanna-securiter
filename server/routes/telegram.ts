import { Router, Request, Response } from "express";
import { telegramService } from "../telegram/TelegramService.js";

export function createTelegramRouter(): Router {
  const router = Router();

  // GET /api/telegram/status
  router.get("/status", (_req: Request, res: Response) => {
    res.json({
      status: "success",
      data: telegramService.getStatus(),
    });
  });

  // GET /api/telegram/config
  router.get("/config", (_req: Request, res: Response) => {
    const cfg = telegramService.getConfig();
    const token = cfg.botToken || "";
    const maskedToken =
      token.length > 8
        ? token.slice(0, 4) + "••••••••" + token.slice(-4)
        : token ? "••••••••" : "";

    res.json({
      status: "success",
      config: {
        ...cfg,
        botToken: maskedToken,
        hasToken: !!token,
      },
    });
  });

  // POST /api/telegram/config
  router.post("/config", async (req: Request, res: Response) => {
    try {
      const { botToken, allowedUsers, autoStart, notificationsEnabled, defaultChatId } = req.body;

      const updatePayload: Record<string, any> = {};

      // Si un token non masqué est envoyé (ne contient pas les puces de masquage)
      if (typeof botToken === "string" && !botToken.includes("••••")) {
        updatePayload.botToken = botToken.trim();
      }

      if (Array.isArray(allowedUsers)) {
        updatePayload.allowedUsers = allowedUsers.map((u) => String(u).trim()).filter(Boolean);
      }

      if (typeof autoStart === "boolean") {
        updatePayload.autoStart = autoStart;
      }

      if (typeof notificationsEnabled === "boolean") {
        updatePayload.notificationsEnabled = notificationsEnabled;
      }

      if (typeof defaultChatId === "string") {
        updatePayload.defaultChatId = defaultChatId.trim();
      }

      telegramService.saveConfig(updatePayload);

      // Si le token a été mis à jour et que le bot tourne, on le redémarre
      if (updatePayload.botToken !== undefined && telegramService.getStatus().isRunning) {
        await telegramService.stop();
        await telegramService.start();
      }

      res.json({
        status: "success",
        data: telegramService.getStatus(),
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/start
  router.post("/start", async (_req: Request, res: Response) => {
    try {
      const result = await telegramService.start();
      if (!result.success) {
        res.status(400).json({
          status: "error",
          error: result.error || "Impossible de démarrer le bot Telegram",
          data: telegramService.getStatus(),
        });
        return;
      }

      res.json({
        status: "success",
        data: telegramService.getStatus(),
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/stop
  router.post("/stop", async (_req: Request, res: Response) => {
    try {
      await telegramService.stop();
      res.json({
        status: "success",
        data: telegramService.getStatus(),
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/test
  router.post("/test", async (req: Request, res: Response) => {
    try {
      const { chatId } = req.body;
      const target = chatId || telegramService.getConfig().defaultChatId;

      if (!target) {
        res.status(400).json({
          status: "error",
          error: "Veuillez fournir un chat_id ou configurer un Chat ID par défaut.",
        });
        return;
      }

      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      await telegramService.sendLongMessage(
        target,
        "✨ *Test de connexion Leanna OS*\n\nVotre bot Telegram est correctement configuré et communique avec succès avec Leanna !",
        { parse_mode: "Markdown" }
      );

      res.json({
        status: "success",
        message: "Message de test envoyé avec succès !",
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/send — Envoi d'un message texte arbitraire
  router.post("/send", async (req: Request, res: Response) => {
    try {
      const { chatId, message, parseMode, disableNotification, replyToMessageId } = req.body;

      const target = chatId || telegramService.getConfig().defaultChatId;
      if (!target) {
        res.status(400).json({
          status: "error",
          error: "Veuillez fournir un chat_id ou configurer un Chat ID par défaut.",
        });
        return;
      }
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({
          status: "error",
          error: "Le champ 'message' est obligatoire et ne peut pas être vide.",
        });
        return;
      }
      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      const options: any = {};
      if (parseMode === "Markdown" || parseMode === "HTML") options.parse_mode = parseMode;
      if (disableNotification === true) options.disable_notification = true;
      if (typeof replyToMessageId === "number") options.reply_to_message_id = replyToMessageId;

      const result = await telegramService.sendMessage(target, message, options);

      res.status(result.success ? 200 : 502).json({
        status: result.success ? "success" : "error",
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/photo — Envoi d'une photo
  router.post("/photo", async (req: Request, res: Response) => {
    try {
      const { chatId, photo, caption, parseMode } = req.body;

      const target = chatId || telegramService.getConfig().defaultChatId;
      if (!target) {
        res.status(400).json({
          status: "error",
          error: "Veuillez fournir un chat_id ou configurer un Chat ID par défaut.",
        });
        return;
      }
      if (!photo || typeof photo !== "string" || photo.trim().length === 0) {
        res.status(400).json({
          status: "error",
          error: "Le champ 'photo' est obligatoire (URL HTTP ou chemin de fichier).",
        });
        return;
      }
      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      const options: any = {};
      if (typeof caption === "string" && caption.length > 0) options.caption = caption;
      if (parseMode === "Markdown" || parseMode === "HTML") options.parse_mode = parseMode;

      const result = await telegramService.sendPhoto(target, photo.trim(), options);

      res.status(result.success ? 200 : 502).json({
        status: result.success ? "success" : "error",
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/document — Envoi d'un document/fichier
  router.post("/document", async (req: Request, res: Response) => {
    try {
      const { chatId, file, caption, parseMode } = req.body;

      const target = chatId || telegramService.getConfig().defaultChatId;
      if (!target) {
        res.status(400).json({
          status: "error",
          error: "Veuillez fournir un chat_id ou configurer un Chat ID par défaut.",
        });
        return;
      }
      if (!file || typeof file !== "string" || file.trim().length === 0) {
        res.status(400).json({
          status: "error",
          error: "Le champ 'file' est obligatoire (URL HTTP ou chemin de fichier).",
        });
        return;
      }
      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      const options: any = {};
      if (typeof caption === "string" && caption.length > 0) options.caption = caption;
      if (parseMode === "Markdown" || parseMode === "HTML") options.parse_mode = parseMode;

      const result = await telegramService.sendDocument(target, file.trim(), options);

      res.status(result.success ? 200 : 502).json({
        status: result.success ? "success" : "error",
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/broadcast — Diffusion à tous les utilisateurs autorisés
  router.post("/broadcast", async (req: Request, res: Response) => {
    try {
      const { message, parseMode, onlyNumericIds } = req.body;

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({
          status: "error",
          error: "Le champ 'message' est obligatoire.",
        });
        return;
      }
      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      const options: any = { onlyNumericIds: onlyNumericIds !== false };
      if (parseMode === "Markdown" || parseMode === "HTML") options.parse_mode = parseMode;

      const result = await telegramService.broadcast(message.trim(), options);

      res.json({
        status: "success",
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // GET /api/telegram/users — Liste des utilisateurs autorisés
  router.get("/users", (_req: Request, res: Response) => {
    res.json({
      status: "success",
      data: {
        allowedUsers: telegramService.getAllowedUsersList(),
        defaultChatId: telegramService.getConfig().defaultChatId,
      },
    });
  });

  // POST /api/telegram/chat-info — Informations sur un chat
  router.post("/chat-info", async (req: Request, res: Response) => {
    try {
      const { chatId } = req.body;
      if (!chatId || typeof chatId !== "string" || chatId.trim().length === 0) {
        res.status(400).json({
          status: "error",
          error: "Le champ 'chatId' est obligatoire.",
        });
        return;
      }
      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      const info = await telegramService.getChatInfo(chatId.trim());
      res.status(info.ok ? 200 : 404).json({
        status: info.ok ? "success" : "error",
        ...info,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  // POST /api/telegram/send-from-workspace — Envoi d'un fichier du workspace projet
  router.post("/send-from-workspace", async (req: Request, res: Response) => {
    try {
      const { chatId, path, caption, parseMode } = req.body;

      const target = chatId || telegramService.getConfig().defaultChatId;
      if (!target) {
        res.status(400).json({
          status: "error",
          error: "Veuillez fournir un chat_id ou configurer un Chat ID par défaut.",
        });
        return;
      }
      if (!path || typeof path !== "string" || path.trim().length === 0) {
        res.status(400).json({
          status: "error",
          error: "Le champ 'path' est obligatoire (chemin relatif dans le workspace).",
        });
        return;
      }
      if (!telegramService.getStatus().isRunning) {
        res.status(400).json({
          status: "error",
          error: "Le bot Telegram n'est pas démarré.",
        });
        return;
      }

      const options: any = {};
      if (typeof caption === "string" && caption.length > 0) options.caption = caption;
      if (parseMode === "Markdown" || parseMode === "HTML") options.parse_mode = parseMode;

      const result = await telegramService.sendFromWorkspace(target, path.trim(), options);

      res.status(result.success ? 200 : 502).json({
        status: result.success ? "success" : "error",
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: "error",
        error: (err as Error).message,
      });
    }
  });

  return router;
}

export default createTelegramRouter();
