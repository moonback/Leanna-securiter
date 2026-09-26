import fs from "fs";
import path from "path";
import { SELF_ROOT, normalizeSelfPath } from "../utils/selfRoot.js";
import { isSandboxActive, getSandboxRoot, assertSandboxReady } from "../utils/sandbox.js";

export const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out"]);
export const EXCLUDED_FILES = new Set(["codebase.md"]);
export const TEXT_FILE_EXT = /\.(ts|tsx|js|jsx|json|md|html|css|scss|sass|yml|yaml|txt|cjs|mjs|env|sh|py|sql)$/i;
export const MAX_PREVIEW_LINES = 40;
export const MAX_PREVIEW_SIZE = 150_000;

export function getProjectRoot(): string {
  if (isSandboxActive()) {
    return getSandboxRoot();
  }
  return SELF_ROOT;
}

export interface SandboxWriteTarget {
  /** Cible canonique sous `.Leanna/sandbox`, obtenue uniquement via le garde. */
  sandboxPath: string;
  /** Chemin relatif canonique partagé par sandbox et projet principal. */
  relativePath: string;
  /** Cible logique sous SELF_ROOT, réservée aux politiques métier. */
  logicalPath: string;
}

/**
 * Associe une cible d'écriture sandbox validée à son équivalent logique dans
 * SELF_ROOT. Les mutations utilisent exclusivement `sandboxPath`; `logicalPath`
 * ne sert qu'à appliquer les politiques de fichiers critiques/interdits.
 */
export function resolveSandboxWriteTarget(target: string): SandboxWriteTarget | null {
  if (!getProjectRoot()) return null;
  try {
    const sandboxPath = assertSandboxReady(target);
    const sandboxRoot = fs.realpathSync(getSandboxRoot());
    const relativePath = path.relative(sandboxRoot, sandboxPath).replace(/\\/g, "/");
    const logicalPath = normalizeSelfPath(relativePath);
    if (!relativePath || !logicalPath) return null;
    return { sandboxPath, relativePath, logicalPath };
  } catch {
    return null;
  }
}

/**
 * Résout un chemin de lecture dans le workspace actif (sandbox si actif).
 * À la différence des écritures, la racine `.` est valide : les outils de
 * découverte et de recherche doivent pouvoir explorer le projet entier.
 * Retourne null si aucun workspace n'est actuellement ouvert.
 */
