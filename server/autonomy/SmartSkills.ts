/**
 * SMART SKILLS — Skills composites avec boucles intégrées.
 *
 * Contrairement aux skills "dumb" qui exécutent et retournent,
 * les Smart Skills encapsulent une logique de boucle :
 *
 * - validatePatch: vérifie → corrige → re-vérifie → boucle jusqu'à succès
 * - readUntilUnderstood: lit → évalue confiance → lit davantage si nécessaire
 * - planCodeChange: analyse impact → ordonne → estime risques → propose
 *
 * Ces skills sont exposés comme des outils standard mais leur implémentation
 * inclut la logique de retry/loop qui manquait au niveau prompt.
 */

import { Skill } from "../skills/base.js";
import { createLogger } from "../utils/logger.js";
import { AgentValidation, type RegressionReport, type ValidationSnapshot } from "../agents/AgentValidation.js";

const log = createLogger("SmartSkills");

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type SkillHandler = (name: string, args: any, context?: any) => Promise<any>;

interface ValidatePatchResult {
  success: boolean;
  attempts: number;
  file: string;
  finalState: "valid" | "failed_max_retries" | "needs_human";
  errors?: string;
  corrections?: string[];
}

interface QualityLoopResult {
  success: boolean;
  stoppedAt: "modify" | "format" | "typecheck" | "tests" | "regression" | "complete";
  file: string;
  testFile: string | null;
  diff: { changed: boolean; addedLines: number; removedLines: number };
  baseline: ValidationSnapshot | null;
  current: ValidationSnapshot | null;
  regression: RegressionReport | null;
  errors: string[];
}

interface ReadUntilUnderstoodResult {
  confidence: number;
  filesRead: string[];
  summary: string;
  keyFindings: string[];
  suggestMore: boolean;
}

