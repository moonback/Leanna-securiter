/**
 * RedisEventBridge — pont optionnel EventBus ↔ Redis Streams (multi-process).
 *
 * Objectif : rendre l'`EventBus` in-process effectivement multi-processus et
 * durable, SANS réécrire son cœur ni changer son comportement local. Le pont :
 *
 *  1. Publie chaque événement local sur un Redis Stream (`XADD`), avec l'id de
 *     l'instance émettrice et l'événement sérialisé.
 *  2. Consomme le stream en tâche de fond (`XREAD BLOCK`) et ré-émet localement
 *     les événements provenant des AUTRES instances.
 *
 * Sans `REDIS_URL` (ou `LEANNA_EVENTBUS_REDIS_URL`), `start()` est un no-op :
 * le bus reste strictement in-process, exactement comme avant. Le pont dégrade
 * donc proprement, comme les autres intégrations optionnelles.
 *
 * Prévention des boucles (essentiel) :
 *  - Chaque instance a un `instanceId` unique. Le consommateur ignore les
 *    entrées émises par sa propre instance (elles sont déjà locales).
 *  - Les événements ré-émis localement par le pont sont marqués dans un WeakSet ;
 *    le publieur (`onAny`) ignore ces événements marqués et ne les republie donc
 *    jamais sur le stream. Sans ce garde, un événement étranger ré-émis serait
 *    aussitôt republié → boucle infinie entre instances.
 *
 * Le client Redis est importé paresseusement et réutilise le même schéma de
 * connexion + backoff que KnowledgeGraphCache / DistributedLock : aucune
 * nouvelle dépendance, aucun effet de bord à l'import.
 */
import { randomUUID } from "crypto";
import type { EventBus } from "./EventBus.js";
import type { RuntimeEvent } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("RedisEventBridge");

function getRedisUrl(): string | undefined {
  return process.env.LEANNA_EVENTBUS_REDIS_URL || process.env.REDIS_URL;
}

function getStreamKey(): string {
  return process.env.LEANNA_EVENTBUS_STREAM || "leanna:eventbus";
}

