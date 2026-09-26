import { randomUUID } from "crypto";
import { z } from "zod";
import type {
  GoalUnderstanding,
  BrainGoalInput,
  BrainPlan,
  BrainStage,
} from "./types.js";
import type { AgentRole } from "../types.js";
import { listAgentDefinitions, hasAgent } from "../roles.js";
import { getToolsForAgent } from "../toolAgentMapper.js";
import { generateText } from "../../utils/textGeneration.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("DynamicPlanner");

// ─── Schéma Zod strict de la réponse brute du LLM ────────────────────────────
//
// La sortie du LLM est du texte non fiable : on ne fait plus confiance à un
// simple `JSON.parse` suivi de vérifications ad hoc. Ce schéma valide la
// STRUCTURE de la réponse au niveau du parsing (le contrat d'échange avec le
// modèle), avant toute transformation en `BrainStage`. Les invariants de graphe
// (cycles, refs orphelines, rôles connus) restent contrôlés en aval par le
// BrainPlanValidator sur le plan transformé.

/** Une étape telle que retournée par le LLM (avant enrichissement). */
export const llmStageSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1, "Le rôle de l'étape est requis"),
    title: z.string().trim().min(1).optional(),
    reason: z.string().trim().optional(),
    instructions: z.string().trim().optional(),
    dependsOn: z.array(z.string().trim().min(1)).optional().default([]),
  })
  .passthrough();

/** Plan complet tel que retourné par le LLM. */
export const llmPlanSchema = z.object({
  architectureRationale: z.string().trim().optional(),
  stages: z
    .array(llmStageSchema)
    .min(1, "Le plan LLM doit contenir au moins une étape"),
});

export type LLMPlanParsed = z.infer<typeof llmPlanSchema>;
export type LLMStageParsed = z.infer<typeof llmStageSchema>;

/**
 * Extrait et valide la réponse JSON du LLM via le schéma Zod strict.
 *
 * Fonction pure (pas d'état, pas d'I/O) pour rester directement testable
 * indépendamment de l'appel réseau au fournisseur de modèle.
 *
 * Étapes :
 *   1. Isole le premier bloc `{ ... }` dans la réponse (le LLM peut baver du
 *      texte autour du JSON malgré la consigne).
 *   2. `JSON.parse` sécurisé (les exceptions de syntaxe sont capturées).
 *   3. Validation structurelle Zod (`llmPlanSchema.safeParse`).
 *
 * @returns le plan validé, ou `null` si la réponse est absente/malformée
 *          (le caller retombe alors sur la décomposition heuristique).
 */
