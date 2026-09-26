/**
 * ASTParser — Moteur d'analyse syntaxique par Tree-sitter
 *
 * Utilise web-tree-sitter (WASM) pour produire un AST complet et précis
 * des fichiers TypeScript/JavaScript, sans compilation native.
 *
 * Capacités :
 *   - Extraction des fonctions/méthodes avec lineStart/lineEnd exacts
 *   - Paramètres avec types TypeScript
 *   - Call-graph intra-fichier (qui appelle qui)
 *   - Détection des arrow-functions, méthodes de classe, closures
 *   - Fallback gracieux vers regex si Tree-sitter indisponible
 *
 * Architecture :
 *   ASTParser (singleton)
 *     ├── init()          → charge le WASM + grammaires (lazy)
 *     ├── parseFile()     → retourne ASTFileResult
 *     └── [privé]
 *           ├── extractFunctions()  → ASTFunction[]
 *           ├── extractClasses()    → ASTClass[]
 *           └── extractCalls()      → ASTCall[]
 */

import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../utils/logger.js";
import type {
  ASTFileResult,
  ASTFunction,
  ASTClass,
  ASTCall,
  ASTParam,
} from "./types.js";

const log = createLogger("ASTParser");

// Chemin vers node_modules (résolu depuis ce fichier ou racine app)
function getBaseDir(): string {
  if (typeof __dirname !== "undefined") return __dirname;
  try {
    // @ts-ignore
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  return process.cwd();
}
const NODE_MODULES = path.resolve(process.env.ELECTRON_APP_PATH || getBaseDir(), process.env.ELECTRON_APP_PATH ? "node_modules" : "../../node_modules");

// ─── Types internes Tree-sitter ───────────────────────────────────────────────

/** Nœud AST Tree-sitter (interface minimale pour compatibilité WASM/natif) */
interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  children: TSNode[];
  namedChildren: TSNode[];
  namedChildCount: number;
  parent: TSNode | null;
  isNamed: boolean;
  childForFieldName(name: string): TSNode | null;
  descendantsOfType(type: string | string[]): TSNode[];
  namedChild(index: number): TSNode | null;
  child(index: number): TSNode | null;
}

interface TSTree {
  rootNode: TSNode;
}

interface TSLanguage {
  // opaque
}

interface TSParserInstance {
  setLanguage(lang: TSLanguage): void;
  parse(source: string): TSTree;
  delete(): void;
}

export interface TreeSitterModule {
  init(): Promise<void>;
  Language: {
    load(wasmPath: string): Promise<TSLanguage>;
  };
  Parser: new () => TSParserInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASTParser
// ═══════════════════════════════════════════════════════════════════════════════

export class ASTParser {
  private _ready: boolean = false;
  private _initPromise: Promise<void> | null = null;
  private _tsParser: TSParserInstance | null = null;
  private _tsxParser: TSParserInstance | null = null;
  private _jsParser: TSParserInstance | null = null;

  /** Initialise le moteur WASM de manière lazy (appelé automatiquement). */
  async init(): Promise<void> {
    if (this._ready) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      // Import dynamique de web-tree-sitter (compatible ESM / CJS bundlers)
      const webTreeSitter = (await import("web-tree-sitter")) as any;
      const Parser = webTreeSitter.Parser || webTreeSitter.default?.Parser || webTreeSitter.default;
      const Language = webTreeSitter.Language || webTreeSitter.default?.Language;

      if (!Parser || typeof Parser.init !== "function") {
        throw new Error("Impossible de trouver la classe Parser de web-tree-sitter");
      }

      // Charger le runtime WASM principal
      const mainWasmPath = path.join(NODE_MODULES, "web-tree-sitter", "web-tree-sitter.wasm");
      await Parser.init({
        locateFile(scriptName: string) {
          if (scriptName.endsWith(".wasm")) {
            return mainWasmPath;
          }
          return scriptName;
        },
      });

      // Charger les grammaires TypeScript / TSX / JavaScript
      const [tsLang, tsxLang, jsLang] = await Promise.all([
        Language.load(
          path.join(NODE_MODULES, "tree-sitter-typescript", "tree-sitter-typescript.wasm")
        ),
        Language.load(
          path.join(NODE_MODULES, "tree-sitter-typescript", "tree-sitter-tsx.wasm")
        ),
        Language.load(
          path.join(NODE_MODULES, "tree-sitter-javascript", "tree-sitter-javascript.wasm")
        ),
      ]);

      // Créer les parsers (réutilisables, thread-safe en lecture)
      const tsParser = new Parser();
      tsParser.setLanguage(tsLang);
      this._tsParser = tsParser;

      const tsxParser = new Parser();
      tsxParser.setLanguage(tsxLang);
      this._tsxParser = tsxParser;

      const jsParser = new Parser();
      jsParser.setLanguage(jsLang);
      this._jsParser = jsParser;

      this._ready = true;
      log.info("✅ ASTParser initialisé (web-tree-sitter WASM)");
    } catch (err) {
      log.warn(`⚠️ ASTParser: Tree-sitter indisponible, fallback regex activé — ${(err as Error).message}`);
      this._ready = false;
    }
  }

