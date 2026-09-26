/**
 * PermissionPolicy — Modèle de permissions par skill appliqué au runtime
 *
 * Roadmap V1.1 · Sécurité & contrôle de l'agent :
 *   « Modèle de permissions par skill (read / write / network / exec)
 *     déclaré et appliqué au runtime »
 *
 * Chaque outil déclare les permissions qu'il requiert (via son skill ou sa
 * déclaration). La politique définit, elle, ce qui est *accordé* globalement
 * à l'exécution. À chaque appel, le ToolRegistry compare les permissions
 * requises par l'outil au jeu accordé par la politique :
 *
 *   - mode "enforce" : un appel réclamant une permission non accordée est refusé.
 *   - mode "audit"   : l'appel passe mais un avertissement est journalisé.
 *   - mode "off"     : aucune vérification (comportement legacy).
 *
 * La politique est indépendante des permissions éventuellement fournies par
 * l'appelant (`callerPermissions`) : elle s'applique *toujours*, ce qui répond
 * à l'exigence « appliqué au runtime ».
 */

import {
  normalizePermissions,
  type ToolPermission,
} from "./types.js";
import type { EventBus } from "./EventBus.js";

export type PermissionMode = "enforce" | "audit" | "off";

/** Toutes les permissions accordées par défaut (comportement ouvert). */
export const ALL_PERMISSIONS: readonly ToolPermission[] = [
  "read",
  "write",
  "network",
  "exec",
  "dangerous",
];

export interface PermissionDecision {
  allowed: boolean;
  toolName: string;
  required: ToolPermission[];
  /**
   * Motifs de refus (vide si autorisé). Peut contenir :
   *   - des `ToolPermission` requises mais non accordées,
   *   - le pseudo-motif `UNDECLARED_PERMISSION` (absence de déclaration),
   *   - un motif d'agent `agent-not-allowed:<role>` (autorisation par agent).
   */
  missing: Array<ToolPermission | typeof UNDECLARED_PERMISSION | `${typeof AGENT_NOT_ALLOWED}:${string}`>;
  mode: PermissionMode;
}

/**
 * Marqueur de refus utilisé quand un outil ne déclare AUCUNE permission alors
 * que la politique exige une déclaration explicite (`denyUndeclared`). Ce n'est
 * pas une `ToolPermission` réelle : c'est un pseudo-motif de refus, rangé dans
 * `missing`, qui rend le refus lisible côté audit/UI sans polluer le vocabulaire
 * de permissions.
 */
export const UNDECLARED_PERMISSION = "undeclared" as const;

/**
 * Pseudo-motif de refus émis quand un agent identifié tente d'appeler un outil
 * à risque dont il ne fait pas partie des `allowedAgents`. Rangé dans `missing`
 * (comme `UNDECLARED_PERMISSION`) pour rester lisible côté audit sans polluer le
 * vocabulaire de permissions. La forme concrète est `agent:<role>`.
 */
export const AGENT_NOT_ALLOWED = "agent-not-allowed" as const;

/**
 * Permissions considérées « à risque » pour l'autorisation PAR AGENT.
 *
 * La règle par-agent (allowedAgents) ne s'applique qu'aux outils dont le risque
 * déclaré appartient à cet ensemble. Un outil `read` reste utilisable par tout
 * agent même s'il porte une attribution d'affichage : restreindre la lecture
 * par agent casserait l'exploration/planification sans gain de sécurité.
 */
export const AGENT_RESTRICTED_RISKS: ReadonlySet<ToolPermission> = new Set<ToolPermission>([
  "write",
  "exec",
  "dangerous",
]);

/**
 * Sous-ensemble de l'attribution d'un outil pertinent pour l'AUTORISATION
 * (par opposition à l'attribution d'affichage/télémétrie du toolAgentMapper).
 * Structurellement compatible avec `ToolAttribution` (server/runtime/types.ts).
 */
