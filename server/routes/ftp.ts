/**
 * ftp.ts — Routes REST pour la connexion FTP workspace.
 *
 * Endpoints :
 *   POST /api/ftp/test          — Teste la connexion (retourne ok/error + auto-save si succès)
 *   POST /api/ftp/download      — Télécharge le workspace FTP (SSE streaming + auto-save)
 *   POST /api/ftp/push          — Pousse les fichiers locaux vers le FTP (SSE streaming)
 *   POST /api/ftp/list          — Liste un répertoire FTP distant
 *   POST /api/ftp/local-path    — Calcule le chemin miroir sans connexion
 *   GET  /api/ftp/servers       — Liste les serveurs FTP enregistrés
 *   DELETE /api/ftp/servers/:id — Supprime un serveur du registre
 *   PATCH  /api/ftp/servers/:id — Renomme un serveur
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { promisify } from 'util';
import { lookup } from 'dns';
import {
  testFtpConnection,
  downloadFtpWorkspace,
  pushFtpChanges,
  listFtpDirectory,
  ftpLocalMirrorPath,
  type FtpConfig,
} from "../utils/ftpSync.js";
import {
  saveFtpServer,
  listFtpServers,
  removeFtpServer,
  renameFtpServer,
} from "../utils/selfRoot.js";

const dnsLookup = promisify(lookup);

// Private IP ranges that should be blocked for FTP connections
const BLOCKED_IP_PREFIXES = [
  '127.',
  '0.',
  '10.',
  '192.168.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
  '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '169.254.',
  '::1',
  'fc',
  'fd',
  'fe80',
];

/**
 * Check if an IP address is in a private/loopback range.
 */
function isPrivateIp(hostname: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return BLOCKED_IP_PREFIXES.some((p) => hostname.startsWith(p));
  }
  if (hostname.includes(':')) {
    const lower = hostname.toLowerCase();
    return BLOCKED_IP_PREFIXES.slice(-3).some((p) => lower.startsWith(p));
  }
  return false;
}

/**
 * Validate that an FTP host is not a private/loopback IP.
 * Resolves DNS to prevent DNS rebinding attacks.
 * 
 * SECURITY NOTE: This prevents using the FTP client as a proxy to scan internal networks.
 * Set ALLOW_FTP_PRIVATE_IPS=true in .env to bypass this check for legitimate internal FTP servers.
 */