  /** Retourne true si Tree-sitter est opérationnel. */
  get isReady(): boolean {
    return this._ready;
  }

  // ─── API publique ──────────────────────────────────────────────────────────

  /**
   * Parse un fichier source et retourne son analyse AST complète.
   * Si Tree-sitter est indisponible, retourne un résultat vide avec
   * usedFallback = true (le ProjectIndexer utilisera ses regex habituelles).
   *
   * @param content Contenu du fichier (déjà lu)
   * @param filePath Chemin relatif du fichier (pour les métadonnées)
   * @param ext Extension du fichier (.ts | .tsx | .js | .jsx | .mjs | .cjs)
   */
  async parseFile(
    content: string,
    filePath: string,
    ext: string
  ): Promise<ASTFileResult> {
    const t0 = Date.now();

    // Initialisation lazy
    if (!this._ready && !this._initPromise) {
      await this.init();
    } else if (this._initPromise && !this._ready) {
      await this._initPromise;
    }

    // Fallback si Tree-sitter indisponible
    if (!this._ready) {
      return this._emptyResult(filePath, ext, t0, true);
    }

    try {
      const parser = this._getParser(ext);
      if (!parser) {
        return this._emptyResult(filePath, ext, t0, true);
      }

      const tree = parser.parse(content);
      const root = tree.rootNode as unknown as TSNode;
      const language = this._detectLanguage(ext);

      const functions = this._extractFunctions(root, filePath, content);
      const classes = this._extractClasses(root, filePath, content, functions);
      const calls = this._extractCalls(root, filePath, functions, classes);

      return {
        language,
        filePath,
        functions,
        classes,
        calls,
        parseTimeMs: Date.now() - t0,
        usedFallback: false,
      };
    } catch (err) {
      log.debug(`⚠️ ASTParser: erreur parsing ${filePath} — ${(err as Error).message}`);
      return this._emptyResult(filePath, ext, t0, true);
    }
  }

  // ─── Extraction des fonctions ──────────────────────────────────────────────

  private _extractFunctions(
    root: TSNode,
    filePath: string,
    _content: string
  ): ASTFunction[] {
    const functions: ASTFunction[] = [];
    const seen = new Set<string>();

    // Types de nœuds qui représentent des fonctions
    const funcTypes = [
      "function_declaration",
      "function_expression",
      "arrow_function",
      "method_definition",
      "generator_function_declaration",
    ];

    const funcNodes = root.descendantsOfType(funcTypes);

    for (const node of funcNodes) {
      const fn = this._parseFunctionNode(node, filePath, seen);
      if (fn) functions.push(fn);
    }

    return functions;
  }

  private _parseFunctionNode(
    node: TSNode,
    filePath: string,
    seen: Set<string>
  ): ASTFunction | null {
    const nameNode =
      node.childForFieldName("name") ||
      this._findAssignedName(node);

    if (!nameNode && node.type === "arrow_function") {
      // Arrow function anonyme sans nom assigné → ignorer
      return null;
    }

    const name = nameNode?.text ?? "(anonymous)";
    const lineStart = node.startPosition.row + 1;
    const lineEnd = node.endPosition.row + 1;

    // Éviter les doublons (même nom + même ligne)
    const key = `${filePath}:${name}:${lineStart}`;
    if (seen.has(key)) return null;
    seen.add(key);

    // Paramètres
    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this._extractParams(paramsNode) : [];

    // Type de retour
    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode
      ? this._cleanTypeAnnotation(returnTypeNode.text)
      : undefined;

    // Modificateurs
    const isAsync = this._hasModifier(node, "async");
    const isExported = this._isExported(node);
    const isMethod = node.type === "method_definition";
    const isArrow = node.type === "arrow_function";

    // Classe parente
    const className = this._findParentClassName(node);

    return {
      name,
      filePath,
      lineStart,
      lineEnd,
      params,
      returnType,
      isAsync,
      isExported,
      isMethod,
      className,
      isArrow,
    };
  }

