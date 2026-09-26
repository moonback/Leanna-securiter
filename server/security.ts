import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { SELF_ROOT } from './utils/selfRoot.js';

export interface AuthOptions {
  apiToken?: string;
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function authenticateRequest(req: { headers?: Record<string, string | string[] | undefined> }, options: AuthOptions = {}): AuthResult {
  const configuredToken = options.apiToken;
  if (!configuredToken) {
    return { ok: true };
  }

  // Note: Node/Express always lowercases header names in req.headers
  const headerValue = req.headers?.['x-leanna-token'];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (token === configuredToken) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}

export interface RateLimiter {
  check: (key: string) => boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string) {
      const now = Date.now();
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      if (existing.count >= limit) {
        return false;
      }

      existing.count += 1;
      return true;
    },
  };
}

/**
 * Directory names that must never be exposed through the IDE tree, search,
 * file-count, or read/write path resolution. These hold local state, secrets,
 * or generated artefacts that should stay out of the workspace surface.
 */
export const EXCLUDED_WORKSPACE_DIRECTORIES = new Set<string>([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.Leanna',
]);

/**
 * Exact file names that must never be exposed (sensitive credentials/config).
 */
export const EXCLUDED_WORKSPACE_FILES = new Set<string>([
  '.gemini-keys.json',
]);

/**
 * Returns true when a single path segment (directory or file name) should be
 * hidden from the workspace surface. Covers the excluded directory/file sets
 * plus any `.env` / `.env.*` variant.
 */
export function isExcludedWorkspaceEntry(name: string): boolean {
  if (EXCLUDED_WORKSPACE_DIRECTORIES.has(name)) return true;
  if (EXCLUDED_WORKSPACE_FILES.has(name)) return true;
  // .env, .env.local, .env.example, .env.production, ...
  if (name === '.env' || name.startsWith('.env.')) return true;
  return false;
}

/**
 * Returns true when any segment of a workspace-relative path is excluded.
 */
export function isExcludedWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized
    .split('/')
    .filter(Boolean)
    .some((segment) => isExcludedWorkspaceEntry(segment));
}

export function resolveWorkspacePath(requestedPath: string, workspaceRoot: string): { ok: true; absolutePath: string } | { ok: false; status: number; error: string } {
  const absolutePath = path.resolve(workspaceRoot, requestedPath);
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedTarget = path.resolve(absolutePath);

  if (!normalizedTarget.startsWith(normalizedRoot + path.sep) && normalizedTarget !== normalizedRoot) {
    return { ok: false, status: 403, error: 'Path outside workspace' };
  }

  // Central filter: block access to excluded/sensitive entries even when the
  // path itself is inside the workspace.
  const relativeToRoot = path.relative(normalizedRoot, normalizedTarget);
  if (relativeToRoot && isExcludedWorkspacePath(relativeToRoot)) {
    return { ok: false, status: 403, error: 'Path excluded from workspace' };
  }

  return { ok: true, absolutePath: normalizedTarget };
}

/**
 * Returns the default workspace root (the project root).
 */
export function getDefaultWorkspaceRoot(): string {
  return SELF_ROOT;
}

/**
 * Authenticate a raw token string (e.g. from a WebSocket query param).
 * If no apiToken is configured, access is granted by default.
 */
export function authenticateToken(token: string | null | undefined, apiToken: string | undefined): AuthResult {
  if (!apiToken) {
    return { ok: true };
  }
  if (token === apiToken) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Unauthorized' };
}

/**
 * Generate a cryptographically secure random API token.
 * Returns a URL-safe base64 string of 32 bytes (256 bits).
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Ensure an API token exists. If not found in environment, generates one
 * and saves it to .env file (or .env.local if .env doesn't exist).
 * Returns the token (existing or newly generated).
 */
export function ensureApiToken(): string {
  const existingToken = process.env.Leanna_API_TOKEN?.trim();
  
  if (existingToken && existingToken.length > 0) {
    return existingToken;
  }

  // Generate a new secure token
  const newToken = generateSecureToken();
  
  // Determine which .env file to update
  const envPath = path.join(SELF_ROOT, '.env');
  const envLocalPath = path.join(SELF_ROOT, '.env.local');
  
  let targetPath = envPath;
  if (!fs.existsSync(envPath) && fs.existsSync(envLocalPath)) {
    targetPath = envLocalPath;
  }

  // Append or update the token in the file
  try {
    let envContent = '';
    if (fs.existsSync(targetPath)) {
      envContent = fs.readFileSync(targetPath, 'utf-8');
    }

    // Check if Leanna_API_TOKEN line already exists (empty or commented)
    const tokenLineRegex = /^#?\s*Leanna_API_TOKEN\s*=.*$/m;
    
    if (tokenLineRegex.test(envContent)) {
      // Replace existing line
      envContent = envContent.replace(
        tokenLineRegex,
        `Leanna_API_TOKEN="${newToken}"`
      );
    } else {
      // Append new line
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n';
      }
      envContent += `\n# Auto-generated secure API token for Leanna authentication\nLeanna_API_TOKEN="${newToken}"\n`;
    }

    fs.writeFileSync(targetPath, envContent, 'utf-8');
    
    // Update process.env for current session
    process.env.Leanna_API_TOKEN = newToken;
    
    console.log(`[Security] ✓ Generated new API token and saved to ${path.basename(targetPath)}`);
    console.log(`[Security] ⚠️  IMPORTANT: Save this token securely. It will be required for all API access.`);
    console.log(`[Security] Token: ${newToken}`);
    
    return newToken;
  } catch (error) {
    console.error('[Security] Failed to write token to .env file:', error);
    throw new Error('Unable to generate and persist API token. Please set Leanna_API_TOKEN manually in your .env file.');
  }
}

/**
 * Sanitize command arguments to prevent shell injection.
 * Applies an allowlist of safe characters, similar to the filter in project.ts.
 * Returns sanitized string with dangerous characters replaced by dashes.
 * 
 * Safe characters: alphanumeric, underscore, hyphen, dot, forward slash, colon, equals, comma
 * All other characters are replaced with '-' to prevent shell metacharacter injection.
 */
export function sanitizeCommandArgument(arg: string): string {
  // Allowlist of safe characters: a-z A-Z 0-9 _ - . / : = ,
  // Replace anything else with '-' to prevent shell injection
  return arg.replace(/[^a-zA-Z0-9_.\-/:=,]/g, '-');
}

/**
 * Sanitize an array of command arguments.
 * Each argument is individually sanitized using sanitizeCommandArgument.
 */
export function sanitizeCommandArguments(args: string[]): string[] {
  return args.map(sanitizeCommandArgument);
}

/**
 * Validate that a file path doesn't contain dangerous shell metacharacters.
 * Returns the original path if safe, or throws an error if dangerous.
 */
export function validateSafePath(filePath: string): string {
  // Check for common shell metacharacters that could be dangerous
  const dangerousPatterns = /[;|&$`<>(){}[\]!*?'"\\\n\r]/;
  
  if (dangerousPatterns.test(filePath)) {
    throw new Error(`Path contains potentially dangerous characters: ${filePath}`);
  }
  
  return filePath;
}
