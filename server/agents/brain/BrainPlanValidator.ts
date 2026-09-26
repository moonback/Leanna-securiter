import { z } from "zod";
import type { BrainPlan, BrainStage } from "./types.js";
import { hasAgent } from "../roles.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("BrainPlanValidator");

// ─── Schéma Zod strict d'une étape et d'un plan ──────────────────────────────

const brainStageSchema = z.object({
  id: z.string().min(1, "id d'étape requis"),
  title: z.string().min(1, "title d'étape requis"),
  agentRole: z.string().min(1, "agentRole requis"),
  dependsOn: z.array(z.string()).default([]),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
});

/**
 * Schéma Zod strict d'un BrainPlan. Ne valide que la structure ; les
 * invariants de graphe (cycles, refs orphelines, rôles connus, unicité des id)
 * sont vérifiés en complément par `validate()`.
 */
export const brainPlanSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  stages: z.array(brainStageSchema).min(1, "Au moins une étape requise"),
});

export interface BrainPlanValidationResult {
  ok: boolean;
  issues: string[];
}

export class BrainPlanValidator {
  /**
   * Valide qu'un `BrainPlan` est un DAG exécutable.
   *
   * Contrôles effectués :
   *  1. Structure Zod stricte (étapes non vides, champs requis, statut valide)
   *  2. Unicité des `id` d'étape
   *  3. Rôles d'agent connus (`hasAgent`)
   *  4. Chaque `dependsOn` référence un `id` d'étape existant (pas d'orphelin)
   *  5. Absence de cycle (DFS avec détection de back-edge)
   */
  validate(plan: BrainPlan): BrainPlanValidationResult {
    const issues: string[] = [];

    // 1. Validation structurelle Zod
    const parsed = brainPlanSchema.safeParse(plan);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push(`Structure invalide (${issue.path.join(".") || "plan"}): ${issue.message}`);
      }
      // Sans structure valide, inutile de poursuivre les checks de graphe
      return { ok: false, issues };
    }

    const stages = plan.stages;

    // 2. Unicité des id
    const seen = new Set<string>();
    for (const stage of stages) {
      if (seen.has(stage.id)) {
        issues.push(`ID d'étape dupliqué : "${stage.id}"`);
      }
      seen.add(stage.id);
    }

    // 3. Rôles connus
    for (const stage of stages) {
      if (!hasAgent(stage.agentRole)) {
        issues.push(`Rôle d'agent inconnu pour l'étape "${stage.id}" : "${stage.agentRole}"`);
      }
    }

    // 4. Références dependsOn existantes
    const knownIds = new Set(stages.map((s) => s.id));
    for (const stage of stages) {
      for (const dep of stage.dependsOn) {
        if (!knownIds.has(dep)) {
          issues.push(
            `Dépendance orpheline : l'étape "${stage.id}" référence "${dep}" qui n'existe pas dans le plan`
          );
        }
        if (dep === stage.id) {
          issues.push(`Auto-dépendance interdite : l'étape "${stage.id}" dépend d'elle-même`);
        }
      }
    }

    // 5. Détection de cycle (DFS, seulement si les refs sont saines)
    const cycle = this.detectCycle(stages);
    if (cycle) {
      issues.push(`Cycle détecté dans le DAG : ${cycle.join(" → ")}`);
    }

    const ok = issues.length === 0;
    if (!ok) {
      log.warn(`Plan ${plan.id?.slice?.(0, 8) ?? "?"} invalide : ${issues.length} problème(s)`);
    }
    return { ok, issues };
  }

  /**
   * Génère une représentation Mermaid (`graph TD`) du DAG des étapes.
   * Chaque étape devient un nœud `id["title (role)"]` et chaque `dependsOn`
   * une arête `dep --> id`. Les étapes sans dépendance sont des racines.
   */
  toMermaid(plan: BrainPlan): string {
    const lines: string[] = ["graph TD"];

    for (const stage of plan.stages) {
      const label = this.escapeMermaidLabel(`${stage.title} (${stage.agentRole})`);
      const nodeId = this.sanitizeNodeId(stage.id);
      lines.push(`  ${nodeId}["${label}"]`);
    }

    for (const stage of plan.stages) {
      const target = this.sanitizeNodeId(stage.id);
      for (const dep of stage.dependsOn ?? []) {
        const source = this.sanitizeNodeId(dep);
        lines.push(`  ${source} --> ${target}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Rend un identifiant d'étape sûr comme identifiant de nœud Mermaid
   * (Mermaid n'accepte pas tous les caractères dans les id de nœud).
   */
  private sanitizeNodeId(id: string): string {
    const cleaned = id.replace(/[^a-zA-Z0-9_]/g, "_");
    // Un id Mermaid ne peut pas commencer par un chiffre
    return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
  }

  /**
   * Échappe les caractères problématiques dans un label Mermaid.
   *
   * Même entre guillemets doubles, Mermaid v11 casse sur les caractères qui
   * servent de délimiteurs de forme de nœud : crochets, parenthèses, accolades,
   * chevrons et barre verticale. On les remplace par des équivalents sûrs.
   */
  private escapeMermaidLabel(label: string): string {
    return label
      .replace(/[\r\n]+/g, " ")
      .replace(/"/g, "'")
      .replace(/[\[\]{}<>|]/g, " ")
      // Parenthèses pleine largeur : visuellement identiques, mais pas des
      // métacaractères de forme de nœud pour Mermaid.
      .replace(/\(/g, "（")
      .replace(/\)/g, "）")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Détecte un cycle dans le graphe de dépendances via DFS avec coloration.
   * Retourne le chemin du cycle (liste d'ids) ou `null` s'il n'y en a pas.
   * Ignore les références orphelines (traitées séparément).
   */
  private detectCycle(stages: BrainStage[]): string[] | null {
    const byId = new Map<string, BrainStage>(stages.map((s) => [s.id, s]));
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(stages.map((s) => [s.id, WHITE]));
    const stack: string[] = [];

    const visit = (id: string): string[] | null => {
      color.set(id, GRAY);
      stack.push(id);

      const stage = byId.get(id);
      for (const dep of stage?.dependsOn ?? []) {
        if (!byId.has(dep)) continue; // orphelin — ignoré ici
        const c = color.get(dep);
        if (c === GRAY) {
          // Back-edge → cycle. Extraire le chemin depuis dep.
          const start = stack.indexOf(dep);
          return [...stack.slice(start), dep];
        }
        if (c === WHITE) {
          const found = visit(dep);
          if (found) return found;
        }
      }

      stack.pop();
      color.set(id, BLACK);
      return null;
    };

    for (const stage of stages) {
      if (color.get(stage.id) === WHITE) {
        const found = visit(stage.id);
        if (found) return found;
      }
    }
    return null;
  }
}
