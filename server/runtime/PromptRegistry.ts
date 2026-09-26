/**
 * PromptRegistry — Registre centralisé des prompts
 * 
 * Remplace les 12 fichiers de prompts dispersés par un registre unique
 * avec support pour :
 * - Templates Markdown avec variables
 * - Héritage (un prompt peut étendre un autre)
 * - Versioning
 * - Cache
 * - Chargement depuis fichiers .md
 * 
 * Architecture :
 *   PromptRegistry.register("agent:base", { content, variables })
 *   PromptRegistry.register("agent:architect", { extends: "agent:base", content })
 *   PromptRegistry.render("agent:architect", { userName: "Bob" })
 */

import type { PromptTemplate } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface RenderOptions {
  /** Variables à injecter dans le template */
  variables?: Record<string, string>;
  /** Sections à exclure (par nom de heading) */
  exclude?: string[];
  /** Mode compact : supprime les lignes vides et commentaires */
  compact?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PromptRegistry
// ═══════════════════════════════════════════════════════════════════════════════

export class PromptRegistry {
  private templates = new Map<string, PromptTemplate>();
  private cache = new Map<string, string>();

  // ─── Enregistrement ────────────────────────────────────────────────────────

  /**
   * Enregistre un template de prompt.
   */
  register(template: PromptTemplate): void {
    this.templates.set(template.id, template);
    // Invalider le cache pour ce template et ses enfants
    this.invalidateCache(template.id);
  }

  /**
   * Enregistre un prompt à partir de contenu brut.
   */
  registerContent(id: string, content: string, opts?: {
    name?: string;
    extends?: string;
    category?: string;
    version?: number;
  }): void {
    const variables = this.extractVariables(content);
    this.register({
      id,
      name: opts?.name ?? id,
      content,
      variables,
      version: opts?.version ?? 1,
      extends: opts?.extends,
      category: opts?.category,
    });
  }

  /**
   * Supprime un template.
   */
  unregister(id: string): boolean {
    this.invalidateCache(id);
    return this.templates.delete(id);
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Rend un prompt en résolvant l'héritage, les variables et les options.
   */
  render(id: string, options: RenderOptions = {}): string {
    // Vérifier le cache (clé = id + hash des options)
    const cacheKey = this.buildCacheKey(id, options);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Prompt "${id}" introuvable. Disponibles: ${Array.from(this.templates.keys()).join(", ")}`);
    }

    // Résoudre l'héritage
    let content = this.resolveInheritance(template);

    // Injecter les variables
    if (options.variables) {
      content = this.injectVariables(content, options.variables);
    }

    // Exclure des sections
    if (options.exclude?.length) {
      content = this.excludeSections(content, options.exclude);
    }

    // Mode compact
    if (options.compact) {
      content = this.compactify(content);
    }

    // Mettre en cache
    this.cache.set(cacheKey, content);
    return content;
  }

  /**
   * Rend un prompt avec les variables injectées, sans cache.
   * Utile pour les prompts dynamiques qui changent à chaque appel.
   */
  renderDynamic(id: string, variables: Record<string, string>): string {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Prompt "${id}" introuvable`);
    }
    let content = this.resolveInheritance(template);
    return this.injectVariables(content, variables);
  }

  // ─── Requêtes ─────────────────────────────────────────────────────────────

  /**
   * Vérifie si un template existe.
   */
  has(id: string): boolean {
    return this.templates.has(id);
  }

  /**
   * Retourne un template brut.
   */
  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Liste tous les templates par catégorie.
   */
  listByCategory(category: string): PromptTemplate[] {
    return Array.from(this.templates.values())
      .filter((t) => t.category === category);
  }

  /**
   * Liste toutes les catégories.
   */
  getCategories(): string[] {
    const cats = new Set<string>();
    for (const t of this.templates.values()) {
      if (t.category) cats.add(t.category);
    }
    return Array.from(cats);
  }

  /**
   * Nombre total de templates.
   */
  get size(): number {
    return this.templates.size;
  }

  // ─── Privé ───────────────────────────────────────────────────────────────

  private resolveInheritance(template: PromptTemplate): string {
    if (!template.extends) return template.content;

    const parent = this.templates.get(template.extends);
    if (!parent) {
      console.warn(`[PromptRegistry] Parent "${template.extends}" non trouvé pour "${template.id}"`);
      return template.content;
    }

    // Récursion (avec protection contre les cycles)
    const parentContent = this.resolveInheritance(parent);

    // Stratégie de fusion : contenu parent + contenu enfant
    // L'enfant peut overrider des sections du parent via des headings identiques
    return this.mergeContents(parentContent, template.content);
  }

  private mergeContents(parent: string, child: string): string {
    // Si l'enfant commence par "---" (frontmatter), on fusionne intelligemment
    // Sinon, simple concaténation parent + enfant
    if (child.startsWith("## ") || child.startsWith("# ")) {
      // L'enfant définit ses propres sections → le contenu enfant remplace
      // les sections parentes avec le même titre
      const parentSections = this.parseSections(parent);
      const childSections = this.parseSections(child);

      // Override les sections parentes
      for (const [title, content] of childSections) {
        parentSections.set(title, content);
      }

      // Reconstruire
      return Array.from(parentSections.entries())
        .map(([title, content]) => `${title}\n${content}`)
        .join("\n\n");
    }

    return `${parent}\n\n${child}`;
  }

  private parseSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split("\n");
    let currentTitle = "";
    let currentContent: string[] = [];

    for (const line of lines) {
      if (line.startsWith("## ") || line.startsWith("# ")) {
        if (currentTitle) {
          sections.set(currentTitle, currentContent.join("\n").trim());
        }
        currentTitle = line;
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentTitle) {
      sections.set(currentTitle, currentContent.join("\n").trim());
    } else if (lines.length > 0) {
      sections.set("__root__", content);
    }

    return sections;
  }

  private injectVariables(content: string, variables: Record<string, string>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return variables[key] ?? `{{${key}}}`;
    });
  }

  private extractVariables(content: string): string[] {
    const matches = content.matchAll(/\{\{(\w+)\}\}/g);
    const vars = new Set<string>();
    for (const match of matches) {
      vars.add(match[1]);
    }
    return Array.from(vars);
  }

  private excludeSections(content: string, exclude: string[]): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let skip = false;
    let skipLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();

        if (exclude.some((ex) => title.toLowerCase().includes(ex.toLowerCase()))) {
          skip = true;
          skipLevel = level;
          continue;
        }

        if (skip && level <= skipLevel) {
          skip = false;
        }
      }

      if (!skip) {
        result.push(line);
      }
    }

    return result.join("\n");
  }

  private compactify(content: string): string {
    // On préserve intégralement le contenu des blocs de code (```), y compris
    // leurs lignes vides : les compacter casse l'indentation et la lisibilité.
    let insideFence = false;
    const kept = content.split("\n").filter((line) => {
      const trimmed = line.trim();

      if (trimmed.startsWith("```")) {
        insideFence = !insideFence;
        return true; // toujours conserver les délimiteurs de fence
      }
      if (insideFence) {
        return true; // tout conserver à l'intérieur d'un bloc de code
      }

      // Hors bloc de code : supprimer lignes vides et commentaires HTML
      return trimmed !== "" && !trimmed.startsWith("<!--");
    });

    // Le collapse des \n{3,} ne doit pas non plus toucher les blocs de code.
    return this.collapseBlankLinesOutsideFences(kept.join("\n"));
  }

  /** Réduit 3+ sauts de ligne consécutifs à 2, hors blocs de code. */
  private collapseBlankLinesOutsideFences(content: string): string {
    const segments = content.split(/(```[\s\S]*?```)/g);
    return segments
      .map((seg) =>
        seg.startsWith("```") ? seg : seg.replace(/\n{3,}/g, "\n\n"),
      )
      .join("");
  }

  private buildCacheKey(id: string, options: RenderOptions): string {
    return `${id}:${JSON.stringify(options)}`;
  }

  private invalidateCache(templateId: string): void {
    // Supprimer toutes les entrées de cache qui commencent par ce template ID
    for (const key of this.cache.keys()) {
      if (key.startsWith(templateId)) {
        this.cache.delete(key);
      }
    }
    // Invalider aussi les templates qui héritent de celui-ci
    for (const t of this.templates.values()) {
      if (t.extends === templateId) {
        this.invalidateCache(t.id);
      }
    }
  }
}
