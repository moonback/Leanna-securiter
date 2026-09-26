import { Router, Request, Response } from 'express';
import type { SkillManagerV2 } from '../runtime/compat/SkillManagerV2.js';

// Type compatible avec l'ancien SkillManager pour une migration progressive
type SkillManager = SkillManagerV2;

/**
 * Crée le router custom-skills en injectant le SkillManager.
 * Après chaque mutation CRUD, le proxy est rechargé immédiatement
 * pour que l'IA voie les changements sans redémarrage.
 */
export function createCustomSkillsRouter(skillManager?: SkillManager): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { getAllCustomSkills, createCustomSkill, updateCustomSkill, deleteCustomSkill, invalidateCustomSkillsCache } = await import('../skills/customSkills');
      const { action, ...payload } = req.body;

      switch (action) {
        case 'list': {
          const skills = await getAllCustomSkills();
          return res.json({ skills });
        }
        case 'create': {
          const skill = await createCustomSkill({
            name: payload.name,
            description: payload.description ?? '',
            parameters: payload.parameters ?? [],
            instruction: payload.instruction ?? '',
            category: payload.category ?? 'custom',
            enabled: true,
            icon: payload.icon ?? 'Sparkles',
          });
          invalidateCustomSkillsCache();
          // Recharger le proxy dans le SkillManager pour que l'IA voie le nouveau skill immédiatement
          if (skillManager) skillManager.loadCustomSkills().catch(() => {});
          return res.json(skill);
        }
        case 'update': {
          const { id, ...updates } = payload;
          if (!id) return res.status(400).json({ error: 'ID requis' });
          const updated = await updateCustomSkill(id, updates);
          invalidateCustomSkillsCache();
          if (skillManager) skillManager.loadCustomSkills().catch(() => {});
          return res.json(updated);
        }
        case 'delete': {
          if (!payload.id) return res.status(400).json({ error: 'ID requis' });
          await deleteCustomSkill(payload.id);
          invalidateCustomSkillsCache();
          if (skillManager) skillManager.loadCustomSkills().catch(() => {});
          return res.json({ success: true });
        }
        default:
          return res.status(400).json({ error: `Action inconnue: ${action}` });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

// Export par défaut sans skillManager pour rétrocompatibilité (si importé sans factory)
export default createCustomSkillsRouter();
