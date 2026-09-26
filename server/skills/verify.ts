import { Skill, validateArgs } from "./base.js";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { SELF_ROOT, normalizeSelfPath } from "../utils/selfRoot.js";
import * as ts from "typescript";
import { createHash } from "crypto";
import type { VerificationIssue, VerificationRecord } from "../agents/WorkspaceState.js";
export type { VerificationIssue, VerificationRecord } from "../agents/WorkspaceState.js";

const execFileAsync = promisify(execFile);

// ── Cache pour les résultats de tests (optimisation) ────────────────────────
export interface ProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
  timedOut?: boolean;
}

interface TestCacheEntry {
  hash: string;
  testHash: string;
  result: ProcessResult;
  timestamp: number;
}
const testCache = new Map<string, TestCacheEntry>();
const TEST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

import { getProjectRoot, normalizeProjectPath } from "./codebaseHelpers.js";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 8_000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + "\n... [sortie tronquee]" : s;
}

export interface ParsedTsError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

/**
 * Pré-vérifie rapidement l'équilibre des accolades, parenthèses, crochets et quotes.
 * Ce n'est pas un parseur TypeScript : pour les fichiers TS/TSX, le résultat du
 * compilateur reste l'autorité syntaxique et cette fonction ne doit pas bloquer.
 */
export function checkBracketBalance(code: string): string | null {
  const pairs = { "{": "}", "(": ")", "[": "]", '"': '"', "'": "'", "`": "`" };
  const opening = Object.keys(pairs);
  const closing = Object.values(pairs);
  const stack: string[] = [];
  let inString = false;
  let stringChar = "";
  let inTemplate = false;
  let escapeNext = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = code[i + 1];

    // Gestion des templates strings
    if (char === "`" && !inString && !inTemplate && !escapeNext) {
      inTemplate = true;
      continue;
    }
    if (inTemplate && char === "`" && !escapeNext) {
      inTemplate = false;
      continue;
    }
    if (inTemplate) {
      if (char === "$" && nextChar === "{" && !escapeNext) {
        stack.push("${");
        i++; // skip {
        continue;
      }
      continue;
    }

    // Gestion des strings simples/doubles
    if ((char === '"' || char === "'") && !inString && !escapeNext) {
      inString = true;
      stringChar = char;
      continue;
    }
    if (inString && char === stringChar && !escapeNext) {
      inString = false;
      stringChar = "";
      continue;
    }
    if (inString) {
      if (char === "\\" && !escapeNext) {
        escapeNext = true;
      } else {
        escapeNext = false;
      }
      continue;
    }

    // Gestion des commentaires // et /* */
    if (char === "/" && nextChar === "/" && !inString && !inTemplate) {
      // Skip to end of line
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && nextChar === "*" && !inString && !inTemplate) {
      i += 2;
      while (i < code.length - 1 && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i++; // skip */
      continue;
    }

    // Parenthèses, accolades, crochets
    if (opening.includes(char) && !inString && !inTemplate) {
      stack.push(char);
    } else if (closing.includes(char) && !inString && !inTemplate) {
      if (stack.length === 0) {
        return `Parenthèse/accolade/crochet fermant inattendu '${char}' à la position ${i}`;
      }
      const last = stack.pop();
      if (last === "${") {
        if (char !== "}") {
          return `Fermeture de template string attendue '}' mais trouvé '${char}' à la position ${i}`;
        }
      } else if (pairs[last as keyof typeof pairs] !== char) {
        return `Mismatch: '${last}' ouvert mais '${char}' fermant à la position ${i}`;
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return `Parenthèse/accolade/crochet non fermé: '${unclosed}' (${stack.length} non fermés au total)`;
  }
  if (inString) return "String non fermée";
  if (inTemplate) return "Template string non fermé";
  return null;
}

/**
 * Vérifie la syntaxe TypeScript d'un code source via l'API TypeScript Compiler.
 * Retourne null si OK, sinon un message d'erreur lisible.
 */
export function checkTypeScriptSyntax(code: string, filePath: string): string | null {
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  // Options minimales sans lib explicites (utilise les defaults du target)
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Les composants .tsx doivent être analysés avec JSX, comme dans tsconfig.json.
    jsx: filePath.endsWith(".tsx") ? ts.JsxEmit.ReactJSX : undefined,
  };

  const host = ts.createCompilerHost(compilerOptions, true);
  
  // Override seulement pour notre fichier en mémoire
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (f, target, onError) => {
    if (f === filePath) return sourceFile;
    return originalGetSourceFile(f, target, onError);
  };
  
  host.writeFile = () => {};

  const program = ts.createProgram([filePath], compilerOptions, host);
  
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const syntaxErrors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);

  if (syntaxErrors.length === 0) return null;

  const messages = syntaxErrors.map(d => {
    if (d.start === undefined || d.start < 0) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      return `${filePath}: error TS${d.code}: ${msg}`;
    }
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    return `${filePath}(${line + 1},${character + 1}): error TS${d.code}: ${msg}`;
  });

  return messages.join("\n");
}

/**
 * Parse les erreurs de compilation TypeScript brutes (stdout/stderr)
 * en un tableau d'objets d'erreur structurés.
 */