interface PlanCodeChangeResult {
  files: Array<{
    path: string;
    action: "modify" | "create" | "delete";
    impact: "low" | "medium" | "high";
    order: number;
    reason: string;
  }>;
  risks: string[];
  testFiles: string[];
  rollbackPlan: string;
  estimatedComplexity: "trivial" | "simple" | "moderate" | "complex";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Smart Skills Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Crée les smart skills. Nécessite un handler pour appeler les skills existants.
 */
export function createSmartSkills(skillHandler: SkillHandler): Skill {
  return {
    name: "smart",
    declarations: [
      {
        name: "quality_loop",
        description:
          "Modifie un fichier puis exécute une seule boucle qualité bornée : formatage ciblé, typecheck, tests associés, analyse du diff et rapport de non-régression. " +
          "Arrête immédiatement à la première phase en échec et ne relance jamais automatiquement une tentative infinie.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "Chemin relatif du fichier à modifier." },
            search: { type: "STRING", description: "Texte exact à remplacer." },
            replace: { type: "STRING", description: "Nouveau texte exact." },
          },
          required: ["path", "search", "replace"],
        },
      },
      {
        name: "validate_patch",
        description:
          "Applique un patch/modification sur un fichier puis boucle automatiquement : " +
          "vérifie (tsc + lint + tests) → si erreurs, analyse et corrige → re-vérifie → " +
          "jusqu'à 3 tentatives. Retourne le résultat final (succès/échec). " +
          "Utilise cet outil AU LIEU de patch_project_file + verify_file séparément " +
          "quand tu veux garantir que le fichier est valide après modification.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: {
              type: "STRING",
              description: "Chemin relatif du fichier à modifier.",
            },
            modifications: {
              type: "STRING",
              description:
                "Description des modifications à appliquer (sera passé à modify_project_file). " +
                "Format: description précise des changements avec le contenu exact.",
            },
            search: {
              type: "STRING",
              description: "Texte exact à chercher dans le fichier (pour modify_project_file).",
            },
            replace: {
              type: "STRING",
              description: "Texte de remplacement (pour modify_project_file).",
            },
          },
          required: ["path", "search", "replace"],
        },
      },
      {
        name: "read_until_understood",
        description:
          "Lit un ensemble de fichiers liés à une tâche de manière incrémentale. " +
          "Commence par knowledge_build_context, puis lit les fichiers recommandés. " +
          "Évalue la confiance après chaque lecture. Continue tant que confiance < 80%. " +
          "Retourne un résumé structuré avec les findings clés et la confiance finale. " +
          "Utilise cet outil au début d'une tâche complexe pour t'assurer de comprendre " +
          "le code AVANT de le modifier.",
        parameters: {
          type: "OBJECT",
          properties: {
            task: {
              type: "STRING",
              description: "Description de la tâche pour laquelle tu as besoin de comprendre le code.",
            },
            maxFiles: {
              type: "NUMBER",
              description: "Nombre max de fichiers à lire (défaut: 8).",
            },
            targetConfidence: {
              type: "NUMBER",
              description: "Niveau de confiance cible (0-100, défaut: 80).",
            },
          },
          required: ["task"],
        },
      },
      {
        name: "plan_code_change",
        description:
          "Analyse l'impact d'un changement de code AVANT de l'effectuer. " +
          "Retourne : fichiers à modifier (ordonnés par impact croissant), " +
          "risques identifiés, fichiers de test associés, plan de rollback, " +
          "et estimation de complexité. " +
          "Utilise cet outil AVANT de commencer une modification multi-fichiers " +
          "pour avoir un plan structuré.",
        parameters: {
          type: "OBJECT",
          properties: {
            description: {
              type: "STRING",
              description: "Description du changement à effectuer.",
            },
            scope: {
              type: "STRING",
              description: "Périmètre du changement: 'single_file', 'module', 'cross_module', 'global'.",
              enum: ["single_file", "module", "cross_module", "global"],
            },
          },
          required: ["description"],
        },
      },
    ],

    async handleToolCall(name: string, args: any, context?: any): Promise<any> {
      switch (name) {
        case "quality_loop":
          return executeQualityLoop(skillHandler, args, context);
        case "validate_patch":
          return executeValidatePatch(skillHandler, args, context);
        case "read_until_understood":
          return executeReadUntilUnderstood(skillHandler, args, context);
        case "plan_code_change":
          return executePlanCodeChange(skillHandler, args, context);
        default:
          return { error: `Smart skill inconnu: ${name}` };
      }
    },
  };
}

async function executeQualityLoop(
  handler: SkillHandler,
  args: { path: string; search: string; replace: string },
  context?: any
): Promise<QualityLoopResult> {
  const { path, search, replace } = args;
  const errors: string[] = [];
  const readResult = await handler("read_project_file", { path }, context);
  const before = asText(readResult);
  if (readResult?.error || before === null) {
    return { success: false, stoppedAt: "modify", file: path, testFile: null, diff: emptyDiff(), baseline: null, current: null, regression: null, errors: [`Lecture initiale échouée: ${readResult?.error ?? "contenu indisponible"}`] };
  }

  const baselineResult = await handler("verify_file", { path }, context);
  const baseline = baselineResult?.error ? null : AgentValidation.snapshot(baselineResult);
  const modifyResult = await handler("modify_project_file", { path, search, replace }, context);
  if (modifyResult?.error) {
    return { success: false, stoppedAt: "modify", file: path, testFile: null, diff: emptyDiff(), baseline, current: null, regression: null, errors: [`Modification échouée: ${modifyResult.error}`] };
  }

  const formatResult = await handler("verify_format", { path }, context);
  if (!isSuccessful(formatResult)) {
    return failureResult(path, "format", baseline, before, await readAfter(handler, path, context), formatResult);
  }

  const typecheckResult = await handler("verify_typecheck", {}, context);
  if (!isSuccessful(typecheckResult)) {
    return failureResult(path, "typecheck", baseline, before, await readAfter(handler, path, context), typecheckResult);
  }

  const testResult = await handler("verify_file", { path }, context);
  const current = AgentValidation.snapshot(testResult);
  const regression = baseline ? AgentValidation.compare(baseline, current) : null;
  const after = await readAfter(handler, path, context);
  const diff = calculateDiff(before, after);
  if (!isSuccessful(testResult)) {
    errors.push(extractVerifyErrors(testResult) ?? "Les tests concernés ont échoué.");
    return { success: false, stoppedAt: "tests", file: path, testFile: testResult?.test?.file ?? null, diff, baseline, current, regression, errors };
  }
  if (regression && !regression.passed) {
    return { success: false, stoppedAt: "regression", file: path, testFile: testResult?.test?.file ?? null, diff, baseline, current, regression, errors: regression.regressions.map((issue) => issue.message) };
  }
  return { success: true, stoppedAt: "complete", file: path, testFile: testResult?.test?.file ?? null, diff, baseline, current, regression, errors };
}

