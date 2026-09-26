/**
 * DistributedLock — verrou mutuel optionnellement distribué (Redis).
 *
 * Objectif : permettre à un travail sensible au multi-instance (par ex. un
 * scheduler autonome, une reprise de tâches) de ne s'exécuter que sur un seul
 * processus à la fois, condition nécessaire pour lever la contrainte « une seule
 * instance PM2 » documentée dans AUTONOMY.md.
 *
 * Conception :
 * - Backend Redis quand `REDIS_URL` (ou `LEANNA_LOCK_REDIS_URL`) est configuré :
 *   acquisition via `SET key token NX PX ttl`, libération via un script Lua
 *   compare-and-delete (on ne supprime que SI le token nous appartient, pour ne
 *   jamais libérer le verrou d'un autre détenteur après expiration/renouvellement).
 * - Repli in-process (Map avec expiration) quand Redis est absent : le verrou
 *   reste correct au sein d'un même processus. Le comportement dégrade donc
 *   proprement, comme les autres intégrations optionnelles (Supabase, cache).
 *
 * Le client Redis est importé paresseusement et réutilise exactement le même
 * schéma de connexion + backoff que KnowledgeGraphCache : aucune nouvelle
 * dépendance, aucun effet de bord à l'import.
 */
import { randomUUID } from "crypto";
import { createLogger } from "./logger.js";

const log = createLogger("DistributedLock");

