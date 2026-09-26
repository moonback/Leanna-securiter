/**
 * RelationExtractor — Extraction de relations sémantiques entre entités
 *
 * Analyse le code source pour détecter les relations typées :
 *   - extends : class A extends B
 *   - implements : class A implements I
 *   - uses : function/méthode appelle une autre entité
 *   - tests : fichier .test.ts teste un fichier .ts
 *   - configures : fichier .config affecte un module
 *   - composes : composant React utilise un autre composant
 *   - calls : fonction appelle une autre fonction (chaîne d'appels)
 *   - serves : fichier sert une route/endpoint API
 *   - reads_env : fichier utilise une variable d'environnement
 *   - writes_table / reads_table : code interagit avec une table DB
 *   - tested_by : entité est testée par un fichier de test
 *
 * Appelé par ProjectIndexer après le parsing d'un fichier.
 */

import path from "path";
import type { EntityRelation, FileNode, CodeEntity, ASTFileResult } from "./types.js";
import { astCallGraph } from "./ASTCallGraph.js";

// ═══════════════════════════════════════════════════════════════════════════════
// RelationExtractor
// ═══════════════════════════════════════════════════════════════════════════════

export class RelationExtractor {
  /**
   * Extrait toutes les relations d'un fichier parsé.
   * 
   * @param fileNode Le fichier déjà parsé avec ses entités
   * @param content Le contenu brut du fichier
   * @param allFiles Map de tous les fichiers connus (pour résolution)
   */
  extractRelations(
    fileNode: FileNode,
    content: string,
    allFiles: Record<string, FileNode>
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const lines = content.split(/\r?\n/);

    // 1. Dépendances explicites entre fichiers/modules
    relations.push(...this.extractDependencyRelations(fileNode, allFiles));

    // 2. Relations d'héritage et implémentation
    relations.push(...this.extractInheritance(fileNode, lines));

    // 3. Relations de test
    relations.push(...this.extractTestRelations(fileNode, allFiles));

    // 3. Relations de composition (React)
    relations.push(...this.extractComposition(fileNode, lines, allFiles));

    // 4. Relations de configuration
    relations.push(...this.extractConfigRelations(fileNode, allFiles));

    // 5. Relations d'appels de fonctions (calls)
    relations.push(...this.extractFunctionCalls(fileNode, lines, allFiles));

    // 6. Relations de routes/endpoints API (serves)
    relations.push(...this.extractRouteRelations(fileNode, lines));

    // 7. Relations de variables d'environnement (reads_env)
    relations.push(...this.extractEnvVarRelations(fileNode, lines));

    // 8. Relations de tables de base de données (reads_table / writes_table)
    relations.push(...this.extractDatabaseRelations(fileNode, lines));

    return relations;
  }

  // ─── Dépendances de modules ───────────────────────────────────────────────

  /**
   * Matérialise les imports comme relations de premier niveau du graphe.
   * Les dépendances externes restent présentes, même sans fichier local résolu.
   */
  private extractDependencyRelations(
    fileNode: FileNode,
    allFiles: Record<string, FileNode>
  ): EntityRelation[] {
    const sourceName = path.basename(fileNode.path, path.extname(fileNode.path));

    return fileNode.imports.map((importPath) => {
      const resolvedPath = this.resolveImportToFile(importPath, fileNode, allFiles);
      return {
        source: {
          name: sourceName,
          filePath: fileNode.path,
          type: "constant" as const,
        },
        target: {
          name: resolvedPath ?? importPath,
          filePath: resolvedPath ?? `(package:${importPath})`,
          type: "import" as const,
        },
        relationType: "depends_on" as const,
        confidence: resolvedPath ? 1 : 0.9,
      };
    });
  }

  // ─── Héritage (extends / implements) ──────────────────────────────────────

