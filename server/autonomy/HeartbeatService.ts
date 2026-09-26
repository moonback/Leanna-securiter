import type { EventBus } from "../runtime/EventBus.js";

export interface HeartbeatConfig {
  activeIntervalMs: number;
  idleIntervalMs: number;
  sleepIntervalMs: number;
  idleAfterMs: number;
}

const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export const heartbeatConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): HeartbeatConfig => ({
  activeIntervalMs: positive(Number(env.LEANNA_HEARTBEAT_ACTIVE_MS), 15_000),
  idleIntervalMs: positive(Number(env.LEANNA_HEARTBEAT_IDLE_MS), 60_000),
  sleepIntervalMs: positive(Number(env.LEANNA_HEARTBEAT_SLEEP_MS), 300_000),
  idleAfterMs: positive(Number(env.LEANNA_HEARTBEAT_IDLE_AFTER_MS), 300_000),
});

/** A single adaptive timer. Events call wake() and never wait for the next poll. */
export class HeartbeatService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastActivityAt = Date.now();
  private state: "active" | "idle" | "sleep" = "active";

  constructor(private readonly events: EventBus, private readonly check: () => { attentionRequired: boolean; reason: string }, private readonly config = heartbeatConfigFromEnv()) {}

  start(): void { if (!this.running) { this.running = true; this.schedule(0); } }
  stop(): void { this.running = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  wake(reason = "event received"): void { this.lastActivityAt = Date.now(); this.state = "active"; if (this.running) this.schedule(0, reason); }
  getState(): "active" | "idle" | "sleep" { return this.state; }

  private schedule(delay: number, wakeReason?: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(wakeReason), delay);
  }
  private tick(wakeReason?: string): void {
    if (!this.running) return;
    const outcome = this.check();
    const elapsed = Date.now() - this.lastActivityAt;
    this.state = outcome.attentionRequired || elapsed < this.config.idleAfterMs ? "active" : elapsed < this.config.idleAfterMs * 2 ? "idle" : "sleep";
    this.events.emit({ type: "autonomy:heartbeat", attentionRequired: outcome.attentionRequired, state: this.state, reason: wakeReason ?? outcome.reason });
    this.schedule(this.state === "active" ? this.config.activeIntervalMs : this.state === "idle" ? this.config.idleIntervalMs : this.config.sleepIntervalMs);
  }
}
