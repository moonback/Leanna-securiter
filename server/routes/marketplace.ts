/**
 * Routeur API Marketplace Leanna.
 *
 * Endpoints :
 *  GET  /api/marketplace/search           — Recherche dans le catalogue
 *  GET  /api/marketplace/featured         — Paquets mis en avant
 *  GET  /api/marketplace/installed        — Paquets installés localement
 *  GET  /api/marketplace/stats            — Statistiques globales
 *  GET  /api/marketplace/package/:id      — Détail d'un paquet
 *  POST /api/marketplace/install          — Installer un paquet (agent + skills)
 *  POST /api/marketplace/uninstall        — Désinstaller un paquet
 *  POST /api/marketplace/publish          — Publier un paquet dans le registre local
 *  POST /api/marketplace/rate             — Noter / commenter un paquet
 *  GET  /api/marketplace/export/:id       — Exporter un paquet en JSON téléchargeable
 */

import { Router, type Request, type Response } from "express";
import { marketplaceRegistry, runSecurityAnalysis } from "../marketplace/MarketplaceRegistry.js";
import {
  MarketplaceSearchSchema,
  InstallPackageSchema,
  RatePackageSchema,
  PublishPackageSchema,
} from "../marketplace/types.js";
import { dynamicAgentRegistry } from "../agents/DynamicAgentRegistry.js";
import { agentRegistry } from "../agents/AgentRegistry.js";
import { getAgentDefinition } from "../agents/roles.js";
import { createClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";
import path from "path";
import fs from "fs";
import { SELF_ROOT } from "../utils/selfRoot.js";

const log = createLogger("MarketplaceAPI");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Tente d'installer le skill dans Supabase (custom_skills) si Supabase est configuré */
async function installSkillToSupabase(skill: any): Promise<{ success: boolean; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { success: false, error: "Supabase non configuré — skill enregistré localement uniquement" };
  }
  try {
    const supabase = createClient(url, key);
    // Vérifier si le skill existe déjà
    const { data: existing } = await supabase
      .from("custom_skills")
      .select("id")
      .eq("name", skill.name)
      .maybeSingle();

    if (existing) {
      return { success: true }; // déjà présent, pas d'erreur
    }

    const { error } = await supabase.from("custom_skills").insert({
      name: skill.name,
      description: skill.description || "",
      parameters: skill.parameters || [],
      instruction: skill.instruction,
      category: skill.category || "custom",
      enabled: true,
      icon: skill.icon || "Zap",
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Installe un agent dans le DynamicAgentRegistry + fichier custom-agents.json */
function installAgentLocally(agentDef: any): { success: boolean; error?: string } {
  try {
    const role = agentDef.role;
    // Ignorer si rôle statique
    if (getAgentDefinition(role)) {
      return { success: false, error: `Le rôle "${role}" est réservé par un agent statique` };
    }

    // Enregistrer dans le registre dynamique (override si réinstallation)
    dynamicAgentRegistry.registerAgent(
      {
        role,
        name: agentDef.name,
        description: agentDef.description || "",
        systemPrompt: agentDef.systemPrompt || "",
        capabilities: agentDef.capabilities || agentDef.tools || [],
        maxConcurrency: agentDef.maxConcurrency ?? 2,
        defaultTimeoutMs: agentDef.defaultTimeoutMs ?? 60_000,
        version: "1.0.0",
        tags: agentDef.triggerKeywords || [],
        isActive: true,
        author: "marketplace",
      },
      true // override
    );

    if (agentRegistry.isReady) {
      agentRegistry.registerAndStartDynamicAgent(role);
    }

    // Persister dans custom-agents.json
    const filePath = path.join(SELF_ROOT || process.cwd(), ".Leanna", "custom-agents.json");
    let agents: any[] = [];
    if (fs.existsSync(filePath)) {
      try {
        agents = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (!Array.isArray(agents)) agents = [];
      } catch { agents = []; }
    }
    // Supprimer l'ancienne entrée si elle existe
    agents = agents.filter((a: any) => a.role !== role);
    agents.push({
      ...agentDef,
      id: `marketplace-${role}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(agents, null, 2), "utf-8");

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Routeur
// ═══════════════════════════════════════════════════════════════════════════════

export function createMarketplaceRouter(): Router {
  const router = Router();

  // ── GET /search ─────────────────────────────────────────────────────────────
  router.get("/search", (req: Request, res: Response) => {
    const parsed = MarketplaceSearchSchema.safeParse({
      query: req.query.query,
      type: req.query.type,
      category: req.query.category,
      sort: req.query.sort ?? "popular",
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 20,
      verified: req.query.verified !== undefined ? req.query.verified === "true" : undefined,
      featured: req.query.featured !== undefined ? req.query.featured === "true" : undefined,
      tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
    });

    if (!parsed.success) {
      res.status(400).json({
        error: "Paramètres invalides",
        details: parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
      return;
    }

    try {
      const result = marketplaceRegistry.search(parsed.data);
      res.json({ success: true, ...result });
    } catch (e: any) {
      log.error(`Erreur recherche Marketplace: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /featured ────────────────────────────────────────────────────────────
  router.get("/featured", (_req: Request, res: Response) => {
    try {
      const featured = marketplaceRegistry.getFeatured();
      res.json({ success: true, packages: featured });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /installed ───────────────────────────────────────────────────────────
  router.get("/installed", (_req: Request, res: Response) => {
    try {
      const installed = marketplaceRegistry.getInstalled();
      res.json({ success: true, packages: installed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /stats ───────────────────────────────────────────────────────────────
  router.get("/stats", (_req: Request, res: Response) => {
    try {
      const stats = marketplaceRegistry.getStats();
      res.json({ success: true, stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /package/:id ─────────────────────────────────────────────────────────
  router.get("/package/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const pkg = marketplaceRegistry.getPackage(id);
    if (!pkg) {
      res.status(404).json({ error: `Paquet "${id}" introuvable` });
      return;
    }
    res.json({ success: true, package: pkg });
  });

  // ── POST /install ────────────────────────────────────────────────────────────
  router.post("/install", async (req: Request, res: Response) => {
    const parsed = InstallPackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Corps invalide",
        details: parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
      return;
    }

    const { packageId } = parsed.data;
    const pkg = marketplaceRegistry.getPackage(packageId);
    if (!pkg) {
      res.status(404).json({ error: `Paquet "${packageId}" introuvable` });
      return;
    }

    // Bloquer les paquets flaggés
    if (pkg.security.trustLevel === "flagged") {
      res.status(403).json({
        error: "Installation refusée : ce paquet a été signalé pour des problèmes de sécurité",
        securityReport: pkg.security,
      });
      return;
    }

    const warnings: string[] = [];
    let agentInstalled = false;
    let skillsInstalled = 0;

    try {
      // Installer l'agent si présent
      if (pkg.agent) {
        const result = installAgentLocally(pkg.agent);
        if (result.success) {
          agentInstalled = true;
          log.info(`🤖 Agent "${pkg.agent.role}" installé depuis le Marketplace`);
        } else {
          warnings.push(`Agent: ${result.error}`);
        }
      }

      // Installer les skills si présents
      if (pkg.skills?.length) {
        for (const skill of pkg.skills) {
          const result = await installSkillToSupabase(skill);
          if (result.success) {
            skillsInstalled++;
            log.info(`🔧 Skill "${skill.name}" installé depuis le Marketplace`);
          } else {
            warnings.push(`Skill "${skill.name}": ${result.error}`);
          }
        }
      }

      // Marquer comme installé
      marketplaceRegistry.markInstalled(packageId);

      res.json({
        success: true,
        packageId,
        agentInstalled,
        skillsInstalled,
        warnings: warnings.length > 0 ? warnings : undefined,
        message: `"${pkg.name}" installé avec succès.${agentInstalled ? " Agent disponible dans l'Agent Builder." : ""}${skillsInstalled > 0 ? " " + skillsInstalled + " skill(s) ajouté(s)." : ""}`,
      });
    } catch (e: any) {
      log.error(`Erreur installation "${packageId}": ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /uninstall ──────────────────────────────────────────────────────────
  router.post("/uninstall", (req: Request, res: Response) => {
    const { packageId } = req.body;
    if (!packageId) {
      res.status(400).json({ error: "packageId requis" });
      return;
    }

    const pkg = marketplaceRegistry.getPackage(packageId);
    if (!pkg) {
      res.status(404).json({ error: `Paquet "${packageId}" introuvable` });
      return;
    }

    try {
      // Désinstaller l'agent si présent
      if (pkg.agent) {
        const role = pkg.agent.role;
        if (!getAgentDefinition(role)) {
          dynamicAgentRegistry.unregisterAgent(role);
          if (agentRegistry.isReady) {
            agentRegistry.unregisterDynamicAgent(role);
          }
          // Retirer du custom-agents.json
          const filePath = path.join(SELF_ROOT || process.cwd(), ".Leanna", "custom-agents.json");
          if (fs.existsSync(filePath)) {
            try {
              const agents = JSON.parse(fs.readFileSync(filePath, "utf-8"));
              const filtered = agents.filter((a: any) => a.role !== role);
              fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), "utf-8");
            } catch { /* silencieux */ }
          }
        }
      }

      marketplaceRegistry.markUninstalled(packageId);
      res.json({ success: true, message: `"${pkg.name}" désinstallé.` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /publish ────────────────────────────────────────────────────────────
  router.post("/publish", (req: Request, res: Response) => {
    const parsed = PublishPackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Corps invalide",
        details: parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
      return;
    }

    try {
      const result = marketplaceRegistry.publish(parsed.data);
      if (!result.success) {
        res.status(422).json({
          error: result.error,
          securityReport: result.securityReport,
        });
        return;
      }
      res.json({
        success: true,
        package: result.package,
        securityReport: result.securityReport,
        message: `Paquet "${result.package?.name}" publié dans le registre local.`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /rate ───────────────────────────────────────────────────────────────
  router.post("/rate", (req: Request, res: Response) => {
    const parsed = RatePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Corps invalide",
        details: parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
      return;
    }

    const result = marketplaceRegistry.ratePackage(parsed.data);
    if (!result.success) {
      res.status(404).json({ error: result.error });
      return;
    }

    const pkg = marketplaceRegistry.getPackage(parsed.data.packageId);
    res.json({
      success: true,
      newRating: pkg?.stats.rating,
      reviewCount: pkg?.stats.reviewCount,
    });
  });

  // ── POST /validate-security ───────────────────────────────────────────────────
  router.post("/validate-security", (req: Request, res: Response) => {
    const parsed = PublishPackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Corps invalide", details: parsed.error.errors });
      return;
    }
    const report = runSecurityAnalysis(parsed.data);
    res.json({ success: true, securityReport: report });
  });

  // ── GET /export/:id ───────────────────────────────────────────────────────────
  router.get("/export/:id", (req: Request, res: Response) => {
    const pkg = marketplaceRegistry.getPackage(req.params.id);
    if (!pkg) {
      res.status(404).json({ error: `Paquet "${req.params.id}" introuvable` });
      return;
    }
    const filename = `${pkg.id}-v${pkg.version}.leanna.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(pkg, null, 2));
  });

  return router;
}
