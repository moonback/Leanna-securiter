/**
 * Workflow d'audit périodique du codebase.
 *
 * Ce workflow est planifié toutes les 24h et effectue :
 * 1. Génération du codebase.md (structure + analyse OpenRouter)
 * 2. Vérification TypeScript (tsc --noEmit)
 * 3. Exécution des tests
 * 4. Sauvegarde d'un résumé en mémoire (pour notification à l'utilisateur)
 *
 * Le workflow est auto-enregistré au démarrage s'il n'existe pas déjà.
 * Il utilise le moteur workflow existant et n'est exécuté que si le serveur tourne.
 */

import { createWorkflow, listWorkflows, type WorkflowDefinition } from "../skills/workflow.js";

const AUDIT_WORKFLOW_NAME = "audit-codebase-periodique";

export const AUDIT_WORKFLOW_DEFINITION = {
  name: AUDIT_WORKFLOW_NAME,
  description:
    "Audit automatique complet : vérifie l'état Git, génère le codebase.md, vérifie la compilation TypeScript, " +
    "exécute les tests, scanne les pistes d'amélioration, vérifie les propositions en attente, " +
    "et sauvegarde un rapport détaillé en mémoire. S'exécute toutes les 24h.",
  schedule: "24h",
  steps: [
    {
      id: "git-check",
      action: "git_status",
      args: {},
      label: "État Git (branche, fichiers modifiés/staged/untracked)",
      onError: "skip" as const,
      maxRetries: 0,
    },
    {
      id: "generate-codebase",
      action: "generate_codebase_markdown",
      args: { includePreview: false, analyzeWithOpenRouter: true },
      label: "Génération codebase.md + analyse architecturale via OpenRouter",
      onError: "skip" as const,
      maxRetries: 1,
    },
    {
      id: "typecheck",
      action: "verify_typecheck",
      args: {},
      label: "Vérification TypeScript (tsc --noEmit) — détection d'erreurs de typage",
      onError: "skip" as const,
      maxRetries: 0,
    },
    {
      id: "run-tests",
      action: "verify_run_script",
      args: { script: "test" },
      label: "Exécution complète de la suite de tests",
      onError: "skip" as const,
      maxRetries: 0,
    },
    {
      id: "scan-improvements",
      action: "scan_for_improvements",
      args: { maxResults: 10 },
      label: "Scan des pistes d'amélioration (TODO/FIXME, tests manquants, fichiers volumineux)",
      onError: "skip" as const,
      maxRetries: 0,
    },
    {
      id: "check-proposals",
      action: "list_evolution_proposals",
      args: { status: "pending" },
      label: "Vérification des propositions d'évolution en attente",
      onError: "skip" as const,
      maxRetries: 0,
    },
    {
      id: "git-log-recent",
      action: "git_log",
      args: { count: 10 },
      label: "Historique des 10 derniers commits (contexte des changements)",
      onError: "skip" as const,
      maxRetries: 0,
    },
    {
      id: "save-report",
      action: "save_memory",
      args: {
        content:
          "📋 Audit périodique Leanna — " +
          "Git: {{steps.git-check.status}} (branche: {{steps.git-check.result.branch}}, {{steps.git-check.result.summary}}) | " +
          "Codebase.md: {{steps.generate-codebase.status}} | " +
          "TypeCheck: {{steps.typecheck.status}} ({{steps.typecheck.result.message}}) | " +
          "Tests: {{steps.run-tests.status}} | " +
          "Scan: {{steps.scan-improvements.status}} ({{steps.scan-improvements.result.count}} pistes) | " +
          "Propositions pending: {{steps.check-proposals.result.count}} | " +
          "Derniers commits: {{steps.git-log-recent.status}}",
      },
      label: "Sauvegarde du rapport d'audit complet en mémoire",
      condition: 'true', // Toujours exécuter, même si des étapes ont échoué
      onError: "skip" as const,
      maxRetries: 1,
    },
  ],
};

import { createClient } from "@supabase/supabase-js";

/**
 * Enregistre le workflow d'audit s'il n'existe pas déjà.
 * Double protection : vérification en mémoire ET en BDD pour éviter
 * les doublons même si le chargement asynchrone n'est pas encore terminé.
 */
export async function ensureAuditWorkflow(): Promise<WorkflowDefinition | null> {
  try {
    // 1. Vérification en mémoire (rapide)
    const existing = listWorkflows();
    const inMemory = existing.find((w) => w.name === AUDIT_WORKFLOW_NAME);
    if (inMemory) {
      console.log(`[Audit] Workflow "${AUDIT_WORKFLOW_NAME}" déjà en mémoire (id: ${inMemory.id}).`);
      return inMemory;
    }

    // 2. Vérification en BDD (protection contre race condition au démarrage)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name")
        .eq("name", AUDIT_WORKFLOW_NAME)
        .limit(1);

      if (!error && data && data.length > 0) {
        console.log(`[Audit] Workflow "${AUDIT_WORKFLOW_NAME}" déjà en BDD (id: ${data[0].id}). Pas de création.`);
        return null; // déjà persisté, loadWorkflows() l'a ou va l'enregistrer
      }

      // Nettoyage défensif : supprimer les doublons éventuels en BDD
      const { data: allInDb } = await supabase
        .from("workflows")
        .select("id, name, created_at")
        .eq("name", AUDIT_WORKFLOW_NAME)
        .order("created_at", { ascending: true });

      if (allInDb && allInDb.length > 1) {
        // Garder le plus ancien, supprimer les doublons
        const toDelete = allInDb.slice(1).map((w: { id: string }) => w.id);
        await supabase.from("workflows").delete().in("id", toDelete);
        console.warn(`[Audit] ⚠ ${toDelete.length} doublon(s) de "${AUDIT_WORKFLOW_NAME}" supprimé(s) de la BDD.`);
        return null;
      }
    }

    // 3. Créer le workflow
    const workflow = await createWorkflow(AUDIT_WORKFLOW_DEFINITION);
    console.log(`[Audit] Workflow "${AUDIT_WORKFLOW_NAME}" créé et planifié (id: ${workflow.id}, schedule: 24h).`);
    return workflow;
  } catch (error: any) {
    console.error(`[Audit] Impossible de créer le workflow d'audit:`, error.message || error);
    return null;
  }
}