function getMaxLen(): number {
  const n = Number(process.env.LEANNA_EVENTBUS_MAXLEN);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

/** Enveloppe sérialisée d'un événement sur le stream. */
export interface WireEnvelope {
  instanceId: string;
  event: RuntimeEvent;
}

/**
 * Sérialise un événement runtime en champs de stream Redis. Exporté pour être
 * testable indépendamment d'une connexion Redis vivante.
 */
export function serializeEvent(instanceId: string, event: RuntimeEvent): Record<string, string> {
  return { instanceId, type: event.type, payload: JSON.stringify(event) };
}

/**
 * Désérialise une entrée de stream. Retourne null si l'entrée est illisible
 * (jamais throw : une entrée corrompue ne doit pas casser le consommateur).
 */
export function deserializeEnvelope(fields: Record<string, string>): WireEnvelope | null {
  try {
    if (!fields.instanceId || !fields.payload) return null;
    const event = JSON.parse(fields.payload) as RuntimeEvent;
    if (!event || typeof event.type !== "string") return null;
    return { instanceId: fields.instanceId, event };
  } catch {
    return null;
  }
}

export class RedisEventBridge {
  readonly instanceId = randomUUID();

  private publishClient: any = null;
  private consumeClient: any = null;
  private connectPromise: Promise<any> | null = null;
  private redisDisabledUntil = 0;
  private unsubscribe: (() => void) | null = null;
  private consuming = false;
  private lastId = "$"; // "$" = uniquement les nouveaux événements après connexion
  /** Événements ré-émis par le pont : ne jamais les republier (anti-boucle). */
  private readonly injected = new WeakSet<object>();
  private started = false;

  constructor(private readonly bus: EventBus) {}

  /** True si un backend Redis Streams est actif (bus réellement multi-process). */
  get isConnected(): boolean {
    return Boolean(this.publishClient?.isReady);
  }

  private async getPublishClient(): Promise<any | null> {
    const url = getRedisUrl();
    if (!url) return null;
    if (Date.now() < this.redisDisabledUntil) return null;
    if (this.publishClient?.isReady) return this.publishClient;
    if (!this.connectPromise) {
      this.connectPromise = import("redis")
        .then(async ({ createClient }) => {
          const pub = createClient({ url });
          pub.on("error", (error: Error) => log.warn(`Redis EventBus (pub) indisponible: ${error.message}`));
          await pub.connect();
          // Connexion dédiée pour la lecture bloquante (XREAD BLOCK) afin de ne
          // pas bloquer les publications.
          const sub = pub.duplicate();
          sub.on("error", (error: Error) => log.warn(`Redis EventBus (sub) indisponible: ${error.message}`));
          await sub.connect();
          this.publishClient = pub;
          this.consumeClient = sub;
          return pub;
        })
        .catch((error) => {
          this.redisDisabledUntil = Date.now() + 30_000;
          log.warn(`Connexion Redis EventBus impossible (bus reste in-process): ${(error as Error).message}`);
          return null;
        })
        .finally(() => { this.connectPromise = null; });
    }
    return this.connectPromise;
  }

  /**
   * Démarre le pont. No-op si Redis n'est pas configuré (le bus reste
   * in-process). Sûr à appeler plusieurs fois.
   */
  async start(): Promise<void> {
    if (this.started) return;
    if (!getRedisUrl()) return; // dégradation propre : aucun backend

    const client = await this.getPublishClient();
    if (!client) return;

    this.started = true;

    // 1. Publier chaque événement local sur le stream (sauf ceux injectés par
    //    le pont lui-même : ils viennent déjà d'une autre instance).
    this.unsubscribe = this.bus.onAny((event) => {
      if (this.injected.has(event as unknown as object)) return;
      void this.publish(event);
    });

    // 2. Consommer le stream en tâche de fond.
    this.consuming = true;
    void this.consumeLoop();
    log.info(`EventBus Redis Streams actif (instance ${this.instanceId.slice(0, 8)}, stream ${getStreamKey()}).`);
  }

  private async publish(event: RuntimeEvent): Promise<void> {
    const client = await this.getPublishClient();
    if (!client) return;
    try {
      await client.xAdd(
        getStreamKey(),
        "*",
        serializeEvent(this.instanceId, event),
        { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: getMaxLen() } },
      );
    } catch (error) {
      log.warn(`Publication EventBus échouée: ${(error as Error).message}`);
    }
  }

  private async consumeLoop(): Promise<void> {
    while (this.consuming) {
      const client = this.consumeClient;
      if (!client?.isReady) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      try {
        // Lecture bloquante : rend la main sans busy-loop tant qu'aucun
        // événement n'arrive. BLOCK 5000ms permet de vérifier régulièrement
        // le flag `consuming` pour un arrêt propre.
        const response = await client.xRead(
          { key: getStreamKey(), id: this.lastId },
          { BLOCK: 5_000, COUNT: 100 },
        );
        if (!response) continue; // timeout BLOCK → reboucle

        for (const stream of response) {
          for (const entry of stream.messages) {
            this.lastId = entry.id;
            this.handleEntry(entry.message as Record<string, string>);
          }
        }
      } catch (error) {
        if (!this.consuming) break;
        log.warn(`Lecture EventBus échouée (retry): ${(error as Error).message}`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  private handleEntry(fields: Record<string, string>): void {
    const envelope = deserializeEnvelope(fields);
    if (!envelope) return;
    // Ignorer nos propres événements : ils ont déjà été dispatchés localement.
    if (envelope.instanceId === this.instanceId) return;
    // Marquer l'événement AVANT de l'émettre pour que le publieur onAny ne le
    // republie pas sur le stream (anti-boucle).
    this.injected.add(envelope.event as unknown as object);
    try {
      this.bus.emit(envelope.event);
    } catch (error) {
      log.warn(`Ré-émission EventBus échouée: ${(error as Error).message}`);
    }
  }

  /** Arrête le pont et ferme les connexions Redis. Sûr à appeler plusieurs fois. */
  async stop(): Promise<void> {
    this.consuming = false;
    this.started = false;
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    for (const client of [this.consumeClient, this.publishClient]) {
      if (client?.isOpen) {
        try { await client.quit(); } catch { /* ignore */ }
      }
    }
    this.consumeClient = null;
    this.publishClient = null;
  }
}