export interface ToolAgentAuthorization {
  /** Rôles autorisés à invoquer l'outil. Vide/absent = aucune restriction. */
  allowedAgents?: string[];
  /** Risque déclaré : la règle par-agent ne s'applique qu'aux risques restreints. */
  risk?: ToolPermission;
}

export interface PermissionPolicyConfig {
  /** Mode d'application. Défaut : "enforce". */
  mode?: PermissionMode;
  /** Permissions accordées globalement. Défaut : toutes. */
  granted?: ToolPermission[];
  /**
   * Refuse en mode "enforce" tout outil qui ne déclare AUCUNE permission.
   *
   * Défaut : true. C'est la fermeture du « passe-droit permissions vides » :
   * avant, `evaluate([])` retournait `allowed:true` inconditionnellement, si
   * bien qu'un outil à effet de bord dont le nom n'était pas reconnu par
   * l'inférence (donc `permissions: []`) s'exécutait sans le moindre contrôle.
   *
   * La sémantique est alignée sur `DryRunController.hasSideEffect([])` (qui
   * traite déjà « aucune permission » comme un effet de bord potentiel) : en
   * enforce, une déclaration vide est refusée de façon DÉTERMINISTE, quel que
   * soit le jeu accordé (un outil non déclaré ne doit pas passer parce que
   * `write` se trouve accordé). Un outil réellement inoffensif doit déclarer
   * `["read"]` (ou la politique doit être créée avec `denyUndeclared:false`).
   *
   * N'a aucun effet en mode "audit" ou "off" : le comportement historique y
   * est préservé.
   */
  denyUndeclared?: boolean;
  /** EventBus optionnel pour émettre les décisions/refus. */
  eventBus?: EventBus;
  /** Callback appelé à chaque refus (audit, alerte…). */
  onDeny?: (decision: PermissionDecision) => void;
}

/**
 * Politique de permissions appliquée au runtime.
 */
export class PermissionPolicy {
  private mode: PermissionMode;
  private granted: Set<ToolPermission>;
  private readonly denyUndeclared: boolean;
  private readonly eventBus?: EventBus;
  private readonly onDeny?: (decision: PermissionDecision) => void;
  private denials: PermissionDecision[] = [];
  private static readonly MAX_DENIALS = 200;

