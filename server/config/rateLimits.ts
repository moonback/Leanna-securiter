import express from "express";
import { rateLimit } from "express-rate-limit";
import compression from "compression";
import { resolveWorkspacePath } from "../security.js";
import * as path from "path";

export interface RateLimitDeps {
  isDev: boolean;
  getDefaultWorkspaceRoot: () => string;
  getElectronAppRoot: () => string;
}

export interface RateLimitBundle {
  skipForLocal: (req: any) => boolean;
  notebookChatLimiter: ReturnType<typeof rateLimit>;
  notebookEmbeddingLimiter: ReturnType<typeof rateLimit>;
}

export function createRateLimitBundle(deps: RateLimitDeps): RateLimitBundle {
  const { isDev } = deps;

  const skipForLocal = (req: any): boolean => {
    if (isDev) return true;
    const ip = req.ip || req.socket?.remoteAddress || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  };

  const notebookChatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isDev ? 1_000_000 : 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipForLocal,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => `nb-chat-${req.ip}`,
    message: { error: "Trop de requêtes chat. Veuillez ralentir." },
  });

  const notebookEmbeddingLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: isDev ? 1_000_000 : 50,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipForLocal,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => `nb-emb-${req.ip}`,
    message: { error: "Trop de requêtes d'embedding. Veuillez patienter." },
  });

  return { skipForLocal, notebookChatLimiter, notebookEmbeddingLimiter };
}

export function applyGlobalRateLimits(
  app: express.Express,
  bundle: RateLimitBundle,
  deps: RateLimitDeps
): void {
  const { isDev } = deps;
  const { skipForLocal } = bundle;

  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 1_000_000 : 10_000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipForLocal,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." },
  });

  const pollingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isDev ? 1_000_000 : 30_000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipForLocal,
    message: { error: "Trop de requêtes polling." },
  });

  const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: isDev ? 1_000_000 : 150,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipForLocal,
    message: { error: "Trop de tentatives d'authentification." },
  });

  const pickByMethod =
    (readLimiter: ReturnType<typeof rateLimit>, writeLimiter: ReturnType<typeof rateLimit>) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method === "GET") return readLimiter(req, res, next);
      return writeLimiter(req, res, next);
    };

  app.use("/api/ide", pickByMethod(pollingLimiter, strictLimiter));
  app.use("/api/sandbox", pickByMethod(pollingLimiter, strictLimiter));
  app.use("/api/safeguards", pickByMethod(pollingLimiter, strictLimiter));
  app.use("/api/knowledge", pickByMethod(pollingLimiter, strictLimiter));

  app.use(/^\/api\/(auth|login|token)/, authLimiter);
  app.use("/api", strictLimiter);
}

export function applyStaticAndCompression(
  app: express.Express,
  deps: RateLimitDeps & {
    getWorkspaceRoot: () => string;
  }
): void {
  const { getElectronAppRoot, getWorkspaceRoot } = deps;

  // Limite par défaut pour les routes générales (10mb suffit pour la plupart des requêtes API)
  // Les routes d'upload (upload-document, notebooks sources, documents) utilisent multer
  // avec leurs propres limites élevées (50mb) et ne sont pas affectées par cette limite
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  
  // Compression gzip/brotli pour toutes les routes API (pas seulement /api/ide)
  // Améliore les temps de chargement pour les payloads volumineux (graphe de connaissances,
  // résultats RAG, historiques de chat, listes d'entités)
  app.use("/api", compression());

  const monacoPath = path.join(getElectronAppRoot(), "node_modules", "monaco-editor");
  app.use("/monaco-editor", express.static(monacoPath));

  app.use(
    "/workspace-preview",
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const ip = req.ip || req.socket?.remoteAddress || "";
      const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
      if (!isLocal) return res.status(403).json({ error: "Accès interdit depuis un hôte distant." });
      return next();
    },
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const root = getWorkspaceRoot();
      const resolved = resolveWorkspacePath(req.path, root);
      if (!resolved.ok) return res.status(403).json({ error: "Chemin non autorisé." });
      return express.static(root, { dotfiles: "ignore" })(req, res, next);
    },
    (_req: express.Request, res: express.Response) => {
      return res.status(404).send("Fichier introuvable.");
    }
  );
}