/** Script Lua : ne supprime la clé que si sa valeur correspond au token fourni. */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Script Lua : ne prolonge le TTL que si le token nous appartient encore. */
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end`;

function getRedisUrl(): string | undefined {
  return process.env.LEANNA_LOCK_REDIS_URL || process.env.REDIS_URL;
}

export interface AcquireOptions {
  /** Durée de vie du verrou en ms (auto-expiration anti-deadlock). Défaut : 30000. */
  ttlMs?: number;
  /**
   * Attente maximale pour obtenir le verrou en ms. 0 = tentative unique
   * (non bloquant). Défaut : 0.
   */
  waitMs?: number;
  /** Intervalle entre deux tentatives d'acquisition en ms. Défaut : 100. */
  retryDelayMs?: number;
}

/** Handle d'un verrou détenu. Toujours appeler `release()` (via `withLock` de préférence). */
export interface LockHandle {
  readonly key: string;
  readonly token: string;
  /** Prolonge le TTL du verrou si toujours détenu. Retourne false si perdu. */
  renew(ttlMs?: number): Promise<boolean>;
  /** Libère le verrou (compare-and-delete). Idempotent. */
  release(): Promise<void>;
}

// ── Repli in-process ─────────────────────────────────────────────────────────

interface LocalEntry { token: string; expiresAt: number; }
const localLocks = new Map<string, LocalEntry>();

function localAcquire(key: string, token: string, ttlMs: number): boolean {
  const existing = localLocks.get(key);
  if (existing && existing.expiresAt > Date.now()) return false;
  localLocks.set(key, { token, expiresAt: Date.now() + ttlMs });
  return true;
}

function localRelease(key: string, token: string): void {
  const existing = localLocks.get(key);
  if (existing && existing.token === token) localLocks.delete(key);
}

function localRenew(key: string, token: string, ttlMs: number): boolean {
  const existing = localLocks.get(key);
  if (existing && existing.token === token && existing.expiresAt > Date.now()) {
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }
  return false;
}

// ── Manager ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DistributedLockManager {
  private redisClient: any = null;
  private redisConnectPromise: Promise<any> | null = null;
  private redisDisabledUntil = 0;

  /** True si un backend Redis est actif (verrou réellement distribué). */
  get isDistributed(): boolean {
    return Boolean(this.redisClient?.isReady);
  }

  private async getRedisClient(): Promise<any | null> {
    const url = getRedisUrl();
    if (!url) return null;
    if (Date.now() < this.redisDisabledUntil) return null;
    if (this.redisClient?.isReady) return this.redisClient;
    if (!this.redisConnectPromise) {
      this.redisConnectPromise = import("redis")
        .then(({ createClient }) => {
          const client = createClient({ url });
          client.on("error", (error: Error) => log.warn(`Redis lock indisponible: ${error.message}`));
          return client.connect().then(() => {
            this.redisClient = client;
            return client;
          });
        })
        .catch((error) => {
          this.redisDisabledUntil = Date.now() + 30_000;
          log.warn(`Connexion Redis lock impossible (repli in-process): ${(error as Error).message}`);
          return null;
        })
        .finally(() => { this.redisConnectPromise = null; });
    }
    return this.redisConnectPromise;
  }

  /**
   * Tente d'acquérir le verrou une seule fois (non bloquant).
   * Retourne un handle si acquis, sinon null.
   */
  async tryAcquire(key: string, ttlMs = DEFAULT_TTL_MS): Promise<LockHandle | null> {
    const token = randomUUID();
    const client = await this.getRedisClient();

    if (client) {
      try {
        const result = await client.set(key, token, { NX: true, PX: ttlMs });
        if (result !== "OK") return null;
        return this.makeHandle(key, token);
      } catch (error) {
        log.warn(`Acquisition Redis échouée (repli in-process): ${(error as Error).message}`);
        // Repli local en cas d'erreur Redis transitoire.
      }
    }

    return localAcquire(key, token, ttlMs) ? this.makeHandle(key, token) : null;
  }

  /**
   * Acquiert le verrou en réessayant jusqu'à `waitMs`. Retourne null si le délai
   * expire sans obtenir le verrou.
   */
  async acquire(key: string, options: AcquireOptions = {}): Promise<LockHandle | null> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const waitMs = options.waitMs ?? 0;
    const retryDelayMs = options.retryDelayMs ?? 100;
    const deadline = Date.now() + waitMs;

    for (;;) {
      const handle = await this.tryAcquire(key, ttlMs);
      if (handle) return handle;
      if (Date.now() + retryDelayMs > deadline) return null;
      await sleep(retryDelayMs);
    }
  }

  /**
   * Exécute `fn` en détenant le verrou, puis le libère systématiquement.
   * Si le verrou ne peut être obtenu dans le délai, `fn` n'est PAS exécutée et
   * `withLock` retourne `{ acquired: false }`.
   */
  async withLock<T>(
    key: string,
    fn: (handle: LockHandle) => Promise<T>,
    options: AcquireOptions = {},
  ): Promise<{ acquired: true; result: T } | { acquired: false }> {
    const handle = await this.acquire(key, options);
    if (!handle) return { acquired: false };
    try {
      const result = await fn(handle);
      return { acquired: true, result };
    } finally {
      await handle.release();
    }
  }

  private makeHandle(key: string, token: string): LockHandle {
    return {
      key,
      token,
      renew: async (ttlMs = DEFAULT_TTL_MS) => {
        const client = await this.getRedisClient();
        if (client) {
          try {
            const res = await client.eval(RENEW_SCRIPT, { keys: [key], arguments: [token, String(ttlMs)] });
            return res === 1;
          } catch (error) {
            log.warn(`Renouvellement Redis échoué: ${(error as Error).message}`);
            return localRenew(key, token, ttlMs);
          }
        }
        return localRenew(key, token, ttlMs);
      },
      release: async () => {
        const client = await this.getRedisClient();
        if (client) {
          try {
            await client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
          } catch (error) {
            log.warn(`Libération Redis échouée: ${(error as Error).message}`);
          }
        }
        // Toujours nettoyer le repli local (idempotent, sûr même en mode Redis).
        localRelease(key, token);
      },
    };
  }

  async close(): Promise<void> {
    if (this.redisClient?.isOpen) {
      try { await this.redisClient.quit(); } catch { /* ignore */ }
    }
    this.redisClient = null;
  }
}

/** Instance partagée : réutilise une seule connexion Redis pour tous les verrous. */
export const distributedLock = new DistributedLockManager();
