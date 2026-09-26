/**
 * EventBus — Bus d'événements léger et typé
 * 
 * Remplace le AgentMessageBus surdimensionné par un EventEmitter typé minimal.
 * Pas de dead-letter queue, pas de retry réseau — c'est du intra-process.
 * 
 * Fonctionnalités :
 * - Pub/Sub typé par événement
 * - Wildcard listener (*)
 * - Métriques simples (compteurs)
 * - Middleware pipeline (optional)
 * - Aucune dépendance externe
 */

import type { RuntimeEvent, RuntimeEventType, RuntimeEventHandler } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

type Handler = (event: RuntimeEvent) => void;
type Middleware = (event: RuntimeEvent, next: () => void) => void;

interface Subscription {
  id: number;
  eventType: RuntimeEventType | "*";
  handler: Handler;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EventBus
// ═══════════════════════════════════════════════════════════════════════════════

export class EventBus {
  private subscriptions: Subscription[] = [];
  private middlewares: Middleware[] = [];
  private nextId = 0;
  private metrics = new Map<string, number>();

  /**
   * Abonnement à un type d'événement.
   * Retourne une fonction de désabonnement.
   */
  on<T extends RuntimeEventType>(
    eventType: T,
    handler: RuntimeEventHandler<T>
  ): () => void {
    const id = this.nextId++;
    this.subscriptions.push({
      id,
      eventType,
      handler: handler as Handler,
    });
    return () => this.off(id);
  }

  /**
   * Abonnement à TOUS les événements (wildcard).
   */
  onAny(handler: (event: RuntimeEvent) => void): () => void {
    const id = this.nextId++;
    this.subscriptions.push({ id, eventType: "*", handler });
    return () => this.off(id);
  }

  /**
   * Abonnement one-shot : se désabonne après la première réception.
   */
  once<T extends RuntimeEventType>(
    eventType: T,
    handler: RuntimeEventHandler<T>
  ): () => void {
    const unsub = this.on(eventType, (event) => {
      unsub();
      handler(event);
    });
    return unsub;
  }

  /**
   * Émet un événement à tous les listeners concernés.
   * Passe par le pipeline de middlewares d'abord.
   */
  emit(event: RuntimeEvent): void {
    // Métriques
    const count = this.metrics.get(event.type) ?? 0;
    this.metrics.set(event.type, count + 1);

    // Pipeline middleware
    if (this.middlewares.length > 0) {
      this.runMiddlewares(event, 0, () => this.dispatch(event));
    } else {
      this.dispatch(event);
    }
  }

  /**
   * Ajoute un middleware au pipeline.
   * Les middlewares s'exécutent dans l'ordre d'ajout.
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Retourne les métriques d'événements (compteurs par type).
   */
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  /**
   * Nombre total de subscriptions actives.
   */
  get subscriberCount(): number {
    return this.subscriptions.length;
  }

  /**
   * Reset complet (utile pour les tests).
   */
  reset(): void {
    this.subscriptions = [];
    this.middlewares = [];
    this.metrics.clear();
    this.nextId = 0;
  }

  // ─── Privé ───────────────────────────────────────────────────────────────

  private off(id: number): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
  }

  private dispatch(event: RuntimeEvent): void {
    for (const sub of this.subscriptions) {
      if (sub.eventType === "*" || sub.eventType === event.type) {
        try {
          sub.handler(event);
        } catch (err) {
          // Ne jamais bloquer le bus à cause d'un handler défaillant
          console.error(`[EventBus] Handler error for "${event.type}":`, err);
        }
      }
    }
  }

  private runMiddlewares(event: RuntimeEvent, index: number, done: () => void): void {
    if (index >= this.middlewares.length) {
      done();
      return;
    }
    const middleware = this.middlewares[index];
    middleware(event, () => this.runMiddlewares(event, index + 1, done));
  }
}