  constructor(config: PermissionPolicyConfig = {}) {
    this.mode = config.mode ?? "enforce";
    this.granted = new Set(
      normalizePermissions(config.granted ?? [...ALL_PERMISSIONS])
    );
    this.denyUndeclared = config.denyUndeclared ?? true;
    this.eventBus = config.eventBus;
    this.onDeny = config.onDeny;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** Permissions actuellement accordées (forme canonique triée). */
  getGranted(): ToolPermission[] {
    return normalizePermissions([...this.granted]);
  }

  /** Remplace le jeu de permissions accordées. */
  setGranted(permissions: ToolPermission[]): void {
    this.granted = new Set(normalizePermissions(permissions));
  }

  grant(permission: ToolPermission): void {
    for (const p of normalizePermissions([permission])) this.granted.add(p);
  }

  revoke(permission: ToolPermission): void {
    for (const p of normalizePermissions([permission])) this.granted.delete(p);
  }

  isGranted(permission: ToolPermission): boolean {
    return this.granted.has(normalizePermissions([permission])[0]!);
  }

  /**
   * Évalue si un outil peut être appelé compte tenu de ses permissions requises.
   * N'applique aucun effet de bord de refus — voir `enforce()`.
   */
  evaluate(
    toolName: string,
    required: readonly ToolPermission[] | undefined
  ): PermissionDecision {
    const normalized = normalizePermissions(required);

    // Mode "off" : aucune vérification (comportement legacy), y compris pour
    // les outils sans permission déclarée.
    if (this.mode === "off") {
      return { allowed: true, toolName, required: normalized, missing: [], mode: this.mode };
    }

    // Outil SANS permission déclarée.
    //
    // Auparavant : `allowed:true` inconditionnel — c'était le passe-droit qui
    // laissait passer un outil à effet de bord dont le nom n'était pas reconnu
    // par l'inférence (SkillAdapter.inferPermissions → []). Désormais, en mode
    // "enforce" et si `denyUndeclared` est actif (défaut), on REFUSE de façon
    // déterministe, indépendamment du jeu accordé. En "audit", on laisse passer
    // mais on signale le motif `undeclared` (journalisé par enforce()).
    if (normalized.length === 0) {
      if (this.mode === "enforce" && this.denyUndeclared) {
        return {
          allowed: false,
          toolName,
          required: normalized,
          missing: [UNDECLARED_PERMISSION],
          mode: this.mode,
        };
      }
      const flagged = this.mode === "audit" && this.denyUndeclared;
      return {
        allowed: true,
        toolName,
        required: normalized,
        missing: flagged ? [UNDECLARED_PERMISSION] : [],
        mode: this.mode,
      };
    }

    const missing = normalized.filter((p) => !this.granted.has(p));
    const allowed = this.mode === "audit" ? true : missing.length === 0;

    return { allowed, toolName, required: normalized, missing, mode: this.mode };
  }

  /**
   * Applique la politique : émet les événements/callbacks et journalise les refus.
   * Retourne la décision. En mode "enforce", `allowed=false` doit conduire
   * l'appelant à lever une erreur de permission.
   */
  enforce(
    toolName: string,
    required: readonly ToolPermission[] | undefined,
    agentId?: string,
    attribution?: ToolAgentAuthorization
  ): PermissionDecision {
    // 1. Autorisation de base : permissions requises vs jeu accordé (+ undeclared).
    let decision = this.evaluate(toolName, required);

    // 2. Autorisation PAR AGENT (chantier C). Ne s'applique QUE si :
    //    - la décision de base est passante (on n'écrase pas un refus existant),
    //    - un agentId est fourni (rétro-compatibilité : les appelants directs
    //      sans agent ne sont pas soumis à cette règle),
    //    - l'outil déclare des allowedAgents ET un risque restreint.
    if (decision.allowed && agentId) {
      const agentDenial = this.evaluateAgent(toolName, decision, agentId, attribution);
      if (agentDenial) decision = agentDenial;
    }

    if (decision.missing.length > 0) {
      // Refus (enforce) ou simple avertissement (audit).
      this.recordDenial(decision);
      this.onDeny?.(decision);

      if (this.mode === "audit") {
        console.warn(
          `[PermissionPolicy] AUDIT — outil "${toolName}" utilise ` +
            `[${decision.missing.join(", ")}] non accordé(s)` +
            (agentId ? ` (agent: ${agentId})` : "")
        );
      }

      this.eventBus?.emit({
        type: "tool:permissionDenied",
        toolName,
        required: decision.required,
        missing: decision.missing,
        mode: this.mode,
        enforced: this.mode === "enforce",
        agentId,
      });
    }

    return decision;
  }

  /**
   * Contrôle d'autorisation PAR AGENT (chantier C).
   *
   * Retourne une décision de refus si l'agent `agentId` n'est pas autorisé à
   * invoquer l'outil `toolName` compte tenu de son attribution ; sinon
   * `undefined` (aucun changement à la décision de base).
   *
   * Règles :
   *   - Sans `allowedAgents` (vide/absent), aucune restriction par agent.
   *   - La restriction ne s'applique qu'aux outils dont le `risk` est dans
   *     AGENT_RESTRICTED_RISKS (write/exec/dangerous). Un outil de lecture reste
   *     libre pour tout agent.
   *   - En mode "enforce", un agent hors liste est REFUSÉ. En "audit", la
   *     décision reste passante mais le motif `agent:<role>` est signalé (pour
   *     l'observabilité) ; en "off", aucun contrôle.
   */
  private evaluateAgent(
    toolName: string,
    base: PermissionDecision,
    agentId: string,
    attribution?: ToolAgentAuthorization
  ): PermissionDecision | undefined {
    if (this.mode === "off") return undefined;

    const allowed = (attribution?.allowedAgents ?? []).filter(Boolean);
    if (allowed.length === 0) return undefined;

    const risk = attribution?.risk;
    if (!risk || !AGENT_RESTRICTED_RISKS.has(risk)) return undefined;

    if (allowed.includes(agentId)) return undefined;

    const reason = `${AGENT_NOT_ALLOWED}:${agentId}` as const;
    // En audit, on laisse passer mais on marque le motif ; en enforce, refus.
    return {
      allowed: this.mode === "audit",
      toolName,
      required: base.required,
      missing: [...base.missing, reason],
      mode: this.mode,
    };
  }

  /** Historique des refus récents (pour l'UI d'audit). */
  getDenials(limit = 50): PermissionDecision[] {
    return this.denials.slice(-limit);
  }

  private recordDenial(decision: PermissionDecision): void {
    this.denials.push(decision);
    if (this.denials.length > PermissionPolicy.MAX_DENIALS) {
      this.denials.splice(0, this.denials.length - PermissionPolicy.MAX_DENIALS);
    }
  }

  // ─── Fabrique depuis l'environnement ─────────────────────────────────────

  /**
   * Construit une politique depuis les variables d'environnement :
   *   - Leanna_PERMISSION_MODE   : enforce | audit | off (défaut: enforce)
   *   - Leanna_GRANTED_PERMISSIONS : liste CSV (ex: "read,write,network")
   *                                  défaut : toutes les permissions
   */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    extra: Omit<PermissionPolicyConfig, "mode" | "granted"> = {}
  ): PermissionPolicy {
    const rawMode = (env.Leanna_PERMISSION_MODE ?? "enforce").toLowerCase();
    const mode: PermissionMode =
      rawMode === "off" || rawMode === "audit" || rawMode === "enforce"
        ? (rawMode as PermissionMode)
        : "enforce";

    const rawGranted = env.Leanna_GRANTED_PERMISSIONS?.trim();
    const granted = rawGranted
      ? (rawGranted
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean) as ToolPermission[])
      : [...ALL_PERMISSIONS];