export function parseTsErrors(output: string): ParsedTsError[] {
  if (!output) return [];
  const errors: ParsedTsError[] = [];
  const lines = output.split(/\r?\n/);

  // Gère les deux formats TypeScript:
  // 1. file(line,col): error TSxxxx: message
  // 2. file:line:col - error TSxxxx: message
  const headerRegex = /^(.+?)(?:\((\d+),(\d+)\):\s*|:(\d+):(\d+)\s+-\s*)error TS(\d+): (.*)$/;

  let current: ParsedTsError | null = null;
  for (const line of lines) {
    const m = line.match(headerRegex);
    if (m) {
      if (current) {
        current.message = current.message.trimEnd();
        errors.push(current);
      }
      const lineNo = m[2] !== undefined ? m[2] : m[4];
      const colNo = m[3] !== undefined ? m[3] : m[5];
      current = {
        file: m[1].trim(),
        line: parseInt(lineNo, 10),
        column: parseInt(colNo, 10),
        code: "TS" + m[6],
        message: m[7].trim(),
      };
    } else if (current) {
      if (/^\s/.test(line) || line.length === 0) {
        current.message += (current.message ? "\n" : "") + line;
      } else if (/^[~^]+/.test(line) || /^\s*\d+\s*\|/.test(line)) {
        current.message += (current.message ? "\n" : "") + line;
      } else {
        const isFollowUpMsg = /^    \S/.test(line) === false && /^\S/.test(line) && headerRegex.test(line) === false;
        if (isFollowUpMsg && current.message && current.message.length < 4000) {
          current.message += "\n" + line;
        } else {
          current.message = current.message.trimEnd();
          errors.push(current);
          current = null;
        }
      }
    }
  }
  if (current) {
    current.message = current.message.trimEnd();
    errors.push(current);
  }
  return errors;
}

export interface ParsedLintViolation {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

/**
 * Parse la sortie du linter intégré (scripts/lint.cjs) en tableau structuré.
 * Format: path/file.ts:12:34 - warning no-console: console.log() détecté.
 */
export function parseLintResults(output: string): ParsedLintViolation[] {
  if (!output) return [];
  const violations: ParsedLintViolation[] = [];
  // Pattern: [X:]path/file.ts:12:34 - severity rule: message
  // Using greedy for file to correctly handle Windows drive letters "C:\..."
  // by anchoring on " - <severity>".
  const regex = /^(.+):(\d+):(\d+)\s+-\s+(error|warning|info)\s+([\w-]+):\s*(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    violations.push({
      file: match[1].trim(),
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] as "error" | "warning" | "info",
      rule: match[5],
      message: match[6].trim(),
    });
  }
  return violations;
}

// ── Analyse de Sécurité Statique (SAST) ─────────────────────────────────────

export interface SecurityIssue {
  file: string;
  line: number;
  column: number;
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  suggestion: string;
}

