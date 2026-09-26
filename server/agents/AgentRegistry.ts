/**
 * AgentRegistry — Registre global des agents autonomes actifs
 *
 * Gère le cycle de vie des instances AutonomousAgent et fournit
 * une interface unifiée pour :
 * - Lookup d'un agent par rôle
 * - Démarrage / arrêt d'agents
 * - Monitoring de l'état de santé de la flotte
 * - Sélection d'un agent disponible (load balancing)
 */
import type { AgentRole } from "./types.js";
import type { SkillHandler } from "./AgentExecutor.js";
import type { AgentTaskRunner } from "./AgentTaskRunner.js";
import { AutonomousAgent } from "./AutonomousAgent.js";
import type { LoopConfig } from "./AutonomousLoop.js";
import { AgentExecutor } from "./AgentExecutor.js";
import { AgentMessageBus, agentMessageBus } from "./AgentMessageBus.js";
import { ProgressNotifier } from "./ProgressNotifier.js";
import { STATIC_AGENT_REGISTRY, listAgentRoles } from "./roles.js";
import { dynamicAgentRegistry } from "./DynamicAgentRegistry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AgentRegistry");

// ═══════════════════════════════════════════════════════════════════════════════
// AgentRegistry
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentRegistry {
  private agents: Map<AgentRole, AutonomousAgent> = new Map();
  private notifier: ProgressNotifier;
  private executor: AgentExecutor;
  /**
   * Moteur d'exécution ACTIF partagé par tous les agents autonomes. Par défaut
   * l'exécuteur legacy ; remplacé par le runtime agentique via `setRunner()`
   * au bootstrap. Les agents déjà démarrés ne sont pas recréés — seuls les
   * agents créés APRÈS le swap utilisent le nouveau moteur (voir setRunner).
   */
  private runner: AgentTaskRunner;
  private bus: AgentMessageBus;
  private initialized = false;
  /** Config de boucle mémorisée par rôle, pour recréer à l'identique au swap de moteur. */
  private loopConfigByRole = new Map<AgentRole, Partial<LoopConfig>>();

  constructor(bus: AgentMessageBus = agentMessageBus) {
    this.bus = bus;
    this.notifier = new ProgressNotifier();
    this.executor = new AgentExecutor(this.notifier);
    this.runner = this.executor;
  }

  /** Retourne le ProgressNotifier partagé (pour brancher un runtime agentique). */
  getNotifier(): ProgressNotifier {
    return this.notifier;
  }

  /** Nombre de tâches actives (en cours + en file) sur toute la flotte. */
  private activeWorkCount(): number {
    let total = 0;
    for (const agent of this.agents.values()) {
      const stats = agent.getStats();
      total += (stats.runningTasks ?? 0) + (stats.queuedTasks ?? 0);
    }
    return total;
  }

  /**
   * Bascule le moteur d'exécution des agents autonomes vers un autre moteur
   * (typiquement le runtime agentique). Conçu pour le BOOTSTRAP : appelé avant
   * qu'aucune mission ne tourne, il redéploie la flotte sur le nouveau moteur en
   * conservant les configs de boucle par rôle.
   *
   * GARDE-FOU : si des tâches sont en cours ou en file, la bascule est REFUSÉE
   * (retourne `false`) au lieu de tuer silencieusement des missions actives.
   * Utiliser `options.allowRestart = true` pour forcer explicitement (réservé
   * aux cas maîtrisés). Un vrai swap à chaud (drain → stop → deploy → resume)
   * est un travail de production ultérieur (`swapRunner`).
   *
   * @returns `true` si la bascule a été appliquée, `false` si refusée.
   */
  setRunner(runner: AgentTaskRunner, options: { allowRestart?: boolean } = {}): boolean {
    // Aucun agent démarré encore → simple affectation (chemin bootstrap idéal).
    if (this.agents.size === 0) {
      this.runner = runner;
      return true;
    }

    const active = this.activeWorkCount();
    if (active > 0 && options.allowRestart !== true) {
      log.warn(
        `⛔ setRunner refusé — ${active} tâche(s) active(s)/en file. ` +
        `La bascule tuerait des missions en cours. Réessayez à l'arrêt, ou passez allowRestart:true en connaissance de cause.`
      );
      return false;
    }

    this.runner = runner;
    log.info(
      `🔁 Bascule du moteur d'exécution — redémarrage de la flotte sur le nouveau moteur` +
      (active > 0 ? ` (allowRestart forcé, ${active} tâche(s) interrompue(s))` : "")
    );
    const roles = [...this.agents.keys()];
    // Arrêt sans réinitialiser le flag ni les configs mémorisées.
    for (const agent of this.agents.values()) agent.stop();
    this.agents.clear();
    // Recrée chaque agent sur le nouveau moteur, en conservant sa config de boucle.
    for (const role of roles) {
      const agent = new AutonomousAgent(role, this.runner, this.bus, this.loopConfigByRole.get(role));
      this.agents.set(role, agent);
      agent.start();
    }
    return true;
  }

  // ─── Initialisation ────────────────────────────────────────────────────────

  /**
   * Initialise et démarre tous les agents.
   * Doit être appelé après la configuration du SkillHandler.
   */
  initialize(skillHandler: SkillHandler): void {
    if (this.initialized) {
      log.warn("AgentRegistry déjà initialisé — skip");
      return;
    }

    this.executor.setSkillHandler(skillHandler);

    // Config de boucle autonome par rôle (les agents read-only itèrent moins)
    const loopConfigByRole: Record<string, { maxIterations: number; minConfidenceScore: number }> = {
      // Code & Ingénierie logicielle
      coder:       { maxIterations: 3, minConfidenceScore: 0.70 }, // écriture & implémentation
      refactor:    { maxIterations: 3, minConfidenceScore: 0.70 }, // restructuration & non-régression
      debugger:    { maxIterations: 3, minConfidenceScore: 0.70 }, // diagnostic & patch
      reviewer:    { maxIterations: 1, minConfidenceScore: 0.50 }, // read-only audit
      tester:      { maxIterations: 3, minConfidenceScore: 0.65 }, // création & exécution de tests
      security:    { maxIterations: 1, minConfidenceScore: 0.50 }, // read-only sécurité
      architect:   { maxIterations: 2, minConfidenceScore: 0.65 }, // conception & structuration
      // Rédaction & Documentation
      writer:      { maxIterations: 3, minConfidenceScore: 0.65 },
      formatter:   { maxIterations: 2, minConfidenceScore: 0.60 },
      researcher:  { maxIterations: 1, minConfidenceScore: 0.50 }, // read-only recherche
      proofreader: { maxIterations: 2, minConfidenceScore: 0.65 },
      translator:  { maxIterations: 2, minConfidenceScore: 0.65 },
      summarizer:  { maxIterations: 2, minConfidenceScore: 0.60 },
      planner:     { maxIterations: 2, minConfidenceScore: 0.65 },
    };

    // Créer et démarrer un agent autonome pour chaque rôle défini (statiques + dynamiques)
    const allRoles = listAgentRoles();
    for (const role of allRoles) {
      const loopConfig = loopConfigByRole[role] ?? { maxIterations: 2, minConfidenceScore: 0.60 };
      this.loopConfigByRole.set(role as AgentRole, loopConfig);
      const agent = new AutonomousAgent(role as AgentRole, this.runner, this.bus, loopConfig);
      this.agents.set(role as AgentRole, agent);
      agent.start();
    }

    this.initialized = true;
    log.info(
      `✅ AgentRegistry initialisé avec ${this.agents.size} agent(s): ${[...this.agents.keys()].join(", ")}`
    );
  }

  /**
   * Arrête tous les agents proprement.
   */
  shutdown(): void {
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    this.agents.clear();
    this.initialized = false;
    log.info("AgentRegistry arrêté");
  }

  // ─── Accès aux agents ──────────────────────────────────────────────────────

  /**
   * Retourne l'agent pour un rôle donné.
   * @throws Si le registre n'est pas initialisé ou le rôle inconnu.
   */
  getAgent(role: AgentRole): AutonomousAgent {
    const agent = this.agents.get(role);
    if (!agent) {
      throw new Error(
        `Agent "${role}" introuvable dans le registre. Avez-vous appelé initialize() ?`
      );
    }
    return agent;
  }

  /**
   * Retourne tous les agents disponibles (non surchargés).
   */
  getAvailableAgents(): AutonomousAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.isAvailable);
  }

  /**
   * Retourne l'agent le moins chargé pour un rôle donné.
   * Utile pour le load balancing si plusieurs instances existaient.
   */
  getLeastLoadedAgent(role: AgentRole): AutonomousAgent {
    return this.getAgent(role); // Extension future: plusieurs instances par rôle
  }

  /**
   * Vérifie si un agent est disponible.
   */
  isAgentAvailable(role: AgentRole): boolean {
    return this.agents.get(role)?.isAvailable ?? false;
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  /** Propage le ProgressCallback à tous les agents */
  setProgressCallback(callback: Parameters<ProgressNotifier["setProgressCallback"]>[0]): void {
    this.notifier.setProgressCallback(callback);
  }

  /** Propage l'EventBroadcaster à tous les agents */
  setEventBroadcaster(broadcaster: Parameters<ProgressNotifier["setEventBroadcaster"]>[0]): void {
    this.notifier.setEventBroadcaster(broadcaster);
  }

  // ─── Enregistrement dynamique d'agents ────────────────────────────────────────

  /**
   * Enregistre et démarre un nouvel agent dynamique.
   * Peut être appelé après l'initialisation pour ajouter des agents créés via l'Agent Builder.
   * 
   * @param role - Rôle de l'agent
   * @param loopConfig - Configuration optionnelle de la boucle autonome
   * @returns true si l'agent a été enregistré et démarré, false s'il existait déjà
   */
  registerAndStartDynamicAgent(
    role: string,
    loopConfig?: { maxIterations: number; minConfidenceScore: number }
  ): boolean {
    // Vérifier si l'agent existe déjà (statique ou dynamique)
    if (this.agents.has(role as AgentRole)) {
      log.warn(`Agent "${role}" déjà démarré — skip`);
      return false;
    }

    const config = loopConfig ?? { maxIterations: 2, minConfidenceScore: 0.60 };
    this.loopConfigByRole.set(role as AgentRole, config);
    const agent = new AutonomousAgent(role as AgentRole, this.runner, this.bus, config);
    this.agents.set(role as AgentRole, agent);
    agent.start();

    log.info(`✅ Agent dynamique "${role}" démarré avec config: ${JSON.stringify(config)}`);
    return true;
  }

  /**
   * Enregistre et démarre plusieurs agents dynamiques.
   */
  registerAndStartDynamicAgents(
    roles: string[],
    loopConfigByRole?: Record<string, { maxIterations: number; minConfidenceScore: number }>
  ): { succeeded: string[]; failed: string[] } {
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const role of roles) {
      const config = loopConfigByRole?.[role];
      if (this.registerAndStartDynamicAgent(role, config)) {
        succeeded.push(role);
      } else {
        failed.push(role);
      }
    }

    return { succeeded, failed };
  }

  /**
   * Arrête et désenregistre un agent dynamique.
   * Ne peut pas désenregistrer les agents statiques.
   */
  unregisterDynamicAgent(role: string): boolean {
    const roleKey = role as AgentRole;
    
    // Ne pas supprimer les agents statiques
    if (role in STATIC_AGENT_REGISTRY) {
      log.warn(`Impossible de désenregistrer l'agent statique "${role}"`);
      return false;
    }

    const agent = this.agents.get(roleKey);
    if (!agent) {
      return false;
    }

    agent.stop();
    this.agents.delete(roleKey);
    
    // Also remove from dynamic registry
    dynamicAgentRegistry.unregisterAgent(role);
    
    log.info(`🗑️ Agent dynamique "${role}" arrêté et désenregistré`);
    return true;
  }

  // ─── Monitoring ────────────────────────────────────────────────────────────

  /** Snapshot d'état de la flotte d'agents */
  getFleetStatus(): {
    totalAgents: number;
    onlineAgents: number;
    idleAgents: number;
    busyAgents: number;
    overloadedAgents: number;
    agents: ReturnType<AutonomousAgent["getStats"]>[];
    busMetrics: ReturnType<AgentMessageBus["getMetrics"]>;
  } {
    const agentStats = Array.from(this.agents.values()).map((a) => a.getStats());

    return {
      totalAgents: agentStats.length,
      onlineAgents: agentStats.filter((a) => a.isOnline).length,
      idleAgents: agentStats.filter((a) => a.status === "idle").length,
      busyAgents: agentStats.filter((a) => a.status === "busy").length,
      overloadedAgents: agentStats.filter((a) => a.status === "overloaded").length,
      agents: agentStats,
      busMetrics: this.bus.getMetrics(),
    };
  }

  get isReady(): boolean {
    return this.initialized;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const agentRegistry = new AgentRegistry(agentMessageBus);
