/**
 * Routeur pour la génération d'agents personnalisés via IA.
 * Extrait de server.ts (Sprint 1 — découpage).
 */

import { Router } from 'express';
import { handleGenerateAgent } from './generate-agent.js';

export function createAgentBuilderRouter(): Router {
  const router = Router();

  // POST /api/agent-builder/generate
  router.post('/generate', handleGenerateAgent);

  return router;
}
