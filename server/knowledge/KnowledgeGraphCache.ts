import crypto from "crypto";
import type { KnowledgeGraphState } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("KnowledgeGraphCache");
const memoryCache = new Map<string, KnowledgeGraphState>();
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function getRedisUrl(): string | undefined {
  return process.env.LEANNA_KNOWLEDGE_REDIS_URL || process.env.REDIS_URL;
}

function getTtlSeconds(): number {
  const configured = Number(process.env.LEANNA_KNOWLEDGE_CACHE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_SECONDS;
}

function cacheKey(projectRoot: string): string {
  const digest = crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0, 32);
  return `leanna:knowledge-graph:${digest}`;
}

export class KnowledgeGraphCache {
  private redisClient: any = null;
  private redisConnectPromise: Promise<any> | null = null;
  private redisDisabledUntil = 0;

  private async getRedisClient(): Promise<any | null> {
    const url = getRedisUrl();
    if (!url) return null;
    if (Date.now() < this.redisDisabledUntil) return null;
    if (this.redisClient?.isReady) return this.redisClient;
    if (!this.redisConnectPromise) {
      this.redisConnectPromise = import("redis")
        .then(({ createClient }) => {
          const client = createClient({ url });
          client.on("error", (error: Error) => log.warn(`Redis KnowledgeGraph indisponible: ${error.message}`));
          return client.connect().then(() => {
            this.redisClient = client;
            return client;
          });
        })
        .catch((error) => {
          this.redisDisabledUntil = Date.now() + 30_000;
          log.warn(`Connexion Redis KnowledgeGraph impossible: ${(error as Error).message}`);
          return null;
        })
        .finally(() => { this.redisConnectPromise = null; });
    }
    return this.redisConnectPromise;
  }

  async get(projectRoot: string): Promise<KnowledgeGraphState | null> {
    const key = cacheKey(projectRoot);
    const local = memoryCache.get(key);
    const client = await this.getRedisClient();
    if (!client) return local ? structuredClone(local) : null;

    try {
      const raw = await client.get(key);
      if (!raw) return local ? structuredClone(local) : null;
      const parsed = JSON.parse(raw) as KnowledgeGraphState;
      memoryCache.set(key, parsed);
      return structuredClone(parsed);
    } catch (error) {
      log.warn(`Lecture cache KnowledgeGraph échouée: ${(error as Error).message}`);
      return local ? structuredClone(local) : null;
    }
  }

  async set(projectRoot: string, state: KnowledgeGraphState): Promise<void> {
    const key = cacheKey(projectRoot);
    const snapshot = structuredClone(state);
    memoryCache.set(key, snapshot);
    const client = await this.getRedisClient();
    if (!client) return;

    try {
      await client.set(key, JSON.stringify(snapshot), { EX: getTtlSeconds() });
    } catch (error) {
      log.warn(`Écriture cache KnowledgeGraph échouée: ${(error as Error).message}`);
    }
  }

  async invalidate(projectRoot: string): Promise<void> {
    const key = cacheKey(projectRoot);
    memoryCache.delete(key);
    const client = await this.getRedisClient();
    if (!client) return;
    try { await client.del(key); } catch { /* Redis reste optionnel */ }
  }

  async close(): Promise<void> {
    if (this.redisClient?.isOpen) await this.redisClient.quit();
    this.redisClient = null;
  }
}

export const knowledgeGraphCache = new KnowledgeGraphCache();