    return new PermissionPolicy({ mode, granted, ...extra });
  }
}

/**
 * Erreur levée quand un outil réclame une permission non accordée
 * par la politique runtime (mode "enforce").
 */
export class PermissionDeniedError extends Error {
  public readonly toolName: string;
  public readonly missing: PermissionDecision["missing"];
  public readonly required: ToolPermission[];

  constructor(decision: PermissionDecision) {
    const undeclared = decision.missing.includes(UNDECLARED_PERMISSION);
    const agentReason = decision.missing.find(
      (m): m is `${typeof AGENT_NOT_ALLOWED}:${string}` =>
        typeof m === "string" && m.startsWith(`${AGENT_NOT_ALLOWED}:`)
    );
    let message: string;
    if (agentReason) {
      const role = agentReason.slice(AGENT_NOT_ALLOWED.length + 1);
      message =
        `Permission refusée pour l'outil "${decision.toolName}" : l'agent "${role}" ` +
        `n'est pas autorisé à invoquer cet outil à risque (voir attribution.allowedAgents).`;
    } else if (undeclared) {
      message =
        `Permission refusée pour l'outil "${decision.toolName}" : aucune permission ` +
        `déclarée (outil traité comme effet de bord potentiel par la politique runtime ` +
        `en mode "enforce"). Déclarez ses permissions (ex: ["read"]) ou désactivez ` +
        `denyUndeclared.`;
    } else {
      message =
        `Permission refusée pour l'outil "${decision.toolName}" : ` +
        `permission(s) [${decision.missing.join(", ")}] non accordée(s) par la politique runtime.`;
    }
    super(message);
    this.name = "PermissionDeniedError";
    this.toolName = decision.toolName;
    this.missing = decision.missing;
    this.required = decision.required;
  }
}