export function normalizeProjectPath(target: string): string | null {
  if (typeof target !== "string" || !target.trim()) return null;
  const root = getProjectRoot();
  if (!root) return null;
  const requestedPath = target.trim();
  if (
    path.isAbsolute(requestedPath)
    || path.win32.isAbsolute(requestedPath)
    || path.posix.isAbsolute(requestedPath)
    || /^[a-zA-Z]:/.test(requestedPath)
    || requestedPath.startsWith("\\\\")
  ) {
    return null;
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, requestedPath);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

/**
 * Adaptateur de compatibilité : toute écriture est autorisée et résolue par
 * assertSandboxReady(), sans fallback vers SELF_ROOT.
 */
export function resolveWritePath(relativePath: string): string | null {
  if (!getProjectRoot()) {
    console.warn("[resolveWritePath] Écriture refusée : aucun workspace ouvert.");
    return null;
  }
  const target = resolveSandboxWriteTarget(relativePath);
  if (!target) {
    console.warn("[resolveWritePath] Écriture refusée : sandbox indisponible ou chemin invalide.");
    return null;
  }
  return target.sandboxPath;
}

export function checkWorkspace(): { exists: boolean; path: string; message: string } {
  const root = getProjectRoot();
  if (!root) {
    return {
      exists: false,
      path: "",
      message: "Aucun workspace ouvert (mode sans projet).",
    };
  }
  const exists = fs.existsSync(root);
  return {
    exists,
    path: root,
    message: exists
      ? `Workspace actif: ${root}`
      : `Le workspace n'existe pas: ${root}`,
  };
}

export interface OutlineEntry {
  type: 'function' | 'class' | 'interface' | 'type' | 'export' | 'import' | 'variable' | 'method' | 'component';
  name: string;
  line: number;
  endLine?: number;
  signature?: string;
}

export function buildTreeMarkdown(files: string[]): string {
  const sortedFiles = [...files].sort();
  const treeLines: string[] = [];
  const tree: Record<string, any> = {};
  for (const file of sortedFiles) {
    const parts = file.split(path.sep);
    let node = tree;
    for (const part of parts) {
      if (!node[part]) node[part] = {};
      node = node[part];
    }
  }
  function renderNode(node: Record<string, any>, depth: number) {
    const indent = "  ".repeat(depth);
    for (const key of Object.keys(node).sort()) {
      const child = node[key];
      if (Object.keys(child).length === 0) treeLines.push(`${indent}- ${key}`);
      else { treeLines.push(`${indent}- **${key}/**`); renderNode(child, depth + 1); }
    }
  }
  renderNode(tree, 0);
  return treeLines.join("\n");
}

export async function buildFilePreview(relativePath: string, rootPath: string): Promise<string> {
  const absolutePath = path.join(rootPath, relativePath);
  const stats = await fs.promises.stat(absolutePath);
  if (!TEXT_FILE_EXT.test(relativePath) || stats.size > MAX_PREVIEW_SIZE) {
    return `*Fichier binaire ou trop volumineux (${stats.size} octets).*`;
  }
  const content = await fs.promises.readFile(absolutePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
  return preview + (lines.length > MAX_PREVIEW_LINES ? "\n... [contenu tronqué]" : "");
}

export async function buildPackageSummary(rootPath: string): Promise<string> {
  const packagePath = path.join(rootPath, "package.json");
  try {
    const pkg = JSON.parse(await fs.promises.readFile(packagePath, "utf-8"));
    const deps = pkg.dependencies ? Object.keys(pkg.dependencies).sort() : [];
    const devDeps = pkg.devDependencies ? Object.keys(pkg.devDependencies).sort() : [];
    const scripts = pkg.scripts ? Object.entries(pkg.scripts).sort(([a], [b]) => a.localeCompare(b)) : [];
    return [
      "### package.json",
      "",
      `- name: \`${pkg.name || "unknown"}\``,
      `- version: \`${pkg.version || "unknown"}\``,
      "",
      "#### Scripts",
      ...scripts.map(([n, v]) => `- \`${n}\`: \`${v}\``),
      "",
      "#### Dependencies",
      ...deps.map((d) => `- \`${d}\``),
      "",
      "#### DevDependencies",
      ...devDeps.map((d) => `- \`${d}\``),
    ].join("\n");
  } catch {
    return "### package.json\n\nImpossible de lire package.json.";
  }
}

export function extractFileOutline(lines: string[], ext: string): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  const isTS = /^\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext);

  if (!isTS) {
    const sections: OutlineEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#{1,3}\s/.test(line)) {
        sections.push({ type: 'export', name: line.trim(), line: i + 1 });
      }
    }
    return sections.length > 0 ? sections : [{ type: 'export', name: '(fichier non-TypeScript)', line: 1 }];
  }

  const patterns: Array<{ regex: RegExp; type: OutlineEntry['type']; nameGroup: number }> = [
    { regex: /^import\s+.*from\s+['"](.+)['"]/, type: 'import', nameGroup: 1 },
    { regex: /^export\s+default\s+(function|class)\s+(\w+)/, type: 'function', nameGroup: 2 },
    { regex: /^export\s+(async\s+)?function\s+(\w+)/, type: 'function', nameGroup: 2 },
    { regex: /^export\s+const\s+(\w+)\s*=\s*(React\.memo\()?(\s*function|\s*\(|async)/, type: 'component', nameGroup: 1 },
    { regex: /^export\s+(const|let|var)\s+(\w+)/, type: 'variable', nameGroup: 2 },
    { regex: /^export\s+(type|interface)\s+(\w+)/, type: 'interface', nameGroup: 2 },
    { regex: /^(export\s+)?(abstract\s+)?class\s+(\w+)/, type: 'class', nameGroup: 3 },
    { regex: /^(export\s+)?interface\s+(\w+)/, type: 'interface', nameGroup: 2 },
    { regex: /^(export\s+)?type\s+(\w+)\s*=/, type: 'type', nameGroup: 2 },
    { regex: /^(async\s+)?function\s+(\w+)/, type: 'function', nameGroup: 2 },
    { regex: /^const\s+(\w+)\s*=\s*(async\s+)?\(/, type: 'function', nameGroup: 1 },
    { regex: /^(export\s+)?const\s+(\w+)\s*=\s*React\.(memo|forwardRef)/, type: 'component', nameGroup: 2 },
  ];

  let importBlockStart = -1;
  let importBlockEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    if (!line || line.startsWith('//') || line.startsWith('*')) continue;

    for (const { regex, type, nameGroup } of patterns) {
      const match = line.match(regex);
      if (match) {
        if (type === 'import') {
          if (importBlockStart === -1) importBlockStart = i + 1;
          importBlockEnd = i + 1;
        } else {
          outline.push({
            type,
            name: match[nameGroup] || 'anonymous',
            line: i + 1,
            signature: line.slice(0, 100),
          });
        }
        break;
      }
    }
  }

  if (importBlockStart > 0) {
    outline.unshift({
      type: 'import',
      name: `imports (${importBlockEnd - importBlockStart + 1} lignes)`,
      line: importBlockStart,
      endLine: importBlockEnd,
    });
  }

  return outline;
}

export function buildAnalysisPrompt(codebaseMarkdown: string): string {
  return [
    "Analyse ce codebase en français.",
    "",
    "Redige un resume executif avec :",
    "- 1. Vue d'ensemble du projet",
    "- 2. Points forts",
    "- 3. Risques ou faiblesses",
    "- 4. Prochaines etapes recommandees",
    "",
    "Reponds en Markdown concis, utile et structure.",
    "",
    "Codebase :",
    codebaseMarkdown.slice(0, 20_000),
  ].join("\n");
}