  /** Pour arrow_function, cherche le nom dans le VariableDeclarator parent. */
  private _findAssignedName(node: TSNode): TSNode | null {
    let parent = node.parent;
    while (parent) {
      if (parent.type === "variable_declarator") {
        return parent.childForFieldName("name");
      }
      if (
        parent.type === "statement_block" ||
        parent.type === "program" ||
        parent.type === "class_body"
      ) {
        break;
      }
      parent = parent.parent;
    }
    return null;
  }

  private _extractParams(paramsNode: TSNode): ASTParam[] {
    const params: ASTParam[] = [];

    for (const child of paramsNode.namedChildren) {
      if (child.type === "required_parameter" || child.type === "optional_parameter") {
        const nameNode =
          child.childForFieldName("pattern") || child.namedChild(0);
        const typeNode = child.childForFieldName("type");
        const optional =
          child.type === "optional_parameter" ||
          child.text.includes("?");
        params.push({
          name: nameNode?.text ?? "_",
          type: typeNode ? this._cleanTypeAnnotation(typeNode.text) : undefined,
          optional,
        });
      } else if (child.type === "identifier") {
        params.push({ name: child.text, optional: false });
      } else if (child.type === "rest_pattern" || child.type === "rest_element") {
        const inner = child.namedChild(0);
        params.push({ name: `...${inner?.text ?? "args"}`, optional: false });
      }
    }

    return params;
  }

  private _cleanTypeAnnotation(text: string): string {
    // Enlever le ": " préfixe des annotations de type Tree-sitter
    return text.replace(/^\s*:\s*/, "").trim();
  }

  private _hasModifier(node: TSNode, modifier: string): boolean {
    // Chercher dans les enfants du niveau courant ou parent proche
    let current: TSNode | null = node;
    while (current && current.type !== "program") {
      for (const child of current.children) {
        if (child.type === modifier || child.text === modifier) return true;
      }
      // "async function" → async est un sibling au niveau lexical_declaration
      if (current.parent?.type === "lexical_declaration" || current.parent?.type === "export_statement") {
        for (const child of (current.parent?.children ?? [])) {
          if (child.text === modifier) return true;
        }
      }
      break;
    }
    return node.text.trimStart().startsWith(modifier);
  }

  private _isExported(node: TSNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    if (parent.type === "export_statement") return true;
    if (parent.type === "lexical_declaration" && parent.parent?.type === "export_statement") return true;
    if (parent.type === "variable_declarator" && parent.parent?.type === "lexical_declaration" && parent.parent?.parent?.type === "export_statement") return true;
    return false;
  }

  private _findParentClassName(node: TSNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === "class_declaration" || current.type === "class") {
        const nameNode = current.childForFieldName("name");
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  // ─── Extraction des classes ────────────────────────────────────────────────

  private _extractClasses(
    root: TSNode,
    filePath: string,
    _content: string,
    allFunctions: ASTFunction[]
  ): ASTClass[] {
    const classes: ASTClass[] = [];
    const classNodes = root.descendantsOfType(["class_declaration", "class"]);

    for (const node of classNodes) {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) continue;

      const name = nameNode.text;
      const lineStart = node.startPosition.row + 1;
      const lineEnd = node.endPosition.row + 1;

      // Classe parente
      const heritageNode = node.childForFieldName("superclass");
      const superClass = heritageNode?.text;

      // Interfaces (implements clause)
      const interfaces: string[] = [];
      const implementsClause = node.descendantsOfType("implements_clause");
      for (const clause of implementsClause) {
        for (const child of clause.namedChildren) {
          if (child.type !== "implements") {
            interfaces.push(child.text.replace(/<.*>/, "").trim());
          }
        }
      }

      // Méthodes = fonctions de allFunctions dont la className correspond
      const methods = allFunctions.filter(
        f => f.className === name && f.filePath === filePath
      );

      const isExported = this._isExported(node);

      classes.push({
        name,
        filePath,
        lineStart,
        lineEnd,
        superClass,
        interfaces,
        methods,
        isExported,
      });
    }

    return classes;
  }

