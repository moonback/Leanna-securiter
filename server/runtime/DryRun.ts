/**
 * DryRun — Simulation globale d'exécution sans effet de bord
 *
 * Roadmap V1.1 · Sécurité & contrôle de l'agent :
 *   « Dry-run global : exécuter une mission complète en simulation,
 *     sans effet de bord »
 *
 * Principe : le ToolRegistry est le point de passage unique de tous les
 * appels d'outils (missions, agents, chat). En mode dry-run, on y intercepte
 * chaque appel :
 *
 *   - un outil en lecture seule (permission `read` uniquement) s'exécute
 *     normalement — indispensable pour que la mission puisse continuer à
 *     lire des fichiers, lister, chercher et donc planifier intelligemment ;
 *   - un outil à effet de bord (`write` / `exec` / `network` / `dangerous`)
 *     n'est PAS exécuté : on retourne un résultat simulé et on enregistre
 *     l'effet qui *aurait* eu lieu.
 *
 * Le contrôleur accumule les effets simulés pour produire un rapport en fin
 * de mission (« ce que l'agent aurait fait »).
 *
 * Le mode dry-run s'appuie sur les permissions déjà déclarées par skill
 * (modèle de permissions runtime), ce qui garantit une classification
 * cohérente entre contrôle d'accès et simulation.
 */

import { normalizePermissions, type ToolPermission } from "./types.js";
import type { EventBus } from "./EventBus.js";

/** Permissions considérées comme produisant un effet de bord. */
export const SIDE_EFFECT_PERMISSIONS: readonly ToolPermission[] = [
  "write",
  "exec",
  "network",
  "dangerous",
];

/** Effet de bord qui aurait été produit par un appel intercepté. */
export interface SimulatedEffect {
  toolName: string;
  /** Permissions à effet de bord qui ont déclenché la simulation. */
  effects: ToolPermission[];
  /** Arguments de l'appel (tronqués pour la lisibilité). */
  args: Record<string, unknown>;
  timestamp: number;
  agentId?: string;
}

export interface DryRunConfig {
  /** Active la simulation. Défaut : false. */
  enabled?: boolean;
  /** EventBus optionnel pour émettre les interceptions. */
  eventBus?: EventBus;
  /**
   * Permissions considérées comme « lecture seule sûre » — un outil dont
   * TOUTES les permissions sont dans cet ensemble s'exécute réellement.
   * Défaut : ["read"].
   */
  safePermissions?: ToolPermission[];
}

/**
 * Contrôleur de simulation globale, attaché au ToolRegistry.
 */
export class DryRunController {
  private enabled: boolean;
  private readonly eventBus?: EventBus;
  private safe: Set<ToolPermission>;
  private effects: SimulatedEffect[] = [];
  private static readonly MAX_EFFECTS = 1000;

