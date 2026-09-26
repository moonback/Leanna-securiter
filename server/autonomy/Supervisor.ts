/**
 * SUPERVISOR — Boucle de contrôle côté serveur.
 *
 * Le Supervisor intercepte les résultats des outils après exécution
 * et prépare des instructions correctives à injecter dans la session
 * Gemini Live quand des problèmes sont détectés (verify échoue,
 * build cassé, tests cassés, etc.)
 *
 * IMPORTANT — Contrat d'appel :
 * Le Supervisor ne fait AUCUNE injection automatique. Chaque méthode
 * `evaluate*` retourne { needsCorrection, directive }. C'est à
 * l'appelant (le serveur) de rappeler explicitement
 * `supervisor.injectDirective(result.directive)` si needsCorrection
 * est vrai. C'est la pièce manquante entre "le modèle reçoit le
 * résultat d'erreur" et "le modèle est FORCÉ de corriger avant de
 * continuer" — mais cette pièce doit être câblée par l'appelant.
 *
 * Architecture:
 *   handleToolCall()
 *     → skillManager.handleToolCall()
 *     → const result = await Supervisor.evaluate(...)
 *     → if (result.needsCorrection) supervisor.injectDirective(result.directive)
 *     → session.sendToolResponse()
 *
 * Modèle de progression (aligné sur le module "Moteur d'Autonomie") :
 *   - Chaque "approche" tolère `attemptsPerApproach` échecs (défaut 2).
 *   - Après ce seuil, ou dès qu'une erreur identique se répète (boucle),
 *     un PIVOT est forcé : l'approche suivante démarre.
 *   - Après `maxApproaches` approches épuisées (défaut 3, donc 6
 *     tentatives max), ESCALADE obligatoire vers l'utilisateur.
 *   - `MAX_TOTAL_CORRECTIONS` reste un coupe-circuit séparé, au niveau
 *     de la session entière (tous fichiers confondus) — un garde-fou
 *     indépendant du compteur par fichier, pas une redite de celui-ci.
 */

import { createLogger } from "../utils/logger.js";
import { createHash } from "crypto";

const log = createLogger("Supervisor");

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SupervisorConfig {
  /** Échecs tolérés par approche avant pivot forcé (défaut: 2) */
  attemptsPerApproach: number;
  /** Nombre d'approches distinctes avant escalade obligatoire (défaut: 3) */
  maxApproaches: number;
  /** Active la correction automatique (défaut: true) */
  autoCorrect: boolean;
  /** Active le suivi de mission persistant (défaut: true) */
  trackMission: boolean;
  /** Timeout par action (ms, défaut: 30000) */
  actionTimeout: number;
}

export interface VerifyFailure {
  file: string;
  errors: string;
  timestamp: number;
  attemptNumber: number;
  approachNumber: number;
}

export interface MissionObjective {
  id: string;
  description: string;
  successCriteria: string[];
  status: "active" | "completed" | "failed" | "paused";
  startedAt: number;
  /** Fichiers modifiés pendant cette mission */
  touchedFiles: Set<string>;
  /** Historique des vérifications échouées */
  verifyFailures: VerifyFailure[];
  /** Nombre total de corrections effectuées */
  corrections: number;
}

export type SessionInjector = (message: string) => void;

/**
 * Sous-ensemble typé des champs de résultat réellement lus par ce module.
 * Le format exact varie selon l'outil (verify_file, build), donc tous les
 * champs restent optionnels — mais au moins typés, plus de `any`.
 */
export interface VerifyResult {
  ok?: boolean;
  status?: string;
  valid?: boolean;
  allIssues?: Array<{
    type?: string;
    rule?: string;
    file?: string;
    line?: number;
    message?: string;
  }>;
  typecheck?: PhaseResult;
  tsc?: PhaseResult;
  lint?: PhaseResult;
  test?: PhaseResult;
  error?: string;
  message?: string;
  stderr?: string;
  stdout?: string;
}

export interface PhaseResult {
  ok?: boolean;
  exitCode?: number;
  output?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  errors?: unknown;
  violations?: unknown;
}

export interface BuildResult {
  valid: boolean;
  errors?: string;
}

interface EvaluationOutcome {
  needsCorrection: boolean;
  directive?: string;
}

