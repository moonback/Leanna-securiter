/**
 * Logger structuré pour Leanna
 *
 * Remplace les console.log éparpillés par un système centralisé avec :
 * - Niveaux configurables (debug, info, warn, error)
 * - Préfixes automatiques (module/composant)
 * - Timestamps ISO
 * - Possibilité d'écriture fichier (future)
 * - Coloration console
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

export interface LoggerOptions {
  /** Niveau minimum de log affiché */
  level?: LogLevel;
  /** Activer les timestamps dans la sortie console */
  timestamps?: boolean;
  /** Activer la coloration ANSI */
  colors?: boolean;
}

/** Filtre appliqué à l'historique de logs consultable par l'assistant. */
export interface LogQuery {
  /** Préfixe du module (par exemple "Agent" ou "Assistant"). */
  module?: string;
  level?: LogLevel;
  since?: string;
  /** Maximum d'entrées, renvoyées de la plus récente à la plus ancienne. */
  limit?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════════════════════

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // gris
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // jaune
  error: "\x1b[31m",  // rouge
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ═══════════════════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_HISTORY_ENTRIES = 1_000;
const MAX_HISTORY_MESSAGE_CHARS = 4_000;

/** Supprime les secrets les plus courants avant qu'un log ne soit réinjecté au modèle. */
function sanitizeHistoryMessage(message: string): string {
  return message
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization|cookie)\b\s*([:=])\s*(?:"[^"]*"|'[^']*'|\S+)/gi, "$1$2[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]")
    .slice(0, MAX_HISTORY_MESSAGE_CHARS);
}

class LoggerInstance {
  private level: LogLevel;
  private timestamps: boolean;
  private colors: boolean;
  private readonly history: LogEntry[] = [];

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? (process.env.LOG_LEVEL as LogLevel) ?? "info";
    this.timestamps = options.timestamps ?? true;
    this.colors = options.colors ?? true;
  }

  /** Reconfigure le logger à chaud */
  configure(options: Partial<LoggerOptions>): void {
    if (options.level !== undefined) this.level = options.level;
    if (options.timestamps !== undefined) this.timestamps = options.timestamps;
    if (options.colors !== undefined) this.colors = options.colors;
  }

  /** Crée un logger enfant avec un préfixe de module */
  child(module: string): ModuleLogger {
    return new ModuleLogger(module, this);
  }

  /** Vérifie si un niveau est actif */
  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  /** Retourne des logs sûrs et bornés, sans les payloads bruts associés. */
  getEntries(query: LogQuery = {}): LogEntry[] {
    const limit = Math.max(1, Math.min(query.limit ?? 50, MAX_HISTORY_ENTRIES));
    const since = query.since ? Date.parse(query.since) : Number.NEGATIVE_INFINITY;
    const hasValidSince = Number.isFinite(since);

    return this.history
      .filter((entry) => !query.module || entry.module.startsWith(query.module))
      .filter((entry) => !query.level || entry.level === query.level)
      .filter((entry) => !hasValidSince || Date.parse(entry.timestamp) >= since)
      .slice(-limit)
      .reverse()
      .map(({ level, module, message, timestamp }) => ({ level, module, message, timestamp }));
  }

  private addToHistory(entry: LogEntry): void {
    this.history.push({
      level: entry.level,
      module: entry.module,
      message: sanitizeHistoryMessage(entry.message),
      timestamp: entry.timestamp,
    });
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history.splice(0, this.history.length - MAX_HISTORY_ENTRIES);
    }
  }

  /** Méthode interne d'écriture */
  write(entry: LogEntry): void {
    this.addToHistory(entry);
    if (!this.isLevelEnabled(entry.level)) return;

    const parts: string[] = [];

    // Timestamp
    if (this.timestamps) {
      const ts = entry.timestamp.split("T")[1]?.replace("Z", "") ?? entry.timestamp;
      parts.push(this.colors ? `\x1b[90m${ts}${RESET}` : ts);
    }

    // Level
    const levelTag = entry.level.toUpperCase().padEnd(5);
    if (this.colors) {
      parts.push(`${LEVEL_COLORS[entry.level]}${levelTag}${RESET}`);
    } else {
      parts.push(levelTag);
    }

    // Module
    if (this.colors) {
      parts.push(`${BOLD}[${entry.module}]${RESET}`);
    } else {
      parts.push(`[${entry.module}]`);
    }

    // Message
    parts.push(entry.message);

    const line = parts.join(" ");

    // Sortie
    switch (entry.level) {
      case "error":
        console.error(line);
        if (entry.data) console.error(entry.data);
        break;
      case "warn":
        console.warn(line);
        if (entry.data) console.warn(entry.data);
        break;
      default:
        console.log(line);
        if (entry.data) console.log(entry.data);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ModuleLogger — Logger avec préfixe de module intégré
// ═══════════════════════════════════════════════════════════════════════════════

export class ModuleLogger {
  constructor(
    private readonly module: string,
    private readonly parent: LoggerInstance
  ) {}

  debug(message: string, data?: unknown): void {
    this.parent.write({
      level: "debug",
      module: this.module,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  info(message: string, data?: unknown): void {
    this.parent.write({
      level: "info",
      module: this.module,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  warn(message: string, data?: unknown): void {
    this.parent.write({
      level: "warn",
      module: this.module,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  error(message: string, data?: unknown): void {
    this.parent.write({
      level: "error",
      module: this.module,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  /** Crée un sous-logger (ex: "Orchestrator" → "Orchestrator:Execution") */
  child(subModule: string): ModuleLogger {
    return new ModuleLogger(`${this.module}:${subModule}`, this.parent);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton global
// ═══════════════════════════════════════════════════════════════════════════════

export const logger = new LoggerInstance();

/**
 * Lit l'historique de logs structuré, conservé en mémoire pour la session active.
 * Les entrées sont assainies et excluent systématiquement les payloads `data` bruts.
 */
export function getLogEntries(query: LogQuery = {}): LogEntry[] {
  return logger.getEntries(query);
}

/**
 * Crée un logger pour un module spécifique.
 * Usage: const log = createLogger("McpBridge");
 */
export function createLogger(module: string): ModuleLogger {
  return logger.child(module);
}