function isSuccessful(result: any): boolean {
  return result?.ok === true || result?.status === "success" || result?.status === "ok";
}

function asText(result: any): string | null {
  if (typeof result === "string") return result;
  if (typeof result?.content === "string") return result.content;
  return null;
}

async function readAfter(handler: SkillHandler, path: string, context?: any): Promise<string> {
  return asText(await handler("read_project_file", { path }, context)) ?? "";
}

function emptyDiff(): QualityLoopResult["diff"] {
  return { changed: false, addedLines: 0, removedLines: 0 };
}

function calculateDiff(before: string, after: string): QualityLoopResult["diff"] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let addedLines = 0;
  let removedLines = 0;
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index++) {
    if (oldLines[index] !== newLines[index]) {
      if (index < newLines.length) addedLines++;
      if (index < oldLines.length) removedLines++;
    }
  }
  return { changed: before !== after, addedLines, removedLines };
}

function failureResult(
  path: string,
  stoppedAt: QualityLoopResult["stoppedAt"],
  baseline: ValidationSnapshot | null,
  before: string,
  after: string,
  phaseResult: any
): QualityLoopResult {
  const current = AgentValidation.snapshot(phaseResult);
  const regression = baseline ? AgentValidation.compare(baseline, current) : null;
  return { success: false, stoppedAt, file: path, testFile: phaseResult?.test?.file ?? null, diff: calculateDiff(before, after), baseline, current, regression, errors: [extractVerifyErrors(phaseResult) ?? `${stoppedAt} échoué.`] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Implémentations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * validate_patch — Boucle modify → verify → fix → re-verify
 */
async function executeValidatePatch(
  handler: SkillHandler,
  args: { path: string; search: string; replace: string },
  context?: any
): Promise<ValidatePatchResult> {
  const { path, search, replace } = args;
  const MAX_ATTEMPTS = 3;
  const corrections: string[] = [];

  log.info(`[validate_patch] Modification de ${path}...`);

  // Étape 1: Appliquer la modification initiale
  const modifyResult = await handler("modify_project_file", { path, search, replace }, context);
  if (modifyResult?.error) {
    return {
      success: false,
      attempts: 0,
      file: path,
      finalState: "failed_max_retries",
      errors: `Modification initiale échouée: ${modifyResult.error}`,
    };
  }

  // Étape 2: Boucle verify → fix
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log.info(`[validate_patch] Vérification #${attempt} de ${path}...`);

    const verifyResult = await handler("verify_file", { path }, context);

    // Succès : le contrat canonique est status=success, ok=true reste accepté pour compatibilité.
    if (verifyResult?.ok === true || verifyResult?.status === "success" || verifyResult?.status === "ok") {
      log.info(`[validate_patch] ✓ ${path} valide après ${attempt} vérification(s).`);
      return {
        success: true,
        attempts: attempt,
        file: path,
        finalState: "valid",
        corrections,
      };
    }

    // Une vérification échouée sans diagnostics reste un échec : ne jamais le convertir en succès.
    const errors = extractVerifyErrors(verifyResult) ?? "verify_file a échoué sans fournir de diagnostic exploitable.";

    // Dernière tentative → ne pas corriger, juste reporter
    if (attempt === MAX_ATTEMPTS) {
      log.warn(`[validate_patch] ✗ ${path} toujours invalide après ${MAX_ATTEMPTS} tentatives.`);
      return {
        success: false,
        attempts: attempt,
        file: path,
        finalState: "failed_max_retries",
        errors,
        corrections,
      };
    }

    // Correction automatique via reasoning + re-modification
    log.info(`[validate_patch] 🔧 Correction automatique #${attempt}...`);
    corrections.push(`Tentative ${attempt}: ${errors.slice(0, 100)}`);

    // Relire le fichier pour avoir le contexte actuel
    const fileContent = await handler("read_project_file", { path }, context);
    if (fileContent?.error) continue;

    // Utiliser reasoning_think pour comprendre la correction nécessaire
    const reasoningResult = await handler("reasoning_think", {
      thought: `Le fichier ${path} a les erreurs suivantes après modification:\n${errors}\n\nContenu actuel pertinent:\n${typeof fileContent === 'string' ? fileContent.slice(0, 2000) : JSON.stringify(fileContent).slice(0, 2000)}\n\nQuelle correction précise appliquer ?`,
      prompt: `Le fichier ${path} a les erreurs suivantes après modification:\n${errors}\n\nContenu actuel pertinent:\n${typeof fileContent === 'string' ? fileContent.slice(0, 2000) : JSON.stringify(fileContent).slice(0, 2000)}\n\nRetourne uniquement un objet JSON valide au format {"search":"texte exact actuel","replace":"texte corrigé"}. N'ajoute aucun commentaire ni bloc Markdown.`,
      strategy: "auto",
    }, context);

    const correction = extractCorrection(reasoningResult);
    if (!correction) {
      return {
        success: false,
        attempts: attempt,
        file: path,
        finalState: "needs_human",
        errors: `${errors} Correction automatique inexploitable: reasoning_think n'a pas fourni un objet JSON {"search":"...","replace":"..."}.`,
        corrections,
      };
    }

    const correctionResult = await handler("modify_project_file", {
      path,
      search: correction.search,
      replace: correction.replace,
    }, context);
    if (correctionResult?.error) {
      return {
        success: false,
        attempts: attempt,
        file: path,
        finalState: "needs_human",
        errors: `${errors} Application de la correction échouée: ${correctionResult.error}`,
        corrections,
      };
    }
  }

  return {
    success: false,
    attempts: MAX_ATTEMPTS,
    file: path,
    finalState: "needs_human",
    errors: "Corrections automatiques épuisées.",
  };
}

function extractCorrection(result: any): { search: string; replace: string } | null {
  const raw = typeof result === "string"
    ? result
    : result?.reasoning ?? result?.answer ?? result?.thought;
  if (typeof raw !== "string") return null;

  const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    if (typeof parsed?.search !== "string" || typeof parsed?.replace !== "string") return null;
    return { search: parsed.search, replace: parsed.replace };
  } catch {
    return null;
  }
}

