/**
 * StrategyMemory — durable, cross-mission skill/tool reliability.
 *
 * This closes GAP-1 from docs/LEANNA_AUTONOMY_MASTER_AUDIT.md: lessons and skill
 * outcomes were produced by ReflectionEngine/LearningEngine but never read back
 * into future planning. `SkillScorer.usageHistory` was in-memory per process.
 *
 * Design (reuse, don't rebuild):
 *   - This is NOT a fourth cognitive memory. It is a compact *metrics* store for
 *     tool reliability, exactly the signal the prompt's §45 asks to measure per
 *     skill/context. It complements ProjectMemory (which stores prose "lessons"
 *     and rejects short/duplicate facts, so it is unsuitable for numeric counters).
 *   - Persistence mirrors ProjectMemory: a per-workspace JSON file written
 *     atomically (tmp + rename) under SELF_ROOT. Fully optional and best-effort:
 *     any I/O error degrades to in-memory only and never throws into the loop.
 *
 * The stored signal is read back by SkillScorer.seedFromReliability() at mission
 * start and by the Planner (via warnings) so a skill that historically fails is
 * scored lower and can be deprioritised or replaced.
 */

import fs from "fs";
import path from "path";
import { SELF_ROOT } from "../utils/selfRoot.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("StrategyMemory");

/** Per-skill durable reliability record. Bounded, small, numeric. */
export interface SkillReliability {
  skillName: string;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  totalCalls: number;
  /** Last N boolean outcomes (most recent last), capped. */
  recent: boolean[];
  lastUsedAt: string;
}

/** Public, read-only view returned to consumers (SkillScorer/Planner). */
export interface SkillReliabilityStats {
  skillName: string;
  totalCalls: number;
  successRate: number;
  recentSuccessRate: number;
  avgDurationMs: number;
  /** Failing = enough evidence AND low recent success. Drives Planner warnings. */
  failing: boolean;
}

const MAX_RECENT = 20;
const MAX_SKILLS = 400;
/** Minimum calls before a skill is allowed to be flagged "failing". */
const MIN_EVIDENCE = 3;
/** Recent success rate at/under which a skill with enough evidence is "failing". */
const FAILING_THRESHOLD = 0.34;

function getStorePath(): string {
  return path.join(SELF_ROOT || process.cwd(), ".Leanna-strategy.json");
}

export class StrategyMemory {
  private skills = new Map<string, SkillReliability>();
  private loadedFrom = "";
  private dirty = false;
  /** When true, never touches disk (used by tests for isolation). */
  private readonly ephemeral: boolean;

  constructor(options: { ephemeral?: boolean } = {}) {
    this.ephemeral = options.ephemeral === true;
  }

  /** Load lazily / re-load when the active workspace (SELF_ROOT) changes. */
  private sync(): void {
    if (this.ephemeral) return;
    const target = getStorePath();
    if (target === this.loadedFrom) return;
    this.loadedFrom = target;
    this.skills.clear();
    try {
      if (fs.existsSync(target)) {
        const raw = JSON.parse(fs.readFileSync(target, "utf-8")) as {
          skills?: SkillReliability[];
        };
        for (const s of raw.skills ?? []) {
          if (s && typeof s.skillName === "string") {
            this.skills.set(s.skillName, {
              skillName: s.skillName,
              successCount: s.successCount || 0,
              failureCount: s.failureCount || 0,
              totalDurationMs: s.totalDurationMs || 0,
              totalCalls: s.totalCalls || 0,
              recent: Array.isArray(s.recent) ? s.recent.slice(-MAX_RECENT) : [],
              lastUsedAt: s.lastUsedAt || new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) {
      // Corrupted store must never break planning. Start empty.
      log.warn(`Impossible de charger la mémoire de stratégie: ${(err as Error).message}`);
      this.skills.clear();
    }
  }

  /** Record one skill outcome. Best-effort; persists to disk. */
  recordSkillOutcome(skillName: string, success: boolean, durationMs: number): void {
    if (!skillName) return;
    this.sync();
    const stat = this.skills.get(skillName) ?? {
      skillName,
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
      totalCalls: 0,
      recent: [],
      lastUsedAt: new Date().toISOString(),
    };
    stat.totalCalls++;
    stat.totalDurationMs += Math.max(0, durationMs) || 0;
    stat.lastUsedAt = new Date().toISOString();
    if (success) stat.successCount++;
    else stat.failureCount++;
    stat.recent.push(success);
    if (stat.recent.length > MAX_RECENT) stat.recent.shift();
    this.skills.set(skillName, stat);
    this.dirty = true;
    if (this.skills.size > MAX_SKILLS) this.prune();
    this.save();
  }

  /** Reliability stats for a single skill, or undefined if never seen. */
  getSkillStats(skillName: string): SkillReliabilityStats | undefined {
    this.sync();
    const s = this.skills.get(skillName);
    if (!s || s.totalCalls === 0) return undefined;
    return this.toStats(s);
  }

  /** All known skill stats (for seeding SkillScorer). */
  getAllStats(): SkillReliabilityStats[] {
    this.sync();
    return [...this.skills.values()].map((s) => this.toStats(s));
  }

  /** Skills with enough evidence and low recent success — Planner warnings. */
  getFailingSkills(): SkillReliabilityStats[] {
    return this.getAllStats().filter((s) => s.failing);
  }

  private toStats(s: SkillReliability): SkillReliabilityStats {
    const successRate = s.totalCalls > 0 ? s.successCount / s.totalCalls : 0;
    const recent = s.recent.slice(-10);
    const recentSuccessRate =
      recent.length > 0 ? recent.filter(Boolean).length / recent.length : successRate;
    return {
      skillName: s.skillName,
      totalCalls: s.totalCalls,
      successRate,
      recentSuccessRate,
      avgDurationMs: s.totalCalls > 0 ? s.totalDurationMs / s.totalCalls : 0,
      failing: s.totalCalls >= MIN_EVIDENCE && recentSuccessRate <= FAILING_THRESHOLD,
    };
  }

  private prune(): void {
    // Drop least-recently-used skills first.
    const sorted = [...this.skills.values()].sort(
      (a, b) => Date.parse(a.lastUsedAt) - Date.parse(b.lastUsedAt),
    );
    const toRemove = sorted.slice(0, this.skills.size - Math.floor(MAX_SKILLS * 0.9));
    for (const s of toRemove) this.skills.delete(s.skillName);
  }

  /** Atomic best-effort persistence (tmp + rename), like ProjectMemory. */
  save(): void {
    if (this.ephemeral || !this.dirty) return;
    const target = this.loadedFrom || getStorePath();
    try {
      const payload = JSON.stringify(
        { version: 1, updatedAt: new Date().toISOString(), skills: [...this.skills.values()] },
        null,
        2,
      );
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, payload, "utf-8");
      fs.renameSync(tmp, target);
      this.dirty = false;
    } catch (err) {
      // Persistence is optional; keep running in-memory.
      log.warn(`Écriture de la mémoire de stratégie échouée: ${(err as Error).message}`);
    }
  }

  /** Test/maintenance helper. */
  reset(): void {
    this.skills.clear();
    this.dirty = true;
    this.loadedFrom = "";
  }
}

/** Shared singleton, mirroring `projectMemory`/`learningEngine`. */
export const strategyMemory = new StrategyMemory();