interface SecurityPattern {
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  suggestion: string;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    pattern: /\beval\s*\(/,
    severity: "critical",
    rule: "no-eval",
    message: "Utilisation de eval() détectée — risque d'injection de code.",
    suggestion: "Utiliser JSON.parse(), des alternatives typées ou un parseur dédié.",
  },
  {
    pattern: /new\s+Function\s*\(/,
    severity: "critical",
    rule: "no-new-function",
    message: "Utilisation de new Function() détectée — équivalent à eval().",
    suggestion: "Remplacer par une fonction typée ou un module dédié.",
  },
  {
    pattern: /child_process.*exec\s*\(/,
    severity: "high",
    rule: "no-shell-exec",
    message: "Utilisation de exec() (shell) détectée — risque d'injection de commande.",
    suggestion: "Utiliser execFile() avec des arguments séparés (pas de shell).",
  },
  {
    pattern: /\bexec\s*\(\s*[`'"]\s*\$\{/,
    severity: "critical",
    rule: "no-command-injection",
    message: "Interpolation de variable dans une commande shell — injection possible.",
    suggestion: "Utiliser execFile() avec un tableau d'arguments échappés.",
  },
  {
    pattern: /innerHTML\s*=/,
    severity: "high",
    rule: "no-innerhtml",
    message: "Assignation directe à innerHTML — risque de XSS.",
    suggestion: "Utiliser textContent, ou un framework avec échappement automatique (React JSX).",
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    severity: "medium",
    rule: "no-dangerously-set-html",
    message: "Utilisation de dangerouslySetInnerHTML — vérifier la sanitization.",
    suggestion: "S'assurer que le contenu est sanitizé avec DOMPurify ou équivalent.",
  },
  {
    pattern: /(?:password|secret|api[_-]?key|token|private[_-]?key)\s*[:=]\s*["'`][^"'`]{4,}/i,
    severity: "critical",
    rule: "no-hardcoded-secrets",
    message: "Secret potentiel codé en dur détecté.",
    suggestion: "Utiliser des variables d'environnement ou un gestionnaire de secrets.",
  },
  {
    pattern: /crypto\.createCipher\b/,
    severity: "high",
    rule: "no-deprecated-crypto",
    message: "crypto.createCipher est déprécié et non sécurisé.",
    suggestion: "Utiliser crypto.createCipheriv() avec un IV aléatoire.",
  },
  {
    pattern: /Math\.random\s*\(\)/,
    severity: "medium",
    rule: "no-math-random-crypto",
    message: "Math.random() utilisé — non cryptographiquement sécurisé.",
    suggestion: "Pour des usages crypto, utiliser crypto.randomBytes() ou crypto.getRandomValues().",
  },
  {
    pattern: /require\s*\(\s*[^'"]/,
    severity: "medium",
    rule: "no-dynamic-require",
    message: "require() dynamique détecté — peut charger des modules non fiables.",
    suggestion: "Utiliser des imports statiques ou valider le chemin avant require().",
  },
  {
    pattern: /process\.env\.\w+/,
    severity: "low",
    rule: "env-usage",
    message: "Accès direct à process.env — vérifier la validation.",
    suggestion: "Valider avec zod ou une couche de config typée.",
  },
  {
    pattern: /disable.*(?:eslint|tslint|prettier)/i,
    severity: "low",
    rule: "no-lint-disable",
    message: "Directive de désactivation de linter détectée.",
    suggestion: "Corriger le problème plutôt que désactiver la règle.",
  },
];

/**
 * Analyse de sécurité statique (SAST) sur le code source.
 * Détecte les patterns dangereux courants.
 */
export function runSecurityAnalysis(code: string, filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const lines = code.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignorer les commentaires
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    for (const sp of SECURITY_PATTERNS) {
      const match = line.match(sp.pattern);
      if (match) {
        // Éviter les faux positifs pour env-usage dans les fichiers de config
        if (sp.rule === "env-usage" && (filePath.includes("config") || filePath.includes(".env"))) continue;
        // Éviter les faux positifs pour Math.random dans les tests
        if (sp.rule === "no-math-random-crypto" && /\.(test|spec)\./i.test(filePath)) continue;

        issues.push({
          file: filePath,
          line: i + 1,
          column: match.index !== undefined ? match.index + 1 : 1,
          severity: sp.severity,
          rule: sp.rule,
          message: sp.message,
          suggestion: sp.suggestion,
        });
      }
    }
  }

  return issues;
}

// ── Cache de tests (optimisation) ───────────────────────────────────────────

export function computeFileHash(filePath: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath, "utf-8")).digest("hex");
  } catch {
    return "unreadable";
  }
}

function combineOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join("\n");
}

function processResultFromError(error: any): ProcessResult {
  const stdout = truncate(typeof error?.stdout === "string" ? error.stdout : "");
  const stderr = truncate(typeof error?.stderr === "string" ? error.stderr : (error?.message || "Erreur inconnue"));
  const rawCode = error?.code;
  const exitCode = typeof rawCode === "number" ? rawCode : null;
  return {
    ok: false,
    stdout,
    stderr,
    exitCode,
    signal: typeof error?.signal === "string" ? error.signal : null,
    timedOut: rawCode === "ETIMEDOUT" || error?.killed === true && rawCode === "ETIMEDOUT",
  };
}

function resultExitCode(results: Array<ProcessResult | null>): number | null {
  const failed = results.find((result) => result && !result.ok);
  return failed?.exitCode ?? (failed ? 1 : 0);
}

function formatProcessFailure(result: ProcessResult): string {
  return combineOutput(result.stdout, result.stderr) || `Processus échoué (code ${result.exitCode ?? "inconnu"}).`;
}

function getCachedTestResult(testFile: string, sourceFile: string): ProcessResult | null {
  const cacheKey = `${testFile}:${sourceFile}`;
  const entry = testCache.get(cacheKey);
  if (!entry) return null;

  // Vérifier TTL
  if (Date.now() - entry.timestamp > TEST_CACHE_TTL_MS) {
    testCache.delete(cacheKey);
    return null;
  }

  // Both source and associated test must be unchanged. This prevents reusing a
  // passing test result after either side was edited during a repair loop.
  if (computeFileHash(sourceFile) !== entry.hash || computeFileHash(path.join(getProjectRoot(), testFile)) !== entry.testHash) {
    testCache.delete(cacheKey);
    return null;
  }

  return entry.result;
}

function setCachedTestResult(testFile: string, sourceFile: string, result: ProcessResult): void {
  const cacheKey = `${testFile}:${sourceFile}`;
  testCache.set(cacheKey, {
    hash: computeFileHash(sourceFile),
    testHash: computeFileHash(path.join(getProjectRoot(), testFile)),
    result,
    timestamp: Date.now(),
  });
}

async function runAllowed(cmd: "tsc" | "npm-test" | "npm-run", args: string[] = []): Promise<ProcessResult> {
  const root = getProjectRoot();
  const isWin = process.platform === "win32";

  const npxBin = isWin ? "npx.cmd" : "npx";
  const npmBin = isWin ? "npm.cmd" : "npm";

  // Depuis le correctif CVE-2024-27980 (Node 18.20/20.12/21+), lancer un
  // fichier .cmd/.bat via child_process sans `shell: true` lève EINVAL sur
  // Windows. On active donc le shell uniquement sur Windows. Les arguments
  // restent passés sous forme de tableau et le nom de script est déjà validé
  // contre une liste blanche en amont : pas d'interpolation de valeur non fiable.
  const opts = {
    cwd: root,
    timeout: TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    shell: isWin,
    env: { ...process.env },
  };

  try {
    let result;
    if (cmd === "tsc") {
      result = await execFileAsync(npxBin, ["tsc", "--noEmit", "--incremental", ...args], opts);
    } else if (cmd === "npm-test") {
      // runAllowed ajoute déjà le séparateur npm; l'appelant ne doit pas en ajouter un second.
      result = await execFileAsync(npmBin, ["test", "--", ...args], opts);
    } else {
      result = await execFileAsync(npmBin, ["run", ...args], opts);
    }
    return {
      ok: true,
      stdout: truncate(result.stdout || ""),
      stderr: truncate(result.stderr || ""),
      exitCode: 0,
      signal: null,
      timedOut: false,
    };
  } catch (e: any) {
    return processResultFromError(e);
  }
}

/** Typecheck ciblé avec les options du tsconfig sans échouer sur les erreurs hors du fichier vérifié. */
function typecheckFileWithProjectConfig(relativePath: string, absolutePath: string): ProcessResult {
  try {
    const root = getProjectRoot();
    const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
      return { ok: false, stdout: "", stderr: "tsconfig.json introuvable pour la vérification TypeScript.", exitCode: 1 };
    }

    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) {
      return {
        ok: false,
        stdout: "",
        stderr: ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
        exitCode: 1,
      };
    }

    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    const targetPath = path.resolve(absolutePath);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([targetPath], parsed.options))
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .filter((diagnostic) => !diagnostic.file || path.resolve(diagnostic.file.fileName) === targetPath);

    const errors = diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) {
        return `${relativePath}: error TS${diagnostic.code}: ${message}`;
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${relativePath}(${position.line + 1},${position.character + 1}): error TS${diagnostic.code}: ${message}`;
    });
    const stderr = truncate(errors.join("\n"));
    return { ok: errors.length === 0, stdout: "", stderr, exitCode: errors.length === 0 ? 0 : 1 };
  } catch (error) {
    return { ok: false, stdout: "", stderr: truncate((error as Error).message), exitCode: 1 };
  }
}

export function findAssociatedTestFile(relativePath: string): string | null {
  const root = getProjectRoot();
  const normalizedRel = path.normalize(relativePath).replace(/\\/g, "/");
  const ext = path.extname(normalizedRel);
  const dir = path.dirname(normalizedRel);
  const filename = path.basename(normalizedRel, ext);

  // Si le fichier est déjà un fichier de test (*.test.ts, *.spec.ts, etc.)
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(normalizedRel)) {
    if (fs.existsSync(path.join(root, normalizedRel))) return normalizedRel;
  }

  const candidates = [
    `${dir}/${filename}.test${ext}`,
    `${dir}/${filename}.spec${ext}`,
    `${dir}/__tests__/${filename}.test${ext}`,
    `${dir}/__tests__/${filename}.spec${ext}`,
    `${dir}/__tests__/${filename}${ext}`,
    `tests/${normalizedRel}`,
    `test/${normalizedRel}`,
    `tests/${dir}/${filename}.test${ext}`,
    `test/${dir}/${filename}.test${ext}`,
  ];

  for (const c of candidates) {
    const candidatePath = path.normalize(c).replace(/\\/g, "/");
    if (fs.existsSync(path.join(root, candidatePath))) return candidatePath;
  }
  return null;
}

const ALLOWED_SCRIPTS = new Set(["build", "lint", "typecheck", "test"]);

/**
 * Exécute le linter intégré directement via node (scripts/lint.cjs).
 * Plus fiable que de passer par npm run lint car on contrôle l'appel.
 */
async function runLintDirect(targets: string[] = []): Promise<ProcessResult & { output: string; violations: ParsedLintViolation[] }> {
  const root = getProjectRoot();
  const isWin = process.platform === "win32";
  const nodeBin = isWin ? "node.exe" : "node";
  const lintScript = path.join(root, "scripts", "lint.cjs");

  if (!fs.existsSync(lintScript)) {
    const stdout = "scripts/lint.cjs introuvable — lint ignoré.";
    return { ok: true, stdout, stderr: "", output: stdout, exitCode: 0, violations: [] };
  }

  try {
    const result = await execFileAsync(nodeBin, [lintScript, ...targets], {
      cwd: root,
      timeout: TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      shell: false, // node est un binaire natif, pas besoin de shell
    });
    const stdout = truncate(result.stdout || "");
    const stderr = truncate(result.stderr || "");
    const output = combineOutput(stdout, stderr);
    return { ok: true, stdout, stderr, output, exitCode: 0, violations: parseLintResults(output) };
  } catch (e: any) {
    const failed = processResultFromError(e);
    const output = combineOutput(failed.stdout, failed.stderr);
    return { ...failed, output, violations: parseLintResults(output) };
  }
}

async function runFormatDirect(target: string): Promise<ProcessResult> {
  const root = getProjectRoot();
  const nodeBin = process.platform === "win32" ? "node.exe" : "node";
  const lintScript = path.join(root, "scripts", "lint.cjs");
  try {
    const result = await execFileAsync(nodeBin, [lintScript, "--fix", target], {
      cwd: root,
      timeout: TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      shell: false, // node est un binaire natif, pas besoin de shell
    });
    return { ok: true, stdout: truncate(result.stdout || ""), stderr: truncate(result.stderr || ""), exitCode: 0 };
  } catch (error: any) {
    return processResultFromError(error);
  }
}

export const verifySkill: Skill = {
  name: "verify",
  declarations: [
    {
      name: "verify_typecheck",
      description: "Vérifie la compilation TypeScript de tout le projet (tsc --noEmit --incremental). À exécuter après toute modification d'un fichier .ts/.tsx avant de considérer la tâche terminée.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "verify_file",
      description: "Vérifie un fichier modifié : lance lint + typecheck TypeScript ciblé avec les options du tsconfig + analyse sécurité + tests associés en parallèle. Retourne un rapport structuré avec fichier/ligne/colonne pour chaque problème.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif du fichier modifié (ex: server/skills/codebase.ts)." },
        },
        required: ["path"],
      },
    },
    {
      name: "verify_run_script",
      description: "Exécute un script npm de la liste autorisée (build, lint, typecheck, test) défini dans package.json. Aucun autre script ou commande arbitraire n'est accepté.",
      parameters: {
        type: "OBJECT",
        properties: {
          script: { type: "STRING", description: "Nom du script npm à exécuter : build, lint, typecheck ou test." },
        },
        required: ["script"],
      },
    },
    {
      name: "verify_format",
      description: "Formate uniquement le fichier modifié (espaces finaux et fin de ligne), sans toucher aux autres fichiers.",
      parameters: {
        type: "OBJECT",
        properties: { path: { type: "STRING", description: "Chemin relatif du fichier modifié." } },
        required: ["path"],
      },
    },
    {
      name: "verify_lint",
      description: "Exécute le linter statique intégré (scripts/lint.cjs) directement sur les dossiers src/ et server/. Retourne un rapport structuré (fichier, ligne, colonne, sévérité, règle, message).",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "verify_security",
      description: "Analyse de sécurité statique (SAST) d'un fichier ou d'un code source. Détecte eval(), new Function(), secrets en dur, injections, innerHTML, crypto faible, etc. Retourne les issues avec sévérité et suggestion de correction.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Chemin relatif du fichier à analyser. Mutuellement exclusif avec 'code'." },
          code: { type: "STRING", description: "Code source à analyser directement. Mutuellement exclusif avec 'path'." },
          filePath: { type: "STRING", description: "Chemin virtuel (pour déterminer le contexte). Requis si 'code' est fourni." },
        },
      },
    },
    {
      name: "verify_syntax",
      description: "Vérification syntaxique standalone (équilibre accolades/parenthèses/quotes + syntaxe TypeScript via API TS compiler) SANS lancer tsc ni tests. Rapide, pour valider un code avant apply.",
      parameters: {
        type: "OBJECT",
        properties: {
          code: { type: "STRING", description: "Code source à valider (string brute)." },
          filePath: { type: "STRING", description: "Chemin relatif du fichier (ex: server/skills/foo.ts) pour déterminer TS/TSX et résolution imports." },
        },
        required: ["code", "filePath"],
      },
    },
    {
      name: "verify_full",
      description: "Vérification complète : typecheck + lint + sécurité sur tout le projet. Retourne un rapport consolidé avec tous les problèmes classés par sévérité.",
      parameters: { type: "OBJECT", properties: {} },
    },
  ],
  inputSchemas: {
    verify_typecheck: z.object({}),
    verify_file: z.object({ path: z.string().min(1) }),
    verify_format: z.object({ path: z.string().min(1) }),
    verify_run_script: z.object({ script: z.enum(["build", "lint", "typecheck", "test"]) }),
    verify_lint: z.object({}),
    verify_security: z.object({
      path: z.string().optional(),
      code: z.string().optional(),
      filePath: z.string().optional(),
    }).refine(data => data.path || data.code, { message: "Il faut fournir 'path' ou 'code'." }),
    verify_syntax: z.object({ code: z.string(), filePath: z.string().min(1) }),
    verify_full: z.object({}),
  },
  handleToolCall: async (name, args) => {
    try {
      if (name === "verify_typecheck") {
        validateArgs(verifySkill.inputSchemas!["verify_typecheck"], args);
        const result = await runAllowed("tsc");
        const rawOutput = combineOutput(result.stdout, result.stderr);
        const parsedErrors = parseTsErrors(rawOutput);
        return {
          status: result.ok ? "success" : "failed",
          ok: result.ok,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          message: result.ok ? "Aucune erreur de typage." : `Erreurs de typage détectées (code ${result.exitCode ?? "inconnu"}), à corriger avant de continuer.`,
          output: rawOutput,
          parsedErrors,
        };
      }

      if (name === "verify_file") {
        const validated = validateArgs(verifySkill.inputSchemas!["verify_file"], args);
        const abs = normalizeProjectPath(validated.path);
        if (!abs || !fs.existsSync(abs)) {
          const message = `Fichier introuvable dans le workspace: ${validated.path}`;
          return {
            status: "failed",
            ok: false,
            exitCode: null,
            stdout: "",
            stderr: message,
            file: validated.path,
            contentHash: "",
            verifiedAt: new Date().toISOString(),
            message,
            error: message,
            issues: [{ type: "configuration", file: validated.path, line: null, column: null, severity: "error", rule: "file-not-found", message }],
            allIssues: [{ type: "configuration", file: validated.path, line: null, column: null, severity: "error", rule: "file-not-found", message }],
          };
        }

        // ─── PRÉ-VALIDATION SYNTAXIQUE (TypeScript API) ──────────────────────
        const hashBefore = computeFileHash(abs);
        const code = fs.readFileSync(abs, "utf-8");
        const ext = path.extname(validated.path).toLowerCase();
        const isTypeScript = ext === ".ts" || ext === ".tsx";
        let tsSyntaxError: string | null = null;
        if (isTypeScript) {
          tsSyntaxError = checkTypeScriptSyntax(code, validated.path);
          if (tsSyntaxError) {
            const syntaxHash = computeFileHash(abs);
            const syntaxIssues: VerificationIssue[] = [{ type: "typecheck", file: validated.path, line: null, column: null, severity: "error", rule: "syntax", message: tsSyntaxError }];
            const verificationRecord: VerificationRecord = { file: validated.path, contentHash: syntaxHash, hashBefore, hashAfter: syntaxHash, verifiedAt: new Date().toISOString(), ok: false, status: hashBefore === syntaxHash ? "failed" : "stale", issues: syntaxIssues, allIssues: syntaxIssues };
            return {
              status: "failed", ok: false, exitCode: 1, stdout: "", stderr: tsSyntaxError, file: validated.path,
              contentHash: syntaxHash, verifiedAt: verificationRecord.verifiedAt, issues: syntaxIssues, allIssues: syntaxIssues,
              verificationRecord, prevalidation: { tsSyntax: false, error: tsSyntaxError },
              typecheck: { ok: false, exitCode: 1, stdout: "", stderr: tsSyntaxError, output: tsSyntaxError, errors: parseTsErrors(tsSyntaxError) }, lint: null, test: null,
            };
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        // Analyse de sécurité (SAST)
        const securityIssues = runSecurityAnalysis(code, validated.path);
        const criticalSecurity = securityIssues.filter(i => i.severity === "critical" || i.severity === "high");

        // Vérification ciblée : uniquement les fichiers .ts/.tsx
        const testFile = findAssociatedTestFile(validated.path);

        // Parallélisation intelligente : lint, typecheck et tests lancés simultanément
        const lintPromise = runLintDirect([validated.path]);

        const typecheckPromise: Promise<ProcessResult> = isTypeScript
          ? Promise.resolve(typecheckFileWithProjectConfig(validated.path, abs))
          : Promise.resolve({ ok: true, stdout: "", stderr: "", exitCode: 0 });

        // Tests avec cache — évite de relancer si le fichier source n'a pas changé
        const testPromise = testFile
          ? (async () => {
              const cached = getCachedTestResult(testFile, abs);
              if (cached) return { ...cached, fromCache: true };
              const result = await runAllowed("npm-test", [testFile]);
              setCachedTestResult(testFile, abs, result);
              return { ...result, fromCache: false };
            })()
          : Promise.resolve(null);

        const [lintResult, typecheck, testResult] = await Promise.all([lintPromise, typecheckPromise, testPromise]);

        const tcOutput = combineOutput(typecheck.stdout, typecheck.stderr);
        const parsedErrors = parseTsErrors(tcOutput);
        const hasLintErrors = lintResult.violations.some((v) => v.severity === "error");
        const lintOk = lintResult.ok && !hasLintErrors;
        const ok = lintOk && typecheck.ok && (!testResult || testResult.ok) && criticalSecurity.length === 0;
        const phaseResults = [typecheck, lintResult, testResult].filter(Boolean) as ProcessResult[];
        const failureOutput = phaseResults
          .filter((phase) => !phase.ok)
          .map(formatProcessFailure)
          .filter(Boolean)
          .join("\n");

        const allIssues: VerificationIssue[] = [
          ...parsedErrors.map(e => ({ type: "typecheck", file: e.file, line: e.line, column: e.column, severity: "error" as const, rule: e.code, message: e.message })),
          ...lintResult.violations.map(v => ({ type: "lint", file: v.file, line: v.line, column: v.column, severity: v.severity as VerificationIssue["severity"], rule: v.rule, message: v.message })),
          ...securityIssues.map(i => ({ type: "security", file: i.file, line: i.line, column: i.column, severity: i.severity as VerificationIssue["severity"], rule: i.rule, message: i.message, suggestion: i.suggestion })),
        ];
        if (!typecheck.ok && parsedErrors.length === 0) {
          allIssues.push({ type: "typecheck", file: validated.path, line: null, column: null, severity: "error", rule: "tsc", message: formatProcessFailure(typecheck) });
        }
        if (!lintOk && lintResult.violations.length === 0) {
          allIssues.push({ type: "lint", file: validated.path, line: null, column: null, severity: "error", rule: "lint-process", message: formatProcessFailure(lintResult) });
        }
        if (testResult && !testResult.ok) {
          allIssues.push({ type: "test", file: testFile ?? validated.path, line: null, column: null, severity: "error", rule: "test-process", message: formatProcessFailure(testResult) });
        }
        const hashAfter = computeFileHash(abs);
        const stale = hashBefore !== hashAfter;
        const verificationOk = ok && !stale;
        // fileChanged = le contenu du fichier a réellement changé depuis le début de verify_file.
        // Utilisé par l'AgentExecutor pour distinguer "patch appliqué avec erreurs préexistantes"
        // de "vérification bloquée sans aucune modification".
        const fileChanged = hashBefore !== hashAfter;
        const verificationRecord: VerificationRecord = {
          file: validated.path,
          contentHash: hashAfter,
          hashBefore,
          hashAfter,
          verifiedAt: new Date().toISOString(),
          ok: verificationOk,
          status: stale ? "stale" : verificationOk ? "success" : "failed",
          issues: allIssues.filter((issue) => issue.severity === "error" || issue.severity === "critical"),
          allIssues,
        };

        // Construire un rapport uniforme : chaque phase expose les deux flux et le code de sortie.
        const report: any = {
          status: verificationOk ? "success" : "failed",
          ok: verificationOk,
          // fileChanged est vrai dès que le fichier a été modifié sur disque, indépendamment
          // du résultat du typecheck/lint. L'AgentExecutor l'utilise pour comptabiliser
          // le patch même quand des erreurs préexistantes font échouer la vérification.
          fileChanged,
          exitCode: resultExitCode([typecheck, lintResult, testResult]),
          stdout: [typecheck.stdout, lintResult.stdout, testResult?.stdout].filter(Boolean).join("\n"),
          stderr: [typecheck.stderr, lintResult.stderr, testResult?.stderr].filter(Boolean).join("\n"),
          message: ok
            ? `✅ Vérification OK pour ${validated.path}${testFile ? ` (tests: ${testFile})` : " (aucun test associé)"}.`
            : `❌ Échec de vérification (code ${resultExitCode([typecheck, lintResult, testResult]) ?? "inconnu"}) — corriger avant de considérer la tâche terminée.\n${failureOutput}`,
          file: validated.path,
          contentHash: verificationRecord.contentHash,
          verifiedAt: verificationRecord.verifiedAt,
          issues: verificationRecord.issues,
          verificationRecord,
          parsedErrors,
          typecheck: {
            ok: typecheck.ok,
            exitCode: typecheck.exitCode,
            stdout: typecheck.stdout,
            stderr: typecheck.stderr,
            output: tcOutput,
            errors: parsedErrors,
          },
          lint: {
            ok: lintOk,
            exitCode: lintResult.exitCode,
            stdout: lintResult.stdout,
            stderr: lintResult.stderr,
            output: lintResult.output,
            violations: lintResult.violations,
            summary: {
              errors: lintResult.violations.filter(v => v.severity === "error").length,
              warnings: lintResult.violations.filter(v => v.severity === "warning").length,
              infos: lintResult.violations.filter(v => v.severity === "info").length,
            },
          },
          security: {
            ok: criticalSecurity.length === 0,
            issues: securityIssues,
            summary: {
              critical: securityIssues.filter(i => i.severity === "critical").length,
              high: securityIssues.filter(i => i.severity === "high").length,
              medium: securityIssues.filter(i => i.severity === "medium").length,
              low: securityIssues.filter(i => i.severity === "low").length,
            },
          },
          test: testResult ? {
            file: testFile,
            ok: testResult.ok,
            exitCode: testResult.exitCode,
            stdout: testResult.stdout,
            stderr: testResult.stderr,
            output: combineOutput(testResult.stdout, testResult.stderr),
            fromCache: (testResult as any).fromCache || false,
          } : null,
          allIssues,
        };

        return report;
      }

      if (name === "verify_run_script") {
        const validated = validateArgs(verifySkill.inputSchemas!["verify_run_script"], args);
        if (!ALLOWED_SCRIPTS.has(validated.script)) {
          return { error: `Script non autorisé: ${validated.script}. Scripts autorisés: ${Array.from(ALLOWED_SCRIPTS).join(", ")}` };
        }
        const result = await runAllowed("npm-run", [validated.script]);
        return {
          status: result.ok ? "success" : "failed",
          ok: result.ok,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          message: result.ok ? `Script ${validated.script} exécuté avec succès.` : `Échec du script ${validated.script} (code ${result.exitCode ?? "inconnu"}).`,
          output: combineOutput(result.stdout, result.stderr),
          error: result.ok ? undefined : formatProcessFailure(result),
        };
      }

      if (name === "verify_lint") {
        validateArgs(verifySkill.inputSchemas!["verify_lint"], args);
        const lintResult = await runLintDirect();
        const summary = {
          total: lintResult.violations.length,
          errors: lintResult.violations.filter(v => v.severity === "error").length,
          warnings: lintResult.violations.filter(v => v.severity === "warning").length,
          infos: lintResult.violations.filter(v => v.severity === "info").length,
        };
        return {
          status: lintResult.ok && summary.errors === 0 ? "success" : "failed",
          ok: lintResult.ok && summary.errors === 0,
          exitCode: lintResult.exitCode,
          stdout: lintResult.stdout,
          stderr: lintResult.stderr,
          message: lintResult.ok && summary.errors === 0 ? "✅ Lint OK — aucune erreur." : `❌ Lint : ${summary.errors} erreur(s), ${summary.warnings} avertissement(s), ${summary.infos} info(s).`,
          output: lintResult.output,
          violations: lintResult.violations,
          summary,
        };
      }

      if (name === "verify_format") {
        const validated = validateArgs(verifySkill.inputSchemas!["verify_format"], args);
        const abs = normalizeProjectPath(validated.path);
        if (!abs || !fs.existsSync(abs)) return { status: "failed", ok: false, error: `Fichier introuvable: ${validated.path}` };
        const result = await runFormatDirect(validated.path);
        return {
          status: result.ok ? "success" : "failed",
          ok: result.ok,
          path: validated.path,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          message: result.ok ? `Formatage ciblé terminé pour ${validated.path}.` : `Échec du formatage ciblé pour ${validated.path}.`,
        };
      }

      if (name === "verify_syntax") {
        const validated = validateArgs(verifySkill.inputSchemas!["verify_syntax"], args);
        const bracketError = checkBracketBalance(validated.code);
        let tsSyntaxError: string | null = null;
        const ext = path.extname(validated.filePath).toLowerCase();
        const isTypeScript = ext === ".ts" || ext === ".tsx";
        if (isTypeScript) {
          tsSyntaxError = checkTypeScriptSyntax(validated.code, validated.filePath);
        }
        // Pour TS/TSX, TypeScript est l'arbitre : le scan de crochets est
        // uniquement un signal rapide et peut produire des faux positifs.
        const syntaxError = isTypeScript ? tsSyntaxError : bracketError;
        const ok = !syntaxError;
        return {
          status: ok ? "success" : "failed",
          message: ok
            ? (isTypeScript && bracketError ? "✅ Syntaxe TypeScript OK (précheck de crochets non bloquant)." : "✅ Syntaxe OK.")
            : (syntaxError || "Erreur de syntaxe"),
          bracketBalance: !bracketError,
          tsSyntax: !tsSyntaxError,
          error: syntaxError,
        };
      }

      if (name === "verify_security") {
        const validated = validateArgs(verifySkill.inputSchemas!["verify_security"], args);
        let code: string;
        let filePath: string;

        if (validated.path) {
          const abs = normalizeProjectPath(validated.path);
          if (!abs || !fs.existsSync(abs)) {
            return { error: `Fichier introuvable: ${validated.path}` };
          }
          code = fs.readFileSync(abs, "utf-8");
          filePath = validated.path;
        } else if (validated.code) {
          code = validated.code;
          filePath = validated.filePath || "anonymous.ts";
        } else {
          return { error: "Il faut fournir 'path' ou 'code'." };
        }

        const issues = runSecurityAnalysis(code, filePath);
        const summary = {
          total: issues.length,
          critical: issues.filter(i => i.severity === "critical").length,
          high: issues.filter(i => i.severity === "high").length,
          medium: issues.filter(i => i.severity === "medium").length,
          low: issues.filter(i => i.severity === "low").length,
        };
        const hasCritical = summary.critical > 0 || summary.high > 0;

        return {
          status: hasCritical ? "failed" : "success",
          message: hasCritical
            ? `🔴 ${summary.critical} critique(s), ${summary.high} haute(s) — correction requise.`
            : issues.length > 0
              ? `🟡 ${issues.length} issue(s) de sécurité (non bloquantes).`
              : "🟢 Aucun problème de sécurité détecté.",
          issues,
          summary,
        };
      }

      if (name === "verify_full") {
        validateArgs(verifySkill.inputSchemas!["verify_full"], args);

        // Lancer tout en parallèle
        const [typecheckResult, lintResult] = await Promise.all([
          runAllowed("tsc"),
          runLintDirect(),
        ]);

        // Analyse de sécurité sur les fichiers modifiés récemment (src/ et server/)
        const root = getProjectRoot();
        const securityFiles: string[] = [];
        for (const sub of ["src", "server"]) {
          const dir = path.join(root, sub);
          if (fs.existsSync(dir)) {
            const walk = (d: string) => {
              try {
                const entries = fs.readdirSync(d, { withFileTypes: true });
                for (const entry of entries) {
                  const full = path.join(d, entry.name);
                  if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                    walk(full);
                  } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
                    securityFiles.push(full);
                  }
                }
              } catch { /* skip */ }
            };
            walk(dir);
          }
        }

        const allSecurityIssues: SecurityIssue[] = [];
        for (const file of securityFiles.slice(0, 200)) { // limiter à 200 fichiers
          try {
            const code = fs.readFileSync(file, "utf-8");
            const relPath = path.relative(root, file).replace(/\\/g, "/");
            const issues = runSecurityAnalysis(code, relPath);
            allSecurityIssues.push(...issues);
          } catch { /* skip */ }
        }

        const tcOutput = combineOutput(typecheckResult.stdout, typecheckResult.stderr);
        const parsedErrors = parseTsErrors(tcOutput);
        const hasLintErrors = lintResult.violations.some(v => v.severity === "error");
        const criticalSecurity = allSecurityIssues.filter(i => i.severity === "critical" || i.severity === "high");
        const ok = typecheckResult.ok && !hasLintErrors && criticalSecurity.length === 0;

        return {
          status: ok ? "success" : "failed",
          message: ok
            ? "✅ Vérification complète réussie."
            : "❌ Des problèmes ont été détectés — voir le rapport ci-dessous.",
          typecheck: {
            ok: typecheckResult.ok,
            errorCount: parsedErrors.length,
            errors: parsedErrors.slice(0, 20), // Top 20 erreurs
          },
          lint: {
            ok: !hasLintErrors,
            summary: {
              errors: lintResult.violations.filter(v => v.severity === "error").length,
              warnings: lintResult.violations.filter(v => v.severity === "warning").length,
              infos: lintResult.violations.filter(v => v.severity === "info").length,
            },
            violations: lintResult.violations.slice(0, 30), // Top 30 violations
          },
          security: {
            ok: criticalSecurity.length === 0,
            summary: {
              critical: allSecurityIssues.filter(i => i.severity === "critical").length,
              high: allSecurityIssues.filter(i => i.severity === "high").length,
              medium: allSecurityIssues.filter(i => i.severity === "medium").length,
              low: allSecurityIssues.filter(i => i.severity === "low").length,
              filesScanned: securityFiles.length,
            },
            issues: allSecurityIssues.filter(i => i.severity === "critical" || i.severity === "high").slice(0, 20),
          },
        };
      }

      throw new Error(`Unknown tool in verify: ${name}`);
    } catch (e: any) {
      const message = e.message || "Erreur inconnue";
      if (name === "verify_file") {
        return {
          status: "failed",
          ok: false,
          exitCode: typeof e.code === "number" ? e.code : null,
          stdout: typeof e.stdout === "string" ? truncate(e.stdout) : "",
          stderr: typeof e.stderr === "string" ? truncate(e.stderr) : message,
          message,
          error: message,
          allIssues: [{ type: "verification", file: args?.path ?? null, line: null, column: null, severity: "error", rule: "verify-exception", message }],
        };
      }
      return { error: message };
    }
  },
};