  constructor(config: DryRunConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.eventBus = config.eventBus;
    this.safe = new Set(normalizePermissions(config.safePermissions ?? ["read"]));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Détermine si un outil aurait un effet de bord (et devrait donc être
   * simulé quand le dry-run est actif). Indépendant de l'état activé/désactivé :
   * la décision « le dry-run est-il actif ? » (global ou override par appel)
   * est prise par l'appelant (ToolRegistry).
   *
   * Un outil est à effet de bord s'il requiert au moins une permission hors
   * de l'ensemble « sûr » (read). Un outil sans permission déclarée est
   * traité prudemment comme un effet de bord potentiel.
   */
  hasSideEffect(required: readonly ToolPermission[] | undefined): boolean {
    const normalized = normalizePermissions(required);
    if (normalized.length === 0) return true;
    return normalized.some((p) => !this.safe.has(p));
  }

  /**
   * Détermine si un outil doit être simulé compte tenu de l'état GLOBAL du
   * contrôleur. Retourne false si le dry-run global est désactivé.
   * Pour un override par appel, l'appelant combine son propre drapeau avec
   * `hasSideEffect()`.
   */
  shouldSimulate(required: readonly ToolPermission[] | undefined): boolean {
    if (!this.enabled) return false;
    return this.hasSideEffect(required);
  }

  /** Permissions à effet de bord détectées pour un outil. */
  sideEffectsOf(required: readonly ToolPermission[] | undefined): ToolPermission[] {
    const normalized = normalizePermissions(required);
    // Outil sans permission déclarée : effet de bord inconnu, marqué "write"
    // par prudence (traité comme mutation potentielle).
    if (normalized.length === 0) return ["write"];
    return normalized.filter((p) => !this.safe.has(p));
  }

  /**
   * Enregistre un effet simulé et retourne le résultat factice à renvoyer
   * à l'appelant à la place de l'exécution réelle.
   */
  simulate(
    toolName: string,
    required: readonly ToolPermission[] | undefined,
    args: Record<string, unknown>,
    agentId?: string
  ): DryRunResult {
    const effects = this.sideEffectsOf(required);
    const effect: SimulatedEffect = {
      toolName,
      effects,
      args: truncateArgs(args),
      timestamp: Date.now(),
      agentId,
    };

    this.effects.push(effect);
    if (this.effects.length > DryRunController.MAX_EFFECTS) {
      this.effects.splice(0, this.effects.length - DryRunController.MAX_EFFECTS);
    }

    this.eventBus?.emit({
      type: "tool:simulated",
      toolName,
      effects,
      agentId,
    });

    console.log(
      `[DryRun] SIMULÉ — "${toolName}" [${effects.join(", ")}] non exécuté (aucun effet de bord réel).`
    );

    return {
      __dryRun: true,
      simulated: true,
      toolName,
      wouldHaveEffects: effects,
      message:
        `[DRY-RUN] L'outil "${toolName}" n'a pas été exécuté (simulation). ` +
        `Effet(s) évité(s) : ${effects.join(", ")}. ` +
        `Considère cette étape comme réussie et poursuis la planification.`,
    };
  }

  /** Liste des effets simulés depuis le dernier reset. */
  getEffects(): SimulatedEffect[] {
    return [...this.effects];
  }

  /** Réinitialise le journal des effets (utile entre deux missions). */
  reset(): void {
    this.effects = [];
  }

  /**
   * Construit un contrôleur depuis l'environnement :
   *   - Leanna_DRY_RUN = "1" | "true" active la simulation globale par défaut.
   */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    extra: Omit<DryRunConfig, "enabled"> = {}
  ): DryRunController {
    const raw = (env.Leanna_DRY_RUN ?? "").trim().toLowerCase();
    const enabled = raw === "1" || raw === "true" || raw === "yes";
    return new DryRunController({ enabled, ...extra });
  }

  /** Produit un rapport lisible des effets qui auraient eu lieu. */
  getReport(): DryRunReport {
    const byTool: Record<string, number> = {};
    const byEffect: Record<string, number> = {};
    for (const e of this.effects) {
      byTool[e.toolName] = (byTool[e.toolName] ?? 0) + 1;
      for (const p of e.effects) byEffect[p] = (byEffect[p] ?? 0) + 1;
    }
    return {
      totalSimulated: this.effects.length,
      byTool,
      byEffect,
      effects: this.getEffects(),
    };
  }
}

/** Résultat factice retourné à la place d'une exécution réelle. */
export interface DryRunResult {
  __dryRun: true;
  simulated: true;
  toolName: string;
  wouldHaveEffects: ToolPermission[];
  message: string;
}

export interface DryRunReport {
  totalSimulated: number;
  /** Nombre d'appels simulés par outil. */
  byTool: Record<string, number>;
  /** Nombre d'effets simulés par type de permission. */
  byEffect: Record<string, number>;
  effects: SimulatedEffect[];
}

/** Tronque les arguments volumineux pour le journal / rapport. */
function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + `… (+${v.length - 200} car.)`;
    } else {
      out[k] = v;
    }
  }
  return out;
}