/** Nombre d'erreurs passées conservées pour la détection de boucle (comprend l'erreur courante). */
const ERROR_HISTORY_SIZE = 4; // 1 courante + 3 précédentes — cohérent avec les directives ("une des 3 dernières tentatives")

/** Clé interne utilisée pour tracker les échecs de build global dans le même mécanisme que les fichiers. */
const GLOBAL_BUILD_KEY = "__global_build__";

interface FileHistory {
  /** Tentatives dans l'approche courante */
  attemptInApproach: number;
  /** Numéro de l'approche courante (démarre à 1) */
  approachNumber: number;
  /** Historique glissant des erreurs (la plus récente en dernier) */
  lastErrors: string[];
  /** Historique des hashes de contenu de fichier (pour détecter A→B→A) */
  contentHashes: string[];
  /** Timestamp de la dernière modification */
  lastModifiedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Supervisor
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SupervisorConfig = {
  attemptsPerApproach: 2,
  maxApproaches: 3,
  autoCorrect: true,
  trackMission: true,
  actionTimeout: 30000,
};

export class Supervisor {
  private config: SupervisorConfig;
  private currentMission: MissionObjective | null = null;
  private injector: SessionInjector | null = null;

  /** Historique des corrections par fichier (pour détection de boucles et suivi d'approche) */
  private correctionHistory: Map<string, FileHistory> = new Map();

  /** Fichiers bloqués après épuisement des approches (escalade déclenchée sur CE fichier) */
  private blockedFiles: Set<string> = new Set();

  /** Mission mise en pause suite à une escalade globale (coupe-circuit de session) */
  private missionPaused = false;

  /** Timestamp de la dernière directive injectée par fichier (pour backoff) */
  private lastDirectiveAt: Map<string, number> = new Map();

  /** Compteur global de corrections dans la session (tous fichiers confondus) */
  private totalCorrections = 0;
  private static readonly MAX_TOTAL_CORRECTIONS = 10;

  /** Délai de base pour le backoff exponentiel (ms) */
  private static readonly BACKOFF_BASE_MS = 500;

