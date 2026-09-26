/**
 * Utility functions for file operations
 */

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'css',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  sh: 'shell',
  py: 'python',
  env: 'ini',
};

/**
 * Get the Monaco editor language for a file path
 */
export function getLanguage(filePath: string): string {
  const parts = filePath.split('.');
  const ext = parts[parts.length - 1]?.toLowerCase() || '';
  return LANGUAGE_BY_EXT[ext] || 'plaintext';
}

/**
 * Extract filename from a file path
 */
export function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}