  // ─── Extraction du call-graph ──────────────────────────────────────────────

  private _extractCalls(
    root: TSNode,
    _filePath: string,
    functions: ASTFunction[],
    _classes: ASTClass[]
  ): ASTCall[] {
    const calls: ASTCall[] = [];
    const seenKeys = new Set<string>();

    const callNodes = root.descendantsOfType("call_expression");

    for (const callNode of callNodes) {
      const functionNode = callNode.childForFieldName("function");
      if (!functionNode) continue;

      // Extraire callee + calleeObject
      let callee: string;
      let calleeObject: string | undefined;

      if (functionNode.type === "member_expression") {
        const obj = functionNode.childForFieldName("object");
        const prop = functionNode.childForFieldName("property");
        calleeObject = obj?.text ?? undefined;
        callee = prop?.text ?? functionNode.text;
      } else {
        callee = functionNode.text;
      }

      // Ignorer les callees triviaux ou trop longs
      if (!callee || callee.length > 80 || /^["'`]/.test(callee)) continue;
      // Ignorer les appels de constructeurs purs (new X())
      if (callNode.parent?.type === "new_expression") continue;

      const lineNumber = callNode.startPosition.row + 1;

      // Trouver la fonction englobante
      const enclosing = this._findEnclosingFunction(callNode, functions, _classes);

      // Détecter await
      const isAwait = callNode.parent?.type === "await_expression";

      // Détecter chaining
      const isChained = callNode.parent?.type === "member_expression";

      const key = `${enclosing.callerFunction}|${callee}|${lineNumber}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      calls.push({
        callerFunction: enclosing.callerFunction,
        callerClass: enclosing.callerClass,
        callee,
        calleeObject,
        lineNumber,
        isAwait,
        isChained,
      });
    }

    return calls;
  }

  private _findEnclosingFunction(
    node: TSNode,
    functions: ASTFunction[],
    _classes: ASTClass[]
  ): { callerFunction: string; callerClass?: string } {
    const line = node.startPosition.row + 1;

    // Trouver la fonction la plus proche qui contient cette ligne
    let best: ASTFunction | null = null;
    let bestSpan = Infinity;

    for (const fn of functions) {
      if (fn.lineStart <= line && fn.lineEnd >= line) {
        const span = fn.lineEnd - fn.lineStart;
        if (span < bestSpan) {
          bestSpan = span;
          best = fn;
        }
      }
    }

    if (best) {
      return { callerFunction: best.name, callerClass: best.className };
    }

    // Fallback : chercher le nom de classe englobant
    let current = node.parent;
    while (current) {
      if (current.type === "class_declaration" || current.type === "class") {
        const nameNode = current.childForFieldName("name");
        return { callerFunction: "(class body)", callerClass: nameNode?.text };
      }
      current = current.parent;
    }

    return { callerFunction: "(module)" };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _getParser(ext: string): TSParserInstance | null {
    switch (ext.toLowerCase()) {
      case ".ts": return this._tsParser;
      case ".tsx": return this._tsxParser;
      case ".js":
      case ".jsx":
      case ".mjs":
      case ".cjs": return this._jsParser;
      default: return null;
    }
  }

  private _detectLanguage(ext: string): ASTFileResult["language"] {
    switch (ext.toLowerCase()) {
      case ".ts": return "typescript";
      case ".tsx": return "tsx";
      case ".jsx": return "jsx";
      default: return "javascript";
    }
  }

  private _emptyResult(
    filePath: string,
    ext: string,
    t0: number,
    usedFallback: boolean
  ): ASTFileResult {
    return {
      language: this._detectLanguage(ext),
      filePath,
      functions: [],
      classes: [],
      calls: [],
      parseTimeMs: Date.now() - t0,
      usedFallback,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Instance singleton du moteur AST.
 * L'initialisation est lazy : Tree-sitter est chargé à la première utilisation.
 */
export const astParser = new ASTParser();