async function validateFtpHost(host: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Allow bypass for legitimate internal FTP servers
  if (process.env.ALLOW_FTP_PRIVATE_IPS === 'true') {
    return { ok: true };
  }

  // Check if host is already an IP literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) {
      return {
        ok: false,
        error: `Connexion FTP vers des adresses privées/locales interdite pour des raisons de sécurité: ${host}. Pour se connecter à un serveur FTP interne légitime, définissez ALLOW_FTP_PRIVATE_IPS=true dans votre .env.`
      };
    }
    return { ok: true };
  }

  // Resolve DNS and check the actual IP
  try {
    const resolved = await dnsLookup(host, { all: true });
    
    for (const record of resolved) {
      if (isPrivateIp(record.address)) {
        return {
          ok: false,
          error: `Le serveur FTP "${host}" résout vers une adresse privée/locale (${record.address}), ce qui est interdit pour des raisons de sécurité (prévention DNS rebinding et scan de réseau interne). Pour se connecter à un serveur FTP interne légitime, définissez ALLOW_FTP_PRIVATE_IPS=true dans votre .env.`
        };
      }
    }
    
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Impossible de résoudre le nom de domaine "${host}": ${error instanceof Error ? error.message : 'erreur DNS'}`
    };
  }
}

export function createFtpRouter(): Router {
  const router = Router();

  // ── Schéma de validation commun ─────────────────────────────────────────────
  const FtpConfigSchema = z.object({
    host: z.string().min(1, "L'hôte FTP est requis."),
    port: z.coerce.number().int().min(1).max(65535).default(21),
    user: z.string().min(1, "Le nom d'utilisateur est requis."),
    password: z.string(),
    remotePath: z.string().default("/"),
    secure: z.boolean().default(false),
  });

  // ── POST /api/ftp/test ──────────────────────────────────────────────────────
  // Teste la connexion et, en cas de succès, enregistre le serveur dans le registre.
  router.post("/test", async (req: Request, res: Response) => {
    const parsed = FtpConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, error: parsed.error.errors[0]?.message ?? "Paramètres invalides." });
    }

    const config: FtpConfig = parsed.data;
    
    // Validate host is not a private IP (security check)
    const hostCheck = await validateFtpHost(config.host);
    if (!hostCheck.ok) {
      return res.status(403).json({ ok: false, error: hostCheck.error });
    }

    const result = await testFtpConnection(config);

    if (result.ok) {
      // Auto-save le serveur dès que la connexion réussit
      const saved = saveFtpServer(
        config.host,
        config.port,
        config.user,
        config.remotePath,
        config.secure
      );
      return res.json({ ...result, saved });
    }

    return res.json(result);
  });

  // ── POST /api/ftp/download — SSE streaming ──────────────────────────────────
  router.post("/download", async (req: Request, res: Response) => {
    const parsed = FtpConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.errors[0]?.message ?? "Paramètres invalides." });
    }

    const config: FtpConfig = parsed.data;

    // Validate host is not a private IP (security check)
    const hostCheck = await validateFtpHost(config.host);
    if (!hostCheck.ok) {
      return res.status(403).json({ error: hostCheck.error });
    }

    // Setup SSE
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
      if (res.writableEnded) return;
      try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch { /* gone */ }
    };
    const finish = () => { try { if (!res.writableEnded) res.end(); } catch { /* ignore */ } };

    try {
      const localDir = await downloadFtpWorkspace(config, (info) => {
        sendEvent("log", { level: info.level, message: info.message });
      });

      sendEvent("log", { level: "info", message: "🔌 Activation du workspace…" });

      const { switchSandboxProject } = await import("../utils/sandbox.js");
      const newRoot = await switchSandboxProject(localDir);

      // Persister dans le registre des workspaces
      const { addOrUpdateWorkspace } = await import("../utils/selfRoot.js");
      const workspaceName = `FTP: ${config.host}${config.remotePath !== "/" ? config.remotePath : ""}`;
      addOrUpdateWorkspace(newRoot, undefined, workspaceName);

      // Persister/mettre à jour le serveur FTP avec le chemin miroir
      const saved = saveFtpServer(
        config.host,
        config.port,
        config.user,
        config.remotePath,
        config.secure,
        { localMirrorPath: localDir }
      );
      sendEvent("log", { level: "info", message: `💾 Serveur FTP enregistré : ${saved.name}` });

      // Recharger le Knowledge System
      try {
        const { knowledgeGraph } = await import("../knowledge/KnowledgeGraph.js");
        const { projectMemory } = await import("../knowledge/ProjectMemory.js");
        const { projectIndexer } = await import("../knowledge/ProjectIndexer.js");
        knowledgeGraph.load();
        projectMemory.load();
        projectIndexer.scanAll({ onProgress: () => {} }).catch(() => {});
        sendEvent("log", { level: "info", message: "🧠 Knowledge System rechargé." });
      } catch { /* silent */ }

      sendEvent("log", { level: "info", message: `🎉 Workspace FTP actif : ${newRoot}` });
      sendEvent("done", { status: "success", newRoot, localDir, savedServer: saved });
    } catch (err: any) {
      sendEvent("log", { level: "error", message: `❌ ${err.message || String(err)}` });
      sendEvent("error", { error: err.message || String(err) });
    } finally {
      finish();
    }
  });

  // ── POST /api/ftp/push — SSE streaming ─────────────────────────────────────
  router.post("/push", async (req: Request, res: Response) => {
    const BodySchema = z.object({
      config: FtpConfigSchema,
      localRoot: z.string().min(1, "localRoot est requis."),
      files: z.array(z.string()).optional().default([]),
    });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.errors[0]?.message ?? "Paramètres invalides." });
    }

    const { config, localRoot, files } = parsed.data;

    // Validate host is not a private IP (security check)
    const hostCheck = await validateFtpHost(config.host);
    if (!hostCheck.ok) {
      return res.status(403).json({ error: hostCheck.error });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
      if (res.writableEnded) return;
      try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch { /* ignore */ }
    };
    const finish = () => { try { if (!res.writableEnded) res.end(); } catch { /* ignore */ } };

    try {
      const uploaded = await pushFtpChanges(config as FtpConfig, localRoot, files, (info) => {
        sendEvent("log", { level: info.level, message: info.message });
      });
      sendEvent("done", { status: "success", uploaded });
    } catch (err: any) {
      sendEvent("log", { level: "error", message: `❌ ${err.message || String(err)}` });
      sendEvent("error", { error: err.message || String(err) });
    } finally {
      finish();
    }
  });

  // ── POST /api/ftp/list ──────────────────────────────────────────────────────
  router.post("/list", async (req: Request, res: Response) => {
    const BodySchema = z.object({
      config: FtpConfigSchema,
      remotePath: z.string().optional(),
    });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Paramètres invalides." });
    }

    // Validate host is not a private IP (security check)
    const hostCheck = await validateFtpHost(parsed.data.config.host);
    if (!hostCheck.ok) {
      return res.status(403).json({ error: hostCheck.error });
    }

    try {
      const entries = await listFtpDirectory(
        parsed.data.config as FtpConfig,
        parsed.data.remotePath
      );
      return res.json({
        entries: entries.map((e) => ({
          name: e.name,
          type: e.type === 2 ? "directory" : "file",
          size: e.size,
          date: e.rawModifiedAt,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ── POST /api/ftp/local-path ────────────────────────────────────────────────
  router.post("/local-path", (req: Request, res: Response) => {
    const parsed = FtpConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Paramètres invalides." });
    }
    return res.json({ localPath: ftpLocalMirrorPath(parsed.data as FtpConfig) });
  });

  // ── GET /api/ftp/servers ────────────────────────────────────────────────────
  router.get("/servers", (_req: Request, res: Response) => {
    try {
      const servers = listFtpServers();
      return res.json({ servers });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ── DELETE /api/ftp/servers/:id ─────────────────────────────────────────────
  router.delete("/servers/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "ID requis." });
    const removed = removeFtpServer(id);
    return res.json({ success: removed, id });
  });

  // ── PATCH /api/ftp/servers/:id — renommer ───────────────────────────────────
  router.patch("/servers/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const Schema = z.object({ name: z.string().min(1, "Le nom est requis.") });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Paramètres invalides." });
    }
    const updated = renameFtpServer(id, parsed.data.name);
    if (!updated) return res.status(404).json({ error: "Serveur introuvable." });
    return res.json({ success: true, server: updated });
  });

  return router;
}