  private extractInheritance(fileNode: FileNode, lines: string[]): EntityRelation[] {
    const relations: EntityRelation[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern: class ClassName extends ParentClass
      const extendsMatch = line.match(
        /class\s+(\w+)(?:\s*<[^>]*>)?\s+extends\s+(\w+)/
      );
      if (extendsMatch) {
        const [, childName, parentName] = extendsMatch;
        relations.push({
          source: {
            name: childName,
            filePath: fileNode.path,
            type: "class",
          },
          target: {
            name: parentName,
            filePath: this.resolveEntityFile(parentName, fileNode) || fileNode.path,
            type: "class",
          },
          relationType: "extends",
          confidence: 0.95,
          sourceLine: i + 1,
        });
      }

      // Pattern: class ClassName implements Interface1, Interface2
      const implementsMatch = line.match(
        /class\s+(\w+)(?:\s*<[^>]*>)?(?:\s+extends\s+\w+(?:\s*<[^>]*>)?)?\s+implements\s+(.+?)[\s{]/
      );
      if (implementsMatch) {
        const [, className, interfaceList] = implementsMatch;
        const interfaces = interfaceList.split(",").map(s => s.trim().replace(/<.*/, ""));
        
        for (const iface of interfaces) {
          if (iface && /^\w+$/.test(iface)) {
            relations.push({
              source: {
                name: className,
                filePath: fileNode.path,
                type: "class",
              },
              target: {
                name: iface,
                filePath: this.resolveEntityFile(iface, fileNode) || fileNode.path,
                type: "interface",
              },
              relationType: "implements",
              confidence: 0.95,
              sourceLine: i + 1,
            });
          }
        }
      }
    }

    return relations;
  }

  // ─── Relations de test ────────────────────────────────────────────────────

  private extractTestRelations(
    fileNode: FileNode,
    allFiles: Record<string, FileNode>
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const filePath = fileNode.path;

    // Détecter si c'est un fichier de test
    const testMatch = filePath.match(/^(.+)\.(test|spec)\.(ts|tsx|js|jsx)$/);
    if (!testMatch) return relations;

    // Trouver le fichier source correspondant
    const basePath = testMatch[1];
    const possibleSources = [
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
    ];

    for (const sourcePath of possibleSources) {
      if (allFiles[sourcePath]) {
        // Chaque entité exportée du fichier source est "testée" par ce fichier
        const sourceFile = allFiles[sourcePath];
        for (const entity of sourceFile.entities.filter(
          (entity) => entity.type !== "symbol" && entity.modifiers?.includes("export")
        )) {
          const testFile = {
            name: path.basename(filePath, path.extname(filePath)),
            filePath,
            type: "function" as const,
          };
          const testedEntity = {
            name: entity.name,
            filePath: sourcePath,
            type: entity.type,
          };
          relations.push({
            source: testFile,
            target: testedEntity,
            relationType: "tests",
            confidence: 0.85,
          });
          relations.push({
            source: testedEntity,
            target: testFile,
            relationType: "tested_by",
            confidence: 0.85,
          });
        }
        break; // On ne teste qu'un fichier source
      }
    }

    return relations;
  }

  // ─── Composition React ────────────────────────────────────────────────────

  private extractComposition(
    fileNode: FileNode,
    lines: string[],
    _allFiles: Record<string, FileNode>
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];

    // Ne traiter que les fichiers .tsx / .jsx
    if (!/\.(tsx|jsx)$/.test(fileNode.path)) return relations;

    // Trouver les composants définis dans ce fichier
    const components = fileNode.entities.filter(
      e => e.type === "component" || (e.type === "function" && /^[A-Z]/.test(e.name))
    );
    if (components.length === 0) return relations;

    // Trouver les imports de composants (noms commençant par majuscule)
    const importedComponents = new Set<string>();
    for (const line of lines) {
      const importMatch = line.match(/import\s+\{([^}]+)\}\s+from/);
      if (importMatch) {
        const names = importMatch[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0]);
        for (const name of names) {
          if (/^[A-Z]/.test(name)) importedComponents.add(name);
        }
      }
      // Default import de composant
      const defaultImport = line.match(/import\s+([A-Z]\w+)\s+from/);
      if (defaultImport) {
        importedComponents.add(defaultImport[1]);
      }
    }

    // Détecter l'utilisation des composants importés dans le JSX
    const contentStr = lines.join("\n");
    for (const imported of importedComponents) {
      // Chercher <ComponentName ou <ComponentName> dans le contenu
      const usageRegex = new RegExp(`<${imported}[\\s/>]`);
      if (usageRegex.test(contentStr)) {
        const mainComponent = components[0]; // Le composant principal du fichier
        relations.push({
          source: {
            name: mainComponent.name,
            filePath: fileNode.path,
            type: "component",
          },
          target: {
            name: imported,
            filePath: this.resolveEntityFile(imported, fileNode) || "unknown",
            type: "component",
          },
          relationType: "composes",
          confidence: 0.80,
        });
      }
    }

    return relations;
  }

  // ─── Relations de configuration ───────────────────────────────────────────

  private extractConfigRelations(
    fileNode: FileNode,
    _allFiles: Record<string, FileNode>
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const filePath = fileNode.path;

    // Détecter les fichiers de configuration
    const configPatterns: { regex: RegExp; targetModule: string }[] = [
      { regex: /tsconfig.*\.json$/, targetModule: "typescript" },
      { regex: /vite\.config\.(ts|js|mjs)$/, targetModule: "vite" },
      { regex: /tailwind\.config\.(ts|js|mjs)$/, targetModule: "tailwind" },
      { regex: /eslint.*\.(ts|js|json|cjs|mjs)$/, targetModule: "eslint" },
      { regex: /jest\.config\.(ts|js)$/, targetModule: "jest" },
      { regex: /webpack\.config\.(ts|js)$/, targetModule: "webpack" },
      { regex: /postcss\.config\.(ts|js|cjs|mjs)$/, targetModule: "postcss" },
    ];

    for (const { regex, targetModule } of configPatterns) {
      if (regex.test(filePath)) {
        relations.push({
          source: {
            name: path.basename(filePath),
            filePath: filePath,
            type: "constant",
          },
          target: {
            name: targetModule,
            filePath: `(build-tool:${targetModule})`,
            type: "constant",
          },
          relationType: "configures",
          confidence: 0.90,
        });
      }
    }

    return relations;
  }

  // ─── Appels de fonctions (calls) ──────────────────────────────────────────

  /**
   * Détecte les appels de fonctions entre fichiers.
   * Identifie quand un fichier importe et appelle une fonction exportée par un autre.
   */
  private extractFunctionCalls(
    fileNode: FileNode,
    lines: string[],
    allFiles: Record<string, FileNode>
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];

    // Collecter les imports nommés du fichier
    const importedSymbols = new Map<string, string>(); // symbol → import path
    for (const line of lines) {
      const importMatch = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const names = importMatch[1].split(",").map(s => s.trim().split(/\s+as\s+/));
        const importPath = importMatch[2];
        for (const parts of names) {
          const localName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
          const originalName = parts[0].trim();
          if (localName && /^[a-z]/.test(localName)) {
            importedSymbols.set(localName, importPath);
            if (originalName !== localName) {
              importedSymbols.set(originalName, importPath);
            }
          }
        }
      }
    }

    // Trouver les appels de ces fonctions importées dans le corps du fichier
    const seenCalls = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Ignorer les lignes d'import/export
      if (/^\s*(import|export)\s/.test(line)) continue;

      for (const [symbol, importPath] of importedSymbols) {
        // Pattern: functionName( ou await functionName(
        const callRegex = new RegExp(`\\b${symbol}\\s*\\(`);
        if (callRegex.test(line)) {
          const callKey = `${fileNode.path}→${symbol}@${importPath}`;
          if (seenCalls.has(callKey)) continue;
          seenCalls.add(callKey);

          // Trouver le composant principal appelant
          const caller = this.findEnclosingEntity(fileNode, i + 1);

          relations.push({
            source: {
              name: caller?.name || path.basename(fileNode.path, path.extname(fileNode.path)),
              filePath: fileNode.path,
              type: caller?.type || "function",
            },
            target: {
              name: symbol,
              filePath: this.resolveImportToFile(importPath, fileNode, allFiles) || importPath,
              type: "function",
            },
            relationType: "calls",
            confidence: 0.80,
            sourceLine: i + 1,
          });
        }
      }
    }

    return relations;
  }

  // ─── Routes / Endpoints API (serves) ──────────────────────────────────────

  /**
   * Détecte les routes Express (app.get, router.post, etc.)
   * et crée des relations "serves".
   */
  private extractRouteRelations(
    fileNode: FileNode,
    lines: string[]
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];

    const routePatterns = [
      // app.get("/api/...", ...) ou router.get("/...", ...)
      /(?:app|router)\.(get|post|put|delete|patch|all)\s*\(\s*['"`]([^'"`]+)['"`]/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of routePatterns) {
        const match = line.match(pattern);
        if (match) {
          const [, method, routePath] = match;
          const routeName = `${method.toUpperCase()} ${routePath}`;

          relations.push({
            source: {
              name: path.basename(fileNode.path, path.extname(fileNode.path)),
              filePath: fileNode.path,
              type: "function",
            },
            target: {
              name: routeName,
              filePath: `(api:${routePath})`,
              type: "route",
            },
            relationType: "serves",
            confidence: 0.95,
            sourceLine: i + 1,
          });
        }
      }
    }

    return relations;
  }

  // ─── Variables d'environnement (reads_env) ────────────────────────────────

  /**
   * Détecte les accès à process.env.XXX et crée des relations "reads_env".
   */
  private extractEnvVarRelations(
    fileNode: FileNode,
    lines: string[]
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const seenVars = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern: process.env.VARIABLE_NAME
      const envMatches = line.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
      for (const match of envMatches) {
        const varName = match[1];
        if (seenVars.has(varName)) continue;
        seenVars.add(varName);

        relations.push({
          source: {
            name: path.basename(fileNode.path, path.extname(fileNode.path)),
            filePath: fileNode.path,
            type: "function",
          },
          target: {
            name: varName,
            filePath: "(env)",
            type: "env_var",
          },
          relationType: "reads_env",
          confidence: 0.95,
          sourceLine: i + 1,
        });
      }

      // Pattern: import.meta.env.VITE_XXX (Vite)
      const viteEnvMatches = line.matchAll(/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g);
      for (const match of viteEnvMatches) {
        const varName = match[1];
        if (seenVars.has(varName)) continue;
        seenVars.add(varName);

        relations.push({
          source: {
            name: path.basename(fileNode.path, path.extname(fileNode.path)),
            filePath: fileNode.path,
            type: "function",
          },
          target: {
            name: varName,
            filePath: "(env:vite)",
            type: "env_var",
          },
          relationType: "reads_env",
          confidence: 0.95,
          sourceLine: i + 1,
        });
      }
    }

    return relations;
  }

  // ─── Tables de base de données (reads_table / writes_table) ───────────────

  /**
   * Détecte les interactions avec les tables de base de données :
   * - CREATE TABLE statements
   * - supabase.from('table')
   * - SQL queries (SELECT/INSERT/UPDATE/DELETE FROM table)
   * - ORM patterns (prisma.table, knex('table'))
   */
  private extractDatabaseRelations(
    fileNode: FileNode,
    lines: string[]
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const seenTables = new Map<string, Set<string>>(); // table → Set<relationType>

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern: supabase.from('table_name')
      const supabaseMatch = line.match(/\.from\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)/i);
      if (supabaseMatch) {
        const tableName = supabaseMatch[1];
        // Déterminer si c'est une lecture ou écriture
        const isWrite = /\.(insert|update|upsert|delete)\s*\(/.test(line) ||
                        /\.(insert|update|upsert|delete)\s*\(/.test(lines[i + 1] || "");
        const relType = isWrite ? "writes_table" : "reads_table";
        this.addTableRelation(relations, seenTables, fileNode, tableName, relType, i + 1);
      }

      // Pattern: CREATE TABLE table_name
      const createMatch = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
      if (createMatch) {
        const tableName = createMatch[1];
        this.addTableRelation(relations, seenTables, fileNode, tableName, "writes_table", i + 1);
      }

      // Pattern: SELECT ... FROM table_name
      const selectMatch = line.match(/\bSELECT\b.*\bFROM\s+(\w+)/i);
      if (selectMatch) {
        const tableName = selectMatch[1];
        if (!/^(select|where|and|or|not|null|true|false)$/i.test(tableName)) {
          this.addTableRelation(relations, seenTables, fileNode, tableName, "reads_table", i + 1);
        }
      }

      // Pattern: INSERT INTO table_name
      const insertMatch = line.match(/\bINSERT\s+INTO\s+(\w+)/i);
      if (insertMatch) {
        this.addTableRelation(relations, seenTables, fileNode, insertMatch[1], "writes_table", i + 1);
      }

      // Pattern: UPDATE table_name SET
      const updateMatch = line.match(/\bUPDATE\s+(\w+)\s+SET\b/i);
      if (updateMatch) {
        this.addTableRelation(relations, seenTables, fileNode, updateMatch[1], "writes_table", i + 1);
      }

      // Pattern: DELETE FROM table_name
      const deleteMatch = line.match(/\bDELETE\s+FROM\s+(\w+)/i);
      if (deleteMatch) {
        this.addTableRelation(relations, seenTables, fileNode, deleteMatch[1], "writes_table", i + 1);
      }
    }

    return relations;
  }

  /**
   * Ajoute une relation de table (dédupliquée par table + type de relation).
   */
  private addTableRelation(
    relations: EntityRelation[],
    seenTables: Map<string, Set<string>>,
    fileNode: FileNode,
    tableName: string,
    relationType: "reads_table" | "writes_table",
    line: number
  ): void {
    if (!seenTables.has(tableName)) seenTables.set(tableName, new Set());
    const seen = seenTables.get(tableName)!;
    if (seen.has(relationType)) return;
    seen.add(relationType);

    relations.push({
      source: {
        name: path.basename(fileNode.path, path.extname(fileNode.path)),
        filePath: fileNode.path,
        type: "function",
      },
      target: {
        name: tableName,
        filePath: "(db)",
        type: "db_table",
      },
      relationType,
      confidence: 0.85,
      sourceLine: line,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Essaye de résoudre dans quel fichier une entité est définie,
   * en se basant sur les imports du fichier courant.
   */
  private resolveEntityFile(entityName: string, fileNode: FileNode): string | null {
    // Chercher dans les imports du fichier si l'entité est importée
    for (const entity of fileNode.entities) {
      if (entity.type === "import" && entity.name === entityName && entity.dependencies?.[0]) {
        // Retourner le chemin d'import (non résolu, mais utile)
        return entity.dependencies[0];
      }
    }
    return null;
  }

  /**
   * Résout un chemin d'import vers un fichier connu dans le graphe.
   */
  private resolveImportToFile(
    importPath: string,
    fileNode: FileNode,
    allFiles: Record<string, FileNode>
  ): string | null {
    if (!importPath.startsWith(".")) return null;

    const sourceDir = path.dirname(fileNode.path);
    const resolved = path.normalize(path.join(sourceDir, importPath)).replace(/\\/g, "/");

    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
    for (const ext of extensions) {
      const candidate = resolved + ext;
      if (allFiles[candidate]) return candidate;
    }
    if (allFiles[resolved]) return resolved;
    return null;
  }

  /**
   * Trouve l'entité (fonction/classe/méthode) qui contient une ligne donnée.
   */
  private findEnclosingEntity(fileNode: FileNode, lineNumber: number): CodeEntity | null {
    let best: CodeEntity | null = null;
    let bestDistance = Infinity;

    for (const entity of fileNode.entities) {
      if (entity.type === "import" || entity.type === "export") continue;
      if (entity.lineStart <= lineNumber && (entity.lineEnd === undefined || entity.lineEnd >= lineNumber)) {
        const distance = lineNumber - entity.lineStart;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entity;
        }
      }
    }
    return best;
  }

  // ─── Relations d'appels AST ────────────────────────────────────────────────

  /**
   * Produit des EntityRelation de type "calls" à partir des résultats AST.
   * Confiance = 0.95 (vs 0.80 pour les regex).
   *
   * Stratégie :
   *  1. Pour chaque ASTCall résolu (inter-fichier), créer une relation calls
   *  2. Pour les appels intra-fichier (this.method()), créer des relations intra
   *  3. Dédupliquer par (caller, callee, sourceLine)
   *
   * @param astResults Map filePath → ASTFileResult (les fichiers parsés lors du scan)
   * @param allFiles   Tous les FileNode du KnowledgeGraph (pour résolution)
   */
  extractASTCallRelations(
    astResults: Map<string, ASTFileResult>,
    allFiles: FileNode[]
  ): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const seenKeys = new Set<string>();

    // Construire un index des fonctions exportées par fichier (pour la résolution)
    const exportIndex = new Map<string, { filePath: string; type: FileNode["entities"][number]["type"] }>();
    for (const file of allFiles) {
      for (const entity of file.entities) {
        if (entity.modifiers?.includes("export")) {
          exportIndex.set(entity.name, { filePath: file.path, type: entity.type });
        }
      }
    }

    for (const [filePath, astResult] of astResults) {
      if (astResult.usedFallback) continue;

      // Relations inter-fichiers via le call-graph AST
      const crossEdges = astCallGraph.getCrossFileCallEdges(filePath);
      for (const edge of crossEdges) {
        const key = `${edge.callerId}→${edge.calleeId}@${edge.sourceLine}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const calleeNode = exportIndex.get(edge.calleeName);
        relations.push({
          source: {
            name: edge.callerId.split("#")[1] ?? edge.callerId,
            filePath,
            type: "function",
          },
          target: {
            name: edge.calleeName,
            filePath: calleeNode?.filePath ?? `(external:${edge.calleeName})`,
            type: (calleeNode?.type as any) ?? "function",
          },
          relationType: "calls",
          confidence: edge.isResolved ? 0.95 : 0.75,
          sourceLine: edge.sourceLine,
        });
      }

      // Relations intra-fichier (this.method()) — graphe d'appels au sein d'une classe
      relations.push(...this.extractIntraFileCallGraph(astResult));
    }

    return relations;
  }

  /**
   * Extrait les relations d'appels intra-fichier depuis l'AST.
   * Cible principalement les appels de méthode (this.foo(), super.bar()),
   * qui sont totalement invisibles pour les regex.
   */
  private extractIntraFileCallGraph(astResult: ASTFileResult): EntityRelation[] {
    const relations: EntityRelation[] = [];
    const seenKeys = new Set<string>();
    const filePath = astResult.filePath;

    // Construire un index des méthodes connues dans ce fichier
    const localMethodNames = new Set<string>();
    for (const fn of astResult.functions) {
      localMethodNames.add(fn.name);
    }

    for (const call of astResult.calls) {
      // Ne garder que les appels vers une fonction locale et de type "this.x"
      const isIntraClass = call.calleeObject === "this" || localMethodNames.has(call.callee);
      if (!isIntraClass) continue;
      if (call.callerFunction === call.callee) continue; // appel récursif direct

      const key = `${call.callerFunction}→${call.callee}@${call.lineNumber}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      relations.push({
        source: {
          name: call.callerFunction,
          filePath,
          type: call.callerClass ? "method" : "function",
        },
        target: {
          name: call.callee,
          filePath,
          type: "function",
        },
        relationType: "calls",
        confidence: 0.92,
        sourceLine: call.lineNumber,
      });
    }

    return relations;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const relationExtractor = new RelationExtractor();
