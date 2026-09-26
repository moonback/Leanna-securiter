import { Router, Request, Response } from "express";

// ═══════════════════════════════════════════════════════════════════════════════
// Missions Router — Approbation humaine & curseur d'autonomie
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expose au frontend les actions liées au curseur d'autonomie :
 *   - approuver / refuser une action en attente (mode "ask")
 *   - lister les approbations en attente d'une mission
 *   - lire et modifier le mode d'autonomie (suggest / ask / auto)
 *
 * L'Executor est fourni via un getter, car il est initialisé de façon
 * asynchrone dans le bootstrap (peut être null au tout début).
 */
export function createMissionsRouter(
  getExecutor: () => any | null,
  handleToolCall?: (name: string, args: any) => Promise<any>
): Router {
  const router = Router();

  // ── Créer une mission (chemin déterministe, indépendant du LLM) ──────────
  router.post("/missions", async (req: Request, res: Response) => {
    if (!handleToolCall) {
      return res.status(503).json({ error: "Création de mission indisponible (handler non configuré)." });
    }
    const { title, description, priority, dryRun } = req.body ?? {};
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Champ 'title' (string) requis." });
    }
    if (typeof description !== "string" || !description.trim()) {
      return res.status(400).json({ error: "Champ 'description' (string) requis." });
    }
    try {
      // Réutilise exactement le chemin du skill (validation, skills disponibles, executor).
      const result = await handleToolCall("mission_create", {
        title: title.trim(),
        description: description.trim(),
        priority: priority ?? "medium",
        dryRun: dryRun === true,
      });
      if (result && typeof result === "object" && "error" in result) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  const requireExecutor = (res: Response): any | null => {
    const executor = getExecutor();
    if (!executor) {
      res.status(503).json({ error: "Mission System non initialisé." });
      return null;
    }
    return executor;
  };

  /** Sérialise une Mission (instance) vers la forme attendue par le frontend. */
  const serializeMission = (mission: any) => {
    const state = mission.getState();
    const goalsRecord = state.goals ?? {};
    // Sous-objectifs = tous les goals ayant un parent (on exclut la racine).
    const goals = Object.values(goalsRecord)
      .filter((g: any) => g.parentId !== null)
      .map((g: any) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        actions: (g.plannedActions ?? []).map((a: any) => ({
          id: a.id,
          skill: a.skillName,
          status: a.status,
          confidence: a.reflection?.confidence,
          decision: a.reflection?.decision,
          durationMs: undefined,
        })),
      }));

    return {
      id: state.id,
      title: state.title,
      status: state.status,
      priority: state.priority,
      goals,
      activeGoalId: state.activeGoalId,
      confidence: state.metrics?.averageConfidence ?? 0.5,
      metrics: {
        totalActions: state.metrics?.totalActions ?? 0,
        successfulActions: state.metrics?.successfulActions ?? 0,
        failedActions: state.metrics?.failedActions ?? 0,
      },
      createdAt: state.createdAt,
    };
  };

  // ── Lister les missions (actives + complétées) — état initial du panneau ──
  router.get("/missions", (_req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;
    try {
      const active = (executor.listActiveMissions?.() ?? []).map(serializeMission);
      const completed = (executor.listCompletedMissions?.() ?? []).map(serializeMission);
      return res.json({ missions: [...active, ...completed] });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Approuver / refuser une action en attente ────────────────────────────
  router.post("/missions/:id/approve", (req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;

    const { actionId, approved } = req.body ?? {};
    if (typeof actionId !== "string" || !actionId.trim()) {
      return res.status(400).json({ error: "Champ 'actionId' (string) requis." });
    }
    if (typeof approved !== "boolean") {
      return res.status(400).json({ error: "Champ 'approved' (boolean) requis." });
    }

    const resolved = executor.resolveApproval(actionId, approved);
    if (!resolved) {
      return res.status(404).json({
        error: "Aucune approbation en attente pour cet actionId (peut-être déjà résolue ou expirée).",
        actionId,
      });
    }
    return res.json({ ok: true, actionId, approved });
  });

  // ── Mettre une mission en pause ──────────────────────────────────────────
  router.post("/missions/:id/pause", (req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;

    const missionId = req.params.id;
    const ok = executor.pauseMission?.(missionId) ?? false;
    if (!ok) {
      return res.status(404).json({
        error: "Mission introuvable, déjà en pause, ou non active.",
        missionId,
      });
    }
    return res.json({ ok: true, missionId, status: "paused" });
  });

  // ── Reprendre une mission en pause ───────────────────────────────────────
  router.post("/missions/:id/resume", (req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;

    const missionId = req.params.id;
    const ok = executor.resumeMission?.(missionId) ?? false;
    if (!ok) {
      return res.status(404).json({
        error: "Mission introuvable ou non en pause.",
        missionId,
      });
    }
    return res.json({ ok: true, missionId, status: "in_progress" });
  });

  // ── Annuler une mission active ───────────────────────────────────────────
  router.post("/missions/:id/cancel", (req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;

    const missionId = req.params.id;
    const ok = executor.cancelMission?.(missionId) ?? false;
    if (!ok) {
      return res.status(404).json({
        error: "Mission introuvable ou déjà terminée.",
        missionId,
      });
    }
    return res.json({ ok: true, missionId, status: "cancelled" });
  });

  // ── Supprimer une mission (active → annulée puis retirée, ou historique) ──
  router.delete("/missions/:id", (req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;

    const missionId = req.params.id;
    const ok = executor.deleteMission?.(missionId) ?? false;
    if (!ok) {
      return res.status(404).json({ error: "Mission introuvable.", missionId });
    }
    return res.json({ ok: true, missionId, deleted: true });
  });

  // ── Lister les approbations en attente ───────────────────────────────────
  router.get("/missions/pending-approvals", (_req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;
    return res.json({ pending: executor.listPendingApprovals() });
  });

  // ── Lire le mode d'autonomie courant ─────────────────────────────────────
  router.get("/missions/autonomy", (_req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;
    const policy = executor.getAutonomyPolicy?.();
    if (!policy) return res.json({ mode: null, enabled: false });
    return res.json({ mode: policy.getMode(), enabled: true });
  });

  // ── Modifier le mode d'autonomie ─────────────────────────────────────────
  router.post("/missions/autonomy", (req: Request, res: Response) => {
    const executor = requireExecutor(res);
    if (!executor) return;

    const { mode } = req.body ?? {};
    if (!["suggest", "ask", "auto"].includes(mode)) {
      return res.status(400).json({ error: "Champ 'mode' invalide (suggest | ask | auto)." });
    }
    const policy = executor.getAutonomyPolicy?.();
    if (!policy) return res.status(503).json({ error: "Curseur d'autonomie non configuré." });

    policy.setMode(mode);
    return res.json({ ok: true, mode });
  });

  return router;
}