/**
 * read_until_understood — Lecture incrémentale jusqu'à confiance suffisante
 */
async function executeReadUntilUnderstood(
  handler: SkillHandler,
  args: { task: string; maxFiles?: number; targetConfidence?: number },
  context?: any
): Promise<ReadUntilUnderstoodResult> {
  const { task, maxFiles = 8, targetConfidence = 80 } = args;
  const filesRead: string[] = [];
  const keyFindings: string[] = [];
  let confidence = 0;

  log.info(`[read_until_understood] Tâche: "${task}" (cible: ${targetConfidence}%)`);

  // Étape 1: knowledge_build_context pour obtenir le contexte initial
  const contextResult = await handler("knowledge_build_context", {
    query: task,
    strategy: "balanced",
    detail: "standard",
    max_files: Math.min(maxFiles, 15),
  }, context);

  if (contextResult?.error) {
    return {
      confidence: 0,
      filesRead: [],
      summary: `Échec knowledge_build_context: ${contextResult.error}`,
      keyFindings: [],
      suggestMore: true,
    };
  }

  // La confiance initiale vient du score de compréhension calculé par le moteur.
  confidence = contextResult?.score?.confidence
    ?? contextResult?.understandingScore
    ?? contextResult?.confidence
    ?? 30;

  // Conserver la pertinence sémantique par fichier : lire un fichier n'est pas
  // une preuve de compréhension si le moteur ne le juge pas pertinent.
  const contextFiles: Array<{ path: string; relevance?: number }> = contextResult?.batch?.files
    ?.map((file: any) => ({ path: file.path, relevance: file.relevance }))
    .filter((file: { path?: string }) => Boolean(file.path))
    ?? contextResult?.files?.map((file: any) => ({ path: file.path || file, relevance: file.relevance }))
    ?? [];
  const recommendedFiles = contextFiles.map((file) => file.path);
  const relevanceByFile = new Map(contextFiles.map((file) => [file.path, file.relevance]));
  const initialConfidence = confidence;

  // Extraire les findings du contexte
  if (contextResult?.facts) {
    for (const fact of contextResult.facts.slice(0, 5)) {
      keyFindings.push(typeof fact === "string" ? fact : fact.content || fact.description || "");
    }
  }

  log.info(`[read_until_understood] Confiance initiale: ${confidence}% (${recommendedFiles.length} fichiers recommandés)`);

  // Étape 2: Lire les fichiers un par un jusqu'à atteindre la confiance cible
  for (const file of recommendedFiles.slice(0, maxFiles)) {
    if (confidence >= targetConfidence) break;

    const outline = await handler("read_file_outline", { path: file }, context);
    if (outline?.error) continue;

    filesRead.push(file);

    const relevances = filesRead
      .map((readFile) => relevanceByFile.get(readFile))
      .filter((relevance): relevance is number => typeof relevance === "number");
    if (relevances.length > 0) {
      const averageRelevance = relevances.reduce((sum, relevance) => sum + relevance, 0) / relevances.length;
      confidence = Math.round((initialConfidence + Math.max(0, Math.min(1, averageRelevance)) * 100) / 2);
    }

    log.info(`[read_until_understood] Lu: ${file} → confiance: ${confidence.toFixed(0)}%`);
  }

  const summary = [
    `Tâche analysée: "${task}"`,
    `Fichiers lus: ${filesRead.length}`,
    `Confiance finale: ${confidence.toFixed(0)}%`,
    confidence < targetConfidence
      ? `⚠️ Confiance insuffisante. Fichiers supplémentaires recommandés.`
      : `✓ Confiance suffisante pour procéder.`,
  ].join("\n");

  return {
    confidence,
    filesRead,
    summary,
    keyFindings,
    suggestMore: confidence < targetConfidence,
  };
}

