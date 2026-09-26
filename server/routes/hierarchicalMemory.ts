import { Router, Request, Response } from "express";
import {
  hierarchicalMemoryService,
  type HierarchicalTier,
} from "../runtime/HierarchicalMemoryService.js";

const router = Router();

// GET /api/memory/hierarchical/stats
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await hierarchicalMemoryService.getStats();
    res.json({ success: true, stats });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/memory/hierarchical/search
router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = String(req.query.query || "").trim();
    const tier = (req.query.tier as HierarchicalTier | "all") || "all";
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const category = req.query.category ? String(req.query.category) : undefined;
    
    let tags: string[] | undefined;
    if (req.query.tags) {
      if (Array.isArray(req.query.tags)) {
        tags = req.query.tags.map(String);
      } else {
        tags = String(req.query.tags).split(",").map(t => t.trim()).filter(Boolean);
      }
    }

    const results = await hierarchicalMemoryService.search(query, {
      tier,
      limit,
      category,
      tags,
    });

    res.json({ success: true, count: results.length, results });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/memory/hierarchical/list
router.get("/list", async (req: Request, res: Response) => {
  try {
    const tier = (req.query.tier as HierarchicalTier) || "session";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const items = await hierarchicalMemoryService.list(tier, { limit, offset });
    res.json({ success: true, tier, count: items.length, items });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/memory/hierarchical/store
router.post("/store", async (req: Request, res: Response) => {
  try {
    const { tier, content, category, tags, confidence, ttl, key } = req.body;
    if (!tier || !content) {
      return res.status(400).json({ success: false, error: "Les champs 'tier' et 'content' sont requis." });
    }

    const item = await hierarchicalMemoryService.store(tier as HierarchicalTier, {
      key,
      content,
      category,
      tags: Array.isArray(tags) ? tags : [],
      confidence: typeof confidence === "number" ? confidence : undefined,
      ttl: typeof ttl === "number" ? ttl : undefined,
    });

    res.status(201).json({ success: true, item });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/memory/hierarchical/promote
router.post("/promote", async (req: Request, res: Response) => {
  try {
    const { id, fromTier, toTier, category, tags, removeSource } = req.body;
    if (!id || !fromTier || !toTier) {
      return res.status(400).json({
        success: false,
        error: "Les champs 'id', 'fromTier' et 'toTier' sont obligatoires.",
      });
    }

    const item = await hierarchicalMemoryService.promote(
      id,
      fromTier,
      toTier,
      {
        category,
        tags: Array.isArray(tags) ? tags : [],
        removeSource: Boolean(removeSource),
      }
    );

    res.json({ success: true, item });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/memory/hierarchical/:tier/clear
router.delete("/:tier/clear", async (req: Request, res: Response) => {
  try {
    const tier = req.params.tier as HierarchicalTier;
    if (!["session", "project", "longterm"].includes(tier)) {
      return res.status(400).json({ success: false, error: "Tier invalide" });
    }

    const cleared = await hierarchicalMemoryService.clear(tier);
    res.json({ success: cleared });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/memory/hierarchical/:tier/:id
router.delete("/:tier/:id", async (req: Request, res: Response) => {
  try {
    const tier = req.params.tier as HierarchicalTier;
    const id = req.params.id;

    if (!["session", "project", "longterm"].includes(tier)) {
      return res.status(400).json({ success: false, error: "Tier invalide" });
    }

    const deleted = await hierarchicalMemoryService.delete(tier, id);
    res.json({ success: deleted });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