  constructor(config: Partial<SupervisorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  /**
   * Injecte la fonction qui permet d'envoyer des messages dans la session Live.
   * C'est le lien entre le superviseur et Gemini.
   */
  setSessionInjector(injector: SessionInjector): void {
    this.injector = injector;
  }

  /**
   * Calcule le hash MD5 d'un contenu de fichier.
   */
  private hashContent(content: string): string {
    return createHash("md5").update(content, "utf8").digest("hex");
  }

  /**
   * Enregistre le hash d'un fichier avant modification.
   * À appeler depuis les skills d'écriture (write/modify/patch).
   */
  recordFileHashBefore(filePath: string, content: string): void {
    const hash = this.hashContent(content);
    const history = this.correctionHistory.get(filePath) || {
      attemptInApproach: 0,
      approachNumber: 1,
      lastErrors: [],
      contentHashes: [],
    };
    
    // Ne pas dupliquer si c'est déjà le dernier hash enregistré
    if (history.contentHashes.length === 0 || history.contentHashes[history.contentHashes.length - 1] !== hash) {
      history.contentHashes.push(hash);
      // Garder les 6 derniers hashes (2 tentatives × 3 approches)
      if (history.contentHashes.length > 6) {
        history.contentHashes.shift();
      }
    }
    
    this.correctionHistory.set(filePath, history);
  }

  /**
   * Vérifie si un hash a déjà été vu (détection A→B→A).
   */
  detectContentLoop(filePath: string, newHash: string): boolean {
    const history = this.correctionHistory.get(filePath);
    if (!history || history.contentHashes.length === 0) return false;
    
    // Vérifier si ce hash existe déjà dans l'historique (excluant le dernier qui est l'avant-modification)
    const previousHashes = history.contentHashes.slice(0, -1);
    return previousHashes.includes(newHash);
  }

  /**
   * Démarre une nouvelle mission (objectif persistant).
   */
  startMission(description: string, successCriteria: string[] = []): MissionObjective {
    this.currentMission = {
      id: `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description,
      successCriteria: successCriteria.length > 0 ? successCriteria : [
        "Code compile sans erreur",
        "verify_file passe",
        "Aucun breaking change",
      ],
      status: "active",
      startedAt: Date.now(),
      touchedFiles: new Set(),
      verifyFailures: [],
      corrections: 0,
    };
    this.missionPaused = false;

    log.info(`🎯 Mission démarrée: "${description}" (${this.currentMission.id})`);
    return this.currentMission;
  }

  /**
   * Récupère la mission active.
   */
  getMission(): MissionObjective | null {
    return this.currentMission;
  }

  /**
   * Termine la mission active.
   */
  completeMission(success: boolean): void {
    if (!this.currentMission) return;
    this.currentMission.status = success ? "completed" : "failed";
    log.info(`${success ? "✓" : "✗"} Mission terminée: "${this.currentMission.description}" (${this.currentMission.corrections} corrections)`);
    this.currentMission = null;
    this.correctionHistory.clear();
    this.blockedFiles.clear();
    this.lastDirectiveAt.clear();
    this.totalCorrections = 0;
    this.missionPaused = false;
  }

  // ─── Évaluation post-outil ────────────────────────────────────────────────

  /**
   * Évalue le résultat d'un verify_file et décide de la réaction.
   * Retourne true si une correction devrait être injectée par l'appelant.
   * Async : applique réellement le backoff exponentiel avant de retourner,
   * au lieu de le calculer puis l'ignorer.
   */
  async evaluateVerifyResult(filePath: string, verifyResult: VerifyResult): Promise<EvaluationOutcome> {
    // Si verify passe → tout va bien
    if (verifyResult?.ok === true || verifyResult?.status === "success" || verifyResult?.status === "ok" || verifyResult?.valid === true) {
      this.correctionHistory.delete(filePath);
      if (this.currentMission) {
        this.currentMission.touchedFiles.add(filePath);
      }
      return { needsCorrection: false };
    }

    const errors = this.extractErrors(verifyResult);
    if (!errors) {
      return { needsCorrection: false };
    }

    if (this.currentMission) {
      this.currentMission.touchedFiles.add(filePath);
    }

    return this.evaluateFailure(filePath, errors);
  }

  /**
   * Évalue un résultat de build global.
   * Passe désormais par le même mécanisme anti-boucle / pivot / escalade
   * que les fichiers individuels (auparavant : aucun suivi, aucune limite).
   */
  async evaluateBuildResult(result: BuildResult): Promise<EvaluationOutcome> {
    if (result.valid) {
      this.correctionHistory.delete(GLOBAL_BUILD_KEY);
      return { needsCorrection: false };
    }
    return this.evaluateFailure(GLOBAL_BUILD_KEY, result.errors || "Build failed");
  }

  /**
   * Logique commune de suivi d'échec (fichier ou build global), partagée
   * pour éviter que l'un des deux points d'entrée échappe au système
   * anti-boucle / pivot / escalade.
   */
  private async evaluateFailure(key: string, errors: string): Promise<EvaluationOutcome> {
    const isBuild = key === GLOBAL_BUILD_KEY;
    const label = isBuild ? "build global" : key;

    if (this.missionPaused) {
      return {
        needsCorrection: true,
        directive: this.buildEscalationDirective(key, errors, /*sessionWide*/ true),
      };
    }

    // --- Fichier déjà bloqué : ne pas relancer de cycle, renvoyer directement l'escalade ---
    if (this.blockedFiles.has(key)) {
      return {
        needsCorrection: true,
        directive: this.buildEscalationDirective(key, errors),
      };
    }

    const history = this.correctionHistory.get(key) || {
      attemptInApproach: 0,
      approachNumber: 1,
      lastErrors: [],
      contentHashes: [],
    };
    history.attemptInApproach++;
    history.lastErrors.push(errors);
    history.lastModifiedAt = Date.now();
    if (history.lastErrors.length > ERROR_HISTORY_SIZE) history.lastErrors.shift();
    this.correctionHistory.set(key, history);

    // Détection de boucle d'erreurs : erreur identique à une des tentatives précédentes
    const recentErrors = history.lastErrors.slice(0, -1);
    const isErrorLoop = recentErrors.some((prev) => prev === errors);
    
    // Détection de boucle de contenu : le fichier revient à un état déjà vu
    // (cette information sera vérifiée au moment du patch via recordFileHashBefore)
    const isContentLoop = history.contentHashes.length >= 2 && 
      history.contentHashes[history.contentHashes.length - 1] === 
      history.contentHashes[history.contentHashes.length - 2];

    const isLoop = isErrorLoop || isContentLoop;

    const recordFailure = (attemptNumber: number, approachNumber: number) => {
      this.totalCorrections++;
      if (this.currentMission && !isBuild) {
        this.currentMission.corrections++;
        this.currentMission.verifyFailures.push({
          file: key,
          errors,
          timestamp: Date.now(),
          attemptNumber,
          approachNumber,
        });
      } else if (this.currentMission && isBuild) {
        this.currentMission.corrections++;
      }
    };

    // --- Coupe-circuit de session : trop de corrections tous fichiers confondus ---
    if (this.totalCorrections + 1 >= Supervisor.MAX_TOTAL_CORRECTIONS) {
      log.warn(`⚠️ Limite de corrections de session atteinte (${Supervisor.MAX_TOTAL_CORRECTIONS}). Mission mise en pause.`);
      this.missionPaused = true;
      this.blockedFiles.add(key);
      recordFailure(history.attemptInApproach, history.approachNumber);
      return {
        needsCorrection: true,
        directive: this.buildEscalationDirective(key, errors, /*sessionWide*/ true),
      };
    }

    // --- Boucle détectée → pivot immédiat, quel que soit le compte de tentatives ---
    if (isLoop) {
      const loopType = isContentLoop ? "contenu" : "erreurs";
      log.warn(`🔄 Boucle détectée (${loopType}) sur ${label} (approche #${history.approachNumber}, tentative #${history.attemptInApproach}).`);
      recordFailure(history.attemptInApproach, history.approachNumber);
      return this.advanceApproachOrEscalate(key, errors, history, /*forcedByLoop*/ true);
    }

    // --- Seuil de tentatives par approche atteint → pivot ---
    if (history.attemptInApproach >= this.config.attemptsPerApproach) {
      log.warn(`⚠️ ${label}: ${history.attemptInApproach} tentatives échouées sur l'approche #${history.approachNumber}.`);
      recordFailure(history.attemptInApproach, history.approachNumber);
      return this.advanceApproachOrEscalate(key, errors, history, /*forcedByLoop*/ false);
    }

    // --- Cas normal : backoff exponentiel réellement appliqué, puis directive de correction ---
    const backoffMs = Supervisor.BACKOFF_BASE_MS * Math.pow(2, history.attemptInApproach - 1);
    const lastAt = this.lastDirectiveAt.get(key) ?? 0;
    const elapsed = Date.now() - lastAt;
    if (elapsed < backoffMs) {
      const wait = backoffMs - elapsed;
      log.debug(`⏳ Backoff ${wait}ms pour ${label} (tentative #${history.attemptInApproach})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastDirectiveAt.set(key, Date.now());

    recordFailure(history.attemptInApproach, history.approachNumber);

    log.info(`🔧 Correction #${history.attemptInApproach} (approche #${history.approachNumber}) pour ${label}`);
    return {
      needsCorrection: true,
      directive: isBuild
        ? this.buildGlobalBuildDirective(errors)
        : this.buildCorrectionDirective(key, errors, history.attemptInApproach),
    };
  }

  /**
   * Fait progresser vers l'approche suivante, ou escalade si le nombre
   * maximal d'approches est atteint. Centralise la règle "2 tentatives
   * × 3 approches = 6 max" partagée avec le module Moteur d'Autonomie.
   */
  private advanceApproachOrEscalate(
    key: string,
    errors: string,
    history: FileHistory,
    forcedByLoop: boolean,
  ): EvaluationOutcome {
    if (history.approachNumber >= this.config.maxApproaches) {
      log.warn(`⛔ ${key}: approches épuisées (${history.approachNumber}/${this.config.maxApproaches}). Escalade.`);
      this.blockedFiles.add(key);
      return {
        needsCorrection: true,
        directive: this.buildEscalationDirective(key, errors),
      };
    }

    // Nouvelle approche : réinitialiser le compteur de tentatives, garder l'historique d'erreurs
    // (utile pour continuer à détecter les boucles même après un pivot).
    history.approachNumber++;
    history.attemptInApproach = 0;
    this.correctionHistory.set(key, history);

    const directive = forcedByLoop
      ? this.buildLoopBreakDirective(key, errors, history.approachNumber)
      : this.buildPivotDirective(key, errors, history.approachNumber);

    return { needsCorrection: true, directive };
  }

  /**
   * Injecte une directive dans la session Gemini Live.
   * Rien n'appelle cette méthode automatiquement — voir le contrat d'appel en tête de fichier.
   */
  injectDirective(directive: string): void {
    if (!this.injector) {
      log.warn("Pas d'injecteur configuré. Directive ignorée.");
      return;
    }
    this.injector(directive);
  }

  /**
   * La mission est-elle en pause suite à une escalade de session ?
   * L'appelant peut vérifier ce flag avant de relancer des corrections automatiques.
   */
  isMissionPaused(): boolean {
    return this.missionPaused;
  }

  /**
   * Reprend une mission mise en pause après validation humaine explicite.
   */
  resumeMission(): void {
    this.missionPaused = false;
    this.totalCorrections = 0;
    this.correctionHistory.clear();
    this.blockedFiles.clear();
    this.lastDirectiveAt.clear();
    log.info("▶️ Mission reprise après validation humaine.");
  }

  // ─── Construction des directives ─────────────────────────────────────────

  private buildCorrectionDirective(file: string, errors: string, attempt: number): string {
    return [
      `[SUPERVISOR — CORRECTION REQUISE]`,
      ``,
      `Le fichier "${file}" contient des erreurs après ta modification (tentative ${attempt}/${this.config.attemptsPerApproach}).`,
      ``,
      `Erreurs détectées:`,
      errors.slice(0, 500),
      ``,
      `INSTRUCTION OBLIGATOIRE:`,
      `1. Analyse les erreurs ci-dessus.`,
      `2. Corrige le fichier immédiatement (patch_project_file ou modify_project_file).`,
      `3. La vérification sera relancée automatiquement.`,
      ``,
      `Ne passe PAS à une autre tâche tant que ce fichier n'est pas valide.`,
    ].join("\n");
  }

  private buildPivotDirective(file: string, errors: string, newApproachNumber: number): string {
    return [
      `[SUPERVISOR — PIVOT REQUIS]`,
      ``,
      `Le fichier "${file}" a épuisé son approche actuelle. Nouvelle approche : #${newApproachNumber}/${this.config.maxApproaches}.`,
      ``,
      `Dernières erreurs:`,
      errors.slice(0, 300),
      ``,
      `INSTRUCTION OBLIGATOIRE:`,
      `1. STOP — N'essaie pas la même approche une fois de plus.`,
      `2. DIAGNOSE — Pourquoi tes corrections précédentes n'ont pas fonctionné ?`,
      `3. PIVOT — Adopte une approche fondamentalement différente :`,
      `   - Peut-être la structure du code doit changer`,
      `   - Peut-être un import manque ou un type est incorrect`,
      `   - Peut-être le fichier entier doit être réécrit (write_project_file)`,
      `4. Si tu es bloqué après cette approche, la suivante sera la dernière avant escalade.`,
    ].join("\n");
  }

  private buildLoopBreakDirective(file: string, errors: string, newApproachNumber: number): string {
    return [
      `[SUPERVISOR — BOUCLE DÉTECTÉE]`,
      ``,
      `Tu produis les MÊMES erreurs sur "${file}" après correction.`,
      `Tes corrections précédentes ne changent pas le résultat. Nouvelle approche forcée : #${newApproachNumber}/${this.config.maxApproaches}.`,
      ``,
      `Erreurs (identiques aux précédentes):`,
      errors.slice(0, 300),
      ``,
      `INSTRUCTION OBLIGATOIRE:`,
      `1. Relis le fichier en entier (read_project_file sans restriction de lignes).`,
      `2. Comprends la CAUSE RACINE — pas juste le symptôme.`,
      `3. Propose une solution DIFFÉRENTE de ce que tu as déjà essayé.`,
      `4. Si c'est un problème de type/import, vérifie les fichiers dépendants.`,
    ].join("\n");
  }

  private buildEscalationDirective(_file: string, _errors: string, sessionWide = false): string {
    const reason = sessionWide
      ? `Le coupe-circuit de session a été atteint (${this.totalCorrections}/${Supervisor.MAX_TOTAL_CORRECTIONS} corrections tous fichiers confondus).`
      : `Toutes les approches disponibles (${this.config.maxApproaches}) ont échoué sur ce fichier.`;
    return [
      `[SUPERVISOR — ESCALATION]`,
      ``,
      reason,
      `Cela indique un problème structurel.`,
      ``,
      `INSTRUCTION:`,
      `1. Explique à l'utilisateur ce qui bloque.`,
      `2. Résume les erreurs persistantes.`,
      `3. Propose des options : rollback, approche différente, ou aide humaine.`,
      `4. N'essaie PLUS de corriger automatiquement sans validation humaine (voir resumeMission()).`,
    ].join("\n");
  }

  private buildGlobalBuildDirective(errors: string): string {
    return [
      `[SUPERVISOR — BUILD CASSÉ]`,
      ``,
      `Le build global du projet a échoué après tes modifications.`,
      ``,
      `Erreurs:`,
      errors.slice(0, 800),
      ``,
      `INSTRUCTION OBLIGATOIRE:`,
      `1. Identifie quels fichiers tu as modifiés qui causent le problème.`,
      `2. Corrige-les un par un en commençant par celui qui a le plus d'erreurs.`,
      `3. Vérifie après chaque correction.`,
      `4. Le build doit passer avant que la tâche soit considérée terminée.`,
    ].join("\n");
  }

  // ─── Utilitaires ─────────────────────────────────────────────────────────

  private extractErrors(verifyResult: VerifyResult): string | null {
    if (!verifyResult) return "verify_file n'a retourné aucun résultat.";
    const parts: string[] = [];

    if (Array.isArray(verifyResult.allIssues)) {
      parts.push(...verifyResult.allIssues.slice(0, 20).map((issue) =>
        `[${issue.type ?? "verification"}/${issue.rule ?? "unknown"}] ${issue.file ?? "global"}${issue.line ? `:${issue.line}` : ""} — ${issue.message ?? "Erreur"}`
      ));
    }

    const addPhase = (label: string, phase?: PhaseResult) => {
      if (!phase || phase.ok !== false) return;
      const output = [phase.output, phase.stdout, phase.stderr, phase.errors, phase.violations]
        .flatMap((value) => Array.isArray(value)
          ? value.map((item) => typeof item === "string" ? item : (item as { message?: string })?.message ?? JSON.stringify(item))
          : value ? [String(value)] : [])
        .filter(Boolean)
        .join("\n");
      parts.push(`${label} (code ${phase.exitCode ?? "inconnu"}): ${output || "échec sans sortie"}`);
    };

    addPhase("TypeScript", verifyResult.typecheck ?? verifyResult.tsc);
    addPhase("Lint", verifyResult.lint);
    addPhase("Tests", verifyResult.test);
    if (verifyResult.error) parts.push(String(verifyResult.error));
    if (verifyResult.message && verifyResult.status === "failed") parts.push(String(verifyResult.message));
    if (verifyResult.stderr) parts.push(String(verifyResult.stderr));
    if (verifyResult.stdout) parts.push(String(verifyResult.stdout));

    return parts.length > 0 ? [...new Set(parts)].join("\n") : null;
  }

  /**
   * Vérifie si un fichier (ou le build global) est bloqué après escalade.
   * Utilisé par le serveur pour rejeter les écritures sur ce fichier
   * ou pour suspendre les tentatives de build automatique.
   */
  isFileBlocked(filePath: string): boolean {
    return this.blockedFiles.has(filePath);
  }

  /**
   * Reset complet (utile pour nouvelle session).
   */
  reset(): void {
    this.currentMission = null;
    this.correctionHistory.clear();
    this.blockedFiles.clear();
    this.lastDirectiveAt.clear();
    this.totalCorrections = 0;
    this.missionPaused = false;
  }

  /**
   * Statistiques de la session.
   */
  getStats(): {
    totalCorrections: number;
    activeMission: string | null;
    missionPaused: boolean;
    filesWithIssues: string[];
    blockedFiles: string[];
  } {
    return {
      totalCorrections: this.totalCorrections,
      activeMission: this.currentMission?.description ?? null,
      missionPaused: this.missionPaused,
      filesWithIssues: Array.from(this.correctionHistory.entries())
        .filter(([_, h]) => h.attemptInApproach > 0 || h.approachNumber > 1)
        .map(([f]) => f),
      blockedFiles: Array.from(this.blockedFiles),
    };
  }
}

// ─── Instance singleton ─────────────────────────────────────────────────────

export const supervisor = new Supervisor();