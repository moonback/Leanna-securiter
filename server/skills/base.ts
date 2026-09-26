import { z } from "zod";

/**
 * Permission déclarable par un skill / outil.
 *
 * Vocabulaire de la roadmap V1.1 « Modèle de permissions par skill » :
 *   - `read`    : lecture de fichiers / ressources
 *   - `write`   : écriture / création / suppression
 *   - `network` : accès réseau sortant
 *   - `exec`    : exécution de commandes / processus
 *
 * Doit rester aligné avec `SkillPermission` de `server/runtime/types.ts`.
 */
export type SkillPermission = "read" | "write" | "network" | "exec";

/**
 * Contexte enrichi passé à chaque appel de skill.
 * Contient l'état du projet, de la tâche courante, et les préférences utilisateur.
 */
export interface SkillContext {
  /** État du projet (fichiers, structure, configuration) */
  project?: {
    root: string;
    files?: string[];
    packageJson?: any;
    tsConfig?: any;
    gitStatus?: string;
  };
  /** État de la tâche/orchestration en cours */
  task?: {
    id: string;
    title: string;
    type: 'delegate' | 'orchestrate' | 'collaborate' | 'workflow' | 'manual';
    parentId?: string;
    stepIndex?: number;
    totalSteps?: number;
  };
  /** Préférences et historique utilisateur */
  user?: {
    preferences: Record<string, any>;
    recentErrors: string[];
    preferredStyle: 'concise' | 'detailed' | 'step-by-step';
    language: 'fr' | 'en';
  };
  /** Résultats des étapes précédentes (pour chaînage) */
  previousResults?: Record<string, any>;
  /** Métadonnées d'exécution */
  execution?: {
    attemptNumber: number;
    maxRetries: number;
    timeoutMs: number;
    startTime: number;
  };
  /** Données arbitraires pour extensions */
  custom?: Record<string, any>;
  /** Callback pour émettre des données en temps réel vers le client */
  emitToClient?: (data: any) => void;
  /** Nom de la voix pour la synthèse vocale TTS */
  voiceName?: string;
  /** Callback pour notifier la session Live API d'une mise à jour de tâche en arrière-plan */
  notifyLiveAPI?: (message: string) => void;
  /** Callback pour émettre une action IDE vers le client */
  emitIdeAction?: (action: any) => void;
  /** Drapeaux d'attente d'action / lecture navigateur */
  browserReadPending?: boolean;
  browserActionPending?: boolean;
  /**
   * Signal d'annulation temps-réel (kill-switch). Propagé par le ToolRegistry
   * jusqu'aux handlers coopératifs : un outil long-running (ex.
   * `run_project_command`) doit le transmettre à son sous-processus/requête
   * pour un arrêt immédiat quand la tâche est annulée.
   */
  signal?: AbortSignal;
}

/**
 * Résultat standardisé d'un appel d'outil.
 * Permet à l'IA de comprendre le succès/échec et d'agir en conséquence.
 */
export interface SkillResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    recoverable: boolean;
    suggestions?: string[];
    retryAfterMs?: number;
  };
  metadata?: {
    durationMs: number;
    toolName: string;
    skillName: string;
    nextActions?: string[];
  };
}

/**
 * Définition d'une action chaînée dans un skill.
 * Permet de définir des séquences d'opérations internes.
 */
export interface ChainedAction {
  name: string;
  toolName: string;
  args: Record<string, any> | ((previousResult: any, context: SkillContext) => Record<string, any>);
  condition?: (previousResult: any, context: SkillContext) => boolean;
  onError?: 'stop' | 'skip' | 'retry' | 'fallback';
  fallbackAction?: ChainedAction;
  transformResult?: (result: any, context: SkillContext) => any;
}

/**
 * Configuration pour l'exécution d'une chaîne d'actions.
 */
export interface ChainExecutionConfig {
  stopOnError?: boolean;
  parallel?: boolean;
  maxParallel?: number;
  timeoutMs?: number;
  onProgress?: (step: number, total: number, result: any) => void;
}

/**
 * Interface Skill améliorée avec validation obligatoire, chaînage et contexte typé.
 */
