import fs from "fs";
import path from "path";
import { SELF_ROOT } from "../utils/selfRoot.js";

export interface HealAttempt {
  skillPath: string;
  error: string;
  timestamp: number;
  success: boolean;
  patchApplied: string | null;
  verificationResult: any;
  rolledBack: boolean;
  /** true when SELF_HEAL_READONLY=true — analyse only, no file written */
  dryRun?: boolean;
  /** Human-readable description of the fix that would have been applied */
  aiThought?: string | null;
  proposedFix?: string;
}

export interface ErrorPattern {
  /** Identifiant du pattern */
  id: string;
  /** Fonction qui teste si le pattern correspond à l'erreur */
  match: (error: Error, fileContent: string) => boolean;
  /** Fonction qui génère le patch (nouveau contenu) */
  fix: (error: Error, fileContent: string, filePath?: string) => string | null;
  /** Description lisible du pattern */
  description: string;
}

const KNOWN_IMPORTS: Record<string, string> = {
  fs: 'import fs from "fs";',
  path: 'import path from "path";',
  z: 'import { z } from "zod";',
  puppeteer: 'import puppeteer from "puppeteer";',
  WebSocket: 'import { WebSocket } from "ws";',
  assert: 'import assert from "node:assert/strict";',
  test: 'import test from "node:test";',
};

