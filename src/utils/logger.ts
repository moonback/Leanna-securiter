/**
 * Centralized logger utility for the application.
 * 
 * Provides consistent logging across all components with:
 * - Log levels (debug, info, warn, error)
 * - Namespaced logging for easier filtering
 * - Development vs production control
 * 
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.debug('MyComponent', 'Debug message');
 *   logger.error('MyComponent', 'Error message', error);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  enabled: boolean;
}

// Default configuration - in development, log everything; in production, only warnings and errors
const isDev = process.env.NODE_ENV !== 'production';

const defaultConfig: LoggerConfig = {
  level: isDev ? 'debug' : 'warn',
  enabled: true,
};

// Log level priorities
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Centralized logger with namespace support
 */
export const logger = {
  /**
   * Debug level - verbose logging for development
   */
  debug(namespace: string, message: string, ...args: unknown[]): void {
    _logInternal('debug', namespace, message, ...args);
  },

  /**
   * Info level - general information
   */
  info(namespace: string, message: string, ...args: unknown[]): void {
    _logInternal('info', namespace, message, ...args);
  },

  /**
   * Warn level - potentially harmful situations
   */
  warn(namespace: string, message: string, ...args: unknown[]): void {
    _logInternal('warn', namespace, message, ...args);
  },

  /**
   * Error level - error events that might still allow the application to continue running
   */
  error(namespace: string, message: string, ...args: unknown[]): void {
    _logInternal('error', namespace, message, ...args);
  },

  /**
   * Configure the logger
   */
  configure(config: Partial<LoggerConfig>): void {
    Object.assign(defaultConfig, config);
  },

  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    if (!defaultConfig.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[defaultConfig.level];
  },
};

/**
 * Internal log function that handles the actual logging
 */
function _logInternal(level: LogLevel, namespace: string, message: string, ...args: unknown[]): void {
  if (!defaultConfig.enabled) return;
  
  // Check if this level should be logged
  if (LOG_LEVELS[level] < LOG_LEVELS[defaultConfig.level]) return;

  // Format the message with namespace and timestamp
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [${namespace}] ${message}`;

  // Use appropriate console method based on level
  switch (level) {
    case 'debug':
      console.debug(formattedMessage, ...args);
      break;
    case 'info':
      console.info(formattedMessage, ...args);
      break;
    case 'warn':
      console.warn(formattedMessage, ...args);
      break;
    case 'error':
      console.error(formattedMessage, ...args);
      break;
  }
}

/**
 * Create a namespaced logger for a specific component/module
 * 
 * Usage:
 *   const log = createLogger('MyComponent');
 *   log.debug('Initializing...');
 *   log.error('Failed to load', error);
 */
export function createLogger(namespace: string) {
  return {
    debug(message: string, ...args: unknown[]): void {
      logger.debug(namespace, message, ...args);
    },
    info(message: string, ...args: unknown[]): void {
      logger.info(namespace, message, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
      logger.warn(namespace, message, ...args);
    },
    error(message: string, ...args: unknown[]): void {
      logger.error(namespace, message, ...args);
    },
  };
}

/**
 * Backwards-compatible console wrapper that can be replaced with the logger
 * 
 * This provides a drop-in replacement for direct console.log calls
 * while maintaining the same API.
 * 
 * In production, only warn and error levels are logged to the console.
 * Debug and info logs are suppressed in production builds.
 */
export const consoleWrapper = {
  debug: (message: string, ...args: unknown[]) => logger.debug('global', message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info('global', message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn('global', message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error('global', message, ...args),
};

// Backwards compatibility alias
export const log = consoleWrapper;

/**
 * Development-only console.log wrapper
 * 
 * In development: logs to console
 * In production: no-op (logs nothing)
 * 
 * Use this instead of direct console.log() calls to avoid console pollution in production.
 * 
 * Example:
 *   import { devLog } from '../utils/logger';
 *   devLog('Debug info', someObject); // Only logs in development
 */
export function devLog(message: string, ...args: unknown[]): void {
  if (isDev) {
    console.log(`[DEV] ${message}`, ...args);
  }
}

/**
 * Production-safe console.log wrapper
 * 
 * In development: logs to console with [LOG] prefix
 * In production: logs only if level is warn or error (respects logger configuration)
 * 
 * This is a drop-in replacement for console.log that respects production settings.
 * 
 * Example:
 *   import { safeLog } from '../utils/logger';
 *   safeLog('Application started'); // Logs in dev, suppressed in prod
 *   safeLog('Warning!', 'warn'); // Logs in both dev and prod
 */
export function safeLog(message: string, level: LogLevel = 'info', ...args: unknown[]): void {
  switch (level) {
    case 'debug':
      logger.debug('global', message, ...args);
      break;
    case 'info':
      logger.info('global', message, ...args);
      break;
    case 'warn':
      logger.warn('global', message, ...args);
      break;
    case 'error':
      logger.error('global', message, ...args);
      break;
  }
}

/**
 * Patches console.log, console.info, console.debug to use the logger
 * 
 * WARNING: This mutates the global console object. Use with caution.
 * Recommended to call this early in the application initialization.
 * 
 * In production, this will suppress most console output (except warnings and errors).
 */
export function patchConsole(): void {
  if (!isDev) {
    // In production, override console methods to use our logger
    const originalConsole = { ...console };
    
    console.log = (...args: unknown[]) => {
      logger.info('console', args.join(' '));
    };
    console.info = (...args: unknown[]) => {
      logger.info('console', args.join(' '));
    };
    console.debug = (...args: unknown[]) => {
      // Suppress debug logs in production
    };
    // Keep warn and error as-is or redirect to logger
    console.warn = (...args: unknown[]) => {
      logger.warn('console', args.join(' '));
    };
    console.error = (...args: unknown[]) => {
      logger.error('console', args.join(' '));
    };
  }
}