export interface Skill {
  name: string;
  declarations: any[];
  /** Schémas Zod pour les outils qui les exposent. */
  inputSchemas?: Record<string, z.ZodType<any>>;
  /** Handler principal. Le contexte reste optionnel pour compatibilité. */
  handleToolCall: (name: string, args: any, context?: SkillContext) => Promise<any> | any
  /** Actions internes chaînées (optionnel) - pour logique complexe multi-étapes */
  chainedActions?: Record<string, ChainedAction[]>;
  /**
   * Permissions requises par défaut pour tous les outils de ce skill.
   * Déclarées explicitement, appliquées au runtime par le ToolRegistry.
   * Si absent, les permissions sont déduites du nom de l'outil (fallback).
   */
  permissions?: SkillPermission[];
  /**
   * Permissions par outil (surcharge `permissions` pour un outil précis).
   * Clé = nom de l'outil (déclaration), valeur = permissions requises.
   */
  toolPermissions?: Record<string, SkillPermission[]>;
  /** Métadonnées du skill */
  metadata?: {
    version: string;
    description: string;
    category: string;
    dependencies?: string[]; // Autres skills requis
  };
}

/**
 * Déclaration d'outil enrichie pour l'IA.
 */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: any;
  /** Exemples d'utilisation pour l'IA */
  examples?: Array<{ args: any; result?: any; description: string }>;
  /** Catégorie pour regroupement */
  category?: string;
  /** Indique si l'outil modifie l'état (pour confirmation) */
  mutating?: boolean;
  /** Timeout spécifique à cet outil */
  timeoutMs?: number;
  /** Permissions requises par cet outil (déclarées, appliquées au runtime) */
  permissions?: SkillPermission[];
}

/**
 * Valide les arguments avec message d'erreur enrichi pour auto-correction.
 */
export function validateArgs<T extends z.ZodType<any, any, any>>(
  schema: T,
  args: unknown,
  toolName?: string
): z.output<T> {
  try {
    return schema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => {
              const path = issue.path.join('.') || '(root)';
              const received = 'received' in issue ? ` (reçu: ${JSON.stringify((issue as any).received)})` : '';
              return `${path}: ${issue.message}${received}`;
            }).join('; ');
      
      const suggestion = toolName 
        ? `Pour corriger: vérifiez les paramètres requis pour "${toolName}". Exemple valide attendu par le schéma.`
        : 'Vérifiez les paramètres fournis.';
      
      throw new SkillValidationError(issues, toolName, suggestion);
    }
    throw error;
  }
}

/**
 * Erreur de validation enrichie pour permettre l'auto-correction.
 */
export class SkillValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR';
  public readonly recoverable = true;
  public readonly suggestions: string[];
  public readonly toolName?: string;
  public readonly zodIssues: z.ZodIssue[];

  constructor(message: string, toolName?: string, suggestion?: string) {
    super(message);
    this.name = 'SkillValidationError';
    this.toolName = toolName;
    this.suggestions = suggestion ? [suggestion] : [
      'Vérifiez les types des paramètres',
      'Assurez-vous que tous les champs requis sont fournis',
      'Consultez la documentation du schéma pour les formats attendus'
    ];
    this.zodIssues = [];
  }

  static fromZodError(error: z.ZodError, toolName?: string): SkillValidationError {
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      const err = new SkillValidationError(`Validation échouée: ${issues}`, toolName);
      // @ts-ignore - readonly property set via constructor
      err.zodIssues = error.issues;
      return err;
    }
}

/**
 * Erreur d'exécution de skill avec métadonnées de récupération.
 */
export class SkillExecutionError extends Error {
  public readonly code: string;
  public readonly recoverable: boolean;
  public readonly suggestions: string[];
  public readonly retryAfterMs?: number;
  public readonly originalError?: Error;

  constructor(
    message: string,
    code: string,
    recoverable: boolean = true,
    suggestions: string[] = [],
    retryAfterMs?: number,
    originalError?: Error
  ) {
    super(message);
    this.name = 'SkillExecutionError';
    this.code = code;
    this.recoverable = recoverable;
    this.suggestions = suggestions.length > 0 ? suggestions : [
      'Réessayez avec des paramètres différents',
      'Vérifiez les prérequis (fichiers, permissions, réseau)',
      'Consultez les logs pour plus de détails'
    ];
    this.retryAfterMs = retryAfterMs;
    this.originalError = originalError;
  }
}

/**
 * Exécute une chaîne d'actions séquentielles ou parallèles.
 * Retourne les résultats de chaque étape.
 */