export function parseLLMPlanResponse(rawText: string): LLMPlanParsed | null {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    log.warn("Réponse LLM sans objet JSON détectable — repli heuristique");
    return null;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(match[0]);
  } catch (err: any) {
    log.warn(`JSON du plan LLM illisible (${err?.message ?? err}) — repli heuristique`);
    return null;
  }

  const result = llmPlanSchema.safeParse(candidate);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "plan"}: ${i.message}`)
      .join(" ; ");
    log.warn(`Plan LLM invalide (${detail}) — repli heuristique`);
    return null;
  }

  return result.data;
}

export class DynamicPlanner {
  /**
   * Crée un plan dynamique adapté à l'objectif sans workflow codé en dur
   */
  async plan(understanding: GoalUnderstanding, input: BrainGoalInput): Promise<BrainPlan> {
    log.info(`🎯 Planification dynamique pour domaine '${understanding.domain}' (complexité: ${understanding.complexity})`);

    // 1. Essai de planification via LLM
    try {
      const llmPlan = await this.planWithLLM(understanding, input);
      if (llmPlan && llmPlan.stages.length > 0) {
        log.info(`✅ Plan LLM généré avec ${llmPlan.stages.length} étapes (${llmPlan.stages.map((s) => s.agentRole).join(" → ")})`);
        return llmPlan;
      }
    } catch (err: any) {
      log.warn(`⚠️ Échec planification LLM (${err.message}), application de la décomposition heuristique`);
    }

    // 2. Décomposition dynamique intelligente heuristique
    return this.planHeuristic(understanding, input);
  }

  /**
   * Décomposition dynamique heuristique basée sur les capabilities réelles
   */
  planHeuristic(understanding: GoalUnderstanding, input: BrainGoalInput): BrainPlan {
    const planId = randomUUID();
    const stages: BrainStage[] = [];
    const files = understanding.relevantFiles;

    // Déterminer la séquence dynamique selon l'intention et le domaine
    const selectedRoles = this.determineRoleSequence(understanding, input);

    let previousStageId: string | null = null;

    for (let i = 0; i < selectedRoles.length; i++) {
      const { role, reason, customTitle, customInstructions } = selectedRoles[i];
      const stageId = `stage-${i + 1}-${role}`;

      // Sélection dynamique des skills et outils adaptés à ce rôle pour cette tâche
      const { skills, tools } = this.selectSkillsAndTools(role, understanding.domain);

      const stage: BrainStage = {
        id: stageId,
        title: customTitle || `Étape ${i + 1} : ${this.getRoleActionTitle(role, understanding.intent)}`,
        description: `Exécution par l'agent ${role}. ${reason}`,
        agentRole: role,
        agentReason: reason,
        skills,
        tools,
        files,
        instructions: customInstructions || this.buildStageInstructions(role, understanding),
        dependsOn: previousStageId ? [previousStageId] : [],
        status: "pending",
        priority: understanding.complexity === "critical" ? "critical" : "high",
        verificationCriteria: this.getRoleVerificationCriteria(role, understanding),
      };

      stages.push(stage);
      previousStageId = stageId;
    }

    const estimatedDurationMs = stages.length * 45_000; // ~45s par étape estimée
    const rolesSummary = stages.map((s) => s.agentRole).join(" → ");
    const architectureRationale =
      `Plan dynamique structuré en ${stages.length} étapes adaptées au domaine '${understanding.domain}'. ` +
      `Agents engagés : ${rolesSummary}.`;

    return {
      id: planId,
      goal: input.goal,
      understanding,
      stages,
      estimatedDurationMs,
      architectureRationale,
      createdAt: new Date().toISOString(),
      status: "planned",
    };
  }

  /**
   * Détermine la séquence d'agents en s'appuyant sur les CAPABILITIES déclarées
   * des agents, et non sur une échelle de rôles codée en dur ni sur des
   * expressions régulières appliquées à l'intention.
   *
   * Principe :
   *   1. On dérive les PHASES d'exécution réellement nécessaires à partir du
   *      `GoalUnderstanding` (domaine, complexité, préférences) — chaque phase
   *      est caractérisée par un ensemble d'outils *signature* (des noms de
   *      capabilities réels du ToolRegistry).
   *   2. Pour chaque phase retenue, on SÉLECTIONNE le rôle dont les
   *      `capabilities` déclarées couvrent le mieux ces outils signature
   *      (via `selectRoleForPhase` → `scoreRoleForCapabilities`).
   *
   * Conséquence : aucune branche « header responsive » ni ladder figé. Un
   * agent nouvellement enregistré avec les bonnes capabilities devient
   * automatiquement éligible, sans toucher au planificateur.
   */
  private determineRoleSequence(
    understanding: GoalUnderstanding,
    input: BrainGoalInput
  ): Array<{ role: AgentRole; reason: string; customTitle?: string; customInstructions?: string }> {
    const phases = this.determineNeededPhases(understanding, input);
    const roles: Array<{ role: AgentRole; reason: string; customTitle?: string; customInstructions?: string }> = [];
    const usedRoles = new Set<AgentRole>();

    for (const phase of phases) {
      const selection = this.selectRoleForPhase(phase, understanding, usedRoles);
      if (!selection) continue; // aucun agent ne couvre cette phase → on la saute
      usedRoles.add(selection.role);
      roles.push({
        role: selection.role,
        reason: selection.reason,
        customTitle: phase.title,
      });
    }

    // Garde-fou : si aucune phase n'a pu être couverte (ex. registre d'agents
    // vide en test), on retombe sur une implémentation directe minimale.
    if (roles.length === 0) {
      const fallback = this.selectRoleForPhase(
        DynamicPlanner.PHASES.implement,
        understanding,
        usedRoles
      );
      roles.push({
        role: fallback?.role ?? "coder",
        reason: fallback?.reason ?? "Implémentation directe de la demande.",
      });
    }

    return roles;
  }

  /**
   * Phases d'exécution candidates. Chaque phase est décrite par les outils
   * *signature* qui caractérisent son travail (noms réels de capabilities) et
   * la liste des rôles autorisés à la porter. Le choix final du rôle dépend de
   * la couverture réelle de ces outils par les capabilities de chaque agent —
   * pas d'un mapping rôle↔phase figé.
   */
  private static readonly PHASES: Record<string, {
    key: string;
    title: string;
    /** Outils signature (capabilities) qui définissent le travail de la phase. */
    signatureTools: string[];
    /** Rôles candidats pour porter la phase (départage par score de couverture). */
    candidateRoles: AgentRole[];
    /** Modèle de justification, `{role}` remplacé par le rôle retenu. */
    reason: string;
  }> = {
    research: {
      key: "research",
      title: "Analyse et exploration du contexte",
      signatureTools: ["search_in_files", "analyze_project_file", "knowledge_build_context", "knowledge_semantic_search", "knowledge_impact_analyze"],
      candidateRoles: ["researcher", "architect", "planner"],
      reason: "Analyse le contexte existant, les dépendances et les contraintes techniques.",
    },
    design: {
      key: "design",
      title: "Conception de l'architecture",
      signatureTools: ["knowledge_search_entities", "knowledge_impact_analyze", "create_project_directory", "reasoning_think"],
      candidateRoles: ["architect", "planner"],
      reason: "Conçoit la structure cible, les interfaces et les patterns.",
    },
    diagnose: {
      key: "diagnose",
      title: "Diagnostic et isolation de la cause racine",
      signatureTools: ["search_in_files", "run_project_command", "analyze_project_file", "reasoning_think"],
      candidateRoles: ["debugger", "researcher"],
      reason: "Localise la cause racine du dysfonctionnement à partir des traces et du code.",
    },
    implement: {
      key: "implement",
      title: "Implémentation et modification du code",
      signatureTools: ["write_project_file", "modify_project_file", "patch_project_file", "verify_file", "verify_typecheck"],
      candidateRoles: ["coder", "refactor", "debugger"],
      reason: "Applique les modifications de code nécessaires puis les vérifie.",
    },
    refactor: {
      key: "refactor",
      title: "Restructuration et réduction de dette",
      signatureTools: ["modify_project_file", "patch_project_file", "knowledge_impact_analyze", "verify_lint", "verify_full"],
      candidateRoles: ["refactor", "coder"],
      reason: "Restructure le code sans altérer le comportement externe.",
    },
    write: {
      key: "write",
      title: "Rédaction du contenu",
      signatureTools: ["write_project_file", "modify_project_file", "apply_patch"],
      candidateRoles: ["writer", "formatter", "summarizer", "translator"],
      reason: "Produit le contenu rédactionnel clair et structuré.",
    },
    proofread: {
      key: "proofread",
      title: "Relecture et finitions",
      signatureTools: ["modify_project_file", "patch_project_file", "verify_file"],
      candidateRoles: ["proofreader", "formatter"],
      reason: "Relit et corrige la cohérence, la clarté et le style.",
    },
    visualCheck: {
      key: "visualCheck",
      title: "Validation visuelle et responsive",
      signatureTools: ["automation_screenshot", "automation_analyze_screenshot", "automation_navigate"],
      candidateRoles: ["vision"],
      reason: "Vérifie visuellement le rendu et détecte les débordements.",
    },
    test: {
      key: "test",
      title: "Tests et non-régression",
      signatureTools: ["run_project_command", "verify_full", "verify_file", "verify_typecheck"],
      candidateRoles: ["tester", "coder"],
      reason: "Valide le comportement et l'absence de régression via les tests.",
    },
    review: {
      key: "review",
      title: "Revue de code et audit qualité",
      signatureTools: ["verify_lint", "verify_typecheck", "analyze_project_file", "knowledge_impact_analyze"],
      candidateRoles: ["reviewer", "security"],
      reason: "Audite la qualité, la conformité et la maintenabilité.",
    },
  };

  /**
   * Dérive les phases nécessaires à partir de la compréhension de l'objectif.
   * On raisonne en termes de NATURE du travail (produire du code, du texte,
   * diagnostiquer, valider visuellement…), pas de mots-clés d'intention.
   */
  private determineNeededPhases(
    understanding: GoalUnderstanding,
    input: BrainGoalInput
  ): Array<typeof DynamicPlanner.PHASES[keyof typeof DynamicPlanner.PHASES]> {
    const { domain, complexity } = understanding;
    const P = DynamicPlanner.PHASES;
    const heavy = complexity === "complex" || complexity === "critical";
    const phases: Array<typeof P[keyof typeof P]> = [];

    // Domaines à dominante rédactionnelle : le livrable est du texte.
    if (domain === "documentation") {
      phases.push(P.research, P.write, P.proofread);
      return phases;
    }

    // Bugfix : le cœur du travail est le diagnostic avant le correctif.
    if (domain === "bugfix") {
      phases.push(P.diagnose, P.implement, P.test, P.review);
      return phases;
    }

    // Refactorisation : conception de la cible puis restructuration.
    if (domain === "refactor") {
      phases.push(P.design, P.refactor, P.test, P.review);
      return phases;
    }

    // Domaines de développement (frontend/backend/fullstack/devops/general).
    // La sélection reste capacitaire : on ajoute les phases pertinentes, le
    // rôle porteur étant choisi par couverture d'outils.
    if (heavy) phases.push(P.research, P.design);
    else phases.push(P.research);

    phases.push(P.implement);

    // Validation visuelle : pertinente pour le frontend, activable/désactivable
    // par préférence — sans jamais dépendre d'un mot-clé « header »/« responsive ».
    if (domain === "frontend" && input.preferences?.visualValidation !== false) {
      phases.push(P.visualCheck);
    }

    if (!input.preferences?.skipTests) phases.push(P.test);
    phases.push(P.review);

    return phases;
  }

  /**
   * Sélectionne le rôle le mieux adapté à une phase en comparant les
   * `signatureTools` de la phase aux `capabilities` déclarées de chaque rôle
   * candidat. Le rôle avec la meilleure couverture (et non déjà utilisé, à
   * couverture égale) l'emporte. Retourne `null` si aucun candidat ne couvre
   * au moins un outil signature.
   */
  private selectRoleForPhase(
    phase: typeof DynamicPlanner.PHASES[keyof typeof DynamicPlanner.PHASES],
    _understanding: GoalUnderstanding,
    usedRoles: Set<AgentRole>
  ): { role: AgentRole; reason: string } | null {
    const definitions = listAgentDefinitions();
    const byRole = new Map(definitions.map((d) => [d.role, d]));

    let best: { role: AgentRole; score: number; alreadyUsed: boolean } | null = null;

    for (const role of phase.candidateRoles) {
      const def = byRole.get(role);
      if (!def) continue; // rôle non enregistré
      const score = this.scoreRoleForCapabilities(def.capabilities, phase.signatureTools);
      if (score <= 0) continue; // ce rôle ne couvre aucun outil de la phase

      const alreadyUsed = usedRoles.has(role);
      const better =
        best === null ||
        // À couverture égale, on préfère un rôle pas encore engagé (diversité).
        score > best.score ||
        (score === best.score && best.alreadyUsed && !alreadyUsed);
      if (better) best = { role, score, alreadyUsed };
    }

    if (!best) return null;
    return {
      role: best.role,
      reason: phase.reason.replace("{role}", String(best.role)),
    };
  }

  /**
   * Score de couverture : nombre d'outils signature de la phase réellement
   * présents dans les capabilities déclarées du rôle. Simple, déterministe et
   * directement fondé sur la source de vérité (les capabilities des agents).
   */
  private scoreRoleForCapabilities(
    capabilities: readonly string[],
    signatureTools: readonly string[]
  ): number {
    const declared = new Set(capabilities);
    let score = 0;
    for (const tool of signatureTools) {
      if (declared.has(tool)) score++;
    }
    return score;
  }

  /**
   * Sélection dynamique des skills et outils adaptés par rôle
   */
  private selectSkillsAndTools(
    role: AgentRole,
    _domain: string
  ): { skills: string[]; tools: string[] } {
    const rawTools = getToolsForAgent(role);
    const skills: string[] = [];
    const tools: string[] = [];

    // Sélection ciblée des outils prioritaires pour éviter les contextes surchargés
    switch (role) {
      case "researcher":
        skills.push("codebase", "knowledge");
        tools.push("read_project_file", "search_in_files", "list_project_files", "analyze_project_file", "knowledge_build_context");
        break;

      case "architect":
        skills.push("codebase", "reasoning");
        tools.push("read_project_file", "search_in_files", "analyze_project_file", "reasoning_think");
        break;

      case "coder":
        skills.push("codebase", "verify");
        tools.push("read_project_file", "modify_project_file", "write_project_file", "patch_project_file", "verify_syntax", "verify_file");
        break;

      case "refactor":
        skills.push("codebase", "verify");
        tools.push("read_project_file", "modify_project_file", "patch_project_file", "verify_syntax", "verify_lint");
        break;

      case "debugger":
        skills.push("codebase", "verify", "reasoning");
        tools.push("read_project_file", "search_in_files", "run_project_command", "verify_syntax", "modify_project_file");
        break;

      case "vision":
        skills.push("browser", "automationBrowser");
        tools.push("automation_screenshot", "automation_navigate", "read_project_file");
        break;

      case "tester":
        skills.push("verify", "codebase");
        tools.push("run_project_command", "verify_file", "verify_syntax", "read_project_file");
        break;

      case "reviewer":
        skills.push("verify", "codebase");
        tools.push("read_project_file", "verify_lint", "verify_typecheck", "verify_syntax");
        break;

      case "writer":
        skills.push("codebase", "documents");
        tools.push("read_project_file", "write_project_file", "modify_project_file");
        break;

      case "proofreader":
        skills.push("codebase");
        tools.push("read_project_file", "modify_project_file");
        break;

      default:
        // Pour rôles personnalisés
        skills.push("codebase");
        tools.push(...rawTools.slice(0, 6));
        break;
    }

    return {
      skills: Array.from(new Set(skills)),
      tools: Array.from(new Set(tools)),
    };
  }

  private getRoleActionTitle(role: AgentRole, _intent: string): string {
    const titles: Record<string, string> = {
      researcher: "Analyse technique et exploration de la codebase",
      architect: "Conception architecturale et modélisation",
      coder: "Implémentation et modifications du code",
      refactor: "Refactorisation et élimination de la dette",
      vision: "Validation visuelle et responsive",
      tester: "Tests automatisés et vérification de conformité",
      reviewer: "Revue de code et audit qualité",
      debugger: "Diagnostic et résolution de bogues",
      writer: "Rédaction de contenu ou documentation",
      proofreader: "Relecture et finitions",
    };
    return titles[role as string] || `Exécution ${role}`;
  }

  private buildStageInstructions(role: AgentRole, understanding: GoalUnderstanding): string {
    return [
      `OBJECTIF GLOBAL : ${understanding.intent}`,
      `DOMAINE : ${understanding.domain} | COMPLEXITÉ : ${understanding.complexity}`,
      `CRITÈRES DE SUCCÈS À SATISFAIRE :`,
      ...understanding.successCriteria.map((c) => `- ${c}`),
      `\nConsigne spécifique pour le rôle '${role}' : concentre-toi exclusivement sur ton domaine d'expertise pour cette étape du plan.`,
    ].join("\n");
  }

  private getRoleVerificationCriteria(role: AgentRole, _understanding: GoalUnderstanding): string[] {
    const criteria: string[] = [];
    if (role === "coder" || role === "refactor" || role === "debugger") {
      criteria.push("Syntaxe valide et absence d'erreur TypeScript");
      criteria.push("Fichiers modifiés enregistrés avec succès");
    } else if (role === "vision") {
      criteria.push("Pas de dépassement ou superposition visuelle constatée");
      criteria.push("Mise en page cohérente sur les résolutions cibles");
    } else if (role === "tester") {
      criteria.push("Exécution sans erreur des tests du module");
    } else if (role === "reviewer") {
      criteria.push("Code conforme aux normes du projet");
    }
    return criteria;
  }

  /**
   * Planification avancée via LLM si disponible
   */
  private async planWithLLM(understanding: GoalUnderstanding, input: BrainGoalInput): Promise<BrainPlan | null> {
    const availableRoles = listAgentDefinitions().map((d) => `${d.role}: ${d.description.slice(0, 70)}...`);

    const prompt = `
Tu es l'Agent Brain de Leanna. Conçois le plan d'exécution optimal sous forme de DAG pour l'objectif suivant :

OBJECTIF : "${understanding.intent}"
DOMAINE : ${understanding.domain}
COMPLEXITÉ : ${understanding.complexity}
CRITÈRES : ${understanding.successCriteria.join("; ")}
FICHIERS : ${understanding.relevantFiles.join(", ") || "Non spécifiés"}

AGENTS DISPONIBLES :
${availableRoles.join("\n")}

RÈGLE ABSOLUE : Pas de workflow codé en dur ! Choisis les agents strictement pertinents et ordonne-les avec dépendances logiques.

Retourne UNIQUEMENT un objet JSON valide :
{
  "architectureRationale": "Explication de la stratégie choisie",
  "stages": [
    {
      "id": "stage-1",
      "role": "nom_du_role",
      "title": "Titre clair de l'étape",
      "reason": "Pourquoi cet agent est choisi",
      "instructions": "Instructions précises",
      "dependsOn": []
    }
  ]
}
`.trim();

    const res = await generateText({
      prompt,
      temperature: 0.1,
      maxOutputTokens: 2048,
    });

    // Validation stricte de la réponse brute du LLM via Zod (au lieu d'un
    // JSON.parse + vérifications ad hoc). Une réponse malformée retourne null,
    // ce qui déclenche proprement le repli heuristique dans `plan()`.
    const parsed = this.parsePlanResponse(res.text);
    if (!parsed) return null;

    // Réindexation des id d'étapes : on associe à chaque étape LLM son id final
    // (fourni ou dérivé) AVANT de remapper les `dependsOn`, afin de préserver
    // les dépendances même quand le LLM omet certains id.
    const stageIds = parsed.stages.map((st, idx) => {
      const role = (hasAgent(st.role) ? st.role : "coder") as AgentRole;
      return st.id && st.id.trim() ? st.id.trim() : `stage-${idx + 1}-${role}`;
    });
    const originalIdToFinal = new Map<string, string>();
    parsed.stages.forEach((st, idx) => {
      if (st.id && st.id.trim()) originalIdToFinal.set(st.id.trim(), stageIds[idx]);
    });

    const stages: BrainStage[] = parsed.stages.map((st: LLMStageParsed, idx: number) => {
      const role = (hasAgent(st.role) ? st.role : "coder") as AgentRole;
      const { skills, tools } = this.selectSkillsAndTools(role, understanding.domain);

      // Remapper les dépendances déclarées vers les id finaux ; à défaut de
      // dépendance explicite, chaîner sur l'étape précédente (séquence par défaut).
      const declaredDeps = (st.dependsOn ?? [])
        .map((d) => originalIdToFinal.get(d.trim()) ?? d.trim())
        .filter((d) => d && d !== stageIds[idx]);
      const dependsOn =
        declaredDeps.length > 0 ? declaredDeps : idx > 0 ? [stageIds[idx - 1]] : [];

      return {
        id: stageIds[idx],
        title: st.title || `Étape ${idx + 1} (${role})`,
        description: st.reason || `Exécution par ${role}`,
        agentRole: role,
        agentReason: st.reason || "Sélectionné par le Brain",
        skills,
        tools,
        files: understanding.relevantFiles,
        instructions: st.instructions || this.buildStageInstructions(role, understanding),
        dependsOn,
        status: "pending",
        priority: "high",
        verificationCriteria: this.getRoleVerificationCriteria(role, understanding),
      };
    });

    return {
      id: randomUUID(),
      goal: input.goal,
      understanding,
      stages,
      estimatedDurationMs: stages.length * 45_000,
      architectureRationale: parsed.architectureRationale || "Planification dynamique établie par LLM",
      createdAt: new Date().toISOString(),
      status: "planned",
    };
  }

  /**
   * Extrait et valide la réponse JSON du LLM via le schéma Zod strict.
   * Délègue à la fonction pure `parseLLMPlanResponse` (testable isolément).
   */
  private parsePlanResponse(rawText: string): LLMPlanParsed | null {
    return parseLLMPlanResponse(rawText);
  }
}