/**
 * plan_code_change — Analyse d'impact et planification
 */
async function executePlanCodeChange(
  handler: SkillHandler,
  args: { description: string; scope?: string },
  context?: any
): Promise<PlanCodeChangeResult> {
  const { description, scope = "module" } = args;

  log.info(`[plan_code_change] Planification: "${description}" (scope: ${scope})`);

  // Étape 1: Chercher les fichiers concernés
  const searchResult = await handler("knowledge_semantic_search", {
    query: description,
    limit: 10,
  }, context);

  const relevantFiles: string[] = [];
  if (searchResult?.results) {
    for (const r of searchResult.results) {
      const filePath = r.file || r.path || r.source;
      if (filePath && !relevantFiles.includes(filePath)) {
        relevantFiles.push(filePath);
      }
    }
  }

  // Étape 2: Impact analysis si disponible
  let impactResult: any = null;
  if (relevantFiles.length >= 3) {
    impactResult = await handler("knowledge_impact_analyze", {
      files: relevantFiles.slice(0, 5),
      mode: "standard",
    }, context);
  }

  // Étape 3: Trouver les fichiers de test associés
  const testFiles: string[] = [];
  for (const file of relevantFiles.slice(0, 5)) {
    // Heuristique: chercher le .test ou .spec correspondant
    const testVariants = [
      file.replace(/\.ts$/, ".test.ts"),
      file.replace(/\.ts$/, ".spec.ts"),
      file.replace(/\.tsx$/, ".test.tsx"),
      file.replace(/src\//, "tests/").replace(/\.ts$/, ".test.ts"),
    ];
    for (const tv of testVariants) {
      const exists = await handler("read_file_outline", { path: tv }, context);
      if (!exists?.error) {
        testFiles.push(tv);
        break;
      }
    }
  }

  // Étape 4: Construire le plan
  const files = relevantFiles.slice(0, 8).map((filePath, i) => ({
    path: filePath,
    action: "modify" as const,
    impact: (impactResult?.impacts?.[filePath]?.level as any) || (i < 2 ? "high" : "medium"),
    order: i + 1,
    reason: `Fichier pertinent pour: ${description.slice(0, 50)}`,
  }));

  // Ordonner par impact croissant (modifier les moins risqués d'abord)
  files.sort((a, b) => {
    const levels: Record<string, number> = { low: 0, medium: 1, high: 2 };
    return (levels[a.impact] ?? 1) - (levels[b.impact] ?? 1);
  });
  files.forEach((f, i) => (f.order = i + 1));

  // Risks
  const risks: string[] = [];
  if (impactResult?.risks) {
    risks.push(...impactResult.risks.slice(0, 5));
  }
  if (scope === "global" || scope === "cross_module") {
    risks.push("Changement cross-module: risque de breaking changes dans les imports.");
  }
  if (files.length > 5) {
    risks.push(`${files.length} fichiers impactés: risque de régression élevé.`);
  }

  // Complexité
  let estimatedComplexity: PlanCodeChangeResult["estimatedComplexity"] = "simple";
  if (files.length > 5 || scope === "global") estimatedComplexity = "complex";
  else if (files.length > 3 || scope === "cross_module") estimatedComplexity = "moderate";
  else if (files.length <= 1) estimatedComplexity = "trivial";

  return {
    files,
    risks,
    testFiles,
    rollbackPlan: `git stash ou revert les ${files.length} fichiers modifiés.`,
    estimatedComplexity,
  };
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

function extractVerifyErrors(result: any): string | null {
  if (!result) return "verify_file n'a retourné aucun résultat.";
  const parts: string[] = [];

  if (Array.isArray(result.allIssues)) {
    parts.push(...result.allIssues.slice(0, 20).map((issue: any) =>
      `[${issue.type ?? "verification"}${issue.rule ? `/${issue.rule}` : ""}] ${issue.file ?? "global"}${issue.line ? `:${issue.line}` : ""} — ${issue.message ?? "Erreur"}`
    ));
  }

  const addPhase = (label: string, phase: any) => {
    if (!phase || phase.ok !== false) return;
    const output = [phase.output, phase.stdout, phase.stderr, phase.errors, phase.violations]
      .flatMap((value) => Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item.message ?? JSON.stringify(item)) : [value])
      .filter(Boolean)
      .join("\n");
    parts.push(`${label}${phase.exitCode !== undefined ? ` (code ${phase.exitCode})` : ""}: ${output || "échec sans sortie"}`);
  };

  addPhase("TypeScript", result.typecheck ?? result.tsc);
  addPhase("Lint", result.lint);
  addPhase("Tests", result.test);

  if (result.error) parts.push(String(result.error));
  if (result.message && result.status === "failed") parts.push(String(result.message));
  if (result.stderr) parts.push(String(result.stderr));
  if (result.stdout) parts.push(String(result.stdout));

  return parts.length > 0 ? [...new Set(parts)].join("\n") : null;
}