export async function executeChain(
  actions: ChainedAction[],
  context: SkillContext,
  config: ChainExecutionConfig = {}
): Promise<SkillResult[]> {
  const {
    stopOnError = true,
    parallel = false,
    maxParallel = 3,
    timeoutMs = 60000,
    onProgress
  } = config;

  // Réservé à l'implémentation d'un timeout global.
  void timeoutMs;
  const results: SkillResult[] = [];

    if (parallel) {
      // Exécution par lots parallèles
      for (let i = 0; i < actions.length; i += maxParallel) {
        const batch = actions.slice(i, i + maxParallel);
        const batchPromises = batch.map(async (action, batchIndex) => {
          const globalIndex = i + batchIndex;
        
          // Vérifier la condition
          if (action.condition && !action.condition(results[globalIndex - 1]?.data, context)) {
            return { success: true, data: null, metadata: { durationMs: 0, toolName: action.toolName, skillName: context.custom?.currentSkill || '', skipped: true } as any };
          }

          const resolvedArgs = typeof action.args === 'function'
            ? action.args(results[globalIndex - 1]?.data, context)
            : action.args;

          try {
            // Note: l'appel réel se fait via le SkillManager, ici on simule
            // Le vrai appel sera fait par le handler du skill
            return { success: true, data: { action: action.name, args: resolvedArgs }, metadata: { durationMs: 0, toolName: action.toolName, skillName: context.custom?.currentSkill || '' } };
          } catch (error) {
            return handleActionError(error, action, context);
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        if (onProgress) {
          onProgress(i + batchResults.length, actions.length, batchResults[batchResults.length - 1]);
        }

        // Vérifier erreurs si stopOnError
              if (stopOnError && batchResults.some(r => !r.success && 'error' in r && r.error && r.error.recoverable === false)) {
                break;
              }
      }
    } else {
      // Exécution séquentielle
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        // Vérifier la condition
        if (action.condition && !action.condition(results[i - 1]?.data, context)) {
          results.push({ success: true, data: null, metadata: { durationMs: 0, toolName: action.toolName, skillName: context.custom?.currentSkill || '', skipped: true } as any });
          if (onProgress) onProgress(i + 1, actions.length, results[i]);
          continue;
        }

        const resolvedArgs = typeof action.args === 'function'
          ? action.args(results[i - 1]?.data, context)
          : action.args;

        try {
          // Le vrai appel d'outil sera délégué au skill via une fonction de callback
          // Ici on retourne la structure attendue
          results.push({ 
            success: true, 
            data: { action: action.name, args: resolvedArgs, _execute: true },
            metadata: { durationMs: 0, toolName: action.toolName, skillName: context.custom?.currentSkill || '' }
          });
        } catch (error) {
          const errorResult = handleActionError(error, action, context);
          results.push(errorResult);

          if (stopOnError && errorResult.error?.recoverable === false) {
            break;
          }

          // Gérer fallback
          if (action.fallbackAction && errorResult.error?.recoverable) {
            const fallbackResult = await executeChain([action.fallbackAction!], context, config);
            results.push(fallbackResult[0]);
          }
        }

        if (onProgress) onProgress(i + 1, actions.length, results[i]);
      }
    }

    return results;
  }

function handleActionError(error: any, _action: ChainedAction, _context: SkillContext): SkillResult {
  if (error instanceof SkillValidationError) {
    return {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        recoverable: error.recoverable,
        suggestions: error.suggestions,
      }
    };
  }
  if (error instanceof SkillExecutionError) {
    return {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        recoverable: error.recoverable,
        suggestions: error.suggestions,
        retryAfterMs: error.retryAfterMs,
      }
    };
  }
  return {
    success: false,
    error: {
      message: error?.message || 'Erreur inconnue',
      code: 'EXECUTION_ERROR',
      recoverable: true,
      suggestions: ['Réessayez', 'Vérifiez les paramètres', 'Contactez le support si persiste'],
    }
  };
}

/**
 * Helper pour créer un résultat de succès standardisé.
 */
export function createSuccessResult<T>(data: T, toolName: string, skillName: string, durationMs: number, nextActions?: string[]): SkillResult<T> {
  return {
    success: true,
    data,
    metadata: { durationMs, toolName, skillName, nextActions }
  };
}

/**
 * Helper pour créer un résultat d'erreur standardisé.
 */
export function createErrorResult(
  message: string,
  code: string,
  toolName: string,
  skillName: string,
  recoverable: boolean = true,
  suggestions?: string[],
  retryAfterMs?: number
): SkillResult {
  return {
    success: false,
    error: { message, code, recoverable, suggestions, retryAfterMs },
    metadata: { durationMs: 0, toolName, skillName }
  };
}