function findExportingFile(symbolName: string, dir: string, depth = 0): string | null {
  if (depth > 6) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.Leanna') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findExportingFile(symbolName, fullPath, depth + 1);
        if (found) return found;
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const regexes = [
          new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const|let|var|interface|type|abstract\\s+class)\\s+${symbolName}\\b`),
          new RegExp(`export\\s+\\{[^}]*\\b${symbolName}\\b[^}]*\\}`)
        ];
        if (regexes.some(r => r.test(content))) {
          return fullPath;
        }
      }
    }
  } catch {
    // ignoré
  }
  return null;
}

export const ERROR_PATTERNS: ErrorPattern[] = [
  {
    id: "missing-property",
    description: "Propriété manquante sur un type/interface",
    match: (error) =>
      error.message.includes("Property") && error.message.includes("does not exist on type"),
    fix: (error, content) => {
      const propMatch = error.message.match(/Property '([^']+)'/);
      const typeMatch = error.message.match(/type '([^']+)'/);
      if (!propMatch) return null;
      const propName = propMatch[1];
      const typeName = typeMatch?.[1];
      const interfaceRegex = typeName
        ? new RegExp(`((?:export\\s+)?interface\\s+${typeName}\\s*\\{)`)
        : /(?:export\s+)?interface\s+(\w+)\s*\{/;
      const match = content.match(interfaceRegex);
      if (match) {
        return content.replace(match[0], `${match[0]}\n  ${propName}?: any; // [auto-heal] ajouté automatiquement`);
      }
      return null;
    },
  },
  {
    id: "missing-import",
    description: "Import manquant",
    match: (error) =>
      error.message.includes("Cannot find name") || error.message.includes("is not defined"),
    fix: (error, content, filePath) => {
      const nameMatch = error.message.match(/Cannot find name '([^']+)'/) ||
        error.message.match(/'([^']+)' is not defined/);
      if (!nameMatch) return null;
      const missingName = nameMatch[1];

      // 1. Check known core modules
      if (KNOWN_IMPORTS[missingName]) {
        return `${KNOWN_IMPORTS[missingName]}\n${content}`;
      }

      // 2. Scan workspace to find exporting file
      if (filePath) {
        const absoluteFilePath = path.resolve(SELF_ROOT, filePath);
        const foundPath = findExportingFile(missingName, SELF_ROOT);
        if (foundPath && foundPath !== absoluteFilePath) {
          let relativePath = path.relative(path.dirname(absoluteFilePath), foundPath);
          relativePath = relativePath.replace(/\\/g, "/").replace(/\.(tsx?|jsx?)$/, "");
          if (!relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
          }
          const importStatement = `import { ${missingName} } from "${relativePath}";`;
          return `${importStatement}\n${content}`;
        }
      }

      // 3. Fallback to comment TODO
      return `// TODO: [auto-heal] Import manquant détecté: ${missingName}\n// Vérifiez d'où importer ce symbole.\n${content}`;
    },
  },
  {
    id: "type-mismatch",
    description: "Erreur d'assignation de type",
    match: (error) =>
      error.message.includes("Type") && error.message.includes("is not assignable to type"),
    fix: (_error, _content) => null,
  },
  {
    id: "missing-return",
    description: "Return manquant dans une fonction",
    match: (error) =>
      error.message.includes("not all code paths return a value") ||
      error.message.includes("A function whose declared type is neither"),
    fix: (_error, _content) => null,
  },
  {
    id: "undefined-access",
    description: "Accès à une propriété potentiellement undefined",
    match: (error) =>
      error.message.includes("possibly 'undefined'") ||
      error.message.includes("possibly 'null'") ||
      error.message.includes("Object is possibly"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum > 0 && lineNum <= lines.length) {
        lines[lineNum - 1] = lines[lineNum - 1] + ' // [auto-heal] TODO: vérifier null/undefined';
      }
      return lines.join('\n');
    },
  },
  {
    id: "runtime-typeerror",
    description: "TypeError runtime (cannot read property of undefined/null)",
    match: (error) =>
      error.message.includes("Cannot read propert") ||
      error.message.includes("is not a function"),
    fix: (_error, _content) => null,
  },
  {
    id: "missing-module",
    description: "Module non trouvé (Cannot find module)",
    match: (error) =>
      error.message.includes("Cannot find module") ||
      error.message.includes("Module not found"),
    fix: (error, content) => {
      const moduleMatch = error.message.match(/Cannot find module '([^']+)'/) ||
        error.message.match(/Module not found.*'([^']+)'/);
      if (!moduleMatch) return null;
      const moduleName = moduleMatch[1];
      if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
        return `// TODO: [auto-heal] Module local introuvable: ${moduleName}\n// Vérifiez que le fichier existe et que le chemin est correct.\n${content}`;
      }
      return `// TODO: [auto-heal] Module npm introuvable: ${moduleName}\n// Exécutez: npm install ${moduleName}\n${content}`;
    },
  },
  {
    id: "duplicate-identifier",
    description: "Identifiant dupliqué dans la même portée",
    match: (error) =>
      error.message.includes("Duplicate identifier") ||
      error.message.includes("has already been declared"),
    fix: (error, content) => {
      const nameMatch = error.message.match(/Duplicate identifier '([^']+)'/) ||
        error.message.match(/'([^']+)' has already been declared/);
      if (!nameMatch) return null;
      const dupName = nameMatch[1];
      const declRegex = new RegExp(
        `^(import\\s+.*${dupName}|(?:export\\s+)?(?:const|let|var|function|class)\\s+${dupName})`,
        'gm'
      );
      const matches = [...content.matchAll(declRegex)];
      if (matches.length > 1) {
        const secondMatch = matches[1];
        const lines = content.split('\n');
        const lineIndex = content.slice(0, secondMatch.index).split('\n').length - 1;
        if (lineIndex >= 0 && lineIndex < lines.length) {
          lines[lineIndex] = `// [auto-heal] DUPLICATE REMOVED: ${lines[lineIndex]}`;
          return lines.join('\n');
        }
      }
      return null;
    },
  },
  {
    id: "unused-variable",
    description: "Variable déclarée mais non utilisée (TS6133)",
    match: (error) =>
      error.message.includes("is declared but its value is never read") ||
      error.message.includes("declared but never used"),
    fix: (error, content) => {
      const nameMatch = error.message.match(/'([^']+)' is declared but/);
      if (!nameMatch) return null;
      const unusedName = nameMatch[1];
      const lines = content.split('\n');
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const declPatterns = [
          new RegExp(`(const|let|var)\\s+${unusedName}\\b`),
          new RegExp(`\\(\\s*${unusedName}\\s*[,:)]`),
          new RegExp(`import\\s+{[^}]*\\b${unusedName}\\b`),
        ];
        for (const pattern of declPatterns) {
          if (pattern.test(line) && !modified) {
            lines[i] = line.replace(
              new RegExp(`\\b${unusedName}\\b`),
              `_${unusedName}`
            );
            modified = true;
            break;
          }
        }
        if (modified) break;
      }
      return modified ? lines.join('\n') : null;
    },
  },
  {
    id: "async-without-await",
    description: "Fonction async sans await (promesse non attendue)",
    match: (error) =>
      error.message.includes("Promises must be awaited") ||
      error.message.includes("Floating promise") ||
      (error.message.includes("async") && error.message.includes("no await")),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/) || error.message.match(/line (\d+)/i);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      const line = lines[lineNum - 1];
      if (!line.trimStart().startsWith('await') && !line.includes('await ')) {
        const indent = line.match(/^(\s*)/)?.[1] || '';
        const trimmed = line.trimStart();
        if (/\w+\(/.test(trimmed) && !trimmed.startsWith('//') && !trimmed.startsWith('return')) {
          lines[lineNum - 1] = `${indent}await ${trimmed}`;
          return lines.join('\n');
        }
      }
      return null;
    },
  },
  {
    id: "missing-semicolon",
    description: "Point-virgule manquant",
    match: (error) =>
      error.message.includes("';' expected") ||
      error.message.includes("Missing semicolon"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),(\d+)\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const colNum = parseInt(lineMatch[2], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      const line = lines[lineNum - 1];
      if (colNum > 0 && colNum <= line.length) {
        lines[lineNum - 1] = line.slice(0, colNum) + ';' + line.slice(colNum);
      } else if (!line.trimEnd().endsWith(';') && !line.trimEnd().endsWith('{') && !line.trimEnd().endsWith('}')) {
        lines[lineNum - 1] = line.trimEnd() + ';';
      }
      return lines.join('\n');
    },
  },
  {
    id: "missing-closing-brace",
    description: "Accolade/parenthèse fermante manquante",
    match: (error) =>
      error.message.includes("'}' expected") ||
      error.message.includes("')' expected") ||
      error.message.includes("']' expected"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),(\d+)\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      let closingChar = '}';
      if (error.message.includes("')'")) closingChar = ')';
      if (error.message.includes("']'")) closingChar = ']';

      const prevLine = lines[lineNum - 1];
      const indent = prevLine.match(/^(\s*)/)?.[1] || '';
      lines.splice(lineNum, 0, `${indent}${closingChar} // [auto-heal] ajouté automatiquement`);
      return lines.join('\n');
    },
  },
  {
    id: "argument-count-mismatch",
    description: "Nombre d'arguments incorrect dans un appel de fonction",
    match: (error) =>
      error.message.includes("Expected") && error.message.includes("arguments, but got") ||
      error.message.includes("requires") && error.message.includes("argument"),
    fix: (_error, _content) => null,
  },
  {
    id: "no-overload-matches",
    description: "Aucune surcharge de fonction ne correspond aux arguments",
    match: (error) =>
      error.message.includes("No overload matches this call") ||
      error.message.includes("Overload"),
    fix: (_error, _content) => null,
  },
  {
    id: "missing-export",
    description: "Export manquant pour un symbole utilisé depuis un autre fichier",
    match: (error) =>
      error.message.includes("has no exported member") ||
      error.message.includes("is not exported from"),
    fix: (error, content) => {
      const memberMatch = error.message.match(/has no exported member '([^']+)'/) ||
        error.message.match(/'([^']+)' is not exported/);
      if (!memberMatch) return null;
      const memberName = memberMatch[1];

      const declRegex = new RegExp(`^(\\s*)((?:const|let|var|function|class|interface|type)\\s+${memberName}\\b)`, 'm');
      const match = content.match(declRegex);
      if (match) {
        return content.replace(match[0], `${match[1]}export ${match[2]}`);
      }
      return null;
    },
  },
  {
    id: "implicit-any",
    description: "Type 'any' implicite (noImplicitAny)",
    match: (error) =>
      error.message.includes("implicitly has an 'any' type") ||
      error.message.includes("has an implicit 'any' type"),
    fix: (error, content) => {
      const paramMatch = error.message.match(/Parameter '([^']+)' implicitly/) ||
        error.message.match(/'([^']+)' implicitly has/);
      if (!paramMatch) return null;
      const paramName = paramMatch[1];
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      const line = lines[lineNum - 1];
      const paramRegex = new RegExp(`\\b(${paramName})(\\s*[,)])`, 'g');
      if (paramRegex.test(line)) {
        lines[lineNum - 1] = line.replace(
          new RegExp(`\\b(${paramName})(\\s*[,)])`),
          `$1: any$2 // [auto-heal] type explicite`
        );
        return lines.join('\n');
      }
      return null;
    },
  },
  {
    id: "expression-not-callable",
    description: "Expression non appelable (This expression is not callable)",
    match: (error) =>
      error.message.includes("This expression is not callable") ||
      error.message.includes("is not callable"),
    fix: (_error, _content) => null,
  },
  {
    id: "json-parse-error",
    description: "Erreur de parsing JSON (SyntaxError)",
    match: (error) =>
      (error.message.includes("SyntaxError") && error.message.includes("JSON")) ||
      error.message.includes("Unexpected token") && error.message.includes("JSON"),
    fix: (_error, _content) => null,
  },
  {
    id: "readonly-assignment",
    description: "Tentative d'assignation à une propriété readonly",
    match: (error) =>
      error.message.includes("Cannot assign to") && error.message.includes("read-only") ||
      error.message.includes("is a read-only property"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;
      lines[lineNum - 1] = `// [auto-heal] READONLY: ${lines[lineNum - 1].trim()} // TODO: cette propriété est readonly, utiliser une copie ou un setter`;
      return lines.join('\n');
    },
  },
  {
    id: "top-level-await",
    description: "await utilisé en dehors d'une fonction async",
    match: (error) =>
      error.message.includes("'await' expressions are only allowed") ||
      error.message.includes("await is only valid in async function"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/) || error.message.match(/line (\d+)/i);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      for (let i = lineNum - 2; i >= 0; i--) {
        const line = lines[i];
        const funcMatch = line.match(/^(\s*)((?:export\s+)?(?:(?:const|let|var)\s+\w+\s*=\s*)?)(function\s*\w*\s*\()/);
        if (funcMatch && !line.includes('async')) {
          lines[i] = `${funcMatch[1]}${funcMatch[2]}async ${funcMatch[3]}`;
          return lines.join('\n');
        }
        const arrowMatch = line.match(/^(\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*)(\([^)]*\)\s*=>)/);
        if (arrowMatch && !line.includes('async')) {
          lines[i] = `${arrowMatch[1]}async ${arrowMatch[2]}`;
          return lines.join('\n');
        }
        const methodMatch = line.match(/^(\s*(?:public|private|protected)?\s*)((?:static\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)/);
        if (methodMatch && !line.includes('async')) {
          lines[i] = `${methodMatch[1]}async ${methodMatch[2]}`;
          return lines.join('\n');
        }
      }
      return null;
    },
  },
  {
    id: "switch-exhaustiveness",
    description: "Switch non exhaustif (type non couvert)",
    match: (error) =>
      error.message.includes("not assignable to type 'never'") ||
      error.message.includes("Not all code paths") && error.message.includes("switch"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      let braceCount = 0;
      for (let i = lineNum - 1; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === '{') braceCount++;
          if (ch === '}') braceCount--;
        }
        if (braceCount <= 0) {
          const indent = lines[i].match(/^(\s*)/)?.[1] || '';
          lines.splice(i, 0, `${indent}  default: // [auto-heal] case par défaut ajouté`, `${indent}    break;`);
          return lines.join('\n');
        }
      }
      return null;
    },
  },
  {
    id: "deprecated-api",
    description: "Utilisation d'une API dépréciée",
    match: (error) =>
      error.message.includes("is deprecated") ||
      error.message.includes("@deprecated"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;
      if (!lines[lineNum - 1].includes('[auto-heal]')) {
        lines[lineNum - 1] = lines[lineNum - 1] + ' // [auto-heal] TODO: API dépréciée, migrer vers la nouvelle version';
      }
      return lines.join('\n');
    },
  },
  {
    id: "unreachable-code",
    description: "Code inatteignable après return/throw/break",
    match: (error) =>
      error.message.includes("Unreachable code detected") ||
      error.message.includes("unreachable"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;
      lines[lineNum - 1] = `// [auto-heal] UNREACHABLE: ${lines[lineNum - 1].trim()}`;
      return lines.join('\n');
    },
  },
  {
    id: "missing-await-in-return",
    description: "Promesse retournée sans await dans un try/catch",
    match: (error) =>
      error.message.includes("Promise returned") && error.message.includes("must be awaited") ||
      error.message.includes("return await"),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/) || error.message.match(/line (\d+)/i);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      const line = lines[lineNum - 1];
      if (line.includes('return') && !line.includes('await')) {
        lines[lineNum - 1] = line.replace(/return\s+/, 'return await ');
        return lines.join('\n');
      }
      return null;
    },
  },
  {
    id: "object-possibly-undefined-destructuring",
    description: "Destructuring d'un objet potentiellement undefined",
    match: (error) =>
      error.message.includes("Cannot destructure property") ||
      (error.message.includes("destructure") && error.message.includes("undefined")),
    fix: (error, content) => {
      const lineMatch = error.message.match(/\((\d+),\d+\)/);
      if (!lineMatch) return null;
      const lineNum = parseInt(lineMatch[1], 10);
      const lines = content.split('\n');
      if (lineNum <= 0 || lineNum > lines.length) return null;

      const line = lines[lineNum - 1];
      const destructMatch = line.match(/(=\s*)(\w+[\w.]*)\s*;?\s*$/);
      if (destructMatch) {
        lines[lineNum - 1] = line.replace(destructMatch[0], `${destructMatch[1]}${destructMatch[2]} || {};`);
        return lines.join('\n');
      }
      return null;
    },
  },
];
